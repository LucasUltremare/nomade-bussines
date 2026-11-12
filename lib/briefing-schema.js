/**
 * Nomade Business — schema do briefing pós-compra
 * ────────────────────────────────────────────
 * Estrutura:
 *   - Cada "section" é um grupo de perguntas (global ou por agent)
 *   - Cada "field" é uma pergunta individual
 *   - O servidor valida que TODOS os fields com `required: true` foram preenchidos
 *   - O front renderiza 1 field por tela (wizard), na ordem em que aparecem
 *
 * Tipos de field suportados:
 *   - "text"        → input curto
 *   - "textarea"    → textarea (tem `minLength` opcional)
 *   - "select"      → dropdown ou radio (dependendo de `options.length`)
 *   - "multiselect" → checkboxes (retorna array)
 *   - "drive_file"  → arquivo via Google Drive Picker
 *   - "text_or_file"→ aceita texto OU drive file (pelo menos um dos dois preenchido)
 *
 * Pra editar: só commit + deploy do server. Zero mudança no front.
 */

const GLOBAL_SECTION = {
  id: "global",
  title: "Sobre o seu negócio",
  fields: [
    {
      id: "segment",
      type: "select",
      label: "Em qual segmento o seu negócio atua?",
      hint: "Isso ajuda a gente a ajustar o tom e o contexto dos agents.",
      required: true,
      options: [
        { value: "barbearia", label: "Barbearia" },
        { value: "alimentacao", label: "Alimentação" },
        { value: "saude", label: "Saúde / Estética" },
        { value: "fitness", label: "Fitness" },
        { value: "consultoria", label: "Consultoria" },
        { value: "advocacia", label: "Advocacia" },
        { value: "educacao", label: "Educação" },
        { value: "imobiliaria", label: "Imobiliária" },
        { value: "moda", label: "Moda / Loja" },
        { value: "tattoo", label: "Tattoo / Arte" },
        { value: "tech", label: "Tecnologia" },
        { value: "outro", label: "Outro" },
      ],
    },
    {
      id: "tone",
      type: "select",
      label: "Qual o tom de voz da sua marca?",
      hint: "Como seus agents devem se comunicar com os clientes.",
      required: true,
      options: [
        { value: "formal", label: "Formal" },
        { value: "descontraido", label: "Descontraído" },
        { value: "proximo", label: "Próximo / íntimo" },
        { value: "divertido", label: "Divertido" },
        { value: "tecnico", label: "Técnico" },
      ],
    },
    {
      id: "products",
      type: "textarea",
      label: "Quais são os principais produtos ou serviços?",
      hint: "Lista o que você vende. Seja específico.",
      placeholder: "Ex: Corte de cabelo masculino (R$ 50), barba (R$ 35), combo corte + barba (R$ 75)...",
      required: true,
      minLength: 20,
    },
    {
      id: "differentials",
      type: "textarea",
      label: "Quais são os diferenciais do seu negócio?",
      hint: "O que te faz diferente da concorrência?",
      placeholder: "Ex: atendimento personalizado, especialização em X, anos de experiência...",
      required: true,
      minLength: 20,
    },
    {
      id: "objections",
      type: "textarea",
      label: "Quais são as objeções mais comuns dos seus clientes?",
      hint: "O que eles costumam falar quando querem desistir ou reclamar?",
      placeholder: "Ex: 'é caro', 'não tenho tempo', 'preciso pensar'...",
      required: true,
      minLength: 20,
    },
    {
      id: "hours",
      type: "text",
      label: "Qual o horário de atendimento?",
      placeholder: "Ex: seg-sex 9h às 18h, sábado 9h às 13h",
      required: true,
    },
    {
      id: "channels",
      type: "multiselect",
      label: "Quais canais você usa hoje?",
      hint: "Selecione todos os que usa.",
      required: true,
      options: [
        { value: "whatsapp", label: "WhatsApp" },
        { value: "instagram", label: "Instagram" },
        { value: "site", label: "Site" },
        { value: "presencial", label: "Presencial" },
        { value: "outro", label: "Outro" },
      ],
    },
    {
      id: "logo",
      type: "drive_file",
      label: "Anexa o logo da sua marca",
      hint: "Arquivo PNG, JPG ou SVG. De preferência fundo transparente.",
      required: true,
    },
  ],
};

const AGENT_SECTIONS = {
  atendimento: {
    id: "agent:atendimento",
    title: "Polvo — Atendimento",
    fields: [
      {
        id: "atendimento_faq",
        type: "text_or_file",
        label: "Qual é a FAQ atual do seu negócio?",
        hint: "Cola aqui as perguntas e respostas mais comuns, ou anexa um documento.",
        textPlaceholder: "P: Vocês atendem domingo?\nR: Sim, das 9h às 13h.\n\nP: ...",
        required: true,
        minTextLength: 40,
      },
      {
        id: "atendimento_escalate",
        type: "select",
        label: "Quando o agent deve escalar pra humano?",
        required: true,
        options: [
          { value: "always", label: "Sempre que não souber responder" },
          { value: "specific", label: "Só em casos específicos (vou detalhar abaixo)" },
          { value: "never", label: "Nunca — sempre tentar responder" },
        ],
      },
      {
        id: "atendimento_has_variations",
        type: "textarea",
        label: "Seus produtos têm estoque ou variações?",
        hint: "Ex: tamanhos, cores, quantidades limitadas. Se não tiver, escreve 'não'.",
        required: true,
        minLength: 3,
      },
    ],
  },
  vendas: {
    id: "agent:vendas",
    title: "Orca — SDR & Vendas",
    fields: [
      {
        id: "vendas_script",
        type: "text_or_file",
        label: "Qual é o seu script de venda atual?",
        hint: "Cola aqui ou anexa documento. Queremos entender como você vende hoje.",
        textPlaceholder: "Abordagem inicial: ...\nDescoberta: ...\nApresentação: ...",
        required: true,
        minTextLength: 40,
      },
      {
        id: "vendas_ticket",
        type: "text",
        label: "Qual o ticket médio da sua venda?",
        placeholder: "Ex: R$ 500",
        required: true,
      },
      {
        id: "vendas_cycle",
        type: "select",
        label: "Qual o ciclo de venda típico?",
        hint: "Do primeiro contato até fechar.",
        required: true,
        options: [
          { value: "instant", label: "Na hora (menos de 1 dia)" },
          { value: "week", label: "Menos de 1 semana" },
          { value: "short", label: "1 a 4 semanas" },
          { value: "medium", label: "1 a 3 meses" },
          { value: "long", label: "Mais de 3 meses" },
        ],
      },
      {
        id: "vendas_qualification",
        type: "textarea",
        label: "Quais critérios você usa pra qualificar um lead?",
        hint: "Como sabe se vale a pena investir tempo num lead?",
        placeholder: "Ex: orçamento acima de R$ X, empresa com mais de Y funcionários...",
        required: true,
        minLength: 20,
      },
    ],
  },
  agendamento: {
    id: "agent:agendamento",
    title: "Cavalo-Marinho — Agendamento",
    fields: [
      {
        id: "agendamento_tool",
        type: "text",
        label: "Qual ferramenta de agenda você usa hoje?",
        placeholder: "Ex: Google Calendar, Calendly, caderno...",
        required: true,
      },
      {
        id: "agendamento_duration",
        type: "select",
        label: "Qual a duração padrão de cada agendamento?",
        required: true,
        options: [
          { value: "15", label: "15 minutos" },
          { value: "30", label: "30 minutos" },
          { value: "45", label: "45 minutos" },
          { value: "60", label: "1 hora" },
          { value: "90", label: "1h30" },
          { value: "120", label: "2 horas" },
          { value: "120+", label: "Mais de 2 horas" },
        ],
      },
      {
        id: "agendamento_buffer",
        type: "select",
        label: "Qual o buffer entre agendamentos?",
        hint: "Intervalo de descanso entre um cliente e outro.",
        required: true,
        options: [
          { value: "0", label: "Sem intervalo" },
          { value: "5", label: "5 minutos" },
          { value: "10", label: "10 minutos" },
          { value: "15", label: "15 minutos" },
          { value: "30", label: "30 minutos" },
        ],
      },
      {
        id: "agendamento_cancel_rules",
        type: "textarea",
        label: "Quais são as regras de cancelamento / remarcação?",
        placeholder: "Ex: cancelar até 24h antes sem taxa; depois, cobra 50%...",
        required: true,
        minLength: 20,
      },
    ],
  },
  brand: {
    id: "agent:brand",
    title: "Baleia — Brand Intel",
    fields: [
      {
        id: "brand_competitors",
        type: "textarea",
        label: "Quais são seus principais concorrentes?",
        hint: "Lista 3 a 5. Pode colocar nome + @ do Instagram.",
        placeholder: "1. Concorrente X (@concorrente_x)\n2. ...",
        required: true,
        minLength: 20,
      },
      {
        id: "brand_instagram",
        type: "text",
        label: "Qual o @ do Instagram do seu negócio?",
        placeholder: "@seu_instagram",
        required: true,
      },
      {
        id: "brand_monitor",
        type: "multiselect",
        label: "O que você quer que a Baleia monitore?",
        required: true,
        options: [
          { value: "hashtags", label: "Hashtags do nicho" },
          { value: "trends", label: "Tendências" },
          { value: "competitors", label: "Lançamentos de concorrentes" },
          { value: "mentions", label: "Menções à sua marca" },
          { value: "other", label: "Outro" },
        ],
      },
      {
        id: "brand_frequency",
        type: "select",
        label: "Com que frequência você quer receber relatórios?",
        required: true,
        options: [
          { value: "weekly", label: "Semanal" },
          { value: "biweekly", label: "Quinzenal" },
          { value: "monthly", label: "Mensal" },
        ],
      },
    ],
  },
  processos: {
    id: "agent:processos",
    title: "Tartaruga — Processos",
    fields: [
      {
        id: "processos_automate",
        type: "textarea",
        label: "Quais processos você quer automatizar?",
        hint: "O que hoje dá trabalho manual e você queria que rodasse sozinho.",
        placeholder: "Ex: follow-up pós-venda, cobrança de pagamento, relatório semanal...",
        required: true,
        minLength: 30,
      },
      {
        id: "processos_tools",
        type: "text",
        label: "Quais ferramentas internas você usa?",
        placeholder: "Ex: Notion, ClickUp, Trello, Google Sheets...",
        required: true,
      },
      {
        id: "processos_meetings",
        type: "select",
        label: "Com que frequência seu time tem reuniões?",
        required: true,
        options: [
          { value: "daily", label: "Diárias" },
          { value: "weekly", label: "Semanais" },
          { value: "biweekly", label: "Quinzenais" },
          { value: "monthly", label: "Mensais" },
          { value: "none", label: "Sem reuniões recorrentes" },
        ],
      },
    ],
  },
  consultor: {
    id: "agent:consultor",
    title: "Golfinho — Consultor",
    fields: [
      {
        id: "consultor_metrics",
        type: "textarea",
        label: "Quais métricas você acompanha hoje?",
        placeholder: "Ex: receita mensal, CAC, LTV, taxa de conversão, NPS...",
        required: true,
        minLength: 20,
      },
      {
        id: "consultor_doubts",
        type: "textarea",
        label: "Quais são suas maiores dúvidas estratégicas hoje?",
        placeholder: "Ex: como precificar, onde investir, quando contratar...",
        required: true,
        minLength: 20,
      },
      {
        id: "consultor_goals",
        type: "textarea",
        label: "Onde você quer chegar em 6 meses?",
        placeholder: "Seja específico. Meta de receita, time, clientes, etc.",
        required: true,
        minLength: 20,
      },
    ],
  },
};

/**
 * Gera o schema personalizado baseado nos agents que o cliente comprou.
 * Retorna sempre a seção global + as seções dos agents.
 */
function buildSchemaForAgents(agents = []) {
  const sections = [GLOBAL_SECTION];
  for (const agentId of agents) {
    if (AGENT_SECTIONS[agentId]) {
      sections.push(AGENT_SECTIONS[agentId]);
    }
  }
  return { sections };
}

/**
 * Valida um briefing submetido contra o schema.
 * Retorna { valid: bool, errors: [{ fieldId, reason }] }
 */
function validateBriefing(schema, data) {
  const errors = [];
  const allFields = schema.sections.flatMap(s => s.fields);

  for (const f of allFields) {
    const value = data?.[f.id];
    if (!f.required) continue;

    // Checagem por tipo
    if (f.type === "text" || f.type === "textarea") {
      if (!value || typeof value !== "string" || value.trim().length === 0) {
        errors.push({ fieldId: f.id, reason: "empty" });
        continue;
      }
      if (f.minLength && value.trim().length < f.minLength) {
        errors.push({ fieldId: f.id, reason: "too_short", min: f.minLength });
      }
    } else if (f.type === "select") {
      const validValues = f.options.map(o => o.value);
      if (!value || !validValues.includes(value)) {
        errors.push({ fieldId: f.id, reason: "invalid_option" });
      }
    } else if (f.type === "multiselect") {
      if (!Array.isArray(value) || value.length === 0) {
        errors.push({ fieldId: f.id, reason: "empty" });
        continue;
      }
      const validValues = f.options.map(o => o.value);
      const invalid = value.filter(v => !validValues.includes(v));
      if (invalid.length > 0) {
        errors.push({ fieldId: f.id, reason: "invalid_option", invalid });
      }
    } else if (f.type === "drive_file") {
      // Esperado: { fileId, name, url, mimeType, ... }
      if (!value || typeof value !== "object" || !value.fileId || !value.url) {
        errors.push({ fieldId: f.id, reason: "no_file" });
      }
    } else if (f.type === "text_or_file") {
      // Aceita text OU file — pelo menos um dos dois
      const hasText = typeof value?.text === "string" && value.text.trim().length >= (f.minTextLength || 20);
      const hasFile = value?.file && typeof value.file === "object" && value.file.fileId;
      if (!hasText && !hasFile) {
        errors.push({ fieldId: f.id, reason: "need_text_or_file", minTextLength: f.minTextLength || 20 });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { buildSchemaForAgents, validateBriefing };