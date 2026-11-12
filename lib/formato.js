/* ══════════════════════════════════════════════════════════════════════════
 * FORMATO — moeda, data e hora do jeito que a empresa configurou.
 *
 * A config mora no banco (lib/empresa-config.js), mas quem formata são
 * páginas e e-mails síncronos. Então a última config lida fica aqui em
 * memória: `obterEmpresaConfig` e `salvarEmpresaConfig` chamam setRegional.
 * Antes da primeira leitura valem os padrões do ambiente.
 * ══════════════════════════════════════════════════════════════════════════ */
const LINGUA = { en: "en", pt: "pt", es: "es" };

let atual = {
  idioma: LINGUA[process.env.IDIOMA_PADRAO] || "en",
  pais: (process.env.PAIS_PADRAO || "BR").toUpperCase().slice(0, 2),
  moeda: (process.env.MOEDA_PADRAO || "BRL").toUpperCase().slice(0, 3),
  fuso: process.env.FUSO_PADRAO || "America/Sao_Paulo",
};

function setRegional(cfg = {}) {
  atual = {
    idioma: LINGUA[cfg.idioma] || atual.idioma,
    pais: cfg.pais || atual.pais,
    moeda: cfg.moeda || atual.moeda,
    fuso: cfg.fuso || atual.fuso,
  };
}

const regional = () => ({ ...atual });
/* idioma da tela + país da empresa: "en-BR" escreve em inglês com vírgula
   decimal e data dia/mês, que é o que quem mora lá espera. */
const locale = (idioma) => `${LINGUA[idioma] || atual.idioma}-${atual.pais}`;
const moeda = () => atual.moeda;

function dinheiro(n, { casas, idioma } = {}) {
  const opts = { style: "currency", currency: atual.moeda };
  if (casas !== undefined) { opts.minimumFractionDigits = casas; opts.maximumFractionDigits = casas; }
  try { return new Intl.NumberFormat(locale(idioma), opts).format(Number(n) || 0); }
  catch { return `${atual.moeda} ${(Number(n) || 0).toFixed(casas ?? 2)}`; }
}

function data(d, opts = { day: "2-digit", month: "short" }, idioma) {
  try { return new Date(d).toLocaleDateString(locale(idioma), { timeZone: atual.fuso, ...opts }); }
  catch { return new Date(d).toLocaleDateString(locale(idioma), opts); }
}

function dataHora(d, opts = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }, idioma) {
  try { return new Date(d).toLocaleString(locale(idioma), { timeZone: atual.fuso, ...opts }); }
  catch { return new Date(d).toLocaleString(locale(idioma), opts); }
}

module.exports = { setRegional, regional, locale, moeda, dinheiro, data, dataHora };
