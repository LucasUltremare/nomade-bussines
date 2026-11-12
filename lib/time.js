/* ══════════════════════════════════════════════════════════════════════════
 * TIME — quem é quem no painel (kanban, menções, sócios, setores)
 *
 * Fonte, nesta ordem:
 *   1. TIME_JSON no ambiente (o JSON inteiro numa variável)
 *   2. o arquivo TIME_FILE (padrão: config/time.json, fora do git)
 *   3. nada configurado: cada email do ADMIN_EMAILS vira um membro
 *
 * Formato (ver config/time.example.json):
 *   { "setores": [{ "id", "label", "color" }],
 *     "time":    [{ "id", "nome", "emails": [], "cor", "iniciais", "setor", "unidade", "socio" }] }
 *
 * O `id` é o que fica gravado nas tasks (assignee/createdBy) e nas menções
 * (@id). Trocar o id de alguém depois desliga o histórico dessa pessoa.
 * ══════════════════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");

const PALETA = ["#0077B6", "#8b5cf6", "#c8a040", "#00A896", "#e2557b", "#4FB3D9", "#d97706", "#6ABF5A"];
const SETORES_PADRAO = [
  { id: "administrativo", label: "Administrativo", color: "#0077B6" },
  { id: "operacional", label: "Operacional", color: "#00A896" },
];

const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_-]+/g, "").slice(0, 32);

function lerConfig() {
  try {
    if (process.env.TIME_JSON) return JSON.parse(process.env.TIME_JSON);
    const arquivo = process.env.TIME_FILE || path.join(__dirname, "..", "config", "time.json");
    if (fs.existsSync(arquivo)) return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch (e) {
    console.error("[time] configuração inválida, usando ADMIN_EMAILS:", e.message);
  }
  return null;
}

function carregarTime() {
  const cfg = lerConfig() || {};
  const admins = String(process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const setores = Array.isArray(cfg.setores) && cfg.setores.length
    ? cfg.setores.map((s) => ({ id: slug(s.id), label: String(s.label || s.id), color: s.color || "#0077B6" }))
    : SETORES_PADRAO;

  const brutos = Array.isArray(cfg.time) && cfg.time.length
    ? cfg.time
    : admins.map((email) => ({ id: email.split("@")[0], nome: email.split("@")[0], emails: [email] }));

  const vistos = new Set();
  const time = [];
  brutos.forEach((m, i) => {
    const emails = (m.emails || (m.email ? [m.email] : [])).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    let id = slug(m.id || m.nome || emails[0]?.split("@")[0]) || `membro${i + 1}`;
    while (vistos.has(id)) id = `${id}${i + 1}`;
    vistos.add(id);
    const nome = String(m.nome || m.name || id);
    const membro = {
      id,
      nome, name: nome,                       // `name` é o campo que o código antigo lê
      emails, email: emails[0] || "",
      cor: m.cor || m.color || PALETA[i % PALETA.length],
      iniciais: String(m.iniciais || m.initials || nome.split(/\s+/).map((p) => p[0]).join("").slice(0, 2)).toUpperCase(),
      setor: setores.some((s) => s.id === m.setor) ? m.setor : setores[0].id,
      unidade: String(m.unidade || ""),
      socio: m.socio !== undefined ? !!m.socio : emails.some((e) => admins.includes(e)),
    };
    membro.color = membro.cor; membro.initials = membro.iniciais; membro.sector = membro.setor;
    time.push(membro);
  });
  return { setores, time };
}

const { setores: SETORES, time: TIME } = carregarTime();
const SOCIOS = TIME.filter((m) => m.socio);

module.exports = { TIME, SETORES, SOCIOS };
