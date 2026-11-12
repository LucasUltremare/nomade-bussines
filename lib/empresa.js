/* ══════════════════════════════════════════════════════════════════════════
 * EMPRESA — quem está usando o Nomade Business
 *
 * Tudo que aparece pro cliente final (proposta, página de pagamento, emails,
 * descrição no Mercado Pago, recepção do chat de leads) sai daqui. Configura
 * pelo .env; nada disso é segredo.
 * ══════════════════════════════════════════════════════════════════════════ */
const limpa = (u) => String(u || "").trim().replace(/\/+$/, "");

const PRODUTO = "Nomade Business";

// Onde o server principal atende o público (proposta, pagamento, webhooks)
const BASE_URL = limpa(process.env.BASE_URL) || "http://localhost:5002";
// Onde o painel abre (o ai-service serve o painel e faz proxy /hq pro server)
const PAINEL_URL = limpa(process.env.PAINEL_URL || process.env.ADMIN_URL) || "http://localhost:5004";

const nome = (process.env.EMPRESA_NOME || "").trim() || "Minha Empresa";
const EMPRESA = {
  nome,
  email: (process.env.EMPRESA_EMAIL || "").trim(),
  site: limpa(process.env.EMPRESA_SITE) || BASE_URL,
  whatsapp: String(process.env.EMPRESA_WHATSAPP || "").replace(/\D/g, ""),   // só dígitos, com DDI: 5511999999999
  cidade: (process.env.EMPRESA_CIDADE || "").trim(),
  slogan: (process.env.EMPRESA_SLOGAN || "").trim(),
  // Uma ou duas frases do que a empresa faz. Entra nos prompts (orquestrador,
  // recepção do chat, gerador de proposta) — sem isso a IA fala genérico.
  descricao: (process.env.EMPRESA_DESCRICAO || "").trim(),
  // Como aparece na fatura do cartão (Mercado Pago aceita até 22 caracteres)
  descritorFatura: (process.env.EMPRESA_DESCRITOR || nome).toUpperCase().normalize("NFD").replace(/[^A-Z0-9 ]/g, "").slice(0, 22).trim() || "NOMADE",
  cor: (process.env.EMPRESA_COR || "#0077B6").trim(),
  logo: (process.env.LOGO_URL || "").trim(),
};

/* Marca pras páginas públicas: o logo configurado ou um monograma na cor da empresa. */
const escHtml = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function marcaHtml(tam = 24) {
  if (EMPRESA.logo) return `<img src="${escHtml(EMPRESA.logo)}" alt="${escHtml(EMPRESA.nome)}" width="${tam}" height="${tam}" style="border-radius:6px;object-fit:contain"/>`;
  const ini = EMPRESA.nome.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return `<span aria-hidden="true" style="display:inline-grid;place-items:center;width:${tam}px;height:${tam}px;border-radius:7px;background:${escHtml(EMPRESA.cor)};color:#fff;font:700 ${Math.round(tam * 0.42)}px/1 sans-serif">${escHtml(ini)}</span>`;
}

module.exports = { EMPRESA, PRODUTO, BASE_URL, PAINEL_URL, marcaHtml };
