# Rodar o PatricJ no PC

Este guia sobe o PatricJ num PC Windows com GPU NVIDIA e deixa o Nomade
Business, rodando em outra máquina, usar esse modelo pela rede de casa.
Testado para: GTX 1660 Super (6 GB), i5 de 9ª geração, 16 GB de RAM.

Na parte 1, o PC passa a servir o modelo, e o painel começa a usar o PatricJ
para decisões, título e tag de memória e embeddings. A parte 2, de treino, é
opcional e só faz sentido quando houver dados de treino.

---

## Antes de começar

- **Windows 10 ou 11** com o driver NVIDIA atualizado (GeForce Experience ou nvidia.com).
- **Git**: https://git-scm.com/download/win
- **O código no PC.** Se o repositório ainda não foi enviado pro GitHub, a
  pasta `modelo/` não vem no `git clone`. Nesse caso, envie antes
  (`git push`) ou copie a pasta do projeto inteira num pendrive.

---

## Parte 1: servir o modelo

### 1. Instalar o Ollama

Baixe e instale: https://ollama.com/download

Abra um PowerShell e confira a versão:

```powershell
ollama --version
```

Precisa ser **0.12 ou mais nova**. As versões anteriores não devolvem
logprobs, e sem logprobs as decisões perdem a probabilidade.

### 2. Liberar o Ollama na rede de casa

Por padrão o Ollama só aceita conexões do próprio PC. Para a outra máquina
conseguir falar com ele:

```powershell
setx OLLAMA_HOST 0.0.0.0
```

Depois feche o Ollama pelo ícone ao lado do relógio e abra de novo.

Libere a porta no firewall só para redes privadas. Rode num **PowerShell
como administrador**:

```powershell
New-NetFirewallRule -DisplayName "Ollama" -Direction Inbound -LocalPort 11434 -Protocol TCP -Action Allow -Profile Private
```

> **Não abra a porta 11434 no roteador.** O Ollama não tem senha: quem
> alcançar essa porta usa o modelo. Confira também se o Wi-Fi de casa está
> marcado como rede **Privada** em Configurações → Rede.

### 3. Pegar o código e criar o PatricJ

```powershell
cd $HOME
git clone https://github.com/LucasUltremare/nomade-bussines.git
cd nomade-bussines
ollama create patricj -f modelo/Modelfile
ollama pull nomic-embed-text
```

O primeiro `create` baixa a base, o Qwen3.5-4B em Q8_0 (~4,5 GB).

Se der erro de tag inexistente, abra `modelo/Modelfile`, troque
`FROM qwen3.5:4b-q8_0` por `FROM qwen3.5:4b` e rode o `create` de novo. Essa
versão é Q4: menor, um pouco menos precisa.

### 4. Conferir se está na GPU

```powershell
ollama run patricj "Responda só: ok"
ollama ps
```

A coluna `PROCESSOR` do `ollama ps` deve mostrar **100% GPU**. Se mostrar
uma parte em CPU, o modelo não coube na placa e vai ficar lento. Nesse caso,
baixe o `num_ctx` no Modelfile (por exemplo para 4096), ou use
`FROM qwen3.5:4b`, e rode o `create` de novo.

### 5. Descobrir o IP do PC

```powershell
ipconfig
```

Anote o **Endereço IPv4** do adaptador da rede de casa, algo como `192.168.0.42`.

Para o IP não mudar depois, reserve ele no roteador (procure por "DHCP
estático" ou "reserva de IP").

---

## Ligar o Nomade no PC

Faça isto **na máquina onde roda o Nomade Business**, não no PC.

### 1. Testar se o PC responde

```bash
curl http://192.168.0.42:11434/api/tags
```

Tem que aparecer uma lista com `patricj` e `nomic-embed-text`. Se der
timeout, revise o passo 2 da Parte 1: o firewall, o `OLLAMA_HOST` e se o
Ollama foi reaberto.

### 2. Testar os logprobs

```bash
curl -s http://192.168.0.42:11434/api/chat -d '{
  "model": "patricj", "stream": false, "think": false,
  "logprobs": true, "top_logprobs": 5,
  "options": {"temperature": 0, "num_predict": 1},
  "messages": [{"role": "user", "content": "Responda só S ou N: o céu é azul?"}]
}'
```

A resposta tem que trazer um campo `logprobs`. Se não trouxer, atualize o
Ollama do PC.

### 3. Configurar o `.env`

No `.env` do Nomade:

```bash
OLLAMA_URL=http://192.168.0.42:11434
OLLAMA_TEXT_MODEL=patricj
```

Reinicie o office (`npm run dev:office`) e confira se a chave foi lida:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:5004/api/office/decisoes/status
# {"motor":"local"}
```

Se `LLMGATEWAY_API_KEY` também estiver preenchida, o motor padrão das
decisões passa a ser o Jev. Para forçar o PatricJ, use `DECISOES_MOTOR=local`.

### 4. Tirar a nota da base

```bash
node --env-file=.env modelo/eval.mjs --motor=local
```

Guarde o resultado: ele fica salvo em `modelo/evals/resultados/`. É a nota
que o fine-tune tem que bater.

---

## Parte 2: treinar (opcional)

Só faz sentido com exemplos em `modelo/treinar/dados/`. O formato e as regras
estão em [treinar/dados/LEIAME.md](treinar/dados/LEIAME.md). O mais
importante: **nada de fatos de empresa** e **nada gerado por Claude, GPT ou
outro modelo de API**.

O treino roda no **WSL2**, o Linux dentro do Windows. O Unsloth não funciona
direto no Windows.

### 1. Instalar o WSL2

Num PowerShell como administrador:

```powershell
wsl --install -d Ubuntu
```

Reinicie o PC, abra o "Ubuntu" no menu Iniciar e crie usuário e senha.

O driver NVIDIA do Windows já serve para o WSL. **Não** instale driver NVIDIA
dentro do Ubuntu. Para conferir que a placa aparece:

```bash
nvidia-smi
```

### 2. Preparar o ambiente (dentro do Ubuntu)

```bash
sudo apt update && sudo apt install -y python3-venv git
git clone https://github.com/LucasUltremare/nomade-bussines.git ~/nomade-bussines
cd ~/nomade-bussines
python3 -m venv .venv && source .venv/bin/activate
pip install unsloth
```

Clone **dentro** do Ubuntu (`~/`), e não em `/mnt/c/`. Ler arquivos do disco
do Windows deixa o treino bem mais lento.

### 3. Colocar os dados

Coloque `train.jsonl` e `valid.jsonl` em `~/nomade-bussines/modelo/treinar/dados/`.
Para copiar do Windows, os arquivos de `C:\Users\<você>` aparecem em
`/mnt/c/Users/<você>/` dentro do Ubuntu:

```bash
cp /mnt/c/Users/<você>/Downloads/train.jsonl /mnt/c/Users/<você>/Downloads/valid.jsonl modelo/treinar/dados/
```

### 4. Treinar

```bash
source .venv/bin/activate
python modelo/treinar/unsloth.py
```

Os padrões do script já são para 6 GB: 4 bits, contexto 2048, batch 1, fp16.
Numa 1660 Super o treino leva **horas**: a placa não tem tensor cores.

| Problema | O que fazer |
|---|---|
| `CUDA out of memory` | `CONTEXTO=1024 python modelo/treinar/unsloth.py` |
| Continua sem caber | `BASE=unsloth/Qwen3.5-2B python modelo/treinar/unsloth.py` (troque também o `FROM` do Modelfile para `qwen3.5:2b` na comparação) |
| `loss` vira `nan` | `LR=1e-4 python modelo/treinar/unsloth.py` |
| Erro dizendo que o modelo é multimodal | No `unsloth.py`, troque `FastLanguageModel` por `FastModel` |

### 5. Levar o modelo treinado pro Ollama

O GGUF sai em `modelo/treinar/saida/gguf/`. Confira o nome exato do arquivo:

```bash
ls modelo/treinar/saida/gguf/*.gguf
```

Copie para a pasta do repositório no Windows:

```bash
mkdir -p /mnt/c/Users/<você>/nomade-bussines/modelo/treinar/saida
cp modelo/treinar/saida/gguf/<arquivo>.gguf /mnt/c/Users/<você>/nomade-bussines/modelo/treinar/saida/patricj-q8_0.gguf
```

No Windows, abra `modelo/Modelfile` e troque a linha do `FROM`:

```
FROM ./treinar/saida/patricj-q8_0.gguf
```

Depois, no PowerShell:

```powershell
cd $HOME\nomade-bussines
ollama create patricj -f modelo/Modelfile
```

### 6. Comparar

Na máquina do Nomade, rode o eval de novo:

```bash
node --env-file=.env modelo/eval.mjs --motor=local
```

Compare com a nota da base, em `modelo/evals/resultados/`. **Se o `acerto`
não subiu e o `brier` não caiu, o fine-tune não entra**: volte o `FROM` pra
base e rode o `create` de novo.

---

## Resumo rápido

| Onde | Comando |
|---|---|
| PC | `ollama create patricj -f modelo/Modelfile` |
| PC | `ollama ps` (tem que mostrar 100% GPU) |
| Máquina do Nomade | `.env`: `OLLAMA_URL=http://<IP-do-PC>:11434` |
| Máquina do Nomade | `node --env-file=.env modelo/eval.mjs --motor=local` |
| PC (Ubuntu/WSL) | `python modelo/treinar/unsloth.py` |
