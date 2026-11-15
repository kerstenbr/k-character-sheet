import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, degrees, PDFName } from "pdf-lib";
import { createApp } from "../server/app";
import { inspectPdf, exportPdf, toPdf, toView } from "../server/pdf";
import { unzipSync, strFromU8 } from "fflate";

test("biblioteca: revisões, 10 versões, modelos, lixeira, backup e limpeza de arquivos", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kcs-test-"));
  const { app, store, close } = createApp(dir);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as any;
  const base = `http://127.0.0.1:${address.port}/api`;
  async function call(url: string, method = "GET", body?: any) {
    const r = await fetch(base + url, {
      method,
      headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json();
    assert.ok(r.ok, `${method} ${url}: ${JSON.stringify(json)}`);
    return json;
  }
  try {
    const folder = await call("/resources", "POST", { kind: "folder", name: "RPG de sábado", parentId: null, data: { color: "#22d3ee", icon: "◈" } });
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const form = pdf.getForm();
    const field = form.createTextField("Nome");
    field.addToPage(page, { x: 40, y: 700, width: 200, height: 25 });
    field.setText("Ana");
    const checkbox = form.createCheckBox("Treinado");
    checkbox.addToPage(page, { x: 40, y: 650, width: 20, height: 20 });
    const upload = new FormData();
    upload.append("file", new Blob([Uint8Array.from(await pdf.save())]), "ficha.pdf");
    const asset = await call("/upload", "POST", upload);
    assert.equal(asset.fields.length, 2);
    let sheet = await call("/resources", "POST", { kind: "sheet", name: "Personagem", parentId: folder.id, data: { ...asset, mode: "inherit" } });
    const stale = sheet;
    for (let i = 0; i < 14; i++) sheet = await call(`/resources/${sheet.id}`, "PUT", { ...sheet, name: `Personagem ${i}`, saveMode: "manual" });
    const conflict = await fetch(base + `/resources/${sheet.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stale),
    });
    assert.equal(conflict.status, 409);
    let versions = await call(`/resources/${sheet.id}/versions`);
    assert.equal(versions.length, 10);
    const restored = await call(`/resources/${sheet.id}/versions/${versions[9].id}/restore`, "POST", { revision: sheet.revision });
    assert.equal(restored.name, versions[9].snapshot.name);
    assert.equal((await call(`/resources/${sheet.id}/versions`)).length, 10);
    const template = await call(`/resources/${sheet.id}/duplicate`, "POST", { asTemplate: true, name: "Modelo" });
    assert.equal(template.data.fields[0].value, "");
    const image = new FormData();
    image.append(
      "file",
      new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRuoAAAAASUVORK5CYII=", "base64")]),
      "mapa.png",
    );
    const img = await call("/upload", "POST", image);
    const items = [
      { id: "note-1", type: "note", x: 0, y: 0, w: 200, h: 150, text: "Encontrar a torre", color: "yellow" },
      { id: "image-1", type: "image", x: 300, y: 0, w: 200, h: 150, text: "Mapa", color: "cyan", assetId: img.assetId },
    ];
    const board = await call("/resources", "POST", {
      kind: "board",
      name: "Quadro",
      parentId: sheet.id,
      data: { items, connections: [{ id: "link-1", from: "note-1", to: "image-1" }] },
    });
    await call("/resources", "POST", {
      kind: "entry",
      name: "Sessão 1",
      parentId: folder.id,
      data: { date: "2026-11-14", number: "1", text: "Uma pista", sheetIds: [sheet.id] },
    });
    const zip = await fetch(base + `/folders/${folder.id}/backup`);
    const buffer = new Uint8Array(await zip.arrayBuffer());
    const entries = unzipSync(buffer),
      manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    assert.equal(manifest.assets.length, 2);
    assert.equal(manifest.resources.length, 4);
    const restoreForm = new FormData();
    restoreForm.append("file", new Blob([buffer]), "backup.zip");
    await call("/backup/import", "POST", restoreForm);
    const all = await call("/resources");
    const imported = all.find((r: any) => r.kind === "folder" && r.id !== folder.id);
    assert.ok(imported);
    const importedSheet = all.find((r: any) => r.parentId === imported.id && r.kind === "sheet");
    assert.notEqual(importedSheet.data.assetId, asset.assetId);
    const importedEntry = all.find((r: any) => r.parentId === imported.id && r.kind === "entry");
    assert.deepEqual(importedEntry.data.sheetIds, [importedSheet.id]);
    await call(`/resources/${folder.id}/trash`, "POST");
    assert.ok(store.get(board.id)?.deleted);
    await call(`/resources/${folder.id}/restore`, "POST");
    assert.equal(store.get(board.id)?.deleted, null);
    await call(`/resources/${folder.id}/trash`, "POST");
    await call(`/resources/${folder.id}`, "DELETE");
    assert.equal(store.get(sheet.id), undefined);
    assert.equal((await call(`/resources/${sheet.id}/versions`)).length, 0);
    assert.equal(existsSync(path.join(store.files, img.assetId)), false);
    assert.equal(existsSync(path.join(store.files, asset.assetId)), true, "template still references original PDF");
    await call(`/resources/${template.id}/trash`, "POST");
    await call(`/resources/${template.id}`, "DELETE");
    assert.equal(existsSync(path.join(store.files, asset.assetId)), false, "unreferenced PDF removed from disk");
    const exported = await fetch(base + `/sheets/${importedSheet.id}/export`);
    assert.equal(exported.status, 200);
    const flat = await PDFDocument.load(await exported.arrayBuffer());
    assert.equal(flat.getForm().getFields().length, 0);
    const bad = await fetch(base + "/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "sheet", name: "Inválido", parentId: null, data: { assetId: "../escape" } }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("transformação de coordenadas para todas as rotações e exportação de sobreposição", async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const p = toView(120, 230, 600, 800, rotation);
    assert.deepEqual(toPdf(p[0], p[1], 600, 800, rotation), [120, 230]);
  }
  const doc = await PDFDocument.create();
  for (const r of [0, 90, 180, 270]) doc.addPage([600, 800]).setRotation(degrees(r));
  const fields = [0, 1, 2, 3].map((page) => ({
    id: `text-${page}`,
    page,
    x: 30,
    y: 40,
    w: 230,
    h: 60,
    type: "text" as const,
    value: "Anotações: ação e coração",
    label: "Texto",
    fontSize: 14,
    align: "left" as const,
  }));
  const bytes = await exportPdf(await doc.save(), fields);
  const reopened = await PDFDocument.load(bytes);
  assert.equal(reopened.getPageCount(), 4);
  assert.equal(reopened.getForm().getFields().length, 0);
  mkdirSync("tmp/pdfs", { recursive: true });
  writeFileSync("tmp/pdfs/rotation-test.pdf", bytes);
});

test("ficha Cyberpunk fornecida: leitura e exportação estática de três páginas", { skip: !existsSync("tmp/pdfs/example.pdf") }, async () => {
  const bytes = readFileSync("tmp/pdfs/example.pdf");
  const info = await inspectPdf(bytes);
  assert.equal(info.pageCount, 3);
  assert.ok(info.fields.length > 0);
  console.log(`Ficha de referência: ${info.fields.length} campos editáveis; ${info.warnings.length} avisos.`);
  const output = await exportPdf(bytes, info.fields);
  const doc = await PDFDocument.load(output);
  assert.equal(doc.getPageCount(), 3);
  assert.equal(doc.getForm().getFields().length, 0);
  for (const p of doc.getPages())
    for (const ref of p.node.Annots()?.asArray() || []) {
      const a: any = doc.context.lookup(ref);
      assert.notEqual(a.get(PDFName.of("Subtype"))?.toString(), "/Widget");
    }
  writeFileSync("tmp/pdfs/example-export.pdf", output);
});
