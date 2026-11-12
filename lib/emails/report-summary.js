/**
 * lib/emails/report-summary.js
 * ────────────────────────────
 * Resumo semanal consolidado — sai toda segunda 10h pros admins.
 * Mostra quem enviou, quem faltou, e o conteúdo agrupado por setor.
 */
const { EMPRESA } = require("../empresa");


const SECTOR_LABEL = {
  administrativo: "Administrativo",
  operacional: "Operacional",
};

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function nl2br(s) {
  return escapeHtml(s).replace(/\n/g, "<br/>");
}

function renderReportSummaryEmail({ weekLabel, reports, missingSectors = [], dashboardUrl }) {
  const subject = `Relatórios semanais · ${weekLabel}`;

  // Lista pelos setores em ordem fixa (administrativo > operacional)
  const SECTOR_ORDER = ["administrativo", "operacional"];
  const reportsBySector = Object.fromEntries(reports.map(r => [r.sector, r]));

  const text = [
    `Relatórios semanais — ${weekLabel}`,
    "",
    `Enviados: ${reports.filter(r => r.submittedAt).length} de 2 setores`,
    missingSectors.length ? "Faltaram: " + missingSectors.map(s => SECTOR_LABEL[s] || s).join(", ") : "",
    "",
    ...SECTOR_ORDER.map(sector => {
      const r = reportsBySector[sector];
      if (!r) return `[${SECTOR_LABEL[sector] || sector}] (não enviado)`;
      const contribs = (r.contributors || []).map(c => c.memberName).join(", ");
      return [
        `[${SECTOR_LABEL[r.sector] || r.sector}]${contribs ? ` — ${contribs}` : ""}`,
        "Entregas:",
        r.entregas,
        r.bloqueios ? "Bloqueios:\n" + r.bloqueios : "",
        r.proximaSemana ? "Próxima semana:\n" + r.proximaSemana : "",
        "—",
      ].filter(Boolean).join("\n");
    }),
  ].filter(Boolean).join("\n\n");

  const renderSectorBlock = (sector) => {
    const r = reportsBySector[sector];
    const label = SECTOR_LABEL[sector] || sector;
    if (!r) {
      return `
        <tr><td style="padding:14px 20px;background:rgba(212,101,74,.04);border-bottom:1px solid rgba(5,16,23,.06);">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:rgba(5,16,23,.55);margin-bottom:4px;">${escapeHtml(label)}</div>
          <div style="font-size:13px;color:#7a2d15;">Setor não enviou relatório esta semana.</div>
        </td></tr>`;
    }
    const contribs = (r.contributors || []).map(c => escapeHtml(c.memberName)).join(", ");
    return `
      <tr><td style="padding:18px 20px 6px;background:#f6fafc;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:rgba(5,16,23,.55);">${escapeHtml(label)}</div>
        ${contribs ? `<div style="font-size:11px;color:rgba(5,16,23,.5);margin-top:2px;">por ${contribs}</div>` : ""}
      </td></tr>
      <tr><td style="padding:14px 20px;border-bottom:1px solid rgba(5,16,23,.06);">
        <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#0077B6;margin-bottom:4px;">Entregas</div>
        <div style="font-size:13px;line-height:1.55;color:rgba(5,16,23,.75);margin-bottom:${r.bloqueios || r.proximaSemana ? 12 : 0}px;">${nl2br(r.entregas)}</div>
        ${r.bloqueios ? `
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#d4654a;margin-bottom:4px;">Bloqueios</div>
          <div style="font-size:13px;line-height:1.55;color:rgba(5,16,23,.75);margin-bottom:${r.proximaSemana ? 12 : 0}px;">${nl2br(r.bloqueios)}</div>
        ` : ""}
        ${r.proximaSemana ? `
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#00A896;margin-bottom:4px;">Próxima semana</div>
          <div style="font-size:13px;line-height:1.55;color:rgba(5,16,23,.75);">${nl2br(r.proximaSemana)}</div>
        ` : ""}
      </td></tr>`;
  };
  const sectorBlocks = SECTOR_ORDER.map(renderSectorBlock).join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#eef6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#051017;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef6f9;padding:30px 16px;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(5,16,23,.04);">
      <tr><td style="padding:30px 36px 12px;">
        <div style="color:#051017;font-weight:700;font-size:16px;">${EMPRESA.nome}</div>
        <div style="color:rgba(5,16,23,.4);font-size:11px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;margin-top:4px;">Relatórios semanais</div>
      </td></tr>
      <tr><td style="padding:14px 36px 24px;">
        <h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;letter-spacing:-0.02em;font-weight:700;color:#051017;">
          Semana <span style="color:#0077B6;">${escapeHtml(weekLabel)}</span>
        </h1>
        <p style="margin:0;font-size:13px;color:rgba(5,16,23,.6);">
          ${reports.filter(r => r.submittedAt).length} de 2 setores enviaram${missingSectors.length ? ` · faltam: ${missingSectors.map(s => escapeHtml(SECTOR_LABEL[s] || s)).join(", ")}` : ""}
        </p>
      </td></tr>
      ${sectorBlocks}
      ${dashboardUrl ? `
      <tr><td style="padding:22px 36px 28px;text-align:center;">
        <a href="${dashboardUrl}" style="display:inline-block;padding:10px 20px;border-radius:8px;background:#0077B6;color:#fff;text-decoration:none;font-size:12.5px;font-weight:600;">
          Abrir no painel →
        </a>
      </td></tr>` : ""}
      <tr><td style="padding:18px 36px 22px;background:#f6fafc;border-top:1px solid rgba(5,16,23,.05);text-align:center;">
        <p style="margin:0;font-size:10px;color:rgba(5,16,23,.3);">${EMPRESA.nome} · resumo automático segunda 10h</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { renderReportSummaryEmail };
