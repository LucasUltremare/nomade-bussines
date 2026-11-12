/**
 * lib/proposta-page — PÁGINA PÚBLICA DA PROPOSTA (HTML server-side)
 * ──────────────────────────────────────────────────────────────────
 * Portada do vlad-proposta: mesmo visual (Sora, off-white, pilares com
 * accents rotativos, card escuro de investimento), com duas mudanças:
 *
 *   · o bloco de Pix direto (QR + copia e cola na conta pessoal) virou
 *     um botão de pagamento que cai no /pagar/:token —
 *     Mercado Pago, com webhook marcando pago sozinho;
 *   · o investimento agora mostra a itemização (o que compõe o valor).
 *
 * A página continua sem JS de propósito: o botão de pagar é um <a> que
 * passa por GET /proposta/:token/pagar (registra o aceite) e redireciona
 * pro checkout. Funciona em qualquer webview de WhatsApp.
 */

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const formato = require("./formato");
const brl = (n) => formato.dinheiro(n, { casas: 0, idioma: "pt" });

const { EMPRESA, marcaHtml } = require("./empresa");
const WAVE = marcaHtml(24);

const ACCENTS = ["#0077B6", "#14b8a6", "#f97316", "#8b5cf6"];

const BRAND = {
  name: EMPRESA.nome,
  tagline: EMPRESA.slogan,
  email: EMPRESA.email,
  site: EMPRESA.site.replace(/^https?:\/\//, ""),
  location: EMPRESA.cidade,
};

const dateLabel = (d) => {
  const dt = d ? new Date(d) : new Date();
  const mes = formato.data(dt, { month: "long" }, "pt");
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} · ${dt.getFullYear()}`;
};

/**
 * @param {object} p — doc de nomade_propostas
 * @param {object} opts — { baseUrl }
 */
function renderPropostaPage(p, opts = {}) {
  const c = p.conteudo || {};
  const mensal = p.mode === "mensal";
  const total = Number(p.total) || 0;
  const isDraft = p.status === "draft";
  const isPaid = p.status === "paid";
  const expired = !isPaid && p.validUntil && new Date(p.validUntil) < new Date();

  const ogTitle = `Proposta — ${p.cliente?.nome || "Cliente"}${c.subtitle ? ` · ${c.subtitle}` : ""}`;
  const ogDesc = `${brl(total)}${mensal ? "/mês" : ""} · ${(c.intro || `Proposta comercial ${BRAND.name}`).slice(0, 150)}`;
  const url = `${(opts.baseUrl || "").replace(/\/$/, "")}/proposta/${p.token}`;

  /* ── pilares ── */
  const sections = (c.sections || []).map((s, i) => {
    const ac = ACCENTS[i % ACCENTS.length];
    const items = (s.items || []).map((it) =>
      `<li><span class="dot" style="background:${ac}"></span><span>${esc(it)}</span></li>`).join("");
    return `<div class="pillar"><span class="ptop" style="background:${ac}"></span>
      ${s.label ? `<div class="plabel">${esc(s.label)}</div>` : ""}
      <h3>${esc(s.title)}</h3>
      ${s.desc ? `<p class="pdesc">${esc(s.desc)}</p>` : ""}
      <ul>${items}</ul></div>`;
  }).join("");

  const extra = c.extra ? `<div class="extra">
      <span class="ptop" style="background:${ACCENTS[2]}"></span>
      <div class="exhead"><h3>${esc(c.extra.title)}</h3>${c.extra.badge ? `<span class="badge">${esc(c.extra.badge)}</span>` : ""}</div>
      ${c.extra.desc ? `<p class="pdesc">${esc(c.extra.desc)}</p>` : ""}
      <ul class="excols">${(c.extra.items || []).map((it) => `<li><span class="dot" style="background:${ACCENTS[1]}"></span><span>${esc(it)}</span></li>`).join("")}</ul>
    </div>` : "";

  const naoIncluido = (c.naoIncluido || []).length ? `<div class="nao">
      <div class="nao-l">O que não está incluso</div>
      <ul>${c.naoIncluido.map((it) => `<li>${esc(it)}</li>`).join("")}</ul>
    </div>` : "";

  const highlights = (c.highlights || []).length
    ? `<div class="hl">${c.highlights.map((h) => `<div class="hlc"><span class="hlk">${esc(h.k)}</span><span class="hlv">${esc(h.v)}</span></div>`).join("")}</div>`
    : "";

  /* ── investimento: itens + total ── */
  const itemRows = (p.itens || []).map((it) => `<div class="irow">
      <span class="irow-d">${esc(it.descricao)}${it.quantidade > 1 ? ` <em>· ${it.quantidade} × ${brl(it.valorUnitario)}</em>` : ""}</span>
      <span class="irow-v">${brl(it.quantidade * it.valorUnitario)}</span>
    </div>`).join("");

  // Mensalidade só aparece quando VOCÊ definiu explicitamente (campo mensalInfo).
  // A faixa que a IA sugere (operacaoMensal) NÃO força nada na página — antes ela
  // aparecia sozinha e virava "mensalidade forçada".
  let mensalNote = "";
  if (!mensal) {
    const mi = Number(p.mensalInfo) || 0;
    if (mi > 0) mensalNote = `+ ${brl(mi)}/mês de operação após a entrega`;
  }
  const pnote = [
    mensal ? "por mês" : "pagamento único",
    mensalNote,
    p.observacoes ? esc(p.observacoes) : "",
  ].filter(Boolean).join(" · ");

  /* ── bloco de pagamento (substitui o Pix do vlad) ── */
  const entrada = p.split && !mensal ? Math.round(total / 2) : total;
  const restante = p.split && !mensal ? total - entrada : 0;
  const payLabel = mensal
    ? `Pagar 1ª mensalidade — ${brl(total)}`
    : p.split
      ? `Pagar entrada (50%) — ${brl(entrada)}`
      : `Pagar agora — ${brl(total)}`;

  // Plano mensal já pago com a mensalidade do mês em aberto → volta a ter botão
  const aberta = isPaid && mensal ? opts.mensalidadeAberta : null;

  let payBlock = "";
  if (aberta) {
    payBlock = `<div class="paywrap" id="pagar">
      <a class="paybtn" href="/pagar/${esc(aberta.token)}">${esc(`Pagar ${aberta.n}ª mensalidade — ${brl(total)}`)}</a>
      <div class="payfoot">Pagamento processado pelo <b>Mercado Pago</b> — Pix ou boleto, em ambiente seguro.</div>
    </div>`;
  } else if (isPaid) {
    payBlock = `<div class="paywrap"><div class="paid">Pagamento confirmado. Obrigado!</div></div>`;
  } else if (isDraft) {
    payBlock = "";
  } else if (expired) {
    payBlock = `<div class="paywrap"><div class="expired">Esta proposta expirou. Fale com a gente pra renovar${BRAND.email ? `: <b>${esc(BRAND.email)}</b>` : "."}</div></div>`;
  } else if (p.paymentLinkToken) {
    payBlock = `<div class="paywrap" id="pagar">
      <a class="paybtn" href="/proposta/${esc(p.token)}/pagar">${esc(payLabel)}</a>
      ${restante > 0 ? `<div class="paylater">Restante <b>${brl(restante)}</b> (50%) na entrega do projeto — o link de pagamento chega na conclusão.</div>` : ""}
      <div class="payfoot">Pagamento processado pelo <b>Mercado Pago</b> — Pix ou boleto, em ambiente seguro.</div>
    </div>`;
  }

  const previewBanner = isDraft
    ? `<div class="preview">PRÉVIA — esta proposta ainda não foi publicada. O link e o pagamento ficam ativos ao publicar.</div>`
    : "";

  const validade = p.validUntil
    ? `Válida até ${formato.data(p.validUntil, { day: "2-digit", month: "2-digit" }, "pt")}`
    : `Válida por ${p.validadeDias || 15} dias`;

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(ogDesc)}"/>
<meta property="og:type" content="website"/>
${url ? `<meta property="og:url" content="${esc(url)}"/>` : ""}
<meta property="og:title" content="${esc(ogTitle)}"/>
<meta property="og:description" content="${esc(ogDesc)}"/>
<meta property="og:site_name" content="${esc(BRAND.name)}"/>
<meta name="twitter:card" content="summary"/>
<meta name="twitter:title" content="${esc(ogTitle)}"/>
<meta name="twitter:description" content="${esc(ogDesc)}"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
  :root{--ink:#16181d;--mut:#5d6470;--faint:#9aa0ac;--blue:#0077B6;--bg:#f7f6f2;--card:#fff;--line:rgba(20,22,28,.09)}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);font-family:"Sora",system-ui,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5;padding:0 0 120px}
  .wrap{max-width:880px;margin:0 auto;padding:38px 28px 0}
  .preview{background:#fef3c7;color:#92400e;font-size:12.5px;font-weight:600;text-align:center;padding:10px 16px;letter-spacing:.02em}
  .top{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid var(--line)}
  .brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:17px;letter-spacing:-.01em}
  .tagline{color:var(--faint);font-size:13px}
  .eyebrow{color:var(--blue);font-size:11.5px;letter-spacing:.14em;font-weight:600;text-transform:uppercase}
  .head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-top:30px}
  h1{font-size:48px;font-weight:700;letter-spacing:-.02em;line-height:1.02;margin:6px 0 2px}
  .subt{color:var(--mut);font-size:16px}
  .meta{text-align:right;flex-shrink:0;padding-top:4px}
  .meta b{display:block;font-size:14px;font-weight:600}
  .meta span{font-size:12.5px;color:var(--faint)}
  .intro{margin-top:30px;background:rgba(47,109,246,.05);border-left:3px solid var(--blue);border-radius:0 12px 12px 0;padding:18px 22px}
  .intro p{margin-top:8px;font-size:15px;color:#2b2f37;max-width:64ch}
  .sec-h{display:flex;align-items:center;gap:14px;margin:38px 0 18px;font-size:22px;font-weight:600}
  .sec-h::after{content:"";flex:1;height:1px;background:var(--line)}
  .pillars{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .pillar,.extra{position:relative;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 18px;overflow:hidden}
  .ptop{position:absolute;top:0;left:0;right:0;height:3px}
  .plabel{color:var(--faint);font-size:11px;letter-spacing:.12em;font-weight:600;text-transform:uppercase;margin-bottom:6px}
  .pillar h3,.extra h3{font-size:18px;font-weight:600}
  .pdesc{color:var(--mut);font-size:13.5px;margin:7px 0 13px;max-width:46ch}
  ul{list-style:none;display:flex;flex-direction:column;gap:9px}
  li{display:flex;gap:10px;font-size:13.5px;align-items:flex-start}
  .dot{width:6px;height:6px;border-radius:50%;margin-top:7px;flex-shrink:0}
  .extra{margin-top:16px}
  .exhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .badge{font-size:10.5px;letter-spacing:.1em;font-weight:600;text-transform:uppercase;color:#c2410c;background:rgba(249,115,22,.12);padding:4px 9px;border-radius:6px}
  .excols{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:9px 22px}
  .nao{margin-top:16px;border:1px dashed var(--line);border-radius:14px;padding:16px 18px}
  .nao-l{color:var(--faint);font-size:11px;letter-spacing:.12em;font-weight:600;text-transform:uppercase;margin-bottom:8px}
  .nao li{color:var(--mut);display:list-item;list-style:none;font-size:13px}
  .nao li::before{content:"—";margin-right:8px;color:var(--faint)}
  .invest{margin-top:30px;background:linear-gradient(120deg,#14161b,#1d2027);color:#fff;border-radius:18px;padding:30px 30px}
  .invest .eyebrow{color:#9aa3b2}
  .irow{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:13.5px}
  .irow-d{color:#c3c9d4}
  .irow-d em{color:#7d8594;font-style:normal;font-size:12px}
  .irow-v{color:#e8ebf0;font-weight:600;white-space:nowrap}
  .irows{margin:18px 0 6px}
  .price{font-size:58px;font-weight:700;letter-spacing:-.02em;line-height:1;margin-top:14px}
  .price small{font-size:24px;font-weight:600;color:#c3c9d4}
  .pnote{color:#9aa3b2;font-size:13px;margin-top:8px;max-width:60ch}
  .paywrap{margin-top:24px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px 24px;text-align:center}
  .paybtn{display:inline-block;background:var(--blue);color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:15px 34px;border-radius:12px;letter-spacing:-.01em}
  .paybtn:hover{background:#2258d6}
  .paylater{margin-top:16px;color:var(--mut);font-size:13.5px;background:rgba(47,109,246,.05);border-radius:10px;padding:12px 16px}
  .payfoot{margin-top:16px;color:var(--faint);font-size:12.5px}
  .paid{color:#0f766e;font-weight:600;font-size:16px;background:rgba(20,184,166,.08);border-radius:12px;padding:18px}
  .expired{color:#92400e;font-size:14px;background:#fef3c7;border-radius:12px;padding:18px}
  .hl{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:34px;padding-top:22px;border-top:1px solid var(--line);text-align:center}
  .hlk{display:block;color:var(--faint);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase}
  .hlv{display:block;font-weight:600;font-size:14px;margin-top:3px}
  .foot{margin-top:26px;padding-top:14px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;color:var(--faint);font-size:12.5px;flex-wrap:wrap}
  @media(max-width:680px){
    .wrap{padding:26px 18px 0}
    h1{font-size:36px}
    .pillars,.excols,.hl{grid-template-columns:1fr}
    .head{flex-direction:column}
    .meta{text-align:left}
    .price{font-size:46px}
    .invest{padding:24px 22px}
    .paybtn{display:block}
  }
</style>
</head><body>
${previewBanner}
<div class="wrap">
  <div class="top"><div class="brand">${WAVE}<span>${esc(BRAND.name)}</span></div><div class="tagline">${esc(BRAND.tagline)}</div></div>

  <div class="head">
    <div>
      <div class="eyebrow">Proposta Comercial</div>
      <h1>${esc(p.cliente?.nome || "Cliente")}</h1>
      ${c.subtitle ? `<div class="subt">${esc(c.subtitle)}</div>` : ""}
    </div>
    <div class="meta"><b>${esc(dateLabel(p.publishedAt || p.createdAt))}</b><span>${esc(validade)}</span></div>
  </div>

  ${c.intro ? `<div class="intro"><div class="eyebrow">O que vamos resolver</div><p>${esc(c.intro)}</p></div>` : ""}

  ${sections ? `<div class="sec-h">A solução</div><div class="pillars">${sections}</div>` : ""}
  ${extra}
  ${naoIncluido}

  <div class="invest">
    <div class="eyebrow">Investimento${mensal ? " mensal" : ""}</div>
    ${itemRows ? `<div class="irows">${itemRows}</div>` : ""}
    <div class="price">${brl(total)}${mensal ? `<small>/mês</small>` : ""}</div>
    ${pnote ? `<div class="pnote">${pnote}</div>` : ""}
  </div>

  ${payBlock}

  ${highlights}

  <div class="foot"><span>${esc([BRAND.name, BRAND.location].filter(Boolean).join(" · "))}</span><span>${esc([BRAND.email, BRAND.site].filter(Boolean).join(" · "))}</span></div>
</div>
</body></html>`;
}

function propostaNotFoundPage() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Proposta não encontrada</title><style>body{font-family:system-ui,sans-serif;background:#f7f6f2;color:#16181d;display:grid;place-items:center;height:100vh;margin:0}div{text-align:center}p{color:#5d6470}</style></head><body><div><h1>Proposta não encontrada</h1><p>Esse link expirou ou não existe.</p></div></body></html>`;
}

module.exports = { renderPropostaPage, propostaNotFoundPage };
