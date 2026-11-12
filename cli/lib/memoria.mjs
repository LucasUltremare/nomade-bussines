/* ═══ MEMÓRIA da empresa ═════════════════════════════════════════════════
   `nomade memoria`           diagnóstico
   `nomade memoria backfill`  roda a manutenção até zerar

   O backfill é de propósito parcial por chamada (título e tag custam uma ida
   ao modelo local CADA) — então quem chama é que repete. Este comando repete. */
import { get, post, erroLegivel } from './api.mjs'
import { cabecalho, dim, bold, azul, verde, gold, coral, info, erro } from './ui.mjs'

const espera = (ms) => new Promise(r => setTimeout(r, ms))
const barra = (feito, total, larg = 24) => {
  if (!total) return ''
  const n = Math.round((feito / total) * larg)
  return `${'█'.repeat(n)}${dim('░'.repeat(larg - n))} ${Math.round((feito / total) * 100)}%`
}

export async function memoria(argv) {
  if (argv[0] === 'backfill') return backfill()
  const s = await get('/api/office/memories/status')

  cabecalho('memória da empresa')
  info(`  ${bold(s.total)} memórias`)
  info(`  com embedding   ${barra(s.comVetor, s.total)} ${dim(`${s.comVetor}/${s.total}`)}`)
  info(`  com associação  ${barra(s.comLinks, s.total)} ${dim(`${s.comLinks}/${s.total}`)}`)
  if (s.semRotulo) info(`  ${gold(`${s.semRotulo} sem título ou tag`)}`)

  const e = s.embedder
  info(`\n  ${bold('embedder')} ${dim(e.url || '(não configurado)')}`)
  if (e.url) {
    info(`    alcançável      ${e.alcancavel ? verde('sim') : coral('não')}`)
    if (e.alcancavel) {
      info(`    ${e.modeloEmbedding.padEnd(18)}${e.temModeloEmbedding ? verde('✓') : coral('✗ falta — ollama pull ' + e.modeloEmbedding)}`)
      info(`    ${e.modeloTexto.padEnd(18)}${e.temModeloTexto ? verde('✓') : coral('✗ falta — ollama pull ' + e.modeloTexto)}`)
    }
  }
  const cor = /saudável/i.test(s.diagnostico) ? verde : gold
  info(`\n  ${cor(s.diagnostico)}\n`)
  if (s.semVetor || s.semRotulo || (s.comVetor && !s.comLinks)) {
    info(dim(`  pra resolver:  ${azul('nomade memoria backfill')}\n`))
  }
}

async function backfill() {
  const antes = await get('/api/office/memories/status')
  if (!antes.embedder.url) { erro('OLLAMA_URL não configurado no serviço — o backfill não teria o que fazer.'); process.exit(1) }
  if (!antes.embedder.alcancavel) {
    erro(`o serviço não alcança ${antes.embedder.url}.`)
    info(dim('  PC desligado, ou o container não chega nessa rede. Confere e roda de novo.'))
    process.exit(1)
  }

  cabecalho(`manutenção da memória ${dim(`· ${antes.total} memórias`)}`)
  let rodada = 0
  let totalRotulados = 0
  let totalEmbeddados = 0

  for (;;) {
    rodada++
    const r = await post('/api/office/memories/backfill')
    totalRotulados += r.rotulados || 0
    totalEmbeddados += r.embeddados || 0
    info(`  ${dim(`rodada ${rodada}`)}  ${r.rotulados} rotulada(s) · ${r.embeddados} embeddada(s) · ${r.religadas} religada(s) ${dim(`· faltam ${r.pendentes}`)}`)

    if (!r.pendentes) break
    // nenhuma das duas passadas andou = não vai andar mais (modelo faltando, etc.)
    if (!r.rotulados && !r.embeddados) {
      info(`\n  ${gold(`parei: ${r.pendentes} pendente(s) que a manutenção não conseguiu tratar`)}`)
      info(dim('  costuma ser modelo faltando no Ollama — confere com `nomade memoria`'))
      break
    }
    if (rodada >= 60) { info(`\n  ${gold('teto de 60 rodadas — roda de novo pra continuar')}`); break }
    await espera(400) // não martelar o PC
  }

  const depois = await get('/api/office/memories/status')
  info(`\n  ${verde('✓')} ${totalRotulados} rotuladas · ${totalEmbeddados} embeddadas`)
  info(`  com embedding   ${depois.comVetor}/${depois.total}`)
  info(`  com associação  ${depois.comLinks}/${depois.total}`)
  info(`\n  ${depois.diagnostico}\n`)
}
