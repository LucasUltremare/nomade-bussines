import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { Badge } from "../../components/shared.jsx";
import { useT, localeOf } from "../../i18n/index.jsx";
import { dinheiro } from "../../lib/regional.js";

const fmtDate = (d, lang) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short", year: "numeric" });
};
const fmtDateTime = (d, lang) => {
  if (!d) return "—";
  return new Date(d).toLocaleString(localeOf(lang), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/* rótulos são chaves i18n — traduzidos na renderização */
const PROP_STATUS = {
  draft:     { key: "cl.d.ps.draft",     tone: "gray" },
  published: { key: "cl.d.ps.published", tone: "blue" },
  paid:      { key: "cl.d.ps.paid",      tone: "teal" },
  lost:      { key: "cl.d.ps.lost",      tone: "red" },
};
const PAY_STATUS = {
  open:             { key: "cl.d.pay.open",             tone: "blue" },
  paid:             { key: "cl.d.pay.paid",             tone: "teal" },
  pending_delivery: { key: "cl.d.pay.pending_delivery", tone: "gold" },
  cancelled:        { key: "cl.d.pay.cancelled",        tone: "gray" },
  expired:          { key: "cl.d.pay.expired",          tone: "gray" },
};
const CLIENT_STATUS = { active: "cl.status.active", paused: "cl.status.paused", cancelled: "cl.status.cancelled" };
const statusLabel = (t, s) => (CLIENT_STATUS[s] ? t(CLIENT_STATUS[s]) : s);

export function ClientDetail({ client, onClose, onEdit, onOpenProposta, onOpenKanban, me }) {
  const { t } = useT();
  const [tab, setTab] = useState("overview");
  const [criandoProposta, setCriandoProposta] = useState(false);

  const novaProposta = async () => {
    setCriandoProposta(true);
    try {
      const r = await api.post(`/api/admin/clients/${client._id}/nova-proposta`);
      onClose();
      onOpenProposta?.(r.propostaId);
    } catch {
      alert(t("cl.d.proposal_fail"));
    } finally {
      setCriandoProposta(false);
    }
  };

  /* Esc close */
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <CDStyles />
      <div className="cd-backdrop" onClick={onClose}>
        <div className="cd-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t("cl.d.aria", { name: client.name })}>
          <header className="cd-head">
            <div className="cd-head-info">
              <div className="cd-avatar" style={{ background: avatarBg(client.name || client.email || "?") }}>
                {(client.name || client.email || "?")[0].toUpperCase()}
              </div>
              <div>
                <h2>{client.name || t("cl.d.unnamed")}</h2>
                <div className="cd-head-meta">
                  {client.email && <span className="cd-email">{client.email}</span>}
                  {client.status && <Badge tone={client.status === "active" ? "teal" : "gray"}>{statusLabel(t, client.status)}</Badge>}
                </div>
              </div>
            </div>
            <div className="cd-head-actions">
              {onOpenProposta && (
                <button className="cd-btn cd-btn--ghost" onClick={novaProposta} disabled={criandoProposta}>
                  <Icon name="report" size={14} /> {criandoProposta ? t("cl.d.creating") : t("cl.d.new_proposal")}
                </button>
              )}
              <button className="cd-btn cd-btn--ghost" onClick={() => onEdit(client)}>
                <Icon name="edit" size={14} /> {t("cl.edit")}
              </button>
              <button className="cd-btn cd-btn--icon" onClick={onClose} aria-label={t("cl.d.close")}>
                <Icon name="close" size={16} />
              </button>
            </div>
          </header>

          <nav className="cd-tabs" role="tablist">
            <Tab id="overview" current={tab} onClick={setTab}>{t("cl.d.tab.overview")}</Tab>
            <Tab id="hub" current={tab} onClick={setTab}>{t("cl.d.tab.hub")}</Tab>
            <Tab id="briefing" current={tab} onClick={setTab}>{t("cl.d.tab.briefing")}</Tab>
            <Tab id="kanban" current={tab} onClick={setTab}>{t("cl.d.tab.kanban")}</Tab>
          </nav>

          <div className="cd-body">
            {tab === "overview" && <OverviewTab client={client} />}
            {tab === "hub" && <HubTab clientId={client._id} />}
            {tab === "briefing" && <BriefingTab clientEmail={client.email} />}
            {tab === "kanban" && (
              <KanbanTab
                clientId={client._id}
                onOpen={() => { onClose(); onOpenKanban?.(client._id); }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Tab({ id, current, onClick, children }) {
  const active = id === current;
  return (
    <button
      role="tab"
      aria-selected={active}
      className={`cd-tab ${active ? "is-active" : ""}`}
      onClick={() => onClick(id)}
    >
      {children}
    </button>
  );
}

/* ─── OVERVIEW TAB ─── */
function OverviewTab({ client }) {
  const { t, lang } = useT();
  const agents = client.agents || [];
  return (
    <div className="cd-grid">
      <Card title={t("cl.d.card.client")}>
        <KV k={t("cl.d.kv.name")} v={client.name || "—"} />
        <KV k={t("cl.d.kv.email")} v={client.email || "—"} />
        <KV k={t("cl.d.kv.contact")} v={client.contact || "—"} />
        <KV k={t("cl.d.kv.segment")} v={client.segment || "—"} />
        <KV k={t("cl.d.kv.plan")} v={client.plan || "—"} />
        <KV k={t("cl.d.kv.status")} v={<Badge tone={client.status === "active" ? "teal" : "gray"}>{client.status ? statusLabel(t, client.status) : "—"}</Badge>} />
      </Card>

      <Card title={t("cl.f.agents")}>
        {agents.length === 0 ? (
          <div className="cd-empty">{t("cl.d.no_agents")}</div>
        ) : (
          <ul className="cd-agents">
            {agents.map((name, i) => (
              <li key={i}>
                <span className="cd-agent-dot" style={{ background: "#0077B6" }} />
                <strong>{String(name)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("cl.d.card.dates")}>
        <KV k={t("cl.d.kv.created")} v={fmtDate(client.createdAt, lang)} />
        <KV k={t("cl.d.kv.activated")} v={fmtDate(client.activatedAt, lang)} />
        <KV k={t("cl.d.kv.next_due")} v={fmtDate(client.nextDueDate, lang)} />
        {client.cancelledAt && <KV k={t("cl.d.kv.cancelled")} v={fmtDate(client.cancelledAt, lang)} />}
        {client.suspendedAt && <KV k={t("cl.d.kv.suspended")} v={fmtDate(client.suspendedAt, lang)} />}
      </Card>

      {client.pricing && (
        <Card title={t("cl.d.card.plan")}>
          <KV k={t("cl.d.kv.cycle")} v={client.cycle || client.pricing?.cycleId || "—"} />
          <KV k={t("cl.d.kv.monthly")} v={brl(client.pricing?.finalMonthly, lang)} />
          <KV k={t("cl.d.kv.charge_now")} v={brl(client.pricing?.chargeNow, lang)} />
          <KV k={t("cl.d.kv.quota")} v={t("cl.d.msgs", { n: (client.quota || (client.agents?.length || 0) * 1000).toLocaleString(localeOf(lang)) })} />
        </Card>
      )}

      {client.notes && (
        <Card title={t("cl.d.card.notes")} wide>
          <div className="cd-notes">{client.notes}</div>
        </Card>
      )}
    </div>
  );
}

/* ─── HUB TAB — propostas & cobranças linkadas pelo email ─── */
function HubTab({ clientId }) {
  const { t, lang } = useT();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/api/admin/clients/${clientId}/hub`)
      .then(setData)
      .catch(() => setErr(t("cl.d.load_fail")));
  }, [clientId]);

  if (err) return <div className="cd-empty">{err}</div>;
  if (!data) return <div className="cd-loading"><div className="cd-spin" /></div>;

  const copy = (url) => navigator.clipboard?.writeText(url);
  const pad3 = (n) => String(n ?? "?").padStart(3, "0");

  return (
    <div className="cd-hub">
      <Card title={t("cl.d.proposals", { n: data.propostas.length })} wide>
        {data.propostas.length === 0 ? (
          <div className="cd-empty">{t("cl.d.no_proposals")}</div>
        ) : (
          <ul className="cd-hub-list">
            {data.propostas.map((p) => {
              const st = PROP_STATUS[p.status] || { tone: "gray" };
              return (
                <li key={p._id} className="cd-hub-row">
                  <div className="cd-hub-main">
                    <strong>#{pad3(p.numero)}</strong>
                    <span className="cd-hub-sub">{p.conteudo?.subtitle || (p.mode === "mensal" ? t("cl.d.mode.monthly") : t("cl.d.mode.project"))}</span>
                  </div>
                  <span className="cd-hub-val">{brl(p.total, lang)}{p.mode === "mensal" ? t("cl.d.per_month") : ""}</span>
                  <Badge tone={st.tone}>{st.key ? t(st.key) : p.status}</Badge>
                  <span className="cd-hub-meta">{t("cl.d.opened", { n: p.aberturas || 0, date: fmtDate(p.createdAt, lang) })}</span>
                  <span className="cd-hub-acts">
                    <button className="icon-btn" title={t("cl.d.open_page")} onClick={() => window.open(p.url, "_blank")}>
                      <Icon name="external" size={13} />
                    </button>
                    {p.status !== "draft" && (
                      <button className="icon-btn" title={t("cl.d.copy_link")} onClick={() => copy(p.url)}>
                        <Icon name="copy" size={13} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t("cl.d.charges", { n: data.pagamentos.length })} wide>
        {data.pagamentos.length === 0 ? (
          <div className="cd-empty">{t("cl.d.no_charges")}</div>
        ) : (
          <ul className="cd-hub-list">
            {data.pagamentos.map((l) => {
              const st = PAY_STATUS[l.status] || { tone: "gray" };
              return (
                <li key={l._id} className="cd-hub-row">
                  <div className="cd-hub-main">
                    <span className="cd-hub-sub">{l.description || t("cl.d.charge")}</span>
                  </div>
                  <span className="cd-hub-val">{brl(l.pricing?.chargeNow, lang)}</span>
                  <Badge tone={st.tone}>{st.key ? t(st.key) : l.status}</Badge>
                  <span className="cd-hub-meta">
                    {l.status === "paid" && l.paidAt ? t("cl.d.paid_on", { date: fmtDate(l.paidAt, lang) }) : fmtDate(l.createdAt, lang)}
                  </span>
                  <span className="cd-hub-acts">
                    {["open"].includes(l.status) && (
                      <button className="icon-btn" title={t("cl.d.copy_pay_link")} onClick={() => copy(l.url)}>
                        <Icon name="copy" size={13} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ─── KANBAN TAB — resumo + abre o board em tela cheia ───
 * O board completo vive na aba Kanban (escopo "Clientes"): aqui dentro do
 * modal a tela é estreita demais pra arrastar cartões. */
function KanbanTab({ clientId, onOpen }) {
  const { t } = useT();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const board = await api.get(`/api/admin/clients/${clientId}/board`);
        const tasks = await api.get(`/api/admin/tasks?boardId=${board._id}`);
        if (alive) setData({ board, tasks });
      } catch {
        if (alive) setData({ board: null, tasks: [] });
      }
    })();
    return () => { alive = false; };
  }, [clientId]);

  if (!data) return <div className="cd-loading"><div className="cd-spin" /></div>;

  const cols = (data.board?.columns || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const total = data.tasks.length;

  return (
    <div className="cd-kbtab">
      <div className="cd-kbtab-head">
        <div>
          <div className="cd-card-title" style={{ marginBottom: 4 }}>{t("cl.d.kb.title")}</div>
          <div className="cd-kbtab-total">
            <strong>{total}</strong> {total === 1 ? t("cl.d.kb.tasks_one") : t("cl.d.kb.tasks_other")}
          </div>
        </div>
        <button className="cd-btn cd-kbtab-open" onClick={onOpen}>
          <Icon name="board" size={14} /> {t("cl.d.kb.open")}
        </button>
      </div>

      {cols.length > 0 && (
        <div className="cd-kbtab-cols">
          {cols.map((c) => {
            const n = data.tasks.filter((t) => t.status === c.id).length;
            return (
              <div key={c.id} className="cd-kbtab-col">
                <span className="cd-kbtab-dot" style={{ background: c.color || "#6b7280" }} />
                <span className="cd-kbtab-name">{c.name}</span>
                <strong className="cd-kbtab-n">{n}</strong>
              </div>
            );
          })}
        </div>
      )}

      {total === 0 && (
        <div className="cd-empty" style={{ marginTop: 4 }}>
          <div className="cd-empty-icon"><Icon name="board" size={22} /></div>
          <strong>{t("cl.d.kb.empty")}</strong>
          <p>{t("cl.d.kb.empty_body")}</p>
        </div>
      )}
    </div>
  );
}

/* ─── BRIEFING TAB ─── */
function BriefingTab({ clientEmail }) {
  const { t, lang } = useT();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!clientEmail) { setErr(t("cl.d.brf.no_email")); return; }
    api.get(`/api/admin/briefings/${encodeURIComponent(clientEmail)}`)
      .then(setData)
      .catch(() => setErr(t("cl.d.brf.load_fail")));
  }, [clientEmail]);

  if (err) return <div className="cd-empty">{err}</div>;
  if (!data) return <div className="cd-loading"><div className="cd-spin" /></div>;

  if (!data.submittedAt && (!data.data || Object.keys(data.data).length === 0)) {
    return (
      <div className="cd-empty">
        <div className="cd-empty-icon"><Icon name="report" size={22} /></div>
        <strong>{t("cl.d.brf.empty")}</strong>
        <p>{t("cl.d.brf.empty_body")}</p>
      </div>
    );
  }

  return (
    <div className="cd-briefing">
      <div className="cd-briefing-status">
        {data.submittedAt ? (
          <Badge tone="teal">{t("cl.d.brf.submitted", { date: fmtDateTime(data.submittedAt, lang) })}</Badge>
        ) : (
          <Badge tone="gold">{t("cl.d.brf.draft", { date: fmtDateTime(data.lastSavedAt, lang) })}</Badge>
        )}
      </div>

      {data.schema?.sections.map((sec) => (
        <section key={sec.id} className="cd-brf-section">
          <h3>{sec.title}</h3>
          <div className="cd-brf-fields">
            {sec.fields.map((f) => {
              const value = data.data?.[f.id];
              return (
                <div key={f.id} className="cd-brf-field">
                  <div className="cd-brf-q">{f.label}</div>
                  <div className="cd-brf-a">{renderAnswer(f, value, t)}</div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function renderAnswer(field, value, t) {
  if (value == null || value === "") return <span className="cd-brf-empty">{t("cl.d.brf.no_answer")}</span>;

  if (field.type === "select") {
    const opt = field.options?.find((o) => o.value === value);
    return <span>{opt?.label || value}</span>;
  }

  if (field.type === "multiselect") {
    if (!Array.isArray(value) || value.length === 0) return <span className="cd-brf-empty">{t("cl.d.brf.no_answer")}</span>;
    return (
      <div className="cd-brf-tags">
        {value.map((v) => {
          const opt = field.options?.find((o) => o.value === v);
          return <span key={v} className="cd-brf-tag">{opt?.label || v}</span>;
        })}
      </div>
    );
  }

  if (field.type === "drive_file") {
    if (!value?.url) return <span className="cd-brf-empty">{t("cl.d.brf.no_file")}</span>;
    return <a href={value.url} target="_blank" rel="noopener noreferrer" className="cd-brf-link">{value.name || value.url}</a>;
  }

  if (field.type === "text_or_file") {
    return (
      <div>
        {value.text && <div className="cd-brf-text">{value.text}</div>}
        {value.file?.url && (
          <div style={{ marginTop: value.text ? 8 : 0 }}>
            <a href={value.file.url} target="_blank" rel="noopener noreferrer" className="cd-brf-link">
              <Icon name="clip" size={12} /> {value.file.name || value.file.url}
            </a>
          </div>
        )}
        {!value.text && !value.file?.url && <span className="cd-brf-empty">{t("cl.d.brf.no_answer")}</span>}
      </div>
    );
  }

  /* text / textarea / fallback */
  return <div className="cd-brf-text">{String(value)}</div>;
}


/* ─── helpers ─── */
function Card({ title, children, wide }) {
  return (
    <div className={`cd-card ${wide ? "cd-card--wide" : ""}`}>
      <div className="cd-card-title">{title}</div>
      {children}
    </div>
  );
}
function KV({ k, v }) {
  return (
    <div className="cd-kv">
      <div className="cd-kv-k">{k}</div>
      <div className="cd-kv-v">{v}</div>
    </div>
  );
}
const brl = (n, lang) => n != null ? dinheiro(n, lang) : "—";

function avatarBg(s) {
  const colors = ["#0077B6", "#00A896", "#c8a040", "#d4654a", "#7a6ad8", "#1a7ec4"];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

/* ─── styles ─── */
function CDStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      .cd-backdrop {
        position: fixed; inset: 0; background: var(--bg-backdrop, var(--ink-soft));
        backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        padding: 20px; z-index: 1000;
        animation: cdFade .2s ease;
      }
      @keyframes cdFade { from { opacity: 0; } to { opacity: 1; } }
      .cd-sheet {
        width: 100%; max-width: 920px; height: min(86vh, 800px);
        background: var(--bg-elev, #fff);
        border-radius: 16px; overflow: hidden;
        display: flex; flex-direction: column;
        box-shadow: var(--shadow-modal, 0 32px 80px var(--ink-ghost));
        color: var(--ink, #051017);
        animation: cdSlide .25s cubic-bezier(.2,.8,.2,1);
      }
      @keyframes cdSlide { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }

      .cd-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 20px 24px; gap: 16px;
        border-bottom: 1px solid var(--border, rgba(0,0,0,.06));
      }
      .cd-head-info { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .cd-avatar {
        width: 44px; height: 44px; border-radius: 50%;
        color: #fff; font-family: var(--heading); font-weight: 700; font-size: 17px;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .cd-head h2 {
        font-family: var(--heading); font-weight: 700;
        font-size: 18px; letter-spacing: -0.02em;
        margin: 0 0 4px;
      }
      .cd-head-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .cd-email {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 11.5px; color: var(--ink-faint, rgba(0,0,0,.5));
      }
      .cd-head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

      .cd-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 7px 14px; border-radius: 8px;
        font-family: var(--heading); font-weight: 600; font-size: 12.5px;
        background: transparent; color: var(--ink, #051017);
        border: 1px solid var(--border, rgba(0,0,0,.08));
        cursor: pointer;
        transition: background .15s, border-color .15s, color .15s;
      }
      .cd-btn:hover { background: var(--bg-hover, rgba(0,0,0,.04)); border-color: var(--border-strong, rgba(0,0,0,.18)); }
      .cd-btn--ghost { background: transparent; }
      .cd-btn--icon { padding: 7px; border: none; }

      .cd-tabs {
        display: flex; align-items: center; gap: 2px;
        padding: 0 24px; border-bottom: 1px solid var(--border, rgba(0,0,0,.06));
        overflow-x: auto;
      }
      .cd-tab {
        padding: 12px 16px;
        background: none; border: none; cursor: pointer;
        font-family: var(--heading); font-weight: 600; font-size: 13px;
        color: var(--ink-faint, rgba(0,0,0,.5));
        position: relative;
        white-space: nowrap;
        transition: color .15s;
      }
      .cd-tab:hover { color: var(--ink, #051017); }
      .cd-tab.is-active { color: var(--ink, #051017); }
      .cd-tab.is-active::after {
        content: ""; position: absolute; bottom: -1px; left: 8px; right: 8px; height: 2px;
        background: #0077B6;
        border-radius: 1px 1px 0 0;
      }

      .cd-body {
        flex: 1; overflow-y: auto;
        padding: 24px;
        background: var(--bg, #fafbfc);
      }
      /* Kanban tab: resumo por coluna + botão pra abrir em tela cheia */
      .cd-kbtab { display: flex; flex-direction: column; gap: 14px; }
      .cd-kbtab-head {
        display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
        background: var(--bg-elev, #fff); border: 1px solid var(--border, rgba(0,0,0,.06));
        border-radius: 12px; padding: 18px 20px;
      }
      .cd-kbtab-total { font-size: 13px; color: var(--ink-faint, rgba(0,0,0,.55)); }
      .cd-kbtab-total strong { color: var(--ink); font-family: var(--heading); font-weight: 700; font-size: 15px; }
      .cd-kbtab-open { background: rgba(0,119,182,.08); border-color: rgba(0,119,182,.25); color: #0077B6; font-weight: 600; }
      .cd-kbtab-open:hover { background: rgba(0,119,182,.14); border-color: rgba(0,119,182,.4); }
      .cd-kbtab-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
      .cd-kbtab-col {
        display: flex; align-items: center; gap: 8px;
        background: var(--bg-elev, #fff); border: 1px solid var(--border, rgba(0,0,0,.06));
        border-radius: 10px; padding: 11px 13px; font-size: 12.5px;
      }
      .cd-kbtab-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .cd-kbtab-name { flex: 1; color: var(--ink-faint, rgba(0,0,0,.6)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cd-kbtab-n { font-family: var(--heading); font-weight: 700; font-size: 14px; color: var(--ink); }

      .cd-loading { padding: 40px; text-align: center; }
      .cd-spin {
        width: 24px; height: 24px; margin: 0 auto;
        border: 2.5px solid rgba(0,119,182,.15);
        border-top-color: #0077B6;
        border-radius: 50%;
        animation: cdspin 1s linear infinite;
      }
      @keyframes cdspin { to { transform: rotate(360deg); } }

      .cd-empty {
        padding: 32px 20px; text-align: center;
        color: var(--ink-faint, rgba(0,0,0,.55));
        font-size: 13px; line-height: 1.55;
      }
      .cd-empty strong { display: block; font-family: var(--heading); font-weight: 700; font-size: 15px; color: var(--ink); margin-bottom: 4px; }
      .cd-empty p { margin: 4px 0 0; font-size: 12.5px; }
      .cd-empty-icon { font-size: 28px; margin-bottom: 12px; }

      /* OVERVIEW grid */
      .cd-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
      }
      @media (max-width: 720px) { .cd-grid { grid-template-columns: 1fr; } }

      .cd-card {
        background: var(--bg-elev, #fff);
        border: 1px solid var(--border, rgba(0,0,0,.06));
        border-radius: 12px;
        padding: 18px 20px;
      }
      .cd-card--wide { grid-column: 1 / -1; }
      .cd-card-title {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 10.5px; letter-spacing: 1.2px; text-transform: uppercase;
        color: var(--ink-faint, rgba(0,0,0,.5));
        margin-bottom: 14px;
      }

      .cd-kv {
        display: flex; justify-content: space-between; gap: 14px;
        padding: 8px 0; font-size: 13px;
        border-top: 1px solid var(--border, rgba(0,0,0,.04));
      }
      .cd-kv:first-of-type { border-top: none; padding-top: 0; }
      .cd-kv-k { color: var(--ink-faint, rgba(0,0,0,.55)); flex-shrink: 0; }
      .cd-kv-v { font-weight: 500; text-align: right; color: var(--ink, #051017); word-break: break-word; }

      .cd-agents { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
      .cd-agents li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
      .cd-agent-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .cd-agent-role { color: var(--ink-faint); font-size: 12px; }

      .cd-notes {
        font-size: 13px; line-height: 1.6; color: var(--ink, #051017);
        white-space: pre-wrap;
      }

      /* HUB tab (propostas & cobranças) */
      .cd-hub { display: flex; flex-direction: column; gap: 14px; }
      .cd-hub-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
      .cd-hub-row {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 0; font-size: 13px; flex-wrap: wrap;
        border-top: 1px solid var(--border, rgba(0,0,0,.05));
      }
      .cd-hub-row:first-child { border-top: none; padding-top: 0; }
      .cd-hub-main { flex: 1; min-width: 150px; display: flex; align-items: baseline; gap: 8px; }
      .cd-hub-main strong { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; }
      .cd-hub-sub { color: var(--ink-faint, rgba(0,0,0,.55)); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cd-hub-val { font-family: var(--heading); font-weight: 700; white-space: nowrap; }
      .cd-hub-meta {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 10px; color: var(--ink-faint, rgba(0,0,0,.45)); white-space: nowrap;
      }
      .cd-hub-acts { display: flex; gap: 2px; }

      /* BRIEFING tab */
      .cd-briefing { display: flex; flex-direction: column; gap: 18px; }
      .cd-briefing-status { display: flex; align-items: center; gap: 8px; }

      .cd-brf-section {
        background: var(--bg-elev, #fff);
        border: 1px solid var(--border, rgba(0,0,0,.06));
        border-radius: 12px;
        padding: 18px 20px;
      }
      .cd-brf-section h3 {
        font-family: var(--heading); font-weight: 700;
        font-size: 14px; letter-spacing: -0.01em;
        margin: 0 0 14px;
        color: #0077B6;
      }
      .cd-brf-fields { display: flex; flex-direction: column; gap: 14px; }
      .cd-brf-field {
        padding: 12px 0; border-top: 1px solid var(--border, rgba(0,0,0,.05));
      }
      .cd-brf-field:first-child { border-top: none; padding-top: 0; }
      .cd-brf-q {
        font-family: var(--heading); font-weight: 600;
        font-size: 13.5px; color: var(--ink, #051017);
        margin-bottom: 6px;
      }
      .cd-brf-a { font-size: 13px; line-height: 1.55; color: var(--ink-faint, rgba(0,0,0,.7)); }
      .cd-brf-text { white-space: pre-wrap; word-break: break-word; }
      .cd-brf-empty {
        font-style: italic; color: rgba(0,0,0,.35);
        font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px;
      }
      .cd-brf-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .cd-brf-tag {
        padding: 3px 10px; border-radius: 50px;
        background: rgba(0,119,182,.08); color: #0077B6;
        font-size: 11.5px; font-weight: 500;
      }
      .cd-brf-link {
        color: #0077B6; text-decoration: underline; word-break: break-all;
      }

      /* TASKS tab */
      .cd-tasks { display: flex; flex-direction: column; gap: 18px; }
      .cd-tasks-summary {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; color: var(--ink-faint, rgba(0,0,0,.55));
      }
      .cd-tasks-summary strong { color: var(--ink, #051017); font-family: var(--heading); font-weight: 700; }

      .cd-task-group { display: flex; flex-direction: column; gap: 8px; }
      .cd-task-group h4 {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 10.5px; letter-spacing: 1.2px; text-transform: uppercase;
        color: var(--ink-faint, rgba(0,0,0,.55));
        margin: 0 0 4px;
      }
      .cd-task-group h4 span { font-weight: 400; opacity: .7; }

      .cd-task-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
      .cd-task {
        background: var(--bg-elev, #fff);
        border: 1px solid var(--border, rgba(0,0,0,.06));
        border-radius: 10px;
        padding: 12px 14px;
        transition: border-color .15s, transform .15s;
      }
      .cd-task:hover {
        border-color: var(--border-strong, rgba(0,119,182,.2));
        transform: translateX(2px);
      }
      .cd-task-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .cd-task-title {
        font-family: var(--heading); font-weight: 600;
        font-size: 13.5px; color: var(--ink, #051017);
        flex: 1;
      }
      .cd-task-visible { font-size: 14px; color: #00A896; }
      .cd-task-prio {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 9.5px; letter-spacing: .5px; text-transform: uppercase; font-weight: 700;
        padding: 2px 8px; border-radius: 50px;
      }
      .cd-task-prio--high { background: rgba(212,101,74,.12); color: #d4654a; }
      .cd-task-prio--low { background: rgba(0,168,150,.10); color: #006559; }
      .cd-task-desc {
        margin: 6px 0 0; font-size: 12.5px; line-height: 1.5;
        color: var(--ink-faint, rgba(0,0,0,.6));
      }
      .cd-task-meta {
        margin-top: 8px; padding-top: 8px;
        border-top: 1px dashed var(--border, rgba(0,0,0,.05));
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 10.5px; color: var(--ink-faint, rgba(0,0,0,.45));
        display: flex; gap: 10px; flex-wrap: wrap;
      }
    `}} />
  );
}
