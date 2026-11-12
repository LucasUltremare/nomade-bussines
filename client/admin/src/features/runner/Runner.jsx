import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { useT, useTimeAgo } from "../../i18n/index.jsx";
import { Icon } from "../../components/Icon.jsx";
import "./runner.css";

/* ══════════════════════════════════════════════════════════
   RUNNER — a fila, as execuções e a máquina que executa.

   A web NUNCA fala com a máquina: dar play só marca "roda essa
   agora" na task. Quem tem o clone e a conta Claude é o runner,
   e é ele quem puxa (POST /api/office/fila/claim) no ciclo dele.
   Por isso o botão diz "Pedir execução" e não "Rodar".
   ══════════════════════════════════════════════════════════ */

// `t` (tradutor) só serve pra mensagem de erro de fallback; sem ele cai em "HTTP n".
const ofetch = (path, opts = {}, t) =>
  fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${api.token()}`,
      ...(opts.headers || {}),
    },
  }).then(async (r) => {
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.error || (t ? t("rn.server_err", { s: r.status }) : `HTTP ${r.status}`));
    return body;
  });

const dur = (ms) => (!ms ? "" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

// status do run vem do servidor (rodando · feito · falhou · decisao · parado);
// a classe CSS usa o valor cru, o texto é traduzido
const STATUS = ["rodando", "feito", "falhou", "decisao", "parado"];
const statusLabel = (t, s) => (STATUS.includes(s) ? t(`rn.status.${s}`) : s);

export function Runner({ onGoTo }) {
  const { t } = useT();
  const [aba, setAba] = useState("fila");
  const [tasks, setTasks] = useState(null);
  const [runs, setRuns] = useState(null);
  const [repos, setRepos] = useState([]);
  const [runners, setRunners] = useState(null);
  const [erro, setErro] = useState("");

  const load = () => {
    ofetch("/api/office/tarefas-agent", {}, t)
      .then((l) => setTasks((Array.isArray(l) ? l : []).filter((tk) => !tk.feita)))
      .catch((e) => { setTasks([]); setErro(e.message); });
    ofetch("/api/office/runs?limit=25", {}, t)
      .then((l) => setRuns(Array.isArray(l) ? l : []))
      .catch(() => setRuns([]));
    // pra avisar, na própria fila, board que ainda não tem repositório
    ofetch("/api/office/runner-boards", {}, t)
      .then((l) => setRepos(Array.isArray(l) ? l : []))
      .catch(() => setRepos([]));
    ofetch("/api/office/runners", {}, t)
      .then((l) => setRunners(Array.isArray(l) ? l : []))
      .catch(() => setRunners([]));
  };

  const ativos = (runs || []).filter((r) => r.status === "rodando").length;

  /* 10s é o ritmo do runner parado (ciclo de 12s). Com run em andamento cai
     pra 3s — é quando alguém está olhando a tela esperando ver coisa acontecer. */
  useEffect(() => {
    load();
    const iv = setInterval(load, ativos ? 3_000 : 10_000);
    return () => clearInterval(iv);
  }, [ativos > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const pedidas = (tasks || []).filter((tk) => tk.pedidoEm).length;

  return (
    <div className="rn">
      <header className="rn-head">
        <div>
          <h2 className="rn-title">{t("rn.title")}</h2>
          <p className="rn-sub">
            {t("rn.sub_a")}<b>{t("rn.sub_b")}</b>{t("rn.sub_c")}
          </p>
        </div>
      </header>

      {erro && <div className="rn-erro">{erro}</div>}

      <nav className="rn-tabs">
        <button className={`rn-tab${aba === "fila" ? " on" : ""}`} onClick={() => setAba("fila")}>
          {t("rn.tab_queue")} {tasks?.length ? <em>{pedidas ? `${pedidas}/${tasks.length}` : tasks.length}</em> : null}
        </button>
        <button className={`rn-tab${aba === "runs" ? " on" : ""}`} onClick={() => setAba("runs")}>
          {t("rn.tab_runs")} {ativos ? <em>{ativos > 1 ? t("rn.activen", { n: ativos }) : t("rn.active1", { n: ativos })}</em> : null}
        </button>
      </nav>

      {aba === "fila" && <Fila tasks={tasks} repos={repos} runners={runners} onMudou={load} onGoTo={onGoTo} />}
      {aba === "runs" && <Runs runs={runs} />}
    </div>
  );
}

/* ── fila: as tasks de agent e o play ────────────────────── */
function Fila({ tasks, repos, runners, onMudou, onGoTo }) {
  const { t } = useT();
  const timeAgo = useTimeAgo();
  const [voando, setVoando] = useState("");
  const [aviso, setAviso] = useState("");
  const [sel, setSel] = useState(() => new Set());
  const [boardSel, setBoardSel] = useState(null);

  const pedir = async (tk, cancelar) => {
    setVoando(tk.id);
    setAviso("");
    try {
      const d = await ofetch(`/api/office/tarefas-agent/${tk.id}/rodar`, { method: cancelar ? "DELETE" : "POST" }, t);
      // o play PEDE; quem roda é a máquina do dono. Sem dizer isso, o sócio
      // clica e fica olhando um card parado sem entender o porquê.
      if (!cancelar && d?.aviso) setAviso(d.aviso);
      onMudou();
    } catch (e) {
      setAviso(e.message);
    } finally {
      setVoando("");
    }
  };

  const marcar = (id) => setSel((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  // resumo do lote: quantas pedidas, pra qual máquina, quantas ficaram de fora e por quê
  const resumoPedido = (d) => {
    const fora = (d.ignoradas || []).length
      ? t("rn.left_out", { n: d.ignoradas.length, why: [...new Set(d.ignoradas.map((i) => i.motivo))].join(", ") })
      : "";
    const dest = Object.entries(d.destinos || {}).map(([k, n]) => `${n} → ${k}`).join(" · ");
    return `${t("rn.requested_n", { n: d.pedidas })}${dest ? ` · ${dest}` : ""}${fora}`;
  };

  /* lote: o servidor ordena por coluna/posição e devolve o que ficou de fora.
     Mostrar o motivo importa — "12 de 15" sem explicação vira desconfiança. */
  const lote = async (cancelar) => {
    setAviso("");
    try {
      const d = await ofetch(cancelar ? "/api/office/fila/cancelar" : "/api/office/fila/pedir", {
        method: "POST",
        body: JSON.stringify({ ids: [...sel] }),
      }, t);
      setSel(new Set());
      if (cancelar) setAviso(t("rn.cancelled_n", { n: d.canceladas || 0 }));
      else setAviso(resumoPedido(d));
      onMudou();
    } catch (e) { setAviso(e.message); }
  };

  /* Agrupa por kanban. Lista corrida misturava board interno com board de
     cliente e não dava pra rodar "só um cliente" sem catar card a card. */
  const grupos = [];
  for (const tk of tasks || []) {
    const chave = tk.boardId || "sem";
    let g = grupos.find((x) => x.id === chave);
    if (!g) {
      const repo = (repos || []).find((r) => r.id === chave);
      grupos.push((g = { id: chave, nome: tk.cliente || tk.board || t("rn.no_board"), pasta: repo?.pasta || null, tasks: [] }));
    }
    g.tasks.push(tk);
  }
  grupos.sort((a, b) => b.tasks.length - a.tasks.length);
  // board escolhido pode ter esvaziado entre dois polls — cai no primeiro
  const boardAtivo = grupos.some((g) => g.id === boardSel) ? boardSel : grupos[0]?.id;
  const grupo = grupos.find((g) => g.id === boardAtivo);
  // seleção em massa vale só dentro do projeto aberto — senão "selecionar
  // todas" pegaria task de cliente que nem está na tela
  const doProjeto = (grupo?.tasks || []).filter((tk) => !tk.aguardandoDecisao && !tk.rodandoEm);

  const loteDoBoard = async (boardId) => {
    setAviso("");
    try {
      const d = await ofetch("/api/office/fila/pedir", { method: "POST", body: JSON.stringify({ boardId }) }, t);
      // pra qual máquina cada uma foi — "8 pedidas" não diz se alguma espera outro sócio
      setAviso(resumoPedido(d));
      onMudou();
    } catch (e) { setAviso(e.message); }
  };

  if (tasks === null) return <div className="rn-load">{t("rn.reading")}</div>;
  if (!tasks.length) return <div className="rn-vazio">{t("rn.empty")}</div>;

  return (
    <>
      {aviso && <div className="rn-erro">{aviso}</div>}

      {/* Sem máquina de pé, pedir execução é pedir pro vazio: a task fica
          marcada e não acontece nada, sem nada explicando. */}
      {runners !== null && !runners.some((m) => m.online) && (
        <div className="rn-offline">
          {runners.length === 0
            ? <>{t("rn.no_machine")}<button className="rn-btn" onClick={() => onGoTo?.("cli")}>{t("rn.connect")}</button></>
            : t("rn.offline", { names: runners.map((m) => m.nome).join(", ") })}
        </div>
      )}

      <div className="rn-lote">
        <button
          className="rn-btn"
          onClick={() => setSel(sel.size === doProjeto.length ? new Set() : new Set(doProjeto.map((tk) => tk.id)))}
        >
          {sel.size === doProjeto.length && doProjeto.length ? t("rn.clear_sel") : t("rn.select_all", { n: doProjeto.length })}
        </button>
        {sel.size > 0 && (
          <>
            <button className="rn-play" onClick={() => lote(false)}>{t("rn.request_n", { n: sel.size })}</button>
            <button className="rn-btn" onClick={() => lote(true)}>{t("rn.cancel_requests")}</button>
          </>
        )}
      </div>

      {/* seletor de projeto: um kanban por vez. Empilhar todos os boards fazia
          rolar sem fim pra achar a task de um cliente só. */}
      <div className="rn-projs">
        {grupos.map((g) => (
          <button
            key={g.id}
            className={`rn-proj${g.id === boardAtivo ? " on" : ""}`}
            onClick={() => setBoardSel(g.id)}
            title={g.pasta || t("rn.no_repo")}
          >
            {g.nome}
            <em>{g.tasks.length}</em>
            {!g.pasta && <i className="rn-proj-alerta" aria-label={t("rn.no_repo_short")} />}
          </button>
        ))}
      </div>

      {grupo && (
        <>
          <div className="rn-grupo-head">
            {!grupo.pasta && <span className="rn-grupo-alerta">{t("rn.no_repo_cli")}</span>}
            <span className="rn-grupo-n">{grupo.pasta || t("rn.no_folder")}</span>
            <button
              className="rn-grupo-btn"
              onClick={() => loteDoBoard(grupo.id)}
              disabled={!grupo.tasks.some((tk) => !tk.aguardandoDecisao && !tk.rodandoEm && !tk.pedidoEm)}
            >
              {t("rn.request_all", { n: grupo.tasks.length })}
            </button>
          </div>

          {grupo.tasks.map((tk) => (
            <div key={tk.id} className={`rn-task${tk.rodandoEm ? " rodando" : tk.pedidoEm ? " pedida" : ""}`}>
              <input
                type="checkbox"
                className="rn-check"
                checked={sel.has(tk.id)}
                disabled={tk.aguardandoDecisao || !!tk.rodandoEm}
                onChange={() => marcar(tk.id)}
                aria-label={t("rn.select_task", { title: tk.titulo })}
              />
              <div className="rn-task-txt">
                <span className="rn-task-nome">{tk.titulo}</span>
                <span className="rn-task-meta">
                  <b>{tk.squad}</b>
                  <span>{tk.colunaNome}</span>
                  {tk.progresso?.etapa > 0 && (
                    <span className="retoma" title={t("rn.resume_title")}>
                      {t("rn.resume", { a: tk.progresso.etapa, b: tk.progresso.de })}
                    </span>
                  )}
                  {tk.rodandoEm && <span>{t("rn.running_on", { m: tk.rodandoEm })}</span>}
                  {!tk.rodandoEm && tk.pedidoEm && <span>{t("rn.requested_ago", { ago: timeAgo(tk.pedidoEm) })}</span>}
                  {tk.aguardandoDecisao && <span className="trava">{t("rn.waiting_decision")}</span>}
                </span>
              </div>
              {tk.aguardandoDecisao ? (
                <button className="rn-play" disabled title={t("rn.locked_title")}>{t("rn.locked")}</button>
              ) : tk.rodandoEm ? (
                <button className="rn-play" disabled>{t("rn.running")}</button>
              ) : tk.pedidoEm ? (
                <button className="rn-play cancelar" disabled={voando === tk.id} onClick={() => pedir(tk, true)}>
                  {voando === tk.id ? "…" : t("rn.cancel_request")}
                </button>
              ) : (
                <button className="rn-play" disabled={!!voando} onClick={() => pedir(tk, false)}>
                  {voando === tk.id ? t("rn.requesting") : t("rn.request")}
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ── runs: o que a máquina fez, etapa por etapa ──────────── */
function Runs({ runs }) {
  const { t } = useT();
  const timeAgo = useTimeAgo();
  const [aberto, setAberto] = useState(null);
  const [detalhe, setDetalhe] = useState({});
  const [tocado, setTocado] = useState(false);

  // run em andamento abre sozinho na primeira vez — quem entra aqui durante
  // uma execução quer ver ela, não clicar pra achar
  useEffect(() => {
    if (tocado || aberto) return;
    const vivo = (runs || []).find((r) => r.status === "rodando");
    if (vivo) setAberto(vivo.id);
  }, [runs, aberto, tocado]);

  /* Nota do run. Otimista de propósito: aprovar/reprovar é gesto de um clique, e esperar
     ida e volta pra pintar o botão faz o sócio clicar duas vezes. Se o PATCH
     falhar, o próximo refresh da lista desfaz sozinho. */
  const notaDoRun = async (run, nota) => {
    run.nota = nota || undefined;
    setDetalhe((d) => ({ ...d, [run.id]: { ...(d[run.id] || run), nota: nota || undefined } }));
    try { await ofetch(`/api/office/runs/${run.id}/nota`, { method: "PATCH", body: JSON.stringify({ nota }) }, t); }
    catch { /* a lista corrige no próximo carregamento */ }
  };

  const abrir = async (run) => {
    setTocado(true);
    if (aberto === run.id) return setAberto(null);
    setAberto(run.id);
    // a lista traz só as 3 últimas etapas; o detalhe busca o run inteiro
    if (!detalhe[run.id]) {
      try {
        const cheio = await ofetch(`/api/office/runs/${run.id}`, {}, t);
        setDetalhe((d) => ({ ...d, [run.id]: cheio }));
      } catch { /* fica com o resumo da lista */ }
    }
  };

  if (runs === null) return <div className="rn-load">{t("rn.loading_runs")}</div>;
  if (!runs.length) return <div className="rn-vazio">{t("rn.empty_runs")}</div>;

  return runs.map((r) => {
    const d = detalhe[r.id] || r;
    return (
      <article key={r.id} className="rn-run">
        <button className="rn-run-head" onClick={() => abrir(r)}>
          <span className={`rn-badge ${r.status}`}>{statusLabel(t, r.status)}</span>
          <span className="rn-run-nome">{r.titulo || r.squad || t("rn.run")}</span>
          <span className="rn-run-meta">
            {r.atual ? `${r.atual.indice}/${r.total || "?"} ${r.atual.nome}` : `${r.etapa || 0}/${r.total || "?"}`}
            {" · "}{r.conta || "?"} · {r.maquina || "?"} · {r.iniciado ? timeAgo(r.iniciado) : ""}
          </span>
        </button>
        {/* NOTA DO RUN — o `office_runs` guardava o que aconteceu e ninguém
            agregava: dava pra sentir que um agent é ruim, nunca pra mostrar.
            Fica fora do <button> de propósito: clicar na nota não pode abrir o
            detalhe junto. Só em run terminado — nota de run rodando é palpite. */}
        {r.status !== "rodando" && (
          <div className="rn-run-nota" style={{ display: "flex", gap: 4, padding: "0 12px 8px", alignItems: "center" }}>
            {[["thumbUp", 1], ["thumbDown", -1]].map(([icone, valor]) => (
              <button
                key={valor}
                onClick={() => notaDoRun(r, r.nota === valor ? 0 : valor)}
                title={r.nota === valor ? t("rn.rate_remove") : valor === 1 ? t("rn.rate_good") : t("rn.rate_bad")}
                style={{
                  background: "none", border: "1px solid var(--line)", borderRadius: "var(--r-xs)",
                  padding: "3px 6px", cursor: "pointer", display: "inline-flex", color: "var(--ink)",
                  opacity: r.nota === valor ? 1 : 0.35,
                }}
              ><Icon name={icone} size={13} /></button>
            ))}
            {r.notaPor && <span style={{ fontSize: 10, opacity: 0.5 }}>{String(r.notaPor).split("@")[0]}</span>}
          </div>
        )}
        {aberto === r.id && (
          <div className="rn-run-body">
            {d.erro && <div className="rn-run-erro">{d.erro}</div>}
            {(d.etapas || []).map((e, i) => <Etapa key={i} e={e} />)}
            {/* etapa em curso: aparece assim que começa, com o que ele já mexeu */}
            {r.atual && <EmCurso a={r.atual} />}
            {!(d.etapas || []).length && !r.atual && (
              <span className="rn-nota">{t("rn.no_steps")}</span>
            )}
          </div>
        )}
      </article>
    );
  });
}

function EmCurso({ a }) {
  const { t } = useT();
  const seg = Math.max(0, Math.floor((Date.now() - new Date(a.desde).getTime()) / 1000));
  return (
    <div className="rn-etapa rn-etapa--vivo">
      <div className="rn-etapa-top">
        <b>{a.nome}</b>
        <span>{a.modelo}</span>
        <span>{a.motor}</span>
        <span className="rn-vivo-tag"><i />{t("rn.working_for", { d: seg < 60 ? `${seg}s` : `${Math.floor(seg / 60)}min` })}</span>
      </div>
      {(a.ferramentas || []).length ? (
        <div className="rn-ferramentas">
          {a.ferramentas.map((f, i) => <span key={i} className="rn-ferramenta" title={f}>{f}</span>)}
        </div>
      ) : (
        <span className="rn-nota">{t("rn.just_started")}</span>
      )}
    </div>
  );
}

function Etapa({ e }) {
  const { t } = useT();
  const [tudo, setTudo] = useState(false);
  const longo = (e.saida || "").length > 600;
  return (
    <div className="rn-etapa">
      <div className="rn-etapa-top">
        <b>{e.nome}</b>
        <span>{e.modelo}</span>
        <span>{e.motor}</span>
        {e.duracaoMs ? <span>{dur(e.duracaoMs)}</span> : null}
      </div>
      {!!(e.ferramentas || []).length && (
        <div className="rn-ferramentas">
          {e.ferramentas.map((f, i) => <span key={i} className="rn-ferramenta" title={f}>{f}</span>)}
        </div>
      )}
      {e.saida && (
        <div className="rn-saida">{tudo || !longo ? e.saida : `${e.saida.slice(0, 600)}…`}</div>
      )}
      {longo && (
        <button className="rn-mais" onClick={() => setTudo((v) => !v)}>
          {tudo ? t("rn.less") : t("rn.more")}
        </button>
      )}
    </div>
  );
}
