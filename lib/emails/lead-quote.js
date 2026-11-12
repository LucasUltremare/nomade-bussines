/**
 * lib/emails/lead-quote.js
 * ────────────────────────
 * Proposta enviada pro lead após admin aprovar o orçamento gerado pela IA.
 * Tom: profissional, direto, estilo brand premium (Stripe / Mercury / Linear).
 */
const { EMPRESA } = require("../empresa");


function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
function brl(n) {
  return require("../formato").dinheiro(n, { casas: 0, idioma: "pt" });
}

const COMPLEXITY_LABEL = {
  simples: "Escopo enxuto",
  medio: "Escopo intermediário",
  complexo: "Escopo robusto",
};

function renderLeadQuoteEmail({ lead, quote, siteUrl }) {
  const firstName = (lead.name || "").split(" ")[0];
  const fv = quote.faixaValor || {};
  const subject = `${firstName ? firstName + ", sua" : "Sua"} proposta inicial · ${EMPRESA.nome}`;

  const text = [
    `${firstName ? "Oi " + firstName : "Oi"},`,
    "",
    "Recebemos seu desafio. Aqui vai uma estimativa inicial pra alinhar expectativas — não é proposta fechada, é o ponto de partida pra uma conversa.",
    "",
    `RESUMO`,
    quote.resumo,
    "",
    `ESCOPO INCLUÍDO`,
    quote.escopo.map(s => `• ${s}`).join("\n"),
    "",
    quote.naoIncluido?.length ? `NÃO INCLUÍDO\n${quote.naoIncluido.map(s => `• ${s}`).join("\n")}\n` : "",
    `PRAZO ESTIMADO: ${quote.prazo}`,
    `BUILD: ${brl(fv.buildMin)} – ${brl(fv.buildMax)}`,
    `OPERAÇÃO MENSAL: ${brl(fv.operacaoMensalMin)} – ${brl(fv.operacaoMensalMax)} /mês`,
    "",
    `PRÓXIMOS PASSOS`,
    quote.proximosPassos.map((s, i) => `${i+1}. ${s}`).join("\n"),
    "",
    "Topa marcar uma conversa pra detalhar? Responde esse email com 2-3 horários da semana.",
    "",
    `— Equipe ${EMPRESA.nome}`,
  ].filter(Boolean).join("\n");

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#051017;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef6f9;padding:30px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(5,16,23,.06);">

      <tr><td style="padding:32px 36px 8px;">
        <div style="color:#051017;font-weight:700;font-size:16px;">${EMPRESA.nome}</div>
        <div style="color:rgba(5,16,23,.4);font-size:11px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;margin-top:4px;">Proposta inicial</div>
      </td></tr>

      <tr><td style="padding:14px 36px 18px;">
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;letter-spacing:-0.02em;font-weight:700;color:#051017;">
          ${firstName ? escapeHtml(firstName) + ", aqui vai" : "Aqui vai"} uma estimativa inicial.
        </h1>
        <p style="margin:0;font-size:14px;line-height:1.65;color:rgba(5,16,23,.65);">
          Não é proposta fechada — é o ponto de partida pra uma conversa. A ideia é alinhar
          expectativas (escopo, prazo, faixa de valor) antes de gastar tempo de ninguém.
        </p>
      </td></tr>

      ${quote.complexidade ? `
      <tr><td style="padding:0 36px 8px;">
        <span style="display:inline-block;padding:4px 12px;border-radius:50px;background:rgba(0,119,182,.08);color:#0077B6;font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">
          ${escapeHtml(COMPLEXITY_LABEL[quote.complexidade] || quote.complexidade)}
        </span>
      </td></tr>` : ""}

      <tr><td style="padding:18px 36px 8px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.5);margin-bottom:6px;">Resumo</div>
        <div style="font-size:14.5px;line-height:1.6;color:rgba(5,16,23,.78);">${escapeHtml(quote.resumo)}</div>
      </td></tr>

      <tr><td style="padding:18px 36px 8px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.5);margin-bottom:8px;">Escopo incluído</div>
        ${quote.escopo.map(s => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:5px 0;font-size:14px;line-height:1.55;color:rgba(5,16,23,.78);">
            <span style="flex-shrink:0;color:#00A896;font-weight:700;">✓</span>
            <span>${escapeHtml(s)}</span>
          </div>
        `).join("")}
      </td></tr>

      ${quote.naoIncluido?.length ? `
      <tr><td style="padding:14px 36px 8px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.5);margin-bottom:8px;">Não incluído</div>
        ${quote.naoIncluido.map(s => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:5px 0;font-size:13.5px;line-height:1.55;color:rgba(5,16,23,.55);">
            <span style="flex-shrink:0;color:#d4654a;font-weight:700;">×</span>
            <span>${escapeHtml(s)}</span>
          </div>
        `).join("")}
      </td></tr>` : ""}

      <tr><td style="padding:22px 36px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,rgba(0,119,182,.05),rgba(0,168,150,.04));border:1px solid rgba(0,119,182,.14);border-radius:12px;">
          <tr>
            <td style="padding:18px 22px;">
              <div style="font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.45);margin-bottom:4px;">Prazo estimado</div>
              <div style="font-family:-apple-system,sans-serif;font-weight:700;font-size:18px;color:#051017;letter-spacing:-0.01em;">${escapeHtml(quote.prazo)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 22px;border-top:1px solid rgba(0,119,182,.12);">
              <div style="font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.45);margin-bottom:4px;">Build (one-shot)</div>
              <div style="font-weight:700;font-size:20px;color:#051017;letter-spacing:-0.015em;">${brl(fv.buildMin)} – ${brl(fv.buildMax)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 22px;border-top:1px solid rgba(0,119,182,.12);">
              <div style="font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.45);margin-bottom:4px;">Operação mensal</div>
              <div style="font-weight:700;font-size:20px;color:#051017;letter-spacing:-0.015em;">${brl(fv.operacaoMensalMin)} – ${brl(fv.operacaoMensalMax)}<span style="font-weight:400;font-size:13px;color:rgba(5,16,23,.4);"> /mês</span></div>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:22px 36px 8px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.5);margin-bottom:8px;">Próximos passos</div>
        ${quote.proximosPassos.map((s, i) => `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:6px 0;font-size:14px;line-height:1.55;color:rgba(5,16,23,.78);">
            <span style="flex-shrink:0;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:11px;color:#0077B6;letter-spacing:.5px;padding-top:2px;">0${i+1}</span>
            <span>${escapeHtml(s)}</span>
          </div>
        `).join("")}
      </td></tr>

      <tr><td style="padding:24px 36px 28px;">
        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:rgba(5,16,23,.7);">
          <strong>Topa uma conversa de 30min?</strong> Responde esse email com 2-3 horários da próxima semana
          que a gente alinha o resto.
        </p>
        ${siteUrl ? `<a href="${siteUrl}" style="display:inline-block;padding:11px 22px;background:#051017;color:#fff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px;">${EMPRESA.site.replace(/^https?:\/\//, "")} →</a>` : ""}
      </td></tr>

      <tr><td style="padding:18px 36px 24px;background:#f6fafc;border-top:1px solid rgba(5,16,23,.05);">
        <p style="margin:0;font-size:11px;color:rgba(5,16,23,.4);line-height:1.5;">
          Faixa de valor é estimativa baseada na descrição que você nos passou. Vai pra cima ou pra baixo conforme a gente entende melhor o problema na call.
        </p>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-size:10px;color:rgba(5,16,23,.3);">${[EMPRESA.nome, EMPRESA.cidade, EMPRESA.site.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ")}</p>
  </td></tr>
</table>
</body></html>`;

  return { subject, html, text };
}

module.exports = { renderLeadQuoteEmail };
