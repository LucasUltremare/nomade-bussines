/* ══════════════════════════════════════════════════════════════════════════
 * CONFIGURAÇÃO DA EMPRESA — o que o onboarding grava.
 *
 * O .env (lib/empresa.js) continua sendo o padrão: é o que o Docker lê e o
 * que as páginas públicas de proposta usam. O que o sócio preenche no
 * onboarding mora em `nomade_settings {key:'empresa'}` e vale por cima do
 * .env dentro do painel, no formulário público de cadastro e nos prompts.
 * ══════════════════════════════════════════════════════════════════════════ */
const { EMPRESA } = require("./empresa");
const { setRegional } = require("./formato");

const IDIOMAS = ["en", "pt", "es"];
const OBJETIVOS = ["sales", "proposals", "projects", "agents", "memory", "leads", "finance", "team"];
const TEMAS = ["light", "dark"];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/* Telas que o sócio pode ligar e desligar. É organização, não segurança:
   quem barra acesso continua sendo a permissão de cada membro. Início e
   Ajustes não entram na lista porque não dá pra desligar. */
const MODULOS = [
  "chat", "inbox", "tasks", "organograma", "memoria", "runner", "activity",
  "atendimento", "leads", "clients", "projetos", "propostas", "payments", "finance",
  "integrations", "cli", "membros",
];
const LAYOUTS = {
  simple: ["tasks", "clients", "finance"],
  sales: ["atendimento", "leads", "clients", "propostas", "payments", "finance"],
  full: MODULOS,
};
const VERSAO = 2; // 2 = tema claro como padrão, região e módulos configuráveis

const padrao = () => ({
  nome: EMPRESA.nome,
  descricao: EMPRESA.descricao,
  site: EMPRESA.site,
  email: EMPRESA.email,
  whatsapp: EMPRESA.whatsapp,
  cidade: EMPRESA.cidade,
  idioma: IDIOMAS.includes(process.env.IDIOMA_PADRAO) ? process.env.IDIOMA_PADRAO : "en",
  tema: "light",
  pais: (process.env.PAIS_PADRAO || "BR").toUpperCase().slice(0, 2),
  moeda: (process.env.MOEDA_PADRAO || "BRL").toUpperCase().slice(0, 3),
  fuso: process.env.FUSO_PADRAO || "America/Sao_Paulo",
  semanaComeca: 1,
  documento: "",
  endereco: "",
  layout: "full",
  modulos: [...MODULOS],
  objetivos: [],
  horario: { dias: [1, 2, 3, 4, 5], abre: "09:00", fecha: "18:00" },
  onboarding: { feito: false, passo: 0, feitoEm: null, por: null },
});

/* Só os campos conhecidos, cada um no formato certo. Campo errado é
   ignorado, não derruba o PUT — o onboarding salva a cada passo. */
function sanitizar(body = {}) {
  const out = {};
  const texto = (k, max) => { if (body[k] !== undefined) out[k] = String(body[k] ?? "").trim().slice(0, max); };
  texto("nome", 80); texto("descricao", 600); texto("site", 200); texto("email", 120); texto("cidade", 80);
  texto("documento", 60); texto("endereco", 200);
  if (body.pais !== undefined && /^[A-Za-z]{2}$/.test(String(body.pais))) out.pais = String(body.pais).toUpperCase();
  if (body.moeda !== undefined && /^[A-Za-z]{3}$/.test(String(body.moeda)) && moedaValida(String(body.moeda))) out.moeda = String(body.moeda).toUpperCase();
  if (body.semanaComeca !== undefined && [0, 1, 6].includes(Number(body.semanaComeca))) out.semanaComeca = Number(body.semanaComeca);
  if (Array.isArray(body.modulos)) {
    const pedidos = new Set(body.modulos.map(String));
    out.modulos = MODULOS.filter((m) => pedidos.has(m));
    // o layout é só o nome do conjunto: se a lista bate com um pronto, é ele
    out.layout = Object.keys(LAYOUTS).find((k) => LAYOUTS[k].length === out.modulos.length && LAYOUTS[k].every((m) => pedidos.has(m))) || "custom";
  } else if (body.layout !== undefined && LAYOUTS[body.layout]) {
    out.layout = body.layout;
    out.modulos = [...LAYOUTS[body.layout]];
  }
  if (body.whatsapp !== undefined) out.whatsapp = String(body.whatsapp || "").replace(/\D/g, "").slice(0, 20);
  if (body.idioma !== undefined && IDIOMAS.includes(body.idioma)) out.idioma = body.idioma;
  if (body.tema !== undefined && TEMAS.includes(body.tema)) out.tema = body.tema;
  if (body.fuso !== undefined && fusoValido(String(body.fuso || ""))) out.fuso = String(body.fuso).slice(0, 64);
  if (Array.isArray(body.objetivos)) out.objetivos = [...new Set(body.objetivos.map(String))].filter((o) => OBJETIVOS.includes(o));
  if (body.horario && typeof body.horario === "object") {
    const h = body.horario;
    const dias = Array.isArray(h.dias) ? [...new Set(h.dias.map(Number))].filter((d) => d >= 0 && d <= 6).sort() : undefined;
    out.horario = {
      dias: dias ?? [1, 2, 3, 4, 5],
      abre: HORA.test(h.abre) ? h.abre : "09:00",
      fecha: HORA.test(h.fecha) ? h.fecha : "18:00",
    };
  }
  if (body.onboarding && typeof body.onboarding === "object") {
    out.onboarding = {
      feito: !!body.onboarding.feito,
      passo: Math.max(0, Math.min(12, Number(body.onboarding.passo) || 0)),
    };
  }
  return out;
}

const moedaValida = (m) => { try { new Intl.NumberFormat("en", { style: "currency", currency: m }); return true; } catch { return false; } };
const fusoValido = (f) => { try { new Intl.DateTimeFormat("en", { timeZone: f }); return !!f; } catch { return false; } };

async function obterEmpresaConfig(db) {
  const doc = await db.collection("nomade_settings").findOne({ key: "empresa" });
  const salvo = { ...(doc?.value || {}) };
  // Config gravada antes da versão 2 guardava "dark" sem ninguém ter escolhido
  // (o onboarding salvava o tema da tela a cada passo). O padrão agora é claro.
  if ((salvo.versao || 1) < VERSAO) delete salvo.tema;
  const base = padrao();
  const cfg = {
    ...base,
    ...salvo,
    horario: { ...base.horario, ...(salvo.horario || {}) },
    onboarding: { ...base.onboarding, ...(salvo.onboarding || {}) },
    versao: VERSAO,
  };
  // layout pronto acompanha o produto: tela nova entra sozinha em quem
  // escolheu "Comercial" ou "Tudo". Só a seleção à mão fica congelada.
  if (LAYOUTS[cfg.layout]) cfg.modulos = [...LAYOUTS[cfg.layout]];
  setRegional(cfg);
  return cfg;
}

async function salvarEmpresaConfig(db, body, por) {
  const atual = await obterEmpresaConfig(db);
  const patch = sanitizar(body);
  const novo = { ...atual, ...patch, versao: VERSAO };
  if (patch.onboarding) {
    novo.onboarding = { ...atual.onboarding, ...patch.onboarding };
    if (patch.onboarding.feito && !atual.onboarding.feito) {
      novo.onboarding.feitoEm = new Date();
      novo.onboarding.por = por || null;
    }
  }
  await db.collection("nomade_settings").updateOne(
    { key: "empresa" },
    { $set: { key: "empresa", value: novo, updatedAt: new Date(), updatedBy: por || null } },
    { upsert: true },
  );
  setRegional(novo);
  return novo;
}

/* ── Formulários públicos de cadastro (links de captação) ─────────────────
   Cada um vira uma página em /f/<slug>, sem JS, que grava em nomade_leads
   com source "form:<slug>". */
const CAMPOS = ["name", "email", "whatsapp", "company", "msg"];

const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function sanitizarForm(body = {}, parcial = false) {
  const out = {};
  if (!parcial || body.titulo !== undefined) out.titulo = String(body.titulo || "").trim().slice(0, 80);
  if (body.descricao !== undefined) out.descricao = String(body.descricao || "").trim().slice(0, 400);
  if (body.idioma !== undefined) out.idioma = IDIOMAS.includes(body.idioma) ? body.idioma : "en";
  if (body.campos !== undefined) {
    const lista = Array.isArray(body.campos) ? body.campos : [];
    out.campos = CAMPOS.filter((c) => lista.includes(c));
    // nome e um contato são o mínimo: sem isso o lead não tem como ser respondido
    if (!out.campos.includes("name")) out.campos.unshift("name");
    if (!out.campos.includes("email") && !out.campos.includes("whatsapp")) out.campos.push("email");
  }
  if (body.ativo !== undefined) out.ativo = !!body.ativo;
  if (body.obrigadoTexto !== undefined) out.obrigadoTexto = String(body.obrigadoTexto || "").trim().slice(0, 300);
  if (body.redirect !== undefined) {
    const r = String(body.redirect || "").trim().slice(0, 300);
    out.redirect = /^https?:\/\//.test(r) ? r : "";
  }
  return out;
}

module.exports = {
  IDIOMAS, OBJETIVOS, TEMAS, CAMPOS, MODULOS, LAYOUTS,
  obterEmpresaConfig, salvarEmpresaConfig, sanitizar,
  sanitizarForm, slugify,
};
