/**
 * Nomade Business — server principal
 * ───────────────────────────────────
 * Express + Socket.IO servindo:
 *   /api/admin/*        → API do painel (CRM, kanban, propostas, cobranças…)
 *   /admin              → painel (client/admin/dist), só via proxy do ai-service
 *   /proposta/:token    → proposta pública (HTML server-side)
 *   /pagar/:token       → página de pagamento (HTML server-side)
 *   /api/leads, /api/lead-chat → entrada de leads do site da empresa
 *   /api/mp-webhook*    → confirmação de pagamento do Mercado Pago
 *   /socket.io/*        → tempo real do kanban e notificações
 *
 * Configuração: ver .env.example (empresa, time, chaves).
 */

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const { Server: SocketIOServer } = require("socket.io");

// ── Email (Resend wrapper + templates) ──
const { sendEmail } = require("./lib/email");
const { renderPaymentConfirmedEmail } = require("./lib/emails/payment-confirmed");
const { renderReportReminderEmail } = require("./lib/emails/report-reminder");
const { renderReportSummaryEmail } = require("./lib/emails/report-summary");
const { renderNewLeadEmail } = require("./lib/emails/new-lead");
const { renderLeadQuoteEmail } = require("./lib/emails/lead-quote");
const { generateProposta } = require("./agents/orcamento");
const { renderPropostaPage, propostaNotFoundPage } = require("./lib/proposta-page");
const { obterEmpresaConfig, salvarEmpresaConfig, sanitizarForm, slugify } = require("./lib/empresa-config");
const { renderFormPage, formNotFoundPage } = require("./lib/form-page");
const { capturar: capturarSite } = require("./lib/screenshot");

const {
  PORT = 5002,
  BASE_URL,
  MONGODB_URI,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  JWT_SECRET,
  ADMIN_EMAILS = "",
} = process.env;

const ADMIN_LIST = ADMIN_EMAILS.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

/* ADMIN_EMAILS vazia não é um detalhe: sem ela NINGUÉM entra no cockpit, e a
   mensagem que a pessoa vê ("Acesso restrito — só admins") culpa a conta dela
   em vez do deploy. O compose declara `ADMIN_EMAILS=${ADMIN_EMAILS}` sem
   default, então basta o Portainer resolver a var vazia pra derrubar o login
   inteiro em silêncio. Isto faz o modo de falha aparecer no `docker logs`. */
if (!ADMIN_LIST.length) {
  console.error("[aviso] ADMIN_EMAILS VAZIA — ninguém vai conseguir logar no cockpit.");
  console.error("   O compose injeta ${ADMIN_EMAILS} a partir do .env do stack. Confere lá.");
}

const { rateLimit, securityHeaders, propostaCsp } = require("./lib/security");
const formato = require("./lib/formato");
const { EMPRESA, PRODUTO, BASE_URL: URL_PUBLICA, PAINEL_URL } = require("./lib/empresa");
const { renderPagamento, renderPagamentoErro, renderPagamentoRetorno } = require("./lib/pagamento-page");

const app = express();
app.disable("x-powered-by");
app.use(securityHeaders);

// Nada aqui é página pra buscador: painel e links privados por token (proposta,
// pagamento) ficam fora do índice e sem cache, mesmo se alguém colar o link em público.
const NOINDEX = [/^\/pagar\//i, /^\/proposta\//i, /^\/admin(\/|$)/i, /^\/onboarding(\/|$)/i, /^\/pagamento(\/|$)/i, /^\/hq\//i];
app.use((req, res, next) => {
  if (NOINDEX.some((re) => re.test(req.path))) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});
// Webhooks do Mercado Pago mandam JSON; corpo de proposta/lead é pequeno.
// 256kb cobre tudo com folga e corta payload-bomb (era 5mb).
app.use(express.json({ limit: "256kb" }));
// formulário público de cadastro (/f/:slug) posta sem JS
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

// Limites por rota pública cara/spamável (por IP, janela de 1min).
// Aplicados nas próprias rotas mais abaixo.
const limitLeads = rateLimit({ windowMs: 60_000, max: 5, message: "Você já enviou vários pedidos. Aguarda um minuto." });
const limitChat = rateLimit({ windowMs: 60_000, max: 15, message: "Muitas mensagens seguidas. Respira e tenta de novo." });
const limitPublic = rateLimit({ windowMs: 60_000, max: 120 }); // proposta/pagar público
const limitWebhook = rateLimit({ windowMs: 60_000, max: 300 }); // MP pode mandar rajada
const limitSenha = rateLimit({ windowMs: 15 * 60_000, max: 10, message: "Muitas tentativas. Espera 15 minutos." });

// Helpers genéricos
const randomToken = () => crypto.randomBytes(32).toString("hex");

const MP_API = "https://api.mercadopago.com";

/* ══════════════════════════════════════════════════════════════════════════
 * MONGO
 * ══════════════════════════════════════════════════════════════════════════ */

let db;
const mongoClient = new MongoClient(MONGODB_URI);
let aiDb = null;
async function connectDB() {
  await mongoClient.connect();
  db = mongoClient.db(process.env.MONGODB_DB || "nomade");
  aiDb = mongoClient.db(process.env.MONGODB_OFFICE_DB || "nomade_office"); // escritório: conversas do orquestrador
  console.log("Mongo connected");
  // Existentes
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  // Membros do crew que NÃO são sócios (ex.: leader). Sócio continua vindo do ADMIN_EMAILS.
  await db.collection("nomade_membros").createIndex({ email: 1 }, { unique: true });
  await db.collection("nomade_clients").createIndex({ createdAt: -1 });
  // Portfólio público (seção Projetos da home): lista ordenada só do publicado
  await db.collection("nomade_projetos").createIndex({ publicado: 1, ordem: 1 });
  await db.collection("nomade_projetos_capas").createIndex({ projetoId: 1 }, { unique: true });
  /* Email único SÓ quando existe — o índice antigo (unique sem filtro) indexava
   * clientes sem email como null/"" e barrava o segundo cadastro sem email.
   * ORDEM IMPORTA: dropar o índice velho ANTES de limpar os vazios, senão o
   * próprio updateMany colide no unique durante a limpeza. Idempotente. */
  const clientsCol = db.collection("nomade_clients");
  const emailIdx = (await clientsCol.indexes()).find((i) => i.name === "email_1");
  if (emailIdx && !emailIdx.partialFilterExpression) {
    await clientsCol.dropIndex("email_1");
    console.log("Índice email_1 antigo removido (migração pra parcial)");
  }
  await clientsCol.updateMany(
    { $or: [{ email: "" }, { email: null }] },
    { $unset: { email: "" } }
  );
  await clientsCol.createIndex(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: "string" } } }
  );
  await db.collection("nomade_tasks").createIndex({ status: 1, createdAt: -1 });
  await db.collection("nomade_tasks").createIndex({ archived: 1, status: 1, updatedAt: 1 });
  await db.collection("nomade_boards").createIndex({ createdAt: -1 });
  /* Um board por cliente. Índice PARCIAL porque boards internos têm clientId
   * null/ausente e colidiriam num unique simples. Antes de criar, funde
   * duplicados que a race pode ter deixado (mantém o mais antigo). */
  {
    const dupes = await db.collection("nomade_boards").aggregate([
      { $match: { clientId: { $type: "objectId" } } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: "$clientId", ids: { $push: "$_id" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]).toArray();
    for (const d of dupes) {
      const [keep, ...drop] = d.ids;
      for (const id of drop) {
        await db.collection("nomade_tasks").updateMany(
          { boardId: String(id) },
          { $set: { boardId: String(keep) } }
        );
        await db.collection("nomade_boards").deleteOne({ _id: id });
      }
      console.log(`Board duplicado do cliente ${d._id} fundido (${drop.length} removido/s)`);
    }
    await db.collection("nomade_boards").createIndex(
      { clientId: 1 },
      { unique: true, partialFilterExpression: { clientId: { $type: "objectId" } } }
    );
    // Boards de antes dos templates nasceram com o layout padrão — grava isso
    // pro badge "atual" e o guard de re-aplicar funcionarem neles também.
    await db.collection("nomade_boards").updateMany(
      { template: { $exists: false } },
      { $set: { template: "padrao" } }
    );
    // Notificações órfãs de antes do cascade (task apagada = clique morto no sino)
    {
      const notifTaskIds = await db.collection("nomade_notifications")
        .distinct("taskId", { taskId: { $type: "string" } });
      if (notifTaskIds.length > 0) {
        const vivos = new Set(
          (await db.collection("nomade_tasks")
            .find({ _id: { $in: notifTaskIds.filter(ObjectId.isValid).map(id => new ObjectId(id)) } })
            .project({ _id: 1 }).toArray()
          ).map(t => String(t._id))
        );
        const mortos = notifTaskIds.filter(id => !vivos.has(id));
        if (mortos.length > 0) {
          const r = await db.collection("nomade_notifications").deleteMany({ taskId: { $in: mortos } });
          console.log(`${r.deletedCount} notificação(ões) órfã(s) removida(s)`);
        }
      }
    }
  }
  await db.collection("nomade_agents").createIndex({ name: 1 });
  await db.collection("nomade_leads").createIndex({ createdAt: -1 });
  await db.collection("nomade_notifications").createIndex({ createdAt: -1 });
  await db.collection("nomade_notifications").createIndex({ recipientEmail: 1, read: 1, createdAt: -1 });
  // Push: o endpoint é a identidade do aparelho — único, senão o mesmo
  // celular vira duas linhas e recebe o aviso em dobro.
  // SEM await de propósito: o listen() só acontece se o connectDB() resolver
  // (fim do arquivo). Notificação é acessório — não pode ser o motivo de o
  // server inteiro não subir e ninguém conseguir nem logar.
  db.collection("nomade_push_subs").createIndex({ endpoint: 1 }, { unique: true }).catch(() => {});
  db.collection("nomade_push_subs").createIndex({ email: 1 }).catch(() => {});
  await db.collection("nomade_finance").createIndex({ data: -1 });
  await db.collection("nomade_finance").createIndex({ tipo: 1, categoria: 1 });
  await db.collection("nomade_briefings").createIndex({ clientEmail: 1 }, { unique: true });
  await db.collection("nomade_messages").createIndex({ clientEmail: 1, from: 1, readAt: 1 });
  await db.collection("nomade_messages").createIndex({ clientEmail: 1, createdAt: -1 });
  // Propostas (orçamento + proposta unificados — substituiu o pipeline de deals)
  await db.collection("nomade_propostas").createIndex({ numero: 1 }, { unique: true });
  await db.collection("nomade_propostas").createIndex({ status: 1, updatedAt: -1 });
  await db.collection("nomade_propostas").createIndex({ token: 1 }, { unique: true });
}

/* ══════════════════════════════════════════════════════════════════════════
 * NOTIFICATIONS (time interno)
 * ══════════════════════════════════════════════════════════════════════════ */

// O time vem de config (lib/time.js: TIME_JSON, config/time.json ou ADMIN_EMAILS).
// Setor de cada um pode ser trocado pela UI — overrides em nomade_team_settings.
const { TIME: TEAM, SETORES } = require("./lib/time");

// Compat: TEAM antigo tinha campo `email` singular — agora usa `emails[]`. Helper preserva acesso.
const TEAM_COMPAT = TEAM.map(m => ({ ...m, email: m.emails[0] }));

const memberById = (id) => TEAM_COMPAT.find(m => m.id === id);
const memberByName = (name) => name ? TEAM_COMPAT.find(m => m.name.toLowerCase() === name.toLowerCase()) : null;
const memberByEmail = (email) => {
  if (!email) return null;
  const e = email.toLowerCase();
  return TEAM_COMPAT.find(m => m.emails.some(x => x.toLowerCase() === e)) || null;
};

function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@(\w+)/g) || [];
  const ids = matches.map(m => m.slice(1).toLowerCase());
  return [...new Set(ids)].filter(id => memberById(id));
}

/* ══════════════════════════════════════════════════════════════════════════
 * WEB PUSH — o aviso que chega com o cockpit fechado
 *
 * O socket já entregava notificação em tempo real, mas só com aba aberta.
 * Desde que o admin virou app instalável (client/admin: manifest + sw.js),
 * dá pra entregar pelo browser mesmo com tudo fechado — é o que faz o app
 * instalado valer mais que um favorito.
 *
 * DESLIGADO POR PADRÃO: sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no ambiente,
 * `pushLigado` é false, as rotas respondem { ativo:false } e o front nem
 * oferece o botão. Nada quebra — só não existe push.
 *
 * Gerar o par de chaves (uma vez, pra sempre): npx web-push generate-vapid-keys
 * ══════════════════════════════════════════════════════════════════════════ */

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (EMPRESA.email ? `mailto:${EMPRESA.email}` : "mailto:admin@localhost");

let webpush = null;
let pushLigado = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush = require("web-push");
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushLigado = true;
    console.log("Web Push ligado");
  } catch (e) {
    // Chave configurada mas lib ausente/inválida: avisa alto e segue sem push,
    // em vez de derrubar o server inteiro por causa de notificação.
    console.error("[push] desligado —", e.message);
  }
}

/** Deep link do aviso: o service worker abre isto ao clicar. */
const urlDaNotificacao = (doc) =>
  doc.taskId ? `/?tab=tasks&task=${doc.taskId}&board=${doc.boardId || ""}` : "/";

/** Dispara o push pra todos os aparelhos de UMA pessoa. Nunca lança. */
async function enviarPush(doc) {
  if (!pushLigado) return;
  let subs;
  try {
    subs = await db.collection("nomade_push_subs")
      .find({ email: doc.recipientEmail }).toArray();
  } catch { return; }
  if (!subs.length) return;

  const payload = JSON.stringify({
    title: doc.title,
    body: doc.body || "",
    // Agrupa por task: cinco comentários na mesma task = um aviso que atualiza
    tag: doc.taskId ? `task:${doc.taskId}` : `notif:${doc._id}`,
    url: urlDaNotificacao(doc),
    notifId: String(doc._id),
    ts: doc.createdAt,
  });

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 12 * 60 * 60 });
    } catch (e) {
      // 404/410 = o browser jogou fora a assinatura (app desinstalado, dados
      // limpos). Guardar isso pra sempre só faria a fila crescer sem entregar.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.collection("nomade_push_subs").deleteOne({ _id: s._id }).catch(() => {});
      } else {
        console.warn("[push] falhou:", e.statusCode || e.message);
      }
    }
  }));
}

async function createNotifications(notifs) {
  if (!notifs || notifs.length === 0) return;
  const docs = notifs.map(n => ({
    type: n.type,
    recipientEmail: n.recipientEmail,
    actorName: n.actorName || "",
    actorEmail: n.actorEmail || "",
    title: n.title,
    body: n.body || "",
    taskId: n.taskId || null,
    boardId: n.boardId || null,
    read: false,
    createdAt: new Date(),
  }));
  const r = await db.collection("nomade_notifications").insertMany(docs);
  docs.forEach((doc, i) => {
    const withId = { ...doc, _id: r.insertedIds[i] };
    // só pra sala da própria pessoa — antes ia pra todo socket conectado
    io.to(`user:${String(doc.recipientEmail || "").toLowerCase()}`).emit(`notif:${doc.recipientEmail}`, withId);
    // Sem await: push é entrega externa (FCM/Apple) e não pode segurar quem
    // criou a notificação — se falhar, o sininho já está entregue.
    enviarPush(withId).catch(() => {});
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * AUTH (JWT + middlewares)
 * ══════════════════════════════════════════════════════════════════════════ */

function signJwt(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" } // curto: um token vazado vale 7d, não 30 (login via Google é rápido)
  );
}
function verifyJwt(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "no_token" });
  const decoded = verifyJwt(token);
  if (!decoded) return res.status(401).json({ error: "invalid_token" });
  req.user = decoded;
  next();
}
/* ══════════════════════════════════════════════════════════════════════════
 * ACESSO DO CREW — sócios + membros
 *
 * Sócio = email no ADMIN_EMAILS: vê e faz tudo (é a regra de sempre).
 * Membro = cadastrado pelos sócios na aba Membros (nomade_membros), com uma
 * lista fechada de módulos. Tudo é decidido AQUI no servidor, a cada request,
 * lendo o banco: tirar um membro corta o acesso na hora, não em 7 dias de JWT.
 *
 * Regra de ouro: NEGA POR PADRÃO. Uma rota do /api/admin só abre pra membro
 * se estiver na tabela ROTAS_MEMBRO abaixo, com método e caminho exatos.
 * Rota nova que ninguém lembrar de mapear fica só pros sócios — o erro seguro.
 * ══════════════════════════════════════════════════════════════════════════ */
const CREW_MODULOS = ["kanban", "clients", "propostas", "leads", "projetos"];
const membroAtivo = (email) =>
  db.collection("nomade_membros").findOne({ email: String(email || "").toLowerCase(), ativo: true });

// [métodos, caminho (relativo a /api/admin), módulos que liberam (qualquer um), módulos exigidos (todos)]
const COMUM = ["*"]; // qualquer membro logado (o que é dele mesmo: sininho, push)
const ROTAS_MEMBRO = [
  // o que é da própria pessoa — as rotas já filtram por req.user.email
  ["GET", /^\/notifications$/, COMUM],
  ["GET", /^\/empresa$/, COMUM], // idioma, nome e horário da empresa — o painel precisa pra montar a tela
  ["GET", /^\/notifications\/unread-count$/, COMUM],
  ["PATCH", /^\/notifications\/[^/]+\/read$/, COMUM],
  ["POST", /^\/notifications\/read-all$/, COMUM],
  ["DELETE", /^\/notifications\/[^/]+$/, COMUM],
  ["GET", /^\/push\/key$/, COMUM],
  ["POST", /^\/push\/(subscribe|unsubscribe|test)$/, COMUM],
  ["GET", /^\/time$/, COMUM], // quem é quem (nomes, cores, setores) — a interface monta avatar e menção com isso

  // lista de clientes: usada pelos seletores do kanban, propostas, leads e projetos
  ["GET", /^\/clients$/, ["kanban", "clients", "propostas", "leads", "projetos"]],

  // Kanban (apagar BOARD inteiro fica com os sócios)
  ["GET", /^\/kanban-templates$/, ["kanban"]],
  ["GET,POST", /^\/boards$/, ["kanban"]],
  ["GET,PATCH", /^\/boards\/[^/]+$/, ["kanban"]],
  ["POST", /^\/boards\/[^/]+\/template$/, ["kanban"]],
  ["GET", /^\/tasks$/, ["kanban", "clients"]],
  ["POST", /^\/tasks$/, ["kanban"]],
  ["POST", /^\/tasks\/reorder$/, ["kanban"]],
  ["PATCH,DELETE", /^\/tasks\/[^/]+$/, ["kanban"]],
  ["POST", /^\/tasks\/[^/]+\/(comments|attachments|archive|unarchive)$/, ["kanban"]],
  ["DELETE", /^\/tasks\/[^/]+\/(comments|attachments)\/[^/]+$/, ["kanban"]],
  ["GET", /^\/clients\/[^/]+\/board$/, ["kanban", "clients"]],

  // Clientes (apagar cliente leva board e tasks junto → só sócios)
  ["POST", /^\/clients$/, ["clients"]],
  ["PATCH", /^\/clients\/[^/]+$/, ["clients"]],
  ["GET", /^\/clients\/[^/]+\/hub$/, ["clients"]],
  ["GET", /^\/briefings\/[^/]+$/, ["clients"]],

  // Propostas — dono checado em checaDonoProposta; liberar a 2ª metade, gerar
  // mensalidade, apagar e mexer nos itens-padrão da casa ficam com os sócios
  ["POST", /^\/clients\/[^/]+\/nova-proposta$/, ["propostas"]],
  ["GET", /^\/propostas$/, ["propostas"]],
  ["POST", /^\/propostas\/(gerar|manual)$/, ["propostas"]],
  ["GET,PATCH", /^\/propostas\/[^/]+$/, ["propostas"]],
  ["POST", /^\/propostas\/[^/]+\/(gerar|publish|lost)$/, ["propostas"]],
  ["GET", /^\/itens-padrao$/, ["propostas"]],

  // Leads (apagar lead fica com os sócios)
  ["GET", /^\/leads$/, ["leads"]],
  ["PATCH", /^\/leads\/[^/]+$/, ["leads"]],
  ["POST", /^\/leads\/[^/]+\/(regenerate-quote|send-quote)$/, ["leads"]],
  ["POST", /^\/leads\/[^/]+\/promote-to-proposta$/, ["leads"], ["leads", "propostas"]],

  // Projetos do portfólio (apagar fica com os sócios)
  ["GET,POST", /^\/projetos$/, ["projetos"]],
  ["PATCH", /^\/projetos\/[^/]+$/, ["projetos"]],
  ["POST", /^\/projetos\/[^/]+\/capturar$/, ["projetos"]],
];

function membroPode(method, pathname, perms) {
  for (const [metodos, re, algum, todos] of ROTAS_MEMBRO) {
    if (!metodos.split(",").includes(method) || !re.test(pathname)) continue;
    if (algum !== COMUM && !algum.some((m) => perms.has(m))) return false;
    if (todos && !todos.every((m) => perms.has(m))) return false;
    return true;
  }
  return false; // não mapeada = só sócio
}

/* Propostas de membro "só as próprias": qualquer /propostas/<id> de outra
 * pessoa responde 404 (não 403 — nem confirma que existe). Id fora do formato
 * também é 404, pra não depender de como o driver interpreta string estranha. */
async function checaDonoProposta(req, res, next) {
  if (!req.crew || req.crew.socio || !req.crew.propostasSoProprias) return next();
  const m = req.path.match(/^\/propostas\/([^/]+)(\/|$)/);
  if (!m || m[1] === "gerar" || m[1] === "manual") return next();
  if (!/^[0-9a-f]{24}$/i.test(m[1])) return res.status(404).json({ error: "not_found" });
  const prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(m[1]) }, { projection: { createdBy: 1 } });
  if (!prop || String(prop.createdBy || "").toLowerCase() !== req.crew.email) return res.status(404).json({ error: "not_found" });
  next();
}

/* Porta do /api/admin. Sócio passa direto; membro passa pela tabela. */
async function requireCrew(req, res, next) {
  const email = (req.user?.email || "").toLowerCase();
  if (req.user?.role === "admin" && ADMIN_LIST.includes(email)) {
    req.crew = { socio: true, email };
    return next();
  }
  if (req.user?.role !== "membro") return res.status(403).json({ error: "not_admin" });
  try {
    const m = await membroAtivo(email);
    if (!m) return res.status(403).json({ error: "sem_acesso" });
    const perms = new Set((m.perms || []).filter((x) => CREW_MODULOS.includes(x)));
    req.crew = { socio: false, email, perms, propostasSoProprias: m.propostasSoProprias !== false };
    if (!membroPode(req.method, req.path, perms)) return res.status(403).json({ error: "sem_permissao" });
    return checaDonoProposta(req, res, next);
  } catch (e) {
    console.error("[crew] acesso:", e.message);
    return res.status(500).json({ error: "acesso_indisponivel" });
  }
}
const soSocio = (req, res, next) => (req.crew?.socio ? next() : res.status(403).json({ error: "so_socios" }));

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "not_admin" });
  // Revogação sem estado: a role está assinada no token, mas reconferimos contra
  // o ADMIN_LIST atual — quem sai do ADMIN_EMAILS perde acesso na hora, não em 7d.
  const email = (req.user?.email || "").toLowerCase();
  if (!ADMIN_LIST.includes(email)) return res.status(403).json({ error: "not_admin" });
  next();
}

/* ══════════════════════════════════════════════════════════════════════════
 * GOOGLE OAUTH (admin)
 *
 * O painel vive no PAINEL_URL, servido pelo ai-service (proxy /hq → cá).
 * O ADMIN_BASE_URL aponta o callback do Google pra esse domínio; o hqOnly
 * esconde painel e OAuth de quem chegar por fora do proxy (BASE_URL/admin → 404).
 * ══════════════════════════════════════════════════════════════════════════ */

// o callback do Google volta pro domínio do painel, pelo proxy /hq do ai-service
const ADMIN_BASE_URL = (process.env.ADMIN_BASE_URL || `${PAINEL_URL}/hq`).replace(/\/+$/, "");
const HQ_PROXY_SECRET = process.env.HQ_PROXY_SECRET || "";
const hqOnly = (req, res, next) => {
  if (!HQ_PROXY_SECRET || req.get("x-hq-key") === HQ_PROXY_SECRET) return next();
  return res.status(404).send("Not found");
};

/* ── LOGIN COM SENHA — pra quem roda em casa, sem Google Cloud ─────────────
   ADMIN_SENHA no .env (o instalar.sh pergunta). Uma senha pra todos os
   e-mails de ADMIN_EMAILS: é o modo "sócio único no próprio computador".
   Com GOOGLE_CLIENT_ID também configurado, o painel mostra os dois. */
app.get("/api/auth/modos", hqOnly, (req, res) => {
  res.json({ google: !!GOOGLE_CLIENT_ID, senha: !!process.env.ADMIN_SENHA });
});
app.post("/api/auth/senha", hqOnly, limitSenha, async (req, res) => {
  const senhaCfg = process.env.ADMIN_SENHA || "";
  if (!senhaCfg) return res.status(404).json({ error: "senha_desligada" });
  const email = String(req.body?.email || "").toLowerCase().trim();
  const a = Buffer.from(String(req.body?.senha || "")), b = Buffer.from(senhaCfg);
  const confere = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!confere || !ADMIN_LIST.includes(email)) return res.status(401).json({ error: "credenciais" });
  const now = new Date();
  await db.collection("users").updateOne(
    { email },
    { $set: { email, role: "admin", lastLogin: now }, $setOnInsert: { name: email.split("@")[0], createdAt: now } },
    { upsert: true },
  );
  const user = await db.collection("users").findOne({ email });
  res.json({ token: signJwt(user), email });
});

app.get("/api/auth/google", hqOnly, (req, res) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${ADMIN_BASE_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/api/auth/google/callback", hqOnly, async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.redirect(`/admin?error=no_code`);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${ADMIN_BASE_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no_access_token");

    const profRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profRes.json();
    const email = (profile.email || "").toLowerCase();
    if (!email) throw new Error("no_email");

    // Antes de decidir role: se a lista está vazia é falha de configuração, e
    // seguir daqui gravaria role:"client" POR CIMA de um admin de verdade.
    if (!ADMIN_LIST.length) {
      console.error("OAuth: ADMIN_EMAILS vazia — login recusado por configuração, não por permissão.");
      return res.redirect(`/admin?error=sem_admins`);
    }

    const membro = ADMIN_LIST.includes(email) ? null : await membroAtivo(email);
    const role = ADMIN_LIST.includes(email) ? "admin" : membro ? "membro" : "client";
    const now = new Date();
    if (membro) await db.collection("nomade_membros").updateOne({ _id: membro._id }, { $set: { ultimoLogin: now } });

    await db.collection("users").updateOne(
      { email },
      {
        $set: { email, name: profile.name, picture: profile.picture, role, lastLogin: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    const user = await db.collection("users").findOne({ email });

    if (user.role !== "admin" && user.role !== "membro") return res.redirect(`/admin?error=not_authorized`);
    const token = signJwt(user);
    // Token no FRAGMENT (#), não na query (?): o fragment nunca é enviado ao
    // servidor, então não entra nos access logs do Cloudflare/NPM nem no Referer.
    res.redirect(`/admin#token=${token}`);
  } catch (e) {
    console.error("OAuth error:", e);
    res.redirect(`/admin?error=auth_failed`);
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.sub) });
  if (!user) return res.status(404).json({ error: "not_found" });
  const email = (user.email || "").toLowerCase();
  const socio = req.user.role === "admin" && ADMIN_LIST.includes(email);
  let acesso = { socio: true, perms: CREW_MODULOS, propostasSoProprias: false };
  if (!socio) {
    const m = req.user.role === "membro" ? await membroAtivo(email) : null;
    if (!m) return res.status(403).json({ error: "sem_acesso" });
    acesso = { socio: false, perms: (m.perms || []).filter((x) => CREW_MODULOS.includes(x)), propostasSoProprias: m.propostasSoProprias !== false };
  }
  res.json({
    id: user._id, email: user.email, name: user.name, picture: user.picture, role: user.role, acesso,
  });
});
/* ══════════════════════════════════════════════════════════════════════════
 * LEADS PÚBLICOS (enterprise form)
 * ══════════════════════════════════════════════════════════════════════════ */

/* Grava um lead e dispara (em background) o orçamento e o aviso aos sócios.
   Dois chamadores: POST /api/leads (site/chat) e o formulário público /f/:slug. */
async function registrarLead(body = {}) {
  const { name, email, company, employees, msg, source = "enterprise", transcript, contact, vertical } = body;

  // Aceita 2 modos:
  //  - clássico (enterprise form): name + email obrigatórios
  //  - chat-driven: contact obrigatório (whatsapp ou email), name opcional
  const isChat = !!transcript && Array.isArray(transcript);
  if (isChat) {
    if (!contact || !contact.type || !contact.value) {
      return { status: 400, body: { error: "missing_contact" } };
    }
    if (!["whatsapp", "email"].includes(contact.type)) {
      return { status: 400, body: { error: "invalid_contact_type" } };
    }
  } else {
    if (!name || !email) return { status: 400, body: { error: "missing_fields" } };
  }

  const doc = {
    name: name || (contact?.type === "email" ? contact.value : null),
    email: email || (contact?.type === "email" ? contact.value : null),
    whatsapp: contact?.type === "whatsapp" ? contact.value : null,
    company: company || null,
    employees: employees || null,
    msg: msg || null,
    transcript: isChat ? transcript : null,
    contactType: contact?.type || (email ? "email" : null),
    contactValue: contact?.value || email || null,
    source,
    vertical: ["ai", "marketing", "sites"].includes(vertical) ? vertical : null,
    createdAt: new Date(),
    status: "new",
  };

  const { insertedId } = await db.collection("nomade_leads").insertOne(doc);

  // Em background: gera pré-orçamento via Gemini + notifica admin (não bloqueia resposta)
  setImmediate(async () => {
    // 1. Gera orçamento (se tem descrição)
    let quote = null;
    const description = msg || (transcript || []).filter(m => m.role === "user").map(m => m.text).join("\n\n");
    if (description && description.trim().length > 20 && process.env.ANTHROPIC_API_KEY) {
      try {
        quote = await generateLeadQuote({
          description,
          context: company ? `Empresa: ${company}${employees ? ` · ${employees}` : ""}` : "",
        });
        await db.collection("nomade_leads").updateOne(
          { _id: insertedId },
          { $set: { quote, quoteGeneratedAt: new Date(), quoteStatus: "draft" } }
        );
      } catch (e) {
        console.error(`[lead] quote gen failed for ${insertedId}:`, e.message);
        await db.collection("nomade_leads").updateOne(
          { _id: insertedId },
          { $set: { quoteError: e.message } }
        );
      }
    }

    // 2. Notifica admins (com orçamento já incluído)
    //    Lead fica em Leads — vira proposta só quando admin promover manualmente.
    if (ADMIN_LIST.length) {
      try {
        const { subject, html, text } = renderNewLeadEmail({
          lead: { ...doc, _id: insertedId, quote },
          adminUrl: PAINEL_URL,
        });
        for (const adminEmail of ADMIN_LIST) {
          try { await sendEmail({ to: adminEmail, subject, html, text }); }
          catch (e) { console.error(`[lead] notify ${adminEmail}:`, e.message); }
        }
      } catch (e) { console.error("[lead] notify failed:", e.message); }
    }
  });

  return { status: 200, body: { ok: true, leadId: insertedId } };
}

app.post("/api/leads", limitLeads, async (req, res) => {
  const r = await registrarLead(req.body);
  res.status(r.status).json(r.body);
});

/* ──────────────────────────────────────────────────────────────────
 * LEAD CHAT — Triagem adaptativa por AI (Gemini), vertical-aware
 *
 * Recebe `vertical` (ai | marketing | sites | null=hub) e ajusta:
 *   - Intro inicial
 *   - System prompt (checklist + caminho de perguntas)
 *   - Fallback sem Gemini
 * ──────────────────────────────────────────────────────────────── */

const MAX_USER_TURNS = 3;

/* Recepção do chat de leads. Genérica de propósito: o que a empresa faz vem
 * de EMPRESA_DESCRICAO. Quer um roteiro por linha de serviço? Acrescente uma
 * entrada aqui com a chave que o seu site manda em `vertical`. */
const VERTICAL_CONFIG = {
  hub: {
    name: EMPRESA.nome,
    intro: `Oi! Sou da recepção da ${EMPRESA.nome}. Pra te passar pra pessoa certa, conta rapidinho o que você precisa.`,
    checklist: `1. O que a pessoa precisa: o projeto ou o problema
2. Sobre o negócio: o que a empresa faz, mais ou menos o tamanho
3. Motivação agora: por que tá procurando, qual o gatilho ou urgência
4. Dimensão: prazo, escala ou faixa de orçamento, se a pessoa mencionar`,
    fallback: "Saquei. Conta um pouco mais — qual o contexto da empresa e o que te motivou a procurar agora?",
  },
};

function resolveVertical(v) {
  if (v && VERTICAL_CONFIG[v]) return v;
  return "hub";
}

app.post("/api/lead-chat", limitChat, async (req, res) => {
  const { step, userMessage, history = [], vertical } = req.body;
  if (typeof step !== "number") return res.status(400).json({ error: "invalid_step" });

  const verticalKey = resolveVertical(vertical);
  const config = VERTICAL_CONFIG[verticalKey];

  // Step 0: bootstrap — intro contextual, sem AI
  if (step === 0) {
    return res.json({ aiText: config.intro, nextStep: 1, done: false });
  }

  const userTurns = history.filter(m => m.role === "user").length;
  const forceClose = userTurns >= MAX_USER_TURNS;

  // Fallback sem Gemini
  if (!process.env.GEMINI_API_KEY) {
    if (forceClose) {
      return res.json({
        aiText: `Beleza, já tenho o suficiente pra alguém da ${EMPRESA.nome} te chamar. Agora me passa seu contato.`,
        nextStep: step,
        done: true,
      });
    }
    return res.json({
      aiText: config.fallback,
      nextStep: step + 1,
      done: false,
    });
  }

  const transcript = history
    .map(m => `${m.role === "ai" ? EMPRESA.nome : "Cliente"}: ${m.text}`)
    .join("\n");

  const verticalContext = verticalKey === "hub"
    ? `O cliente abriu o chat no site da ${EMPRESA.nome}.`
    : `O cliente abriu o chat na página de ${config.name}. Ele JÁ está interessado nessa frente: vá direto pra triagem dela.`;

  const prompt = `# PAPEL
Você é a recepção da ${EMPRESA.nome}.${EMPRESA.descricao ? ` O que a empresa faz: ${EMPRESA.descricao}` : ""}

Seu único trabalho aqui é fazer TRIAGEM — descobrir contexto suficiente pra um humano da equipe atender o lead da forma certa. Você NÃO vende, NÃO promete nada, NÃO menciona preço, NÃO inventa fato sobre a empresa.

# CONTEXTO IMPORTANTE
${verticalContext}

# CHECKLIST MENTAL (descobrir, não perguntar de uma vez)
${config.checklist}

# TOM (regra dura)
- PT-BR direto, profissional mas humano. Sem floreio, sem corporativês.
- PROIBIDO parafrasear o que o cliente disse. NUNCA escreva "Entendi que você precisa de...", "Compreendi que...", "Saquei que você quer X" — isso é robótico e o cliente já sabe o que falou.
- Em vez disso: vá DIRETO pra próxima pergunta natural, ou faça um comentário ÚTIL/concreto (curto) antes — referência específica a uma palavra do que ele disse, observação prática, NÃO resumo.
- Pergunte UMA coisa por vez. Sem listas. Sem opções A/B/C.
- Máximo 2 frases por resposta.

# CONVERSA ATÉ AGORA
${transcript}

# ÚLTIMA MENSAGEM DO CLIENTE
"${userMessage}"

# DECISÃO — TRIAGEM CURTA, MÁXIMO 3 TURNOS
O objetivo é fechar a conversa RÁPIDO. Cliente já demonstrou interesse vindo até aqui — não precisa de entrevista longa.

${forceClose
  ? `Você já fez ${userTurns} perguntas — JÁ DEU, FECHA AGORA. Em 1 frase curta e útil (sem parafrasear), diz que tem o suficiente e vai passar pra alguém da ${EMPRESA.nome}. Marque done=true.`
  : `Critério de fechamento RELAXADO: já feche quando tiver 2 dos 4 itens do checklist OU se o cliente deu uma resposta rica que cobre múltiplos pontos.
- Se tem contexto mínimo (2+ itens) → fecha. 1 frase curta + sinaliza que vai passar pra alguém. done=true.
- Se ainda não → próxima pergunta DIRETA cobrindo o item mais importante restante. done=false.

Lembrete: NUNCA faça mais de 3 perguntas no total. Cliente vai embora se cansar.`}

# FORMATO DE SAÍDA
Devolve APENAS um JSON, sem markdown, sem code fences:
{"aiText": "...", "done": true|false}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    clearTimeout(timeout);
    const data = await r.json();
    if (!r.ok) {
      console.error("[lead-chat] Gemini:", JSON.stringify(data));
      throw new Error("gemini_failed");
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { parsed = { aiText: text, done: forceClose }; }

    const aiText = parsed.aiText || "Conta mais um pouco do contexto.";
    const done = forceClose || !!parsed.done;

    res.json({
      aiText,
      nextStep: step + 1,
      done,
    });
  } catch (e) {
    console.error("[lead-chat] error:", e.message);
    res.json({
      aiText: forceClose
        ? "Beleza, já tenho o suficiente. Agora me passa seu contato pra um humano te chamar."
        : "Conta um pouco mais do contexto — qual a empresa e por que tá procurando agora?",
      nextStep: step + 1,
      done: forceClose,
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * MERCADO PAGO — helpers
 * ══════════════════════════════════════════════════════════════════════════ */

/* Token do Mercado Pago: o que foi colado em Integrações vence o .env. */
async function mpToken() {
  try {
    const d = await aiDb?.collection("office_integracoes").findOne({ id: "mercadopago" });
    if (d?.config?.token) return d.config.token;
  } catch { /* sem office db */ }
  return process.env.MP_ACCESS_TOKEN || "";
}

async function createMpPreapproval({ leadId, email, amount, months, label }) {
  const body = {
    reason: label,
    external_reference: leadId.toString(),
    payer_email: email,
    back_url: `${URL_PUBLICA}/pagamento/retorno?lead=${leadId}`,
    auto_recurring: {
      frequency: months,
      frequency_type: "months",
      transaction_amount: Number(amount.toFixed(2)),
      currency_id: formato.moeda(),
    },
    status: "pending",
  };
  const r = await fetch(`${MP_API}/preapproval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await mpToken()}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error("MP preapproval error:", data);
    throw new Error(data.message || "mp_preapproval_failed");
  }
  return data;
}

async function createMpPreference({ invoiceId, email, amount, label, cycle, excludeCard = false }) {
  const body = {
    items: [{
      id: invoiceId.toString(),
      title: label,
      description: `${EMPRESA.nome} · ciclo ${cycle}`,
      quantity: 1,
      unit_price: Number(amount.toFixed(2)),
      currency_id: formato.moeda(),
    }],
    // Propostas podem não ter email do cliente — MP aceita preference sem payer
    ...(email ? { payer: { email } } : {}),
    external_reference: invoiceId.toString(),
    back_urls: {
      success: `${URL_PUBLICA}/pagamento/retorno?invoice=${invoiceId}`,
      pending: `${URL_PUBLICA}/pagamento/retorno?invoice=${invoiceId}`,
      failure: `${URL_PUBLICA}/pagamento/retorno?invoice=${invoiceId}&failed=1`,
    },
    auto_return: "approved",
    notification_url: `${URL_PUBLICA}/api/mp-webhook-payment`,
    statement_descriptor: EMPRESA.descritorFatura,
    payment_methods: {
      installments: 12,           // cliente pode escolher até 12x
      default_installments: 1,    // default 1x
      ...(excludeCard && { excluded_payment_types: [{ id: "credit_card" }] }),
    },
  };
  const r = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await mpToken()}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error("MP preference error:", data);
    throw new Error(data.message || "mp_preference_failed");
  }
  return data;
}

/* ══════════════════════════════════════════════════════════════════════════
 * WEBHOOKS MP
 * ══════════════════════════════════════════════════════════════════════════ */

// Webhook de preapproval (cartão recorrente)
app.post("/api/mp-webhook", limitWebhook, async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const { type, data } = req.body;
    if (type !== "subscription_preapproval" && type !== "preapproval") return;
    const preapprovalId = data?.id;
    if (!preapprovalId) return;

    const r = await fetch(`${MP_API}/preapproval/${preapprovalId}`, {
      headers: { Authorization: `Bearer ${await mpToken()}` },
    });
    const pre = await r.json();
    if (!r.ok) return console.error("MP fetch preapproval failed:", pre);

    const refId = pre.external_reference;
    if (!refId) return;

    const paymentLink = await db.collection("nomade_payment_links").findOne({ _id: new ObjectId(refId) }).catch(() => null);
    if (!paymentLink) return;

    await db.collection("nomade_payment_links").updateOne(
      { _id: paymentLink._id },
      { $set: {
        mp_status: pre.status,
        mp_last_webhook_at: new Date(),
        ...(pre.status === "authorized" ? { status: "paid", paidAt: new Date() } : {}),
      }}
    );
    if (pre.status === "authorized" && paymentLink.status !== "paid") {
      await registerPaymentLinkPaid(paymentLink);
    }
  } catch (e) {
    console.error("mp-webhook error:", e);
  }
});

// Webhook de payment (pagamentos Pix/boleto avulsos)
app.post("/api/mp-webhook-payment", limitWebhook, async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const { type, data } = req.body;
    if (type !== "payment") return;
    const paymentId = data?.id;
    if (!paymentId) return;

    const r = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${await mpToken()}` },
    });
    const payment = await r.json();
    if (!r.ok) return console.error("MP fetch payment failed:", payment);

    const refId = payment.external_reference;
    if (!refId) return;

    const paymentLink = await db.collection("nomade_payment_links").findOne({ _id: new ObjectId(refId) }).catch(() => null);
    if (!paymentLink) return;

    const isPaid = payment.status === "approved";
    await db.collection("nomade_payment_links").updateOne(
      { _id: paymentLink._id },
      { $set: {
        mp_payment_id: paymentId,
        mp_payment_status: payment.status,
        mp_payment_method: payment.payment_method_id,
        mp_last_webhook_at: new Date(),
        ...(isPaid && paymentLink.status !== "paid" ? { status: "paid", paidAt: new Date() } : {}),
      }}
    );
    if (isPaid && paymentLink.status !== "paid") {
      await registerPaymentLinkPaid(paymentLink);
    }
    // Link veio de uma proposta → marca a proposta como paga.
    // Mensalidade seguinte (2ª, 3ª...) não mexe no paidAt da 1ª.
    if (isPaid && paymentLink.propostaId) {
      const now = new Date();
      await db.collection("nomade_propostas").updateOne(
        { _id: paymentLink.propostaId, status: { $ne: "lost" } },
        {
          $set: {
            status: "paid", updatedAt: now,
            ...(paymentLink.mensalidade > 1 ? { ultimaMensalidadePagaEm: now } : { paidAt: now }),
          },
          $push: { history: { at: now, by: "mp-webhook", action: "paid",
            note: paymentLink.mensalidade > 1 ? `${paymentLink.mensalidade}ª mensalidade` : paymentLink.setupPart || "" } },
        }
      ).catch((e) => console.error("[proposta] mark paid failed:", e.message));
    }
  } catch (e) {
    console.error("mp-webhook-payment error:", e);
  }
});

// Payment link pago → registra/atualiza o cliente pro admin e confirma por email.
// Sem painel do cliente: nenhuma conta de acesso é criada.
async function registerPaymentLinkPaid(link) {
  // Links de proposta podem não ter email (cliente só com WhatsApp) —
  // sem email não há como registrar cliente nem confirmar por email.
  if (!link.email) {
    console.log(`Payment-link pago sem email (proposta): ${link._id}`);
    return;
  }
  const now = new Date();
  const nextDueDate = new Date(now);
  nextDueDate.setMonth(nextDueDate.getMonth() + (link.pricing?.cycleMonths || 1));

  await db.collection("nomade_clients").updateOne(
    { email: link.email },
    {
      $set: {
        name: link.name,
        email: link.email,
        // Sync não-destrutivo: link de proposta vem sem agents/ciclo —
        // não sobrescrever o que o cliente já tem com vazio.
        ...(link.agents?.length ? { agents: link.agents } : {}),
        ...(link.pricing?.finalMonthly > 0 ? { cycle: link.cycle, pricing: link.pricing, nextDueDate } : {}),
        status: "active",
        paymentMethod: link.paymentMethod || "manual",
        payment_link_id: link._id,
        ...(link.mp_preapproval_id ? { mp_preapproval_id: link.mp_preapproval_id } : {}),
        source: link.propostaId ? "proposta" : "payment_link",
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  try {
    const { subject, html, text } = renderPaymentConfirmedEmail({
      name: link.name,
      amount: link.pricing?.chargeNow || 0,
      cycleLabel: link.cycle,
      nextDueDate: link.pricing?.cycleMonths ? nextDueDate : null,
    });
    await sendEmail({ to: link.email, subject, html, text });
    console.log(`Pagamento confirmado via payment-link: ${link.email}`);
  } catch (e) {
    console.error("[payment-link] confirmation email failed:", e.message);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * ADMIN ROUTES
 * ══════════════════════════════════════════════════════════════════════════ */

const admin = express.Router();
admin.use(requireAuth, requireCrew);

/* ─── Membros do crew (só sócios) ───
 * Sócios aparecem na lista mas não se editam aqui: quem é sócio é o
 * ADMIN_EMAILS do deploy, de propósito fora do alcance da interface. */
const limpaMembro = (m) => ({
  _id: m._id, email: m.email, nome: m.nome || "", perms: (m.perms || []).filter((x) => CREW_MODULOS.includes(x)),
  propostasSoProprias: m.propostasSoProprias !== false, ativo: m.ativo !== false,
  createdAt: m.createdAt, createdBy: m.createdBy || "", ultimoLogin: m.ultimoLogin || null,
});
function validaMembro(body = {}, parcial = false) {
  const out = {};
  if (!parcial || body.email !== undefined) {
    const email = String(body.email || "").toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "email_invalido" };
    if (ADMIN_LIST.includes(email)) return { error: "ja_e_socio" };
    out.email = email;
  }
  if (body.nome !== undefined) out.nome = String(body.nome).slice(0, 80).trim();
  if (body.perms !== undefined) {
    if (!Array.isArray(body.perms)) return { error: "perms_invalidas" };
    out.perms = [...new Set(body.perms.map(String))].filter((x) => CREW_MODULOS.includes(x));
  }
  if (body.propostasSoProprias !== undefined) out.propostasSoProprias = !!body.propostasSoProprias;
  if (body.ativo !== undefined) out.ativo = !!body.ativo;
  return { set: out };
}
// derruba as conexões de socket de quem perdeu o acesso (o HTTP já cai no próximo request)
const derrubaSockets = (email) => {
  for (const [, sock] of io.sockets.sockets) if (sock.user?.email?.toLowerCase() === email) sock.disconnect(true);
};

/* GET /api/admin/time — o time configurado (lib/time.js), sem nada além do que
 * a interface precisa pra desenhar avatar, menção e setor. */
admin.get("/time", (req, res) => {
  res.json({
    setores: SETORES,
    time: TEAM.map((m) => ({ id: m.id, name: m.name, emails: m.emails, color: m.color, initials: m.initials, sector: m.sector, unidade: m.unidade, socio: m.socio })),
  });
});

admin.get("/membros", soSocio, async (req, res) => {
  const lista = await db.collection("nomade_membros").find().sort({ createdAt: 1 }).toArray();
  res.json({
    modulos: CREW_MODULOS,
    socios: ADMIN_LIST.map((email) => ({ email, nome: memberByEmail(email)?.name || "" })),
    membros: lista.map(limpaMembro),
  });
});
admin.post("/membros", soSocio, async (req, res) => {
  const v = validaMembro(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const doc = {
    nome: "", perms: [], propostasSoProprias: true, ativo: true, ...v.set,
    createdAt: new Date(), createdBy: req.crew.email,
  };
  try {
    const r = await db.collection("nomade_membros").insertOne(doc);
    res.json(limpaMembro({ _id: r.insertedId, ...doc }));
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: "ja_existe" });
    throw e;
  }
});
admin.patch("/membros/:id", soSocio, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "not_found" });
  const v = validaMembro(req.body, true);
  if (v.error) return res.status(400).json({ error: v.error });
  const _id = new ObjectId(req.params.id);
  const antes = await db.collection("nomade_membros").findOne({ _id });
  if (!antes) return res.status(404).json({ error: "not_found" });
  try {
    await db.collection("nomade_membros").updateOne({ _id }, { $set: { ...v.set, updatedAt: new Date(), updatedBy: req.crew.email } });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: "ja_existe" });
    throw e;
  }
  // trocou o email ou desativou: quem estava logado com o acesso antigo sai agora
  if (v.set.ativo === false || (v.set.email && v.set.email !== antes.email)) derrubaSockets(antes.email);
  res.json(limpaMembro(await db.collection("nomade_membros").findOne({ _id })));
});
admin.delete("/membros/:id", soSocio, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "not_found" });
  const _id = new ObjectId(req.params.id);
  const m = await db.collection("nomade_membros").findOne({ _id });
  if (!m) return res.status(404).json({ error: "not_found" });
  await db.collection("nomade_membros").deleteOne({ _id });
  await db.collection("users").updateOne({ email: m.email, role: "membro" }, { $set: { role: "client" } });
  derrubaSockets(m.email);
  res.json({ ok: true });
});

/* GET /api/admin/overview — o painel de QUEM ESTÁ LOGADO.
 * Devolve em uma chamada: o dia da pessoa (tasks dela, relatório do setor),
 * o pulso do negócio e um feed do que aconteceu — pra bater o olho e saber
 * o que está rolando sem abrir aba nenhuma. */
admin.get("/overview", async (req, res) => {
  const me = memberByEmail(req.user.email);
  const now = new Date();
  const hojeFim = new Date(now); hojeFim.setHours(23, 59, 59, 999);
  const mesInicio = new Date(now.getFullYear(), now.getMonth(), 1);
  const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const T = db.collection("nomade_tasks");
  const P = db.collection("nomade_propostas");
  const L = db.collection("nomade_payment_links");
  const C = db.collection("nomade_clients");

  const [
    minhasTasks, tasksTimeAbertas,
    propostas, pagosMes, linksReceber,
    clientesAtivos, clientesNovos,
    propsRecentes, pagosRecentes, clientesRecentes, tasksFeitasRecentes,
    boards,
  ] = await Promise.all([
    // Minhas tasks abertas (assignee usa o id do time, ex.: "ana")
    me ? T.find({ assignee: me.id, archived: { $ne: true }, status: { $ne: "done" } })
          .project({ title: 1, status: 1, dueDate: 1, priority: 1, boardId: 1 })
          .sort({ dueDate: 1 }).limit(50).toArray()
       : Promise.resolve([]),
    T.countDocuments({ archived: { $ne: true }, status: { $ne: "done" } }),

    P.find({ status: { $ne: "lost" } }).project({ numero: 1, status: 1, total: 1, mode: 1, "cliente.nome": 1, opens: 1, updatedAt: 1, publishedAt: 1, acceptedAt: 1, paidAt: 1 }).toArray(),
    L.aggregate([
      { $match: { status: "paid", paidAt: { $gte: mesInicio } } },
      { $group: { _id: null, total: { $sum: "$pricing.chargeNow" }, n: { $sum: 1 } } },
    ]).toArray(),
    // "A receber" cru: filtrado depois contra as propostas ativas — link solto
    // (teste antigo, sem proposta ou de proposta perdida) não é dinheiro a receber.
    L.find({ status: { $in: ["open", "pending_delivery"] } })
      .project({ status: 1, "pricing.chargeNow": 1, propostaId: 1 }).toArray(),

    C.countDocuments({ status: { $ne: "cancelled" } }),
    C.countDocuments({ createdAt: { $gte: d30 } }),

    // Feed
    P.find({}).project({ numero: 1, status: 1, total: 1, "cliente.nome": 1, updatedAt: 1, lastOpenedAt: 1, acceptedAt: 1, paidAt: 1, publishedAt: 1 }).sort({ updatedAt: -1 }).limit(12).toArray(),
    L.find({ status: "paid" }).project({ name: 1, description: 1, pricing: 1, paidAt: 1 }).sort({ paidAt: -1 }).limit(6).toArray(),
    C.find({}).project({ name: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(5).toArray(),
    T.find({ status: "done", archived: { $ne: true } }).project({ title: 1, updatedAt: 1, assignee: 1 }).sort({ updatedAt: -1 }).limit(6).toArray(),
    db.collection("nomade_boards").find({}).project({ name: 1, clientId: 1 }).toArray(),
  ]);

  const boardName = new Map(boards.map(b => [String(b._id), b.name]));

  /* ─── Meu dia ─── */
  const atrasadas = minhasTasks.filter(t => t.dueDate && new Date(t.dueDate) < now);
  const paraHoje = minhasTasks.filter(t => t.dueDate && new Date(t.dueDate) >= now && new Date(t.dueDate) <= hojeFim);
  const decorate = (t) => ({ ...t, boardName: boardName.get(String(t.boardId)) || null });

  /* ─── Relatório semanal do meu setor ─── */
  let relatorio = null;
  try {
    const wk = getWeekStart(); wk.setHours(0, 0, 0, 0);
    const setor = me ? await getSectorForUser(req.user.email) : null;
    if (setor) {
      const r = await db.collection("nomade_sector_reports").findOne({ weekStart: wk, sector: setor });
      relatorio = { setor, enviado: !!r?.submittedAt, venceEm: fmtDueLabel(getReportDueDate(wk)) };
    }
  } catch { /* relatório é opcional no overview */ }

  /* ─── Pulso comercial ─── */
  // Só conta link de proposta que existe e não foi perdida (links soltos de
  // teste antigo entravam na soma e inflavam o número)
  const propostasVivas = new Set(propostas.map(p => String(p._id)));
  const linksValidos = linksReceber.filter(l => l.propostaId && propostasVivas.has(String(l.propostaId)));
  const abertos = linksValidos.filter(l => l.status === "open");
  const naEntrega = linksValidos.filter(l => l.status === "pending_delivery");

  const aguardando = propostas.filter(p => p.status === "published" && !p.acceptedAt);
  const valorEmJogo = aguardando.reduce((s, p) => s + (p.total || 0), 0);
  const aceitasNaoPagas = propostas.filter(p => p.acceptedAt && p.status !== "paid");

  /* ─── Feed: junta tudo e ordena por quando aconteceu ─── */
  const feed = [];
  for (const p of propsRecentes) {
    const nome = p.cliente?.nome || "cliente";
    if (p.paidAt) feed.push({ at: p.paidAt, tipo: "paga", texto: `Proposta #${p.numero} de ${nome} foi paga`, valor: p.total });
    else if (p.acceptedAt) feed.push({ at: p.acceptedAt, tipo: "aceita", texto: `${nome} aceitou a proposta #${p.numero}`, valor: p.total });
    else if (p.lastOpenedAt) feed.push({ at: p.lastOpenedAt, tipo: "aberta", texto: `${nome} abriu a proposta #${p.numero}` });
    else if (p.publishedAt) feed.push({ at: p.publishedAt, tipo: "enviada", texto: `Proposta #${p.numero} publicada pra ${nome}`, valor: p.total });
  }
  for (const l of pagosRecentes) if (l.paidAt) feed.push({ at: l.paidAt, tipo: "pagamento", texto: `Pagamento recebido — ${l.name || l.description || "cobrança"}`, valor: l.pricing?.chargeNow });
  for (const c of clientesRecentes) if (c.createdAt) feed.push({ at: c.createdAt, tipo: "cliente", texto: `${c.name} entrou como cliente` });
  for (const t of tasksFeitasRecentes) {
    const quem = memberById(t.assignee)?.name;
    feed.push({ at: t.updatedAt, tipo: "task", texto: `${quem ? quem + " concluiu" : "Concluída"}: ${t.title}` });
  }
  feed.sort((a, b) => new Date(b.at) - new Date(a.at));

  res.json({
    me: me ? { id: me.id, nome: me.name } : null,
    meuDia: {
      total: minhasTasks.length,
      atrasadas: atrasadas.slice(0, 6).map(decorate),
      paraHoje: paraHoje.slice(0, 6).map(decorate),
      semPrazo: minhasTasks.filter(t => !t.dueDate).length,
      relatorio,
    },
    pulso: {
      propostasAguardando: aguardando.length,
      valorEmJogo,
      aceitasNaoPagas: aceitasNaoPagas.length,
      recebidoMes: pagosMes[0]?.total || 0,
      recebidoMesN: pagosMes[0]?.n || 0,
      aReceber: abertos.reduce((s2, l) => s2 + (l.pricing?.chargeNow || 0), 0),
      aReceberN: abertos.length,
      aReceberEntrega: naEntrega.reduce((s2, l) => s2 + (l.pricing?.chargeNow || 0), 0),
      aReceberEntregaN: naEntrega.length,
      clientesAtivos,
      clientesNovos,
      tasksTimeAbertas,
      rascunhos: propostas.filter(p => p.status === "draft").length,
    },
    feed: feed.slice(0, 12),
  });
});

/* Clients */
admin.get("/clients", async (req, res) => {
  const list = await db.collection("nomade_clients").find().sort({ createdAt: -1 }).toArray();
  res.json(list);
});
// Campos aceitos no cadastro/edição. Email vazio NUNCA é gravado (o índice
// único parcial só vale quando o campo existe — senão o 2º cliente sem email
// batia em duplicate key).
function sanitizeClientBody(body = {}) {
  const email = String(body.email || "").toLowerCase().trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return { error: "email_invalid" };
  return {
    set: {
      ...(body.name !== undefined && { name: String(body.name).slice(0, 120).trim() }),
      ...(email && { email }),
      ...(body.contact !== undefined && { contact: String(body.contact).slice(0, 120).trim() }),
      ...(body.segment !== undefined && { segment: String(body.segment).slice(0, 80).trim() }),
      ...(body.plan !== undefined && { plan: String(body.plan).slice(0, 80).trim() }),
      ...(body.notes !== undefined && { notes: String(body.notes).slice(0, 4000) }),
      ...(Array.isArray(body.agents) && {
        agents: body.agents.map((a) => String(a).slice(0, 80).trim()).filter(Boolean).slice(0, 20),
      }),
      ...(["active", "paused", "cancelled"].includes(body.status) && { status: body.status }),
    },
    clearEmail: !email && body.email !== undefined,
  };
}

admin.post("/clients", async (req, res) => {
  const s = sanitizeClientBody(req.body);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!s.set.name) return res.status(400).json({ error: "name_required" });
  const doc = { ...s.set, status: s.set.status || "active", createdAt: new Date() };
  try {
    const r = await db.collection("nomade_clients").insertOne(doc);
    res.json({ _id: r.insertedId, ...doc });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: "email_duplicado", message: "Já existe cliente com esse email." });
    throw e;
  }
});
admin.patch("/clients/:id", async (req, res) => {
  const s = sanitizeClientBody(req.body);
  if (s.error) return res.status(400).json({ error: s.error });
  try {
    await db.collection("nomade_clients").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...s.set, updatedAt: new Date() }, ...(s.clearEmail ? { $unset: { email: "" } } : {}) }
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: "email_duplicado", message: "Já existe cliente com esse email." });
    throw e;
  }
});
admin.delete("/clients/:id", async (req, res) => {
  const _id = new ObjectId(req.params.id);
  // Cascade: sem isso o board do cliente e as tasks dele viravam dado órfão —
  // invisível na UI mas ainda somando nos contadores do Overview.
  const board = await db.collection("nomade_boards").findOne({ clientId: _id });
  if (board) {
    const taskIds = await db.collection("nomade_tasks")
      .find({ boardId: String(board._id) }).project({ _id: 1 }).toArray();
    await db.collection("nomade_tasks").deleteMany({ boardId: String(board._id) });
    await db.collection("nomade_notifications").deleteMany({
      taskId: { $in: taskIds.map(t => String(t._id)) },
    });
    await db.collection("nomade_boards").deleteOne({ _id: board._id });
  }
  await db.collection("nomade_clients").deleteOne({ _id });
  res.json({ ok: true });
});

/* ─── Projetos (portfólio público) ───
 * Cada projeto é um site/sistema de cliente que aparece na seção "Projetos"
 * da home e no "Trampos nossos" da vertical (campo `frente`). A capa é um
 * screenshot tirado pelo server (lib/screenshot.js) a partir da `url` —
 * ninguém sobe imagem. O binário mora em nomade_projetos_capas, separado,
 * pra lista do admin não carregar 300KB por linha. */
const PROJETO_FRENTES = ["ecommerce", "crm", "agents", "marketing", "apps", "site"];
function sanitizeProjetoBody(body = {}) {
  const url = body.url !== undefined ? String(body.url).trim() : undefined;
  if (url !== undefined && url && !/^https?:\/\/[^\s]+$/i.test(url)) return { error: "url_invalid" };
  let clientId;
  if (body.clientId !== undefined) {
    if (!body.clientId) clientId = null;
    else if (ObjectId.isValid(body.clientId)) clientId = new ObjectId(body.clientId);
    else return { error: "client_invalid" };
  }
  const cor = body.cor !== undefined ? String(body.cor).trim() : undefined;
  if (cor && !/^#[0-9a-f]{6}$/i.test(cor)) return { error: "cor_invalid" };
  return {
    set: {
      ...(body.nome !== undefined && { nome: String(body.nome).slice(0, 80).trim() }),
      ...(url !== undefined && { url }),
      ...(clientId !== undefined && { clientId }),
      ...(body.frente !== undefined && { frente: PROJETO_FRENTES.includes(body.frente) ? body.frente : "site" }),
      ...(body.resumo !== undefined && { resumo: String(body.resumo).slice(0, 160).trim() }),
      ...(body.resumoEn !== undefined && { resumoEn: String(body.resumoEn).slice(0, 160).trim() }),
      ...(cor !== undefined && { cor: cor || null }),
      ...(body.ordem !== undefined && { ordem: Number(body.ordem) || 0 }),
      ...(body.destaque !== undefined && { destaque: !!body.destaque }),
      ...(body.proprio !== undefined && { proprio: !!body.proprio }), // projeto da própria empresa, não de cliente
      ...(body.publicado !== undefined && { publicado: !!body.publicado }),
    },
  };
}

// Captura em background: a resposta do POST/PATCH não espera o Chromium.
// Resultado (ou erro) fica no próprio projeto: capaAt / capaErro.
const capturando = new Set();
async function capturarCapaProjeto(_id) {
  const id = String(_id);
  if (capturando.has(id)) return;
  capturando.add(id);
  try {
    const p = await db.collection("nomade_projetos").findOne({ _id });
    if (!p?.url) return;
    const shot = await capturarSite(p.url);
    // a versão celular é bônus: se falhar, fica só a desktop (o site usa ela nos dois)
    let mob = null;
    try { mob = await capturarSite(p.url, { mobile: true }); } catch (e) { console.error("[projetos] captura mobile falhou", id, e?.message); }
    await db.collection("nomade_projetos_capas").updateOne(
      { projetoId: _id },
      {
        $set: { projetoId: _id, data: shot.data, mime: shot.mime, w: shot.w, h: shot.h, capturedAt: new Date(),
          ...(mob && { dataMobile: mob.data, wm: mob.w, hm: mob.h }) },
        ...(mob ? {} : { $unset: { dataMobile: "", wm: "", hm: "" } }),
      },
      { upsert: true }
    );
    await db.collection("nomade_projetos").updateOne({ _id },
      { $set: { capaAt: new Date(), ...(mob && { capaMobileAt: new Date() }) }, $unset: { capaErro: "", ...(mob ? {} : { capaMobileAt: "" }) } });
  } catch (e) {
    const msg = e?.message === "chromium_ausente"
      ? "Chromium não está instalado neste servidor."
      : String(e?.message || e).slice(0, 200);
    console.error("[projetos] captura falhou", id, msg);
    await db.collection("nomade_projetos").updateOne({ _id }, { $set: { capaErro: msg } });
  } finally {
    capturando.delete(id);
  }
}

admin.get("/projetos", async (req, res) => {
  const list = await db.collection("nomade_projetos").find().sort({ ordem: 1, createdAt: -1 }).toArray();
  res.json(list.map((p) => ({ ...p, capturando: capturando.has(String(p._id)) })));
});
admin.post("/projetos", async (req, res) => {
  const s = sanitizeProjetoBody(req.body);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!s.set.nome) return res.status(400).json({ error: "nome_required" });
  if (!s.set.url) return res.status(400).json({ error: "url_required" });
  const total = await db.collection("nomade_projetos").countDocuments();
  const doc = {
    frente: "site", resumo: "", resumoEn: "", cor: null, destaque: false, proprio: false, publicado: false,
    ...s.set, ordem: s.set.ordem ?? total, createdAt: new Date(),
  };
  const r = await db.collection("nomade_projetos").insertOne(doc);
  capturarCapaProjeto(r.insertedId);
  res.json({ _id: r.insertedId, ...doc, capturando: true });
});
admin.patch("/projetos/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "not_found" });
  const s = sanitizeProjetoBody(req.body);
  if (s.error) return res.status(400).json({ error: s.error });
  const _id = new ObjectId(req.params.id);
  const antes = await db.collection("nomade_projetos").findOne({ _id });
  if (!antes) return res.status(404).json({ error: "not_found" });
  await db.collection("nomade_projetos").updateOne({ _id }, { $set: { ...s.set, updatedAt: new Date() } });
  // url mudou (ou nunca teve capa) → recaptura sozinho
  if ((s.set.url && s.set.url !== antes.url) || (!antes.capaAt && (s.set.url || antes.url))) capturarCapaProjeto(_id);
  res.json({ ok: true });
});
// Forçar nova captura (site do cliente mudou de cara)
admin.post("/projetos/:id/capturar", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "not_found" });
  const _id = new ObjectId(req.params.id);
  const p = await db.collection("nomade_projetos").findOne({ _id });
  if (!p) return res.status(404).json({ error: "not_found" });
  capturarCapaProjeto(_id);
  res.json({ ok: true, capturando: true });
});
admin.delete("/projetos/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "not_found" });
  const _id = new ObjectId(req.params.id);
  await db.collection("nomade_projetos_capas").deleteOne({ projetoId: _id });
  await db.collection("nomade_projetos").deleteOne({ _id });
  res.json({ ok: true });
});

/* GET /api/admin/clients/:id/hub — tudo que está linkado ao cliente (por email):
 * propostas + cobranças. Briefing/tasks/chat já têm endpoints próprios. */
admin.get("/clients/:id/hub", async (req, res) => {
  let client;
  try { client = await db.collection("nomade_clients").findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.status(400).json({ error: "invalid_id" }); }
  if (!client) return res.status(404).json({ error: "not_found" });

  const email = (client.email || "").toLowerCase().trim();
  // Link primário é o clienteId; email cobre propostas antigas e pagamentos avulsos
  const orProp = [{ clienteId: client._id }, ...(email ? [{ "cliente.email": email }] : [])];
  const orPay = [{ clienteId: client._id }, ...(email ? [{ email }] : [])];

  const baseUrl = URL_PUBLICA;
  const soProprias = req.crew && !req.crew.socio && req.crew.propostasSoProprias;
  if (soProprias) {
    // cobrança só aparece se for de uma proposta da própria pessoa
    const minhas = await db.collection("nomade_propostas")
      .find({ $or: orProp, createdBy: req.crew.email }).project({ _id: 1 }).toArray();
    orPay.splice(0, orPay.length, { propostaId: { $in: minhas.map((x) => x._id) } });
  }
  const [propostas, pagamentos] = await Promise.all([
    db.collection("nomade_propostas")
      .find(soProprias ? { $or: orProp, createdBy: req.crew.email } : { $or: orProp })
      .project({ numero: 1, token: 1, status: 1, mode: 1, total: 1, "conteudo.subtitle": 1, publishedAt: 1, acceptedAt: 1, paidAt: 1, createdAt: 1, opens: 1 })
      .sort({ createdAt: -1 }).limit(50).toArray(),
    db.collection("nomade_payment_links")
      .find({ $or: orPay })
      .project({ token: 1, description: 1, status: 1, pricing: 1, createdAt: 1, paidAt: 1, expiresAt: 1, setupPart: 1 })
      .sort({ createdAt: -1 }).limit(50).toArray(),
  ]);

  res.json({
    propostas: propostas.map((p) => ({ ...p, aberturas: p.opens?.length || 0, opens: undefined, url: `${baseUrl}/proposta/${p.token}` })),
    pagamentos: pagamentos.map((l) => ({ ...l, url: `${baseUrl}/pagar/${l.token}` })),
  });
});

/* POST /api/admin/clients/:id/nova-proposta — cria rascunho de proposta já
 * linkado ao cliente (sem IA — o time preenche o briefing na aba Propostas). */
admin.post("/clients/:id/nova-proposta", async (req, res) => {
  let client;
  try { client = await db.collection("nomade_clients").findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.status(400).json({ error: "invalid_id" }); }
  if (!client) return res.status(404).json({ error: "not_found" });

  const numero = await nextPropostaNumber();
  const now = new Date();
  const doc = {
    numero,
    token: randomToken(),
    status: "draft",
    mode: "unica",
    brief: "",
    contexto: [client.segment && `Segmento: ${client.segment}`, client.notes].filter(Boolean).join("\n").slice(0, 4000),
    cliente: {
      nome: client.name || "",
      email: (client.email || "").toLowerCase().trim(),
      whatsapp: client.contact || "",
    },
    conteudo: null,
    complexidade: null,
    itens: [],
    total: 0,
    operacaoMensal: { min: 0, max: 0 },
    mensalInfo: 0,
    prazo: "",
    observacoes: "",
    aviso: "",
    split: false,
    validadeDias: 15,
    validUntil: null,
    acceptedAt: null,
    paymentLinkId: null,
    paymentLinkToken: null,
    deliveryPaymentLinkId: null,
    opens: [],
    leadId: null,
    clienteId: client._id,
    history: [{ at: now, by: req.user.email, action: "created_from_client", note: client.name || "" }],
    createdBy: req.user.email,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await db.collection("nomade_propostas").insertOne(doc);
  res.json({ ok: true, propostaId: insertedId, numero });
});

/* Boards */
/* Templates de Kanban. A coluna "terminal" de todo template usa id "done" de
 * propósito: métricas (tasks abertas), o risco no card e o feed do Overview
 * dependem desse id — o nome exibido pode variar, o id não. */
const KANBAN_TEMPLATES = [
  {
    id: "padrao",
    name: "Padrão",
    description: "Fluxo simples de execução — serve pra qualquer coisa.",
    columns: [
      { id: "backlog",  name: "Backlog",      color: "#6b7280", position: 0 },
      { id: "todo",     name: "A fazer",      color: "#8b5cf6", position: 1 },
      { id: "doing",    name: "Em progresso", color: "#0077B6", position: 2 },
      { id: "review",   name: "Review",       color: "#c8a040", position: 3 },
      { id: "done",     name: "Feito",        color: "#00A896", position: 4 },
    ],
  },
  {
    id: "cliente",
    name: "Fluxo de Cliente",
    description: "Da prospecção ao suporte — o funil que usamos com cliente.",
    columns: [
      { id: "on-radar",       name: "On Radar",       color: "#64748b", position: 0 },
      { id: "away-radar",     name: "Away Radar",     color: "#94a3b8", position: 1 },
      { id: "understanding",  name: "Understanding",  color: "#8b5cf6", position: 2 },
      { id: "meeting",        name: "Meeting",        color: "#c8a040", position: 3 },
      { id: "sending-budget", name: "Sending Budget", color: "#d97706", position: 4 },
      { id: "after-payment",  name: "After Payment",  color: "#00A896", position: 5 },
      { id: "working",        name: "Working",        color: "#0077B6", position: 6 },
      { id: "done",           name: "Finals",         color: "#059669", position: 7 },
      { id: "support",        name: "Support",        color: "#06b6d4", position: 8 },
    ],
  },
  {
    id: "software",
    name: "Desenvolvimento de Software",
    description: "Do backlog ao deploy — specs, dev, review, QA.",
    columns: [
      { id: "backlog",     name: "Backlog",     color: "#6b7280", position: 0 },
      { id: "specs",       name: "Specs",       color: "#8b5cf6", position: 1 },
      { id: "todo",        name: "A fazer",     color: "#94a3b8", position: 2 },
      { id: "dev",         name: "Em dev",      color: "#0077B6", position: 3 },
      { id: "code-review", name: "Code Review", color: "#c8a040", position: 4 },
      { id: "qa",          name: "QA / Testes", color: "#d97706", position: 5 },
      { id: "deploy",      name: "Deploy",      color: "#06b6d4", position: 6 },
      { id: "done",        name: "Feito",       color: "#00A896", position: 7 },
    ],
  },
];
const templateById = (id) => KANBAN_TEMPLATES.find(t => t.id === id);
const templateColumns = (id) => (templateById(id) || KANBAN_TEMPLATES[0]).columns.map(c => ({ ...c }));
const DEFAULT_COLUMNS = () => templateColumns("padrao");

// Templates disponíveis (o client mostra preview das colunas)
admin.get("/kanban-templates", (req, res) => res.json(KANBAN_TEMPLATES));

// Lista SÓ os boards internos (sem cliente e fora a Área Dev, que tem aba própria).
admin.get("/boards", async (req, res) => {
  const list = await db.collection("nomade_boards")
    .find({ clientId: { $in: [null, undefined] } })
    .sort({ createdAt: -1 }).toArray();
  res.json(list);
});
admin.post("/boards", async (req, res) => {
  const { name, description, template } = req.body;
  const tpl = templateById(template) || templateById("padrao");
  const doc = {
    name: name || "Novo board",
    description: description || "",
    clientId: null,          // board interno
    template: tpl.id,
    columns: templateColumns(tpl.id),
    members: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const r = await db.collection("nomade_boards").insertOne(doc);
  res.json({ _id: r.insertedId, ...doc });
});

/* POST /boards/:id/template — troca o template de QUALQUER board, a qualquer
 * momento. Tasks em colunas que não existem no novo template vão pra primeira
 * coluna (não se perde nada); as demais ficam onde estão (mesmo id = mesma
 * coluna, ex.: "done"/"backlog" existem em vários templates). */
admin.post("/boards/:id/template", async (req, res) => {
  const tpl = templateById(req.body?.template);
  if (!tpl) return res.status(400).json({ error: "template_desconhecido" });
  const _id = new ObjectId(req.params.id);
  const board = await db.collection("nomade_boards").findOne({ _id });
  if (!board) return res.status(404).json({ error: "not_found" });

  const columns = templateColumns(tpl.id);
  const validIds = columns.map(c => c.id);
  await db.collection("nomade_boards").updateOne(
    { _id }, { $set: { columns, template: tpl.id, updatedAt: new Date() } }
  );

  // Órfãs vão pro FIM da primeira coluna, em ordem estável (position era
  // relativa à coluna de origem — reusar colidia e intercalava com as
  // existentes; mesma semântica do deleteColumn no client).
  const T = db.collection("nomade_tasks");
  const orphans = await T.find({ boardId: String(_id), status: { $nin: validIds } })
    .sort({ status: 1, position: 1 }).project({ _id: 1 }).toArray();
  if (orphans.length > 0) {
    const last = await T.find({ boardId: String(_id), status: validIds[0] })
      .sort({ position: -1 }).limit(1).project({ position: 1 }).toArray();
    const base = (last[0]?.position ?? -1) + 1;
    await T.bulkWrite(orphans.map((t, i) => ({
      updateOne: { filter: { _id: t._id }, update: { $set: { status: validIds[0], position: base + i } } },
    })));
    // board:updated só recarrega colunas no client; tasks:reordered força as tasks
    io.to(`board:${req.params.id}`).emit("tasks:reordered", { boardId: req.params.id });
  }
  io.to(`board:${req.params.id}`).emit("board:updated", { boardId: req.params.id });
  res.json({ ok: true, moved: orphans.length, board: { ...board, columns, template: tpl.id } });
});


// GET /api/admin/boards/:id — resolve QUALQUER board por id (inclusive de cliente).
// Necessário pra notificação de task abrir o board certo: /boards lista só internos.
admin.get("/boards/:id", async (req, res) => {
  const b = await db.collection("nomade_boards").findOne({ _id: new ObjectId(req.params.id) });
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json(b);
});

// GET /api/admin/clients/:id/board — o Kanban DAQUELE cliente (cria se não existe)
admin.get("/clients/:id/board", async (req, res) => {
  let client;
  try { client = await db.collection("nomade_clients").findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.status(400).json({ error: "invalid_id" }); }
  if (!client) return res.status(404).json({ error: "cliente_not_found" });

  let board = await db.collection("nomade_boards").findOne({ clientId: client._id });
  if (!board) {
    const doc = {
      name: client.name || "Cliente",
      description: "",
      clientId: client._id,
      template: "cliente",                  // board de cliente nasce com o funil de cliente
      columns: templateColumns("cliente"),
      members: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    try {
      const r = await db.collection("nomade_boards").insertOne(doc);
      board = { _id: r.insertedId, ...doc };
    } catch (e) {
      // Race: dois requests simultâneos passaram pelo findOne. O índice único
      // parcial em clientId barra o segundo insert — aí só relemos o vencedor.
      if (e.code !== 11000) throw e;
      board = await db.collection("nomade_boards").findOne({ clientId: client._id });
      if (!board) return res.status(500).json({ error: "board_race" });
    }
  }
  res.json(board);
});
admin.patch("/boards/:id", async (req, res) => {
  // Whitelist: kind/clientId/template definem identidade do board — mudar por
  // aqui quebraria os singletons (dev, um-board-por-cliente).
  const ALLOWED = ["name", "description", "columns", "members"];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => ALLOWED.includes(k)));
  patch.updatedAt = new Date();
  const _bid = new ObjectId(req.params.id);
  await db.collection("nomade_boards").updateOne({ _id: _bid }, { $set: patch });

  /* Colunas mudaram? Task cujo status aponta pra coluna que sumiu vira CARD
   * INVISÍVEL — existe no banco e não aparece em coluna nenhuma. Migra pra
   * primeira coluna, mesma regra da troca de template. */
  if (Array.isArray(patch.columns) && patch.columns.length) {
    const validas = new Set(patch.columns.map(c => c.id));
    const destino = [...patch.columns].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0].id;
    const r = await db.collection("nomade_tasks").updateMany(
      { boardId: String(_bid), status: { $nin: [...validas] } },
      { $set: { status: destino, updatedAt: new Date() } }
    );
    if (r.modifiedCount) io.to(`board:${req.params.id}`).emit("board:tasks-migrated", { boardId: req.params.id, count: r.modifiedCount });
  }
  io.to(`board:${req.params.id}`).emit("board:updated", { boardId: req.params.id });
  res.json({ ok: true });
});
admin.delete("/boards/:id", async (req, res) => {
  const _id = new ObjectId(req.params.id);
  const board = await db.collection("nomade_boards").findOne({ _id });
  // Board de cliente só cai junto com o cliente (cascade no DELETE /clients/:id)
  if (board?.clientId) {
    return res.status(400).json({ error: "board_protegido" });
  }
  await db.collection("nomade_boards").deleteOne({ _id });
  const taskIds = await db.collection("nomade_tasks")
    .find({ boardId: req.params.id }).project({ _id: 1 }).toArray();
  await db.collection("nomade_tasks").deleteMany({ boardId: req.params.id });
  await db.collection("nomade_notifications").deleteMany({
    taskId: { $in: taskIds.map(t => String(t._id)) },
  });
  io.emit("boards:changed");
  res.json({ ok: true });
});

/* Tasks */
admin.get("/tasks", async (req, res) => {
  const filter = {};
  if (req.query.boardId) filter.boardId = req.query.boardId;
  if (req.query.clientEmail) filter.clientEmail = String(req.query.clientEmail).toLowerCase().trim();
  if (req.query.archived === "true") filter.archived = true;
  else filter.archived = { $ne: true };
  const list = await db.collection("nomade_tasks").find(filter).sort({ position: 1, createdAt: -1 }).toArray();
  res.json(list);
});
admin.post("/tasks", async (req, res) => {
  const {
    boardId, title, description, status, assignee, priority,
    dueDate, labels, subtasks, checklist, createdBy, createdByName,
    clientEmail, visibleToClient, clientStatusLabel,
  } = req.body;
  const maxPos = await db.collection("nomade_tasks")
    .find({ boardId, status: status || "todo" })
    .sort({ position: -1 }).limit(1).toArray();
  const position = maxPos.length > 0 ? (maxPos[0].position || 0) + 1 : 0;
  const doc = {
    boardId: boardId || null,
    title, description: description || "",
    status: status || "todo", position,
    assignee: assignee || "",
    priority: priority || "medium",
    dueDate: dueDate ? new Date(dueDate) : null,
    labels: labels || [], subtasks: subtasks || [], checklist: checklist || [],
    attachments: [], comments: [], archived: false,
    createdBy: createdBy || "", createdByName: createdByName || "",
    clientEmail: (clientEmail || "").toLowerCase().trim() || null,
    visibleToClient: !!visibleToClient,
    clientStatusLabel: clientStatusLabel || null,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const r = await db.collection("nomade_tasks").insertOne(doc);
  const newDoc = { _id: r.insertedId, ...doc };
  if (boardId) io.to(`board:${boardId}`).emit("task:created", newDoc);
  res.json(newDoc);
});
admin.patch("/tasks/:id", async (req, res) => {
  const patch = { ...req.body, updatedAt: new Date() };
  if (patch.dueDate) patch.dueDate = new Date(patch.dueDate);
  if (patch.clientEmail !== undefined) {
    patch.clientEmail = (patch.clientEmail || "").toLowerCase().trim() || null;
  }
  const prevTask = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.id) });
  await db.collection("nomade_tasks").updateOne({ _id: new ObjectId(req.params.id) }, { $set: patch });
  const task = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.id) });
  if (task?.boardId) io.to(`board:${task.boardId}`).emit("task:updated", task);

  /* Task criada pelo orquestrador foi pra coluna final NA MÃO? O ciclo só
   * fecha se ele ficar sabendo — grava o recado na conversa que a criou
   * (mesmo mecanismo das decisões; o chat consome na próxima retomada). */
  if (aiDb && task?.conversaId && patch.status && prevTask && patch.status !== prevTask.status) {
    try {
      const board = await db.collection("nomade_boards").findOne({ _id: new ObjectId(String(task.boardId)) });
      const col = board?.columns?.find(c => c.id === patch.status);
      if (col && /done|final|conclu|feito/i.test(col.name || col.id || "")) {
        const abertas = await db.collection("nomade_tasks").countDocuments({
          conversaId: task.conversaId, archived: { $ne: true }, status: { $ne: patch.status },
        });
        await aiDb.collection("office_mensagens").insertOne({
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          conversaId: task.conversaId,
          autor: "sistema",
          texto: `Task "${task.title}" foi marcada como concluída no kanban pela equipe.` +
            (abertas > 0 ? ` — ainda faltam ${abertas} tarefa(s) desta conversa.` : " — era a última tarefa aberta desta conversa."),
          task: { id: String(task._id), titulo: task.title, estado: "feita" },
          consumida: false,
          ts: new Date(),
        });
        await aiDb.collection("office_conversas").updateOne({ id: task.conversaId }, { $set: { atualizada: new Date() } });
      }
    } catch (e) { console.error("aviso ao orquestrador:", e.message); }
  }

  if (patch.assignee && patch.assignee !== prevTask?.assignee) {
    const target = memberById(patch.assignee);
    if (target && target.email !== req.user.email) {
      await createNotifications([{
        type: "assigned", recipientEmail: target.email,
        actorName: req.user.email, actorEmail: req.user.email,
        title: `Nova task atribuída: ${task.title}`,
        body: "", taskId: req.params.id, boardId: task.boardId,
      }]);
    }
  }

  res.json({ ok: true });
});
admin.delete("/tasks/:id", async (req, res) => {
  const task = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.id) });
  await db.collection("nomade_tasks").deleteOne({ _id: new ObjectId(req.params.id) });
  // Cascade: notificação apontando pra task apagada vira clique morto no sino
  await db.collection("nomade_notifications").deleteMany({ taskId: req.params.id });
  if (task?.boardId) io.to(`board:${task.boardId}`).emit("task:deleted", { taskId: req.params.id });
  res.json({ ok: true });
});

/* Task comments */
admin.post("/tasks/:id/comments", async (req, res) => {
  const { text, author, authorName, parentId } = req.body;
  const comment = {
    id: new ObjectId().toString(),
    author: author || "", authorName: authorName || "Anônimo",
    text, parentId: parentId || null, createdAt: new Date(),
  };
  await db.collection("nomade_tasks").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $push: { comments: comment }, $set: { updatedAt: new Date() } }
  );
  const task = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.id) });
  if (task?.boardId) io.to(`board:${task.boardId}`).emit("task:updated", task);


  const mentionIds = extractMentions(text);
  const recipientEmails = new Set();
  if (parentId) {
    const parent = (task.comments || []).find(c => c.id === parentId);
    if (parent) {
      const parentAuthor = memberById(parent.author) || memberByName(parent.authorName);
      if (parentAuthor) recipientEmails.add(parentAuthor.email);
    }
  }
  if (mentionIds.length > 0) TEAM.forEach(m => recipientEmails.add(m.email));
  else if (!parentId) {
    if (task.assignee) {
      const a = memberById(task.assignee);
      if (a) recipientEmails.add(a.email);
    }
    const c = memberByName(task.createdByName) || memberById(task.createdBy);
    if (c) recipientEmails.add(c.email);
  }
  recipientEmails.delete(req.user.email);

  if (recipientEmails.size > 0) {
    const mentionedNames = mentionIds.map(id => memberById(id)?.name).filter(Boolean);
    const notifType = parentId ? "reply" : (mentionIds.length > 0 ? "mention" : "comment");
    const notifTitle = parentId
      ? `Resposta em "${task.title}"`
      : mentionIds.length > 0
        ? `Menção em "${task.title}"${mentionedNames.length > 0 ? ` (${mentionedNames.join(", ")})` : ""}`
        : `Novo comentário em "${task.title}"`;
    const notifs = Array.from(recipientEmails).map(email => ({
      type: notifType, recipientEmail: email,
      actorName: authorName || req.user.email, actorEmail: req.user.email,
      title: notifTitle, body: text.slice(0, 140),
      taskId: req.params.id, boardId: task.boardId,
    }));
    await createNotifications(notifs);
  }
  res.json(comment);
});
admin.delete("/tasks/:taskId/comments/:commentId", async (req, res) => {
  await db.collection("nomade_tasks").updateOne(
    { _id: new ObjectId(req.params.taskId) },
    {
      $pull: { comments: { $or: [{ id: req.params.commentId }, { parentId: req.params.commentId }] } },
      $set: { updatedAt: new Date() }
    }
  );
  const task = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.taskId) });
  if (task?.boardId) io.to(`board:${task.boardId}`).emit("task:updated", task);
  res.json({ ok: true });
});

/* Batch reorder */
admin.post("/tasks/reorder", async (req, res) => {
  const { updates } = req.body;
  if (!updates || !Array.isArray(updates)) return res.status(400).json({ error: "bad_body" });
  const ops = updates.map(u => ({
    updateOne: {
      filter: { _id: new ObjectId(u.id) },
      update: { $set: { status: u.status, position: u.position, updatedAt: new Date() } },
    },
  }));
  await db.collection("nomade_tasks").bulkWrite(ops);
  const firstTask = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(updates[0].id) });
  if (firstTask?.boardId) io.to(`board:${firstTask.boardId}`).emit("tasks:reordered", { boardId: firstTask.boardId });
  res.json({ ok: true });
});

/* Attachments */
admin.post("/tasks/:id/attachments", async (req, res) => {
  const { fileId, name, url, iconUrl, mimeType, thumbnailUrl } = req.body;
  if (!fileId || !name || !url) return res.status(400).json({ error: "missing_fields" });
  const attachment = {
    id: new ObjectId().toString(),
    fileId, name, url,
    iconUrl: iconUrl || "", mimeType: mimeType || "", thumbnailUrl: thumbnailUrl || "",
    addedBy: req.user.email, addedAt: new Date(),
  };
  await db.collection("nomade_tasks").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $push: { attachments: attachment }, $set: { updatedAt: new Date() } }
  );
  const task = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.id) });
  if (task?.boardId) io.to(`board:${task.boardId}`).emit("task:updated", task);

  res.json(attachment);
});
admin.delete("/tasks/:taskId/attachments/:attachmentId", async (req, res) => {
  await db.collection("nomade_tasks").updateOne(
    { _id: new ObjectId(req.params.taskId) },
    { $pull: { attachments: { id: req.params.attachmentId } }, $set: { updatedAt: new Date() } }
  );
  const task = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.taskId) });
  if (task?.boardId) io.to(`board:${task.boardId}`).emit("task:updated", task);
  res.json({ ok: true });
});

/* Archive */
admin.post("/tasks/:id/archive", async (req, res) => {
  await db.collection("nomade_tasks").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { archived: true, archivedAt: new Date(), updatedAt: new Date() } }
  );
  const task = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.id) });
  if (task?.boardId) io.to(`board:${task.boardId}`).emit("task:updated", task);

  res.json({ ok: true });
});
admin.post("/tasks/:id/unarchive", async (req, res) => {
  await db.collection("nomade_tasks").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { archived: false, updatedAt: new Date() }, $unset: { archivedAt: "" } }
  );
  const task = await db.collection("nomade_tasks").findOne({ _id: new ObjectId(req.params.id) });
  if (task?.boardId) io.to(`board:${task.boardId}`).emit("task:updated", task);

  res.json({ ok: true });
});

async function archiveOldDoneTasks() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await db.collection("nomade_tasks").updateMany(
      { status: "done", archived: { $ne: true }, updatedAt: { $lt: sevenDaysAgo } },
      { $set: { archived: true, archivedAt: new Date() } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[archive] ${result.modifiedCount} tasks arquivadas`);
      io.emit("boards:changed");
    }
  } catch (e) {
    console.error("[archive] erro:", e);
  }
}

/* Notifications (time interno) */
admin.get("/notifications", async (req, res) => {
  const list = await db.collection("nomade_notifications")
    .find({ recipientEmail: req.user.email })
    .sort({ createdAt: -1 }).limit(50).toArray();
  res.json(list);
});
admin.get("/notifications/unread-count", async (req, res) => {
  const count = await db.collection("nomade_notifications")
    .countDocuments({ recipientEmail: req.user.email, read: false });
  res.json({ count });
});
admin.patch("/notifications/:id/read", async (req, res) => {
  await db.collection("nomade_notifications").updateOne(
    { _id: new ObjectId(req.params.id), recipientEmail: req.user.email },
    { $set: { read: true } }
  );
  res.json({ ok: true });
});
admin.post("/notifications/read-all", async (req, res) => {
  await db.collection("nomade_notifications").updateMany(
    { recipientEmail: req.user.email, read: false },
    { $set: { read: true } }
  );
  res.json({ ok: true });
});
admin.delete("/notifications/:id", async (req, res) => {
  await db.collection("nomade_notifications").deleteOne({
    _id: new ObjectId(req.params.id), recipientEmail: req.user.email
  });
  res.json({ ok: true });
});

/* ─── Push (app instalado) ─────────────────────────────────────────────────
 * Uma assinatura por APARELHO, não por pessoa: quem usa notebook e celular
 * tem duas, e as duas devem tocar. A chave é o endpoint (o browser garante
 * que é único), então reenviar a mesma assinatura é upsert, nunca duplica. */

admin.get("/push/key", (_, res) => {
  res.json({ ativo: pushLigado, chave: pushLigado ? VAPID_PUBLIC_KEY : null });
});

const assinaturaValida = (s) =>
  s && typeof s.endpoint === "string" &&
  /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1024 &&
  s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";

admin.post("/push/subscribe", async (req, res) => {
  if (!pushLigado) return res.status(503).json({ error: "push desligado no servidor" });
  const sub = req.body?.subscription;
  if (!assinaturaValida(sub)) return res.status(400).json({ error: "assinatura inválida" });

  await db.collection("nomade_push_subs").updateOne(
    { endpoint: sub.endpoint },
    {
      $set: {
        email: req.user.email,
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        ua: String(req.headers["user-agent"] || "").slice(0, 200),
        vistoEm: new Date(),
      },
      $setOnInsert: { criadoEm: new Date() },
    },
    { upsert: true }
  );
  res.json({ ok: true });
});

admin.post("/push/unsubscribe", async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ error: "endpoint faltando" });
  // Casa o email junto: ninguém desliga o aparelho de outro sócio.
  await db.collection("nomade_push_subs").deleteOne({ endpoint, email: req.user.email });
  res.json({ ok: true });
});

/* Botão "testar" da UI — prova que a corrente inteira (VAPID → browser →
 * service worker) está de pé, sem depender de alguém te mencionar. */
admin.post("/push/test", async (req, res) => {
  if (!pushLigado) return res.status(503).json({ error: "push desligado no servidor" });
  const subs = await db.collection("nomade_push_subs").find({ email: req.user.email }).toArray();
  if (!subs.length) return res.status(400).json({ error: "nenhum aparelho assinado" });
  await enviarPush({
    _id: "teste",
    recipientEmail: req.user.email,
    title: PRODUTO,
    body: "Push funcionando — é assim que os avisos vão chegar.",
    taskId: null, boardId: null,
    createdAt: new Date(),
  });
  res.json({ ok: true, aparelhos: subs.length });
});

/* Daily summary */
admin.get("/daily-summary", async (req, res) => {
  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const me = TEAM.find(m => m.email === req.user.email);
  const myId = me?.id;
  const [closedYesterday, openToday, overdue, myOpen, mentionedToday] = await Promise.all([
    db.collection("nomade_tasks").countDocuments({
      status: "done", archived: { $ne: true },
      updatedAt: { $gte: startOfYesterday, $lt: startOfToday },
    }),
    db.collection("nomade_tasks").countDocuments({ status: { $ne: "done" }, archived: { $ne: true } }),
    db.collection("nomade_tasks").countDocuments({
      status: { $ne: "done" }, archived: { $ne: true },
      dueDate: { $lt: startOfToday, $ne: null },
    }),
    myId ? db.collection("nomade_tasks").countDocuments({
      assignee: myId, status: { $ne: "done" }, archived: { $ne: true }
    }) : 0,
    db.collection("nomade_notifications").countDocuments({
      recipientEmail: req.user.email, createdAt: { $gte: startOfYesterday },
    }),
  ]);
  res.json({ closedYesterday, openToday, overdue, myOpen, mentionedToday, me: me ? me.name : null });
});

/* ─── BRIEFING TEMPLATES (admin pode salvar/reusar) ─── */
admin.get("/briefing-templates", async (req, res) => {
  const list = await db.collection("nomade_briefing_templates").find().sort({ updatedAt: -1 }).toArray();
  res.json(list);
});

admin.post("/briefing-templates", async (req, res) => {
  const { name, description, questions } = req.body;
  if (!name || !Array.isArray(questions)) return res.status(400).json({ error: "name_questions_required" });
  const now = new Date();
  const { insertedId } = await db.collection("nomade_briefing_templates").insertOne({
    name: name.trim(),
    description: (description || "").trim(),
    questions: questions.map(normalizeQuestion),
    createdBy: req.user.email,
    createdAt: now,
    updatedAt: now,
  });
  res.json({ ok: true, id: insertedId });
});

admin.patch("/briefing-templates/:id", async (req, res) => {
  try {
    const { name, description, questions } = req.body;
    const $set = { updatedAt: new Date() };
    if (name !== undefined) $set.name = String(name).trim();
    if (description !== undefined) $set.description = String(description).trim();
    if (Array.isArray(questions)) $set.questions = questions.map(normalizeQuestion);
    await db.collection("nomade_briefing_templates").updateOne({ _id: new ObjectId(req.params.id) }, { $set });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "invalid_id_or_body" });
  }
});

admin.delete("/briefing-templates/:id", async (req, res) => {
  try {
    await db.collection("nomade_briefing_templates").deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "invalid_id" });
  }
});

function normalizeQuestion(q) {
  return {
    id: q.id || ("q_" + Math.random().toString(36).slice(2, 10)),
    type: ["text","textarea","select","multiselect","number","url","email"].includes(q.type) ? q.type : "text",
    label: String(q.label || "").trim(),
    placeholder: String(q.placeholder || "").trim(),
    helper: String(q.helper || "").trim(),
    options: Array.isArray(q.options) ? q.options.map(o => String(o)) : [],
    required: !!q.required,
    order: Number.isFinite(q.order) ? q.order : 0,
  };
}

/* ─── BRIEFINGS POR CLIENTE (admin envia + revisa respostas) ─── */
admin.get("/briefings/:clientEmail", async (req, res) => {
  const clientEmail = String(req.params.clientEmail || "").toLowerCase().trim();
  if (!clientEmail) return res.status(400).json({ error: "missing_client" });
  const client = await db.collection("nomade_clients").findOne({ email: clientEmail });
  if (!client) return res.status(404).json({ error: "client_not_found" });
  const briefing = await db.collection("nomade_briefings").findOne({ clientEmail });
  res.json({
    client: { name: client.name, email: client.email, agents: client.agents || [] },
    briefing: briefing || null,
  });
});

// POST /api/admin/briefings/:clientEmail — cria/redefine perguntas (status: pending)
admin.post("/briefings/:clientEmail", async (req, res) => {
  const clientEmail = String(req.params.clientEmail || "").toLowerCase().trim();
  const { questions, templateId } = req.body;
  if (!Array.isArray(questions)) return res.status(400).json({ error: "questions_required" });
  const client = await db.collection("nomade_clients").findOne({ email: clientEmail });
  if (!client) return res.status(404).json({ error: "client_not_found" });

  const now = new Date();
  const normalized = questions.map(normalizeQuestion);

  await db.collection("nomade_briefings").updateOne(
    { clientEmail },
    {
      $set: {
        clientEmail,
        clientName: client.name,
        questions: normalized,
        status: "pending",
        sentAt: now,
        templateId: templateId || null,
        sentBy: req.user.email,
      },
      $setOnInsert: { answers: {}, createdAt: now },
    },
    { upsert: true }
  );
  res.json({ ok: true, count: normalized.length });
});

// PATCH /api/admin/briefings/:clientEmail/approve — admin marca como aprovado
admin.post("/briefings/:clientEmail/approve", async (req, res) => {
  const clientEmail = String(req.params.clientEmail || "").toLowerCase().trim();
  await db.collection("nomade_briefings").updateOne(
    { clientEmail },
    { $set: { status: "approved", approvedAt: new Date(), approvedBy: req.user.email } }
  );
  res.json({ ok: true });
});

// DELETE /api/admin/briefings/:clientEmail — limpa briefing (volta pro estado "awaiting")
admin.delete("/briefings/:clientEmail", async (req, res) => {
  const clientEmail = String(req.params.clientEmail || "").toLowerCase().trim();
  await db.collection("nomade_briefings").deleteOne({ clientEmail });
  res.json({ ok: true });
});

// GET /api/admin/briefings — lista todos (pra dashboard de briefings)
admin.get("/briefings", async (req, res) => {
  const list = await db.collection("nomade_briefings").find().sort({ sentAt: -1 }).toArray();
  res.json(list);
});

/* Messages — chat admin↔cliente */
admin.get("/threads", async (req, res) => {
  const pipeline = [
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$clientEmail",
        clientName: { $first: "$clientName" },
        lastMessage: { $first: "$$ROOT" },
        total: { $sum: 1 },
        unread: {
          $sum: { $cond: [{ $and: [{ $eq: ["$from", "client"] }, { $eq: ["$readAt", null] }] }, 1, 0] },
        },
      },
    },
    { $sort: { "lastMessage.createdAt": -1 } },
    { $limit: 200 },
  ];
  const threads = await db.collection("nomade_messages").aggregate(pipeline).toArray();
  res.json({
    threads: threads.map(t => ({
      clientEmail: t._id,
      clientName: t.clientName,
      lastBody: t.lastMessage.body,
      lastFrom: t.lastMessage.from,
      lastAt: t.lastMessage.createdAt,
      total: t.total,
      unread: t.unread,
    })),
  });
});

admin.get("/messages", async (req, res) => {
  const clientEmail = (req.query.clientEmail || "").toLowerCase().trim();
  if (!clientEmail) return res.status(400).json({ error: "missing_client" });
  const list = await db.collection("nomade_messages")
    .find({ clientEmail })
    .sort({ createdAt: 1 })
    .limit(500)
    .toArray();
  res.json({
    messages: list.map(m => ({
      id: m._id,
      from: m.from,
      authorName: m.authorName || (m.from === "admin" ? EMPRESA.nome : m.clientName),
      body: m.body,
      createdAt: m.createdAt,
      readAt: m.readAt || null,
    })),
  });
});

admin.post("/messages", async (req, res) => {
  const clientEmail = String(req.body?.clientEmail || "").toLowerCase().trim();
  const body = String(req.body?.body || "").trim();
  if (!clientEmail) return res.status(400).json({ error: "missing_client" });
  if (!body) return res.status(400).json({ error: "empty" });
  if (body.length > 4000) return res.status(400).json({ error: "too_long" });

  const client = await db.collection("nomade_clients").findOne({ email: clientEmail });
  if (!client) return res.status(404).json({ error: "client_not_found" });

  const now = new Date();
  const doc = {
    clientEmail,
    clientName: client.name,
    from: "admin",
    authorEmail: req.user?.email || "",
    authorName: req.user?.name || EMPRESA.nome,
    body,
    createdAt: now,
    readAt: null,
  };
  const r = await db.collection("nomade_messages").insertOne(doc);
  res.json({ id: r.insertedId, ...doc });
});

admin.post("/messages/read", async (req, res) => {
  const clientEmail = String(req.body?.clientEmail || req.query?.clientEmail || "").toLowerCase().trim();
  if (!clientEmail) return res.status(400).json({ error: "missing_client" });
  const now = new Date();
  await db.collection("nomade_messages").updateMany(
    { clientEmail, from: "client", readAt: null },
    { $set: { readAt: now } }
  );
  res.json({ ok: true });
});

/* Agents */
admin.get("/agents", async (req, res) => {
  const list = await db.collection("nomade_agents").find().sort({ name: 1 }).toArray();
  res.json(list);
});
admin.post("/agents", async (req, res) => {
  const doc = { ...req.body, config: req.body.config || {}, status: "offline", lastRun: null, createdAt: new Date() };
  const r = await db.collection("nomade_agents").insertOne(doc);
  res.json({ _id: r.insertedId, ...doc });
});
admin.patch("/agents/:id", async (req, res) => {
  await db.collection("nomade_agents").updateOne(
    { _id: new ObjectId(req.params.id) }, { $set: req.body });
  res.json({ ok: true });
});
admin.delete("/agents/:id", async (req, res) => {
  await db.collection("nomade_agents").deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ ok: true });
});
admin.post("/agents/:id/heartbeat", async (req, res) => {
  const { status = "online", lastRunResult } = req.body;
  await db.collection("nomade_agents").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status, lastRun: new Date(), lastRunResult } });
  res.json({ ok: true });
});

/* Leads */
admin.get("/leads", async (req, res) => {
  const list = await db.collection("nomade_leads").find().sort({ createdAt: -1 }).toArray();
  res.json(list);
});

// PATCH /api/admin/leads/:id — atualiza status / quote / notes
admin.patch("/leads/:id", async (req, res) => {
  try {
    const id = new ObjectId(req.params.id);
    const allowed = ["status", "quote", "notes"];
    const $set = {};
    for (const k of allowed) if (req.body[k] !== undefined) $set[k] = req.body[k];
    $set.updatedAt = new Date();
    await db.collection("nomade_leads").updateOne({ _id: id }, { $set });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "invalid_id_or_body" });
  }
});

// POST /api/admin/leads/:id/regenerate-quote — re-roda o agent
admin.post("/leads/:id/regenerate-quote", async (req, res) => {
  try {
    const id = new ObjectId(req.params.id);
    const lead = await db.collection("nomade_leads").findOne({ _id: id });
    if (!lead) return res.status(404).json({ error: "lead_not_found" });

    const description = lead.msg
      || (lead.transcript || []).filter(m => m.role === "user").map(m => m.text).join("\n\n");
    if (!description || description.trim().length < 20) {
      return res.status(400).json({ error: "no_description" });
    }
    const quote = await generateLeadQuote({
      description,
      context: lead.company ? `Empresa: ${lead.company}${lead.employees ? ` · ${lead.employees}` : ""}` : "",
    });
    await db.collection("nomade_leads").updateOne(
      { _id: id },
      { $set: { quote, quoteGeneratedAt: new Date(), quoteStatus: "draft", updatedAt: new Date() } }
    );
    res.json({ ok: true, quote });
  } catch (e) {
    console.error("[lead regenerate]:", e.message);
    res.status(500).json({ error: "regenerate_failed", message: e.message });
  }
});

// POST /api/admin/leads/:id/send-quote — envia orçamento pro lead via email
admin.post("/leads/:id/send-quote", async (req, res) => {
  try {
    const id = new ObjectId(req.params.id);
    const lead = await db.collection("nomade_leads").findOne({ _id: id });
    if (!lead) return res.status(404).json({ error: "lead_not_found" });
    if (!lead.quote) return res.status(400).json({ error: "no_quote" });

    // Determina destinatário
    const toEmail = lead.email || (lead.contactType === "email" ? lead.contactValue : null);
    if (!toEmail) {
      return res.status(400).json({ error: "no_email", message: "Lead sem email — só tem WhatsApp. Envia manual." });
    }

    const { subject, html, text } = renderLeadQuoteEmail({
      lead,
      quote: lead.quote,
      siteUrl: URL_PUBLICA,
    });
    await sendEmail({ to: toEmail, subject, html, text });

    await db.collection("nomade_leads").updateOne(
      { _id: id },
      { $set: {
        quoteStatus: "sent",
        quoteSentAt: new Date(),
        quoteSentTo: toEmail,
        status: lead.status === "new" ? "contacted" : lead.status,
        updatedAt: new Date(),
      }}
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[lead send-quote]:", e);
    res.status(500).json({ error: "send_failed", message: e.message });
  }
});

// DELETE /api/admin/leads/:id
admin.delete("/leads/:id", async (req, res) => {
  try {
    await db.collection("nomade_leads").deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "invalid_id" });
  }
});

// POST /api/admin/leads/:id/promote-to-proposta — converte lead em rascunho de proposta.
// Sem chamada de IA aqui (seria lento): cria o draft com o briefing do lead e o
// time gera/edita na aba Propostas.
admin.post("/leads/:id/promote-to-proposta", async (req, res) => {
  try {
    const lead = await db.collection("nomade_leads").findOne({ _id: new ObjectId(req.params.id) });
    if (!lead) return res.status(404).json({ error: "not_found" });
    if (lead.propostaId || lead.dealId) {
      return res.status(400).json({ error: "already_promoted", message: "Esse lead já virou proposta." });
    }

    // Briefing: mensagem explícita OU fala do usuário no transcript do chat
    let brief = lead.msg || "";
    if (!brief && Array.isArray(lead.transcript)) {
      brief = lead.transcript.filter(m => m.role === "user").map(m => m.text).join("\n\n");
    }

    const numero = await nextPropostaNumber();
    const now = new Date();
    const doc = {
      numero,
      token: randomToken(),
      status: "draft",
      mode: "unica",
      brief: brief.slice(0, 8000),
      contexto: "",
      cliente: {
        nome: (lead.name || lead.email || lead.contactValue || "Sem nome").split("@")[0].slice(0, 80),
        email: lead.email || (lead.contactType === "email" ? lead.contactValue : "") || "",
        whatsapp: lead.whatsapp || (lead.contactType === "whatsapp" ? lead.contactValue : "") || "",
      },
      conteudo: null, // gerado depois na aba Propostas
      complexidade: null,
      itens: [],
      total: 0,
      operacaoMensal: { min: 0, max: 0 },
      mensalInfo: 0,
      prazo: "",
      observacoes: "",
      aviso: "",
      split: false,
      validadeDias: 15,
      validUntil: null,
      paymentLinkId: null,
      paymentLinkToken: null,
      deliveryPaymentLinkId: null,
      opens: [],
      leadId: lead._id,
      history: [{ at: now, by: req.user.email, action: "created_from_lead", note: lead.source || "" }],
      createdBy: req.user.email,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db.collection("nomade_propostas").insertOne(doc);

    await db.collection("nomade_leads").updateOne(
      { _id: lead._id },
      { $set: { propostaId: insertedId, propostaNumero: numero, status: "converted" } }
    );
    res.json({ ok: true, propostaId: insertedId, numero });
  } catch (e) {
    res.status(400).json({ error: "promote_failed", message: e.message });
  }
});

// POST /api/admin/leads/bulk-delete — body: { ids: [...] }
admin.post("/leads/bulk-delete", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids_required" });
  }
  try {
    const objectIds = ids.map(id => new ObjectId(id));
    const r = await db.collection("nomade_leads").deleteMany({ _id: { $in: objectIds } });
    res.json({ ok: true, deleted: r.deletedCount });
  } catch (e) {
    res.status(400).json({ error: "bulk_delete_failed", message: e.message });
  }
});

/* ──────────────────────────────────────────────────────────────────
 * WEEKLY REPORTS (relatórios semanais por setor)
 * ──────────────────────────────────────────────────────────────── */

const SECTORS_SERVER = SETORES.map((x) => x.id);

// ISO week start (Monday 00:00 local). Aceita Date ou ISO string.
function getWeekStart(d = new Date()) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // shift pra segunda
  date.setDate(date.getDate() + diff);
  return date;
}
function getPreviousWeekStart(d = new Date()) {
  const ws = getWeekStart(d);
  ws.setDate(ws.getDate() - 7);
  return ws;
}
// Vencimento = próxima segunda 9h (quando o cron consolida a semana que acabou)
function getReportDueDate(weekStart) {
  const due = new Date(weekStart);
  due.setDate(due.getDate() + 7);
  due.setHours(9, 0, 0, 0);
  return due;
}
function fmtWeekLabel(weekStart) {
  const ws = new Date(weekStart);
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const f = (d) => formato.data(d, { day: "2-digit", month: "short" }, "pt");
  return `${f(ws)} – ${f(we)}`;
}
function fmtDueLabel(d) {
  const date = new Date(d);
  return formato.data(date, { weekday: "long", day: "2-digit", month: "short" }, "pt");
}

// Resolve setor do membro (override no DB > default do TEAM)
async function getSectorForUser(email) {
  const m = memberByEmail(email);
  if (!m) return SECTORS_SERVER[0];
  const override = await db.collection("nomade_team_settings").findOne({ email: email.toLowerCase() });
  return override?.sector || m.sector || SECTORS_SERVER[0];
}

// GET /api/admin/team/sectors — lista TEAM com setores (overrides aplicados)
admin.get("/team/sectors", async (req, res) => {
  const overrides = await db.collection("nomade_team_settings").find().toArray();
  const overrideByEmail = Object.fromEntries(overrides.map(o => [o.email.toLowerCase(), o.sector]));
  const team = TEAM.map(m => ({
    id: m.id,
    name: m.name,
    emails: m.emails,
    primaryEmail: m.emails[0],
    sector: overrideByEmail[m.emails[0].toLowerCase()] || m.sector,
  }));
  res.json({ team, sectors: SECTORS_SERVER });
});

// PATCH /api/admin/team/sectors/:id — atualiza setor de um membro
admin.patch("/team/sectors/:id", async (req, res) => {
  const member = TEAM.find(m => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: "member_not_found" });
  const { sector } = req.body;
  if (!SECTORS_SERVER.includes(sector)) return res.status(400).json({ error: "sector_invalid" });
  await db.collection("nomade_team_settings").updateOne(
    { email: member.emails[0].toLowerCase() },
    { $set: { email: member.emails[0].toLowerCase(), memberId: member.id, sector, updatedAt: new Date() } },
    { upsert: true }
  );
  res.json({ ok: true, id: member.id, sector });
});

// Helper: lista membros por setor (overrides aplicados)
async function listSectorMembers(sector) {
  const overrides = await db.collection("nomade_team_settings").find().toArray();
  const overrideByEmail = Object.fromEntries(overrides.map(o => [o.email.toLowerCase(), o.sector]));
  return TEAM
    .map(m => ({ id: m.id, name: m.name, email: m.emails[0], emails: m.emails, sector: overrideByEmail[m.emails[0].toLowerCase()] || m.sector }))
    .filter(m => m.sector === sector);
}

// Helper: tasks da semana pra um setor
// Critério: assignee é membro do setor + (status=done && updated na semana) OU (updated na semana)
async function getSectorTasksForWeek(sector, weekStart) {
  const members = await listSectorMembers(sector);
  const memberIds = members.map(m => m.id);
  if (!memberIds.length) return [];

  const ws = new Date(weekStart);
  const we = new Date(ws); we.setDate(we.getDate() + 7);

  const tasks = await db.collection("nomade_tasks").find({
    $or: [
      { assignee: { $in: memberIds } },
      { createdBy: { $in: memberIds } },
    ],
    updatedAt: { $gte: ws, $lt: we },
  }).sort({ status: 1, updatedAt: -1 }).limit(80).toArray();

  return tasks.map(t => ({
    id: t._id,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    assigneeName: TEAM.find(m => m.id === t.assignee)?.name || null,
    priority: t.priority,
    updatedAt: t.updatedAt,
    completedThisWeek: t.status === "done" && new Date(t.updatedAt) >= ws && new Date(t.updatedAt) < we,
  }));
}

// GET /api/admin/reports/me — meu setor + relatório da semana ATUAL (em curso) + tasks como contexto
admin.get("/reports/me", async (req, res) => {
  const me = memberByEmail(req.user.email);
  if (!me) return res.status(403).json({ error: "not_team_member" });
  const sector = await getSectorForUser(req.user.email);
  const currentWeekStart = getWeekStart();
  const dueDate = getReportDueDate(currentWeekStart);

  const sectorMembers = await listSectorMembers(sector);
  const report = await db.collection("nomade_sector_reports").findOne({ sector, weekStart: currentWeekStart });
  const tasks = await getSectorTasksForWeek(sector, currentWeekStart);
  const history = await db.collection("nomade_sector_reports")
    .find({ sector, weekStart: { $lt: currentWeekStart } }).sort({ weekStart: -1 }).limit(12).toArray();

  res.json({
    me: { id: me.id, name: me.name, email: me.emails[0], sector },
    sectorMembers,
    // Mantém nome 'previousWeek' por compat com client; conteúdo é a semana ATUAL.
    previousWeek: {
      weekStart: currentWeekStart,
      label: fmtWeekLabel(currentWeekStart),
      dueDate,
      dueLabel: fmtDueLabel(dueDate),
      submitted: !!report?.submittedAt,
      report: report || null,
    },
    tasks,
    history,
  });
});

// POST /api/admin/reports — cria/atualiza relatório do MEU setor pra semana anterior
admin.post("/reports", async (req, res) => {
  const me = memberByEmail(req.user.email);
  if (!me) return res.status(403).json({ error: "not_team_member" });
  const { entregas, bloqueios, proximaSemana, weekStart, markSubmitted } = req.body;
  if (!entregas || !entregas.trim()) return res.status(400).json({ error: "entregas_required" });

  const sector = await getSectorForUser(req.user.email);
  const ws = weekStart ? new Date(weekStart) : getWeekStart();
  ws.setHours(0, 0, 0, 0);
  const now = new Date();

  // Existing doc pra preservar contributors / submittedAt
  const existing = await db.collection("nomade_sector_reports").findOne({ sector, weekStart: ws });
  const contributors = existing?.contributors || [];
  const idx = contributors.findIndex(c => c.memberId === me.id);
  if (idx >= 0) contributors[idx] = { memberId: me.id, memberName: me.name, lastEditedAt: now };
  else contributors.push({ memberId: me.id, memberName: me.name, lastEditedAt: now });

  const $set = {
    sector,
    weekStart: ws,
    weekLabel: fmtWeekLabel(ws),
    entregas: (entregas || "").trim(),
    bloqueios: (bloqueios || "").trim(),
    proximaSemana: (proximaSemana || "").trim(),
    contributors,
    lastEditedBy: { memberId: me.id, memberName: me.name },
    updatedAt: now,
  };
  if (markSubmitted) $set.submittedAt = now;
  // se já tinha submittedAt e tá editando, mantém

  await db.collection("nomade_sector_reports").updateOne(
    { sector, weekStart: ws },
    { $set, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  res.json({ ok: true, sector, weekStart: ws });
});

// POST /api/admin/reports/ai-revise — Gemini reescreve com base em draft + tasks
admin.post("/reports/ai-revise", async (req, res) => {
  const me = memberByEmail(req.user.email);
  if (!me) return res.status(403).json({ error: "not_team_member" });
  const { entregas, bloqueios, proximaSemana, sector: sectorReq, weekStart } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: "ai_not_configured", message: "GEMINI_API_KEY não configurado." });
  }

  const sector = sectorReq || await getSectorForUser(req.user.email);
  const ws = weekStart ? new Date(weekStart) : getWeekStart();
  ws.setHours(0, 0, 0, 0);

  const tasks = await getSectorTasksForWeek(sector, ws);
  const completed = tasks.filter(t => t.completedThisWeek);
  const inProgress = tasks.filter(t => t.status !== "done");

  const taskContext = [
    completed.length ? `Tasks CONCLUÍDAS na semana:\n${completed.map(t => `- [${t.assigneeName || "—"}] ${t.title}`).join("\n")}` : "",
    inProgress.length ? `\nTasks EM ANDAMENTO:\n${inProgress.slice(0, 20).map(t => `- [${t.assigneeName || "—"}] ${t.title} (${t.status})`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Você é um assistente que reescreve relatórios semanais de equipe em formato NARRATIVO — texto descritivo em parágrafos curtos, contando o que rolou na semana. Tom profissional mas leve, português brasileiro coloquial sem ser informal demais. Use as tasks como evidência concreta pra descrever o que foi feito.

NÃO USE listas com bullets (-, *, •). Use parágrafos fluidos, frases conectadas.

Setor: ${sector === "operacional" ? "Operacional" : "Administrativo"}
Semana: ${fmtWeekLabel(ws)}

${taskContext ? `CONTEXTO — TASKS DO SETOR NA SEMANA:\n${taskContext}\n` : ""}

RASCUNHO DA EQUIPE:

[Entregas]
${entregas || "(vazio)"}

[Bloqueios]
${bloqueios || "(vazio)"}

[Próxima semana]
${proximaSemana || "(vazio)"}

INSTRUÇÕES:
- Cada bloco vira 1 ou 2 parágrafos curtos (3-5 frases cada).
- DESCREVA o trabalho como narrativa: "A equipe entregou X, avançou em Y, fechou Z..." — não inventário seco.
- Use as tasks pra dar exemplos concretos (pode citar nome da task ou pessoa).
- Não invente nada além do rascunho ou das tasks fornecidas.
- Bloco vazio sem nada pra inferir do contexto = mantém vazio.
- Próxima semana: descreva o foco em 1-2 frases narrativas, não listinha.
- Devolva APENAS JSON puro no formato:
{"entregas": "...", "bloqueios": "...", "proximaSemana": "..."}
- Sem markdown, sem code fences. Quebras de linha dentro de string ok pra separar parágrafos (use \\n).`;

  // Timeout de 25s — Gemini 2.5 flash sem thinking responde em 1-4s.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2500,
            responseMimeType: "application/json",
            // Desliga thinking — pra reescrita simples não precisa, e era o que tava timeoutando
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    clearTimeout(timeout);

    const data = await r.json();
    if (!r.ok) {
      console.error("[ai-revise] Gemini error:", JSON.stringify(data, null, 2));
      return res.status(502).json({ error: "ai_failed", message: data.error?.message || "gemini falhou" });
    }

    // Safety filter pode bloquear → candidates vem vazio
    const candidate = data.candidates?.[0];
    if (!candidate) {
      console.error("[ai-revise] Gemini sem candidates:", JSON.stringify(data));
      return res.status(502).json({ error: "ai_failed", message: "Gemini não retornou conteúdo (possivelmente bloqueado por safety filter)" });
    }
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      console.warn("[ai-revise] finishReason:", candidate.finishReason);
    }

    const text = candidate.content?.parts?.[0]?.text || "";
    if (!text) {
      console.error("[ai-revise] Resposta sem texto:", JSON.stringify(candidate));
      return res.status(502).json({ error: "ai_failed", message: "Resposta do Gemini veio vazia" });
    }

    let revised;
    try {
      revised = JSON.parse(text);
    } catch (e) {
      console.error("[ai-revise] JSON inválido do Gemini:", text.slice(0, 300));
      return res.status(502).json({ error: "ai_invalid_response", message: "Gemini devolveu JSON inválido" });
    }
    res.json({
      ok: true,
      revised: {
        entregas: revised.entregas || entregas || "",
        bloqueios: revised.bloqueios || bloqueios || "",
        proximaSemana: revised.proximaSemana || proximaSemana || "",
      },
      taskCount: { completed: completed.length, inProgress: inProgress.length },
    });
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === "AbortError") {
      console.error("[ai-revise] Timeout (25s)");
      return res.status(504).json({ error: "ai_timeout", message: "Gemini demorou demais (>25s). Tenta um relatório menor." });
    }
    console.error("[ai-revise] fetch error:", e);
    res.status(500).json({ error: "ai_failed", message: e.message || "erro desconhecido" });
  }
});

// DELETE /api/admin/reports — apaga relatório do MEU setor da semana indicada
// (ou de qualquer setor se admin passar ?sector=)
admin.delete("/reports", async (req, res) => {
  const me = memberByEmail(req.user.email);
  if (!me) return res.status(403).json({ error: "not_team_member" });

  const sectorReq = req.query.sector;
  const sector = sectorReq || await getSectorForUser(req.user.email);
  if (!SECTORS_SERVER.includes(sector)) return res.status(400).json({ error: "sector_invalid" });

  const ws = req.query.weekStart ? new Date(req.query.weekStart) : getWeekStart();
  ws.setHours(0, 0, 0, 0);

  // Se quer deletar de outro setor, precisa ser admin
  if (sectorReq) {
    const isAdmin = ADMIN_LIST.includes(req.user.email.toLowerCase());
    const mySector = await getSectorForUser(req.user.email);
    if (!isAdmin && sector !== mySector) {
      return res.status(403).json({ error: "forbidden_other_sector" });
    }
  }

  const r = await db.collection("nomade_sector_reports").deleteOne({ sector, weekStart: ws });
  res.json({ ok: true, deleted: r.deletedCount });
});

// GET /api/admin/reports/index — lista compacta de TODAS as semanas com status por setor
//   Pra archive/browse: {weekStart, weekLabel, sectors: [{sector, submitted, updatedAt}]}
admin.get("/reports/index", async (req, res) => {
  const all = await db.collection("nomade_sector_reports")
    .find({})
    .project({ sector: 1, weekStart: 1, weekLabel: 1, submittedAt: 1, updatedAt: 1, contributors: 1, entregas: 1 })
    .sort({ weekStart: -1 })
    .toArray();

  // Agrupa por weekStart
  const byWeek = new Map();
  for (const r of all) {
    const k = new Date(r.weekStart).toISOString();
    if (!byWeek.has(k)) byWeek.set(k, { weekStart: r.weekStart, weekLabel: r.weekLabel, sectors: [] });
    byWeek.get(k).sectors.push({
      sector: r.sector,
      submitted: !!r.submittedAt,
      submittedAt: r.submittedAt || null,
      updatedAt: r.updatedAt,
      contributors: r.contributors || [],
      preview: (r.entregas || "").slice(0, 100),
    });
  }

  // Garante que a semana atual aparece mesmo sem dados
  const current = getWeekStart();
  const currentKey = current.toISOString();
  if (!byWeek.has(currentKey)) {
    byWeek.set(currentKey, {
      weekStart: current,
      weekLabel: fmtWeekLabel(current),
      sectors: [],
    });
  }

  const weeks = Array.from(byWeek.values())
    .sort((a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime());

  res.json({ weeks, allSectors: SECTORS_SERVER, currentWeekStart: current });
});

// GET /api/admin/reports/summary — semana especificada (default: atual em curso)
//   ?weekStart=ISO  → mostra essa semana específica (pra navegação histórica)
admin.get("/reports/summary", async (req, res) => {
  const target = req.query.weekStart ? new Date(req.query.weekStart) : getWeekStart();
  target.setHours(0, 0, 0, 0);
  const isCurrent = target.getTime() === getWeekStart().getTime();
  const dueDate = getReportDueDate(target);

  const reports = await db.collection("nomade_sector_reports")
    .find({ weekStart: target }).sort({ sector: 1 }).toArray();
  const submittedSet = new Set(reports.filter(r => r.submittedAt).map(r => r.sector));
  const missingSectors = SECTORS_SERVER.filter(s => !submittedSet.has(s));

  // Pra navegação: tem semana anterior/próxima com algum dado?
  const [hasPrev, hasNext] = await Promise.all([
    db.collection("nomade_sector_reports").findOne(
      { weekStart: { $lt: target } }, { sort: { weekStart: -1 }, projection: { weekStart: 1 } }
    ),
    db.collection("nomade_sector_reports").findOne(
      { weekStart: { $gt: target } }, { sort: { weekStart: 1 }, projection: { weekStart: 1 } }
    ),
  ]);

  res.json({
    weekStart: target,
    weekLabel: fmtWeekLabel(target),
    isCurrent,
    dueDate: isCurrent ? dueDate : null,
    dueLabel: isCurrent ? fmtDueLabel(dueDate) : null,
    submitted: submittedSet.size,
    expected: SECTORS_SERVER.length,
    reports,
    missingSectors,
    prevWeekStart: hasPrev?.weekStart || null,
    nextWeekStart: hasNext?.weekStart || null,
  });
});

/* ──────────────────────────────────────────────────────────────────
 * ORÇAMENTO DE LEAD — pré-orçamento automático na entrada do lead.
 * Sem tabela de preços (estilo vlad): a IA usa os valores do briefing
 * ou estima valor de mercado.
 * ──────────────────────────────────────────────────────────────── */

/* Adaptador de compatibilidade: o pré-orçamento de LEAD (email lead-quote +
 * LeadsView) consome o shape antigo {resumo, faixaValor, escopo…}. O gerador
 * novo devolve proposta completa — aqui a gente mapeia de volta. */
async function generateLeadQuote({ description, context = "" }) {
  const g = await generateProposta({ brief: description, contexto: context, mode: "unica" });
  return {
    resumo: g.conteudo.intro || "",
    complexidade: g.complexidade,
    escopo: g.conteudo.sections.flatMap((s) => s.items).slice(0, 6),
    naoIncluido: g.conteudo.naoIncluido,
    prazo: g.prazo,
    faixaValor: {
      buildMin: g.total,
      buildMax: g.total,
      operacaoMensalMin: g.operacaoMensal.min,
      operacaoMensalMax: g.operacaoMensal.max,
    },
    proximosPassos: ["Alinhar os detalhes numa conversa rápida", "Aprovar o orçamento e agendar o kickoff"],
    itens: g.itens,
    total: g.total,
  };
}


/* ──────────────────────────────────────────────────────────────────
 * PAYMENT LINKS — vendas cria link, manda manual, cliente paga
 * Ao pagar: registra o cliente pro admin + manda email de confirmação
 * ──────────────────────────────────────────────────────────────── */

const PAY_METHODS = ["card", "manual"]; // card = recorrente cartão · manual = pix/boleto único
const PAY_CYCLES = ["mensal", "trimestral", "anual"];

// POST /api/admin/payment-links — body: { name, email, description, agents[], buildAmount, monthlyAmount, cycle, paymentMethod, leadId? }
admin.post("/payment-links", async (req, res) => {
  const {
    name, email, description = "",
    agents = [],
    buildAmount = 0,
    monthlyAmount = 0,
    cycle = "mensal",
    paymentMethod = "manual",
    leadId = null,
  } = req.body;

  if (!name || !email) return res.status(400).json({ error: "name_email_required" });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "email_invalid" });
  if (!PAY_METHODS.includes(paymentMethod)) return res.status(400).json({ error: "method_invalid" });
  if (!PAY_CYCLES.includes(cycle)) return res.status(400).json({ error: "cycle_invalid" });
  if (Number(buildAmount) < 0 || Number(monthlyAmount) < 0) return res.status(400).json({ error: "amounts_invalid" });
  if (Number(buildAmount) === 0 && Number(monthlyAmount) === 0) return res.status(400).json({ error: "no_amount" });

  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 dias

  const cycleMonths = cycle === "mensal" ? 1 : cycle === "trimestral" ? 3 : 12;
  const chargeNow = Number(buildAmount) + Number(monthlyAmount) * cycleMonths;

  const doc = {
    token,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    description: description.trim(),
    agents: Array.isArray(agents) ? agents : [],
    pricing: {
      buildAmount: Number(buildAmount),
      monthlyAmount: Number(monthlyAmount),
      cycle,
      cycleMonths,
      chargeNow,
      finalMonthly: Number(monthlyAmount),
    },
    paymentMethod,
    cycle,
    leadId: leadId || null,
    status: "open", // open | paid | expired | cancelled
    createdBy: req.user.email,
    createdAt: now,
    expiresAt,
  };

  const { insertedId } = await db.collection("nomade_payment_links").insertOne(doc);

  // Gera o init_point do MP imediato
  try {
    const isCardSubscription = paymentMethod === "card" && cycle === "mensal";
    if (isCardSubscription) {
      // Preapproval (assinatura recorrente cartão)
      const pre = await createMpPreapproval({
        leadId: insertedId.toString(),
        email: doc.email,
        amount: doc.pricing.finalMonthly,
        months: 1,
        label: `${EMPRESA.nome} · ${doc.description || "Serviço"}`,
      });
      await db.collection("nomade_payment_links").updateOne(
        { _id: insertedId },
        { $set: { mp_preapproval_id: pre.id, mp_init_point: pre.init_point } }
      );
      doc.mp_init_point = pre.init_point;
    } else {
      // Preference (pagamento avulso — pode ser cartão ou pix/boleto)
      const pref = await createMpPreference({
        invoiceId: insertedId.toString(),
        email: doc.email,
        amount: chargeNow,
        label: `${EMPRESA.nome} · ${doc.description || "Serviço"}`,
        cycle,
        excludeCard: paymentMethod === "manual",
      });
      await db.collection("nomade_payment_links").updateOne(
        { _id: insertedId },
        { $set: { mp_preference_id: pref.id, mp_init_point: pref.init_point } }
      );
      doc.mp_init_point = pref.init_point;
    }
  } catch (e) {
    console.error("[payment-link] MP error:", e.message);
    await db.collection("nomade_payment_links").updateOne(
      { _id: insertedId },
      { $set: { mp_error: e.message } }
    );
  }

  const baseUrl = URL_PUBLICA;
  const url = `${baseUrl}/pagar/${token}`;
  res.json({ ok: true, id: insertedId, token, url, link: { ...doc, _id: insertedId, url } });
});

// Mercado Pago está pronto pra cobrar? (Integrações ou .env)
admin.get("/payment-links/status", async (req, res) => {
  res.json({ configured: !!(await mpToken()) });
});

// GET /api/admin/payment-links — lista
admin.get("/payment-links", async (req, res) => {
  const list = await db.collection("nomade_payment_links")
    .find({}).sort({ createdAt: -1 }).limit(100).toArray();
  const baseUrl = URL_PUBLICA;
  res.json(list.map(l => ({ ...l, url: `${baseUrl}/pagar/${l.token}` })));
});

// DELETE /api/admin/payment-links/:id — cancela link (não cancela MP, só inutiliza o token)
admin.delete("/payment-links/:id", async (req, res) => {
  try {
    await db.collection("nomade_payment_links").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: "cancelled", cancelledAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "invalid_id" });
  }
});

/* ─── Endpoints PÚBLICOS (sem auth) — portfólio da home ─── */

// GET /api/site/projetos — só o publicado, na ordem do admin. Sem clientId,
// sem erro de captura: o site recebe o mínimo. A capa vem por URL própria
// (versionada pelo capaAt, então o cache de 1 dia não segura print velho).
app.get("/api/site/projetos", limitPublic, async (req, res) => {
  const list = await db.collection("nomade_projetos")
    .find({ publicado: true, capaAt: { $exists: true } })
    .sort({ ordem: 1, createdAt: -1 })
    .project({ nome: 1, url: 1, frente: 1, resumo: 1, resumoEn: 1, cor: 1, destaque: 1, proprio: 1, capaAt: 1, capaMobileAt: 1 })
    .toArray();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(list.map((p) => {
    let host = "";
    try { host = new URL(p.url).hostname.replace(/^www\./, ""); } catch {}
    return {
      id: String(p._id), nome: p.nome, url: p.url, host, frente: p.frente,
      resumo: p.resumo || "", resumoEn: p.resumoEn || "", cor: p.cor || null, destaque: !!p.destaque, proprio: !!p.proprio,
      capa: `/api/site/projetos/${p._id}/capa.jpg?v=${new Date(p.capaAt).getTime()}`,
      capaMobile: p.capaMobileAt ? `/api/site/projetos/${p._id}/capa-mobile.jpg?v=${new Date(p.capaMobileAt).getTime()}` : null,
    };
  }));
});

// GET /api/site/projetos/:id/capa.jpg — o screenshot. O admin também usa
// (thumb da lista), por isso serve mesmo sem `publicado`: é print de site
// público e o id não é adivinhável.
// capa.jpg = desktop 1440×900 · capa-mobile.jpg = iPhone 390×844 @2x (painel da home em tela pequena)
async function servirCapa(req, res, campo) {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).end();
  const capa = await db.collection("nomade_projetos_capas").findOne(
    { projetoId: new ObjectId(req.params.id) }, { projection: { [campo]: 1, mime: 1 } });
  const bin = capa?.[campo];
  if (!bin) return res.status(404).end();
  const buf = bin.buffer ? Buffer.from(bin.buffer) : Buffer.from(bin);
  res.setHeader("Content-Type", capa.mime || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(buf);
}
app.get("/api/site/projetos/:id/capa.jpg", limitPublic, (req, res) => servirCapa(req, res, "data"));
app.get("/api/site/projetos/:id/capa-mobile.jpg", limitPublic, (req, res) => servirCapa(req, res, "dataMobile"));

/* ─── Endpoints PÚBLICOS (sem auth) — usados pela página /pagar/:token ─── */

// GET /api/payment-links/public/:token — dados pra renderizar a página de pagamento
app.get("/api/payment-links/public/:token", limitPublic, async (req, res) => {
  const link = await db.collection("nomade_payment_links").findOne({ token: req.params.token });
  if (!link) return res.status(404).json({ error: "not_found" });
  if (link.status === "cancelled") return res.status(410).json({ error: "cancelled" });
  if (link.status === "paid") return res.status(410).json({ error: "already_paid" });
  // pending_delivery: 2ª metade do setup só fica acessível quando admin promove pra "open"
  if (link.status === "pending_delivery") return res.status(404).json({ error: "not_found" });
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).json({ error: "expired" });
  }
  // Não devolve dados sensíveis (createdBy, etc)
  res.json({
    name: link.name,
    description: link.description,
    pricing: link.pricing,
    cycle: link.cycle,
    paymentMethod: link.paymentMethod,
    mp_init_point: link.mp_init_point,
    setupPaymentMode: link.setupPaymentMode || null,
    setupPart: link.setupPart || null,
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROPOSTAS — orçamento + proposta unificados (substituiu o pipeline de deals)
 * brief → IA gera (itens + editorial) → time edita → publica → link público
 * /proposta/:token → cliente paga via Mercado Pago → webhook marca paga
 * ══════════════════════════════════════════════════════════════════════════ */

const PROPOSTA_STATUSES = ["draft", "published", "paid", "lost"];

async function nextPropostaNumber() {
  const r = await db.collection("nomade_settings").findOneAndUpdate(
    { key: "proposta_counter" },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return r?.value || 1;
}

function sanitizeItens(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => ({
    descricao: String(it?.descricao || "").slice(0, 200).trim() || "Serviço",
    quantidade: Math.max(1, Math.round(Number(it?.quantidade) || 1)),
    valorUnitario: Math.max(0, Math.round(Number(it?.valorUnitario) || 0)),
  })).filter((it) => it.valorUnitario > 0).slice(0, 12);
}

const somaItens = (itens) => (itens || []).reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);

// Sanitiza pilares editados no admin (mesma forma que o gerador produz)
function sanitizeConteudoSections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => ({
    label: String(s?.label || "").slice(0, 40).trim() || `PILAR ${String(i + 1).padStart(2, "0")}`,
    title: String(s?.title || "").slice(0, 80).trim() || "Pilar",
    desc: String(s?.desc || "").slice(0, 300).trim(),
    items: (Array.isArray(s?.items) ? s.items : []).map((x) => String(x).slice(0, 200).trim()).filter(Boolean).slice(0, 8),
  })).filter((s) => s.items.length > 0).slice(0, 4);
}

function pushHistory(doc, by, action, note) {
  return [...(doc.history || []), { at: new Date(), by, action, note: note || "" }].slice(-100);
}

// POST /api/admin/propostas/gerar — { clienteId, brief, contexto, mode } → gera e salva como draft.
// Proposta SEMPRE nasce de um cliente cadastrado — é o que mantém tudo linkado.
admin.post("/propostas/gerar", async (req, res) => {
  const { brief, contexto = "", mode = "unica", clienteId } = req.body || {};
  if (!brief || brief.trim().length < 30) {
    return res.status(400).json({ error: "brief_required", message: "Descreve melhor o desafio — mínimo 30 caracteres." });
  }
  if (!clienteId) {
    return res.status(400).json({ error: "cliente_required", message: "Seleciona o cliente — cadastra na aba Clientes se ainda não existe." });
  }
  let client;
  try { client = await db.collection("nomade_clients").findOne({ _id: new ObjectId(clienteId) }); }
  catch { return res.status(400).json({ error: "cliente_invalido" }); }
  if (!client) return res.status(404).json({ error: "cliente_not_found", message: "Cliente não encontrado." });

  try {
    const g = await generateProposta({ brief, contexto, mode });
    const numero = await nextPropostaNumber();
    const now = new Date();
    const doc = {
      numero,
      token: randomToken(),
      status: "draft",
      mode: mode === "mensal" ? "mensal" : "unica",
      brief: brief.trim().slice(0, 8000),
      contexto: (contexto || "").trim().slice(0, 4000),
      cliente: {
        nome: client.name || g.clienteNome,
        email: (client.email || "").toLowerCase().trim(),
        whatsapp: client.contact || "",
      },
      clienteId: client._id,
      conteudo: g.conteudo,
      complexidade: g.complexidade,
      itens: g.itens,
      total: g.total,
      operacaoMensal: g.operacaoMensal,
      mensalInfo: 0,
      prazo: g.prazo,
      observacoes: g.observacoes,
      aviso: g.aviso,
      split: false,
      validadeDias: 15,
      validUntil: null,
      acceptedAt: null,
      paymentLinkId: null,
      paymentLinkToken: null,
      deliveryPaymentLinkId: null,
      opens: [],
      leadId: null,
      history: [{ at: now, by: req.user.email, action: "generated", note: "" }],
      createdBy: req.user.email,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db.collection("nomade_propostas").insertOne(doc);
    res.json({ ok: true, id: insertedId, proposta: { ...doc, _id: insertedId } });
  } catch (e) {
    console.error("[propostas/gerar]", e.message);
    res.status(500).json({ error: "gerar_failed", message: e.message });
  }
});

// POST /api/admin/propostas/manual — cria proposta EM BRANCO pra montar na mão (sem IA)
admin.post("/propostas/manual", async (req, res) => {
  const { clienteId, mode = "unica" } = req.body || {};
  if (!clienteId) return res.status(400).json({ error: "cliente_required", message: "Seleciona o cliente." });
  let client;
  try { client = await db.collection("nomade_clients").findOne({ _id: new ObjectId(clienteId) }); }
  catch { return res.status(400).json({ error: "cliente_invalido" }); }
  if (!client) return res.status(404).json({ error: "cliente_not_found" });

  const numero = await nextPropostaNumber();
  const now = new Date();
  const doc = {
    numero,
    token: randomToken(),
    status: "draft",
    mode: mode === "mensal" ? "mensal" : "unica",
    brief: "",
    contexto: "",
    cliente: {
      nome: client.name || "",
      email: (client.email || "").toLowerCase().trim(),
      whatsapp: client.contact || "",
    },
    clienteId: client._id,
    // conteúdo VAZIO mas presente (não null) → cai direto no editor completo,
    // sem passar pela tela de "gerar com IA".
    conteudo: { subtitle: "", intro: "", sections: [], extra: null, highlights: [], naoIncluido: [] },
    complexidade: null,
    itens: [],
    total: 0,
    operacaoMensal: { min: 0, max: 0 },
    mensalInfo: 0,
    prazo: "",
    observacoes: "",
    aviso: "",
    split: false,
    validadeDias: 15,
    validUntil: null,
    acceptedAt: null,
    paymentLinkId: null,
    paymentLinkToken: null,
    deliveryPaymentLinkId: null,
    opens: [],
    leadId: null,
    manual: true,
    history: [{ at: now, by: req.user.email, action: "created_manual", note: "" }],
    createdBy: req.user.email,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await db.collection("nomade_propostas").insertOne(doc);
  res.json({ ok: true, id: insertedId, proposta: { ...doc, _id: insertedId } });
});

/* ─── ITENS PADRÃO — catálogo de produtos/serviços com preço padrão.
 * Você define uma vez; insere com 1 clique em qualquer proposta. Não é
 * tabela de tiers (aquela foi removida) — é uma paleta reutilizável. ── */
function sanitizeItensPadrao(list) {
  if (!Array.isArray(list)) return [];
  return list.map((it) => ({
    descricao: String(it?.descricao || "").slice(0, 200).trim(),
    valorUnitario: Math.max(0, Math.round(Number(it?.valorUnitario) || 0)),
  })).filter((it) => it.descricao).slice(0, 60);
}

admin.get("/itens-padrao", async (req, res) => {
  const doc = await db.collection("nomade_settings").findOne({ key: "itens_padrao" });
  res.json({ itens: doc?.value || [] });
});

admin.put("/itens-padrao", async (req, res) => {
  const itens = sanitizeItensPadrao(req.body?.itens);
  await db.collection("nomade_settings").updateOne(
    { key: "itens_padrao" },
    { $set: { key: "itens_padrao", value: itens, updatedAt: new Date(), updatedBy: req.user.email } },
    { upsert: true }
  );
  res.json({ ok: true, itens });
});

// POST /api/admin/propostas/:id/gerar — (re)gera conteúdo num draft existente
// (lead promovido chega aqui sem conteúdo; regenerar também cai aqui)
admin.post("/propostas/:id/gerar", async (req, res) => {
  let prop;
  try { prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.status(400).json({ error: "invalid_id" }); }
  if (!prop) return res.status(404).json({ error: "not_found" });
  if (prop.status === "paid") return res.status(400).json({ error: "proposta_paga", message: "Proposta já foi paga." });

  const brief = String(req.body?.brief ?? prop.brief ?? "").trim();
  const contexto = String(req.body?.contexto ?? prop.contexto ?? "").trim();
  const mode = ["unica", "mensal"].includes(req.body?.mode) ? req.body.mode : prop.mode;
  if (brief.length < 30) {
    return res.status(400).json({ error: "brief_required", message: "Briefing muito curto — mínimo 30 caracteres." });
  }

  try {
    const g = await generateProposta({ brief, contexto, mode });
    const keepNome = prop.cliente?.nome && prop.cliente.nome !== "Sem nome";
    await db.collection("nomade_propostas").updateOne(
      { _id: prop._id },
      { $set: {
        brief: brief.slice(0, 8000),
        contexto: contexto.slice(0, 4000),
        mode,
        conteudo: g.conteudo,
        complexidade: g.complexidade,
        itens: g.itens,
        total: g.total,
        operacaoMensal: g.operacaoMensal,
        prazo: g.prazo,
        observacoes: g.observacoes,
        aviso: g.aviso,
        updatedAt: new Date(),
        history: pushHistory(prop, req.user.email, "regenerated", ""),
        ...(keepNome ? {} : { "cliente.nome": g.clienteNome }),
      }}
    );
    const updated = await db.collection("nomade_propostas").findOne({ _id: prop._id });
    res.json({ ok: true, proposta: updated });
  } catch (e) {
    console.error("[propostas/:id/gerar]", e.message);
    res.status(500).json({ error: "gerar_failed", message: e.message });
  }
});

// GET /api/admin/propostas — lista (?status= &q=)
admin.get("/propostas", async (req, res) => {
  const q = {};
  if (req.crew && !req.crew.socio && req.crew.propostasSoProprias) q.createdBy = req.crew.email;
  if (req.query.status && PROPOSTA_STATUSES.includes(req.query.status)) q.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    q.$or = [{ "cliente.nome": rx }, { "cliente.email": rx }, { brief: rx }];
  }
  const list = await db.collection("nomade_propostas")
    .find(q)
    .project({ brief: 0, contexto: 0, history: 0 })
    .sort({ updatedAt: -1 }).limit(200).toArray();
  const baseUrl = URL_PUBLICA;
  res.json(list.map((p) => ({ ...p, url: `${baseUrl}/proposta/${p.token}` })));
});

// GET /api/admin/propostas/:id
admin.get("/propostas/:id", async (req, res) => {
  try {
    const prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(req.params.id) });
    if (!prop) return res.status(404).json({ error: "not_found" });
    const baseUrl = URL_PUBLICA;
    res.json({ ...prop, url: `${baseUrl}/proposta/${prop.token}` });
  } catch {
    res.status(400).json({ error: "invalid_id" });
  }
});

// PATCH /api/admin/propostas/:id — edita cliente, itens, condições e textos-chave
admin.patch("/propostas/:id", async (req, res) => {
  let prop;
  try { prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.status(400).json({ error: "invalid_id" }); }
  if (!prop) return res.status(404).json({ error: "not_found" });
  if (prop.status === "paid") return res.status(400).json({ error: "proposta_paga", message: "Proposta já foi paga." });

  const body = req.body || {};
  const $set = { updatedAt: new Date() };

  // Re-linkar a outro cliente: snapshot (nome/email/whatsapp) vem do CADASTRO,
  // nunca de texto livre — é o que mantém proposta↔cliente sempre em sincronia.
  if (body.clienteId) {
    let cl;
    try { cl = await db.collection("nomade_clients").findOne({ _id: new ObjectId(body.clienteId) }); }
    catch { return res.status(400).json({ error: "cliente_invalido" }); }
    if (!cl) return res.status(404).json({ error: "cliente_not_found" });
    $set.clienteId = cl._id;
    $set.cliente = {
      nome: cl.name || "",
      email: (cl.email || "").toLowerCase().trim(),
      whatsapp: cl.contact || "",
    };
  }
  if (body.itens !== undefined) {
    $set.itens = sanitizeItens(body.itens);
    $set.total = somaItens($set.itens);
  }
  if (["unica", "mensal"].includes(body.mode)) $set.mode = body.mode;
  if (body.mensalInfo !== undefined) $set.mensalInfo = Math.max(0, Math.round(Number(body.mensalInfo) || 0));
  if (body.split !== undefined) $set.split = !!body.split;
  if (body.validadeDias !== undefined) $set.validadeDias = Math.max(1, Math.min(180, Math.round(Number(body.validadeDias) || 15)));
  if (typeof body.observacoes === "string") $set.observacoes = body.observacoes.slice(0, 600).trim();
  if (typeof body.prazo === "string") $set.prazo = body.prazo.slice(0, 80).trim();
  if (typeof body.brief === "string") $set.brief = body.brief.slice(0, 8000);
  if (typeof body.contexto === "string") $set.contexto = body.contexto.slice(0, 4000);
  if (body.conteudo && prop.conteudo) {
    const c = body.conteudo;
    $set.conteudo = {
      ...prop.conteudo,
      ...(typeof c.subtitle === "string" && { subtitle: c.subtitle.slice(0, 160).trim() }),
      ...(typeof c.intro === "string" && { intro: c.intro.slice(0, 1200).trim() }),
      ...(Array.isArray(c.sections) && { sections: sanitizeConteudoSections(c.sections) }),
      ...(Array.isArray(c.highlights) && {
        highlights: c.highlights
          .map((h) => ({ k: String(h?.k || "").slice(0, 40).trim(), v: String(h?.v || "").slice(0, 80).trim() }))
          .filter((h) => h.k && h.v)
          .slice(0, 3),
      }),
      ...(Array.isArray(c.naoIncluido) && {
        naoIncluido: c.naoIncluido.map((s) => String(s).slice(0, 200).trim()).filter(Boolean).slice(0, 5),
      }),
    };
  }

  $set.history = pushHistory(prop, req.user.email, "updated", body.note || "");

  await db.collection("nomade_propostas").updateOne({ _id: prop._id }, { $set });
  const updated = await db.collection("nomade_propostas").findOne({ _id: prop._id });
  res.json({ ok: true, proposta: updated });
});

// POST /api/admin/propostas/:id/publish — ativa o link público + cria a cobrança MP.
// Republicar depois de editar recria a cobrança (a anterior é cancelada).
admin.post("/propostas/:id/publish", async (req, res) => {
  let prop;
  try { prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.status(400).json({ error: "invalid_id" }); }
  if (!prop) return res.status(404).json({ error: "not_found" });
  if (prop.status === "paid") return res.status(400).json({ error: "proposta_paga" });
  if (prop.status === "lost") return res.status(400).json({ error: "proposta_perdida" });
  if (!prop.conteudo) return res.status(400).json({ error: "sem_conteudo", message: "Gera a proposta com a IA antes de publicar." });
  if (!prop.cliente?.nome) return res.status(400).json({ error: "sem_cliente", message: "Preenche o nome do cliente." });

  const total = somaItens(prop.itens);
  if (total <= 0) return res.status(400).json({ error: "sem_valor", message: "A proposta precisa de pelo menos 1 item com valor." });

  const now = new Date();
  const mensal = prop.mode === "mensal";
  const split = !!prop.split && !mensal;
  const entrada = split ? Math.round(total / 2) : total;
  const restante = split ? total - entrada : 0;

  // Cancela cobrança anterior (republish depois de editar valores)
  if (prop.paymentLinkId) {
    await db.collection("nomade_payment_links").updateOne(
      { _id: prop.paymentLinkId, status: { $in: ["open", "pending_delivery"] } },
      { $set: { status: "cancelled", cancelledAt: now } }
    ).catch(() => {});
  }
  if (prop.deliveryPaymentLinkId) {
    await db.collection("nomade_payment_links").updateOne(
      { _id: prop.deliveryPaymentLinkId, status: { $in: ["open", "pending_delivery"] } },
      { $set: { status: "cancelled", cancelledAt: now } }
    ).catch(() => {});
  }

  // Cobrança principal (Mercado Pago — pix/boleto via Checkout Pro)
  const cycle = mensal ? "mensal" : "unico";
  const linkDoc = {
    token: randomToken(),
    name: prop.cliente.nome,
    email: prop.cliente.email || "",
    description: `Proposta #${String(prop.numero).padStart(3, "0")} · ${mensal ? "1ª mensalidade" : split ? "entrada (50%)" : "projeto"}`,
    agents: [],
    pricing: {
      buildAmount: mensal ? 0 : entrada,
      monthlyAmount: mensal ? total : 0,
      cycle,
      cycleMonths: mensal ? 1 : 0,
      chargeNow: entrada,
      finalMonthly: mensal ? total : 0,
    },
    paymentMethod: "manual",
    cycle,
    propostaId: prop._id,
    clienteId: prop.clienteId || null,
    status: "open",
    createdBy: req.user.email,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    ...(split && { setupPaymentMode: "half", setupPart: "first" }),
  };
  const { insertedId: linkId } = await db.collection("nomade_payment_links").insertOne(linkDoc);

  try {
    const pref = await createMpPreference({
      invoiceId: linkId.toString(),
      email: linkDoc.email,
      amount: entrada,
      label: `${EMPRESA.nome} · Proposta #${String(prop.numero).padStart(3, "0")}`,
      cycle,
      excludeCard: true,
    });
    await db.collection("nomade_payment_links").updateOne(
      { _id: linkId },
      { $set: { mp_preference_id: pref.id, mp_init_point: pref.init_point } }
    );
  } catch (e) {
    console.error("[propostas/publish] MP error:", e.message);
    await db.collection("nomade_payment_links").updateOne(
      { _id: linkId },
      { $set: { mp_error: e.message } }
    );
  }

  // Split → 2ª metade fica pending_delivery até o admin liberar na entrega
  let deliveryLinkId = null;
  if (split) {
    const deliveryDoc = {
      token: randomToken(),
      name: prop.cliente.nome,
      email: prop.cliente.email || "",
      description: `Proposta #${String(prop.numero).padStart(3, "0")} · 2ª metade (entrega)`,
      agents: [],
      pricing: { buildAmount: restante, monthlyAmount: 0, cycle: "unico", cycleMonths: 0, chargeNow: restante, finalMonthly: 0 },
      paymentMethod: "manual",
      cycle: "unico",
      propostaId: prop._id,
    clienteId: prop.clienteId || null,
      status: "pending_delivery",
      createdBy: req.user.email,
      createdAt: now,
      setupPaymentMode: "half",
      setupPart: "second",
    };
    const r2 = await db.collection("nomade_payment_links").insertOne(deliveryDoc);
    deliveryLinkId = r2.insertedId;
  }

  const validUntil = new Date(now.getTime() + (prop.validadeDias || 15) * 24 * 60 * 60 * 1000);
  await db.collection("nomade_propostas").updateOne(
    { _id: prop._id },
    { $set: {
      status: "published",
      total,
      publishedAt: prop.publishedAt || now,
      validUntil,
      paymentLinkId: linkId,
      paymentLinkToken: linkDoc.token,
      deliveryPaymentLinkId: deliveryLinkId,
      updatedAt: now,
      history: pushHistory(prop, req.user.email, "published", ""),
    }}
  );

  const baseUrl = URL_PUBLICA;
  res.json({ ok: true, url: `${baseUrl}/proposta/${prop.token}`, validUntil });
});

// POST /api/admin/propostas/:id/liberar-final — libera a 2ª metade (entrega)
admin.post("/propostas/:id/liberar-final", async (req, res) => {
  let prop;
  try { prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.status(400).json({ error: "invalid_id" }); }
  if (!prop) return res.status(404).json({ error: "not_found" });
  if (!prop.deliveryPaymentLinkId) return res.status(400).json({ error: "sem_link_final" });

  const link = await db.collection("nomade_payment_links").findOne({ _id: prop.deliveryPaymentLinkId });
  if (!link) return res.status(404).json({ error: "link_not_found" });

  if (link.status === "pending_delivery") {
    try {
      const pref = await createMpPreference({
        invoiceId: link._id.toString(),
        email: link.email,
        amount: link.pricing.chargeNow,
        label: `${EMPRESA.nome} · Proposta #${String(prop.numero).padStart(3, "0")} · entrega`,
        cycle: "unico",
        excludeCard: true,
      });
      await db.collection("nomade_payment_links").updateOne(
        { _id: link._id },
        { $set: { status: "open", mp_preference_id: pref.id, mp_init_point: pref.init_point, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }
      );
    } catch (e) {
      console.error("[propostas/liberar-final] MP error:", e.message);
      return res.status(502).json({ error: "mp_failed", message: e.message });
    }
    await db.collection("nomade_propostas").updateOne(
      { _id: prop._id },
      { $set: { updatedAt: new Date(), history: pushHistory(prop, req.user.email, "final_released", "") } }
    );
  }

  const baseUrl = URL_PUBLICA;
  res.json({ ok: true, url: `${baseUrl}/pagar/${link.token}` });
});

// POST /api/admin/propostas/:id/mensalidade — gera a cobrança do próximo mês
// de um plano mensal já pago. A 1ª mensalidade sai no publish; daqui em diante
// é um Pix avulso por mês. Se já tem uma em aberto, devolve ela (sem duplicar).
admin.post("/propostas/:id/mensalidade", async (req, res) => {
  let prop;
  try { prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(req.params.id) }); }
  catch { return res.status(400).json({ error: "invalid_id" }); }
  if (!prop) return res.status(404).json({ error: "not_found" });
  if (prop.mode !== "mensal") return res.status(400).json({ error: "nao_mensal", message: "Só plano mensal tem mensalidade." });
  if (prop.status !== "paid") return res.status(400).json({ error: "nao_paga", message: "A 1ª mensalidade ainda não foi paga." });

  const L = db.collection("nomade_payment_links");
  const baseUrl = URL_PUBLICA;
  const now = new Date();

  const aberta = await L.findOne(
    { propostaId: prop._id, cycle: "mensal", status: "open", expiresAt: { $gt: now } },
    { sort: { createdAt: -1 } }
  );
  if (aberta) {
    return res.json({ ok: true, reused: true, mensalidade: aberta.mensalidade || 1, url: `${baseUrl}/pagar/${aberta.token}` });
  }

  const total = prop.total || somaItens(prop.itens);
  if (total <= 0) return res.status(400).json({ error: "sem_valor" });
  const pagas = await L.countDocuments({ propostaId: prop._id, cycle: "mensal", status: "paid" });
  const n = pagas + 1;
  const numero = String(prop.numero).padStart(3, "0");

  const linkDoc = {
    token: randomToken(),
    name: prop.cliente?.nome || "",
    email: prop.cliente?.email || "",
    description: `Proposta #${numero} · ${n}ª mensalidade`,
    agents: [],
    pricing: { buildAmount: 0, monthlyAmount: total, cycle: "mensal", cycleMonths: 1, chargeNow: total, finalMonthly: total },
    paymentMethod: "manual",
    cycle: "mensal",
    mensalidade: n,
    propostaId: prop._id,
    clienteId: prop.clienteId || null,
    status: "open",
    createdBy: req.user.email,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
  const { insertedId } = await L.insertOne(linkDoc);

  try {
    const pref = await createMpPreference({
      invoiceId: insertedId.toString(),
      email: linkDoc.email,
      amount: total,
      label: `${EMPRESA.nome} · Proposta #${numero} · ${n}ª mensalidade`,
      cycle: "mensal",
      excludeCard: true,
    });
    await L.updateOne({ _id: insertedId }, { $set: { mp_preference_id: pref.id, mp_init_point: pref.init_point } });
  } catch (e) {
    console.error("[propostas/mensalidade] MP error:", e.message);
    await L.updateOne({ _id: insertedId }, { $set: { status: "cancelled", cancelledAt: new Date(), mp_error: e.message } });
    return res.status(502).json({ error: "mp_failed", message: e.message });
  }

  await db.collection("nomade_propostas").updateOne(
    { _id: prop._id },
    { $set: { updatedAt: now, history: pushHistory(prop, req.user.email, "mensalidade", `${n}ª`) } }
  );

  res.json({ ok: true, reused: false, mensalidade: n, url: `${baseUrl}/pagar/${linkDoc.token}` });
});

// POST /api/admin/propostas/:id/lost
admin.post("/propostas/:id/lost", async (req, res) => {
  try {
    const prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(req.params.id) });
    if (!prop) return res.status(404).json({ error: "not_found" });
    await db.collection("nomade_propostas").updateOne(
      { _id: prop._id },
      { $set: {
        status: "lost",
        lostReason: req.body?.reason || "",
        lostAt: new Date(),
        updatedAt: new Date(),
        history: pushHistory(prop, req.user.email, "lost", req.body?.reason || ""),
      }}
    );
    // Cancela cobranças abertas
    for (const id of [prop.paymentLinkId, prop.deliveryPaymentLinkId].filter(Boolean)) {
      await db.collection("nomade_payment_links").updateOne(
        { _id: id, status: { $in: ["open", "pending_delivery"] } },
        { $set: { status: "cancelled", cancelledAt: new Date() } }
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "invalid_id" });
  }
});

// DELETE /api/admin/propostas/:id — só draft/lost; libera o lead pra promover de novo
admin.delete("/propostas/:id", async (req, res) => {
  try {
    const prop = await db.collection("nomade_propostas").findOne({ _id: new ObjectId(req.params.id) });
    if (!prop) return res.status(404).json({ error: "not_found" });
    if (!["draft", "lost"].includes(prop.status)) {
      return res.status(400).json({ error: "not_deletable", message: "Só dá pra excluir rascunho ou perdida. Marca como perdida antes." });
    }
    if (prop.leadId) {
      await db.collection("nomade_leads").updateOne(
        { _id: prop.leadId },
        { $unset: { propostaId: "", propostaNumero: "" }, $set: { status: "new" } }
      ).catch(() => {});
    }
    await db.collection("nomade_propostas").deleteOne({ _id: prop._id });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "invalid_id" });
  }
});

/* Rede de proteção: encapsula os handlers async do router admin pra que uma
 * rejeição (ex.: ObjectId inválido → BSONError num req.params malformado) vire
 * resposta 400/500 pelo error-handler, em vez de request pendurado. Fecha o
 * padrão pré-existente de ObjectId(req.params) sem try/catch numa tacada só. */
for (const layer of admin.stack) {
  if (!layer.route) continue;
  for (const s of layer.route.stack) {
    const fn = s.handle;
    if (fn.length >= 4) continue; // não mexe em error handlers
    s.handle = function wrapped(req, res, next) {
      try {
        const r = fn.call(this, req, res, next);
        if (r && typeof r.catch === "function") r.catch(next);
      } catch (e) { next(e); }
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * EMPRESA (onboarding), LINKS DE CADASTRO e HOME
 * ══════════════════════════════════════════════════════════════════════════ */
admin.get("/empresa", async (req, res) => {
  res.json(await obterEmpresaConfig(db));
});
admin.put("/empresa", soSocio, async (req, res) => {
  res.json(await salvarEmpresaConfig(db, req.body || {}, req.user.email));
});

/* Formulários públicos — cada um é um link /f/<slug> que grava lead. */
const formOut = (f, n = 0) => ({ ...f, _id: undefined, id: f.slug, url: `${URL_PUBLICA}/f/${f.slug}`, leads: n });
admin.get("/forms", async (req, res) => {
  const forms = await db.collection("nomade_forms").find({}).sort({ criadoEm: -1 }).toArray();
  const contagem = await db.collection("nomade_leads").aggregate([
    { $match: { source: { $regex: /^form:/ } } }, { $group: { _id: "$source", n: { $sum: 1 } } },
  ]).toArray();
  const n = new Map(contagem.map((c) => [c._id, c.n]));
  res.json(forms.map((f) => formOut(f, n.get(`form:${f.slug}`) || 0)));
});
admin.post("/forms", soSocio, async (req, res) => {
  const v = sanitizarForm(req.body);
  if (!v.titulo) return res.status(400).json({ error: "titulo_obrigatorio" });
  let slug = slugify(req.body.slug || v.titulo) || `form-${Date.now().toString(36)}`;
  // slug repetido ganha sufixo em vez de erro: o onboarding cria sem perguntar
  if (await db.collection("nomade_forms").findOne({ slug })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const doc = { slug, idioma: "en", campos: ["name", "email", "whatsapp", "msg"], ativo: true, descricao: "", obrigadoTexto: "", redirect: "", ...v, criadoEm: new Date(), por: req.user.email };
  await db.collection("nomade_forms").insertOne(doc);
  res.json(formOut(doc));
});
admin.patch("/forms/:slug", soSocio, async (req, res) => {
  const v = sanitizarForm(req.body, true);
  const r = await db.collection("nomade_forms").findOneAndUpdate(
    { slug: req.params.slug }, { $set: { ...v, atualizadoEm: new Date() } }, { returnDocument: "after" },
  );
  if (!r) return res.status(404).json({ error: "not_found" });
  res.json(formOut(r));
});
admin.delete("/forms/:slug", soSocio, async (req, res) => {
  await db.collection("nomade_forms").deleteOne({ slug: req.params.slug });
  res.json({ ok: true });
});

/* HOME — os números e os SINAIS da empresa. Só dado; o texto é do painel,
   que fala o idioma da pessoa. */
admin.get("/home", async (req, res) => {
  const now = new Date();
  const dia = 24 * 3600 * 1000;
  const d30 = new Date(now.getTime() - 30 * dia);
  const d7 = new Date(now.getTime() - 7 * dia);
  const d14 = new Date(now.getTime() - 14 * dia);
  const mesInicio = new Date(now.getFullYear(), now.getMonth(), 1);
  const T = db.collection("nomade_tasks"), P = db.collection("nomade_propostas");
  const L = db.collection("nomade_payment_links"), C = db.collection("nomade_clients"), LD = db.collection("nomade_leads");

  const [leads30, leadsNovos, tasksAbertas, tasksAtrasadas, tasksFeitas7, propostas, pagos30, clientesAtivos, clientesNovos, linksAbertos] = await Promise.all([
    LD.find({ createdAt: { $gte: d30 } }).project({ createdAt: 1, status: 1, name: 1, company: 1, source: 1 }).toArray(),
    LD.countDocuments({ status: "new" }),
    T.countDocuments({ archived: { $ne: true }, status: { $ne: "done" } }),
    T.countDocuments({ archived: { $ne: true }, status: { $ne: "done" }, dueDate: { $lt: now } }),
    T.countDocuments({ archived: { $ne: true }, status: "done", updatedAt: { $gte: d7 } }),
    P.find({ status: { $ne: "lost" } }).project({ numero: 1, status: 1, total: 1, "cliente.nome": 1, publishedAt: 1, acceptedAt: 1, paidAt: 1, updatedAt: 1, lastOpenedAt: 1 }).toArray(),
    L.find({ status: "paid", paidAt: { $gte: d30 } }).project({ paidAt: 1, "pricing.chargeNow": 1, name: 1 }).toArray(),
    C.countDocuments({ status: { $ne: "cancelled" } }),
    C.countDocuments({ createdAt: { $gte: d30 } }),
    L.find({ status: { $in: ["open", "pending_delivery"] } }).project({ status: 1, "pricing.chargeNow": 1, propostaId: 1 }).toArray(),
  ]);

  // séries diárias dos últimos 30 dias (índice 0 = há 29 dias, 29 = hoje)
  const serie = (docs, campo, valor = () => 1) => {
    const out = Array.from({ length: 30 }, () => 0);
    for (const d of docs) {
      const i = 29 - Math.floor((now - new Date(d[campo])) / dia);
      if (i >= 0 && i < 30) out[i] += valor(d);
    }
    return out;
  };
  const leadsSerie = serie(leads30, "createdAt");
  const receitaSerie = serie(pagos30, "paidAt", (l) => l.pricing?.chargeNow || 0);
  const leads7 = leads30.filter((l) => l.createdAt >= d7).length;
  const leadsPrev7 = leads30.filter((l) => l.createdAt >= d14 && l.createdAt < d7).length;

  const vivas = new Set(propostas.map((p) => String(p._id)));
  const links = linksAbertos.filter((l) => l.propostaId && vivas.has(String(l.propostaId)));
  const aguardando = propostas.filter((p) => p.status === "published" && !p.acceptedAt);
  const paradas = aguardando.filter((p) => p.publishedAt && now - new Date(p.publishedAt) > 5 * dia);
  const aceitasNaoPagas = propostas.filter((p) => p.acceptedAt && p.status !== "paid");
  const recebidoMes = pagos30.filter((l) => l.paidAt >= mesInicio).reduce((s2, l) => s2 + (l.pricing?.chargeNow || 0), 0);
  const aReceber = links.reduce((s2, l) => s2 + (l.pricing?.chargeNow || 0), 0);
  const leadsSemResposta = leads30.filter((l) => l.status === "new" && now - new Date(l.createdAt) > 2 * dia).length;

  /* SINAIS — o que mudou e pede ação. Cada um aponta pra aba certa. */
  const sinais = [];
  if (paradas.length) sinais.push({ id: "proposals_stale", front: "sales", level: "warn", n: paradas.length, valor: paradas.reduce((a, p) => a + (p.total || 0), 0), tab: "propostas" });
  if (leadsSemResposta) sinais.push({ id: "leads_unanswered", front: "sales", level: leadsSemResposta > 3 ? "risk" : "warn", n: leadsSemResposta, tab: "leads" });
  if (tasksAtrasadas) sinais.push({ id: "tasks_overdue", front: "delivery", level: tasksAtrasadas > 5 ? "risk" : "warn", n: tasksAtrasadas, tab: "tasks" });
  if (aceitasNaoPagas.length) sinais.push({ id: "accepted_unpaid", front: "finance", level: "warn", n: aceitasNaoPagas.length, valor: aceitasNaoPagas.reduce((a, p) => a + (p.total || 0), 0), tab: "propostas" });
  if (!sinais.some((x) => x.front === "sales")) sinais.push({ id: "sales_ok", front: "sales", level: "ok", n: aguardando.length, tab: "propostas" });
  if (!sinais.some((x) => x.front === "delivery")) sinais.push({ id: "delivery_ok", front: "delivery", level: "ok", n: tasksAbertas, tab: "tasks" });
  if (!sinais.some((x) => x.front === "finance")) sinais.push({ id: "finance_ok", front: "finance", level: "ok", valor: recebidoMes, tab: "finance" });

  const feed = [];
  for (const p of propostas.slice().sort((x, y) => new Date(y.updatedAt) - new Date(x.updatedAt)).slice(0, 10)) {
    const nome = p.cliente?.nome || "";
    if (p.paidAt) feed.push({ at: p.paidAt, tipo: "proposal_paid", nome, numero: p.numero, valor: p.total });
    else if (p.acceptedAt) feed.push({ at: p.acceptedAt, tipo: "proposal_accepted", nome, numero: p.numero, valor: p.total });
    else if (p.lastOpenedAt) feed.push({ at: p.lastOpenedAt, tipo: "proposal_opened", nome, numero: p.numero });
    else if (p.publishedAt) feed.push({ at: p.publishedAt, tipo: "proposal_sent", nome, numero: p.numero, valor: p.total });
  }
  for (const l of leads30.slice(-8)) feed.push({ at: l.createdAt, tipo: "lead_new", nome: l.name || l.company || "", source: l.source });
  for (const l of pagos30.slice(-6)) feed.push({ at: l.paidAt, tipo: "payment", nome: l.name || "", valor: l.pricing?.chargeNow });
  feed.sort((a, b) => new Date(b.at) - new Date(a.at));

  res.json({
    kpis: {
      leads: { total: leads30.length, novos: leadsNovos, semana: leads7, semanaAnterior: leadsPrev7, serie: leadsSerie },
      tasks: { abertas: tasksAbertas, atrasadas: tasksAtrasadas, feitas7: tasksFeitas7 },
      propostas: { rascunhos: propostas.filter((p) => p.status === "draft").length, aguardando: aguardando.length, emJogo: aguardando.reduce((a, p) => a + (p.total || 0), 0), aceitasNaoPagas: aceitasNaoPagas.length },
      clientes: { ativos: clientesAtivos, novos30: clientesNovos },
      receita: { mes: recebidoMes, aReceber, aReceberN: links.length, serie: receitaSerie, total30: receitaSerie.reduce((a, b) => a + b, 0) },
    },
    sinais,
    feed: feed.slice(0, 14),
  });
});

app.use("/api/admin", admin);

/* ══════════════════════════════════════════════════════════════════════════
 * FINANCE (fluxo de caixa interno)
 * ══════════════════════════════════════════════════════════════════════════ */

app.get("/api/admin/finance", requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await db.collection("nomade_finance").find({}).sort({ data: -1, createdAt: -1 }).toArray();
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/admin/finance", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { tipo, categoria, descricao, valor, data, metodo, recorrente } = req.body;
    if (!["entrada", "saida"].includes(tipo)) return res.status(400).json({ error: "tipo inválido" });
    if (!descricao || !data) return res.status(400).json({ error: "campos obrigatórios faltando" });
    const v = Number(valor);
    if (!v || v <= 0) return res.status(400).json({ error: "valor inválido" });
    const doc = {
      tipo, categoria: categoria || "Outros",
      descricao: String(descricao).trim(), valor: v, data,
      metodo: metodo || null, recorrente: !!recorrente,
      createdBy: req.user.email, createdAt: new Date(), updatedAt: new Date(),
    };
    const r = await db.collection("nomade_finance").insertOne(doc);
    res.json({ ...doc, _id: r.insertedId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.patch("/api/admin/finance/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const allowed = ["tipo", "categoria", "descricao", "valor", "data", "metodo", "recorrente"];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    if ("valor" in update) update.valor = Number(update.valor);
    if ("descricao" in update) update.descricao = String(update.descricao).trim();
    if ("recorrente" in update) update.recorrente = !!update.recorrente;
    update.updatedAt = new Date();
    await db.collection("nomade_finance").updateOne(
      { _id: new ObjectId(req.params.id) }, { $set: update }
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/admin/finance/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.collection("nomade_finance").deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════════════════════════════════════
 * STATIC (painel) + páginas públicas
 * ══════════════════════════════════════════════════════════════════════════ */

app.get("/health", (_, res) => res.json({ ok: true }));

const adminDist  = path.join(__dirname, "client", "admin",  "dist");

// Vite gera bundles com hash no nome (ex.: main-abc123.js) — esses podem
// ser cacheados pra sempre. O index.html não tem hash, então precisa revalidar
// a cada request, senão o browser fica preso numa versão antiga.
const staticOpts = {
  setHeaders(res, filePath) {
    const nome = path.basename(filePath);

    // O service worker precisa de escopo "/" porque o cockpit abre na RAIZ do
    // crew (o ai-service reescreve / → /admin/), mas o arquivo é servido de
    // /admin/sw.js. Sem este header o browser recusa o escopo e o registro
    // falha — é a peça que faz o PWA existir.
    if (nome === "sw.js") {
      res.setHeader("Service-Worker-Allowed", "/");
      res.setHeader("Cache-Control", "no-cache");
      return;
    }
    // Sem hash no nome: cachear "pra sempre" prenderia o app numa versão.
    if (nome === "index.html" || nome === "manifest.webmanifest") {
      res.setHeader("Cache-Control", "no-cache");
      return;
    }
    // Ícone do app também não tem hash — uma semana já economiza os requests
    // sem custar um ícone velho preso por um ano no aparelho de alguém.
    if (filePath.includes(`${path.sep}icons${path.sep}`)) {
      res.setHeader("Cache-Control", "public, max-age=604800");
      return;
    }
    // Bundles do Vite: o hash está no nome, então mudar = outro arquivo.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  },
};
const sendIndex = (res, dist) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(dist, "index.html"));
};

// Painel (/admin — chega aqui pelo proxy do ai-service, que é a porta pública dele)
app.use("/admin", hqOnly, express.static(adminDist, staticOpts));
app.get(/^\/admin(\/.*)?$/, hqOnly, (req, res) => sendIndex(res, adminDist));

// ─── PROPOSTA PÚBLICA — página server-rendered (visual vlad-proposta) ───
// Sem JS na página: o botão "Pagar" é um <a> pra rota abaixo, que registra
// o aceite e redireciona pro checkout /pagar/:token (Mercado Pago).
/* ── FORMULÁRIO PÚBLICO DE CADASTRO — /f/:slug (sem JS) ─────────────────── */
app.get("/f/:slug", limitPublic, async (req, res) => {
  const form = await db.collection("nomade_forms").findOne({ slug: req.params.slug, ativo: true });
  if (!form) return res.status(404).type("html").send(formNotFoundPage());
  const empresa = await obterEmpresaConfig(db);
  res.set("Cache-Control", "no-store").type("html").send(renderFormPage(form, empresa, { ok: req.query.ok === "1" }));
});
app.post("/f/:slug", limitLeads, async (req, res) => {
  const form = await db.collection("nomade_forms").findOne({ slug: req.params.slug, ativo: true });
  if (!form) return res.status(404).type("html").send(formNotFoundPage());
  const empresa = await obterEmpresaConfig(db);
  const b = req.body || {};
  const limpo = (k, max) => String(b[k] || "").trim().slice(0, max);
  const valores = { name: limpo("name", 120), email: limpo("email", 160), whatsapp: limpo("whatsapp", 40), company: limpo("company", 120), msg: limpo("msg", 4000) };
  const campos = form.campos || [];
  const invalido = !valores.name ? "name"
    : campos.includes("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valores.email) ? "email"
    : campos.includes("whatsapp") && !campos.includes("email") && valores.whatsapp.replace(/\D/g, "").length < 8 ? "whatsapp"
    : "";
  if (invalido) return res.status(400).type("html").send(renderFormPage(form, empresa, { erro: invalido, valores }));
  const contato = valores.email ? null : { type: "whatsapp", value: valores.whatsapp.replace(/\D/g, "") };
  const r = await registrarLead({
    name: valores.name, email: valores.email || undefined, company: valores.company || undefined,
    msg: valores.msg || undefined, source: `form:${form.slug}`,
    ...(contato ? { contact: contato, transcript: [] } : {}),
  });
  if (r.status !== 200) return res.status(400).type("html").send(renderFormPage(form, empresa, { erro: "name", valores }));
  if (valores.whatsapp && valores.email) {
    await db.collection("nomade_leads").updateOne({ _id: r.body.leadId }, { $set: { whatsapp: valores.whatsapp } }).catch(() => {});
  }
  if (form.redirect) return res.redirect(form.redirect);
  res.redirect(`/f/${form.slug}?ok=1`);
});

app.get("/proposta/:token", limitPublic, async (req, res) => {
  propostaCsp(res); // vale pra página E pras páginas de erro (404/500)
  try {
    const prop = await db.collection("nomade_propostas").findOne({ token: req.params.token });
    if (!prop || prop.status === "lost") {
      return res.status(404).send(propostaNotFoundPage());
    }
    // Registra abertura só depois de publicada (prévia do time não conta)
    if (prop.status !== "draft") {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;
      db.collection("nomade_propostas").updateOne(
        { _id: prop._id },
        {
          $push: { opens: { $each: [{ at: new Date(), ip, userAgent: req.headers["user-agent"] || "" }], $slice: -50 } },
          $set: { lastOpenedAt: new Date() },
        }
      ).catch(() => {});
    }
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderPropostaPage(prop, {
      baseUrl: URL_PUBLICA,
      mensalidadeAberta: await mensalidadeAberta(prop),
    }));
  } catch (e) {
    console.error("[proposta-page]", e.message);
    res.status(500).send(propostaNotFoundPage());
  }
});

// Plano mensal pago: a cobrança do mês em aberto (2ª mensalidade em diante), se houver
async function mensalidadeAberta(prop) {
  if (prop.mode !== "mensal" || prop.status !== "paid") return null;
  const l = await db.collection("nomade_payment_links").findOne(
    { propostaId: prop._id, cycle: "mensal", status: "open", expiresAt: { $gt: new Date() } },
    { sort: { createdAt: -1 } }
  );
  return l ? { n: l.mensalidade || 1, token: l.token } : null;
}

// Clique em "Pagar" na proposta → marca o aceite (1ª vez) e vai pro checkout
app.get("/proposta/:token/pagar", limitPublic, async (req, res) => {
  try {
    const prop = await db.collection("nomade_propostas").findOne({ token: req.params.token });
    const back = `/proposta/${encodeURIComponent(req.params.token)}`;
    if (!prop || prop.status === "draft" || prop.status === "lost" || !prop.paymentLinkToken) {
      return res.redirect(back);
    }
    if (prop.status !== "paid" && prop.validUntil && new Date(prop.validUntil) < new Date()) {
      return res.redirect(back);
    }
    if (!prop.acceptedAt) {
      await db.collection("nomade_propostas").updateOne(
        { _id: prop._id },
        {
          $set: { acceptedAt: new Date(), updatedAt: new Date() },
          $push: { history: { at: new Date(), by: "client", action: "accepted", note: "" } },
        }
      ).catch(() => {});
    }
    const aberta = await mensalidadeAberta(prop);
    res.redirect(`/pagar/${aberta ? aberta.token : prop.paymentLinkToken}`);
  } catch (e) {
    console.error("[proposta-pagar]", e.message);
    res.redirect(`/proposta/${encodeURIComponent(req.params.token)}`);
  }
});

/* ─── PÁGINA DE PAGAMENTO — /pagar/:token (HTML server-side) ───
 * Mesmos critérios do endpoint público /api/payment-links/public/:token. */
app.get("/pagar/:token", limitPublic, async (req, res) => {
  res.type("html");
  try {
    const link = await db.collection("nomade_payment_links").findOne({ token: req.params.token });
    // pending_delivery: 2ª metade só abre quando um sócio libera na entrega
    if (!link || link.status === "pending_delivery") return res.status(404).send(renderPagamentoErro("not_found"));
    if (link.status === "cancelled") return res.status(410).send(renderPagamentoErro("cancelled"));
    if (link.status === "paid") return res.status(410).send(renderPagamentoErro("already_paid"));
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) return res.status(410).send(renderPagamentoErro("expired"));
    res.send(renderPagamento(link));
  } catch (e) {
    console.error("[pagar]", e.message);
    res.status(500).send(renderPagamentoErro("erro"));
  }
});
// Volta do checkout do Mercado Pago (back_urls). Quem confirma é o webhook.
app.get(["/pagamento/retorno", "/onboarding/success"], (req, res) => {
  res.type("html").send(renderPagamentoRetorno(req.query));
});

// Nada pra indexar aqui.
app.get("/robots.txt", (req, res) => res.type("text/plain").send("User-agent: *\nDisallow: /\n"));

// Raiz: manda pro site da empresa, se for outro endereço; senão, um aviso curto.
app.get("/", (req, res) => {
  if (EMPRESA.site && EMPRESA.site !== URL_PUBLICA) return res.redirect(302, EMPRESA.site);
  res.type("txt").send(`${PRODUTO} — ${EMPRESA.nome}`);
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "not_found" });
  res.status(404).type("txt").send("Not found");
});

/* Error-handler final (4 args). Recebe as rejeições encapsuladas do router admin.
 * ObjectId inválido → 400; o resto → 500 genérico (NÃO vaza e.message do Mongo/MP
 * pro cliente). Loga internamente pra debug. */
app.use((err, req, res, next) => {
  const bsonBadId =
    err?.name === "BSONError" ||
    /24 hex|hex string|Argument passed in must be|hex characters/i.test(err?.message || "");
  if (bsonBadId) {
    if (res.headersSent) return next(err);
    return res.status(400).json({ error: "invalid_id" });
  }
  console.error("[unhandled]", req.method, req.originalUrl, "→", err?.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "server_error" });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SOCKET.IO (presence)
 * ══════════════════════════════════════════════════════════════════════════ */

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: true, credentials: true },
  pingInterval: 25000, pingTimeout: 20000,
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("no_token"));
  const decoded = verifyJwt(token);
  if (!decoded) return next(new Error("invalid_token"));
  const email = (decoded.email || "").toLowerCase();
  const socio = decoded.role === "admin" && ADMIN_LIST.includes(email);
  if (!socio) {
    // membro só conecta se puder ver o kanban (é o que o socket entrega: tasks e presença)
    const m = decoded.role === "membro" ? await membroAtivo(email).catch(() => null) : null;
    if (!m || !(m.perms || []).includes("kanban")) return next(new Error("not_admin"));
  }
  socket.user = decoded;
  socket.join(`user:${email}`);
  next();
});

const presence = new Map();
function broadcastPresence() {
  const byEmail = new Map();
  for (const [, p] of presence) {
    const existing = byEmail.get(p.user.email);
    if (!existing || p.lastSeen > existing.lastSeen) byEmail.set(p.user.email, p);
  }
  const list = Array.from(byEmail.values()).map(p => ({
    email: p.user.email,
    viewingTaskId: p.viewingTaskId || null,
    viewingBoardId: p.viewingBoardId || null,
  }));
  io.emit("presence:update", list);
}

io.on("connection", (socket) => {
  presence.set(socket.id, {
    user: { sub: socket.user.sub, email: socket.user.email },
    viewingTaskId: null, viewingBoardId: null, lastSeen: Date.now(),
  });
  broadcastPresence();
  console.log(`[ws] +${socket.user.email} (${presence.size} online)`);

  socket.on("board:join", (boardId) => {
    if (!boardId) return;
    for (const room of socket.rooms) {
      if (room.startsWith("board:")) socket.leave(room);
    }
    socket.join(`board:${boardId}`);
    const p = presence.get(socket.id);
    if (p) { p.viewingBoardId = boardId; p.lastSeen = Date.now(); }
    broadcastPresence();
  });
  socket.on("board:leave", () => {
    for (const room of socket.rooms) {
      if (room.startsWith("board:")) socket.leave(room);
    }
    const p = presence.get(socket.id);
    if (p) p.viewingBoardId = null;
    broadcastPresence();
  });
  socket.on("task:viewing", (taskId) => {
    const p = presence.get(socket.id);
    if (p) { p.viewingTaskId = taskId || null; p.lastSeen = Date.now(); }
    broadcastPresence();
  });
  socket.on("cursor:move", (data) => {
    if (!data || typeof data.x !== "number" || typeof data.y !== "number") return;
    const p = presence.get(socket.id);
    if (!p || !p.viewingBoardId) return;
    p.lastSeen = Date.now();
    socket.to(`board:${p.viewingBoardId}`).emit("cursor:update", {
      email: socket.user.email, x: data.x, y: data.y, relX: data.relX, relY: data.relY,
    });
  });
  socket.on("cursor:leave", () => {
    const p = presence.get(socket.id);
    if (!p || !p.viewingBoardId) return;
    socket.to(`board:${p.viewingBoardId}`).emit("cursor:gone", { email: socket.user.email });
  });
  socket.on("disconnect", () => {
    const p = presence.get(socket.id);
    if (p?.viewingBoardId) {
      socket.to(`board:${p.viewingBoardId}`).emit("cursor:gone", { email: socket.user.email });
    }
    presence.delete(socket.id);
    broadcastPresence();
    console.log(`[ws] -${socket.user.email} (${presence.size} online)`);
  });
});

/* ──────────────────────────────────────────────────────────────────
 * WEEKLY REPORT CRONS — segunda 9h reminder, 10h consolidado
 * ──────────────────────────────────────────────────────────────── */

async function sendWeeklyReportReminders() {
  try {
    const now = new Date();
    if (now.getDay() !== 1) return; // só segunda
    const ws = (() => { const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate() - 7); return d; })();

    // Setores que JÁ enviaram (submittedAt presente)
    const sent = await db.collection("nomade_sector_reports")
      .find({ weekStart: ws, submittedAt: { $exists: true } }).project({ sector: 1 }).toArray();
    const sentSectors = new Set(sent.map(r => r.sector));
    const missingSectors = SECTORS_SERVER.filter(s => !sentSectors.has(s));
    if (!missingSectors.length) return;

    const fmt = (d) => {
      const we = new Date(d); we.setDate(we.getDate() + 6);
      const f = (x) => formato.data(x, { day: "2-digit", month: "short" }, "pt");
      return `${f(d)} – ${f(we)}`;
    };
    const weekLabel = fmt(ws);
    const reportUrl = `${PAINEL_URL}/relatorios`;

    // Pra cada setor pendente, manda reminder pra TODOS os membros do setor
    let count = 0;
    const overrides = await db.collection("nomade_team_settings").find().toArray();
    const overrideByEmail = Object.fromEntries(overrides.map(o => [o.email.toLowerCase(), o.sector]));

    for (const m of TEAM) {
      const memberSector = overrideByEmail[m.emails[0].toLowerCase()] || m.sector;
      if (!missingSectors.includes(memberSector)) continue;
      try {
        const { subject, html, text } = renderReportReminderEmail({
          name: m.name, weekLabel, reportUrl,
        });
        await sendEmail({ to: m.emails[0], subject, html, text });
        count++;
      } catch (e) { console.error(`[cron] report reminder ${m.id} falhou:`, e.message); }
    }
    if (count > 0) console.log(`[cron] enviou ${count} reminder(s) de relatório (setores pendentes: ${missingSectors.join(", ")})`);
  } catch (e) { console.error("[cron] sendWeeklyReportReminders error:", e); }
}

async function sendWeeklyReportSummary() {
  try {
    const now = new Date();
    if (now.getDay() !== 1) return; // só segunda
    if (!ADMIN_LIST.length) return;

    const ws = (() => { const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate() - 7); return d; })();
    const reports = await db.collection("nomade_sector_reports")
      .find({ weekStart: ws }).sort({ sector: 1 }).toArray();

    const submittedSectors = new Set(reports.filter(r => r.submittedAt).map(r => r.sector));
    const missingSectors = SECTORS_SERVER.filter(s => !submittedSectors.has(s));

    const fmt = (d) => {
      const we = new Date(d); we.setDate(we.getDate() + 6);
      const f = (x) => formato.data(x, { day: "2-digit", month: "short" }, "pt");
      return `${f(d)} – ${f(we)}`;
    };
    const weekLabel = fmt(ws);
    const dashboardUrl = `${PAINEL_URL}/relatorios`;

    const { subject, html, text } = renderReportSummaryEmail({
      weekLabel, reports, missingSectors, dashboardUrl,
    });

    for (const adminEmail of ADMIN_LIST) {
      try { await sendEmail({ to: adminEmail, subject, html, text }); }
      catch (e) { console.error(`[cron] summary email pra ${adminEmail} falhou:`, e.message); }
    }
    console.log(`[cron] resumo semanal enviado pra ${ADMIN_LIST.length} admin(s) — ${submittedSectors.size}/${SECTORS_SERVER.length} setores`);
  } catch (e) { console.error("[cron] sendWeeklyReportSummary error:", e); }
}

// Tick que verifica horário-alvo: segunda 9h (reminder) e 10h (summary).
// Tracking via collection pra não duplicar caso server restart no mesmo horário.
async function weeklyReportTick() {
  const now = new Date();
  if (now.getDay() !== 1) return;
  const hour = now.getHours();

  if (hour === 9) {
    const key = `reminder-${now.toISOString().slice(0,10)}`;
    const exists = await db.collection("nomade_cron_locks").findOne({ key });
    if (!exists) {
      await db.collection("nomade_cron_locks").insertOne({ key, ranAt: now });
      await sendWeeklyReportReminders();
    }
  }
  if (hour === 10) {
    const key = `summary-${now.toISOString().slice(0,10)}`;
    const exists = await db.collection("nomade_cron_locks").findOne({ key });
    if (!exists) {
      await db.collection("nomade_cron_locks").insertOne({ key, ranAt: now });
      await sendWeeklyReportSummary();
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * BOOT
 * ══════════════════════════════════════════════════════════════════════════ */

connectDB().then(async () => {
  httpServer.listen(PORT, () => console.log(`${PRODUTO} (server) on :${PORT} (HTTP + WS)`));

  // Seed inicial de templates de briefing (só se collection vazia)
  try {
    const count = await db.collection("nomade_briefing_templates").countDocuments();
    if (count === 0) {
      const now = new Date();
      const seedTemplates = [
        {
          name: "Atendimento — base",
          description: "Perguntas pra desenhar agent de atendimento ao cliente",
          questions: [
            { id: "q_neg",   type: "textarea", label: "O que sua empresa faz?",                                  helper: "Em 1-2 frases", required: true,  order: 1, placeholder: "", options: [] },
            { id: "q_can",   type: "select",   label: "Em qual canal o agent vai atender?",                       options: ["WhatsApp Business","Site (chat web)","Instagram","Email","Mais de um"], required: true,  order: 2, placeholder: "", helper: "" },
            { id: "q_hor",   type: "text",     label: "Horário de atendimento atual",                             placeholder: "ex: seg-sex 9h-18h",       required: false, order: 3, options: [], helper: "" },
            { id: "q_top",   type: "textarea", label: "Top 5 perguntas/dúvidas que clientes fazem hoje",          helper: "Uma por linha",                  required: true,  order: 4, placeholder: "", options: [] },
            { id: "q_esc",   type: "textarea", label: "Quando o agent deve passar pra um humano?",                helper: "Casos onde ele NÃO deve resolver sozinho", required: true, order: 5, placeholder: "", options: [] },
            { id: "q_int",   type: "text",     label: "Sistemas que precisa integrar",                            placeholder: "ex: Bling, Google Calendar, CRM próprio", required: false, order: 6, options: [], helper: "" },
            { id: "q_voz",   type: "textarea", label: "Tom de voz da marca",                                      helper: "Formal? Coloquial? Específico?", required: false, order: 7, placeholder: "", options: [] },
          ],
        },
        {
          name: "Vendas / SDR — base",
          description: "Perguntas pra desenhar agent de pré-venda e qualificação",
          questions: [
            { id: "q_pro",  type: "textarea", label: "O que você vende?",                          helper: "Produto/serviço + ticket médio", required: true, order: 1, placeholder: "", options: [] },
            { id: "q_lead", type: "textarea", label: "De onde vêm seus leads hoje?",               required: true, order: 2, placeholder: "", helper: "", options: [] },
            { id: "q_qua",  type: "textarea", label: "Como você qualifica um lead bom hoje?",      helper: "Critérios objetivos", required: true, order: 3, placeholder: "", options: [] },
            { id: "q_obj",  type: "textarea", label: "Top 3 objeções que aparecem",                helper: "Uma por linha", required: true, order: 4, placeholder: "", options: [] },
            { id: "q_fec",  type: "textarea", label: "Como o agent deve fechar / passar pro time?", required: true, order: 5, placeholder: "", helper: "", options: [] },
          ],
        },
        {
          name: "Processo interno — base",
          description: "Pra automatizar processo interno (não cliente-facing)",
          questions: [
            { id: "q_pro", type: "textarea", label: "Qual processo você quer automatizar?",       required: true, order: 1, placeholder: "", helper: "Descreva passo a passo como funciona hoje", options: [] },
            { id: "q_who", type: "text",     label: "Quem faz isso hoje?",                        required: true, order: 2, placeholder: "ex: time financeiro, 2 pessoas", helper: "", options: [] },
            { id: "q_vol", type: "text",     label: "Volume mensal",                              required: true, order: 3, placeholder: "ex: ~200 entradas/mês", helper: "", options: [] },
            { id: "q_sis", type: "textarea", label: "Sistemas envolvidos",                        required: true, order: 4, placeholder: "", helper: "Onde os dados ficam (planilha, sistema, email)", options: [] },
            { id: "q_dor", type: "textarea", label: "Onde mais dá erro/dor hoje?",                required: false, order: 5, placeholder: "", helper: "", options: [] },
          ],
        },
      ];
      await db.collection("nomade_briefing_templates").insertMany(
        seedTemplates.map(t => ({ ...t, createdBy: "system", createdAt: now, updatedAt: now }))
      );
      console.log("[seed] 3 templates de briefing criados");
    }
  } catch (e) { console.error("[seed] briefing templates:", e.message); }

  // Job de arquivamento de tasks antigas (1x/h)
  archiveOldDoneTasks();
  setInterval(archiveOldDoneTasks, 60 * 60 * 1000);

  // Relatório semanal por setor: a tela saiu do painel, então os lembretes
  // ficam DESLIGADOS por padrão (mandariam gente pra uma aba que não existe).
  // RELATORIO_SEMANAL=1 religa o cron.
  if (process.env.RELATORIO_SEMANAL === "1") {
    weeklyReportTick();
    setInterval(weeklyReportTick, 15 * 60 * 1000);
  }

  // Moeda, país e fuso da empresa em memória pras páginas públicas e e-mails.
  try { await obterEmpresaConfig(db); } catch (e) { console.error("[empresa] config:", e.message); }

  // Projetos publicados que ficaram sem capa (ex.: site inacessível na rede de
  // quem cadastrou) ganham nova tentativa de print a cada boot, em background.
  try {
    const semCapa = await db.collection("nomade_projetos").find({ publicado: true, capaAt: { $exists: false } }).project({ _id: 1 }).toArray();
    for (const p of semCapa) capturarCapaProjeto(p._id);
  } catch (e) { console.error("[projetos] recaptura no boot falhou:", e.message); }

});
