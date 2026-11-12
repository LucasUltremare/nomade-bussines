# Nomade Business

O painel de operação de uma empresa de serviços, num lugar só e no seu servidor:
leads, clientes, propostas com página pública, cobrança pelo Mercado Pago,
kanban, membros com permissão, agenda dos sócios, e um escritório de agents de
IA com memória da empresa.

Open source sob a [AGPL-3.0](LICENSE).

> **Nunca mexeu com terminal?** Tem um guia passo a passo, com onde clicar:
> [**Comece aqui** (português)](docs/COMECE-AQUI.md) · [**Start here** (English)](docs/START-HERE.md) · [**Empieza aquí** (español)](docs/EMPIEZA-AQUI.md).
> Resumindo: instale o Docker Desktop, baixe esta pasta e rode `bash instalar.sh`.

## O que vem

| Área | O que faz |
|---|---|
| **Leads** | Entrada pelo site (formulário e chat de triagem com IA), orçamento inicial automático, prospecção por região (Google Places) |
| **Clientes** | Cadastro, briefing, histórico de propostas e cobranças de cada um |
| **Propostas** | A IA monta a proposta a partir do briefing, o time edita, publica e manda o link. A página pública não precisa de JavaScript e abre em qualquer webview de WhatsApp |
| **Pagamentos** | Nome, e-mail e valor viram um link `/pagar/<token>` pra mandar no WhatsApp. Pix, boleto ou cartão pelo Mercado Pago; o webhook marca como pago sozinho. Propostas também geram link, à vista, em duas metades ou mensal |
| **Kanban** | Boards por cliente, menções, comentários, anexos do Google Drive, tempo real |
| **Projetos** | Portfólio com capa automática (print do site), servido em `/api/site/projetos` pro seu site consumir |
| **Finance** | Fluxo de caixa interno |
| **Membros** | Sócios têm acesso total. Membros só veem os módulos liberados, com checagem no servidor a cada request |
| **Escritório** | Agents organizados por departamento, chat com um orquestrador que cria tasks e decisões, fila de execução, activity |
| **Memória** | Base de conhecimento da empresa com busca semântica, curadoria e grafo. Os agents consultam durante o trabalho. **Uma memória por empresa**: o banco é carimbado no primeiro boot e não sobe com outra empresa |
| **Decisões** | O "sistema 1": perguntas fechadas (sim/não, escolha, nota) respondidas com probabilidade, pelo Jev (LLM Gateway) ou pelo modelo local |
| **PatricJ** | O modelo da casa: Qwen3.5-4B no Ollama, com avaliação e fine-tune em [modelo/](modelo/README.md). Um modelo pra todas as empresas, porque o que é de cada uma fica na memória |
| **Integrações** | Slack, Discord, Telegram, WhatsApp (Evolution), Resend, Mercado Pago, Stripe, Notion, Google Drive, GitHub, webhooks (Zapier/Make/n8n), servidores MCP e Ollama, com teste de conexão. As chaves de IA ficam na mesma tela |
| **Links de cadastro** | Páginas públicas em `/f/<slug>`, sem JavaScript, em inglês, português ou espanhol. Cada envio vira lead |
| **Onboarding** | Primeiro acesso guiado: idioma, empresa, o que automatizar, horário, primeiro link de cadastro, time e conexões. Painel em inglês, português e espanhol, tema escuro ou claro |
| **CLI `nomade`** | Liga uma máquina como runner da fila, conversa com o orquestrador e registra a memória da empresa no Claude Code via MCP |

## Como é montado

```
navegador do time ──► office (ai-service.js, :5004)  ── /hq ──►  server (server.js, :5002)
                        painel, escritório, CLI                      API do painel, propostas,
                                                                     pagamentos, webhooks
cliente final ─────────────────────────────────────────────────►    /proposta/:token, /pagar/:token
                                    ambos ──► MongoDB
```

- **server** atende o público (`BASE_URL`): proposta, página de pagamento, webhook do Mercado Pago, entrada de leads. Também serve a API do painel, mas só pra quem chega pelo office.
- **office** é a porta do time (`PAINEL_URL`): abre o painel na raiz, faz proxy de `/hq` pro server e cuida do escritório (agents, memória, fila, login e download do CLI).

## Subir com Docker

```bash
git clone https://github.com/LucasUltremare/nomade-bussines.git
cd nomade-bussines
cp .env.example .env              # preencha os campos marcados com *
cp config/time.example.json config/time.json   # opcional: nomes, cores e setores do time
docker compose up -d --build
```

O painel abre em `http://localhost:5004`. No primeiro acesso de um sócio ele
passa pelo onboarding (nome da empresa, idioma, horário, primeiro link de
cadastro). Tudo isso fica em **Ajustes** depois. Em produção, coloque um proxy com
HTTPS na frente das duas portas e aponte `BASE_URL` e `PAINEL_URL` pros
endereços públicos.

### O mínimo pra funcionar

1. **Google OAuth** (login do painel). No Google Cloud, crie um cliente OAuth do tipo Web com:
   - URI de redirecionamento: `<PAINEL_URL>/hq/api/auth/google/callback`
   - Origem JavaScript: `<PAINEL_URL>` (é o login do CLI)
2. **`ADMIN_EMAILS`** com o email Google de cada sócio.
3. **`JWT_SECRET`** e **`HQ_PROXY_SECRET`**: `openssl rand -hex 32` pra cada um.

### O resto é opcional e liga por chave

| Recurso | Variável |
|---|---|
| Cobrança | `MP_ACCESS_TOKEN`, e o webhook `<BASE_URL>/api/mp-webhook-payment` no Mercado Pago |
| Emails | `RESEND_API_KEY`, `EMAIL_FROM` |
| Proposta e orçamento com IA | `GEMINI_API_KEY` |
| Orquestrador do escritório | `ANTHROPIC_API_KEY` (ou OpenAI, GLM, Ollama) |
| Modelo local (PatricJ) | `OLLAMA_URL`, `OLLAMA_TEXT_MODEL=patricj` (veja [modelo/](modelo/README.md)) |
| Decisões com o Jev | `LLMGATEWAY_API_KEY` |
| Push no celular | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| Prospecção | `GOOGLE_PLACES_KEY` |

Sem a chave, o recurso some da interface ou cai num caminho sem IA. Nada quebra.

## A cara da sua empresa

Tudo que o cliente final vê sai das variáveis `EMPRESA_*`: nome, email, site,
cidade, cor, logo e a descrição que entra nos prompts da IA. O time vem de
`config/time.json` (ou `TIME_JSON`): o `id` de cada pessoa é o que fica gravado
nas tasks e nas menções (`@ana`).

## Membros e permissões

Sócio é quem está no `ADMIN_EMAILS`, e isso não se edita pela interface.
Membros são adicionados pelos sócios na aba **Membros**, escolhendo os módulos
(Kanban, Clientes, Propostas, Leads, Projetos). O perfil pronto **Leader**
libera Kanban, Clientes e Propostas, vendo só as propostas que a própria pessoa
criou.

A checagem é no servidor: cada rota do painel só abre pra membro se estiver
numa lista explícita, com método e caminho exatos. Rota nova sem mapeamento
fica só pros sócios. O escritório inteiro é só dos sócios.

## O CLI

```bash
npm i -g <PAINEL_URL>/cli/nomade-cli.tgz
nomade login --url=<PAINEL_URL>
nomade runner        # esta máquina passa a executar a fila do kanban
nomade mcp           # memória da empresa dentro do Claude Code
```

Detalhes em [cli/README.md](cli/README.md). O runner precisa do Claude Code
logado na máquina: a assinatura de quem roda os agents nunca sai dali.

## Desenvolvimento

```bash
npm install
cd client/admin && npm install && cd ../..
cp .env.example .env     # com MONGODB_URI apontando pra um Mongo local
npm run dev              # server em :5002
npm run dev:office       # office em :5004
npm run dev:painel       # painel em :5173, com proxy pro office
npm run check            # rotas, variáveis do compose e sintaxe
```

Precisa de Node 20.19 ou mais novo.

## Licença

[AGPL-3.0](LICENSE). Se você roda uma versão modificada como serviço pra
outras pessoas, o código dessas mudanças precisa ficar disponível pra elas.
