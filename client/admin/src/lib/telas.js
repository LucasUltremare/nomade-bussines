/* ══════════════════════════════════════════════════════════
   TELAS — o menu inteiro do painel, num lugar só.
   O shell monta a barra lateral daqui; Ajustes e o onboarding
   usam a mesma lista pra deixar a empresa ligar e desligar tela.
   `mod` é a permissão de membro que libera a tela (sem `mod`, só sócio).
   Agentes e CLI saíram do menu: dono de negócio não opera agente. Quem
   quiser agente usa o Relay (outro projeto da Nomade), que entra pelo
   plug em Integrações.
   ══════════════════════════════════════════════════════════ */

export const NAV = [
  { group: "nav.monitor", items: [
    { id: "home", label: "nav.home", icon: "home" },
    { id: "chat", label: "nav.chat", icon: "comment" },
    { id: "inbox", label: "nav.decisions", icon: "bell", count: "dec" },
  ] },
  { group: "nav.company", items: [
    { id: "tasks", label: "nav.tasks", icon: "board", mod: "kanban" },
    { id: "memoria", label: "nav.memory", icon: "bookmark", count: "mem" },
    { id: "runner", label: "nav.runs", icon: "play", count: "runs" },
    { id: "activity", label: "nav.activity", icon: "list" },
  ] },
  { group: "nav.sales", items: [
    { id: "atendimento", label: "nav.atendimento", icon: "comment", count: "atend" },
    { id: "leads", label: "nav.leads", icon: "inbox", mod: "leads" },
    { id: "clients", label: "nav.clients", icon: "clients", mod: "clients" },
    { id: "projetos", label: "nav.projects", icon: "external", mod: "projetos" },
    { id: "propostas", label: "nav.proposals", icon: "report", mod: "propostas" },
    { id: "payments", label: "nav.payments", icon: "zap", mod: "propostas" },
    { id: "finance", label: "nav.finance", icon: "finance" },
  ] },
  { group: "nav.system", items: [
    { id: "integrations", label: "nav.integrations", icon: "plug" },
    { id: "membros", label: "nav.members", icon: "users" },
    { id: "settings", label: "nav.settings", icon: "settings" },
  ] },
];

/* Início e Ajustes ficam sempre ligados. */
export const FIXAS = ["home", "settings"];
export const TELAS = NAV.flatMap((g) => g.items.map((i) => i.id)).filter((id) => !FIXAS.includes(id));

/* Pontos de partida. Tem que bater com LAYOUTS em lib/empresa-config.js. */
export const LAYOUTS = {
  simple: ["tasks", "clients", "finance"],
  sales: ["atendimento", "leads", "clients", "propostas", "payments", "finance"],
  full: TELAS,
};

export const layoutDe = (modulos) => {
  const set = new Set(modulos || []);
  return Object.keys(LAYOUTS).find((k) => LAYOUTS[k].length === set.size && LAYOUTS[k].every((m) => set.has(m))) || "custom";
};
