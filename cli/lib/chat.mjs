/* ═══ CHAT com o orquestrador ════════════════════════════════════════════
   A conversa vive no SERVIDOR (office_conversas), não no processo. Então o
   sócio começa no terminal e continua na web — e o que ele colar aqui vira
   briefing da conversa lá também. */
import readline from 'node:readline'
import { ler } from './config.mjs'
import { api, get, post, erroLegivel } from './api.mjs'
import { cabecalho, dim, bold, azul, gold, verde, coral, info, erro, espera } from './ui.mjs'

const ICONE = { tarefa: '▸', decisao: '?', memoria: '*', squad: '+', imagem: '#' }

/** Imprime os `passos` — o que o turno CRIOU de verdade (card, decisão, memória). */
function mostrarPassos(passos = []) {
  if (!passos.length) return
  info('')
  for (const p of passos) {
    const ic = ICONE[p.tipo] || '·'
    const cor = p.tipo === 'decisao' ? gold : p.jaExistia ? dim : verde
    info(`  ${cor(ic)} ${dim(p.tipo)} ${p.resumo}${p.agent ? dim(` → ${p.agent}`) : ''}${p.cliente ? dim(` · ${p.cliente}`) : ''}`)
  }
}

/** Manda uma mensagem e streama a resposta (SSE do ai-service). */
async function enviar(conversaId, texto, sinal) {
  // SSE não pode cair no timeout padrão do api(); o sinal vem de fora pra
  // o ctrl+c poder cancelar SÓ esta resposta em vez de matar o programa
  const ctrl = new AbortController()
  sinal?.addEventListener('abort', () => ctrl.abort(), { once: true })

  const girando = espera('pensando')
  let r
  try {
    r = await api(`/api/office/conversas/${conversaId}/mensagens`, {
      method: 'POST', body: JSON.stringify({ texto }), signal: ctrl.signal,
    })
  } catch (e) { girando.para(); throw e }
  if (!r.ok) { girando.para(); throw new Error(`${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`) }

  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let passos = []
  let primeiro = true
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const blocos = buf.split('\n\n')
    buf = blocos.pop()
    for (const bloco of blocos) {
      const linha = bloco.split('\n').find(l => l.startsWith('data:'))
      if (!linha) continue
      let ev
      try { ev = JSON.parse(linha.slice(5).trim()) } catch { continue }
      if (ev.t === 'delta') {
        if (primeiro) { girando.para(); process.stdout.write(dim('orquestrador › ')); primeiro = false }
        process.stdout.write(ev.text)
      }
      else if (ev.t === 'final') passos = ev.passos || []
      else if (ev.t === 'error') throw new Error(ev.error)
    }
  }
  girando.para() // resposta vazia: o spinner não pode ficar girando pra sempre
  process.stdout.write('\n')
  mostrarPassos(passos)
  return passos
}

/** Conversa a usar: a última do sócio, ou uma nova. */
async function conversaAtiva(nova) {
  if (!nova) {
    const convs = await get('/api/office/conversas').catch(() => [])
    if (convs.length) return convs[0] // já vem ordenada por atualizada desc
  }
  return post('/api/office/conversas')
}

export async function chat(argv) {
  const cfg = await ler()
  if (!cfg.token) { erro('não conectado. Roda: nomade login'); process.exit(1) }

  const nova = argv.includes('--nova')
  const mensagem = argv.filter(a => !a.startsWith('--')).join(' ').trim()
  const conv = await conversaAtiva(nova)

  // one-shot: `nomade "cria as tasks do lançamento"`
  if (mensagem) {
    await enviar(conv.id, mensagem).catch(e => { erro(erroLegivel(e)); process.exit(1) })
    return
  }

  cabecalho(`orquestrador ${dim(`· ${conv.titulo || 'nova conversa'}`)}`)
  if (conv.pendentes) info(dim(`  (${conv.pendentes} recado(s) desde a última vez — entram no próximo turno)\n`))
  info(dim('  ctrl+c pra sair · --nova começa outra conversa\n'))

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: azul('você › ') })

  /* UMA DE CADA VEZ. Sem esta trava, cada Enter durante a resposta virava
     OUTRA requisição: o orquestrador respondia tudo embaralhado, criava card
     duplicado, e o terminal ficava ilegível. Agora, digitar enquanto ele
     trabalha não faz nada além de avisar. */
  let ocupado = false
  let cancelar = null

  rl.prompt()
  rl.on('line', async (linha) => {
    const t = linha.trim()

    if (ocupado) {
      // não enfileira: o que o sócio ia mandar provavelmente muda depois de
      // ler a resposta que está chegando
      if (t) info(dim('  (espera terminar — ctrl+c cancela a resposta)'))
      return
    }
    if (!t) return rl.prompt()
    if (t === '/sair' || t === '/exit') return rl.close()

    ocupado = true
    cancelar = new AbortController()
    /* NÃO usa rl.pause() aqui: pausar não descarta o que foi digitado, só
       ADIA — no resume o readline despeja tudo de uma vez, já com `ocupado`
       em false, e o flood passa igual. Deixar o readline vivo é o que faz a
       trava funcionar. */
    try {
      await enviar(conv.id, t, cancelar.signal)
    } catch (e) {
      info(cancelar.signal.aborted
        ? dim('\n  (cancelado)')
        : `\n${coral('erro')} ${erroLegivel(e)}`)
    } finally {
      ocupado = false
      cancelar = null
      info('')
      rl.prompt()
    }
  })

  /* ctrl+c: durante a resposta CANCELA ela; parado, sai. Sem isso o único
     jeito de escapar de uma resposta longa era matar o programa. */
  rl.on('SIGINT', () => {
    if (ocupado && cancelar) { cancelar.abort(); return }
    rl.close()
  })
  rl.on('close', () => { cancelar?.abort(); info(''); process.exit(0) })
}

/** `nomade decisoes` — a fila do que só um sócio resolve. */
export async function decisoes() {
  const abertas = await get('/api/office/decisions?status=aberta')
  if (!abertas.length) { info(dim('nenhuma decisão aberta.')); return }
  cabecalho(`${abertas.length} decisão(ões) esperando`)
  for (const d of abertas) {
    const urg = d.urgencia === 'urgente' ? coral(d.urgencia) : d.urgencia === 'hoje' ? gold(d.urgencia) : dim(d.urgencia)
    info(`  ${bold(d.pergunta)}`)
    info(`    ${urg} ${dim(`· ${d.agentName || 'orquestrador'}`)}`)
    if (d.sugestao) info(`    ${dim('sugestão:')} ${d.sugestao}`)
    if (d.opcoes?.length) info(`    ${dim('opções:')} ${d.opcoes.map(o => o.label).join(' · ')}`)
    info('')
  }
  info(dim('  responder ainda é na web (aba Decisões) — o CLI só mostra.\n'))
}
