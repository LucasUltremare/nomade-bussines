import { useState, useMemo, useEffect, useRef } from "react";
import { Icon } from "../../components/Icon.jsx";
import { ErrorBoundary } from "../../components/ErrorBoundary.jsx";
import { memberFromUser } from "../../lib/team.js";
import { api } from "../../api/client.js";
import { useT, LANGS } from "../../i18n/index.jsx";

import { NotifBell } from "../overview/NotifBell.jsx";
import { InstallButton, UpdateBar } from "../../components/AppInstall.jsx";
import { rotaInicial, aoClicarNotificacao } from "../../lib/pwa.js";
import { Home } from "../home/Home.jsx";
import { Clients } from "../clients/Clients.jsx";
import { Projetos } from "../projetos/Projetos.jsx";
import { Tasks } from "../kanban/Tasks.jsx";
import { Finance } from "../finance/Finance.jsx";
import { Propostas } from "../propostas/Propostas.jsx";
import { Organograma, InboxDecisoes, Activity } from "../office/Office.jsx";
import { Chat } from "../office/Chat.jsx";
import { Memoria } from "../memoria/Memoria.jsx";
import { Runner } from "../runner/Runner.jsx";
import { Leads } from "../leads/Leads.jsx";
import { Membros } from "../membros/Membros.jsx";
import { Integrations } from "../integrations/Integrations.jsx";
import { Cli } from "../cli/Cli.jsx";
import { Settings } from "../settings/Settings.jsx";
import { Payments } from "../payments/Payments.jsx";
import { Atendimento } from "../atendimento/Atendimento.jsx";
import { NAV } from "../../lib/telas.js";
import { usePresenca } from "../../lib/presenca.js";
import { Tour, tourVisto } from "../tour/Tour.jsx";
import { passosDoTour } from "../tour/passos.js";

/* ══════════════════════════════════════════════════════════
   SHELL — sidebar em grupos, topbar com pulso de execução,
   paleta ⌘K, idioma e tema. Monocromático.
   ══════════════════════════════════════════════════════════ */

const FLAT = NAV.flatMap(g => g.items);
const MOBILE_TABS = ["home", "chat", "tasks", "inbox", "clients"];
const permitidaEm = (flat) => (id) => flat.some(i => i.id === id);
const TOP_ACTION = { organograma: "action.new_agent", chat: "action.new_chat", memoria: "action.new_memory" };

export function Dashboard({ user, empresa, theme, onLogout, onEmpresaChange, onRerunOnboarding }) {
  const { t, lang, setLang } = useT();
  const ac = user?.acesso || { socio: false, perms: [] };
  const podeVer = (n) => ac.socio || (!!n.mod && (ac.perms || []).includes(n.mod));
  /* O sócio escolhe quais telas a empresa usa (Ajustes → Telas). Início e
     Ajustes não desligam: sem eles não tem como voltar atrás. */
  const ligados = Array.isArray(empresa?.modulos) ? new Set(empresa.modulos) : null;
  const emUso = (n) => !ligados || n.id === "home" || n.id === "settings" || ligados.has(n.id);
  const nav = NAV.map(g => ({ ...g, items: g.items.filter(n => podeVer(n) && emUso(n)) })).filter(g => g.items.length);
  const flat = nav.flatMap(g => g.items);
  // telas desligadas em Ajustes saem da barra com animação, em vez de sumir de uma vez
  const fase = usePresenca(flat.map(i => i.id));
  const permitida = (id) => flat.some(i => i.id === id);
  const inicial = flat[0]?.id || "home";
  const mobileTabs = [...MOBILE_TABS.filter(permitidaEm(flat)), ...flat.map(i => i.id).filter(id => !MOBILE_TABS.includes(id))].slice(0, 5);

  const [tab, setTabCru] = useState(() => (permitida(rotaInicial.tab === "overview" ? "home" : rotaInicial.tab) ? rotaInicial.tab : inicial));
  const setTab = (id) => { if (permitida(id)) setTabCru(id); };
  const [menuAberto, setMenuAberto] = useState(false);
  const [cmdk, setCmdk] = useState(false);
  // o tour abre sozinho na primeira vez; depois, só pelo botão de ajuda
  const [tour, setTour] = useState(() => !tourVisto());
  // uma tela desligada em Ajustes enquanto estava aberta: volta pro início
  useEffect(() => { if (!flat.some(i => i.id === tab)) setTabCru(inicial); }, [empresa?.modulos]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openTaskRequest, setOpenTaskRequest] = useState(
    () => (rotaInicial.task ? { taskId: rotaInicial.task, boardId: rotaInicial.board, nonce: Date.now() } : null)
  );
  const me = useMemo(() => memberFromUser(user), [user]);

  const handleOpenTask = (taskId, boardId) => { setTab("tasks"); setOpenTaskRequest({ taskId, boardId, nonce: Date.now() }); };
  const [propostaRequest, setPropostaRequest] = useState(null);
  const handleOpenProposta = (propostaId) => { setTab("propostas"); setPropostaRequest({ propostaId, nonce: Date.now() }); };
  const [clientBoardRequest, setClientBoardRequest] = useState(null);
  const handleOpenClientKanban = (cid) => { setTab("tasks"); setClientBoardRequest({ clientId: cid, nonce: Date.now() }); };

  useEffect(() => aoClicarNotificacao(({ tab: tt, task, board }) => {
    if (task) handleOpenTask(task, board);
    else if (permitida(tt)) setTab(tt);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const bleed = ["tasks", "chat"].includes(tab);
  const wide = ["home"].includes(tab);
  const irPara = (id) => { setTab(id); setMenuAberto(false); setCmdk(false); };

  // atalhos: ⌘K paleta · esc fecha
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk(v => !v); }
      if (e.key === "Escape") { setMenuAberto(false); setCmdk(false); }
      if (e.key === "?" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable) setTour(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // contadores ao vivo + máquinas (só sócio)
  const [counts, setCounts] = useState({ dec: 0, squads: 0, mem: 0, runs: 0, atend: 0 });
  const [rodando, setRodando] = useState([]);
  const [runnerOnline, setRunnerOnline] = useState(null); // null = não sei ainda
  useEffect(() => {
    const auth = { headers: { Authorization: `Bearer ${api.token()}` } };
    const j = (r) => (r.ok ? r.json() : []);
    const load = () => {
      if (!ac.socio) return;
      Promise.all([
        fetch("/api/office/decisions?status=aberta", auth).then(j).catch(() => []),
        fetch("/api/office/agents", auth).then(j).catch(() => []),
        fetch("/api/office/memories", auth).then(j).catch(() => []),
        fetch("/api/office/runs?ativos=1&limit=5", auth).then(j).catch(() => []),
        fetch("/api/office/runners", auth).then(j).catch(() => []),
        fetch("/api/office/atendimento/conversas?status=abertas", auth).then(j).catch(() => ({})),
      ]).then(([dec, squads, mem, runs, runners, atend]) => {
        const vivos = Array.isArray(runs) ? runs : [];
        setRodando(vivos);
        setRunnerOnline(Array.isArray(runners) ? runners.some(m => m.online) : null);
        setCounts({
          dec: Array.isArray(dec) ? dec.length : 0,
          squads: Array.isArray(squads) ? squads.length : 0,
          mem: Array.isArray(mem) ? mem.length : 0,
          runs: vivos.length,
          atend: atend?.abertas || 0,
        });
      });
    };
    load();
    const iv = setInterval(load, rodando.length ? 5_000 : 30_000);
    return () => clearInterval(iv);
  }, [rodando.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const nomeEmpresa = empresa?.nome || "Nomade Business";
  useEffect(() => {
    document.title = rodando.length ? `(${rodando.length}) ${nomeEmpresa}` : nomeEmpresa;
  }, [rodando.length, nomeEmpresa]);

  const countOf = (n) => (n.count ? counts[n.count] ?? null : null);
  const topAction = TOP_ACTION[tab];
  const fireTopAction = () => window.dispatchEvent(new CustomEvent("nomade:top-action", { detail: { tab } }));
  const [promoOculto, setPromoOculto] = useState(() => { try { return sessionStorage.getItem("nomade_promo_off") === "1"; } catch { return false; } });
  const mostrarPromo = ac.socio && runnerOnline === false && !promoOculto && tab !== "cli" && permitida("cli");

  return (
    <div className={`shell${menuAberto ? " shell--menu" : ""}`}>
      <button className="shell__scrim" aria-label={t("common.close")} onClick={() => setMenuAberto(false)} />
      <aside className="sb">
        <div className="sb__nav">
          <button className="sb__ws" data-tour="ws" onClick={() => irPara("settings")} title={t("nav.settings")}>
            <span className="sb__ws-mark">{nomeEmpresa.trim().slice(0, 1).toUpperCase()}</span>
            <span className="sb__ws-name"><b>{nomeEmpresa}</b><span>nomade business</span></span>
            <Icon name="updown" size={14} />
          </button>
          <button className="sb__search" data-tour="search" onClick={() => setCmdk(true)}>
            <Icon name="search" size={14} /><span>{t("nav.search")}</span><kbd>⌘K</kbd>
          </button>

          {NAV.map((g) => {
            const itens = g.items.filter(n => fase(n.id));
            if (!itens.length) return null;
            const gf = itens.some(n => ["in", "entrando"].includes(fase(n.id))) ? (itens.every(n => fase(n.id) === "entrando") ? "entrando" : "in") : "saindo";
            return (
              <div className={`pz pz--${gf}`} key={g.group}>
                <div className="pz__in">
                  <div className="sb__group" data-tour={`grupo-${g.group.split(".")[1]}`}>
                    <div className="sb__group-label">{t(g.group)}</div>
                    {itens.map(n => {
                      const c = countOf(n), f = fase(n.id);
                      return (
                        <div className={`pz pz--${f}`} key={n.id}>
                          <div className="pz__in">
                            <button data-tour={f === "saindo" ? undefined : `nav-${n.id}`} tabIndex={f === "saindo" ? -1 : undefined} onClick={() => irPara(n.id)} className={`sb__item${tab === n.id ? " sb__item--active" : ""}`} aria-current={tab === n.id ? "page" : undefined}>
                              <Icon name={n.icon} size={16} />
                              <span className="sb__item-label">{t(n.label)}</span>
                              {c !== null && c > 0 && <span className={`sb__count${["dec", "atend"].includes(n.count) ? " alert" : ""}${n.count === "runs" ? " vivo" : ""}`}>{c}</span>}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sb__foot">
          {mostrarPromo && (
            <div className="sb__promo">
              <button className="sb__promo-x" aria-label={t("common.close")} onClick={() => { setPromoOculto(true); try { sessionStorage.setItem("nomade_promo_off", "1"); } catch { /* */ } }}><Icon name="close" size={12} /></button>
              <b>{t("nav.runner_off")}</b>
              <p>{t("nav.runner_off_sub")}</p>
              <button onClick={() => irPara("cli")}>{t("nav.runner_cta")}</button>
            </div>
          )}
          <div className="sb__usercard" data-tour="conta">
            <span className="av">{user.picture ? <img src={user.picture} alt="" /> : (me?.initials || user.name?.[0] || "?")}</span>
            <div><div className="nm">{me?.name || user.name}</div><div className="em">{user.email}</div></div>
            <button className="out" onClick={onLogout} title={t("nav.signout")}><Icon name="logout" size={14} /></button>
          </div>
        </div>
      </aside>

      <div className="shell__main">
        <header className="tb">
          <button className="tb__burger" onClick={() => setMenuAberto(v => !v)} aria-label="Menu" aria-expanded={menuAberto}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
            {counts.dec > 0 && <i className="tb__burger-dot" />}
          </button>
          <div className="tb__title">
            <span className="tb__crumb">{t(nav.find(g => g.items.some(i => i.id === tab))?.group || "nav.monitor")} /</span>
            {t(FLAT.find(i => i.id === tab)?.label || "nav.home")}
          </div>
          {rodando.length > 0 && (
            <button className="tb__vivo" onClick={() => irPara(permitida("runner") ? "runner" : "home")}>
              <i /><span className="tb__vivo-txt">
                {rodando.length === 1
                  ? t("nav.working1", { name: rodando[0].atual?.nome || rodando[0].squad || "agent", task: rodando[0].titulo || "" })
                  : t("nav.working", { n: rodando.length })}
              </span>
            </button>
          )}
          <div className="tb__spacer" />
          <div className="tb__actions">
            <button className="tb__btn" data-tour="ajuda" onClick={() => setTour(true)} title={t("tour.open")} aria-label={t("tour.open")}>
              <Icon name="help" size={14} />
            </button>
            <Pop label={lang.toUpperCase()} title={t("nav.lang")}>
              {LANGS.map(l => <button key={l} role="menuitemradio" aria-checked={lang === l} onClick={() => setLang(l)}>{t(`lang.${l}`)}</button>)}
            </Pop>
            <button className="tb__btn" onClick={theme.toggle} title={t("nav.theme")} aria-label={t("nav.theme")}>
              <Icon name={theme.theme === "dark" ? "sun" : "moon"} size={14} />
            </button>
            <InstallButton />
            <span data-tour="avisos" style={{ display: "inline-flex" }}><NotifBell me={me} onOpenTask={handleOpenTask} /></span>
            {topAction && (
              <button className="tb__btnp" onClick={fireTopAction}><Icon name="plus" size={13} />{t(topAction)}</button>
            )}
          </div>
        </header>

        <main className={`shell__content${bleed ? " shell__content--bleed" : ""}${wide ? " shell__content--wide" : ""}`}>
          <ErrorBoundary resetKey={tab}>
            {tab === "home" && <Home user={user} me={me} empresa={empresa} onGoTo={irPara} tem={permitida} runnerOnline={runnerOnline} decisoes={counts.dec} />}
            {tab === "propostas" && <Propostas openRequest={propostaRequest} />}
            {tab === "leads" && <Leads />}
            {tab === "clients" && <Clients onOpenProposta={handleOpenProposta} onOpenKanban={handleOpenClientKanban} me={me} user={user} />}
            {tab === "projetos" && <Projetos />}
            {tab === "tasks" && <Tasks user={user} me={me} openTaskRequest={openTaskRequest} onOpenTask={handleOpenTask} openClientBoard={clientBoardRequest} onTaskRequestDone={() => setOpenTaskRequest(null)} onClientBoardDone={() => setClientBoardRequest(null)} />}
            {tab === "finance" && <Finance />}
            {tab === "chat" && <Chat me={me} onGoTo={irPara} />}
            {tab === "organograma" && <Organograma />}
            {tab === "inbox" && <InboxDecisoes />}
            {tab === "memoria" && <Memoria />}
            {tab === "activity" && <Activity />}
            {tab === "runner" && <Runner onGoTo={irPara} />}
            {tab === "membros" && <Membros />}
            {tab === "integrations" && <Integrations />}
            {tab === "cli" && <Cli />}
            {tab === "payments" && <Payments onGoTo={irPara} />}
            {tab === "atendimento" && <Atendimento onGoTo={irPara} />}
            {tab === "settings" && <Settings empresa={empresa} theme={theme} onChange={onEmpresaChange} onRerunOnboarding={onRerunOnboarding} onTour={() => { irPara("home"); setTour(true); }} />}
          </ErrorBoundary>
        </main>
      </div>

      <UpdateBar />

      {cmdk && <CommandPalette nav={nav} onPick={irPara} onClose={() => setCmdk(false)} />}
      {tour && !cmdk && <Tour passos={passosDoTour} onClose={() => setTour(false)} onMenu={setMenuAberto} />}

      <nav className="shell__tabs">
        {mobileTabs.map(id => {
          const n = flat.find(x => x.id === id); if (!n) return null;
          const c = countOf(n);
          return (
            <button key={n.id} onClick={() => irPara(n.id)} className={`shell__tab${tab === n.id ? " shell__tab--active" : ""}`}>
              <span className="shell__tab-ic"><Icon name={n.icon} size={19} />{c > 0 && <i className={`shell__tab-badge${n.count === "dec" ? " alert" : ""}`}>{c > 9 ? "9+" : c}</i>}</span>
              <span>{t(n.label)}</span>
            </button>
          );
        })}
        <button onClick={() => setMenuAberto(true)} className="shell__tab" data-tour="mais">
          <span className="shell__tab-ic"><Icon name="more" size={19} /></span><span>{t("nav.more")}</span>
        </button>
      </nav>
    </div>
  );
}

/* menu pequeno da topbar (idioma) */
function Pop({ label, title, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="tb__menu" ref={ref}>
      <button className="tb__btn" onClick={() => setOpen(v => !v)} title={title} aria-haspopup="menu" aria-expanded={open}>{label}</button>
      {open && <div className="tb__pop" role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

/* ⌘K — ir pra qualquer tela digitando */
function CommandPalette({ nav, onPick, onClose }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const itens = nav.flatMap(g => g.items.map(i => ({ ...i, grupo: t(g.group), nome: t(i.label) })));
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lista = itens.filter(i => !q || norm(i.nome).includes(norm(q)) || norm(i.grupo).includes(norm(q)));
  useEffect(() => { setSel(0); }, [q]);
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(lista.length - 1, s + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    if (e.key === "Enter" && lista[sel]) onPick(lista[sel].id);
  };
  let ultimoGrupo = null;
  return (
    <div className="cmdk" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk__box" role="dialog" aria-modal="true">
        <div className="cmdk__input">
          <Icon name="search" size={15} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder={t("cmd.placeholder")} />
        </div>
        <div className="cmdk__list">
          {lista.length === 0 && <div className="cmdk__empty">—</div>}
          {lista.map((i, idx) => {
            const cab = i.grupo !== ultimoGrupo ? <div className="cmdk__group" key={`g-${i.grupo}`}>{i.grupo}</div> : null;
            ultimoGrupo = i.grupo;
            return (
              <div key={i.id}>
                {cab}
                <button className="cmdk__item" aria-selected={idx === sel} onMouseEnter={() => setSel(idx)} onClick={() => onPick(i.id)}>
                  <Icon name={i.icon} size={15} />{i.nome}{idx === sel && <kbd>↵</kbd>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk__hint">{t("cmd.hint")}</div>
      </div>
    </div>
  );
}
