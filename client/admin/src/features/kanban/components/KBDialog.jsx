import { useState, useEffect, useRef } from "react";
import { useT } from "../../../i18n/index.jsx";

export function KBDialog({ config, onClose }) {
  const { t } = useT();
  const [inputVal, setInputVal] = useState(config.defaultValue || "");
  const inputRef = useRef(null);
  useEffect(() => { if (config.type === "prompt" && inputRef.current) inputRef.current.focus(); }, []);
  const submit = () => {
    if (config.type === "prompt") { if (inputVal.trim()) { config.onConfirm(inputVal.trim()); onClose(); } }
    else { config.onConfirm(); onClose(); }
  };
  return (
    <div className="kb-dialog-backdrop" onClick={onClose}>
      <div className="kb-dialog" onClick={e => e.stopPropagation()}>
        <div className="kb-dialog-title">{config.title}</div>
        {config.message && <div className="kb-dialog-msg">{config.message}</div>}
        {config.type === "prompt" && (
          <input ref={inputRef} className="kb-dialog-input" placeholder={config.placeholder || ""} value={inputVal}
            onChange={e => setInputVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }} />
        )}
        <div className="kb-dialog-actions">
          <button className="kb-dialog-cancel" onClick={onClose}>{t("kb.common.cancel")}</button>
          <button className={`kb-dialog-ok ${config.danger ? "kb-dialog-ok--danger" : ""}`} onClick={submit} disabled={config.type === "prompt" && !inputVal.trim()}>
            {config.confirmLabel || t("kb.common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
