/**
 * lib/email.js
 * ────────────
 * Wrapper minimal do Resend. Sem dependência do SDK (Node 20 tem fetch nativo).
 *
 * ENV:
 *   RESEND_API_KEY=re_xxxxx
 *   EMAIL_FROM=Sua Empresa <contato@suaempresa.com>
 */
const { EMPRESA } = require("./empresa");


const RESEND_API = "https://api.resend.com/emails";

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY ausente — email não enviado para", to);
    return { skipped: true };
  }

  const r = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || `${EMPRESA.nome} <onboarding@resend.dev>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    }),
  });

  const data = await r.json();
  if (!r.ok) {
    console.error("Resend error:", data);
    throw new Error(data.message || "resend_failed");
  }
  return data;
}

module.exports = { sendEmail };
