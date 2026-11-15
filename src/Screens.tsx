import { useEffect, useState } from "react";
import { BookOpen, Plus, Search, History, RotateCcw, Trash2, Download, Upload, HardDrive, Sun, Moon, Monitor } from "lucide-react";
import type { Resource, Settings } from "../shared/types";
import { api, post, create, formatDate, download, bytes } from "./api";
import { Modal, Empty, SaveBar } from "./components";
import { useDocument, pending } from "./useDocument";
export function Journal({
  parent,
  resources,
  settings,
  onSaved,
  refresh,
}: {
  parent: Resource;
  resources: Resource[];
  settings: Settings;
  onSaved: (r: Resource) => void;
  refresh: () => Promise<void>;
}) {
  const [search, setSearch] = useState(""),
    [editing, setEditing] = useState<Resource | null>(null),
    [error, setError] = useState("");
  const entries = resources
    .filter((r) => !r.deleted && r.kind === "entry" && (parent.kind === "folder" ? r.parentId === parent.id : r.data.sheetIds?.includes(parent.id)))
    .filter((r) => `${r.name} ${r.data.text}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.data.date.localeCompare(a.data.date));
  async function add() {
    try {
      const e = await create("entry", "Nova sessão", parent.kind === "folder" ? parent.id : parent.parentId, {
        date: new Date().toLocaleDateString("en-CA"),
        number: "",
        text: "",
        sheetIds: parent.kind === "sheet" ? [parent.id] : [],
      });
      await refresh();
      setEditing(e);
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <div className="journal">
      <div className="section-toolbar">
        <div className="search">
          <Search size={17} />
          <input placeholder="Buscar no diário…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="primary" onClick={add}>
          <Plus size={17} />
          Registrar sessão
        </button>
      </div>
      {error && <div className="alert">{error}</div>}
      {!entries.length ? (
        <Empty icon={<BookOpen size={30} />} title="Nenhuma sessão registrada">
          Adicione anotações ao diário usando o botão Registrar sessão.
        </Empty>
      ) : (
        <div className="journal-list">
          {entries.map((e) => (
            <button className="journal-card" key={e.id} onClick={() => setEditing(e)}>
              <div className="entry-date">
                <BookOpen size={20} />
                <span>{e.data.date}</span>
              </div>
              <div>
                <div className="eyebrow">{e.data.number ? `SESSÃO ${e.data.number}` : "REGISTRO DE CAMPANHA"}</div>
                <h3>{e.name}</h3>
                <p>{e.data.text.slice(0, 220) || "Ainda sem anotações."}</p>
                <div className="tags">
                  {e.data.sheetIds.map((id: string) => (
                    <span key={id}>{resources.find((r) => r.id === id)?.name || "Personagem removido"}</span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {editing && (
        <EntryModal resource={editing} resources={resources} settings={settings} onSaved={onSaved} onClose={() => setEditing(null)} refresh={refresh} />
      )}
    </div>
  );
}
function EntryModal({
  resource,
  resources,
  settings,
  onSaved,
  onClose,
  refresh,
}: {
  resource: Resource;
  resources: Resource[];
  settings: Settings;
  onSaved: (r: Resource) => void;
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const ed = useDocument(resource, settings, onSaved),
    d = ed.doc.data;
  return (
    <Modal
      title="Diário de sessão"
      wide
      onClose={() => {
        if (!ed.dirty) onClose();
        else if (confirm("Salvar as alterações antes de fechar?"))
          void ed.save(true).then((ok) => {
            if (ok) onClose();
          });
      }}>
      <SaveBar editor={ed} />
      <label>
        Título
        <input value={ed.doc.name} onChange={(e) => ed.change({ ...ed.doc, name: e.target.value })} />
      </label>
      <div className="form-row">
        <label>
          Data
          <input type="date" value={d.date} onChange={(e) => ed.setData({ ...d, date: e.target.value })} />
        </label>
        <label>
          Número da sessão
          <input value={d.number} onChange={(e) => ed.setData({ ...d, number: e.target.value })} />
        </label>
      </div>
      <label>
        O que aconteceu?
        <textarea
          className="journal-text"
          placeholder="Encontros, descobertas, escolhas…"
          value={d.text}
          onChange={(e) => ed.setData({ ...d, text: e.target.value })}
        />
      </label>
      <label>Personagens envolvidos</label>
      <div className="check-list">
        {resources
          .filter((r) => r.kind === "sheet" && !r.deleted && r.parentId === resource.parentId)
          .map((r) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={d.sheetIds.includes(r.id)}
                onChange={(e) => ed.setData({ ...d, sheetIds: e.target.checked ? [...d.sheetIds, r.id] : d.sheetIds.filter((id: string) => id !== r.id) })}
              />
              {r.name}
            </label>
          ))}
      </div>
      <div className="modal-actions">
        <button
          className="danger-button"
          onClick={async () => {
            if (confirm("Mover este registro para a lixeira?")) {
              await post(`/resources/${resource.id}/trash`);
              pending.delete(resource.id);
              localStorage.removeItem(`kcs-draft-${resource.id}`);
              await refresh();
              onClose();
            }
          }}>
          <Trash2 size={15} />
          Excluir registro
        </button>
        <button
          className="primary"
          onClick={async () => {
            if (await ed.save(true)) onClose();
          }}>
          Salvar e fechar
        </button>
      </div>
    </Modal>
  );
}
export function HistoryPanel({ resource, resources, onSaved }: { resource: Resource; resources: Resource[]; onSaved: (r: Resource) => void }) {
  const [target, setTarget] = useState(resource.id),
    [versions, setVersions] = useState<any[]>([]),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState("");
  const related = [resource, ...resources.filter((r) => r.kind === "board" && r.parentId === resource.id && !r.deleted)];
  const load = () =>
    api<any[]>(`/resources/${target}/versions`)
      .then(setVersions)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [target]);
  return (
    <div className="history-panel">
      <div className="section-toolbar">
        <div>
          <h2>Pontos de recuperação</h2>
          <p className="muted">Até 10 versões por ficha ou quadro. As mais antigas são removidas automaticamente.</p>
        </div>
        <select aria-label="Histórico de" value={target} onChange={(e) => setTarget(e.target.value)}>
          {related.map((r) => (
            <option key={r.id} value={r.id}>
              {r.kind === "board" ? "Quadro de notas" : r.name}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="alert">{error}</div>}
      {!versions.length ? (
        <Empty icon={<History size={30} />} title="Nenhuma versão salva">
          Os pontos de recuperação aparecem conforme você salva alterações.
        </Empty>
      ) : (
        <div className="version-list">
          {versions.map((v, i) => (
            <div className="version-row" key={v.id}>
              <div className="version-icon">
                <History size={19} />
              </div>
              <div>
                <b>{formatDate(v.created)}</b>
                <p>
                  {v.mode === "manual" ? "Salvamento manual" : "Ponto automático"} · {i === 0 ? "Mais recente" : `Versão anterior ${i}`}
                </p>
              </div>
              <button className="secondary small" onClick={() => setPreview(v)}>
                Inspecionar
              </button>
            </div>
          ))}
        </div>
      )}
      {preview && (
        <Modal title="Inspecionar versão" wide onClose={() => setPreview(null)}>
          <p className="muted">
            {formatDate(preview.created)} · {preview.snapshot.name}
          </p>
          <div className="snapshot-preview">
            {preview.snapshot.kind === "board"
              ? preview.snapshot.data.items.map((i: any) => (
                  <div key={i.id}>
                    <b>{i.type === "image" ? "Imagem" : "Nota"}</b>
                    {i.assetId && <img src={`/api/assets/${i.assetId}`} alt={i.text} />}
                    <p>{i.text || "Sem texto"}</p>
                  </div>
                ))
              : preview.snapshot.data.fields?.map((f: any) => (
                  <div key={f.id}>
                    <b>{f.label}</b>
                    {f.type === "image" && f.assetId ? (
                      <img src={`/api/assets/${f.assetId}`} alt={f.label} />
                    ) : (
                      <span>{typeof f.value === "boolean" ? (f.value ? "Marcado" : "Desmarcado") : f.value || "Vazio"}</span>
                    )}
                  </div>
                ))}
          </div>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setPreview(null)}>
              Fechar
            </button>
            <button
              className="primary"
              onClick={async () => {
                try {
                  const current = resources.find((r) => r.id === target)!;
                  const restored = await post<Resource>(`/resources/${target}/versions/${preview.id}/restore`, { revision: current.revision });
                  onSaved(restored);
                  setPreview(null);
                  await load();
                } catch (e: any) {
                  setError(e.message);
                }
              }}>
              <RotateCcw size={16} />
              Restaurar esta versão
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function SettingsPanel({ resource, onSaved, refresh }: { resource: Resource; onSaved: (r: Resource) => void; refresh: () => Promise<void> }) {
  const [data, setData] = useState<Settings>(resource.data),
    [storage, setStorage] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/storage")
      .then(setStorage)
      .catch(() => {});
  }, []);
  const save = async () => {
    try {
      const saved = await api<Resource>(`/resources/${resource.id}`, { method: "PUT", body: JSON.stringify({ ...resource, data }) });
      onSaved(saved);
      setMessage("Preferências salvas.");
    } catch (e: any) {
      setMessage(e.message);
    }
  };
  return (
    <div className="settings-page">
      <section className="settings-card">
        <h2>Aparência</h2>
        <p>Escolha o tema da interface.</p>
        <div className="theme-options">
          {(
            [
              { id: "dark", name: "Escuro", icon: Moon },
              { id: "light", name: "Claro", icon: Sun },
              { id: "system", name: "Sistema", icon: Monitor },
            ] as const
          ).map((t) => (
            <button key={t.id} className={data.theme === t.id ? "selected" : ""} onClick={() => setData({ ...data, theme: t.id })}>
              <t.icon size={24} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-card">
        <h2>Salvamento</h2>
        <p>Preferência padrão para fichas, quadros e diário.</p>
        <div className="form-row">
          <label>
            Modo
            <select value={data.mode} onChange={(e) => setData({ ...data, mode: e.target.value as Settings["mode"] })}>
              <option value="auto">Automático</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <label>
            Pausa antes de salvar (segundos)
            <input type="number" min={1} max={60} value={data.delay} onChange={(e) => setData({ ...data, delay: Number(e.target.value) })} />
          </label>
        </div>
        <button className="primary" onClick={save}>
          Salvar preferências
        </button>
        {message && <p role="status">{message}</p>}
      </section>
      <section className="settings-card">
        <h2>
          <HardDrive size={20} /> Armazenamento e backup
        </h2>
        <p>{storage ? `${bytes(storage.bytes)} utilizados · ${storage.trash} registros na lixeira` : "Consultando armazenamento…"}</p>
        <p>
          São mantidas até 10 versões por recurso. PDFs e imagens são reutilizados pelo histórico, sem duplicar os arquivos a cada salvamento. A lixeira mantém
          os dados até você esvaziá-la.
        </p>
        <div className="form-row">
          <button className="secondary" onClick={() => download("/backup")}>
            <Download size={16} />
            Exportar biblioteca
          </button>
          <label className="secondary file-button">
            <Upload size={16} />
            {busy ? "Restaurando…" : "Restaurar backup"}
            <input
              hidden
              disabled={busy}
              type="file"
              accept=".zip"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                try {
                  const form = new FormData();
                  form.append("file", f);
                  const r = await api("/backup/import", { method: "POST", body: form });
                  await refresh();
                  setMessage(`${r.count} registros restaurados como cópias independentes.`);
                } catch (e: any) {
                  setMessage(e.message);
                } finally {
                  setBusy(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
