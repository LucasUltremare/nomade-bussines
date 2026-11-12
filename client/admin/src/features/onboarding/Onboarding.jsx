import { useState, useEffect } from "react";
import { api } from "../../api/client.js";
import { useT, LANGS } from "../../i18n/index.jsx";
import { Icon } from "../../components/Icon.jsx";
import { RegiaoEditor } from "../settings/Regiao.jsx";
import { TelasEditor } from "../settings/Telas.jsx";
import { LAYOUTS } from "../../lib/telas.js";
import "./onboarding.css";

/* ══════════════════════════════════════════════════════════
   ONBOARDING — a primeira vez que alguém abre o painel.
   Salva a cada passo (PUT /api/admin/empresa): fechar no meio
   não perde nada, e reabrir continua de onde parou.
   ══════════════════════════════════════════════════════════ */

/* A ordem. "link" e "connect" só aparecem se a empresa ligou as telas a que
   eles servem (Leads; conversa, agentes e máquinas). */
const TODOS = ["lang", "company", "region", "screens", "hours", "link", "team", "connect", "done"];
const DE_IA = ["chat", "runner", "memoria", "integrations"];
const passosPara = (modulos) => TODOS.filter((p) =>
  p === "link" ? modulos.includes("leads") : p === "connect" ? modulos.some((m) => DE_IA.includes(m)) : true);
const CAMPOS = ["name", "email", "whatsapp", "company", "msg"];
const PERMS_PADRAO = ["kanban", "clients", "propostas", "leads", "projetos"];

const ofetch = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) } })
    .then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok) throw new Error(b?.error || `HTTP ${r.status}`); return b; });

export function Onboarding({ empresa, onDone }) {
  const { t, lang, setLang } = useT();
  const [salvando, setSalvando] = useState(false);
  const [cfg, setCfg] = useState(() => ({
    nome: /^(Minha Empresa|Sua Empresa)$/.test(empresa?.nome || "") ? "" : (empresa?.nome || ""),
    descricao: empresa?.descricao || "",
    site: empresa?.site && !/suaempresa|localhost/.test(empresa.site) ? empresa.site : "",
    pais: empresa?.pais || "BR",
    moeda: empresa?.moeda || "BRL",
    cidade: empresa?.cidade || "",
    semanaComeca: empresa?.semanaComeca ?? 1,
    modulos: empresa?.modulos || LAYOUTS.full,
    horario: empresa?.horario || { dias: [1, 2, 3, 4, 5], abre: "09:00", fecha: "18:00" },
    // primeira vez: o fuso do computador de quem está configurando é o melhor palpite
    fuso: empresa?.onboarding?.passo ? empresa.fuso : (Intl.DateTimeFormat().resolvedOptions().timeZone || empresa?.fuso || "UTC"),
  }));
  const PASSOS = passosPara(cfg.modulos);
  const [passo, setPasso] = useState(() => Math.min(PASSOS.length - 2, empresa?.onboarding?.passo || 0));
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const total = PASSOS.length - 1; // "done" não conta
  const id = PASSOS[passo];

  const salvar = async (proximo = passo + 1) => {
    setSalvando(true);
    try {
      await ofetch("/hq/api/admin/empresa", { method: "PUT", body: JSON.stringify({ ...cfg, idioma: lang, onboarding: { passo: proximo, feito: proximo >= PASSOS.length - 1 } }) });
      setPasso(proximo);
    } finally { setSalvando(false); }
  };
  const avancar = () => salvar();
  const voltar = () => setPasso((p) => Math.max(0, p - 1));

  const podeAvancar = id !== "company" || cfg.nome.trim().length >= 2;

  return (
    <div className="ob">
      <div className="ob__progress"><i style={{ width: `${Math.min(100, (passo / total) * 100)}%` }} /></div>

      <aside className="ob__rail">
        <div className="ob__brand"><span className="ob__mark">{(cfg.nome || "N").trim().slice(0, 1).toUpperCase()}</span>{cfg.nome || "Nomade Business"}</div>
        <ol className="ob__steps">
          {PASSOS.slice(0, -1).map((p, i) => (
            <li key={p} className={i === passo ? "on" : i < passo ? "done" : ""} onClick={() => i < passo && setPasso(i)}>
              <span className="ob__n">{i + 1}</span>
              <span>{t(`ob.s.${p}`)}</span>
              {i < passo && <Icon name="check" size={12} />}
            </li>
          ))}
        </ol>
        <p className="ob__hint">{t("ob.hint")}</p>
      </aside>

      <main className="ob__main">
        <div className="ob__top">
          <span className="ob__count">{id === "done" ? "" : t("ob.step", { n: passo + 1, total })}</span>
          <div className="ob__langs">{LANGS.map((l) => <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l}</button>)}</div>
        </div>

        <section className={`ob__body${id === "screens" ? " ob__body--wide" : ""}`} key={id}>
          {id === "lang" && (
            <>
              <h1 className="ob__title">{t("ob.lang.title")}</h1>
              <p className="ob__sub">{t("ob.lang.sub")}</p>
              <div className="ob__cards ob__cards--3">
                {LANGS.map((l) => (
                  <button key={l} className={`ob__card${lang === l ? " on" : ""}`} onClick={() => setLang(l)}>
                    <b>{t(`lang.${l}`)}</b>
                    <span className="ob__check"><Icon name="check" size={12} /></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {id === "company" && (
            <>
              <h1 className="ob__title">{t("ob.company.title")}</h1>
              <p className="ob__sub">{t("ob.company.sub")}</p>
              <label className="ob__f"><span>{t("ob.company.name")}</span>
                <input autoFocus value={cfg.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Acme Studio" maxLength={80} />
              </label>
              <label className="ob__f"><span>{t("ob.company.desc")}</span>
                <textarea rows={3} value={cfg.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder={t("ob.company.desc_ph")} maxLength={600} />
              </label>
              <label className="ob__f"><span>{t("ob.company.site")}</span>
                <input value={cfg.site} onChange={(e) => set("site", e.target.value)} placeholder="https://" />
              </label>
            </>
          )}

          {id === "region" && (
            <>
              <h1 className="ob__title">{t("ob.region.title")}</h1>
              <p className="ob__sub">{t("ob.region.sub")}</p>
              <RegiaoEditor value={cfg} onChange={setCfg} cls={{ grid: "ob__row", f: "ob__f" }} />
            </>
          )}

          {id === "screens" && (
            <>
              <h1 className="ob__title">{t("ob.screens.title")}</h1>
              <p className="ob__sub">{t("ob.screens.sub")}</p>
              <TelasEditor value={cfg.modulos} onChange={(m) => set("modulos", m)} />
            </>
          )}

          {id === "hours" && (
            <>
              <h1 className="ob__title">{t("ob.hours.title")}</h1>
              <p className="ob__sub">{t("ob.hours.sub")}</p>
              <HorarioEditor value={cfg.horario} onChange={(h) => set("horario", h)} />
            </>
          )}

          {id === "link" && <PassoLink />}
          {id === "team" && <PassoTime />}
          {id === "connect" && <PassoConectar />}

          {id === "done" && (
            <div className="ob__done">
              <div className="ob__done-mark">{(cfg.nome || "N").trim().slice(0, 1).toUpperCase()}</div>
              <h1 className="ob__title">{t("ob.done.title", { name: cfg.nome || "Nomade" })}</h1>
              <p className="ob__sub">{t("ob.done.sub")}</p>
              <button className="ob__btn ob__btn--primary" onClick={onDone}>{t("ob.finish")} <Icon name="arrow" size={14} /></button>
            </div>
          )}
        </section>

        {id !== "done" && (
          <footer className="ob__foot">
            <button className="ob__btn ob__btn--ghost" onClick={voltar} disabled={passo === 0 || salvando}>{t("ob.back")}</button>
            <div className="ob__foot-r">
              {!["lang", "company"].includes(id) && <button className="ob__btn ob__btn--ghost" onClick={avancar} disabled={salvando}>{t("ob.skip")}</button>}
              <button className="ob__btn ob__btn--primary" onClick={avancar} disabled={!podeAvancar || salvando}>
                {passo === total - 1 ? t("ob.finish") : t("ob.next")} <Icon name="arrow" size={14} />
              </button>
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}

/* ── horário ───────────────────────────────────────────────── */
export function HorarioEditor({ value, onChange }) {
  const { t } = useT();
  const dias = value?.dias || [];
  const toggle = (d) => onChange({ ...value, dias: dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d].sort() });
  return (
    <div className="ob__hours">
      <div className="ob__f"><span>{t("ob.hours.days")}</span>
        <div className="ob__days">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" aria-pressed={dias.includes(d)} onClick={() => toggle(d)}>{t(`day.${d}`)}</button>
          ))}
        </div>
      </div>
      <div className="ob__row">
        <label className="ob__f"><span>{t("ob.hours.open")}</span><input type="time" value={value?.abre || "09:00"} onChange={(e) => onChange({ ...value, abre: e.target.value })} /></label>
        <label className="ob__f"><span>{t("ob.hours.close")}</span><input type="time" value={value?.fecha || "18:00"} onChange={(e) => onChange({ ...value, fecha: e.target.value })} /></label>
      </div>
    </div>
  );
}

/* ── link de cadastro ──────────────────────────────────────── */
function PassoLink() {
  const { t, lang } = useT();
  const [titulo, setTitulo] = useState("");
  const [idioma, setIdioma] = useState(lang);
  const [campos, setCampos] = useState(["name", "email", "whatsapp", "msg"]);
  const [criado, setCriado] = useState(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [voando, setVoando] = useState(false);

  const criar = async () => {
    setVoando(true); setErro("");
    try { setCriado(await ofetch("/hq/api/admin/forms", { method: "POST", body: JSON.stringify({ titulo: titulo || t("ob.link.form_title_ph"), idioma, campos }) })); }
    catch (e) { setErro(e.message); }
    finally { setVoando(false); }
  };
  const copiar = () => navigator.clipboard?.writeText(criado.url).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); });

  return (
    <>
      <h1 className="ob__title">{t("ob.link.title")}</h1>
      <p className="ob__sub">{t("ob.link.sub")}</p>
      {!criado ? (
        <>
          <label className="ob__f"><span>{t("ob.link.form_title")}</span>
            <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={t("ob.link.form_title_ph")} maxLength={80} />
          </label>
          <div className="ob__row">
            <div className="ob__f"><span>{t("ob.link.fields")}</span>
              <div className="ob__days">
                {CAMPOS.map((c) => (
                  <button key={c} type="button" aria-pressed={campos.includes(c)} disabled={c === "name"} onClick={() => setCampos(campos.includes(c) ? campos.filter((x) => x !== c) : [...campos, c])}>{t(`field.${c}`)}</button>
                ))}
              </div>
            </div>
            <label className="ob__f ob__f--sm"><span>{t("ob.link.lang")}</span>
              <select value={idioma} onChange={(e) => setIdioma(e.target.value)}>{LANGS.map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}</select>
            </label>
          </div>
          {erro && <p className="ob__err">{erro}</p>}
          <button className="ob__btn ob__btn--primary" onClick={criar} disabled={voando}>{t("ob.link.create")}</button>
        </>
      ) : (
        <div className="ob__linkbox">
          <div className="ob__linkbox-h"><i /> {t("ob.link.created")}</div>
          <code>{criado.url}</code>
          <div className="ob__linkbox-a">
            <button className="ob__btn ob__btn--primary" onClick={copiar}>{copiado ? t("ob.link.copied") : t("ob.link.copy")}</button>
            <a className="ob__btn ob__btn--ghost" href={criado.url} target="_blank" rel="noreferrer">{t("ob.link.open")} <Icon name="external" size={13} /></a>
          </div>
        </div>
      )}
    </>
  );
}

/* ── time ──────────────────────────────────────────────────── */
function PassoTime() {
  const { t } = useT();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [lista, setLista] = useState([]);
  const [erro, setErro] = useState("");
  const [voando, setVoando] = useState(false);
  const add = async () => {
    if (!email.trim()) return;
    setVoando(true); setErro("");
    try {
      const m = await ofetch("/hq/api/admin/membros", { method: "POST", body: JSON.stringify({ nome, email, perms: PERMS_PADRAO }) });
      setLista((l) => [...l, m]); setNome(""); setEmail("");
    } catch (e) { setErro(t("ob.team.err", { e: e.message })); }
    finally { setVoando(false); }
  };
  return (
    <>
      <h1 className="ob__title">{t("ob.team.title")}</h1>
      <p className="ob__sub">{t("ob.team.sub")}</p>
      <div className="ob__row">
        <label className="ob__f"><span>{t("ob.team.name")}</span><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ana" /></label>
        <label className="ob__f"><span>{t("ob.team.email")}</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="ana@company.com" /></label>
      </div>
      {erro && <p className="ob__err">{erro}</p>}
      <button className="ob__btn ob__btn--ghost" onClick={add} disabled={voando || !email.trim()}><Icon name="plus" size={13} /> {t("ob.team.add")}</button>
      {lista.length > 0 && (
        <ul className="ob__list">
          {lista.map((m) => <li key={m._id || m.email}><b>{m.nome || m.email}</b><span>{m.email}</span><em>{t("ob.team.added")}</em></li>)}
        </ul>
      )}
    </>
  );
}

/* ── conectar ──────────────────────────────────────────────── */
/* Todos os provedores (lib/provedores.js no servidor) e o modelo que o chat
   vai usar. Agente e máquina saíram daqui: quem quiser usa o plug do Relay. */
const PROV_PADRAO = [{ id: "anthropic", nome: "Anthropic", produto: "Claude", prefixo: "sk-ant-…", modelos: ["claude-sonnet-5"] }];

function PassoConectar() {
  const { t } = useT();
  const [provs, setProvs] = useState(PROV_PADRAO);
  const [provider, setProvider] = useState("anthropic");
  const [chave, setChave] = useState("");
  const [modelos, setModelos] = useState([]);
  const [modelo, setModelo] = useState("");
  const [estado, setEstado] = useState(null); // "ok" | "erro" | null
  const [voando, setVoando] = useState(false);
  const p = provs.find((x) => x.id === provider) || provs[0];

  useEffect(() => { ofetch("/api/office/provedores").then((l) => Array.isArray(l) && l.length && setProvs(l)).catch(() => {}); }, []);
  useEffect(() => { setModelos(p?.modelos || []); setModelo(p?.modelos?.[0] || ""); setEstado(null); }, [provider, p]);

  const salvarChave = async () => {
    if (!chave.trim()) return;
    setVoando(true); setEstado(null);
    try {
      await ofetch("/api/office/keys", { method: "PATCH", body: JSON.stringify({ [provider]: chave.trim() }) });
      setChave("");
      // com a chave salva, a lista vem ao vivo do provedor: todos os modelos que a conta enxerga
      const vivo = await ofetch(`/api/office/modelos/${provider}`).catch(() => null);
      if (vivo?.modelos?.length) setModelos(vivo.modelos);
      await ofetch("/api/office/orq-info", { method: "PATCH", body: JSON.stringify({ provider, model: modelo || p.modelos[0] }) }).catch(() => {});
      setEstado("ok");
    } catch { setEstado("erro"); }
    finally { setVoando(false); }
  };
  const escolherModelo = (m) => {
    setModelo(m);
    if (estado === "ok") ofetch("/api/office/orq-info", { method: "PATCH", body: JSON.stringify({ provider, model: m }) }).catch(() => {});
  };

  return (
    <>
      <h1 className="ob__title">{t("ob.connect.title")}</h1>
      <p className="ob__sub">{t("ob.connect.sub")}</p>
      <div className="ob__cbox">
        <div className="ob__cbox-h"><Icon name="cpu" size={15} /><b>{t("ob.connect.ai")}</b></div>
        <p>{t("ob.connect.ai_d")}</p>
        <div className="ob__provs" role="radiogroup" aria-label={t("ob.connect.ai")}>
          {provs.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={x.id === provider} onClick={() => setProvider(x.id)}>
              <b>{x.produto}</b><small>{x.nome}</small>
            </button>
          ))}
        </div>
        <div className="ob__row ob__row--tight">
          <input type="password" value={chave} onChange={(e) => setChave(e.target.value)} placeholder={p?.prefixo || "sk-…"} autoComplete="off" />
          <button className="ob__btn ob__btn--primary" onClick={salvarChave} disabled={voando || !chave.trim()}>{t("int.save")}</button>
        </div>
        {p?.site && <a className="ob__keylink" href={p.site} target="_blank" rel="noreferrer">{t("int.ai.get_key")} · {p.nome} ↗</a>}
        <label className="ob__f"><span>{t("ob.connect.model")}</span>
          <input list="ob-modelos" value={modelo} onChange={(e) => escolherModelo(e.target.value)} spellCheck="false" />
          <datalist id="ob-modelos">{modelos.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        {estado === "ok" && <em className="ob__ok">{t("int.saved")} · {t("ob.connect.models_n", { n: modelos.length })}</em>}
        {estado === "erro" && <em className="ob__err">{t("ob.connect.err")}</em>}
      </div>
    </>
  );
}
