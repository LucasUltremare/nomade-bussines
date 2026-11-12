# Nomade Business

**[English](#english)** · **[Português](#português)**

Open source under the [AGPL-3.0](LICENSE) · Código aberto sob a [AGPL-3.0](LICENSE)

---

## English

One panel to run a service business, on your own computer or server: leads, customers, proposals with a public page, payment links, kanban, customer service for marketplaces, members with permissions, and AI agents that remember how your company works.

### Run it on your computer (no Docker, no install)

1. Download the latest `nomade-business-<version>.zip` from [**Releases**](https://github.com/LucasUltremare/nomade-bussines/releases) and unzip it.
2. Open it:
   - **Mac:** double-click `Nomade.command`. The first time, macOS says it came from the internet: right-click → Open → Open.
   - **Windows:** double-click `Nomade.cmd`. If SmartScreen warns, click More info → Run anyway.
   - **Linux:** `./local/nomade.sh`
3. Answer four questions (language, company name, your e-mail, a password). The panel opens at `http://localhost:5004`.

The first time it downloads Node.js (if you don't have it) and a MongoDB database, about 35 to 110 MB depending on the system, once. It needs no admin rights: everything goes to your user folder, so updating is just downloading the new zip and opening it. Your data stays.

Step-by-step guide with where to click: [Start here](docs/START-HERE.md) · [Comece aqui](docs/COMECE-AQUI.md) · [Empieza aquí](docs/EMPIEZA-AQUI.md).

| Command | What it does |
|---|---|
| `Nomade.cmd configurar` / `./local/nomade.sh configurar` | Answer the questions again: e-mail, password, your own MongoDB link, open on the local network |
| `… diagnostico` | Checks what works on this computer: proxy, blocked sites, HTTPS inspection, free ports |
| `… onde` | Shows where the data is |

### On a work computer

Running on a laptop is not the same as running on a server. The launcher and the panel (**Settings → This computer**) test each part and say what to do:

| Situation | What happens | What to do |
|---|---|---|
| Ports 5004/5002 taken | It picks the next free ones | Nothing |
| Company proxy | Read from the Windows or macOS settings and used for downloads and APIs | If the proxy uses a PAC script, set `HTTPS_PROXY` in `config.env` |
| HTTPS inspection (custom root certificate) | Nomade trusts the system certificates | If it still fails, ask IT for the root certificate and set `NODE_EXTRA_CA_CERTS` |
| A site is blocked (AI, Mercado Pago) | The feature says which host is blocked | Ask IT to allow that host |
| Database download blocked | It shows the link to download in the browser, or asks for a free [MongoDB Atlas](https://www.mongodb.com/atlas) link | |
| Windows without Visual C++ | The local database can't start | Ask IT for the "Visual C++ Redistributable", or use an Atlas link |
| Links you send to customers | Only open on this computer (`localhost`) | Run it on a server, or point `BASE_URL` to a tunnel |
| "Paid" status from Mercado Pago, Mercado Livre and Shopee login | Need a public HTTPS address | Same as above |
| Computer asleep | Nomade stops | Keep the window open and the computer awake |

By default it only listens on `127.0.0.1`: nobody else on the company network sees it.

### What's inside

| Area | What it does |
|---|---|
| **Leads** | From your site (form and AI triage chat), automatic first quote, prospecting by region (Google Places) |
| **Customers** | Records, briefing, proposal and payment history |
| **Proposals** | AI drafts it from the briefing, the team edits and publishes. The public page needs no JavaScript and opens in WhatsApp's browser |
| **Payments** | Name, e-mail and amount become a `/pagar/<token>` link. Pix, boleto or card through Mercado Pago; the webhook marks it paid |
| **Customer service** | Questions from Mercado Livre and Shopee. The AI drafts the answer from the company memory; what you fix or teach becomes memory. Manual, suggest or automatic mode per channel |
| **Kanban** | Boards per customer, mentions, comments, Google Drive attachments, real time |
| **Projects** | Portfolio with an automatic cover (site screenshot), served at `/api/site/projetos` |
| **Finance** | Internal cash flow |
| **Members** | Partners see everything. Members only see the screens they were given, checked on the server on every request |
| **Office** | Agents by department, a chat with an orchestrator that creates tasks and decisions, a run queue |
| **Memory** | Company knowledge base with semantic search and a graph. Agents read it while they work. **One memory per company** |
| **Decisions** | Closed questions (yes/no, choice, score) answered with a probability |
| **PatricJ** | The house model (Qwen3.5-4B on Ollama), with evals and fine-tuning in [modelo/](modelo/README.md) |
| **Integrations** | AI keys, Slack, Discord, Telegram, WhatsApp, Resend, Mercado Pago, Stripe, Notion, Google Drive, GitHub, webhooks, MCP servers and Ollama, each with a connection test |
| **Sign-up links** | Public pages at `/f/<slug>` in English, Portuguese or Spanish. Each submission becomes a lead |
| **Setup** | First-time setup: language, company, country and currency, which screens to use, hours, first sign-up link, team, AI. A guided tour shows where to click (`?` key) |
| **CLI `nomade`** | Turns a machine into a queue runner and puts the company memory in Claude Code via MCP |

Everything adapts to where you are: country, currency, time zone and first day of the week are set in **Settings → Region**. You can also turn screens off: a simple layout, a sales-only one, everything, or your own pick.

### How it's built

```
team browser ──► office (ai-service.js, :5004)  ── /hq ──►  server (server.js, :5002)
                  panel, office, CLI                         panel API, proposals,
                                                             payments, webhooks
end customer ──────────────────────────────────────────►    /proposta/:token, /pagar/:token
                              both ──► MongoDB
```

- **server** faces the public (`BASE_URL`): proposals, payment page, Mercado Pago webhook, incoming leads. It also serves the panel API, but only through the office.
- **office** is the team's door (`PAINEL_URL`): serves the panel, proxies `/hq` to the server and runs the office (agents, memory, queue, login, CLI download).

### Run on a server with Docker

```bash
git clone https://github.com/LucasUltremare/nomade-bussines.git
cd nomade-bussines
bash instalar.sh          # asks four questions, writes .env and runs docker compose
```

Or by hand: `cp .env.example .env`, fill in the fields marked with `*`, then `docker compose up -d --build`. In production put an HTTPS proxy in front of both ports and point `BASE_URL` and `PAINEL_URL` to the public addresses.

**The minimum:** `ADMIN_EMAILS` (the partners' e-mails), `ADMIN_SENHA` (password login) or Google OAuth (`GOOGLE_CLIENT_ID`/`SECRET`, redirect `<PAINEL_URL>/hq/api/auth/google/callback`), and `JWT_SECRET` and `HQ_PROXY_SECRET` (`openssl rand -hex 32` each).

**The rest is optional and turns on with a key:**

| Feature | Variable |
|---|---|
| Payments | `MP_ACCESS_TOKEN`, webhook `<BASE_URL>/api/mp-webhook-payment` |
| E-mail | `RESEND_API_KEY`, `EMAIL_FROM` |
| AI (proposals, chat, agents, customer service) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`… or paste it in Integrations |
| Local model and semantic memory search | `OLLAMA_URL` |
| Decisions through LLM Gateway | `LLMGATEWAY_API_KEY` |
| Phone push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| Prospecting | `GOOGLE_PLACES_KEY` |

Without a key the feature hides or falls back to a path without AI. Nothing breaks.

### Members and permissions

A partner is anyone in `ADMIN_EMAILS`; that can't be edited from the panel. Partners add members in **Members** and pick their screens. Every panel route opens to a member only if it's on an explicit list, with exact method and path. A new route with no mapping is partners-only. The office is partners-only.

### CLI

```bash
npm i -g <PAINEL_URL>/cli/nomade-cli.tgz
nomade login --url=<PAINEL_URL>
nomade runner        # this machine runs the kanban queue
nomade mcp           # company memory inside Claude Code
```

Details in [cli/README.md](cli/README.md).

### Development

```bash
npm install
cd client/admin && npm install && cd ../..
cp .env.example .env     # MONGODB_URI pointing to a local Mongo
npm run dev              # server on :5002
npm run dev:office       # office on :5004
npm run dev:painel       # panel on :5173, proxied to the office
npm run check            # routes, compose variables and syntax
npm run local            # the same launcher the Releases zip uses
npm run empacotar        # builds release/nomade-business-<version>.zip
```

Node 20.19 or newer. Pushing a `v*` tag runs [.github/workflows/release.yml](.github/workflows/release.yml), which builds the zip and publishes it on Releases.

---

## Português

Um painel pra tocar uma empresa de serviços, no seu computador ou no seu servidor: leads, clientes, propostas com página pública, links de pagamento, kanban, atendimento de marketplace, membros com permissão e agents de IA que lembram como a sua empresa funciona.

### Rodar no seu computador (sem Docker, sem instalar)

1. Baixe o `nomade-business-<versão>.zip` mais novo em [**Releases**](https://github.com/LucasUltremare/nomade-bussines/releases) e descompacte.
2. Abra:
   - **Mac:** dois cliques em `Nomade.command`. Na primeira vez o macOS avisa que veio da internet: botão direito → Abrir → Abrir.
   - **Windows:** dois cliques em `Nomade.cmd`. Se o SmartScreen avisar, clique em Mais informações → Executar assim mesmo.
   - **Linux:** `./local/nomade.sh`
3. Responda quatro perguntas (idioma, nome da empresa, seu e-mail, uma senha). O painel abre em `http://localhost:5004`.

Na primeira vez ele baixa o Node.js (se você não tiver) e um banco MongoDB, de 35 a 110 MB conforme o sistema, uma vez só. Não precisa de admin: tudo vai pra pasta do seu usuário, então atualizar é baixar o zip novo e abrir. Os dados ficam.

Guia passo a passo, com onde clicar: [Comece aqui](docs/COMECE-AQUI.md) · [Start here](docs/START-HERE.md) · [Empieza aquí](docs/EMPIEZA-AQUI.md).

| Comando | O que faz |
|---|---|
| `Nomade.cmd configurar` / `./local/nomade.sh configurar` | Refaz as perguntas: e-mail, senha, link do seu próprio MongoDB, abrir na rede local |
| `… diagnostico` | Confere o que funciona neste computador: proxy, sites bloqueados, inspeção de HTTPS, portas livres |
| `… onde` | Mostra onde ficam os dados |

### No computador do trabalho

Rodar num notebook não é igual a rodar num servidor. O instalador e o painel (**Ajustes → Este computador**) testam cada parte e dizem o que fazer:

| Situação | O que acontece | O que fazer |
|---|---|---|
| Portas 5004/5002 ocupadas | Ele pega as próximas livres | Nada |
| Proxy da empresa | Lido das configurações do Windows ou do macOS e usado nos downloads e nas APIs | Se o proxy usa script PAC, coloque `HTTPS_PROXY` no `config.env` |
| Inspeção de HTTPS (certificado raiz da empresa) | O Nomade confia nos certificados do sistema | Se ainda falhar, peça o certificado raiz pro TI e coloque em `NODE_EXTRA_CA_CERTS` |
| Site bloqueado (IA, Mercado Pago) | A função diz qual endereço está bloqueado | Peça pro TI liberar esse endereço |
| Download do banco bloqueado | Ele mostra o link pra baixar pelo navegador, ou pede um link grátis do [MongoDB Atlas](https://www.mongodb.com/atlas) | |
| Windows sem Visual C++ | O banco local não sobe | Peça pro TI o "Visual C++ Redistributable", ou use um link do Atlas |
| Links que você manda pro cliente | Só abrem neste computador (`localhost`) | Rode num servidor, ou aponte `BASE_URL` pra um túnel |
| Status "pago" do Mercado Pago, login do Mercado Livre e da Shopee | Precisam de endereço público com HTTPS | O mesmo de cima |
| Computador dormindo | O Nomade para | Deixe a janela aberta e o computador acordado |

Por padrão ele só escuta em `127.0.0.1`: ninguém mais na rede da empresa vê.

### O que vem

| Área | O que faz |
|---|---|
| **Leads** | Entrada pelo site (formulário e chat de triagem com IA), orçamento inicial automático, prospecção por região (Google Places) |
| **Clientes** | Cadastro, briefing, histórico de propostas e cobranças |
| **Propostas** | A IA monta a partir do briefing, o time edita e publica. A página pública não precisa de JavaScript e abre no navegador do WhatsApp |
| **Pagamentos** | Nome, e-mail e valor viram um link `/pagar/<token>`. Pix, boleto ou cartão pelo Mercado Pago; o webhook marca como pago |
| **Atendimento** | Perguntas do Mercado Livre e da Shopee. A IA rascunha a resposta com a memória da empresa; o que você corrige ou ensina vira memória. Modo manual, sugerir ou automático por canal |
| **Kanban** | Boards por cliente, menções, comentários, anexos do Google Drive, tempo real |
| **Projetos** | Portfólio com capa automática (print do site), servido em `/api/site/projetos` |
| **Finance** | Fluxo de caixa interno |
| **Membros** | Sócios veem tudo. Membros só veem as telas liberadas, com checagem no servidor a cada request |
| **Escritório** | Agents por departamento, chat com um orquestrador que cria tasks e decisões, fila de execução |
| **Memória** | Base de conhecimento da empresa com busca semântica e grafo. Os agents consultam enquanto trabalham. **Uma memória por empresa** |
| **Decisões** | Perguntas fechadas (sim/não, escolha, nota) respondidas com probabilidade |
| **PatricJ** | O modelo da casa (Qwen3.5-4B no Ollama), com avaliação e fine-tune em [modelo/](modelo/README.md) |
| **Integrações** | Chaves de IA, Slack, Discord, Telegram, WhatsApp, Resend, Mercado Pago, Stripe, Notion, Google Drive, GitHub, webhooks, servidores MCP e Ollama, cada um com teste de conexão |
| **Links de cadastro** | Páginas públicas em `/f/<slug>` em inglês, português ou espanhol. Cada envio vira lead |
| **Configuração** | Primeiro acesso guiado: idioma, empresa, país e moeda, quais telas usar, horário, primeiro link de cadastro, time, IA. Um tour mostra onde clicar (tecla `?`) |
| **CLI `nomade`** | Liga uma máquina como runner da fila e coloca a memória da empresa no Claude Code via MCP |

Tudo se adapta a onde você está: país, moeda, fuso e início da semana ficam em **Ajustes → Região**. Dá pra desligar telas também: um modo simples, um só comercial, tudo, ou do seu jeito.

### Como é montado

```
navegador do time ──► office (ai-service.js, :5004)  ── /hq ──►  server (server.js, :5002)
                        painel, escritório, CLI                      API do painel, propostas,
                                                                     pagamentos, webhooks
cliente final ─────────────────────────────────────────────────►    /proposta/:token, /pagar/:token
                                    ambos ──► MongoDB
```

- **server** atende o público (`BASE_URL`): proposta, página de pagamento, webhook do Mercado Pago, entrada de leads. Também serve a API do painel, mas só pra quem chega pelo office.
- **office** é a porta do time (`PAINEL_URL`): abre o painel, faz proxy de `/hq` pro server e cuida do escritório (agents, memória, fila, login e download do CLI).

### Subir num servidor com Docker

```bash
git clone https://github.com/LucasUltremare/nomade-bussines.git
cd nomade-bussines
bash instalar.sh          # faz quatro perguntas, escreve o .env e roda o docker compose
```

Ou na mão: `cp .env.example .env`, preencha os campos marcados com `*` e rode `docker compose up -d --build`. Em produção, coloque um proxy com HTTPS na frente das duas portas e aponte `BASE_URL` e `PAINEL_URL` pros endereços públicos.

**O mínimo:** `ADMIN_EMAILS` (e-mail dos sócios), `ADMIN_SENHA` (login com senha) ou Google OAuth (`GOOGLE_CLIENT_ID`/`SECRET`, redirecionamento `<PAINEL_URL>/hq/api/auth/google/callback`), e `JWT_SECRET` e `HQ_PROXY_SECRET` (`openssl rand -hex 32` cada).

**O resto é opcional e liga por chave:**

| Recurso | Variável |
|---|---|
| Cobrança | `MP_ACCESS_TOKEN`, webhook `<BASE_URL>/api/mp-webhook-payment` |
| E-mail | `RESEND_API_KEY`, `EMAIL_FROM` |
| IA (propostas, chat, agents, atendimento) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`… ou cole em Integrações |
| Modelo local e busca semântica na memória | `OLLAMA_URL` |
| Decisões pelo LLM Gateway | `LLMGATEWAY_API_KEY` |
| Push no celular | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| Prospecção | `GOOGLE_PLACES_KEY` |

Sem a chave, o recurso some da interface ou cai num caminho sem IA. Nada quebra.

### Membros e permissões

Sócio é quem está no `ADMIN_EMAILS`, e isso não se edita pelo painel. Os sócios adicionam membros em **Membros** e escolhem as telas de cada um. Cada rota do painel só abre pra membro se estiver numa lista explícita, com método e caminho exatos. Rota nova sem mapeamento fica só pros sócios. O escritório é só dos sócios.

### CLI

```bash
npm i -g <PAINEL_URL>/cli/nomade-cli.tgz
nomade login --url=<PAINEL_URL>
nomade runner        # esta máquina passa a executar a fila do kanban
nomade mcp           # memória da empresa dentro do Claude Code
```

Detalhes em [cli/README.md](cli/README.md).

### Desenvolvimento

```bash
npm install
cd client/admin && npm install && cd ../..
cp .env.example .env     # com MONGODB_URI apontando pra um Mongo local
npm run dev              # server em :5002
npm run dev:office       # office em :5004
npm run dev:painel       # painel em :5173, com proxy pro office
npm run check            # rotas, variáveis do compose e sintaxe
npm run local            # o mesmo lançador do zip de Releases
npm run empacotar        # monta release/nomade-business-<versão>.zip
```

Node 20.19 ou mais novo. Uma tag `v*` dispara o [.github/workflows/release.yml](.github/workflows/release.yml), que monta o zip e publica em Releases.

### Licença

[AGPL-3.0](LICENSE). Se você roda uma versão modificada como serviço pra outras pessoas, o código dessas mudanças precisa ficar disponível pra elas. / If you run a modified version as a service for others, the source of those changes must be available to them.
