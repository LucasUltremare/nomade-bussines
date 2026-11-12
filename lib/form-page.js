/* ══════════════════════════════════════════════════════════════════════════
 * PÁGINA PÚBLICA DE CADASTRO — /f/<slug>
 *
 * Sem JavaScript de propósito: abre em qualquer webview de WhatsApp e
 * Instagram. O POST volta pra mesma URL com ?ok=1 ou ?erro=<campo>.
 * Monocromática, no mesmo sistema do painel (Geist).
 * ══════════════════════════════════════════════════════════════════════════ */
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const T = {
  en: {
    name: "Your name", email: "Email", whatsapp: "WhatsApp", company: "Company", msg: "What do you need?",
    send: "Send", sending: "Sending…", required: "Please fill in", thanks: "Got it.",
    thanksBody: "We received your message and will get back to you soon.",
    hours: "We reply", days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], to: "to",
    poweredBy: "Runs on", invalid: "Please check the field",
  },
  pt: {
    name: "Seu nome", email: "E-mail", whatsapp: "WhatsApp", company: "Empresa", msg: "O que você precisa?",
    send: "Enviar", sending: "Enviando…", required: "Preencha", thanks: "Recebido.",
    thanksBody: "Recebemos sua mensagem e vamos responder em breve.",
    hours: "Respondemos", days: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"], to: "a",
    poweredBy: "Roda em", invalid: "Confira o campo",
  },
  es: {
    name: "Tu nombre", email: "Correo", whatsapp: "WhatsApp", company: "Empresa", msg: "¿Qué necesitas?",
    send: "Enviar", sending: "Enviando…", required: "Completa", thanks: "Recibido.",
    thanksBody: "Recibimos tu mensaje y te responderemos pronto.",
    hours: "Respondemos", days: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"], to: "a",
    poweredBy: "Funciona con", invalid: "Revisa el campo",
  },
};

/* "Mon–Fri" quando os dias são consecutivos; "Mon, Wed, Fri" quando não. */
function diasLabel(dias, nomes) {
  if (!dias?.length) return "";
  const seq = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  if (seq && dias.length > 2) return `${nomes[dias[0]]}–${nomes[dias[dias.length - 1]]}`;
  return dias.map((d) => nomes[d]).join(", ");
}

function renderFormPage(form, empresa, { ok = false, erro = "", valores = {} } = {}) {
  const t = T[form.idioma] || T.en;
  const campos = form.campos?.length ? form.campos : ["name", "email", "msg"];
  const obrigatorio = (c) => c === "name" || c === "email" || c === "whatsapp";
  const horario = empresa?.horario;
  const horas = horario ? `${t.hours} ${diasLabel(horario.dias, t.days)}, ${horario.abre} ${t.to} ${horario.fecha}` : "";

  const campo = (c) => {
    const id = `f-${c}`;
    const invalido = erro === c;
    const comum = `id="${id}" name="${c}" value="${esc(valores[c] || "")}" ${obrigatorio(c) ? "required" : ""} autocomplete="${c === "name" ? "name" : c === "email" ? "email" : c === "whatsapp" ? "tel" : c === "company" ? "organization" : "off"}"`;
    const controle = c === "msg"
      ? `<textarea id="${id}" name="msg" rows="4">${esc(valores.msg || "")}</textarea>`
      : `<input type="${c === "email" ? "email" : c === "whatsapp" ? "tel" : "text"}" ${comum}>`;
    return `<label class="f${invalido ? " f--bad" : ""}" for="${id}"><span>${t[c]}${obrigatorio(c) ? " <i>*</i>" : ""}</span>${controle}${invalido ? `<em>${t.invalid}</em>` : ""}</label>`;
  };

  const corpo = ok
    ? `<div class="done"><h1>${t.thanks}</h1><p>${esc(form.obrigadoTexto || t.thanksBody)}</p></div>`
    : `<form method="post" action="">
        ${campos.map(campo).join("\n")}
        <button type="submit">${t.send} <span>→</span></button>
      </form>`;

  return `<!doctype html>
<html lang="${esc(form.idioma || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(form.titulo)} · ${esc(empresa?.nome || "")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#fafaf8;--panel:#fff;--ink:#0b0b0c;--mute:rgba(11,11,12,.6);--faint:rgba(11,11,12,.4);--line:rgba(11,11,12,.1);--line2:rgba(11,11,12,.2);--bad:#c9353a}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{min-height:100%}
  body{background:var(--bg);color:var(--ink);font:15px/1.5 'Geist',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:520px;margin:0 auto;padding:56px 20px 40px}
  .brand{display:flex;align-items:center;gap:10px;color:var(--mute);font-size:13px;letter-spacing:.02em;margin-bottom:40px}
  .brand b{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;background:var(--ink);color:var(--bg);font-weight:600;font-size:12px}
  h1{font-weight:600;font-size:32px;line-height:1.1;letter-spacing:-.03em;margin-bottom:10px}
  .lead{color:var(--mute);margin-bottom:32px;max-width:44ch}
  form{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px 22px 20px;display:grid;gap:16px}
  .f{display:grid;gap:7px}
  .f span{font-size:12px;color:var(--mute);letter-spacing:.02em}
  .f i{font-style:normal;color:var(--faint)}
  .f input,.f textarea{width:100%;background:transparent;border:1px solid var(--line2);border-radius:9px;padding:11px 12px;color:var(--ink);font:inherit;outline:none;transition:border-color .15s}
  .f input:focus,.f textarea:focus{border-color:var(--ink)}
  .f--bad input,.f--bad textarea{border-color:var(--bad)}
  .f em{font-style:normal;font-size:12px;color:var(--bad)}
  button{margin-top:4px;height:46px;border:0;border-radius:10px;background:var(--ink);color:var(--bg);font:600 15px 'Geist',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:transform .12s}
  button:hover{transform:translateY(-1px)}
  button span{font-size:16px;line-height:1}
  .done{padding:40px 0}
  .done p{color:var(--mute);font-size:17px;max-width:40ch}
  .foot{margin-top:28px;display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--faint);font-size:12px}
  .foot a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line2)}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><b>${esc((empresa?.nome || "N").trim().slice(0, 1).toUpperCase())}</b>${esc(empresa?.nome || "")}</div>
  ${ok ? "" : `<h1>${esc(form.titulo)}</h1>`}
  ${!ok && form.descricao ? `<p class="lead">${esc(form.descricao)}</p>` : ""}
  ${corpo}
  <div class="foot">
    ${horas ? `<span>${esc(horas)}</span>` : ""}
    ${empresa?.site ? `<a href="${esc(empresa.site)}">${esc(empresa.site.replace(/^https?:\/\//, ""))}</a>` : ""}
    <span>${t.poweredBy} Nomade Business</span>
  </div>
</div>
</body>
</html>`;
}

function formNotFoundPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404</title>
<style>body{background:#fafaf8;color:#0b0b0c;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}p{color:rgba(11,11,12,.55)}</style></head>
<body><div><h1 style="font-weight:500">This link is not active.</h1><p>Este link não está ativo · Este enlace no está activo.</p></div></body></html>`;
}

module.exports = { renderFormPage, formNotFoundPage };
