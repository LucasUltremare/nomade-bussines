/* ══════════════════════════════════════════════════════════════════════════
 * PROVEDORES DE IA — a lista inteira, num lugar só.
 *
 * Chave, teste, seletor do chat e lista de modelos saem daqui. Quase todo
 * mundo fala o dialeto OpenAI (`/chat/completions`), então basta a `base`.
 * A Anthropic tem SDK próprio e o Ollama roda local, sem chave.
 *
 * `modelos` é só o ponto de partida: com a chave conectada, o painel puxa a
 * lista ao vivo do provedor (GET /models), e dá pra digitar qualquer id.
 * ══════════════════════════════════════════════════════════════════════════ */

export const PROVEDORES = [
  { id: 'anthropic', nome: 'Anthropic', produto: 'Claude', prefixo: 'sk-ant-…', env: 'ANTHROPIC_API_KEY', tipo: 'anthropic',
    base: 'https://api.anthropic.com/v1', site: 'https://console.anthropic.com/settings/keys',
    modelos: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] },
  { id: 'openai', nome: 'OpenAI', produto: 'GPT', prefixo: 'sk-…', env: 'OPENAI_API_KEY',
    base: 'https://api.openai.com/v1', site: 'https://platform.openai.com/api-keys',
    modelos: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'] },
  { id: 'gemini', nome: 'Google', produto: 'Gemini', prefixo: 'AIza…', env: 'GEMINI_API_KEY',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai', site: 'https://aistudio.google.com/apikey',
    modelos: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] },
  { id: 'xai', nome: 'xAI', produto: 'Grok', prefixo: 'xai-…', env: 'XAI_API_KEY',
    base: 'https://api.x.ai/v1', site: 'https://console.x.ai',
    modelos: ['grok-4', 'grok-3', 'grok-3-mini'] },
  { id: 'deepseek', nome: 'DeepSeek', produto: 'DeepSeek', prefixo: 'sk-…', env: 'DEEPSEEK_API_KEY',
    base: 'https://api.deepseek.com/v1', site: 'https://platform.deepseek.com/api_keys',
    modelos: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'mistral', nome: 'Mistral', produto: 'Mistral', prefixo: '…', env: 'MISTRAL_API_KEY',
    base: 'https://api.mistral.ai/v1', site: 'https://console.mistral.ai/api-keys',
    modelos: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] },
  { id: 'groq', nome: 'Groq', produto: 'Groq', prefixo: 'gsk_…', env: 'GROQ_API_KEY',
    base: 'https://api.groq.com/openai/v1', site: 'https://console.groq.com/keys',
    modelos: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'] },
  { id: 'openrouter', nome: 'OpenRouter', produto: 'Todos os modelos', prefixo: 'sk-or-…', env: 'OPENROUTER_API_KEY',
    base: 'https://openrouter.ai/api/v1', site: 'https://openrouter.ai/keys',
    modelos: ['openrouter/auto'] },
  { id: 'qwen', nome: 'Alibaba', produto: 'Qwen', prefixo: 'sk-…', env: 'DASHSCOPE_API_KEY',
    base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', site: 'https://modelstudio.console.alibabacloud.com',
    modelos: ['qwen-max', 'qwen-plus', 'qwen-turbo'] },
  { id: 'moonshot', nome: 'Moonshot', produto: 'Kimi', prefixo: 'sk-…', env: 'MOONSHOT_API_KEY',
    base: 'https://api.moonshot.ai/v1', site: 'https://platform.moonshot.ai/console/api-keys',
    modelos: ['kimi-latest'] },
  { id: 'glm', nome: 'Zhipu', produto: 'GLM', prefixo: '…', env: 'GLM_API_KEY',
    base: 'https://open.bigmodel.cn/api/paas/v4', site: 'https://bigmodel.cn',
    modelos: ['glm-4.6'] },
  { id: 'together', nome: 'Together', produto: 'Open models', prefixo: '…', env: 'TOGETHER_API_KEY',
    base: 'https://api.together.xyz/v1', site: 'https://api.together.ai/settings/api-keys',
    modelos: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
  { id: 'perplexity', nome: 'Perplexity', produto: 'Sonar', prefixo: 'pplx-…', env: 'PERPLEXITY_API_KEY',
    base: 'https://api.perplexity.ai', site: 'https://www.perplexity.ai/settings/api',
    modelos: ['sonar', 'sonar-pro'], semLista: true },
]

/* provedores que pedem chave (o Ollama entra à parte, só com OLLAMA_URL) */
export const COM_CHAVE = PROVEDORES.map((p) => p.id)
export const provedor = (id) => PROVEDORES.find((p) => p.id === id) || null

/* id de modelo digitado à mão: letras, números e o que os provedores usam (/ : . @ -) */
export const MODELO_LIVRE = /^[\w.:/@-]{1,120}$/

/* O que o painel mostra (sem segredo nenhum). */
export const publico = (p) => ({ id: p.id, nome: p.nome, produto: p.produto, prefixo: p.prefixo, site: p.site, modelos: p.modelos })

/* Lista de modelos ao vivo, direto do provedor. Cache de 10 min por chave. */
const cache = new Map()
export async function listarModelos(p, chave, { ollamaUrl } = {}) {
  if (!p) return []
  const ck = `${p.id}:${String(chave || '').slice(-8)}`
  const hit = cache.get(ck)
  if (hit && Date.now() - hit.em < 10 * 60e3) return hit.lista
  let lista = []
  const signal = AbortSignal.timeout(12_000)
  if (p.id === 'ollama') {
    const r = await fetch(`${ollamaUrl}/api/tags`, { signal })
    const d = await r.json().catch(() => ({}))
    lista = (d.models || []).map((m) => m.name)
  } else if (p.semLista || !chave) {
    lista = []
  } else if (p.tipo === 'anthropic') {
    const r = await fetch(`${p.base}/models?limit=100`, { signal, headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' } })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`)
    lista = (d.data || []).map((m) => m.id)
  } else {
    const r = await fetch(`${p.base}/models`, { signal, headers: { Authorization: `Bearer ${chave}` } })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`)
    lista = (d.data || d.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean)
    // tira o que não conversa (embedding, áudio, imagem, moderação)
    lista = lista.filter((id) => !/embed|whisper|tts|dall-e|image|moderation|audio|transcribe|realtime|rerank/i.test(id))
  }
  lista = [...new Set(lista)].sort()
  cache.set(ck, { em: Date.now(), lista })
  return lista
}
