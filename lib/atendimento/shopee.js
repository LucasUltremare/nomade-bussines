/* ══════════════════════════════════════════════════════════════════════════
 * SHOPEE — chat do vendedor (Open Platform v2, sellerchat).
 *
 * Atenção: a Shopee só libera os endpoints de chat pra apps com a permissão
 * "Seller Chat" aprovada no Open Platform. Sem ela a conexão funciona, mas
 * puxar e enviar devolvem erro de permissão — a tela mostra esse erro.
 *
 * Assinatura: HMAC-SHA256(partner_key) sobre
 *   partner_id + path + timestamp                      (chamadas públicas)
 *   partner_id + path + timestamp + access_token + shop_id   (da loja)
 * ══════════════════════════════════════════════════════════════════════════ */
import crypto from "node:crypto";

const HOST = { live: "https://partner.shopeemobile.com", teste: "https://partner.test-stable.shopeemobile.com" };
const com = (ms = 15_000) => ({ signal: AbortSignal.timeout(ms) });

export const id = "shopee";
export const nome = "Shopee";
export const campos = [
  { k: "partnerId", tipo: "text", rotulo: "Partner ID" },
  { k: "partnerKey", tipo: "secret", rotulo: "Partner key" },
  { k: "ambiente", tipo: "select", rotulo: "Ambiente", opcoes: ["live", "teste"], padrao: "live" },
];
export const precisaHttps = false;

const host = (cfg) => HOST[cfg.ambiente] || HOST.live;
const ts = () => Math.floor(Date.now() / 1000);
const assinar = (cfg, base) => crypto.createHmac("sha256", String(cfg.partnerKey || "")).update(base).digest("hex");

function urlPublica(cfg, path, extra = {}) {
  const t = ts();
  const sign = assinar(cfg, `${cfg.partnerId}${path}${t}`);
  return `${host(cfg)}${path}?${new URLSearchParams({ partner_id: cfg.partnerId, timestamp: t, sign, ...extra })}`;
}

async function daLoja(cfg, tokens, conta, path, { metodo = "GET", query = {}, corpo } = {}) {
  const t = ts();
  const sign = assinar(cfg, `${cfg.partnerId}${path}${t}${tokens.access}${conta.id}`);
  const q = new URLSearchParams({ partner_id: cfg.partnerId, timestamp: t, sign, access_token: tokens.access, shop_id: conta.id, ...query });
  const r = await fetch(`${host(cfg)}${path}?${q}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    ...com(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.message || j.error || `Shopee ${r.status}`);
  return j.response || j;
}

export function urlAutorizacao(cfg, redirect, state) {
  const volta = `${redirect}${redirect.includes("?") ? "&" : "?"}state=${encodeURIComponent(state)}`;
  return urlPublica(cfg, "/api/v2/shop/auth_partner", { redirect: volta });
}

async function token(cfg, path, corpo) {
  const r = await fetch(urlPublica(cfg, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...corpo, partner_id: Number(cfg.partnerId) }),
    ...com(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || !j.access_token) throw new Error(j.message || j.error || `Shopee ${r.status}`);
  return { access: j.access_token, refresh: j.refresh_token, expira: Date.now() + (Number(j.expire_in) || 14400) * 1000 };
}

export async function trocarCodigo(cfg, query) {
  if (!query.code || !query.shop_id) throw new Error("A Shopee não devolveu código e loja.");
  const tokens = await token(cfg, "/api/v2/auth/token/get", { code: query.code, shop_id: Number(query.shop_id) });
  const conta = { id: String(query.shop_id), nome: String(query.shop_id) };
  try { const info = await daLoja(cfg, tokens, conta, "/api/v2/shop/get_shop_info"); conta.nome = info.shop_name || conta.nome; } catch { /* nome é enfeite */ }
  return { tokens, conta };
}

export async function renovar(cfg, tokens, conta) {
  if (tokens?.expira && tokens.expira - Date.now() > 10 * 60_000) return tokens;
  if (!tokens?.refresh) throw new Error("Sessão da Shopee expirou. Conecte de novo.");
  return token(cfg, "/api/v2/auth/access_token/get", { refresh_token: tokens.refresh, shop_id: Number(conta.id) });
}

export async function puxar(cfg, tokens, conta) {
  const lista = await daLoja(cfg, tokens, conta, "/api/v2/sellerchat/get_conversation_list", { query: { direction: "latest", type: "unread", page_size: 20 } });
  const out = [];
  for (const c of (lista.conversations || []).slice(0, 20)) {
    const m = await daLoja(cfg, tokens, conta, "/api/v2/sellerchat/get_message", { query: { conversation_id: c.conversation_id, page_size: 20 } });
    const msgs = (m.messages || [])
      .filter((x) => x.message_type === "text" && x.content?.text)
      .map((x) => ({
        id: String(x.message_id),
        de: String(x.from_shop_id || "") === String(conta.id) || String(x.from_id) === String(conta.id) ? "empresa" : "cliente",
        texto: x.content.text,
        em: new Date((Number(x.created_timestamp) || ts()) * 1000),
      }))
      .sort((a, b) => a.em - b.em);
    out.push({
      externoId: `conv:${c.conversation_id}`,
      tipo: "chat",
      assunto: "",
      cliente: { id: String(c.to_id || ""), nome: c.to_name || "" },
      ref: { conversationId: String(c.conversation_id), toId: c.to_id },
      mensagens: msgs,
    });
  }
  return out;
}

export async function enviar(cfg, tokens, conta, conv, texto) {
  await daLoja(cfg, tokens, conta, "/api/v2/sellerchat/send_message", {
    metodo: "POST",
    corpo: { to_id: Number(conv.ref.toId), message_type: "text", content: { text: texto } },
  });
  return {};
}

export const maxTexto = 1000;
