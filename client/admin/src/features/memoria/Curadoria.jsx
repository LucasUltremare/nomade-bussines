import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client.js";
import { useT } from "../../i18n/index.jsx";

/* ══════════════════════════════════════════════════════════════════════
   CURADORIA — lista de trabalho, não CRUD.

   A memória cresce sozinha (o agent grava no meio da task) e ninguém revisa.
   Foi assim que 6 assuntos viraram 11 grafias. Esta tela existe pra que
   qualquer sócio consiga melhorar a base sem entender o sistema.

   Três regras que decidem se ela é usada ou abandonada:

   ORDENADA POR IMPACTO, não por data. O primeiro item é o que mais atrapalha
   o recall hoje — memória da casa aparece na busca de TODO cliente, então
   dizer o que ela é vale mais que classificar um doc já isolado por escopo.

   UM ITEM, UMA PERGUNTA, UM TOQUE. Sem formulário, sem editor, sem busca.
   Abre, resolve os três do topo, fecha.

   SEM CONFIRMAR EM MASSA, de propósito. O Gemma erra ~30%; um botão que
   aprova oito de uma vez põe carimbo humano em palpite que ninguém leu, e aí
   não dá mais pra saber o que foi revisado de verdade.
   ══════════════════════════════════════════════════════════════════════ */

const ofetch = async (path, opts = {}) => {
  const r = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(await r.text().catch(() => r.status));
  return r.json();
};

/* A frase importa mais que o rótulo: sem ela ninguém sabe a diferença entre
   convenção e decisão, e a tela morre no primeiro item. Fica visível sempre,
   com ou sem palpite do Gemma. Nome e frase são chaves de i18n — traduz na
   hora de mostrar. */
const TIPOS = [
  { id: "convencao", nome: "mem.type.convencao", frase: "mem.type.convencao.hint" },
  { id: "decisao", nome: "mem.type.decisao", frase: "mem.type.decisao.hint" },
  { id: "preferencia", nome: "mem.type.preferencia", frase: "mem.type.preferencia.hint" },
  { id: "fato_cliente", nome: "mem.type.fato_cliente", frase: "mem.type.fato_cliente.hint" },
  { id: "playbook", nome: "mem.type.playbook", frase: "mem.type.playbook.hint" },
];
const tipoDe = (id) => TIPOS.find((t) => t.id === id);

const DESFAZER_MS = 5000; // 5s: 1,5s não é desfazer, é animação

function quando(ts, t) {
  if (!ts) return "";
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d === 0) return t("mem.time.today");
  if (d === 1) return t("time.yesterday");
  return `${d}d`;
}

export function Curadoria() {
  const { t } = useT();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [feitos, setFeitos] = useState({});   // id → {texto, desfazer}
  const timers = useRef({});

  const carregar = useCallback(async () => {
    try { setDados(await ofetch("/api/office/memories/curadoria")); setErro(""); }
    catch (e) { setErro(String(e.message || e)); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /* O Gemma classifica em background, de 12 em 12. Enquanto sobrar item sem
     palpite, recarrega sozinho — senão o primeiro que abre a tela vê a lista
     inteira sem sugestão e conclui que não funciona. */
  useEffect(() => {
    if (!dados?.analisando) return;
    const tm = setTimeout(carregar, 6000);
    return () => clearTimeout(tm);
  }, [dados?.analisando, carregar]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  /* Escreve NA HORA e o desfazer é a chamada inversa. Um timer que segura a
     escrita perde tudo se a aba fechar no meio. */
  const agir = async (id, texto, fazer, desfazer) => {
    try {
      await fazer();
      setFeitos((f) => ({ ...f, [id]: { texto, desfazer } }));
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => {
        setFeitos((f) => { const { [id]: _, ...resto } = f; return resto; });
        carregar();
      }, DESFAZER_MS);
    } catch (e) { setErro(String(e.message || e)); }
  };

  const desfazer = async (id) => {
    clearTimeout(timers.current[id]);
    try { await feitos[id]?.desfazer?.(); } catch (e) { setErro(String(e.message || e)); }
    setFeitos((f) => { const { [id]: _, ...resto } = f; return resto; });
    carregar();
  };

  if (erro && !dados) return <div className="cur-hint">{t("common.error", { e: erro })}</div>;
  if (!dados) return <div className="cur-hint">{t("common.loading")}</div>;

  if (!dados.total) {
    return (
      <div className="cur-zero">
        <b>{t("mem.cur.zero_title")}</b>
        <span>{t("mem.cur.zero_text")}</span>
      </div>
    );
  }

  return (
    <div className="cur">
      <div className="cur-topo">
        <span className="cur-total">{t("mem.cur.total", { n: dados.total })}</span>
        {dados.analisando > 0 && (
          <span className="cur-gemma">{t("mem.cur.analyzing", { n: dados.analisando })}</span>
        )}
        {!dados.gemma && (
          <span className="cur-gemma cur-gemma--off">
            {t("mem.cur.gemma_off")}
          </span>
        )}
      </div>

      {dados.bandas.filter((b) => b.total).map((b) => (
        <section key={b.id} className="cur-banda">
          <header>
            <h3>{b.titulo}</h3>
            <span className="cur-cont">{t(b.total === 1 ? "mem.cur.items_1" : "mem.cur.items_n", { n: b.total })}</span>
          </header>
          <p className="cur-ajuda">{b.ajuda}</p>
          <div className="cur-itens">
            {b.itens.map((m) => (
              <Item
                key={m.id} m={m} banda={b.id}
                feito={feitos[m.id]}
                onDesfazer={() => desfazer(m.id)}
                agir={agir}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Item({ m, banda, feito, onDesfazer, agir }) {
  const { t } = useT();
  const [mais, setMais] = useState(false);
  const [resposta, setResposta] = useState("");

  if (feito) {
    return (
      <article className="cur-item cur-item--feito">
        <div className="cur-feito">
          <span>{feito.texto}</span>
          <button className="cur-undo" onClick={onDesfazer}>{t("mem.cur.undo")}</button>
        </div>
      </article>
    );
  }

  const classificar = (tipo) =>
    agir(m.id, `${t(tipoDe(tipo)?.nome)} · ${t(tipoDe(tipo)?.frase)}`,
      () => ofetch(`/api/office/memories/${m.id}/classificar`, { method: "POST", body: JSON.stringify({ tipo }) }),
      () => ofetch(`/api/office/memories/${m.id}/classificar`, { method: "POST", body: JSON.stringify({ tipo: null }) }));

  const cabeca = (
    <>
      <h4>{m.titulo || t("mem.untitled")}</h4>
      <p className="cur-txt">{m.conteudo}</p>
      <div className="cur-meta">
        {m.escopo && <span className="cur-escopo">{m.escopo}</span>}
        {/* quem mexeu fica visível: classificação muda o que TODO agent vê no
            recall, inclusive nas sessões de código. É onde olhar quando algo
            estranho aparece na busca. */}
        {m.por && <span className="cur-por">{m.por.split("@")[0]} · {quando(m.em, t)}</span>}
      </div>
    </>
  );

  if (banda === "lacuna") {
    return (
      <article className="cur-item">
        {cabeca}
        <p className="cur-pergunta">{m.lacuna}</p>
        {m.perguntarNoGrupo && <p className="cur-marcado">{t("mem.cur.marked_group")}</p>}
        <div className="cur-resp">
          <input
            value={resposta} onChange={(e) => setResposta(e.target.value)}
            placeholder={t("mem.cur.answer_ph")}
            onKeyDown={(e) => e.key === "Enter" && resposta.trim().length > 1 && responder()}
          />
        </div>
        <div className="cur-acoes">
          <button className="cur-b cur-b--pri" disabled={resposta.trim().length < 2} onClick={responder}>{t("mem.cur.save")}</button>
          {/* NÃO tem "arquiva": seria o caminho fácil e o mais clicado, e estas
              quatro são exatamente as perguntas da próxima call. Não lembrar
              mantém aberto, não some. */}
          <button className="cur-b" onClick={perguntar}>{t("mem.cur.ask_group")}</button>
        </div>
      </article>
    );
  }

  function responder() {
    const txt = resposta.trim();
    agir(m.id, t("mem.cur.done.answered", { txt: txt.slice(0, 40) }),
      () => ofetch(`/api/office/memories/${m.id}/lacuna`, { method: "POST", body: JSON.stringify({ resposta: txt }) }),
      () => ofetch(`/api/office/memories/${m.id}/lacuna`, { method: "POST", body: JSON.stringify({ desfazer: true }) }));
  }
  function perguntar() {
    agir(m.id, t("mem.cur.done.ask"),
      () => ofetch(`/api/office/memories/${m.id}/lacuna`, { method: "POST", body: JSON.stringify({ perguntar: true }) }),
      () => ofetch(`/api/office/memories/${m.id}/lacuna`, { method: "POST", body: JSON.stringify({ perguntar: false }) }));
  }

  if (banda === "cadeia") {
    return (
      <article className="cur-item">
        {cabeca}
        <p className="cur-cadeia">{t("mem.cur.chain")} <b>{m.substituiPor}</b></p>
        <div className="cur-acoes">
          <button className="cur-b cur-b--pri" onClick={() =>
            agir(m.id, t("mem.cur.done.checked"),
              () => ofetch(`/api/office/memories/${m.id}/cadeia`, { method: "POST", body: JSON.stringify({ confere: true }) }),
              () => ofetch(`/api/office/memories/${m.id}/cadeia`, { method: "POST", body: JSON.stringify({ confere: true, desfazer: true }) }))
          }>{t("mem.cur.confirm")}</button>
          <button className="cur-b" onClick={() =>
            agir(m.id, t("mem.cur.done.unarchived"),
              () => ofetch(`/api/office/memories/${m.id}/cadeia`, { method: "POST", body: JSON.stringify({ confere: false }) }),
              () => ofetch(`/api/office/memories/${m.id}/cadeia`, { method: "POST", body: JSON.stringify({ confere: true }) }))
          }>{t("mem.cur.unarchive")}</button>
        </div>
      </article>
    );
  }

  // bandas de tipo: casa e cliente
  const sug = m.tipoSugerido ? tipoDe(m.tipoSugerido) : null;
  const outros = TIPOS.filter((tp) => tp.id !== sug?.id);

  return (
    <article className="cur-item">
      {cabeca}

      {sug ? (
        <>
          <div className="cur-sug">
            <span className="cur-sug-lbl">{t("mem.cur.suggest")}</span>
            <b>{t(sug.nome).toUpperCase()}</b>
          </div>
          <p className="cur-frase">{t(sug.frase)}</p>
          <div className="cur-acoes">
            <button className="cur-b cur-b--pri" onClick={() => classificar(sug.id)}>{t("mem.cur.yes")}</button>
            {outros.slice(0, 2).map((tp) => (
              <button key={tp.id} className="cur-b" onClick={() => classificar(tp.id)} title={t(tp.frase)}>
                {t("mem.cur.is", { type: t(tp.nome) })}
              </button>
            ))}
            <button className="cur-b cur-b--mais" onClick={() => setMais((v) => !v)}>…</button>
          </div>
        </>
      ) : (
        /* Sem palpite (Gemma fora, ou resposta que não casou): os quatro
           botões com a frase. Perde velocidade, não perde função. */
        <div className="cur-escolha">
          {TIPOS.map((tp) => (
            <button key={tp.id} className="cur-op" onClick={() => classificar(tp.id)}>
              <b>{t(tp.nome)}</b><span>{t(tp.frase)}</span>
            </button>
          ))}
        </div>
      )}

      {mais && (
        <div className="cur-mais">
          {outros.slice(2).map((tp) => (
            <button key={tp.id} className="cur-op" onClick={() => classificar(tp.id)}>
              <b>{t(tp.nome)}</b><span>{t(tp.frase)}</span>
            </button>
          ))}
          <TrocaEscopo m={m} agir={agir} />
        </div>
      )}
    </article>
  );
}

/* A saída pro caso que já aconteceu: doc no cliente errado (a
   identidade visual de um cliente gravada como convenção da casa). Único
   campo editável da tela — de propósito, porque isto não é editor. */
function TrocaEscopo({ m, agir }) {
  const { t } = useT();
  const [escopos, setEscopos] = useState(null);
  useEffect(() => { ofetch("/api/office/escopos").then((d) => setEscopos(d.escopos || [])).catch(() => setEscopos([])); }, []);
  if (!escopos) return null;
  return (
    <div className="cur-escopo-troca">
      <span>{t("mem.cur.move")}</span>
      <select defaultValue="" onChange={(e) => {
        const rotulo = e.target.value;
        if (!rotulo) return;
        agir(m.id, t("mem.cur.done.moved", { scope: rotulo }),
          () => ofetch(`/api/office/memories/${m.id}/escopo`, { method: "POST", body: JSON.stringify({ projeto: rotulo }) }),
          () => ofetch(`/api/office/memories/${m.id}/escopo`, { method: "POST", body: JSON.stringify({ projeto: m.escopo || "" }) }));
      }}>
        <option value="">{t("mem.cur.pick")}</option>
        {escopos.map((e) => <option key={e.rotulo} value={e.rotulo}>{e.rotulo}</option>)}
      </select>
    </div>
  );
}
