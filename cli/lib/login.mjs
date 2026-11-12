/* LOGIN por device-code — o mesmo fluxo que o app desktop já usa, então o
   servidor não muda nada: pede um código, abre o navegador em /link, o sócio
   entra com o Google, e o CLI busca o JWT de 90 dias.
   A credencial nunca passa pelo terminal: quem vê a conta Google é o navegador. */
import { exec } from 'node:child_process'
import { ler, gravar, limpar, SERVICO_PADRAO } from './config.mjs'
import { api } from './api.mjs'
import { cabecalho, dim, bold, ok, erro, info, azul } from './ui.mjs'

function abrirNavegador(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start ""'
    : 'xdg-open'
  exec(`${cmd} "${url}"`, () => { /* sem navegador: o sócio abre na mão */ })
}

const espera = (ms) => new Promise(r => setTimeout(r, ms))

export async function login(argv) {
  const urlArg = argv.find(a => a.startsWith('--url='))
  const url = urlArg ? urlArg.slice(6).replace(/\/$/, '') : (await ler()).url || SERVICO_PADRAO
  await gravar({ url })

  cabecalho(`conectando esta máquina em ${dim(url)}`)

  const r = await api('/api/device/code', { method: 'POST', publico: true })
  if (!r.ok) { erro(`o serviço respondeu ${r.status}. Confere a URL: ${url}`); process.exit(1) }
  const { code, secret } = await r.json()

  const linkUrl = `${url}/link?code=${code}`
  info(`  código:  ${bold(code)}`)
  info(`  abre:    ${azul(linkUrl)}\n`)
  info(dim('  (abrindo no navegador… se não abrir, cola o endereço acima)'))
  abrirNavegador(linkUrl)

  // O código vive em memória no servidor; poll até o sócio terminar o Google.
  const limite = Date.now() + 5 * 60_000
  process.stdout.write(dim('\n  esperando o login'))
  while (Date.now() < limite) {
    await espera(2500)
    process.stdout.write(dim('.'))
    const p = await api('/api/device/poll', {
      method: 'POST', publico: true, body: JSON.stringify({ code, secret }),
    }).catch(() => null)
    if (!p) continue
    if (p.status === 202) continue                    // ainda não entrou
    if (p.status === 404) { console.log(); erro('o código expirou. Roda de novo: nomade login'); process.exit(1) }
    if (p.status === 403) { console.log(); erro('código não confere — tenta de novo.'); process.exit(1) }
    if (!p.ok) continue
    const { token, email } = await p.json()
    await gravar({ token, email })
    console.log('\n')
    ok(`conectado como ${bold(email)}`)
    info(dim('\n  próximo passo:'))
    info(`    ${azul('nomade runner')}    ${dim('deixa esta máquina pegando trabalho da fila')}`)
    info(`    ${azul('nomade')}           ${dim('conversa com o orquestrador')}\n`)
    return
  }
  console.log()
  erro('tempo esgotado (5 min). Roda de novo: nomade login')
  process.exit(1)
}

export async function logout() {
  await limpar()
  ok('desconectado desta máquina. O token foi apagado de ~/.nomade/config.json')
}

export async function whoami() {
  const cfg = await ler()
  if (!cfg.token) { erro('não conectado. Roda: nomade login'); process.exit(1) }
  info(`${bold(cfg.email || '?')}  ${dim('·')}  ${dim(cfg.url)}`)
  info(dim(`máquina ${cfg.machineId || '(ainda não registrada — roda o runner uma vez)'}`))
}
