import { useState, useEffect, useRef } from "react";
import { Icon } from "../../../components/Icon.jsx";
import { useT, localeOf } from "../../../i18n/index.jsx";
import { semanaComeca } from "../../../lib/regional.js";

export function KBDatePicker({ value, onChange }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const today = new Date();
  const [viewDate, setViewDate] = useState(() => {
    if (value) { const d = new Date(value + "T12:00:00"); return { year: d.getFullYear(), month: d.getMonth() }; }
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const daysInMonth = new Date(viewDate.year, viewDate.month + 1, 0).getDate();
  const inicio = semanaComeca(); // 0 dom · 1 seg · 6 sáb (Ajustes → Região)
  const firstDay = (new Date(viewDate.year, viewDate.month, 1).getDay() - inicio + 7) % 7;
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  const monthNames = t("kb.date.months").split(",");
  const nomes = t("kb.date.days").split(",");
  const dayNames = nomes.map((_, i) => nomes[(i + inicio) % 7]);
  const prev = () => setViewDate(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const next = () => setViewDate(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });
  const select = (day) => {
    const m = String(viewDate.month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onChange(`${viewDate.year}-${m}-${d}`);
    setOpen(false);
  };
  const isSelected = (day) => { if (!value || !day) return false; return value === `${viewDate.year}-${String(viewDate.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`; };
  const isToday = (day) => day && day === today.getDate() && viewDate.month === today.getMonth() && viewDate.year === today.getFullYear();
  const displayValue = value ? new Date(value + "T12:00:00").toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short", year: "numeric" }) : null;
  return (
    <div className="kbdate" ref={ref}>
      <button className="kbs-trigger" onClick={() => setOpen(!open)} type="button">
        <span className="kbs-value" style={!displayValue ? { color: "var(--ink-ghost)" } : {}}>
          <Icon name="calendar" size={12} />
          {displayValue || t("kb.date.set")}
        </span>
        {value && <span className="kbdate-clear" onClick={e => { e.stopPropagation(); onChange(""); }}><Icon name="close" size={10} /></span>}
      </button>
      {open && (
        <div className="kbdate-calendar">
          <div className="kbdate-nav">
            <button onClick={prev} type="button"><Icon name="chevLeft" size={14} /></button>
            <span>{monthNames[viewDate.month]} {viewDate.year}</span>
            <button onClick={next} type="button"><Icon name="chevRight" size={14} /></button>
          </div>
          <div className="kbdate-days-header">{dayNames.map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="kbdate-grid">
            {days.map((day, i) => (
              <button key={i} type="button" disabled={!day}
                className={`kbdate-day ${!day ? "kbdate-day--empty" : ""} ${isSelected(day) ? "kbdate-day--sel" : ""} ${isToday(day) ? "kbdate-day--today" : ""}`}
                onClick={() => day && select(day)}>{day || ""}</button>
            ))}
          </div>
          <div className="kbdate-shortcuts">
            <button type="button" onClick={() => { const d = new Date(); setViewDate({ year: d.getFullYear(), month: d.getMonth() }); select(d.getDate()); }}>{t("kb.date.today")}</button>
            <button type="button" onClick={() => { const d = new Date(); d.setDate(d.getDate()+7); setViewDate({ year: d.getFullYear(), month: d.getMonth() }); select(d.getDate()); }}>+7d</button>
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}>{t("kb.common.clear")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
