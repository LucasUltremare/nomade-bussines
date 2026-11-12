/* ═══ AQUI ═══════════════════════════════════════════════════════════════
     nomade aqui "<pedido>"                  roda um agent NESTA pasta, agora
     nomade aqui "<pedido>" --agent Dev      escolhe qual agent trabalha
     nomade aqui "<pedido>" --modelo opus    troca o modelo só nesta rodada
     nomade aqui                             lista os agents disponíveis

   O `runner` executa o que está no kanban; este comando é o contrário: roda
   agora, aqui, sem criar card. É pro trabalho que não vale um board — a
   pergunta rápida, o ajuste pontual, testar um agent antes de soltar ele na
   fila.

   Mesmo motor, mesmas ferramentas, mesma memória da empresa. O que muda é que
   não existe task pra fechar: o `entregar` encerra o turno e imprime aqui.

   A pasta é o diretório ATUAL, não a do board — quem roda está nela. */
import { get } from './api.mjs'
import { rodarSquad } from './agente.mjs'
import { checarClaude, COMO_INSTALAR } from './claude.mjs'
import { cabecalho, dim, bold, azul, verde, gold, coral, info, erro, agora } from './ui.mjs'

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/* Como as pessoas falam × o id que a API quer. A lista espelha a do canvas
   (SquadCanvas.jsx) de propósito: dois lugares oferecendo modelos diferentes
   confunde mais do que ajuda. */
const APELIDOS = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  glm: 'zai:glm-4.6',
  gpt: 'openai:gpt-5',
}

/** `--agent Dev` e `--agent=Dev` — os dois, porque as duas formas são naturais. */
function flag(argv, nome) {
  const i = argv.findIndex(a => a === `--${nome}`)
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  const eq = argv.find(a => a.startsWith(`--${nome}=`))
  return eq ? eq.slice(nome.length + 3) : null
}

export async function aqui(argv) {
  const pedido = argv.filter((a, i) => {
    if (a.startsWith('--')) return false
    // valor de flag não é parte do pedido
    const ant = argv[i - 1]
    return !(ant === '--agent' || ant === '--modelo')
  }).join(' ').trim()

  const squads = await get('/api/office/agents')
  if (!squads.length) { erro('nenhum agent criado ainda — cria no crew, aba Escritório.'); process.exitCode = 1; return }

  const nomeAgent = flag(argv, 'agent')
  if (!pedido || !nomeAgent) {
    cabecalho('agents disponíveis')
    for (const s of squads) {
      const motor = !s.modelo || /^claude/i.test(s.modelo) ? verde('assinatura') : gold('chave da equipe')
      info(`  ${bold(String(s.name).padEnd(14))} ${dim(String(s.modelo || 'claude (padrão)').padEnd(18))} ${motor}`)
    }
    info('')
    info(dim(`  ${azul('nomade aqui "arruma o parser de datas" --agent Dev')}`))
    info(dim(`  ${azul('nomade aqui "renomeia isso tudo" --agent "Dev rápido" --modelo haiku')}`))
    info(dim(`\n  roda na pasta atual, sem criar card. apelidos: ${Object.keys(APELIDOS).join(' · ')}\n`))
    return
  }

  const alvo = norm(nomeAgent)
  const squad = squads.find(s => norm(s.name) === alvo) || squads.find(s => norm(s.name).includes(alvo))
  if (!squad) {
    erro(`nenhum agent casa com "${nomeAgent}".`)
    info(dim('  agents: ' + squads.map(s => s.name).join(' · ') + '\n'))
    process.exitCode = 1
    return
  }

  const pedidoModelo = flag(argv, 'modelo')
  const modelo = pedidoModelo ? (APELIDOS[norm(pedidoModelo)] || pedidoModelo) : (squad.modelo || null)
  const ehClaude = !modelo || /^claude/i.test(modelo)

  /* Falhar aqui custa uma linha; falhar no meio do turno custa o run inteiro,
     e o erro que volta é de autenticação, que não diz o que fazer. */
  if (ehClaude) {
    const c = await checarClaude()
    if (!c.cli) { erro(`o CLI do Claude não está no PATH — instala com: ${COMO_INSTALAR}`); process.exitCode = 1; return }
    if (!c.login) { erro('sem login do Claude nesta máquina. Roda `claude` uma vez e entra com a conta.'); process.exitCode = 1; return }
  }

  cabecalho(`${squad.name} ${dim('· nesta pasta, sem card')}`)
  info(`  pasta    ${dim(process.cwd())}`)
  info(`  modelo   ${dim(modelo || 'claude (padrão do SDK)')}${pedidoModelo ? dim(' · só nesta rodada') : ''}`)
  info(`  motor    ${ehClaude ? verde('assinatura desta máquina') : gold('chave da equipe')}`)
  info(`\n${agora()} ${azul('▶')} ${bold(pedido)}\n`)

  const r = await rodarSquad({
    cwd: process.cwd(),
    objetivo: pedido,
    squad: { ...squad, modelo },   // override vale só neste objeto, não grava no squad
    taskId: null,                  // sem card: o entregar encerra o turno e imprime aqui
    runId: null,
    contaDir: null,                // login padrão da máquina — quem roda está nela
  })

  const seg = Math.round((r.duracaoMs || 0) / 1000)
  info('')
  if (r.parouPorDecisao) info(`${agora()} ${gold('⏸ decisão aberta')} ${dim(`· ${seg}s · responde em nomade decisoes`)}\n`)
  else if (r.ok) info(`${agora()} ${verde('✓ entregue')} ${dim(`· ${seg}s`)}\n`)
  else info(`${agora()} ${coral('✗ ' + (r.motivo || 'falhou'))} ${dim(`· ${seg}s`)}\n`)
}
