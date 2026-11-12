import { useEffect, useRef, useState } from "react";
import { LogoMark } from "../../components/Logo.jsx";
import { api } from "../../api/client.js";
import { deptCor, deptLabel, tipoLabel } from "./Office.jsx";
import { useT } from "../../i18n/index.jsx";
import "./chat.css";

/* ══════════════════════════════════════════════════════════
   CHAT — o sócio fala com o orquestrador da empresa.
   Não é chatbot: é a mesa de comando. Hero → timeline de
   trabalho → resposta → card de passos (tarefas + decisões).
   Design: console dark near-black (tokens.css, Inter).
   ══════════════════════════════════════════════════════════ */

const authHeaders = () => ({ Authorization: `Bearer ${api.token()}` });
const ofetch = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers || {}) } })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });

/* avatar do orquestrador: a marca, pulsando enquanto ele pensa (chat.css .oc-mark-nb) */
const Wave = ({ size = 32, thinking = false }) => (
  <span className={`oc-mark-nb${thinking ? " thinking" : ""}`} style={{ display: "inline-flex" }}>
    <LogoMark size={size} />
  </span>
);

/* opções da decisão — o servidor manda [{label,valor}]; aceita string solta */
const opcoesDe = (dec) => (dec?.opcoes || [])
  .map(o => (typeof o === "string" ? { label: o, valor: o } : o))
  .filter(o => o?.label);

/* ── decisão resolvível DENTRO do chat ──────────────────────────────
   Igual permissão do Claude Code: o sócio aprova / ajusta / assume aqui,
   sem desvio pro Inbox. O PATCH grava o recado 'sistema' na conversa e a
   AUTO-RETOMADA (efeito lá embaixo) faz o orquestrador seguir sozinho.
   NUNCA disparar turno daqui. */
function DecisaoBloco({ dec, resolvidaTipo, estado, onResolver, onGoTo }) {
  const { t } = useT();
  const [ajuste, setAjuste] = useState(null); // string = modo ajuste aberto
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  /* trava síncrona: `disabled` e `salvando` só valem depois do re-render,
     então dois cliques no mesmo frame passariam os dois pelo PATCH (e o
     servidor gravaria DOIS recados 'sistema' → duas retomadas). */
  const enviandoRef = useRef(false);

  const resolver = async (tipo, resolucao) => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setSalvando(true);
    setErro("");
    try {
      await onResolver(dec, tipo, resolucao);
      /* sucesso: o pai marca em decResolvidas e este bloco vira "resolvida ·
         tipo" — não reabilita os botões pra não piscar acionável de novo. */
    } catch (e) {
      enviandoRef.current = false;
      setErro(t("chat.dec.fail", { e: String(e?.message || e) }));
      setSalvando(false);
    }
  };

  if (resolvidaTipo) return <div className="oc-decstate">{t("chat.dec.resolved_tipo", { tipo: tipoLabel(t, resolvidaTipo) })}</div>;

  if (!dec) {
    if (estado === "carregando") return <div className="oc-decstate wait">{t("chat.dec.checking")}</div>;
    if (estado === "erro") return (
      <div className="oc-decstate err">
        {t("chat.dec.check_fail")}
        <button type="button" className="oc-declink" onClick={() => onGoTo?.("inbox")}>{t("chat.dec.open_queue")}</button>
      </div>
    );
    return <div className="oc-decstate">{t("chat.dec.resolved")}</div>;
  }

  const ops = opcoesDe(dec);
  const sugerida = (op) => dec.sugestao && (op.valor === dec.sugestao || op.label === dec.sugestao);

  return (
    <div className="oc-decbox">
      <div className="oc-decq">{dec.pergunta}</div>
      {dec.contexto ? <p className="oc-decctx">{dec.contexto}</p> : null}
      {dec.sugestao ? <p className="oc-decsug"><b>{t("chat.dec.suggestion")}</b> {dec.sugestao}</p> : null}

      {ajuste !== null ? (
        <div className="oc-decform">
          <textarea
            autoFocus
            rows={2}
            className="oc-decta"
            placeholder={t("chat.dec.adjust_ph")}
            value={ajuste}
            disabled={salvando}
            onChange={e => setAjuste(e.target.value)}
          />
          <div className="oc-decacts">
            <button type="button" className="oc-dbtn go" disabled={salvando || !ajuste.trim()} onClick={() => resolver("ajustar", ajuste)}>{t("chat.dec.send_adjust")}</button>
            <button type="button" className="oc-dbtn" disabled={salvando} onClick={() => setAjuste(null)}>{t("chat.dec.cancel")}</button>
          </div>
        </div>
      ) : (
        <div className="oc-decacts">
          {ops.map((op, i) => (
            <button key={i} type="button" className={`oc-dbtn${sugerida(op) ? " go" : ""}`} disabled={salvando} onClick={() => resolver("aprovar", op.valor)}>
              {op.label}
            </button>
          ))}
          {ops.length === 0 && (
            <button type="button" className="oc-dbtn go" disabled={salvando} onClick={() => resolver("aprovar", dec.sugestao || "aprovado")}>
              {dec.sugestao ? t("chat.dec.approve_sug") : t("chat.dec.approve")}
            </button>
          )}
          <button type="button" className="oc-dbtn" disabled={salvando} onClick={() => { setErro(""); setAjuste(""); }}>{t("chat.dec.adjust")}</button>
          <button type="button" className="oc-dbtn" disabled={salvando} onClick={() => resolver("assumir", "assumida pelo sócio")}>{t("chat.dec.take")}</button>
          <button type="button" className="oc-declink" onClick={() => onGoTo?.("inbox")}>{t("chat.dec.open_queue")}</button>
        </div>
      )}

      {salvando ? <div className="oc-decnote">{t("chat.dec.resolving")}</div> : null}
      {erro ? <div className="oc-decnote err">{erro}</div> : null}
    </div>
  );
}

/* card de passos — o que o orquestrador criou de verdade.
   tarefa = card no kanban · decisao = bloco acionável · memoria = registro */
function PassosCard({ passos, onGoTo, decAbertas, decResolvidas, decEstado, onResolver }) {
  const { t } = useT();
  const decisoes = passos.filter(p => p.tipo === "decisao");
  const pendentes = decisoes.filter(p => decAbertas?.[p.refId] && !decResolvidas?.[p.refId]).length;
  const temTarefa = passos.some(p => p.tipo === "tarefa");
  const temSquad = passos.some(p => p.tipo === "squad");

  return (
    <div className="oc-passos">
      <div className="oc-passos-head">
        <span>{t("chat.steps.title")}</span>
        <span>{passos.length}{decisoes.length > 0 ? ` · ${decisoes.length} ${decisoes.length > 1 ? t("chat.steps.decn") : t("chat.steps.dec1")}` : ""}</span>
      </div>

      {passos.map((p, i) => {
        const dec = p.tipo === "decisao" ? decAbertas?.[p.refId] : null;
        const resolvidaTipo = p.tipo === "decisao" ? decResolvidas?.[p.refId] : null;
        const aberta = p.tipo === "decisao" && !!dec && !resolvidaTipo;
        return (
          <div key={i} className={`oc-pitem${p.tipo === "decisao" ? " decision" : ""}${aberta ? " open" : ""}`}>
            <div className="oc-prow">
              <span className="oc-dot" style={{ background: deptCor(p.dept) }} />
              <span className="oc-dept">{deptLabel(t, p.dept) || "—"}</span>
              {/* decisão aberta: a pergunta aparece inteira no bloco abaixo,
                  então a linha não repete o resumo */}
              <span className="oc-nm" title={p.resumo}>{aberta ? t("chat.steps.needs_you") : p.resumo}</span>
              {p.tipo === "tarefa" && p.agent ? <span className="oc-pmeta" title={p.agent}>· {p.agent}</span> : null}
              {p.tipo === "tarefa" && p.cliente ? <span className="oc-pmeta" title={p.cliente}>· {p.cliente}</span> : null}
              {p.tipo === "tarefa" && (
                <span className={`oc-stt${p.jaExistia ? "" : " ok"}`}>{p.jaExistia ? t("chat.steps.existed") : t("chat.steps.card")}</span>
              )}
              {p.tipo === "memoria" && <span className="oc-stt">{t("chat.steps.memory")}</span>}
              {p.tipo === "squad" && <span className="oc-stt ok">{t("chat.steps.hired")}</span>}
              {p.tipo === "imagem" && <span className={`oc-stt${p.erro ? " warn" : " ok"}`}>{p.erro ? t("chat.steps.img_fail") : t("chat.steps.img")}</span>}
              {p.tipo === "decisao" && <span className={`oc-stt${aberta ? " warn" : ""}`}>{t("chat.steps.decision")}</span>}
            </div>
            {p.tipo === "imagem" && p.url && (
              <a className="oc-img" href={p.url} target="_blank" rel="noreferrer" title={t("chat.steps.open_img")}>
                <img src={p.url} alt={p.resumo} loading="lazy" />
              </a>
            )}
            {p.tipo === "decisao" && (
              <DecisaoBloco
                dec={dec}
                resolvidaTipo={resolvidaTipo}
                estado={decEstado}
                onResolver={onResolver}
                onGoTo={onGoTo}
              />
            )}
          </div>
        );
      })}

      <div className="oc-passfoot">
        {temTarefa && <button type="button" className="oc-pbtn" onClick={() => onGoTo?.("tasks")}>{t("chat.steps.see_kanban")}</button>}
        {temSquad && <button type="button" className="oc-pbtn" onClick={() => onGoTo?.("organograma")}>{t("chat.steps.see_org")}</button>}
        <button type="button" className="oc-pbtn" onClick={() => onGoTo?.("activity")}>{t("chat.steps.see_activity")}</button>
        {pendentes > 0 && (
          <button type="button" className="oc-declink" onClick={() => onGoTo?.("inbox")}>{t("chat.dec.open_queue")}</button>
        )}
      </div>
    </div>
  );
}

/* recado do sistema — a decisão que o sócio resolveu volta pro thread.
   Não é bolha de ninguém: é um card à parte, faixa coral. */
function SistemaCard({ msg }) {
  const { t } = useT();
  const d = msg.decisao || {};
  return (
    <div className="oc-sysmsg">
      <span className="oc-sysic" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
          <path d="M5 3v8a4 4 0 004 4h6" />
          <path d="M13 11l4 4-4 4" />
        </svg>
      </span>
      <div className="oc-sysbody">
        <div className="oc-syshead">{t("chat.sys.title")}{d.tipo ? ` · ${tipoLabel(t, d.tipo)}` : ""}</div>
        <div className="oc-systxt">{d.pergunta || msg.texto}</div>
        {d.resolucao ? <div className="oc-sysres">→ {d.resolucao}</div> : null}
      </div>
    </div>
  );
}

/* seletor do orquestrador — provider + modelo, troca em runtime */
function OrqSelector({ info, setInfo, compact = false }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vivos, setVivos] = useState({});   // provider → modelos ao vivo
  const [busca, setBusca] = useState("");
  const wrapRef = useRef(null);

  /* Abriu o menu: puxa do provedor TODOS os modelos que a chave enxerga. */
  useEffect(() => {
    if (!open || !info?.options) return;
    info.options.filter(o => o.conectado && !vivos[o.provider]).forEach(o => {
      ofetch(`/api/office/modelos/${o.provider}`).then(r => setVivos(v => ({ ...v, [o.provider]: r.modelos || [] }))).catch(() => {});
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!info) return null;
  const provLabel = info.options?.find(o => o.provider === info.provider)?.label || info.provider;

  const pick = async (provider, model) => {
    if (saving) return;
    if (provider === info.provider && model === info.model) { setOpen(false); return; }
    setSaving(true);
    setErr(false);
    try {
      const res = await ofetch("/api/office/orq-info", { method: "PATCH", body: JSON.stringify({ provider, model }) });
      setInfo(prev => ({ ...prev, ...res }));
      setOpen(false);
    } catch {
      setErr(true);
    }
    setSaving(false);
  };

  return (
    <div className={`oc-orqsel${compact ? " compact" : ""}`} ref={wrapRef}>
      <button type="button" className="oc-orqbtn" aria-expanded={open} onClick={() => { setErr(false); setOpen(v => !v); }}>
        <span>{t("chat.orq.label", { p: provLabel })}</span>
        <span className="oc-orqmdl">— {info.model}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="13" height="13" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {err && <span className="oc-orqerr">{t("chat.orq.err")}</span>}
      {open && (
        <div className="oc-orqmenu" role="listbox">
          <form className="oc-orqfind" onSubmit={(e) => { e.preventDefault(); const m = busca.trim(); if (m) pick(info.provider, m); }}>
            <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t("chat.orq.find")} spellCheck="false" />
          </form>
          {[...(info.options || [])].sort((a, b) => (b.conectado ? 1 : 0) - (a.conectado ? 1 : 0)).map(opt => (
            <div key={opt.provider} className={`oc-orqgroup${opt.conectado === false ? " off" : ""}`}>
              <div className="oc-orqprov">{opt.label}{opt.conectado === false && <em>{t("chat.orq.no_key")}</em>}</div>
              {opt.conectado !== false && (vivos[opt.provider] || opt.models || []).filter(m => !busca.trim() || m.toLowerCase().includes(busca.trim().toLowerCase())).map(m => {
                const on = opt.provider === info.provider && m === info.model;
                return (
                  <button key={m} type="button" role="option" aria-selected={on} className={`oc-orqopt${on ? " on" : ""}`} disabled={saving} onClick={() => pick(opt.provider, m)}>
                    <i /><span>{m}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Chat({ me, onGoTo }) {
  const { t } = useT();
  const [convs, setConvs] = useState([]);
  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); // { steps:[{t,done}], answer }
  const [showConvs, setShowConvs] = useState(false);
  const [orqInfo, setOrqInfo] = useState(null);
  const [squads, setSquads] = useState([]);
  const [mention, setMention] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [anexos, setAnexos] = useState([]);      // material de apoio temporário
  const [anexoErro, setAnexoErro] = useState("");
  const fileRef = useRef(null);
  const [convErr, setConvErr] = useState("");
  const [decAbertas, setDecAbertas] = useState({});     // id → decisão aberta
  const [decResolvidas, setDecResolvidas] = useState({}); // id → tipo (resolvida nesta sessão)
  const [decEstado, setDecEstado] = useState("carregando"); // carregando | ok | erro
  const [drawerErr, setDrawerErr] = useState("");
  const [apagando, setApagando] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const dockRef = useRef(null);
  const stageRef = useRef(null);
  /* recados já retomados — impede disparar o mesmo lote duas vezes */
  const retomadosRef = useRef(new Set());
  const busyRef = useRef(false);

  const nome = (me?.name || t("chat.partner")).split(" ")[0];
  const initials = nome.slice(0, 2).toUpperCase();
  const thread = msgs.length > 0 || live !== null || carregando;

  useEffect(() => { busyRef.current = busy; }, [busy]);

  /* quantas decisões DESTA conversa ainda estão abertas — segura a retomada
     até o sócio responder todas (e o thread avisa quantas faltam) */
  const decisoesPendentes = conv
    ? Object.values(decAbertas || {}).filter(d => d.conversaId === conv.id).length
    : 0;
  // já resolveu alguma do lote? então tem retomada represada esperando o resto
  const temRecadoPendente = msgs.some(m => m.autor === "sistema" && m.consumida === false);

  const loadConvs = () => ofetch("/api/office/conversas").then(setConvs).catch(() => {});

  /* decisões abertas — mapa por id. O PassosCard usa isso pra saber se ainda
     dá pra resolver aquele passo aqui dentro (ou se já foi resolvido). */
  const loadDecisoes = () =>
    ofetch("/api/office/decisions?status=aberta")
      .then(list => {
        setDecAbertas(Object.fromEntries((Array.isArray(list) ? list : []).map(d => [d.id, d])));
        setDecEstado("ok");
      })
      .catch(() => setDecEstado("erro"));

  useEffect(() => {
    loadConvs();
    loadDecisoes();
    ofetch("/api/office/orq-info").then(setOrqInfo).catch(() => {});
    ofetch("/api/office/agents").then(setSquads).catch(() => {});
  }, []);

  /* o dock cresce (textarea, menções, erro do seletor) — o thread reserva
     exatamente a altura dele pra nunca esconder o último card. */
  useEffect(() => {
    const el = dockRef.current;
    const stage = stageRef.current;
    if (!el || !stage) return;
    const apply = () => stage.style.setProperty("--oc-dock-h", `${el.offsetHeight}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [thread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, live]);

  /* objetivo digitado na caixa do Overview cai aqui pronto pra enviar */
  useEffect(() => {
    const pre = sessionStorage.getItem("orq-prefill");
    if (pre) {
      sessionStorage.removeItem("orq-prefill");
      setInput(pre);
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, []);

  const loadAnexos = (cid) =>
    ofetch(`/api/office/conversas/${cid}/anexos`).then(setAnexos).catch(() => setAnexos([]));

  /* lê o arquivo como TEXTO — o que serve de contexto é o conteúdo, não o
     binário. Formato que não é texto a gente recusa dizendo o porquê. */
  const anexar = async (file) => {
    setAnexoErro("");
    if (!file) return;
    let alvo = conv;
    if (!alvo) {
      alvo = await ofetch("/api/office/conversas", { method: "POST", body: "{}" }).catch(() => null);
      if (!alvo) return setAnexoErro(t("chat.attach.conv_fail"));
      setConv(alvo);
      setConvs(prev => [alvo, ...prev]);
    }
    if (file.size > 400_000) return setAnexoErro(t("chat.attach.too_big"));
    const ehTexto = /^text\/|json|csv|markdown|javascript|typescript|xml|yaml/.test(file.type) ||
      /\.(md|txt|json|csv|ya?ml|js|jsx|ts|tsx|py|sql|env|sh|html|css)$/i.test(file.name);
    if (!ehTexto) return setAnexoErro(t("chat.attach.text_only", { name: file.name }));
    try {
      const conteudo = await file.text();
      const novo = await ofetch(`/api/office/conversas/${alvo.id}/anexos`, {
        method: "POST",
        body: JSON.stringify({ nome: file.name, conteudo }),
      });
      setAnexos(prev => [novo, ...prev]);
    } catch (e) {
      setAnexoErro(t("chat.attach.fail", { e: String(e?.message || e) }));
    }
  };

  const removerAnexo = async (a) => {
    setAnexos(prev => prev.filter(x => x.id !== a.id));
    await ofetch(`/api/office/anexos/${a.id}`, { method: "DELETE" }).catch(() => {});
  };

  const openConv = async (c) => {
    setConv(c);
    setShowConvs(false);
    setMsgs([]);          // limpa antes de buscar: msgs da conversa anterior não podem
    setLive(null);        // vazar pro efeito de auto-retomada da nova conversa
    setConvErr("");
    setCarregando(true);
    try {
      setMsgs(await ofetch(`/api/office/conversas/${c.id}/mensagens`));
      loadAnexos(c.id);
    } catch (err) {
      setConvErr(t("chat.conv.load_fail", { e: String(err?.message || err) }));
    }
    setCarregando(false);
  };

  const novaConversa = () => {
    setAnexos([]); setAnexoErro("");
    setConv(null);
    setMsgs([]);
    setShowConvs(false);
    setInput("");
    setConvErr("");
    setCarregando(false);
    inputRef.current?.focus();
  };

  const apagarConv = async (c) => {
    if (busy && conv?.id === c.id) {
      setDrawerErr(t("chat.conv.wait_delete"));
      return;
    }
    if (!window.confirm(t("chat.conv.delete_confirm", { title: c.titulo || t("chat.conv.untitled") }))) return;
    setDrawerErr("");
    setApagando(c.id);
    try {
      await ofetch(`/api/office/conversas/${c.id}`, { method: "DELETE" });
      setConvs(prev => prev.filter(x => x.id !== c.id));
      if (conv?.id === c.id) {           // era a aberta: volta pro hero
        setConv(null);
        setMsgs([]);
        setLive(null);
        setConvErr("");
        setCarregando(false);
      }
      loadConvs();
    } catch (err) {
      setDrawerErr(t("chat.conv.delete_fail", { e: String(err?.message || err) }));
    }
    setApagando(null);
  };

  /* puxa recados 'sistema' inéditos — é o que o poll faz, exposto pra
     rodar na hora depois de resolver uma decisão aqui dentro. Só busca
     mensagem: quem dispara o turno é a auto-retomada, nunca isto. */
  const puxarSistema = (cid) => {
    if (!cid || busyRef.current) return;
    ofetch(`/api/office/conversas/${cid}/mensagens`)
      .then(list => {
        if (!Array.isArray(list) || busyRef.current) return; // turno começou no meio
        setMsgs(prev => {
          const vistos = new Set(prev.map(m => m.id));
          const novos = list.filter(m => m.autor === "sistema" && !vistos.has(m.id));
          return novos.length ? [...prev, ...novos] : prev;
        });
      })
      .catch(() => {});
  };

  /* resolve a decisão sem sair do chat. O servidor grava o recado 'sistema';
     puxamos ele na hora e a AUTO-RETOMADA continua a conversa sozinha. */
  const resolverDecisao = async (dec, tipo, resolucao) => {
    try {
      await ofetch(`/api/office/decisions/${dec.id}`, {
        method: "PATCH",
        body: JSON.stringify({ tipo, resolucao }),
      });
    } catch (err) {
      /* pode ter sido outro sócio resolvendo antes: relê a lista pra o bloco
         virar "resolvida" sozinho em vez de ficar oferecendo botão morto. */
      loadDecisoes();
      throw err;
    }
    setDecResolvidas(prev => ({ ...prev, [dec.id]: tipo }));
    setDecAbertas(prev => {
      if (!prev[dec.id]) return prev;
      const next = { ...prev };
      delete next[dec.id];
      return next;
    });
    loadDecisoes();
    puxarSistema(conv?.id);
    loadConvs();
  };

  useEffect(() => {
    const onTopAction = (e) => { if (e.detail?.tab === "chat") novaConversa(); };
    window.addEventListener("nomade:top-action", onTopAction);
    return () => window.removeEventListener("nomade:top-action", onTopAction);
  }, []);

  /* opts.auto = turno de continuação disparado pela auto-retomada:
     não mexe no que o sócio está digitando e, no lugar da bolha,
     marca o thread com uma linha discreta. */
  const enviar = async (textoArg, opts = {}) => {
    const texto = (textoArg ?? input).trim();
    if (!texto || busy) return;
    let alvo = conv;
    if (!alvo) {
      alvo = await ofetch("/api/office/conversas", { method: "POST", body: "{}" }).catch(() => null);
      if (!alvo) return;
      setConv(alvo);
      setConvs(prev => [alvo, ...prev]);
    }
    if (!opts.auto) {
      setInput("");
      setMention(null);
    }
    setBusy(true);
    busyRef.current = true;
    setMsgs(prev => [...prev, opts.auto
      ? { id: `ret_${Date.now()}`, autor: "retomada" }
      : { id: `tmp_${Date.now()}`, autor: "socio", texto }]);
    setLive({
      steps: [
        { t: opts.auto ? t("chat.live.reading") : t("chat.live.receiving"), done: true },
        { t: t("chat.live.dispatch"), done: false },
      ],
      answer: "",
    });

    try {
      const res = await fetch(`/api/office/conversas/${alvo.id}/mensagens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ texto }),
      });
      /* sem isto um 404 (conversa apagada em outra aba) vinha como JSON no
         lugar do SSE: o loop não achava linha "data:", terminava calado e o
         sócio ficava olhando a bolha dele sem resposta nenhuma. */
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.t === "delta") {
              setLive(prev => prev && {
                steps: prev.steps.map(s => ({ ...s, done: true })),
                answer: prev.answer + ev.text,
              });
            } else if (ev.t === "final") {
              setLive(null);
              setMsgs(prev => [...prev, { id: `orq_${Date.now()}`, autor: "orquestrador", texto: ev.texto, passos: ev.passos }]);
              loadDecisoes(); // as decisões deste turno acabaram de nascer
            } else if (ev.t === "error") {
              setLive(null);
              setMsgs(prev => [...prev, { id: `err_${Date.now()}`, autor: "orquestrador", texto: t("chat.err", { e: ev.error }) }]);
            }
          } catch { /* evento parcial */ }
        }
      }
    } catch (err) {
      setLive(null);
      setMsgs(prev => [...prev, { id: `err_${Date.now()}`, autor: "orquestrador", texto: t("chat.err", { e: String(err?.message || err) }) }]);
    }
    setLive(null);
    setBusy(false);
    busyRef.current = false;
    loadConvs();
    /* decisão resolvida NO MEIO do turno: puxarSistema tinha desistido por
       causa do busy. Sem isto o recado só apareceria no poll de 20s. */
    puxarSistema(alvo.id);
  };

  /* AUTO-RETOMADA — o sócio resolveu a decisão em outra aba; ao voltar (ou ao
     chegar recado novo aqui) o chat manda sozinho um turno de continuação.
     O servidor injeta os recados pendentes nesse turno e marca como lidos. */
  useEffect(() => {
    if (!conv || busy || carregando) return;
    const novos = msgs.filter(m => m.autor === "sistema" && m.consumida === false && !retomadosRef.current.has(m.id));
    if (novos.length === 0) return;
    /* Lote com várias decisões: NÃO retoma na primeira resposta — o
       orquestrador seguiria meio informado e ainda gastaria um turno por
       decisão. Espera o sócio fechar todas as decisões DESTA conversa. */
    if (decisoesPendentes > 0) return;
    novos.forEach(m => retomadosRef.current.add(m.id));
    enviar("Continua daí.", { auto: true });
  }, [msgs, conv, busy, carregando, decisoesPendentes]);

  /* poll leve: recado resolvido em outra aba aparece aqui sem F5.
     Nunca durante streaming e só acrescenta mensagem 'sistema' inédita. */
  useEffect(() => {
    if (!conv) return;
    const cid = conv.id;
    const id = setInterval(() => {
      if (busyRef.current) return;
      puxarSistema(cid);
      loadConvs();
      loadDecisoes();
    }, 20000);
    return () => clearInterval(id);
  }, [conv?.id]);

  /* @menções */
  const onInputChange = (v) => {
    setInput(v);
    const m = v.match(/@([\w-]*)$/);
    setMention(m ? m[1].toLowerCase() : null);
  };
  const mencionaveis = mention !== null
    ? squads.filter(s => s.name.toLowerCase().includes(mention)).slice(0, 6)
    : [];

  /* composer compartilhado (hero e dock — só um montado por vez) */
  const composerBox = (placeholder) => (
    <div className={`oc-box${busy ? " busy" : ""}`}>
      {mencionaveis.length > 0 && (
        <div className="oc-mentions">
          {mencionaveis.map(s => (
            <button key={s.id} onMouseDown={e => { e.preventDefault(); setInput(prev => prev.replace(/@([\w-]*)$/, `@${s.name} `)); setMention(null); inputRef.current?.focus(); }}>
              <i style={{ background: deptCor(s.dept) }} />{s.name}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        className="oc-field"
        rows={1}
        value={input}
        placeholder={placeholder}
        disabled={busy}
        onChange={e => {
          onInputChange(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px";
        }}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
      />
      {(anexos.length > 0 || anexoErro) && (
        <div className="oc-anexos">
          {anexos.map(a => (
            <span key={a.id} className="oc-anexo" title={t("chat.attach.meta", { n: a.chars })}>
              {a.nome}
              <button type="button" onClick={() => removerAnexo(a)} aria-label={t("chat.attach.remove", { name: a.nome })}>×</button>
            </span>
          ))}
          {anexoErro && <span className="oc-anexo-err">{anexoErro}</span>}
        </div>
      )}
      <div className="oc-bar">
        <button
          type="button"
          className="oc-act"
          title={t("chat.attach.title")}
          onClick={() => fileRef.current?.click()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
            <path d="M21 12.5a4 4 0 01-4 4H8a5 5 0 010-10h9a3 3 0 010 6H9" />
          </svg>
          {t("chat.attach.btn")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.txt,.json,.csv,.yml,.yaml,.js,.jsx,.ts,.tsx,.py,.sql,.sh,.html,.css,text/*"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; anexar(f); }}
        />
        <button className="oc-act" onClick={() => { setInput(t("chat.chip.proposal_fill")); inputRef.current?.focus(); }}>{t("chat.chip.proposal")}</button>
        <button className="oc-act" onClick={() => { setInput(t("chat.chip.diag_fill")); inputRef.current?.focus(); }}>{t("chat.chip.diag")}</button>
        <button className="oc-act" onClick={() => { setInput(t("chat.chip.prospect_fill")); inputRef.current?.focus(); }}>{t("chat.chip.prospect")}</button>
        <div className="oc-spacer" />
        <button className="oc-send" onClick={() => enviar()} disabled={busy || !input.trim()} title={t("chat.send")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="17" height="17"><path d="M12 20V5M6 11l6-6 6 6" /></svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="oc">
      {/* rail fino — conversas */}
      <div className="oc-rail">
        <Wave size={30} />
        <button className={`oc-ic${showConvs ? " on" : ""}`} onClick={() => { setDrawerErr(""); setShowConvs(v => !v); }} title={t("chat.convs")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        </button>
        <button className="oc-ic" onClick={novaConversa} title={t("chat.new_conv")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <div className="oc-grow" />
        <div className="oc-av">{initials}</div>
      </div>

      {showConvs && (
        <div className="oc-drawer">
          <div className="oc-drawer-head">{t("chat.convs")}</div>
          {drawerErr && <div className="oc-drawer-err">{drawerErr}</div>}
          {convs.map(c => (
            <div key={c.id} className={`oc-drawer-row${conv?.id === c.id ? " on" : ""}`}>
              <button type="button" className="oc-drawer-item" onClick={() => openConv(c)} title={c.titulo}>
                <span className="oc-drawer-t">{c.titulo}</span>
                {c.pendentes > 0 && (
                  <i className="oc-drawer-dot" title={c.pendentes > 1 ? t("chat.drawer.pendingn", { n: c.pendentes }) : t("chat.drawer.pending1", { n: c.pendentes })} />
                )}
              </button>
              <button
                type="button"
                className="oc-drawer-x"
                title={t("chat.drawer.delete")}
                aria-label={t("chat.drawer.delete_aria", { title: c.titulo || t("chat.conv.untitled") })}
                disabled={apagando === c.id}
                onClick={() => apagarConv(c)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="13" height="13"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          ))}
          {convs.length === 0 && <span className="oc-drawer-empty">{t("chat.drawer.empty")}</span>}
        </div>
      )}

      <div className="oc-stage" ref={stageRef}>
        <div className={`oc-top${thread ? " scrolled" : ""}`}>
          <div className={`oc-conv${thread && conv ? " show" : ""}`}>{conv?.titulo}</div>
          <div className="oc-top-r">
            <span className="oc-chip-sm">{t("chat.orq")}</span>
            <div className="oc-av oc-av--sm">{initials}</div>
          </div>
        </div>

        <div className="oc-scroll" ref={scrollRef}>
          <div className="oc-col">
            {!thread && (
              <div className="oc-hero">
                <Wave size={56} />
                <h1>{t("chat.hero.l1")}<br />{t("chat.hero.l2")}<b>{nome}</b>{t("chat.hero.l3")}</h1>
                <div className="oc-sub">{t("chat.hero.sub")}</div>
                {composerBox(t("chat.hero.ph"))}
                <div className="oc-boxfoot">
                  <OrqSelector info={orqInfo} setInfo={setOrqInfo} />
                </div>
              </div>
            )}

            {thread && (
              <div className="oc-thread">
                {carregando && <div className="oc-note">{t("chat.loading_conv")}</div>}
                {convErr && <div className="oc-note err">{convErr}</div>}
                {msgs.map(m => {
                  if (m.autor === "orquestrador") return (
                    <div key={m.id} className="oc-orq">
                      <Wave size={32} />
                      <div className="oc-body">
                        <div className="oc-answer">{m.texto}</div>
                        {m.passos?.length > 0 && (
                          <PassosCard
                            passos={m.passos}
                            onGoTo={onGoTo}
                            decAbertas={decAbertas}
                            decResolvidas={decResolvidas}
                            decEstado={decEstado}
                            onResolver={resolverDecisao}
                          />
                        )}
                      </div>
                    </div>
                  );
                  if (m.autor === "sistema") return <SistemaCard key={m.id} msg={m} />;
                  if (m.autor === "retomada") return <div key={m.id} className="oc-note">{t("chat.resuming")}</div>;
                  return <div key={m.id} className="oc-usermsg">{m.texto}</div>;
                })}

                {!live && !busy && decisoesPendentes > 0 && temRecadoPendente && (
                  <div className="oc-espera">
                    <span className="oc-espera-dot" />
                    {decisoesPendentes === 1
                      ? t("chat.wait1")
                      : t("chat.waitn", { n: decisoesPendentes })}
                  </div>
                )}

                {live && (
                  <div className="oc-orq">
                    <Wave size={32} thinking={!live.answer} />
                    <div className="oc-body">
                      <div className="oc-steps">
                        {live.steps.map((s, i) => (
                          <div key={i} className={`oc-step${s.done ? " done" : ""}`}>
                            <span className="oc-st">
                              <span className="oc-ring" />
                              <svg className="oc-chk" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" width="18" height="18"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </span>
                            <span>{s.t}</span>
                          </div>
                        ))}
                      </div>
                      {live.answer && <div className="oc-answer">{live.answer}<span className="oc-caret" /></div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {thread && (
          <div className="oc-dock" ref={dockRef}>
            <div className="oc-dock-inner">
              <OrqSelector info={orqInfo} setInfo={setOrqInfo} compact />
              {composerBox(t("chat.dock_ph"))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
