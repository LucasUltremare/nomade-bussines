import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { MongoClient, ObjectId } from 'mongodb'
import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import fsSync from 'fs'
import zlib from 'zlib'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { rateLimit, securityHeaders } from './lib/security.js'
import { EMPRESA, PRODUTO, PAINEL_URL, BASE_URL as URL_PUBLICA } from './lib/empresa.js'
import { buscarNoPlaces, buscarNoOsm, importarLeads } from './lib/leads.js'
import { carimbarEmpresa, colecaoDaEmpresa } from './lib/memoria-empresa.js'
import { decidir, motorDisponivel } from './lib/decisoes.js'
import { CATALOGO as INTEGRACOES, porId as integracaoPorId, mascarar as mascararIntegracao, mesclarConfig as mesclarIntegracao } from './lib/integracoes.js'
import { readFileSync } from 'node:fs'
import { PROVEDORES, COM_CHAVE, provedor, publico as provPublico, listarModelos, MODELO_LIVRE } from './lib/provedores.js'
import { CANAIS, canalPorId, CANAL_TESTE, MODOS as MODOS_ATEND, publico as publicoCanal } from './lib/atendimento/index.js'

dotenv.config({ path: '.env' })

const app = express()
const server = createServer(app)
// destroyUpgrade false: upgrades de websocket que não são do socket.io daqui
// (ex.: /hq/socket.io do admin proxiado) não podem ser derrubados pelo engine.io
const io = new Server(server, { cors: { origin: '*' }, destroyUpgrade: false })

const PORT = process.env.AI_SERVICE_PORT || 5004
const MONGODB_URI = process.env.AI_MONGODB_URI || process.env.MONGODB_URI
const JWT_SECRET = process.env.JWT_SECRET
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
let db
let mainDb
// a empresa dona deste banco — carimbada no boot (lib/memoria-empresa.js)
let empresaAtual = null
// office_memories SEMPRE por aqui: o empresaId vai junto em todo filtro
const memorias = () => colecaoDaEmpresa(db, empresaAtual?.id)

async function connectDB() {
  const mongoClient = new MongoClient(MONGODB_URI)
  await mongoClient.connect()
  db = mongoClient.db(process.env.MONGODB_OFFICE_DB || "nomade_office")
  // clientes, kanban e propostas moram no db principal — o orquestrador LÊ de lá
  // (projeto = cliente; não existe collection de projeto paralela)
  mainDb = mongoClient.db(process.env.MONGODB_DB || "nomade")
  // feed do escritório expira sozinho — 30 dias (senão vira o maior custo do Atlas)
  db.collection('office_events').createIndex({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }).catch(() => {})
  // anexo é material de apoio, não arquivo morto: 7 dias e o Mongo apaga
  db.collection('office_anexos').createIndex({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 }).catch(() => {})
  // histórico de execução: 30 dias basta pra auditar. Sem TTL isso vira a
  // collection que mais cresce (é um doc por run, com a saída de cada etapa).
  db.collection('office_runs').createIndex({ iniciado: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }).catch(() => {})
  db.collection('office_runs').createIndex({ taskId: 1 }).catch(() => {})
  // uma memória por empresa: banco de outra empresa barra o boot aqui
  empresaAtual = await carimbarEmpresa(db, { nome: EMPRESA.nome, idFixo: process.env.EMPRESA_ID })
  for (const s of await db.collection('office_cli_sessions').find({ revogada: true }, { projection: { jti: 1 } }).toArray()) sessoesRevogadas.add(s.jti)
  db.collection('office_cli_sessions').createIndex({ jti: 1 }, { unique: true }).catch(() => {})
  db.collection('office_integracoes').createIndex({ id: 1 }, { unique: true }).catch(() => {})
  console.log('Connected to MongoDB (AI Service)')
  console.log(`Memória da empresa "${empresaAtual.nome}" (${empresaAtual.id})`)
}

// ── O painel vive NESTE domínio (PAINEL_URL) ──
// Raiz e /admin = SPA do painel; /hq/* = API + socket do server principal
// (sob prefixo pra não colidir com o /api daqui). O header secreto prova que a
// request veio deste proxy — o server principal 404a o /admin acessado por fora.
// IMPORTANTE: registrado ANTES do express.json(), senão o body dos POSTs
// proxiados é consumido e a request trava.
const ADMIN_UPSTREAM = process.env.ADMIN_UPSTREAM || ''
const HQ_PROXY_SECRET = process.env.HQ_PROXY_SECRET || ''
let hqProxy = null
if (ADMIN_UPSTREAM) {
  const proxyOpts = {
    target: ADMIN_UPSTREAM,
    changeOrigin: true,
    headers: HQ_PROXY_SECRET ? { 'x-hq-key': HQ_PROXY_SECRET } : {},
    logLevel: 'warn',
  }
  hqProxy = createProxyMiddleware({ ...proxyOpts, pathRewrite: { '^/hq': '' } })
  // o painel (raiz, /admin, /hq) é privado: fora do índice e sem cache
  app.use((req, res, next) => {
    if (req.path === '/' || req.path.startsWith('/admin') || req.path.startsWith('/hq')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow')
      res.setHeader('Cache-Control', 'no-store')
    }
    next()
  })
  app.use('/hq', hqProxy)
  app.use('/admin', createProxyMiddleware(proxyOpts))
  // a RAIZ é o painel — PAINEL_URL abre direto nele
  // (os assets dele continuam em /admin/assets, cobertos pelo proxy acima)
  app.get('/', createProxyMiddleware({ ...proxyOpts, pathRewrite: () => '/admin/' }))
  // upgrade de websocket do socket.io do admin (path /hq/socket.io)
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/hq/socket.io')) hqProxy.upgrade(req, socket, head)
  })
}

// O painel é privado: nada no PAINEL_URL deve virar resultado de
// busca. O login já barra o acesso, mas sem isto a URL (e o título) podem
// aparecer no Google mesmo sem o conteúdo — robots.txt fecha isso na porta.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send('User-agent: *\nDisallow: /\n')
})

// Headers de segurança (HSTS, nosniff, no-store nas APIs). Vem DEPOIS do
// proxy de propósito: /admin e /hq são respondidos pelo server principal, que
// já aplica os dele.
app.use(securityHeaders)
app.use((req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next() })

app.use(express.json())

// Limites por rota. Este serviço fala com Anthropic/OpenAI — request sem freio
// aqui é conta de token de terceiro. Chave = IP + rota (lib/security).
const limitDevice = rateLimit({ windowMs: 60_000, max: 10, message: 'Muitas tentativas de conexão. Espera um minuto.' })
const limitPoll = rateLimit({ windowMs: 60_000, max: 120 }) // app faz poll de 2 em 2s; cabe várias máquinas no mesmo IP
const limitLogin = rateLimit({ windowMs: 60_000, max: 10, message: 'Muitas tentativas de login.' })
const limitOffice = rateLimit({ windowMs: 60_000, max: 240 }) // uso normal do cockpit é folgado
const limitArquivo = rateLimit({ windowMs: 60_000, max: 120 })
const limitTeste = rateLimit({ windowMs: 60_000, max: 20, message: 'Muito teste de chave seguido. Espera um minuto.' })

// CORS — o site em dev (5173) chama a API de outra origem; sem esses headers o
// navegador bloqueia em silêncio. Antes refletia QUALQUER Origin de volta, o que
// autorizava qualquer site a falar com esta API pelo navegador de um sócio. Hoje
// é allowlist: localhost em qualquer porta e os domínios da instalação (painel,
// URL pública, site da empresa e o que vier em CORS_DOMINIOS).
// Quem não é browser (o CLI/runner, curl) não manda Origin e segue igual.
// PENDENTE: `file://`/`null` continua liberado abaixo e era só do app Electron,
// que saiu. Tirar é hardening de graça, mas é mudança de comportamento em API no
// ar — some num deploy calmo, conferindo que nada mais manda Origin nulo.
const DOMINIOS_OK = [...new Set([PAINEL_URL, URL_PUBLICA, EMPRESA.site, ...String(process.env.CORS_DOMINIOS || '').split(',')]
  .map((u) => { try { return new URL(u.includes('://') ? u : `https://${u.trim()}`).hostname } catch { return '' } })
  .filter((h) => h && h !== 'localhost' && h !== '127.0.0.1'))]
const ORIGEM_OK = (o) => {
  if (!o || o === 'null' || o === 'file://') return true       // Electron/app
  try {
    const { protocol, hostname } = new URL(o)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true
    return DOMINIOS_OK.some(d => hostname === d || hostname.endsWith('.' + d))
  } catch { return false }
}
app.use((req, res, next) => {
  const origin = req.headers.origin
  // Vary: sem isso um cache guarda a resposta de uma origem e serve pra outra
  res.setHeader('Vary', 'Origin')
  if (ORIGEM_OK(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Freio geral do cockpit (cada rota /api/office/* tem a própria janela).
// Depois do CORS de propósito: um 429 sem header de CORS chega no navegador
// como erro opaco, e a pessoa não vê a mensagem.
app.use('/api/office', limitOffice)

function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1] || req.query.token
  if (!token) return res.status(401).json({ error: 'No token' })
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' })
    // Token de MEMBRO do painel (ex.: leader) vale só no server principal, com a
    // tabela de permissões de lá. Aqui (escritório, máquinas, squads) não entra.
    if (user?.role === 'membro') return res.status(403).json({ error: 'Acesso restrito aos sócios.' })
    // sessão de CLI revogada pelo painel: o JWT ainda é válido, a sessão não
    if (user?.jti && sessoesRevogadas.has(user.jti)) return res.status(403).json({ error: 'Esta sessão do CLI foi desconectada no painel. Roda `nomade login` de novo.' })
    if (user?.jti) marcarUsoDaSessao(user.jti)
    req.user = user
    next()
  })
}

/* Revogação em memória (carregada no boot, atualizada no DELETE): checar o
   banco a cada request do runner seria um find por heartbeat. */
const sessoesRevogadas = new Set()
const usoRegistrado = new Map() // jti → ts do último registro (1 escrita a cada 10 min)
function marcarUsoDaSessao(jti) {
  const agora = Date.now()
  if ((usoRegistrado.get(jti) || 0) > agora - 10 * 60_000) return
  usoRegistrado.set(jti, agora)
  db?.collection('office_cli_sessions').updateOne({ jti }, { $set: { ultimoUso: new Date() } }).catch(() => {})
}

// Squad Code Parser — parse squad.ai syntax
function parseSquadCode(code) {
  const agents = []
  const squadMatch = code.match(/squad\s+(\w+)\s*{([\s\S]*)}/i)
  if (!squadMatch) return { error: 'Invalid squad syntax' }

  const squadName = squadMatch[1]
  const squadBody = squadMatch[2]
  const agentMatches = [...squadBody.matchAll(/agent\s+(\w+)\s*{([\s\S]*?)(?=agent\s+\w+\s*{|$)/gi)]

  for (const match of agentMatches) {
    const agentName = match[1]
    const agentBody = match[2]

    const agent = {
      id: `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: agentName,
      role: { title: extractValue(agentBody, 'role'), description: '', expertise: [], behaviors: [] },
      model: extractValue(agentBody, 'model') || 'claude-sonnet-5',
      temperature: parseFloat(extractValue(agentBody, 'temperature')) || 0.7,
      systemPrompt: extractValue(agentBody, 'systemPrompt') || '',
      integrations: extractValue(agentBody, 'integrations')?.split(',').map(s => s.trim()) || []
    }
    agents.push(agent)
  }

  return { squadName, agents }
}

function extractValue(text, key) {
  const triple = text.match(new RegExp(`${key}\\s*:\\s*"""([\\s\\S]*?)"""`, 'i'))
  if (triple) return triple[1].trim()
  const regex = new RegExp(`${key}\\s*:\\s*["]?([^"\\n]+)["]?`, 'i')
  const match = text.match(regex)
  return match ? match[1].trim() : null
}

// Executa um agente — roteia pelo prefixo do modelo:
// claude-* → Anthropic (chave do usuário se conectada, senão a da casa)
// gpt-*/o* → OpenAI (exige plano conectado pelo usuário)
// IDs Anthropic usam hífen na versão (claude-haiku-4-5); squads antigos salvaram "4.5"
const fixClaudeModelId = (m) => /^claude/i.test(m || '') ? String(m).replace(/(\d)\.(\d)/g, '$1-$2') : m

async function executeAgent(agent, context = '', keys = {}) {
  if (agent.model === 'imagem') {
    const t0 = Date.now()
    try {
      const prompt = [agent.systemPrompt, context].filter(Boolean).join('\n\n').slice(0, 1200)
      const img = await gerarImagem(prompt)
      const saved = await salvarImagem(prompt, img, { por: 'squad', squad: agent.name })
      return {
        status: 'completed',
        output: `Imagem gerada: /api/office/imagens/${saved.id}/arquivo`,
        tokensUsed: 0, duration: Date.now() - t0, error: null, logs: [],
      }
    } catch (e) {
      return { status: 'failed', output: '', tokensUsed: 0, duration: Date.now() - t0, error: String(e.message || e), logs: [] }
    }
  }
  if (/^local\//i.test(agent.model)) {
    return {
      status: 'failed', output: '', tokensUsed: 0, duration: 0, logs: [],
      /* O prefixo `local/` era enumerado pelo app Electron, que saiu. No CLI o
         equivalente é `ollama:<modelo>`, que cai no motor agnóstico e roda na
         máquina do runner sem precisar de conta Claude. */
      error: `Modelo "${agent.model}" não tem executor: o prefixo local/ era do app desktop, que foi removido. Troca o modelo do squad pra "ollama:${agent.model.slice(6)}" e roda pelo runner (nomade runner) na máquina com o Ollama de pé.`,
    }
  }
  if (/^glm/i.test(agent.model)) return executeOpenAI(agent, context, keys.glm, 'https://open.bigmodel.cn/api/paas/v4', 'Modelo GLM sem plano conectado — conecta tua chave do bigmodel.cn em "Conectar plano".')
  if (/^(gpt-|o\d)/i.test(agent.model)) return executeOpenAI(agent, context, keys.openai)

  const startTime = Date.now()
  try {
    const messages = [{ role: 'user', content: context || 'You are an AI agent. Please perform your task.' }]
    const anthropic = keys.anthropic ? new Anthropic({ apiKey: keys.anthropic }) : client

    const response = await anthropic.messages.create({
      model: fixClaudeModelId(agent.model),
      max_tokens: 1024,
      system: (agent.systemPrompt || `You are ${agent.name}, a ${agent.role.title}.`) +
        '\n\nSe bater numa dúvida que só um sócio pode responder (preço, escopo, escolha que muda o projeto), NÃO chuta: responde APENAS o bloco ```decisao {"pergunta":"...","contexto":"...","opcoes":["A","B"],"sugestao":"..."}``` e para.',
      messages,
    })

    const duration = Date.now() - startTime
    const output = response.content[0]?.text || ''
    const tokensUsed = response.usage?.output_tokens || 0

    return {
      status: 'completed',
      output,
      tokensUsed,
      duration,
      error: null,
      logs: []
    }
  } catch (err) {
    return {
      status: 'failed',
      output: '',
      tokensUsed: 0,
      duration: Date.now() - startTime,
      error: err.message,
      logs: []
    }
  }
}

/* Teto de saída nas APIs estilo OpenAI.
   A OpenAI aposentou o `max_tokens`: nos modelos de raciocínio (gpt-5*, série o)
   ele é REJEITADO com "Unsupported parameter: 'max_tokens' is not supported with
   this model. Use 'max_completion_tokens' instead." O nome novo vale pra API
   inteira da OpenAI, então o campo é escolhido pelo DESTINO e não pelo modelo:
   endpoint só compatível (GLM/bigmodel, Ollama, LM Studio) segue no nome antigo,
   que é o único que entende. */
const tetoTokens = (base, valor) =>
  String(base).includes('api.openai.com')
    ? { max_completion_tokens: valor }
    : { max_tokens: valor }

async function executeOpenAI(agent, context, apiKey, base = 'https://api.openai.com/v1', errMsg = null) {
  const startTime = Date.now()
  if (!apiKey) {
    return {
      status: 'failed', output: '', tokensUsed: 0, duration: 0, logs: [],
      error: errMsg || 'Modelo OpenAI sem plano conectado — conecta tua chave em "Conectar plano".',
    }
  }
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: agent.model,
        ...tetoTokens(base, 1024),
        messages: [
          { role: 'system', content: agent.systemPrompt || `You are ${agent.name}, a ${agent.role.title}.` },
          { role: 'user', content: context || 'You are an AI agent. Please perform your task.' },
        ],
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`)
    return {
      status: 'completed',
      output: data.choices?.[0]?.message?.content || '',
      tokensUsed: data.usage?.completion_tokens || 0,
      duration: Date.now() - startTime,
      error: null,
      logs: [],
    }
  } catch (err) {
    return {
      status: 'failed', output: '', tokensUsed: 0,
      duration: Date.now() - startTime, error: err.message, logs: [],
    }
  }
}

function maskKey(key) {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '•••'
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`)

  socket.on('auth', async (data) => {
    try {
      const decoded = jwt.verify(data.token, JWT_SECRET)
      if (decoded?.role === 'membro') throw new Error('membro')
      socket.userId = decoded.sub
      socket.emit('auth-success', { id: decoded.sub, email: decoded.email })
    } catch (err) {
      socket.emit('auth-error', { message: 'Invalid token' })
    }
  })

  socket.on('fetch-squads', async () => {
    try {
      const squads = await db.collection('squads').find({ ownerId: socket.userId }).toArray()
      socket.emit('squads-list', squads)
    } catch (err) {
      console.error('Error fetching squads:', err)
    }
  })

  // ── Planos conectados (Claude / OpenAI) — chave por usuário ──
  const emitProviders = async () => {
    const rows = await db.collection('providers').find({ userId: socket.userId }).toArray()
    socket.emit('providers-list', rows.map(r => ({ provider: r.provider, masked: maskKey(r.apiKey) })))
  }

  socket.on('fetch-providers', async () => {
    try { await emitProviders() } catch (err) { console.error('Error fetching providers:', err) }
  })

  socket.on('save-provider', async (data) => {
    try {
      const { provider, apiKey } = data
      if (!['anthropic', 'openai', 'glm', 'gemini'].includes(provider) || !apiKey?.trim()) return
      await db.collection('providers').updateOne(
        { userId: socket.userId, provider },
        { $set: { apiKey: apiKey.trim(), updatedAt: new Date() } },
        { upsert: true }
      )
      await emitProviders()
    } catch (err) {
      console.error('Error saving provider:', err)
    }
  })

  socket.on('remove-provider', async (data) => {
    try {
      await db.collection('providers').deleteOne({ userId: socket.userId, provider: data.provider })
      await emitProviders()
    } catch (err) {
      console.error('Error removing provider:', err)
    }
  })

  socket.on('create-squad', async (data) => {
    try {
      const code = data.code || `squad ${String(data.name || 'MeuSquad').replace(/\W/g, '')} {\n\n}`
      const parsed = parseSquadCode(code)
      const squad = {
        id: `squad_${Date.now()}`,
        name: data.name,
        code,
        agents: parsed.error ? [] : parsed.agents,
        orchestration: 'sequential',
        ownerId: socket.userId,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      await db.collection('squads').insertOne(squad)
      officeEvent('funcionario_criado', { nome: squad.name })
      const squads = await db.collection('squads').find({ ownerId: socket.userId }).toArray()
      socket.emit('squads-list', squads)
    } catch (err) {
      console.error('Error creating squad:', err)
    }
  })

  socket.on('save-squad', async (data) => {
    try {
      const { squadId, code } = data
      const parsed = parseSquadCode(code)
      if (parsed.error) {
        socket.emit('execution-error', { error: parsed.error })
        return
      }

      await db.collection('squads').updateOne(
        { id: squadId },
        { $set: { code, agents: parsed.agents, updatedAt: new Date() } }
      )
      const squad = await db.collection('squads').findOne({ id: squadId })
      socket.emit('squad-updated', squad)
    } catch (err) {
      console.error('Error saving squad:', err)
      socket.emit('execution-error', { error: err.message })
    }
  })

  socket.on('run-squad', async (data) => {
    const { squadId, code, input } = data
    let officeRunId = null // fora do try — o catch fecha o run na Sala mesmo em erro
    try {
      const parsed = parseSquadCode(code)
      if (parsed.error) {
        socket.emit('execution-error', { error: parsed.error })
        return
      }

      const execution = {
        id: `exec_${Date.now()}`,
        squadId,
        status: 'running',
        startedAt: new Date(),
        agents: [],
        totalTokens: 0
      }

      socket.emit('execution-start', execution)
      officeRunId = `wrun_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      officeEvent('run_start', { runId: officeRunId, squad: parsed.squadName, origem: 'web', task: String(input || '').slice(0, 140) })

      // chaves dos planos conectados do usuário
      const providerRows = await db.collection('providers').find({ userId: socket.userId }).toArray()
      const keys = Object.fromEntries(providerRows.map(r => [r.provider, r.apiKey]))

      let context = String(input || '').trim()
      for (const agent of parsed.agents) {
        officeEvent('run_step', { runId: officeRunId, squad: parsed.squadName, etapa: agent.name, modelo: agent.model })
        socket.emit('execution-update', {
          squadId,
          agents: [...execution.agents, { ...agent, agentName: agent.name, status: 'running', tokensUsed: 0, duration: 0, timestamp: new Date() }]
        })

        const result = await executeAgent(agent, context, keys)
        context = result.output

        // agent pediu julgamento humano no meio? cria a decisão e para o squad
        const pedido = String(result.output || '').match(/```decisao\s*([\s\S]*?)```/i)
        if (pedido) {
          try {
            const j = JSON.parse(pedido[1].trim())
            if (j?.pergunta) {
              const dec = {
                id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                agentId: null, conversaId: null, taskId: null,
                agentName: agent.name, dept: null, projetoId: null,
                contexto: String(j.contexto || '').slice(0, 1500),
                pergunta: String(j.pergunta).slice(0, 300),
                opcoes: normOpcoes(j.opcoes),
                urgencia: URGENCIAS.includes(j.urgencia) ? j.urgencia : 'hoje',
                sugestao: String(j.sugestao || '').slice(0, 300),
                status: 'aberta', createdAt: new Date(),
              }
              await db.collection('office_decisions').insertOne(dec)
              officeEvent('decisao_aberta', { decisionId: dec.id, agentName: dec.agentName, pergunta: dec.pergunta, urgencia: dec.urgencia })
            }
          } catch { /* bloco inválido: segue como texto normal */ }
          execution.status = 'aguardando_decisao'
          execution.completedAt = new Date()
          socket.emit('execution-complete', execution)
          officeEvent('run_pausado', { squad: parsed.squadName, etapa: agent.name })
          return
        }

        execution.agents.push({
          agentId: agent.id,
          agentName: agent.name,
          systemPrompt: agent.systemPrompt,
          input: context.substring(0, 100),
          output: result.output,
          tokensUsed: result.tokensUsed,
          duration: result.duration,
          status: result.status,
          error: result.error,
          logs: result.logs,
          timestamp: new Date()
        })

        execution.totalTokens += result.tokensUsed

        socket.emit('execution-update', {
          squadId,
          agents: execution.agents
        })
      }

      execution.status = 'completed'
      execution.completedAt = new Date()
      socket.emit('execution-complete', execution)
      officeEvent('run_done', { runId: officeRunId, squad: parsed.squadName, origem: 'web', tokens: execution.totalTokens })

      console.log(`Squad executed: ${squadId}`)
    } catch (err) {
      console.error('Error running squad:', err)
      socket.emit('execution-error', { squadId, error: err.message })
      officeEvent('run_error', { runId: officeRunId, squadId, erro: String(err.message || err).slice(0, 200) })
    }
  })

  socket.on('delete-squad', async (data) => {
    try {
      await db.collection('squads').deleteOne({ id: data.squadId, ownerId: socket.userId })
      const squads = await db.collection('squads').find({ ownerId: socket.userId }).toArray()
      socket.emit('squads-list', squads)
    } catch (err) {
      console.error('Error deleting squad:', err)
    }
  })

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`)
  })
})

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'AI IDE' }))


// ═══ Login do CLI — device-link com Google ═══
// O app gera um código, abre o navegador em /link, o usuário entra
// com Google (só emails liberados), o app faz poll e recebe o token.

const deviceCodes = new Map() // code → { createdAt, token?, email? }
// Quem entra é quem está no ADMIN_EMAILS — a mesma lista do painel.
const ALLOWED_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

// expira códigos velhos
setInterval(() => {
  const now = Date.now()
  for (const [code, entry] of deviceCodes) {
    if (now - entry.createdAt > 10 * 60_000) deviceCodes.delete(code)
  }
}, 60_000)

// config pública pro front (client id do Google)
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' })
})

// login Google direto do site (IDE web — gerência de agents)
app.post('/api/auth/google', limitLogin, async (req, res) => {
  try {
    const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(req.body.credential || '')}`)).json()
    if (info.aud !== process.env.GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'Token inválido.' })
    const email = String(info.email || '').toLowerCase()
    if (!email) return res.status(401).json({ error: 'Sem email na conta.' })
    if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Acesso por convite — esse email ainda não foi liberado.' })
    }
    const token = jwt.sign({ sub: email, email, web: true }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, email, name: info.name || email })
  } catch {
    res.status(401).json({ error: 'Falha na validação.' })
  }
})

/* O app pede um PAR: o `code` viaja na URL do navegador (é o que o /link usa)
   e o `secret` nunca sai da máquina — é exigido no /poll. Antes o poll só pedia
   o código, de 4 bytes e sem rate limit: quem varresse o espaço durante a
   janela de 10min saía com um JWT de sócio válido por 90 dias. Agora, mesmo
   que o código vaze (ele passa pela barra de endereço), sem o secret não vira
   token. */
app.post('/api/device/code', limitDevice, (req, res) => {
  // teto de pendências — o mapa vive em memória e é alimentado por rota pública
  if (deviceCodes.size > 500) {
    return res.status(429).json({ error: 'Muitas conexões pendentes. Tenta de novo em instantes.' })
  }
  const code = crypto.randomBytes(8).toString('hex').toUpperCase()
  const secret = crypto.randomBytes(32).toString('hex')
  deviceCodes.set(code, { createdAt: Date.now(), secret })
  res.json({ code, secret })
})

app.get('/link', (req, res) => {
  const code = String(req.query.code || '').replace(/[^A-Z0-9]/g, '')
  const google = !!process.env.GOOGLE_CLIENT_ID
  const senha = !!process.env.ADMIN_SENHA
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect — ${PRODUTO}</title>
${google ? '<script src="https://accounts.google.com/gsi/client" async></script>' : ''}
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  body{margin:0;font-family:'Geist',system-ui,sans-serif;background:#0a0a0b;color:#f4f4f2;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background-image:radial-gradient(rgba(255,255,255,.04) 1px,transparent 1px);background-size:22px 22px}
  .card{width:min(380px,92vw);padding:32px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:#131315}
  h1{font-weight:600;font-size:22px;letter-spacing:-.02em;margin:0 0 6px}
  p{color:rgba(244,244,242,.55);font-size:14px;line-height:1.5;margin:0 0 20px}
  .code{font-family:ui-monospace,monospace;font-size:12px;color:#f4f4f2;letter-spacing:2px;border:1px solid rgba(255,255,255,.15);padding:2px 8px;border-radius:6px}
  label{display:block;font-size:12px;color:rgba(244,244,242,.55);margin:12px 0 6px}
  input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:transparent;color:#f4f4f2;font:inherit}
  button{margin-top:16px;width:100%;height:44px;border:0;border-radius:9px;background:#f4f4f2;color:#0a0a0b;font:600 14px 'Geist',sans-serif;cursor:pointer}
  #done{display:none;color:#5fe0a4;font-size:15px;margin-top:16px}
  #err{display:none;color:#f07276;font-size:13px;margin-top:12px}
  #gbtn{display:flex;justify-content:center;margin-top:10px}
  .or{text-align:center;color:rgba(244,244,242,.3);font-size:12px;margin:14px 0 4px}
</style></head><body><div class="card">
  <h1>Connect this machine</h1>
  <p>Sign in to link the <b>${PRODUTO}</b> CLI. Code <span class="code">${code}</span></p>
  ${senha ? `<form id="f"><label>E-mail</label><input name="email" type="email" required autocomplete="username"><label>Password</label><input name="senha" type="password" required autocomplete="current-password"><button type="submit">Connect</button></form>` : ''}
  ${google && senha ? '<div class="or">or</div>' : ''}
  ${google ? '<div id="gbtn"></div>' : ''}
  ${!google && !senha ? '<p>No sign-in method configured. Set ADMIN_SENHA or GOOGLE_CLIENT_ID in the .env.</p>' : ''}
  <div id="done">Connected. You can go back to the terminal.</div>
  <div id="err"></div>
</div>
<script>
  const CODE = '${code}'
  async function enviar(body) {
    const r = await fetch('/api/device/link', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ code: CODE, ...body }) })
    const data = await r.json()
    if (data.ok) { document.getElementById('done').style.display = 'block'; const f = document.getElementById('f'); if (f) f.style.display = 'none' }
    else { const e = document.getElementById('err'); e.textContent = data.error; e.style.display = 'block' }
  }
  const f = document.getElementById('f')
  if (f) f.onsubmit = (ev) => { ev.preventDefault(); enviar({ email: f.email.value, senha: f.senha.value }) }
  ${google ? `window.onload = () => {
    google.accounts.id.initialize({ client_id: '${process.env.GOOGLE_CLIENT_ID}', callback: (resp) => enviar({ credential: resp.credential }) })
    google.accounts.id.renderButton(document.getElementById('gbtn'), { theme: 'filled_black', size: 'large', text: 'continue_with' })
  }` : ''}
</script></body></html>`)
})

app.post('/api/device/link', limitDevice, async (req, res) => {
  try {
    const { code, credential } = req.body
    const entry = deviceCodes.get(code)
    if (!entry) return res.json({ ok: false, error: 'Code expired — run `nomade login` again.' })

    let email
    if (!credential && process.env.ADMIN_SENHA) {
      // senha do .env (instalação caseira, sem Google Cloud)
      const a = Buffer.from(String(req.body.senha || '')), b = Buffer.from(process.env.ADMIN_SENHA)
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.json({ ok: false, error: 'Wrong e-mail or password.' })
      email = String(req.body.email || '').toLowerCase().trim()
    } else {
      // valida o ID token do Google
      const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`)).json()
      if (info.aud !== process.env.GOOGLE_CLIENT_ID) return res.json({ ok: false, error: 'Invalid token.' })
      email = String(info.email || '').toLowerCase()
    }
    if (!email) return res.json({ ok: false, error: 'Sem email na conta.' })
    if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(email)) {
      return res.json({ ok: false, error: 'Acesso por convite — esse email ainda não foi liberado. Fala com um sócio.' })
    }

    entry.email = email
    // jti: é o que permite REVOGAR esta sessão do painel (aba CLI) antes dos 90 dias
    const jti = crypto.randomBytes(12).toString('hex')
    entry.token = jwt.sign({ sub: email, email, studio: true, jti }, JWT_SECRET, { expiresIn: '90d' })
    await db.collection('office_cli_sessions').insertOne({
      jti, email, criadoEm: new Date(), ultimoUso: null, revogada: false,
      agente: String(req.headers['user-agent'] || '').slice(0, 120),
    }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    res.json({ ok: false, error: 'Falha na validação — tenta de novo.' })
  }
})

app.post('/api/device/poll', limitPoll, (req, res) => {
  const code = String(req.body.code || '')
  const entry = deviceCodes.get(code)
  if (!entry) return res.status(404).json({ error: 'expired' })
  // timingSafeEqual: comparação de secret em tempo constante
  const enviado = Buffer.from(String(req.body.secret || ''))
  const esperado = Buffer.from(entry.secret || '')
  if (enviado.length !== esperado.length || !crypto.timingSafeEqual(enviado, esperado)) {
    return res.status(403).json({ error: 'bad_secret' })
  }
  if (!entry.token) return res.status(202).json({ pending: true })
  const { token, email } = entry
  deviceCodes.delete(code)
  res.json({ token, email })
})

// ── máquinas da conta ──
/* MODOS DE ENERGIA da máquina de plantão. Lista FECHADA de propósito: o CLI
   traduz cada nome num script local conhecido dele. Se isto virasse comando
   livre, quem comprometesse o serviço executaria qualquer coisa na máquina do
   sócio — o runner roda com o usuário dele.
     server      economiza (plano Equilibrado; a CPU para de travar em clock alto)
     edit        desempenho pra editar vídeo
     production  uso normal */
const MODOS = ['server', 'edit', 'production']

app.post('/api/machines/register', authenticateToken, async (req, res) => {
  try {
    const { machineId, name, platform, lanIp, models, servidor, contas, claude, modo } = req.body
    if (!machineId || !name) return res.status(400).json({ error: 'machineId e name obrigatórios' })
    const doc = await db.collection('machines').findOneAndUpdate(
      { email: req.user.email, machineId },
      {
        $set: {
          name,
          platform: platform || 'unknown',
          lanIp: lanIp || null,
          // modelos locais (Ollama/LM Studio) detectados naquela máquina —
          // as outras máquinas da conta enxergam e conectam via rede local
          models: Array.isArray(models) ? models.slice(0, 40) : [],
          // modo servidor: é o que diferencia a máquina de um sócio do RUNNER
          servidor: !!servidor,
          contas: Number(contas) || 0,
          /* Estado do CLI do Claude naquela máquina. É o que explica, na aba
             Máquina, um runner online que não executa nada: sem CLI ou sem
             login, todo squad em Claude volta pra fila. Versão antiga do CLI
             não manda o campo — daí o null, que a tela mostra como "?". */
          claude: claude && typeof claude === 'object'
            ? { cli: !!claude.cli, versao: String(claude.versao || '').slice(0, 60) || null, login: !!claude.login }
            : null,
          dono: req.user.email,
          /* modo de energia REPORTADO pela máquina (o que ela aplicou de fato).
             O desejado (`modoDesejado`) é setado pelo admin e desce na resposta
             — a web nunca chama a máquina, é ela quem pergunta no heartbeat. */
          modoAtual: MODOS.includes(String(modo)) ? String(modo) : null,
          lastSeen: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' }
    )
    const m = doc?.value || doc
    res.json({ ok: true, modo: MODOS.includes(m?.modoDesejado) ? m.modoDesejado : null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


/* ═══ DOWNLOAD DO CLI ════════════════════════════════════════════════════
   `npm i -g <url do tgz>` — instala e atualiza o `nomade` sem clonar o
   repo e sem registry.

   O tarball é montado AQUI, em Node puro (tar ustar + gzip), sem chamar npm.
   A primeira versão fazia `execFile('npm', ['pack'])` e morria em produção
   com "spawn npm ENOENT" — que era o cwd inexistente, porque a imagem não
   copiava o cli/. Montando à mão, não há binário externo pra faltar.

   PÚBLICO de propósito: é código cliente, sem credencial dentro. Quem
   controla acesso é o login (Google + ADMIN_EMAILS), não o download — e npm
   não sabe buscar arquivo atrás de token. */
const CLI_DIR = path.join(process.cwd(), 'cli')

/* Um cabeçalho ustar de 512 bytes. O checksum é a soma dos bytes do próprio
   cabeçalho com o campo do checksum preenchido de espaços — por isso ele é
   calculado depois e escrito por cima. */
function cabecalhoTar(nome, tamanho, mtime) {
  const h = Buffer.alloc(512)
  const põe = (txt, off, len) => h.write(String(txt).slice(0, len - 1), off, len - 1, 'utf8')
  const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'

  põe(nome, 0, 100)
  põe(octal(0o644, 8), 100, 8)      // mode
  põe(octal(0, 8), 108, 8)          // uid
  põe(octal(0, 8), 116, 8)          // gid
  põe(octal(tamanho, 12), 124, 12)
  põe(octal(Math.floor(mtime / 1000), 12), 136, 12)
  h.write('        ', 148, 8, 'utf8') // checksum: espaços enquanto soma
  h.write('0', 156, 1, 'utf8')        // typeflag: arquivo comum
  h.write('ustar\0', 257, 6, 'utf8')
  h.write('00', 263, 2, 'utf8')

  let soma = 0
  for (const b of h) soma += b
  h.write(soma.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8')
  return h
}

const padding = (n) => Buffer.alloc((512 - (n % 512)) % 512)

/* Percorre o cli/ respeitando o `files` do package.json — o mesmo recorte que
   o npm pack faria. Sem isso o node_modules (centenas de MB) entraria junto. */
async function arquivosDoCli() {
  const pkg = JSON.parse(await fs.readFile(path.join(CLI_DIR, 'package.json'), 'utf8'))
  const raiz = ['package.json', 'README.md', ...(pkg.files || [])]
  const saida = []
  const anda = async (rel) => {
    const abs = path.join(CLI_DIR, rel)
    const st = await fs.stat(abs).catch(() => null)
    if (!st) return
    if (st.isDirectory()) {
      for (const f of await fs.readdir(abs)) await anda(path.join(rel, f))
    } else {
      saida.push({ rel, abs, tamanho: st.size, mtime: st.mtimeMs })
    }
  }
  for (const r of raiz) await anda(r)
  return saida
}

/* Empacota QUALQUER pasta do repo no formato que o npm entende. Serve o
   CLI montado na hora a partir do cli/ do repo. */
async function empacotar(dir, raizExtra = []) {
  const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
  const raiz = ['package.json', 'README.md', 'LEIA.md', ...raizExtra, ...(pkg.files || [])]
  const arquivos = []
  const anda = async (rel) => {
    const abs = path.join(dir, rel)
    const st = await fs.stat(abs).catch(() => null)
    if (!st) return
    if (st.isDirectory()) { for (const f of await fs.readdir(abs)) await anda(path.join(rel, f)) }
    else arquivos.push({ rel, abs, mtime: st.mtimeMs })
  }
  for (const r of [...new Set(raiz)]) await anda(r)
  if (!arquivos.length) throw new Error(`nada em ${dir} — a imagem não copiou essa pasta`)
  const pedacos = []
  for (const a of arquivos) {
    const conteudo = await fs.readFile(a.abs)
    pedacos.push(cabecalhoTar(`package/${a.rel.split(path.sep).join('/')}`, conteudo.length, a.mtime))
    pedacos.push(conteudo, padding(conteudo.length))
  }
  pedacos.push(Buffer.alloc(1024))
  return { buf: zlib.gzipSync(Buffer.concat(pedacos), { level: 9 }), versao: pkg.version, arquivos: arquivos.length }
}

let cliTgz = null       // { buf, versao } em memória — o pacote tem ~17 KB
let cliMontando = null  // corrida: dois downloads não montam duas vezes

async function pacoteDoCli() {
  if (cliTgz) return cliTgz
  if (cliMontando) return cliMontando
  cliMontando = (async () => (cliTgz = await empacotar(CLI_DIR)))()
  try { return await cliMontando } finally { cliMontando = null }
}

/* URL COM A VERSÃO NO NOME — a única coisa que vence cache que não é meu.

   Histórico: o tarball ia sem Cache-Control e o npm reinstalava a cópia velha.
   Pus no-cache + ETag, e uma máquina Windows CONTINUOU baixando a versão
   errada. Header só manda em quem obedece: proxy corporativo, NPM Proxy
   Manager ou CDN no meio podem ignorar e servir o que têm.

   Caminho novo a cada versão resolve por construção — nenhum cache tem em
   mãos um arquivo que nunca pediram. É por isso que o mundo publica asset com
   hash no nome, e o motivo aqui é o mesmo.

   O caminho antigo continua vivo: quem já tem o comando colado em algum lugar
   não pode quebrar. Ele REDIRECIONA pro versionado, então até quem usa a URL
   velha passa a baixar por uma que o cache não conhece. */
app.get('/cli/nomade-cli-:versao.tgz', limitArquivo, async (req, res) => {
  try {
    const { buf, versao } = await pacoteDoCli()
    if (req.params.versao !== versao) {
      // pediram uma versão que não é a que está no ar: manda pra atual em vez
      // de servir errado calado
      return res.redirect(302, `/cli/nomade-cli-${versao}.tgz`)
    }
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Length', buf.length)
    res.setHeader('X-Nomade-Cli', versao)
    // imutável: este caminho SÓ existe pra esta versão, então cachear é seguro
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('Content-Disposition', `attachment; filename="nomade-cli-${versao}.tgz"`)
    res.end(buf)
  } catch (err) {
    res.status(503).type('text/plain').send(`Não deu pra montar o pacote do CLI (${err.message}).\n`)
  }
})

app.get('/cli/nomade-cli.tgz', limitArquivo, async (req, res) => {
  try {
    const { buf, versao } = await pacoteDoCli()

    /* Manda pro caminho versionado. Quem tem a URL velha colada num README ou
       num grupo continua funcionando, e passa a baixar por um caminho que
       nenhum cache no meio conhece — que é o ponto. */
    if (!req.query.direto) return res.redirect(302, `/cli/nomade-cli-${versao}.tgz`)

    /* SEM CACHE, e isto não é zelo: a URL do tarball é fixa e o conteúdo muda
       a cada deploy. Sem Cache-Control nem ETag, o npm aplica cache heurístico
       e reinstala a cópia velha — o comando roda, diz "changed N packages", e
       a máquina fica na versão anterior. Aconteceu numa instalação real no
       Windows, e o sintoma é o pior tipo: sucesso aparente.
       ETag do conteúdo faz a revalidação custar 304 em vez dos 55 KB. */
    const etag = `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`
    res.setHeader('Cache-Control', 'no-cache, must-revalidate')
    res.setHeader('ETag', etag)
    res.setHeader('X-Nomade-Cli', versao)
    if (req.get('if-none-match') === etag) return res.status(304).end()

    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Length', buf.length)
    res.setHeader('Content-Disposition', 'attachment; filename="nomade-cli.tgz"')
    res.end(buf)
  } catch (err) {
    res.status(503).type('text/plain').send(
      `Não deu pra montar o pacote do CLI (${err.message}).\n` +
      `Enquanto isso dá pra instalar do clone:  npm i -g ./cli\n`
    )
  }
})

/* Página de uma linha: o que colar no terminal. */
app.get('/cli', async (req, res) => {
  // atrás do proxy o req.protocol vira http — quem manda é o header
  const proto = req.get('x-forwarded-proto') || req.protocol
  const base = `${proto}://${req.get('host')}`
  const pkg = await pacoteDoCli().catch(() => null)
  const info = pkg ? ` (v${pkg.versao})` : ''
  const verOuVazio = pkg?.versao || 'atual'
  // mesma razão do tarball: página cacheada anuncia versão que não é a do ar
  res.setHeader('Cache-Control', 'no-cache, must-revalidate')
  /* Esta página é a FONTE do comando de instalação — o link vai pro grupo e
     ninguém copia comando digitado à mão. Já custou uma volta: um `npm i -g
     nomade-business-cli` (pacote que não existe em registry nenhum) mandou alguém
     caçar erro 404 por meia hora. A URL do tarball sai daqui, montada com o
     host da requisição, então nunca aponta pro lugar errado. */
  res.type('text/plain').send(
    `nomade — o ${PRODUTO} no terminal${info}\n\n` +
    `━━ 1. instalar (e atualizar, é o mesmo comando)\n\n` +
    `  npm i -g ${base}/cli/nomade-cli-${verOuVazio}.tgz\n\n` +
    `  (o número no nome muda a cada versão, de propósito: assim nenhum cache\n` +
    `   de rede consegue te entregar a versão anterior)\n\n` +
    `━━ 2. conectar esta máquina\n\n` +
    `  nomade login              abre o navegador, entra com o Google\n\n` +
    `━━ 3. ligar a memória da empresa no Claude Code\n\n` +
    `  nomade mcp                registra o servidor MCP\n\n` +
    `  Depois REINICIA o Claude Code — fecha e abre, não é /clear. Servidor MCP\n` +
    `  carrega na abertura da sessão, então numa janela já aberta ele não aparece.\n` +
    `  Confere com /mcp: tem que listar "nomade" com três ferramentas.\n\n` +
    `━━ o resto\n\n` +
    `  nomade                    conversa com o orquestrador\n` +
    `  nomade runner             esta máquina pega trabalho da fila\n` +
    `  nomade decisoes           o que está esperando um sócio\n` +
    `  nomade maquinas           quem está de pé na conta\n` +
    `  nomade memoria            saúde da memória da empresa\n` +
    `  nomade mcp --remover      desliga a memória do Claude Code\n\n` +
    `━━ precisa de\n\n` +
    `  Node 20+  ·  Claude Code instalado e logado (roda: claude)\n\n` +
    `━━ se achar que não atualizou\n\n` +
    `  npm i -g --force ${base}/cli/nomade-cli-${verOuVazio}.tgz\n` +
    `  npm ls -g --depth=0 | grep nomade      confere a versão instalada\n`
  )
})

/* Instaladores (`/api/download/:platform`) e feed do electron-updater
   (`/updates/:arquivo`) saíram junto com o app Electron. A distribuição agora é
   o CLI: `/cli/nomade-cli.tgz`, montado na hora a partir do `cli/` do repo, e
   `/cli`, que cospe a linha de instalação. O npm resolve plataforma e
   atualização sozinho — não existe mais build por sistema pra publicar. */

// ── missões — marca trabalho pros agents codarem ──
app.get('/api/missions', authenticateToken, async (req, res) => {
  const rows = await db.collection('missions').find({ email: req.user.email }).sort({ createdAt: -1 }).toArray()
  res.json(rows.map(m => ({ id: m.id, title: m.title, status: m.status, createdAt: m.createdAt })))
})

app.post('/api/missions', authenticateToken, async (req, res) => {
  const title = String(req.body.title || '').trim()
  if (!title) return res.status(400).json({ error: 'Missão vazia.' })
  const mission = { id: `mis_${Date.now()}`, email: req.user.email, title, status: 'aberta', createdAt: new Date() }
  await db.collection('missions').insertOne(mission)
  res.json({ id: mission.id, title, status: mission.status })
})

app.patch('/api/missions/:id', authenticateToken, async (req, res) => {
  const { status } = req.body
  if (!['aberta', 'codando', 'feita'].includes(status)) return res.status(400).json({ error: 'Status inválido.' })
  await db.collection('missions').updateOne({ id: req.params.id, email: req.user.email }, { $set: { status } })
  res.json({ ok: true })
})

app.delete('/api/missions/:id', authenticateToken, async (req, res) => {
  await db.collection('missions').deleteOne({ id: req.params.id, email: req.user.email })
  res.json({ ok: true })
})

app.get('/api/machines', authenticateToken, async (req, res) => {
  try {
    const rows = await db.collection('machines').find({ email: req.user.email }).toArray()
    const now = Date.now()
    res.json(rows.map(m => ({
      machineId: m.machineId,
      name: m.name,
      platform: m.platform,
      lanIp: m.lanIp || null,
      models: m.models || [],
      online: now - new Date(m.lastSeen).getTime() < 90_000,
      /* Dois campos, não um: `modoDesejado` é o que o sócio pediu, `modoAtual`
         é o que a máquina confirmou ter aplicado. Diferentes = ainda não pegou
         o heartbeat (ou o runner está fechado, e aí nunca vai pegar). */
      modoDesejado: m.modoDesejado || null,
      modoAtual: m.modoAtual || null,
      servidor: !!m.servidor,
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/squads', authenticateToken, async (req, res) => {
  try {
    const squads = await db.collection('squads').find({ ownerId: req.user.sub }).toArray()
    res.json(squads)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══ Escritório virtual — a camada "empresa autônoma" ═══
// Agents são FUNCIONÁRIOS: têm departamento, papel, modelo e autonomia.
// Quando um agent bate num ponto de julgamento, vira DECISÃO no inbox dos
// sócios (gestão por exceção: sócio é chamado, não vigia). Tudo que
// acontece vira evento no feed (TTL 30 dias — não infla o Atlas).

const officeAuth = (req, res, next) => authenticateToken(req, res, () => {
  const email = (req.user?.email || '').toLowerCase()
  if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'Acesso restrito aos sócios.' })
  }
  next()
})

async function officeEvent(tipo, data = {}) {
  try { await db.collection('office_events').insertOne({ tipo, ...data, ts: new Date() }) } catch { /* feed é best-effort */ }
}

// — funcionários = OS PRÓPRIOS SQUADS da empresa —
// Nada de registro paralelo: o organograma é uma LENTE sobre a collection
// squads. Departamento/autonomia são atributos salvos no squad. Criar e
// editar a composição continua no editor (hub); aqui mora a visão-empresa.
app.get('/api/office/agents', officeAuth, async (req, res) => {
  try {
    const squads = await db.collection('squads').find({}).sort({ createdAt: 1 }).toArray()

    /* Placar de notas boas/ruins por squad, da janela que os runs cobrem (TTL de 30 dias).
       Agrupa por NOME porque é o que o run guarda — squad renomeado zera o
       placar, o que é aceitável: agent renomeado costuma ser agent mudado. */
    const notas = await db.collection('office_runs').aggregate([
      { $match: { nota: { $in: [1, -1] } } },
      { $group: { _id: { squad: '$squad', nota: '$nota' }, n: { $sum: 1 } } },
    ]).toArray().catch(() => [])
    const placar = {}
    for (const r of notas) {
      const k = r._id.squad || ''
      placar[k] = placar[k] || { bons: 0, ruins: 0 }
      if (r._id.nota === 1) placar[k].bons += r.n
      else placar[k].ruins += r.n
    }

    res.json(squads.map(s => ({
      id: s.id,
      name: s.name,
      notas: placar[s.name] || { bons: 0, ruins: 0 },
      agents: (s.agents || []).map(a => ({ name: a.name, model: a.model || '', role: a.role?.title || a.role || '' })),
      dept: s.dept || null,
      autonomia: s.autonomia ?? 0, // 0 = sempre pede aprovação · 3 = roda solto
      servidor: !!s.servidor,       // pode rodar no servidor, sem máquina aberta
      donoConta: s.donoConta || null, // QUEM executa: assinatura de qual sócio
      maquinaId: s.maquinaId || null, // ONDE executa: eixo separado do dono
      instrucoes: s.instrucoes || null, // o cérebro do agent; null = roda no fallback
      boardPadrao: s.boardPadrao || null, // board onde as tasks dele nascem (é de lá que sai a pasta)
      modelo: s.modelo || null,       // vazio = Claude; zai:/gemini:/ollama: = motor agnóstico
      graph: s.graph || null,
      updatedAt: s.updatedAt,
    })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// gera o código squad.ai a partir dos agents — mantém o formato do parser
function generateSquadCode(squadName, agents) {
  const safeName = String(squadName || 'MeuSquad').replace(/\W/g, '')
  const blocks = (agents || []).map(a => {
    const id = String(a.name || 'Agente').replace(/\W/g, '')
    return [
      `  agent ${id} {`,
      `    role: "${a.role?.title || a.role || 'Agent'}"`,
      `    model: "${a.model || 'claude-sonnet-5'}"`,
      `    temperature: ${Number.isFinite(Number(a.temperature)) ? Number(a.temperature) : 0.7}`,
      `    systemPrompt: """`,
      `${String(a.systemPrompt || '').trim()}`,
      `    """`,
      `  }`,
    ].join('\n')
  })
  return `squad ${safeName} {\n${blocks.join('\n\n')}\n}`
}

// ── GRAFO do squad (canvas estilo n8n) ──────────────────────
// Nós: agent (LLM) · loop (repete um trecho) · funcao (transforma o texto
// sem gastar modelo) · nota (só documenta). A EXECUÇÃO continua sendo uma
// linha — então o grafo é LINEARIZADO aqui: caminhar do início pelas
// ligações, expandindo loop N vezes. Assim o runner do app não muda.
const NODE_TIPOS = ['agent', 'loop', 'funcao', 'imagem', 'nota']

function normGraph(g) {
  if (!g || !Array.isArray(g.nodes)) return null
  const nodes = g.nodes.slice(0, 60).map(n => ({
    id: String(n.id || `n_${Math.random().toString(36).slice(2, 8)}`),
    tipo: NODE_TIPOS.includes(n.tipo) ? n.tipo : 'agent',
    x: Number(n.x) || 0,
    y: Number(n.y) || 0,
    nome: String(n.nome || 'Etapa').slice(0, 60),
    // agent
    papel: String(n.papel || '').slice(0, 120),
    modelo: String(n.modelo || 'claude-sonnet-5'),
    temperatura: Math.min(1, Math.max(0, Number(n.temperatura) ?? 0.7)),
    prompt: String(n.prompt || ''),
    // loop
    vezes: Math.min(5, Math.max(1, Number(n.vezes) || 2)),
    // funcao
    operacao: ['resumir', 'extrair_json', 'concatenar', 'limpar'].includes(n.operacao) ? n.operacao : 'resumir',
    texto: String(n.texto || '').slice(0, 2000),
  }))
  const ids = new Set(nodes.map(n => n.id))
  const edges = (Array.isArray(g.edges) ? g.edges : []).slice(0, 120)
    .map(e => ({ de: String(e.de), para: String(e.para) }))
    .filter(e => ids.has(e.de) && ids.has(e.para) && e.de !== e.para)
  return { nodes, edges }
}

// grafo → fila de agents (o que o runner executa hoje)
function linearizarGraph(graph) {
  if (!graph?.nodes?.length) return []
  const { nodes, edges } = graph
  const porId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const temEntrada = new Set(edges.map(e => e.para))
  const inicio = nodes.find(n => !temEntrada.has(n.id)) || nodes[0]

  const fila = []
  const visitados = new Set()
  let atual = inicio
  let guarda = 0
  while (atual && guarda++ < 200) {
    if (visitados.has(atual.id)) break // ciclo solto: para (loop é nó explícito)
    visitados.add(atual.id)

    if (atual.tipo === 'agent') {
      fila.push({ name: atual.nome, role: atual.papel, model: atual.modelo, temperature: atual.temperatura, systemPrompt: atual.prompt })
    } else if (atual.tipo === 'imagem') {
      // desenha a partir do resultado anterior — o runner reconhece 'imagem'
      fila.push({ name: atual.nome, role: 'imagem', model: 'imagem', temperature: 0, systemPrompt: atual.prompt || '' })
    } else if (atual.tipo === 'funcao') {
      // vira um passo barato: instrução determinística pro modelo do passo seguinte
      const instr = {
        resumir: 'Resume o resultado anterior em no máximo 10 linhas, sem perder número nem nome.',
        extrair_json: 'Extrai do resultado anterior um JSON válido com os campos citados. Responde só o JSON.',
        concatenar: `Junta o resultado anterior com este texto fixo:\n${atual.texto}`,
        limpar: 'Reescreve o resultado anterior sem repetição, sem preâmbulo e sem markdown desnecessário.',
      }[atual.operacao]
      fila.push({ name: atual.nome, role: 'função', model: 'claude-haiku-4-5', temperature: 0, systemPrompt: instr })
    } else if (atual.tipo === 'loop') {
      // repete o BLOCO seguinte N vezes (o trecho até o próximo nó sem saída
      // ou até voltar pro loop) — expandido aqui, plano pro runner
      const saida = edges.find(e => e.de === atual.id)
      const corpo = []
      let cursor = saida ? porId[saida.para] : null
      const vistosLoop = new Set([atual.id])
      while (cursor && !vistosLoop.has(cursor.id) && cursor.tipo !== 'loop') {
        vistosLoop.add(cursor.id)
        if (cursor.tipo === 'agent') corpo.push({ name: cursor.nome, role: cursor.papel, model: cursor.modelo, temperature: cursor.temperatura, systemPrompt: cursor.prompt })
        const prox = edges.find(e => e.de === cursor.id)
        cursor = prox ? porId[prox.para] : null
      }
      for (let i = 0; i < atual.vezes; i++) {
        for (const passo of corpo) fila.push({ ...passo, name: `${passo.name} ${i + 1}/${atual.vezes}` })
      }
      vistosLoop.forEach(id => visitados.add(id))
      atual = cursor || null
      continue
    }

    const prox = edges.find(e => e.de === atual.id)
    atual = prox ? porId[prox.para] : null
  }
  return fila
}

const normSquadAgents = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 12).map(a => ({
  id: a.id || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: String(a.name || 'Agente').replace(/\W/g, '') || 'Agente',
  role: { title: String(a.role?.title || a.role || 'Agent'), description: '', expertise: [], behaviors: [] },
  model: String(a.model || 'claude-sonnet-5'),
  temperature: Math.min(1, Math.max(0, Number(a.temperature) || 0.7)),
  systemPrompt: String(a.systemPrompt || ''),
  integrations: [],
}))

// criar squad direto do admin (organograma é o gerenciador oficial)
app.post('/api/office/agents', officeAuth, async (req, res) => {
  try {
    const { name, dept, autonomia, agents, graph, instrucoes } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name obrigatório' })
    const g = normGraph(graph)
    // com canvas, a fila de execução vem do GRAFO (linearizado)
    const normAgents = g ? normSquadAgents(linearizarGraph(g)) : normSquadAgents(agents)
    const squad = {
      id: `squad_${Date.now()}`,
      name: name.trim(),
      code: generateSquadCode(name, normAgents),
      agents: normAgents,
      graph: g, // desenho do canvas (null = squad em lista, do editor antigo)
      orchestration: 'sequential',
      ownerId: req.user.sub || req.user.email,
      ownerEmail: req.user.email,
      dept: dept || null,
      autonomia: Math.min(3, Math.max(0, Number(autonomia) || 0)),
      /* O cérebro do agent no motor agêntico. Sem isto o runner cai no
         systemPrompt do primeiro agent do pipeline e ignora tudo que foi escrito
         pro squad — era lido em três lugares e não tinha por onde escrever. */
      instrucoes: String(instrucoes || '').trim() || null,
      servidor: !!req.body.servidor,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.collection('squads').insertOne(squad)
    officeEvent('funcionario_criado', { nome: squad.name, por: req.user.email })
    res.json(squad)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/office/agents/:id', officeAuth, async (req, res) => {
  try {
    const existing = await db.collection('squads').findOne({ id: req.params.id })
    if (!existing) return res.status(404).json({ error: 'Squad não encontrado.' })
    const allowed = { updatedAt: new Date() }
    if (req.body.dept !== undefined) allowed.dept = req.body.dept || null
    if (req.body.autonomia !== undefined) allowed.autonomia = Math.min(3, Math.max(0, Number(req.body.autonomia) || 0))
    if (req.body.servidor !== undefined) allowed.servidor = !!req.body.servidor // roda sem máquina aberta
    // dono do squad: default de quem executa as tasks dele (a task pode sobrescrever)
    if (req.body.boardPadrao !== undefined) allowed.boardPadrao = req.body.boardPadrao || null
    // modelo do squad: "claude-*" usa o Agent SDK; "zai:/gemini:/ollama:" o motor agnóstico
    if (req.body.modelo !== undefined) allowed.modelo = String(req.body.modelo || '').trim() || null
    // o cérebro do agent — ver o comentário no POST. Sem caminho de escrita, todo
    // squad rodava no fallback do pipeline velho, que é o preset genérico.
    if (req.body.instrucoes !== undefined) allowed.instrucoes = String(req.body.instrucoes || '').trim() || null
    if (req.body.donoConta !== undefined) {
      const d = String(req.body.donoConta || '').trim().toLowerCase()
      if (d && ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(d)) {
        return res.status(400).json({ error: `"${d}" não é um sócio liberado.` })
      }
      allowed.donoConta = d || null
    }
    /* MÁQUINA DO SQUAD — "tudo do squad Produção roda no desktop do Bruno".
       Vale pra todas as tasks dele que não carimbem máquina própria, e vence o
       board. Vazio = qualquer máquina. */
    if (req.body.maquinaId !== undefined) {
      const mid = String(req.body.maquinaId || '').trim().slice(0, 64)
      if (mid) {
        const existe = await db.collection('machines').findOne({ machineId: mid }, { projection: { _id: 1 } })
        if (!existe) return res.status(400).json({ error: 'máquina desconhecida — ela precisa ter rodado o runner ao menos uma vez.' })
      }
      allowed.maquinaId = mid || null
    }
    if (req.body.name?.trim()) allowed.name = req.body.name.trim()
    // grafo válido manda (desenho antigo); lista de agents = editor em lista,
    // e aí o grafo vai embora — graph:null com agents NÃO zera o pipeline
    const gPatch = req.body.graph !== undefined ? normGraph(req.body.graph) : undefined
    if (gPatch) {
      allowed.graph = gPatch
      allowed.agents = normSquadAgents(linearizarGraph(gPatch))
      allowed.code = generateSquadCode(allowed.name || existing.name, allowed.agents)
    } else if (Array.isArray(req.body.agents)) {
      allowed.agents = normSquadAgents(req.body.agents)
      if (req.body.graph === null) allowed.graph = null
      allowed.code = generateSquadCode(allowed.name || existing.name, allowed.agents)
    } else if (allowed.name && allowed.name !== existing.name) {
      allowed.code = generateSquadCode(allowed.name, existing.agents || [])
    }
    await db.collection('squads').updateOne({ id: req.params.id }, { $set: allowed })
    res.json(await db.collection('squads').findOne({ id: req.params.id }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// excluir de verdade — inclusive squads órfãos de dono antigo (o hub só
// apagava por ownerId, e squad de sub antigo ficava imortal no organograma)
app.delete('/api/office/agents/:id', officeAuth, async (req, res) => {
  try {
    const squad = await db.collection('squads').findOne({ id: req.params.id })
    await db.collection('squads').deleteOne({ id: req.params.id })
    if (squad) officeEvent('funcionario_demitido', { nome: squad.name, por: req.user.email })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// — decisões (inbox de aprovações) —
/* ═══ PROSPECÇÃO — acha negócio real e vira lead ═════════════════════════
   Dois passos de propósito: buscar MOSTRA, importar GRAVA. Cada busca custa
   dinheiro no Google e cada lead ruim custa o tempo de quem liga — então
   ninguém enche a base sem olhar antes.
   A lógica mora em lib/leads.js; aqui é só a porta. */
app.post('/api/office/leads/buscar', officeAuth, async (req, res) => {
  try {
    const busca = String(req.body?.busca || '').trim()
    if (!busca) return res.status(400).json({ error: 'busca obrigatória (ex: "padaria")' })
    const regiao = String(req.body?.regiao || '').trim()
    const max = Number(req.body?.max) || 20
    /* Duas fontes: `osm` é grátis e sem chave, `places` é paga e sabe mais.
       O padrão é a grátis — ninguém deveria precisar de cartão pra testar. */
    const fonte = req.body?.fonte === 'places' ? 'places' : 'osm'
    const achados = fonte === 'places'
      ? await buscarNoPlaces({ busca, regiao, max, chave: process.env.GOOGLE_PLACES_KEY || process.env.GOOGLE_API_KEY })
      : await buscarNoOsm({ busca, regiao, max })
    const scoreMinimo = Number.isFinite(Number(req.body?.scoreMinimo)) ? Number(req.body.scoreMinimo) : 30

    if (!req.body?.importar) {
      return res.json({
        prévia: true, fonte, encontrados: achados.length, scoreMinimo,
        leads: achados.sort((a, b) => b.score - a.score),
      })
    }
    const r = await importarLeads(mainDb.collection('nomade_leads'), achados, {
      por: req.user.email, busca, regiao: req.body?.regiao, scoreMinimo,
    })
    officeEvent('leads_prospectados', { busca, regiao, fonte, novos: r.novos, por: req.user.email })
    res.json({ prévia: false, fonte, encontrados: achados.length, ...r })
  } catch (err) { res.status(400).json({ error: String(err.message || err) }) }
})

app.get('/api/office/decisions', officeAuth, async (req, res) => {
  try {
    const q = req.query.status ? { status: req.query.status } : {}
    res.json(await db.collection('office_decisions').find(q).sort({ createdAt: -1 }).limit(100).toArray())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

const URGENCIAS = ['urgente', 'hoje', 'andamento', 'afazer']

app.post('/api/office/decisions', officeAuth, async (req, res) => {
  try {
    const { agentId, agentName, dept, contexto, pergunta, opcoes, urgencia, sugestao, projetoId, taskId } = req.body
    // decisão levantada por um agent NO MEIO da execução: herda a conversa da
    // task, pra resposta voltar pro mesmo fio onde o trabalho foi planejado
    let conversaDaTask = null
    if (taskId) {
      try {
        const t = await mainDb.collection('nomade_tasks').findOne({ _id: new ObjectId(String(taskId)) })
        if (t?.conversaId) conversaDaTask = t.conversaId
        if (t) {
          await mainDb.collection('nomade_tasks').updateOne({ _id: t._id }, {
            $push: { comments: {
              id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              author: agentName || 'Agent', authorId: 'agent',
              text: `Parei aqui e levantei uma decisão: ${String(pergunta || '').slice(0, 300)}`,
              createdAt: new Date(),
            } },
            $set: { updatedAt: new Date() },
          })
        }
      } catch { /* task inválida: decisão vive sem vínculo */ }
    }
    if (!pergunta?.trim()) return res.status(400).json({ error: 'pergunta obrigatória' })
    // opções ricas [{label, valor}] — aceita string simples também
    const ops = (Array.isArray(opcoes) ? opcoes : []).slice(0, 6)
      .map(o => typeof o === 'string'
        ? { label: o.trim(), valor: o.trim() }
        : { label: String(o?.label || o?.valor || '').trim(), valor: String(o?.valor || o?.label || '').trim() })
      .filter(o => o.label)
    const decision = {
      id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId: agentId || null,
      conversaId: conversaDaTask, // agent parou no meio → volta pro fio certo
      taskId: taskId || null,
      agentName: (agentName || '').trim(),
      dept: (dept || '').trim() || null,
      projetoId: projetoId || null,
      contexto: (contexto || '').trim(),
      pergunta: pergunta.trim(),
      opcoes: ops,
      urgencia: URGENCIAS.includes(urgencia) ? urgencia : 'afazer',
      sugestao: (sugestao || '').trim(), // caminho que o orquestrador recomenda
      status: 'aberta',
      createdAt: new Date(),
    }
    await db.collection('office_decisions').insertOne(decision)
    officeEvent('decisao_aberta', { decisionId: decision.id, agentName: decision.agentName, pergunta: decision.pergunta, urgencia: decision.urgencia })
    res.json(decision)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/office/decisions/:id', officeAuth, async (req, res) => {
  try {
    const { resolucao, tipo } = req.body
    await db.collection('office_decisions').updateOne(
      { id: req.params.id, status: 'aberta' },
      {
        $set: {
          status: 'resolvida',
          tipo: ['aprovar', 'ajustar', 'assumir'].includes(tipo) ? tipo : 'aprovar',
          resolucao: (resolucao || '').trim(),
          resolvidaPor: req.user.email,
          resolvidaEm: new Date(),
        },
      }
    )
    const dec = await db.collection('office_decisions').findOne({ id: req.params.id })
    if (dec) {
      officeEvent('decisao_resolvida', { decisionId: dec.id, resolucao: dec.resolucao, por: req.user.email })
      // A decisão nasceu numa conversa? Então a resposta VOLTA pra lá como
      // recado do sistema — pendente de leitura. Quando o sócio abrir o chat,
      // o orquestrador consome isso e segue de onde parou (sem re-explicar).
      if (dec.conversaId) {
        await db.collection('office_mensagens').insertOne({
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          conversaId: dec.conversaId,
          autor: 'sistema',
          texto: `Decisão resolvida por ${String(req.user.email).split('@')[0]}: "${dec.pergunta}" → ${dec.tipo || 'aprovar'}${dec.resolucao ? ` · ${dec.resolucao}` : ''}`,
          decisao: { id: dec.id, pergunta: dec.pergunta, tipo: dec.tipo, resolucao: dec.resolucao },
          consumida: false,
          ts: new Date(),
        })
        await db.collection('office_conversas').updateOne({ id: dec.conversaId }, { $set: { atualizada: new Date() } })
      }
      /* Decisão que PAROU um agent no meio: a resposta volta pra TASK e a
         task VOLTA PRA FILA. Sem o segundo, o sócio respondia e não
         acontecia nada — o agent tinha parado, o `pedidoEm` já tinha sido
         consumido no claim, e a task ficava esperando alguém lembrar de dar
         play de novo. Responder É o gatilho. */
      if (dec.taskId) {
        try {
          await mainDb.collection('nomade_tasks').updateOne(
            { _id: new ObjectId(String(dec.taskId)), archived: { $ne: true } },
            { $set: { pedidoEm: new Date(), pedidoPor: req.user.email }, $unset: { workerLock: '', workerMaquina: '' } }
          )
          officeEvent('run_pedido', { task: dec.taskId, por: req.user.email, motivo: 'decisão respondida' })
        } catch { /* task apagada: a decisão segue resolvida */ }
        try {
          await mainDb.collection('nomade_tasks').updateOne(
            { _id: new ObjectId(String(dec.taskId)) },
            {
              $push: { comments: {
                id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                author: String(req.user.email).split('@')[0], authorId: 'socio',
                text: `Decisão respondida — "${dec.pergunta}" → ${dec.tipo || 'aprovar'}${dec.resolucao ? `: ${dec.resolucao}` : ''}`,
                createdAt: new Date(),
              } },
              $set: { updatedAt: new Date() },
            }
          )
        } catch { /* task apagada no meio: a decisão segue resolvida */ }
      }
    }
    res.json(dec)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══ IMAGENS — os agents desenham ═══
// Usa as chaves da EQUIPE (OpenAI primeiro, Gemini como reserva). O binário
// fica no Mongo e é servido por rota própria — assim a imagem tem URL estável
// pra entrar no chat, no card do kanban e no canvas.

async function gerarImagem(prompt, opts = {}) {
  const keys = await getKeys()
  const limpo = String(prompt || '').trim().slice(0, 1200)
  if (!limpo) throw new Error('Sem prompt pra imagem.')
  const tamanho = ['1024x1024', '1536x1024', '1024x1536'].includes(opts.tamanho) ? opts.tamanho : '1024x1024'

  // 1) OpenAI gpt-image-1
  if (keys.openai) {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${keys.openai}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: limpo, size: tamanho, n: 1 }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok && j.data?.[0]?.b64_json) {
      return { b64: j.data[0].b64_json, mime: 'image/png', provider: 'openai', model: 'gpt-image-1' }
    }
    if (!keys.gemini) throw new Error(j.error?.message || `OpenAI imagem HTTP ${r.status}`)
  }

  // 2) Gemini (reserva)
  if (keys.gemini) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${keys.gemini}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: limpo }] }] }),
    })
    const j = await r.json().catch(() => ({}))
    const part = j?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)
    if (r.ok && part) {
      return { b64: part.inlineData.data, mime: part.inlineData.mimeType || 'image/png', provider: 'gemini', model: 'gemini-2.5-flash-image' }
    }
    throw new Error(j.error?.message || `Gemini imagem HTTP ${r.status}`)
  }

  throw new Error('Sem chave de imagem — conecta OpenAI ou Gemini na aba Chaves.')
}

async function salvarImagem(prompt, img, meta = {}) {
  const doc = {
    // 16 bytes de crypto — o comentário da rota pública abaixo diz que o id
    // é o que protege a imagem; antes era timestamp + 4 chars de Math.random
    // (~20 bits e o tempo dá pra chutar), ou seja, enumerável.
    id: `img_${crypto.randomBytes(16).toString('hex')}`,
    prompt: String(prompt).slice(0, 1200),
    b64: img.b64,
    mime: img.mime,
    provider: img.provider,
    model: img.model,
    bytes: Math.round((img.b64.length * 3) / 4),
    por: meta.por || 'agent',
    squad: meta.squad || null,
    taskId: meta.taskId || null,
    ts: new Date(),
  }
  await db.collection('office_imagens').insertOne(doc)
  officeEvent('imagem_criada', { prompt: doc.prompt.slice(0, 80), provider: doc.provider, por: doc.por })
  const { b64, ...semBinario } = doc
  return semBinario
}

app.get('/api/office/imagens', officeAuth, async (req, res) => {
  try {
    res.json(await db.collection('office_imagens')
      .find({}, { projection: { b64: 0 } }).sort({ ts: -1 }).limit(120).toArray())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/office/imagens', officeAuth, async (req, res) => {
  try {
    const img = await gerarImagem(req.body?.prompt, req.body || {})
    const saved = await salvarImagem(req.body.prompt, img, { por: req.user.email, squad: req.body.squad, taskId: req.body.taskId })
    res.json({ ...saved, url: `/api/office/imagens/${saved.id}/arquivo` })
  } catch (err) { res.status(400).json({ error: String(err.message || err) }) }
})

// bytes da imagem — rota pública POR ID (id é aleatório e não listável sem token)
app.get('/api/office/imagens/:id/arquivo', limitArquivo, async (req, res) => {
  try {
    const doc = await db.collection('office_imagens').findOne({ id: req.params.id })
    if (!doc) return res.status(404).end()
    const buf = Buffer.from(doc.b64, 'base64')
    res.writeHead(200, { 'Content-Type': doc.mime || 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, immutable' })
    res.end(buf)
  } catch { res.status(500).end() }
})

app.delete('/api/office/imagens/:id', officeAuth, async (req, res) => {
  try {
    await db.collection('office_imagens').deleteOne({ id: req.params.id })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})



// ═══ GATILHOS — o ciclo começa sem ninguém mandar ═══
// Sem isto, tudo depende de um sócio abrir o chat. Ambos nascem DESLIGADOS:
// ligar é decisão de quem paga a conta de token (aba Chaves → Automações).
async function getGatilhos() {
  try {
    const d = await db.collection('office_config').findOne({ id: 'gatilhos' })
    return { leadTriagem: !!d?.leadTriagem, rotinaDiaria: !!d?.rotinaDiaria, horaRotina: Number(d?.horaRotina ?? 8), ultimaRotina: d?.ultimaRotina || null, dono: d?.dono || null }
  } catch { return { leadTriagem: false, rotinaDiaria: false, horaRotina: 8, ultimaRotina: null, dono: null } }
}

app.get('/api/office/gatilhos', officeAuth, async (req, res) => res.json(await getGatilhos()))

app.patch('/api/office/gatilhos', officeAuth, async (req, res) => {
  try {
    const set = { por: req.user.email, em: new Date() }
    if (req.body.leadTriagem !== undefined) set.leadTriagem = !!req.body.leadTriagem
    if (req.body.rotinaDiaria !== undefined) {
      set.rotinaDiaria = !!req.body.rotinaDiaria
      // quem liga a rotina recebe as conversas dela (senão caía sempre no 1º admin)
      if (set.rotinaDiaria) set.dono = req.user.email
    }
    if (req.body.horaRotina !== undefined) set.horaRotina = Math.min(23, Math.max(0, Number(req.body.horaRotina) || 8))
    await db.collection('office_config').updateOne({ id: 'gatilhos' }, { $set: set }, { upsert: true })
    officeEvent('gatilho_alterado', { ...set, por: req.user.email })
    res.json(await getGatilhos())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GATILHO 1 — lead novo no site vira task pro squad de Triagem
async function gatilhoLeads() {
  const squad = await db.collection('squads').findOne({ dept: 'triagem' })
  if (!squad) return // sem squad de triagem, não inventa trabalho
  const novos = await mainDb.collection('nomade_leads')
    .find({ status: 'new', taskTriagem: { $exists: false } })
    .sort({ createdAt: -1 }).limit(5).toArray()
  if (!novos.length) return

  const board = await boardDoOrquestrador()
  const colunaId = colunaDeEntrada(board)
  let pos = (await mainDb.collection('nomade_tasks').countDocuments({ boardId: String(board._id), status: colunaId })) || 0
  for (const lead of novos) {
    const quem = lead.name || lead.company || lead.contactValue || 'lead sem nome'
    const doc = {
      boardId: String(board._id),
      title: `Triar lead: ${quem}`,
      description: [
        lead.company ? `Empresa: ${lead.company}${lead.employees ? ` (${lead.employees})` : ''}` : null,
        lead.contactValue ? `Contato: ${lead.contactValue} (${lead.contactType || '?'})` : null,
        lead.vertical ? `Vertical: ${lead.vertical}` : null,
        lead.msg ? `\nMensagem:\n${String(lead.msg).slice(0, 2000)}` : null,
      ].filter(Boolean).join('\n'),
      status: colunaId,
      position: pos++,
      assignee: `agent:${squad.id}`,
      priority: 'high',
      dueDate: null,
      labels: ['orquestrador', 'triagem', 'lead'],
      subtasks: [], checklist: [], attachments: [], comments: [],
      archived: false,
      createdBy: 'gatilho', createdByName: 'Gatilho · lead novo',
      clientEmail: (lead.email || '').toLowerCase() || null,
      visibleToClient: false, clientStatusLabel: null,
      conversaId: null,
      createdAt: new Date(), updatedAt: new Date(),
    }
    await mainDb.collection('nomade_tasks').insertOne(doc)
    await mainDb.collection('nomade_leads').updateOne({ _id: lead._id }, { $set: { taskTriagem: new Date() } })
    officeEvent('gatilho_lead', { lead: quem, squad: squad.name })
  }
}

// GATILHO 2 — rotina diária: o orquestrador olha a casa e reporta
async function gatilhoRotina(cfg) {
  const agora = new Date()
  const hoje = agora.toISOString().slice(0, 10)
  if (cfg.ultimaRotina === hoje) return
  if (agora.getHours() < cfg.horaRotina) return

  await db.collection('office_config').updateOne({ id: 'gatilhos' }, { $set: { ultimaRotina: hoje } }, { upsert: true })

  const dono = cfg.dono || (process.env.ADMIN_EMAILS || '').split(',')[0].trim()
  const conv = {
    id: `conv_${Date.now()}_rotina`,
    titulo: `Rotina do dia · ${agora.toLocaleDateString('pt-BR')}`,
    dono,
    criada: agora, atualizada: agora,
  }
  await db.collection('office_conversas').insertOne(conv)

  const pedido = 'Revisa a casa e me dá o retrato do dia: o que está aberto no kanban há tempo demais, ' +
    'qual cliente está sem movimento, e o que tu recomenda atacar hoje. Se faltar decisão minha pra destravar algo, levanta. ' +
    'Só cria tarefa se for realmente necessário — não enche o board.'
  await db.collection('office_mensagens').insertOne({
    id: `msg_${Date.now()}_rot`, conversaId: conv.id, autor: `socio:${dono}`, texto: pedido, ts: agora,
  })

  try {
    const orq = await getOrqConfig()
    const keys = await getKeys()
    const system = await orqSystemPrompt(conv)
    const msgs = [{ role: 'user', content: pedido }]
    const nada = () => {}
    let full = ''
    full = await orqStream(orq, keys, system, msgs, nada)

    const { visivel, passos } = await orqProcessar(full, conv.id)
    await db.collection('office_mensagens').insertOne({
      id: `msg_${Date.now()}_orq`, conversaId: conv.id, autor: 'orquestrador', texto: visivel, passos, ts: new Date(),
    })
    officeEvent('rotina_diaria', { passos: passos.length })
  } catch (err) {
    officeEvent('rotina_diaria_erro', { erro: String(err.message || err).slice(0, 200) })
  }
}


/* ═══ RUNS — a execução vira registro que a WEB consegue abrir ═══
   Desenho: a web NUNCA fala com a máquina. A ponte local recusa qualquer
   request com Origin (o agent roda em bypassPermissions — página de navegador
   não dirige agente). Então o runner PUXA trabalho daqui e EMPURRA progresso
   pra cá; a web só lê este banco.

   O que é gravado é progresso ESTRUTURADO, não log cru: etapa, modelo, conta
   usada e a saída de cada etapa. Stream token-a-token de máquina remota,
   atravessando banco, pra quatro sócios olharem, não paga o custo. */

const RUN_MAX_ETAPAS = 24
const RUN_SAIDA_MAX = 12000

app.get('/api/office/runs', officeAuth, async (req, res) => {
  try {
    const q = {}
    if (req.query.taskId) q.taskId = String(req.query.taskId)
    if (req.query.ativos === '1') q.status = 'rodando'
    const rows = await db.collection('office_runs')
      .find(q, { projection: { etapas: { $slice: -3 } } }) // lista não precisa do histórico inteiro
      .sort({ iniciado: -1 }).limit(Math.min(100, Number(req.query.limit) || 40)).toArray()
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/office/runs/:id', officeAuth, async (req, res) => {
  try {
    const run = await db.collection('office_runs').findOne({ id: req.params.id })
    if (!run) return res.status(404).json({ error: 'Run não encontrado.' })
    res.json(run)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// runner abre o run (já reservou a task no claim)
app.post('/api/office/runs', officeAuth, async (req, res) => {
  try {
    const { taskId, squad, maquina, conta, total, retomando } = req.body
    const run = {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      taskId: taskId ? String(taskId) : null,
      titulo: '',
      squad: String(squad || '').slice(0, 80),
      maquina: String(maquina || '').slice(0, 80),
      conta: String(conta || '').slice(0, 80),   // qual assinatura tocou este run
      status: 'rodando',
      etapa: Number(retomando) || 0,
      total: Number(total) || 0,
      etapas: [],
      erro: null,
      por: req.user.email,
      iniciado: new Date(),
      atualizado: new Date(),
    }
    if (run.taskId) {
      const t = await mainDb.collection('nomade_tasks').findOne({ _id: new ObjectId(run.taskId) }).catch(() => null)
      if (t) run.titulo = t.title
    }
    await db.collection('office_runs').insertOne(run)
    officeEvent('run_start', { runId: run.id, squad: run.squad, origem: run.maquina || 'runner', task: run.titulo, conta: run.conta })
    res.json(run)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// progresso e fim — uma rota só, porque o runner só tem estes dois momentos
/* NOTA DO SÓCIO NUM RUN — boa ou ruim. Existe porque `office_runs` guardava o que
   aconteceu e ninguém agregava por squad: dava pra sentir que um agent é ruim,
   nunca pra mostrar. Com três Dev em modelos diferentes, "qual presta" vira
   pergunta de todo dia, e sensação não responde.

   A nota é do RUN, não do squad: o mesmo agent vai bem numa task e mal noutra,
   e é a distribuição que interessa. Os runs expiram em 30 dias por TTL, então
   a contagem é sempre da janela recente — que é a que importa pra decidir. */
app.patch('/api/office/runs/:id/nota', officeAuth, async (req, res) => {
  try {
    const n = Number(req.body?.nota)
    if (n !== 1 && n !== -1 && n !== 0) return res.status(400).json({ error: 'nota: 1 (bom), -1 (ruim) ou 0 (tira a nota)' })
    const r = await db.collection('office_runs').updateOne(
      { id: req.params.id },
      n === 0
        ? { $unset: { nota: '', notaPor: '', notaEm: '', notaComentario: '' } }
        : { $set: { nota: n, notaPor: req.user.email, notaEm: new Date(), notaComentario: String(req.body?.comentario || '').slice(0, 500) } }
    )
    if (!r.matchedCount) return res.status(404).json({ error: 'Run não encontrado.' })
    res.json({ ok: true, nota: n || null })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/office/runs/:id', officeAuth, async (req, res) => {
  try {
    const run = await db.collection('office_runs').findOne({ id: req.params.id })
    if (!run) return res.status(404).json({ error: 'Run não encontrado.' })

    const set = { atualizado: new Date() }
    const push = {}

    if (req.body.etapa && typeof req.body.etapa === 'object') {
      const e = req.body.etapa
      set.etapa = Math.max(0, Number(e.indice) || 0)
      if (e.total) set.total = Number(e.total)
      if ((run.etapas || []).length < RUN_MAX_ETAPAS) {
        push.etapas = {
          indice: Math.max(0, Number(e.indice) || 0),
          nome: String(e.nome || '').slice(0, 80),
          modelo: String(e.modelo || '').slice(0, 60),
          motor: String(e.motor || '').slice(0, 20),   // agente | texto | local | desenho
          saida: String(e.saida || '').slice(0, RUN_SAIDA_MAX),
          ferramentas: (Array.isArray(e.ferramentas) ? e.ferramentas : []).slice(0, 40).map(f => String(f).slice(0, 160)),
          imagem: e.imagem ? String(e.imagem).slice(0, 300) : null,
          duracaoMs: Number(e.duracaoMs) || 0,
          /* Contadores do `result` do SDK. A etapa é saneada campo a campo, então
             campo que não está aqui é DESCARTADO em silêncio — foi por isso que
             tokens nunca chegou. `subtype` é o que separa "estourou o teto de
             turnos" de "esqueceu de entregar", que hoje têm a mesma mensagem. */
          subtype: e.subtype ? String(e.subtype).slice(0, 40) : null,
          turnos: Number(e.turnos) || null,
          tokens: Number(e.tokens) || null,
          custoUsd: Number(e.custoUsd) || null,
          em: new Date(),
        }
      }
    }

    /* ATUAL = a etapa em curso, atualizada no meio do caminho. Sem isto a tela
       ficava muda durante uma etapa longa: o progresso só era publicado quando
       a etapa fechava, e etapa do Claude editando arquivo leva minutos. Não é
       stream de token — é o que ele está MEXENDO, que é o que dá pra ler. */
    if (req.body.atual === null) set.atual = null
    else if (req.body.atual && typeof req.body.atual === 'object') {
      set.atual = {
        indice: Math.max(0, Number(req.body.atual.indice) || 0),
        nome: String(req.body.atual.nome || '').slice(0, 80),
        modelo: String(req.body.atual.modelo || '').slice(0, 60),
        motor: String(req.body.atual.motor || '').slice(0, 20),
        ferramentas: (Array.isArray(req.body.atual.ferramentas) ? req.body.atual.ferramentas : [])
          .slice(-12).map(f => String(f).slice(0, 160)), // só as últimas: é acompanhamento, não log
        desde: req.body.atual.desde ? new Date(req.body.atual.desde) : new Date(),
        em: new Date(),
      }
    }
    // etapa fechada ou run terminado: não existe mais "em curso"
    if (req.body.etapa || (req.body.status && req.body.status !== 'rodando')) set.atual = null

    if (req.body.status && ['rodando', 'feito', 'falhou', 'decisao', 'parado'].includes(req.body.status)) {
      set.status = req.body.status
      if (req.body.status !== 'rodando') set.terminado = new Date()
    }
    if (req.body.erro !== undefined) set.erro = req.body.erro ? String(req.body.erro).slice(0, 600) : null
    /* O bruto vai inteiro (8k) e SEPARADO da frase amigável. `erro` é o que a
       tela mostra; `erroBruto` é o que salva a próxima madrugada — um run
       morreu com "exited with code 1" e até hoje ninguém sabe por quê, porque
       o stderr foi descartado na tradução pra frase. */
    if (req.body.erroBruto !== undefined) set.erroBruto = req.body.erroBruto ? String(req.body.erroBruto).slice(0, 8000) : null

    await db.collection('office_runs').updateOne({ id: run.id }, { $set: set, ...(push.etapas ? { $push: push } : {}) })

    if (set.status && set.status !== 'rodando') {
      const ult = (req.body.etapa && typeof req.body.etapa === 'object') ? req.body.etapa : null
      officeEvent(set.status === 'feito' ? 'run_done' : 'run_error', {
        runId: run.id, squad: run.squad, origem: run.maquina || 'runner',
        erro: set.erro || undefined, duracao: Date.now() - new Date(run.iniciado).getTime(),
        // veio de graça junto com o `result` do SDK; sem isto o card de
        // "Tokens processados" nunca sai de "—" pra trabalho de runner
        tokens: ult?.tokens || undefined, turnos: ult?.turnos || undefined,
      })
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})


/* Quem executa esta task e se a máquina dele está no ar.
   O play não roda nada: ele pede. Quem roda é a máquina do DONO — então
   quem clica precisa saber pra onde o pedido foi, senão fica olhando um
   card parado sem entender por quê. */
async function quemExecuta(task) {
  let dono = task.donoConta || null
  if (!dono && String(task.assignee || '').startsWith('agent:')) {
    const sq = await db.collection('squads').findOne({ id: String(task.assignee).slice(6) }, { projection: { donoConta: 1 } }).catch(() => null)
    dono = sq?.donoConta || null
  }
  if (!dono) return { dono: null, online: true } // sem dono: qualquer runner serve
  const m = await db.collection('machines').findOne({
    dono, servidor: true, lastSeen: { $gt: new Date(Date.now() - 90_000) },
  }).catch(() => null)
  return { dono, online: !!m, maquina: m?.name || null }
}

/* PLAY — a web não dispara o run: ela marca "roda essa agora" e o runner
   (que é quem tem o clone e a conta Claude) pega no próximo ciclo. A web
   nunca fala com a máquina; esse é o contrato. */
app.post('/api/office/tarefas-agent/:id/rodar', officeAuth, async (req, res) => {
  try {
    const t = await mainDb.collection('nomade_tasks').findOne({ _id: new ObjectId(req.params.id) })
    if (!t) return res.status(404).json({ error: 'Task não encontrada.' })
    const aberta = await db.collection('office_decisions').findOne({ taskId: String(t._id), status: 'aberta' })
    if (aberta) return res.status(409).json({ error: 'Essa task está esperando uma decisão — responde antes de rodar.' })

    await mainDb.collection('nomade_tasks').updateOne({ _id: t._id }, {
      $set: { pedidoEm: new Date(), pedidoPor: req.user.email, updatedAt: new Date() },
      $unset: { workerLock: '', workerMaquina: '' }, // solta trava velha: o pedido tem prioridade
    })
    officeEvent('run_pedido', { task: t.title, por: req.user.email })
    const exec = await quemExecuta(t)
    res.json({
      ok: true,
      ...exec,
      aviso: !exec.dono ? null
        : exec.dono === String(req.user.email).toLowerCase()
          ? (exec.online ? null : 'Teu runner está offline — roda `nomade runner` na tua máquina.')
          : exec.online
            ? `Vai rodar na máquina de ${exec.dono.split('@')[0]} (${exec.maquina}).`
            : `${exec.dono.split('@')[0]} está com o runner offline — a task espera ele ligar.`,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// cancela o pedido (ainda não começou)
app.delete('/api/office/tarefas-agent/:id/rodar', officeAuth, async (req, res) => {
  try {
    await mainDb.collection('nomade_tasks').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $unset: { pedidoEm: '', pedidoPor: '', workerLock: '', workerMaquina: '' } }
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// auto: runner varre o board sozinho, ou só pega o que foi pedido no play
app.get('/api/office/runner-config', officeAuth, async (req, res) => {
  const d = await db.collection('office_config').findOne({ id: 'runner' }).catch(() => null)
  res.json({ auto: !!d?.auto })
})
app.patch('/api/office/runner-config', officeAuth, async (req, res) => {
  await db.collection('office_config').updateOne({ id: 'runner' },
    { $set: { auto: !!req.body.auto, por: req.user.email, em: new Date() } }, { upsert: true })
  const d = await db.collection('office_config').findOne({ id: 'runner' })
  res.json({ auto: !!d?.auto })
})


/* LOTE — pedir execução de várias de uma vez: seleção do kanban, uma coluna
   inteira ou o board todo.

   Duas coisas que o lote precisa acertar e o play unitário não:
   1) ORDEM. O runner pega por pedidoEm crescente. Se o lote inteiro levasse o
      mesmo timestamp, a ordem viraria sorteio — então cada uma ganha +1ms na
      ordem do board (coluna, posição). É a mesma ordem que o sócio vê na tela.
   2) O QUE FICOU DE FORA. Task travada em decisão ou já rodando não entra, e
      quem pediu tem que saber disso — 12 pedidas de 15 sem explicação é pior
      que erro. */
app.post('/api/office/fila/pedir', officeAuth, async (req, res) => {
  try {
    const filtro = { assignee: { $regex: '^agent:' }, archived: { $ne: true } }
    if (Array.isArray(req.body?.ids) && req.body.ids.length) {
      filtro._id = { $in: req.body.ids.slice(0, 200).map(id => { try { return new ObjectId(String(id)) } catch { return null } }).filter(Boolean) }
    } else if (req.body?.boardId) {
      filtro.boardId = String(req.body.boardId)
      if (req.body.coluna) filtro.status = String(req.body.coluna)
    } else {
      return res.status(400).json({ error: 'manda ids, boardId ou boardId+coluna' })
    }

    const tasks = await mainDb.collection('nomade_tasks').find(filtro)
      .sort({ boardId: 1, status: 1, position: 1 }).limit(200).toArray()
    if (!tasks.length) return res.json({ pedidas: 0, ignoradas: [] })

    // colunas finais variam por board — só descobre lendo os boards envolvidos
    const boards = await mainDb.collection('nomade_boards')
      .find({ _id: { $in: [...new Set(tasks.map(t => String(t.boardId)))].map(id => { try { return new ObjectId(id) } catch { return null } }).filter(Boolean) } })
      .toArray()
    const bmap = Object.fromEntries(boards.map(b => [String(b._id), b]))
    const abertas = await db.collection('office_decisions')
      .find({ taskId: { $in: tasks.map(t => t._id.toString()) }, status: 'aberta' }).toArray()
    const travadas = new Set(abertas.map(d => String(d.taskId)))
    const limite = new Date(Date.now() - LOCK_MIN * 60_000)

    const ignoradas = []
    const aPedir = []
    for (const t of tasks) {
      const col = bmap[String(t.boardId)]?.columns?.find(c => c.id === t.status)
      if (col && COLUNA_FINAL.test(col.name || col.id || '')) { ignoradas.push({ titulo: t.title, motivo: 'já concluída' }); continue }
      if (travadas.has(t._id.toString())) { ignoradas.push({ titulo: t.title, motivo: 'esperando decisão' }); continue }
      if (t.workerLock && new Date(t.workerLock) > limite) { ignoradas.push({ titulo: t.title, motivo: `já rodando em ${t.workerMaquina || 'outra máquina'}` }); continue }
      aPedir.push(t)
    }
    if (!aPedir.length) return res.json({ pedidas: 0, ignoradas })

    // base no futuro imediato: não briga com pedido unitário feito agora
    const base = Date.now()
    await mainDb.collection('nomade_tasks').bulkWrite(aPedir.map((t, i) => ({
      updateOne: {
        filter: { _id: t._id },
        update: {
          $set: { pedidoEm: new Date(base + i), pedidoPor: req.user.email, updatedAt: new Date() },
          $unset: { workerLock: '', workerMaquina: '' },
        },
      },
    })))
    officeEvent('run_pedido_lote', { quantas: aPedir.length, ignoradas: ignoradas.length, por: req.user.email })
    // pra onde foi cada uma: quem pediu precisa saber o que espera máquina alheia
    const eu = String(req.user.email).toLowerCase()
    const destinos = {}
    for (const t of aPedir) {
      const e = await quemExecuta(t)
      const chave = !e.dono ? 'qualquer runner' : e.dono === eu ? 'tua máquina' : `${e.dono.split('@')[0]}${e.online ? '' : ' (offline)'}`
      destinos[chave] = (destinos[chave] || 0) + 1
    }
    res.json({ pedidas: aPedir.length, ignoradas, destinos })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// cancela em lote o que ainda não começou
app.post('/api/office/fila/cancelar', officeAuth, async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 200)
      .map(id => { try { return new ObjectId(String(id)) } catch { return null } }).filter(Boolean)
    const filtro = ids.length ? { _id: { $in: ids } } : (req.body?.boardId ? { boardId: String(req.body.boardId) } : null)
    if (!filtro) return res.status(400).json({ error: 'manda ids ou boardId' })
    const r = await mainDb.collection('nomade_tasks').updateMany(
      { ...filtro, pedidoEm: { $exists: true } },
      { $unset: { pedidoEm: '', pedidoPor: '', workerLock: '', workerMaquina: '' } }
    )
    res.json({ canceladas: r.modifiedCount })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* ═══ CLAIM — o runner pede a próxima task ═══
   Mesmo mecanismo do worker do container (workerLock), mas pra máquina
   externa. Sem isto o PC e o Mac de alguém pegariam a mesma task. */
app.post('/api/office/fila/claim', officeAuth, async (req, res) => {
  try {
    const maquina = String(req.body?.maquina || '').slice(0, 80)
    if (!maquina) return res.status(400).json({ error: 'maquina obrigatória' })
    const limite = new Date(Date.now() - LOCK_MIN * 60_000)
    const livre = { $or: [{ workerLock: { $exists: false } }, { workerLock: { $lt: limite } }] }

    /* ═══ FILA POR DONO ═══════════════════════════════════════════════
       A task pertence a um sócio, e só a MÁQUINA DELE executa. É o que faz
       o multi-máquina funcionar: a Ana abre uma task pro Bruno, ela espera
       o runner do Bruno, e roda na máquina onde o repo e a assinatura dele
       estão. Sem isto o claim entregava pra quem pedisse primeiro — e quem
       não tem a pasta devolvia a task, que perdia o `pedidoEm` no caminho e
       sumia da fila sem ninguém executar.

       Sem dono = de todo mundo (é o comportamento de antes, preservado).
       O dono pode vir da TASK (`donoConta`) ou, na falta dela, do SQUAD —
       assim dá pra dizer "tudo do squad Produção roda na máquina do Bruno"
       sem carimbar card por card. */
    const meu = String(req.user.email || '').toLowerCase()
    const squadsDeOutros = await db.collection('squads')
      .find({ donoConta: { $nin: [null, '', meu] } }, { projection: { id: 1 } }).toArray().catch(() => [])
    const assigneesAlheios = squadsDeOutros.map(sq => `agent:${sq.id}`)
    const semDonoNaTask = { $or: [{ donoConta: { $exists: false } }, { donoConta: { $in: [null, ''] } }] }

    const doMeuTime = {
      $or: [
        { donoConta: meu },                                    // carimbada pra mim: vence até o dono do squad
        { $and: [semDonoNaTask, { assignee: { $nin: assigneesAlheios } }] }, // sem dono e o squad não é de outro
      ],
    }

    /* ═══ FILA POR MÁQUINA ════════════════════════════════════════════
       Eixo INDEPENDENTE do dono, e é de propósito: dono é PESSOA (decide qual
       assinatura executa), máquina é ONDE. O mesmo computador pode ter dois
       sócios logados, e o mesmo sócio pode ter dois computadores — misturar os
       dois num campo só quebra num dos dois casos.

       Antes disto o `maquina` do corpo era só carimbo do lock: dois
       computadores do mesmo sócio competiam e levava quem pollasse primeiro.

       Precedência igual à do dono: TASK > SQUAD > BOARD > qualquer uma.
       O board entra porque `pastaNoRunner` é um caminho só: um board com pasta
       já está de fato preso a um sistema de arquivos, e sem isto o runner
       errado pegava a task e devolvia em silêncio.

       Runner velho não manda `machineId`. Nesse caso ele só recebe o que não
       está preso a máquina nenhuma, em vez de roubar trabalho carimbado. */
    const machineId = String(req.body?.machineId || '').slice(0, 64)
    const deOutraMaquina = { $nin: [null, '', machineId] }
    const [squadsAlhures, boardsAlhures, squadsAqui] = await Promise.all([
      db.collection('squads').find({ maquinaId: deOutraMaquina }, { projection: { id: 1 } }).toArray().catch(() => []),
      mainDb.collection('nomade_boards').find({ maquinaId: deOutraMaquina }, { projection: { _id: 1 } }).toArray().catch(() => []),
      machineId
        ? db.collection('squads').find({ maquinaId: machineId }, { projection: { id: 1 } }).toArray().catch(() => [])
        : Promise.resolve([]),
    ])
    const semMaquinaNaTask = { $or: [{ maquinaId: { $exists: false } }, { maquinaId: { $in: [null, ''] } }] }
    const naoPresoAOutra = {
      $and: [
        semMaquinaNaTask,
        { assignee: { $nin: squadsAlhures.map(sq => `agent:${sq.id}`) } },
        { boardId: { $nin: boardsAlhures.map(b => String(b._id)) } },
      ],
    }
    const nestaMaquina = machineId
      ? {
        $or: [
          { maquinaId: machineId },                                                        // task carimbada: vence tudo
          { $and: [semMaquinaNaTask, { assignee: { $in: squadsAqui.map(sq => `agent:${sq.id}`) } }] }, // squad daqui vence o board
          naoPresoAOutra,                                                                  // nada preso: qualquer runner
        ],
      }
      : naoPresoAOutra

    const base = {
      assignee: { $regex: '^agent:' }, archived: { $ne: true },
      ...livre,
      $and: [doMeuTime, nestaMaquina],
    }
    const marcar = { $set: { workerLock: new Date(), workerMaquina: maquina, workerMachineId: machineId || null, rodandoPor: meu }, $unset: { pedidoEm: '', pedidoPor: '' } }

    // 1º o que alguém pediu no play (mais antigo primeiro: quem pediu antes roda antes)
    let r = await mainDb.collection('nomade_tasks').findOneAndUpdate(
      { ...base, pedidoEm: { $exists: true } }, marcar,
      { sort: { pedidoEm: 1 }, returnDocument: 'after' }
    )
    let task = r?.value || r

    // 2º varredura do board — só se ligaram o automático. Desligado (padrão), o
    // runner é on-demand de verdade: só roda o que foi mandado rodar.
    if (!task?._id) {
      const cfg = await db.collection('office_config').findOne({ id: 'runner' }).catch(() => null)
      if (!cfg?.auto) return res.json({ task: null })
      r = await mainDb.collection('nomade_tasks').findOneAndUpdate(
        base, marcar, { sort: { boardId: 1, status: 1, position: 1 }, returnDocument: 'after' }
      )
      task = r?.value || r
    }
    if (!task?._id) return res.json({ task: null })

    const board = await mainDb.collection('nomade_boards').findOne({ _id: new ObjectId(String(task.boardId)) }).catch(() => null)
    const col = board?.columns?.find(c => c.id === task.status)
    // já concluída: devolve a trava e não entrega
    if (col && COLUNA_FINAL.test(col.name || col.id || '')) {
      await mainDb.collection('nomade_tasks').updateOne({ _id: task._id }, { $unset: { workerLock: '', workerMaquina: '' } })
      return res.json({ task: null })
    }
    // pergunta em aberto: rodar de novo só repetiria a dúvida
    const aberta = await db.collection('office_decisions').findOne({ taskId: String(task._id), status: 'aberta' })
    if (aberta) {
      await mainDb.collection('nomade_tasks').updateOne({ _id: task._id }, { $unset: { workerLock: '', workerMaquina: '' } })
      return res.json({ task: null })
    }

    const squad = await db.collection('squads').findOne({ id: String(task.assignee).slice(6) })
    const decs = await db.collection('office_decisions')
      .find({ taskId: String(task._id), status: 'resolvida' }).sort({ createdAt: 1 }).limit(5).toArray()

    res.json({
      task: {
        id: task._id.toString(),
        titulo: task.title,
        detalhe: task.description || '',
        boardId: String(task.boardId || ''),
        // o clone vive NO RUNNER: a pasta é do board, não da máquina de quem clicou
        pasta: board?.pastaNoRunner || null,
        conversaId: task.conversaId || null,
        progresso: task.progresso || null,
        decisoes: decs.map(d => ({ pergunta: d.pergunta, tipo: d.tipo || null, resolucao: d.resolucao || '' })),
        /* CRITÉRIOS DE ACEITE — o que precisa ser verdade pra task estar feita.
           Sem isto "entregue" era só a palavra do agent: ele fechava o card e
           ninguém sabia se prestava sem abrir. Com critério, o `entregar` exige
           que ele diga COMO atendeu cada um, e isso fica registrado na entrega. */
        criterios: Array.isArray(task.criterios) ? task.criterios.slice(0, 12) : [],
        dono: task.donoConta || squad?.donoConta || null, // qual assinatura roda: decide a conta Claude local
      },
      /* O runner precisa do SQUAD INTEIRO pra trabalhar:
         · instrucoes → o cérebro do agent (sem isto ele cai no systemPrompt
           do agent velho e ignora tudo que foi escrito pra ele)
         · modelo     → decide o motor (claude-* = Agent SDK · zai:/gemini:/
           ollama: = motor agnóstico, sem precisar de conta Claude na máquina)
         · dept       → entra no prompt de identidade */
      squad: squad ? {
        id: squad.id, name: squad.name, dept: squad.dept || null,
        agents: squad.agents || [], code: squad.code || '',
        autonomia: squad.autonomia ?? 0,
        instrucoes: squad.instrucoes || '',
        modelo: squad.modelo || '',
        donoConta: squad.donoConta || null,
      } : null,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// runner desistiu (sem conta disponível, pasta não configurada): devolve a task
app.post('/api/office/fila/soltar', officeAuth, async (req, res) => {
  try {
    if (!req.body?.taskId) return res.status(400).json({ error: 'taskId obrigatório' })
    await mainDb.collection('nomade_tasks').updateOne(
      { _id: new ObjectId(String(req.body.taskId)) },
      { $unset: { workerLock: '', workerMaquina: '' } }
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* ═══ CONTAS CLAUDE DO RUNNER ═══
   Cada sócio loga a SUA assinatura uma vez, pelo terminal do PC, numa pasta
   própria (CLAUDE_CONFIG_DIR). O runner descobre as pastas e reporta aqui;
   a web só dá nome e diz de quem é. A credencial nunca sai da máquina. */
app.get('/api/office/contas', officeAuth, async (req, res) => {
  try {
    res.json(await db.collection('office_contas').find({}).sort({ label: 1 }).toArray())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// o runner publica o que ENCONTROU na máquina (pasta existe e tem credencial)
app.post('/api/office/contas/sync', officeAuth, async (req, res) => {
  try {
    const maquina = String(req.body?.maquina || '').slice(0, 80)
    const achadas = (Array.isArray(req.body?.contas) ? req.body.contas : []).slice(0, 12)
    for (const c of achadas) {
      const id = String(c.id || '').trim().slice(0, 40)
      if (!id) continue
      await db.collection('office_contas').updateOne(
        { id },
        {
          $set: { maquina, configDir: String(c.configDir || '').slice(0, 300), logada: !!c.logada, vistaEm: new Date() },
          $setOnInsert: { id, label: id, dono: null, criada: new Date() },
        },
        { upsert: true }
      )
    }
    // pasta que sumiu da máquina não pode continuar aparecendo como disponível
    await db.collection('office_contas').updateOne(
      { maquina, id: { $nin: achadas.map(c => String(c.id || '')) } },
      { $set: { logada: false } }
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/office/contas/:id', officeAuth, async (req, res) => {
  try {
    const set = {}
    if (req.body.label !== undefined) set.label = String(req.body.label).slice(0, 60)
    if (req.body.dono !== undefined) set.dono = req.body.dono ? String(req.body.dono).slice(0, 120) : null
    if (!Object.keys(set).length) return res.status(400).json({ error: 'nada pra mudar' })
    await db.collection('office_contas').updateOne({ id: req.params.id }, { $set: set })
    res.json(await db.collection('office_contas').findOne({ id: req.params.id }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})



/* RUNNERS — as máquinas que executam, vistas por QUALQUER sócio.
   /api/machines é por dono (cada um vê as suas). O runner é da empresa: quem
   olha o kanban precisa saber se ele está de pé, mesmo que quem logou nele
   tenha sido outra pessoa. Sem isto, pedir execução com o runner desligado
   era pedir pro vazio — nada acontecia e nada explicava. */
app.get('/api/office/runners', officeAuth, async (req, res) => {
  try {
    const rows = await db.collection('machines').find({ servidor: true }).toArray()
    const agora = Date.now()

    /* DEDUPE POR MÁQUINA — o registro é upsert por {email, machineId}, então
       dois sócios logando no MESMO computador criam dois documentos e a tela
       mostra a mesma máquina duas vezes. Aqui uma máquina é uma máquina:
       agrupa por machineId e fica com o registro mais recente, somando as
       contas Claude que cada sócio configurou nela. */
    const porMaquina = new Map()
    for (const m of rows) {
      const atual = porMaquina.get(m.machineId)
      if (!atual || new Date(m.lastSeen) > new Date(atual.lastSeen)) {
        porMaquina.set(m.machineId, { ...m, donos: new Set([...(atual?.donos || []), m.dono].filter(Boolean)), contasTotal: (atual?.contasTotal || 0) + (m.contas || 0) })
      } else {
        if (m.dono) atual.donos.add(m.dono) // registro antigo sem dono não vira entrada vazia
        atual.contasTotal = (atual.contasTotal || 0) + (m.contas || 0)
      }
    }

    res.json([...porMaquina.values()].map(m => {
      const idadeMs = agora - new Date(m.lastSeen).getTime()
      return {
        machineId: m.machineId,
        nome: m.name,
        plataforma: m.platform,
        dono: m.dono || null,
        donos: [...(m.donos || [])],       // mais de um sócio usa esta máquina
        contas: m.contasTotal ?? m.contas ?? 0,
        modelos: (m.models || []).length,
        /* null = CLI velho, que ainda não reporta. A tela mostra "?" em vez de
           acusar falta de Claude numa máquina que pode estar perfeita. */
        claude: m.claude || null,
        /* Consegue rodar squad em Claude? Basta UM login: o padrão da máquina
           ou uma das pastas por sócio. Squad em GLM/Gemini/Ollama roda sem
           nenhum dos dois, então isto é aviso, não impedimento. */
        rodaClaude: m.claude ? !!(m.claude.login || (m.contasTotal ?? m.contas ?? 0) > 0) : null,
        // o runner bate a cada 60s; 90s de folga cobre uma perdida
        online: idadeMs < 90_000,
        // registro velho não é runner: é lixo de instalação antiga. A tela
        // precisa distinguir "desligada agora" de "nunca mais voltou".
        diasSemVer: Math.floor(idadeMs / 86_400_000),
        morta: idadeMs > 7 * 86_400_000,
        visto: m.lastSeen,
        /* Modo de energia. Dois campos porque são duas coisas: `modoDesejado` é
           o que o sócio pediu na tela, `modoAtual` é o que a máquina confirmou
           ter aplicado. Diferentes = ainda não bateu o heartbeat, ou o runner
           está fechado — e aí não vai aplicar nunca, o que a tela precisa dizer. */
        modoDesejado: m.modoDesejado || null,
        modoAtual: m.modoAtual || null,
      }
    }).sort((a, b) => Number(b.online) - Number(a.online) || a.diasSemVer - b.diasSemVer))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* Remove o registro de uma máquina. Não desinstala nada — só tira da lista.
   Se ela voltar a rodar o runner, se registra de novo sozinha. */
app.delete('/api/office/runners/:machineId', officeAuth, async (req, res) => {
  try {
    const r = await db.collection('machines').deleteMany({ machineId: String(req.params.machineId) })
    officeEvent('maquina_removida', { machineId: req.params.machineId, por: req.user.email })
    res.json({ ok: true, removidos: r.deletedCount })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* MODO DE ENERGIA — o sócio escolhe aqui, a máquina aplica no heartbeat dela
   (até 60s). Este processo NÃO executa nada e não fala com máquina nenhuma:
   grava a intenção e devolve no `/api/machines/register`, que é a máquina
   perguntando. O nome do modo é de lista fechada; a tradução pra comando local
   mora no CLI (`cli/lib/modos.mjs`), nunca aqui — assim o serviço não vira
   canal de execução remota no computador de um sócio.
   `null`/vazio = para de forçar modo, deixa como a máquina estiver.
   updateMany porque a lista da tela é por MÁQUINA: dois sócios logados no
   mesmo computador têm dois registros, e o modo é do computador. */
app.patch('/api/office/runners/:machineId/modo', officeAuth, async (req, res) => {
  try {
    const bruto = req.body?.modo
    const modo = bruto == null || bruto === '' ? null : String(bruto)
    if (modo !== null && !MODOS.includes(modo)) {
      return res.status(400).json({ error: `modo inválido — use ${MODOS.join(', ')} ou vazio` })
    }
    const r = await db.collection('machines').updateMany(
      { machineId: String(req.params.machineId) },
      { $set: { modoDesejado: modo, modoPor: req.user.email, modoEm: new Date() } }
    )
    if (!r.matchedCount) return res.status(404).json({ error: 'Máquina não encontrada.' })
    officeEvent('maquina_modo', { machineId: req.params.machineId, modo, por: req.user.email })
    res.json({ ok: true, modo })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* Boards pro seletor de repositório. Devolve TODOS (interno e de cliente),
   com quantas tasks de agent cada um tem — quem escolhe é o sócio. Gerar a
   lista sozinho enchia a tela de board que nunca vai rodar nada (um por
   pessoa, por exemplo). */
app.get('/api/office/runner-boards', officeAuth, async (req, res) => {
  try {
    const boards = await mainDb.collection('nomade_boards').find({}).toArray()
    const contagem = await mainDb.collection('nomade_tasks').aggregate([
      { $match: { assignee: { $regex: '^agent:' }, archived: { $ne: true } } },
      { $group: { _id: '$boardId', n: { $sum: 1 } } },
    ]).toArray()
    const cmap = Object.fromEntries(contagem.map(c => [String(c._id), c.n]))
    res.json(boards.map(b => ({
      id: String(b._id),
      nome: b.name,
      cliente: !!b.clientId,
      tasks: cmap[String(b._id)] || 0,
      pasta: b.pastaNoRunner || null,
      maquinaId: b.maquinaId || null,
    })).sort((a, b) => b.tasks - a.tasks || String(a.nome).localeCompare(String(b.nome))))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* Pasta do clone NO RUNNER, por board (projeto = cliente = board).

   Aceita `maquinaId` junto porque as duas coisas são o mesmo fato: um caminho
   existe num sistema de arquivos só. Quem roda `nomade setpath` ESTÁ na
   máquina, então o CLI manda o id dele e o board passa a ser daquela máquina —
   sem isso o runner errado pegava a task e devolvia em silêncio. Mandar
   `maquinaId: ""` desamarra e volta a valer pra qualquer runner. */
app.patch('/api/office/boards/:id/pasta', officeAuth, async (req, res) => {
  try {
    const pasta = String(req.body?.pasta || '').trim().slice(0, 400)
    const set = { pastaNoRunner: pasta || null, pastaPor: req.user.email, pastaEm: new Date() }
    if (req.body?.maquinaId !== undefined) {
      const mid = String(req.body.maquinaId || '').trim().slice(0, 64)
      if (mid) {
        const existe = await db.collection('machines').findOne({ machineId: mid }, { projection: { _id: 1 } })
        if (!existe) return res.status(400).json({ error: 'máquina desconhecida — ela precisa ter rodado o runner ao menos uma vez.' })
      }
      set.maquinaId = mid || null
    }
    // pasta limpa não deixa a amarra de máquina pendurada sozinha
    if (!pasta && req.body?.maquinaId === undefined) set.maquinaId = null
    await mainDb.collection('nomade_boards').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: set }
    )
    res.json({ ok: true, pasta: pasta || null })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ═══ WORKER DO SERVIDOR — a fila anda sem máquina aberta ═══
// Trabalha SÓ em task de squad marcado "roda no servidor" (default off) e
// usa as CHAVES DA EQUIPE — a assinatura do Claude é da máquina do sócio e
// não existe aqui. Etapa que precisa mexer em arquivo continua sendo do app.
const WORKER_MS = Number(process.env.WORKER_INTERVALO_MS || 90_000)
const WORKER_MAX_POR_CICLO = 2      // teto de custo por rodada
const LOCK_MIN = 20                 // task travada há mais que isso volta pra fila
let workerRodando = false

async function pegarTarefaDoWorker() {
  const squads = await db.collection('squads').find({ servidor: true }).toArray()
  if (!squads.length) return null
  const ids = squads.map(s => `agent:${s.id}`)
  const limite = new Date(Date.now() - LOCK_MIN * 60_000)

  // claim atômico: dois workers (ou dois restarts) não pegam a mesma task
  const r = await mainDb.collection('nomade_tasks').findOneAndUpdate(
    {
      assignee: { $in: ids },
      archived: { $ne: true },
      $or: [{ workerLock: { $exists: false } }, { workerLock: { $lt: limite } }],
      status: { $nin: ['done'] },
    },
    { $set: { workerLock: new Date() } },
    { sort: { boardId: 1, status: 1, position: 1 }, returnDocument: 'after' }
  )
  const task = r?.value || r
  if (!task?._id) return null

  // a coluna final varia por board: se já está concluída, ignora
  const board = await mainDb.collection('nomade_boards').findOne({ _id: new ObjectId(String(task.boardId)) })
  const col = board?.columns?.find(c => c.id === task.status)
  if (col && /done|final|conclu|feito/i.test(col.name || col.id || '')) return null

  const squad = squads.find(s => `agent:${s.id}` === task.assignee)
  return { task, squad, board }
}

async function rodarTarefaNoServidor({ task, squad, board }) {
  const keys = await getKeys()
  const t0 = Date.now()
  officeEvent('run_start', { squad: squad.name, origem: 'servidor', task: String(task.title).slice(0, 140) })

  // move pra coluna de trabalho (quem olha o board vê que já tem alguém nela)
  const cols = [...(board?.columns || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const emAndamento = cols.find(c => /doing|fazendo|working|progress|dev/i.test(c.name || ''))
  if (emAndamento) await mainDb.collection('nomade_tasks').updateOne({ _id: task._id }, { $set: { status: emAndamento.id, updatedAt: new Date() } })

  /* Retomada: mesmo contrato do runner da máquina. Task que parou no meio
     (limite de janela, decisão, queda) continua da etapa seguinte em vez de
     refazer — e queimar token — tudo o que já tinha sido executado. */
  const agentsDoSquad = squad.agents || []
  const jaFeitas = Math.min(Math.max(0, Number(task.progresso?.etapa) || 0), agentsDoSquad.length)
  let context = jaFeitas > 0
    ? String(task.progresso?.contexto || '')
    : [task.title, task.description].filter(Boolean).join('\n\n')

  for (let idx = jaFeitas; idx < agentsDoSquad.length; idx++) {
    const agent = agentsDoSquad[idx]
    // etapa que precisa de arquivo/repo não roda aqui: isso é da máquina
    if (String(agent.model || '').startsWith('local/')) {
      await mainDb.collection('nomade_tasks').updateOne({ _id: task._id }, {
        $push: { comments: { id: `c_${Date.now()}`, author: 'Servidor', authorId: 'worker',
          text: `Parei: a etapa "${agent.name}" usa modelo local, que só existe na máquina. Roda essa task pelo Studio.`, createdAt: new Date() } },
        $set: { updatedAt: new Date(), workerLock: new Date(Date.now() + 6 * 3600_000) }, // não tenta de novo tão cedo
      })
      officeEvent('run_error', { squad: squad.name, origem: 'servidor', erro: 'etapa local' })
      return
    }

    const res = await executeAgent(agent, context, keys)
    if (res.status !== 'completed') {
      await avisarConversaDaTask(task, { estado: 'falha', detalhe: res.error, por: 'servidor' })
      await mainDb.collection('nomade_tasks').updateOne({ _id: task._id }, {
        $set: { status: cols[0]?.id || task.status, updatedAt: new Date() },
        $unset: { workerLock: '' },
        $push: { comments: { id: `c_${Date.now()}`, author: 'Servidor', authorId: 'worker',
          text: `Execução no servidor falhou na etapa "${agent.name}": ${String(res.error || '').slice(0, 400)}`, createdAt: new Date() } },
      })
      officeEvent('run_error', { squad: squad.name, origem: 'servidor', erro: String(res.error || '').slice(0, 200) })
      return
    }
    context = res.output

    // agent pediu decisão → para e devolve a task pra fila
    const pedido = String(res.output || '').match(/```decisao\s*([\s\S]*?)```/i)
    if (pedido) {
      try {
        const j = JSON.parse(pedido[1].trim())
        if (j?.pergunta) {
          await db.collection('office_decisions').insertOne({
            id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            agentId: null, conversaId: task.conversaId || null, taskId: String(task._id),
            agentName: squad.name, dept: null, projetoId: null,
            contexto: String(j.contexto || '').slice(0, 1500),
            pergunta: String(j.pergunta).slice(0, 300),
            opcoes: normOpcoes(j.opcoes),
            urgencia: URGENCIAS.includes(j.urgencia) ? j.urgencia : 'hoje',
            sugestao: String(j.sugestao || '').slice(0, 300),
            status: 'aberta', createdAt: new Date(),
          })
          officeEvent('decisao_aberta', { agentName: squad.name, pergunta: String(j.pergunta).slice(0, 120), urgencia: 'hoje' })
        }
      } catch { /* bloco inválido: segue como texto */ }
      await mainDb.collection('nomade_tasks').updateOne({ _id: task._id }, {
        $set: { status: cols[0]?.id || task.status, updatedAt: new Date() },
        $unset: { workerLock: '' },
      })
      return
    }

    // etapa fechada: ponto de retomada gravado antes de seguir pra próxima
    await mainDb.collection('nomade_tasks').updateOne({ _id: task._id }, {
      $set: {
        progresso: { etapa: idx + 1, de: agentsDoSquad.length, contexto: String(context || '').slice(0, 8000), em: new Date() },
        updatedAt: new Date(),
      },
    })
  }

  // terminou: fecha (ou pede aprovação, se autonomia 0)
  const feita = cols.find(c => /done|final|conclu|feito/i.test(c.name || '') || c.id === 'done')
  const aut = Math.min(3, Math.max(0, Number(squad.autonomia) || 0))
  await mainDb.collection('nomade_tasks').updateOne({ _id: task._id }, {
    $set: { status: aut === 0 ? (emAndamento?.id || task.status) : (feita?.id || task.status), updatedAt: new Date() },
    $unset: { workerLock: '', progresso: '' }, // terminou: não tem mais de onde retomar
    $push: { comments: { id: `c_${Date.now()}`, author: squad.name, authorId: 'worker',
      text: String(context || '').slice(0, 4000), createdAt: new Date() } },
  })
  await avisarConversaDaTask(task, { estado: 'feita', detalhe: String(context || '').slice(0, 600), por: 'servidor' })
  if (aut === 0) {
    await db.collection('office_decisions').insertOne({
      id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId: null, conversaId: task.conversaId || null, taskId: String(task._id),
      agentName: squad.name, dept: null, projetoId: null,
      contexto: `Entrega do agent (rodou no servidor) na task "${task.title}":\n${String(context || '').slice(0, 800)}`,
      pergunta: `Aprovar a entrega de "${task.title}"?`,
      opcoes: [{ label: 'Aprovar e fechar', valor: 'aprovado' }, { label: 'Refazer', valor: 'refazer' }],
      urgencia: 'hoje', sugestao: '', status: 'aberta', createdAt: new Date(),
    })
  }
  officeEvent('run_done', { squad: squad.name, origem: 'servidor', duracao: Date.now() - t0 })
}

async function cicloWorker() {
  if (workerRodando) return
  workerRodando = true
  try {
    const cfg = await getGatilhos()
    if (cfg.leadTriagem) await gatilhoLeads().catch(err => console.error('gatilho lead:', err.message))
    if (cfg.rotinaDiaria) await gatilhoRotina(cfg).catch(err => console.error('rotina:', err.message))

    for (let i = 0; i < WORKER_MAX_POR_CICLO; i++) {
      const alvo = await pegarTarefaDoWorker()
      if (!alvo) break
      await rodarTarefaNoServidor(alvo).catch(err => console.error('worker:', err.message))
    }
  } catch (err) {
    console.error('ciclo do worker:', err.message)
  } finally {
    workerRodando = false
  }
}

// ═══ Chat — o sócio fala com o ORQUESTRADOR (o cérebro da empresa) ═══
// Objetivo em linguagem natural → resposta em streaming (SSE) → tarefas
// viram CARDS no kanban (nomade_tasks) + ambiguidades viram decisões.
// Provider trocável por env: ORQUESTRADOR_PROVIDER ∈ anthropic|openai|glm.

const ORQ_PROVIDER = (process.env.ORQUESTRADOR_PROVIDER || 'anthropic').toLowerCase()
// o modelo da casa: PatricJ no Ollama (modelo/README.md). Um modelo pra todas
// as empresas — o que é de cada uma mora na memória, nunca nos pesos.
const MODELO_LOCAL = process.env.OLLAMA_TEXT_MODEL || 'patricj'
const ORQ_MODEL = process.env.ORQUESTRADOR_MODEL ||
  (ORQ_PROVIDER === 'glm' ? 'glm-4.6' : ORQ_PROVIDER === 'openai' ? 'gpt-5-mini' : ORQ_PROVIDER === 'ollama' ? MODELO_LOCAL : 'claude-sonnet-5')

// opções que o sócio pode escolher na UI do chat (troca em runtime, salva no Mongo)
// Todos os provedores de lib/provedores.js. O Ollama só aparece com OLLAMA_URL:
// sem ele a opção não teria pra onde ir.
const ORQ_OPTIONS = [
  ...PROVEDORES.map(p => ({ provider: p.id, label: `${p.nome} · ${p.produto}`, models: p.modelos })),
  ...(process.env.OLLAMA_URL ? [{ provider: 'ollama', label: 'Local (Ollama)', models: [MODELO_LOCAL] }] : []),
]
// opções com o que está conectado agora (o seletor esmaece quem não tem chave)
async function orqOptions() {
  const keys = await getKeys()
  return ORQ_OPTIONS.map(o => ({ ...o, conectado: o.provider === 'ollama' || !!keys[o.provider] }))
}

// Chaves de API da EQUIPE: quem conecta uma vez, conecta pra todos —
// o orquestrador usa, os squads usam e o app da máquina puxa no login
// (ninguém mais precisa colar chave em cada máquina).
async function getKeys() {
  let saved = {}
  try { saved = (await db.collection('office_config').findOne({ id: 'keys' })) || {} } catch { /* sem banco */ }
  return Object.fromEntries(PROVEDORES.map(p => [p.id, saved[p.id] || process.env[p.env] || '']))
}

async function getOrqConfig() {
  try {
    const doc = await db.collection('office_config').findOne({ id: 'orq' })
    if (doc?.provider) return { provider: doc.provider, model: doc.model }
  } catch { /* usa o env */ }
  return { provider: ORQ_PROVIDER, model: ORQ_MODEL }
}

const normOpcoes = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 6)
  .map(o => typeof o === 'string'
    ? { label: o.trim(), valor: o.trim() }
    : { label: String(o?.label || o?.valor || '').trim(), valor: String(o?.valor || o?.label || '').trim() })
  .filter(o => o.label)

async function orqSystemPrompt(conv) {
  let funcionarios = 'nenhum squad criado ainda'
  try {
    const squads = await db.collection('squads').find({}).toArray()
    if (squads.length) {
      const AUT = ['pede aprovação em tudo', 'autonomia baixa', 'autonomia média', 'roda solto']
      /* O QUE O SQUAD FAZ, não só como ele se chama. Sem isto o orquestrador
         não tem como saber que um squad entrega a peça inteira sozinho — e
         planeja como se fosse dar pra humano: briefing, storyboard, revisão,
         quatro decisões. Aconteceu de verdade com o Motion em 27/ago. */
      funcionarios = squads.map(s => {
        const oQueFaz = String(s.instrucoes || '').trim().split('\n')[0].slice(0, 160)
        return `- ${s.name}${s.dept ? ` [${s.dept}]` : ''} · ${AUT[Math.min(3, Math.max(0, Number(s.autonomia) || 0))]}` +
          (oQueFaz ? `\n    ${oQueFaz}` : `: ${(s.agents || []).map(a => `${a.name} (${a.model || 'claude'})`).join(', ') || 'sem agents'}`)
      }).join('\n')
    }
  } catch { /* segue sem a lista */ }
  // clientes (= projetos) e o que está aberto no kanban
  let carteira = 'nenhum cliente cadastrado ainda'
  let kanban = ''
  try {
    const clientes = await mainDb.collection('nomade_clients').find({}).limit(60).toArray()
    const tasks = await mainDb.collection('nomade_tasks')
      .find({ archived: { $ne: true }, status: { $ne: 'done' } },
        { projection: { title: 1, description: 1, status: 1, assignee: 1, clientEmail: 1 } })
      .sort({ updatedAt: -1 }).limit(40).toArray()

    /* NOTAS DO CLIENTE — o campo tem o combinado que não está escrito em mais
       lugar nenhum, e até aqui o orquestrador via só nome+segmento+plano. Era
       por isso que ele criava card genérico: com essa entrada, não havia outra
       saída possível.
       Só entra a nota de quem tem trabalho ABERTO — senão 60 clientes × 4000
       chars viram o prompt inteiro, e o resto do contexto some. */
    const comTrabalho = new Set(tasks.map(t => (t.clientEmail || '').toLowerCase()).filter(Boolean))
    if (clientes.length) {
      carteira = clientes.map(c => {
        const linha = `- ${c.name}${c.segment ? ` (${c.segment})` : ''}${c.plan ? ` · ${c.plan}` : ''} — ${c.status || 'active'}`
        const ativo = c.email && comTrabalho.has(c.email.toLowerCase())
        const nota = ativo && c.notes?.trim()
          ? `\n    combinado: ${c.notes.trim().replace(/\s+/g, ' ').slice(0, 300)}`
          : ''
        return linha + nota
      }).join('\n')
    }
    if (tasks.length) {
      kanban = '\nTarefas abertas no kanban (o id entre parênteses serve pra editar):\n' + tasks.map(t => {
        const cab = `- (${t._id}) [${t.status}] ${t.title}${t.clientEmail ? ` · ${t.clientEmail}` : ''}${String(t.assignee || '').startsWith('agent:') ? ' · com agent' : ''}`
        // a descrição é o que diz o que a task É — sem ela o plano se repete
        const det = String(t.description || '').trim().replace(/\s+/g, ' ')
        return det ? `${cab}\n    ${det.slice(0, 160)}${det.length > 160 ? '…' : ''}` : cab
      }).join('\n')
    }
  } catch { /* db principal fora — segue sem a carteira */ }

  // mesma fonte do endpoint /api/office/escopos e das ferramentas: se estas
  // três listas divergirem, a grafia suja volta pelo caminho que ficou aberto
  const escoposDoPrompt = (await escoposValidos().catch(() => []))
    .map(e => `- ${e.rotulo}${e.tipo === 'cliente' ? ' (cliente)' : ''}`).join('\n') || '(sem escopos cadastrados)'

  // Documento colado pelo sócio = FONTE DA VERDADE desta conversa. Sem isso,
  // depois de alguns turnos ele saía do doc e inventava stack (caso real: o
  // doc dizia Mongo/Mongoose e ele criou task de Postgres/Prisma).
  let anexos = ''
  if (conv?.id) {
    try {
      const lista = await db.collection('office_anexos').find({ conversaId: conv.id }).sort({ ts: 1 }).limit(5).toArray()
      if (lista.length) {
        anexos = '\n\nANEXOS DESTA CONVERSA (material de apoio temporário — usa como referência, some em alguns dias):\n' +
          lista.map(a => `--- ${a.nome} ---\n${String(a.conteudo).slice(0, 12000)}`).join('\n\n')
      }
    } catch { /* sem anexo, segue */ }
  }

  const briefing = conv?.briefing
    ? '\n\nDOCUMENTO DE REFERÊNCIA DESTA CONVERSA (fonte da verdade — NÃO contradiga, NÃO troque stack nem escopo por conta própria):\n"""\n' + String(conv.briefing).slice(0, 9000) + '\n"""'
    : ''

  /* ═══ BLOCOS ORDENADOS POR VOLATILIDADE ═══════════════════════════════
     Cache de prompt é PREFIXO: um byte que muda invalida tudo daí pra frente.
     Antes isto era uma string plana com as ~900 tokens de regra (100% estáveis)
     depois do kanban (que muda a cada card) — a pior ordem possível: mesmo com
     cache ligado, quase nunca acertaria.

     Agora:
       A  identidade + regras   → idêntico em TODA conversa de TODO sócio · cache
       B  briefing + anexos     → estável dentro desta conversa            · cache
       C  squads + carteira     → muda quando a casa muda
       D  memórias (o caller)   → muda a cada pergunta
  */
  const REGRAS = [
    `Tu és o ORQUESTRADOR da ${EMPRESA.nome} — quem transforma objetivo de sócio em trabalho pros agents.`,
    EMPRESA.descricao ? `O que a ${EMPRESA.nome} faz: ${EMPRESA.descricao}` : `A ${EMPRESA.nome} é tocada pelos sócios; os agents fazem o trabalho operacional.`,
    'Departamentos (usa exatamente estes ids): triagem, diagnostico, comercial, producao, conteudo, suporte.',
    '',
    '',
    'Regras:',
    '- Responde ao sócio em português, direto e curto. Sem enrolação.',
    '- Quando o objetivo implicar trabalho executável, TERMINA a resposta com um bloco ```json neste formato:',
    '{"tarefas":[{"dept":"comercial","resumo":"título curto da task","detalhe":"instrução completa pro squad","squad":"nome exato do squad responsável","cliente":"nome do cliente, se for de um"}],"decisoes":[{"pergunta":"...","contexto":"...","dept":"...","urgencia":"urgente|hoje|andamento|afazer","opcoes":["opção A","opção B"],"sugestao":"o caminho que tu recomenda"}]}',
    '- FIDELIDADE AO DOCUMENTO: se existe documento de referência acima, ELE manda. Stack, escopo e fases saem dele. Se o doc não define algo (ex.: qual API de WhatsApp), tu NÃO escolhe sozinho — levanta DECISÃO. Nunca troca tecnologia citada no doc por outra que tu prefere.',
    '- CONTINUAÇÃO: quando o turno for retomada (decisão resolvida ou "continua daí"), NÃO replaneja do zero nem repete tarefa já criada — entrega só o que falta a partir do kanban acima.',
    '- AUTONOMIA: squad com "pede aprovação em tudo" tem cada entrega revisada por um sócio antes de fechar — considera isso ao prometer prazo. Squad "roda solto" fecha sozinho.',
    '- LISTA as tarefas NA ORDEM DE EXECUÇÃO (a primeira é a que começa) — elas entram no kanban nessa sequência.',
    '- NÃO recria tarefa que já existe: confere a lista de tarefas abertas acima antes. Se o pedido é sobre algo já aberto, usa "atualizacoes" pra mexer no card existente em vez de criar outro.',
    '- Cada tarefa vira um CARD REAL no kanban, com o squad como responsável: "resumo" é o título e "detalhe" é o que o responsável precisa pra executar. Se a tarefa é de um CLIENTE, preenche "cliente" com o nome dele — o card vai pro kanban DAQUELE cliente; sem cliente, vai pro board interno Agents.',
    '- Pra IMAGEM (post, capa, mockup, ilustração), inclui no bloco "imagens":[{"prompt":"descrição visual rica em inglês ou português, com estilo, enquadramento e paleta","tamanho":"1024x1024|1536x1024|1024x1536"}] — só quando pedirem arte de verdade, não pra ilustrar resposta.',
    '- Se pedirem um FUNCIONÁRIO novo (ou tu perceber que falta um squad pro trabalho e o sócio topar), contrata pelo mesmo bloco: "squads":[{"nome":"Nome","dept":"triagem|diagnostico|comercial|producao|conteudo|suporte","agents":[{"nome":"SemEspaco","papel":"o que faz","modelo":"claude-sonnet-5","temperatura":0.7,"prompt":"system prompt completo"}]}] — pipeline em sequência, o resultado de um vira contexto do próximo. NÃO contrata sem o sócio pedir/topar.',
    '- Tu também EDITA o kanban: pra mexer em card que já existe, usa "atualizacoes":[{"task":"o id entre parênteses da lista acima (preferido) ou o título exato","coluna":"nome/id da coluna destino","prioridade":"low|medium|high|urgent","titulo":"novo título","detalhe":"nova descrição","comentario":"o que registrar no card"}] — só os campos que quiser mudar.',
    '- Tarefa = trabalho que um squad executa sozinho. Decisão = depende de julgamento de sócio; NUNCA adivinha no lugar deles.',
    '- TAMANHO DO PLANO: no máximo 8 tarefas por turno, e só a FASE que começa agora. Projeto grande se planeja por fase — termina a primeira, aí planeja a próxima. Board com 25 cards ninguém lê nem executa.',
    '- SQUAD COM DESCRIÇÃO ENTREGA INTEIRO. Se a lista acima diz o que um squad faz, ele executa sozinho de ponta a ponta — não quebra o trabalho dele em briefing/produção/revisão como se fosse pra humano, e não abre decisão perguntando coisa que ele mesmo vai resolver. UMA task com o pedido completo, e o squad devolve pronto (ou levanta a decisão dele se precisar).',
    '- Uma tarefa é UMA ENTREGA que dá pra pedir a um squad e receber pronta (ex.: "API de cadastro de profissionais, com validação e testes"). Passo miúdo (criar model, criar rota, escrever teste) NÃO vira card: vai no "detalhe" como lista dentro da mesma tarefa.',
    '- Se não houver trabalho a criar, não inclui bloco json nenhum.',
    '- MEMÓRIA: as memórias relevantes já vêm no contexto. Não inventes fatos fora delas.',
    '  Quando aparecer algo que merece ser lembrado (decisão tomada, preferência dos sócios, fato estável de um cliente/projeto, conclusão a que chegaram), inclui no MESMO bloco json a chave "memorias": [{"titulo":"curto","conteudo":"o fato","tags":["..."],"projeto":"um dos ESCOPOS listados abaixo, exato"}]. Só o que importa depois — nada de conversa fiada nem do que já está nas memórias acima.',
    '  ESCOPO da memória: "projeto" só aceita rótulo EXATO da lista de escopos abaixo. Fato que vale pra empresa toda (convenção, preferência dos sócios) vai SEM "projeto". Se for de um cliente/assunto que NÃO está na lista, manda "projeto":"__novo__" e "projetoSugerido":"o nome que tu daria" — não escolhe o mais parecido: memória no cliente errado é pior que memória sem dono.',
  ].join('\n')

  const docDaConversa = [briefing, anexos].filter(Boolean).join('')

  return [
    { text: REGRAS, cache: true },
    ...(docDaConversa ? [{ text: docDaConversa, cache: true }] : []),
    {
      text: [
        `Funcionários (squads) disponíveis:\n${funcionarios}`,
        '',
        `CLIENTES da casa (é o que a empresa chama de PROJETO — o trabalho de cada um vive no kanban):\n${carteira}${kanban}`,
        '',
        `ESCOPOS válidos para "projeto" em memórias (rótulo EXATO, ou "${ESCOPO_NOVO}" + "projetoSugerido" se não estiver aqui):\n${escoposDoPrompt}`,
      ].join('\n'),
    },
  ]
}

// Um plano com várias tarefas passa fácil de 1500 tokens — e cortar no meio
// do bloco json faz o orquestrador "engasgar": some o plano E nada é criado.
// Teto alto + CONTINUAÇÃO automática quando ele bate no limite.
const ORQ_MAX_TOKENS = 8000

/* Blocos → uma string só (provider que não tem cache de prefixo). */
const systemPlano = (blocos) => (Array.isArray(blocos) ? blocos : [{ text: String(blocos || '') }])
  .map(b => b.text).filter(Boolean).join('\n')

/* Blocos → formato Anthropic, marcando onde o cache corta. Bloco com
   `cache: true` vira breakpoint: o prefixo até ali é reusado nos turnos
   seguintes por ~10% do preço. */
const systemAnthropic = (blocos) => (Array.isArray(blocos) ? blocos : [{ text: String(blocos || '') }])
  .filter(b => b.text)
  .map(b => ({ type: 'text', text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) }))

async function orqStreamAnthropic(model, blocos, messages, onDelta, apiKey) {
  const system = systemAnthropic(blocos)
  const cli = apiKey ? new Anthropic({ apiKey }) : client
  let acumulado = ''
  let msgs = [...messages]

  for (let rodada = 0; rodada < 3; rodada++) {
    const stream = cli.messages.stream({ model, max_tokens: ORQ_MAX_TOKENS, system, messages: msgs })
    stream.on('text', onDelta)
    const final = await stream.finalMessage()
    const texto = final.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    acumulado += texto

    if (final.stop_reason !== 'max_tokens') return acumulado
    // cortou: manda continuar EXATAMENTE de onde parou (sem repetir nada)
    msgs = [
      ...messages,
      { role: 'assistant', content: acumulado },
      { role: 'user', content: 'Continua exatamente de onde parou, sem repetir o que já escreveu e sem recomeçar o bloco json. Só o restante.' },
    ]
  }
  return acumulado
}

/* provider → chamada. Um lugar só: a rotina agendada e o chat usam o mesmo. */
function orqStream(orq, keys, blocos, messages, onDelta) {
  const p = provedor(orq.provider)
  if (p && p.tipo !== 'anthropic') return orqStreamOpenAILike(p.base, keys[p.id], orq.model || p.modelos[0], blocos, messages, onDelta)
  // Ollama fala o dialeto OpenAI em /v1 e não pede chave (qualquer uma serve)
  if (orq.provider === 'ollama') {
    if (!OLLAMA_URL) throw new Error('OLLAMA_URL não configurado no servidor.')
    return orqStreamOpenAILike(`${OLLAMA_URL}/v1`, 'ollama', orq.model || MODELO_LOCAL, blocos, messages, onDelta)
  }
  return orqStreamAnthropic(orq.model || 'claude-sonnet-5', blocos, messages, onDelta, keys.anthropic)
}

async function orqStreamOpenAILike(base, key, model, blocos, messages, onDelta) {
  if (!key) throw new Error('Esse provedor ainda não tem chave. Conecta em Integrações.')
  const system = systemPlano(blocos) // GLM/OpenAI não têm breakpoint de prefixo
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      ...tetoTokens(base, ORQ_MAX_TOKENS),
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.error?.message || `Orquestrador HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const l of lines) {
      const t = l.trim()
      if (!t.startsWith('data:')) continue
      const p = t.slice(5).trim()
      if (p === '[DONE]') continue
      try {
        const j = JSON.parse(p)
        const d = j.choices?.[0]?.delta?.content
        if (d) { full += d; onDelta(d) }
      } catch { /* linha parcial */ }
    }
  }
  return full
}

// Fecha um JSON truncado (o modelo parou no meio): descarta o item pela
// metade e fecha os colchetes/chaves abertos. Melhor recuperar 3 tarefas
// de 4 do que perder o plano inteiro.
function fecharJson(txt) {
  let t = String(txt).trim()
  try { return JSON.parse(t), t } catch { /* segue pro conserto */ }
  // corta no último item completo
  const ultimoFim = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (ultimoFim === -1) return t
  t = t.slice(0, ultimoFim + 1)
  // fecha o que ficou aberto, na ordem inversa
  const pilha = []
  let dentroStr = false, escapou = false
  for (const ch of t) {
    if (escapou) { escapou = false; continue }
    if (ch === '\\') { escapou = true; continue }
    if (ch === '"') { dentroStr = !dentroStr; continue }
    if (dentroStr) continue
    if (ch === '{' || ch === '[') pilha.push(ch)
    else if (ch === '}' || ch === ']') pilha.pop()
  }
  while (pilha.length) t += pilha.pop() === '{' ? '}' : ']'
  return t
}

// Board onde as tarefas do orquestrador caem — é o KANBAN de verdade
// (nomade_boards/nomade_tasks do db principal), não uma fila paralela.
async function boardDoOrquestrador() {
  const col = mainDb.collection('nomade_boards')
  let board = await col.findOne({ clientId: { $in: [null, undefined] }, orquestrador: true })
  if (board) return board
  // board com nome de agents já criado à mão? adota
  board = await col.findOne({ clientId: { $in: [null, undefined] }, name: { $regex: /^(agents|orquestrador)$/i } })
  if (board) {
    await col.updateOne({ _id: board._id }, { $set: { orquestrador: true } })
    return board
  }
  // nenhum board interno ainda: cria o da empresa com as colunas padrão
  const doc = {
    name: 'Agents',
    description: 'Trabalho que o orquestrador distribui pros squads',
    clientId: null,
    orquestrador: true,
    template: 'padrao',
    columns: [
      { id: 'backlog', name: 'Backlog', color: '#64748b', position: 0 },
      { id: 'todo', name: 'A fazer', color: '#8b5cf6', position: 1 },
      { id: 'doing', name: 'Fazendo', color: '#0077B6', position: 2 },
      { id: 'done', name: 'Feito', color: '#00A896', position: 3 },
    ],
    members: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const r = await col.insertOne(doc)
  return { _id: r.insertedId, ...doc }
}

// Board DO CLIENTE — cada cliente tem o kanban dele (funil de cliente).
// Mesma regra do server principal: um board por clientId; cria se faltar.
async function boardDoCliente(cliente) {
  const col = mainDb.collection('nomade_boards')
  let board = await col.findOne({ clientId: cliente._id })
  if (board) return board
  const doc = {
    name: cliente.name || 'Cliente',
    description: '',
    clientId: cliente._id,
    template: 'cliente',
    columns: [
      { id: 'on-radar', name: 'On Radar', color: '#64748b', position: 0 },
      { id: 'away-radar', name: 'Away Radar', color: '#94a3b8', position: 1 },
      { id: 'understanding', name: 'Understanding', color: '#8b5cf6', position: 2 },
      { id: 'meeting', name: 'Meeting', color: '#c8a040', position: 3 },
      { id: 'sending-budget', name: 'Sending Budget', color: '#d97706', position: 4 },
      { id: 'after-payment', name: 'After Payment', color: '#00A896', position: 5 },
      { id: 'working', name: 'Working', color: '#0077B6', position: 6 },
      { id: 'done', name: 'Finals', color: '#059669', position: 7 },
      { id: 'support', name: 'Support', color: '#06b6d4', position: 8 },
    ],
    members: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  try {
    const r = await col.insertOne(doc)
    return { _id: r.insertedId, ...doc }
  } catch (e) {
    if (e.code !== 11000) throw e // corrida: o índice único barrou — relê o vencedor
    return col.findOne({ clientId: cliente._id })
  }
}

// Coluna de entrada DO BOARD escolhido. Ids de coluna são livres por board
// (templates geram ids aleatórios), então status fixo 'todo' vira card órfão:
// existe no banco e não aparece em coluna nenhuma. Aqui resolvemos de verdade.
function colunaDeEntrada(board) {
  const cols = Array.isArray(board?.columns) ? [...board.columns] : []
  if (!cols.length) return 'todo'
  cols.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  // board de cliente: trabalho novo entra em "Working" (o funil comercial
  // antes disso é do sócio, não do agent)
  if (board.clientId) {
    const w = cols.find(c => /working|execu|produ/i.test(c.name || '') || c.id === 'working')
    if (w) return w.id
  }
  const porNome = cols.find(c => /a fazer|todo|fazer|backlog|entrada|novo/i.test(c.name || ''))
  return (porNome || cols[0]).id
}

// bloco ```json no fim da resposta → tarefas + decisões de verdade
async function orqProcessar(fullText, conversaId) {
  // Aceita o bloco em qualquer posição (o modelo às vezes escreve algo depois)
  // e pega o ÚLTIMO. Se veio cortado (sem fechar), tenta salvar o que dá.
  const fences = [...fullText.matchAll(/```json\s*([\s\S]*?)```/gi)]
  let m = fences.length ? fences[fences.length - 1] : null
  let truncado = false
  if (!m) {
    const abriu = fullText.lastIndexOf('```json')
    if (abriu !== -1) { // bloco aberto e nunca fechado = resposta cortada
      m = { 1: fullText.slice(abriu + 7), index: abriu }
      truncado = true
    }
  }
  /* SEM CERCA — o modelo às vezes manda o JSON cru, sem o ```json. Até aqui
     isso caía fora de todos os testes: a resposta dizia "Feito, criei a task"
     e NADA era criado, com o json inteiro vazando na tela do sócio. É o pior
     tipo de falha que existe — a que mente.
     Ancora nas chaves que o bloco aceita pra não confundir com prosa. */
  if (!m) {
    const cru = fullText.match(/\{\s*"(?:tarefas|decisoes|atualizacoes|squads|imagens|memorias)"[\s\S]*$/)
    if (cru) {
      m = { 1: cru[0], index: cru.index }
      truncado = !cru[0].trimEnd().endsWith('}')
    }
  }
  const passos = []
  let visivel = fullText
  if (m) {
    try {
      const bloco = JSON.parse(fecharJson(m[1]))
      visivel = fullText.slice(0, m.index).trim() || 'Trabalho criado.'
      if (truncado) visivel += '\n\n(o plano veio cortado no meio — criei o que deu pra recuperar; confere se falta alguma etapa)'
      // ORDEM DE EXECUÇÃO: respeita "ordem" quando o modelo mandar, senão a
      // ordem em que ele listou. A posição no kanban sai daqui.
      // teto duro: mesmo com a regra no prompt, um doc grande fazia ele
      // despejar o projeto inteiro em cards de uma vez. Corte silencioso não:
      // o sócio precisa saber que sobrou plano de fora.
      const pedidas = (bloco.tarefas || []).filter(t => t?.resumo)
      if (pedidas.length > 8) {
        visivel += `\n\n(o plano vinha com ${pedidas.length} tarefas — criei as 8 primeiras, que é o tamanho de uma fase. Quando essas andarem, me pede a próxima leva.)`
      }
      // ordena ANTES de cortar: com "ordem" explícita fora de sequência,
      // cortar primeiro pegaria as 8 erradas em vez das 8 primeiras
      const tarefasNovas = pedidas
        .map((t, i) => ({ ...t, _i: Number.isFinite(Number(t.ordem)) ? Number(t.ordem) : i }))
        .sort((a, b) => a._i - b._i)
        .slice(0, 8)
      if (tarefasNovas.length) {
        const squads = await db.collection('squads').find({}).toArray()
        const clientes = await mainDb.collection('nomade_clients').find({}).toArray()
        const posCache = new Map() // boardId+coluna → próxima posição
        // ANTI-DUPLICATA: título que já existe (vivo) não vira card de novo.
        // O prompt pede pra não repetir, mas prompt não é garantia — a trava
        // é aqui. Normaliza acento/caixa/espaço pra pegar "quase igual".
        const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
        // Título igual é fácil. O problema real é "Modelo de dados (Mongoose) +
        // CRUD de planos" vs "Modelo de dados + CRUD de planos": textos
        // diferentes, MESMA tarefa. Compara por palavras que importam.
        const RUIDO = new Set(['para', 'com', 'dos', 'das', 'nos', 'nas', 'que', 'uma', 'pelo', 'pela', 'sobre', 'completo', 'inicial', 'criar', 'fazer'])
        const palavras = (x) => new Set(norm(x).split(' ').filter(w => w.length > 3 && !RUIDO.has(w)))
        const parecidos = (a, b) => {
          const A = palavras(a), B = palavras(b)
          if (!A.size || !B.size) return 0
          const inter = [...A].filter(w => B.has(w)).length
          return inter / new Set([...A, ...B]).size // Jaccard
        }
        const titulosVivos = (await mainDb.collection('nomade_tasks')
          .find({ archived: { $ne: true } }, { projection: { title: 1 } }).limit(500).toArray())
          .map(x => x.title)
        const existentes = new Set(titulosVivos.map(norm))

        for (const t of tarefasNovas) {
          const chaveTitulo = norm(t.resumo)
          const gemeo = titulosVivos.find(x => parecidos(x, t.resumo) >= 0.6)
          if (existentes.has(chaveTitulo) || gemeo) {
            passos.push({ tipo: 'tarefa', refId: null, dept: t.dept || null, resumo: `${String(t.resumo).slice(0, 90)} — já existia, não dupliquei`, jaExistia: true })
            continue
          }
          existentes.add(chaveTitulo)
          titulosVivos.push(t.resumo) // repetição DENTRO do mesmo bloco também morre aqui
          // squad citado vira RESPONSÁVEL da task (assignee "agent:<id>")
          const nomeQuer = String(t.squad || '').toLowerCase()
          // dois squads podem dividir o mesmo dept (Conteudo e Motion são os
          // dois "conteudo"): aí quem for CITADO no texto da tarefa ganha,
          // senão o dept sozinho entregaria sempre pro primeiro da lista
          const texto = `${t.resumo || ''} ${t.detalhe || ''}`.toLowerCase()
          const doDept = squads.filter(sq => t.dept && sq.dept === t.dept)
          const alvo =
            (nomeQuer && squads.find(sq => sq.name.toLowerCase() === nomeQuer)) ||
            (nomeQuer && squads.find(sq => nomeQuer.includes(sq.name.toLowerCase()) || sq.name.toLowerCase().includes(nomeQuer))) ||
            doDept.find(sq => texto.includes(sq.name.toLowerCase())) ||
            doDept[0] ||
            (squads.length === 1 ? squads[0] : null) || null // um squad só na casa? é ele
          // cliente citado liga a task ao cliente (mesma chave que o kanban usa)
          const quer = String(t.cliente || '').toLowerCase()
          const cli = quer
            ? clientes.find(c => c.name?.toLowerCase() === quer)
              || clientes.find(c => c.name && (quer.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(quer)))
              || clientes.find(c => c.email && quer.includes(c.email.toLowerCase()))
            : null

          /* Onde o card cai: cliente → board dele; squad com board próprio →
             o board dele (é lá que mora a pasta do projeto que o agent edita);
             senão → board interno. Sem a segunda regra a task do Motion caía
             no board "Agents", que não tem pasta, e o runner devolvia. */
          let board = null
          if (cli) board = await boardDoCliente(cli)
          else if (alvo?.boardPadrao) {
            board = await mainDb.collection('nomade_boards')
              .findOne({ _id: new ObjectId(String(alvo.boardPadrao)) }).catch(() => null)
          }
          if (!board) board = await boardDoOrquestrador()
          const colunaId = colunaDeEntrada(board)
          const chave = `${board._id}:${colunaId}`
          if (!posCache.has(chave)) {
            posCache.set(chave, (await mainDb.collection('nomade_tasks').countDocuments({ boardId: String(board._id), status: colunaId })) || 0)
          }
          const pos = posCache.get(chave)
          posCache.set(chave, pos + 1)

          const doc = {
            boardId: String(board._id),
            title: String(t.resumo).slice(0, 200),
            description: String(t.detalhe || ''),
            status: colunaId,
            position: pos,
            assignee: alvo ? `agent:${alvo.id}` : '',
            priority: 'medium',
            dueDate: null,
            labels: ['orquestrador', ...(t.dept ? [t.dept] : [])],
            subtasks: [], checklist: [], attachments: [], comments: [],
            archived: false,
            createdBy: 'orquestrador',
            createdByName: 'Orquestrador',
            conversaId, // por onde o RESULTADO volta pro orquestrador
            clientEmail: cli?.email?.toLowerCase() || null,
            visibleToClient: false,
            clientStatusLabel: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          const r = await mainDb.collection('nomade_tasks').insertOne(doc)
          officeEvent('tarefa_criada', { dept: t.dept || null, resumo: doc.title, squad: alvo?.name || null, cliente: cli?.name || null, board: board.name })
          passos.push({
            tipo: 'tarefa',
            refId: r.insertedId.toString(),
            dept: t.dept || null,
            resumo: doc.title,
            agent: alvo?.name || null,
            cliente: cli?.name || null,
            board: board.name,
          })
        }
      }
      // imagens que o orquestrador decidiu gerar
      for (const im of (bloco.imagens || []).slice(0, 4)) {
        if (!im?.prompt) continue
        try {
          const img = await gerarImagem(im.prompt, im)
          const saved = await salvarImagem(im.prompt, img, { por: 'orquestrador' })
          passos.push({ tipo: 'imagem', refId: saved.id, dept: null, resumo: im.prompt.slice(0, 90), url: `/api/office/imagens/${saved.id}/arquivo` })
        } catch (e) {
          passos.push({ tipo: 'imagem', refId: null, dept: null, resumo: `falhou: ${String(e.message || e).slice(0, 90)}`, erro: true })
        }
      }

      // contratar funcionário: o orquestrador monta o squad e ele já entra
      // no organograma (mesma entidade que roda no Studio)
      for (const sq of (bloco.squads || []).slice(0, 3)) {
        if (!sq?.nome) continue
        try {
          const agentsNovos = normSquadAgents((sq.agents || []).map(a => ({
            name: a.nome || a.name,
            role: a.papel || a.role,
            model: a.modelo || a.model,
            temperature: a.temperatura ?? a.temperature,
            systemPrompt: a.prompt || a.systemPrompt,
          })))
          const squad = {
            id: `squad_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            name: String(sq.nome).slice(0, 60),
            code: generateSquadCode(sq.nome, agentsNovos),
            agents: agentsNovos,
            orchestration: 'sequential',
            ownerId: 'orquestrador',
            ownerEmail: 'orquestrador',
            dept: sq.dept || null,
            autonomia: 0, // nasce pedindo aprovação — sobe quando provar
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          await db.collection('squads').insertOne(squad)
          officeEvent('funcionario_criado', { nome: squad.name, dept: squad.dept, por: 'orquestrador' })
          passos.push({ tipo: 'squad', refId: squad.id, dept: squad.dept, resumo: `${squad.name} · ${agentsNovos.length} agente(s)` })
        } catch { /* um squad inválido não derruba o resto */ }
      }

      // atualizações no kanban: mover de coluna, priorizar, comentar, fechar
      for (const u of (bloco.atualizacoes || []).slice(0, 12)) {
        if (!u?.task) continue
        try {
          const alvoTask = /^[a-f0-9]{24}$/i.test(String(u.task))
            ? await mainDb.collection('nomade_tasks').findOne({ _id: new ObjectId(String(u.task)) })
            : await mainDb.collection('nomade_tasks').findOne({
                archived: { $ne: true },
                title: { $regex: String(u.task).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
              })
          if (!alvoTask) continue
          const board = await mainDb.collection('nomade_boards').findOne({ _id: new ObjectId(String(alvoTask.boardId)) }).catch(() => null)
          const set = { updatedAt: new Date() }
          if (u.coluna && board?.columns?.some(c => c.id === u.coluna || c.name?.toLowerCase() === String(u.coluna).toLowerCase())) {
            set.status = board.columns.find(c => c.id === u.coluna || c.name?.toLowerCase() === String(u.coluna).toLowerCase()).id
          }
          if (['low', 'medium', 'high', 'urgent'].includes(u.prioridade)) set.priority = u.prioridade
          if (u.titulo) set.title = String(u.titulo).slice(0, 200)
          if (u.detalhe) set.description = String(u.detalhe)
          const push = {}
          if (u.comentario) {
            push.comments = {
              id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              author: 'Orquestrador', authorId: 'orquestrador',
              text: String(u.comentario).slice(0, 2000), createdAt: new Date(),
            }
          }
          await mainDb.collection('nomade_tasks').updateOne({ _id: alvoTask._id }, {
            $set: set,
            ...(push.comments ? { $push: push } : {}),
          })
          officeEvent('tarefa_atualizada', { resumo: set.title || alvoTask.title, coluna: set.status || alvoTask.status, por: 'orquestrador' })
          passos.push({ tipo: 'tarefa', refId: alvoTask._id.toString(), dept: null, resumo: `${set.title || alvoTask.title} → ${set.status || alvoTask.status}`, atualizada: true })
        } catch { /* uma atualização inválida não derruba as outras */ }
      }

      // memórias que o orquestrador julgou dignas de lembrar
      for (const mm of (bloco.memorias || []).slice(0, 5)) {
        if (!mm?.conteudo) continue
        const saved = await memCreate({ title: mm.titulo, content: mm.conteudo, tags: mm.tags, project: mm.projeto })
        // memória fundida não é memória nova: o sócio precisa ver que não duplicou
        // (mesma transparência que a task já tem no anti-duplicata)
        officeEvent(saved.fundida ? 'memoria_fundida' : 'memoria_criada', { titulo: saved.title || saved.content.slice(0, 60), por: 'orquestrador' })
        passos.push({
          tipo: 'memoria', refId: saved.id, dept: null,
          resumo: `${saved.title || saved.content.slice(0, 80)}${saved.fundida ? ' — já existia, complementei' : ''}`,
          jaExistia: !!saved.fundida,
        })
      }
      for (const d of (bloco.decisoes || []).slice(0, 6)) {
        if (!d?.pergunta) continue
        const decision = {
          id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          agentId: null,
          conversaId, // volta pra ESTA conversa quando um sócio resolver
          agentName: 'orquestrador',
          dept: d.dept || null,
          contexto: String(d.contexto || ''),
          pergunta: String(d.pergunta).slice(0, 300),
          opcoes: normOpcoes(d.opcoes),
          urgencia: URGENCIAS.includes(d.urgencia) ? d.urgencia : 'hoje',
          sugestao: String(d.sugestao || ''),
          status: 'aberta',
          createdAt: new Date(),
        }
        await db.collection('office_decisions').insertOne(decision)
        officeEvent('decisao_aberta', { decisionId: decision.id, agentName: 'orquestrador', pergunta: decision.pergunta, urgencia: decision.urgencia })
        passos.push({ tipo: 'decisao', refId: decision.id, dept: decision.dept, resumo: decision.pergunta })
      }
    } catch { visivel = fullText /* bloco inválido — mostra como veio */ }
  }
  return { visivel, passos }
}

// ═══ MEMÓRIA da empresa — vetorial + associativa (portada do Vlad) ═══
// Embeddings locais (Ollama/nomic — grátis) quando OLLAMA_URL existir;
// sem Ollama a busca degrada pra regex e NADA quebra. Cada memória guarda
// `links`: vizinhos semânticos por cosseno — a base vira um GRAFO.

const OLLAMA_URL = (process.env.OLLAMA_URL || '').replace(/\/$/, '')
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text'

/* O QUE É EMBEDDADO — um lugar só, de propósito.

   Medido: a convenção do Socket.IO em 142 tokens ficava em 42º na busca que
   ela existe pra responder; o mesmo fato em 34 tokens dá 0.685 e entra no top
   8. Não era o modelo (o v2-moe também falhou) nem falta de vocabulário (pôr
   "tempo real" no texto moveu 0.002) — era tamanho. O vetor de um texto longo
   é um centroide, e a pergunta tem seis palavras.

   Então `resumo` é o que se indexa e `content` é o que o modelo lê depois de
   achar. Três caminhos gravam embedding (enriquecimento, PATCH e backfill);
   se cada um decidisse sozinho o que embeddar, o esquecido faria doc nascer
   invisível — achável por ninguém e sem erro nenhum. */
const textoParaEmbedar = (doc = {}) =>
  (doc.resumo && String(doc.resumo).trim()) || `${doc.title || ''}\n${doc.content || ''}`

async function embedText(text) {
  if (!OLLAMA_URL) return []
  try {
    const r = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: String(text).slice(0, 6000) }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!r.ok) return []
    const j = await r.json()
    return j?.embeddings?.[0] ?? []
  } catch { return [] }
}

function cosineVec(a, b) {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

const memOut = (d) => { const { embedding, ...rest } = d; return rest }
const toTags = (t) => Array.isArray(t) ? t.map(x => String(x).trim()).filter(Boolean)
  : typeof t === 'string' ? t.split(',').map(s => s.trim()).filter(Boolean) : []

// religa UMA memória aos vizinhos semânticos (depois de embeddar)
async function linkMemory(id, k = 5, min = 0.55) {
  const c = memorias()
  const me = await c.findOne({ id }, { projection: { embedding: 1 } })
  if (!me?.embedding?.length) return
  const others = await c.find({ id: { $ne: id }, embedding: { $type: 'array' } }, { projection: { id: 1, embedding: 1 } }).limit(800).toArray()
  const scored = []
  for (const o of others) {
    const s = cosineVec(me.embedding, o.embedding)
    if (s >= min) scored.push({ id: o.id, score: Math.round(s * 1000) / 1000 })
  }
  scored.sort((a, b) => b.score - a.score)
  await c.updateOne({ id }, { $set: { links: scored.slice(0, k) } })
}

/* Refaz o grafo INTEIRO: recalcula os vizinhos de todas as memórias que têm
   embedding. Puro cosseno — sem modelo, sem nuvem, sem custo. O `linkMemory`
   liga uma memória às que existiam NAQUELE momento; quem entrou depois nunca
   apareceu como vizinha das antigas. Sem isso o grafo envelhece torto. */
async function rebuildLinks(k = 5, min = 0.55) {
  const c = memorias()
  const docs = await c.find({ embedding: { $type: 'array' } }, { projection: { id: 1, embedding: 1 } }).limit(800).toArray()
  if (docs.length < 2) return 0
  const ops = []
  for (let i = 0; i < docs.length; i++) {
    const vi = docs[i].embedding
    const scored = []
    for (let j = 0; j < docs.length; j++) {
      if (i === j) continue
      const s = cosineVec(vi, docs[j].embedding)
      if (s >= min) scored.push({ id: docs[j].id, score: Math.round(s * 1000) / 1000 })
    }
    scored.sort((a, b) => b.score - a.score)
    ops.push({ updateOne: { filter: { id: docs[i].id }, update: { $set: { links: scored.slice(0, k) } } } })
  }
  if (ops.length) await c.bulkWrite(ops, { ordered: false })
  return ops.length
}

/* ═══ QUEM ENTRA NO RECALL ════════════════════════════════════════════════
   Duas perguntas, e a segunda é a que quase se errou.

   (1) Estado: arquivado, incompleto e pendente ficam FORA. Arquivado já foi
   substituído — trazer junto com quem o substituiu é o que fez o pedido de
   check-in reaparecer cinco dias depois da decisão. Incompleto registra que
   houve decisão sem dizer qual: no recall só ocuparia contexto. Pendente é
   escopo não resolvido, e memória sem dono não entra em busca de dono nenhum.

   (2) Escopo, e aqui a resposta é POR TIPO, não por campo vazio. Convenção e
   playbook são da casa e têm que aparecer SEMPRE — são o motivo desta camada
   existir. Decisão e fato de cliente são escopados e não vazam nunca. Filtrar
   só por "tem cliente igual ao meu" consertaria o vazamento e quebraria o
   recall de convenção no mesmo commit.

   O caso de transição: hoje `tipo` é null em todos os 48 docs (a migração
   criou o campo, classificar é decisão à parte). Doc sem cliente e sem tipo
   ENTRA — não pode vazar dado de cliente porque não tem cliente, e escondê-lo
   silenciaria justamente as convenções. A exceção é `fato_cliente` sem
   cliente: isso é doc quebrado, vai pra curadoria, não pro recall. */
const TIPOS_GLOBAIS = ['convencao', 'playbook', 'preferencia'] // valem pra casa toda
const STATUS_FORA = ['arquivado', 'incompleto', 'pendente']

function filtroDeRecall({ cliente } = {}) {
  // `status` não existe em doc anterior à migração 001 — $nin sozinho o
  // excluiria, e a base inteira sumiria do recall sem erro nenhum
  const base = { $and: [{ $or: [{ status: { $exists: false } }, { status: { $nin: STATUS_FORA } }] }] }
  if (cliente === undefined) return base

  /* id inválido NÃO derruba a busca: vira "só a casa". Antes, um cliente
     digitado errado subia como ObjectId('casa') e devolvia 500 — resposta
     pior que a resposta vazia, e o chamador não tinha como distinguir. */
  const bruto = cliente ? String(cliente) : null
  const alvo = bruto && /^[a-f0-9]{24}$/i.test(bruto) ? new ObjectId(bruto) : null
  base.$and.push({
    $or: [
      // do cliente pedido — a única porta por onde memória escopada passa
      ...(alvo ? [{ 'escopo.cliente': alvo }] : []),
      // sem cliente: da casa. Entra por tipo global, ou por tipo ainda não
      // classificado — nunca como fato_cliente órfão.
      {
        $and: [
          { $or: [{ 'escopo.cliente': null }, { 'escopo.cliente': { $exists: false } }] },
          { $or: [{ tipo: { $in: TIPOS_GLOBAIS } }, { tipo: null }, { tipo: { $exists: false } }] },
        ],
      },
    ],
  })
  return base
}

async function memSearch(query, limit = 8, filtro = {}) {
  const c = memorias()
  const vec = await embedText(query)
  if (vec.length) {
    const docs = await c.find({ ...filtro, embedding: { $type: 'array' } }).limit(500).toArray()
    return docs
      .map(d => ({ d, score: cosineVec(vec, d.embedding || []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => ({ ...memOut(x.d), score: Math.round(x.score * 1000) / 1000 }))
  }
  // sem embedder — regex nos campos de texto
  const rx = new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).slice(0, 4).join('|'), 'i')
  const docs = await c.find({ ...filtro, $or: [{ content: rx }, { title: rx }, { tags: rx }] }, { projection: { embedding: 0 } })
    .sort({ updatedAt: -1 }).limit(limit).toArray()
  return docs.map(memOut)
}

/* ── AGENTES LOCAIS de manutenção da memória (Ollama, grátis) ──────────
   Titulador e etiquetador. Rodam em BACKGROUND: memória entra crua e é
   enriquecida depois, sem segurar a resposta de ninguém e sem gastar token
   de nuvem. Sem Ollama no ar, tudo isso simplesmente não acontece — a
   memória continua salva, só sem título e sem tag. */
const TEXTO_MODEL = MODELO_LOCAL

async function ollamaTexto(system, prompt, max = 60) {
  if (!OLLAMA_URL) return ''
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEXTO_MODEL, stream: false,
        options: { temperature: 0.3, num_predict: max },
        messages: [{ role: 'system', content: system }, { role: 'user', content: String(prompt).slice(0, 4000) }],
      }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!r.ok) return ''
    const j = await r.json()
    return String(j?.message?.content || '').trim()
  } catch { return '' } // modelo local fora do ar não é erro: é ausência de luxo
}

const tituloLocal = async (conteudo) => {
  const t = await ollamaTexto(
    'Você dá título a memórias de uma empresa. Responda SOMENTE o título: no máximo 6 palavras, sem aspas, sem ponto final, em português do Brasil.',
    conteudo, 24)
  return t.split('\n')[0].replace(/^["'\s]+|["'.\s]+$/g, '').slice(0, 60)
}

const tagsLocal = async (conteudo) => {
  const t = await ollamaTexto(
    'Você etiqueta memórias de uma empresa. Responda SOMENTE de 2 a 4 etiquetas curtas em português, minúsculas, separadas por vírgula. Sem explicação, sem numeração.',
    conteudo, 32)
  return toTags(t.split('\n')[0]).slice(0, 4).filter(x => x.length > 1 && x.length < 24)
}

/* Enriquece uma memória sem travar quem chamou: título e tag pelos modelos
   LOCAIS, embedding, e religa no grafo. */
function enriquecerEmBackground(id, { precisaTitulo, precisaTags } = {}) {
  void (async () => {
    const c = memorias()
    const doc = await c.findOne({ id })
    if (!doc) return
    const patch = {}
    if (precisaTitulo) { const t = await tituloLocal(doc.content); if (t) patch.title = t }
    if (precisaTags) { const g = await tagsLocal(`${doc.title || ''}\n${doc.content}`); if (g.length) patch.tags = g }
    if (Object.keys(patch).length) await c.updateOne({ id }, { $set: patch })
    const vec = await embedText(textoParaEmbedar({ ...doc, title: patch.title || doc.title }))
    if (vec.length) {
      await c.updateOne({ id }, { $set: { embedding: vec } })
      await linkMemory(id).catch(() => {})
    }
  })().catch(() => {})
}

// normaliza pra comparar: sem acento, sem pontuação, sem caixa
const normMem = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/* ═══ ESCOPO — a lista FECHADA de a quem uma memória pode pertencer ═══════
   Até aqui `project` era string livre que o MODELO preenchia, e por isso
   divergia: 11 grafias para 6 assuntos, misturando nome de cliente, nome de
   board e texto inventado na hora. Filtrar por igualdade nisso esconderia
   metade da memória do próprio cliente sem dar erro.

   Cliente vem de `nomade_clients` — registro que JÁ é canônico e tem id
   estável. Normalizar string aqui criaria um SEGUNDO vocabulário de cliente
   ao lado do primeiro, que é a divergência que esta camada existe pra evitar.

   Os internos são lista fixa e NÃO saem dos boards de propósito: board é onde
   o trabalho aconteceu, escopo é sobre o que ele é. "Agents" é board, e os
   docs que caíram lá eram metade prospecção, metade conteúdo.

   Projeto novo NUNCA nasce do modelo: ele manda ESCOPO_NOVO com um palpite, a
   memória entra NÃO resolvida e fica fora do recall filtrado até alguém
   decidir. Sem esse caminho o modelo escolhe o rótulo mais parecido — foi
   assim que a identidade visual de um cliente virou convenção da casa. */
const ESCOPO_NOVO = '__novo__'
// Escopos da própria empresa (o resto do vocabulário são os clientes cadastrados).
// Troca ou acrescenta por ESCOPOS_INTERNOS no .env, separado por vírgula.
const ESCOPOS_INTERNOS = String(process.env.ESCOPOS_INTERNOS || '').split(',').map((x) => x.trim()).filter(Boolean).length
  ? String(process.env.ESCOPOS_INTERNOS).split(',').map((x) => x.trim()).filter(Boolean)
  : [`${EMPRESA.nome} · design`, `${EMPRESA.nome} · comercial`, `${EMPRESA.nome} · conteúdo`, `${EMPRESA.nome} · interno`]

let escoposCache = { em: 0, lista: [] }
async function escoposValidos() {
  if (escoposCache.lista.length && Date.now() - escoposCache.em < 60_000) return escoposCache.lista
  let clientes
  try {
    clientes = await mainDb.collection('nomade_clients')
      .find({}, { projection: { name: 1 } }).sort({ name: 1 }).limit(300).toArray()
  } catch { return escoposCache.lista } // registro fora do ar: cache velho vale mais que lista vazia
  const lista = [
    ...clientes.filter(c => c.name?.trim()).map(c => ({ id: String(c._id), rotulo: c.name.trim(), tipo: 'cliente' })),
    ...ESCOPOS_INTERNOS.map(p => ({ id: null, rotulo: p, tipo: 'interno' })),
  ]
  escoposCache = { em: Date.now(), lista }
  return lista
}

/* Rótulo que veio do modelo → escopo. Casa por id ou por rótulo exato (com
   caixa e acento normalizados, o que é seguro porque o conjunto é FECHADO:
   normalizar só faz casar ou não casar, nunca casar no cliente errado).
   Não existe "mais parecido". Não casou, entra não resolvida.
   Sem rótulo = memória global, de propósito: convenção da casa vale pra todos. */
async function resolverEscopo(rotulo, sugerido) {
  const bruto = String(rotulo ?? '').trim()
  if (!bruto) return { cliente: null, clienteRotulo: null, projeto: null, resolvido: true, sugestao: null }

  if (bruto !== ESCOPO_NOVO) {
    const alvo = normMem(bruto)
    const lista = await escoposValidos()
    const e = lista.find(x => x.id === bruto) || lista.find(x => normMem(x.rotulo) === alvo)
    if (e) return {
      cliente: e.id ? new ObjectId(e.id) : null,
      clienteRotulo: e.tipo === 'cliente' ? e.rotulo : null,
      projeto: e.rotulo,
      resolvido: true,
      sugestao: null,
    }
  }
  const palpite = String(sugerido ?? '').trim() || (bruto === ESCOPO_NOVO ? '' : bruto)
  return { cliente: null, clienteRotulo: null, projeto: null, resolvido: false, sugestao: palpite || null }
}

/* Salva SEM duplicar. O orquestrador cria memória a cada turno e não tem como
   saber o que já existe — sem esta trava a base vira dez versões do mesmo fato,
   e aí o recall traz as dez e desperdiça contexto.
   Casa por título quase igual, ou por conteúdo contido (um dentro do outro).
   Achou? COMPLEMENTA a existente em vez de criar outra. */
async function memCreate({ title, content, tags, project, projetoSugerido, resumo }) {
  const c = memorias()
  /* TRAVA DE ESCOPO. São QUATRO caminhos de escrita — gravar_memoria do motor
     Claude (agente.mjs), a do motor GLM (acoes.mjs), o orquestrador e o POST
     da sede. Enum e prompt são pedido; aqui é onde todos passam. */
  const escopo = await resolverEscopo(project, projetoSugerido)
  const now = new Date()
  const texto = String(content || '').trim()
  const titulo = (title || '').trim()
  const nTit = normMem(titulo)
  const nTxt = normMem(texto)
  const inTags = toTags(tags)

  // universo pequeno (a base da casa é de centenas, não milhões). Só funde com
  // memória do MESMO dono: fato de um cliente não pode virar parágrafo de outro.
  // (`escopo.cliente: null` também casa doc antigo sem escopo — esse é da casa)
  const todas = await c.find({ 'escopo.cliente': escopo.cliente ?? null }, { projection: { id: 1, title: 1, content: 1, tags: 1, project: 1 } }).limit(500).toArray().catch(() => [])
  let igual = null
  if (nTit.length > 2) igual = todas.find(m => normMem(m.title) === nTit)
  if (!igual && nTxt.length > 8) {
    igual = todas.find(m => {
      const mc = normMem(m.content)
      return mc === nTxt || mc.includes(nTxt) || nTxt.includes(mc)
    })
  }

  if (igual) {
    const mc = normMem(igual.content)
    // info nova já está lá? não mexe no texto. Senão, anexa em vez de trocar.
    const fundido = mc.includes(nTxt) ? igual.content : `${igual.content}\n${texto}`.trim()
    const tagsFundidas = [...new Set([...(igual.tags || []), ...inTags])]
    const novoResumo = (resumo && String(resumo).trim()) || ''
    /* A fusão anexa conteúdo, e aí o resumo guardado passa a descrever MENOS
       do que o texto diz — sem avisar ninguém. Se veio resumo novo e não
       havia nenhum, adota; se já havia, marca pra revisão em vez de escolher
       sozinho qual dos dois vale. */
    const resumoPatch = novoResumo && !igual.resumo ? { resumo: novoResumo }
      : (novoResumo && igual.resumo && novoResumo !== igual.resumo) ? { resumoDesatualizado: true }
      : {}
    await c.updateOne({ id: igual.id }, {
      $set: {
        content: fundido, tags: tagsFundidas, ...resumoPatch,
        title: igual.title || titulo || undefined,
        project: escopo.projeto || igual.project,
        // escopo resolvido SOBE pro doc antigo; não resolvido nunca rebaixa o que já estava certo
        ...(escopo.resolvido && escopo.projeto ? { escopo } : {}),
        updatedAt: now,
      },
    })
    enriquecerEmBackground(igual.id, { precisaTitulo: !igual.title && !titulo, precisaTags: !tagsFundidas.length })
    const atual = await c.findOne({ id: igual.id }, { projection: { embedding: 0 } })
    return { ...memOut(atual), fundida: true } // o caller avisa que não duplicou
  }

  const doc = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: titulo || undefined,
    content: texto,
    tags: inTags,
    /* `resumo` é o que será EMBEDDADO (ver textoParaEmbedar). Sem ele a
       memória nasce indexada pelo texto inteiro e fica difícil de achar —
       medido: 142 tokens põem o doc em 42º na busca que ele responde, 34
       tokens põem em 2º. Quem grava fornece; o modelo não inventa. */
    resumo: (resumo && String(resumo).trim()) || undefined,
    project: escopo.projeto || undefined,
    escopo,
    status: escopo.resolvido ? 'ativo' : 'pendente', // não resolvida fica fora do recall filtrado
    substituiPor: null,
    createdAt: now,
    updatedAt: now,
  }
  await c.insertOne(doc)
  enriquecerEmBackground(doc.id, { precisaTitulo: !titulo, precisaTags: !inTags.length })
  return memOut(doc)
}

// recall — os DOCS relevantes ao pedido, com salto no grafo.
// SALTO: além dos matches diretos, traz os VIZINHOS semânticos de cada um
// (campo `links`, que linkMemory já grava e ninguém lia). É a diferença entre
// buscar e lembrar — memória que não casaria sozinha com a pergunta, mas está
// colada a algo que casou, entra junto. Vale nos DOIS caminhos (cosseno e
// regex): os links vivem no Mongo e não dependem do Ollama estar de pé.
// Devolve docs (não texto) porque tem dois consumidores: o system prompt do
// orquestrador (memRecall, logo abaixo) e a ferramenta buscar_memoria do agent.
async function memRecallDocs(query, { cliente } = {}) {
  // cliente undefined = sem filtro de escopo · null = só o que é da casa
  const filtro = filtroDeRecall({ cliente })
  const DIRETOS = 8      // matches por similaridade — ou por regex, sem embedder
  /* PISO medido, não herdado. O 0.55 vinha do linkMemory (que GRAVA o vizinho)
     e nunca cortou nada na leitura: o vizinho mais fraco da base tem 0.668.
     A distribuição real dos candidatos ao salto se amontoa em 0.70–0.75 (32 de
     49) — é o "tudo é vagamente parecido com tudo" do embedder v1 em
     português. 0.75 corta essa massa e deixa ~12 candidatos disputarem as ~6
     vagas, que é onde escolher passa a significar alguma coisa.
     Calibrado em 3 buscas: se a base mudar de tamanho, remede. */
  const MIN_LINK = 0.75
  const TETO = 14        // diretos + vizinhos: o que cabe num contexto

  // regex não tem score: aí o sort (estável) é no-op e a ordem original vale
  const diretos = [...(await memSearch(query, DIRETOS, filtro))]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  if (!diretos.length) return []

  const vistos = new Set(diretos.map(m => m.id)) // dedup: direto não volta como vizinho
  const candidatos = [] // {id, score} — ORDENADO depois; ver o porquê abaixo
  for (const m of diretos) {
    /* DOIS campos de vizinhança, e a diferença importa. `links` é cosseno e o
       backfill REESCREVE inteiro a cada religamento. `linksFixos` é estrutura
       que o texto sabe e a similaridade não — a receita anterior, a próxima, e
       o critério de aprovação do playbook — e nada automático encosta nele.
       Guardar os dois no mesmo campo já custou uma perda: o religamento
       trocou os vizinhos escritos à mão por cinco receitas parecidas entre si,
       e o critério de verificação sumiu sem erro nenhum. */
    const vizinhanca = [...(Array.isArray(m.linksFixos) ? m.linksFixos : []), ...(Array.isArray(m.links) ? m.links : [])]
    const porDireto = []
    for (const l of vizinhanca) { // doc antigo não tem nem um nem outro
      if (!l?.id || vistos.has(l.id)) continue
      // linksFixos é estrutura, não semelhança: passa por baixo do piso de
      // propósito. O critério de aprovação de um playbook tem que vir junto
      // mesmo quando o cosseno acha que ele não parece com a pergunta.
      const fixo = (m.linksFixos || []).some(x => x.id === l.id)
      if (!fixo && (l.score ?? 0) < MIN_LINK) continue
      vistos.add(l.id)
      // score 1 no fixo fazia ele ganhar de TODO vizinho de cosseno; com 6
      // playbooks nos diretos isso monopolizou as 6 vagas do salto. Usa o
      // score gravado (0.9/0.95): continua ganhando de quase tudo, sem varrer.
      porDireto.push({ id: l.id, score: fixo ? (l.score ?? 0.9) : (l.score ?? 0) })
    }
    /* TETO POR DIRETO. O vizinho vale por acompanhar QUEM casou com a
       pergunta; oito diretos trazendo cinco cada dá 40 candidatos pra ~6
       vagas, e aí um único match acaba pautando o salto inteiro. Dois por
       direto espalha a vizinhança em vez de deixar o primeiro colocado levar
       tudo. */
    candidatos.push(...porDireto.sort((a, b) => b.score - a.score).slice(0, 2))
  }

  /* ORDENA. Sem isto o salto era loteria: `saltoIds` saía em ordem de laço, o
     `$in` devolve em ordem natural do Mongo, e o corte no TETO ficava pegando
     o que o banco entregou primeiro. Um vizinho de 0.87 perdia vaga pra um de
     0.67 por posição na coleção. */
  candidatos.sort((a, b) => b.score - a.score)
  const saltoIds = candidatos.map(x => x.id)

  let vizinhos = []
  if (saltoIds.length) {
    try {
      vizinhos = await memorias()
        // `id` é a string da memória, NÃO o _id do Mongo. E sem `embedding`
        // na projeção: são 768 floats por doc que não servem pra nada aqui.
        // MESMO filtro dos diretos: o salto busca por id e não passa pelo
        // memSearch, então sem isto arquivado e memória de outro cliente
        // voltavam pela porta dos fundos
        .find({ ...filtro, id: { $in: saltoIds } }, { projection: { embedding: 0 } })
        .toArray()
    } catch { vizinhos = [] } // salto é bônus: falhou, segue com os diretos
  }

  // o $in não preserva ordem: reordena pela pontuação que o candidato tinha
  const ordem = new Map(candidatos.map((x, i) => [x.id, i]))
  vizinhos.sort((a, b) => (ordem.get(a.id) ?? 1e9) - (ordem.get(b.id) ?? 1e9))

  return [
    ...diretos.map(m => ({ ...m, origem: 'direto' })),
    ...vizinhos.map(m => ({ ...memOut(m), origem: 'salto' })),
  ].slice(0, TETO)
}

// bloco de contexto pro system prompt do orquestrador
/* COMO A MEMÓRIA CHEGA NO MODELO — resumo por padrão, texto inteiro só no topo.

   Depois que `resumo` passou a existir, mandar `content` de 14 documentos é
   pagar contexto por 13 que o modelo não vai usar: ele lê a lista pra saber
   O QUE existe, e só precisa do porquê inteiro daquilo que de fato responde
   o pedido. O resumo já diz o que o doc resolve — é literalmente escrito pra
   isso.

   TRÊS é o corte porque o recall traz 8 diretos ordenados por score e a queda
   entre o 3º e o 4º é onde "responde a pergunta" vira "é do mesmo assunto".
   Doc sem resumo (anterior a esta mudança) cai no content, senão sumiria. */
const PROFUNDOS = 3

function memParaModelo(docs) {
  return docs.map((m, i) => {
    const corpo = (i < PROFUNDOS || !m.resumo) ? m.content : m.resumo
    return `- ${m.title ? `${m.title}: ` : ''}${corpo}`.slice(0, i < PROFUNDOS ? 900 : 300)
  })
}

async function memRecall(query) {
  try {
    const docs = await memRecallDocs(query)
    if (!docs.length) return ''
    return '\n\nMEMÓRIAS da empresa relevantes ao pedido (usa quando ajudar; NÃO inventa fatos fora delas).\n' +
      'As três primeiras vêm inteiras, com o porquê; as outras vêm resumidas — se precisar do detalhe de uma delas, chama buscar_memoria com a pergunta específica:\n' +
      memParaModelo(docs).join('\n')
  } catch { return '' }
}

/* SISTEMA 1 — decisão tipada com probabilidade (lib/decisoes.js). Mesmo
   formato do /v1/decisions do LLM Gateway: { input, questions[] } →
   { motor, model, answers[] }. O limiar é do CHAMADOR, não do prompt. */
app.post('/api/office/decisoes', officeAuth, async (req, res) => {
  try {
    const { input, questions, motor } = req.body || {}
    if (!String(input || '').trim()) return res.status(400).json({ error: 'input obrigatório' })
    res.json(await decidir({ input, questions, motor }))
  } catch (err) { res.status(err.status || 502).json({ error: err.message }) }
})
app.get('/api/office/decisoes/status', officeAuth, (req, res) => {
  res.json({ motor: motorDisponivel() })
})


/* ══════════════════════════════════════════════════════════════════════════
 * ATENDIMENTO — conversas de clientes vindas de canais (Mercado Livre,
 * Shopee) num lugar só, com a IA rascunhando a resposta a partir da MEMÓRIA.
 *
 * O ciclo que torna isso dinâmico:
 *   1. chega pergunta → recall na memória da casa → a IA rascunha e diz quão
 *      segura está (confianca) e o que faltou saber (faltou).
 *   2. modo "automatico" + confiança acima do limiar + nada faltando → envia.
 *      Senão fica como rascunho pra uma pessoa revisar.
 *   3. a pessoa ensina o que faltou (vira memória e o rascunho é refeito) ou
 *      corrige e envia (a resposta corrigida vira memória).
 *   4. a próxima pergunta parecida já encontra essa memória — no atendimento
 *      e em qualquer agent, porque a base é a mesma.
 *
 * Coleções: office_canais (credencial, tokens, modo) e office_atendimento
 * (uma conversa por documento). Conector de cada canal em lib/atendimento/.
 * ══════════════════════════════════════════════════════════════════════════ */
const canaisCol = () => db.collection('office_canais')
const atendCol = () => db.collection('office_atendimento')
const redirectDoCanal = (id) => `${PAINEL_URL}/api/atendimento/oauth/${id}`

async function perfilDaEmpresa() {
  try {
    const d = await mainDb.collection('nomade_settings').findOne({ key: 'empresa' })
    return { nome: EMPRESA.nome, ...(d?.value || {}) }
  } catch { return { nome: EMPRESA.nome } }
}

/* mensagens do cliente desde a última resposta da empresa = o que precisa de resposta */
function perguntaAberta(conv) {
  const msgs = conv.mensagens || []
  const ult = msgs.map(m => m.de).lastIndexOf('empresa')
  return msgs.slice(ult + 1).filter(m => m.de === 'cliente').map(m => m.texto).join('\n').trim()
}

const NOME_CANAL = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', teste: 'teste' }
const TIPO_CONV = { pergunta: 'pergunta pública num anúncio (outros compradores leem)', pos_venda: 'mensagem pós-venda de quem já comprou', chat: 'chat privado com o comprador' }

function extrairJson(txt) {
  const s = String(txt || '')
  const ini = s.indexOf('{'), fim = s.lastIndexOf('}')
  if (ini === -1 || fim <= ini) return null
  try { return JSON.parse(s.slice(ini, fim + 1)) } catch { return null }
}

async function gerarRascunho(conv) {
  const pergunta = perguntaAberta(conv)
  if (!pergunta) return null
  const [orq, keys, emp] = await Promise.all([getOrqConfig(), getKeys(), perfilDaEmpresa()])
  const p = provedor(orq.provider)
  const temIA = orq.provider === 'ollama' ? !!OLLAMA_URL : !!keys[p?.id || orq.provider || 'anthropic']
  if (!temIA) return { texto: '', confianca: 0, faltou: '', memorias: [], erro: 'sem_ia', em: new Date() }

  // cliente: null = só memória da casa. Fato de um cliente do painel nunca
  // vai parar na resposta a um comprador de marketplace.
  const docs = await memRecallDocs(`${conv.assunto || ''}\n${pergunta}`.trim(), { cliente: null }).catch(() => [])
  const memTexto = docs.length ? memParaModelo(docs).map((l, i) => `[${i + 1}] ${l.slice(2)}`).join('\n') : '(nenhuma memória relevante)'
  const historico = (conv.mensagens || []).slice(-12).map(m => `${m.de === 'cliente' ? 'CLIENTE' : 'EMPRESA'}: ${m.texto}`).join('\n')
  const conector = canalPorId(conv.canal)
  const max = conector?.maxTexto || 1000

  const system = [
    `Você responde clientes da ${emp.nome}${emp.descricao ? ` (${emp.descricao})` : ''} no canal ${NOME_CANAL[conv.canal] || conv.canal}.`,
    conv.tipo ? `Tipo de conversa: ${TIPO_CONV[conv.tipo] || conv.tipo}.` : '',
    conv.assunto ? `Assunto/anúncio: ${conv.assunto}.` : '',
    '',
    'MEMÓRIAS DA EMPRESA (a única fonte de fatos sobre produto, preço, prazo, estoque, troca, garantia e política):',
    memTexto,
    '',
    'Regras:',
    '- Use só fatos que estão nas memórias ou na própria conversa. Nunca invente preço, prazo, estoque, medida, política ou promessa.',
    '- Se a resposta depende de algo que não está nas memórias, escreva a melhor resposta honesta possível sem inventar (ex.: "vou confirmar e já te retorno") e descreva em "faltou", em uma frase, o fato que a empresa precisa ensinar.',
    '- Responda no idioma do cliente. Tom cordial, direto e curto (até 3 frases). Sem emojis, sem markdown, sem assinatura.',
    `- No máximo ${max} caracteres.`,
    '- confianca: 0 a 1. Acima de 0.85 só quando cada fato da resposta está escrito nas memórias.',
    '',
    'Responda SOMENTE com JSON: {"resposta": "...", "confianca": 0.0, "faltou": "", "usou": [números das memórias usadas]}',
  ].filter(l => l !== null).join('\n')

  let bruto = ''
  try {
    bruto = await orqStream(orq, keys, system, [{ role: 'user', content: `Conversa até agora:\n${historico}\n\nEscreva a próxima resposta da EMPRESA.` }], () => {})
  } catch (err) {
    return { texto: '', confianca: 0, faltou: '', memorias: [], erro: erroProvider(err), em: new Date() }
  }
  const j = extrairJson(bruto)
  const texto = String(j?.resposta ?? (j ? '' : bruto)).trim().slice(0, max)
  const usou = (Array.isArray(j?.usou) ? j.usou : []).map(Number).filter(n => n >= 1 && n <= docs.length)
  return {
    texto,
    confianca: Math.max(0, Math.min(1, Number(j?.confianca) || 0)),
    faltou: String(j?.faltou || '').trim().slice(0, 300),
    memorias: (usou.length ? usou.map(n => docs[n - 1]) : docs.slice(0, 3)).map(d => ({ id: d.id, title: d.title || (d.resumo || d.content || '').slice(0, 60) })),
    consultadas: docs.length,
    motor: `${orq.provider}${orq.model ? `/${orq.model}` : ''}`,
    em: new Date(),
  }
}

/* envia pelo canal e registra. `ia` marca resposta que saiu sem mão humana. */
async function enviarResposta(conv, texto, { por, ia = false } = {}) {
  texto = String(texto || '').trim()
  if (!texto) throw new Error('Resposta vazia.')
  if (conv.canal !== CANAL_TESTE) {
    const conector = canalPorId(conv.canal)
    const canal = await canaisCol().findOne({ id: conv.canal })
    if (!conector || !canal?.tokens?.access) throw new Error('Canal desconectado.')
    const tokens = await conector.renovar(canal.cfg, canal.tokens, canal.conta)
    if (tokens !== canal.tokens) await canaisCol().updateOne({ id: conv.canal }, { $set: { tokens } })
    await conector.enviar(canal.cfg, tokens, canal.conta, conv, texto)
  }
  const msg = { id: `env_${Date.now()}`, de: 'empresa', texto, em: new Date(), por: por || null, ia }
  await atendCol().updateOne({ _id: conv._id }, {
    $push: { mensagens: msg },
    $set: { status: 'respondida', rascunho: null, atualizadaEm: new Date() },
  })
  return msg
}

/* A resposta que uma PESSOA mandou vira memória — quando ela não é só o
   rascunho aprovado. Rascunho aprovado sem mudança não ensina nada novo. */
const normTxt = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, ' ').trim()
async function aprenderComResposta(conv, pergunta, texto, por) {
  if (!pergunta || normTxt(conv.rascunho?.texto) === normTxt(texto)) return null
  const m = await memCreate({
    title: `Atendimento: ${(conv.assunto || pergunta).replace(/\s+/g, ' ').slice(0, 50)}`,
    content: `Cliente perguntou${conv.assunto ? ` sobre "${conv.assunto}"` : ''}: ${pergunta}\nResposta aprovada pela empresa: ${texto}`,
    tags: ['atendimento', conv.canal],
    resumo: pergunta.slice(0, 220),
  })
  officeEvent('memoria_atendimento', { memoria: m.id, canal: conv.canal, por })
  return m
}

async function processarConversa(conv, canalDoc) {
  const modo = conv.canal === CANAL_TESTE ? 'sugerir' : (canalDoc?.modo || 'sugerir')
  if (modo === 'manual' || !perguntaAberta(conv)) return
  const r = await gerarRascunho(conv)
  if (!r) return
  await atendCol().updateOne({ _id: conv._id }, { $set: { rascunho: r, status: 'aguardando', atualizadaEm: new Date() } })
  const limiar = typeof canalDoc?.limiar === 'number' ? canalDoc.limiar : 0.85
  if (modo === 'automatico' && r.texto && !r.faltou && r.confianca >= limiar) {
    try { await enviarResposta({ ...conv, rascunho: r }, r.texto, { ia: true }) }
    catch (err) { await atendCol().updateOne({ _id: conv._id }, { $set: { erroEnvio: err.message } }) }
  }
}

/* grava o que o canal devolveu: conversa nova entra, conhecida ganha só as
   mensagens que ainda não tinha. Rascunho é refeito só se chegou coisa nova. */
async function guardarConversas(canalId, lista, canalDoc) {
  let novas = 0
  for (const c of lista) {
    const chave = `${canalId}:${c.externoId}`
    const atual = await atendCol().findOne({ chave })
    const ids = new Set((atual?.mensagens || []).map(m => m.id))
    const chegaram = (c.mensagens || []).filter(m => m.id && !ids.has(m.id) && String(m.texto || '').trim())
    if (atual && !chegaram.length) continue
    const agora = new Date()
    if (!atual) {
      await atendCol().insertOne({
        chave, canal: canalId, externoId: c.externoId, tipo: c.tipo, assunto: c.assunto || '',
        cliente: c.cliente || {}, ref: c.ref || {}, mensagens: chegaram, status: 'nova',
        rascunho: null, criadaEm: agora, atualizadaEm: agora,
      })
    } else {
      await atendCol().updateOne({ chave }, {
        $push: { mensagens: { $each: chegaram } },
        $set: { ref: { ...atual.ref, ...c.ref }, status: 'nova', atualizadaEm: agora, ...(c.assunto && !atual.assunto ? { assunto: c.assunto } : {}) },
      })
    }
    novas += chegaram.filter(m => m.de === 'cliente').length
    processarConversa(await atendCol().findOne({ chave }), canalDoc).catch(() => {})
  }
  return novas
}

const sincronizando = new Set()
async function sincronizarCanal(id) {
  if (sincronizando.has(id)) return { pulou: true }
  sincronizando.add(id)
  try {
    const conector = canalPorId(id)
    const doc = await canaisCol().findOne({ id })
    if (!conector || !doc?.tokens?.access || doc.ativo === false) return { pulou: true }
    try {
      const tokens = await conector.renovar(doc.cfg, doc.tokens, doc.conta)
      if (tokens !== doc.tokens) await canaisCol().updateOne({ id }, { $set: { tokens } })
      const lista = await conector.puxar(doc.cfg, tokens, doc.conta)
      const novas = await guardarConversas(id, lista, doc)
      await canaisCol().updateOne({ id }, { $set: { ultimaSync: new Date(), erro: null } })
      return { novas }
    } catch (err) {
      await canaisCol().updateOne({ id }, { $set: { ultimaSync: new Date(), erro: err.message } })
      return { erro: err.message }
    }
  } finally { sincronizando.delete(id) }
}

async function cicloAtendimento() {
  const ativos = await canaisCol().find({ ativo: { $ne: false }, 'tokens.access': { $exists: true } }, { projection: { id: 1 } }).toArray()
  for (const c of ativos) await sincronizarCanal(c.id)
}

const convOut = (c) => ({ ...c, _id: String(c._id), ref: undefined, pergunta: perguntaAberta(c) })
async function convPorId(id) {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) return null
  return atendCol().findOne({ _id: new ObjectId(id) })
}

// ── canais ──
app.get('/api/office/atendimento/canais', officeAuth, async (req, res) => {
  try {
    const docs = await canaisCol().find({}).toArray()
    const por = new Map(docs.map(d => [d.id, d]))
    res.json(CANAIS.map(c => ({ ...publicoCanal(c, por.get(c.id)), redirect: redirectDoCanal(c.id) })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/office/atendimento/canais/:id', officeAuth, async (req, res) => {
  try {
    const conector = canalPorId(req.params.id)
    if (!conector) return res.status(404).json({ error: 'canal desconhecido' })
    const b = req.body || {}
    const set = { atualizadoPor: req.user.email, atualizadoEm: new Date() }
    for (const c of conector.campos) {
      if (b.cfg?.[c.k] === undefined) continue
      const v = String(b.cfg[c.k] ?? '').trim()
      if (c.tipo === 'secret' && v.startsWith('••••')) continue // máscara voltou intacta
      if (c.tipo === 'select' && v && !c.opcoes.includes(v)) continue
      set[`cfg.${c.k}`] = v
    }
    if (MODOS_ATEND.includes(b.modo)) set.modo = b.modo
    if (b.limiar !== undefined) set.limiar = Math.max(0.5, Math.min(0.99, Number(b.limiar) || 0.85))
    if (b.ativo !== undefined) set.ativo = !!b.ativo
    if (b.aprender !== undefined) set.aprender = !!b.aprender
    await canaisCol().updateOne({ id: conector.id }, { $set: { id: conector.id, ...set } }, { upsert: true })
    res.json({ ...publicoCanal(conector, await canaisCol().findOne({ id: conector.id })), redirect: redirectDoCanal(conector.id) })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// começa o login no canal: devolve a URL pra onde o navegador vai
app.post('/api/office/atendimento/canais/:id/conectar', officeAuth, async (req, res) => {
  try {
    const conector = canalPorId(req.params.id)
    const doc = await canaisCol().findOne({ id: req.params.id })
    if (!conector) return res.status(404).json({ error: 'canal desconhecido' })
    const cfg = doc?.cfg || {}
    if (conector.campos.some(c => c.tipo !== 'select' && !cfg[c.k])) return res.status(400).json({ error: 'Preencha as credenciais do app antes de conectar.' })
    const state = crypto.randomBytes(18).toString('hex')
    await canaisCol().updateOne({ id: conector.id }, { $set: { oauth: { state, ate: new Date(Date.now() + 15 * 60_000), por: req.user.email } } })
    res.json({ url: conector.urlAutorizacao(cfg, redirectDoCanal(conector.id), state) })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// volta do login (pública: quem chama é o navegador, vindo do canal)
app.get('/api/atendimento/oauth/:id', limitLogin, async (req, res) => {
  const conector = canalPorId(req.params.id)
  const volta = (q) => res.redirect(`/?tab=atendimento&${new URLSearchParams(q)}`)
  try {
    const doc = await canaisCol().findOne({ id: req.params.id })
    const state = String(req.query.state || '')
    if (!conector || !doc?.oauth?.state || state.length !== doc.oauth.state.length ||
      !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(doc.oauth.state)) || new Date(doc.oauth.ate) < new Date()) {
      return volta({ canal: req.params.id, erro: 'state' })
    }
    const { tokens, conta } = await conector.trocarCodigo(doc.cfg, req.query, redirectDoCanal(conector.id))
    await canaisCol().updateOne({ id: conector.id }, { $set: { tokens, conta, ativo: true, erro: null, conectadoPor: doc.oauth.por, conectadoEm: new Date() }, $unset: { oauth: '' } })
    officeEvent('canal_conectado', { canal: conector.id, conta: conta?.nome, por: doc.oauth.por })
    sincronizarCanal(conector.id).catch(() => {})
    volta({ canal: conector.id, ok: '1' })
  } catch (err) {
    await canaisCol().updateOne({ id: req.params.id }, { $set: { erro: err.message } }).catch(() => {})
    volta({ canal: req.params.id, erro: 'troca' })
  }
})

app.delete('/api/office/atendimento/canais/:id/conexao', officeAuth, async (req, res) => {
  try {
    await canaisCol().updateOne({ id: req.params.id }, { $unset: { tokens: '', conta: '', oauth: '' }, $set: { erro: null } })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/office/atendimento/canais/:id/sincronizar', officeAuth, async (req, res) => {
  try { res.json(await sincronizarCanal(req.params.id)) } catch (err) { res.status(500).json({ error: err.message }) }
})

/* aviso de "tem coisa nova" (ML notifications / Shopee push). O corpo não é
   confiável e nem é lido: só dispara uma sincronização, que busca na API. */
const ultimoAviso = new Map()
app.post('/api/atendimento/aviso/:id', (req, res) => {
  res.sendStatus(200)
  const id = req.params.id
  if (!canalPorId(id) || Date.now() - (ultimoAviso.get(id) || 0) < 10_000) return
  ultimoAviso.set(id, Date.now())
  sincronizarCanal(id).catch(() => {})
})

// ── conversas ──
app.get('/api/office/atendimento/conversas', officeAuth, async (req, res) => {
  try {
    const filtro = req.query.status === 'abertas' ? { status: { $in: ['nova', 'aguardando'] } }
      : req.query.status === 'arquivadas' ? { status: 'arquivada' }
      : { status: { $ne: 'arquivada' } }
    if (req.query.canal) filtro.canal = String(req.query.canal)
    const lista = await atendCol().find(filtro).sort({ atualizadaEm: -1 }).limit(200).toArray()
    const abertas = await atendCol().countDocuments({ status: { $in: ['nova', 'aguardando'] } })
    res.json({ abertas, conversas: lista.map(convOut) })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/office/atendimento/conversas/:id', officeAuth, async (req, res) => {
  const c = await convPorId(req.params.id)
  c ? res.json(convOut(c)) : res.status(404).json({ error: 'não achei' })
})

// envia (texto da pessoa, ou o rascunho como está)
app.post('/api/office/atendimento/conversas/:id/responder', officeAuth, async (req, res) => {
  try {
    const conv = await convPorId(req.params.id)
    if (!conv) return res.status(404).json({ error: 'não achei' })
    const texto = String(req.body?.texto || '').trim()
    const pergunta = perguntaAberta(conv)
    const msg = await enviarResposta(conv, texto, { por: req.user.email })
    const canal = conv.canal === CANAL_TESTE ? null : await canaisCol().findOne({ id: conv.canal })
    let memoria = null
    if (canal?.aprender !== false) memoria = await aprenderComResposta(conv, pergunta, texto, req.user.email).catch(() => null)
    res.json({ msg, memoria: memoria ? { id: memoria.id, title: memoria.title, fundida: !!memoria.fundida } : null })
  } catch (err) { res.status(502).json({ error: err.message }) }
})

// refaz o rascunho (depois de ensinar algo, ou só pra tentar de novo)
app.post('/api/office/atendimento/conversas/:id/rascunho', officeAuth, async (req, res) => {
  try {
    const conv = await convPorId(req.params.id)
    if (!conv) return res.status(404).json({ error: 'não achei' })
    const r = await gerarRascunho(conv)
    await atendCol().updateOne({ _id: conv._id }, { $set: { rascunho: r, atualizadaEm: new Date(), ...(r ? { status: 'aguardando' } : {}) } })
    res.json(r)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// "ensinar": o fato que faltou vira memória da casa e o rascunho é refeito
app.post('/api/office/atendimento/conversas/:id/ensinar', officeAuth, async (req, res) => {
  try {
    const conv = await convPorId(req.params.id)
    if (!conv) return res.status(404).json({ error: 'não achei' })
    const fato = String(req.body?.fato || '').trim()
    if (fato.length < 3) return res.status(400).json({ error: 'Escreva o que a IA precisa saber.' })
    const m = await memCreate({ content: fato, tags: ['atendimento', 'ensinado'], resumo: fato.slice(0, 220) })
    officeEvent('memoria_atendimento', { memoria: m.id, canal: conv.canal, por: req.user.email, ensinado: true })
    // o embedding é gravado em background; sem esperar, o recall não acha o que acabou de entrar
    for (let i = 0; i < 12; i++) {
      const d = await memorias().findOne({ id: m.id }, { projection: { embedding: 1 } })
      if (!OLLAMA_URL || d?.embedding?.length) break
      await new Promise(r => setTimeout(r, 400))
    }
    const r = await gerarRascunho(conv)
    await atendCol().updateOne({ _id: conv._id }, { $set: { rascunho: r, atualizadaEm: new Date() } })
    res.json({ memoria: { id: m.id, title: m.title, fundida: !!m.fundida }, rascunho: r })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/office/atendimento/conversas/:id', officeAuth, async (req, res) => {
  try {
    const conv = await convPorId(req.params.id)
    if (!conv) return res.status(404).json({ error: 'não achei' })
    const set = { atualizadaEm: new Date() }
    if (req.body?.arquivar === true) set.status = 'arquivada'
    if (req.body?.arquivar === false) set.status = perguntaAberta(conv) ? 'nova' : 'respondida'
    await atendCol().updateOne({ _id: conv._id }, { $set: set })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* canal de ensaio: a pessoa escreve como cliente, a IA responde com as
   memórias. Mesma engrenagem dos canais reais, sem sair do painel. */
app.post('/api/office/atendimento/teste', officeAuth, async (req, res) => {
  try {
    const texto = String(req.body?.texto || '').trim().slice(0, 2000)
    if (!texto) return res.status(400).json({ error: 'Escreva a mensagem do cliente.' })
    const msg = { id: `t_${Date.now()}`, de: 'cliente', texto, em: new Date() }
    let conv = req.body?.conversa ? await convPorId(req.body.conversa) : null
    if (conv && conv.canal === CANAL_TESTE) {
      await atendCol().updateOne({ _id: conv._id }, { $push: { mensagens: msg }, $set: { status: 'nova', atualizadaEm: new Date() } })
    } else {
      const r = await atendCol().insertOne({
        chave: `teste:${Date.now()}`, canal: CANAL_TESTE, externoId: '', tipo: 'chat',
        assunto: String(req.body?.assunto || '').slice(0, 120), cliente: { nome: 'Cliente de teste' }, ref: {},
        mensagens: [msg], status: 'nova', rascunho: null, criadaEm: new Date(), atualizadaEm: new Date(),
      })
      conv = { _id: r.insertedId }
    }
    conv = await atendCol().findOne({ _id: conv._id })
    const r = await gerarRascunho(conv)
    await atendCol().updateOne({ _id: conv._id }, { $set: { rascunho: r, status: 'aguardando' } })
    res.json(convOut(await atendCol().findOne({ _id: conv._id })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* ══════════════════════════════════════════════════════════════════════════
 * INTEGRAÇÕES — conectar softwares (lib/integracoes.js)
 * ══════════════════════════════════════════════════════════════════════════ */
async function listarIntegracoes() {
  const docs = await db.collection('office_integracoes').find({}).toArray()
  const por = new Map(docs.map(d => [d.id, d]))
  return INTEGRACOES.map(i => mascararIntegracao(i, por.get(i.id)))
}
app.get('/api/office/integracoes', officeAuth, async (req, res) => {
  try { res.json(await listarIntegracoes()) } catch (err) { res.status(500).json({ error: err.message }) }
})
app.patch('/api/office/integracoes/:id', officeAuth, async (req, res) => {
  try {
    const item = integracaoPorId(req.params.id)
    if (!item) return res.status(404).json({ error: 'unknown_integration' })
    const atual = await db.collection('office_integracoes').findOne({ id: item.id })
    const config = mesclarIntegracao(item, atual?.config, req.body || {})
    await db.collection('office_integracoes').updateOne(
      { id: item.id },
      { $set: { id: item.id, config, por: req.user.email, atualizadaEm: new Date() }, $setOnInsert: { conectadaEm: new Date() } },
      { upsert: true },
    )
    officeEvent('integracao_conectada', { id: item.id, por: req.user.email })
    res.json(mascararIntegracao(item, await db.collection('office_integracoes').findOne({ id: item.id })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})
app.delete('/api/office/integracoes/:id', officeAuth, async (req, res) => {
  try {
    await db.collection('office_integracoes').deleteOne({ id: req.params.id })
    officeEvent('integracao_removida', { id: req.params.id, por: req.user.email })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})
/* Testa de verdade. Com body, testa o que foi digitado (sem salvar);
   sem body, testa o que está salvo. */
app.post('/api/office/integracoes/:id/testar', officeAuth, limitTeste, async (req, res) => {
  const item = integracaoPorId(req.params.id)
  if (!item) return res.status(404).json({ error: 'unknown_integration' })
  const atual = await db.collection('office_integracoes').findOne({ id: item.id })
  const config = mesclarIntegracao(item, atual?.config, req.body || {})
  const resultado = { em: new Date() }
  const faltando = item.campos.filter(c => c.k !== 'eventos' && c.k !== 'env' && c.k !== 'chatId' && !String(config[c.k] || '').trim())
  if (faltando.length) return res.json({ ...resultado, ok: false, texto: `Fill in: ${faltando.map(c => c.rotulo).join(', ')}.` })
  try {
    resultado.ok = true
    resultado.texto = await item.testar(config)
  } catch (e) {
    resultado.ok = false
    resultado.texto = e.name === 'TimeoutError' ? 'Timed out — the service did not answer.' : e.message
  }
  if (atual) await db.collection('office_integracoes').updateOne({ id: item.id }, { $set: { ultimoTeste: resultado } }).catch(() => {})
  res.json(resultado)
})

/* ══════════════════════════════════════════════════════════════════════════
 * CLI — o que o painel sabe sobre o `nomade` instalado nas máquinas
 * ══════════════════════════════════════════════════════════════════════════ */
let cliInfoCache = null
app.get('/api/office/cli/info', officeAuth, (req, res) => {
  if (!cliInfoCache) {
    let versao = null
    try { versao = JSON.parse(readFileSync(new URL('./cli/package.json', import.meta.url), 'utf8')).version } catch { /* sem pacote */ }
    cliInfoCache = { versao, pacote: `${PAINEL_URL}/cli/nomade-cli.tgz` }
  }
  res.json(cliInfoCache)
})
app.get('/api/office/cli/sessoes', officeAuth, async (req, res) => {
  try {
    const lista = await db.collection('office_cli_sessions').find({}).sort({ criadoEm: -1 }).limit(100).toArray()
    res.json(lista.map(s => ({ jti: s.jti, email: s.email, criadoEm: s.criadoEm, ultimoUso: s.ultimoUso, revogada: !!s.revogada, agente: s.agente || null })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})
app.delete('/api/office/cli/sessoes/:jti', officeAuth, async (req, res) => {
  try {
    await db.collection('office_cli_sessions').updateOne({ jti: req.params.jti }, { $set: { revogada: true, revogadaEm: new Date(), revogadaPor: req.user.email } })
    sessoesRevogadas.add(req.params.jti)
    officeEvent('cli_sessao_revogada', { jti: req.params.jti, por: req.user.email })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// de quem é esta memória — o CLI e o MCP mostram, pra ninguém gravar na empresa errada
app.get('/api/office/empresa', officeAuth, (req, res) => {
  res.json({ id: empresaAtual?.id, nome: empresaAtual?.nome })
})

app.get('/api/office/memories', officeAuth, async (req, res) => {
  try {
    const { q, tag, project } = req.query
    if (q) return res.json(await memSearch(String(q), 30))
    const filter = {}
    if (tag) filter.tags = tag
    if (project) filter.project = project
    const docs = await memorias()
      .find(filter, { projection: { embedding: 0 } }).sort({ updatedAt: -1 }).limit(500).toArray()
    res.json(docs.map(memOut))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/office/memories', officeAuth, async (req, res) => {
  try {
    if (!req.body?.content?.trim()) return res.status(400).json({ error: 'content obrigatório' })
    const m = await memCreate(req.body)
    officeEvent('memoria_criada', { titulo: m.title || m.content.slice(0, 60), por: req.user.email })
    res.json(m)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/office/memories/:id', officeAuth, async (req, res) => {
  try {
    const set = { updatedAt: new Date() }
    for (const k of ['title', 'content', 'resumo']) if (req.body[k] !== undefined) set[k] = req.body[k]
    if (req.body.tags !== undefined) set.tags = toTags(req.body.tags)
    // `project` sozinho deixava o `escopo` (o que o recall filtra) pra trás
    if (req.body.project !== undefined) {
      const escopo = await resolverEscopo(req.body.project)
      Object.assign(set, { project: escopo.projeto || undefined, escopo }, escopo.resolvido ? {} : { status: 'pendente' })
    }
    await memorias().updateOne({ id: req.params.id }, { $set: set })
    // conteúdo mudou → re-embeda e religa
    if (set.content !== undefined || set.title !== undefined || set.resumo !== undefined) {
      const doc = await memorias().findOne({ id: req.params.id })
      if (doc) void embedText(textoParaEmbedar(doc)).then(async (vec) => {
        if (!vec.length) return
        await memorias().updateOne({ id: doc.id }, { $set: { embedding: vec } })
        await linkMemory(doc.id).catch(() => {})
      }).catch(() => {})
    }
    const out = await memorias().findOne({ id: req.params.id }, { projection: { embedding: 0 } })
    res.json(out ? memOut(out) : null)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/office/memories/:id', officeAuth, async (req, res) => {
  try {
    await memorias().deleteOne({ id: req.params.id })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// status do embedder + backfill (memórias salvas com o Ollama fora voltam pro grafo)
/* MANUTENÇÃO DA BASE — tudo nos modelos LOCAIS, de graça.
   Três passadas: (1) título e tag no que está sem, (2) embedding no que ficou
   pra trás, (3) religa o grafo inteiro. Antes isto só fazia embedding, e
   memória sem título ficava sem título pra sempre.
   Título/tag é caro em TEMPO (uma chamada por memória), então vai de 10 em 10:
   chamar de novo continua de onde parou. */
app.post('/api/office/memories/backfill', officeAuth, async (req, res) => {
  try {
    const c = memorias()

    const semRotulo = await c.find(
      { $or: [{ title: { $in: [null, ''] } }, { title: { $exists: false } }, { tags: { $size: 0 } }, { tags: { $exists: false } }] },
      { projection: { id: 1, title: 1, content: 1, tags: 1 } }
    ).limit(10).toArray()
    let rotulados = 0
    for (const d of semRotulo) {
      const patch = {}
      if (!d.title) { const t = await tituloLocal(d.content); if (t) patch.title = t }
      if (!d.tags?.length) { const g = await tagsLocal(`${d.title || ''}\n${d.content}`); if (g.length) patch.tags = g }
      if (Object.keys(patch).length) { await c.updateOne({ id: d.id }, { $set: patch }); rotulados++ }
    }

    // `resumo` NA PROJEÇÃO: sem ele o backfill leria um doc sem o campo e
    // embeddaria title+content, desfazendo a mudança sem dar erro
    const semVetor = await c.find({ embedding: { $exists: false } }, { projection: { id: 1, title: 1, content: 1, resumo: 1 } }).limit(30).toArray()
    let embeddados = 0
    for (const d of semVetor) {
      const vec = await embedText(textoParaEmbedar(d))
      if (vec.length) { await c.updateOne({ id: d.id }, { $set: { embedding: vec } }); embeddados++ }
    }

    // religa TODAS (não só as novas): quem entrou depois nunca virou vizinha das antigas
    const religadas = await rebuildLinks().catch(() => 0)

    const pendentes = await c.countDocuments({
      $or: [{ title: { $in: [null, ''] } }, { title: { $exists: false } }, { tags: { $size: 0 } }, { tags: { $exists: false } }, { embedding: { $exists: false } }],
    })
    res.json({
      rotulados, embeddados, religadas, pendentes,
      embedder: !!OLLAMA_URL,
      aviso: OLLAMA_URL ? undefined : 'sem OLLAMA_URL: não dá pra gerar título, tag nem embedding — só o religamento rodou',
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* SAÚDE DA MEMÓRIA — diagnóstico de uma olhada só.
   Nasceu de um problema real: o OLLAMA_URL ficou vazio por meses, então
   NENHUMA memória tinha embedding, o grafo nunca foi construído, e o recall
   rodava em regex — tudo isso em silêncio, porque degradar sem quebrar é o
   desenho. Aqui o silêncio vira número.
   `alcancavel` é o que importa depois de um deploy: a variável estar
   preenchida não prova que o container chega no PC da LAN. */
app.get('/api/office/memories/status', officeAuth, async (req, res) => {
  try {
    const c = memorias()
    const [total, comVetor, comLinks] = await Promise.all([
      c.countDocuments({}),
      c.countDocuments({ embedding: { $type: 'array' } }),
      c.countDocuments({ 'links.0': { $exists: true } }),
    ])
    const semRotulo = await c.countDocuments({
      $or: [{ title: { $in: [null, ''] } }, { title: { $exists: false } }, { tags: { $size: 0 } }, { tags: { $exists: false } }],
    })

    let alcancavel = false
    let modelos = []
    if (OLLAMA_URL) {
      try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) })
        if (r.ok) {
          alcancavel = true
          modelos = ((await r.json())?.models || []).map(m => m.name)
        }
      } catch { /* PC dormindo ou fora da rota — é a informação que queremos */ }
    }
    const temModelo = (nome) => modelos.some(m => m === nome || m.startsWith(`${nome}:`))

    res.json({
      total, comVetor, semVetor: total - comVetor, comLinks, semRotulo,
      embedder: {
        url: OLLAMA_URL || null,
        alcancavel,
        modeloEmbedding: EMBED_MODEL,
        temModeloEmbedding: alcancavel ? temModelo(EMBED_MODEL) : null,
        modeloTexto: TEXTO_MODEL,
        temModeloTexto: alcancavel ? temModelo(TEXTO_MODEL) : null,
      },
      diagnostico: !OLLAMA_URL
        ? 'OLLAMA_URL vazio: busca em regex, sem embedding e sem grafo.'
        : !alcancavel
          ? `Não alcancei ${OLLAMA_URL} daqui — PC desligado, ou o container não chega nessa rede.`
          : comVetor < total
            ? `${total - comVetor} memória(s) sem embedding. Roda o backfill até zerar.`
            : comLinks ? 'Memória saudável.' : 'Todas embeddadas, mas sem associações — roda o backfill pra religar o grafo.',
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* Projetos existentes com contagem — o campo `project` já existia nas memórias
   e nada listava quais são. */
/* A LISTA FECHADA, servida de um lugar só. O /projetos logo abaixo agrega os
   valores que já existem no banco — serve pra diagnóstico, mas NÃO serve de
   vocabulário: derivar a lista do dado sujo legitima a grafia errada. */
app.get('/api/office/escopos', officeAuth, async (req, res) => {
  try { res.json({ escopos: await escoposValidos(), novo: ESCOPO_NOVO }) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

/* ═══ CURADORIA ══════════════════════════════════════════════════════════
   A memória cresce por dois caminhos e nenhum dos dois é perfeito: o agent
   grava no meio do trabalho, e (quando existir) o worker extrai de sessão
   encerrada. Sem um lugar onde um humano olhe, a base apodrece — foi assim
   que 6 assuntos viraram 11 grafias.

   Isto NÃO é um CRUD. É uma lista de trabalho ordenada por quanto cada item
   atrapalha o recall HOJE, com uma ação por item. Quem abre resolve os três
   do topo e fecha, sem precisar entender o sistema.

   A ordem é a tese:
   1. casa sem tipo — aparece na busca de TODO cliente. Enquanto `tipo` for
      null a regra de transição deixa passar; no instante em que vira
      `decisao`, some das sessões de cliente. É a ação de maior impacto.
   2. lacuna — registrou que decidiu sem registrar o quê. Preencher recupera
      decisão perdida.
   3. cadeia — arquivado apontando pro que o substituiu; confere se está certo.
   4. cliente sem tipo — já isolado pelo escopo, então classificar só organiza. */
const TIPOS = ['convencao', 'decisao', 'preferencia', 'fato_cliente', 'playbook']

/* O modelo local pré-classifica; o humano CONFIRMA num toque em vez de
   julgar do zero. É uma decisão `choice` (lib/decisoes.js): volta a
   probabilidade de cada tipo, e palpite com confiança baixa NÃO vira
   sugestão — a tela mostra os botões, que é melhor que um chute bem vestido.
   Sem motor de decisão não há palpite: perde velocidade, não perde função. */
const TIPO_DESC = {
  convencao: 'regra ou processo que vale SEMPRE, em qualquer projeto (ex: todo post fica 7 dias em revisão)',
  decisao: 'algo combinado UMA vez, para um caso ou projeto específico',
  preferencia: 'como os sócios gostam que as coisas sejam feitas',
  fato_cliente: `verdade sobre uma EMPRESA CLIENTE que contratou a ${EMPRESA.nome} (a stack dela, o prazo dela). Sócio, funcionário ou squad da própria ${EMPRESA.nome} NÃO é cliente`,
  playbook: 'trecho de manual interno (motion, design, copy)',
}
const CONFIANCA_MIN_TIPO = 0.25 // margem do 1º sobre o 2º tipo

async function classificarLocal(doc) {
  if (!motorDisponivel()) return null
  /* Trava estrutural: memória sem cliente no escopo NÃO pode ser fato de
     cliente — isso é o que o banco diz, não o que o modelo acha. Então a
     opção nem é oferecida (antes o Gemma chamou o "ICP" de um sócio de
     fato_cliente, e o palpite errado vira carimbo no primeiro toque). */
  const tipos = TIPOS.filter(t => t !== 'fato_cliente' || doc.escopo?.cliente)
  try {
    const { answers: [r] } = await decidir({
      input: `${doc.title || ''}\n${doc.content}`,
      questions: [{
        type: 'choice', name: 'tipo',
        instructions: 'Em qual categoria esta memória da empresa se encaixa?',
        choices: tipos.map(t => ({ value: t, description: TIPO_DESC[t] })),
      }],
    })
    if (r?.type !== 'choice' || r.calibrado === false) return r?.choice || null
    return r.confidence >= CONFIANCA_MIN_TIPO ? r.choice : null
  } catch { return null } // motor fora do ar não é erro: é ausência de luxo
}

/* Em BACKGROUND, como o titulador: a tela não espera o modelo local. Primeira
   abertura pode vir sem palpite; a seguinte já tem. */
function preClassificarEmBackground(ids) {
  void (async () => {
    const c = memorias()
    for (const id of ids.slice(0, 12)) { // de 12 em 12: cada uma é uma ida ao modelo
      const doc = await c.findOne({ id }, { projection: { title: 1, content: 1, escopo: 1 } })
      if (!doc) continue
      const tipo = await classificarLocal(doc)
      await c.updateOne({ id }, { $set: { tipoSugerido: tipo, tipoSugeridoEm: new Date() } })
    }
  })().catch(() => {})
}

const paraCuradoria = (m) => ({
  id: m.id,
  titulo: m.title || null,
  conteudo: m.content,
  escopo: m.escopo?.clienteRotulo || m.escopo?.projeto || null,
  tipo: m.tipo || null,
  tipoSugerido: m.tipoSugerido || null,
  lacuna: m.lacuna || null,
  perguntarNoGrupo: !!m.perguntarNoGrupo,
  substituiPor: m.substituiPor || null,
  // quem mexeu fica visível: classificação muda o que TODO mundo vê no recall,
  // inclusive nas sessões de código. Sem isto não há onde olhar quando algo
  // estranho aparece na busca.
  por: m.classificadoPor || null,
  em: m.classificadoEm || null,
})

app.get('/api/office/memories/curadoria', officeAuth, async (req, res) => {
  try {
    const c = memorias()
    const todas = await c.find({}, { projection: { embedding: 0 } }).toArray()
    const semTipo = (m) => !m.tipo
    const daCasa = (m) => !m.escopo?.cliente

    const bandas = [
      {
        id: 'casa',
        titulo: 'Aparece em toda sessão',
        ajuda: 'Memória da casa não tem dono, então entra na busca de todo cliente. Dizer o que ela é decide se continua entrando.',
        itens: todas.filter(m => m.status === 'ativo' && daCasa(m) && semTipo(m)),
      },
      {
        id: 'lacuna',
        titulo: 'Falta o dado',
        ajuda: 'Alguém registrou que decidiu, sem registrar o quê.',
        itens: todas.filter(m => m.status === 'incompleto'),
      },
      {
        id: 'cadeia',
        titulo: 'Confere a substituição',
        ajuda: 'Foi arquivada porque outra memória a substituiu. Confere se está certo.',
        itens: todas.filter(m => m.status === 'arquivado' && !m.cadeiaConferidaEm),
      },
      {
        id: 'cliente',
        titulo: 'Só falta o tipo',
        ajuda: 'De cliente. Não muda o que aparece — organiza pra depois.',
        itens: todas.filter(m => m.status === 'ativo' && !daCasa(m) && semTipo(m)),
      },
    ]

    // pede palpite pro que ainda não tem, sem segurar a resposta
    const semPalpite = bandas.flatMap(b => b.itens).filter(m => !m.tipoSugerido && !m.tipo).map(m => m.id)
    if (semPalpite.length && OLLAMA_URL) preClassificarEmBackground(semPalpite)

    res.json({
      total: bandas.reduce((n, b) => n + b.itens.length, 0),
      analisando: OLLAMA_URL ? semPalpite.length : 0, // 0 sem Ollama: a tela cai nas frases de exemplo
      gemma: !!OLLAMA_URL,
      bandas: bandas.map(b => ({ ...b, total: b.itens.length, itens: b.itens.map(paraCuradoria) })),
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* Escreve na hora e o desfazer é a chamada inversa — não um timer que segura
   a escrita. Fechar a aba no meio do desfazer não pode deixar a base num
   estado que ninguém escolheu. */
app.post('/api/office/memories/:id/classificar', officeAuth, async (req, res) => {
  try {
    const tipo = req.body?.tipo ?? null
    if (tipo !== null && !TIPOS.includes(tipo)) return res.status(400).json({ error: `tipo inválido: ${tipo}` })
    await memorias().updateOne({ id: req.params.id }, {
      $set: {
        tipo,
        classificadoPor: tipo ? req.user.email : null,
        classificadoEm: tipo ? new Date() : null,
        updatedAt: new Date(),
      },
    })
    res.json({ ok: true, tipo })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* Lacuna preenchida ANEXA ao texto em vez de trocar: o registro de que a
   decisão existiu é o que sobrou dela, e apagar isso perde a única pista.
   "Não sei" NÃO arquiva — marca pra perguntar no grupo. Arquivar seria o
   caminho fácil, e essas quatro são exatamente as perguntas da próxima call. */
app.post('/api/office/memories/:id/lacuna', officeAuth, async (req, res) => {
  try {
    const c = memorias()
    const doc = await c.findOne({ id: req.params.id })
    if (!doc) return res.status(404).json({ error: 'memória não encontrada' })

    if (req.body?.perguntar) {
      await c.updateOne({ id: doc.id }, { $set: { perguntarNoGrupo: true, updatedAt: new Date() } })
      return res.json({ ok: true, perguntarNoGrupo: true })
    }
    if (req.body?.desfazer) {
      await c.updateOne({ id: doc.id }, {
        $set: { content: doc.respostaAnterior ?? doc.content, status: 'incompleto', updatedAt: new Date() },
        $unset: { respostaAnterior: '', respondidoPor: '', respondidoEm: '' },
      })
      return res.json({ ok: true, status: 'incompleto' })
    }

    const resposta = String(req.body?.resposta || '').trim()
    if (resposta.length < 2) return res.status(400).json({ error: 'resposta vazia' })
    await c.updateOne({ id: doc.id }, {
      $set: {
        respostaAnterior: doc.content,
        content: `${doc.content}\n${resposta}`,
        status: 'ativo',
        perguntarNoGrupo: false,
        respondidoPor: req.user.email,
        respondidoEm: new Date(),
        updatedAt: new Date(),
      },
      $unset: { lacuna: '' },
    })
    // texto mudou: re-embeda e religa, senão a resposta nova não é buscável
    enriquecerEmBackground(doc.id, {})
    res.json({ ok: true, status: 'ativo' })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/office/memories/:id/cadeia', officeAuth, async (req, res) => {
  try {
    /* desfazer o "confere" tem que devolver o item pra fila — sem isto o
       desfazer da tela é botão que não faz nada, que é pior que não ter. */
    if (req.body?.desfazer) {
      await memorias().updateOne({ id: req.params.id }, {
        $set: { updatedAt: new Date() },
        $unset: { cadeiaConferidaPor: '', cadeiaConferidaEm: '' },
      })
      return res.json({ ok: true, desfeito: true })
    }
    const confere = req.body?.confere !== false
    await memorias().updateOne({ id: req.params.id }, {
      $set: confere
        // conferida continua arquivada, mas sai da fila
        ? { cadeiaConferidaPor: req.user.email, cadeiaConferidaEm: new Date(), updatedAt: new Date() }
        // "não, desarquiva": volta pro recall e a cadeia se desfaz
        : { status: 'ativo', substituiPor: null, cadeiaConferidaPor: null, cadeiaConferidaEm: null, updatedAt: new Date() },
    })
    res.json({ ok: true, confere })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* A saída pro caso que já aconteceu: doc no cliente errado. Único
   campo editável da tela, e de propósito — não é editor de memória. */
app.post('/api/office/memories/:id/escopo', officeAuth, async (req, res) => {
  try {
    const escopo = await resolverEscopo(req.body?.projeto, req.body?.projetoSugerido)
    if (!escopo.resolvido) return res.status(400).json({ error: 'escopo fora da lista' })
    await memorias().updateOne({ id: req.params.id }, {
      $set: { escopo, project: escopo.projeto || undefined, escopoPor: req.user.email, escopoEm: new Date(), updatedAt: new Date() },
    })
    res.json({ ok: true, escopo })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/office/memories/projetos', officeAuth, async (req, res) => {
  try {
    const rows = await memorias().aggregate([
      { $match: { project: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$project', total: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]).toArray()
    res.json(rows.map(r => ({ projeto: String(r._id), total: r.total })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* De quem é esta task. O agent manda só o taskId — se ele tivesse que
   informar o cliente, teria que adivinhar, e adivinhar escopo é a origem do
   problema todo. Board interno (de sócio, Agents…) não tem clientId:
   devolve null, que no filtro quer dizer "só o que é da casa". */
async function clienteDaTask(taskId) {
  const t = await mainDb.collection('nomade_tasks')
    .findOne({ _id: new ObjectId(String(taskId)) }, { projection: { boardId: 1, clientEmail: 1 } })
  if (!t) return { ok: false, cliente: null }
  if (t.boardId) {
    const b = await mainDb.collection('nomade_boards')
      .findOne({ _id: new ObjectId(String(t.boardId)) }, { projection: { clientId: 1 } })
    if (b?.clientId) return { ok: true, cliente: String(b.clientId) }
  }
  // card do board interno marcado com o e-mail do cliente
  if (t.clientEmail) {
    const c = await mainDb.collection('nomade_clients')
      .findOne({ email: String(t.clientEmail).toLowerCase() }, { projection: { _id: 1 } })
    if (c) return { ok: true, cliente: String(c._id) }
  }
  return { ok: true, cliente: null } // board interno: trabalho da casa
}

/* RECALL COMO FERRAMENTA — a mesma busca que alimenta o system prompt do
   orquestrador, exposta por HTTP pro agent do runner consultar DURANTE o
   trabalho. Até hoje a memória da empresa só existia pra quem planeja; quem
   executa nunca a viu. Leitura pura: não embeda, não religa, não grava. */
app.get('/api/office/memories/recall', officeAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.status(400).json({ error: 'q obrigatório' })

    /* ESCOPO. Sem `task` nem `cliente` = busca ampla (a sede, o orquestrador).
       Com `task`, o recall passa a ver só o cliente dela mais o que é da casa.
       Task que NÃO resolve cai em "só a casa", não em "tudo": errar pro lado
       de esconder devolve contexto pobre; errar pro outro põe memória de um
       cliente na sessão de outro, que é o bug que esta camada existe pra
       impedir. E o motivo vai na resposta — silêncio aqui é como se descobre
       três semanas depois. */
    let escopo // undefined = sem filtro
    let escopoNota = 'sem filtro de cliente'
    if (req.query.cliente === 'casa') {
      /* "casa" explícito = só o que não tem dono. É o que uma sessão de código
         quer: convenção do repositório, não fato de cliente. Existe porque
         AUSÊNCIA de cliente significa "sem filtro", e um cliente MCP precisa
         de um jeito de pedir o oposto disso. */
      escopo = null
      escopoNota = 'só memória da casa'
    } else if (req.query.cliente) {
      escopo = String(req.query.cliente)
      escopoNota = 'cliente informado'
    } else if (req.query.task) {
      const r = await clienteDaTask(req.query.task).catch(() => ({ ok: false, cliente: null }))
      escopo = r.cliente
      escopoNota = r.ok
        ? (r.cliente ? 'cliente da task' : 'task de board interno — só memória da casa')
        : 'task não resolvida — fechado na memória da casa'
    }

    const docs = await memRecallDocs(q, ...(escopo === undefined ? [] : [{ cliente: escopo }]))
    res.json({
      q,
      escopo: { cliente: escopo ?? null, nota: escopoNota },
      embedder: !!OLLAMA_URL, // false = veio de regex, não de cosseno (Ollama fora)
      total: docs.length,
      memorias: docs.map((m, i) => ({
        id: m.id,
        titulo: m.title || null,
        // mesma regra do system prompt: inteiro no topo, resumo no resto
        conteudo: (i < PROFUNDOS || !m.resumo) ? m.content : m.resumo,
        resumido: !(i < PROFUNDOS || !m.resumo),
        tags: m.tags || [],
        // escopo canônico primeiro: o `project` legado ainda tem as grafias
        // sujas (nome de cliente com grafia livre) e era isso que
        // o agent estava vendo no [projeto: ...] do buscar_memoria
        projeto: m.escopo?.projeto || m.project || null,
        cliente: m.escopo?.clienteRotulo || null,
        score: m.score ?? null,  // null no caminho regex e nos vizinhos do salto
        origem: m.origem,        // 'direto' = casou com a pergunta · 'salto' = vizinho no grafo
      })),
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// — projetos = CLIENTES (moram no db principal, junto do kanban) —
// Não existe collection de projeto paralela: o que a empresa chama de
// projeto é o cliente + o board dele. Aqui é só leitura pro escritório.
app.get('/api/office/clientes', officeAuth, async (req, res) => {
  try {
    const clientes = await mainDb.collection('nomade_clients').find({}).sort({ name: 1 }).limit(300).toArray()
    const tasks = await mainDb.collection('nomade_tasks')
      .find({ archived: { $ne: true } }, { projection: { title: 1, status: 1, assignee: 1, clientEmail: 1, boardId: 1 } })
      .limit(1000).toArray()
    const decs = await db.collection('office_decisions').find({ status: 'aberta' }).toArray()
    res.json(clientes.map(c => {
      const minhas = tasks.filter(t => t.clientEmail && c.email && t.clientEmail === c.email.toLowerCase())
      return {
        id: c._id.toString(),
        nome: c.name,
        email: c.email || null,
        segmento: c.segment || '',
        plano: c.plan || '',
        status: c.status || 'active',
        tarefasAbertas: minhas.filter(t => t.status !== 'done').length,
        tarefasAgent: minhas.filter(t => String(t.assignee || '').startsWith('agent:')).length,
        decisoes: decs.filter(d => d.projetoId === c._id.toString()).length,
      }
    }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* FICHA DO CLIENTE — o que um agent precisa saber ANTES de trabalhar pra ele.
   `ref` aceita _id, e-mail ou nome (exato, depois substring): o agent sabe o
   nome do cliente, não o ObjectId. É a mesma resolução que o orquestrador já
   faz ao criar card.
   Leitura pura de propósito: NÃO chama boardDoCliente, que CRIA o board se
   não existir — consulta não pode ter efeito colateral. */
app.get('/api/office/clientes/:ref', officeAuth, async (req, res) => {
  try {
    const ref = String(req.params.ref || '').trim()
    if (!ref) return res.status(400).json({ error: 'ref obrigatório' })
    const alvo = ref.toLowerCase()
    const col = mainDb.collection('nomade_clients')
    const campos = { name: 1, email: 1, contact: 1, segment: 1, plan: 1, status: 1, notes: 1, agents: 1 }

    let c = null
    if (/^[a-f0-9]{24}$/i.test(ref)) c = await col.findOne({ _id: new ObjectId(ref) }, { projection: campos }).catch(() => null)
    if (!c) c = await col.findOne({ email: alvo }, { projection: campos })
    if (!c) {
      const todos = await col.find({}, { projection: campos }).limit(300).toArray()
      c = todos.find(x => x.name?.toLowerCase() === alvo)
        || todos.find(x => x.name && (alvo.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(alvo)))
        || null
    }
    if (!c) return res.status(404).json({ error: `Nenhum cliente casa com "${ref}".` })

    const board = await mainDb.collection('nomade_boards').findOne({ clientId: c._id })
    const cols = [...(board?.columns || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    const nomeCol = (id) => cols.find(x => x.id === id)?.name || id
    const concluida = (id) => COLUNA_FINAL.test(nomeCol(id)) || COLUNA_FINAL.test(String(id || ''))

    // task de cliente chega por dois caminhos: board dele, ou clientEmail
    // (card do board interno marcado com o e-mail). Pega os dois.
    const ou = [
      ...(board ? [{ boardId: String(board._id) }] : []),
      ...(c.email ? [{ clientEmail: c.email.toLowerCase() }] : []),
    ]
    const tasks = ou.length
      ? await mainDb.collection('nomade_tasks')
          .find({ archived: { $ne: true }, $or: ou },
            { projection: { title: 1, description: 1, status: 1, assignee: 1, priority: 1, updatedAt: 1 } })
          .sort({ updatedAt: -1 }).limit(120).toArray()
      : []

    const squads = await db.collection('squads').find({}, { projection: { id: 1, name: 1 } }).toArray()
    const responsavel = (a) => String(a || '').startsWith('agent:')
      ? (squads.find(s => s.id === String(a).slice(6))?.name || 'agent removido')
      : (a || null)

    const ids = tasks.map(t => t._id.toString())
    const decs = await db.collection('office_decisions').find({
      status: 'aberta',
      $or: [{ projetoId: c._id.toString() }, ...(ids.length ? [{ taskId: { $in: ids } }] : [])],
    }).limit(20).toArray()

    const abertas = tasks.filter(t => !concluida(t.status))
    const entregues = tasks.filter(t => concluida(t.status))

    res.json({
      id: c._id.toString(),
      nome: c.name,
      email: c.email || null,
      contato: c.contact || '',
      segmento: c.segment || '',
      plano: c.plan || '',
      status: c.status || 'active',
      // campo livre do cliente — é onde mora o combinado que não está em lugar nenhum
      notas: c.notes || '',
      agentsContratados: c.agents || [],
      board: board ? { id: String(board._id), nome: board.name, pastaNoRunner: board.pastaNoRunner || null } : null,
      tarefasAbertas: abertas.slice(0, 20).map(t => ({
        id: t._id.toString(),
        titulo: t.title,
        detalhe: String(t.description || '').slice(0, 300),
        coluna: nomeCol(t.status),
        prioridade: t.priority || 'medium',
        responsavel: responsavel(t.assignee),
      })),
      totalAbertas: abertas.length,
      entreguesRecentes: entregues.slice(0, 8).map(t => ({ titulo: t.title, em: t.updatedAt })),
      decisoesAbertas: decs.map(d => ({ pergunta: d.pergunta, urgencia: d.urgencia })),
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

const KEY_FIELDS = COM_CHAVE
const maskKeyVal = (k) => (k ? `${String(k).slice(0, 6)}…${String(k).slice(-4)}` : '')

// leitura mascarada — pra UI mostrar o que está conectado sem vazar a chave na tela
app.get('/api/office/keys', officeAuth, async (req, res) => {
  try {
    const keys = await getKeys()
    const saved = (await db.collection('office_config').findOne({ id: 'keys' })) || {}
    res.json(KEY_FIELDS.map(f => ({
      provider: f,
      conectada: !!keys[f],
      mascara: maskKeyVal(keys[f]),
      origem: saved[f] ? 'equipe' : keys[f] ? 'servidor' : null, // equipe = colada aqui; servidor = env
    })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// as chaves REAIS — o app da máquina puxa depois de logar (é o que faz
// "conectou uma vez, vale pra todo mundo" funcionar sem colar em cada PC)
app.get('/api/office/keys/raw', officeAuth, async (req, res) => {
  try { res.json(await getKeys()) } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/office/keys', officeAuth, async (req, res) => {
  try {
    const set = {}
    for (const f of KEY_FIELDS) {
      if (req.body[f] === undefined) continue
      const v = String(req.body[f] || '').trim()
      set[f] = v // string vazia = desconecta (volta pro env do servidor, se houver)
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: 'nada pra salvar' })
    set.por = req.user.email
    set.em = new Date()
    await db.collection('office_config').updateOne({ id: 'keys' }, { $set: set }, { upsert: true })
    officeEvent('chaves_atualizadas', { provedores: Object.keys(set).filter(k => KEY_FIELDS.includes(k)), por: req.user.email })
    const keys = await getKeys()
    const saved = (await db.collection('office_config').findOne({ id: 'keys' })) || {}
    res.json(KEY_FIELDS.map(f => ({ provider: f, conectada: !!keys[f], mascara: maskKeyVal(keys[f]), origem: saved[f] ? 'equipe' : keys[f] ? 'servidor' : null })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/* ── Testar chave ──────────────────────────────────────────────────────
   A tela de Chaves dizia "conectada" só porque EXISTE uma string salva.
   Chave revogada, com typo ou de projeto errado aparecia verde igual, e o
   erro só aparecia no chat — na frente de todo mundo. Aqui a gente faz uma
   chamada pequena DE VERDADE, pelo mesmo caminho que a produção usa (teto de
   tokens incluso, que é onde a OpenAI é chata). Verde aqui = responde. */

// o modelo mais barato de cada um (o último da lista é o menor, ou o único)
const MODELO_TESTE = Object.fromEntries(PROVEDORES.map(p => [p.id, { anthropic: 'claude-haiku-4-5', openai: 'gpt-5-mini', gemini: 'gemini-2.5-flash' }[p.id] || p.modelos[p.modelos.length - 1]]))

// "fetch failed" e "operation was aborted" não dizem nada pra quem tá olhando
// a tela — traduz pro que aconteceu.
const erroProvider = (err) => {
  const m = String(err?.message || err || '')
  if (/abort|timeout/i.test(m)) return 'O provedor não respondeu em 25s.'
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(m)) return 'Não consegui alcançar o provedor a partir do servidor (rede/DNS).'
  return m || 'Falhou sem mensagem.'
}

async function testarChave(provider, chave, modelo) {
  const signal = AbortSignal.timeout(25_000)

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: fixClaudeModelId(modelo), max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`)
    return d.model || modelo
  }

  if (provider === 'gemini') {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(chave)}`,
      {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
      })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`)
    return modelo
  }

  // o resto fala o dialeto OpenAI — e é aqui que o campo de teto muda
  const base = provedor(provider)?.base || 'https://api.openai.com/v1'
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, ...tetoTokens(base, 16), messages: [{ role: 'user', content: 'ping' }] }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`)
  return d.model || modelo
}

app.post('/api/office/keys/:provider/testar', officeAuth, limitTeste, async (req, res) => {
  const provider = String(req.params.provider || '')
  if (!KEY_FIELDS.includes(provider)) return res.status(400).json({ error: 'provider desconhecido' })
  try {
    // dá pra testar uma chave AINDA NÃO SALVA: cola, testa, e só então salva
    // pra equipe inteira — em vez de descobrir o problema depois de conectar.
    const chave = String(req.body?.chave || '').trim() || (await getKeys())[provider]
    if (!chave) return res.json({ ok: false, erro: 'Nenhuma chave conectada nesse provedor.' })

    // se é o provider que o orquestrador está usando, testa com o modelo que o
    // chat usa DE VERDADE — assim verde aqui significa "o chat funciona"
    const orq = await getOrqConfig()
    const modelo = orq.provider === provider && orq.model ? orq.model : MODELO_TESTE[provider]

    const respondeu = await testarChave(provider, chave, modelo)
    res.json({ ok: true, modelo: respondeu, em: new Date() })
  } catch (err) {
    res.json({ ok: false, erro: erroProvider(err), em: new Date() })
  }
})

app.get('/api/office/orq-info', officeAuth, async (req, res) => {
  const cfg = await getOrqConfig()
  res.json({ ...cfg, options: await orqOptions() })
})

// catálogo de provedores pra tela de Integrações e o onboarding (sem segredo)
app.get('/api/office/provedores', officeAuth, (req, res) => res.json(PROVEDORES.map(provPublico)))

// "todos os possíveis": a lista de modelos AO VIVO do provedor, com a chave da equipe
app.get('/api/office/modelos/:provider', officeAuth, async (req, res) => {
  const id = String(req.params.provider || '')
  const p = id === 'ollama' ? (OLLAMA_URL ? { id: 'ollama', modelos: [MODELO_LOCAL] } : null) : provedor(id)
  if (!p) return res.status(404).json({ error: 'provedor desconhecido' })
  try {
    const vivos = await listarModelos(p, (await getKeys())[id], { ollamaUrl: OLLAMA_URL })
    res.json({ provider: id, modelos: [...new Set([...p.modelos, ...vivos])], aoVivo: vivos.length > 0 })
  } catch (err) {
    res.json({ provider: id, modelos: p.modelos, aoVivo: false, erro: erroProvider(err) })
  }
})

// trocar o orquestrador em runtime (vale pra todos os sócios)
app.patch('/api/office/orq-info', officeAuth, async (req, res) => {
  try {
    const { provider, model } = req.body
    const opt = ORQ_OPTIONS.find(o => o.provider === provider)
    if (!opt) return res.status(400).json({ error: 'Provider desconhecido.' })
    // da lista, da lista ao vivo ou digitado à mão: qualquer id bem formado vale
    const chosen = opt.models.includes(model) || MODELO_LIVRE.test(String(model || '')) ? String(model) : opt.models[0]
    await db.collection('office_config').updateOne(
      { id: 'orq' },
      { $set: { provider, model: chosen, por: req.user.email, em: new Date() } },
      { upsert: true }
    )
    officeEvent('orquestrador_trocado', { provider, model: chosen, por: req.user.email })
    res.json({ provider, model: chosen, options: await orqOptions() })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Anexos da conversa: material de apoio que o orquestrador lê, guardado
// SÓ enquanto serve. Some sozinho em 7 dias (índice TTL), junto com a
// conversa, ou na hora que o sócio remover. Nada de arquivo eterno no banco.
const ANEXO_TTL_DIAS = 7

app.get('/api/office/conversas/:id/anexos', officeAuth, async (req, res) => {
  try {
    res.json(await db.collection('office_anexos')
      .find({ conversaId: req.params.id }, { projection: { conteudo: 0 } })
      .sort({ ts: -1 }).toArray())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/office/conversas/:id/anexos', officeAuth, async (req, res) => {
  try {
    const conv = await db.collection('office_conversas').findOne({ id: req.params.id, dono: req.user.email })
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' })
    const nome = String(req.body?.nome || 'arquivo').slice(0, 120)
    const conteudo = String(req.body?.conteudo || '')
    if (!conteudo.trim()) return res.status(400).json({ error: 'Arquivo vazio ou ilegível (só leio texto: md, txt, json, csv, código).' })
    if (conteudo.length > 200000) return res.status(400).json({ error: 'Arquivo muito grande — corta em pedaços de até 200 mil caracteres.' })

    const doc = {
      id: `anx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversaId: conv.id,
      nome,
      conteudo,
      chars: conteudo.length,
      por: req.user.email,
      ts: new Date(),
    }
    await db.collection('office_anexos').insertOne(doc)
    officeEvent('anexo_adicionado', { nome, chars: doc.chars, por: req.user.email })
    const { conteudo: _, ...semTexto } = doc
    res.json({ ...semTexto, expiraEm: ANEXO_TTL_DIAS })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/office/anexos/:id', officeAuth, async (req, res) => {
  try {
    await db.collection('office_anexos').deleteOne({ id: req.params.id })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/office/conversas', officeAuth, async (req, res) => {
  try {
    const convs = await db.collection('office_conversas').find({ dono: req.user.email }).sort({ atualizada: -1 }).limit(50).toArray()
    const pend = await db.collection('office_mensagens').aggregate([
      { $match: { autor: 'sistema', consumida: false } },
      { $group: { _id: '$conversaId', n: { $sum: 1 } } },
    ]).toArray()
    const map = Object.fromEntries(pend.map(p => [p._id, p.n]))
    res.json(convs.map(c => ({ ...c, pendentes: map[c.id] || 0 })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/office/conversas', officeAuth, async (req, res) => {
  try {
    const conv = {
      id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      titulo: 'Nova conversa',
      dono: req.user.email,
      criada: new Date(),
      atualizada: new Date(),
    }
    await db.collection('office_conversas').insertOne(conv)
    res.json(conv)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/office/conversas/:id/mensagens', officeAuth, async (req, res) => {
  try {
    const conv = await db.collection('office_conversas').findOne({ id: req.params.id, dono: req.user.email })
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' })
    res.json(await db.collection('office_mensagens').find({ conversaId: conv.id }).sort({ ts: 1 }).toArray())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/office/conversas/:id/mensagens', officeAuth, async (req, res) => {
  const texto = String(req.body?.texto || '').trim()
  if (!texto) return res.status(400).json({ error: 'texto obrigatório' })
  const conv = await db.collection('office_conversas').findOne({ id: req.params.id, dono: req.user.email })
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // proxies não podem bufferizar o streaming
  })
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  try {
    await db.collection('office_mensagens').insertOne({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversaId: conv.id,
      autor: `socio:${req.user.email}`,
      texto,
      ts: new Date(),
    })
    if (conv.titulo === 'Nova conversa') {
      await db.collection('office_conversas').updateOne({ id: conv.id }, { $set: { titulo: texto.slice(0, 60) } })
    }
    // Texto longo colado = documento do projeto. Fixa na conversa pra continuar
    // valendo depois de 20 mensagens — era aí que a viagem começava.
    if (!conv.briefing && texto.length > 1200) {
      await db.collection('office_conversas').updateOne({ id: conv.id }, { $set: { briefing: texto.slice(0, 9000) } })
      officeEvent('briefing_fixado', { conversa: conv.titulo, chars: texto.length })
    }

    // recados de decisão que chegaram enquanto o sócio estava fora entram
    // NESTE turno e são marcados como lidos — o fluxo não quebra mais.
    const pendentes = await db.collection('office_mensagens')
      .find({ conversaId: conv.id, autor: 'sistema', consumida: false }).sort({ ts: 1 }).toArray()
    if (pendentes.length) {
      await db.collection('office_mensagens').updateMany(
        { conversaId: conv.id, autor: 'sistema', consumida: false },
        { $set: { consumida: true } }
      )
    }

    const history = await db.collection('office_mensagens').find({ conversaId: conv.id }).sort({ ts: 1 }).toArray()
    const msgs = history.slice(-20)
      .filter(m => m.autor !== 'sistema')
      .map(m => ({ role: m.autor === 'orquestrador' ? 'assistant' : 'user', content: m.texto }))
    if (pendentes.length) {
      // injeta como contexto do turno atual (o modelo age em cima disso)
      const bloco = pendentes.map(p => `- ${p.texto}`).join('\n')
      msgs.splice(Math.max(0, msgs.length - 1), 0, {
        role: 'user',
        content: `[decisões resolvidas desde a última mensagem]\n${bloco}\n\nConsidera isso resolvido e segue o trabalho a partir daí.`,
      })
    }
    /* recall associativo antes de responder — o contexto mora na memória.
       `conv` PRECISA ir: é dele que saem o briefing e os anexos. Sem o argumento
       (era o caso até aqui) o documento colado pelo sócio era gravado, montado
       no prompt... e nunca chegava no modelo. */
    const memBloco = await memRecall(texto)
    const system = [
      ...(await orqSystemPrompt(conv)),
      ...(memBloco ? [{ text: memBloco }] : []), // o mais volátil: muda a cada pergunta
    ]

    let full = ''
    const onDelta = (t) => send({ t: 'delta', text: t })
    const orq = await getOrqConfig()
    const keys = await getKeys()
    full = await orqStream(orq, keys, system, msgs, onDelta)

    const { visivel, passos } = await orqProcessar(full, conv.id)
    await db.collection('office_mensagens').insertOne({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversaId: conv.id,
      autor: 'orquestrador',
      texto: visivel,
      passos,
      ts: new Date(),
    })
    await db.collection('office_conversas').updateOne({ id: conv.id }, { $set: { atualizada: new Date() } })
    send({ t: 'final', texto: visivel, passos })
    send({ t: 'done' })
  } catch (err) {
    send({ t: 'error', error: String(err?.message || err) })
  }
  res.end()
})

// tarefas do kanban criadas pelo orquestrador (fonte: nomade_tasks)
app.get('/api/office/tarefas', officeAuth, async (req, res) => {
  try {
    const filtro = { archived: { $ne: true }, labels: 'orquestrador' }
    const rows = await mainDb.collection('nomade_tasks').find(filtro).sort({ createdAt: -1 }).limit(100).toArray()
    // status do kanban → vocabulário do escritório (fila/rodando/concluida)
    const map = { todo: 'fila', backlog: 'fila', doing: 'rodando', 'in-progress': 'rodando', review: 'rodando', done: 'concluida' }
    res.json(rows.map(t => ({
      id: t._id.toString(),
      resumo: t.title,
      detalhe: t.description || '',
      dept: (t.labels || []).find(l => l !== 'orquestrador') || null,
      squadName: String(t.assignee || '').startsWith('agent:') ? t.assignee.slice(6) : null,
      status: map[t.status] || t.status,
      criada: t.createdAt,
    })))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Coluna de conclusão: ids e nomes são livres por board ("Feito" no interno,
// "Finals" no de cliente). Uma regra só pra ler (feita) e pra escrever (PATCH),
// senão a task fecha num lado e continua aberta no outro.
const COLUNA_FINAL = /done|final|conclu|feito|entregue/i

// O ELO QUE FECHA O CICLO: quando uma task criada pelo orquestrador termina
// (ou falha), o desfecho volta pra conversa que a criou como recado 'sistema'.
// A auto-retomada do chat consome e ele segue sabendo o que aconteceu —
// antes ele criava trabalho e nunca ficava sabendo do fim.
// Autonomia do squad responsável pela task (0 = sempre pede · 3 = solto)
async function autonomiaDaTask(task) {
  const id = String(task?.assignee || '').startsWith('agent:') ? task.assignee.slice(6) : null
  if (!id) return 3 // sem squad: ninguém pra aprovar
  const sq = await db.collection('squads').findOne({ id }, { projection: { autonomia: 1, name: 1 } })
  return { squad: sq?.name || null, nivel: Math.min(3, Math.max(0, Number(sq?.autonomia) || 0)) }
}

async function avisarConversaDaTask(task, { estado, detalhe, por }) {
  if (!task?.conversaId) return
  try {
    const conv = await db.collection('office_conversas').findOne({ id: task.conversaId })
    if (!conv) return
    const abertas = await mainDb.collection('nomade_tasks').countDocuments({
      conversaId: task.conversaId,
      archived: { $ne: true },
      status: { $nin: ['done'] },
    })
    const cabeca = estado === 'falha'
      ? `Task "${task.title}" FALHOU`
      : `Task "${task.title}" concluída`
    await db.collection('office_mensagens').insertOne({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      conversaId: task.conversaId,
      autor: 'sistema',
      texto: `${cabeca}${por ? ` (${String(por).split('@')[0]})` : ''}${detalhe ? `: ${String(detalhe).slice(0, 600)}` : '.'}${abertas > 0 ? ` — ainda faltam ${abertas} tarefa(s) desta conversa.` : ' — era a última tarefa aberta desta conversa.'}`,
      task: { id: String(task._id), titulo: task.title, estado },
      consumida: false,
      ts: new Date(),
    })
    await db.collection('office_conversas').updateOne({ id: task.conversaId }, { $set: { atualizada: new Date() } })
  } catch { /* aviso é best-effort: nunca derruba a execução */ }
}

// Tasks atribuídas a AGENT — é a fila que o app da máquina e a extensão
// do VSCode leem pra executar o trabalho onde o dev estiver.
app.get('/api/office/tarefas-agent', officeAuth, async (req, res) => {
  try {
    // ordem de EXECUÇÃO: board → coluna → posição. Era por data de update,
    // então a fila chegava embaralhada no app e no VSCode.
    const rows = await mainDb.collection('nomade_tasks')
      .find({ archived: { $ne: true }, assignee: { $regex: '^agent:' } })
      .sort({ boardId: 1, status: 1, position: 1 }).limit(100).toArray()
    const boards = await mainDb.collection('nomade_boards').find({}).toArray()
    const squads = await db.collection('squads').find({}).toArray()
    const bmap = Object.fromEntries(boards.map(b => [String(b._id), b]))
    // decisões DESTA leva de tasks — o que o sócio já respondeu vai junto pro
    // app, senão o run seguinte recomeça sem saber o que foi decidido
    const decs = await db.collection('office_decisions')
      .find({ taskId: { $in: rows.map(t => t._id.toString()) } })
      .sort({ createdAt: 1 }).toArray()
    const decPorTask = decs.reduce((acc, d) => {
      (acc[String(d.taskId)] ||= []).push(d)
      return acc
    }, {})
    res.json(rows.map(t => {
      const b = bmap[String(t.boardId)]
      const sq = squads.find(x => x.id === String(t.assignee).slice(6))
      const col = b?.columns?.find(c => c.id === t.status)
      return {
        id: t._id.toString(),
        titulo: t.title,
        detalhe: t.description || '',
        board: b?.name || null,
        boardId: String(t.boardId || ''),
        cliente: t.clientEmail || null,
        coluna: t.status,
        colunaNome: col?.name || t.status,
        // MESMO vocabulário do PATCH abaixo (que aceita "feito"): sem isso o
        // board interno, cuja coluna final chama "Feito", devolvia feita:false
        // e a task voltava pra fila do app depois de concluída — pra sempre.
        feita: COLUNA_FINAL.test(col?.name || '') || COLUNA_FINAL.test(String(t.status || '')),
        squadId: sq?.id || null,
        squad: sq?.name || 'agent removido',
        squadAgents: (sq?.agents || []).map(a => ({ name: a.name, model: a.model })),
        prioridade: t.priority || 'medium',
        // o que o agent perguntou e o que o sócio respondeu nesta task
        decisoes: (decPorTask[t._id.toString()] || []).slice(-5).map(d => ({
          pergunta: d.pergunta,
          tipo: d.tipo || null,
          resolucao: d.resolucao || '',
          resolvida: d.status === 'resolvida',
        })),
        // trava a execução enquanto tiver pergunta sem resposta
        aguardandoDecisao: (decPorTask[t._id.toString()] || []).some(d => d.status === 'aberta'),
        // etapas já concluídas num run anterior — a retomada continua daqui
        progresso: t.progresso || null,
        dono: t.donoConta || sq?.donoConta || null, // de quem é a máquina que executa
        donoNaTask: !!t.donoConta,           // carimbado no card, ou herdado do squad
        pedidoEm: t.pedidoEm || null,        // alguém deu play e o runner ainda não pegou
        rodandoEm: t.workerMaquina || null,  // máquina que reservou esta task
        atualizada: t.updatedAt,
      }
    }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// o app/extensão reportam progresso da execução na própria task
app.patch('/api/office/tarefas-agent/:id', officeAuth, async (req, res) => {
  try {
    const t = await mainDb.collection('nomade_tasks').findOne({ _id: new ObjectId(req.params.id) })
    if (!t) return res.status(404).json({ error: 'Task não encontrada.' })
    const board = await mainDb.collection('nomade_boards').findOne({ _id: new ObjectId(String(t.boardId)) }).catch(() => null)
    const set = { updatedAt: new Date() }
    const push = {}

    // 'rodando' | 'feita' | 'falha' viram a coluna certa DAQUELE board (ids são livres).
    // Falha PRECISA sair de "fazendo": run que morreu no meio ficava marcado como
    // em andamento e o board mentia — ninguém estava tocando aquilo.
    if (req.body.estado && board?.columns?.length) {
      const cols = [...board.columns].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      const alvo = req.body.estado === 'feita'
        ? cols.find(c => COLUNA_FINAL.test(c.name || '') || c.id === 'done')
        : req.body.estado === 'falha'
          ? cols.find(c => c.id === colunaDeEntrada(board))
          : cols.find(c => /doing|fazendo|working|progress|dev/i.test(c.name || '') || c.id === 'doing')
      if (alvo) set.status = alvo.id
    }
    if (req.body.coluna && board?.columns?.some(c => c.id === req.body.coluna)) set.status = req.body.coluna

    /* DONO DA TASK — de QUEM é a assinatura que vai executar. String vazia
       solta a task pra qualquer sócio; um e-mail prende à conta daquele. */
    if (req.body.dono !== undefined) {
      const d = String(req.body.dono || '').trim().toLowerCase()
      if (d && ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(d)) {
        return res.status(400).json({ error: `"${d}" não é um sócio liberado.` })
      }
      set.donoConta = d || null
    }

    /* CRITÉRIOS DE ACEITE — lista curta do que precisa ser verdade pra task
       estar feita. Quem escreve é quem abre o card (sócio ou orquestrador); o
       agent não inventa os seus. Lista vazia mantém o comportamento de antes. */
    if (req.body.criterios !== undefined) {
      const lista = Array.isArray(req.body.criterios)
        ? req.body.criterios
        : String(req.body.criterios || '').split('\n')
      set.criterios = lista.map(c => String(c || '').trim()).filter(Boolean).slice(0, 12)
    }

    /* MÁQUINA DA TASK — ONDE ela roda. Eixo separado do dono: um sócio pode ter
       dois computadores, e um computador pode ter dois sócios. Vazio = qualquer
       máquina (aí valem o squad e o board, nessa ordem). */
    if (req.body.maquina !== undefined) {
      const mid = String(req.body.maquina || '').trim().slice(0, 64)
      if (mid) {
        const existe = await db.collection('machines').findOne({ machineId: mid }, { projection: { _id: 1 } })
        if (!existe) return res.status(400).json({ error: 'máquina desconhecida — ela precisa ter rodado o runner ao menos uma vez.' })
      }
      set.maquinaId = mid || null
    }

    /* PROGRESSO POR ETAPA — o run morria e levava junto o que já tinha sido
       feito: limite de janela, rede caindo, app fechado, PC reiniciando pra
       update. Guardado aqui, a retomada continua da etapa seguinte em vez de
       queimar token refazendo o começo. Some quando a task fecha. */
    if (req.body.progresso === null) set.progresso = null
    else if (req.body.progresso && typeof req.body.progresso === 'object') {
      set.progresso = {
        etapa: Math.max(0, Number(req.body.progresso.etapa) || 0), // etapas JÁ concluídas
        de: Math.max(0, Number(req.body.progresso.de) || 0),
        contexto: String(req.body.progresso.contexto || '').slice(0, 8000),
        em: new Date(),
      }
    }
    if (req.body.estado === 'feita') set.progresso = null
    if (req.body.comentario) {
      push.comments = {
        id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        author: req.body.autor || 'Agent', authorId: 'agent',
        text: String(req.body.comentario).slice(0, 4000), createdAt: new Date(),
      }
    }
    await mainDb.collection('nomade_tasks').updateOne({ _id: t._id }, { $set: set, ...(push.comments ? { $push: push } : {}) })
    officeEvent('tarefa_atualizada', { resumo: t.title, coluna: set.status || t.status, estado: req.body.estado || null, por: req.user.email })
    if (req.body.estado === 'feita' || req.body.estado === 'falha') {
      await avisarConversaDaTask(t, { estado: req.body.estado, detalhe: req.body.comentario, por: req.user.email })

      // AUTONOMIA 0: entrega não fecha sozinha — vira aprovação na fila.
      // (1-2 avisam e seguem; 3 roda solto, nem pergunta.)
      if (req.body.estado === 'feita') {
        const aut = await autonomiaDaTask(t)
        if (aut && aut.nivel === 0) {
          const dec = {
            id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            agentId: null,
            conversaId: t.conversaId || null,
            agentName: aut.squad || 'agent',
            dept: (t.labels || []).find(l => l !== 'orquestrador') || null,
            projetoId: null,
            contexto: `Entrega do agent na task "${t.title}":\n${String(req.body.comentario || '').slice(0, 800)}`,
            pergunta: `Aprovar a entrega de "${t.title}"?`,
            opcoes: [
              { label: 'Aprovar e fechar', valor: 'aprovado' },
              { label: 'Refazer', valor: 'refazer' },
            ],
            urgencia: 'hoje',
            sugestao: '',
            status: 'aberta',
            createdAt: new Date(),
          }
          await db.collection('office_decisions').insertOne(dec)
          officeEvent('decisao_aberta', { decisionId: dec.id, agentName: dec.agentName, pergunta: dec.pergunta, urgencia: dec.urgencia })
        }
      }
    }
    res.json({ ok: true, status: set.status || t.status })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// apagar conversa do chat (e os recados dela)
app.delete('/api/office/conversas/:id', officeAuth, async (req, res) => {
  try {
    const conv = await db.collection('office_conversas').findOne({ id: req.params.id, dono: req.user.email })
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' })
    await db.collection('office_mensagens').deleteMany({ conversaId: conv.id })
    // decisões abertas daquela conversa não podem sobrar penduradas na fila
    await db.collection('office_decisions').deleteMany({ conversaId: conv.id, status: 'aberta' })
    await db.collection('office_anexos').deleteMany({ conversaId: conv.id })
    await db.collection('office_conversas').deleteOne({ id: conv.id })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// — activity (feed) —
app.get('/api/office/events', officeAuth, async (req, res) => {
  try {
    const limit = Math.min(400, Number(req.query.limit) || 60)
    res.json(await db.collection('office_events').find({}).sort({ ts: -1 }).limit(limit).toArray())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/office/events', officeAuth, async (req, res) => {
  try {
    const { tipo, payload } = req.body
    if (!tipo?.trim()) return res.status(400).json({ error: 'tipo obrigatório' })
    await officeEvent(tipo.trim(), { payload: payload || {}, por: req.user.email })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// fallback do SPA (hash routing): /hub/* volta o index do hub;
// qualquer caminho desconhecido volta pro cockpit (raiz)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/link' || req.path === '/health') return next()
  if (req.path === '/hub' || req.path.startsWith('/hub/') || !ADMIN_UPSTREAM) {
    return res.sendFile(path.join(WEB_DIR, 'index.html'), (err) => { if (err) next() })
  }
  res.redirect('/')
})

connectDB().then(() => {
  server.listen(PORT, () => console.log(`AI Service running on port ${PORT}`))
  // worker: só age em squad marcado "roda no servidor" (default: nenhum)
  if (process.env.WORKER_DESLIGADO !== '1') {
    setInterval(() => { cicloWorker().catch(() => {}) }, WORKER_MS)
    console.log(`Worker do escritório ativo (a cada ${Math.round(WORKER_MS / 1000)}s, só squads liberados)`)
  }
  // atendimento: puxa os canais conectados a cada 2 min (o aviso do canal adianta)
  atendCol().createIndex({ chave: 1 }, { unique: true }).catch(() => {})
  atendCol().createIndex({ status: 1, atualizadaEm: -1 }).catch(() => {})
  if (process.env.ATENDIMENTO_DESLIGADO !== '1') setInterval(() => { cicloAtendimento().catch(() => {}) }, 120_000)
}).catch(err => {
  console.error('Failed to connect to database:', err)
  process.exit(1)
})
