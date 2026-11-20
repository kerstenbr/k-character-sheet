import { uuid } from "./id";
import { useLayoutEffect, useRef, useState } from "react";
import { StickyNote, ImagePlus, Link2, Hand, MousePointer2, Minus, Plus, Maximize, Trash2, Copy, GripHorizontal, Download } from "lucide-react";
import type { Resource, Settings, BoardData, BoardItem } from "../shared/types";
import { useDocument } from "./useDocument";
import { SaveBar } from "./components";
import { upload } from "./api";
import { fitBoardViewport } from "./boardViewport";
import { exportBoardPng } from "./boardExport";
export default function Board({ resource, settings, onSaved }: { resource: Resource; settings: Settings; onSaved: (r: Resource) => void }) {
  const editor = useDocument(resource, settings, onSaved),
    data = editor.doc.data as BoardData;
  const [tool, setTool] = useState<"select" | "pan" | "connect">("select"),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 50, y: 50 }),
    [selected, setSelected] = useState<string | null>(null),
    [from, setFrom] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false);
  const area = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const initialItems = useRef(data.items);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const target = event.target;
      // Keep ordinary scrolling inside note editors and floating controls.
      if (!event.ctrlKey && target instanceof Element && target.closest("textarea, .board-toolbar, .board-selection, .board-zoom")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.deltaY) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const nextZoom = Math.max(0.2, Math.min(2.5, zoom * Math.exp(-delta * 0.002)));
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left - element.clientLeft;
      const y = event.clientY - rect.top - element.clientTop;
      setPan({ x: x - (x - pan.x) * nextZoom / zoom, y: y - (y - pan.y) * nextZoom / zoom });
      setZoom(nextZoom);
    };
    // React's passive wheel listener cannot cancel the browser's Ctrl+wheel zoom.
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom, pan]);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const initialize = () => {
      if (!element.clientWidth || !element.clientHeight) return false;
      const view = fitBoardViewport(initialItems.current, element.clientWidth, element.clientHeight);
      setZoom(view.zoom);
      setPan(view.pan);
      return true;
    };
    // Fit once on opening, after layout; editing and panning must not reset the view.
    if (initialize()) return;
    const observer = new ResizeObserver(() => {
      if (initialize()) observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const update = (id: string, patch: Partial<BoardItem>) => editor.setData({ ...data, items: data.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const center = () => ({ x: ((area.current?.clientWidth || 800) / 2 - pan.x) / zoom - 120, y: ((area.current?.clientHeight || 500) / 2 - pan.y) / zoom - 90 });
  const addNote = () => {
    const item: BoardItem = { id: uuid(), type: "note", ...center(), w: 250, h: 200, text: "", color: "yellow" };
    editor.setData({ ...data, items: [...data.items, item] });
    setSelected(item.id);
    setTool("select");
  };
  const addImage = async (f: File) => {
    setBusy(true);
    setError("");
    try {
      const a = await upload(f);
      if (!a.mime.startsWith("image/")) throw new Error("Escolha uma imagem PNG, JPG ou WebP.");
      const item: BoardItem = { id: uuid(), type: "image", ...center(), w: 300, h: 240, text: f.name, color: "cyan", assetId: a.assetId };
      editor.setData({ ...data, items: [...data.items, item] });
      setSelected(item.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const connect = (id: string) => {
    if (!from) {
      setFrom(id);
      return;
    }
    if (from !== id && !data.connections.some((c) => (c.from === from && c.to === id) || (c.to === from && c.from === id)))
      editor.setData({ ...data, connections: [...data.connections, { id: uuid(), from, to: id }] });
    setFrom(null);
  };
  const drag = (e: React.PointerEvent, item: BoardItem, resize = false) => {
    if (e.button !== 0) return;
    if (tool === "connect") return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(item.id);
    const el = e.currentTarget as HTMLElement,
      box = el.closest(".board-item") as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    let patch: Partial<BoardItem> = {};
    const move = (ev: PointerEvent) => {
      if (!(ev.buttons & 1)) {
        end();
        return;
      }
      const dx = (ev.clientX - start.x) / zoom,
        dy = (ev.clientY - start.y) / zoom;
      patch = resize ? { w: Math.max(120, Math.min(4000, item.w + dx)), h: Math.max(100, Math.min(4000, item.h + dy)) } : { x: item.x + dx, y: item.y + dy };
      if (resize) {
        box.style.width = `${patch.w}px`;
        box.style.height = `${patch.h}px`;
      } else {
        box.style.left = `${patch.x}px`;
        box.style.top = `${patch.y}px`;
      }
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
      if (Object.keys(patch).length) update(item.id, patch);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  };
  const panStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget && tool !== "pan") return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY },
      before = { ...pan };
    if (tool !== "connect") setSelected(null);
    const move = (ev: PointerEvent) => {
      if (!(ev.buttons & 1)) {
        end();
        return;
      }
      setPan({ x: before.x + ev.clientX - start.x, y: before.y + ev.clientY - start.y });
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
  };
  const fit = () => {
    if (!area.current) return;
    const view = fitBoardViewport(data.items, area.current.clientWidth, area.current.clientHeight);
    setZoom(view.zoom);
    setPan(view.pan);
  };
  const remove = () => {
    editor.setData({
      ...data,
      items: data.items.filter((i) => i.id !== selected),
      connections: data.connections.filter((c) => c.id !== selected && c.from !== selected && c.to !== selected),
    });
    setSelected(null);
  };
  const item = data.items.find((i) => i.id === selected);
  const exportPng = async () => {
    if (!area.current) return;
    // Capture the current theme before the asynchronous export starts.
    const style = getComputedStyle(area.current);
    const theme = {
      background: style.backgroundColor,
      imageBackground: style.getPropertyValue("--panel").trim(),
      imageLabel: style.getPropertyValue("--muted").trim(),
    };
    setExporting(true);
    setError("");
    try {
      await exportBoardPng(data, editor.doc.name, theme);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível exportar o quadro.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="board-shell">
      <SaveBar editor={editor} />
      <div className="board-export">
        <button className="secondary" disabled={exporting || busy || !data.items.length} onClick={() => void exportPng()}>
          <Download size={16} /> {exporting ? "Exportando…" : "Exportar PNG"}
        </button>
        <span role="status">{exporting ? "Preparando imagem do quadro…" : "Exporta todos os itens. Textos respeitam o tamanho das notas."}</span>
      </div>
      {error && <div className="alert">{error}</div>}
      <div
        className={`board-area ${tool}`}
        ref={area}
        onMouseDownCapture={(e) => {
          // Cancel native middle-button autoscroll as well as pointer-based dragging.
          if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onPointerDownCapture={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onPointerDown={panStart}
        style={{ backgroundSize: `${24 * zoom}px ${24 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}>
        {!data.items.length && (
          <div className="board-empty">
            <StickyNote size={34} />
            <h2>Quadro vazio</h2>
            <p>Adicione notas ou imagens pela barra de ferramentas.</p>
          </div>
        )}
        <div
          className="board-world"
          style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, pointerEvents: tool === "pan" ? "none" : undefined }}>
          <svg className="connections">
            {data.connections.map((c) => {
              const a = data.items.find((i) => i.id === c.from),
                b = data.items.find((i) => i.id === c.to);
              if (!a || !b) return null;
              return (
                <g key={c.id} onClick={() => setSelected(c.id)}>
                  <line
                    x1={a.x + a.w / 2}
                    y1={a.y + a.h / 2}
                    x2={b.x + b.w / 2}
                    y2={b.y + b.h / 2}
                    stroke="transparent"
                    strokeWidth={18}
                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  />
                  <line
                    x1={a.x + a.w / 2}
                    y1={a.y + a.h / 2}
                    x2={b.x + b.w / 2}
                    y2={b.y + b.h / 2}
                    stroke={selected === c.id ? "#fff" : "#22d3ee"}
                    strokeWidth={2}
                    strokeDasharray="6 5"
                  />
                </g>
              );
            })}
          </svg>
          {data.items.map((i) => (
            <article
              key={i.id}
              className={`board-item ${i.color} ${selected === i.id || from === i.id ? "selected" : ""} ${i.type}`}
              style={{ left: i.x, top: i.y, width: i.w, height: i.h }}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(i.id);
                if (tool === "connect") connect(i.id);
              }}>
              <div className="note-grip" onPointerDown={(e) => drag(e, i)}>
                <GripHorizontal size={18} />
                <span>{i.type === "image" ? "IMAGEM" : "NOTA"}</span>
              </div>
              {i.type === "note" ? (
                <textarea
                  aria-label="Texto da nota"
                  placeholder="Escreva uma ideia…"
                  value={i.text}
                  onChange={(e) => update(i.id, { text: e.target.value })}
                  readOnly={tool === "connect"}
                />
              ) : (
                <img draggable={false} src={`/api/assets/${i.assetId}`} alt={i.text} onPointerDown={(e) => drag(e, i)} />
              )}
              <button className="resize-handle" aria-label="Redimensionar nota" onPointerDown={(e) => drag(e, i, true)} />
            </article>
          ))}
        </div>
        <div className="board-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <button
            className={tool === "select" ? "icon active" : "icon"}
            title="Selecionar"
            aria-label="Selecionar"
            onClick={() => {
              setTool("select");
              setFrom(null);
            }}>
            <MousePointer2 size={19} />
          </button>
          <button className={tool === "pan" ? "icon active" : "icon"} title="Mover quadro" aria-label="Mover quadro" onClick={() => setTool("pan")}>
            <Hand size={19} />
          </button>
          <span className="divider" />
          <button className="icon" title="Adicionar nota" aria-label="Adicionar nota" onClick={addNote}>
            <StickyNote size={19} />
          </button>
          <button className="icon" title="Adicionar imagem" aria-label="Adicionar imagem" disabled={busy} onClick={() => file.current?.click()}>
            <ImagePlus size={19} />
          </button>
          <button
            className={tool === "connect" ? "icon active" : "icon"}
            title="Conectar dois itens"
            aria-label="Conectar dois itens"
            onClick={() => {
              setTool("connect");
              setFrom(null);
            }}>
            <Link2 size={19} />
          </button>
        </div>
        {selected && (
          <div className="board-selection" onPointerDown={(e) => e.stopPropagation()}>
            {item?.type === "note" &&
              ["yellow", "cyan", "rose", "green", "purple"].map((color) => (
                <button
                  key={color}
                  className={`swatch ${color}`}
                  aria-label={`Cor ${color}`}
                  onClick={() => update(item.id, { color: color as BoardItem["color"] })}
                />
              ))}
            {item && (
              <button
                className="icon"
                title="Duplicar"
                aria-label="Duplicar item"
                onClick={() => editor.setData({ ...data, items: [...data.items, { ...item, id: uuid(), x: item.x + 30, y: item.y + 30 }] })}>
                <Copy size={17} />
              </button>
            )}
            <button className="icon danger" title="Excluir seleção" aria-label="Excluir seleção" onClick={remove}>
              <Trash2 size={17} />
            </button>
          </div>
        )}
        {tool === "connect" && (
          <div className="board-instruction">{from ? "Clique no segundo item para conectar." : "Clique em dois itens para criar uma conexão."}</div>
        )}
        <div className="board-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon" aria-label="Diminuir zoom do quadro" onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}>
            <Minus size={16} />
          </button>
          <span title="Use a roda do mouse para dar zoom no quadro">{Math.round(zoom * 100)}%</span>
          <button className="icon" aria-label="Aumentar zoom do quadro" onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}>
            <Plus size={16} />
          </button>
          <button className="icon" aria-label="Mostrar todas as notas" onClick={fit}>
            <Maximize size={16} />
          </button>
        </div>
        <div className="board-count">
          {data.items.length} itens · {data.connections.length} conexões
        </div>
      </div>
      <input
        ref={file}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImage(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
