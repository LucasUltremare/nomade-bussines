/**
 * lib/emails/report-reminder.js
 * ─────────────────────────────
 * Manda toda segunda 9h pra quem ainda não submeteu o relatório da semana anterior.
 * Tom: direto, lembrete leve, sem dramaturgia.
 */
const { EMPRESA } = require("../empresa");


function renderReportReminderEmail({ name, weekLabel, reportUrl }) {
  const firstName = name ? name.split(" ")[0] : "";
  const subject = `${firstName ? firstName + ", relatório" : "Relatório"} da semana ${weekLabel}`;

  const text = `${firstName ? "Oi " + firstName : "Oi"},

Bom dia. Lembrete do relatório da semana ${weekLabel}.

Leva 2 minutos:
${reportUrl}

— Equipe ${EMPRESA.nome}`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#eef6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#051017;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef6f9;padding:40px 20px;">
  <tr>
    <td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(5,16,23,.04);">
        <tr><td style="padding:32px 36px 8px;">
          <div style="color:#051017;font-weight:700;font-size:16px;letter-spacing:-0.01em;">${EMPRESA.nome}</div>
          <div style="color:rgba(5,16,23,.4);font-size:11px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;margin-top:4px;">Relatório semanal</div>
        </td></tr>
        <tr><td style="padding:18px 36px 8px;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;letter-spacing:-0.02em;font-weight:700;color:#051017;">
            ${firstName ? firstName + ", " : ""}falta seu relatório da semana <span style="color:#0077B6;">${weekLabel}</span>.
          </h1>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:rgba(5,16,23,.65);">
            Leva ~2 minutos. Três campos: o que entregou, bloqueios, próxima semana.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="border-radius:8px;background:#0077B6;">
                <a href="${reportUrl}" style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:.2px;">
                  Preencher agora →
                </a>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 36px 28px;">
          <p style="margin:0;font-size:11px;color:rgba(5,16,23,.4);line-height:1.55;">
            Este lembrete é enviado toda segunda às 9h pra quem ainda não enviou o relatório da semana anterior.
          </p>
        </td></tr>
        <tr><td style="padding:18px 36px 24px;background:#f6fafc;border-top:1px solid rgba(5,16,23,.05);text-align:center;">
          <p style="margin:0;font-size:10px;color:rgba(5,16,23,.3);">${[EMPRESA.nome, EMPRESA.cidade, EMPRESA.site.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ")}</p>
        </td></tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { renderReportReminderEmail };
