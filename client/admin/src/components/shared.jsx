import { useEffect } from "react";
import { Icon } from "./Icon.jsx";

/* ══════════════════════════════════
   SHARED primitives
   ══════════════════════════════════ */

export function Header({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div>
        <h1 style={{ fontFamily: "var(--heading)", fontWeight: 700, fontSize: 28, letterSpacing: "-0.03em", color: "var(--ink)" }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: "var(--ink-mute)", marginTop: 4 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ children, tone = "gray" }) {
  const colors = {
    gray: ["var(--border)", "var(--ink-soft)"],
    teal: ["rgba(0,168,150,.1)", "#00A896"],
    blue: ["rgba(0,119,182,.1)", "#0077B6"],
    gold: ["rgba(200,160,64,.12)", "#b8902e"],
    red: ["rgba(212,101,74,.12)", "#d4654a"],
  };
  const [bg, fg] = colors[tone];
  return <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 50, background: bg, color: fg, fontSize: 10, fontWeight: 600, letterSpacing: .5, textTransform: "uppercase", fontFamily: "var(--heading)" }}>{children}</span>;
}

export function Field({ label, value, onChange, placeholder, type = "text", textarea }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="field-label">{label}</label>
      {textarea
        ? <textarea className="field-input" value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ minHeight: 70, resize: "vertical" }} />
        : <input className="field-input" type={type} value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      }
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={wide ? { maxWidth: 760, width: "calc(100vw - 40px)" } : undefined}>
        <div className="modal-header">
          <h2 style={{ fontFamily: "var(--heading)", fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em" }}>{title}</h2>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={16}/></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
