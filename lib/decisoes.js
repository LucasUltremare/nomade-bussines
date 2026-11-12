/* ══════════════════════════════════════════════════════════════════════════
 * DECISÕES — o "sistema 1" do Nomade
 *
 * Pergunta com resposta conhecida (qual o tipo desta memória? esse lead é
 * urgente? de 0 a 4, quanto risco tem essa entrega?) não precisa de um modelo
 * escrevendo prosa que o código joga fora. Precisa de um VALOR com
 * probabilidade, pra o código decidir com limiar — e mandar pro humano quando
 * a confiança for baixa.
 *
 * Três primitivos, no formato do /v1/decisions do LLM Gateway (o mesmo do Jev,
 * da TypeSafe), pra trocar de motor sem mudar quem chama:
 *   predicate → probabilidade de "sim"              { probability }
 *   choice    → uma opção de uma lista              { choice, probabilities, confidence }
 *   score     → nota numa escala ordenada (2..10)   { score, probabilities, confidence }
 *
 * Dois motores:
 *   jev   → LLM Gateway com o Jev (LLMGATEWAY_API_KEY). Calibrado, na nuvem.
 *   local → o modelo do Ollama (PatricJ). A probabilidade sai dos LOGPROBS do
 *           primeiro token: cada opção vira uma letra/dígito, o modelo
 *           responde um token só, e a distribuição desse token É a resposta.
 *           Sem logprobs (Ollama < 0.12) vira resposta seca, com
 *           `calibrado: false` — o chamador sabe que não pode confiar no número.
 * ══════════════════════════════════════════════════════════════════════════ */

const OLLAMA_URL = (process.env.OLLAMA_URL || "").replace(/\/$/, "");
const MODELO_LOCAL = process.env.DECISOES_MODELO || process.env.OLLAMA_TEXT_MODEL || "patricj";
const GATEWAY_URL = (process.env.LLMGATEWAY_URL || "https://api.llmgateway.io/v1").replace(/\/$/, "");
const GATEWAY_KEY = process.env.LLMGATEWAY_API_KEY || "";
const JEV_MODELO = process.env.JEV_MODEL || "jev-1.13.0";

const LETRAS = "ABCDEFGHIJKLMNOPQRST"; // top_logprobs do Ollama vai até 20
const MAX_PERGUNTAS = 16;

/* Motor pedido → motor que dá pra usar. Vazio = o melhor disponível. */
function motorDisponivel(pedido = process.env.DECISOES_MOTOR) {
  const m = String(pedido || "").toLowerCase();
  if (m === "jev") return GATEWAY_KEY ? "jev" : null;
  if (m === "local") return OLLAMA_URL ? "local" : null;
  return GATEWAY_KEY ? "jev" : OLLAMA_URL ? "local" : null;
}

// erro de quem chamou (400) vs. motor fora do ar (503): a rota devolve o status
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

function validar(questions) {
  if (!Array.isArray(questions) || !questions.length) throw erro("questions vazio");
  if (questions.length > MAX_PERGUNTAS) throw erro(`no máximo ${MAX_PERGUNTAS} perguntas por chamada`);
  const nomes = new Set();
  for (const q of questions) {
    if (!q?.name || nomes.has(q.name)) throw erro("cada pergunta precisa de um name único");
    nomes.add(q.name);
    if (q.type === "choice" && !(q.choices?.length >= 2)) throw erro(`${q.name}: choice precisa de 2+ choices`);
    if (q.type === "score" && !(q.levels?.length >= 2 && q.levels.length <= 10)) throw erro(`${q.name}: score precisa de 2 a 10 levels`);
    if (!["predicate", "choice", "score"].includes(q.type)) throw erro(`${q.name}: type ${q.type} não existe`);
  }
}

// margem do vencedor sobre o segundo: 1 = certeza, 0 = empate
function confianca(ps) {
  const [a = 0, b = 0] = [...ps].sort((x, y) => y - x);
  return Math.round((a - b) * 1000) / 1000;
}
const r3 = (x) => Math.round(x * 1000) / 1000;

/* ── motor local ─────────────────────────────────────────────────────────── */

/* Monta a pergunta como múltipla escolha de UM símbolo. */
function comoMultiplaEscolha(q) {
  if (q.type === "predicate") return { simbolos: ["S", "N"], linhas: ["S) sim", "N) não"] };
  if (q.type === "score") {
    return { simbolos: q.levels.map((_, i) => String(i)), linhas: q.levels.map((l, i) => `${i}) ${l.label}`) };
  }
  if (q.choices.length > LETRAS.length) throw erro(`${q.name}: o motor local aceita até ${LETRAS.length} choices`);
  return {
    simbolos: q.choices.map((_, i) => LETRAS[i]),
    linhas: q.choices.map((c, i) => `${LETRAS[i]}) ${c.value}${c.description ? ` — ${c.description}` : ""}`),
  };
}

async function perguntarLocal(input, q) {
  const { simbolos, linhas } = comoMultiplaEscolha(q);
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELO_LOCAL,
      stream: false,
      think: false, // modelo com raciocínio gastaria o único token pensando
      logprobs: true,
      top_logprobs: 20,
      options: { temperature: 0, num_predict: 1 },
      messages: [
        { role: "system", content: "Você toma decisões rápidas sobre o texto que recebe. Responda com UM único símbolo da lista de opções, sem explicar." },
        { role: "user", content: `TEXTO:\n${String(input).slice(0, 6000)}\n\nPERGUNTA: ${q.instructions || q.name}\n\nOPÇÕES:\n${linhas.join("\n")}\n\nResponda só o símbolo.` },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  const j = await r.json();

  const simbolo = (tok) => String(tok || "").trim().replace(/[).:]$/, "").toUpperCase();
  const massa = Object.fromEntries(simbolos.map((s) => [s, 0]));
  const top = j.logprobs?.[0]?.top_logprobs || [];
  // " A" e "A" são tokens diferentes pro mesmo símbolo: soma
  for (const t of top) if (simbolo(t.token) in massa) massa[simbolo(t.token)] += Math.exp(t.logprob);
  let total = Object.values(massa).reduce((a, b) => a + b, 0);
  let calibrado = true;
  if (!total) {
    // sem logprobs: o que veio escrito vale 100%, e o chamador fica sabendo
    const s = simbolo(j.message?.content);
    if (!(s in massa)) return { type: "refusal", name: q.name };
    massa[s] = 1; total = 1; calibrado = false;
  }
  const ps = simbolos.map((s) => massa[s] / total);
  return montarResposta(q, ps, calibrado);
}

function montarResposta(q, ps, calibrado) {
  const extra = calibrado ? {} : { calibrado: false };
  if (q.type === "predicate") return { type: "predicate", name: q.name, probability: r3(ps[0]), ...extra };
  if (q.type === "score") {
    return {
      type: "score", name: q.name,
      score: r3(ps.reduce((a, p, i) => a + p * i, 0)),
      probabilities: q.levels.map((l, i) => ({ value: i, label: l.label, probability: r3(ps[i]) })),
      confidence: confianca(ps), ...extra,
    };
  }
  const melhor = ps.indexOf(Math.max(...ps));
  return {
    type: "choice", name: q.name,
    choice: q.choices[melhor].value,
    probabilities: q.choices.map((c, i) => ({ value: c.value, probability: r3(ps[i]) })),
    confidence: confianca(ps), ...extra,
  };
}

/* ── motor jev ───────────────────────────────────────────────────────────── */

async function perguntarJev(input, questions) {
  const r = await fetch(`${GATEWAY_URL}/decisions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GATEWAY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JEV_MODELO, input: String(input), questions }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `LLM Gateway ${r.status}`);
  return { model: j.model || JEV_MODELO, answers: j.answers || [] };
}

/* ── entrada ─────────────────────────────────────────────────────────────── */

/* decidir({ input, questions, motor? }) → { motor, model, answers }
   As respostas voltam na ordem das perguntas. Lança se não houver motor. */
async function decidir({ input, questions, motor } = {}) {
  validar(questions);
  const usar = motorDisponivel(motor);
  if (!usar) throw erro("Sem motor de decisão: configure LLMGATEWAY_API_KEY (Jev) ou OLLAMA_URL (local).", 503);
  if (usar === "jev") return { motor: "jev", ...(await perguntarJev(input, questions)) };
  const answers = [];
  // uma de cada vez: o Ollama de uma máquina pequena enfileira de qualquer jeito
  for (const q of questions) answers.push(await perguntarLocal(input, q));
  return { motor: "local", model: MODELO_LOCAL, answers };
}

module.exports = { decidir, motorDisponivel, confianca };
