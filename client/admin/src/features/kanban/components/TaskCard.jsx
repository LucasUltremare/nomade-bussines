import { useRef, useState } from "react";
import { Icon } from "../../../components/Icon.jsx";
import { Avatar } from "../../../components/Avatar.jsx";
import { TEAM } from "../../../lib/team.js";
import { assigneeById } from "../../../lib/assignees.js";
import { PRIORITIES, LABEL_COLORS } from "../constants.js";
import { api } from "../../../api/client.js";
import { useT, localeOf } from "../../../i18n/index.jsx";

/* ──────────────────────────────────────────
   CARD — cor por urgência (borda esquerda) + preview de subtasks
   ────────────────────────────────────────── */

export function TaskCard({ task, semPastaRunner, viewers, onOpen, onDelete, onDragStart, onDragEnd, onDrop, onMoveRequest, selecionada, onToggleSel, modoSel, onChanged }) {
  const { t, lang } = useT();
  const priorityId = task.priority || "medium";
  const pri = PRIORITIES.find(p => p.id === priorityId);
  const assignee = assigneeById(task.assignee, t);
  const ehDeAgent = String(task.assignee || "").startsWith("agent:");
  const [pedindo, setPedindo] = useState(false);

  /* "rodando" que não termina: o runner só devolve a task nos guards de
     entrada — run que estoura no meio (timeout de rede, p.ex.) deixa o lock
     preso e o card fica "rodando" até os 20 min vencerem. Dizer desde quando é
     a diferença entre "está trabalhando" e "morreu e ninguém viu". */
  const LOCK_MIN = 20;
  const minRodando = task.workerLock
    ? Math.floor((Date.now() - new Date(task.workerLock).getTime()) / 60000)
    : null;
  const lockVencido = minRodando !== null && minRodando >= LOCK_MIN;

  /* O play não dispara nada aqui: marca o pedido no serviço e o runner pega
     no ciclo dele. A web nunca fala com a máquina — ela é quem liga pra cá. */
  const pedirExecucao = async () => {
    /* Sem pasta no board, o runner pega e devolve sem deixar rastro no admin.
       Pedir assim é pedir nada — mas quem decide é o sócio, não o botão. */
    if (!task.pedidoEm && semPastaRunner && !window.confirm(t("kb.card.confirm_no_folder"))) return;
    setPedindo(true);
    try {
      await fetch(`/api/office/tarefas-agent/${task._id}/rodar`, {
        method: task.pedidoEm ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}` },
      });
      onChanged?.();
    } finally {
      setPedindo(false);
    }
  };
  const creator = TEAM.find(m => m.name === task.createdByName || m.id === task.createdBy);

  const subtasks = task.subtasks || [];
  const stDone = subtasks.filter(s => s.done).length;
  const stTotal = subtasks.length;
  const cmCount = (task.comments || []).length;
  const atCount = (task.attachments || []).length;

  // long-press mobile → menu de mover
  const pressTimer = useRef(null);
  const moved = useRef(false);
  const handleTouchStart = () => {
    moved.current = false;
    pressTimer.current = setTimeout(() => {
      if (!moved.current && onMoveRequest) {
        if (navigator.vibrate) navigator.vibrate(40);
        onMoveRequest(task);
      }
    }, 500);
  };
  const handleTouchMove = () => { moved.current = true; clearTimeout(pressTimer.current); };
  const handleTouchEnd = () => clearTimeout(pressTimer.current);

  const MAX_PREVIEW = 3;
  const previewSubs = subtasks.slice(0, MAX_PREVIEW);
  const remainingSubs = subtasks.length - MAX_PREVIEW;

  return (
    <div
      className={`kb-card kb-card--${priorityId} ${task.status === "done" ? "kb-card--done" : ""} ${task.archived ? "kb-card--archived" : ""} ${viewers.length > 0 ? "kb-card--being-viewed" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={onDrop}
      onClick={(e) => {
        /* ctrl/cmd/shift marca sem abrir; em modo selecao, clique simples
           marca — e assim que se limpa varias sem abrir uma por uma */
        if (e.metaKey || e.ctrlKey || e.shiftKey || modoSel) { e.preventDefault(); onToggleSel && onToggleSel(task._id); return; }
        onOpen();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {onToggleSel && (
        <span
          className={selecionada ? 'kb-card-sel on' : 'kb-card-sel'}
          role="checkbox"
          aria-checked={!!selecionada}
          title={t("kb.card.select_title")}
          onClick={(e) => { e.stopPropagation(); onToggleSel(task._id); }}
        />
      )}
      {onDelete && (
        <button
          className="kb-card-del"
          title={t("kb.card.delete")}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          onDragStart={(e) => e.preventDefault()}
        >
          <Icon name="trash" size={12} />
        </button>
      )}

      {viewers.length > 0 && (
        <div className="kb-card-viewers" title={t(viewers.length === 1 ? "kb.card.viewing1" : "kb.card.viewingN", { names: viewers.map(v => v.name).join(", ") })}>
          <Icon name="eye" size={10} />
          <div className="kb-card-viewers-avs">
            {viewers.slice(0, 3).map(v => <Avatar key={v.id} member={v} size={14} />)}
          </div>
        </div>
      )}

      {task.labels?.length > 0 && (
        <div className="kb-card-labels">
          {task.labels.map(l => {
            const lc = LABEL_COLORS.find(c => c.id === l) || LABEL_COLORS[7];
            return <span key={l} className="kb-label" style={{ background: lc.bg, color: lc.fg }}>{l}</span>;
          })}
        </div>
      )}

      <div className="kb-card-title">{task.title}</div>
      {task.description && <div className="kb-card-desc">{task.description.slice(0, 80)}{task.description.length > 80 ? "…" : ""}</div>}

      {stTotal > 0 && (
        <div className="kb-card-subtasks">
          {previewSubs.map(s => (
            <div key={s.id} className={`kb-card-subtask ${s.done ? "kb-card-subtask--done" : ""}`}>
              <span className="kb-card-subtask-box">
                {s.done && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>}
              </span>
              <span className="kb-card-subtask-title">{s.title}</span>
            </div>
          ))}
          {remainingSubs > 0 && <div className="kb-card-subtask-more">{t("kb.card.more", { n: remainingSubs })}</div>}
        </div>
      )}

      <div className="kb-card-meta">
        <div className="kb-card-meta-left">
          {pri && pri.id !== "medium" && <span className="kb-card-priority" style={{ color: pri.color }}>{pri.icon}</span>}
          {task.dueDate && (
            <span className="kb-card-due" style={{ color: new Date(task.dueDate) < new Date() ? "var(--red)" : "var(--ink-mute)" }}>
              <Icon name="calendar" size={10} />
              {new Date(task.dueDate).toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short" })}
            </span>
          )}
          {stTotal > 0 && <span className="kb-card-badge">{stDone}/{stTotal}</span>}
          {cmCount > 0 && <span className="kb-card-badge"><Icon name="comment" size={9} /> {cmCount}</span>}
          {atCount > 0 && <span className="kb-card-badge"><Icon name="clip" size={9} /> {atCount}</span>}
          {/* task de agent: dar play PEDE execução — quem roda é a máquina
              que tem o clone. Estado vem do próprio card, sem fetch extra. */}
          {ehDeAgent && (
            <button
              className={`kb-card-play${task.workerMaquina ? " rodando" : task.pedidoEm ? " pedida" : ""}`}
              disabled={pedindo}
              title={
                task.workerMaquina
                  ? (lockVencido
                      ? t("kb.card.stuck_title", { machine: task.workerMaquina, n: minRodando })
                      : t("kb.card.running_title", { machine: task.workerMaquina, since: minRodando !== null ? t("kb.card.since", { n: minRodando }) : "" }))
                  : task.pedidoEm ? t("kb.card.queued_title")
                  : semPastaRunner
                    ? t("kb.card.no_folder_title")
                    : t("kb.card.run_title")
              }
              onClick={(e) => { e.stopPropagation(); pedirExecucao(); }}
            >
              <Icon name="play" size={9} />
              {task.workerMaquina
                ? (lockVencido ? t("kb.card.stuck", { n: minRodando }) : t("kb.card.running"))
                : task.pedidoEm ? t("kb.card.queued") : t("kb.card.run")}
            </button>
          )}
        </div>
        <div className="kb-card-avatars">
          {assignee && <Avatar member={assignee} size={22} />}
          {creator && (!assignee || creator.id !== assignee.id) && <Avatar member={creator} size={17} muted />}
        </div>
      </div>
    </div>
  );
}