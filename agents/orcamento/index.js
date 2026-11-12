/**
 * agents/orcamento — GERADOR DE PROPOSTA COMERCIAL (Gemini)
 * ─────────────────────────────────────────────────────────
 * Uma chamada só → proposta completa: itens (descrição × qtd × valor
 * unitário) + editorial (intro "o que vamos resolver", pilares,
 * highlights) que vira a página pública.
 *
 * Preço no estilo vlad-proposta — SEM tabela de preços:
 *   · valores citados no briefing são usados exatamente como vieram;
 *   · o que faltar é estimado a valor de mercado (Brasil/SMB) e
 *     sinalizado em "observacoes" como estimativa.
 *
 * Provedor: Gemini 2.5 Flash via fetch (mesmo padrão do lead-chat e
 * do ai-revise — sem SDK). Diferente do gerador antigo, o thinking
 * fica LIGADO e o teto de saída é folgado — era isso que estrangulava
 * a qualidade antes, não o modelo.
 *
 * mode: "unica"  → itens compõem o BUILD (cobrança única, split 50/50 ok)
 *       "mensal" → itens compõem a MENSALIDADE (cobra 1º mês)
 */
const { EMPRESA } = require("../../lib/empresa");


const GEMINI_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 60_000;

function buildSystemPrompt(mode) {
  const modeRules = mode === "mensal"
    ? `MODO DE COBRANÇA: MENSAL (recorrente).
- Os "itens" compõem a MENSALIDADE: o que o cliente recebe todo mês, cada item com valor.
- A soma dos itens é o valor mensal da proposta.
- "operacaoMensal" fica zerada (a mensalidade JÁ É a cobrança recorrente).`
    : `MODO DE COBRANÇA: ÚNICA (projeto/build).
- Os "itens" compõem o BUILD: quebre em 3-8 etapas concretas (descoberta, desenho de fluxo,
  integração por sistema, construção, testes com dados reais, publicação e treinamento).
- A soma dos itens é o valor do projeto.
- "operacaoMensal": preencha a faixa {min,max} só se o job implicar operação recorrente após
  a entrega (ex.: agent que precisa de monitoramento/ajuste). Se não fizer sentido, zeros.`;

  return `Você é o redator de propostas comerciais da ${EMPRESA.nome}.${EMPRESA.descricao ? ` O que a empresa faz: ${EMPRESA.descricao}` : ""}

Monte uma PROPOSTA COMERCIAL completa a partir do briefing, em português do Brasil, na voz da ${EMPRESA.nome}: confiante, direta, sofisticada, sem clichê de agência nem enrolação. Frases curtas e concretas. Foco no que resolve pro cliente.

${modeRules}

PREÇOS:
- Se o briefing traz valores, use EXATAMENTE os valores dele — o total tem que bater com o que foi pedido.
- Se faltar valor, estime um valor de mercado razoável (Brasil, SMB) e sinalize em "observacoes" que é estimativa.
- Seja realista: não infle, não subestime pra parecer barato.

COMO ITEMIZAR:
- quantidade = unidades/sessões/fluxos/integrações. valorUnitario = valor POR unidade.
  3 integrações a R$ 800 cada = quantidade 3 × valorUnitario 800 — nunca 1 × 2400.
- Na dúvida, menos itens e mais claros. Não invente serviço que o cliente não pediu.

ESTRUTURA EDITORIAL (vira a página que o cliente abre):
- "intro": diagnostica a dor e resume a solução em 3-5 linhas. É a primeira coisa que o cliente lê.
- "sections": 2-3 pilares, cada um com label ("PILAR 01"), título, desc curta e 3-5 entregas concretas.
- "highlights": exatamente 3 pares chave/valor — um DEVE ser o prazo (ex.: {"k":"PRAZO","v":"3 a 5 semanas"}).
- "naoIncluido": 2-4 bullets específicos do que fica fora — protege os dois lados.
- "extra": só se o briefing pedir algo destacável (garantia, manutenção). Senão, null.

REGRAS GERAIS:
- Não invente fatos sobre o cliente — use só o que está no briefing.
- Prazo realista pro escopo descrito.
- O pagamento é processado pelo Mercado Pago — NÃO mencione Pix direto, chave Pix ou transferência.

DEVOLVE APENAS JSON puro (sem markdown, sem code fences), exatamente neste formato:
{
  "cliente": "nome do cliente/empresa (título grande da proposta)",
  "subtitle": "produto/contexto, ou \\"\\"",
  "intro": "...",
  "sections": [{ "label": "PILAR 01", "title": "...", "desc": "...", "items": ["...", "..."] }],
  "extra": { "title": "...", "badge": "...", "desc": "...", "items": ["..."] } | null,
  "highlights": [{ "k": "PRAZO", "v": "..." }, { "k": "...", "v": "..." }, { "k": "...", "v": "..." }],
  "naoIncluido": ["...", "..."],
  "complexidade": "simples" | "medio" | "complexo",
  "itens": [{ "descricao": "...", "quantidade": 1, "valorUnitario": 1500 }],
  "operacaoMensal": { "min": 0, "max": 0 },
  "prazo": "ex: 3 a 5 semanas",
  "observacoes": "condições curtas; sinalize estimativas; ou \\"\\""
}`;
}

function toNum(v) {
  const n = typeof v === "number"
    ? v
    : parseFloat(String(v ?? "").replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const strArr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => ({
      descricao: String(it?.descricao ?? "").trim() || "Serviço",
      quantidade: Math.max(1, Math.round(toNum(it?.quantidade)) || 1),
      valorUnitario: Math.max(0, Math.round(toNum(it?.valorUnitario))),
    }))
    .filter((it) => it.valorUnitario > 0);
}

function normalizeSections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s, i) => ({
      label: String(s?.label ?? "").trim() || `PILAR ${String(i + 1).padStart(2, "0")}`,
      title: String(s?.title ?? "").trim() || "Pilar",
      desc: String(s?.desc ?? "").trim(),
      items: strArr(s?.items),
    }))
    .filter((s) => s.items.length > 0)
    .slice(0, 4);
}

/**
 * Gera a proposta completa a partir do briefing.
 * @returns {clienteNome, conteudo, complexidade, itens, total, operacaoMensal, prazo, observacoes}
 */
async function generateProposta({ brief, contexto = "", mode = "unica" }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não configurado no servidor");
  }
  if (!brief || !brief.trim()) throw new Error("brief é obrigatório");
  mode = mode === "mensal" ? "mensal" : "unica";

  const userPrompt = `BRIEFING:
${brief.trim()}
${contexto.trim() ? `\nCONTEXTO ADICIONAL (cliente, setor, escala):\n${contexto.trim()}\n` : ""}
Monte a proposta agora.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let data;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(mode) }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 8000,
            responseMimeType: "application/json",
            // thinking LIGADO (dinâmico) — o gerador antigo desligava e a
            // qualidade despencava; não repetir esse erro.
          },
        }),
      }
    );
    clearTimeout(timeout);
    data = await r.json();
    if (!r.ok) {
      console.error("[proposta] Gemini error:", JSON.stringify(data).slice(0, 500));
      throw new Error(data.error?.message || "gemini_failed");
    }
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === "AbortError") throw new Error("A IA demorou demais (timeout 60s). Tenta de novo.");
    throw e;
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("A IA não conseguiu montar a proposta (resposta vazia)");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("[proposta] JSON inválido:", text.slice(0, 300));
    throw new Error("A IA devolveu JSON inválido. Tenta de novo.");
  }

  const itens = normalizeItems(parsed.itens);
  const total = itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);

  const op = parsed.operacaoMensal || {};
  let opMin = Math.max(0, Math.round(toNum(op.min)));
  let opMax = Math.max(0, Math.round(toNum(op.max)));
  if (opMin > opMax) [opMin, opMax] = [opMax, opMin];

  const extraRaw = parsed.extra || {};
  const extraItems = strArr(extraRaw.items);
  const extra = (String(extraRaw.title || "").trim() && extraItems.length > 0)
    ? {
        title: String(extraRaw.title).trim(),
        badge: String(extraRaw.badge || "").trim(),
        desc: String(extraRaw.desc || "").trim(),
        items: extraItems,
      }
    : null;

  return {
    clienteNome: String(parsed.cliente || "").trim() || "Cliente",
    conteudo: {
      subtitle: String(parsed.subtitle || "").trim(),
      intro: String(parsed.intro || "").trim(),
      sections: normalizeSections(parsed.sections),
      extra,
      highlights: (Array.isArray(parsed.highlights) ? parsed.highlights : [])
        .map((h) => ({ k: String(h?.k || "").trim(), v: String(h?.v || "").trim() }))
        .filter((h) => h.k && h.v)
        .slice(0, 3),
      naoIncluido: strArr(parsed.naoIncluido).slice(0, 5),
    },
    complexidade: ["simples", "medio", "complexo"].includes(parsed.complexidade) ? parsed.complexidade : "medio",
    itens,
    total,
    operacaoMensal: { min: opMin, max: opMax },
    prazo: String(parsed.prazo || "").trim(),
    observacoes: String(parsed.observacoes || "").trim(),
    aviso: "",
  };
}

module.exports = { generateProposta };
