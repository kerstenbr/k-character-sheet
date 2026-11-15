import type { ReactNode } from "react";
import { X, Save, AlertCircle, RotateCcw, RotateCw, Check, LoaderCircle } from "lucide-react";
import type { useDocument } from "./useDocument";
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}>
      <section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Fechar" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SaveBar({ editor }: { editor: ReturnType<typeof useDocument> }) {
  return (
    <>
      <div className="save-bar">
        <span className={`save-state ${editor.error ? "danger" : ""}`}>
          {editor.status === "Salvando…" ? <LoaderCircle size={14} className="spin" /> : editor.dirty ? <span className="dot amber" /> : <Check size={14} />}{" "}
          {editor.status}
        </span>
        <span className="divider" />
        <button className="icon" title="Desfazer" aria-label="Desfazer" onClick={editor.undo}>
          <RotateCcw size={16} />
        </button>
        <button className="icon" title="Refazer" aria-label="Refazer" onClick={editor.redo}>
          <RotateCw size={16} />
        </button>
        <button className="secondary small" onClick={() => void editor.save(true)}>
          <Save size={15} />
          Salvar
        </button>
      </div>
      {editor.error && (
        <div className="alert">
          <AlertCircle size={17} />
          <span>{editor.error}</span>
          <button onClick={() => void editor.save(true)}>Tentar novamente</button>
          {editor.error.includes("outra aba") && (
            <button
              onClick={() => {
                if (confirm("Substituir a versão do servidor por seu rascunho? A versão anterior ficará no histórico.")) void editor.resolveConflict();
              }}>
              Usar meu rascunho
            </button>
          )}
        </div>
      )}
      {editor.recovery && (
        <Modal title="Rascunho recuperado" onClose={editor.discardRecovery}>
          <p>Há alterações locais que ainda não foram salvas. Deseja recuperá-las?</p>
          <div className="modal-actions">
            <button className="secondary" onClick={editor.discardRecovery}>
              Descartar rascunho
            </button>
            <button className="primary" onClick={editor.recover}>
              Recuperar alterações
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
