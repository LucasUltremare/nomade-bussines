/* ═══ MOTOR AGÊNTICO ═════════════════════════════════════════════════════
   Um agent com ferramentas decide sozinho o que chamar e em que ordem. Não
   existe pipeline de etapas: é UM turno agêntico do Claude Agent SDK, com as
   ferramentas de arquivo do próprio SDK (Read/Edit/Bash/Grep) mais as quatro
   da empresa.

   PODER LIMITADO DE PROPÓSITO: o agent LÊ o que quiser e ESCREVE em três
   lugares só — a fila de decisões, a própria task e a memória da empresa.
   Não cria card e não mexe em board.

   A memória entrou na lista em 30/ago/2026: antes o agent só lia, então todo
   run terminava e a empresa não aprendia nada — o próximo redescobria a mesma
   coisa gastando token de novo. */
import { createRequire } from 'node:module'
import { ler } from './config.mjs'
import { api, get, erroLegivel } from './api.mjs'
import { rodarAgenteOpenAI } from './motor-glm.mjs'
import { ESCOPO_NOVO, rotulosDeEscopo, descricaoDeEscopo, DESC_SUGERIDO } from './acoes.mjs'
import { dim, azul, gold, verde, coral, agora, info } from './ui.mjs'

const require = createRequire(import.meta.url)
let sdkPromise = null
const sdk = () => (sdkPromise ??= import('@anthropic-ai/claude-agent-sdk'))

// ids antigos foram salvos como "claude-haiku-4.5"; a API quer hífen na versão
const fixModelo = (m) => (/^claude/i.test(m || '') ? String(m).replace(/(\d)\.(\d)/g, '$1-$2') : m)

/* Sem ANTHROPIC_API_KEY no ambiente, o motor cai no login do Claude Code da
   máquina — que é o desenho: a assinatura é do sócio e nunca sai daqui. */
/* CREDENCIAL DO RUNNER — chave de API primeiro, assinatura como queda.

   Metade das falhas registradas foi uma causa só: "You've hit your session
   limit · resets 7pm". Isso é limite de ASSINATURA, e a §12 já tinha decidido
   que assinatura paga terminal e automação paga chave — só que o código fazia
   o contrário, apagando ANTHROPIC_API_KEY de propósito pra forçar o seat.

   Os dois modos são excludentes: com chave, CLAUDE_CONFIG_DIR não serve pra
   nada (não há conta a escolher), e mantê-lo só confunde quem lê o log. Sem
   chave, cai no comportamento antigo — nenhuma máquina para por causa disto. */
function envDoAgente(contaDir, chaveApi) {
  const env = { ...process.env }
  if (chaveApi) {
    env.ANTHROPIC_API_KEY = chaveApi
    delete env.CLAUDE_CONFIG_DIR
    return env
  }
  delete env.ANTHROPIC_API_KEY
  if (contaDir) env.CLAUDE_CONFIG_DIR = contaDir
  return env
}

/* Tudo que o erro sabia, antes de virar frase. Guardado inteiro numa string
   porque é pra LER quando algo der errado, não pra consultar por campo — e
   objeto de erro não serializa em JSON.stringify (message e stack somem). */
function detalharErro(err) {
  const p = []
  if (err?.name) p.push(`name: ${err.name}`)
  if (err?.message) p.push(`message: ${err.message}`)
  if (err?.code) p.push(`code: ${err.code}`)
  if (err?.exitCode !== undefined) p.push(`exitCode: ${err.exitCode}`)
  if (err?.stderr) p.push(`stderr:\n${String(err.stderr).slice(0, 4000)}`)
  if (err?.stdout) p.push(`stdout:\n${String(err.stdout).slice(0, 2000)}`)
  if (err?.cause) p.push(`cause: ${err.cause?.message || err.cause?.code || String(err.cause)}`)
  if (err?.stack) p.push(`stack:\n${String(err.stack).slice(0, 3000)}`)
  return p.join('\n') || String(err)
}

async function ferramentasEmpresa(ctx) {
  const { createSdkMcpServer, tool } = await sdk()
  const zod = require('zod')
  const z = zod.z || zod
  const texto = (t) => ({ content: [{ type: 'text', text: String(t) }] })
  const falha = (t) => ({ content: [{ type: 'text', text: String(t) }], isError: true })

  return createSdkMcpServer({
    name: 'nomade',
    version: '1.0.0',
    alwaysLoad: true, // são poucas: não vale escondê-las atrás de busca de ferramenta
    tools: [

      tool(
        'buscar_memoria',
        'Busca na memória da empresa: decisões já tomadas, preferências dos sócios, fatos estáveis de clientes e projetos. ' +
        'Usa ANTES de assumir qualquer coisa sobre como a empresa faz as coisas — teu palpite não vale, a memória vale. ' +
        'A busca é semântica e traz também memórias vizinhas por associação, então pergunta amplo em vez de palavra-chave solta.',
        { pergunta: z.string().min(2).describe('o que tu quer lembrar, em linguagem natural') },
        async ({ pergunta }) => {
          try {
            /* task no querystring: o serviço resolve de quem ela é e a busca passa a
               ver só esse cliente mais o que é da casa. O agent não escolhe escopo. */
            const d = await get(`/api/office/memories/recall?q=${encodeURIComponent(pergunta)}`
              + (ctx.taskId ? `&task=${encodeURIComponent(ctx.taskId)}` : ''))
            ctx.ferramenta(`memória · ${pergunta.slice(0, 60)}`)
            if (!d.total) return texto('Nada na memória da empresa sobre isso. Segue sem assumir nada — e se for uma escolha que importa, abre decisão.')
            const aviso = (d.embedder ? '' : '\n(busca por texto: o embedder está fora, então pode ter escapado coisa relevante)')
              // escopo fechado por engano devolve pouco; melhor dizer do que o agent concluir que não há nada
              + (/não resolvida/.test(d.escopo?.nota || '') ? '\n(não deu pra saber de quem é esta task: só veio memória da casa, nada de cliente)' : '')
            return texto(d.memorias.map(m =>
              `- ${m.titulo ? `${m.titulo}: ` : ''}${m.conteudo}` +
              `${m.projeto ? ` [projeto: ${m.projeto}]` : ''}` +
              `${m.origem === 'salto' ? ' (relacionada)' : ''}`).join('\n') + aviso)
          } catch (e) { return falha(`Não deu pra consultar a memória: ${e.message}`) }
        }
      ),

      /* O outro lado do buscar_memoria. Sem isto todo run terminava e a empresa
         não aprendia nada: o agent descobria como o cliente gosta, por que o
         deploy quebra, qual convenção o repo usa — e jogava fora ao fechar a
         task. O `memCreate` do serviço deduplica e ANEXA em memória parecida,
         então gravar de novo o mesmo assunto não polui a base. */
      tool(
        'gravar_memoria',
        'Grava na memória da empresa um fato que vai valer DEPOIS desta task. ' +
        'Usa quando descobrir algo estável: uma preferência do cliente, uma convenção do repositório, ' +
        'o motivo real de um erro que se repete, uma decisão que os sócios tomaram no meio do caminho. ' +
        'NÃO grava o que já está no código (isso se lê de novo), nem o que só vale para esta task, ' +
        'nem suposição tua — memória errada é pior que memória vazia, porque o próximo agent confia nela. ' +
        'Escreve como fato curto e autocontido, que se entenda daqui a seis meses sem ter visto esta task.',
        {
          titulo: z.string().optional().describe('resumo em poucas palavras — é o que aparece na lista'),
          conteudo: z.string().min(12).describe('o fato, direto, sem o contexto da conversa'),
          /* z.enum precisa de tupla não-vazia; sem lista, cai em string livre e
             quem segura é a trava do memCreate — que marca pendente, não chuta. */
          projeto: (rotulosDeEscopo(ctx).length
            ? z.enum([...rotulosDeEscopo(ctx), ESCOPO_NOVO])
            : z.string()).optional().describe(descricaoDeEscopo(rotulosDeEscopo(ctx))),
          projetoSugerido: z.string().optional().describe(DESC_SUGERIDO),
          tags: z.string().optional().describe('palavras-chave separadas por vírgula'),
        },
        async ({ titulo, conteudo, projeto, projetoSugerido, tags }) => {
          try {
            const r = await api('/api/office/memories', {
              method: 'POST',
              body: JSON.stringify({ title: titulo || '', content: conteudo, project: projeto || '', projetoSugerido: projetoSugerido || '', tags: tags || '' }),
            })
            const m = await r.json().catch(() => null)
            ctx.ferramenta(`gravou memória · ${String(titulo || conteudo).slice(0, 60)}`)
            return texto(m?.id
              ? 'Guardado na memória da empresa — da próxima o buscar_memoria acha isso.'
              : 'Não deu pra gravar agora. Segue o trabalho, não trava por isso.')
          } catch (e) { return falha(`Não deu pra gravar na memória: ${e.message}`) }
        }
      ),

      tool(
        'ver_cliente',
        'Ficha completa de um cliente da empresa: segmento, plano, status, NOTAS (onde moram combinados que não estão escritos em mais lugar nenhum), ' +
        'tarefas abertas dele, entregas recentes e decisões pendentes. Aceita nome, e-mail ou id. ' +
        'Chama isto antes de trabalhar em qualquer coisa de cliente — entregar sem ler a ficha é como entrar numa reunião sem saber com quem tu fala.',
        { referencia: z.string().min(2).describe('nome, e-mail ou id do cliente') },
        async ({ referencia }) => {
          try {
            const c = await get(`/api/office/clientes/${encodeURIComponent(referencia)}`)
            ctx.ferramenta(`cliente · ${c.nome}`)
            return texto([
              `${c.nome}${c.segmento ? ` · ${c.segmento}` : ''}${c.plano ? ` · plano ${c.plano}` : ''} · ${c.status}`,
              c.email ? `e-mail: ${c.email}` : null,
              c.notas ? `\nNOTAS DO CLIENTE (o combinado):\n${c.notas}` : null,
              c.board?.pastaNoRunner ? `\nPasta do projeto nesta máquina: ${c.board.pastaNoRunner}` : null,
              c.tarefasAbertas.length
                ? `\nTarefas abertas (${c.totalAbertas}):\n` + c.tarefasAbertas.map(t =>
                    `- [${t.coluna}] ${t.titulo}${t.responsavel ? ` · ${t.responsavel}` : ''}`).join('\n')
                : '\nNenhuma tarefa aberta.',
              c.entreguesRecentes.length ? `\nEntregue recentemente:\n` + c.entreguesRecentes.map(t => `- ${t.titulo}`).join('\n') : null,
              c.decisoesAbertas.length ? `\nATENÇÃO — decisões pendentes com os sócios:\n` + c.decisoesAbertas.map(d => `- ${d.pergunta}`).join('\n') : null,
            ].filter(Boolean).join('\n'))
          } catch (e) {
            return falha(`Não achei esse cliente (${e.message}). Confere o nome — ou segue sem, se a task não for de cliente.`)
          }
        }
      ),

      tool(
        'gerar_imagem',
        'Desenha uma imagem a partir de uma descrição e devolve a URL dela. Roda nas CHAVES DA EQUIPE (OpenAI, com Gemini de reserva), ' +
        'não na assinatura desta máquina. Usa pra post, capa, mockup, ilustração — arte que vai pro cliente ou pro site. ' +
        'Descreve como quem dá briefing a um ilustrador: assunto, enquadramento, luz, paleta, estilo. Vale citar a paleta da marca. ' +
        'NÃO usa pra "ilustrar" a tua resposta: cada imagem custa dinheiro de verdade.',
        {
          descricao: z.string().min(10).describe('a cena, em detalhe: assunto, enquadramento, luz, paleta, estilo'),
          tamanho: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024')
            .describe('quadrado · deitado (capa, hero) · em pé (story, cartaz)'),
        },
        async ({ descricao, tamanho }) => {
          try {
            const cfg = await ler()
            const r = await api('/api/office/imagens', {
              method: 'POST',
              body: JSON.stringify({ prompt: descricao, tamanho, squad: ctx.squad, taskId: ctx.taskId || null }),
              timeout: 180_000, // desenhar demora bem mais que uma resposta de texto
            })
            const j = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
            const url = `${cfg.url}${j.url}`
            ctx.ferramenta(`imagem · ${descricao.slice(0, 50)}`)
            // a URL é estável e pública por id — serve pra colar no card, no site ou no chat
            return texto(`Imagem pronta: ${url}\nEssa URL é definitiva; usa ela onde a imagem precisa aparecer.`)
          } catch (e) { return falha(`Não deu pra gerar a imagem: ${e.message}`) }
        }
      ),

      tool(
        'abrir_decisao',
        'Levanta uma pergunta pra um sócio responder e PARA o trabalho. ' +
        'Usa quando bater numa escolha que só humano pode fazer: preço, escopo, tecnologia que muda o projeto, ou qualquer coisa irreversível. ' +
        'Não chuta e não decide por conta própria — decisão errada tomada sozinha custa mais caro que uma pergunta. ' +
        'Depois de chamar isto, ENCERRA a resposta: não continua trabalhando em cima de um palpite.',
        {
          pergunta: z.string().min(5).describe('a pergunta, direta, que o sócio vai ler na fila'),
          contexto: z.string().default('').describe('o que tu já apurou e por que travou aqui'),
          opcoes: z.array(z.string()).default([]).describe('os caminhos possíveis, se tu enxerga mais de um'),
          sugestao: z.string().default('').describe('o que tu faria, e por quê'),
          urgencia: z.enum(['urgente', 'hoje', 'andamento', 'afazer']).default('hoje'),
        },
        async ({ pergunta, contexto, opcoes, sugestao, urgencia }) => {
          if (ctx.estado.encerrado) return falha('Esta task já foi encerrada nesta rodada. Não abre outra decisão — só termina a resposta.')
          try {
            const r = await api('/api/office/decisions', {
              method: 'POST',
              body: JSON.stringify({ pergunta, contexto, opcoes, sugestao, urgencia, agentName: ctx.squad, taskId: ctx.taskId || null }),
            })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            ctx.estado.encerrado = 'decisao'
            ctx.estado.detalhe = pergunta
            ctx.ferramenta(`${gold('decisão')} · ${pergunta.slice(0, 60)}`)
            return texto('Decisão registrada na fila dos sócios. Para por aqui — a task volta pra ti quando alguém responder.')
          } catch (e) { return falha(`Não deu pra registrar a decisão: ${e.message}. NÃO segue no chute — encerra e avisa.`) }
        }
      ),

      tool(
        'entregar',
        'Registra a entrega e fecha a task no kanban. Chama UMA vez, quando o trabalho estiver de fato feito. ' +
        'Se o squad tem autonomia 0, isto abre uma aprovação pro sócio em vez de fechar direto — é o esperado, não é erro. ' +
        'Sem chamar isto a task NÃO fecha, por mais trabalho que tenha sido feito. Depois de chamar, encerra a resposta.',
        {
          resumo: z.string().min(3).describe('uma linha: o que foi entregue'),
          detalhe: z.string().default('').describe('o que foi feito, onde, e o que o sócio precisa saber pra conferir'),
          atendidos: z.array(z.string()).optional().describe(
            'quando a task tem critérios de aceite: um item por critério, NA MESMA ORDEM, dizendo COMO tu atendeu ' +
            '(arquivo, comportamento, teste). Não é "feito" — é o que dá pra conferir.'
          ),
        },
        async ({ resumo, detalhe, atendidos }) => {
          if (ctx.estado.encerrado) return falha('Esta task já foi encerrada nesta rodada. Não entrega de novo — só termina a resposta.')
          try {
            /* PORTÃO DOS CRITÉRIOS. Sem isto "entregue" era só a palavra do
               agent: o card fechava e ninguém sabia se prestava sem abrir. O
               pareamento é POR ÍNDICE, e o texto do critério que vai pro
               registro é o do card, não o que o agent digitou — senão bastava
               parafrasear o critério pra "atender" outro. */
            const exigidos = ctx.criterios || []
            let prestacao = ''
            if (exigidos.length) {
              const dados = Array.isArray(atendidos) ? atendidos.map(a => String(a || '').trim()) : []
              if (dados.length !== exigidos.length) {
                return falha(
                  `Esta task tem ${exigidos.length} critério(s) de aceite e o "atendidos" veio com ${dados.length}. ` +
                  `Manda um item para CADA, na mesma ordem:\n` +
                  exigidos.map((c, i) => `${i + 1}. ${c}`).join('\n')
                )
              }
              const fraco = dados.findIndex(d => d.length < 15)
              if (fraco !== -1) {
                return falha(
                  `O critério ${fraco + 1} ("${exigidos[fraco]}") não foi justificado. ` +
                  `Diz concretamente o que foi feito — arquivo, comportamento, como conferir. "Feito" não serve.`
                )
              }
              prestacao = '\n\nCritérios de aceite:\n' + exigidos.map((c, i) => `- ${c}\n  → ${dados[i]}`).join('\n')
            }
            const corpo = ([resumo, detalhe].filter(Boolean).join('\n\n') + prestacao).slice(0, 4000)
            /* Run avulso (`nomade aqui`) não tem card pra fechar. A entrega
               continua existindo: encerra o turno e aparece no terminal. Sem
               isto o PATCH ia pra /tarefas-agent/null e o agent achava que a
               entrega falhou — ficaria tentando de novo até estourar o turno. */
            if (!ctx.taskId) {
              ctx.estado.encerrado = 'entrega'
              ctx.estado.detalhe = corpo
              ctx.ferramenta(`${verde('entrega')} · ${resumo.slice(0, 60)}`)
              return texto('Entrega registrada. Esta rodada não tem card no kanban (run avulso), então nada a fechar. Encerra por aqui.')
            }
            const r = await api(`/api/office/tarefas-agent/${ctx.taskId}`, {
              method: 'PATCH',
              body: JSON.stringify({ estado: 'feita', autor: ctx.squad, comentario: corpo }),
            })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            ctx.estado.encerrado = 'entrega'
            ctx.estado.detalhe = corpo
            ctx.ferramenta(`${verde('entrega')} · ${resumo.slice(0, 60)}`)
            return texto(ctx.autonomia === 0
              ? 'Entrega registrada. Como este squad pede aprovação, foi pra fila do sócio em vez de fechar. Encerra por aqui.'
              : 'Entrega registrada e task fechada no kanban. Encerra por aqui.')
          } catch (e) { return falha(`Não deu pra registrar a entrega: ${e.message}`) }
        }
      ),

    ],
  })
}

/* Contrato de trabalho — vai APPENDADO ao preset do Claude Code, não no lugar
   dele. O preset é quem ensina a usar Read/Edit/Bash direito; trocá-lo por um
   parágrafo nosso faz o agent DESCREVER o trabalho em vez de fazer. */
export function promptDoSquad(squad, instrucoes) {
  return [
    `Tu és ${squad.name}, agent da empresa${squad.dept ? ` no departamento de ${squad.dept}` : ''}.`,
    'A empresa é tocada pelos sócios; tu és um dos agents dela. Tu FAZ o trabalho — não descreve o que faria.',
    instrucoes ? `\n${instrucoes.trim()}` : '',
    '',
    'COMO TU TRABALHA:',
    '- Antes de assumir qualquer coisa sobre a empresa, um cliente ou uma decisão passada, chama buscar_memoria. Teu palpite não vale; a memória da empresa vale.',
    '- Descobriu no caminho um fato que vai valer DEPOIS desta task — convenção do repo, preferência do cliente, a causa real de um erro que se repete? chama gravar_memoria. O próximo agent começa sabendo, em vez de redescobrir. Não grava o que já está no código, nem o que só serve pra hoje.',
    '- Se a task é de um cliente, chama ver_cliente ANTES de começar. As notas dele guardam combinado que não está escrito em mais lugar nenhum.',
    '- Tu tem acesso real aos arquivos do projeto: ler, editar, rodar comando. Trabalho de código se faz EDITANDO ARQUIVO, não escrevendo o que deveria ser editado.',
    '- Escolha que só um sócio pode fazer (preço, escopo, tecnologia que muda o projeto, algo irreversível): chama abrir_decisao e para. Nunca chuta.',
    '- Precisa de arte (post, capa, mockup, ilustração)? chama gerar_imagem e usa a URL que ela devolve. Não descreve a imagem: gera.',
    '- Quando terminar de verdade, chama entregar. Sem isso a task não fecha, por mais trabalho que tu tenha feito.',
    '- Se a task trouxe CRITÉRIOS DE ACEITE, o entregar vai te cobrar um item por critério, na ordem, dizendo como tu atendeu. Trabalha olhando pra eles desde o começo — descobrir no fim que um não foi atendido custa refazer.',
    '- Entrega o trabalho, não um relatório sobre o trabalho. Sem preâmbulo, sem "vou fazer", sem repetir o enunciado.',
  ].filter(Boolean).join('\n')
}

const MAX_TURNOS = 60 // trava de loop maluco; um run normal usa bem menos

/** Uma linha por ferramenta usada — é isto que a web mostra no lugar de log cru. */
function resumoDaFerramenta(input = {}) {
  const i = input || {}
  // os dois motores nomeiam diferente: o Agent SDK usa file_path/command,
  // as ferramentas de arquivo.mjs usam caminho/comando. Sem os dois, o log
  // do run sai como "rodar:" sem dizer o quê — e não dá pra depurar nada.
  return String(
    i.file_path || i.path || i.pattern || i.url || i.command || i.prompt ||
    i.caminho || i.comando || i.texto || i.pasta ||
    i.pergunta || i.referencia || i.resumo || i.descricao || ''
  ).replace(/\s+/g, ' ').slice(0, 140)
}

export async function rodarSquad({ cwd, objetivo, squad, taskId, runId, contaDir = null, silencioso = false, criterios = [] }) {
  const aoServico = async (body) => {
    if (!runId) return
    await api(`/api/office/runs/${runId}`, { method: 'PATCH', body: JSON.stringify(body) }).catch(() => {})
  }
  const naTask = async (body) => {
    if (!taskId) return
    await api(`/api/office/tarefas-agent/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) }).catch(() => {})
  }

  const abort = new AbortController()
  const parar = () => abort.abort()
  process.on('SIGINT', parar)

  const t0 = Date.now()
  const autonomia = Math.min(3, Math.max(0, Number(squad.autonomia) || 0))
  const ferramentas = []
  const estado = { encerrado: null, detalhe: '' }
  const instrucoes = squad.instrucoes || squad.agents?.[0]?.systemPrompt || ''
  const modelo = squad.modelo || (await ler()).modelo || null
  let resultado = { ok: true }
  let saida = ''

  const anotar = (linha) => {
    ferramentas.push(linha.replace(/\x1b\[[0-9;]*m/g, '')) // sem cor no que vai pro banco
    if (!silencioso) info(`   ${dim('·')} ${linha}`)
  }

  /* DOIS MOTORES, e quem escolhe é o modelo do squad.
     Sem modelo ou `claude-*` → Agent SDK (ferramentas de arquivo prontas).
     `zai:`, `glm`, `openai:`, `gemini:`, `ollama:` → motor agnóstico, com as
     ferramentas de arquivo escritas à mão em arquivo.mjs.
     As AÇÕES DA EMPRESA são as mesmas nos dois (acoes.mjs) — o agent se
     comporta igual, só muda quem pensa. */
  const ehClaude = !modelo || /^claude/i.test(modelo)
  /* Declarado FORA do desvio de propósito: os dois motores publicam progresso
     com ele, e o resumo da etapa (lá embaixo) também. Declarar dentro de um
     dos ramos fazia o run terminar com "info_ is not defined" DEPOIS de já
     ter entregue — a peça saía e o board marcava falha. */
  /* A lista fechada de escopos, buscada UMA vez e usada pelos dois motores.
     Declarada aqui fora pelo mesmo motivo que o info_: dentro de um ramo, o
     outro fica sem — e o motor que ficasse sem voltaria a aceitar rótulo
     livre, que é o buraco por onde a grafia suja entrava. Falhou a busca?
     lista vazia, campo vira texto livre, e quem segura é a trava do memCreate. */
  const escopos = await get('/api/office/escopos').then(r => r.escopos || []).catch(() => [])
  /* Buscadas UMA vez, fora do desvio: o ramo GLM já precisava delas, e agora o
     ramo Claude também. Serviço fora do ar = objeto vazio, e aí o motor Claude
     volta pra assinatura em vez de não rodar. */
  const chaves = await get('/api/office/keys/raw').catch(() => ({}))
  const chaveApi = String(chaves.anthropic || '').trim() || null

  const info_ = { indice: 1, nome: squad.name, modelo: modelo || 'claude', motor: 'agente', desde: new Date().toISOString() }
  /* Declarado FORA do desvio pelo mesmo motivo que o info_: quem lê é a etapa,
     que é montada depois dos dois ramos. Dentro do ramo Claude, a etapa não
     enxergaria — e o erro só apareceria em produção, com o run já entregue. */
  let resultadoSdk = null

  try {
    if (!ehClaude) {
      const ctx = { taskId, squad: squad.name, autonomia, estado, ferramenta: anotar, criterios, escopos }
      let ultimoPing = 0
      await aoServico({ atual: { ...info_, ferramentas: [] } })

      saida = await rodarAgenteOpenAI({
        spec: modelo, chaves, cwd,
        sistema: `${promptDoSquad(squad, instrucoes)}

Tu trabalha DENTRO da pasta do projeto. Use as ferramentas de arquivo pra ler antes de escrever — nunca edita às cegas.`,
        objetivo, ctx,
        aoPasso: (p) => {
          if (p.tipo === 'texto' && !silencioso) {
            process.stdout.write(dim(p.texto.length > 400 ? p.texto.slice(0, 400) + '…\n' : p.texto + '\n'))
          }
          if (p.tipo === 'ferramenta' && !/^(buscar_memoria|gravar_memoria|ver_cliente|gerar_imagem|abrir_decisao|entregar)$/.test(p.nome)) {
            anotar(`${p.nome}: ${resumoDaFerramenta(p.args)}`)
          }
          if (Date.now() - ultimoPing > 4000) {
            ultimoPing = Date.now()
            aoServico({ atual: { ...info_, ferramentas: ferramentas.slice(-12) } }).catch(() => {})
          }
        },
      })
    } else {

    const { query } = await sdk()
    const servidor = await ferramentasEmpresa({
      taskId, squad: squad.name, autonomia, estado, ferramenta: anotar, criterios, escopos,
    })

    let ultimoPing = 0
    const pingar = async (forcar = false) => {
      if (!runId) return
      if (!forcar && Date.now() - ultimoPing < 4000) return
      ultimoPing = Date.now()
      await aoServico({ atual: { ...info_, ferramentas: ferramentas.slice(-12) } })
    }
    await pingar(true) // aparece na web assim que COMEÇA, não quando acaba

    const textos = []
    const stream = query({
      prompt: objetivo,
      options: {
        cwd,
        model: modelo ? fixModelo(modelo) : undefined,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: promptDoSquad(squad, instrucoes) },
        mcpServers: { nomade: servidor },
        permissionMode: 'bypassPermissions',
        maxTurns: MAX_TURNOS,
        abortController: abort,
        env: envDoAgente(contaDir, chaveApi),
      },
    })

    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        for (const b of (msg.message?.content ?? [])) {
          if (b.type === 'text' && b.text) {
            textos.push(b.text)
            if (!silencioso) process.stdout.write(dim(b.text.length > 400 ? b.text.slice(0, 400) + '…\n' : b.text + '\n'))
          } else if (b.type === 'tool_use') {
            if (!String(b.name || '').startsWith('mcp__nomade__')) {
              anotar(`${b.name}: ${resumoDaFerramenta(b.input)}`)
            }
            pingar().catch(() => {})
          }
        }
      } else if (msg.type === 'result') {
        saida = msg.result || ''
        /* Bater no teto de turnos NÃO é "terminou". Até aqui só o motor GLM
           marcava isso; o Claude caía no mesmo else e reportava "terminou sem
           chamar entregar", mandando quem for depurar procurar a coisa errada.
           O SDK diz de graça no subtype — era só ler. */
        if (msg.subtype === 'error_max_turns') estado.estourou = true
        // num_turns e usage: o card de tokens da dash vivia em "—" porque o
        // runner nunca mandava, e o dado estava aqui o tempo todo
        resultadoSdk = {
          subtype: msg.subtype || null,
          turnos: msg.num_turns ?? null,
          tokens: (msg.usage?.input_tokens || 0) + (msg.usage?.output_tokens || 0) || null,
          custoUsd: msg.total_cost_usd ?? null,
        }
      }
    }
    saida = saida || textos.join('\n')
    } // fim do caminho Claude

    const etapa = {
      indice: 1, total: 1, nome: squad.name, modelo: info_.modelo, motor: 'agente',
      saida: String(estado.detalhe || saida).slice(0, 12000),
      ferramentas: ferramentas.slice(0, 40), duracaoMs: Date.now() - t0,
      ...(resultadoSdk || {}),
    }

    if (abort.signal.aborted) {
      await aoServico({ status: 'parado', erro: 'Interrompido.' })
      resultado = { ok: false, motivo: 'interrompido' }
    } else if (estado.encerrado === 'decisao') {
      await aoServico({ etapa, status: 'decisao', erro: `Parou pra perguntar: ${estado.detalhe}` })
      await naTask({ autor: 'Runner', comentario: `O agent parou e levantou uma decisão: ${estado.detalhe}` })
      resultado = { ok: true, parouPorDecisao: true, motivo: 'decisão pendente' }
    } else if (estado.encerrado === 'entrega') {
      await aoServico({ etapa, status: 'feito' })
      // a própria ferramenta `entregar` já fechou a task — nada a fazer aqui
    } else {
      /* Terminou sem entregar e sem perguntar. Não fecha: o board mentiria.
         Comenta o que saiu e devolve pra fila, que é o que de fato aconteceu. */
      const texto = String(saida || '').slice(0, 3000) || '(sem saída)'
      /* Bater no teto de passos é outro diagnóstico: o agent não "esqueceu"
         de entregar — ele se perdeu, quase sempre porque a pasta do board
         não é a do projeto e ele tentou reconstruir tudo do zero. */
      const motivo = estado.estourou
        ? 'Estourou o teto de passos sem concluir — confere se a pasta do board é mesmo a do projeto.'
        : 'Terminou sem chamar entregar nem abrir_decisao.'
      await aoServico({
        etapa: { ...etapa, saida: texto }, status: 'falhou', erro: motivo,
        erroBruto: resultadoSdk ? `subtype=${resultadoSdk.subtype} turnos=${resultadoSdk.turnos}` : null,
      })
      await naTask({ estado: 'falha', autor: 'Runner', comentario: `${motivo}\n\nO que ele produziu:\n\n${texto}` })
      resultado = { ok: false, motivo }
    }
  } catch (err) {
    const motivo = abort.signal.aborted ? 'Interrompido.' : erroLegivel(err)
    const bruto = detalharErro(err)
    await aoServico({ status: 'falhou', erro: motivo, erroBruto: bruto })
    if (!estado.encerrado) {
      await naTask({ estado: 'falha', autor: 'Runner', comentario: `Execução no runner não terminou: ${motivo}` })
    }
    resultado = { ok: false, motivo, motivoBruto: bruto }
  } finally {
    process.off('SIGINT', parar)
  }
  return { ...resultado, ferramentas, duracaoMs: Date.now() - t0 }
}
