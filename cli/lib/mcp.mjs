/* ═══ `nomade mcp` ═════════════════════════════════════════════════════
   Liga a memória da empresa no Claude Code de quem rodar isto.

   Existe porque a instalação à mão tem três passos e cada um erra de um jeito
   diferente: achar o caminho absoluto do arquivo, lembrar do `-s user` (senão
   só vale na pasta atual), e ter feito login antes (o servidor lê o token que
   o `nomade login` guardou). Um comando resolve os três e diz qual falhou.

     nomade mcp            instala
     nomade mcp --remover  desinstala                                    */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import url from 'node:url'
import { ler } from './config.mjs'
import { cabecalho, dim, bold, verde, gold, coral, azul, info, erro } from './ui.mjs'

const exec = promisify(execFile)

/* ACHAR O `claude` — PATH primeiro, depois os lugares conhecidos.

   No macOS o instalador põe um symlink em ~/.local/bin/claude e escreve a
   linha do PATH no ~/.zshrc. Isso vale num terminal interativo, onde o
   .zshrc já rodou; mas `execFile` herda o PATH do processo, e um CLI chamado
   de fora desse contexto não encontraria o binário.

   Distinguir "não instalado" de "instalado fora do PATH" importa: a segunda
   mensagem manda arrumar o PATH, a primeira manda instalar de novo o que já
   está lá — e é o tipo de instrução errada que faz alguém desistir. */
const WIN = process.platform === 'win32'

/* No Windows o `claude` é um .cmd, e execFile SEM shell não executa .cmd nem
   .bat — dá ENOENT mesmo com o binário no PATH.

   Mas com `shell: true` o Node JUNTA os argumentos com espaço e entrega a
   linha pronta pro cmd.exe: quem tem espaço dentro (o `C:\Program
   Files\nodejs\node.exe` da vida) parte no meio, e o `claude mcp add`
   registra um comando quebrado. O servidor então aparece como "failed to
   connect", sem nada dizendo que o problema é uma aspas faltando.

   Por isso as aspas são postas AQUI, argumento por argumento — e só onde
   precisa, senão o `--` e o `-s` chegam citados e o claude não os reconhece. */
const citar = (a) => (WIN && /[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a)
const rodar = (bin, args) => WIN
  ? exec(citar(bin), args.map(citar), { shell: true })
  : exec(bin, args)

const CANDIDATOS = WIN
  ? [
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      path.join(os.homedir(), '.local', 'bin', 'claude.cmd'),
      path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
    ].filter(x => !x.startsWith(path.sep) || x.length > 3)
  : [
      path.join(os.homedir(), '.local/bin/claude'),
      path.join(os.homedir(), '.claude/local/claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ]

async function acharClaude() {
  try { await rodar('claude', ['--version']); return { bin: 'claude', noPath: true } }
  catch { /* não está no PATH deste processo — procura onde ele costuma cair */ }
  for (const c of CANDIDATOS) {
    try { await fsp.access(c); await rodar(c, ['--version']); return { bin: c, noPath: false } }
    catch { /* próximo */ }
  }
  return null
}

/* O servidor viaja DENTRO do pacote (cli/servicos/), não na raiz do repo.
   `files` do package.json já inclui `servicos`, então ele chega em quem roda
   `npm i -g @nomade/cli` sem clonar nada — que é o caso dos sócios.
   Resolver ao lado de si mesmo faz o caminho valer nos dois mundos: rodando
   do repositório ou de /opt/homebrew/lib/node_modules. */
const servidor = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'servicos', 'mcp-memoria.mjs')

export async function mcp(argv) {
  const remover = argv.includes('--remover') || argv.includes('--remove')
  cabecalho(remover ? 'desligar a memória do Claude Code' : 'ligar a memória no Claude Code')

  const claude = await acharClaude()
  if (!claude) {
    erro('não achei o Claude Code nesta máquina.')
    info(dim('  Instala primeiro: https://claude.com/claude-code\n'))
    process.exit(1)
  }
  if (!claude.noPath) {
    info(`  ${gold('achei o claude fora do PATH')} ${dim(claude.bin)}`)
    info(dim(WIN
      ? '  Funciona assim mesmo. Pra chamar `claude` de qualquer lugar, põe a pasta dele no Path do sistema.'
      : '  Funciona assim mesmo, mas pra chamar `claude` de qualquer lugar, põe no ~/.zshrc:'))
    if (!WIN) info(dim('    export PATH="$HOME/.local/bin:$PATH"'))
    info('')
  }

  if (remover) {
    try { await rodar(claude.bin, ['mcp', 'remove', 'nomade', '-s', 'user']) } catch { /* já não estava */ }
    info(`  ${verde('pronto')} ${dim('— reinicia o Claude Code pra sumir da sessão')}\n`)
    return
  }

  try { await fsp.access(servidor) }
  catch {
    erro(`não achei ${servidor}`)
    info(dim('  Este comando precisa do repositório clonado — o servidor MCP mora nele.\n'))
    process.exit(1)
  }

  /* Login ANTES, não depois: sem token o servidor sobe e toda busca devolve
     "sem token". Melhor falhar aqui, onde a mensagem diz o que fazer. */
  const cfg = await ler()
  if (!cfg.token) {
    erro('esta máquina não está conectada.')
    info(dim('  Roda primeiro:  ') + bold('nomade login') + '\n')
    process.exit(1)
  }

  // -s user: vale em QUALQUER pasta. Sem isso só funciona onde foi rodado.
  /* Qual `node` registrar. Bare "node" depende do PATH que o Claude Code usar
     pra lançar o servidor, e "node: command not found" lá dentro aparece
     apenas como servidor que não conecta. Mas process.execPath no Homebrew é
     versionado (…/Cellar/node/25.9.0_1/bin/node) e morre no próximo upgrade.
     Então: symlink estável quando existir, execPath como queda. */
  const node = await (async () => {
    // no Windows o execPath já é estável (node.exe não fica em pasta versionada)
    if (WIN) return process.execPath
    for (const c of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
      try { await fsp.access(c); return c } catch { /* próximo */ }
    }
    return process.execPath
  })()

  /* Remove antes de adicionar. Rodar de novo tem que CONSERTAR o registro, não
     falhar com "already exists" — é justamente quem já instalou uma vez que
     precisa disto, pra trocar um caminho velho (servidor que mudou de pasta,
     `node` bare que some do PATH) pelo atual. */
  try { await rodar(claude.bin, ['mcp', 'remove', 'nomade', '-s', 'user']) } catch { /* não estava */ }
  await rodar(claude.bin, ['mcp', 'add', 'nomade', '-s', 'user', '--', node, servidor])

  /* CONFERE que o que foi registrado de fato sobe. Sem isto o comando diz
     "ligado" e a falha só aparece depois, dentro do Claude Code, como "failed
     to connect" — sem nada ligando uma coisa à outra. Aconteceu no Windows:
     caminho com espaço quebrava o registro e o comando comemorava assim mesmo. */
  let saude = ''
  try {
    /* `claude mcp list` SAI COM ERRO quando qualquer outro servidor da conta
       precisa de autenticação — Gmail e Calendar, no caso. Ler só o caminho
       feliz descartava a saída boa junto com o código de erro, e o comando
       ficava sem saber se o nomade tinha subido. O stdout do erro serve
       igual: é a mesma listagem. */
    const r = await rodar(claude.bin, ['mcp', 'list']).catch(e => e)
    const linha = String(r?.stdout || '').split('\n').find(l => /nomade/i.test(l)) || ''
    saude = /connected|✔/i.test(linha) ? 'ok' : (linha ? 'falhou' : 'sumiu')
  } catch { saude = '?' }

  if (saude === 'falhou' || saude === 'sumiu') {
    erro('registrei, mas o servidor não sobe.')
    info(dim(`  node:     ${node}`))
    info(dim(`  servidor: ${servidor}`))
    info(dim('  Roda à mão pra ver o erro de verdade:'))
    info(`    ${azul(`"${node}" "${servidor}"`)}`)
    info(dim('  (ele fica esperando entrada — se não imprimir erro em 2s, o problema é outro)\n'))
    process.exit(1)
  }

  info(`  ${verde('ligado')} ${dim(`· ${cfg.email || 'esta conta'}`)}${saude === 'ok' ? dim(' · servidor responde') : ''}`)
  info(`  ${dim('servidor')}  ${dim(servidor)}`)
  info(`  ${dim('ferramentas')} buscar_memoria · ver_cliente · gravar_memoria\n`)
  info(`  ${gold('reinicia o Claude Code')} ${dim('— servidor MCP carrega na abertura da sessão')}`)
  info(dim(`  depois, confere com  ${azul('/mcp')}  dentro dele.\n`))
  info(dim('  Teste rápido, numa sessão nova:'))
  info(dim('    "o socket tá caindo em produção, o que a gente faz nesse caso?"'))
  info(dim(`    ${verde('acertou')} se citar o Nginx Proxy Manager derrubando o upgrade.`))
  info(dim(`    ${coral('não consultou')} se der conselho genérico de websocket.\n`))
}
