/* ══════════════════════════════════════════════════════════════════════════
 * INTEGRAÇÕES — o catálogo de softwares que a empresa pode conectar.
 *
 * Cada integração é {id, categoria, campos[]} e um `testar(config)` que faz
 * UMA chamada mínima no serviço de verdade. "Conectada" só quer dizer que
 * existe credencial salva; "testada" quer dizer que o serviço respondeu.
 *
 * As chaves de IA (Anthropic, OpenAI, Gemini, GLM) continuam em
 * office_config{id:'keys'} — orquestrador e squads leem de lá. A tela de
 * integrações mostra as duas listas juntas.
 *
 * Segredo nunca volta inteiro pra tela: só a máscara (mascarar()).
 * ══════════════════════════════════════════════════════════════════════════ */

const com = (ms = 12_000) => ({ signal: AbortSignal.timeout(ms) });
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

const CATALOGO = [
  // ── Mensagens ──
  {
    id: "slack", categoria: "messaging", nome: "Slack",
    campos: [{ k: "webhook", tipo: "secret", rotulo: "Incoming webhook URL", placeholder: "https://hooks.slack.com/services/…" }],
    async testar(c) {
      const r = await fetch(c.webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Nomade Business connected" }), ...com() });
      if (!r.ok) throw new Error(`Slack ${r.status}`);
      return "Message posted to the channel.";
    },
  },
  {
    id: "discord", categoria: "messaging", nome: "Discord",
    campos: [{ k: "webhook", tipo: "secret", rotulo: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…" }],
    async testar(c) {
      const r = await fetch(c.webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "Nomade Business connected" }), ...com() });
      if (!r.ok && r.status !== 204) throw new Error(`Discord ${r.status}`);
      return "Message posted to the channel.";
    },
  },
  {
    id: "telegram", categoria: "messaging", nome: "Telegram",
    campos: [
      { k: "token", tipo: "secret", rotulo: "Bot token", placeholder: "123456:ABC-…" },
      { k: "chatId", tipo: "text", rotulo: "Chat ID", placeholder: "-100123456789" },
    ],
    async testar(c) {
      const r = await fetch(`https://api.telegram.org/bot${c.token}/getMe`, com());
      const j = await json(r);
      if (!j.ok) throw new Error(j.description || `Telegram ${r.status}`);
      if (c.chatId) {
        const s = await fetch(`https://api.telegram.org/bot${c.token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c.chatId, text: "Nomade Business connected" }), ...com() });
        const sj = await json(s);
        if (!sj.ok) throw new Error(sj.description || "Could not send to that chat.");
      }
      return `Bot @${j.result?.username} responded.`;
    },
  },
  {
    id: "whatsapp", categoria: "messaging", nome: "WhatsApp", sub: "Evolution API",
    campos: [
      { k: "url", tipo: "text", rotulo: "Evolution API URL", placeholder: "https://evo.yourcompany.com" },
      { k: "apikey", tipo: "secret", rotulo: "API key" },
      { k: "instance", tipo: "text", rotulo: "Instance name" },
    ],
    async testar(c) {
      const base = String(c.url || "").replace(/\/$/, "");
      const r = await fetch(`${base}/instance/connectionState/${encodeURIComponent(c.instance)}`, { headers: { apikey: c.apikey }, ...com() });
      const j = await json(r);
      if (!r.ok) throw new Error(j.message || j.error || `Evolution ${r.status}`);
      return `Instance state: ${j.instance?.state || j.state || "ok"}.`;
    },
  },
  // ── E-mail ──
  {
    id: "resend", categoria: "email", nome: "Resend",
    campos: [{ k: "apikey", tipo: "secret", rotulo: "API key", placeholder: "re_…" }],
    async testar(c) {
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${c.apikey}` }, ...com() });
      const j = await json(r);
      if (!r.ok) throw new Error(j.message || `Resend ${r.status}`);
      return `${(j.data || []).length} domain(s) on the account.`;
    },
  },
  // ── Pagamentos ──
  {
    id: "mercadopago", categoria: "payments", nome: "Mercado Pago",
    campos: [{ k: "token", tipo: "secret", rotulo: "Access token", placeholder: "APP_USR-…" }],
    async testar(c) {
      const r = await fetch("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${c.token}` }, ...com() });
      const j = await json(r);
      if (!r.ok) throw new Error(j.message || `Mercado Pago ${r.status}`);
      return `Account ${j.nickname || j.id} responded.`;
    },
  },
  {
    id: "stripe", categoria: "payments", nome: "Stripe",
    campos: [{ k: "secret", tipo: "secret", rotulo: "Secret key", placeholder: "sk_live_…" }],
    async testar(c) {
      const r = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${c.secret}` }, ...com() });
      const j = await json(r);
      if (!r.ok) throw new Error(j.error?.message || `Stripe ${r.status}`);
      return "Balance endpoint responded.";
    },
  },
  // ── Documentos ──
  {
    id: "notion", categoria: "docs", nome: "Notion",
    campos: [{ k: "token", tipo: "secret", rotulo: "Internal integration token", placeholder: "ntn_…" }],
    async testar(c) {
      const r = await fetch("https://api.notion.com/v1/users/me", { headers: { Authorization: `Bearer ${c.token}`, "Notion-Version": "2022-06-28" }, ...com() });
      const j = await json(r);
      if (!r.ok) throw new Error(j.message || `Notion ${r.status}`);
      return `Integration "${j.name || j.bot?.owner?.type || "bot"}" responded.`;
    },
  },
  {
    id: "gdrive", categoria: "docs", nome: "Google Drive",
    campos: [
      { k: "clientId", tipo: "text", rotulo: "OAuth client ID", placeholder: "….apps.googleusercontent.com" },
      { k: "apiKey", tipo: "secret", rotulo: "API key" },
    ],
    async testar(c) {
      if (!c.clientId?.endsWith(".apps.googleusercontent.com")) throw new Error("Client ID does not look like a Google OAuth client.");
      const r = await fetch(`https://www.googleapis.com/discovery/v1/apis/drive/v3/rest?key=${encodeURIComponent(c.apiKey)}`, com());
      if (!r.ok) throw new Error(`Google API ${r.status}: check the API key.`);
      return "Drive API reachable. The picker uses this client in the kanban.";
    },
  },
  // ── Dev ──
  {
    id: "github", categoria: "dev", nome: "GitHub",
    campos: [{ k: "token", tipo: "secret", rotulo: "Personal access token", placeholder: "ghp_… / github_pat_…" }],
    async testar(c) {
      const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${c.token}`, "User-Agent": "nomade-business" }, ...com() });
      const j = await json(r);
      if (!r.ok) throw new Error(j.message || `GitHub ${r.status}`);
      return `Signed in as ${j.login}.`;
    },
  },
  // ── Automação ──
  {
    id: "webhook", categoria: "automation", nome: "Webhook", sub: "Zapier · Make · n8n · custom",
    campos: [
      { k: "url", tipo: "secret", rotulo: "Webhook URL", placeholder: "https://hooks.zapier.com/…" },
      { k: "eventos", tipo: "text", rotulo: "Events (comma separated)", placeholder: "lead.created, proposal.paid, task.done" },
    ],
    async testar(c) {
      const r = await fetch(c.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "ping", source: "nomade-business", at: new Date().toISOString() }), ...com() });
      if (!r.ok) throw new Error(`Webhook ${r.status}`);
      return "Ping delivered.";
    },
  },
  {
    id: "mcp", categoria: "automation", nome: "MCP server", sub: "tools for the runners",
    campos: [
      { k: "nome", tipo: "text", rotulo: "Name", placeholder: "my-tools" },
      { k: "comando", tipo: "text", rotulo: "Command", placeholder: "npx -y @org/mcp-server" },
      { k: "env", tipo: "secret", rotulo: "Env (KEY=value, one per line)" },
    ],
    async testar(c) {
      if (!/^[a-z0-9-_]+$/i.test(c.nome || "")) throw new Error("Name: letters, numbers, - and _ only.");
      if (!String(c.comando || "").trim()) throw new Error("Command is required.");
      return "Saved. Runners pick this server up on the next `nomade runner` start.";
    },
  },
  // ── IA local ──
  {
    id: "ollama", categoria: "ai", nome: "Ollama", sub: "local models · PatricJ",
    campos: [{ k: "url", tipo: "text", rotulo: "Ollama URL", placeholder: "http://192.168.0.42:11434" }],
    async testar(c) {
      const r = await fetch(`${String(c.url || "").replace(/\/$/, "")}/api/tags`, com(6000));
      const j = await json(r);
      if (!r.ok) throw new Error(`Ollama ${r.status}`);
      const nomes = (j.models || []).map((m) => m.name);
      return nomes.length ? `${nomes.length} model(s): ${nomes.slice(0, 5).join(", ")}` : "Reachable, but no models pulled yet.";
    },
  },
];

const porId = (id) => CATALOGO.find((i) => i.id === id);

const mascara = (v) => {
  const s = String(v || "");
  if (!s) return "";
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

/* O que a tela recebe: config sem segredo (só máscara) + metadados. */
function mascarar(item, doc) {
  const cfg = {};
  for (const campo of item.campos) {
    const v = doc?.config?.[campo.k];
    if (v === undefined || v === "") continue;
    cfg[campo.k] = campo.tipo === "secret" ? mascara(v) : v;
  }
  return {
    id: item.id, categoria: item.categoria, nome: item.nome, sub: item.sub || null,
    campos: item.campos.map(({ k, tipo, rotulo, placeholder }) => ({ k, tipo, rotulo, placeholder })),
    conectada: !!doc && item.campos.some((c) => doc.config?.[c.k]),
    config: cfg,
    conectadaEm: doc?.conectadaEm || null, por: doc?.por || null,
    ultimoTeste: doc?.ultimoTeste || null,
  };
}

/* Patch da tela → config a gravar. Campo secret vazio mantém o que estava
   (a tela nunca tem o valor real pra mandar de volta). */
function mesclarConfig(item, atual = {}, body = {}) {
  const out = { ...atual };
  for (const campo of item.campos) {
    if (body[campo.k] === undefined) continue;
    const v = String(body[campo.k] ?? "").trim();
    if (campo.tipo === "secret" && !v) continue;
    out[campo.k] = v.slice(0, 4000);
  }
  return out;
}

module.exports = { CATALOGO, porId, mascarar, mesclarConfig };
