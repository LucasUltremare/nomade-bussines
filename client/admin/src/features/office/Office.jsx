import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { SquadEditor } from "./SquadEditor.jsx";
import { TEAM } from "../../lib/team.js";
import { useT, useTimeAgo } from "../../i18n/index.jsx";
import "./office.css";

/* ══════════════════════════════════════════════════════════
   ESCRITÓRIO VIRTUAL — organograma, inbox de decisões, activity
   Agents são funcionários; sócio é chamado, não vigia.
   API vive no ai-service (mesma origem, /api/office/*).
   ══════════════════════════════════════════════════════════ */

// Departamentos oficiais — cor FIXA, igual em qualquer tela (README da sede)
// `label` é o inglês (fallback); o texto no idioma ativo vem de deptLabel(t, id)
export const DEPTS = [
  { id: "triagem", key: "of.dept.triagem", label: "Triage", cor: "#d4654a" },
  { id: "diagnostico", key: "of.dept.diagnostico", label: "Diagnostics", cor: "#c8a040" },
  { id: "comercial", key: "of.dept.comercial", label: "Sales", cor: "#0077B6" },
  { id: "producao", key: "of.dept.producao", label: "Production", cor: "#00A896" },
  { id: "conteudo", key: "of.dept.conteudo", label: "Content", cor: "#3aa0c9" },
  { id: "suporte", key: "of.dept.suporte", label: "Support", cor: "#d98a5a" },
];
export const deptCor = (id) => DEPTS.find(d => d.id === id)?.cor || "#6b859c";
export const deptLabel = (t, id) => {
  const d = DEPTS.find(x => x.id === id);
  return d ? t(d.key) : (id || "");
};
// dept antigo/desconhecido conta como "sem departamento"
const normDept = (d) => (DEPTS.some(x => x.id === d) ? d : null);

export const URGENCIAS = [
  { id: "urgente", key: "of.urg.urgente", label: "Urgent", cor: "#d4654a" },
  { id: "hoje", key: "of.urg.hoje", label: "Today", cor: "#c8a040" },
  { id: "andamento", key: "of.urg.andamento", label: "In progress", cor: "#0077B6" },
  { id: "afazer", key: "of.urg.afazer", label: "To do", cor: "#6b859c" },
];
export const urgLabel = (t, id) => {
  const u = URGENCIAS.find(x => x.id === id);
  return u ? t(u.key) : (id || "");
};
const urgIdx = (u) => Math.max(0, URGENCIAS.findIndex(x => x.id === u));
const urg = (u) => URGENCIAS.find(x => x.id === u) || URGENCIAS[3];

// tipo de resolução (aprovar · ajustar · assumir) — valor do servidor, texto traduzido
const TIPOS = ["aprovar", "ajustar", "assumir"];
export const tipoLabel = (t, tipo) => (TIPOS.includes(tipo) ? t(`of.tipo.${tipo}`) : (tipo || ""));

const ofetch = async (path, opts = {}) => {
  const r = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${api.token()}`,
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

/* ── Organograma — O GERENCIADOR oficial dos funcionários-agent ──
   Criar, editar (pipeline completo) e excluir acontecem AQUI, no
   SquadEditor (formulário em lista). Squads são a mesma entidade que o runner executa. */
export function Organograma() {
  const { t } = useT();
  const [squads, setSquads] = useState(null);
  const [editor, setEditor] = useState(undefined); // undefined fechado · null novo · objeto edição

  const load = () => ofetch("/api/office/agents").then(setSquads).catch(() => setSquads([]));
  useEffect(() => { load(); }, []);

  /* Máquinas registradas, pro seletor de ONDE o squad roda. Dono e máquina são
     eixos diferentes: dono decide qual ASSINATURA executa, máquina decide em
     qual COMPUTADOR. O mesmo micro pode ter dois sócios logados. */
  const [maquinas, setMaquinas] = useState([]);
  useEffect(() => {
    ofetch("/api/office/runners").then(m => setMaquinas(Array.isArray(m) ? m : [])).catch(() => setMaquinas([]));
  }, []);

  useEffect(() => {
    const h = (e) => { if (e.detail?.tab === "organograma") setEditor(null); };
    window.addEventListener("nomade:top-action", h);
    return () => window.removeEventListener("nomade:top-action", h);
  }, []);

  const patch = async (s, body) => {
    await ofetch(`/api/office/agents/${s.id}`, { method: "PATCH", body: JSON.stringify(body) });
    load();
  };

  const demitir = async (s) => {
    if (!window.confirm(t("of.org.fire_confirm", { name: s.name }))) return;
    await ofetch(`/api/office/agents/${s.id}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  if (squads === null) return <div className="of-hint">{t("of.loading")}</div>;

  const groups = [...DEPTS, { id: null, key: "of.dept.none", label: "No department", cor: "var(--ink-faint)" }];

  return (
    <div className="of">
      <div className="of-head">
        <p className="of-sub">
          {t("of.org.sub_a")}<b>0</b>{t("of.org.sub_b")}<b>3</b>{t("of.org.sub_c")}
        </p>
        <button className="of-add" onClick={() => setEditor(null)}>{t("of.org.hire")}</button>
      </div>

      {editor !== undefined && (
        <SquadEditor
          squad={editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => { setEditor(undefined); load(); }}
        />
      )}

      {squads.length === 0 ? (
        <div className="of-empty">
          <b>{t("of.org.empty_t")}</b>
          <span>{t("of.org.empty_s")}</span>
        </div>
      ) : (
        groups.map(dept => {
          const list = squads.filter(s => normDept(s.dept) === dept.id);
          if (list.length === 0) return null;
          return (
            <div className="of-dept" key={dept.id || "sem"}>
              <div className="of-dept-head" style={{ "--dc": dept.cor }}>
                <span className="of-dept-dot" />
                {t(dept.key)}
                <em>{list.length}</em>
              </div>
              <div className="of-grid">
                {list.map(s => (
                  <div className="of-card" key={s.id} style={{ "--dc": dept.cor }}>
                    <div className="of-card-top">
                      <span className="of-card-av">{s.name.slice(0, 2).toUpperCase()}</span>
                      <div className="of-card-id">
                        <b>{s.name}</b>
                        <span>
                          {s.agents.length === 1 ? t("of.org.agents_1") : t("of.org.agents_n", { n: s.agents.length })}
                          {s.servidor ? t("of.org.on_server") : ""}
                        </span>
                      </div>
                      <button className="of-open" onClick={() => setEditor(s)} title={t("of.org.edit_title")}>{t("of.org.edit")}</button>
                      <button className="of-card-x" onClick={() => demitir(s)} title={t("of.org.fire_title")}>×</button>
                    </div>
                    {s.agents.length > 0 && (
                      <div className="of-agents">
                        {s.agents.map((a, i) => (
                          <span key={i} className="of-agent-chip" title={a.role}>
                            {a.name}<em>{a.model?.startsWith("local/") ? `${a.model.slice(6)} · ${t("of.org.local")}` : a.model}</em>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* INSTRUÇÕES — o cérebro do agent no motor agêntico: vira o
                        system prompt do run. Era lido em três lugares e não tinha
                        por onde escrever (nenhuma rota aceitava o campo, e a UI não
                        tinha campo nenhum), então todo squad rodava no fallback do
                        pipeline velho. Salva no blur pra não dar um PATCH por tecla. */}
                    <textarea
                      className="of-instrucoes"
                      defaultValue={s.instrucoes || ""}
                      rows={3}
                      placeholder={t("of.org.instr_ph")}
                      onBlur={e => {
                        const v = e.target.value.trim();
                        if (v !== (s.instrucoes || "")) patch(s, { instrucoes: v || null });
                      }}
                      style={{ width: "100%", marginTop: 8, resize: "vertical", font: "inherit", fontSize: 11, lineHeight: 1.45 }}
                    />
                    <div className="of-card-foot">
                      <select
                        className="of-dept-sel"
                        value={normDept(s.dept) || ""}
                        onChange={e => patch(s, { dept: e.target.value || null })}
                      >
                        <option value="">{t("of.dept.none_opt")}</option>
                        {DEPTS.map(d => <option key={d.id} value={d.id}>{t(d.key)}</option>)}
                      </select>
                      {/* DONO — de quem é a máquina que executa as tasks deste squad.
                          Sem dono, qualquer runner pega. Com dono, só o dele. */}
                      <select
                        className="of-dono-sel"
                        value={s.donoConta || ""}
                        onChange={e => patch(s, { donoConta: e.target.value || null })}
                        title={s.donoConta
                          ? t("of.org.owner_title", { owner: s.donoConta })
                          : t("of.org.owner_none")}
                      >
                        <option value="">{t("of.org.any_partner")}</option>
                        {TEAM.map(m => <option key={m.id} value={m.email}>{t("of.org.sig_of", { name: m.name })}</option>)}
                      </select>
                      {/* MÁQUINA — separado do dono de propósito: um sócio pode
                          ter dois computadores, e um computador pode ter dois
                          sócios logados. Aqui é ONDE, ali em cima é QUEM. */}
                      <select
                        className="of-dono-sel"
                        value={s.maquinaId || ""}
                        onChange={e => patch(s, { maquinaId: e.target.value || null })}
                        title={(() => {
                          if (!s.maquinaId) return t("of.org.mach_none");
                          const m = maquinas.find(x => x.machineId === s.maquinaId);
                          if (!m) return t("of.org.mach_gone");
                          return m.online ? t("of.org.mach_on", { name: m.nome }) : t("of.org.mach_off", { name: m.nome });
                        })()}
                      >
                        <option value="">{t("of.org.any_machine")}</option>
                        {maquinas.map(m => (
                          <option key={m.machineId} value={m.machineId}>
                            {m.online ? "● " : "○ "}{m.nome}
                          </option>
                        ))}
                        {/* máquina removida da lista continua carimbada na task:
                            mostrar o id é feio, mas some sem isto */}
                        {s.maquinaId && !maquinas.some(m => m.machineId === s.maquinaId) && (
                          <option value={s.maquinaId}>{t("of.org.mach_missing", { id: s.maquinaId.slice(0, 8) })}</option>
                        )}
                      </select>
                      <span
                        className="of-aut"
                        title={t(`of.org.aut${Math.min(3, Math.max(0, s.autonomia || 0))}`)}
                      >
                        {[0, 1, 2, 3].map(n => (
                          <i key={n} className={n <= (s.autonomia || 0) ? "on" : ""} onClick={() => patch(s, { autonomia: n })} />
                        ))}
                      </span>
                      {/* PLACAR — sem isto dava pra SENTIR que um agent é ruim
                          e nunca mostrar. Com três Dev em modelos diferentes,
                          "qual presta" é pergunta de todo dia. Só aparece com
                          nota: zero a zero é ruído, não informação. */}
                      {(s.notas?.bons || s.notas?.ruins) ? (
                        <span
                          className="of-notas"
                          style={{ fontSize: 11, opacity: 0.75, whiteSpace: "nowrap" }}
                          title={t("of.org.score_title", { good: s.notas.bons, bad: s.notas.ruins })}
                        >
                          +{s.notas.bons} / −{s.notas.ruins}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ── Minhas decisões — O CORAÇÃO. A fila do que só um humano resolve. ──
   Gestão por exceção: agent roda solto até o ponto de julgamento, aí para
   e levanta uma decisão. Aprovar · ajustar · assumir. */
const opsOf = (dec) => (dec.opcoes || []).map(o => (typeof o === "string" ? { label: o, valor: o } : o));

export function InboxDecisoes() {
  const { t } = useT();
  const timeAgo = useTimeAgo();
  const [open, setOpen] = useState(null);
  const [done, setDone] = useState([]);
  const [fDept, setFDept] = useState("");
  const [fUrg, setFUrg] = useState("");
  const [ajustando, setAjustando] = useState(null); // dec.id em modo ajuste
  const [ajusteTxt, setAjusteTxt] = useState("");
  const [composer, setComposer] = useState(null); // nova decisão/issue manual

  const load = () => {
    ofetch("/api/office/decisions?status=aberta").then(setOpen).catch(() => setOpen([]));
    ofetch("/api/office/decisions?status=resolvida").then(d => setDone(d.slice(0, 8))).catch(() => {});
  };
  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, []);

  const resolve = async (dec, tipo, resolucao) => {
    await ofetch(`/api/office/decisions/${dec.id}`, { method: "PATCH", body: JSON.stringify({ tipo, resolucao }) });
    setAjustando(null); setAjusteTxt("");
    load();
  };

  const criar = async () => {
    if (!composer?.pergunta?.trim()) return;
    await ofetch("/api/office/decisions", {
      method: "POST",
      body: JSON.stringify({
        ...composer,
        agentName: "issue dos sócios",
        opcoes: (composer.opcoes || "").split(",").map(s => s.trim()).filter(Boolean),
      }),
    });
    setComposer(null);
    load();
  };

  if (open === null) return <div className="of-hint">{t("of.loading")}</div>;

  const fila = open
    .filter(d => !fDept || normDept(d.dept) === fDept)
    .filter(d => !fUrg || (d.urgencia || "afazer") === fUrg)
    .sort((a, b) => urgIdx(a.urgencia || "afazer") - urgIdx(b.urgencia || "afazer") || new Date(a.createdAt) - new Date(b.createdAt));

  return (
    <div className="of">
      <div className="of-head">
        <p className="of-sub">{t("of.inbox.sub")}</p>
        <button className="of-add" onClick={() => setComposer({ pergunta: "", contexto: "", dept: "", urgencia: "afazer", opcoes: "" })}>
          {t("of.inbox.new")}
        </button>
      </div>

      {/* filtros por departamento e urgência — cores fixas */}
      <div className="of-filters">
        <button className={`of-chip${fDept === "" ? " on" : ""}`} onClick={() => setFDept("")}>{t("of.inbox.all")}</button>
        {DEPTS.map(d => (
          <button
            key={d.id}
            className={`of-chip${fDept === d.id ? " on" : ""}`}
            style={{ "--cc": d.cor }}
            onClick={() => setFDept(fDept === d.id ? "" : d.id)}
          ><i />{t(d.key)}</button>
        ))}
        <span className="of-filters-sep" />
        {URGENCIAS.map(u => (
          <button
            key={u.id}
            className={`of-chip${fUrg === u.id ? " on" : ""}`}
            style={{ "--cc": u.cor }}
            onClick={() => setFUrg(fUrg === u.id ? "" : u.id)}
          ><i />{t(u.key)}</button>
        ))}
      </div>

      {composer && (
        <div className="of-form of-form--dec">
          <input autoFocus placeholder={t("of.inbox.q_ph")} value={composer.pergunta}
            onChange={e => setComposer({ ...composer, pergunta: e.target.value })} />
          <div className="of-form-row">
            <select value={composer.dept} onChange={e => setComposer({ ...composer, dept: e.target.value })}>
              <option value="">{t("of.dept.none_opt")}</option>
              {DEPTS.map(d => <option key={d.id} value={d.id}>{t(d.key)}</option>)}
            </select>
            <select value={composer.urgencia} onChange={e => setComposer({ ...composer, urgencia: e.target.value })}>
              {URGENCIAS.map(u => <option key={u.id} value={u.id}>{t(u.key)}</option>)}
            </select>
          </div>
          <textarea rows={2} placeholder={t("of.inbox.ctx_ph")} value={composer.contexto}
            onChange={e => setComposer({ ...composer, contexto: e.target.value })} />
          <input placeholder={t("of.inbox.opts_ph")} value={composer.opcoes}
            onChange={e => setComposer({ ...composer, opcoes: e.target.value })} />
          <div className="of-form-actions">
            <button className="of-btn of-btn--go" onClick={criar} disabled={!composer.pergunta.trim()}>{t("of.inbox.open")}</button>
            <button className="of-btn" onClick={() => setComposer(null)}>{t("of.inbox.cancel")}</button>
          </div>
        </div>
      )}

      {fila.length === 0 ? (
        <div className="of-empty">
          <b>{t("of.inbox.empty_t")}</b>
          <span>{fDept || fUrg ? t("of.inbox.empty_filters") : t("of.inbox.empty_you")}</span>
        </div>
      ) : (
        fila.map(dec => {
          const u = urg(dec.urgencia || "afazer");
          const dc = deptCor(normDept(dec.dept));
          const ops = opsOf(dec);
          return (
            <div className="of-dec" key={dec.id} style={{ "--dc": dc }}>
              <div className="of-dec-head">
                {dec.agentName && <span className="of-dec-agent" style={{ "--cc": dc }}>{dec.agentName}</span>}
                {dec.dept && normDept(dec.dept) && <span className="of-dec-dept" style={{ "--cc": dc }}>{deptLabel(t, normDept(dec.dept))}</span>}
                <span className="of-dec-urg" style={{ "--cc": u.cor }}>{t(u.key)}</span>
                <em>{timeAgo(dec.createdAt)}</em>
              </div>
              <b className="of-dec-q">{dec.pergunta}</b>
              {dec.contexto && <p className="of-dec-ctx">{dec.contexto}</p>}
              {dec.sugestao && (
                <p className="of-dec-sug"><b>{t("of.inbox.suggestion")}</b> {dec.sugestao}</p>
              )}
              {ajustando === dec.id ? (
                <div className="of-dec-ajuste">
                  <textarea
                    autoFocus rows={2}
                    placeholder={t("of.inbox.adjust_ph")}
                    value={ajusteTxt}
                    onChange={e => setAjusteTxt(e.target.value)}
                  />
                  <div className="of-dec-actions">
                    <button className="of-btn of-btn--go" disabled={!ajusteTxt.trim()} onClick={() => resolve(dec, "ajustar", ajusteTxt)}>{t("of.inbox.send_adjust")}</button>
                    <button className="of-btn" onClick={() => { setAjustando(null); setAjusteTxt(""); }}>{t("of.inbox.cancel")}</button>
                  </div>
                </div>
              ) : (
                <div className="of-dec-actions">
                  {ops.map((op, i) => (
                    <button key={i} className="of-btn of-btn--go" onClick={() => resolve(dec, "aprovar", op.valor)}>{op.label}</button>
                  ))}
                  {dec.sugestao && ops.length === 0 && (
                    <button className="of-btn of-btn--go" onClick={() => resolve(dec, "aprovar", dec.sugestao)}>{t("of.inbox.approve_sug")}</button>
                  )}
                  <button className="of-btn" onClick={() => { setAjustando(dec.id); setAjusteTxt(""); }}>{t("of.inbox.adjust")}</button>
                  <button className="of-btn" onClick={() => resolve(dec, "assumir", "assumida pelo sócio")}>{t("of.inbox.take")}</button>
                </div>
              )}
            </div>
          );
        })
      )}

      {done.length > 0 && (
        <>
          <div className="of-label">{t("of.inbox.recent")}</div>
          {done.map(dec => (
            <div className="of-dec of-dec--done" key={dec.id}>
              <span className="of-dec-q">{dec.pergunta}</span>
              <em>{tipoLabel(t, dec.tipo || "aprovar")} → {dec.resolucao} · {String(dec.resolvidaPor || "").split("@")[0]}</em>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ── Activity — o pulso da empresa ── */
const EVENT_LABEL = {
  run_start: { key: "of.ev.run_start", cor: "#4FB3D9" },
  run_done: { key: "of.ev.run_done", cor: "#00A896" },
  run_error: { key: "of.ev.run_error", cor: "#e05252" },
  decisao_aberta: { key: "of.ev.decisao_aberta", cor: "#D9A04F" },
  decisao_resolvida: { key: "of.ev.decisao_resolvida", cor: "#9B6DFF" },
  funcionario_criado: { key: "of.ev.funcionario_criado", cor: "#00A896" },
};

export function Activity() {
  const { t } = useT();
  const timeAgo = useTimeAgo();
  const [events, setEvents] = useState(null);

  useEffect(() => {
    const load = () => ofetch("/api/office/events?limit=80").then(setEvents).catch(() => setEvents([]));
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, []);

  if (events === null) return <div className="of-hint">{t("of.loading")}</div>;

  const line = (ev) => {
    const p = ev.payload || {};
    const known = EVENT_LABEL[ev.tipo];
    const meta = known ? { txt: t(known.key), cor: known.cor } : { txt: ev.tipo, cor: "var(--ink-faint)" };
    const who = p.squad || ev.agentName || ev.nome || p.agentName || "";
    const extra = [p.projeto && t("of.act.in", { p: p.projeto }), p.task, ev.pergunta, p.erro, ev.resolucao && `→ ${ev.resolucao}`]
      .filter(Boolean).join(" · ");
    return { meta, who, extra };
  };

  return (
    <div className="of">
      <p className="of-sub">{t("of.act.sub")}</p>
      {events.length === 0 ? (
        <div className="of-empty">
          <b>{t("of.act.empty_t")}</b>
          <span>{t("of.act.empty_s")}</span>
        </div>
      ) : (
        <div className="of-feed">
          {events.map((ev, i) => {
            const { meta, who, extra } = line(ev);
            return (
              <div className="of-ev" key={ev.id || ev._id || i}>
                <span className="of-ev-dot" style={{ background: meta.cor }} />
                <div className="of-ev-body">
                  <span>{who && <b>{who}</b>} {meta.txt}{extra ? <em> — {extra}</em> : null}</span>
                  <time>{timeAgo(ev.ts)}</time>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
