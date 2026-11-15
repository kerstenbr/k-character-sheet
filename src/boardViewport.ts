import type { BoardItem } from "../shared/types";

export function fitBoardViewport(items: Pick<BoardItem, "x" | "y" | "w" | "h">[], width: number, height: number) {
  if (!items.length) return { zoom: 1, pan: { x: 50, y: 50 } };
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const contentWidth = Math.max(...items.map((item) => item.x + item.w)) - left;
  const contentHeight = Math.max(...items.map((item) => item.y + item.h)) - top;
  // Leave room for the toolbar above and the zoom controls below the content.
  const availableWidth = Math.max(1, width - 40);
  const availableHeight = Math.max(1, height - 140);
  const zoom = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
  return {
    zoom,
    pan: {
      x: (width - contentWidth * zoom) / 2 - left * zoom,
      y: 80 + (availableHeight - contentHeight * zoom) / 2 - top * zoom,
    },
  };
}
