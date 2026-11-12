import { useState } from "react";
import { Modal, Field } from "../../../components/shared.jsx";
import { useT } from "../../../i18n/index.jsx";

/* ──────────────────────────────────────────
   COLUMN EDIT MODAL
   ────────────────────────────────────────── */

export function ColumnEditModal({ col, onClose, onSave, onDelete }) {
  const { t } = useT();
  const [name, setName] = useState(col.name);
  const [color, setColor] = useState(col.color);
  const colors = ["#6b7280","#8b5cf6","#0077B6","#c8a040","#00A896","#d4654a","#dc2626","#059669","#2563eb","#7c3aed"];
  return (
    <Modal title={t("kb.colmodal.title")} onClose={onClose}>
      <Field label={t("kb.colmodal.name")} value={name} onChange={setName} />
      <div style={{ marginTop: 12 }}>
        <label className="field-label">{t("kb.colmodal.color")}</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {colors.map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: color === c ? "2.5px solid #051017" : "2.5px solid transparent", cursor: "pointer", transition: ".15s" }} />)}
        </div>
      </div>
      <div className="modal-actions" style={{ justifyContent: "space-between" }}>
        <button className="btn-ghost" style={{ color: "#dc2626", borderColor: "#dc262630" }} onClick={onDelete}>{t("kb.common.delete")}</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={onClose}>{t("kb.common.cancel")}</button>
          <button className="btn-primary" onClick={() => onSave({ name, color })} disabled={!name}>{t("kb.common.save")}</button>
        </div>
      </div>
    </Modal>
  );
}
