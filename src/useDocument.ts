import { useState, useRef, useEffect, useCallback } from "react";
import type { Resource, Settings } from "../shared/types";
import { api } from "./api";
export const pending = new Map<string, () => Promise<boolean>>();
export const manualPending = new Set<string>();
export function useDocument(initial: Resource, settings: Settings, onSaved: (r: Resource) => void) {
  const [doc, setDoc] = useState(initial),
    [status, setStatus] = useState("Salvo"),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [recovery, setRecovery] = useState<any>(null);
  const ref = useRef(doc),
    revision = useRef(initial.revision),
    generation = useRef(0),
    savedGeneration = useRef(0),
    busy = useRef<Promise<boolean> | null>(null),
    undo = useRef<Resource[]>([]),
    redo = useRef<Resource[]>([]);
  const callback = useRef(onSaved);
  callback.current = onSaved;
  useEffect(() => {
    if (initial.revision > revision.current && generation.current === savedGeneration.current) {
      revision.current = initial.revision;
      ref.current = initial;
      setDoc(initial);
    }
  }, [initial.revision]);
  const key = `kcs-draft-${initial.id}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw);
        if (JSON.stringify(draft.data) !== JSON.stringify(initial.data) || draft.name !== initial.name) setRecovery(draft);
        else localStorage.removeItem(key);
      }
    } catch {}
  }, [key]);
  const mode = doc.data.mode && doc.data.mode !== "inherit" ? doc.data.mode : settings.mode;
  const change = useCallback(
    (next: Resource, history = true) => {
      if (history) {
        undo.current.push(structuredClone(ref.current));
        if (undo.current.length > 50) undo.current.shift();
        redo.current = [];
      }
      ref.current = next;
      generation.current++;
      setDoc(next);
      setDirty(true);
      setStatus("Alterações não salvas");
      setError("");
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        setError("Sem espaço para rascunho no navegador. Salve no servidor.");
      }
    },
    [key],
  );
  const save = useCallback(
    async (manual = false): Promise<boolean> => {
      if (busy.current) {
        await busy.current;
        if (generation.current === savedGeneration.current) return true;
      }
      if (generation.current === savedGeneration.current) return true;
      const at = generation.current,
        current = ref.current;
      setStatus("Salvando…");
      const run = (async () => {
        try {
          const saved = await api<Resource>(`/resources/${current.id}`, {
            method: "PUT",
            body: JSON.stringify({ ...current, revision: revision.current, saveMode: manual ? "manual" : "auto" }),
          });
          revision.current = saved.revision;
          savedGeneration.current = at;
          callback.current(saved);
          if (generation.current === at) {
            ref.current = saved;
            setDoc(saved);
            setDirty(false);
            setStatus(`Salvo às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
            localStorage.removeItem(key);
          } else setStatus("Alterações não salvas");
          setError("");
          return true;
        } catch (e: any) {
          setError(e.message);
          setStatus("Falha ao salvar");
          return false;
        } finally {
          busy.current = null;
        }
      })();
      busy.current = run;
      return run;
    },
    [key],
  );
  useEffect(() => {
    if (!dirty || mode !== "auto" || error) return;
    const timer = setTimeout(() => void save(), settings.delay * 1000);
    return () => clearTimeout(timer);
  }, [doc, dirty, mode, settings.delay, error, save]);
  useEffect(() => {
    if (!dirty) return;
    pending.set(initial.id, () => save(true));
    if (mode === "manual") manualPending.add(initial.id);
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      pending.delete(initial.id);
      manualPending.delete(initial.id);
      window.removeEventListener("beforeunload", leave);
    };
  }, [dirty, initial.id, save, mode]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save(true);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [save]);
  return {
    doc,
    dirty,
    status,
    error,
    recovery,
    mode,
    save,
    change,
    setData: (data: any) => change({ ...ref.current, data }),
    undo: () => {
      const previous = undo.current.pop();
      if (previous) {
        redo.current.push(ref.current);
        change(previous, false);
      }
    },
    redo: () => {
      const next = redo.current.pop();
      if (next) {
        undo.current.push(ref.current);
        change(next, false);
      }
    },
    recover: () => {
      change({ ...ref.current, data: recovery.data, name: recovery.name });
      setRecovery(null);
    },
    discardRecovery: () => {
      localStorage.removeItem(key);
      setRecovery(null);
    },
    resolveConflict: async () => {
      const all = await api<Resource[]>("/resources");
      const latest = all.find((r) => r.id === initial.id);
      if (latest) {
        revision.current = latest.revision;
        setError("");
        return save(true);
      }
      return false;
    },
  };
}
