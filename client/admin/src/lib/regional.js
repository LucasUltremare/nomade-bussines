/* ══════════════════════════════════════════════════════════
   REGIONAL — país, moeda e fuso da empresa (Ajustes → Região).
   Vem de /api/admin/empresa e fica em memória, igual lib/acesso.js:
   qualquer tela formata dinheiro e data sem receber prop.
   ══════════════════════════════════════════════════════════ */

let atual = { pais: "BR", moeda: "BRL", fuso: null, semanaComeca: 1 };

export function setRegional(e) {
  if (!e || typeof e !== "object") return;
  atual = {
    pais: /^[A-Z]{2}$/.test(e.pais || "") ? e.pais : atual.pais,
    moeda: /^[A-Z]{3}$/.test(e.moeda || "") ? e.moeda : atual.moeda,
    fuso: e.fuso || atual.fuso,
    semanaComeca: [0, 1, 6].includes(e.semanaComeca) ? e.semanaComeca : atual.semanaComeca,
  };
}

export const regional = () => atual;
export const moeda = () => atual.moeda;
export const semanaComeca = () => atual.semanaComeca;

/* idioma da tela + país da empresa. "en-BR" escreve em inglês com
   vírgula decimal e dia/mês — o formato de quem mora lá. */
export const localeDe = (lang) => `${lang || "en"}-${atual.pais}`;

export function dinheiro(n, lang, opts = {}) {
  try { return new Intl.NumberFormat(localeDe(lang), { style: "currency", currency: atual.moeda, ...opts }).format(Number(n) || 0); }
  catch { return `${atual.moeda} ${Number(n) || 0}`; }
}

/* só o símbolo ("R$", "US$", "€") — pra prefixo de campo */
export function simbolo(lang) {
  try {
    return new Intl.NumberFormat(localeDe(lang), { style: "currency", currency: atual.moeda, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((p) => p.type === "currency")?.value || atual.moeda;
  } catch { return atual.moeda; }
}
