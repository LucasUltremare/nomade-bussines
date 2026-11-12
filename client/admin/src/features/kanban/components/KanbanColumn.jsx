import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../../components/Icon.jsx";
import { Avatar } from "../../../components/Avatar.jsx";
import { useAssignees } from "../../../lib/assignees.js";
import { useFloating } from "../../../hooks/useFloating.js";
import { useT } from "../../../i18n/index.jsx";
import { TaskCard } from "./TaskCard.jsx";

/* ──────────────────────────────────────────
   COLUMN
   ────────────────────────────────────────── */

export function KanbanColumn({ sel, onToggleSel, modoSel, col, tasks, semPastaRunner, viewersByTask, creating, onStartCreate, onCancelCreate, onCreateTask, onOpenTask, onDeleteTask, onDragStart, onDragEnd, onDragOver, onDrop, dragState, onEditCol, onDeleteCol, onMoveRequest, onChanged, onColDragStart, onColDragEnd, onColDragOver, onColDrop, colDragging, colDropTarget }) {
  const { t } = useT();
  const { all: ASSIGNEES } = useAssignees();
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const colMenu = useFloating({ align: "right" });
  const submit = () => { if (newTitle.trim()) { onCreateTask(newTitle, newAssignee); setNewTitle(""); setNewAssignee(""); } };
  const cancel = () => { onCancelCreate(); setNewTitle(""); setNewAssignee(""); };

  return (
    <div
      className={`kb-col ${dragState ? "kb-col--drop-target" : ""} ${colDragging === col.id ? "kb-col--dragging" : ""} ${colDropTarget === col.id ? "kb-col--drop-col" : ""}`}
      onDragOver={(e) => { onDragOver(e); if (onColDragOver) onColDragOver(e, col.id); }}
      onDrop={(e) => {
        const isCol = e.dataTransfer.types.includes("application/x-kb-col");
        if (isCol && onColDrop) { onColDrop(e, col.id); return; }
        onDrop(e, tasks.length);
      }}
    >
      <div
        className="kb-col-header"
        draggable={!!onColDragStart}
        onDragStart={e => onColDragStart && onColDragStart(e, col)}
        onDragEnd={e => onColDragEnd && onColDragEnd(e)}
      >
        <div className="kb-col-header-left">
          <div className="kb-col-dot" style={{ background: col.color }} />
          <span className="kb-col-name">{col.name}</span>
          <span className="kb-col-count">{tasks.length}</span>
        </div>
        <div className="kb-col-header-right">
          <button className="kb-col-action" onClick={onStartCreate}><Icon name="plus" size={14} /></button>
          <div style={{ position: "relative" }}>
            <button ref={colMenu.anchorRef} className="kb-col-action" onClick={colMenu.toggle}><Icon name="more" size={14} /></button>
            {colMenu.isOpen && createPortal(
              <div ref={colMenu.floatingRef} className="kb-dropdown kb-dropdown--portal" style={{ top: colMenu.pos.top, right: colMenu.pos.right, minWidth: 150 }}>
                <button onClick={() => { onEditCol(); colMenu.close(); }}>{t("kb.col.edit")}</button>
                <button className="danger" onClick={() => { onDeleteCol(); colMenu.close(); }}>{t("kb.col.delete")}</button>
              </div>,
              document.body
            )}
          </div>
        </div>
      </div>
      <div className="kb-col-body">
        {tasks.map((task, idx) => (
          <TaskCard
            key={task._id}
            task={task}
            semPastaRunner={semPastaRunner}
            viewers={viewersByTask[task._id] || []}
            onOpen={() => onOpenTask(task)}
            onDelete={onDeleteTask ? () => onDeleteTask(task._id) : undefined}
            onDragStart={e => onDragStart(e, task)}
            onDragEnd={onDragEnd}
            onDrop={e => { e.stopPropagation(); onDrop(e, idx); }}
            onMoveRequest={onMoveRequest}
            onChanged={onChanged}
            selecionada={sel ? sel.has(task._id) : false}
            onToggleSel={onToggleSel}
            modoSel={modoSel}
          />
        ))}

        {creating ? (
          <div className="kb-inline-create">
            <input autoFocus placeholder={t("kb.col.new_title")} value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") cancel(); }} />
            <div className="kb-inline-assign">
              <span className="kb-inline-assign-label">{t("kb.col.assign")}</span>
              <div className="kb-inline-assign-opts">
                {ASSIGNEES.map(m => (
                  <button key={m.id} className={`kb-assign-chip ${newAssignee === m.id ? "kb-assign-chip--active" : ""}`} onClick={() => setNewAssignee(newAssignee === m.id ? "" : m.id)} style={{ "--c": m.color }}>
                    <Avatar member={m} size={16} />
                    <span>{m.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="kb-inline-actions">
              <button className="kb-btn-create" onClick={submit} disabled={!newTitle.trim()}>{t("kb.col.create_task")}</button>
              <button className="kb-btn-cancel" onClick={cancel}><Icon name="close" size={14} /></button>
            </div>
          </div>
        ) : <button className="kb-add-card" onClick={onStartCreate}><Icon name="plus" size={13} /> {t("kb.common.add")}</button>}
      </div>
    </div>
  );
}