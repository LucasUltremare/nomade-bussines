/* ═══ CLAUDE DA MÁQUINA ══════════════════════════════════════════════════
   O motor agêntico roda na ASSINATURA do sócio, não em chave de API: o
   agente.mjs apaga ANTHROPIC_API_KEY do ambiente e o SDK cai no login do
   Claude Code desta máquina.

   Só que o SDK não sabe LOGAR. Ele lê a credencial que o CLI do Claude
   gravou. Sem `claude` instalado e sem ninguém ter rodado ele uma vez, a
   máquina se registra bonitinha, pega task da fila e só então falha — com
   erro de autenticação no meio de um run, que é o pior lugar pra descobrir.

   Por isso esta checagem existe e roda ANTES: instalado? logado? A resposta
   sobe no registro da máquina e aparece na aba Máquina do admin. */
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const WIN = process.platform === 'win32'

/* No Windows `claude` pode ser .exe (instalador nativo) ou .cmd (npm global),
   e execFile não executa .cmd sem shell — então lá vai com shell pra cobrir os
   dois. Nos outros o shell é desnecessário, e evitá-lo é o certo mesmo aqui,
   onde só passam constantes. */
const opts = { shell: WIN, timeout: 15_000, windowsHide: true }

/** Onde o CLI do Claude guarda a credencial quando ninguém aponta outra pasta. */
export function pastaPadraoDoClaude() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

/* O instalador NATIVO, não `npm i -g`: ele se auto-atualiza em background, o
   que numa máquina que fica ligada sozinha é a diferença entre estar sempre na
   versão certa e depender de alguém lembrar. */
export const COMO_INSTALAR = WIN
  ? 'irm https://claude.ai/install.ps1 | iex'
  : 'curl -fsSL https://claude.ai/install.sh | bash'

/** O `claude` está no PATH? Devolve o caminho, ou null. */
async function ondeEsta() {
  try {
    const { stdout } = await exec(WIN ? 'where' : 'which', ['claude'], opts)
    return stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean) || null
  } catch { return null } // não está no PATH — `where`/`which` sai com código ≠ 0
}

/* macOS guarda a credencial no Keychain em vez de arquivo; Linux e Windows
   usam ~/.claude/.credentials.json. Checar só o arquivo dava "sem login" em
   Mac logado, que é falso negativo — e falso negativo aqui manda o sócio
   refazer um login que já estava feito. */
async function temCredencial(dir) {
  try { await fsp.access(path.join(dir, '.credentials.json')); return true } catch { /* segue */ }
  /* O Keychain guarda UMA credencial, a do login padrão. Consultá-lo pra uma
     pasta de sócio ainda não logada devolveria "sim" pela credencial de outra
     pessoa — por isso o fallback vale só quando a pasta É a padrão. */
  if (process.platform !== 'darwin' || dir !== path.join(os.homedir(), '.claude')) return false
  try {
    await exec('security', ['find-generic-password', '-s', 'Claude Code-credentials'], { timeout: 5_000 })
    return true
  } catch { return false }
}

/**
 * Estado do Claude nesta máquina.
 * `{ cli, versao, caminho, login, pasta, diagnostico }`
 * — `cli`   o binário existe e responde
 * — `login` existe credencial na pasta padrão (as pastas por sócio são
 *           checadas à parte, em runner.mjs/descobrirContas)
 */
export async function checarClaude() {
  const pasta = pastaPadraoDoClaude()
  const caminho = await ondeEsta()
  const login = await temCredencial(pasta)

  if (!caminho) {
    return {
      cli: false, versao: null, caminho: null, login, pasta,
      diagnostico: `CLI do Claude não encontrado no PATH — instala com \`${COMO_INSTALAR}\` e roda \`claude\` uma vez pra logar.`,
    }
  }

  let versao = null
  try {
    const { stdout } = await exec('claude', ['--version'], opts)
    versao = stdout.trim().split(/\r?\n/)[0].slice(0, 60) || null
  } catch {
    /* Achado no PATH mas não executa: instalação quebrada, ou o binário é de
       outra arquitetura. Não é o mesmo caso de "não instalado" e o sócio
       precisa saber a diferença — reinstalar resolve um, não o outro. */
    return {
      cli: false, versao: null, caminho, login, pasta,
      diagnostico: `achei ${caminho} mas \`claude --version\` falhou — instalação quebrada, reinstala com \`${COMO_INSTALAR}\`.`,
    }
  }

  return {
    cli: true, versao, caminho, login, pasta,
    diagnostico: login
      ? 'pronto pra rodar na assinatura.'
      : `instalado, mas sem login nesta pasta (${pasta}) — roda \`claude\` uma vez e entra com a conta.`,
  }
}
