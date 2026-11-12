/* ══════════════════════════════════════════════════════════
   TEAM — mapeamento email → membro

   Não mora mais no código: vem do servidor (GET /api/admin/time),
   que lê a config do time (config/time.json, TIME_JSON ou o
   ADMIN_EMAILS). O App chama carregarTime() logo depois do login,
   antes de abrir o painel — os arrays abaixo são preenchidos no
   lugar, então quem importou TEAM/SECTORS enxerga a lista.
   ══════════════════════════════════════════════════════════ */
import { api } from "../api/client.js";

export const SECTORS = [];
export const TEAM = [];

export async function carregarTime() {
  try {
    const r = await api.get("/api/admin/time");
    SECTORS.splice(0, SECTORS.length, ...(r?.setores || []));
    TEAM.splice(0, TEAM.length, ...(r?.time || []).map((m) => ({ ...m, email: (m.emails || [])[0] || "" })));
  } catch {
    /* sem a lista o painel abre igual: avatar cai no genérico (memberFromUser) */
  }
}

export function memberByEmail(email) {
  if (!email) return null;
  const e = email.toLowerCase();
  return TEAM.find(m => (m.emails || []).some(x => x.toLowerCase() === e)) || null;
}

export function memberFromUser(user) {
  if (!user) return null;
  const m = memberByEmail(user.email);
  if (m) return m;
  // fallback genérico
  return {
    id: user.email || "me",
    email: user.email,
    emails: user.email ? [user.email] : [],
    name: user.name || (user.email || "?").split("@")[0],
    color: "#0077B6",
    initials: ((user.name || user.email || "?").slice(0, 2)).toUpperCase(),
    sector: SECTORS[0]?.id || "operacional",
  };
}

export function sectorById(id) {
  return SECTORS.find(s => s.id === id) || SECTORS[SECTORS.length - 1] || { id: "operacional", label: "Operacional", color: "#00A896" };
}
