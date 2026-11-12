import { useState, useEffect, useCallback } from "react";
import { Modal, Field } from "../../../components/shared.jsx";
import { api } from "../../../api/client.js";
import { useT } from "../../../i18n/index.jsx";

/* ──────────────────────────────────────────
   TEMPLATE MODAL — criar board (nome + template) ou trocar o
   template de um board existente. Preview mostra as colunas
   numeradas, na ordem, com a cor de cada uma.
   ────────────────────────────────────────── */

export function TemplateModal({ mode, board, onClose, onConfirm }) {
  const { t } = useT();
  const criar = mode === "create";
  // Boards de antes dos templates nasceram com o layout padrão
  const tplAtual = criar ? null : (board?.template || "padrao");
  const [templates, setTemplates] = useState(null); // null=carregando | "erro" | []
  const [sel, setSel] = useState(criar ? "padrao" : tplAtual);
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(() => {
    setTemplates(null);
    api.get("/api/admin/kanban-templates").then(setTemplates).catch(() => setTemplates("erro"));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = Array.isArray(templates) ? templates : [];
  const mesmoTemplate = !criar && sel === tplAtual;
  const pronto = criar ? nome.trim() && sel : sel && !mesmoTemplate;

  // Colunas do board que NÃO existem no template escolhido (custom ou de outro
  // template) — serão removidas; as tasks delas vão pra primeira coluna.
  const tplSel = lista.find(x => x.id === sel);
  const colunasPerdidas = (!criar && tplSel && board?.columns)
    ? board.columns.filter(c => !tplSel.columns.some(tc => tc.id === c.id)).map(c => c.name)
    : [];

  const confirmar = async () => {
    if (!pronto || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await onConfirm(criar ? { name: nome.trim(), template: sel } : { template: sel });
    } catch {
      setErro(criar ? t("kb.tpl.err_create") : t("kb.tpl.err_switch"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={criar ? t("kb.tpl.new_board") : t("kb.tpl.switch")} onClose={onClose} wide>
      {criar && (
        <Field label={t("kb.tpl.board_name")} value={nome} onChange={setNome} placeholder={t("kb.tpl.board_name_ph")} />
      )}

      <label className="field-label">{t("kb.tpl.template")}</label>
      {templates === null ? (
        <div style={{ padding: 24, color: "var(--ink-mute)", fontSize: 13 }}>{t("kb.tpl.loading")}</div>
      ) : templates === "erro" ? (
        <div style={{ padding: 20, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--ink-mute)", marginBottom: 10 }}>{t("kb.tpl.load_err")}</div>
          <button className="btn-ghost" onClick={carregar}>{t("kb.tpl.retry")}</button>
        </div>
      ) : (
        <div className="kb-tpl-list">
          {lista.map(tpl => {
            const atual = !criar && tplAtual === tpl.id;
            return (
              <button
                key={tpl.id}
                className={`kb-tpl-card ${sel === tpl.id ? "kb-tpl-card--sel" : ""}`}
                onClick={() => setSel(tpl.id)}
              >
                <div className="kb-tpl-head">
                  <span className="kb-tpl-name">{tpl.name}</span>
                  {atual && <span className="kb-tpl-atual">{t("kb.common.current")}</span>}
                </div>
                <div className="kb-tpl-desc">{tpl.description}</div>
                <div className="kb-tpl-cols">
                  {tpl.columns.map((c, i) => (
                    <span key={c.id} className="kb-tpl-chip">
                      <i style={{ background: c.color }}>{i + 1}</i>
                      {c.name}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!criar && sel && !mesmoTemplate && (
        <div className="kb-tpl-aviso">
          {colunasPerdidas.length > 0 && (
            <>{t("kb.tpl.lost_before")} <strong>{colunasPerdidas.join(", ")}</strong> {t("kb.tpl.lost_after")} </>
          )}
          {t("kb.tpl.moved_before")} <strong>{t("kb.tpl.first_col")}</strong>{t("kb.tpl.moved_after")}
        </div>
      )}

      {erro && <div className="kb-tpl-aviso" style={{ borderColor: "rgba(220,38,38,.4)", background: "rgba(220,38,38,.08)" }}>{erro}</div>}

      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>{t("kb.common.cancel")}</button>
        <button className="btn-primary" onClick={confirmar} disabled={!pronto || busy}>
          {busy ? t("kb.tpl.applying") : criar ? t("kb.tpl.create_board") : t("kb.tpl.switch")}
        </button>
      </div>
    </Modal>
  );
}
