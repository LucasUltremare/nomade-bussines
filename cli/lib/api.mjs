/* Cliente HTTP do ai-service. Todo request leva o JWT de 90 dias que o
   `nomade login` guardou. Erro de auth vira mensagem que diz o que fazer,
   não stack trace. */
import { ler } from './config.mjs'

export class SemLogin extends Error {
  constructor() { super('Não estás conectado nesta máquina. Roda: nomade login') }
}

export async function api(rota, init = {}) {
  const cfg = await ler()
  if (!cfg.token && !init.publico) throw new SemLogin()
  const r = await fetch(`${cfg.url}${rota}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      ...(init.headers || {}),
    },
    signal: init.signal ?? AbortSignal.timeout(init.timeout ?? 30_000),
  })
  if (r.status === 401 || r.status === 403) {
    const corpo = await r.text().catch(() => '')
    throw new Error(
      /convite|liberado/i.test(corpo)
        ? 'Esse e-mail não está liberado. Fala com um sócio da empresa.'
        : 'Sessão expirada ou sem acesso. Roda: nomade login'
    )
  }
  return r
}

/** GET que já devolve JSON e estoura com o texto do servidor em caso de erro. */
export async function get(rota, init) {
  const r = await api(rota, init)
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  return r.json()
}

export async function post(rota, corpo, init = {}) {
  const r = await api(rota, { ...init, method: 'POST', body: JSON.stringify(corpo ?? {}) })
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  return r.json().catch(() => ({}))
}

export async function patch(rota, corpo, init = {}) {
  const r = await api(rota, { ...init, method: 'PATCH', body: JSON.stringify(corpo ?? {}) })
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  return r.json().catch(() => ({}))
}

/* Mensagens de erro que o sócio consegue agir em cima. O runner fica horas
   ligado sozinho — "terminated" na tela não diz nem onde parou nem o que fazer.
   (mesmo tratamento do app desktop, que nasceu de erro real em produção) */
export function erroLegivel(err) {
  const raw = String(err?.message || err || '')
  const causa = String(err?.cause?.message || err?.cause?.code || '')
  const tudo = `${raw} ${causa}`.toLowerCase()
  if (/terminated|other side closed|econnreset|socket hang up|epipe/.test(tudo))
    return 'a conexão com o modelo caiu no meio da resposta (rede ou o provedor cortou)'
  if (/fetch failed|enotfound|eai_again|dns/.test(tudo))
    return 'não deu pra alcançar o serviço — sem internet ou o endereço não resolveu'
  if (/etimedout|body timeout|headers timeout|timeout/.test(tudo))
    return 'demorou demais e a conexão estourou o tempo'
  if (/oauth session expired|could not be refreshed|please run.*login/.test(tudo))
    return 'o login do Claude Code desta máquina expirou — roda "claude" no terminal pra logar de novo'
  if (/401|unauthorized|invalid.*api.?key|authentication/.test(tudo))
    return 'credencial recusada — confere em Chaves no admin'
  if (/429|rate.?limit|quota/.test(tudo))
    return `limite do provedor estourado — ${raw.slice(0, 140)}`
  return raw
}
