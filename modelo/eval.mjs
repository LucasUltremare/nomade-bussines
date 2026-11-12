#!/usr/bin/env node
/* Avaliação do sistema 1 — mede o PatricJ (ou o Jev) nas decisões da casa.
   Sem isto não dá pra saber se um fine-tune melhorou ou só mudou.

     node --env-file=.env modelo/eval.mjs                 # motor do .env
     node --env-file=.env modelo/eval.mjs --motor=local   # força o Ollama
     DECISOES_MODELO=qwen3.5:4b node --env-file=.env modelo/eval.mjs --motor=local

   Mede três coisas:
     acerto     — a resposta de maior probabilidade é a esperada?
     brier      — erro quadrático da probabilidade dada à resposta certa
                  (0 = perfeito, 0.25 = chute numa binária). Calibração importa
                  porque o código decide por LIMIAR, não pela resposta seca.
     confiança  — média nos acertos vs. nos erros. Se for igual, o número não
                  serve pra mandar caso difícil pro humano.

   Os casos de evals/ NUNCA entram no treino: viram decoreba e a nota mente. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { decidir } = require('../lib/decisoes.js')

const aqui = path.dirname(new URL(import.meta.url).pathname)
const motor = process.argv.find(a => a.startsWith('--motor='))?.split('=')[1]
const casos = fs.readFileSync(path.join(aqui, 'evals/decisoes.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))

// probabilidade que o modelo deu pra resposta esperada
function probCerta(r, esperado) {
  if (r.type === 'predicate') return esperado ? r.probability : 1 - r.probability
  if (r.type === 'choice') return r.probabilities.find(p => p.value === esperado)?.probability ?? 0
  if (r.type === 'score') return r.probabilities.find(p => p.value === esperado)?.probability ?? 0
  return 0
}
function acertou(r, esperado) {
  if (r.type === 'predicate') return (r.probability >= 0.5) === esperado
  if (r.type === 'choice') return r.choice === esperado
  if (r.type === 'score') return Math.round(r.score) === esperado
  return false
}

const linhas = []
let modelo = ''
let usado = ''
for (const c of casos) {
  const t0 = Date.now()
  try {
    const d = await decidir({ input: c.input, questions: [c.question], motor })
    modelo = d.model; usado = d.motor
    const r = d.answers[0]
    const p = probCerta(r, c.esperado)
    linhas.push({ id: c.id, ok: acertou(r, c.esperado), p, conf: r.confidence ?? Math.abs(p - 0.5) * 2, calibrado: r.calibrado !== false, ms: Date.now() - t0 })
  } catch (e) {
    linhas.push({ id: c.id, ok: false, p: 0, conf: 0, erro: e.message, ms: Date.now() - t0 })
  }
  const l = linhas.at(-1)
  console.log(`${l.ok ? '✓' : '✗'} ${c.id.padEnd(24)} p(certa)=${l.p.toFixed(2)}  ${l.ms}ms${l.erro ? `  ${l.erro}` : ''}`)
}

const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const acertos = linhas.filter(l => l.ok)
const erros = linhas.filter(l => !l.ok)
const resumo = {
  motor: usado, modelo, quando: new Date().toISOString(), casos: linhas.length,
  acerto: +(acertos.length / linhas.length).toFixed(3),
  brier: +media(linhas.map(l => (1 - l.p) ** 2)).toFixed(3),
  confiancaAcertos: +media(acertos.map(l => l.conf)).toFixed(3),
  confiancaErros: +media(erros.map(l => l.conf)).toFixed(3),
  semLogprobs: linhas.filter(l => l.calibrado === false).length,
  msMedio: Math.round(media(linhas.map(l => l.ms))),
}
console.log('\n' + JSON.stringify(resumo, null, 2))
if (resumo.semLogprobs) console.log(`\n! ${resumo.semLogprobs} resposta(s) sem logprobs: atualize o Ollama (>= 0.12) pra ter probabilidade de verdade.`)

// guarda pra comparar base × fine-tune
const dir = path.join(aqui, 'evals/resultados')
fs.mkdirSync(dir, { recursive: true })
const arq = path.join(dir, `${String(modelo || 'sem-modelo').replace(/[^\w.-]/g, '_')}-${Date.now()}.json`)
fs.writeFileSync(arq, JSON.stringify({ resumo, linhas }, null, 2))
console.log(`\nresultado → ${path.relative(process.cwd(), arq)}`)
