import express from "express";
import multer from "multer";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { Store, assetRefs } from "./store";
import { inspectPdf, exportPdf } from "./pdf";
import type { Resource, Kind } from "../shared/types";

const id = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const finite = z.number().finite();
const field = z.object({
  id,
  page: z.number().int().min(0).max(199),
  x: finite,
  y: finite,
  w: finite.positive().max(10000),
  h: finite.positive().max(10000),
  type: z.enum(["text", "check", "image"]),
  assetId: id.optional(),
  imageCleared: z.boolean().optional(),
  value: z.union([z.string().max(50000), z.boolean()]),
  label: z.string().max(300),
  fontSize: finite.min(4).max(120),
  align: z.enum(["left", "center", "right"]),
  native: z.string().optional(),
  nativeType: z.string().optional(),
  options: z.array(z.string()).optional(),
  option: z.string().optional(),
});
const dataSchemas: Record<Kind, z.ZodTypeAny> = {
  folder: z.object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#22d3ee"),
    icon: z.string().max(8).default("◈"),
  }),
  sheet: z.object({
    assetId: id,
    fields: z.array(field).max(5000),
    pageCount: z.number().int().min(1).max(200),
    warnings: z.array(z.string()).default([]),
    mode: z.enum(["inherit", "auto", "manual"]).default("inherit"),
  }),
  template: z.object({
    assetId: id,
    fields: z.array(field).max(5000),
    pageCount: z.number().int().min(1).max(200),
    warnings: z.array(z.string()).default([]),
    mode: z.enum(["inherit", "auto", "manual"]).default("inherit"),
  }),
  board: z.object({
    items: z
      .array(
        z.object({
          id,
          type: z.enum(["note", "image"]),
          x: finite,
          y: finite,
          w: finite.min(80).max(4000),
          h: finite.min(60).max(4000),
          text: z.string().max(50000),
          color: z.enum(["yellow", "cyan", "rose", "green", "purple"]),
          assetId: id.optional(),
        }),
      )
      .max(2000),
    connections: z.array(z.object({ id, from: id, to: id })).max(5000),
  }),
  entry: z.object({ date: z.string().max(30), number: z.string().max(30), text: z.string().max(200000), sheetIds: z.array(id).max(500) }),
  settings: z.object({ mode: z.enum(["auto", "manual"]), delay: finite.min(1).max(60), theme: z.enum(["dark", "light", "system"]) }),
};
const resourceSchema = z.object({
  kind: z.enum(["folder", "sheet", "board", "entry", "template", "settings"]),
  name: z.string().trim().min(1).max(200),
  parentId: id.nullable(),
  data: z.unknown(),
});
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
export function createApp(dir: string) {
  const store = new Store(dir),
    app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1 } });
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use("/api", (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
      return next(fail("Origem não permitida.", 403));
    next();
  });
  app.use(express.json({ limit: "10mb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  // Upgrade previously imported image buttons without replacing user fields.
  let upgrading: Promise<void> | undefined;
  async function upgradeImages() {
    for (const r of store.list()) {
      if (r.deleted || !["sheet", "template"].includes(r.kind) || !r.data.warnings?.some((w: string) => w.startsWith("Campo preservado, sem edição: ")))
        continue;
      try {
        const info = await inspectPdf(readFileSync(path.join(store.files, r.data.assetId)));
        const images = info.fields.filter((f) => f.type === "image" && !r.data.fields.some((old: any) => old.native === f.native));
        if (!images.length) continue;
        if (r.kind === "template") images.forEach((f) => (f.imageCleared = true));
        const names = new Set(images.map((f) => "Campo preservado, sem edição: " + f.native));
        const latest = store.get(r.id)!;
        if (latest.revision !== r.revision) continue;
        store.update(
          r.id,
          { ...r, data: { ...r.data, fields: [...r.data.fields, ...images], warnings: r.data.warnings.filter((w: string) => !names.has(w)) } },
          r.revision,
        );
      } catch (e) {
        console.warn("Não foi possível atualizar campos de imagem:", r.id, (e as Error).message);
      }
    }
  }
  app.get("/api/resources", async (_req, res) => {
    upgrading ??= upgradeImages().finally(() => {
      upgrading = undefined;
    });
    await upgrading;
    res.json(store.list());
  });
  app.get("/api/storage", (_req, res) =>
    res.json({
      bytes: store.size(),
      trash: store.list().filter((r) => r.deleted).length,
      versions: store.db.prepare("SELECT count(*) AS n FROM versions").get(),
    }),
  );
  function validate(value: any, existingId?: string) {
    const r = resourceSchema.parse(value);
    const data: any = dataSchemas[r.kind].parse(r.data);
    if (r.parentId) {
      const parent = store.get(r.parentId);
      const allowed = r.kind === "board" ? ["folder", "sheet"] : ["folder"];
      if (!parent || parent.deleted || !allowed.includes(parent.kind)) throw fail("Pasta ou ficha de destino inválida.");
    }
    if (["folder", "template", "settings"].includes(r.kind) && r.parentId) throw fail("Este registro não pode ter uma pasta pai.");
    if (r.kind === "board" && !r.parentId) throw fail("O quadro precisa pertencer a uma ficha ou campanha.");
    if (["sheet", "template"].includes(r.kind))
      for (const f of data.fields) {
        if (f.type === "image" && (!f.native || f.nativeType !== "PDFButton")) throw fail("Campo de imagem deve pertencer ao formulário original.");
        if (f.assetId) {
          const a = store.db.prepare("SELECT mime FROM assets WHERE id=?").get(f.assetId) as any;
          if (f.type !== "image" || !a || !["image/png", "image/jpeg"].includes(a.mime)) throw fail("Escolha uma imagem PNG ou JPEG para a ficha.");
        }
      }
    for (const aid of assetRefs(data)) if (!store.db.prepare("SELECT id FROM assets WHERE id=?").get(aid)) throw fail("Arquivo associado não encontrado.");
    if (r.kind === "board") {
      if (store.list().some((x) => x.kind === "board" && x.parentId === r.parentId && !x.deleted && x.id !== existingId))
        throw fail("Este quadro já existe.", 409);
      const ids = new Set(data.items.map((i: any) => i.id));
      if (data.connections.some((c: any) => !ids.has(c.from) || !ids.has(c.to) || c.from === c.to)) throw fail("Conexão inválida no quadro.");
    }
    return { ...r, data };
  }
  app.post("/api/resources", (req, res) => {
    if (req.body.kind === "settings") throw fail("As configurações já existem.");
    const r = validate(req.body);
    res.status(201).json(store.create(r.kind, r.name, r.parentId, r.data));
  });
  app.put("/api/resources/:id", (req, res) => {
    const old = store.get(String(req.params.id));
    if (!old) throw fail("Registro não encontrado.", 404);
    const r = validate({ ...req.body, kind: old.kind }, old.id);
    const saved = store.update(old.id, r, z.number().int().parse(req.body.revision), req.body.saveMode === "manual" ? "manual" : "auto");
    store.gc();
    res.json(saved);
  });
  app.post("/api/resources/:id/trash", (req, res) => {
    const r = store.get(String(req.params.id));
    if (!r || r.kind === "settings") throw fail("Registro inválido.");
    store.trash(r.id);
    res.json({ ok: true });
  });
  app.post("/api/resources/:id/restore", (req, res) => {
    store.restore(String(req.params.id));
    res.json({ ok: true });
  });
  app.delete("/api/resources/:id", (req, res) => {
    const r = store.get(String(req.params.id));
    if (!r?.deleted) throw fail("Mova o registro para a lixeira antes de excluir.");
    store.purge(r.id);
    res.json({ ok: true });
  });
  app.get("/api/resources/:id/versions", (req, res) =>
    res.json(
      store.db
        .prepare("SELECT * FROM versions WHERE resourceId=? ORDER BY created DESC,rowid DESC")
        .all(String(req.params.id))
        .map((v: any) => ({ ...v, snapshot: JSON.parse(v.snapshot) })),
    ),
  );
  app.post("/api/resources/:id/versions/:version/restore", (req, res) => {
    const old = store.get(String(req.params.id)),
      v = store.db.prepare("SELECT * FROM versions WHERE id=? AND resourceId=?").get(String(req.params.version), String(req.params.id)) as any;
    if (!old || !v) throw fail("Versão não encontrada.", 404);
    const snapshot = JSON.parse(v.snapshot);
    const valid = validate({ ...snapshot, parentId: old.parentId }, old.id);
    res.json(store.update(old.id, valid, z.number().int().parse(req.body.revision), "manual"));
    store.gc();
  });
  app.post("/api/resources/:id/duplicate", (req, res) => {
    const r = store.get(String(req.params.id));
    if (!r || r.deleted || !["sheet", "template"].includes(r.kind)) throw fail("Ficha ou modelo não encontrado.");
    const asTemplate = req.body.asTemplate === true,
      kind = asTemplate ? "template" : "sheet";
    const data = structuredClone(r.data);
    if (asTemplate || r.kind === "template")
      data.fields = data.fields.map((f: any) => ({
        ...f,
        value: f.type === "check" ? false : "",
        ...(f.type === "image" ? { assetId: undefined, imageCleared: true } : {}),
      }));
    const candidate = validate({
      kind,
      name: req.body.name || `${r.name} — cópia`,
      parentId: asTemplate ? null : r.kind === "template" ? req.body.parentId || null : r.parentId,
      data,
    });
    const copy = store.create(candidate.kind, candidate.name, candidate.parentId, candidate.data);
    if (!asTemplate && r.kind === "sheet")
      for (const b of store.list().filter((b) => b.kind === "board" && b.parentId === r.id && !b.deleted)) store.create("board", b.name, copy.id, b.data);
    res.status(201).json(copy);
  });
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    const f = req.file;
    if (!f) throw fail("Selecione um arquivo.");
    const aid = crypto.randomUUID();
    let metadata: any = {};
    let mime = "";
    if (f.buffer.subarray(0, 5).toString() === "%PDF-") {
      metadata = await inspectPdf(f.buffer);
      mime = "application/pdf";
    } else if (f.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = "image/png";
    else if (f.buffer[0] === 255 && f.buffer[1] === 216 && f.buffer[2] === 255) mime = "image/jpeg";
    else if (f.buffer.subarray(0, 4).toString() === "RIFF" && f.buffer.subarray(8, 12).toString() === "WEBP") mime = "image/webp";
    else throw fail("Envie PDF, PNG, JPG ou WebP válido.");
    writeFileSync(path.join(store.files, aid), f.buffer);
    store.db.prepare("INSERT INTO assets(id,name,mime,created) VALUES(?,?,?,?)").run(aid, f.originalname, mime, new Date().toISOString());
    res.json({ assetId: aid, mime, ...metadata });
  });
  app.get("/api/assets/:id", (req, res) => {
    const a = store.db.prepare("SELECT * FROM assets WHERE id=?").get(String(req.params.id)) as any;
    if (!a) throw fail("Arquivo não encontrado.", 404);
    res.type(a.mime).set("Cache-Control", "private, max-age=86400").sendFile(path.resolve(store.files, a.id));
  });
  app.get("/api/sheets/:id/export", async (req, res) => {
    const r = store.get(String(req.params.id));
    if (!r || r.deleted || !["sheet", "template"].includes(r.kind)) throw fail("Ficha não encontrada.", 404);
    const bytes = await exportPdf(readFileSync(path.join(store.files, r.data.assetId)), r.data.fields, (aid) => {
      const a = store.db.prepare("SELECT mime FROM assets WHERE id=?").get(aid) as any;
      if (!a || !["image/png", "image/jpeg"].includes(a.mime)) throw fail("Imagem associada inválida.");
      return readFileSync(path.join(store.files, id.parse(aid)));
    });
    res
      .type("pdf")
      .attachment(`${r.name.replace(/[^\p{L}\p{N} _-]/gu, "")}.pdf`)
      .send(Buffer.from(bytes));
  });
  app.get("/api/backup", (_req, res) =>
    sendBackup(
      store.list().filter((r) => r.kind !== "settings"),
      res,
    ),
  );
  app.get("/api/folders/:id/backup", (req, res) => {
    const r = store.get(String(req.params.id));
    if (r?.kind !== "folder") throw fail("Campanha não encontrada.", 404);
    sendBackup(store.descendants(r.id), res);
  });
  function sendBackup(resources: Resource[], res: express.Response) {
    const ids = new Set(resources.map((r) => r.id));
    const versions = store.db
      .prepare("SELECT * FROM versions")
      .all()
      .filter((v: any) => ids.has(v.resourceId)) as any[];
    const refs = new Set([...resources.flatMap((r) => assetRefs(r.data)), ...versions.flatMap((v) => assetRefs(JSON.parse(v.snapshot).data))]);
    const assets = store.db
      .prepare("SELECT * FROM assets")
      .all()
      .filter((a: any) => refs.has(a.id)) as any[];
    const files: Record<string, Uint8Array> = {
      "manifest.json": strToU8(JSON.stringify({ format: "k-character-sheet", version: 1, resources, versions, assets })),
    };
    for (const a of assets) files[`assets/${a.id}`] = readFileSync(path.join(store.files, a.id));
    res
      .type("application/zip")
      .attachment("k-character-sheet-backup.zip")
      .send(Buffer.from(zipSync(files, { level: 1 })));
  }
  app.post("/api/backup/import", multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 1 } }).single("file"), (req, res) => {
    if (!req.file) throw fail("Selecione um backup ZIP.");
    let total = 0;
    const files = unzipSync(req.file.buffer, {
      filter: (f) => {
        total += f.originalSize;
        if (total > 500 * 1024 * 1024) throw fail("Backup descompactado excede 500 MB.");
        if (!/^(manifest\.json|assets\/[a-zA-Z0-9-]{1,80})$/.test(f.name)) throw fail("Caminho inválido no backup.");
        return true;
      },
    });
    if (!files["manifest.json"]) throw fail("Manifesto ausente.");
    const m = JSON.parse(strFromU8(files["manifest.json"]));
    if (
      m.format !== "k-character-sheet" ||
      m.version !== 1 ||
      !Array.isArray(m.resources) ||
      m.resources.length > 10000 ||
      !Array.isArray(m.assets) ||
      !Array.isArray(m.versions)
    )
      throw fail("Formato de backup não suportado.");
    const mapping = new Map<string, string>();
    for (const r of m.resources) {
      id.parse(r.id);
      if (mapping.has(r.id) || r.kind === "settings") throw fail("Registro inválido no backup.");
      resourceSchema.parse(r);
      dataSchemas[r.kind as Kind].parse(r.data);
      mapping.set(r.id, crypto.randomUUID());
    }
    const assetMap = new Map<string, string>();
    for (const a of m.assets) {
      id.parse(a.id);
      if (!files[`assets/${a.id}`] || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(a.mime))
        throw fail("Arquivo ausente ou inválido no backup.");
      assetMap.set(a.id, crypto.randomUUID());
    }
    function remap(data: any): any {
      if (Array.isArray(data)) return data.map(remap);
      if (data && typeof data === "object")
        return Object.fromEntries(
          Object.entries(data).map(([k, v]) => [
            k,
            k === "assetId" ? assetMap.get(String(v)) : k === "sheetIds" && Array.isArray(v) ? v.map((x) => mapping.get(x)).filter(Boolean) : remap(v),
          ]),
        );
      return data;
    }
    for (const r of m.resources) {
      if (r.parentId && !mapping.has(r.parentId)) throw fail("Referência de pasta ausente.");
      for (const aid of assetRefs(r.data)) if (!assetMap.has(aid)) throw fail("Arquivo referenciado ausente.");
    }
    for (const v of m.versions) {
      if (!mapping.has(v.resourceId)) throw fail("Histórico inválido.");
      const snap = JSON.parse(v.snapshot);
      dataSchemas[snap.kind as Kind].parse(snap.data);
      for (const aid of assetRefs(snap.data)) if (!assetMap.has(aid)) throw fail("Arquivo de versão ausente.");
    }
    store.transaction(() => {
      for (const a of m.assets) {
        const newId = assetMap.get(a.id)!;
        writeFileSync(path.join(store.files, newId), files[`assets/${a.id}`]);
        store.db.prepare("INSERT INTO assets(id,name,mime,created) VALUES(?,?,?,?)").run(newId, String(a.name).slice(0, 200), a.mime, new Date().toISOString());
      }
      for (const r of m.resources) {
        const nr = store.create(
          r.kind,
          r.kind === "folder" ? `${r.name} (restaurado)` : r.name,
          r.parentId ? mapping.get(r.parentId)! : null,
          remap(r.data),
          mapping.get(r.id),
        );
        if (r.deleted) store.db.prepare("UPDATE resources SET deleted=? WHERE id=?").run(String(r.deleted), nr.id);
      }
      for (const v of m.versions) {
        const snap = JSON.parse(v.snapshot);
        snap.id = mapping.get(v.resourceId);
        snap.parentId = mapping.get(snap.parentId) || null;
        snap.data = remap(snap.data);
        store.db.prepare("INSERT INTO versions VALUES(?,?,?,?,?)").run(crypto.randomUUID(), snap.id, JSON.stringify(snap), String(v.created), String(v.mode));
      }
      for (const newId of mapping.values())
        store.db
          .prepare(
            "DELETE FROM versions WHERE resourceId=? AND id NOT IN (SELECT id FROM versions WHERE resourceId=? ORDER BY created DESC,rowid DESC LIMIT 10)",
          )
          .run(newId, newId);
    });
    res.json({ count: m.resources.length });
  });
  app.use("/api", (_req, _res, next) => next(fail("Rota não encontrada.", 404)));
  if (existsSync("dist/index.html")) {
    app.use(express.static("dist"));
    app.get("/{*path}", (_req, res) => res.sendFile(path.resolve("dist/index.html")));
  }
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err.message);
    res
      .status(err.status || (err instanceof z.ZodError || err instanceof multer.MulterError ? 400 : 500))
      .json({
        error:
          err instanceof z.ZodError
            ? "Dados inválidos. Confira os campos e tente novamente."
            : err.code === "LIMIT_FILE_SIZE"
              ? "Backup excede o limite permitido de 200 MB."
              : err.message || "Erro inesperado.",
      });
  });
  const timer = setInterval(() => store.gc(), 3600000);
  timer.unref();
  return {
    app,
    store,
    close: () => {
      clearInterval(timer);
      store.db.close();
    },
  };
}
