import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.js";
import { useT, localeOf } from "../../i18n/index.jsx";
import "./leads.css";

/* ══════════════════════════════════════════════════════════════════════
   LEADS — quem ainda não é cliente.

   Duas origens que se comportam diferente e a tela precisa deixar claro:
   · o que CHEGOU (formulário do site, WhatsApp) — já quis falar com a gente
   · o que a gente FOI BUSCAR (prospecção) — não sabe que existimos ainda

   O caminho é sempre o mesmo: lead → orçamento → proposta → cliente.
   ══════════════════════════════════════════════════════════════════════ */

// admin (leads, orçamento) fala com o server principal via /hq; prospecção é do ai-service
const hq = async (rota, opts = {}) => {
  const r = await fetch(`/hq${rota}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 200));
  return r.json();
};
const office = async (rota, opts = {}) => {
  const r = await fetch(rota, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};

// `key` é traduzido no render; o id é o que vai pro servidor
const STATUS = [
  { id: "new", key: "ld.st.new", cor: "var(--teal)" },
  { id: "contacted", key: "ld.st.contacted", cor: "var(--gold)" },
  { id: "qualified", key: "ld.st.qualified", cor: "var(--info)" },
  { id: "won", key: "ld.st.won", cor: "var(--teal)" },
  { id: "lost", key: "ld.st.lost", cor: "var(--ink-faint)" },
];
const stat = (id) => STATUS.find(s => s.id === id) || { id, key: null, cor: "var(--ink-faint)" };
const statLabel = (t, s) => (s.key ? t(s.key) : (s.id || "?"));

const quando = (ts, t, lang) => {
  if (!ts) return "";
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d === 0) return t("ld.today");
  if (d === 1) return t("ld.yesterday");
  if (d < 30) return `${d}d`;
  return new Date(ts).toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short" });
};

const contato = (l) => l.whatsapp || l.contactValue || l.email || null;
const zap = (l) => (l.whatsapp ? `https://wa.me/${String(l.whatsapp).replace(/\D/g, "")}` : null);

export function Leads() {
  const { t, lang } = useT();
  const [leads, setLeads] = useState(null);
  const [filtro, setFiltro] = useState("");
  const [origem, setOrigem] = useState("");
  const [aberto, setAberto] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [prospec, setProspec] = useState(null); // painel de prospecção aberto
  const [sel, setSel] = useState(() => new Set());
  const marcar = (id, e) => {
    e.stopPropagation();
    setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const carregar = () => hq("/api/admin/leads").then(setLeads).catch(() => setLeads([]));
  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    const h = (e) => { if (e.detail?.tab === "leads") setProspec({ busca: "", regiao: "", fonte: "osm", achados: null }); };
    window.addEventListener("nomade:top-action", h);
    return () => window.removeEventListener("nomade:top-action", h);
  }, []);

  const mudarStatus = async (l, status) => {
    await hq(`/api/admin/leads/${l._id}`, { method: "PATCH", body: JSON.stringify({ status }) }).catch(e => setAviso(e.message));
    carregar();
  };

  const gerarOrcamento = async (l) => {
    setBuscando(true); setAviso("");
    try {
      const r = await hq(`/api/admin/leads/${l._id}/regenerate-quote`, { method: "POST", body: "{}" });
      setAviso(t("ld.msg.quote_ready"));
      await carregar();
      setAberto({ ...l, quote: r.quote });
    } catch (e) {
      setAviso(/no_description/.test(e.message) ? t("ld.msg.no_description") : e.message);
    }
    setBuscando(false);
  };

  const enviarOrcamento = async (l) => {
    setBuscando(true); setAviso("");
    try {
      await hq(`/api/admin/leads/${l._id}/send-quote`, { method: "POST", body: "{}" });
      setAviso(t("ld.msg.quote_sent"));
      carregar();
    } catch (e) {
      setAviso(/no_email/.test(e.message) ? t("ld.msg.no_email") : e.message);
    }
    setBuscando(false);
  };

  /* Excluir é o par do prospectar: uma busca ruim despeja dezenas de nomes na
     base, e sem como desfazer ninguém arrisca prospectar de novo. */
  const excluirSelecionados = async () => {
    const ids = [...sel];
    if (!window.confirm(t("ld.confirm.delete_n", { n: ids.length }))) return;
    setSel(new Set());
    try { await hq("/api/admin/leads/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }); }
    catch (e) { setAviso(e.message); }
    carregar();
  };

  /* Desfaz uma leva inteira: tudo que veio da mesma busca e ninguém tocou
     ainda (status `new`). Quem já foi contatado NÃO entra — o trabalho de
     alguém não some por causa de uma limpeza. */
  const excluirLeva = async (vertical, regiao) => {
    const alvo = (leads || []).filter(l =>
      (l.source === "places" || l.source === "osm") &&
      l.vertical === vertical && (l.regiao || null) === (regiao || null) &&
      (l.status || "new") === "new");
    const intocados = alvo.length;
    const total = (leads || []).filter(l => l.vertical === vertical && (l.regiao || null) === (regiao || null)).length;
    if (!intocados) { setAviso(t("ld.msg.batch_nothing")); return; }
    const extra = total > intocados ? t("ld.confirm.batch_keep", { n: total - intocados }) : "";
    const where = regiao ? t("ld.confirm.batch_in", { r: regiao }) : "";
    if (!window.confirm(t("ld.confirm.batch", { n: intocados, v: vertical, where, extra }))) return;
    try { await hq("/api/admin/leads/bulk-delete", { method: "POST", body: JSON.stringify({ ids: alvo.map(l => l._id) }) }); }
    catch (e) { setAviso(e.message); }
    carregar();
  };

  const virarProposta = async (l) => {
    setBuscando(true); setAviso("");
    try {
      const r = await hq(`/api/admin/leads/${l._id}/promote-to-proposta`, { method: "POST", body: "{}" });
      setAviso(t("ld.msg.promoted", { num: r.numero ? t("ld.msg.promoted_num", { n: r.numero }) : "" }));
      carregar();
    } catch (e) {
      setAviso(/already_promoted/.test(e.message) ? t("ld.msg.already_promoted") : e.message);
    }
    setBuscando(false);
  };

  const lista = useMemo(() => {
    let l = leads || [];
    if (origem === "prospectado") l = l.filter(x => x.source === "places" || x.source === "osm");
    if (origem === "chegou") l = l.filter(x => x.source !== "places" && x.source !== "osm");
    if (filtro) l = l.filter(x => x.status === filtro);
    return l;
  }, [leads, filtro, origem]);

  if (leads === null) return <div className="ld-hint">{t("ld.loading")}</div>;

  const porStatus = Object.fromEntries(STATUS.map(s => [s.id, (leads || []).filter(l => l.status === s.id).length]));
  const buscados = (leads || []).filter(l => l.source === "places" || l.source === "osm");
  const prospectados = buscados.length;

  // as levas: cada busca que trouxe gente vira uma linha que dá pra desfazer
  const levas = [];
  for (const l of buscados) {
    if (!l.vertical) continue;
    const chave = `${l.vertical}|${l.regiao || ""}`;
    let g = levas.find(x => x.chave === chave);
    if (!g) { g = { chave, vertical: l.vertical, regiao: l.regiao || "", total: 0, novos: 0 }; levas.push(g); }
    g.total++;
    if ((l.status || "new") === "new") g.novos++;
  }
  levas.sort((a, b) => b.total - a.total);

  const vazioTitulo = filtro
    ? t("ld.empty.status", { s: statLabel(t, stat(filtro)) })
    : origem ? t("ld.empty.origin") : t("ld.empty.all");

  return (
    <div className="ld">
      <div className="ld-top">
        <div className="ld-filtros">
          <button className={!filtro ? "on" : ""} onClick={() => setFiltro("")}>{t("ld.filter.all")} <em>{leads.length}</em></button>
          {STATUS.map(s => porStatus[s.id] > 0 && (
            <button key={s.id} className={filtro === s.id ? "on" : ""} style={{ "--c": s.cor }} onClick={() => setFiltro(s.id)}>
              {statLabel(t, s)} <em>{porStatus[s.id]}</em>
            </button>
          ))}
        </div>
        <div className="ld-origem">
          <button className={!origem ? "on" : ""} onClick={() => setOrigem("")}>{t("ld.origin.all")}</button>
          <button className={origem === "chegou" ? "on" : ""} onClick={() => setOrigem("chegou")} title={t("ld.origin.inbound_title")}>{t("ld.origin.inbound")}</button>
          <button className={origem === "prospectado" ? "on" : ""} onClick={() => setOrigem("prospectado")} title={t("ld.origin.prospected_title")}>
            {t("ld.origin.prospected")} {prospectados > 0 && <em>{prospectados}</em>}
          </button>
        </div>
        <button className="ld-btn ld-btn--pri" onClick={() => setProspec({ busca: "", regiao: "", fonte: "osm", achados: null })}>
          {t("ld.prospect_btn")}
        </button>
      </div>

      {aviso && <div className="ld-aviso" onClick={() => setAviso("")}>{aviso}<span>×</span></div>}

      {sel.size > 0 && (
        <div className="ld-sel-bar">
          <b>{sel.size}</b> {t(sel.size > 1 ? "ld.sel.selected_pl" : "ld.sel.selected")}
          <button className="ld-btn ld-btn--del" onClick={excluirSelecionados}>{t("ld.act.delete")}</button>
          <button className="ld-btn" onClick={() => setSel(new Set())}>{t("ld.sel.clear")}</button>
        </div>
      )}

      {origem === "prospectado" && levas.length > 0 && (
        <div className="ld-levas">
          <div className="ld-levas-cab">{t("ld.batch.title")}</div>
          {levas.map(g => (
            <div key={g.chave} className="ld-leva">
              <b>{g.vertical}</b>
              {g.regiao && <span className="ld-leva-r">{g.regiao}</span>}
              <span className="ld-leva-n">
                {t(g.total > 1 ? "ld.batch.leads_pl" : "ld.batch.leads", { n: g.total })}
                {g.novos < g.total ? t("ld.batch.worked", { n: g.total - g.novos }) : ""}
              </span>
              <button className="ld-btn ld-btn--del" disabled={!g.novos}
                title={g.novos ? t("ld.batch.del_title", { n: g.novos }) : t("ld.batch.all_worked")}
                onClick={() => excluirLeva(g.vertical, g.regiao || null)}>
                {g.novos > 0 && g.novos < g.total ? t("ld.batch.del_untouched", { n: g.novos }) : t("ld.batch.del_all")}
              </button>
            </div>
          ))}
        </div>
      )}

      {prospec && <Prospeccao estado={prospec} setEstado={setProspec} onImportou={() => { setProspec(null); carregar(); }} setAviso={setAviso} />}

      {lista.length === 0 ? (
        <div className="ld-vazio">
          <b>{vazioTitulo}</b>
          <span>{t("ld.empty.hint")}</span>
        </div>
      ) : (
        <div className="ld-grid">
          {lista.map(l => {
            const s = stat(l.status);
            const buscado = l.source === "places" || l.source === "osm";
            return (
              <div key={l._id} className={`ld-card${aberto?._id === l._id ? " on" : ""}`} onClick={() => setAberto(aberto?._id === l._id ? null : l)}>
                <div className="ld-card-top">
                  <input type="checkbox" className="ld-chk" checked={sel.has(l._id)}
                    onClick={e => marcar(l._id, e)} onChange={() => {}} title={t("ld.card.select")} />
                  {typeof l.score === "number" && (
                    <span className="ld-score" style={{ "--f": l.score / 100 }} title={l.motivo}><i>{l.score}</i></span>
                  )}
                  <b>{l.name || l.company || t("ld.card.no_name")}</b>
                  <span className="ld-st" style={{ "--c": s.cor }}>{statLabel(t, s)}</span>
                </div>
                {l.company && l.company !== l.name && <div className="ld-emp">{l.company}</div>}
                <div className="ld-meta">
                  {contato(l) && <span className="ld-fone">{contato(l)}</span>}
                  {l.site && <a href={l.site} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{t("ld.card.site")}</a>}
                  {buscado && !l.site && <span className="ld-sem">{t("ld.card.no_site")}</span>}
                  <span className="ld-q">{quando(l.createdAt, t, lang)}</span>
                </div>
                {l.motivo && <div className="ld-motivo">{l.motivo}</div>}

                {aberto?._id === l._id && (
                  <div className="ld-aberto" onClick={e => e.stopPropagation()}>
                    {l.msg && <pre className="ld-msg">{l.msg}</pre>}
                    {l.quote && (
                      <div className="ld-quote">
                        <div className="ld-quote-cab">{t("ld.quote.title")} {l.quoteStatus === "sent" ? <em>{t("ld.quote.sent")}</em> : <em>{t("ld.quote.draft")}</em>}</div>
                        <pre>{typeof l.quote === "string" ? l.quote : JSON.stringify(l.quote, null, 2)}</pre>
                      </div>
                    )}
                    <div className="ld-acoes">
                      {zap(l) && <a className="ld-btn" href={zap(l)} target="_blank" rel="noreferrer">WhatsApp ↗</a>}
                      <button className="ld-btn" disabled={buscando} onClick={() => gerarOrcamento(l)}>
                        {l.quote ? t("ld.act.redo_quote") : t("ld.act.make_quote")}
                      </button>
                      {l.quote && l.email && (
                        <button className="ld-btn" disabled={buscando} onClick={() => enviarOrcamento(l)}>{t("ld.act.send_email")}</button>
                      )}
                      {!l.propostaId && (
                        <button className="ld-btn" disabled={buscando} onClick={() => virarProposta(l)}>{t("ld.act.to_proposal")}</button>
                      )}
                      <button className="ld-btn ld-btn--del" onClick={async () => {
                        if (!window.confirm(t("ld.confirm.delete_one", { name: l.name || l.company }))) return;
                        await hq(`/api/admin/leads/${l._id}`, { method: "DELETE" }).catch(e => setAviso(e.message));
                        setAberto(null); carregar();
                      }}>{t("ld.act.delete")}</button>
                      <select className="ld-sel" value={l.status || "new"} onChange={e => mudarStatus(l, e.target.value)}>
                        {STATUS.map(s => <option key={s.id} value={s.id}>{statLabel(t, s)}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Prospecção: mostra antes de gravar. Cada busca custa (no Google) ou pesa
   numa instância comunitária (no OSM), e cada lead ruim custa o tempo de
   quem liga — então ninguém enche a base sem olhar. */
function Prospeccao({ estado, setEstado, onImportou, setAviso }) {
  const { t } = useT();
  const [rodando, setRodando] = useState(false);
  const set = (p) => setEstado(e => ({ ...e, ...p }));

  const buscar = async (importar = false) => {
    if (!estado.busca.trim() || !estado.regiao.trim()) return;
    setRodando(true); setAviso("");
    try {
      const r = await office("/api/office/leads/buscar", {
        method: "POST",
        body: JSON.stringify({ busca: estado.busca.trim(), regiao: estado.regiao.trim(), fonte: estado.fonte, importar, max: 40 }),
      });
      if (importar) {
        setAviso(
          t("ld.imp.new", { n: r.novos })
          + (r.repetidos ? t("ld.imp.dup", { n: r.repetidos }) : "")
          + (r.ignorados ? t("ld.imp.below", { n: r.ignorados }) : "")
        );
        onImportou();
      } else {
        set({ achados: r.leads, scoreMinimo: r.scoreMinimo });
      }
    } catch (e) { setAviso(e.message); }
    setRodando(false);
  };

  const bons = (estado.achados || []).filter(a => a.score >= (estado.scoreMinimo ?? 30)).length;

  return (
    <div className="ld-prosp">
      <div className="ld-prosp-form">
        <input autoFocus placeholder={t("ld.prosp.what_ph")} value={estado.busca}
          onChange={e => set({ busca: e.target.value, achados: null })}
          onKeyDown={e => e.key === "Enter" && buscar(false)} />
        <input placeholder={t("ld.prosp.where_ph")} value={estado.regiao}
          onChange={e => set({ regiao: e.target.value, achados: null })}
          onKeyDown={e => e.key === "Enter" && buscar(false)} />
        <div className="ld-fonte">
          <button className={estado.fonte === "osm" ? "on" : ""} onClick={() => set({ fonte: "osm", achados: null })}
            title={t("ld.prosp.osm_title")}>{t("ld.prosp.osm")}</button>
          <button className={estado.fonte === "places" ? "on" : ""} onClick={() => set({ fonte: "places", achados: null })}
            title={t("ld.prosp.places_title")}>Google</button>
        </div>
        <button className="ld-btn" disabled={rodando || !estado.busca.trim() || !estado.regiao.trim()} onClick={() => buscar(false)}>
          {rodando ? t("ld.prosp.searching") : t("ld.prosp.search")}
        </button>
        <button className="ld-x" onClick={() => setEstado(null)}>×</button>
      </div>

      {estado.achados && (
        <>
          <div className="ld-prosp-res">
            {estado.achados.map((a, i) => (
              <div key={i} className={`ld-achado${a.score >= (estado.scoreMinimo ?? 30) ? "" : " fora"}`}>
                <span className="ld-score" style={{ "--f": a.score / 100 }}><i>{a.score}</i></span>
                <b>{a.nome}</b>
                <span className="ld-achado-c">{a.telefone || <i>{t("ld.prosp.no_phone")}</i>}</span>
                <span className="ld-achado-m">{a.motivo}</span>
              </div>
            ))}
          </div>
          <div className="ld-prosp-foot">
            <span>{t("ld.prosp.found", { n: estado.achados.length })} · <b>{bons}</b> {t("ld.prosp.above_cut")}</span>
            <button className="ld-btn ld-btn--pri" disabled={rodando || !bons} onClick={() => buscar(true)}>
              {t("ld.prosp.save_n", { n: bons })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
