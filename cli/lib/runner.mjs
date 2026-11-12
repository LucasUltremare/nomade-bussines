/* ═══ RUNNER ═════════════════════════════════════════════════════════════
   Esta máquina vira executora da fila. O contrato não muda em relação ao app:
   a WEB NUNCA fala com a máquina — o runner PUXA trabalho (fila/claim) e
   EMPURRA progresso (office_runs). É por isso que funciona atrás de NAT, sem
   porta aberta e sem túnel.

   O clone dos projetos mora AQUI: `pastaNoRunner` vem do board, não da máquina
   de quem clicou em play. */
import os from 'node:os'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ler, machineId, baseDasContas } from './config.mjs'
import { api, get, post, erroLegivel } from './api.mjs'
import { rodarSquad } from './agente.mjs'
import { checarClaude } from './claude.mjs'
import { aplicarModo } from './modos.mjs'
import { cabecalho, dim, bold, azul, gold, coral, verde, info, erro, agora } from './ui.mjs'

const CICLO_MS = 12_000
const HEARTBEAT_MS = 60_000 // a web considera offline com 90s sem sinal
const espera = (ms) => new Promise(r => setTimeout(r, ms))

/* ═══ LIMITE DE SESSÃO ═══════════════════════════════════════════════════
   Metade das falhas registradas foi "You've hit your session limit · resets
   7pm" — e três delas foram a MESMA parede batida de novo em 12s, porque o
   ciclo não distingue erro que passa de erro que só passa no relógio. Os runs
   duraram 382s, 3s e 2s: os dois últimos foram puro desperdício.

   A chave de API resolve a causa. Isto aqui é o cinto: se a assinatura for o
   caminho (máquina sem chave), a fila para até o horário do reset em vez de
   moer. Teto de 1h porque parada longa demais some do olho de quem opera. */
const PAUSA_MAX_MS = 60 * 60_000
const PAUSA_PADRAO_MS = 15 * 60_000

const ehLimiteDeSessao = (txt) => /hit your (session|usage) limit|session limit reached/i.test(String(txt || ''))

/* "resets 7pm" ou "resets 1:30pm" → quanto falta em ms. Sem hora legível,
   devolve o padrão: melhor esperar 15 min do que fingir que dá pra continuar. */
function esperaAteReset(txt) {
  const m = String(txt || '').match(/resets?\s+(\d{1,2})(?::(\d{2}))?\s*([ap])m/i)
  if (!m) return PAUSA_PADRAO_MS
  let h = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'p') h += 12
  const alvo = new Date()
  alvo.setHours(h, Number(m[2] || 0), 30, 0) // +30s de folga: relógio do provedor não é o nosso
  if (alvo <= new Date()) alvo.setDate(alvo.getDate() + 1) // já passou hoje = é amanhã
  return Math.min(PAUSA_MAX_MS, Math.max(60_000, alvo - Date.now()))
}

/** Contas Claude logadas nesta máquina — uma pasta por sócio. */
export async function descobrirContas() {
  const base = baseDasContas()
  try {
    const dirs = (await fsp.readdir(base, { withFileTypes: true }))
      .filter(d => d.isDirectory()).map(d => d.name).slice(0, 12)
    const contas = []
    for (const nome of dirs) {
      const dir = path.join(base, nome)
      let logada = false
      try { await fsp.access(path.join(dir, '.credentials.json')); logada = true } catch { /* ainda não logou */ }
      contas.push({ id: nome, configDir: dir, logada })
    }
    return contas
  } catch { return [] } // pasta não existe = nenhuma conta separada; usa o login padrão da máquina
}

/** A conta que deve rodar ESTA task: a do dono, se ele logou aqui. */
function contaParaRun(contas, dono) {
  const logadas = contas.filter(c => c.logada)
  if (!logadas.length) return null
  return (dono && logadas.find(c => c.id === String(dono).toLowerCase())) || logadas[0]
}

/* Modo de energia: o admin guarda a intenção, a máquina aplica. `modoFalhou`
   existe pra não repetir o mesmo aviso a cada 60s numa máquina onde aquele
   modo não é aplicável (Mac, ou Windows sem as tarefas do C:\Ops). */
let modoAplicado = null
let modoFalhou = null

async function sincronizarModo(desejado, cfg) {
  if (!desejado || desejado === modoAplicado || desejado === modoFalhou) return
  const r = await aplicarModo(desejado, cfg)
  if (r.ok) {
    modoAplicado = r.modo
    modoFalhou = null
    info(`${agora()} ${azul('modo')} ${bold(r.modo)} ${dim('· aplicado a pedido do admin')}`)
  } else {
    modoFalhou = desejado
    info(`${agora()} ${gold('modo')} ${bold(desejado)} ${dim(`· não aplicado: ${r.motivo}`)}`)
  }
}

async function registrar(contas, claude, cfg = {}) {
  const id = await machineId()
  const resp = await post('/api/machines/register', {
    machineId: id,
    name: os.hostname(),
    platform: `${process.platform}-${process.arch}`,
    servidor: true,                       // é isto que marca a máquina como RUNNER
    contas: contas.filter(c => c.logada).length,
    /* Sobe junto pra aba Máquina do admin mostrar POR QUE um runner online não
       executa nada. Sem isto o sintoma na tela é "máquina verde, fila parada". */
    claude: claude ? { cli: claude.cli, versao: claude.versao, login: claude.login } : null,
    // o que ESTA máquina aplicou; o admin compara com o que ele pediu
    modo: modoAplicado,
  }).catch(() => null)
  // a resposta traz o modo desejado — a web não manda comando, ela responde
  await sincronizarModo(resp?.modo, cfg).catch(() => {})
  return id
}

export async function runner(argv) {
  const cfg = await ler()
  if (!cfg.token) { erro('não conectado. Roda: nomade login'); process.exit(1) }
  const umaSo = argv.includes('--uma') // roda uma task e sai (bom pra testar)

  const contas = await descobrirContas()
  /* Antes de qualquer coisa: o motor Claude roda na assinatura desta máquina,
     e quem grava a credencial é o CLI do Claude. Descobrir que ele falta no
     meio de um run custa uma task falhada; descobrir aqui custa uma linha. */
  let claude = await checarClaude()
  const id = await registrar(contas, claude, cfg)

  cabecalho(`runner em ${bold(os.hostname())} ${dim(`(${cfg.email})`)}`)
  info(`  executa   ${dim('as tasks de')} ${bold(cfg.email)} ${dim('+ as sem dono')}`)
  info(`  serviço  ${dim(cfg.url)}`)
  info(`  máquina  ${dim(id)}`)
  /* Qual credencial vai pagar este runner. Sem isto na tela, ninguém descobre
     que voltou pra assinatura até a fila morrer às 19h com "session limit". */
  const chaveDaEquipe = await get('/api/office/keys/raw').then(k => String(k.anthropic || '').trim()).catch(() => '')
  info(`  claude   ${chaveDaEquipe
    ? `${verde('chave de API da equipe')} ${dim('· automação não gasta seat de assinatura')}`
    : gold('assinatura desta máquina — sujeito a limite de sessão')}`)
  info(`  contas   ${contas.filter(c => c.logada).length
    ? contas.filter(c => c.logada).map(c => c.id).join(', ')
    : dim('nenhuma pasta separada — usando o login padrão do Claude Code desta máquina')}`)
  info(`  claude   ${claude.cli
    ? `${verde(claude.versao || 'instalado')} ${claude.login ? dim('· logado') : gold('· sem login')}`
    : coral('não encontrado')}`)

  /* Aviso, não erro fatal: squad com modelo GLM/Gemini/Ollama roda sem Claude
     nenhum, e barrar o runner inteiro tiraria do ar quem não depende disso. */
  if (!claude.cli || (!claude.login && !contas.some(c => c.logada))) {
    info(`\n  ${gold('!')} ${claude.diagnostico}`)
    info(dim('    Squads em Claude vão ser devolvidos pra fila até resolver.'))
    info(dim('    Squad com modelo GLM, Gemini ou Ollama roda normal — esses usam a chave da equipe.'))
  }
  info(`\n  ${dim('ctrl+c pra parar')}\n`)

  /* Só reconfere o Claude enquanto ele está ruim: assim o sócio que instala e
     loga com o runner aberto vê a tela ficar verde sozinha, e a máquina
     saudável não paga um `claude --version` por minuto pra sempre. */
  const bater = setInterval(async () => {
    if (!claude.cli || !claude.login) claude = await checarClaude().catch(() => claude)
    registrar(contas, claude, cfg).catch(() => {})
  }, HEARTBEAT_MS)
  let vazioAnunciado = false

  try {
    for (;;) {
      let pegou = false
      try {
        pegou = await umCiclo(contas, { silenciarVazio: vazioAnunciado, machineId: id })
        if (pegou) vazioAnunciado = false
        else vazioAnunciado = true
      } catch (e) {
        info(`${agora()} ${coral('falha no ciclo')} ${dim(erroLegivel(e))}`)
      }
      if (umaSo && pegou) break
      await espera(pegou?.pausa || CICLO_MS)
    }
  } finally {
    clearInterval(bater)
  }
}

/** Um ciclo: pede trabalho, roda se vier. Devolve true se rodou algo. */
async function umCiclo(contas, { silenciarVazio, machineId } = {}) {
  /* `maquina` é o hostname, que serve pra LER na tela; `machineId` é o id
     estável do config.json, que é o que o claim usa pra filtrar. Hostname
     colide entre máquinas e muda quando alguém renomeia o PC — carimbar fila
     por ele daria trabalho executando no lugar errado. */
  const { task, squad } = await post('/api/office/fila/claim', { maquina: os.hostname(), machineId })
  if (!task) {
    if (!silenciarVazio) info(`${agora()} ${dim('fila vazia — esperando trabalho')}`)
    return false
  }

  const soltar = async (motivo) => {
    info(`${agora()} ${gold('devolvi')} "${task.titulo}" ${dim(`— ${motivo}`)}`)
    await post('/api/office/fila/soltar', { taskId: task.id }).catch(() => {})
  }

  if (!squad?.agents?.length && !squad?.instrucoes) return soltar('squad sem instrução nem agents') || false
  if (!task.pasta) return soltar('o board não tem pasta configurada no runner') || false
  try { await fsp.access(task.pasta) } catch { return soltar(`a pasta ${task.pasta} não existe nesta máquina`) || false }

  /* Conta Claude só é exigida se o squad ROda em Claude. Squad com modelo
     `zai:`, `gemini:` ou `ollama:` usa a chave da equipe e não precisa de
     assinatura nenhuma nesta máquina — era o que barrava sócio sem Claude
     de executar, que é exatamente quem o motor novo veio destravar. */
  const modelo = squad.modelo || squad.agents?.[0]?.model || ''
  const precisaClaude = !modelo || /^claude/i.test(modelo)
  const conta = precisaClaude ? contaParaRun(contas, task.dono) : null
  if (precisaClaude && contas.length && !conta) {
    return soltar(`nenhuma conta Claude logada nesta máquina — ou loga (roda "claude" no terminal), ou põe um modelo GLM no squad "${squad.name}"`) || false
  }

  // objetivo = título + detalhe + o que os sócios JÁ responderam nesta task
  const objetivo = [
    task.titulo,
    task.detalhe,
    (task.decisoes || []).length
      ? 'Decisões já respondidas pelos sócios (segue elas, não pergunta de novo):\n' +
        task.decisoes.map(d => `- ${d.pergunta} → ${d.tipo || 'aprovar'}${d.resolucao ? `: ${d.resolucao}` : ''}`).join('\n')
      : '',
    /* Critérios no OBJETIVO, não só no gate do entregar: o agent tem que saber
       o que vai ser cobrado ANTES de trabalhar, senão descobre no fim e refaz. */
    (task.criterios || []).length
      ? 'CRITÉRIOS DE ACEITE — a task só está feita se todos forem verdade, e o entregar vai te cobrar um por um:\n' +
        task.criterios.map(c => `- ${c}`).join('\n')
      : '',
  ].filter(t => String(t || '').trim()).join('\n\n')

  const run = await post('/api/office/runs', {
    taskId: task.id, squad: squad.name, maquina: os.hostname(),
    conta: conta?.id || 'login da máquina', total: 1, retomando: 0,
  }).catch(() => null)

  info(`\n${agora()} ${azul('▶')} ${bold(task.titulo)} ${dim(`· ${squad.name} · ${task.pasta}`)}`)

  const r = await rodarSquad({
    cwd: task.pasta, objetivo, squad, taskId: task.id, runId: run?.id || null,
    contaDir: conta?.configDir || null,
    criterios: task.criterios || [],
  })

  const seg = Math.round((r.duracaoMs || 0) / 1000)
  if (r.parouPorDecisao) info(`${agora()} ${gold('⏸ decisão aberta')} ${dim(`· ${seg}s`)}\n`)
  else if (r.ok) info(`${agora()} ${verde('✓ entregue')} ${dim(`· ${seg}s`)}\n`)
  else info(`${agora()} ${coral('✗ ' + (r.motivo || 'falhou'))} ${dim(`· ${seg}s`)}\n`)

  /* Parede de horário: devolve a task E para a fila. Sem soltar, a task fica
     travada nesta máquina durante a pausa; sem parar, a máquina volta em 12s
     pra bater na mesma parede. */
  const texto = `${r.motivoBruto || ''} ${r.motivo || ''}`
  if (!r.ok && ehLimiteDeSessao(texto)) {
    const ms = esperaAteReset(texto)
    await post('/api/office/fila/soltar', { taskId: task.id }).catch(() => {})
    info(`${agora()} ${gold('⏸ limite de sessão da assinatura')} ${dim(`— pausando ${Math.round(ms / 60000)} min e devolvendo a task`)}`)
    info(dim('    (uma chave de API em Chaves no admin evita isto: automação não gasta seat)\n'))
    return { pausa: ms }
  }
  return true
}

/** `nomade maquinas` — quem está de pé na conta. */
export async function maquinas() {
  const rows = await get('/api/machines')
  if (!rows.length) { info(dim('nenhuma máquina registrada ainda. Roda `nomade runner` numa delas.')); return }
  cabecalho('máquinas da conta')
  for (const m of rows) {
    const luz = m.online ? verde('●') : dim('○')
    info(`  ${luz} ${bold(m.name)} ${dim(`· ${m.platform}${m.lanIp ? ` · ${m.lanIp}` : ''}`)}`)
    if (m.models?.length) info(`      ${dim(`modelos locais: ${m.models.slice(0, 6).join(', ')}`)}`)
  }
  info('')
}
