import { useT } from "../../../i18n/index.jsx";

/* ──────────────────────────────────────────
   MOVE TASK SHEET (mobile) — escolhe coluna pra mover
   ────────────────────────────────────────── */

export function MoveTaskSheet({ task, columns, onClose, onMove }) {
  const { t } = useT();
  return (
    <div className="kb-sheet-bg" onClick={onClose}>
      <div className="kb-sheet" onClick={e => e.stopPropagation()}>
        <div className="kb-sheet-handle" />
        <div className="kb-sheet-title">{t("kb.move.title")}</div>
        <div className="kb-sheet-task-title">{task.title}</div>
        <div className="kb-sheet-options">
          {columns.map(c => (
            <button key={c.id} className={`kb-sheet-opt ${c.id === task.status ? "kb-sheet-opt--current" : ""}`} disabled={c.id === task.status} onClick={() => { onMove(c.id); onClose(); }}>
              <span className="kb-sheet-opt-dot" style={{ background: c.color }} />
              <span>{c.name}</span>
              {c.id === task.status && <span className="kb-sheet-opt-tag">{t("kb.common.current")}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
