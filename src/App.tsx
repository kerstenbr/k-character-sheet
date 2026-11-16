import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Folder,
  Plus,
  Search,
  Upload,
  Settings as SettingsIcon,
  Trash2,
  Files,
  BookOpen,
  ArrowUpRight,
  ChevronRight,
  MoreHorizontal,
  FileText,
  StickyNote,
  History,
  Download,
  Copy,
  FolderInput,
  Bookmark,
  Check,
  LoaderCircle,
  List,
  ArrowLeft,
  PanelRightClose,
  PanelLeft,
} from "lucide-react";
import type { Resource, Settings } from "../shared/types";
import { api, post, create, upload, download, formatDate } from "./api";
import { Modal, Empty } from "./components";
import { Thumbnail, PdfEditor } from "./PdfEditor";
import Board from "./Board";
import { pending, manualPending } from "./useDocument";
import { Journal, HistoryPanel, SettingsPanel } from "./Screens";

type Route = { section: "library" | "templates" | "trash" | "settings"; id?: string; tab?: string };
export default function App() {
  const [resources, setResources] = useState<Resource[]>([]),
    [route, setRoute] = useState<Route>({ section: "library" }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [grid, setGrid] = useState(true),
    [sort, setSort] = useState("recent"),
    [limit, setLimit] = useState(24),
    [split, setSplit] = useState<"board" | "journal" | null>(null),
    [navigationOpen, setNavigationOpen] = useState(false),
    [modal, setModal] = useState<{ type: string; resource?: Resource } | null>(null),
    [name, setName] = useState(""),
    [color, setColor] = useState("#22d3ee"),
    [icon, setIcon] = useState("◈"),
    [destination, setDestination] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [working, setWorking] = useState(false),
    [modalError, setModalError] = useState("");
  const settingsResource = resources.find((r) => r.kind === "settings"),
    settings: Settings = settingsResource?.data || { mode: "auto", delay: 2, theme: "dark" };
  const folders = resources.filter((r) => r.kind === "folder" && !r.deleted),
    current = resources.find((r) => r.id === route.id),
    isSheet = current?.kind === "sheet",
    tab = isSheet ? route.tab || "sheets" : "sheets";
  const workspace = route.section === "library" && !!current && (isSheet || tab !== "sheets");
  const refresh = async () => {
    setResources(await api<Resource[]>("/resources"));
  };
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => (document.documentElement.dataset.theme = settings.theme === "system" ? (media.matches ? "dark" : "light") : settings.theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const onSaved = (r: Resource) => setResources((old) => (old.some((x) => x.id === r.id) ? old.map((x) => (x.id === r.id ? r : x)) : [r, ...old]));
  const navigate = async (next: Route) => {
    if (pending.size) {
      if (manualPending.size && !confirm("Salvar alterações pendentes antes de continuar?")) return;
      for (const save of pending.values()) if (!(await save())) return;
    }
    setRoute(next);
    setNavigationOpen(false);
    setSplit(null);
    setQuery("");
    setLimit(24);
  };
  const openModal = async (type: string, resource?: Resource) => {
    if (pending.size) {
      if (manualPending.size && !confirm("Salvar as alterações antes de continuar?")) return;
      for (const save of pending.values()) if (!(await save())) return;
      if (resource) {
        try {
          const latest = await api<Resource[]>("/resources");
          setResources(latest);
          resource = latest.find((r) => r.id === resource!.id) || resource;
        } catch (e: any) {
          setError(e.message);
          return;
        }
      }
    }
    setModal({ type, resource });
    setName(resource?.name || "");
    setColor(resource?.data.color || "#22d3ee");
    setIcon(resource?.data.icon || "◈");
    setDestination(resource?.parentId || (current?.kind === "folder" && current.id) || "");
    setFile(null);
    setModalError("");
  };
  const run = async (fn: () => Promise<void>) => {
    try {
      setError("");
      await fn();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const showBoard = isSheet && (tab === "board" || (tab === "pdf" && split === "board"));
  const board = resources.find((r) => r.kind === "board" && r.parentId === current?.id && !r.deleted),
    boardCreating = useRef<string | null>(null);
  useEffect(() => {
    if (showBoard && !board && current && boardCreating.current !== current.id) {
      boardCreating.current = current.id;
      void create("board", `Quadro de ${current.name}`, current.id, { items: [], connections: [] })
        .then(onSaved)
        .catch(async (e) => {
          if (e.status === 409) await refresh();
          else setError(e.message);
        })
        .finally(() => {
          boardCreating.current = null;
        });
    }
  }, [showBoard, board, current?.id]);
  const changeSidePanel = async (next: "board" | "journal" | null) => {
    if (split === "board" && board) {
      const save = pending.get(board.id);
      if (save && !(await save())) return;
    }
    if (split === "journal") {
      for (const entry of resources.filter((r) => r.kind === "entry" && r.data.sheetIds?.includes(current?.id))) {
        const save = pending.get(entry.id);
        if (save && !(await save())) return;
      }
    }
    setSplit(next === split ? null : next);
  };
  const saveModal = async () => {
    setWorking(true);
    setModalError("");
    try {
      if (!modal) return;
      const r = modal.resource;
      if (modal.type === "folder") {
        if (!name.trim()) throw new Error("Digite um nome para a campanha.");
        if (r) {
          onSaved(
            await api<Resource>(`/resources/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, name, data: { color, icon }, saveMode: "manual" }) }),
          );
        } else onSaved(await create("folder", name, null, { color, icon }));
      }
      if (modal.type === "upload") {
        if (!file) throw new Error("Escolha um PDF.");
        const a = await upload(file);
        if (a.mime !== "application/pdf") throw new Error("Escolha um arquivo PDF.");
        const sheet = await create("sheet", name.trim() || file.name.replace(/\.pdf$/i, ""), destination || null, {
          assetId: a.assetId,
          fields: a.fields,
          pageCount: a.pageCount,
          warnings: a.warnings,
          mode: "inherit",
        });
        onSaved(sheet);
        setRoute({ section: "library", id: sheet.id, tab: "pdf" });
        setToast("Ficha importada.");
      }
      if (modal.type === "rename" && r) {
        if (!name.trim()) throw new Error("Digite um nome.");
        onSaved(await api<Resource>(`/resources/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, name, saveMode: "manual" }) }));
      }
      if (modal.type === "move" && r)
        onSaved(
          await api<Resource>(`/resources/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, parentId: destination || null, saveMode: "manual" }) }),
        );
      if (["duplicate", "template", "instantiate"].includes(modal.type) && r) {
        const copy = await post<Resource>(`/resources/${r.id}/duplicate`, {
          name: name || `${r.name} — cópia`,
          asTemplate: modal.type === "template",
          parentId: destination || null,
        });
        onSaved(copy);
        await refresh();
        if (copy.kind === "sheet") setRoute({ section: "library", id: copy.id, tab: "pdf" });
        setToast(modal.type === "template" ? "Modelo criado com campos vazios." : "Ficha criada.");
      }
      setModal(null);
    } catch (e: any) {
      setModalError(e.message);
    } finally {
      setWorking(false);
    }
  };
  const trash = async (r: Resource) => {
    if (!confirm(`Mover “${r.name}”${r.kind === "folder" ? " e todo seu conteúdo" : ""} para a lixeira? Você poderá restaurar depois.`)) return;
    await run(async () => {
      await post(`/resources/${r.id}/trash`);
      await refresh();
      if (current?.id === r.id) setRoute({ section: "library" });
      setToast("Movido para a lixeira.");
    });
  };
  let sheets = resources
    .filter(
      (r) =>
        !r.deleted &&
        (route.section === "templates" ? r.kind === "template" : r.kind === "sheet") &&
        (route.section === "templates" || !route.id || (route.id === "unfiled" ? !r.parentId : r.parentId === route.id)),
    )
    .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
  sheets.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "pt-BR") : b.updated.localeCompare(a.updated)));
  const title =
    route.section === "templates"
      ? "Modelos"
      : route.section === "trash"
        ? "Lixeira"
        : route.section === "settings"
          ? "Configurações"
          : current?.name || (route.id === "unfiled" ? "Sem campanha" : "Biblioteca");
  const libraryView = (route.section === "library" && !isSheet && tab === "sheets") || route.section === "templates";
  const allCount = resources.filter((r) => r.kind === "sheet" && !r.deleted).length;
  const menu = (r: Resource) => (
    <details className="card-menu" onClick={(e) => e.stopPropagation()}>
      <summary aria-label={`Opções de ${r.name}`}>
        <MoreHorizontal size={19} />
      </summary>
      <div className="dropdown">
        <button onClick={() => openModal("rename", r)}>Renomear</button>
        {r.kind === "sheet" ? (
          <>
            <button onClick={() => openModal("move", r)}>
              <FolderInput size={14} />
              Mover para campanha
            </button>
            <button onClick={() => openModal("duplicate", r)}>
              <Copy size={14} />
              Duplicar ficha
            </button>
            <button onClick={() => openModal("template", r)}>
              <Bookmark size={14} />
              Salvar como modelo
            </button>
            <button onClick={() => download(`/sheets/${r.id}/export`)}>
              <Download size={14} />
              Baixar PDF salvo
            </button>
          </>
        ) : (
          <button onClick={() => openModal("instantiate", r)}>Criar ficha deste modelo</button>
        )}
        <button className="danger" onClick={() => void trash(r)}>
          <Trash2 size={14} />
          Mover para lixeira
        </button>
      </div>
    </details>
  );
  return (
    <div className={`app ${workspace ? "workspace-app" : ""} ${navigationOpen ? "navigation-open" : ""}`}>
      <aside className="sidebar" id="library-navigation">
        {workspace && (
          <button className="secondary small navigation-close" onClick={() => setNavigationOpen(false)}>
            <PanelLeft size={16} />
            Recolher biblioteca
          </button>
        )}
        <button className="brand" onClick={() => void navigate({ section: "library" })}>
          <span className="brand-mark" role="img" aria-label="K" />
          <span>
            CHARACTER
            <br />
            <b>SHEET</b>
          </span>
        </button>
        <div className="nav-label">BIBLIOTECA</div>
        <nav>
          <button className={route.section === "library" && !route.id ? "nav-item active" : "nav-item"} onClick={() => void navigate({ section: "library" })}>
            <LayoutGrid size={18} />
            <span>Todas as fichas</span>
            <small>{allCount}</small>
          </button>
          <button className={route.id === "unfiled" ? "nav-item active" : "nav-item"} onClick={() => void navigate({ section: "library", id: "unfiled" })}>
            <Files size={18} />
            <span>Fichas sem campanha</span>
            <small>{resources.filter((r) => r.kind === "sheet" && !r.deleted && !r.parentId).length}</small>
          </button>
          <button className={route.section === "templates" ? "nav-item active" : "nav-item"} onClick={() => void navigate({ section: "templates" })}>
            <Bookmark size={18} />
            <span>Modelos</span>
          </button>
        </nav>
        <div className="nav-label campaigns-label">
          CAMPANHAS
          <button className="icon" title="Criar campanha" aria-label="Criar campanha" onClick={() => openModal("folder")}>
            <Plus size={16} />
          </button>
        </div>
        <nav className="campaign-nav">
          {folders.map((f) => (
            <button
              key={f.id}
              className={route.id === f.id || current?.parentId === f.id ? "nav-item active" : "nav-item"}
              onClick={() => void navigate({ section: "library", id: f.id })}>
              <span className="campaign-symbol" style={{ color: f.data.color }}>
                {f.data.icon || "◈"}
              </span>
              <span>{f.name}</span>
              <small>{resources.filter((r) => r.kind === "sheet" && r.parentId === f.id && !r.deleted).length}</small>
            </button>
          ))}
          {!folders.length && <p className="sidebar-hint">Nenhuma campanha criada.</p>}
          <button className="new-campaign" onClick={() => openModal("folder")}>
            <Plus size={15} />
            Nova campanha
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className={route.section === "trash" ? "nav-item active" : "nav-item"} onClick={() => void navigate({ section: "trash" })}>
            <Trash2 size={17} />
            Lixeira
          </button>
          <button className={route.section === "settings" ? "nav-item active" : "nav-item"} onClick={() => void navigate({ section: "settings" })}>
            <SettingsIcon size={17} />
            Configurações
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="breadcrumb">
            <span>K Character Sheet</span>
            <ChevronRight size={13} />
            <span>{current?.kind === "sheet" ? folders.find((f) => f.id === current.parentId)?.name || "Sem campanha" : title}</span>
          </div>
        </div>
        <div className={`page-content ${workspace ? "workspace-page" : ""}`}>
          <header className="page-heading">
            <div className="page-identity">
              {workspace && (
                <button
                  className="icon bordered"
                  title="Mostrar biblioteca"
                  aria-label="Mostrar biblioteca"
                  aria-expanded={navigationOpen}
                  aria-controls="library-navigation"
                  onClick={() => setNavigationOpen((open) => !open)}>
                  <PanelLeft size={18} />
                </button>
              )}
              {isSheet && (
                <button className="back-link" onClick={() => void navigate({ section: "library", id: current.parentId || undefined })}>
                  <ArrowLeft size={14} />
                  Voltar à campanha
                </button>
              )}
              <h1>{title}</h1>
            </div>
            <div className="heading-actions">
              {current?.kind === "folder" && (
                <>
                  <button className="icon bordered" title="Editar campanha" aria-label="Editar campanha" onClick={() => openModal("folder", current)}>
                    <SettingsIcon size={18} />
                  </button>
                  <button className="icon bordered" title="Excluir campanha" aria-label="Excluir campanha" onClick={() => void trash(current)}>
                    <Trash2 size={18} />
                  </button>
                </>
              )}
              {isSheet
                ? menu(current)
                : route.section === "library" && (
                    <button className="primary" onClick={() => openModal("upload")}>
                      <Plus size={18} />
                      Importar ficha
                    </button>
                  )}
            </div>
          </header>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => setError("")}>Fechar</button>
            </div>
          )}
          {current && route.section === "library" && (
            <div className="tabs">
              {(isSheet
                ? [
                    ["pdf", "Ficha", FileText],
                    ["board", "Quadro", StickyNote],
                    ["journal", "Diário", BookOpen],
                    ["history", "Histórico", History],
                  ]
                : [["sheets", "Fichas", Files]]
              ).map(([id, label, Icon]: any) => (
                <button key={id} className={tab === id ? "active" : ""} onClick={() => void navigate({ ...route, tab: id })}>
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          )}
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Carregando fichas…
            </div>
          ) : (
            <>
              {libraryView && (
                <>
                  {!current && route.section === "library" && folders.length > 0 && (
                    <div className="campaign-strip">
                      {folders.slice(0, 4).map((f) => (
                        <button className="campaign-card" key={f.id} onClick={() => void navigate({ section: "library", id: f.id })}>
                          <span className="campaign-tile" style={{ color: f.data.color, background: `${f.data.color}15` }}>
                            {f.data.icon || "◈"}
                          </span>
                          <div>
                            <b>{f.name}</b>
                            <span>{resources.filter((r) => r.kind === "sheet" && !r.deleted && r.parentId === f.id).length} fichas</span>
                          </div>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="section-toolbar">
                    <div className="search">
                      <Search size={17} />
                      <input
                        aria-label="Buscar fichas"
                        placeholder="Buscar personagem ou ficha…"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setLimit(24);
                        }}
                      />
                    </div>
                    <div className="view-options">
                      <span className="result-count">
                        {sheets.length} {sheets.length === 1 ? "ficha" : "fichas"}
                      </span>
                      <select aria-label="Ordenar fichas" value={sort} onChange={(e) => setSort(e.target.value)}>
                        <option value="recent">Mais recentes</option>
                        <option value="name">Nome A–Z</option>
                      </select>
                      <div className="segmented">
                        <button className={grid ? "active" : ""} aria-label="Visualização em cartões" onClick={() => setGrid(true)}>
                          <LayoutGrid size={16} />
                        </button>
                        <button className={!grid ? "active" : ""} aria-label="Visualização em lista" onClick={() => setGrid(false)}>
                          <List size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {!sheets.length ? (
                    <Empty
                      icon={route.section === "templates" ? <Bookmark size={32} /> : <FileText size={32} />}
                      title={query ? "Nenhuma ficha encontrada" : route.section === "templates" ? "Nenhum modelo criado" : "Nenhuma ficha importada"}
                      action={
                        !query && route.section !== "templates" ? (
                          <button className="primary" onClick={() => openModal("upload")}>
                            <Upload size={17} />
                            Importar ficha
                          </button>
                        ) : undefined
                      }>
                      {query
                        ? "Tente outro nome."
                        : route.section === "templates"
                          ? "Use “Salvar como modelo” no menu de uma ficha para reutilizar seus campos."
                          : "Importe uma ficha em PDF para começar."}
                    </Empty>
                  ) : (
                    <div className={grid ? "sheet-grid" : "sheet-list"}>
                      {sheets.slice(0, limit).map((s) => (
                        <article key={s.id} className="sheet-card">
                          <button
                            className="sheet-preview"
                            aria-label={`Abrir ${s.name}`}
                            onClick={() =>
                              route.section === "templates" ? openModal("instantiate", s) : void navigate({ section: "library", id: s.id, tab: "pdf" })
                            }>
                            <Thumbnail assetId={s.data.assetId} />
                            <span className="page-badge">{s.data.pageCount} páginas</span>
                            <span className="open-sheet">
                              {route.section === "templates" ? "Usar modelo" : "Abrir ficha"}
                              <ArrowUpRight size={15} />
                            </span>
                          </button>
                          <div className="sheet-card-info">
                            <div className="sheet-card-title">
                              <button
                                onClick={() =>
                                  route.section === "templates" ? openModal("instantiate", s) : void navigate({ section: "library", id: s.id, tab: "pdf" })
                                }>
                                <h3>{s.name}</h3>
                              </button>
                              {menu(s)}
                            </div>
                            <div className="sheet-meta">
                              <span className="folder-tag">
                                <span className="tiny-dot" style={{ background: folders.find((f) => f.id === s.parentId)?.data.color || "#68758a" }} />
                                {folders.find((f) => f.id === s.parentId)?.name || (s.kind === "template" ? "Modelo reutilizável" : "Sem campanha")}
                              </span>
                              <span title={formatDate(s.updated)}>{new Date(s.updated).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</span>
                            </div>
                          </div>
                        </article>
                      ))}
                      {grid && route.section === "library" && (
                        <button className="add-sheet-card" onClick={() => openModal("upload")}>
                          <span>
                            <Plus size={26} />
                          </span>
                          <b>Importar ficha</b>
                          <small>Arquivo PDF</small>
                        </button>
                      )}
                    </div>
                  )}
                  {sheets.length > limit && (
                    <button className="secondary load-more" onClick={() => setLimit((n) => n + 24)}>
                      Carregar mais fichas
                    </button>
                  )}
                </>
              )}
              {current && isSheet && tab === "pdf" && (
                <div className={`split-workspace ${split ? "split" : ""}`}>
                  <PdfEditor
                    key={current.id}
                    resource={current}
                    settings={settings}
                    onSaved={onSaved}
                    sidePanel={split}
                    onBoard={() => void changeSidePanel("board")}
                    onJournal={() => void changeSidePanel("journal")}
                  />
                  {split && (
                    <section className="split-board">
                      <div className="split-board-title">
                        <span>{split === "journal" ? "Diário do personagem" : "Quadro do personagem"}</span>
                        <button
                          className="icon"
                          aria-label={split === "journal" ? "Fechar diário lateral" : "Fechar quadro lateral"}
                          onClick={() => void changeSidePanel(null)}>
                          <PanelRightClose size={18} />
                        </button>
                      </div>
                      {split === "journal" ? (
                        <Journal key={current.id} parent={current} resources={resources} settings={settings} onSaved={onSaved} refresh={refresh} />
                      ) : board ? (
                        <Board
                          key={board.id}
                          resource={board}
                          settings={{ ...settings, mode: current.data.mode === "inherit" ? settings.mode : current.data.mode || settings.mode }}
                          onSaved={onSaved}
                        />
                      ) : (
                        <div className="loading">Preparando quadro…</div>
                      )}
                    </section>
                  )}
                </div>
              )}
              {current &&
                isSheet &&
                tab === "board" &&
                (board ? (
                  <Board
                    key={board.id}
                    resource={board}
                    settings={{ ...settings, mode: isSheet && current.data.mode !== "inherit" ? current.data.mode || settings.mode : settings.mode }}
                    onSaved={onSaved}
                  />
                ) : (
                  <div className="loading">Preparando quadro…</div>
                ))}
              {current && isSheet && tab === "journal" && (
                <Journal parent={current} resources={resources} settings={settings} onSaved={onSaved} refresh={refresh} />
              )}
              {current && isSheet && tab === "history" && <HistoryPanel resource={current} resources={resources} onSaved={onSaved} />}
              {route.section === "settings" && settingsResource && <SettingsPanel resource={settingsResource} onSaved={onSaved} refresh={refresh} />}
              {route.section === "trash" && (
                <>
                  {!resources.some((r) => r.deleted) ? (
                    <Empty icon={<Trash2 size={30} />} title="Lixeira vazia">
                      Os itens excluídos aparecem aqui.
                    </Empty>
                  ) : (
                    <>
                      <div className="section-toolbar">
                        <p className="muted">A exclusão definitiva também remove o histórico e os arquivos que não estão em uso.</p>
                        <button
                          className="danger-button"
                          onClick={() =>
                            void run(async () => {
                              if (!confirm("Esvaziar toda a lixeira? Esta ação não pode ser desfeita.")) return;
                              for (const r of resources.filter((r) => r.deleted && (!r.parentId || !resources.find((p) => p.id === r.parentId)?.deleted)))
                                await api(`/resources/${r.id}`, { method: "DELETE" });
                              await refresh();
                            })
                          }>
                          Esvaziar lixeira
                        </button>
                      </div>
                      <div className="version-list">
                        {resources
                          .filter((r) => r.deleted && (!r.parentId || !resources.find((p) => p.id === r.parentId)?.deleted))
                          .map((r) => (
                            <div className="version-row" key={r.id}>
                              <div className="version-icon">{r.kind === "folder" ? <Folder size={20} /> : <FileText size={20} />}</div>
                              <div>
                                <b>{r.name}</b>
                                <p>Excluído em {formatDate(r.deleted!)}</p>
                              </div>
                              <button
                                className="secondary small"
                                onClick={() =>
                                  void run(async () => {
                                    await post(`/resources/${r.id}/restore`);
                                    await refresh();
                                    setToast("Restaurado.");
                                  })
                                }>
                                Restaurar
                              </button>
                              <button
                                className="icon danger"
                                aria-label={`Excluir definitivamente ${r.name}`}
                                onClick={() =>
                                  void run(async () => {
                                    if (confirm(`Excluir “${r.name}” definitivamente?`)) {
                                      await api(`/resources/${r.id}`, { method: "DELETE" });
                                      await refresh();
                                    }
                                  })
                                }>
                                <Trash2 size={17} />
                              </button>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              folder: modal.resource ? "Editar campanha" : "Nova campanha",
              upload: "Importar ficha",
              rename: "Renomear",
              move: "Mover ficha",
              duplicate: "Duplicar ficha",
              template: "Salvar como modelo",
              instantiate: "Novo personagem",
            }[modal.type] || ""
          }
          onClose={() => {
            if (!working) setModal(null);
          }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveModal();
            }}>
            {modal.type === "upload" && (
              <label
                className={`upload-zone ${file ? "has-file" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) {
                    setFile(f);
                    setName(f.name.replace(/\.pdf$/i, ""));
                  }
                }}>
                <Upload size={30} />
                <b>{file?.name || "Escolha ou arraste seu PDF"}</b>
                <span>Com ou sem campos preenchíveis</span>
                <input
                  hidden
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      setName(f.name.replace(/\.pdf$/i, ""));
                    }
                  }}
                />
              </label>
            )}
            {modal.type !== "move" && (
              <label>
                {modal.type === "folder" ? "Nome da campanha" : modal.type === "template" ? "Nome do modelo" : "Nome"}
                <input
                  autoFocus={modal.type !== "upload"}
                  value={name}
                  maxLength={200}
                  placeholder={modal.type === "folder" ? "Ex.: RPG de sábado" : "Ex.: Nome do personagem"}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            {modal.type === "folder" && (
              <div className="form-row">
                <label>
                  Cor
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                </label>
                <label>
                  Símbolo
                  <select value={icon} onChange={(e) => setIcon(e.target.value)}>
                    {["◈", "✦", "⚔", "☾", "◎", "⌘", "♜", "⬡"].map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {["upload", "move", "instantiate"].includes(modal.type) && (
              <label>
                Campanha
                <select value={destination} onChange={(e) => setDestination(e.target.value)}>
                  <option value="">Sem campanha</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modal.type === "template" && (
              <p className="hint">O modelo reutiliza o PDF e os campos configurados, com valores vazios. Sua ficha atual permanece intacta.</p>
            )}
            {modalError && <div className="alert">{modalError}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={working} onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="primary" disabled={working}>
                {working ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    Preparando…
                  </>
                ) : modal.type === "upload" ? (
                  "Importar ficha"
                ) : (
                  "Salvar"
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
