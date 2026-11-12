import { useState, useEffect } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { Button, Badge, Input, Switch, Empty, Modal, PageHeader, Card, Note, useToast } from "../../components/ui.jsx";
import { useT, localeOf } from "../../i18n/index.jsx";

/* ══════════════════════════════════════════════════════════════
   MEMBROS — quem entra no crew além dos sócios, e o que vê.

   Sócio = ADMIN_EMAILS do deploy (acesso total, não se edita aqui).
   Membro = cadastrado aqui, com uma lista de módulos. A pessoa
   entra com a conta Google desse email. Tudo é checado no
   servidor a cada request: desativar ou remover corta na hora.
   ══════════════════════════════════════════════════════════════ */

// rótulos e descrições são chaves i18n; o id é o que vai pro servidor
const MODULOS = [
  { id: "kanban", label: "mb.mod.kanban", desc: "mb.mod.kanban_desc" },
  { id: "clients", label: "mb.mod.clients", desc: "mb.mod.clients_desc" },
  { id: "propostas", label: "mb.mod.propostas", desc: "mb.mod.propostas_desc" },
  { id: "leads", label: "mb.mod.leads", desc: "mb.mod.leads_desc" },
  { id: "projetos", label: "mb.mod.projetos", desc: "mb.mod.projetos_desc" },
];
const modLabel = (t, id) => { const m = MODULOS.find((x) => x.id === id); return m ? t(m.label) : id; };

// Presets: um clique monta o perfil. "Leader" = quem caça lead.
const PRESETS = [
  { id: "leader", label: "Leader", perms: ["kanban", "clients", "propostas"], propostasSoProprias: true },
];

const ERROS = {
  email_invalido: "mb.err.email_invalid",
  ja_e_socio: "mb.err.already_partner",
  ja_existe: "mb.err.already_exists",
};
const erroDe = (t, e) => {
  try { const k = ERROS[JSON.parse(e.message).error]; return k ? t(k) : t("mb.err.save_failed"); } catch { return t("mb.err.save_failed"); }
};
const quando = (d, t, lang) => (d ? new Date(d).toLocaleString(localeOf(lang), { dateStyle: "short", timeStyle: "short" }) : t("mb.never_logged"));

export function Membros() {
  const { t, lang } = useT();
  const [dados, setDados] = useState(null);
  const [modal, setModal] = useState(null); // "new" | membro
  const toast = useToast();

  const load = () => api.get("/api/admin/membros").then(setDados).catch(() => setDados({ socios: [], membros: [], erro: true }));
  useEffect(() => { load(); }, []);

  const salvar = async (f) => {
    try {
      if (modal === "new") await api.post("/api/admin/membros", f);
      else await api.patch(`/api/admin/membros/${modal._id}`, f);
      setModal(null);
      load();
      toast(modal === "new" ? t("mb.toast.added") : t("mb.toast.saved"), { tone: "ok" });
    } catch (e) {
      toast(erroDe(t, e), { tone: "danger" });
    }
  };

  const alternar = async (m) => {
    try {
      await api.patch(`/api/admin/membros/${m._id}`, { ativo: !m.ativo });
      load();
      toast(m.ativo ? t("mb.toast.access_off", { name: m.nome || m.email }) : t("mb.toast.access_on", { name: m.nome || m.email }), { tone: "ok" });
    } catch (e) { toast(erroDe(t, e), { tone: "danger" }); }
  };

  const remover = async (m) => {
    if (!confirm(t("mb.confirm.remove", { name: m.nome || m.email }))) return;
    await api.del(`/api/admin/membros/${m._id}`);
    load();
  };

  if (!dados) return <div style={{ padding: 40, color: "var(--ink-mute)" }}>{t("mb.loading")}</div>;

  return (
    <div>
      <PageHeader
        title={t("mb.title")}
        subtitle={t("mb.subtitle")}
        action={<Button variant="primary" icon="plus" onClick={() => setModal("new")}>{t("mb.add")}</Button>}
      />

      <Card title={t("mb.partners")} pad>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)" }}>
          {dados.socios.map((s) => (
            <Badge key={s.email}>{s.nome ? `${s.nome} · ` : ""}{s.email}</Badge>
          ))}
        </div>
        <div style={{ fontSize: "var(--t-xs)", color: "var(--ink-mute)", marginTop: "var(--s-2)" }}>
          {t("mb.partners_note")}
        </div>
      </Card>

      <div style={{ height: "var(--s-5)" }} />

      {dados.membros.length === 0 ? (
        <Empty icon="agents" title={t("mb.empty.title")}>
          {t("mb.empty.body")}
        </Empty>
      ) : (
        <div className="ui-table">
          <table>
            <thead>
              <tr>
                <th>{t("mb.col.member")}</th>
                <th>{t("mb.col.sees")}</th>
                <th style={{ width: 150 }}>{t("mb.col.last_access")}</th>
                <th style={{ width: 120 }}>{t("mb.col.access")}</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {dados.membros.map((m) => (
                <tr key={m._id} style={m.ativo ? undefined : { opacity: 0.55 }}>
                  <td>
                    <strong>{m.nome || m.email.split("@")[0]}</strong>
                    <div style={{ fontSize: "var(--t-xs)", color: "var(--ink-mute)" }}>{m.email}</div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {m.perms.length ? m.perms.map((p) => <Badge key={p}>{modLabel(t, p)}</Badge>) : <span style={{ color: "var(--ink-mute)" }}>{t("mb.sees_nothing")}</span>}
                      {m.perms.includes("propostas") && m.propostasSoProprias && <Badge tone="warn">{t("mb.own_proposals_badge")}</Badge>}
                    </div>
                  </td>
                  <td style={{ fontSize: "var(--t-xs)", color: "var(--ink-mute)" }}>{quando(m.ultimoLogin, t, lang)}</td>
                  <td><Switch checked={m.ativo} onChange={() => alternar(m)} label={m.ativo ? t("mb.active") : t("mb.cut_off")} /></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button variant="ghost" size="sm" icon="edit" onClick={() => setModal(m)}>{t("mb.edit")}</Button>
                    <Button variant="ghost" size="sm" icon="trash" onClick={() => remover(m)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <MembroModal initial={modal === "new" ? null : modal} onClose={() => setModal(null)} onSave={salvar} />}
    </div>
  );
}

function MembroModal({ initial, onClose, onSave }) {
  const { t } = useT();
  const [f, setF] = useState(initial
    ? { email: initial.email, nome: initial.nome, perms: initial.perms, propostasSoProprias: initial.propostasSoProprias }
    : { email: "", nome: "", perms: PRESETS[0].perms, propostasSoProprias: true });
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const toggle = (id) => setF((x) => ({ ...x, perms: x.perms.includes(id) ? x.perms.filter((p) => p !== id) : [...x.perms, id] }));
  const aplicar = (p) => setF((x) => ({ ...x, perms: p.perms, propostasSoProprias: p.propostasSoProprias }));

  return (
    <Modal
      title={initial ? t("mb.modal.edit_title") : t("mb.add")}
      subtitle={t("mb.modal.subtitle")}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("mb.modal.cancel")}</Button>
        <Button variant="primary" disabled={!emailOk} onClick={() => onSave({ ...f, email: f.email.trim().toLowerCase() })}>{t("mb.modal.save")}</Button>
      </>}
    >
      <Input label={t("mb.modal.email")} type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })}
        error={f.email && !emailOk ? t("mb.modal.email_invalid") : undefined} autoFocus={!initial} />
      <Input label={t("mb.modal.name")} value={f.nome} onChange={(v) => setF({ ...f, nome: v })} placeholder={t("mb.modal.name_ph")} />

      <div className="ui-field">
        <label className="ui-field__label">{t("mb.modal.preset")}</label>
        <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="ui-chip" style={{ cursor: "pointer" }} onClick={() => aplicar(p)}>
              {p.label} · {p.perms.map((id) => modLabel(t, id)).join(", ")}
            </button>
          ))}
        </div>
      </div>

      <div className="ui-field">
        <label className="ui-field__label">{t("mb.modal.sees")}</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {MODULOS.map((m) => (
            <label key={m.id} style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={f.perms.includes(m.id)} onChange={() => toggle(m.id)} />
              <span><strong>{t(m.label)}</strong> <span style={{ color: "var(--ink-mute)", fontSize: "var(--t-xs)" }}>{t(m.desc)}</span></span>
            </label>
          ))}
        </div>
      </div>

      {f.perms.includes("propostas") && (
        <div className="ui-field">
          <Switch checked={!!f.propostasSoProprias} onChange={(v) => setF({ ...f, propostasSoProprias: v })}
            label={t("mb.modal.own_only")} />
          <div style={{ fontSize: "var(--t-xs)", color: "var(--ink-mute)", marginTop: 4 }}>
            {t("mb.modal.own_only_help")}
          </div>
        </div>
      )}

      <Note>{t("mb.modal.note")}</Note>
    </Modal>
  );
}
