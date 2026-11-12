/* ══════════════════════════════════════════════════════════════════════════
 * MERCADO LIVRE — perguntas de anúncio e mensagens pós-venda.
 *
 * Mercado Pago não tem chat com comprador; a conversa acontece no Mercado
 * Livre, e é a mesma conta/app de developers.mercadolivre.com.br.
 *
 * O conector só sabe falar com a API. Quem guarda conversa, chama a IA e
 * decide enviar é o ai-service (seção ATENDIMENTO). Contrato:
 *   urlAutorizacao(cfg, redirect, state) → URL do login do vendedor
 *   trocarCodigo(cfg, query, redirect)   → { tokens, conta }
 *   renovar(cfg, tokens)                 → tokens novos (ou os mesmos)
 *   puxar(cfg, tokens, conta)            → [conversa normalizada]
 *   enviar(cfg, tokens, conta, conv, txt)
 *
 * Endpoints conferidos contra a documentação pública até 2026; se o ML mudar
 * algum caminho, é aqui que ajusta.
 * ══════════════════════════════════════════════════════════════════════════ */

const API = "https://api.mercadolibre.com";
const AUTH = {
  BR: "https://auth.mercadolivre.com.br", AR: "https://auth.mercadolibre.com.ar", MX: "https://auth.mercadolibre.com.mx",
  CL: "https://auth.mercadolibre.cl", CO: "https://auth.mercadolibre.com.co", UY: "https://auth.mercadolibre.com.uy",
  PE: "https://auth.mercadolibre.com.pe",
};
const com = (ms = 15_000) => ({ signal: AbortSignal.timeout(ms) });

export const id = "mercadolivre";
export const nome = "Mercado Livre";
export const campos = [
  { k: "clientId", tipo: "text", rotulo: "App ID" },
  { k: "clientSecret", tipo: "secret", rotulo: "Secret key" },
  { k: "site", tipo: "select", rotulo: "País da conta", opcoes: Object.keys(AUTH), padrao: "BR" },
];
export const precisaHttps = true; // o ML só aceita redirect https

async function chamar(caminho, token, opts = {}) {
  const r = await fetch(`${API}${caminho}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    ...com(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.message || j.error || `Mercado Livre ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

export function urlAutorizacao(cfg, redirect, state) {
  const base = AUTH[cfg.site] || AUTH.BR;
  const q = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: redirect, state });
  return `${base}/authorization?${q}`;
}

async function token(corpo) {
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(corpo),
    ...com(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.message || j.error_description || j.error || `Mercado Livre ${r.status}`);
  return { access: j.access_token, refresh: j.refresh_token, expira: Date.now() + (Number(j.expires_in) || 21600) * 1000, userId: j.user_id };
}

export async function trocarCodigo(cfg, query, redirect) {
  if (!query.code) throw new Error("O Mercado Livre não devolveu o código de autorização.");
  const tokens = await token({ grant_type: "authorization_code", client_id: cfg.clientId, client_secret: cfg.clientSecret, code: query.code, redirect_uri: redirect });
  const me = await chamar("/users/me", tokens.access);
  return { tokens, conta: { id: String(me.id), nome: me.nickname || String(me.id) } };
}

export async function renovar(cfg, tokens) {
  if (tokens?.expira && tokens.expira - Date.now() > 10 * 60_000) return tokens;
  if (!tokens?.refresh) throw new Error("Sessão do Mercado Livre expirou. Conecte de novo.");
  return token({ grant_type: "refresh_token", client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: tokens.refresh });
}

/* título do anúncio, com cache curto: dez perguntas no mesmo item = uma chamada */
const titulos = new Map();
async function tituloDoItem(itemId, tk) {
  if (!itemId) return "";
  const c = titulos.get(itemId);
  if (c && Date.now() - c.em < 3600_000) return c.t;
  try { const it = await chamar(`/items/${itemId}?attributes=title`, tk); titulos.set(itemId, { t: it.title || "", em: Date.now() }); return it.title || ""; }
  catch { return ""; }
}

export async function puxar(cfg, tokens, conta) {
  const tk = tokens.access;
  const out = [];

  // 1) perguntas sem resposta nos anúncios
  const q = await chamar(`/questions/search?seller_id=${conta.id}&status=UNANSWERED&api_version=4&sort_fields=date_created&sort_types=DESC&limit=50`, tk);
  for (const p of q.questions || []) {
    out.push({
      externoId: `q:${p.id}`,
      tipo: "pergunta",
      assunto: await tituloDoItem(p.item_id, tk),
      cliente: { id: String(p.from?.id || ""), nome: p.from?.nickname || "" },
      ref: { questionId: p.id, itemId: p.item_id },
      mensagens: [{ id: `q:${p.id}`, de: "cliente", texto: p.text || "", em: new Date(p.date_created || Date.now()) }],
    });
  }

  // 2) pós-venda: só os packs com mensagem não lida
  let pendentes = [];
  try { pendentes = (await chamar(`/messages/unread?role=seller&tag=post_sale`, tk)).results || []; }
  catch (e) { if (e.status !== 404) throw e; }
  for (const r of pendentes.slice(0, 30)) {
    const m = String(r.resource || "").match(/packs\/(\d+)/);
    if (!m) continue;
    const pack = m[1];
    let j;
    try { j = await chamar(`/messages/packs/${pack}/sellers/${conta.id}?tag=post_sale&mark_as_read=false`, tk); }
    catch (e) { if (e.status === 403) continue; throw e; } // conversa bloqueada/expirada
    const msgs = (j.messages || []).map((x) => ({
      id: String(x.id),
      de: String(x.from?.user_id) === String(conta.id) ? "empresa" : "cliente",
      texto: x.text || "",
      em: new Date(x.message_date?.created || x.date_created || Date.now()),
    })).sort((a, b) => a.em - b.em);
    const comprador = (j.messages || []).map((x) => x.from?.user_id).find((u) => u && String(u) !== String(conta.id));
    out.push({
      externoId: `pack:${pack}`,
      tipo: "pos_venda",
      assunto: `Venda ${pack}`,
      cliente: { id: String(comprador || ""), nome: "" },
      ref: { packId: pack, buyerId: comprador },
      mensagens: msgs,
    });
  }
  return out;
}

export async function enviar(cfg, tokens, conta, conv, texto) {
  const tk = tokens.access;
  if (conv.tipo === "pergunta") {
    await chamar("/answers", tk, { method: "POST", body: JSON.stringify({ question_id: conv.ref.questionId, text: texto }) });
    return { encerra: true }; // pergunta respondida some da fila do ML
  }
  if (!conv.ref?.buyerId) throw new Error("Não achei o comprador dessa venda.");
  await chamar(`/messages/packs/${conv.ref.packId}/sellers/${conta.id}?tag=post_sale`, tk, {
    method: "POST",
    body: JSON.stringify({ from: { user_id: Number(conta.id) }, to: { user_id: Number(conv.ref.buyerId) }, text: texto }),
  });
  return {};
}

/* limite do ML pra resposta de pergunta */
export const maxTexto = 2000;
