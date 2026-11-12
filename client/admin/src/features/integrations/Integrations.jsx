import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { useT, useTimeAgo } from "../../i18n/index.jsx";
import "./integrations.css";

/* ══════════════════════════════════════════════════════════
   INTEGRAÇÕES — chaves de IA (office_config keys) + catálogo
   de softwares (office_integracoes) + automações. Segredo
   nunca volta inteiro: só máscara.
   ══════════════════════════════════════════════════════════ */

const ofetch = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) } })
    .then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok) throw new Error(b?.error || `HTTP ${r.status}`); return b; });

/* Fallback até /api/office/provedores responder (a lista inteira mora em lib/provedores.js no servidor). */
const AI = [
  { id: "anthropic", nome: "Anthropic", produto: "Claude", prefixo: "sk-ant-…" },
  { id: "openai", nome: "OpenAI", produto: "GPT", prefixo: "sk-…" },
  { id: "gemini", nome: "Google", produto: "Gemini", prefixo: "AIza…" },
];
/* Agentes moram em outro projeto da Nomade. Aqui fica só o plug. */
const RELAY = "https://github.com/LucasUltremare/nomade-ai";
const CATEGORIAS = ["messaging", "email", "payments", "docs", "dev", "automation", "ai"];

// marca monocromática: duas letras num quadrado
const Marca = ({ nome }) => {
  const p = nome.replace(/\(.*\)/, "").trim().split(/\s+/);
  const ini = (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
  return <span className="in-mark">{ini}</span>;
};

export function Integrations() {
  const { t } = useT();
  const [lista, setLista] = useState(null);
  const [keys, setKeys] = useState(null);
  const [aberta, setAberta] = useState(null); // integração no drawer
  const [provs, setProvs] = useState(AI);
  const [erro, setErro] = useState("");

  const load = () => {
    ofetch("/api/office/integracoes").then(setLista).catch((e) => { setLista([]); setErro(e.message); });
    ofetch("/api/office/keys").then((l) => setKeys(Array.isArray(l) ? l : [])).catch(() => setKeys([]));
    ofetch("/api/office/provedores").then((l) => Array.isArray(l) && l.length && setProvs(l)).catch(() => {});
  };
  useEffect(load, []);

  const porCat = (c) => (lista || []).filter((i) => i.categoria === c);

  return (
    <div className="in">
      <header className="in-head">
        <h1 className="in-title">{t("int.title")}</h1>
        <p className="in-sub">{t("int.sub")}</p>
      </header>
      {erro && <div className="in-err">{t("common.error", { e: erro })}</div>}

      <section className="in-sec">
        <div className="in-sec-h"><span className="in-sec-k">01</span><h2>{t("int.cat.ai")}</h2></div>
        <div className="in-grid">
          {provs.map((p) => <CartaoIA key={p.id} meta={p} estado={(keys || []).find((k) => k.provider === p.id)} onChange={load} />)}
          {porCat("ai").map((i) => <Cartao key={i.id} item={i} onOpen={() => setAberta(i)} />)}
        </div>
        <p className="in-hint">{t("int.local.hint")}</p>
      </section>

      <section className="in-sec">
        <div className="in-sec-h"><span className="in-sec-k">+</span><h2>{t("int.plug.title")}</h2></div>
        <a className="in-card in-plug" href={RELAY} target="_blank" rel="noreferrer">
          <span className="in-mark">RE</span>
          <div className="in-card-b">
            <b>Relay <small>{t("int.plug.by")}</small></b>
            <span className="in-plug-d">{t("int.plug.relay")}</span>
          </div>
          <span className="in-card-a">{t("int.plug.open")} <Icon name="external" size={12} /></span>
        </a>
      </section>

      {CATEGORIAS.filter((c) => c !== "ai").map((c, idx) => (
        <section className="in-sec" key={c}>
          <div className="in-sec-h"><span className="in-sec-k">{String(idx + 2).padStart(2, "0")}</span><h2>{t(`int.cat.${c}`)}</h2></div>
          <div className="in-grid">
            {lista === null && <div className="in-empty">{t("common.loading")}</div>}
            {porCat(c).map((i) => <Cartao key={i.id} item={i} onOpen={() => setAberta(i)} />)}
          </div>
        </section>
      ))}

      <Automacoes />

      {aberta && <Drawer item={aberta} onClose={() => setAberta(null)} onChange={(novo) => { setLista((l) => l.map((x) => (x.id === novo.id ? novo : x))); setAberta(novo); }} onRemoved={() => { setAberta(null); load(); }} />}
    </div>
  );
}

function Cartao({ item, onOpen }) {
  const { t } = useT();
  const ok = item.ultimoTeste?.ok;
  return (
    <button className={`in-card${item.conectada ? " on" : ""}`} onClick={onOpen}>
      <Marca nome={item.nome} />
      <div className="in-card-b">
        <b>{item.nome}</b>
        <span className={`in-status${item.conectada ? " on" : ""}${item.conectada && ok === false ? " bad" : ""}`}><i />{item.conectada ? t("int.connected") : t("int.not_connected")}</span>
      </div>
      <span className="in-card-a">{item.conectada ? t("int.manage") : t("int.connect")} <Icon name="arrow" size={12} /></span>
    </button>
  );
}

/* ── chave de IA (API existente /api/office/keys) ─────────── */
function CartaoIA({ meta, estado, onChange }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [voando, setVoando] = useState("");
  const [msg, setMsg] = useState(null);
  const conectada = !!estado?.conectada;

  const salvar = async () => {
    if (!draft.trim()) return;
    setVoando("save"); setMsg(null);
    try { await ofetch("/api/office/keys", { method: "PATCH", body: JSON.stringify({ [meta.id]: draft.trim() }) }); setDraft(""); setMsg({ ok: true, txt: t("int.saved") }); onChange(); testar(); }
    catch (e) { setMsg({ ok: false, txt: e.message }); }
    finally { setVoando(""); }
  };
  const testar = async () => {
    setVoando("test");
    try { const r = await ofetch(`/api/office/keys/${meta.id}/testar`, { method: "POST", body: JSON.stringify(draft.trim() ? { chave: draft.trim() } : {}) }); setMsg({ ok: r.ok, txt: r.ok ? `${t("int.tested_ok")} · ${r.modelo}` : r.erro }); }
    catch (e) { setMsg({ ok: false, txt: e.message }); }
    finally { setVoando(""); }
  };
  const desconectar = async () => {
    if (!window.confirm(t("int.disconnect_q", { name: `${meta.nome} ${meta.produto}` }))) return;
    await ofetch("/api/office/keys", { method: "PATCH", body: JSON.stringify({ [meta.id]: "" }) }).catch(() => {});
    setMsg(null); onChange();
  };

  return (
    <div className={`in-card in-card--ai${conectada ? " on" : ""}${open ? " open" : ""}`}>
      <button className="in-card-top" onClick={() => setOpen((v) => !v)}>
        <Marca nome={meta.nome} />
        <div className="in-card-b">
          <b>{meta.nome} <small>{meta.produto}</small></b>
          <span className={`in-status${conectada ? " on" : ""}`}><i />{conectada ? `${t("int.connected")} · ${estado.mascara || ""}` : t("int.not_connected")}</span>
        </div>
        <span className="in-card-a">{conectada ? t("int.manage") : t("int.connect")} <Icon name="chevron" size={12} /></span>
      </button>
      {open && (
        <div className="in-card-body">
          <p>{t(`int.ai.${meta.id}`) === `int.ai.${meta.id}` ? t("int.ai.generic", { p: `${meta.nome} ${meta.produto}` }) : t(`int.ai.${meta.id}`)}
            {meta.site && <> · <a href={meta.site} target="_blank" rel="noreferrer">{t("int.ai.get_key")} ↗</a></>}
            {estado?.origem && <em> · {t(`int.ai.origin.${estado.origem}`)}</em>}</p>
          <div className="in-row">
            <input type="password" autoComplete="off" spellCheck="false" value={draft} onChange={(e) => { setDraft(e.target.value); setMsg(null); }} placeholder={conectada ? t("int.ai.paste_other", { p: meta.prefixo }) : t("int.ai.paste", { p: meta.prefixo })} />
            <button className="in-btn in-btn--p" onClick={salvar} disabled={!!voando || !draft.trim()}>{voando === "save" ? t("int.saving") : t("int.save")}</button>
            <button className="in-btn" onClick={testar} disabled={!!voando || (!conectada && !draft.trim())}>{voando === "test" ? t("int.testing") : t("int.test")}</button>
            {conectada && <button className="in-btn in-btn--d" onClick={desconectar} disabled={!!voando}>{t("int.disconnect")}</button>}
          </div>
          {msg && <div className={`in-msg${msg.ok ? " ok" : " bad"}`}><Icon name={msg.ok ? "check" : "close"} size={12} /> {msg.txt}</div>}
        </div>
      )}
    </div>
  );
}

/* ── drawer de uma integração do catálogo ─────────────────── */
function Drawer({ item, onClose, onChange, onRemoved }) {
  const { t } = useT();
  const ago = useTimeAgo();
  const [draft, setDraft] = useState({});
  const [voando, setVoando] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => { setDraft({}); setMsg(null); }, [item.id]);
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const corpo = () => Object.fromEntries(Object.entries(draft).filter(([, v]) => String(v).trim() !== ""));

  const salvar = async () => {
    setVoando("save"); setMsg(null);
    try { onChange(await ofetch(`/api/office/integracoes/${item.id}`, { method: "PATCH", body: JSON.stringify(corpo()) })); setDraft({}); setMsg({ ok: true, txt: t("int.saved") }); }
    catch (e) { setMsg({ ok: false, txt: e.message }); }
    finally { setVoando(""); }
  };
  const testar = async () => {
    setVoando("test"); setMsg(null);
    try { const r = await ofetch(`/api/office/integracoes/${item.id}/testar`, { method: "POST", body: JSON.stringify(corpo()) }); setMsg({ ok: r.ok, txt: r.texto }); }
    catch (e) { setMsg({ ok: false, txt: e.message }); }
    finally { setVoando(""); }
  };
  const remover = async () => {
    if (!window.confirm(t("int.disconnect_q", { name: item.nome }))) return;
    await ofetch(`/api/office/integracoes/${item.id}`, { method: "DELETE" }).catch(() => {});
    onRemoved();
  };

  return (
    <div className="in-drawer-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="in-drawer" role="dialog" aria-modal="true">
        <div className="in-drawer-h">
          <Marca nome={item.nome} />
          <div><b>{item.nome}</b><span>{item.sub ? `${item.sub} · ` : ""}{t(`int.cat.${item.categoria}`)}</span></div>
          <button className="in-x" onClick={onClose} aria-label={t("common.close")}><Icon name="close" size={16} /></button>
        </div>
        <div className="in-drawer-b">
          {item.campos.map((c) => (
            <label className="in-f" key={c.k}>
              <span>{c.rotulo}</span>
              {c.k === "env" ? (
                <textarea rows={3} value={draft[c.k] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [c.k]: e.target.value }))} placeholder={item.config?.[c.k] ? `•••• (${t("int.connected").toLowerCase()})` : c.placeholder || ""} spellCheck="false" />
              ) : (
                <input type={c.tipo === "secret" ? "password" : "text"} autoComplete="off" spellCheck="false" value={draft[c.k] ?? (c.tipo === "secret" ? "" : item.config?.[c.k] ?? "")} onChange={(e) => setDraft((d) => ({ ...d, [c.k]: e.target.value }))} placeholder={c.tipo === "secret" && item.config?.[c.k] ? item.config[c.k] : c.placeholder || ""} />
              )}
            </label>
          ))}
          <div className="in-row">
            <button className="in-btn in-btn--p" onClick={salvar} disabled={!!voando || !Object.keys(corpo()).length}>{voando === "save" ? t("int.saving") : t("int.save")}</button>
            <button className="in-btn" onClick={testar} disabled={!!voando || (!item.conectada && !Object.keys(corpo()).length)}>{voando === "test" ? t("int.testing") : t("int.test")}</button>
            {item.conectada && <button className="in-btn in-btn--d" onClick={remover} disabled={!!voando}>{t("int.disconnect")}</button>}
          </div>
          {msg && <div className={`in-msg${msg.ok ? " ok" : " bad"}`}><Icon name={msg.ok ? "check" : "close"} size={12} /> {msg.txt}</div>}
          {item.conectada && (
            <div className="in-meta">
              {item.ultimoTeste && <span>{t("int.last_test")}: {item.ultimoTeste.ok ? t("int.tested_ok") : t("int.tested_fail")} · {ago(item.ultimoTeste.em)}</span>}
              {item.por && <span>{t("int.by")} {String(item.por).split("@")[0]}{item.conectadaEm ? ` · ${ago(item.conectadaEm)}` : ""}</span>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ── automações (gatilhos) ────────────────────────────────── */
function Automacoes() {
  const { t } = useT();
  const [cfg, setCfg] = useState(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { ofetch("/api/office/gatilhos").then(setCfg).catch(() => setCfg(null)); }, []);
  const patch = async (campo) => { setSalvando(true); try { setCfg(await ofetch("/api/office/gatilhos", { method: "PATCH", body: JSON.stringify(campo) })); } finally { setSalvando(false); } };
  if (!cfg) return null;
  const Sw = ({ on, onClick, label }) => <button type="button" className={`in-sw${on ? " on" : ""}`} aria-pressed={on} aria-label={label} disabled={salvando} onClick={onClick}><i /></button>;
  return (
    <section className="in-sec">
      <div className="in-sec-h"><span className="in-sec-k">08</span><h2>{t("int.auto.title")}</h2></div>
      <p className="in-sub" style={{ marginBottom: 14 }}>{t("int.auto.sub")}</p>
      <div className="in-auto">
        <Sw on={!!cfg.leadTriagem} label={t("int.auto.lead")} onClick={() => patch({ leadTriagem: !cfg.leadTriagem })} />
        <div><b>{t("int.auto.lead")}</b><p>{t("int.auto.lead_d")}</p></div>
      </div>
      <div className="in-auto">
        <Sw on={!!cfg.rotinaDiaria} label={t("int.auto.daily")} onClick={() => patch({ rotinaDiaria: !cfg.rotinaDiaria })} />
        <div>
          <b>{t("int.auto.daily")}</b><p>{t("int.auto.daily_d")}</p>
          {cfg.rotinaDiaria && (
            <div className="in-hora">
              <span>{t("int.auto.from")}</span>
              <select value={cfg.horaRotina} disabled={salvando} onChange={(e) => patch({ horaRotina: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
              <em>{cfg.ultimaRotina ? `${t("int.auto.last")}: ${cfg.ultimaRotina}` : t("int.auto.never")}</em>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
