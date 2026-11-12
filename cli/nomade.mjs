#!/usr/bin/env node
/* nomade — o Nomade Business no terminal.
 *
 *   nomade login                 conecta esta máquina (device-code + Google)
 *   nomade                       conversa com o orquestrador (REPL)
 *   nomade "cria as tasks do X"  um tiro só
 *   nomade runner                deixa a máquina pegando trabalho da fila
 *   nomade maquinas              quem está de pé na conta
 *   nomade decisoes              a fila do que só um sócio resolve
 *
 * Substitui o instalador do app: aqui o npm instala o binário nativo da
 * plataforma CERTA, porque roda na máquina de destino. */
import { erroLegivel } from './lib/api.mjs'
import { erro, info, dim, bold, azul, marca } from './lib/ui.mjs'

const [, , cmd, ...resto] = process.argv

const AJUDA = `
${marca('nomade')} ${dim('— o Nomade Business no terminal')}

  ${bold('nomade login')}              conecta esta máquina (abre o navegador)
  ${bold('nomade')}                    conversa com o orquestrador
  ${bold('nomade')} ${dim('"faz X"')}            manda uma e sai
  ${bold('nomade runner')}             pega trabalho da fila e executa aqui
  ${bold('nomade maquinas')}           máquinas conectadas na conta
  ${bold('nomade decisoes')}           o que está esperando um sócio
  ${bold('nomade memoria')}            saúde da memória ${dim('(+ backfill)')}
  ${bold('nomade mcp')}                liga a memória no Claude Code desta máquina
  ${bold('nomade fila')}               o que espera execução, e de quem é
  ${bold('nomade rodar')} ${dim('"título"')}      dá play numa task
  ${bold('nomade aqui')} ${dim('"pedido"')}      roda um agent NESTA pasta, sem card ${dim('(--agent --modelo)')}
  ${bold('nomade setpath')} ${dim('<Board>')}     aponta o board pra pasta ATUAL
  ${bold('nomade pastas')}             onde mora o clone de cada board ${dim('(--detectar)')}
  ${bold('nomade leads')} ${dim('"o quê" "onde"')}   acha negócio real e vira lead ${dim('(--importar)')}
  ${bold('nomade pecas')}              as peças prontas ${dim('(--abrir)')}
  ${bold('nomade doutor')}             esta máquina consegue executar? ${dim('(Claude, contas, Node)')}
  ${bold('nomade whoami')}             quem está logado nesta máquina
  ${bold('nomade logout')}             apaga a credencial daqui

${dim('opções')}
  --nova                       começa outra conversa (no chat)
  --uma                        roda uma task e sai (no runner)
  --todas                      inclui as tasks de outros sócios (na fila)
  --url=https://…              aponta pra outro serviço (no login)

${dim('config em ~/.nomade/config.json · contas Claude em ~/.nomade/contas')}
`

async function main() {
  switch (cmd) {
    case 'login':    return (await import('./lib/login.mjs')).login(resto)
    case 'logout':   return (await import('./lib/login.mjs')).logout()
    case 'whoami':   return (await import('./lib/login.mjs')).whoami()
    case 'doutor':
    case 'doctor':   return (await import('./lib/doutor.mjs')).doutor()
    case 'runner':   return (await import('./lib/runner.mjs')).runner(resto)
    case 'maquinas':
    case 'machines': return (await import('./lib/runner.mjs')).maquinas()
    case 'decisoes':
    case 'decisions':return (await import('./lib/chat.mjs')).decisoes()
    case 'memoria':
    case 'memory':  return (await import('./lib/memoria.mjs')).memoria(resto)
    case 'mcp':     return (await import('./lib/mcp.mjs')).mcp(resto)
    case 'fila':
    case 'queue':   return (await import('./lib/fila.mjs')).fila(resto)
    case 'pastas':
    case 'paths':   return (await import('./lib/pastas.mjs')).pastas(resto)
    case 'setpath':
    case 'pasta':   return (await import('./lib/pastas.mjs')).setpath(resto)
    case 'leads':   return (await import('./lib/leads.mjs')).leads(resto)
    case 'rodar':
    case 'run':     return (await import('./lib/rodar.mjs')).rodar(resto)
    case 'aqui':
    case 'now':     return (await import('./lib/aqui.mjs')).aqui(resto)
    case 'help':
    case '--help':
    case '-h':       return info(AJUDA)
    case 'version':
    case '--version': {
      const { readFile } = await import('node:fs/promises')
      const { fileURLToPath } = await import('node:url')
      const pkg = JSON.parse(await readFile(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'))
      return info(pkg.version)
    }
    default:
      // sem subcomando conhecido = chat (com ou sem mensagem)
      return (await import('./lib/chat.mjs')).chat(cmd ? [cmd, ...resto] : [])
  }
}

main().catch((e) => {
  erro(erroLegivel(e))
  process.exit(1)
})
