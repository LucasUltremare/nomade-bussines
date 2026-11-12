#!/usr/bin/env node
/* Pega o erro que só aparece em produção: código lê `process.env.X`, o `.env`
   até tem X, mas o docker-compose NÃO repassa X pro container — porque lá as
   variáveis são declaradas UMA A UMA. Dentro do container a var é undefined e
   a funcionalidade morre em silêncio (ou com "sem chave", que foi o caso).

   Aconteceu duas vezes em 26/ago/2026: OLLAMA_TEXT_MODEL e GOOGLE_PLACES_KEY. */
import fs from 'node:fs'

const COMPOSE = 'docker-compose.yml'
// qual serviço do compose roda qual arquivo
const SERVICOS = {
  office: ['ai-service.js', 'lib/screenshot.js', 'lib/leads.js', 'lib/empresa.js', 'lib/decisoes.js', 'lib/memoria-empresa.js'],
  server: ['server.js', 'lib/email.js', 'lib/formato.js', 'lib/empresa.js', 'lib/empresa-config.js', 'lib/time.js', 'lib/screenshot.js', 'agents/orcamento/index.js'],
}
// vars que o próprio Docker/Node dá, ou que são de build
// (o proxy vem do ambiente da máquina, não do .env)
const IGNORAR = new Set(['NODE_ENV', 'PORT', 'HOME', 'PATH', 'TZ', 'HTTPS_PROXY', 'HTTP_PROXY', 'PROGRAMFILES', 'LOCALAPPDATA'])

const compose = fs.readFileSync(COMPOSE, 'utf8')

/** As env vars declaradas no bloco `environment:` de um serviço. */
function declaradas(servico) {
  const i = compose.indexOf(`\n  ${servico}:`)
  if (i === -1) return null
  const prox = compose.slice(i + 1).search(/\n {2}[a-z][\w-]*:\n/)
  const bloco = compose.slice(i, prox === -1 ? undefined : i + 1 + prox)
  return new Set([...bloco.matchAll(/^\s*-\s*([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]))
}

let faltando = 0
for (const [servico, arquivos] of Object.entries(SERVICOS)) {
  const tem = declaradas(servico)
  if (!tem) { console.error(`✗ serviço "${servico}" não existe no ${COMPOSE}`); faltando++; continue }

  const usadas = new Set()
  for (const arq of arquivos) {
    if (!fs.existsSync(arq)) continue
    for (const m of fs.readFileSync(arq, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) usadas.add(m[1])
  }
  const ausentes = [...usadas].filter(v => !tem.has(v) && !IGNORAR.has(v)).sort()
  if (ausentes.length) {
    console.error(`\n✗ ${servico} lê variáveis que o compose não repassa:`)
    for (const v of ausentes) console.error(`   ${v}`)
    console.error(`   → adiciona no environment: do serviço "${servico}":`)
    for (const v of ausentes) console.error(`       - ${v}=\${${v}:-}`)
    faltando += ausentes.length
  }
}

if (faltando) { console.error(`\n${faltando} variável(is) sem passagem — vai dar undefined no container.`); process.exit(1) }
console.log('✓ toda variável lida pelo código chega no container')
