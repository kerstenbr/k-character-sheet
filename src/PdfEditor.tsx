import { uuid } from "./id";
import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize,
  Type,
  SquareCheck,
  MousePointer2,
  Download,
  Trash2,
  BookOpen,
  PanelRight,
  SlidersHorizontal,
} from "lucide-react";
import type { Field, Resource, Settings } from "../shared/types";
import { useDocument } from "./useDocument";
import { SaveBar } from "./components";
import { download, upload } from "./api";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export function usePdf(assetId: string) {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setPdf(null);
    setError("");
    const task = pdfjs.getDocument({
      url: `/api/assets/${assetId}`,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
    });
    let alive = true;
    task.promise
      .then((p) => {
        if (alive) setPdf(p);
      })
      .catch((e) => {
        if (alive) setError(`Não foi possível exibir o PDF: ${e.message}`);
      });
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [assetId]);
  return { pdf, error };
}
export function Thumbnail({ assetId }: { assetId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { pdf } = usePdf(assetId);
  useEffect(() => {
    let render: pdfjs.RenderTask | undefined,
      stopped = false;
    if (pdf)
      void pdf
        .getPage(1)
        .then((page) => {
          if (stopped || !canvas.current) return;
          const viewport = page.getViewport({ scale: 1 }),
            scale = 400 / viewport.width,
            vp = page.getViewport({ scale });
          canvas.current.width = vp.width;
          canvas.current.height = vp.height;
          render = page.render({ canvas: canvas.current, viewport: vp });
          return render.promise;
        })
        .catch(() => {});
    return () => {
      stopped = true;
      render?.cancel();
    };
  }, [pdf]);
  return <canvas className="thumbnail-canvas" ref={canvas} />;
}
type PageSize = { w: number; h: number };
function ImageField({ field, pdf, scale, onChange }: { field: Field; pdf: pdfjs.PDFDocumentProxy; scale: number; onChange: (patch: Partial<Field>) => void }) {
  const input = useRef<HTMLInputElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    change = useRef(onChange);
  change.current = onChange;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (field.assetId || field.imageCleared) return;
    let active = true,
      render: pdfjs.RenderTask | undefined;
    void pdf
      .getPage(field.page + 1)
      .then((page) => {
        if (!active || !canvas.current) return;
        const zoom = scale * devicePixelRatio;
        canvas.current.width = Math.ceil(field.w * zoom);
        canvas.current.height = Math.ceil(field.h * zoom);
        render = page.render({
          canvas: canvas.current,
          viewport: page.getViewport({ scale: zoom }),
          transform: [1, 0, 0, 1, -field.x * zoom, -field.y * zoom],
          annotationMode: pdfjs.AnnotationMode.ENABLE,
        });
        return render.promise;
      })
      .catch((e) => {
        if (active && e.name !== "RenderingCancelledException") setError("Não foi possível mostrar a imagem original.");
      });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, field.page, field.x, field.y, field.w, field.h, field.assetId, field.imageCleared, scale]);
  const select = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("Escolha uma imagem PNG ou JPEG.");
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      const result = await upload(file);
      if (!["image/png", "image/jpeg"].includes(result.mime)) throw new Error("Escolha uma imagem PNG ou JPEG.");
      change.current({ assetId: result.assetId, imageCleared: false });
    } catch (e: any) {
      setError(e.message || "Não foi possível carregar a imagem.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-field">
      {field.assetId ? (
        <img src={`/api/assets/${field.assetId}`} alt={field.label} />
      ) : !field.imageCleared ? (
        <canvas ref={canvas} aria-label={`Imagem original: ${field.label}`} />
      ) : null}
      <div className="image-field-actions">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Enviando…" : field.assetId ? "Substituir imagem" : "Escolher imagem"}
        </button>
        {(field.assetId || !field.imageCleared) && (
          <button
            type="button"
            disabled={busy}
            aria-label={`Remover imagem: ${field.label}`}
            onClick={() => {
              setError("");
              onChange({ assetId: undefined, imageCleared: true });
            }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="image-field-error">
          {error}
        </div>
      )}
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg"
        aria-label={`Selecionar imagem: ${field.label}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void select(file);
        }}
      />
    </div>
  );
}
function PageCanvas({ pdf, page, scale }: { pdf: pdfjs.PDFDocumentProxy; page: number; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: element.closest(".pdf-scroll"), rootMargin: "800px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    if (!visible) {
      element.width = 0;
      element.height = 0;
      return;
    }
    let render: pdfjs.RenderTask | undefined,
      active = true;
    void pdf
      .getPage(page + 1)
      .then((p) => {
        if (!active) return;
        const viewport = p.getViewport({ scale: scale * devicePixelRatio });
        element.width = viewport.width;
        element.height = viewport.height;
        render = p.render({ canvas: element, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE });
        return render.promise;
      })
      .catch((e) => {
        if (e.name !== "RenderingCancelledException") console.warn(e);
      });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page, scale, visible]);
  return <canvas ref={canvas} style={{ width: "100%", height: "100%", pointerEvents: "none" }} />;
}
export function PdfEditor({
  resource,
  settings,
  onSaved,
  onBoard,
  onJournal,
  sidePanel,
}: {
  resource: Resource;
  settings: Settings;
  onSaved: (r: Resource) => void;
  onBoard: () => void;
  onJournal: () => void;
  sidePanel: "board" | "journal" | null;
}) {
  const editor = useDocument(resource, settings, onSaved),
    { pdf, error } = usePdf(resource.data.assetId);
  const [page, setPage] = useState(0),
    [scale, setScale] = useState(0.7),
    [sizes, setSizes] = useState<PageSize[]>([]),
    [configure, setConfigure] = useState(false),
    [tool, setTool] = useState<"select" | "text" | "check">("select"),
    [selected, setSelected] = useState<string | null>(null),
    [fit, setFit] = useState(true),
    [showTools, setShowTools] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const width = sizes.length ? Math.max(...sizes.map((size) => size.w)) : 612;
  const fields = editor.doc.data.fields as Field[],
    field = fields.find((f) => f.id === selected);
  const fitPage = () => {
    if (scroll.current) {
      const style = getComputedStyle(scroll.current);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setScale(Math.max(0.15, Math.min(2, (scroll.current.clientWidth - padding) / width)));
    }
  };
  useEffect(() => {
    setSizes([]);
    setPage(0);
    setSelected(null);
    if (scroll.current) scroll.current.scrollTop = 0;
    if (!pdf) return;
    let active = true;
    void Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const p = await pdf.getPage(index + 1),
          v = p.getViewport({ scale: 1 });
        return { w: v.width, h: v.height };
      }),
    )
      .then((next) => {
        if (active) setSizes(next);
      })
      .catch(console.warn);
    return () => {
      active = false;
    };
  }, [pdf]);
  useEffect(() => {
    if (!fit) return;
    fitPage();
    const observer = new ResizeObserver(fitPage);
    if (scroll.current) observer.observe(scroll.current);
    return () => observer.disconnect();
  }, [width, fit]);
  const trackPage = () => {
    const container = scroll.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    let best = 0,
      visibleHeight = 0;
    container.querySelectorAll<HTMLElement>(".pdf-page").forEach((element, index) => {
      const rect = element.getBoundingClientRect(),
        height = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
      if (height > visibleHeight) {
        best = index;
        visibleHeight = height;
      }
    });
    if (visibleHeight) setPage(best);
  };
  useEffect(() => {
    trackPage();
  }, [sizes, scale]);
  const goToPage = (index: number) => {
    const container = scroll.current,
      element = container?.querySelectorAll<HTMLElement>(".pdf-page")[index];
    if (container && element) {
      container.scrollTo({ top: element.offsetTop - parseFloat(getComputedStyle(container).paddingTop) });
      setPage(index);
    }
  };
  const update = (id: string, patch: Partial<Field>) => {
    const target = fields.find((f) => f.id === id);
    editor.setData({
      ...editor.doc.data,
      fields: fields.map((f) =>
        f.id === id
          ? { ...f, ...patch }
          : target?.native && f.native === target.native && ("value" in patch || "assetId" in patch || "imageCleared" in patch)
            ? {
                ...f,
                ...("value" in patch ? { value: target.nativeType === "PDFRadioGroup" ? false : patch.value! } : {}),
                ...("assetId" in patch ? { assetId: patch.assetId } : {}),
                ...("imageCleared" in patch ? { imageCleared: patch.imageCleared } : {}),
              }
            : f,
      ),
    });
  };
  const add = (e: React.MouseEvent<HTMLDivElement>, page: number, size: PageSize) => {
    if (!configure || tool === "select" || e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect(),
      x = (e.clientX - r.left) / scale,
      y = (e.clientY - r.top) / scale;
    const f: Field = {
      id: uuid(),
      page,
      x,
      y,
      w: Math.min(tool === "check" ? 20 : 160, size.w - x),
      h: Math.min(tool === "check" ? 20 : 32, size.h - y),
      type: tool === "check" ? "check" : "text",
      value: tool === "check" ? false : "",
      label: tool === "check" ? "Marcação" : "Novo campo",
      fontSize: 12,
      align: "left",
    };
    editor.setData({ ...editor.doc.data, fields: [...fields, f] });
    setSelected(f.id);
    setTool("select");
  };
  const drag = (e: React.PointerEvent, f: Field, resize = false) => {
    if (!configure || f.native) return;
    const size = sizes[f.page];
    if (!size) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(f.id);
    const start = { x: e.clientX, y: e.clientY },
      el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const box = el.closest(".pdf-field") as HTMLElement;
    let patch: Partial<Field> = {};
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale,
        dy = (ev.clientY - start.y) / scale;
      patch = resize
        ? { w: Math.max(12, Math.min(size.w - f.x, f.w + dx)), h: Math.max(12, Math.min(size.h - f.y, f.h + dy)) }
        : { x: Math.max(0, Math.min(size.w - f.w, f.x + dx)), y: Math.max(0, Math.min(size.h - f.h, f.y + dy)) };
      if (resize) {
        box.style.width = `${patch.w! * scale}px`;
        box.style.height = `${patch.h! * scale}px`;
      } else {
        box.style.left = `${patch.x! * scale}px`;
        box.style.top = `${patch.y! * scale}px`;
      }
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      if (Object.keys(patch).length) update(f.id, patch);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  return (
    <div className="editor-shell">
      <div className="editor-top">
        <div className="segmented">
          <button
            className={!configure ? "active" : ""}
            onClick={() => {
              setConfigure(false);
              setTool("select");
            }}>
            Preencher
          </button>
          <button className={configure ? "active" : ""} onClick={() => setConfigure(true)}>
            Configurar campos
          </button>
        </div>
        <div className="editor-actions">
          <select
            aria-label="Modo de salvamento da ficha"
            value={editor.doc.data.mode || "inherit"}
            onChange={(e) => editor.setData({ ...editor.doc.data, mode: e.target.value })}>
            <option value="inherit">Salvamento padrão</option>
            <option value="auto">Automático</option>
            <option value="manual">Manual</option>
          </select>
          <button className="secondary small" aria-pressed={sidePanel === "board"} onClick={onBoard}>
            <PanelRight size={15} />
            Quadro ao lado
          </button>
          <button className="secondary small" aria-pressed={sidePanel === "journal"} onClick={onJournal}>
            <BookOpen size={15} />
            Diário ao lado
          </button>
          <button
            className="primary small"
            onClick={async () => {
              if (await editor.save(true)) download(`/sheets/${resource.id}/export`);
            }}>
            <Download size={15} />
            Baixar PDF
          </button>
        </div>
      </div>
      <SaveBar editor={editor} />
      {error && <div className="alert">{error}</div>}
      {resource.data.warnings?.length > 0 && (
        <details className="pdf-warnings">
          <summary>{resource.data.warnings.length} campo(s) com edição limitada</summary>
          {resource.data.warnings.map((w: string, i: number) => (
            <p key={i}>{w}</p>
          ))}
        </details>
      )}
      <div className="pdf-workspace">
        <div className="pdf-scroll" ref={scroll} onScroll={trackPage}>
          {!pdf || !sizes.length ? (
            <div className="loading">Carregando sua ficha…</div>
          ) : (
            sizes.map((size, page) => (
              <div
                key={`${resource.data.assetId}-${page}`}
                aria-label={`Página ${page + 1}`}
                className={`pdf-page ${configure ? "configuring" : ""}`}
                style={{ width: size.w * scale, height: size.h * scale, cursor: configure && tool !== "select" ? "crosshair" : undefined }}
                onClick={(e) => add(e, page, size)}>
                <PageCanvas pdf={pdf} page={page} scale={scale} />
                {fields
                  .filter((f) => f.page === page)
                  .map((f) => (
                    <div
                      key={f.id}
                      className={`pdf-field ${selected === f.id ? "selected" : ""} ${f.native ? "native" : ""}`}
                      style={{ left: f.x * scale, top: f.y * scale, width: f.w * scale, height: f.h * scale, fontSize: f.fontSize * scale }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(f.id);
                      }}
                      onPointerDown={(e) => (configure ? drag(e, f) : undefined)}>
                      {configure ? (
                        <div className="field-label">
                          {f.native ? "▣ " : ""}
                          {f.label}
                        </div>
                      ) : f.type === "image" ? (
                        <ImageField field={f} pdf={pdf!} scale={scale} onChange={(patch) => update(f.id, patch)} />
                      ) : f.type === "check" ? (
                        <input aria-label={f.label} type="checkbox" checked={!!f.value} onChange={(e) => update(f.id, { value: e.target.checked })} />
                      ) : f.options ? (
                        <select aria-label={f.label} value={String(f.value)} onChange={(e) => update(f.id, { value: e.target.value })}>
                          <option value="" />
                          {f.options.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <textarea
                          spellCheck={false}
                          aria-label={f.label}
                          style={{ fontSize: "inherit", textAlign: f.align }}
                          value={String(f.value)}
                          onChange={(e) => update(f.id, { value: e.target.value })}
                          onInput={(e) => {
                            const t = e.currentTarget;
                            t.title =
                              t.scrollHeight > t.clientHeight + 2 ? "O texto ultrapassa a altura do campo. Aumente o campo ou reduza a fonte." : f.label;
                          }}
                        />
                      )}
                      {configure && selected === f.id && !f.native && (
                        <button className="resize-handle" aria-label="Redimensionar campo" onPointerDown={(e) => drag(e, f, true)} />
                      )}
                    </div>
                  ))}
              </div>
            ))
          )}
        </div>
        {configure && showTools && (
          <aside className="field-tools">
            <div className="eyebrow">FERRAMENTAS</div>
            <button className={tool === "select" ? "tool active" : "tool"} onClick={() => setTool("select")}>
              <MousePointer2 size={16} />
              Selecionar
            </button>
            <button className={tool === "text" ? "tool active" : "tool"} onClick={() => setTool("text")}>
              <Type size={16} />
              Campo de texto
            </button>
            <button className={tool === "check" ? "tool active" : "tool"} onClick={() => setTool("check")}>
              <SquareCheck size={16} />
              Marcação
            </button>
            <p className="hint">Escolha uma ferramenta e clique na ficha. Arraste os campos para posicionar.</p>
            {field && (
              <>
                <hr />
                <div className="eyebrow">CAMPO SELECIONADO</div>
                <label>
                  Nome
                  <input value={field.label} onChange={(e) => update(field.id, { label: e.target.value })} />
                </label>
                {!field.native && field.type === "text" && (
                  <>
                    <label>
                      Tamanho da fonte
                      <input
                        type="number"
                        min={4}
                        max={120}
                        value={field.fontSize}
                        onChange={(e) => update(field.id, { fontSize: Math.max(4, Math.min(120, Number(e.target.value))) })}
                      />
                    </label>
                    <label>
                      Alinhamento
                      <select value={field.align} onChange={(e) => update(field.id, { align: e.target.value as Field["align"] })}>
                        <option value="left">Esquerda</option>
                        <option value="center">Centro</option>
                        <option value="right">Direita</option>
                      </select>
                    </label>
                  </>
                )}
                {field.native ? (
                  <p className="hint">Campo do formulário original. A posição é preservada.</p>
                ) : (
                  <button
                    className="danger-button"
                    onClick={() => {
                      editor.setData({ ...editor.doc.data, fields: fields.filter((f) => f.id !== field.id) });
                      setSelected(null);
                    }}>
                    <Trash2 size={15} />
                    Excluir campo
                  </button>
                )}
              </>
            )}
          </aside>
        )}
      </div>
      <div className="pdf-bottom">
        <div className="pager">
          <button className="icon" disabled={!sizes.length || page === 0} aria-label="Página anterior" onClick={() => goToPage(page - 1)}>
            <ChevronLeft size={17} />
          </button>
          <span>
            Página <b>{page + 1}</b> de {pdf?.numPages ?? resource.data.pageCount}
          </span>
          <button className="icon" disabled={!sizes.length || page + 1 >= sizes.length} aria-label="Próxima página" onClick={() => goToPage(page + 1)}>
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="zoom">
          <button
            className="icon"
            aria-label="Diminuir zoom"
            onClick={() => {
              setFit(false);
              setScale((s) => Math.max(0.15, s - 0.1));
            }}>
            <Minus size={16} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            className="icon"
            aria-label="Aumentar zoom"
            onClick={() => {
              setFit(false);
              setScale((s) => Math.min(3, s + 0.1));
            }}>
            <Plus size={16} />
          </button>
          <button
            className="icon"
            title="Ajustar à largura"
            aria-label="Ajustar à largura"
            onClick={() => {
              setFit(true);
              fitPage();
            }}>
            <Maximize size={16} />
          </button>
          {configure && (
            <button className="icon" aria-label="Mostrar ferramentas" onClick={() => setShowTools((v) => !v)}>
              <SlidersHorizontal size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
