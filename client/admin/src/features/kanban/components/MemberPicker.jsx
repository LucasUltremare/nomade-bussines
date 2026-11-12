import { useState, useEffect, useRef } from "react";
import { Icon } from "../../../components/Icon.jsx";
import { Avatar } from "../../../components/Avatar.jsx";
import { useAssignees, assigneeById } from "../../../lib/assignees.js";
import { useT } from "../../../i18n/index.jsx";

export function MemberPicker({ value, onChange }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { team, agents } = useAssignees();
  const selected = assigneeById(value, t);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="kbs" ref={ref}>
      <button className="kbs-trigger" onClick={() => setOpen(!open)} type="button">
        {selected ? <Avatar member={selected} size={18} showName /> : <span className="kbs-value" style={{ color: "var(--ink-ghost)" }}>{t("kb.member.none")}</span>}
        <Icon name="chevDown" size={12} />
      </button>
      {open && (
        <div className="kbs-menu">
          <button className={`kbs-option ${!value ? "kbs-option--active" : ""}`} onClick={() => { onChange(""); setOpen(false); }}>
            <span style={{ color: "var(--ink-faint)" }}>{t("kb.member.none")}</span>
          </button>
          {team.map(m => (
            <button key={m.id} className={`kbs-option ${value === m.id ? "kbs-option--active" : ""}`} onClick={() => { onChange(m.id); setOpen(false); }}>
              <Avatar member={m} size={18} showName />
            </button>
          ))}
          {agents.length > 0 && <div className="kbs-group-label">{t("kb.member.agents")}</div>}
          {agents.map(m => (
            <button key={m.id} className={`kbs-option ${value === m.id ? "kbs-option--active" : ""}`} onClick={() => { onChange(m.id); setOpen(false); }}>
              <Avatar member={m} size={18} showName />
              <span className="kbs-agent-tag">{t("kb.member.agent_tag")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
