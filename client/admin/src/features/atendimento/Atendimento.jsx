import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { useT, useTimeAgo } from "../../i18n/index.jsx";
import "./atendimento.css";

/* ══════════════════════════════════════════════════════════
   ATENDIMENTO — perguntas e mensagens dos canais de venda
   (Mercado Livre, Shopee) com a resposta rascunhada pela IA a
   partir da memória da empresa. Cada correção ou fato ensinado
   aqui vira memória, e a próxima resposta já nasce melhor.
   Servidor: seção ATENDIMENTO do ai-service.
   ══════════════════════════════════════════════════════════ */

const ofetch = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) } })
    .then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok) throw new Error(b?.error || `HTTP ${r.status}`); return b; });
const post = (p, body) => ofetch(p, { method: "POST", body: JSON.stringify(body || {}) });

const NOME = { mercadolivre: "Mercado Livre", shopee: "Shopee", teste: "Teste" };

export function Atendimento({ onGoTo }) {
  const { t } = useT();
  const [filtro, setFiltro] = useState("abertas");
  const [dados, setDados] = useState(null);
  const [sel, setSel] = useState(null);
  const [canais, setCanais] = useState([]);
  const [painel, setPainel] = useState(false);
  const [aviso, setAviso] = useState(null);

  const carregar = useCallback(() => ofetch(`/api/office/atendimento/conversas?status=${filtro}`).then(setDados).catch(() => setDados({ abertas: 0, conversas: [] })), [filtro]);
  const carregarCanais = useCallback(() => ofetch("/api/office/atendimento/canais").then(setCanais).catch(() => setCanais([])), []);

  useEffect(() => { carregar(); const iv = setInterval(carregar, 20_000); return () => clearInterval(iv); }, [carregar]);
  useEffect(() => { carregarCanais(); }, [carregarCanais]);

  // volta do login no canal: ?tab=atendimento&canal=…&ok=1 | &erro=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("tab") !== "atendimento" || !q.get("canal")) return;
    setAviso(q.get("ok") ? { ok: true, txt: t("at.connected", { canal: NOME[q.get("canal")] || q.get("canal") }) } : { ok: false, txt: t(`at.err.${q.get("erro") || "troca"}`) });
    setPainel(true);
    window.history.replaceState({}, "", "/");
  }, [t]);

  const conversas = dados?.conversas || [];
  const atual = useMemo(() => conversas.find((c) => c._id === sel) || null, [conversas, sel]);
  const conectados = canais.filter((c) => c.conectado);

  const novoTeste = async (texto) => {
    const c = await post("/api/office/atendimento/teste", { texto });
    await carregar(); setFiltro((f) => (f === "arquivadas" ? "abertas" : f)); setSel(c._id);
  };

  return (
    <div className="at">
      <header className="at-head">
        <div>
          <h1 className="at-title">{t("at.title")}</h1>
          <p className="at-sub">{t("at.sub")}</p>
        </div>
        <div className="at-head-a">
          <button className="at-btn" onClick={() => setSel("novo-teste")}><Icon name="edit" size={13} />{t("at.test")}</button>
          <button className={`at-btn${painel ? " on" : ""}`} onClick={() => setPainel((v) => !v)}><Icon name="plug" size={13} />{t("at.channels")}</button>
        </div>
      </header>

      <div className="at-strip">
        {canais.map((c) => (
          <button key={c.id} className="at-chip" onClick={() => setPainel(true)}>
            <i className={`at-dot ${c.erro ? "bad" : c.conectado ? "ok" : ""}`} />
            <b>{c.nome}</b>
            <span>{c.erro ? t("at.ch.error") : c.conectado ? `${c.conta?.nome || ""} · ${t(`at.mode.${c.modo}`)}` : t("at.ch.off")}</span>
          </button>
        ))}
        <span className="at-strip-hint">{conectados.length ? t("at.strip.on") : t("at.strip.off")}</span>
      </div>

      {aviso && <div className={`at-aviso ${aviso.ok ? "ok" : "bad"}`}>{aviso.txt}<button onClick={() => setAviso(null)} aria-label={t("common.close")}><Icon name="close" size={12} /></button></div>}

      {painel && <Canais canais={canais} onChange={carregarCanais} onSync={carregar} />}

      <div className="at-main">
        <aside className="at-list">
          <div className="at-tabs" role="tablist">
            {["abertas", "todas", "arquivadas"].map((f) => (
              <button key={f} role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}>
                {t(`at.f.${f}`)}{f === "abertas" && dados?.abertas ? <em>{dados.abertas}</em> : null}
              </button>
            ))}
          </div>
          {dados === null && <div className="at-empty">{t("common.loading")}</div>}
          {dados && conversas.length === 0 && (
            <div className="at-empty">
              <p>{filtro === "abertas" ? t("at.empty.open") : t("at.empty.all")}</p>
              {!conectados.length && <button className="at-link" onClick={() => setSel("novo-teste")}>{t("at.empty.try")}</button>}
            </div>
          )}
          {conversas.map((c) => <Item key={c._id} c={c} on={sel === c._id} onClick={() => setSel(c._id)} />)}
        </aside>

        <section className="at-thread">
          {sel === "novo-teste" ? <NovoTeste onSend={novoTeste} />
            : atual ? <Conversa key={atual._id} conv={atual} onChange={carregar} onGoTo={onGoTo} onTeste={async (texto) => { await post("/api/office/atendimento/teste", { texto, conversa: atual._id }); carregar(); }} />
            : <div className="at-blank"><Icon name="comment" size={22} /><p>{t("at.pick")}</p></div>}
        </section>
      </div>
    </div>
  );
}

function Item({ c, on, onClick }) {
  const ago = useTimeAgo();
  const { t } = useT();
  const ult = c.mensagens?.[c.mensagens.length - 1];
  const aberta = ["nova", "aguardando"].includes(c.status);
  return (
    <button className={`at-item${on ? " on" : ""}${aberta ? " aberta" : ""}`} onClick={onClick}>
      <div className="at-item-h">
        <span className="at-tag">{NOME[c.canal] || c.canal}</span>
        <b>{c.cliente?.nome || c.assunto || t(`at.type.${c.tipo}`)}</b>
        <time>{ago(c.atualizadaEm)}</time>
      </div>
      {c.assunto && c.cliente?.nome && <div className="at-item-s">{c.assunto}</div>}
      <p>{ult?.de === "empresa" ? `${t("at.you")}: ` : ""}{ult?.texto}</p>
      {c.rascunho?.texto && aberta && <span className="at-item-d">{t("at.has_draft", { n: Math.round((c.rascunho.confianca || 0) * 100) })}</span>}
    </button>
  );
}

function NovoTeste({ onSend }) {
  const { t } = useT();
  const [txt, setTxt] = useState("");
  const [voando, setVoando] = useState(false);
  const enviar = async (e) => {
    e.preventDefault(); if (!txt.trim()) return;
    setVoando(true); try { await onSend(txt.trim()); } finally { setVoando(false); }
  };
  return (
    <form className="at-novo" onSubmit={enviar}>
      <h2>{t("at.test.title")}</h2>
      <p>{t("at.test.sub")}</p>
      <textarea autoFocus rows={4} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={t("at.test.ph")} />
      <button className="at-btn at-btn--p" disabled={voando || !txt.trim()}>{voando ? t("at.thinking") : t("at.test.send")}</button>
    </form>
  );
}

function Conversa({ conv, onChange, onGoTo, onTeste }) {
  const { t } = useT();
  const ago = useTimeAgo();
  const r = conv.rascunho;
  const [texto, setTexto] = useState(r?.texto || "");
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [fato, setFato] = useState("");
  const [aprendeu, setAprendeu] = useState(null);
  const [comoCliente, setComoCliente] = useState("");
  const fim = useRef(null);
  const aberta = ["nova", "aguardando"].includes(conv.status);
  const teste = conv.canal === "teste";

  useEffect(() => { setTexto(r?.texto || ""); }, [r?.texto, r?.em]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [conv.mensagens?.length]);

  const rodar = async (qual, fn) => {
    setOcupado(qual); setErro("");
    try { await fn(); await onChange(); } catch (e) { setErro(e.message); } finally { setOcupado(""); }
  };
  const responder = () => rodar("enviar", async () => {
    const res = await post(`/api/office/atendimento/conversas/${conv._id}/responder`, { texto });
    setAprendeu(res.memoria);
  });
  const refazer = () => rodar("refazer", () => post(`/api/office/atendimento/conversas/${conv._id}/rascunho`));
  const ensinar = () => rodar("ensinar", async () => {
    const res = await post(`/api/office/atendimento/conversas/${conv._id}/ensinar`, { fato });
    setFato(""); setAprendeu(res.memoria);
  });
  const arquivar = (v) => rodar("arquivar", () => ofetch(`/api/office/atendimento/conversas/${conv._id}`, { method: "PATCH", body: JSON.stringify({ arquivar: v }) }));
  const falarComoCliente = (e) => { e.preventDefault(); if (!comoCliente.trim()) return; rodar("cliente", async () => { await onTeste(comoCliente.trim()); setComoCliente(""); }); };

  return (
    <div className="at-conv">
      <div className="at-conv-h">
        <div>
          <b>{conv.cliente?.nome || t(`at.type.${conv.tipo}`)}</b>
          <span>{NOME[conv.canal] || conv.canal}{conv.tipo ? ` · ${t(`at.type.${conv.tipo}`)}` : ""}{conv.assunto ? ` · ${conv.assunto}` : ""}</span>
        </div>
        <button className="at-btn at-btn--sm" onClick={() => arquivar(conv.status !== "arquivada")} disabled={!!ocupado}>
          {conv.status === "arquivada" ? t("at.unarchive") : t("at.archive")}
        </button>
      </div>

      <div className="at-msgs">
        {(conv.mensagens || []).map((m) => (
          <div key={m.id} className={`at-msg at-msg--${m.de}`}>
            <p>{m.texto}</p>
            <span>{m.de === "empresa" ? (m.ia ? t("at.sent_auto") : (m.por || "").split("@")[0] || t("at.you")) : t("at.client")} · {ago(m.em)}</span>
          </div>
        ))}
        <div ref={fim} />
      </div>

      {aprendeu && (
        <div className="at-learn">
          <Icon name="bookmark" size={13} />
          <span>{aprendeu.fundida ? t("at.learned_merged") : t("at.learned")} <b>{aprendeu.title || ""}</b></span>
          <button className="at-link" onClick={() => onGoTo?.("memoria")}>{t("at.see_memory")}</button>
          <button className="at-x" onClick={() => setAprendeu(null)} aria-label={t("common.close")}><Icon name="close" size={11} /></button>
        </div>
      )}

      {aberta && (
        <div className="at-draft">
          {r?.erro === "sem_ia" ? (
            <div className="at-warn">
              {t("at.no_ai")} <button className="at-link" onClick={() => onGoTo?.("integrations")}>{t("at.no_ai_cta")}</button>
            </div>
          ) : r?.erro ? <div className="at-warn">{r.erro}</div> : null}

          {r && !r.erro && (
            <div className="at-meta">
              <span className={`at-conf ${r.confianca >= 0.85 ? "alta" : r.confianca >= 0.6 ? "media" : "baixa"}`}>{t("at.confidence", { n: Math.round(r.confianca * 100) })}</span>
              <span>{r.memorias?.length ? t("at.used", { n: r.memorias.length, total: r.consultadas || r.memorias.length }) : t("at.used_none")}</span>
              {r.memorias?.map((m) => <span key={m.id} className="at-mem" title={m.title}>{m.title}</span>)}
            </div>
          )}

          {r?.faltou && (
            <div className="at-gap">
              <div><b>{t("at.gap")}</b> {r.faltou}</div>
              <div className="at-gap-f">
                <input value={fato} onChange={(e) => setFato(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fato.trim() && ensinar()} placeholder={t("at.teach_ph")} />
                <button className="at-btn" onClick={ensinar} disabled={!!ocupado || fato.trim().length < 3}>{ocupado === "ensinar" ? t("at.thinking") : t("at.teach")}</button>
              </div>
            </div>
          )}

          <textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={ocupado === "refazer" ? t("at.thinking") : t("at.reply_ph")} />
          {erro && <div className="at-warn">{erro}</div>}
          <div className="at-draft-a">
            <span className="at-hint">{t("at.learn_hint")}</span>
            <button className="at-btn" onClick={refazer} disabled={!!ocupado}><Icon name="refresh" size={13} />{ocupado === "refazer" ? t("at.thinking") : t("at.redo")}</button>
            <button className="at-btn at-btn--p" onClick={responder} disabled={!!ocupado || !texto.trim()}><Icon name="send" size={13} />{ocupado === "enviar" ? t("at.sending") : teste ? t("at.send_test") : t("at.send")}</button>
          </div>
        </div>
      )}

      {teste && (
        <form className="at-as-client" onSubmit={falarComoCliente}>
          <input value={comoCliente} onChange={(e) => setComoCliente(e.target.value)} placeholder={t("at.as_client")} />
          <button className="at-btn" disabled={!!ocupado || !comoCliente.trim()}>{ocupado === "cliente" ? t("at.thinking") : t("at.test.send")}</button>
        </form>
      )}
    </div>
  );
}

/* ── canais: credenciais, login, modo de resposta ───────────── */
function Canais({ canais, onChange, onSync }) {
  return <div className="at-canais">{canais.map((c) => <Canal key={c.id} c={c} onChange={onChange} onSync={onSync} />)}</div>;
}

function Canal({ c, onChange, onSync }) {
  const { t } = useT();
  const [f, setF] = useState(() => Object.fromEntries(c.campos.map((x) => [x.k, x.valor])));
  const [ocupado, setOcupado] = useState("");
  const [msg, setMsg] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const local = /localhost|127\.0\.0\.1/.test(c.redirect);

  const salvar = (extra) => ofetch(`/api/office/atendimento/canais/${c.id}`, { method: "PATCH", body: JSON.stringify(extra) }).then(onChange);
  const rodar = async (qual, fn) => { setOcupado(qual); setMsg(null); try { await fn(); } catch (e) { setMsg({ ok: false, txt: e.message }); } finally { setOcupado(""); } };
  const conectar = () => rodar("conectar", async () => {
    await salvar({ cfg: f });
    const { url } = await post(`/api/office/atendimento/canais/${c.id}/conectar`);
    window.location.href = url;
  });
  const sincronizar = () => rodar("sync", async () => {
    const r = await post(`/api/office/atendimento/canais/${c.id}/sincronizar`);
    setMsg(r.erro ? { ok: false, txt: r.erro } : { ok: true, txt: t("at.ch.synced", { n: r.novas || 0 }) });
    onChange(); onSync();
  });
  const desconectar = () => rodar("off", async () => { await ofetch(`/api/office/atendimento/canais/${c.id}/conexao`, { method: "DELETE" }); onChange(); });
  const copiar = () => navigator.clipboard?.writeText(c.redirect).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1400); });

  return (
    <div className="at-canal">
      <div className="at-canal-h">
        <b>{c.nome}</b>
        <span className={`at-state ${c.erro ? "bad" : c.conectado ? "ok" : ""}`}>{c.conectado ? t("at.ch.on", { conta: c.conta?.nome || "" }) : t("at.ch.off")}</span>
      </div>
      <p className="at-canal-d">{t(`at.ch.${c.id}.d`)}</p>

      {!c.conectado && (
        <>
          <div className="at-grid">
            {c.campos.map((x) => (
              <label key={x.k} className="at-f"><span>{x.rotulo}</span>
                {x.tipo === "select"
                  ? <select value={f[x.k] || x.padrao} onChange={(e) => setF({ ...f, [x.k]: e.target.value })}>{x.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  : <input type={x.tipo === "secret" ? "password" : "text"} autoComplete="off" value={f[x.k] || ""} onChange={(e) => setF({ ...f, [x.k]: e.target.value })} />}
              </label>
            ))}
          </div>
          <div className="at-redir">
            <span>{t("at.ch.redirect")}</span>
            <code onClick={copiar}>{c.redirect}</code>
            <button className="at-btn at-btn--sm" onClick={copiar}>{copiado ? t("ob.link.copied") : t("ob.link.copy")}</button>
          </div>
          {c.precisaHttps && local && <p className="at-note">{t("at.ch.https")}</p>}
        </>
      )}

      <div className="at-f"><span>{t("at.ch.mode")}</span>
        <div className="seg">
          {["manual", "sugerir", "automatico"].map((m) => <button key={m} type="button" aria-pressed={c.modo === m} onClick={() => salvar({ modo: m })}>{t(`at.mode.${m}`)}</button>)}
        </div>
        <small className="at-help">{t(`at.mode.${c.modo}_d`)}</small>
      </div>
      {c.modo === "automatico" && (
        <label className="at-f"><span>{t("at.ch.threshold", { n: Math.round(c.limiar * 100) })}</span>
          <input type="range" min="0.6" max="0.98" step="0.01" defaultValue={c.limiar} onMouseUp={(e) => salvar({ limiar: Number(e.target.value) })} onTouchEnd={(e) => salvar({ limiar: Number(e.target.value) })} onKeyUp={(e) => salvar({ limiar: Number(e.target.value) })} />
        </label>
      )}
      <label className="at-check"><input type="checkbox" checked={c.aprender} onChange={(e) => salvar({ aprender: e.target.checked })} />{t("at.ch.learn")}</label>

      {c.erro && <p className="at-warn">{c.erro}</p>}
      {msg && <p className={msg.ok ? "at-ok" : "at-warn"}>{msg.txt}</p>}

      <div className="at-canal-a">
        {c.conectado ? (
          <>
            <button className="at-btn" onClick={sincronizar} disabled={!!ocupado}><Icon name="refresh" size={13} />{ocupado === "sync" ? t("at.thinking") : t("at.ch.sync")}</button>
            <button className="at-btn" onClick={desconectar} disabled={!!ocupado}>{t("at.ch.disconnect")}</button>
          </>
        ) : (
          <button className="at-btn at-btn--p" onClick={conectar} disabled={!!ocupado}>{ocupado === "conectar" ? t("at.thinking") : t("at.ch.connect", { canal: c.nome })}</button>
        )}
      </div>
    </div>
  );
}
