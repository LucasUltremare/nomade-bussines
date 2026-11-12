import { Icon } from "../../../components/Icon.jsx";
import { Avatar } from "../../../components/Avatar.jsx";
import { TEAM } from "../../../lib/team.js";
import { assigneeById } from "../../../lib/assignees.js";
import { useT, localeOf } from "../../../i18n/index.jsx";
import { PRIORITIES } from "../constants.js";

/* ──────────────────────────────────────────
   LIST VIEW
   ────────────────────────────────────────── */

export function ListView({ tasks, columns, onOpenTask, onDeleteTask }) {
  const { t, lang } = useT();
  const sorted = [...tasks].sort((a,b) => {
    const ca = columns.findIndex(c => c.id === a.status), cb = columns.findIndex(c => c.id === b.status);
    return ca !== cb ? ca - cb : (a.position||0) - (b.position||0);
  });
  return (
    <div className="kb-list">
      <div className="kb-list-header">
        <span style={{ flex: 2 }}>{t("kb.list.task")}</span>
        <span style={{ width: 100 }}>{t("kb.list.status")}</span>
        <span style={{ width: 90 }}>{t("kb.list.priority")}</span>
        <span style={{ width: 100 }}>{t("kb.list.assignee")}</span>
        <span style={{ width: 100 }}>{t("kb.list.created_by")}</span>
        <span style={{ width: 90 }}>{t("kb.list.due")}</span>
        <span style={{ width: 40 }}></span>
      </div>
      {sorted.map(task => {
        const col = columns.find(c => c.id === task.status);
        const pri = PRIORITIES.find(p => p.id === task.priority);
        const assignee = assigneeById(task.assignee, t);
        const creator = TEAM.find(m => m.name === task.createdByName || m.id === task.createdBy);
        return (
          <div key={task._id} className="kb-list-row" onClick={() => onOpenTask(task)}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <div className="kb-list-title">{task.title}</div>
              {task.description && <div className="kb-list-desc">{task.description.slice(0,60)}</div>}
            </div>
            <div style={{ width: 100 }}><span className="kb-list-status" style={{ color: col?.color, borderColor: `${col?.color||"#6b7280"}30` }}>{col?.name||task.status}</span></div>
            <div style={{ width: 90 }}>{pri && <span style={{ color: pri.color, fontSize: 11, fontWeight: 600 }}>{pri.icon} {t(pri.labelKey)}</span>}</div>
            <div style={{ width: 100 }}>{assignee && <Avatar member={assignee} size={18} showName />}</div>
            <div style={{ width: 100 }}>{creator && <Avatar member={creator} size={18} showName muted />}</div>
            <div style={{ width: 90, fontSize: 11, color: "var(--ink-mute)" }}>{task.dueDate ? new Date(task.dueDate).toLocaleDateString(localeOf(lang),{ day:"2-digit", month:"short" }) : "—"}</div>
            <div style={{ width: 40 }}><button className="icon-btn" onClick={e => { e.stopPropagation(); onDeleteTask(task._id); }}><Icon name="trash" size={13} /></button></div>
          </div>
        );
      })}
      {sorted.length === 0 && <div className="empty-card" style={{ margin: 16 }}>{t("kb.list.empty")}</div>}
    </div>
  );
}
