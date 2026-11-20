import { test } from "node:test";
import assert from "node:assert/strict";
import { boardExportBounds, wrapBoardText } from "../src/boardExport.ts";
import type { BoardItem } from "../shared/types";

const note = (x: number, y: number, w = 250, h = 200): BoardItem => ({ id: String(x), type: "note", x, y, w, h, color: "yellow", text: "" });

test("PNG includes negative coordinates and distant items with padding", () => {
  const items = [note(-800, -300), note(1600, 900)];
  const bounds = boardExportBounds(items);
  for (const item of items) {
    assert.ok(item.x >= bounds.left + 32);
    assert.ok(item.y >= bounds.top + 32);
    assert.ok(item.x + item.w <= bounds.left + bounds.width - 32);
    assert.ok(item.y + item.h <= bounds.top + bounds.height - 32);
  }
  assert.equal(bounds.scale, 2);
});

test("PNG dimensions and memory stay bounded for large and sparse boards", () => {
  for (const items of [[note(-1e6, 0), note(1e6, 0)], [note(0, 0, 4000, 4000)]]) {
    const { width, height, scale } = boardExportBounds(items);
    assert.ok(width * scale <= 8192);
    assert.ok(height * scale <= 8192);
    assert.ok(width * height * scale ** 2 <= 16_000_001);
  }
  assert.throws(() => boardExportBounds([]), /Adicione/);
});

test("notes wrap words, long tokens, accents, emoji and explicit blank lines", () => {
  const measure = (text: string) => Array.from(text).length;
  assert.deepEqual(wrapBoardText("Olá mundo\n\nAção 🎲", 6, measure), ["Olá ", "mundo", "", "Ação 🎲"]);
  assert.deepEqual(wrapBoardText("abcdefghi", 4, measure), ["abcd", "efgh", "i"]);
  assert.deepEqual(wrapBoardText("a\r\nb", 4, measure), ["a", "b"]);
});
