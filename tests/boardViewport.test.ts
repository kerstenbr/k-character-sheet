import { test } from "node:test";
import assert from "node:assert/strict";
import { fitBoardViewport } from "../src/boardViewport.ts";

test("opening a narrow side panel fits notes created in a wide board", () => {
  const items = [
    { x: 900, y: 300, w: 250, h: 200 },
    { x: -500, y: -200, w: 300, h: 240 },
  ];
  for (const width of [280, 420, 1200]) {
    const { zoom, pan } = fitBoardViewport(items, width, 450);
    for (const item of items) {
      assert.ok(item.x * zoom + pan.x >= 20 - 1e-8);
      assert.ok((item.x + item.w) * zoom + pan.x <= width - 20 + 1e-8);
      assert.ok(item.y * zoom + pan.y >= 80 - 1e-8);
      assert.ok((item.y + item.h) * zoom + pan.y <= 390 + 1e-8);
    }
  }
});

test("empty boards keep their default origin and small notes are not enlarged", () => {
  assert.deepEqual(fitBoardViewport([], 280, 450), { zoom: 1, pan: { x: 50, y: 50 } });
  assert.equal(fitBoardViewport([{ x: 800, y: 500, w: 120, h: 100 }], 1200, 800).zoom, 1);
});
