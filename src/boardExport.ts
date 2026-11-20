import type { BoardData, BoardItem } from "../shared/types";

const colors: Record<string, string> = { yellow: "#e8dba3", cyan: "#abdce0", rose: "#e6bbc5", green: "#bdd4b4", purple: "#cdc0df" };

export function boardExportBounds(items: BoardItem[]) {
  if (!items.length) throw new Error("Adicione uma nota ou imagem antes de exportar.");
  const left = Math.min(...items.map(i => i.x)) - 32;
  const top = Math.min(...items.map(i => i.y)) - 32;
  const width = Math.max(...items.map(i => i.x + i.w)) + 32 - left;
  const height = Math.max(...items.map(i => i.y + i.h)) + 32 - top;
  // Bound both the longest edge and memory use, including very sparse boards.
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)));
  return { left, top, width, height, scale };
}

export function wrapBoardText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const token of paragraph.replace(/\t/g, "    ").match(/\s+|\S+/gu) || []) {
      if (line && measure(line + token) > width) {
        lines.push(line);
        line = "";
      }
      for (const char of token) {
        if (line && measure(line + char) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function loadImage(assetId?: string): Promise<HTMLImageElement> {
  if (!assetId) throw new Error("Uma imagem do quadro está indisponível.");
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      reject(new Error("Não foi possível carregar uma imagem do quadro. Tente novamente."));
    };
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = fail;
    image.src = `/api/assets/${encodeURIComponent(assetId)}`;
  });
}

export interface BoardExportTheme {
  background: string;
  imageBackground: string;
  imageLabel: string;
}

export async function exportBoardPng(data: BoardData, name: string, theme: BoardExportTheme) {
  const bounds = boardExportBounds(data.items);
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(bounds.width * bounds.scale));
  canvas.height = Math.max(1, Math.floor(bounds.height * bounds.scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível criar a imagem do quadro.");
  try {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(bounds.scale, bounds.scale);
    ctx.translate(-bounds.left, -bounds.top);
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    const items = new Map(data.items.map(item => [item.id, item]));
    for (const connection of data.connections) {
      const a = items.get(connection.from), b = items.get(connection.to);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x + a.w / 2, a.y + a.h / 2);
      ctx.lineTo(b.x + b.w / 2, b.y + b.h / 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const item of data.items) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(item.x, item.y, item.w, item.h, 5);
      ctx.fillStyle = item.type === "image" ? theme.imageBackground : colors[item.color] || colors.yellow;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = item.type === "image" ? theme.imageLabel : "#64748b";
      ctx.font = '8px "Noto Sans", sans-serif';
      ctx.textAlign = "right";
      ctx.fillText(item.type === "image" ? "IMAGEM" : "NOTA", item.x + item.w - 12, item.y + 21);
      ctx.textAlign = "left";
      if (item.type === "image") {
        const image = await loadImage(item.assetId);
        const scale = Math.min((item.w - 4) / image.naturalWidth, (item.h - 36) / image.naturalHeight);
        const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
        ctx.drawImage(image, item.x + (item.w - w) / 2, item.y + 34 + (item.h - 36 - h) / 2, w, h);
      } else {
        ctx.beginPath();
        ctx.rect(item.x + 17, item.y + 38, item.w - 34, item.h - 56);
        ctx.clip();
        ctx.fillStyle = "#253039";
        ctx.font = '14px "Noto Sans", sans-serif';
        ctx.textBaseline = "top";
        const lines = wrapBoardText(item.text, item.w - 34, text => ctx.measureText(text).width);
        lines.forEach((line, index) => ctx.fillText(line, item.x + 17, item.y + 40 + index * 23.1));
      }
      ctx.restore();
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Não foi possível gerar o PNG. Tente reduzir o tamanho do quadro.")), "image/png"));
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 120) || "quadro"}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
