# Comece aqui — rode o Nomade Business no seu computador

**Pra quem é:** qualquer pessoa. Barbeiro, dentista, agência de duas pessoas. Você não precisa saber o que é terminal; esta página mostra onde clicar.

**O que você ganha:** um site privado, no seu computador, com seus leads, clientes, propostas, links de pagamento, tarefas e uma IA que lembra da sua empresa. Ninguém mais vê, a não ser que você coloque na internet.

**Tempo:** uns 20 minutos, a maior parte esperando download.

---

## 1. Instale o Docker Desktop (uma vez só)

O Docker é o programa que roda o Nomade pra você. É grátis.

1. Entre em https://www.docker.com/products/docker-desktop/
2. Clique em **Download** pro seu sistema (Mac ou Windows) e instale como qualquer app.
3. Abra o **Docker Desktop**. Espere o ícone da baleia (em cima no Mac, embaixo à direita no Windows) parar de se mexer. Deixe aberto.

> Windows: o instalador pode pedir pra ativar o **WSL 2**. Aceite e reinicie se pedir.

## 2. Baixe o Nomade

1. Abra https://github.com/LucasUltremare/nomade-bussines
2. Clique no botão verde **Code** → **Download ZIP**.
3. Descompacte. Vai aparecer uma pasta `nomade-bussines-main`. Mova pra um lugar fácil, tipo a Área de Trabalho.

## 3. Abra um terminal dentro dessa pasta

O terminal é a janela preta onde você digita um comando. Como abrir **já dentro da pasta**:

- **Mac:** no Finder, ache a pasta, clique com o botão direito → **Novo Terminal na Pasta**. (Não apareceu? Abra o app Terminal, digite `cd ` com espaço, arraste a pasta pra dentro da janela e dê Enter.)
- **Windows:** abra a pasta no Explorador, clique com o botão direito num espaço vazio → **Open Git Bash here**. Não tem Git Bash? Instale em https://git-scm.com/download/win (só dar Avançar) — ou use o app **Ubuntu**, se o Docker configurou o WSL pra você.

## 4. Rode o instalador

Digite isto e dê Enter:

```bash
bash instalar.sh
```

Ele pergunta quatro coisas:

1. **Idioma** — digite 1, 2 ou 3.
2. **Nome da empresa** — o que seus clientes veem.
3. **Seu e-mail** — vira o seu login.
4. **Uma senha** — pelo menos 8 caracteres. Anote.

Depois ele baixa e monta tudo. Na primeira vez leva alguns minutos. Quando aparecer **Pronto**, ele abre o navegador em **http://localhost:5004**.

## 5. Entre e responda a configuração

Entre com o e-mail e a senha que você escolheu. O Nomade te guia numa configuração curta: idioma, o que você quer organizar, seu horário de atendimento, seu primeiro **link de cadastro** (uma página que o cliente preenche; cada envio cai em Leads), seu time e as ferramentas que você já usa. Dá pra pular qualquer passo e mudar depois em **Ajustes**.

---

## O que fazer em seguida

- **Criar um link pro cliente pagar:** vá em **Pagamentos**, digite nome, e-mail e valor, clique em **Criar link**. Manda no WhatsApp. Pra receber de verdade, conecte o **Mercado Pago** em **Integrações** (precisa de uma conta Mercado Pago; cole o *Access token* da página de desenvolvedores deles).
- **Compartilhar o link de cadastro** no Instagram, WhatsApp ou no site. Fica em **Ajustes → Links de cadastro**.
- **Chamar o time** em **Membros**. Cada pessoa só vê os módulos que você marcar.
- **Botar a IA pra trabalhar:** cole uma chave da Anthropic, OpenAI ou Gemini em **Integrações → Modelos de IA** e converse com ela no **Chat**.

## Usar do celular ou de outro computador

No mesmo Wi-Fi, abra `http://<IP do seu computador>:5004` (no Mac: Ajustes do Sistema → Wi-Fi → Detalhes mostra o IP; no Windows: `ipconfig`). Depois, no arquivo `.env`, troque `PAINEL_URL` e `BASE_URL` pra esse endereço e rode `bash instalar.sh` de novo.

Pra usar de qualquer lugar (internet), precisa de um servidor pequeno (VPS) e um domínio — é a seção "Subir com Docker" do README. Peça pra alguém técnico ou abra uma issue; pra essa pessoa é meia hora.

## Comandos do dia a dia (no mesmo terminal)

| Você quer… | Digite |
|---|---|
| Parar o Nomade | `docker compose down` |
| Ligar de novo | `docker compose up -d` |
| Atualizar pra uma versão nova | baixe o ZIP novo por cima da pasta e rode `bash instalar.sh` |
| Ver o que está acontecendo | `docker compose logs -f` (Ctrl+C pra sair) |
| Trocar a senha | abra o `.env` em qualquer editor de texto, mude `ADMIN_SENHA=`, salve, rode `bash instalar.sh` |

## Se der errado

- **"O Docker não está aberto"** — abra o Docker Desktop, espere a baleia e rode o instalador de novo.
- **A página não abre** — espere mais um minuto e atualize. Nada? Rode `docker compose logs -f`, procure uma linha vermelha e cole numa issue.
- **"Porta 5004 em uso"** — outro programa usa essa porta. Edite o `docker-compose.yml`, troque `"5004:5004"` por `"5104:5004"` e abra `http://localhost:5104`.
- **Perdeu a senha** — veja a tabela acima.

Seus dados ficam num volume do Docker chamado `mongo-data`. Apagar a pasta não apaga os dados; `docker compose down -v` apaga.
