import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client.js";
import { useT } from "../../i18n/index.jsx";
import { Markdown, wikilinksDe } from "./md.jsx";
import { MemoryGraph } from "./MemoryGraph.jsx";
import { Curadoria } from "./Curadoria.jsx";
import "./memoria.css";

/* ══════════════════════════════════════════════════════════════════════
   MEMÓRIA DA EMPRESA — o que a empresa sabe.
   Três painéis: a lista, a nota, e com quem ela conversa. A nota é markdown
   com [[wikilinks]]; as associações do lado direito são SEMÂNTICAS (vizinhos
   por cosseno, calculados no servidor) — não é o sócio que liga uma na outra,
   é a base que percebe sozinha.
   ══════════════════════════════════════════════════════════════════════ */

const ofetch = async (path, opts = {}) => {
  const r = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// título bruto; o fallback "sem título" é traduzido por quem chama (recebe t)
const tituloBruto = (m) =>
  (m?.title && m.title.trim()) ||
  String(m?.content || "").split("\n")[0].replace(/^#+\s*/, "").slice(0, 60);
const tituloDe = (m, t) => tituloBruto(m) || t("mem.untitled");

function quando(ts, t) {
  if (!ts) return "";
  const min = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return t("time.now");
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? t("time.yesterday") : `${d}d`;
}

/* A memória tem dois públicos e eles não querem a mesma tela.
   ARRUMAR é lista de trabalho: um sócio abre, resolve três itens, fecha, sem
   precisar entender o sistema. TUDO é o CRUD de sempre — busca, teia, editor —
   que é ferramenta de admin e continua sendo usada por quem administra.
   NOVAS nasce vazia de propósito: quando o worker existir ela enche, e a tela
   já vai estar no hábito de todo mundo. */
export function Memoria() {
  const { t } = useT();
  const [aba, setAba] = useState("arrumar");
  const [pendentes, setPendentes] = useState(0);

  useEffect(() => {
    ofetch("/api/office/memories/curadoria").then(d => setPendentes(d.total || 0)).catch(() => {});
  }, [aba]);

  return (
    <div className="mm mm--abas">
      <nav className="mm-abas">
        <button className={aba === "arrumar" ? "on" : ""} onClick={() => setAba("arrumar")}>
          {t("mem.tab.fix")} {pendentes > 0 && <i>{pendentes}</i>}
        </button>
        <button className={aba === "novas" ? "on" : ""} onClick={() => setAba("novas")}>{t("mem.tab.new")}</button>
        <button className={aba === "tudo" ? "on" : ""} onClick={() => setAba("tudo")}>{t("mem.tab.all")}</button>
      </nav>
      {aba === "arrumar" && <Curadoria />}
      {aba === "novas" && (
        <div className="cur-zero">
          <b>{t("mem.new.empty_title")}</b>
          <span>{t("mem.new.empty_text")}</span>
        </div>
      )}
      {aba === "tudo" && <MemoriaCrud />}
    </div>
  );
}

function MemoriaCrud() {
  const { t } = useT();
  const [mems, setMems] = useState(null);
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState("");
  const [proj, setProj] = useState("");
  const [vista, setVista] = useState("notas");   // notas | teia
  const [abertaId, setAbertaId] = useState(null);
  const [draft, setDraft] = useState(null);      // {title, content, tags, project}
  const [modo, setModo] = useState("ler");       // ler | editar
  const [salvo, setSalvo] = useState(true);
  const [saude, setSaude] = useState(null);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const timer = useRef();

  const carregar = async (termo = busca, projeto = proj) => {
    const qs = termo ? `?q=${encodeURIComponent(termo)}` : projeto ? `?project=${encodeURIComponent(projeto)}` : "";
    const lista = await ofetch(`/api/office/memories${qs}`).catch(() => []);
    setMems(lista);
    return lista;
  };
  const carregarSaude = () => ofetch("/api/office/memories/status").then(setSaude).catch(() => setSaude(null));

  useEffect(() => { carregar(); carregarSaude(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // o botão primário da topbar cria memória nova
  useEffect(() => {
    const h = (e) => { if (e.detail?.tab === "memoria") nova(); };
    window.addEventListener("nomade:top-action", h);
    return () => window.removeEventListener("nomade:top-action", h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const aberta = useMemo(() => (mems || []).find(m => m.id === abertaId) || null, [mems, abertaId]);

  /* ── abrir, criar, salvar ── */
  const abrir = (m) => {
    setAbertaId(m.id);
    setDraft({ title: m.title || "", content: m.content || "", tags: (m.tags || []).join(", "), project: m.project || "" });
    setModo("ler");
    setSalvo(true);
    setVista("notas");
  };

  const nova = (titulo = "") => {
    setAbertaId(null);
    setDraft({ title: titulo, content: "", tags: "", project: proj || "" });
    setModo("editar");
    setSalvo(true);
    setVista("notas");
  };

  const mudou = (patch) => {
    setDraft(d => ({ ...d, ...patch }));
    setSalvo(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persistir(), 800); // autosave, como caderno
  };

  const persistir = async () => {
    setDraft(atual => { void gravar(atual); return atual; });
  };

  const gravar = async (d) => {
    if (!d) return;
    const corpo = {
      title: d.title.trim() || undefined,
      content: d.content.trim(),
      tags: d.tags.split(",").map(s => s.trim()).filter(Boolean),
      project: d.project.trim() || undefined,
    };
    if (!corpo.content && !corpo.title) { setSalvo(true); return; }
    try {
      if (abertaId) {
        await ofetch(`/api/office/memories/${abertaId}`, { method: "PATCH", body: JSON.stringify(corpo) });
      } else {
        const criada = await ofetch("/api/office/memories", { method: "POST", body: JSON.stringify(corpo) });
        setAbertaId(criada.id);
        // o servidor funde quando já existe memória do mesmo assunto
        if (criada.fundida) setAviso(t("mem.warn.merged"));
      }
      setSalvo(true);
      carregar();
    } catch { setAviso(t("mem.warn.save_fail")); }
  };

  const esquecer = async () => {
    if (!abertaId) { setDraft(null); return; }
    if (!window.confirm(t("mem.confirm.forget", { title: tituloDe(aberta, t) }))) return;
    await ofetch(`/api/office/memories/${abertaId}`, { method: "DELETE" }).catch(() => {});
    setAbertaId(null); setDraft(null);
    carregar(); carregarSaude();
  };

  const buscar = (e) => {
    e?.preventDefault();
    const termo = q.trim();
    setBusca(termo);
    carregar(termo, proj);
  };

  const manutencao = async () => {
    setOcupado(true); setAviso("");
    try {
      const r = await ofetch("/api/office/memories/backfill", { method: "POST", body: "{}" });
      setAviso(r.aviso
        ? r.aviso
        : t("mem.maint.result", { a: r.rotulados, b: r.embeddados, c: r.religadas })
          + (r.pendentes ? t("mem.maint.pending", { n: r.pendentes }) : t("mem.maint.done")));
      await carregar(); await carregarSaude();
    } catch { setAviso(t("mem.maint.fail")); }
    setOcupado(false);
  };

  /* ── navegar pelo [[nome]] ── */
  const irPara = (nome) => {
    const alvo = (mems || []).find(m => tituloDe(m, t).toLowerCase() === nome.toLowerCase());
    if (alvo) abrir(alvo); else nova(nome); // não existe? cria com esse nome
  };

  if (mems === null) return <div className="mm-hint">{t("common.loading")}</div>;

  const projetos = [...new Set((mems || []).map(m => m.project).filter(Boolean))].sort();
  const lista = proj && !busca ? mems.filter(m => m.project === proj) : mems;
  const porId = Object.fromEntries(mems.map(m => [m.id, m]));

  // quem aponta pra esta nota por [[wikilink]] — o backlink do Obsidian
  const retro = aberta
    ? mems.filter(m => m.id !== aberta.id && wikilinksDe(m.content).some(n => n.toLowerCase() === tituloDe(aberta, t).toLowerCase()))
    : [];
  const vizinhas = (aberta?.links || []).map(l => ({ ...porId[l.id], score: l.score })).filter(v => v.id);

  return (
    <div className="mm">
      {/* ── barra ── */}
      <div className="mm-top">
        <form className="mm-busca" onSubmit={buscar}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("mem.search_ph")} />
          {busca && <button type="button" className="mm-x" onClick={() => { setQ(""); setBusca(""); carregar("", proj); }}>×</button>}
        </form>

        <div className="mm-projs">
          <button className={!proj ? "on" : ""} onClick={() => { setProj(""); carregar(busca, ""); }}>{t("mem.filter.all")}</button>
          {projetos.map(p => (
            <button key={p} className={proj === p ? "on" : ""} onClick={() => { setProj(p); setBusca(""); setQ(""); carregar("", p); }}>{p}</button>
          ))}
        </div>

        <div className="mm-acts">
          <div className="mm-vista">
            <button className={vista === "notas" ? "on" : ""} onClick={() => setVista("notas")}>{t("mem.view.notes")}</button>
            <button className={vista === "teia" ? "on" : ""} onClick={() => setVista("teia")}>{t("mem.view.web")}</button>
          </div>
          {saude && <SaudeChip s={saude} />}
          <button className="mm-btn" onClick={manutencao} disabled={ocupado}>{ocupado ? t("mem.maint.running") : t("mem.maint")}</button>
          <button className="mm-btn mm-btn--pri" onClick={() => nova()}>{t("mem.new_btn")}</button>
        </div>
      </div>

      {aviso && <div className="mm-aviso" onClick={() => setAviso("")}>{aviso}<span>×</span></div>}

      {vista === "teia" ? (
        <MemoryGraph memorias={mems} selecionada={abertaId} onAbrir={(id) => porId[id] && abrir(porId[id])} />
      ) : (
        <div className="mm-corpo">
          {/* ── lista ── */}
          <aside className="mm-lista">
            <div className="mm-lista-cab">
              {busca
                ? t("mem.count.by_meaning", { n: lista.length })
                : t(lista.length === 1 ? "mem.count.1" : "mem.count.n", { n: lista.length })}
            </div>
            {lista.length === 0 && <div className="mm-vazio">{busca ? t("mem.empty.search") : t("mem.empty.all")}</div>}
            {lista.map(m => (
              <button key={m.id} className={`mm-item${m.id === abertaId ? " on" : ""}`} onClick={() => abrir(m)}>
                <div className="mm-item-t">
                  {tituloDe(m, t)}
                  {typeof m.score === "number" && <em>{Math.round(m.score * 100)}%</em>}
                </div>
                <div className="mm-item-p">{String(m.content || "").replace(/[#*`>[\]]/g, "").trim().slice(0, 76) || "—"}</div>
                <div className="mm-item-f">
                  {m.project && <span className="mm-chip">{m.project}</span>}
                  {(m.tags || []).slice(0, 2).map(tag => <span key={tag} className="mm-tag">{tag}</span>)}
                  {!!m.links?.length && <span className="mm-lig" title={t("mem.links_title", { n: m.links.length })}>◈ {m.links.length}</span>}
                  <span className="mm-quando">{quando(m.updatedAt, t)}</span>
                </div>
              </button>
            ))}
          </aside>

          {/* ── nota ── */}
          <section className="mm-nota">
            {!draft ? (
              <div className="mm-branco">
                <b>{t("mem.pick.title")}</b>
                <span>{t("mem.pick.text")} <code>[[{t("mem.pick.code")}]]</code>.</span>
              </div>
            ) : (
              <>
                <div className="mm-nota-cab">
                  <input className="mm-titulo" value={draft.title} onChange={e => mudou({ title: e.target.value })} placeholder={t("mem.title_ph")} />
                  <span className={`mm-salvo${salvo ? " ok" : ""}`}>{salvo ? t("mem.saved") : t("mem.saving")}</span>
                  <div className="mm-modo">
                    <button className={modo === "editar" ? "on" : ""} onClick={() => setModo("editar")}>{t("mem.edit")}</button>
                    <button className={modo === "ler" ? "on" : ""} onClick={() => { persistir(); setModo("ler"); }}>{t("mem.read")}</button>
                  </div>
                  <button className="mm-del" onClick={esquecer} title={t("mem.forget_title")}>{t("mem.forget")}</button>
                </div>

                <div className="mm-meta">
                  <input value={draft.tags} onChange={e => mudou({ tags: e.target.value })} placeholder={t("mem.tags_ph")} />
                  <input value={draft.project} onChange={e => mudou({ project: e.target.value })} placeholder={t("mem.project_ph")} list="mm-projetos" />
                  <datalist id="mm-projetos">{projetos.map(p => <option key={p} value={p} />)}</datalist>
                </div>

                {modo === "editar" ? (
                  <textarea
                    className="mm-editor" autoFocus value={draft.content}
                    onChange={e => mudou({ content: e.target.value })}
                    onBlur={() => persistir()}
                    placeholder={t("mem.editor_ph")}
                  />
                ) : (
                  <div className="mm-leitura">
                    {draft.content.trim()
                      ? <Markdown texto={draft.content} onWiki={irPara} />
                      : <p className="mm-branco-txt">{t("mem.empty_note")}</p>}
                  </div>
                )}
              </>
            )}
          </section>

          {/* ── com quem essa memória conversa ── */}
          {draft && (
            <aside className="mm-lig-painel">
              <div className="mm-lig-cab">{t("mem.related")} <em>{t("mem.related.by_meaning")}</em></div>
              {vizinhas.length === 0 && (
                <p className="mm-lig-vazio">
                  {abertaId ? t("mem.related.none") : t("mem.related.unsaved")}
                </p>
              )}
              {vizinhas.map(v => (
                <button key={v.id} className="mm-lig-item" onClick={() => abrir(v)}>
                  <span className="mm-lig-barra" style={{ "--f": v.score }} />
                  <span className="mm-lig-t">{tituloDe(v, t)}</span>
                  <em>{Math.round(v.score * 100)}%</em>
                </button>
              ))}

              {retro.length > 0 && (
                <>
                  <div className="mm-lig-cab mm-lig-cab--2">{t("mem.backlinks")} <em>[[link]]</em></div>
                  {retro.map(r => (
                    <button key={r.id} className="mm-lig-item" onClick={() => abrir(r)}>
                      <span className="mm-lig-t">{tituloDe(r, t)}</span>
                    </button>
                  ))}
                </>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

/* Saúde da base num chip: é o que revela silenciosamente que o embedder caiu. */
function SaudeChip({ s }) {
  const { t } = useT();
  const e = s.embedder || {};
  const ok = e.alcancavel && s.comVetor === s.total && s.comLinks > 0;
  const tom = !e.url || !e.alcancavel ? "ruim" : ok ? "bom" : "meio";
  return (
    <span className={`mm-saude mm-saude--${tom}`} title={s.diagnostico}>
      <i />
      {t("mem.health", { a: s.comVetor, b: s.total, c: s.comLinks })}
    </span>
  );
}
