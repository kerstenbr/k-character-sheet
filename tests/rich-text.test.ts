import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { inspectPdf, exportPdf } from "../server/pdf";

test("campos rich text vazios e com valor simples podem ser importados e exportados", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  for (const [name, value, y] of [["Cultural Origins", "", 700], ["Nome", "Ana", 650]] as const) {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 40, y, width: 200, height: 25 });
    field.setText(value);
    form.updateFieldAppearances();
    field.enableRichFormatting();
  }
  const bytes = await doc.save({ updateFieldAppearances: false });
  const info = await inspectPdf(bytes);
  assert.deepEqual(info.fields.map((f) => [f.label, f.value]), [["Cultural Origins", ""], ["Nome", "Ana"]]);
  assert.deepEqual(info.warnings, []);
  for (const edited of [false, true]) {
    const fields = info.fields.map((f) => ({ ...f, value: edited ? "Nova origem" : f.value }));
    const output = await PDFDocument.load(await exportPdf(bytes, fields));
    assert.equal(output.getPageCount(), 1);
    assert.equal(output.getForm().getFields().length, 0);
  }
  const original = await PDFDocument.load(bytes);
  assert.equal(original.getForm().getTextField("Cultural Origins").isRichFormatted(), true);
});

test("conteúdo exclusivamente formatado é preservado sem impedir a importação", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const field = doc.getForm().createTextField("História");
  field.addToPage(page, { x: 40, y: 700, width: 200, height: 25 });
  field.setText("Conteúdo original");
  doc.getForm().updateFieldAppearances();
  field.acroField.removeValue();
  field.acroField.dict.set(PDFName.of("RV"), PDFString.of("<body><p>Conteúdo original</p></body>"));
  field.enableRichFormatting();
  const bytes = await doc.save({ updateFieldAppearances: false });
  const info = await inspectPdf(bytes);
  assert.equal(info.fields.length, 0);
  assert.match(info.warnings[0], /Campo preservado, sem edição.*História/);
  const output = await PDFDocument.load(await exportPdf(bytes, info.fields));
  assert.equal(output.getForm().getFields().length, 0);
  assert.ok(output.getPage(0).node.Contents());
});
