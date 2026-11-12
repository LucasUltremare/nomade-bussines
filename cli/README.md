# nomade — o Nomade Business no terminal

Conecta a máquina ao painel da tua empresa, roda a fila de agents do kanban,
conversa com o orquestrador e liga a memória da empresa no Claude Code.

## Instalar

O servidor do Nomade Business monta o pacote na hora a partir desta pasta.
Troca `<PAINEL_URL>` pelo endereço do painel da tua empresa:

```bash
npm i -g <PAINEL_URL>/cli/nomade-cli.tgz
```

**Atualizar é o mesmo comando.** `<PAINEL_URL>/cli` mostra a linha certa, com a
versão no nome do arquivo (assim nenhum cache de rede entrega a versão velha).

O tarball é **público de propósito**: é código cliente, sem credencial dentro.
Quem controla acesso é o login (Google + `ADMIN_EMAILS` do servidor).

De um clone, se preferir: `npm i -g ./cli`

Requer **Node 20+** e o Claude Code logado na máquina (`claude` no terminal), que é
onde mora a assinatura de quem roda os agents. A credencial nunca sai dali.

## Usar

```bash
nomade login --url=<PAINEL_URL>   # abre o navegador, entra com o Google
nomade                # conversa com o orquestrador (REPL)
nomade "cria os cards do lançamento"   # um tiro só
nomade runner         # esta máquina passa a pegar trabalho da fila
nomade maquinas       # quem está de pé na conta
nomade decisoes       # o que está esperando um sócio
nomade memoria        # saúde da memória da empresa (+ backfill)
nomade mcp            # liga a memória no Claude Code desta máquina
```

`--nova` começa outra conversa · `--uma` roda uma task e sai · `--url=` aponta pra
outro serviço.

## A memória no teu Claude Code

```bash
nomade mcp
```

Registra a memória da empresa como servidor MCP no Claude Code — convenções da
casa, decisões de cliente e os playbooks de processo passam a ser consultáveis
de dentro de qualquer sessão de código, em qualquer pasta.

Depois **reinicia o Claude Code**: servidor MCP carrega na abertura da sessão,
então numa janela já aberta ele não aparece. Confere com `/mcp` — tem que
listar `nomade` com três ferramentas: `buscar_memoria`, `ver_cliente` e
`gravar_memoria`.

`gravar_memoria` existe, mas é **pra usar quando tu pedir**, não pro modelo
decidir sozinho no fim de uma tarefa — senão a base enche de descarte. E ele exige um `resumo` curto, escrito por quem grava: é o único
campo indexado, e é ele que decide se a memória vai ser achada daqui a três
meses. Vale ler antes de confirmar.

Pra desligar: `nomade mcp --remover`.

## Onde ficam as coisas

| | |
|---|---|
| `~/.nomade/config.json` | url, token (90 dias), e-mail, id da máquina — modo `0600` |
| `~/.nomade/contas/<socio>/` | uma pasta `CLAUDE_CONFIG_DIR` por sócio; o runner escolhe a do dono da task |

`NOMADE_CONFIG_DIR` aponta a config pra outro lugar (testar contra um serviço
local, ou manter mais de uma conta na mesma máquina).

## De quem é cada task

A task pertence a um **sócio**, e só a máquina dele executa. É isso que faz o
multi-máquina funcionar: a Ana abre uma task pro Bruno, ela espera o runner do
Bruno, e roda onde o repo e a assinatura dele estão.

| A task tem | Quem executa |
|---|---|
| `dono` = um sócio | só o runner logado com aquele e-mail |
| sem `dono`, mas o **squad** tem dono | o runner do dono do squad |
| sem dono nenhum | qualquer runner |

O dono da task vence o do squad — dá pra dizer "tudo do squad Produção roda na
máquina do Bruno" e ainda assim carimbar um card específico pra outra pessoa.

`nomade fila` mostra o que espera esta máquina, o que está solto, e (com
`--todas`) o que espera a máquina de outro sócio.

## Deixar rodando sem terminal aberto

Os três arquivos estão em [`servicos/`](servicos/), com as instruções dentro:

| | |
|---|---|
| **Linux** | `nomade-runner.service` — systemd de **usuário** (root não tem o login do Claude) |
| **macOS** | `com.nomade.runner.plist` — LaunchAgent |
| **Windows** | `runner-windows.ps1` — Task Scheduler ao logar |

No Windows é agendador e **não** serviço de propósito: serviço roda em sessão
isolada, sem o login do Claude Code do teu usuário, e todo run falha com
"Not logged in".

## O contrato do runner

**A web nunca fala com a máquina.** O runner PUXA trabalho (`fila/claim`) e EMPURRA
progresso (`office_runs`). É por isso que funciona atrás de NAT, sem porta aberta e
sem túnel — e é o contrato que não deve ser invertido.

O clone dos projetos mora na máquina do runner. O caminho vem do board
(`pastaNoRunner`), não de quem clicou em play.

O agent roda em `bypassPermissions` dentro dessa pasta: ele edita arquivo de
verdade. Aponta pra um clone que tu topa ver mexido.
