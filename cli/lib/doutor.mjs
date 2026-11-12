/* ═══ DOUTOR ═════════════════════════════════════════════════════════════
   `nomade doutor` — esta máquina consegue executar a fila?

   Existe porque as falhas de setup são todas mudas: o runner sobe verde, se
   registra no admin, e só quebra quando cai a primeira task de Claude na
   fila. Aqui a mesma verificação acontece em dois segundos, com o comando de
   conserto do SISTEMA CERTO já montado — a linha do Mac não serve no
   PowerShell e vice-versa. */
import os from 'node:os'
import path from 'node:path'
import { ler, baseDasContas } from './config.mjs'
import { checarClaude, COMO_INSTALAR } from './claude.mjs'
import { descobrirContas } from './runner.mjs'
import { cabecalho, dim, bold, azul, verde, gold, coral, info } from './ui.mjs'

const WIN = process.platform === 'win32'
const SISTEMA = WIN ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'

const sim = verde('✓')
const nao = coral('✗')
const talvez = gold('!')

const linha = (marca, rotulo, valor) => info(`  ${marca} ${bold(rotulo.padEnd(16))} ${valor}`)

/** O comando pra logar uma conta separada, na sintaxe do shell desta máquina. */
export function comandoDeConta(nome = 'socio') {
  const dir = path.join(baseDasContas(), nome)
  return WIN
    ? `$env:CLAUDE_CONFIG_DIR="${dir}"; claude`
    : `CLAUDE_CONFIG_DIR="${dir}" claude`
}

export async function doutor() {
  const cfg = await ler()
  const nodeMaior = Number(process.versions.node.split('.')[0])
  const claude = await checarClaude()
  const contas = await descobrirContas()
  const logadas = contas.filter(c => c.logada)
  const conserto = []

  cabecalho(`diagnóstico desta máquina ${dim(`· ${os.hostname()} · ${SISTEMA}`)}`)

  /* ── Node ── */
  if (nodeMaior >= 20) linha(sim, 'Node', `${process.version} ${dim(`(${process.platform}-${process.arch})`)}`)
  else {
    linha(nao, 'Node', `${process.version} ${coral('— o CLI pede 20+')}`)
    conserto.push(WIN ? 'winget install OpenJS.NodeJS.LTS' : process.platform === 'darwin' ? 'brew install node' : 'sudo apt install nodejs')
  }

  /* ── conta ── */
  if (cfg.token) linha(sim, 'Painel', `${cfg.email || '?'} ${dim(`· ${cfg.url}`)}`)
  else {
    linha(nao, 'Painel', coral('não conectado'))
    conserto.push('nomade login')
  }

  /* ── CLI do Claude ── */
  if (claude.cli) linha(sim, 'CLI do Claude', `${claude.versao || 'instalado'} ${dim(`· ${claude.caminho}`)}`)
  else {
    linha(nao, 'CLI do Claude', coral('não encontrado no PATH'))
    conserto.push(COMO_INSTALAR)
  }

  /* ── assinatura ──
     Uma conta separada por sócio serve, o login padrão da máquina também.
     O que NÃO serve é nenhum dos dois: aí todo squad em Claude é devolvido. */
  if (logadas.length) {
    linha(sim, 'Assinatura', `${logadas.map(c => c.id).join(', ')} ${dim(`em ${baseDasContas()}`)}`)
  } else if (claude.login) {
    linha(sim, 'Assinatura', `login padrão desta máquina ${dim(`· ${claude.pasta}`)}`)
    info(dim(`    ${contas.length ? 'há pastas por sócio, mas nenhuma logada — ' : ''}pra separar por sócio: ${comandoDeConta()}`))
  } else {
    linha(nao, 'Assinatura', coral('nenhum login do Claude nesta máquina'))
    if (claude.cli) conserto.push('claude') // rodar uma vez abre o login e grava a credencial
  }

  /* ── chave de API: informativo, não requisito ──
     Se estiver setada no ambiente, o agente.mjs a APAGA de propósito — quem
     paga é a assinatura. Vale dizer, senão alguém "conserta" o que funciona. */
  if (process.env.ANTHROPIC_API_KEY) {
    linha(talvez, 'ANTHROPIC_KEY', dim('setada no ambiente — o runner a ignora de propósito (roda na assinatura)'))
  }

  /* ── pastas dos repositórios ──
     Não dá pra checar sem token (a lista vem do serviço), então aqui só o
     ponteiro: é a segunda causa de task devolvida, depois do Claude. */
  if (cfg.token) info(dim(`\n  ${' '.repeat(2)}repos            confere com \`nomade pastas\` — board sem pasta o runner recusa`))

  const pronto = nodeMaior >= 20 && cfg.token && (claude.login || logadas.length)
  info('')
  if (pronto) {
    info(`  ${verde('pronto pra executar.')} ${dim('sobe com')} ${azul('nomade runner')}\n`)
  } else {
    info(`  ${gold('falta resolver:')}`)
    for (const c of conserto) info(`    ${azul(c)}`)
    if (!claude.login && !logadas.length && claude.cli) {
      info(dim('\n    (rodar `claude` uma vez abre o login da assinatura e grava a credencial'))
      info(dim(`     que o runner usa. Pra conta por sócio: ${comandoDeConta()})`))
    }
    info('')
  }
}
