/* ══════════════════════════════════════════════════════════
   ASSIGNEES — sócios (TEAM) + funcionários-agent (squads).
   Task do kanban pode ser de humano OU de agent: o assignee
   de agent é a string "agent:<squadId>" (o campo é livre no
   server, então isso é 100% client-side).
   ══════════════════════════════════════════════════════════ */
import { useEffect, useState } from "react";
import { TEAM } from "./team.js";
import { api } from "../api/client.js";

// cores fixas por departamento (mesmas do Office/DEPTS — duplicadas aqui
// de propósito: lib não importa feature)
const DEPT_COLORS = {
  triagem: "#d4654a",
  diagnostico: "#c8a040",
  comercial: "#0077B6",
  producao: "#00A896",
  conteudo: "#3aa0c9",
  suporte: "#d98a5a",
};

let AGENTS = [];
let started = false;
const subs = new Set();

export async function refreshAgents() {
  try {
    const r = await fetch("/api/office/agents", { headers: { Authorization: `Bearer ${api.token()}` } });
    if (!r.ok) return;
    const squads = await r.json();
    AGENTS = (Array.isArray(squads) ? squads : []).map(s => ({
      id: `agent:${s.id}`,
      name: s.name,
      color: DEPT_COLORS[s.dept] || "#6b859c",
      initials: String(s.name || "?").slice(0, 2).toUpperCase(),
      isAgent: true,
    }));
    subs.forEach(cb => cb());
  } catch { /* offline — fica a lista anterior */ }
}

export const agentMembers = () => AGENTS;
export const allAssignees = () => [...TEAM, ...AGENTS];

/* `t` é opcional: só é usado pro nome do agent removido (i18n) */
export function assigneeById(id, t) {
  if (!id) return null;
  const hit = TEAM.find(m => m.id === id) || AGENTS.find(m => m.id === id);
  if (hit) return hit;
  if (String(id).startsWith("agent:")) {
    // squad apagado — não quebra a task
    return { id, name: t ? t("kb.agent_removed") : "Removed agent", color: "#6b859c", initials: "AG", isAgent: true };
  }
  return null;
}

/* hook: garante o fetch (1x + refresh a cada 60s) e re-renderiza quando chegar */
export function useAssignees() {
  const [, force] = useState(0);
  useEffect(() => {
    if (!started) {
      started = true;
      refreshAgents();
      setInterval(refreshAgents, 60_000);
    }
    const cb = () => force(x => x + 1);
    subs.add(cb);
    return () => subs.delete(cb);
  }, []);
  return { team: TEAM, agents: AGENTS, all: allAssignees() };
}
