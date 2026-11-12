/* Saída do terminal. Cor só quando é TTY — pipe e log ficam limpos. */
const tty = process.stdout.isTTY
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s))

export const dim = (s) => c('2', s)
export const bold = (s) => c('1', s)
export const azul = (s) => c('36', s)
export const verde = (s) => c('32', s)
export const gold = (s) => c('33', s)
export const coral = (s) => c('31', s)
export const marca = (s) => c('1;36', s)

export const info = (...a) => console.log(...a)
export const erro = (msg) => console.error(`${coral('erro')} ${msg}`)
export const ok = (msg) => console.log(`${verde('✓')} ${msg}`)
export const passo = (msg) => console.log(dim(`· ${msg}`))

/** Hora curta pro log do runner — quem deixa rodando quer saber quando foi. */
export const agora = () => dim(new Date().toTimeString().slice(0, 8))

/** Barra de título usada no login e no runner. */
export function cabecalho(texto) {
  console.log(`\n${marca('nomade')} ${dim('·')} ${texto}\n`)
}

/* ═══ ESPERA ═════════════════════════════════════════════════════════════
   Enquanto o orquestrador pensa, o terminal não pode ficar mudo: entre
   mandar e o primeiro pedaço da resposta passam vários segundos (ele monta
   o prompt, busca memória, chama o modelo). Sem sinal de vida, quem está
   do outro lado acha que travou — e manda de novo. */
const QUADROS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function espera(texto = 'pensando') {
  if (!process.stdout.isTTY) return { para: () => {} } // em pipe, spinner vira lixo
  let i = 0
  const t0 = Date.now()
  const desenha = () => {
    const s = Math.floor((Date.now() - t0) / 1000)
    process.stdout.write(`\r${azul(QUADROS[i++ % QUADROS.length])} ${dim(texto)}${s > 2 ? dim(` ${s}s`) : ''}   `)
  }
  desenha()
  const timer = setInterval(desenha, 80)
  return {
    para(limpa = true) {
      clearInterval(timer)
      if (limpa) process.stdout.write('\r' + ' '.repeat(texto.length + 14) + '\r')
    },
  }
}
