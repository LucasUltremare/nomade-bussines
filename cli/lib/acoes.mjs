/* ═══ AS AÇÕES DA EMPRESA ════════════════════════════════════════════════
   As cinco coisas que o agent sabe fazer além de mexer em arquivo, escritas
   uma vez só, em formato NEUTRO: função + schema JSON.

   Dois motores consomem daqui — o do Claude (que envolve em MCP) e o do GLM
   (que envolve em function calling). Se ficassem duplicadas, um dia uma
   ganharia uma regra que a outra não tem, e o agent passaria a se comportar
   diferente dependendo do modelo. Isso seria impossível de depurar.

   PODER LIMITADO DE PROPÓSITO: lê o que quiser, escreve em dois lugares —
   a fila de decisões e a própria task. Não cria card, não mexe em board,
   não grava memória. */
import { ler } from './config.mjs'
import { api, get } from './api.mjs'

/* ═══ ESCOPO da memória, escrito UMA vez ═════════════════════════════════
   Os dois motores gravam memória — o do Claude por MCP (agente.mjs) e o do
   GLM por function calling (aqui). O `gravar_memoria` já vive duplicado
   entre os dois; se a regra de escopo também duplicasse, um dia um motor
   aceitaria rótulo livre e o outro não, e a grafia suja voltaria pelo lado
   que ficou aberto. Daqui saem os dois.

   A lista vem de `ctx.escopos` (GET /api/office/escopos), que é a MESMA
   fonte que o orquestrador lê. Sem ela o campo vira string livre — e aí quem
   segura é a trava do memCreate no serviço, que marca a memória como pendente
   em vez de chutar dono. */
export const ESCOPO_NOVO = '__novo__'

export const rotulosDeEscopo = (ctx) =>
  (Array.isArray(ctx?.escopos) ? ctx.escopos : []).map(e => e.rotulo).filter(Boolean)

export const descricaoDeEscopo = (rotulos) =>
  'Cliente ou assunto a que o fato pertence. Usa um dos rótulos EXATOS' +
  (rotulos.length ? ` — ${rotulos.join(' | ')}` : '') +
  `. Fato que vale pra empresa toda (convenção, preferência dos sócios) vai SEM projeto. ` +
  `Se for de um cliente ou assunto que NÃO está na lista, manda "${ESCOPO_NOVO}" e preenche projetoSugerido — ` +
  'NÃO escolhe o mais parecido: memória no cliente errado é pior que memória sem dono.'

export const DESC_SUGERIDO = `o nome que tu daria ao escopo — só quando projeto="${ESCOPO_NOVO}"`


/* `ctx` carrega o que muda por execução: taskId, nome do squad, autonomia,
   o estado de encerramento e o callback que anota a ferramenta usada. */
export function acoesDaEmpresa(ctx) {
  const encerra = (tipo, detalhe) => { ctx.estado.encerrado = tipo; ctx.estado.detalhe = detalhe }

  return {
    buscar_memoria: {
      descricao:
        'Busca na memória da empresa: decisões já tomadas, preferências dos sócios, fatos estáveis de clientes e projetos. ' +
        'Usa ANTES de assumir qualquer coisa sobre como a empresa faz as coisas — teu palpite não vale, a memória vale. ' +
        'A busca é semântica e traz também memórias vizinhas por associação, então pergunta amplo em vez de palavra-chave solta.',
      schema: {
        type: 'object',
        properties: { pergunta: { type: 'string', description: 'o que tu quer lembrar, em linguagem natural' } },
        required: ['pergunta'],
      },
      async executar({ pergunta }) {
        /* task no querystring: o serviço resolve de quem ela é e a busca passa a
           ver só esse cliente mais o que é da casa. O agent não escolhe escopo. */
        const d = await get(`/api/office/memories/recall?q=${encodeURIComponent(pergunta)}`
          + (ctx.taskId ? `&task=${encodeURIComponent(ctx.taskId)}` : ''))
        ctx.ferramenta(`memória · ${String(pergunta).slice(0, 60)}`)
        if (!d.total) return 'Nada na memória da empresa sobre isso. Segue sem assumir nada — e se for uma escolha que importa, abre decisão.'
        const aviso = (d.embedder ? '' : '\n(busca por texto: o embedder está fora, então pode ter escapado coisa relevante)')
          // escopo fechado por engano devolve pouco; melhor dizer do que o agent concluir que não há nada
          + (/não resolvida/.test(d.escopo?.nota || '') ? '\n(não deu pra saber de quem é esta task: só veio memória da casa, nada de cliente)' : '')
        return d.memorias.map(m =>
          `- ${m.titulo ? `${m.titulo}: ` : ''}${m.conteudo}` +
          `${m.projeto ? ` [projeto: ${m.projeto}]` : ''}` +
          `${m.origem === 'salto' ? ' (relacionada)' : ''}`).join('\n') + aviso
      },
    },

    /* O outro lado do buscar_memoria. Sem isto todo run terminava e a empresa
       não aprendia nada: o agent descobria como o cliente gosta, por que o
       deploy quebra, qual convenção o repo usa — e jogava fora ao fechar a
       task. Amanhã outro agent redescobre do zero, gastando token na mesma
       descoberta. O `memCreate` do serviço deduplica e ANEXA em memória
       parecida, então gravar de novo o mesmo assunto não polui a base. */
    gravar_memoria: {
      descricao:
        'Grava na memória da empresa um fato que vai valer DEPOIS desta task. ' +
        'Usa quando descobrir algo estável: uma preferência do cliente, uma convenção do repositório, ' +
        'o motivo real de um erro que se repete, uma decisão que os sócios tomaram no meio do caminho. ' +
        'NÃO grava o que já está no código (isso se lê de novo), nem o que só vale para esta task, ' +
        'nem suposição tua — memória errada é pior que memória vazia, porque o próximo agent confia nela. ' +
        'Escreve como fato curto e autocontido, que se entenda daqui a seis meses sem ter visto esta task.',
      schema: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'resumo em poucas palavras — é o que aparece na lista' },
          conteudo: { type: 'string', description: 'o fato, direto, sem o contexto da conversa' },
          projeto: {
            type: 'string',
            ...(rotulosDeEscopo(ctx).length ? { enum: [...rotulosDeEscopo(ctx), ESCOPO_NOVO] } : {}),
            description: descricaoDeEscopo(rotulosDeEscopo(ctx)),
          },
          projetoSugerido: { type: 'string', description: DESC_SUGERIDO },
          tags: { type: 'string', description: 'palavras-chave separadas por vírgula' },
        },
        required: ['conteudo'],
      },
      async executar({ titulo, conteudo, projeto, projetoSugerido, tags }) {
        const texto = String(conteudo || '').trim()
        if (texto.length < 12) return 'Curto demais pra virar memória. Escreve o fato inteiro, ou não grava.'
        const m = await api('/api/office/memories', {
          method: 'POST',
          body: JSON.stringify({ title: titulo || '', content: texto, project: projeto || '', projetoSugerido: projetoSugerido || '', tags: tags || '' }),
        }).then(r => r.json()).catch(() => null)
        ctx.ferramenta(`gravou memória · ${String(titulo || texto).slice(0, 60)}`)
        return m?.id
          ? 'Guardado na memória da empresa — da próxima o buscar_memoria acha isso.'
          : 'Não deu pra gravar agora. Segue o trabalho, não trava por isso.'
      },
    },

    ver_cliente: {
      descricao:
        'Ficha completa de um cliente da empresa: segmento, plano, status, NOTAS (onde moram combinados que não estão escritos em mais lugar nenhum), ' +
        'tarefas abertas dele, entregas recentes e decisões pendentes. Aceita nome, e-mail ou id. ' +
        'Chama isto antes de trabalhar em qualquer coisa de cliente.',
      schema: {
        type: 'object',
        properties: { referencia: { type: 'string', description: 'nome, e-mail ou id do cliente' } },
        required: ['referencia'],
      },
      async executar({ referencia }) {
        const c = await get(`/api/office/clientes/${encodeURIComponent(referencia)}`)
        ctx.ferramenta(`cliente · ${c.nome}`)
        return [
          `${c.nome}${c.segmento ? ` · ${c.segmento}` : ''}${c.plano ? ` · plano ${c.plano}` : ''} · ${c.status}`,
          c.email ? `e-mail: ${c.email}` : null,
          c.notas ? `\nNOTAS DO CLIENTE (o combinado):\n${c.notas}` : null,
          c.board?.pastaNoRunner ? `\nPasta do projeto nesta máquina: ${c.board.pastaNoRunner}` : null,
          c.tarefasAbertas?.length
            ? `\nTarefas abertas (${c.totalAbertas}):\n` + c.tarefasAbertas.map(t => `- [${t.coluna}] ${t.titulo}${t.responsavel ? ` · ${t.responsavel}` : ''}`).join('\n')
            : '\nNenhuma tarefa aberta.',
          c.entreguesRecentes?.length ? `\nEntregue recentemente:\n` + c.entreguesRecentes.map(t => `- ${t.titulo}`).join('\n') : null,
          c.decisoesAbertas?.length ? `\nATENÇÃO — decisões pendentes com os sócios:\n` + c.decisoesAbertas.map(d => `- ${d.pergunta}`).join('\n') : null,
        ].filter(Boolean).join('\n')
      },
    },

    gerar_imagem: {
      descricao:
        'Desenha uma imagem a partir de uma descrição e devolve a URL dela. Roda nas CHAVES DA EQUIPE, não na assinatura desta máquina. ' +
        'Usa pra post, capa, mockup, ilustração. Descreve como quem dá briefing a um ilustrador: assunto, enquadramento, luz, paleta, estilo. ' +
        'NÃO usa pra ilustrar a tua resposta: cada imagem custa dinheiro de verdade.',
      schema: {
        type: 'object',
        properties: {
          descricao: { type: 'string', description: 'a cena em detalhe: assunto, enquadramento, luz, paleta, estilo' },
          tamanho: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'], description: 'quadrado · deitado · em pé' },
        },
        required: ['descricao'],
      },
      async executar({ descricao, tamanho }) {
        const cfg = await ler()
        const r = await api('/api/office/imagens', {
          method: 'POST',
          body: JSON.stringify({ prompt: descricao, tamanho: tamanho || '1024x1024', squad: ctx.squad, taskId: ctx.taskId || null }),
          timeout: 180_000,
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        ctx.ferramenta(`imagem · ${String(descricao).slice(0, 50)}`)
        return `Imagem pronta: ${cfg.url}${j.url}\nEssa URL é definitiva; usa ela onde a imagem precisa aparecer.`
      },
    },

    abrir_decisao: {
      descricao:
        'Levanta uma pergunta pra um sócio responder e PARA o trabalho. Usa quando bater numa escolha que só humano pode fazer: ' +
        'preço, escopo, tecnologia que muda o projeto, ou qualquer coisa irreversível. Não chuta e não decide por conta própria. ' +
        'Depois de chamar isto, ENCERRA a resposta.',
      schema: {
        type: 'object',
        properties: {
          pergunta: { type: 'string', description: 'a pergunta, direta, que o sócio vai ler na fila' },
          contexto: { type: 'string', description: 'o que tu já apurou e por que travou aqui' },
          opcoes: { type: 'array', items: { type: 'string' }, description: 'os caminhos possíveis' },
          sugestao: { type: 'string', description: 'o que tu faria, e por quê' },
          urgencia: { type: 'string', enum: ['urgente', 'hoje', 'andamento', 'afazer'] },
        },
        required: ['pergunta'],
      },
      async executar({ pergunta, contexto, opcoes, sugestao, urgencia }) {
        if (ctx.estado.encerrado) throw new Error('Esta task já foi encerrada nesta rodada. Só termina a resposta.')
        const r = await api('/api/office/decisions', {
          method: 'POST',
          body: JSON.stringify({
            pergunta, contexto: contexto || '', opcoes: opcoes || [],
            sugestao: sugestao || '', urgencia: urgencia || 'hoje',
            agentName: ctx.squad, taskId: ctx.taskId || null,
          }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status} — NÃO segue no chute, encerra e avisa.`)
        encerra('decisao', pergunta)
        ctx.ferramenta(`decisão · ${String(pergunta).slice(0, 60)}`)
        return 'Decisão registrada na fila dos sócios. Para por aqui — a task volta pra ti quando alguém responder.'
      },
    },

    entregar: {
      descricao:
        'Registra a entrega e fecha a task no kanban. Chama UMA vez, quando o trabalho estiver de fato feito. ' +
        'Se o squad tem autonomia 0, isto abre uma aprovação pro sócio em vez de fechar direto — é o esperado. ' +
        'Sem chamar isto a task NÃO fecha. Depois de chamar, encerra a resposta.',
      schema: {
        type: 'object',
        properties: {
          resumo: { type: 'string', description: 'uma linha: o que foi entregue' },
          detalhe: { type: 'string', description: 'o que foi feito, onde, e o que o sócio precisa saber pra conferir' },
          atendidos: {
            type: 'array', items: { type: 'string' },
            description: 'quando a task tem critérios de aceite: um item por critério, NA MESMA ORDEM, dizendo COMO tu atendeu (arquivo, comportamento, teste). Não é "feito" — é o que dá pra conferir.',
          },
        },
        required: ['resumo'],
      },
      async executar({ resumo, detalhe, atendidos }) {
        if (ctx.estado.encerrado) throw new Error('Esta task já foi encerrada nesta rodada. Só termina a resposta.')
        /* PORTÃO DOS CRITÉRIOS — ver o comentário longo no agente.mjs. Pareia
           por ÍNDICE e registra o texto do CARD, não o que o agent digitou. */
        const exigidos = ctx.criterios || []
        let prestacao = ''
        if (exigidos.length) {
          const dados = Array.isArray(atendidos) ? atendidos.map(a => String(a || '').trim()) : []
          if (dados.length !== exigidos.length) {
            throw new Error(
              `Esta task tem ${exigidos.length} critério(s) de aceite e o "atendidos" veio com ${dados.length}. ` +
              `Manda um item para CADA, na mesma ordem:\n` + exigidos.map((c, i) => `${i + 1}. ${c}`).join('\n')
            )
          }
          const fraco = dados.findIndex(d => d.length < 15)
          if (fraco !== -1) {
            throw new Error(
              `O critério ${fraco + 1} ("${exigidos[fraco]}") não foi justificado. ` +
              `Diz concretamente o que foi feito — arquivo, comportamento, como conferir. "Feito" não serve.`
            )
          }
          prestacao = '\n\nCritérios de aceite:\n' + exigidos.map((c, i) => `- ${c}\n  → ${dados[i]}`).join('\n')
        }
        const corpo = ([resumo, detalhe].filter(Boolean).join('\n\n') + prestacao).slice(0, 4000)
        /* Run avulso (`nomade aqui`) não tem card pra fechar — ver o mesmo
           guard no agente.mjs. Sem ele o PATCH ia pra /tarefas-agent/null. */
        if (!ctx.taskId) {
          encerra('entrega', corpo)
          ctx.ferramenta(`entrega · ${String(resumo).slice(0, 60)}`)
          return 'Entrega registrada. Esta rodada não tem card no kanban (run avulso), então nada a fechar. Encerra por aqui.'
        }
        const r = await api(`/api/office/tarefas-agent/${ctx.taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({ estado: 'feita', autor: ctx.squad, comentario: corpo }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        encerra('entrega', corpo)
        ctx.ferramenta(`entrega · ${String(resumo).slice(0, 60)}`)
        return ctx.autonomia === 0
          ? 'Entrega registrada. Como este squad pede aprovação, foi pra fila do sócio em vez de fechar. Encerra por aqui.'
          : 'Entrega registrada e task fechada no kanban. Encerra por aqui.'
      },
    },
  }
}
