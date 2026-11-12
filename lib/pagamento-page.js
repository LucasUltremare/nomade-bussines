/**
 * lib/pagamento-page — PÁGINA PÚBLICA DE PAGAMENTO (HTML server-side)
 * ─────────────────────────────────────────────────────────────────────
 * /pagar/:token mostra o resumo combinado e o botão do Mercado Pago.
 * Mesmo espírito da página de proposta: sem JS, abre em qualquer webview
 * de WhatsApp, marca da empresa vinda do .env (lib/empresa.js).
 *
 * renderPagamento(link)        → a página com o resumo e o botão
 * renderPagamentoErro(motivo)  → link inexistente, expirado, cancelado ou pago
 * renderPagamentoRetorno(q)    → pra onde o Mercado Pago devolve o cliente
 */
const { EMPRESA, PRODUTO, marcaHtml } = require("./empresa");

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const { dinheiro } = require("./formato");
const brl = (n) => dinheiro(n, { idioma: "pt" });
const CICLO = { mensal: "Mensal", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual", unico: "Único" };

const CSS = `
:root{--bg:#f6f4ef;--card:#fff;--ink:#14171a;--soft:#5b6168;--line:rgba(20,23,26,.1);--ac:${EMPRESA.cor}}
*{box-sizing:border-box}html,body{margin:0}
body{min-height:100vh;background:var(--bg);color:var(--ink);font:400 16px/1.55 Sora,system-ui,sans-serif;padding:0 20px 64px}
.top{max-width:560px;margin:0 auto;padding:26px 0;display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.01em}
.card{max-width:560px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:22px;padding:30px 28px;box-shadow:0 24px 60px rgba(20,23,26,.07)}
.tag{display:inline-flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
.tag i{width:7px;height:7px;border-radius:50%;background:var(--ac)}
h1{margin:12px 0 6px;font-size:30px;line-height:1.1;letter-spacing:-.03em;font-weight:600}
.sub{margin:0;color:var(--soft)}
.sec{margin-top:24px;padding-top:20px;border-top:1px solid var(--line)}
.lbl{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--soft);margin-bottom:8px}
.desc{white-space:pre-line}
.line{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:12px 0}
.line+.line{border-top:1px dashed var(--line)}
.ll{font-weight:600}.ls{font-size:13px;color:var(--soft)}
.lv{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
.lv small{font-weight:400;color:var(--soft)}
.total{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin-top:12px;padding:18px;border-radius:16px;background:var(--ink);color:#fff}
.total .ls{color:rgba(255,255,255,.65)}
.tv{font-size:28px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
.cta{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:20px;padding:16px;border-radius:999px;background:var(--ac);color:#fff;font-weight:600;text-decoration:none}
.cta:focus-visible{outline:3px solid var(--ink);outline-offset:3px}
.trust{margin-top:16px;display:grid;gap:6px;font-size:13px;color:var(--soft)}
.aviso{margin-top:20px;padding:14px 16px;border-radius:14px;background:#fff4e5;color:#7a4a00;font-size:14px}
.foot{max-width:560px;margin:22px auto 0;font-size:13px;color:var(--soft);text-align:center}
@media(max-width:480px){.card{padding:24px 20px}h1{font-size:26px}.tv{font-size:24px}}`;

function casca(titulo, corpo) {
  const contato = [EMPRESA.email, EMPRESA.site.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
<title>${esc(titulo)} · ${esc(EMPRESA.nome)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600&display=swap" rel="stylesheet"/>
<style>${CSS}</style></head><body>
<header class="top">${marcaHtml(26)}<span>${esc(EMPRESA.nome)}</span></header>
${corpo}
<p class="foot">${esc(contato)}</p>
</body></html>`;
}

function renderPagamento(link) {
  const p = link.pricing || {};
  const ciclo = CICLO[link.cycle] || link.cycle || "";
  const assinaturaCartao = link.paymentMethod === "card" && link.cycle === "mensal";
  const metade1 = link.setupPaymentMode === "half" && link.setupPart === "first";
  const metade2 = link.setupPaymentMode === "half" && link.setupPart === "second";
  const nome = String(link.name || "").trim().split(/\s+/)[0];

  const linhas = [];
  if (Number(p.buildAmount) > 0) {
    linhas.push(`<div class="line"><div><div class="ll">${metade1 ? "Projeto · 1ª metade" : metade2 ? "Projeto · 2ª metade (entrega)" : "Projeto"}</div>
      <div class="ls">${metade1 ? "metade agora · o restante na entrega" : metade2 ? "metade final · entrega do projeto" : "pagamento único"}</div></div>
      <div class="lv">${brl(p.buildAmount)}</div></div>`);
  }
  if (Number(p.monthlyAmount) > 0) {
    linhas.push(`<div class="line"><div><div class="ll">Recorrência ${esc(ciclo.toLowerCase())}</div>
      <div class="ls">${assinaturaCartao ? "cobrança automática no cartão · cancela quando quiser" : `${p.cycleMonths === 1 ? "mensal" : `${esc(p.cycleMonths)} meses`} · pix ou boleto`}</div></div>
      <div class="lv">${brl(p.monthlyAmount)}<small>/mês</small></div></div>`);
  }
  const totalSub = assinaturaCartao
    ? `+ ${brl(p.monthlyAmount)}/mês recorrente`
    : Number(p.monthlyAmount) > 0
      ? `${esc(ciclo.toLowerCase())} adiantado · próxima cobrança em ${esc(p.cycleMonths)} ${p.cycleMonths === 1 ? "mês" : "meses"}`
      : "pagamento único";

  const botao = link.mp_init_point
    ? `<a class="cta" href="${esc(link.mp_init_point)}" rel="noopener">Pagar com Mercado Pago <span aria-hidden="true">→</span></a>
       <div class="trust"><span>Pagamento processado pelo Mercado Pago</span><span>A confirmação chega no seu email</span></div>`
    : `<div class="aviso">O link de pagamento ainda não foi gerado. Fale com a ${esc(EMPRESA.nome)}${EMPRESA.email ? ` em <b>${esc(EMPRESA.email)}</b>` : ""}.</div>`;

  return casca("Pagamento", `<main class="card">
  <div class="tag"><i></i>Pagamento combinado</div>
  <h1>Olá${nome ? `, ${esc(nome)}` : ""}.</h1>
  <p class="sub">Conforme combinado com a ${esc(EMPRESA.nome)}. Confira o resumo e finalize o pagamento.</p>
  ${link.description ? `<div class="sec"><div class="lbl">O que está incluso</div><div class="desc">${esc(link.description)}</div></div>` : ""}
  <div class="sec">${linhas.join("")}
    <div class="total"><div><div class="ll">${assinaturaCartao ? "Cobrança agora" : "Total a pagar agora"}</div><div class="ls">${totalSub}</div></div>
    <div class="tv">${brl(p.chargeNow)}</div></div>
  </div>
  ${botao}
</main>`);
}

const MOTIVOS = {
  not_found: ["Link indisponível", "Esse link não existe ou foi removido."],
  expired: ["Link expirado", "Peça um novo link pra equipe."],
  cancelled: ["Link cancelado", "Esse link de pagamento foi cancelado."],
  already_paid: ["Pagamento já feito", "Esse pagamento já foi processado. Obrigado!"],
};
function renderPagamentoErro(motivo) {
  const [titulo, texto] = MOTIVOS[motivo] || ["Algo deu errado", "Tente de novo daqui a pouco."];
  return casca(titulo, `<main class="card"><div class="tag"><i></i>${esc(PRODUTO)}</div><h1>${esc(titulo)}</h1><p class="sub">${esc(texto)}${EMPRESA.email ? ` Contato: <b>${esc(EMPRESA.email)}</b>` : ""}</p></main>`);
}

/* Volta do checkout. O Mercado Pago manda o status na query; quem confirma de
 * verdade é o webhook, então aqui é só o recado pra pessoa. */
function renderPagamentoRetorno(q = {}) {
  const falhou = q.failed === "1" || q.status === "rejected" || q.collection_status === "rejected";
  const pendente = q.status === "pending" || q.collection_status === "pending" || q.collection_status === "in_process";
  const [titulo, texto] = falhou
    ? ["Pagamento não concluído", "O Mercado Pago não aprovou o pagamento. Você pode tentar de novo pelo mesmo link."]
    : pendente
      ? ["Pagamento em processamento", "Assim que o Mercado Pago confirmar, a confirmação chega no seu email."]
      : ["Pagamento recebido", "Obrigado! A confirmação chega no seu email em instantes."];
  return casca(titulo, `<main class="card"><div class="tag"><i></i>${esc(EMPRESA.nome)}</div><h1>${esc(titulo)}</h1><p class="sub">${esc(texto)}</p></main>`);
}

module.exports = { renderPagamento, renderPagamentoErro, renderPagamentoRetorno };
