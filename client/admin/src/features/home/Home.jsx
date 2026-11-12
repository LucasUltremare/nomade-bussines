import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { useT, useTimeAgo, localeOf } from "../../i18n/index.jsx";
import { dinheiro } from "../../lib/regional.js";
import "./home.css";

/* ══════════════════════════════════════════════════════════
   HOME — os números do mês, o gráfico de 30 dias, o que pede
   atenção, o que aconteceu por último e os atalhos. Só mostra
   o que pertence às telas que a empresa ligou (prop `tem`).
   Dado real de /api/admin/home.
   ══════════════════════════════════════════════════════════ */

const moeda = (n, lang) => dinheiro(n, lang, { maximumFractionDigits: 0 });
const num = (n, lang) => new Intl.NumberFormat(localeOf(lang)).format(Number(n) || 0);

function useCountUp(target, dur = 900) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const to = Number(target) || 0, from = prev.current; prev.current = to;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || from === to) { setVal(to); return; }
    let raf; const t0 = performance.now();
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur); setVal(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return val;
}

/* ── gráfico de área, 30 dias, com cursor ─────────────────── */
function AreaChart({ serie, formato, lang }) {
  const [hover, setHover] = useState(null);
  const W = 900, H = 220, pL = 44, pR = 12, pT = 16, pB = 28;
  const pw = W - pL - pR, ph = H - pT - pB;
  const max = Math.max(1, ...serie);
  const nice = max <= 5 ? max : Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));
  const x = (i) => pL + (i / (serie.length - 1)) * pw;
  const y = (v) => pT + ph * (1 - v / nice);
  const pts = serie.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const linha = `M${pts.join(" L")}`;
  const area = `${linha} L${x(serie.length - 1).toFixed(1)},${(pT + ph).toFixed(1)} L${pL},${(pT + ph).toFixed(1)} Z`;
  const dia = (i) => { const d = new Date(); d.setDate(d.getDate() - (serie.length - 1 - i)); return d; };
  const fmtDia = (d) => d.toLocaleDateString(localeOf(lang), { month: "short", day: "numeric" });
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pL) / pw) * (serie.length - 1));
    setHover(Math.max(0, Math.min(serie.length - 1, i)));
  };
  const ticks = [0, nice / 2, nice].map((v) => Math.round(v));
  return (
    <div className="hm-chart-wrap">
      <svg className="hm-chart" viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
        <defs>
          <linearGradient id="hm-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".22" /><stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}><line className="hm-gridline" x1={pL} x2={W - pR} y1={y(v)} y2={y(v)} /><text className="hm-ax" x={pL - 8} y={y(v) + 3} textAnchor="end">{formato(v)}</text></g>
        ))}
        {[0, 7, 14, 21, 29].map((i) => <text key={i} className="hm-ax" x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === 29 ? "end" : "middle"}>{fmtDia(dia(i))}</text>)}
        <path className="hm-area" d={area} fill="url(#hm-fill)" />
        <path className="hm-line" d={linha} pathLength="1" />
        {hover != null && (
          <g>
            <line className="hm-cursor" x1={x(hover)} x2={x(hover)} y1={pT} y2={pT + ph} />
            <circle className="hm-dot" cx={x(hover)} cy={y(serie[hover])} r="4" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="hm-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <span>{fmtDia(dia(hover))}</span><b>{formato(serie[hover])}</b>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, delta, up }) {
  return (
    <div className="hm-kpi">
      <div className="hm-kpi-l">{label}</div>
      <div className="hm-kpi-v">{value}</div>
      <div className="hm-kpi-h">
        {delta != null && <em className={up ? "up" : "down"}>{delta}</em>}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}

export function Home({ user, me, onGoTo, tem = () => true, runnerOnline, decisoes }) {
  const { t, lang } = useT();
  const ago = useTimeAgo();
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [serieSel, setSerieSel] = useState("leads");

  useEffect(() => {
    const load = () => api.get("/api/admin/home").then(setD).catch((e) => setErro(e.message));
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  const hora = new Date().getHours();
  const saud = hora < 12 ? t("home.greeting.morning") : hora < 18 ? t("home.greeting.afternoon") : t("home.greeting.evening");
  const nome = (me?.name || user?.name || "").split(" ")[0];
  const k = d?.kpis;

  const leadsUp = useCountUp(k?.leads.total ?? 0);
  const recUp = useCountUp(k?.receita.mes ?? 0);
  const propUp = useCountUp(k?.propostas.aguardando ?? 0);
  const taskUp = useCountUp(k?.tasks.abertas ?? 0);

  const deltaLeads = useMemo(() => {
    if (!k) return null;
    const a = k.leads.semana, b = k.leads.semanaAnterior;
    if (!b) return a ? "+100%" : null;
    return `${a >= b ? "+" : "−"}${Math.abs(Math.round(((a - b) / b) * 100))}%`;
  }, [k]);

  /* sinais: os do servidor + os que só o painel sabe (máquina, decisões) */
  const sinais = useMemo(() => {
    const s = (d?.sinais || []).filter((x) => !x.tab || tem(x.tab));
    if (decisoes > 0 && tem("inbox")) s.unshift({ id: "decisions", front: "system", level: "warn", n: decisoes, tab: "inbox" });
    const peso = { risk: 0, warn: 1, ok: 2 };
    return s.sort((a, b) => peso[a.level] - peso[b.level]);
  }, [d, runnerOnline, decisoes]); // eslint-disable-line react-hooks/exhaustive-deps

  /* cada número pertence a uma tela; tela desligada, número fora */
  const vendas = tem("leads"), dinheiroOn = tem("finance") || tem("payments") || tem("propostas");
  const series = [vendas && "leads", dinheiroOn && "receita"].filter(Boolean);
  const serie = series.includes(serieSel) ? serieSel : series[0];
  const atalhos = [
    ["payments", "zap", "home.quick.payment"], ["settings", "link", "home.quick.lead", "leads"],
    ["integrations", "plug", "home.quick.integration"], ["settings", "settings", "home.quick.settings"],
  ].filter(([tab, , , precisa]) => tem(precisa || tab));

  const perguntar = (e) => {
    e.preventDefault();
    const txt = e.target.elements.q.value.trim();
    if (!txt) return;
    sessionStorage.setItem("orq-prefill", txt);
    onGoTo?.("chat");
  };

  const feedTxt = (f) => t(`home.feed.${f.tipo}`, { name: f.nome || "—", n: f.numero ?? "" });
  const dataHoje = new Date().toLocaleDateString(localeOf(lang), { weekday: "short", day: "numeric", month: "long" });

  return (
    <div className="hm">
      <header className="hm-head">
        <div>
          <h1 className="hm-title">{saud}{nome ? `, ${nome}` : ""}</h1>
        </div>
        <div className="hm-date">{dataHoje}</div>
      </header>

      {tem("chat") && (
        <form className="hm-ask" onSubmit={perguntar}>
          <Icon name="comment" size={15} />
          <input name="q" placeholder={t("home.ask")} autoComplete="off" />
          <button type="submit" aria-label={t("home.ask_send")}><Icon name="arrow" size={15} /></button>
        </form>
      )}

      {erro && <div className="hm-err">{t("common.error", { e: erro })}</div>}

      <div className="hm-grid">
        <div className="hm-main">
          <section className="hm-kpis">
            {vendas && <Kpi label={t("home.kpi.leads")} value={d ? num(Math.round(leadsUp), lang) : "—"} delta={deltaLeads} up={!deltaLeads?.startsWith("−")} hint={k?.leads.novos ? t("home.kpi.leads_new", { n: k.leads.novos }) : t("home.vs")} />}
            {dinheiroOn && <Kpi label={t("home.kpi.revenue")} value={d ? moeda(recUp, lang) : "—"} hint={k ? `${moeda(k.receita.aReceber, lang)} · ${t("home.kpi.receivable", { n: k.receita.aReceberN })}` : ""} />}
            {tem("propostas") && <Kpi label={t("home.kpi.pipeline")} value={d ? num(Math.round(propUp), lang) : "—"} hint={k ? `${moeda(k.propostas.emJogo, lang)} ${t("home.kpi.in_play")}` : ""} />}
            {tem("tasks") && <Kpi label={t("home.kpi.tasks")} value={d ? num(Math.round(taskUp), lang) : "—"} delta={k?.tasks.atrasadas ? t("home.kpi.overdue", { n: k.tasks.atrasadas }) : null} up={false} hint={k ? t("home.kpi.done7", { n: k.tasks.feitas7 }) : ""} />}
          </section>

          {series.length > 0 && <section className="hm-panel">
            <div className="hm-ph">
              <div>
                <div className="hm-pt">{serie === "leads" ? t("home.chart.title") : t("home.chart.revenue")}</div>
                <div className="hm-ps">{t("home.chart.sub")}</div>
              </div>
              {series.length > 1 && (
                <div className="hm-seg">
                  <button aria-pressed={serie === "leads"} onClick={() => setSerieSel("leads")}>{t("nav.leads")}</button>
                  <button aria-pressed={serie === "receita"} onClick={() => setSerieSel("receita")}>{t("nav.finance")}</button>
                </div>
              )}
            </div>
            {k ? (
              <AreaChart serie={serie === "leads" ? k.leads.serie : k.receita.serie} lang={lang} formato={(v) => (serie === "leads" ? num(v, lang) : moeda(v, lang))} />
            ) : <div className="hm-empty">{t("common.loading")}</div>}
          </section>}

          <section className="hm-panel">
            <div className="hm-ph">
              <div><div className="hm-pt">{t("home.signals.title")}</div><div className="hm-ps">{t("home.signals.sub")}</div></div>
            </div>
            <table className="hm-table">
              <thead><tr><th>{t("home.signals.front")}</th><th>{t("home.signals.signal")}</th><th>{t("home.signals.state")}</th><th>{t("home.signals.next")}</th></tr></thead>
              <tbody>
                {sinais.map((s, i) => (
                  <tr key={s.id} style={{ "--i": i }}>
                    <td className="hm-front">{t(`home.front.${s.front}`)}</td>
                    <td>{t(`home.sig.${s.id}`, { n: s.n ?? 0 })}{s.valor ? <em> · {moeda(s.valor, lang)}</em> : null}</td>
                    <td><span className={`hm-pill hm-pill--${s.level}`}><i />{t(`home.level.${s.level}`)}</span></td>
                    <td><button className="hm-act" onClick={() => onGoTo?.(s.tab)}>{t(`home.sig.${s.id}_a`)} <Icon name="arrow" size={12} /></button></td>
                  </tr>
                ))}
                {d && sinais.length === 0 && <tr><td colSpan={4} className="hm-empty">{t("home.signals.empty")}</td></tr>}
                {!d && <tr><td colSpan={4} className="hm-empty">{t("common.loading")}</td></tr>}
              </tbody>
            </table>
          </section>
        </div>

        <aside className="hm-side">
          <section className="hm-panel">
            <div className="hm-ph"><div className="hm-pt">{t("home.quick.title")}</div></div>
            <div className="hm-quick">
              {atalhos.map(([tab, icone, rotulo]) => (
                <button key={rotulo} onClick={() => onGoTo?.(tab)}><Icon name={icone} size={15} />{t(rotulo)}</button>
              ))}
            </div>
          </section>
          <section className="hm-panel">
            <div className="hm-ph"><div className="hm-pt">{t("home.feed.title")}</div></div>
            <div className="hm-feed">
              {d && d.feed.length === 0 && <div className="hm-empty">{t("home.feed.empty")}</div>}
              {(d?.feed || []).map((f, i) => (
                <div className="hm-fitem" key={`${f.tipo}-${f.at}-${i}`} style={{ "--i": i }}>
                  <i className={`hm-fdot hm-fdot--${f.tipo}`} />
                  <div className="hm-ftxt">{feedTxt(f)}{f.valor ? <b> {moeda(f.valor, lang)}</b> : null}</div>
                  <time>{ago(f.at)}</time>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
