import { useState, useEffect, useRef } from "react";
import { Icon } from "../../../components/Icon.jsx";
import { useT } from "../../../i18n/index.jsx";

export function KBSelect({ value, options, onChange, placeholder, renderOption }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find(o => o.id === value);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="kbs" ref={ref}>
      <button className="kbs-trigger" onClick={() => setOpen(!open)} type="button">
        <span className="kbs-value">{renderOption && selected ? renderOption(selected) : selected?.label || selected?.name || placeholder || t("kb.common.select")}</span>
        <Icon name="chevDown" size={12} />
      </button>
      {open && (
        <div className="kbs-menu">
          {placeholder && (
            <button className={`kbs-option ${!value ? "kbs-option--active" : ""}`} onClick={() => { onChange(""); setOpen(false); }}>
              <span style={{ color: "var(--ink-faint)" }}>{placeholder}</span>
            </button>
          )}
          {options.map(o => (
            <button key={o.id} className={`kbs-option ${value === o.id ? "kbs-option--active" : ""}`} onClick={() => { onChange(o.id); setOpen(false); }}>
              {renderOption ? renderOption(o) : (o.label || o.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
