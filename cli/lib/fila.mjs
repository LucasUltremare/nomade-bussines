/* ═══ FILA ═══════════════════════════════════════════════════════════════
   O que está esperando execução, e de quem é cada coisa.

   A task pertence a um SÓCIO, e só a máquina dele executa — é o que faz o
   multi-máquina funcionar: a Ana abre uma task pro Bruno, ela espera o
   runner do Bruno, e roda onde o repo e a assinatura dele estão. */
import { ler } from './config.mjs'
import { get } from './api.mjs'
import { cabecalho, dim, bold, azul, verde, gold, coral, info } from './ui.mjs'

const dono = (t) => t.dono || null

export async function fila(argv) {
  const cfg = await ler()
  const eu = String(cfg.email || '').toLowerCase()
  const todas = argv.includes('--todas')

  const tarefas = await get('/api/office/tarefas-agent')
  const abertas = tarefas.filter(t => !t.feita)

  const minhas = abertas.filter(t => dono(t) === eu)
  const livres = abertas.filter(t => !dono(t))
  const alheias = abertas.filter(t => dono(t) && dono(t) !== eu)

  cabecalho(`fila ${dim(`· ${eu}`)}`)

  const bloco = (titulo, lista, cor) => {
    if (!lista.length) return
    info(`  ${cor(titulo)} ${dim(`(${lista.length})`)}`)
    for (const t of lista) {
      const estado = t.aguardandoDecisao ? coral('espera decisão')
        : t.rodandoEm ? azul(`rodando em ${t.rodandoEm}`)
        : t.pedidoEm ? gold('pedida — aguardando runner')
        : dim('parada')
      info(`    ${bold(t.titulo.slice(0, 58))}`)
      info(`      ${dim(t.squad)} ${dim('·')} ${dim(t.board || 'sem board')} ${dim('·')} ${estado}`)
      if (t.progresso?.etapa) info(`      ${dim(`retomando da etapa ${t.progresso.etapa}`)}`)
    }
    info('')
  }

  bloco('minhas — a minha máquina executa', minhas, verde)
  bloco('sem dono — qualquer runner pega', livres, gold)
  if (todas) bloco('de outros sócios', alheias, dim)

  if (!minhas.length && !livres.length) {
    info(dim('  nada pra esta máquina executar.'))
    if (alheias.length) info(dim(`  (${alheias.length} task(s) esperando a máquina de outro sócio — vê com --todas)`))
    info('')
  } else if (alheias.length && !todas) {
    info(dim(`  + ${alheias.length} de outros sócios (--todas mostra)\n`))
  }
}
