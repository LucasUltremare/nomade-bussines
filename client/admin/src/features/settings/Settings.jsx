import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { useT, LANGS } from "../../i18n/index.jsx";
import { HorarioEditor } from "../onboarding/Onboarding.jsx";
import { RegiaoEditor } from "./Regiao.jsx";
import { TelasEditor } from "./Telas.jsx";
import { AmbienteLista } from "./Ambiente.jsx";
import { setRegional } from "../../lib/regional.js";
import "./settings.css";

/* ══════════════════════════════════════════════════════════
   AJUSTES — tudo que a empresa configura: quem é, de onde é,
   em que moeda recebe, quais telas usa, horário, aparência e
   os links de cadastro.
   ══════════════════════════════════════════════════════════ */

const CAMPOS = ["name", "email", "whatsapp", "company", "msg"];

export function Settings({ empresa, theme, onChange, onRerunOnboarding, onTour }) {
  const { t, lang, setLang } = useT();
  const [f, setF] = useState(() => ({ ...empresa }));
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setSalvo(false); };

  useEffect(() => { setF({ ...empresa }); }, [empresa]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const salva = await api.put("/api/admin/empresa", {
        nome: f.nome, descricao: f.descricao, site: f.site, email: f.email, whatsapp: f.whatsapp,
        documento: f.documento, endereco: f.endereco,
        pais: f.pais, cidade: f.cidade, moeda: f.moeda, fuso: f.fuso, semanaComeca: f.semanaComeca,
        modulos: f.modulos, horario: f.horario, idioma: f.idioma, tema: f.tema,
      });
      setRegional(salva);
      setSalvo(true); onChange?.();
    } finally { setSalvando(false); }
  };

  return (
    <div className="st">
      <header className="st-head">
        <div><h1 className="st-title">{t("set.title")}</h1><p className="st-sub">{t("set.sub")}</p></div>
        <button className="st-btn st-btn--p" onClick={salvar} disabled={salvando}>{salvo ? <><Icon name="check" size={13} /> {t("set.saved")}</> : t("set.save")}</button>
      </header>

      <section className="st-sec">
        <div className="st-sec-h"><h2>{t("set.company")}</h2></div>
        <div className="st-grid">
          <label className="st-f"><span>{t("ob.company.name")}</span><input value={f.nome || ""} onChange={(e) => set("nome", e.target.value)} /></label>
          <label className="st-f"><span>{t("ob.company.site")}</span><input value={f.site || ""} onChange={(e) => set("site", e.target.value)} /></label>
          <label className="st-f st-f--full"><span>{t("ob.company.desc")}</span><textarea rows={3} value={f.descricao || ""} onChange={(e) => set("descricao", e.target.value)} /></label>
          <label className="st-f"><span>{t("field.email")}</span><input value={f.email || ""} onChange={(e) => set("email", e.target.value)} /></label>
          <label className="st-f"><span>{t("field.whatsapp")}</span><input value={f.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} inputMode="tel" /></label>
          <label className="st-f"><span>{t("set.taxid")}</span><input value={f.documento || ""} onChange={(e) => set("documento", e.target.value)} maxLength={60} /></label>
          <label className="st-f"><span>{t("set.address")}</span><input value={f.endereco || ""} onChange={(e) => set("endereco", e.target.value)} maxLength={200} /></label>
        </div>
      </section>

      <section className="st-sec">
        <div className="st-sec-h"><div><h2>{t("set.region")}</h2><p className="st-sec-s">{t("set.region.sub")}</p></div></div>
        <RegiaoEditor value={f} onChange={(v) => { setF(v); setSalvo(false); }} />
      </section>

      <section className="st-sec">
        <div className="st-sec-h"><div><h2>{t("set.screens")}</h2><p className="st-sec-s">{t("set.screens.sub")}</p></div></div>
        <TelasEditor value={f.modulos} onChange={(m) => set("modulos", m)} />
      </section>

      <section className="st-sec">
        <div className="st-sec-h"><h2>{t("set.hours")}</h2></div>
        <HorarioEditor value={f.horario} onChange={(h) => set("horario", h)} />
      </section>

      <section className="st-sec">
        <div className="st-sec-h"><h2>{t("set.appearance")}</h2></div>
        <div className="st-grid">
          <div className="st-f"><span>{t("nav.theme")}</span>
            <div className="st-seg">
              {["light", "dark"].map((tm) => <button key={tm} aria-pressed={(f.tema || theme.theme) === tm} onClick={() => { set("tema", tm); theme.setTheme(tm); }}><Icon name={tm === "dark" ? "moon" : "sun"} size={13} />{t(`set.theme.${tm}`)}</button>)}
            </div>
          </div>
          <div className="st-f"><span>{t("nav.lang")}</span>
            <div className="st-seg">
              {LANGS.map((l) => <button key={l} aria-pressed={(f.idioma || lang) === l} onClick={() => { set("idioma", l); setLang(l); }}>{t(`lang.${l}`)}</button>)}
            </div>
          </div>
        </div>
      </section>

      <Links />

      <section className="st-sec">
        <div className="st-sec-h"><div><h2>{t("amb.title")}</h2><p className="st-sec-s">{t("amb.sub")}</p></div></div>
        <AmbienteLista />
      </section>

      <section className="st-sec">
        <div className="st-sec-h"><div><h2>{t("set.help")}</h2><p className="st-sec-s">{t("set.help.sub")}</p></div></div>
        <div className="st-row st-row--top">
          <button className="st-btn" onClick={onTour}><Icon name="help" size={13} /> {t("tour.open")}</button>
          <button className="st-btn" onClick={onRerunOnboarding}><Icon name="refresh" size={13} /> {t("set.rerun")}</button>
        </div>
      </section>
    </div>
  );
}

/* ── links de cadastro ───────────────────────────────────── */
function Links() {
  const { t, lang } = useT();
  const [lista, setLista] = useState(null);
  const [novo, setNovo] = useState(null); // {titulo, idioma, campos, descricao}
  const [copiado, setCopiado] = useState("");
  const load = () => api.get("/api/admin/forms").then(setLista).catch(() => setLista([]));
  useEffect(load, []);

  const criar = async () => {
    if (!novo?.titulo?.trim()) return;
    await api.post("/api/admin/forms", novo);
    setNovo(null); load();
  };
  const patch = async (f, body) => { await api.patch(`/api/admin/forms/${f.slug}`, body); load(); };
  const apagar = async (f) => { if (!window.confirm(t("set.links.delete_q"))) return; await api.del(`/api/admin/forms/${f.slug}`); load(); };
  const copiar = (url) => navigator.clipboard?.writeText(url).then(() => { setCopiado(url); setTimeout(() => setCopiado(""), 1500); });

  return (
    <section className="st-sec">
      <div className="st-sec-h">
        <div><h2>{t("set.links")}</h2><p className="st-sec-s">{t("set.links.sub")}</p></div>
        <button className="st-btn" onClick={() => setNovo({ titulo: "", idioma: lang, campos: ["name", "email", "whatsapp", "msg"], descricao: "" })}><Icon name="plus" size={13} /> {t("set.links.new")}</button>
      </div>

      {novo && (
        <div className="st-new">
          <div className="st-grid">
            <label className="st-f"><span>{t("ob.link.form_title")}</span><input autoFocus value={novo.titulo} onChange={(e) => setNovo({ ...novo, titulo: e.target.value })} placeholder={t("ob.link.form_title_ph")} /></label>
            <label className="st-f"><span>{t("ob.link.lang")}</span><select value={novo.idioma} onChange={(e) => setNovo({ ...novo, idioma: e.target.value })}>{LANGS.map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}</select></label>
            <div className="st-f st-f--full"><span>{t("ob.link.fields")}</span>
              <div className="st-chips">{CAMPOS.map((c) => <button key={c} aria-pressed={novo.campos.includes(c)} disabled={c === "name"} onClick={() => setNovo({ ...novo, campos: novo.campos.includes(c) ? novo.campos.filter((x) => x !== c) : [...novo.campos, c] })}>{t(`field.${c}`)}</button>)}</div>
            </div>
          </div>
          <div className="st-row"><button className="st-btn st-btn--p" onClick={criar} disabled={!novo.titulo.trim()}>{t("ob.link.create")}</button><button className="st-btn" onClick={() => setNovo(null)}>{t("common.cancel")}</button></div>
        </div>
      )}

      {lista === null ? null : lista.length === 0 && !novo ? <div className="st-empty">{t("set.links.empty")}</div> : (
        <div className="st-links">
          {lista.map((f) => (
            <div key={f.slug} className={`st-link${f.ativo ? "" : " off"}`}>
              <div className="st-link-b">
                <b>{f.titulo}</b>
                <code onClick={() => copiar(f.url)}>{f.url}</code>
                <div className="st-link-m"><span className="st-tag">{f.idioma}</span><span>{t("set.links.leads", { n: f.leads })}</span><span>{f.ativo ? t("set.links.active") : t("set.links.paused")}</span></div>
              </div>
              <div className="st-link-a">
                <button className="st-btn st-btn--sm" onClick={() => copiar(f.url)}>{copiado === f.url ? t("ob.link.copied") : t("ob.link.copy")}</button>
                <a className="st-btn st-btn--sm" href={f.url} target="_blank" rel="noreferrer">{t("ob.link.open")} <Icon name="external" size={12} /></a>
                <button className="st-btn st-btn--sm" onClick={() => patch(f, { ativo: !f.ativo })}>{f.ativo ? t("set.links.pause") : t("set.links.activate")}</button>
                <button className="st-btn st-btn--sm danger" onClick={() => apagar(f)}><Icon name="trash" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
