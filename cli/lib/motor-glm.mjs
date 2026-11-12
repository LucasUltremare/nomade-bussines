/* ═══ MOTOR AGNÓSTICO DE PROVIDER ════════════════════════════════════════
   O loop agêntico contra qualquer endpoint compatível com OpenAI: GLM
   (Z.ai), OpenAI, Gemini e Ollama local. É o que permite rodar agent sem
   depender do Claude.

   A diferença pro motor do Claude não é o modelo — é de quem são as
   ferramentas de arquivo. Lá vêm prontas no Agent SDK; aqui são as de
   cli/lib/arquivo.mjs, escritas à mão e presas à raiz do projeto.

   A INTELIGÊNCIA MORA NO SISTEMA, não no modelo: as ferramentas, as
   descrições e as regras são as mesmas nos dois motores. O modelo é peça
   trocável. */
import { ferramentasDeArquivo } from './arquivo.mjs'
import { acoesDaEmpresa } from './acoes.mjs'
import { erroLegivel } from './api.mjs'

const MAX_PASSOS = 40        // trava de loop maluco
const TETO_RESULTADO = 8000  // resultado de ferramenta que volta pro modelo

/* Sem prefixo, deduz pelo nome antes de cair no default. A lista antiga do
   canvas gravava "gpt-5" solto, e sem isto ele ia pro endpoint do GLM com a
   chave do GLM — request pro provider errado, e o erro que voltava não dizia
   isso. Squad salvo daquele jeito continua funcionando. */
function provedorPeloNome(modelo) {
  if (/^(gpt-|o\d|chatgpt)/i.test(modelo)) return 'openai'
  if (/^gemini/i.test(modelo)) return 'gemini'
  return 'zai'   // glm-* e desconhecidos: mantém o default histórico
}

/* provider → endpoint compatível com OpenAI. O `spec` é "provider:modelo".
   Só o PRIMEIRO dois-pontos separa, então "ollama:qwen2.5:7b" funciona. */
export function endpointDe(spec, chaves = {}) {
  /* "local/xxx" era como o app Electron nomeava modelo de Ollama/LM Studio.
     O app saiu, mas squad salvo assim continua no banco — traduzir é melhor
     que mandar "local/llama3" pro GLM como se fosse nome de modelo dele. */
  const s = String(spec).replace(/^local\//i, 'ollama:')
  const i = s.indexOf(':')
  const provider = i === -1 ? provedorPeloNome(s) : s.slice(0, i).toLowerCase()
  const modelo = i === -1 ? s : s.slice(i + 1)
  // permite apontar pra outro endereço: proxy da empresa, gateway, ou um
  // servidor local durante teste. Sem isso não dá nem pra testar o loop
  // sem gastar chave de verdade.
  const base = chaves.baseUrl || process.env.NOMADE_LLM_BASE
  if (base) return { url: base.replace(/\/$/, ''), chave: chaves.glm || chaves.openai || 'teste', modelo, provider }
  switch (provider) {
    case 'zai': case 'glm': case 'z.ai':
      return { url: 'https://open.bigmodel.cn/api/paas/v4', chave: chaves.glm, modelo, provider: 'glm' }
    case 'openai':
      return { url: 'https://api.openai.com/v1', chave: chaves.openai, modelo, provider: 'openai' }
    case 'gemini': case 'google':
      return { url: 'https://generativelanguage.googleapis.com/v1beta/openai', chave: chaves.gemini, modelo, provider: 'gemini' }
    case 'ollama': case 'local':
      return { url: (chaves.ollama || 'http://localhost:11434') + '/v1', chave: 'ollama', modelo, provider: 'ollama' }
    default:
      throw new Error(`provider "${provider}" desconhecido — usa zai, openai, gemini ou ollama`)
  }
}

/** As ferramentas no formato function calling. */
function paraOpenAI(mapa) {
  return Object.entries(mapa).map(([nome, f]) => ({
    type: 'function',
    function: { name: nome, description: f.descricao, parameters: f.schema },
  }))
}

export async function rodarAgenteOpenAI({
  spec, chaves, sistema, objetivo, cwd, ctx, aoPasso,
}) {
  const { url, chave, modelo, provider } = endpointDe(spec, chaves)
  if (!chave) throw new Error(`sem chave pra ${provider} — configura em Chaves no admin.`)

  const mapa = { ...ferramentasDeArquivo(cwd), ...acoesDaEmpresa(ctx) }
  const tools = paraOpenAI(mapa)
  const mensagens = [
    { role: 'system', content: sistema },
    { role: 'user', content: objetivo },
  ]
  const textos = []

  for (let passo = 0; passo < MAX_PASSOS; passo++) {
    const r = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
      body: JSON.stringify({ model: modelo, messages: mensagens, tools, tool_choice: 'auto', temperature: 0.3, stream: false }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!r.ok) {
      const corpo = await r.text().catch(() => '')
      if (/does not support tools|function.*not support/i.test(corpo)) {
        throw new Error(`o modelo "${modelo}" não suporta ferramentas — não serve de agent. Usa um com function calling.`)
      }
      throw new Error(`${provider} ${r.status}: ${corpo.slice(0, 200)}`)
    }
    const j = await r.json()
    const msg = j?.choices?.[0]?.message ?? {}
    const texto = String(msg.content ?? '').trim()
    const chamadas = Array.isArray(msg.tool_calls) ? msg.tool_calls : []

    if (texto) { textos.push(texto); aoPasso?.({ tipo: 'texto', texto }) }

    // sem ferramenta = ele terminou de falar
    if (!chamadas.length) break

    mensagens.push({ role: 'assistant', content: msg.content ?? '', tool_calls: chamadas })

    for (const c of chamadas) {
      const nome = String(c?.function?.name ?? '')
      let args = {}
      try {
        const a = c?.function?.arguments
        args = typeof a === 'string' ? JSON.parse(a || '{}') : (a ?? {})
      } catch {
        // JSON quebrado do modelo não pode derrubar o run: devolve o erro
        // pra ele como resultado e deixa tentar de novo
        mensagens.push({ role: 'tool', tool_call_id: c.id, content: 'Os argumentos vieram com JSON inválido. Manda de novo.' })
        continue
      }
      const f = mapa[nome]
      aoPasso?.({ tipo: 'ferramenta', nome, args })
      let resultado
      try {
        resultado = f ? String(await f.executar(args)) : `Ferramenta "${nome}" não existe. As que existem: ${Object.keys(mapa).join(', ')}`
      } catch (e) {
        // erro de ferramenta VOLTA pro modelo em vez de matar o run — é assim
        // que ele conserta o caminho errado ou o trecho ambíguo
        resultado = `ERRO: ${e.message}`
      }
      mensagens.push({ role: 'tool', tool_call_id: c.id, content: resultado.slice(0, TETO_RESULTADO) })
    }

    if (ctx.estado.encerrado) break // entregou ou perguntou: acabou

    /* Bater no teto NÃO é "terminou": é um agent que se perdeu, e o log
       precisa dizer isso. Sem distinguir, um run que rodou 40 ferramentas em
       círculo aparecia igual a um que simplesmente esqueceu de entregar. */
    if (passo === MAX_PASSOS - 1) {
      ctx.estado.estourou = true
      textos.push(`[parei no teto de ${MAX_PASSOS} passos sem concluir — provavelmente a pasta do projeto não é a esperada, ou o caminho ficou preso num erro que se repete]`)
    }
  }

  return textos.join('\n\n')
}
