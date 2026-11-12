/**
 * lib/emails/new-lead.js
 * ──────────────────────
 * Notifica admin quando chega lead novo (form clássico ou chat).
 * Mostra a transcrição do chat se existir.
 */
const { EMPRESA } = require("../empresa");


function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
function nl2br(s) { return escapeHtml(s).replace(/\n/g, "<br/>"); }

function fmtDateTime(d) {
  return require("../formato").dataHora(d, undefined, "pt");
}

function renderNewLeadEmail({ lead, adminUrl }) {
  const isChat = Array.isArray(lead.transcript) && lead.transcript.length > 0;
  const contactLine = lead.contactType === "whatsapp"
    ? `WhatsApp: ${lead.contactValue}`
    : `Email: ${lead.contactValue || lead.email}`;

  const subject = isChat
    ? `Novo lead via chat${lead.name ? ` · ${lead.name}` : ""}`
    : `Novo lead${lead.name ? ` · ${lead.name}` : ""}${lead.company ? ` (${lead.company})` : ""}`;

  // Plain text
  const transcriptText = isChat
    ? lead.transcript.map(m => `${m.role === "ai" ? EMPRESA.nome : "Cliente"}: ${m.text}`).join("\n\n")
    : "";

  const text = [
    `Novo lead — ${fmtDateTime(lead.createdAt || Date.now())}`,
    "",
    contactLine,
    lead.name ? `Nome: ${lead.name}` : null,
    lead.company ? `Empresa: ${lead.company}` : null,
    lead.msg ? `\nMensagem:\n${lead.msg}` : null,
    isChat ? `\nTranscrição:\n${transcriptText}` : null,
    "",
    `Origem: ${lead.source || "—"}`,
    adminUrl ? `\nVer no admin: ${adminUrl}` : null,
  ].filter(Boolean).join("\n");

  // Transcrição como bolhas no HTML
  const transcriptHtml = isChat ? lead.transcript.map(m => {
    const isAi = m.role === "ai";
    return `
      <tr><td style="padding:6px 0;">
        <div style="display:flex;${isAi ? "" : "justify-content:flex-end;"}">
          <div style="
            max-width:78%;
            padding:10px 14px;
            border-radius:14px;
            background:${isAi ? "#f6f0e3" : "#0077B6"};
            color:${isAi ? "#051017" : "#fff"};
            font-size:13px;
            line-height:1.55;
            ${isAi ? "border-bottom-left-radius:4px;" : "border-bottom-right-radius:4px;"}
          ">${nl2br(m.text)}</div>
        </div>
      </td></tr>
    `;
  }).join("") : "";

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#051017;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef6f9;padding:30px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(5,16,23,.04);">
      <tr><td style="padding:30px 32px 12px;">
        <div style="color:#051017;font-weight:700;font-size:16px;">${EMPRESA.nome}</div>
        <div style="color:rgba(5,16,23,.4);font-size:11px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;margin-top:4px;">
          ${isChat ? "Lead via chat" : "Novo lead"}
        </div>
      </td></tr>

      <tr><td style="padding:6px 32px 18px;">
        <h1 style="margin:0 0 6px;font-size:22px;line-height:1.25;letter-spacing:-0.02em;font-weight:700;color:#051017;">
          ${lead.name ? escapeHtml(lead.name) : "Lead novo"}${lead.company ? ` <span style="color:rgba(5,16,23,.5);font-weight:500;font-size:15px;">· ${escapeHtml(lead.company)}</span>` : ""}
        </h1>
        <div style="font-size:13px;color:rgba(5,16,23,.55);">
          ${escapeHtml(contactLine)}
        </div>
      </td></tr>

      ${isChat ? `
      <tr><td style="padding:8px 32px 18px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.45);margin-bottom:10px;">Conversa</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${transcriptHtml}
        </table>
      </td></tr>
      ` : (lead.msg ? `
      <tr><td style="padding:8px 32px 18px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(5,16,23,.45);margin-bottom:6px;">Mensagem</div>
        <div style="font-size:13.5px;line-height:1.6;color:rgba(5,16,23,.78);white-space:pre-wrap;">${escapeHtml(lead.msg)}</div>
      </td></tr>
      ` : "")}

      <tr><td style="padding:14px 32px 22px;border-top:1px solid rgba(5,16,23,.05);font-size:11px;color:rgba(5,16,23,.45);">
        Origem: <strong>${escapeHtml(lead.source || "—")}</strong> · ${fmtDateTime(lead.createdAt || Date.now())}
        ${adminUrl ? `<br/><a href="${adminUrl}" style="color:#0077B6;text-decoration:none;">Abrir no admin →</a>` : ""}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { renderNewLeadEmail };
