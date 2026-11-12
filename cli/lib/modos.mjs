/* ═══ MODO DE ENERGIA DA MÁQUINA ═════════════════════════════════════════
   O sócio escolhe o modo no admin; esta máquina aplica sozinha no heartbeat.

   A web NUNCA manda comando: o serviço guarda só a INTENÇÃO (`modoDesejado`)
   e o runner pergunta no `/api/machines/register`, que é o mesmo contrato do
   resto — a máquina puxa, nunca é chamada.

   Por isso o mapa nome→comando vive AQUI, na máquina, e não lá. O servidor
   manda a string `"server"`, nunca uma linha de comando. Mesmo que alguém
   comprometa o serviço, o pior que consegue é trocar o plano de energia de
   quem estiver rodando o runner — não executar o que quiser no computador
   de um sócio.

   No Windows os scripts do C:\Ops já existem como tarefa agendada e rodam
   ELEVADAS sem prompt de UAC. É por isso que funcionam por Moonlight, e é o
   que permite o runner (que roda sem elevação) acioná-las. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Lista fechada. Tem que bater com a MODOS do ai-service. */
export const MODOS = ['server', 'edit', 'production']

/* Só Windows por enquanto: é onde existe a máquina de plantão. Em Mac/Linux
   o modo é ignorado com aviso, em vez de falhar — um sócio no Mac não pode
   ver o runner dele quebrar porque alguém clicou num seletor. */
const PADRAO_WIN = {
  server: ['schtasks.exe', ['/run', '/tn', 'Ops - Modo Server']],
  edit: ['schtasks.exe', ['/run', '/tn', 'Ops - Modo Edit']],
  production: ['schtasks.exe', ['/run', '/tn', 'Ops - Modo Production']],
}

/**
 * O que rodar pra cada modo nesta máquina.
 * `cfg.modos` (em ~/.nomade/config.json) sobrescreve, pra quem não usa o
 * C:\Ops — é config LOCAL, escrita pelo dono da máquina, não pelo serviço.
 * Formato: { "server": ["comando", ["arg","arg"]] }
 */
export function comandoDoModo(modo, cfg = {}) {
  if (!MODOS.includes(modo)) return null
  const custom = cfg?.modos?.[modo]
  if (Array.isArray(custom) && typeof custom[0] === 'string') {
    return [custom[0], Array.isArray(custom[1]) ? custom[1].map(String) : []]
  }
  if (process.platform !== 'win32') return null
  return PADRAO_WIN[modo] || null
}

/**
 * Aplica o modo. Devolve `{ ok, modo, motivo }` — nunca estoura: o runner não
 * pode cair porque um plano de energia não trocou.
 */
export async function aplicarModo(modo, cfg = {}) {
  if (!MODOS.includes(modo)) return { ok: false, modo: null, motivo: `modo desconhecido: ${modo}` }
  const cmd = comandoDoModo(modo, cfg)
  if (!cmd) {
    return {
      ok: false,
      modo: null,
      motivo: process.platform === 'win32'
        ? `sem comando pro modo "${modo}" — configura "modos" no ~/.nomade/config.json`
        : `modo de energia só está implementado no Windows (esta é ${process.platform})`,
    }
  }
  try {
    /* shell: false de propósito. Os argumentos são constantes daqui ou config
       local do dono; não passam por shell, então nome de tarefa com espaço
       (que é o caso: "Ops - Modo Server") não vira injeção. */
    await exec(cmd[0], cmd[1], { timeout: 30_000, windowsHide: true })
    return { ok: true, modo, motivo: null }
  } catch (e) {
    return { ok: false, modo: null, motivo: String(e?.message || e).slice(0, 200) }
  }
}
