# Comece aqui: rode o Nomade Business no seu computador

**Pra quem é:** qualquer pessoa. Barbeiro, dentista, agência de duas pessoas, ou quem quer testar no computador do trabalho. Você não precisa saber o que é terminal; esta página mostra onde clicar.

**O que você ganha:** um painel privado, no seu computador, com seus leads, clientes, propostas, links de pagamento, tarefas e uma IA que lembra da sua empresa. Ninguém mais vê.

**O que não precisa:** Docker, senha de administrador, instalar programa.

**Tempo:** uns 10 minutos, a maior parte esperando download.

---

## 1. Baixe o Nomade

1. Entre em https://github.com/LucasUltremare/nomade-bussines/releases
2. Na versão mais nova, abra **Assets** e clique em `nomade-business-<versão>.zip`.
3. Descompacte:
   - **Mac:** dois cliques no zip.
   - **Windows:** botão direito no zip → **Extrair tudo** → **Extrair**. Não abra de dentro do zip sem extrair: não funciona.
4. Mova a pasta pra um lugar fácil, tipo Documentos.

## 2. Abra

- **Mac:** dois cliques em **Nomade.command**. Na primeira vez o macOS avisa que o arquivo veio da internet. Feche o aviso, clique com o **botão direito** em Nomade.command → **Abrir** → **Abrir**. Das próximas vezes, dois cliques bastam.
- **Windows:** dois cliques em **Nomade.cmd**. Se aparecer a tela azul "O Windows protegeu o computador", clique em **Mais informações** → **Executar assim mesmo**.
- **Linux:** no terminal, dentro da pasta: `./local/nomade.sh`

Abre uma janela preta. É ela que mantém o Nomade ligado.

## 3. Responda quatro perguntas

1. **Idioma**: digite 1, 2 ou 3.
2. **Nome da empresa**: o que seus clientes veem.
3. **Seu e-mail**: vira o seu login.
4. **Uma senha**: pelo menos 8 caracteres. Ela aparece como `****` enquanto você digita. Anote.

Na primeira vez ele baixa o Node.js (se o computador não tiver) e o banco de dados. Uma vez só, de 35 a 110 MB. Quando aparecer **Pronto**, ele abre o navegador no painel (normalmente **http://localhost:5004**).

## 4. Entre e termine a configuração

Entre com o e-mail e a senha. O painel te guia: idioma, empresa, país e moeda, quais telas você quer usar, horário, primeiro link de cadastro, time, IA e, por último, **o que funciona neste computador**. Dá pra pular qualquer passo e mudar depois em **Ajustes**.

Deixe a janela preta aberta enquanto usa. Fechou, o Nomade desliga; os dados ficam salvos.

---

## No computador do trabalho

Quase tudo funciona igual. O que muda, e o próprio Nomade avisa (na janela preta e em **Ajustes → Este computador**):

- **Os links que você manda pro cliente** (proposta, pagamento, cadastro) só abrem neste computador. Pra mandar pro cliente de verdade, precisa de um endereço público. Veja "Mandar links pro cliente" abaixo.
- **O Mercado Pago não consegue avisar que pagaram**, porque não alcança o seu computador. O link de pagamento funciona; confira o pagamento no Mercado Pago.
- **Mercado Livre e Shopee** só conectam num endereço público com HTTPS. O "Testar como cliente" do Atendimento funciona.
- **A rede da empresa pode bloquear** a IA, o Mercado Pago ou o download do banco. O Nomade diz qual endereço está bloqueado. Peça pro TI liberar.
- **Proxy da empresa:** ele lê das configurações do Windows ou do Mac sozinho. Se ainda assim não sair pra internet, peça o endereço do proxy pro TI e coloque no arquivo `config.env` (veja "Onde ficam os dados"): `HTTPS_PROXY=http://proxy.empresa:8080`
- **Computador dormindo = Nomade parado.**
- Por padrão, ninguém mais na rede da empresa consegue abrir o seu painel.

Quer ver tudo de uma vez? Rode o diagnóstico (veja a tabela de comandos).

## O que fazer em seguida

- **Criar um link pro cliente pagar:** vá em **Pagamentos**, digite nome, e-mail e valor, clique em **Criar link**. Pra receber de verdade, conecte o **Mercado Pago** em **Integrações** (cole o *Access token* da página de desenvolvedores deles).
- **Compartilhar o link de cadastro** no Instagram, WhatsApp ou no site. Fica em **Ajustes → Links de cadastro**.
- **Chamar o time** em **Membros**. Cada pessoa só vê as telas que você marcar.
- **Botar a IA pra trabalhar:** cole uma chave da Anthropic, OpenAI ou Gemini em **Integrações** e converse com ela no **Chat**.
- **Ver de novo onde clicar:** aperte `?` em qualquer tela.

## Usar do celular ou de outro computador

Rode o comando `configurar` (veja abaixo) e responda **s** em "Abrir também pelo celular no mesmo Wi-Fi?". Depois abra o Nomade de novo: ele mostra o endereço com o IP do computador. No computador do trabalho, deixe **não**: qualquer pessoa da rede da empresa veria a tela de login.

## Mandar links pro cliente

O cliente precisa conseguir abrir o seu Nomade pela internet. Dois caminhos:

1. **Um servidor pequeno (VPS)** com Docker: a seção "Subir num servidor com Docker" do README. Pra alguém técnico é meia hora.
2. **Um túnel até este computador** (Cloudflare Tunnel, ngrok e parecidos). Aponte o túnel pra `http://localhost:5002` e coloque o endereço que ele te der no `config.env`: `BASE_URL=https://seu-tunel.exemplo.com`. No computador do trabalho, pergunte antes pro TI se pode.

## Comandos do dia a dia

| Você quer… | Faça |
|---|---|
| Ligar | Dois cliques em Nomade.command / Nomade.cmd |
| Desligar | Feche a janela preta (ou Ctrl+C nela) |
| Atualizar | Baixe o zip novo, descompacte e abra. Os dados não ficam na pasta, então nada se perde. Pode apagar a pasta velha |
| Trocar e-mail, senha, banco ou abrir na rede | Mac/Linux: `./local/nomade.sh configurar` · Windows: na barra de endereço do Explorador, dentro da pasta, digite `cmd` e Enter; na janela que abrir, rode `Nomade.cmd configurar` |
| Conferir o que funciona aqui | O mesmo, com `diagnostico` no lugar de `configurar` |
| Ver os logs | Pasta `logs` dentro da pasta de dados |

## Onde ficam os dados

Fora da pasta do Nomade, na pasta do seu usuário:

- **Windows:** `%LOCALAPPDATA%\NomadeBusiness` (cole isso na barra do Explorador)
- **Mac:** `~/Library/Application Support/NomadeBusiness` (no Finder: Ir → Ir para a pasta…)
- **Linux:** `~/.local/share/nomade-business`

Lá estão o banco (`mongo`), os logs, o Node e o banco baixados (`runtime`) e o `config.env` com a sua configuração. Pra começar do zero, apague essa pasta.

## Se der errado

- **"Não deu pra baixar"** (Node ou banco): a rede bloqueou. A janela mostra o link: baixe pelo navegador e coloque o arquivo na pasta que ela indica (ou deixe em Downloads), depois abra o Nomade de novo. Pro banco, também dá pra usar um grátis do [MongoDB Atlas](https://www.mongodb.com/atlas): ele pergunta o link.
- **Windows: "Falta o Visual C++"**: o banco precisa dele. Peça pro TI instalar o "Microsoft Visual C++ Redistributable", ou use o MongoDB Atlas.
- **A página não abre:** espere um minuto e atualize. Se não abrir, olhe a janela preta; ela diz o que parou e qual arquivo de log mandar.
- **"A porta 5004 está ocupada"**: tudo bem, ele usa outra e mostra o endereço certo.
- **Esqueceu a senha:** rode `configurar` e escolha outra.

---

## Prefere Docker?

Se você já usa Docker (ou vai rodar num servidor), baixe o código (botão verde **Code** → **Download ZIP**), abra um terminal na pasta e rode `bash instalar.sh`. Ele faz as mesmas quatro perguntas e sobe tudo com `docker compose`. Os dados ficam no volume `mongo-data`.
