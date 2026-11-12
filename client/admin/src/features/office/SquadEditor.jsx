import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { useT } from "../../i18n/index.jsx";
import { DEPTS, deptLabel } from "./Office.jsx";
import "./squad-editor.css";

/* ══════════════════════════════════════════════════════════
   EDITOR DE SQUAD — substitui o canvas. Um formulário: nome,
   departamento, autonomia, instruções e o pipeline em lista
   (as etapas rodam em ordem). Mesma entidade que o runner usa.
   ══════════════════════════════════════════════════════════ */

const MODELOS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "openai:gpt-5-mini", "gemini:gemini-2.5-flash", "zai:glm-4.6", "ollama:patricj"];
const ofetch = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) } })
    .then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok) throw new Error(b?.error || `HTTP ${r.status}`); return b; });

const etapaDe = (a = {}, i = 0) => ({
  id: a.id || `agent_${Date.now()}_${i}`,
  name: a.name || "",
  role: a.role?.title || (typeof a.role === "string" ? a.role : "") || "",
  model: a.model || "claude-sonnet-5",
  systemPrompt: a.systemPrompt || "",
  temperature: a.temperature ?? 0.7,
});

export function SquadEditor({ squad, onClose, onSaved }) {
  const { t } = useT();
  const editando = !!squad?.id;
  const [nome, setNome] = useState(squad?.name || "");
  const [dept, setDept] = useState(squad?.dept || "");
  const [autonomia, setAutonomia] = useState(squad?.autonomia ?? 0);
  const [servidor, setServidor] = useState(!!squad?.servidor);
  const [instrucoes, setInstrucoes] = useState(squad?.instrucoes || "");
  const [etapas, setEtapas] = useState(() => (squad?.agents?.length ? squad.agents.map(etapaDe) : [etapaDe({ name: "Agent" })]));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const setEtapa = (id, patch) => setEtapas((l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const mover = (i, dir) => setEtapas((l) => { const n = [...l]; const j = i + dir; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const salvar = async () => {
    if (!nome.trim()) return;
    setSalvando(true); setErro("");
    const agents = etapas.map((e) => ({ id: e.id, name: e.name.trim() || "Agent", role: { title: e.role, description: "", expertise: [], behaviors: [] }, model: e.model, temperature: e.temperature, systemPrompt: e.systemPrompt, integrations: [] }));
    const body = { name: nome.trim(), dept: dept || null, autonomia, servidor, instrucoes: instrucoes.trim() || null, agents, graph: null };
    try {
      if (editando) await ofetch(`/api/office/agents/${squad.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await ofetch("/api/office/agents", { method: "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (e) { setErro(e.message); }
    finally { setSalvando(false); }
  };

  return (
    <div className="se-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="se" role="dialog" aria-modal="true">
        <header className="se-h">
          <h2>{editando ? t("sq.edit") : t("sq.new")}</h2>
          <button className="se-x" onClick={onClose} aria-label={t("common.close")}><Icon name="close" size={16} /></button>
        </header>

        <div className="se-b">
          <div className="se-grid">
            <label className="se-f"><span>{t("sq.name")}</span><input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Dev · Copy · Triage…" /></label>
            <label className="se-f"><span>{t("sq.dept")}</span>
              <select value={dept || ""} onChange={(e) => setDept(e.target.value)}>
                <option value="">{t("sq.dept.none")}</option>
                {DEPTS.map((d) => <option key={d.id} value={d.id}>{deptLabel(t, d.id)}</option>)}
              </select>
            </label>
            <div className="se-f"><span>{t("sq.autonomy")}</span>
              <div className="se-aut">
                {[0, 1, 2, 3].map((n) => <button key={n} type="button" aria-pressed={autonomia === n} title={t(`sq.autonomy.${n}`)} onClick={() => setAutonomia(n)}>{n}</button>)}
                <small>{t(`sq.autonomy.${autonomia}`)}</small>
              </div>
            </div>
            <label className="se-f se-f--row"><input type="checkbox" checked={servidor} onChange={(e) => setServidor(e.target.checked)} /><span>{t("sq.server")}</span></label>
            <label className="se-f se-f--full"><span>{t("sq.instructions")}</span>
              <textarea rows={4} value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} placeholder={t("sq.instructions_ph")} />
            </label>
          </div>

          <div className="se-pipe-h">
            <div><b>{t("sq.pipeline")}</b><p>{t("sq.pipeline_sub")}</p></div>
            <button className="se-btn" onClick={() => setEtapas((l) => [...l, etapaDe({ name: `Step ${l.length + 1}` }, l.length)])}><Icon name="plus" size={13} /> {t("sq.step.add")}</button>
          </div>
          <ol className="se-pipe">
            {etapas.map((e, i) => (
              <li key={e.id} className="se-step">
                <div className="se-step-n">
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="↑">↑</button>
                  <button type="button" disabled={i === etapas.length - 1} onClick={() => mover(i, 1)} aria-label="↓">↓</button>
                </div>
                <div className="se-step-b">
                  <div className="se-grid se-grid--3">
                    <label className="se-f"><span>{t("sq.step.name")}</span><input value={e.name} onChange={(ev) => setEtapa(e.id, { name: ev.target.value })} /></label>
                    <label className="se-f"><span>{t("sq.step.role")}</span><input value={e.role} onChange={(ev) => setEtapa(e.id, { role: ev.target.value })} placeholder="Writer, Reviewer…" /></label>
                    <label className="se-f"><span>{t("sq.step.model")}</span>
                      <select value={MODELOS.includes(e.model) ? e.model : "__outro"} onChange={(ev) => setEtapa(e.id, { model: ev.target.value === "__outro" ? "ollama:" : ev.target.value })}>
                        {MODELOS.map((m) => <option key={m} value={m}>{m}</option>)}
                        <option value="__outro">{t("sq.model.other")}</option>
                      </select>
                      {!MODELOS.includes(e.model) && <input className="se-mono" value={e.model} onChange={(ev) => setEtapa(e.id, { model: ev.target.value })} placeholder="ollama:qwen3.5:4b" />}
                    </label>
                  </div>
                  <label className="se-f"><span>{t("sq.step.prompt")}</span>
                    <textarea rows={4} value={e.systemPrompt} onChange={(ev) => setEtapa(e.id, { systemPrompt: ev.target.value })} />
                  </label>
                </div>
                <button className="se-x se-step-x" disabled={etapas.length === 1} onClick={() => setEtapas((l) => l.filter((x) => x.id !== e.id))} title={t("sq.step.remove")}><Icon name="trash" size={14} /></button>
              </li>
            ))}
          </ol>
          {erro && <div className="se-err">{erro}</div>}
        </div>

        <footer className="se-foot">
          <button className="se-btn" onClick={onClose}>{t("sq.cancel")}</button>
          <button className="se-btn se-btn--p" onClick={salvar} disabled={salvando || !nome.trim()}>{t("sq.save")}</button>
        </footer>
      </div>
    </div>
  );
}
