/* ═══ PROSPECÇÃO ═════════════════════════════════════════════════════════
     nomade leads "padaria" "Sorocaba"              mostra (OpenStreetMap, grátis)
     nomade leads "padaria" "Sorocaba" --places     usa o Google (paga, sabe mais)
     nomade leads "padaria" "Sorocaba" --importar   grava

   Dois passos de propósito: cada busca custa no Google e cada lead ruim
   custa o tempo de quem liga. Olha antes de encher a base. */
import { post } from './api.mjs'
import { cabecalho, dim, bold, azul, verde, gold, coral, info, erro } from './ui.mjs'

const barra = (n) => {
  const c = n >= 70 ? verde : n >= 45 ? gold : dim
  return c('▇'.repeat(Math.max(1, Math.round(n / 12))).padEnd(9, ' '))
}

export async function leads(argv) {
  const flags = argv.filter(a => a.startsWith('--'))
  const args = argv.filter(a => !a.startsWith('--'))
  if (!args.length) {
    erro('falta o que buscar.')
    info(dim('  ex: nomade leads "padaria" "Sorocaba SP"'))
    info(dim('      nomade leads "oficina mecânica" "Campinas" --importar --min=50\n'))
    return
  }
  const [busca, regiao = ''] = args
  const importar = flags.includes('--importar')
  const min = Number((flags.find(f => f.startsWith('--min=')) || '').split('=')[1])
  const max = Number((flags.find(f => f.startsWith('--max=')) || '').split('=')[1])

  const fonte = flags.includes('--places') ? 'Google Places' : 'OpenStreetMap'
  cabecalho(`${importar ? 'prospectando' : 'olhando'} ${bold(busca)}${regiao ? ` em ${bold(regiao)}` : ''} ${dim(`· ${fonte}`)}`)

  let r
  try {
    r = await post('/api/office/leads/buscar', {
      busca, regiao, importar,
      fonte: flags.includes('--places') ? 'places' : 'osm',
      ...(Number.isFinite(min) ? { scoreMinimo: min } : {}),
      ...(Number.isFinite(max) ? { max } : {}),
    })
  } catch (e) {
    erro(String(e.message).replace(/^\d+:\s*/, '').replace(/^\{.*"error":"|"\}$/g, ''))
    return
  }

  if (r.prévia) {
    for (const l of r.leads) {
      const sinal = !l.site ? coral('SEM SITE') : dim(l.site.replace(/^https?:\/\//, '').slice(0, 30))
      info(`  ${barra(l.score)} ${String(l.score).padStart(3)} ${bold(l.nome.slice(0, 34).padEnd(34))} ${sinal}`)
      info(`  ${' '.repeat(13)}${dim(`${l.telefone || 'sem telefone'} · ${l.nota ? `nota ${l.nota} (${l.avaliacoes})` : 'sem nota'}`)}`)
      info(`  ${' '.repeat(13)}${dim(l.motivo)}`)
      info('')
    }
    const bons = r.leads.filter(l => l.score >= r.scoreMinimo).length
    info(`  ${r.encontrados} encontrado(s) · ${bons} acima do corte (${r.scoreMinimo})`)
    if (r.fonte === 'osm') {
      const semFone = r.leads.filter(l => !l.telefone).length
      if (semFone) info(dim(`  ${semFone} sem telefone — o OSM é grátis mas sabe menos. --places completa contato e nota.`))
    }
    info(dim(`\n  gravar:  ${azul(`nomade leads "${busca}"${regiao ? ` "${regiao}"` : ''} --importar`)}\n`))
    return
  }

  info(`  ${verde('✓')} ${bold(r.novos)} lead(s) novo(s) na base`)
  if (r.repetidos) info(`  ${dim(`${r.repetidos} já estavam lá (não dupliquei)`)}`)
  if (r.ignorados) info(`  ${dim(`${r.ignorados} abaixo do corte ou fechados`)}`)
  for (const l of r.leads) info(`    ${bold(l.nome)} ${dim(`· ${l.motivo}`)}`)
  info(dim(`\n  viram task pro squad de Triagem no próximo ciclo do gatilho.\n`))
}
