import {
  PDFDocument,
  PDFButton,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFName,
  PDFDict,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import type { Field } from "../shared/types";

export function toView(x: number, y: number, w: number, h: number, r: number): [number, number] {
  if (r === 90) return [y, x];
  if (r === 180) return [w - x, y];
  if (r === 270) return [h - y, w - x];
  return [x, h - y];
}
export function toPdf(x: number, y: number, w: number, h: number, r: number): [number, number] {
  if (r === 90) return [y, x];
  if (r === 180) return [w - x, y];
  if (r === 270) return [w - y, h - x];
  return [x, h - y];
}
export async function inspectPdf(bytes: Uint8Array) {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch {
    throw new Error("PDF inválido ou protegido por senha. Envie uma cópia desbloqueada.");
  }
  const pages = doc.getPages();
  if (!pages.length || pages.length > 200) throw new Error("O PDF deve ter entre 1 e 200 páginas.");
  const form = doc.getForm();
  if (form.hasXFA()) throw new Error("Formulários XFA não são suportados. Exporte uma cópia comum do PDF.");
  const fields: Field[] = [];
  const warnings: string[] = [];
  for (const f of form.getFields()) {
    const imageButton =
      f instanceof PDFButton &&
      (/imagem|image|foto|photo|portrait|retrato|avatar/i.test(f.getName()) ||
        f.acroField.getWidgets().some((w) => w.getAppearanceCharacteristics()?.dict.has(PDFName.of("I"))));
    const supported =
      imageButton ||
      f instanceof PDFTextField ||
      f instanceof PDFCheckBox ||
      f instanceof PDFDropdown ||
      f instanceof PDFOptionList ||
      f instanceof PDFRadioGroup;
    if (!supported || f.isReadOnly()) {
      warnings.push(`Campo preservado, sem edição: ${f.getName()}`);
      continue;
    }
    const widgets = f.acroField.getWidgets();
    widgets.forEach((widget, wi) => {
      const pi = pages.findIndex(
        (p) =>
          widget.P()?.toString() === p.ref.toString() ||
          p.node
            .Annots()
            ?.asArray()
            .some((ref) => doc.context.lookup(ref) === widget.dict),
      );
      if (pi < 0) {
        warnings.push(`Campo sem página identificável: ${f.getName()}`);
        return;
      }
      const p = pages[pi],
        rect = widget.getRectangle(),
        crop = p.getCropBox(),
        rot = ((p.getRotation().angle % 360) + 360) % 360;
      const a = toView(rect.x - crop.x, rect.y - crop.y, crop.width, crop.height, rot),
        b = toView(rect.x + rect.width - crop.x, rect.y + rect.height - crop.y, crop.width, crop.height, rot);
      const option = f instanceof PDFRadioGroup ? f.getOptions()[wi] : undefined;
      const value =
        f instanceof PDFTextField
          ? f.getText() || ""
          : f instanceof PDFCheckBox
            ? f.isChecked()
            : f instanceof PDFRadioGroup
              ? f.getSelected() === option
              : f instanceof PDFDropdown || f instanceof PDFOptionList
                ? f.getSelected().join(", ")
                : "";
      const appearance = widget.dict.get(PDFName.of("DA"))?.toString() || f.acroField.getDefaultAppearance() || "";
      let explicitSize = Number(appearance.match(/([\d.]+)\s+Tf/)?.[1]);
      if (!explicitSize) {
        try {
          const ap = widget.dict.lookup(PDFName.of("AP"));
          const normal = ap instanceof PDFDict ? ap.lookup(PDFName.of("N")) : undefined;
          if (normal instanceof PDFRawStream)
            explicitSize = Number(
              Buffer.from(decodePDFRawStream(normal).decode())
                .toString()
                .match(/([\d.]+)\s+Tf/)?.[1],
            );
        } catch {
          /* Fall back when an original appearance stream is damaged. */
        }
      }
      const fieldHeight = Math.abs(a[1] - b[1]);
      const fontSize = explicitSize > 0 ? explicitSize : Math.min(18, Math.max(6, fieldHeight * 0.65));
      fields.push({
        id: crypto.randomUUID(),
        page: pi,
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        w: Math.abs(a[0] - b[0]),
        h: fieldHeight,
        type: imageButton ? "image" : f instanceof PDFCheckBox || f instanceof PDFRadioGroup ? "check" : "text",
        value,
        label: f.getName(),
        fontSize: Math.min(120, Math.max(4, fontSize)),
        align: f instanceof PDFTextField ? (["left", "center", "right"] as const)[f.getAlignment()] : "left",
        native: f.getName(),
        nativeType: f.constructor.name,
        option,
        options: f instanceof PDFDropdown || f instanceof PDFOptionList ? f.getOptions() : undefined,
      });
    });
  }
  return { fields, pageCount: pages.length, warnings };
}

export async function exportPdf(bytes: Uint8Array, fields: Field[], loadImage?: (assetId: string) => Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync("node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"), { subset: true });
  const form = doc.getForm();
  for (const f of form.getFields()) {
    const values = fields.filter((v) => v.native === f.getName());
    if (!values.length) continue;
    const v = values[0];
    if (f instanceof PDFButton && v.type === "image") {
      if (v.assetId) {
        if (!loadImage) throw new Error("Imagem associada não disponível.");
        const imageBytes = loadImage(v.assetId);
        const image = imageBytes[0] === 137 ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
        f.setImage(image);
      } else if (v.imageCleared) form.removeField(f);
      continue;
    }
    let changed = false;
    if (f instanceof PDFTextField && (f.getText() || "") !== String(v.value)) {
      f.setText(String(v.value));
      changed = true;
    } else if (f instanceof PDFCheckBox && f.isChecked() !== !!v.value) {
      v.value ? f.check() : f.uncheck();
      changed = true;
    } else if (f instanceof PDFRadioGroup) {
      const selected = values.find((v) => v.value);
      if (f.getSelected() !== selected?.option) {
        if (selected?.option) f.select(selected.option);
        else f.clear();
        changed = true;
      }
    } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
      if (f.getSelected().join(", ") !== String(v.value)) {
        if (v.value) f.select(String(v.value));
        else f.clear();
        changed = true;
      }
    }
    if (changed) {
      for (const widget of f.acroField.getWidgets())
        if (!widget.dict.has(PDFName.of("BS")) && !widget.dict.has(PDFName.of("Border"))) widget.getOrCreateBorderStyle().setWidth(0);
      if (f instanceof PDFTextField || f instanceof PDFDropdown || f instanceof PDFOptionList) f.updateAppearances(font);
      else if (f instanceof PDFCheckBox || f instanceof PDFRadioGroup) f.updateAppearances();
    }
  }
  form.flatten({ updateFieldAppearances: false });
  // Some source PDFs contain dangling widget references. Flattened exports must
  // have neither interactive widgets nor invalid annotation references.
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (annots)
      for (let i = annots.size() - 1; i >= 0; i--) {
        const annot = doc.context.lookup(annots.get(i));
        if (!(annot instanceof PDFDict) || annot.get(PDFName.of("Subtype"))?.toString() === "/Widget") annots.remove(i);
      }
  }
  doc.catalog.delete(PDFName.of("AcroForm"));
  doc.catalog.delete(PDFName.of("OpenAction"));
  doc.catalog.delete(PDFName.of("AA"));
  const names = doc.catalog.lookup(PDFName.of("Names"));
  if (names instanceof PDFDict) names.delete(PDFName.of("JavaScript"));
  for (const f of fields.filter((f) => !f.native)) {
    const page = doc.getPages()[f.page];
    if (!page) continue;
    const box = page.getCropBox(),
      rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const point = (x: number, y: number) => {
      const p = toPdf(x, y, box.width, box.height, rotation);
      return { x: p[0] + box.x, y: p[1] + box.y };
    };
    if (f.type === "check") {
      if (f.value) {
        const inset = Math.min(f.w, f.h) * 0.18;
        page.drawLine({ start: point(f.x + inset, f.y + inset), end: point(f.x + f.w - inset, f.y + f.h - inset), thickness: 1.4 });
        page.drawLine({ start: point(f.x + f.w - inset, f.y + inset), end: point(f.x + inset, f.y + f.h - inset), thickness: 1.4 });
      }
    } else {
      const size = f.fontSize || 10,
        maxWidth = Math.max(1, f.w - 4),
        lines: string[] = [];
      for (const paragraph of String(f.value).split("\n")) {
        let line = "";
        for (const char of paragraph) {
          if (line && font.widthOfTextAtSize(line + char, size) > maxWidth) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
        lines.push(line);
      }
      lines.slice(0, Math.max(1, Math.floor(f.h / (size * 1.2)))).forEach((line, i) => {
        const width = font.widthOfTextAtSize(line, size),
          offset = f.align === "center" ? (f.w - width) / 2 : f.align === "right" ? f.w - width - 2 : 2;
        page.drawText(line, { ...point(f.x + offset, f.y + size + i * size * 1.2), font, size, rotate: degrees(rotation), color: rgb(0.07, 0.08, 0.1) });
      });
    }
  }
  return doc.save();
}
