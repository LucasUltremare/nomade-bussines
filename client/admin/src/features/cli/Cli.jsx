import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { useT, useTimeAgo } from "../../i18n/index.jsx";
import "./cli.css";

/* ══════════════════════════════════════════════════════════
   CLI & MÁQUINAS — instalar o `nomade`, ver as máquinas que
   executam, revogar sessões e a referência de comandos.
   A web NUNCA fala com a máquina: tudo aqui é o que o runner
   reportou no heartbeat, ou intenção que ele aplica depois.
   ══════════════════════════════════════════════════════════ */

const ofetch = (path, opts = {}) =>
  fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}`, ...(opts.headers || {}) } })
    .then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok) throw new Error(b?.error || `HTTP ${r.status}`); return b; });

const SISTEMAS = {
  mac: { nome: "macOS", node: "brew install node", claude: "curl -fsSL https://claude.ai/install.sh | bash", contas: "~/.nomade/contas", conta: (d) => `CLAUDE_CONFIG_DIR="${d}" claude`, sep: "/" },
  linux: { nome: "Linux", node: "sudo apt install -y nodejs npm", claude: "curl -fsSL https://claude.ai/install.sh | bash", contas: "~/.nomade/contas", conta: (d) => `CLAUDE_CONFIG_DIR="${d}" claude`, sep: "/" },
  windows: { nome: "Windows", node: "winget install OpenJS.NodeJS.LTS", claude: "irm https://claude.ai/install.ps1 | iex", contas: "%USERPROFILE%\\.nomade\\contas", conta: (d) => `$env:CLAUDE_CONFIG_DIR="${d}"; claude`, sep: "\\" },
};
const soDoNavegador = () => { const ua = navigator.userAgent || ""; return /Win/i.test(ua) ? "windows" : /Mac/i.test(ua) ? "mac" : "linux"; };

const COMANDOS = [
  ["nomade login", "login"], ["nomade", "chat"], ['nomade "do X"', "once"], ["nomade runner", "runner"], ["nomade machines", "machines"],
  ["nomade decisions", "decisions"], ["nomade memory", "memory"], ["nomade mcp", "mcp"], ["nomade queue", "queue"], ['nomade run "title"', "run"],
  ['nomade now "request"', "now"], ["nomade setpath <Board>", "setpath"], ["nomade paths", "paths"], ['nomade leads "what" "where"', "leads"],
  ["nomade doctor", "doctor"], ["nomade whoami", "whoami"], ["nomade logout", "logout"],
];

const quando = (d) => { if (!d) return ""; const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}min` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

function useCopiar() {
  const [copiado, setCopiado] = useState("");
  const copiar = (txt) => navigator.clipboard?.writeText(txt).then(() => { setCopiado(txt); setTimeout(() => setCopiado(""), 1500); });
  return [copiado, copiar];
}

export function Cli() {
  const { t } = useT();
  const [aba, setAba] = useState("install");
  const [info, setInfo] = useState(null);
  const [runners, setRunners] = useState(null);
  const [erro, setErro] = useState("");

  const load = () => {
    ofetch("/api/office/cli/info").then(setInfo).catch(() => {});
    ofetch("/api/office/runners").then((l) => setRunners(Array.isArray(l) ? l : [])).catch((e) => { setRunners([]); setErro(e.message); });
  };
  useEffect(() => { load(); const iv = setInterval(load, 15_000); return () => clearInterval(iv); }, []);

  const online = (runners || []).filter((m) => m.online).length;

  return (
    <div className="cl">
      <header className="cl-head">
        <div>
          <h1 className="cl-title">{t("cli.title")}</h1>
          <p className="cl-sub">{t("cli.sub")}</p>
        </div>
        <div className="cl-badge-v"><span>nomade</span>{info?.versao ? `v${info.versao}` : "—"}</div>
      </header>
      {erro && <div className="cl-err">{t("common.error", { e: erro })}</div>}

      <nav className="cl-tabs">
        {["install", "machines", "sessions", "commands"].map((a) => (
          <button key={a} className={aba === a ? "on" : ""} onClick={() => setAba(a)}>
            {t(`cli.tab.${a}`)}{a === "machines" && runners ? <em className={online ? "ok" : ""}>{online}/{runners.length}</em> : null}
          </button>
        ))}
      </nav>

      {aba === "install" && <Instalar info={info} />}
      {aba === "machines" && <Maquinas runners={runners} onMudou={load} />}
      {aba === "sessions" && <Sessoes />}
      {aba === "commands" && <Comandos />}
    </div>
  );
}

/* ── instalar ─────────────────────────────────────────────── */
function Instalar({ info }) {
  const { t } = useT();
  const [so, setSo] = useState(soDoNavegador);
  const [copiado, copiar] = useCopiar();
  const s = SISTEMAS[so];
  const base = window.location.origin;
  const passos = [
    { k: "node", cmd: s.node, opcional: true },
    { k: "install", cmd: `npm i -g ${info?.pacote || `${base}/cli/nomade-cli.tgz`}` },
    { k: "claude", cmd: s.claude },
    { k: "claude_login", cmd: "claude" },
    { k: "login", cmd: `nomade login --url=${base}` },
    { k: "doctor", cmd: "nomade doctor" },
    { k: "runner", cmd: "nomade runner" },
    { k: "mcp", cmd: "nomade mcp", opcional: true },
  ];
  return (
    <div className="cl-sec">
      <div className="cl-os">
        <span>{t("cli.os")}</span>
        {Object.entries(SISTEMAS).map(([k, v]) => <button key={k} aria-pressed={so === k} onClick={() => setSo(k)}>{v.nome}</button>)}
      </div>
      <ol className="cl-steps">
        {passos.map((p, i) => (
          <li key={p.k} className={p.opcional ? "opc" : ""}>
            <span className="cl-n">{String(i + 1).padStart(2, "0")}</span>
            <div className="cl-step-b">
              <div className="cl-step-t">{t(`cli.step.${p.k}`)}{p.opcional && <em>{t("cli.optional")}</em>}</div>
              <code onClick={() => copiar(p.cmd)}>{p.cmd}</code>
            </div>
            <button className="cl-copy" onClick={() => copiar(p.cmd)}>{copiado === p.cmd ? t("cli.copied") : t("cli.copy")}</button>
          </li>
        ))}
      </ol>
      <p className="cl-note">{t("cli.note.sub")}</p>
    </div>
  );
}

/* ── máquinas ─────────────────────────────────────────────── */
function Maquinas({ runners, onMudou }) {
  const { t } = useT();
  const [contas, setContas] = useState(null);
  const [boards, setBoards] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [erro, setErro] = useState("");
  const [novoBoard, setNovoBoard] = useState("");
  const [novaPasta, setNovaPasta] = useState("");
  const so = soDoNavegador();
  const sis = SISTEMAS[so];

  const load = () => {
    ofetch("/api/office/contas").then(setContas).catch(() => setContas([]));
    ofetch("/api/office/runner-config").then(setCfg).catch(() => setCfg({ auto: false }));
    ofetch("/api/office/runner-boards").then((b) => setBoards(Array.isArray(b) ? b : [])).catch(() => setBoards([]));
  };
  useEffect(load, []);

  const salvarModo = async (m, modo) => { try { await ofetch(`/api/office/runners/${m.machineId}/modo`, { method: "PATCH", body: JSON.stringify({ modo }) }); onMudou(); } catch (e) { setErro(e.message); } };
  const esquecer = async (m) => { if (!window.confirm(t("cli.forget_q", { name: m.nome }))) return; try { await ofetch(`/api/office/runners/${m.machineId}`, { method: "DELETE" }); onMudou(); } catch (e) { setErro(e.message); } };
  const salvarPasta = async (boardId, pasta) => { try { await ofetch(`/api/office/boards/${boardId}/pasta`, { method: "PATCH", body: JSON.stringify({ pasta }) }); load(); } catch (e) { setErro(e.message); } };
  const salvarConta = async (id, campo) => { try { await ofetch(`/api/office/contas/${id}`, { method: "PATCH", body: JSON.stringify(campo) }); load(); } catch (e) { setErro(e.message); } };

  const claudeBadge = (m) => {
    if (m.claude == null) return <span className="cl-tag">{t("cli.claude.unknown")}</span>;
    if (!m.claude.cli) return <span className="cl-tag bad">{t("cli.claude.none")}</span>;
    if (!m.rodaClaude) return <span className="cl-tag warn">{t("cli.claude.nologin")}</span>;
    return <span className="cl-tag ok">claude {m.claude.versao || "ok"}</span>;
  };
  const configurados = (boards || []).filter((b) => b.pasta);
  const disponiveis = (boards || []).filter((b) => !b.pasta);

  return (
    <div className="cl-sec">
      {erro && <div className="cl-err">{erro}</div>}
      {runners === null ? <div className="cl-empty">{t("common.loading")}</div>
        : runners.length === 0 ? <div className="cl-empty">{t("cli.machines.empty")}</div>
        : runners.map((m) => (
          <div key={m.machineId} className={`cl-machine${m.online ? " on" : ""}`}>
            <span className={`cl-dot${m.online ? " on" : ""}`} />
            <div className="cl-machine-b">
              <div className="cl-machine-t"><b>{m.nome}</b>{claudeBadge(m)}{m.morta && <span className="cl-tag bad">{t("cli.abandoned")}</span>}</div>
              <div className="cl-machine-m">
                {m.online ? t("cli.online") : t("cli.offline")} · {m.plataforma} · {t("cli.accounts", { n: m.contas ?? 0 })} · {t("cli.models", { n: m.modelos ?? 0 })}
                {(m.donos?.length ? m.donos : m.dono ? [m.dono] : []).length ? ` · ${(m.donos?.length ? m.donos : [m.dono]).map((d) => String(d).split("@")[0]).join(", ")}` : ""}
                {!m.online && m.visto ? ` · ${t("cli.seen", { t: quando(m.visto) })}` : ""}
              </div>
            </div>
            <label className="cl-mode" title={m.modoDesejado && m.modoAtual !== m.modoDesejado ? t("cli.mode.pending") : t("cli.mode")}>
              <select value={m.modoDesejado || ""} onChange={(e) => salvarModo(m, e.target.value)}>
                <option value="">{t("cli.mode.free")}</option><option value="server">{t("cli.mode.server")}</option><option value="edit">{t("cli.mode.edit")}</option><option value="production">{t("cli.mode.production")}</option>
              </select>
              {m.modoDesejado && m.modoAtual !== m.modoDesejado && <em>⋯</em>}
            </label>
            <button className="cl-x" onClick={() => esquecer(m)} title={t("cli.forget")}><Icon name="close" size={14} /></button>
          </div>
        ))}

      <h3 className="cl-h3">{t("cli.accounts.title")}</h3>
      <p className="cl-note">{t("cli.accounts.sub")}<br /><code>{sis.conta(`${sis.contas}${sis.sep}ana`)}</code></p>
      {contas === null ? null : !contas.length ? <div className="cl-empty">{t("cli.accounts.empty")}</div> : contas.map((c) => (
        <div key={c.id} className="cl-row">
          <span className="cl-mono">{c.id}</span>
          <span className={`cl-tag${c.logada ? " ok" : ""}`}>{c.logada ? t("cli.accounts.logged") : t("cli.accounts.nologin")}</span>
          <input className="cl-in" defaultValue={c.label || c.id} onBlur={(e) => e.target.value !== (c.label || "") && salvarConta(c.id, { label: e.target.value })} />
          <input className="cl-in" defaultValue={c.dono || ""} placeholder="owner@email" onBlur={(e) => e.target.value !== (c.dono || "") && salvarConta(c.id, { dono: e.target.value })} />
          <span className="cl-mono cl-dim">{c.configDir}</span>
        </div>
      ))}

      <h3 className="cl-h3">{t("cli.repos.title")}</h3>
      <p className="cl-note">{t("cli.repos.sub")}</p>
      {boards === null ? null : (
        <>
          {configurados.length === 0 && <div className="cl-empty">{t("cli.repos.empty")}</div>}
          {configurados.map((b) => (
            <div key={b.id} className="cl-row">
              <span className="cl-mono">{b.nome}</span>
              {b.tasks > 0 && <span className="cl-tag">{b.tasks}</span>}
              <input className="cl-in cl-in--mono grow" defaultValue={b.pasta || ""} onBlur={(e) => e.target.value !== (b.pasta || "") && salvarPasta(b.id, e.target.value)} />
              <button className="cl-copy" onClick={() => salvarPasta(b.id, "")}>{t("cli.repos.remove")}</button>
            </div>
          ))}
          {disponiveis.length > 0 && (
            <div className="cl-row">
              <select className="cl-in" value={novoBoard} onChange={(e) => setNovoBoard(e.target.value)}>
                <option value="">{t("cli.repos.pick")}</option>
                {disponiveis.map((b) => <option key={b.id} value={b.id}>{b.nome}{b.tasks ? ` · ${b.tasks}` : ""}</option>)}
              </select>
              <input className="cl-in cl-in--mono grow" value={novaPasta} placeholder={so === "windows" ? "C:\\nomade\\repos\\client" : "~/repos/client"} onChange={(e) => setNovaPasta(e.target.value)} onKeyDown={(e) => e.key === "Enter" && novoBoard && novaPasta.trim() && salvarPasta(novoBoard, novaPasta.trim())} />
              <button className="cl-copy" disabled={!novoBoard || !novaPasta.trim()} onClick={() => { salvarPasta(novoBoard, novaPasta.trim()); setNovoBoard(""); setNovaPasta(""); }}>{t("cli.repos.add")}</button>
            </div>
          )}
        </>
      )}

      <h3 className="cl-h3">{t("cli.auto.title")}</h3>
      <div className="cl-row">
        <button className={`cl-sw${cfg?.auto ? " on" : ""}`} aria-pressed={!!cfg?.auto} onClick={async () => { try { setCfg(await ofetch("/api/office/runner-config", { method: "PATCH", body: JSON.stringify({ auto: !cfg?.auto }) })); } catch (e) { setErro(e.message); } }}><i /></button>
        <span className="cl-dim">{cfg?.auto ? t("cli.auto.on") : t("cli.auto.off")}</span>
      </div>
    </div>
  );
}

/* ── sessões ──────────────────────────────────────────────── */
function Sessoes() {
  const { t } = useT();
  const ago = useTimeAgo();
  const [lista, setLista] = useState(null);
  const load = () => ofetch("/api/office/cli/sessoes").then(setLista).catch(() => setLista([]));
  useEffect(load, []);
  const revogar = async (s) => { if (!window.confirm(t("cli.sessions.revoke_q"))) return; await ofetch(`/api/office/cli/sessoes/${s.jti}`, { method: "DELETE" }).catch(() => {}); load(); };
  return (
    <div className="cl-sec">
      <p className="cl-note">{t("cli.sessions.sub")}</p>
      {lista === null ? <div className="cl-empty">{t("common.loading")}</div> : lista.length === 0 ? <div className="cl-empty">{t("cli.sessions.empty")}</div> : (
        <table className="cl-table">
          <tbody>
            {lista.map((s) => (
              <tr key={s.jti} className={s.revogada ? "off" : ""}>
                <td><span className={`cl-dot${s.revogada ? "" : " on"}`} /></td>
                <td><b>{s.email}</b><div className="cl-dim cl-mono">{s.jti.slice(0, 8)}{s.agente ? ` · ${s.agente.slice(0, 40)}` : ""}</div></td>
                <td className="cl-dim">{t("cli.sessions.created")} {ago(s.criadoEm)}</td>
                <td className="cl-dim">{s.ultimoUso ? `${t("cli.sessions.last")} ${ago(s.ultimoUso)}` : t("cli.sessions.never")}</td>
                <td>{s.revogada ? <span className="cl-tag">{t("cli.sessions.revoked")}</span> : <button className="cl-copy danger" onClick={() => revogar(s)}>{t("cli.sessions.revoke")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── comandos ─────────────────────────────────────────────── */
function Comandos() {
  const { t } = useT();
  const [copiado, copiar] = useCopiar();
  return (
    <div className="cl-sec">
      <table className="cl-table cl-table--cmd">
        <tbody>
          {COMANDOS.map(([cmd, k]) => (
            <tr key={k}>
              <td><code onClick={() => copiar(cmd)}>{cmd}</code></td>
              <td className="cl-dim">{t(`cli.cmd.${k}`)}</td>
              <td><button className="cl-copy" onClick={() => copiar(cmd)}>{copiado === cmd ? t("cli.copied") : t("cli.copy")}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
