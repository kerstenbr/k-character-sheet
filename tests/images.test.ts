import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFRawStream, degrees } from "pdf-lib";
import { inspectPdf, exportPdf } from "../server/pdf";
import { createApp } from "../server/app";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRuoAAAAASUVORK5CYII=", "base64");
async function fixture() {
  const doc = await PDFDocument.create(),
    form = doc.getForm();
  const image = form.createButton("IMAGEM");
  for (const rotation of [0, 90, 180, 270]) {
    const page = doc.addPage([600, 800]);
    page.setRotation(degrees(rotation));
    image.addToPage("", page, { x: 40, y: 400, width: 200, height: 100, borderWidth: 0 });
  }
  image.setImage(await doc.embedPng(png));
  form.createButton("Enviar").addToPage("Enviar", doc.getPage(0));
  const locked = form.createButton("Foto bloqueada");
  locked.addToPage("", doc.getPage(0));
  locked.enableReadOnly();
  return doc.save();
}

test("imagem: identificação seletiva, preservação, substituição e remoção em todas as rotações", async () => {
  const bytes = await fixture(),
    info = await inspectPdf(bytes);
  assert.equal(info.fields.length, 4);
  assert.ok(info.fields.every((f) => f.type === "image" && f.native === "IMAGEM"));
  assert.deepEqual(info.warnings, ["Campo preservado, sem edição: Enviar", "Campo preservado, sem edição: Foto bloqueada"]);
  const untouched = await PDFDocument.load(await exportPdf(bytes, info.fields));
  assert.equal(untouched.getForm().getFields().length, 0);
  assert.ok(untouched.getPage(0).node.Resources()?.lookup(PDFName.of("XObject")));
  let loaded = 0;
  const exported = await PDFDocument.load(
    await exportPdf(
      bytes,
      info.fields.map((f) => ({ ...f, assetId: "portrait" })),
      (id) => {
        assert.equal(id, "portrait");
        loaded++;
        return png;
      },
    ),
  );
  assert.equal(loaded, 1, "one image updates all widgets of the same field");
  assert.equal(exported.getPageCount(), 4);
  assert.equal(exported.getForm().getFields().length, 0);
  assert.ok(
    exported.context.enumerateIndirectObjects().some(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image"),
  );
  const cleared = await PDFDocument.load(
    await exportPdf(
      bytes,
      info.fields.map((f) => ({ ...f, imageCleared: true })),
    ),
  );
  // Only the two unrelated buttons remain as flattened appearances on page one.
  const xobjects: any = cleared.getPage(1).node.Resources()?.lookup(PDFName.of("XObject"));
  assert.equal(xobjects?.keys().length ?? 0, 0, "removed image has no page appearance");
});

test("imagem: ficha de referência reconhece IMAGEM", { skip: !existsSync("tmp/pdfs/example.pdf") }, async () => {
  const info = await inspectPdf(readFileSync("tmp/pdfs/example.pdf"));
  assert.ok(info.fields.some((f) => f.native === "IMAGEM" && f.type === "image"));
  assert.ok(!info.warnings.some((w) => w.endsWith(": IMAGEM")));
});

test("imagem: atualização de fichas antigas, persistência, duplicação, modelos, histórico e backup", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kcs-images-"));
  const { app, store, close } = createApp(dir),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function call(url: string, method = "GET", body?: any) {
    const response = await fetch(base + url, {
      method,
      headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  }
  async function upload(bytes: Uint8Array, name: string) {
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(bytes)]), name);
    return call("/upload", "POST", form);
  }
  try {
    const pdf = await upload(await fixture(), "ficha.pdf");
    let sheet = await call("/resources", "POST", {
      kind: "sheet",
      name: "Antiga",
      parentId: null,
      data: { ...pdf, fields: [], warnings: [...pdf.warnings, "Campo preservado, sem edição: IMAGEM"] },
    });
    let all = await call("/resources");
    sheet = all.find((r: any) => r.id === sheet.id);
    assert.equal(sheet.data.fields.length, 4);
    assert.equal(sheet.data.warnings.length, 2);
    const revision = sheet.revision;
    all = await call("/resources");
    assert.equal(all.find((r: any) => r.id === sheet.id).revision, revision);
    const image = await upload(png, "retrato.png");
    sheet = await call(`/resources/${sheet.id}`, "PUT", {
      ...sheet,
      saveMode: "manual",
      data: { ...sheet.data, fields: sheet.data.fields.map((f: any) => ({ ...f, assetId: image.assetId })) },
    });
    assert.equal(store.get(sheet.id)?.data.fields[0].assetId, image.assetId);
    const copy = await call(`/resources/${sheet.id}/duplicate`, "POST", {});
    assert.equal(copy.data.fields[0].assetId, image.assetId);
    const model = await call(`/resources/${sheet.id}/duplicate`, "POST", { asTemplate: true });
    assert.ok(model.data.fields.every((f: any) => !f.assetId && f.imageCleared));
    const character = await call(`/resources/${model.id}/duplicate`, "POST", {});
    assert.ok(character.data.fields.every((f: any) => !f.assetId && f.imageCleared));
    const response = await fetch(base + `/sheets/${sheet.id}/export`);
    assert.equal(response.status, 200);
    assert.equal((await PDFDocument.load(await response.arrayBuffer())).getForm().getFields().length, 0);
    const invalid = await fetch(base + `/resources/${sheet.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sheet, data: { ...sheet.data, fields: sheet.data.fields.map((f: any) => ({ ...f, assetId: pdf.assetId })) } }),
    });
    assert.equal(invalid.status, 400);
    const zip = await fetch(base + "/backup"),
      body = new FormData();
    body.append("file", new Blob([await zip.arrayBuffer()]), "backup.zip");
    await call("/backup/import", "POST", body);
    const imported = (await call("/resources")).find((r: any) => r.name === sheet.name && r.id !== sheet.id);
    assert.ok(imported.data.fields[0].assetId);
    assert.notEqual(imported.data.fields[0].assetId, image.assetId);
    assert.equal((await fetch(base + `/sheets/${imported.id}/export`)).status, 200);
    sheet = await call(`/resources/${sheet.id}`, "PUT", {
      ...sheet,
      saveMode: "manual",
      data: { ...sheet.data, fields: sheet.data.fields.map((f: any) => ({ ...f, assetId: undefined, imageCleared: true })) },
    });
    const versions = await call(`/resources/${sheet.id}/versions`),
      withImage = versions.find((v: any) => v.snapshot.data.fields.some((f: any) => f.assetId === image.assetId));
    assert.ok(withImage);
    sheet = await call(`/resources/${sheet.id}/versions/${withImage.id}/restore`, "POST", { revision: sheet.revision });
    assert.equal(sheet.data.fields[0].assetId, image.assetId);
    store.gc();
    assert.ok(existsSync(path.join(store.files, image.assetId)));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    close();
    rmSync(dir, { recursive: true, force: true });
  }
});
