/**
 * lib/emails/payment-confirmed.js
 * ───────────────────────────────
 * Email mandado quando um pagamento é confirmado (payment link).
 */
const { EMPRESA } = require("../empresa");


function renderPaymentConfirmedEmail({ name, amount, cycleLabel, nextDueDate }) {
  const firstName = name ? name.split(" ")[0] : "";
  const formato = require("../formato");
  const brl = (n) => formato.dinheiro(n, { idioma: "pt" });
  const nextFormatted = nextDueDate
    ? formato.data(nextDueDate, { day: "2-digit", month: "long", year: "numeric" }, "pt")
    : null;

  const subject = `Pagamento confirmado · ${EMPRESA.nome}`;

  const text = `Oi${firstName ? " " + firstName : ""},

Recebemos seu pagamento de ${brl(amount)}. Tudo certo por aqui.

${nextFormatted ? `Próxima cobrança: ${nextFormatted}` : ""}

Qualquer dúvida, é só responder este email.

— Equipe ${EMPRESA.nome}`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#051017;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef6f9;padding:40px 20px;">
  <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(5,16,23,.04);">
      <tr><td style="padding:32px 36px 8px;">
        <div style="color:#051017;font-weight:700;font-size:15px;letter-spacing:-0.01em;">${EMPRESA.nome}</div>
        <div style="color:rgba(0,168,150,.95);font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;margin-top:3px;">Pagamento confirmado</div>
      </td></tr>
      <tr><td style="padding:24px 36px 8px;text-align:center;">
        <div style="width:56px;height:56px;border-radius:28px;background:rgba(0,168,150,.12);display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <span style="font-size:28px;line-height:1;color:#00A896;">✓</span>
        </div>
        <h1 style="margin:0 0 8px;font-size:22px;line-height:1.2;letter-spacing:-0.02em;font-weight:700;color:#051017;">
          Recebemos seu pagamento
        </h1>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:rgba(5,16,23,.55);">
          Tudo certo${firstName ? ", " + firstName : ""}. Nosso time já está com tudo em andamento.
        </p>
      </td></tr>
      <tr><td style="padding:0 36px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6fafc;border-radius:12px;padding:18px 20px;">
          <tr>
            <td style="font-size:12px;color:rgba(5,16,23,.5);padding:5px 0;">Valor pago</td>
            <td align="right" style="font-size:13px;color:#051017;font-weight:600;padding:5px 0;">${brl(amount)}</td>
          </tr>
          <tr>
            <td style="font-size:12px;color:rgba(5,16,23,.5);padding:5px 0;border-top:1px solid rgba(5,16,23,.06);">Ciclo</td>
            <td align="right" style="font-size:13px;color:#051017;font-weight:500;padding:5px 0;border-top:1px solid rgba(5,16,23,.06);">${cycleLabel}</td>
          </tr>
          ${nextFormatted ? `
          <tr>
            <td style="font-size:12px;color:rgba(5,16,23,.5);padding:5px 0;border-top:1px solid rgba(5,16,23,.06);">Próxima cobrança</td>
            <td align="right" style="font-size:13px;color:#051017;font-weight:500;padding:5px 0;border-top:1px solid rgba(5,16,23,.06);">${nextFormatted}</td>
          </tr>` : ""}
        </table>
      </td></tr>
      <tr><td style="padding:20px 36px 24px;background:#f6fafc;border-top:1px solid rgba(5,16,23,.05);text-align:center;">
        <p style="margin:0;font-size:11px;color:rgba(5,16,23,.4);">
          Obrigado pela confiança. Qualquer dúvida, é só responder este email.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { renderPaymentConfirmedEmail };
