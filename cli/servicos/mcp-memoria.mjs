#!/usr/bin/env node
/* ═══ MCP DA MEMÓRIA DA EMPRESA ══════════════════════════════════════════
   Põe a memória da empresa dentro de QUALQUER cliente que fale MCP — o
   Claude Code no terminal, primeiro. Até aqui ela só existia pra quem
   trabalha pela sede ou pelo agent do runner; sessão de código começava do
   zero e as convenções da casa eram repetidas na mão toda vez.

   É casca fina sobre o serviço: toda a inteligência (busca híbrida, salto no
   grafo, filtro de escopo, trava de vocabulário) já vive no crew e é a MESMA
   que o orquestrador e os dois motores de agent usam. Duplicar aqui seria
   criar um quinto caminho que um dia divergiria dos outros quatro.

   ESCRITA: só gravar_memoria, e com uma exigência. `abrir_decisao` e
   `entregar` continuam fora — são ações de execução de task, e aqui não há
   task. O que voltou foi só o registro de fato.

   O modo de falha registrado nunca foi "escrever do terminal": foi o MODELO
   decidindo sozinho o que virava memória, e gravando a ata ("ferramenta de
   CRM escolhida pelo sócio") em vez do fato. Por isso a regra aqui é gravar
   quando PEDIDO, com a pessoa olhando o texto.

   E `resumo` é OBRIGATÓRIO, escrito por quem grava. Gerar resumo foi testado
   e reprovou: gemma3 e qwen2.5:7b inverteram a regra de um playbook. Como o
   resumo é o único campo indexado, resumo ruim é memória que nunca mais será
   achada — e resumo invertido é pior que memória nenhuma.

   Escopo fecha na CASA por padrão. Não existe `task` numa sessão de código,
   e sem task não há de quem seja o trabalho. Sessão de código quer convenção
   do repositório, não fato de cliente — quem quiser um cliente pede pelo
   nome, explicitamente. É a mesma decisão que o serviço já toma quando a task
   não resolve, e vale pelo mesmo motivo.

   stdio de propósito: roda na máquina de quem usa, com o token que a CLI já
   guardou. Servidor HTTP remoto é outro passo — precisa de
   container, token por pessoa e log de quem consultou o quê.

   Instalar:
     claude mcp add nomade -- node <caminho absoluto deste arquivo>
   Precisa de `nomade login` feito antes (é de lá que sai o token). */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const DIR = process.env.NOMADE_CONFIG_DIR || path.join(os.homedir(), '.nomade')
const cfg = await fs.readFile(path.join(DIR, 'config.json'), 'utf8').then(JSON.parse).catch(() => ({}))
const URL_BASE = (process.env.NOMADE_URL || cfg.url || 'http://localhost:5004').replace(/\/$/, '')
const TOKEN = process.env.NOMADE_TOKEN || cfg.token

/* Sem token o servidor SOBE mesmo assim, e cada ferramenta explica o que
   fazer. Servidor que morre no boot aparece no Claude Code como "failed" sem
   dizer por quê, e o usuário fica olhando pra um X vermelho. */
async function chamar(rota, opts = {}) {
  if (!TOKEN) throw new Error('sem token — roda `nomade login` nesta máquina e reinicia o Claude Code.')
  const r = await fetch(`${URL_BASE}${rota}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...opts.headers },
    signal: AbortSignal.timeout(20_000),
  })
  if (r.status === 401) throw new Error('token recusado — roda `nomade login` de novo.')
  /* O ?cliente=casa é mais novo que o serviço pode estar. Sem esta mensagem o
     usuário vê "500" amanhã e vai caçar um bug que já está corrigido no disco
     dele — o erro tem que dizer que o problema é a versão no ar, não o código. */
  if (r.status === 500 && /24 character hex/.test(await r.clone().text().catch(() => ''))) {
    throw new Error('o serviço no ar é anterior ao escopo "casa" — falta o redeploy do crew (git push + redeploy no Portainer).')
  }
  if (!r.ok) throw new Error(`${rota} devolveu ${r.status}`)
  return r.json()
}

const texto = (t) => ({ content: [{ type: 'text', text: String(t) }] })
const falha = (t) => ({ content: [{ type: 'text', text: String(t) }], isError: true })

// a lista fechada, buscada no boot — mesma fonte do orquestrador e dos agents
const escopos = await chamar('/api/office/escopos').then(d => d.escopos || []).catch(() => [])
const rotulos = escopos.map(e => e.rotulo)
// de QUAL empresa é esta memória (uma por empresa) — vai no título das tools
const empresa = await chamar('/api/office/empresa').then(d => d.nome || '').catch(() => '')
const daEmpresa = empresa ? ` (${empresa})` : ''

const server = new McpServer({ name: 'nomade-memoria', version: '1.0.0' })

/* A DESCRIÇÃO É O PROMPT: é lendo isto que o modelo decide chamar. "Busca
   convenções" não faz ninguém chamar nada; enumerar o gatilho, faz. */
server.registerTool('buscar_memoria', {
  title: `Memória da empresa${daEmpresa}`,
  description:
    'Memória da empresa: convenções técnicas da casa, decisões já tomadas com clientes, ' +
    'preferências dos sócios e fatos estáveis de projeto. ' +
    'CONSULTE SEMPRE antes de escrever código que toque MongoDB, Docker, Socket.IO, deploy, ' +
    'design system ou integração de pagamento — e antes de assumir qualquer coisa sobre como a ' +
    'a empresa faz as coisas. O palpite não vale, a memória vale. ' +
    'A busca é semântica e traz também memórias vizinhas por associação: pergunta amplo, ' +
    'em frase, não em palavra-chave solta.',
  inputSchema: {
    pergunta: z.string().min(2).describe('o que quer lembrar, em linguagem natural'),
    cliente: z.string().optional().describe(
      'SÓ quando o trabalho for de um cliente específico. Omitido, busca as convenções e ' +
      'decisões da casa — que é o que uma sessão de código quer na maioria das vezes' +
      (rotulos.length ? `. Um de: ${rotulos.join(' | ')}` : '')),
  },
}, async ({ pergunta, cliente }) => {
  try {
    /* Sem cliente → "casa", nunca "tudo". Rótulo que não casa também vira
       casa: pedir um cliente e receber a base inteira porque digitou errado é o
       tipo de falha que ninguém percebe. */
    const achado = cliente ? escopos.find(e => e.rotulo.toLowerCase() === cliente.trim().toLowerCase()) : null
    const qs = new URLSearchParams({ q: pergunta, cliente: achado?.id || 'casa' })
    const d = await chamar(`/api/office/memories/recall?${qs}`)
    const naoAchou = cliente && !achado
      ? `\n\n(não existe cliente "${cliente}" — busquei só na memória da casa. Os válidos: ${rotulos.join(', ')})`
      : ''
    if (!d.total) return texto(`Nada na memória da empresa sobre isso. Segue sem assumir — e se for escolha que importa, pergunta ao sócio.${naoAchou}`)
    const linhas = d.memorias.map(m =>
      `- ${m.titulo ? `${m.titulo}: ` : ''}${m.conteudo}` +
      `${m.cliente ? ` [cliente: ${m.cliente}]` : m.projeto ? ` [${m.projeto}]` : ''}` +
      `${m.origem === 'salto' ? ' (relacionada)' : ''}`)
    // sem isto o modelo lê recall pobre como "a empresa não tem convenção"
    const aviso = d.embedder ? '' : '\n\n(busca por texto: o embedder está fora, pode ter escapado coisa relevante)'
    return texto(`${linhas.join('\n')}${aviso}${naoAchou}`)
  } catch (e) { return falha(`Não deu pra consultar a memória: ${e.message}`) }
})

server.registerTool('ver_cliente', {
  title: `Ficha de cliente da empresa${daEmpresa}`,
  description:
    'Ficha de um cliente: segmento, plano, status, NOTAS (onde moram os combinados que não estão ' +
    'escritos em mais lugar nenhum), tarefas abertas, entregas recentes e decisões pendentes. ' +
    'Aceita nome, e-mail ou id. Chama antes de mexer em qualquer coisa de cliente.',
  inputSchema: {
    referencia: z.string().min(2).describe('nome, e-mail ou id do cliente'),
  },
}, async ({ referencia }) => {
  try {
    const d = await chamar(`/api/office/clientes/${encodeURIComponent(referencia)}`)
    return texto(JSON.stringify(d, null, 2).slice(0, 6000))
  } catch (e) { return falha(`Não deu pra ver o cliente: ${e.message}`) }
})

server.registerTool('gravar_memoria', {
  title: `Gravar na memória da empresa${daEmpresa}`,
  description:
    'Grava um fato que vai valer DEPOIS desta sessão: uma convenção do repositório, o motivo real ' +
    'de um erro que se repete, uma decisão que os sócios tomaram. ' +
    'Use APENAS quando a pessoa pedir pra guardar — não decida sozinho no fim de uma tarefa que algo ' +
    'merece virar memória. NÃO grava o que já está no código (isso se lê de novo), nem o que só vale ' +
    'pra hoje, nem suposição: memória errada é pior que memória vazia, porque a próxima sessão confia nela.',
  inputSchema: {
    conteudo: z.string().min(20).describe('o fato completo, com o PORQUÊ. É o que se lê depois de achar a memória'),
    /* O resumo é o ÚNICO campo indexado: é ele que decide se a memória será
       achada um dia. Obrigatório e sem default — opcional aqui viraria vazio
       na prática, e memória sem resumo nasce invisível. */
    resumo: z.string().min(20).describe(
      'A LINHA DE BUSCA, 30 a 60 palavras. ABRE pelo sintoma ou pela dúvida de quem vai procurar, ' +
      'nunca pelo nome do assunto — quem tem o problema não sabe como ele se chama. Depois do sintoma, ' +
      'a resposta em uma frase. Sem o porquê (isso vai no conteudo). ' +
      'EXEMPLO (levou uma memória de 42º para 2º numa busca real): "Tempo real caindo em produção, chat ' +
      'que para de atualizar sozinho, websocket que não conecta: é o Nginx Proxy Manager derrubando o ' +
      'upgrade direto. Socket.IO tem que começar em polling."'),
    titulo: z.string().optional().describe('resumo em poucas palavras — é o que aparece na lista'),
    projeto: (rotulos.length ? z.enum([...rotulos, '__novo__']) : z.string()).optional().describe(
      'cliente ou assunto a que o fato pertence, rótulo EXATO. Convenção que vale pra empresa toda vai ' +
      'SEM projeto. Se não estiver na lista, manda "__novo__" e preenche projetoSugerido — nunca escolhe ' +
      'o mais parecido: memória no cliente errado é pior que memória sem dono.'),
    projetoSugerido: z.string().optional().describe('o nome que daria ao escopo — só com projeto="__novo__"'),
    tags: z.string().optional().describe('palavras-chave separadas por vírgula'),
  },
}, async ({ conteudo, resumo, titulo, projeto, projetoSugerido, tags }) => {
  try {
    const m = await chamar('/api/office/memories', {
      method: 'POST',
      body: JSON.stringify({
        title: titulo || '', content: conteudo, resumo,
        project: projeto || '', projetoSugerido: projetoSugerido || '', tags: tags || '',
      }),
    })
    if (!m?.id) return falha('Não deu pra gravar agora.')
    return texto(m.fundida
      ? 'Já existia memória parecida — o fato novo foi anexado nela em vez de duplicar.'
      : 'Guardado. A próxima sessão acha isso pelo resumo que você escreveu.')
  } catch (e) { return falha(`Não deu pra gravar: ${e.message}`) }
})

/* Sistema 1: pergunta de resposta conhecida volta como VALOR com
   probabilidade (Jev ou o modelo local — o serviço escolhe). Só leitura. */
server.registerTool('decidir', {
  title: `Decisão rápida${daEmpresa}`,
  description:
    'Responde perguntas fechadas sobre um texto com probabilidade, sem prosa: ' +
    'predicate (sim/não → probabilidade de sim), choice (uma opção de uma lista) e score (nota numa escala ' +
    'de 2 a 10 níveis). Use pra classificar, triar e rotear quando a resposta é uma de poucas opções — ' +
    'e trate confidence baixa como "não sei", não como resposta.',
  inputSchema: {
    texto: z.string().min(2).describe('o que está sendo avaliado (mensagem, ticket, trecho de call)'),
    perguntas: z.array(z.object({
      type: z.enum(['predicate', 'choice', 'score']),
      name: z.string().describe('id da pergunta, volta na resposta'),
      instructions: z.string().optional().describe('a pergunta em uma frase'),
      choices: z.array(z.object({ value: z.string(), description: z.string().optional() })).optional()
        .describe('só pra choice: 2 a 20 opções'),
      levels: z.array(z.object({ label: z.string() })).optional()
        .describe('só pra score: 2 a 10 níveis, do menor pro maior'),
    })).min(1).max(16),
  },
}, async ({ texto: input, perguntas }) => {
  try {
    const d = await chamar('/api/office/decisoes', { method: 'POST', body: JSON.stringify({ input, questions: perguntas }) })
    return texto(JSON.stringify(d, null, 2))
  } catch (e) { return falha(`Não deu pra decidir: ${e.message}`) }
})


await server.connect(new StdioServerTransport())
