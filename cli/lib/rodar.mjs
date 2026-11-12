/* ═══ RODAR ══════════════════════════════════════════════════════════════
     nomade rodar                 escolhe da lista
     nomade rodar "pedaço do título"

   O play que só existia na dash. Marca a task como pedida — quem executa
   continua sendo o runner da máquina do dono, que pega no próximo ciclo. */
import { get, post } from './api.mjs'
import { cabecalho, dim, bold, azul, verde, gold, coral, info, erro } from './ui.mjs'

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export async function rodar(argv) {
  const alvo = argv.filter(a => !a.startsWith('--')).join(' ').trim()
  const tarefas = (await get('/api/office/tarefas-agent')).filter(t => !t.feita)

  if (!alvo) {
    if (!tarefas.length) { info(dim('  nenhuma task de agent aberta.\n')); return }
    cabecalho('o que dá pra rodar')
    tarefas.forEach(t => {
      const estado = t.aguardandoDecisao ? coral('espera decisão')
        : t.rodandoEm ? azul(`rodando em ${t.rodandoEm}`)
        : t.pedidoEm ? gold('já pedida') : dim('parada')
      info(`  ${bold(t.titulo.slice(0, 52).padEnd(53))} ${dim(t.squad.padEnd(12))} ${estado}`)
    })
    info(dim(`\n  ${azul('nomade rodar "parte do título"')}\n`))
    return
  }

  const casa = tarefas.filter(t => norm(t.titulo).includes(norm(alvo)))
  if (!casa.length) { erro(`nenhuma task aberta com "${alvo}".`); info(dim('  ve a lista com: nomade rodar\n')); process.exit(1) }
  if (casa.length > 1) {
    erro(`"${alvo}" casa com ${casa.length} tasks — sê mais específico:`)
    casa.forEach(t => info(dim(`  ${t.titulo}`)))
    process.exit(1)
  }
  const t = casa[0]
  if (t.aguardandoDecisao) { erro(`"${t.titulo}" espera uma decisão. Responde antes: nomade decisoes`); process.exit(1) }

  const r = await post(`/api/office/tarefas-agent/${t.id}/rodar`)
  info(`${verde('✓')} ${bold(t.titulo)} ${dim('· pedida')}`)
  if (r.aviso) info(`  ${gold(r.aviso)}`)
  else info(dim(`  o runner pega no próximo ciclo (até 12s).`))
  info(dim(`  acompanha com: nomade fila\n`))
}
