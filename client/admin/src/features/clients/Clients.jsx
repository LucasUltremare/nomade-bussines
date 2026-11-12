import { useState, useEffect } from "react";
import { api } from "../../api/client.js";
import { ehSocio } from "../../lib/acesso.js";
import { Icon } from "../../components/Icon.jsx";
import { Button, Badge, Input, Empty, Modal, PageHeader, useToast } from "../../components/ui.jsx";
import { useT } from "../../i18n/index.jsx";
import { ClientDetail } from "./ClientDetail.jsx";

/* ══════════════════════════════════════════════════════════════
   CLIENTES — o hub. Cada cliente concentra o que é dele:
   propostas, cobranças, briefing e tasks.
   Proposta paga cria/atualiza o cliente sozinha (webhook do MP).

   Cliente É o projeto: não existe tela paralela de projeto. O que o
   escritório (ai-service) sabe do andamento — tarefas abertas, o que
   está na mão de agent, decisão esperando sócio — entra aqui como
   sinal na própria linha, casado por email. Enriquecimento puro:
   nada disso é editável e nada disso bloqueia a tela.
   ══════════════════════════════════════════════════════════════ */

// O escritório vive na MESMA origem, mas fora do proxy /hq (que é o server
// legado) — por isso fetch direto em vez de api.get.
const officeFetch = (path) =>
  fetch(path, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}` },
  }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });

const emailKey = (v) => (v || "").toLowerCase().trim();

/* status é enum do server — traduz na renderização; valor desconhecido fica como veio */
const STATUS_KEYS = { active: "cl.status.active", paused: "cl.status.paused", cancelled: "cl.status.cancelled" };
const statusLabel = (t, s) => (STATUS_KEYS[s] ? t(STATUS_KEYS[s]) : (s || "—"));

export function Clients({ onOpenProposta, onOpenKanban, me, user }) {
  const { t } = useT();
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);      // "new" | client
  const [detail, setDetail] = useState(null);
  const [office, setOffice] = useState(null);    // { [email]: { tarefasAbertas, tarefasAgent, decisoes } }
  const toast = useToast();

  // Escritório fora do ar não pode derrubar a lista de clientes: some o
  // enriquecimento e a tela segue exatamente como era. Silêncio é proposital.
  const loadOffice = () =>
    officeFetch("/api/office/clientes")
      .then((rows) => {
        const map = {};
        for (const r of Array.isArray(rows) ? rows : []) {
          const k = emailKey(r.email);
          if (k) map[k] = r;
        }
        setOffice(map);
      })
      .catch(() => setOffice(null));

  const load = () => {
    loadOffice();   // o join é por email, então os sinais recarregam junto com a lista
    return api.get("/api/admin/clients").then(setList).catch(() => setList([]));
  };

  // NÃO passar `load` direto: ele retorna uma Promise, e o React trataria esse
  // retorno como função de cleanup → crash "n is not a function" no unmount.
  useEffect(() => { load(); }, []);

  const save = async (data) => {
    const payload = { ...data, email: (data.email || "").toLowerCase().trim() };
    try {
      if (modal === "new") await api.post("/api/admin/clients", payload);
      else await api.patch(`/api/admin/clients/${modal._id}`, payload);
      setModal(null);
      load();
      toast(t("cl.toast.saved"), { tone: "ok" });
    } catch {
      toast(t("cl.toast.save_fail"), { tone: "danger" });
    }
  };

  const del = async (c) => {
    if (!confirm(t("cl.confirm.delete", { name: c.name }))) return;
    await api.del(`/api/admin/clients/${c._id}`);
    load();
  };

  if (!list) return <div style={{ padding: 40, color: "var(--ink-mute)" }}>{t("cl.loading")}</div>;

  const term = q.trim().toLowerCase();
  const filtered = term
    ? list.filter((c) => [c.name, c.email, c.segment, c.contact].some((v) => (v || "").toLowerCase().includes(term)))
    : list;

  return (
    <div>
      <PageHeader
        title={t("cl.title")}
        subtitle={t(list.length === 1 ? "cl.subtitle_one" : "cl.subtitle_other", { n: list.length })}
        action={<Button variant="primary" icon="plus" onClick={() => setModal("new")}>{t("cl.new")}</Button>}
      />

      <div style={{ marginBottom: "var(--s-4)", maxWidth: 280 }}>
        <div className="ui-input-wrap">
          <Icon name="search" size={14} />
          <input className="ui-input" placeholder={t("cl.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="clients" title={term ? t("cl.empty.search_title") : t("cl.empty.title")}>
          {term ? t("cl.empty.search_body") : t("cl.empty.body")}
        </Empty>
      ) : (
        <div className="ui-table ui-table--clickable">
          <table>
            <thead>
              <tr>
                <th>{t("cl.th.client")}</th>
                <th style={{ width: 140 }}>{t("cl.th.segment")}</th>
                <th style={{ width: 100 }}>{t("cl.th.status")}</th>
                <th style={{ width: 170 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c._id} onClick={() => setDetail(c)}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexWrap: "wrap" }}>
                      <strong>{c.name}</strong>
                      {office && c.email && office[emailKey(c.email)] && (
                        <OfficeSignals data={office[emailKey(c.email)]} t={t} />
                      )}
                    </div>
                    <div style={{ fontSize: "var(--t-sm)", color: "var(--ink-mute)" }}>
                      {c.email || c.contact || "—"}
                      {!c.email && (
                        <span style={{ color: "var(--warn-fg)", marginLeft: 6 }} title={t("cl.no_email_title")}>
                          {t("cl.no_email")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: "var(--ink-soft)", fontSize: "var(--t-sm)" }}>{c.segment || "—"}</td>
                  <td><Badge tone={c.status === "active" ? "ok" : "neutral"}>{statusLabel(t, c.status)}</Badge></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      <button className="icon-btn" onClick={() => setDetail(c)} title={t("cl.open_hub")}>
                        <Icon name="eye" size={14} />
                      </button>
                      {onOpenKanban && (
                        <button className="icon-btn" onClick={() => onOpenKanban(c._id)} title={t("cl.open_kanban")}>
                          <Icon name="board" size={14} />
                        </button>
                      )}
                      <button className="icon-btn" onClick={() => setModal(c)} title={t("cl.edit")}><Icon name="edit" size={14} /></button>
                      {ehSocio() && <button className="icon-btn" onClick={() => del(c)} title={t("cl.delete")}><Icon name="trash" size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <ClientModal initial={modal === "new" ? null : modal} onClose={() => setModal(null)} onSave={save} />}
      {detail && (
        <ClientDetail
          client={detail}
          onClose={() => setDetail(null)}
          onEdit={(c) => { setDetail(null); setTimeout(() => setModal(c), 50); }}
          onOpenProposta={onOpenProposta}
          onOpenKanban={onOpenKanban}
          me={me}
        />
      )}
    </div>
  );
}

/* Sinais do escritório na linha do cliente. Só aparece o que tem número:
   cliente sem movimento fica idêntico ao que era antes. */
function OfficeSignals({ data, t }) {
  const abertas = data.tarefasAbertas || 0;
  const agent = data.tarefasAgent || 0;
  const decisoes = data.decisoes || 0;
  if (!abertas && !agent && !decisoes) return null;

  const p = (n, key) => t(`${key}_${n === 1 ? "one" : "other"}`, { n });

  return (
    <>
      {abertas > 0 && (
        <span title={p(abertas, "cl.sig.open_title")}>
          <Badge>{p(abertas, "cl.sig.open")}</Badge>
        </span>
      )}
      {agent > 0 && (
        <span title={p(agent, "cl.sig.agent_title")}>
          <Badge tone="ok">{t("cl.sig.agent", { n: agent })}</Badge>
        </span>
      )}
      {decisoes > 0 && (
        <span title={p(decisoes, "cl.sig.dec_title")}>
          <Badge tone="danger">{p(decisoes, "cl.sig.dec")}</Badge>
        </span>
      )}
    </>
  );
}

/* Sugestões de agents — clica pra adicionar/remover; campo livre pro resto.
   Guardamos chaves e traduzimos na renderização. */
const AGENT_SUGGESTION_KEYS = [
  "cl.agent.whatsapp",
  "cl.agent.instagram",
  "cl.agent.sdr",
  "cl.agent.scheduling",
  "cl.agent.prequal",
  "cl.agent.postsale",
  "cl.agent.support",
  "cl.agent.collections",
  "cl.agent.reactivation",
];

const SEGMENT_SUGGESTION_KEYS = ["cl.seg.clinic", "cl.seg.barber", "cl.seg.law", "cl.seg.ecommerce", "cl.seg.restaurant", "cl.seg.realestate", "cl.seg.gym"];

function ClientModal({ initial, onClose, onSave }) {
  const { t } = useT();
  const [f, setF] = useState(initial
    ? { agents: [], ...initial }
    : { name: "", email: "", segment: "", contact: "", notes: "", agents: [], status: "active" });
  const [customAgent, setCustomAgent] = useState("");
  const emailOk = !f.email || /^\S+@\S+\.\S+$/.test(f.email);

  const agentSuggestions = AGENT_SUGGESTION_KEYS.map((k) => t(k));
  const segmentSuggestions = SEGMENT_SUGGESTION_KEYS.map((k) => t(k));

  const agents = f.agents || [];
  const toggleAgent = (name) =>
    setF({ ...f, agents: agents.includes(name) ? agents.filter((a) => a !== name) : [...agents, name] });
  const addCustom = () => {
    const name = customAgent.trim();
    if (!name || agents.includes(name)) return;
    setF({ ...f, agents: [...agents, name] });
    setCustomAgent("");
  };

  const chip = (name, active) => (
    <button
      key={name}
      type="button"
      className={`ui-chip${active ? " ui-chip--active" : ""}`}
      style={{ cursor: "pointer" }}
      onClick={() => toggleAgent(name)}
    >
      {active && <Icon name="check" size={11} />}{name}
    </button>
  );

  return (
    <Modal
      title={initial ? t("cl.modal.edit") : t("cl.new")}
      subtitle={t("cl.modal.sub")}
      size="wide"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cl.cancel")}</Button>
        <Button variant="primary" disabled={!f.name || !emailOk} onClick={() => onSave(f)}>{t("cl.save")}</Button>
      </>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 var(--s-4)" }}>
        <Input label={t("cl.f.name")} value={f.name} onChange={(v) => setF({ ...f, name: v })} />
        <Input label={t("cl.f.email")} type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })}
          error={!emailOk ? t("cl.f.email_invalid") : undefined} />
        <Input label={t("cl.f.contact")} value={f.contact} onChange={(v) => setF({ ...f, contact: v })} />
        <div>
          <Input label={t("cl.f.segment")} value={f.segment} onChange={(v) => setF({ ...f, segment: v })} placeholder={t("cl.f.segment_ph")} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "calc(var(--s-2) * -1)", marginBottom: "var(--s-3)" }}>
            {segmentSuggestions.map((s) => (
              <button key={s} type="button" onClick={() => setF({ ...f, segment: s })}
                style={{
                  fontSize: "var(--t-2xs)", padding: "2px 8px", borderRadius: "var(--r-full)",
                  border: "1px solid var(--line)", background: f.segment === s ? "var(--accent-soft)" : "transparent",
                  color: f.segment === s ? "var(--accent-fg)" : "var(--ink-faint)", cursor: "pointer",
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-field">
        <label className="ui-field__label">{t("cl.f.agents")}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)" }}>
          {/* selecionados que não estão nas sugestões (customizados) */}
          {agents.filter((a) => !agentSuggestions.includes(a)).map((a) => chip(a, true))}
          {agentSuggestions.map((a) => chip(a, agents.includes(a)))}
        </div>
        <div style={{ display: "flex", gap: "var(--s-2)", marginTop: "var(--s-2)" }}>
          <input
            className="ui-input"
            placeholder={t("cl.f.agent_other_ph")}
            value={customAgent}
            onChange={(e) => setCustomAgent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
          />
          <Button variant="secondary" icon="plus" onClick={addCustom} disabled={!customAgent.trim()}>{t("cl.add")}</Button>
        </div>
      </div>

      {initial && (
        <div className="ui-field" style={{ maxWidth: 220 }}>
          <label className="ui-field__label">{t("cl.f.status")}</label>
          <select className="ui-select" value={f.status || "active"} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">{t("cl.status.active")}</option>
            <option value="paused">{t("cl.status.paused")}</option>
            <option value="cancelled">{t("cl.status.cancelled")}</option>
          </select>
        </div>
      )}

      <Input label={t("cl.f.notes")} textarea value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
    </Modal>
  );
}
