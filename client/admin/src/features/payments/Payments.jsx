import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { useT, useTimeAgo, localeOf } from "../../i18n/index.jsx";
import { dinheiro, simbolo } from "../../lib/regional.js";
import "./payments.css";

/* ══════════════════════════════════════════════════════════
   PAGAMENTOS — nome, e-mail, valor → link. Simples de propósito:
   o fluxo completo (proposta, duas metades, entrega) continua em
   Propostas. Aqui é o "manda o link no WhatsApp e pronto".
   ══════════════════════════════════════════════════════════ */

const moeda = (n, lang) => dinheiro(n, lang);

export function Payments({ onGoTo }) {
  const { t, lang } = useT();
  const ago = useTimeAgo();
  const [lista, setLista] = useState(null);
  const [mp, setMp] = useState(null); // null = não sei · true/false
  const [f, setF] = useState({ nome: "", email: "", desc: "", tipo: "once", valor: "", mensal: "", ciclo: "mensal", metodo: "any" });
  const [criando, setCriando] = useState(false);
  const [criado, setCriado] = useState(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const load = () => {
    api.get("/api/admin/payment-links").then((l) => setLista(Array.isArray(l) ? l : [])).catch(() => setLista([]));
    api.get("/api/admin/payment-links/status").then((s) => setMp(!!s.configured)).catch(() => setMp(null));
  };
  useEffect(load, []);

  const copiar = (url) => navigator.clipboard?.writeText(url).then(() => { setCopiado(url); setTimeout(() => setCopiado(""), 1500); });
  const wa = (l) => `https://wa.me/?text=${encodeURIComponent(t("pay.wa_text", { name: l.name, desc: l.description || "", url: l.url }))}`;

  const criar = async (e) => {
    e.preventDefault();
    setErro(""); setCriando(true);
    const once = f.tipo === "once";
    const body = {
      name: f.nome, email: f.email, description: f.desc,
      buildAmount: once ? Number(f.valor) || 0 : 0,
      monthlyAmount: once ? 0 : Number(f.mensal) || 0,
      // à vista: o ciclo não entra na conta; "anual" só evita o caminho de assinatura
      cycle: once ? "anual" : f.ciclo,
      paymentMethod: f.metodo === "manual" ? "manual" : "card",
    };
    try {
      const r = await api.post("/api/admin/payment-links", body);
      setCriado({ ...r.link, url: r.url });
      setF({ nome: "", email: "", desc: "", tipo: "once", valor: "", mensal: "", ciclo: "mensal", metodo: "any" });
      load();
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(err.message).error; } catch { /* texto cru */ }
      setErro(t(`pay.err.${msg}`) === `pay.err.${msg}` ? t("pay.err.generic", { e: msg }) : t(`pay.err.${msg}`));
    } finally { setCriando(false); }
  };

  const once = f.tipo === "once";
  const metodos = once ? ["any", "manual"] : (f.ciclo === "mensal" ? ["card", "manual"] : ["manual", "any"]);
  const metodoOk = metodos.includes(f.metodo) ? f.metodo : metodos[0];

  return (
    <div className="py">
      <header className="py-head">
        <div><h1 className="py-title">{t("pay.title")}</h1><p className="py-sub">{t("pay.sub")}</p></div>
      </header>

      {mp === false && (
        <div className="py-warn">
          <Icon name="zap" size={15} />
          <span>{t("pay.mp_missing")}</span>
          <button onClick={() => onGoTo?.("integrations")}>{t("pay.mp_connect")} →</button>
        </div>
      )}

      <div className="py-grid">
        <form className="py-card py-form" onSubmit={criar}>
          <h2>{t("pay.new")}</h2>
          <div className="py-row">
            <label className="py-f"><span>{t("pay.f.name")}</span><input value={f.nome} onChange={(e) => set("nome", e.target.value)} required placeholder="João" /></label>
            <label className="py-f"><span>{t("pay.f.email")}</span><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} required placeholder="joao@email.com" /></label>
          </div>
          <label className="py-f"><span>{t("pay.f.desc")}</span><input value={f.desc} onChange={(e) => set("desc", e.target.value)} placeholder={t("pay.f.desc_ph")} /></label>
          <div className="py-f"><span>{t("pay.f.kind")}</span>
            <div className="py-seg">
              <button type="button" aria-pressed={once} onClick={() => set("tipo", "once")}>{t("pay.kind.once")}</button>
              <button type="button" aria-pressed={!once} onClick={() => set("tipo", "monthly")}>{t("pay.kind.monthly")}</button>
            </div>
          </div>
          <div className="py-row">
            {once ? (
              <label className="py-f"><span>{t("pay.f.amount")}</span><div className="py-money"><i>{simbolo(lang)}</i><input type="number" min="1" step="0.01" value={f.valor} onChange={(e) => set("valor", e.target.value)} required placeholder="150" /></div></label>
            ) : (
              <>
                <label className="py-f"><span>{t("pay.f.monthly")}</span><div className="py-money"><i>{simbolo(lang)}</i><input type="number" min="1" step="0.01" value={f.mensal} onChange={(e) => set("mensal", e.target.value)} required placeholder="99" /></div></label>
                <label className="py-f"><span>{t("pay.f.cycle")}</span>
                  <select value={f.ciclo} onChange={(e) => set("ciclo", e.target.value)}>
                    {["mensal", "trimestral", "anual"].map((c) => <option key={c} value={c}>{t(`pay.cycle.${c}`)}</option>)}
                  </select>
                </label>
              </>
            )}
            <label className="py-f"><span>{t("pay.f.method")}</span>
              <select value={metodoOk} onChange={(e) => set("metodo", e.target.value)}>
                {metodos.map((m) => <option key={m} value={m}>{t(`pay.method.${m}`)}</option>)}
              </select>
            </label>
          </div>
          {!once && f.mensal && <p className="py-hint">{t("pay.total_now")}: <b>{moeda(Number(f.mensal) * (f.ciclo === "mensal" ? 1 : f.ciclo === "trimestral" ? 3 : 12), lang)}</b></p>}
          {erro && <p className="py-err">{erro}</p>}
          <button type="submit" className="py-btn py-btn--p" disabled={criando}>{criando ? t("pay.creating") : t("pay.create")} <Icon name="arrow" size={14} /></button>

          {criado && (
            <div className="py-done">
              <div className="py-done-h"><i /> {t("pay.created")}</div>
              <code>{criado.url}</code>
              <div className="py-done-a">
                <button type="button" className="py-btn py-btn--p" onClick={() => copiar(criado.url)}>{copiado === criado.url ? t("pay.copied") : t("pay.copy")}</button>
                <a className="py-btn" href={wa(criado)} target="_blank" rel="noreferrer">{t("pay.whatsapp")}</a>
                <a className="py-btn" href={criado.url} target="_blank" rel="noreferrer">{t("pay.open")} ↗</a>
              </div>
            </div>
          )}
        </form>

        <section className="py-card">
          <h2>{t("pay.list")}</h2>
          {lista === null ? <div className="py-empty">{t("common.loading")}</div> : lista.length === 0 ? <div className="py-empty">{t("pay.empty")}</div> : (
            <div className="py-list">
              {lista.map((l) => (
                <div key={l._id} className={`py-item${l.status === "cancelled" ? " off" : ""}`}>
                  <div className="py-item-b">
                    <b>{l.name} <small>{l.email}</small></b>
                    <span>{l.description || "—"} · {ago(l.createdAt)}</span>
                  </div>
                  <div className="py-item-v">{moeda(l.pricing?.chargeNow ?? l.pricing?.buildAmount, lang)}{l.pricing?.monthlyAmount ? <small>/{t(`pay.cycle.${l.cycle || "mensal"}`)}</small> : null}</div>
                  <span className={`py-pill py-pill--${l.status}`}>{t(`pay.status.${l.status}`)}</span>
                  <div className="py-item-a">
                    <button className="py-ico" title={t("pay.copy")} onClick={() => copiar(l.url)}><Icon name={copiado === l.url ? "check" : "copy"} size={14} /></button>
                    <a className="py-ico" title={t("pay.whatsapp")} href={wa(l)} target="_blank" rel="noreferrer"><Icon name="send" size={14} /></a>
                    {l.status === "open" && <button className="py-ico" title={t("pay.cancel")} onClick={async () => { if (!window.confirm(t("pay.cancel_q"))) return; await api.del(`/api/admin/payment-links/${l._id}`); load(); }}><Icon name="close" size={14} /></button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
