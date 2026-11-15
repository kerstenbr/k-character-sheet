import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, unlinkSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Kind, Resource } from "../shared/types";

export function assetRefs(value: any): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => (k === "assetId" && typeof v === "string" ? [v] : assetRefs(v)));
}
export class Store {
  db: DatabaseSync;
  files: string;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true });
    this.files = path.join(dir, "files");
    mkdirSync(this.files, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "app.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA auto_vacuum=INCREMENTAL;
      CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,parentId TEXT,data TEXT NOT NULL,revision INTEGER NOT NULL,updated TEXT NOT NULL,deleted TEXT);
      CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,resourceId TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL,mode TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS versions_resource ON versions(resourceId,created);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,created TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0);
      PRAGMA user_version=1;`);
    if (!(this.db.prepare("PRAGMA table_info(assets)").all() as any[]).some((c) => c.name === "claimed"))
      this.db.exec("ALTER TABLE assets ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0");
    if (!this.get("settings")) this.create("settings", "Preferências", null, { mode: "auto", delay: 2, theme: "dark" }, "settings");
  }
  parse(row: any): Resource | undefined {
    return row ? { ...row, data: JSON.parse(row.data) } : undefined;
  }
  get(id: string) {
    return this.parse(this.db.prepare("SELECT * FROM resources WHERE id=?").get(id));
  }
  list() {
    return this.db
      .prepare("SELECT * FROM resources ORDER BY updated DESC")
      .all()
      .map((r) => this.parse(r)!);
  }
  create(kind: Kind, name: string, parentId: string | null, data: any, id: string = crypto.randomUUID()) {
    this.db.prepare("INSERT INTO resources VALUES(?,?,?,?,?,1,?,NULL)").run(id, kind, name, parentId, JSON.stringify(data), new Date().toISOString());
    for (const aid of assetRefs(data)) this.db.prepare("UPDATE assets SET claimed=1 WHERE id=?").run(aid);
    return this.get(id)!;
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  update(id: string, patch: Pick<Resource, "name" | "parentId" | "data">, revision: number, mode = "auto") {
    return this.transaction(() => {
      const old = this.get(id);
      if (!old || old.deleted) throw Object.assign(new Error("Registro não encontrado."), { status: 404 });
      if (old.revision !== revision) throw Object.assign(new Error("Esta ficha foi alterada em outra aba. Seu rascunho foi preservado."), { status: 409 });
      const last = this.db.prepare("SELECT created FROM versions WHERE resourceId=? ORDER BY created DESC LIMIT 1").get(id) as any;
      if (old.kind !== "settings" && (mode === "manual" || !last || Date.now() - Date.parse(last.created) >= 300000)) this.snapshot(old, mode);
      this.db
        .prepare("UPDATE resources SET name=?,parentId=?,data=?,revision=revision+1,updated=? WHERE id=?")
        .run(patch.name, patch.parentId, JSON.stringify(patch.data), new Date().toISOString(), id);
      for (const aid of assetRefs(patch.data)) this.db.prepare("UPDATE assets SET claimed=1 WHERE id=?").run(aid);
      return this.get(id)!;
    });
  }
  snapshot(r: Resource, mode: string) {
    this.db.prepare("INSERT INTO versions VALUES(?,?,?,?,?)").run(crypto.randomUUID(), r.id, JSON.stringify(r), new Date().toISOString(), mode);
    this.db
      .prepare("DELETE FROM versions WHERE resourceId=? AND id NOT IN (SELECT id FROM versions WHERE resourceId=? ORDER BY created DESC,rowid DESC LIMIT 10)")
      .run(r.id, r.id);
  }
  descendants(id: string) {
    const all = this.list(),
      ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of all)
        if (r.parentId && ids.has(r.parentId) && !ids.has(r.id)) {
          ids.add(r.id);
          changed = true;
        }
    }
    return all.filter((r) => ids.has(r.id));
  }
  trash(id: string) {
    const stamp = new Date().toISOString();
    this.transaction(() => {
      for (const r of this.descendants(id)) if (!r.deleted) this.db.prepare("UPDATE resources SET deleted=?,revision=revision+1 WHERE id=?").run(stamp, r.id);
    });
  }
  restore(id: string) {
    const root = this.get(id);
    if (!root) return;
    this.transaction(() => {
      for (const r of this.descendants(id))
        if (r.deleted === root.deleted) this.db.prepare("UPDATE resources SET deleted=NULL,revision=revision+1 WHERE id=?").run(r.id);
      if (root.parentId && (!this.get(root.parentId) || this.get(root.parentId)?.deleted))
        this.db.prepare("UPDATE resources SET parentId=NULL WHERE id=?").run(id);
    });
  }
  purge(id: string) {
    this.transaction(() => {
      for (const r of this.descendants(id)) {
        this.db.prepare("DELETE FROM versions WHERE resourceId=?").run(r.id);
        this.db.prepare("DELETE FROM resources WHERE id=?").run(r.id);
      }
    });
    this.gc(true);
  }
  gc(immediate = false) {
    const refs = new Set(this.list().flatMap((r) => assetRefs(r.data)));
    for (const v of this.db.prepare("SELECT snapshot FROM versions").all() as any[]) for (const id of assetRefs(JSON.parse(v.snapshot).data)) refs.add(id);
    for (const a of this.db.prepare("SELECT * FROM assets").all() as any[])
      if (!refs.has(a.id) && (a.claimed || Date.now() - Date.parse(a.created) > 86400000)) {
        const file = path.join(this.files, a.id);
        if (existsSync(file)) unlinkSync(file);
        this.db.prepare("DELETE FROM assets WHERE id=?").run(a.id);
      }
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum;");
  }
  size() {
    return readdirSync(this.files).reduce((n, f) => n + statSync(path.join(this.files, f)).size, 0) + statSync(path.join(this.dir, "app.sqlite")).size;
  }
}
