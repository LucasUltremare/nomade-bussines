# PatricJ

O modelo da casa do Nomade Business: pequeno, local, rápido e barato. Ele faz
o trabalho de volume do sistema: decisões tipadas, título e tag de memória,
triagem, extração de calls. O orquestrador também pode rodar nele.

**Um modelo para todas as empresas, uma memória por empresa.** O que é de cada
empresa (ICP, decisões, clientes, números) mora na memória dela, nunca nos
pesos. Os pesos aprendem *comportamento*: português, formato, chamar a
ferramenta certa, dizer "não sei" quando a memória não cobre.

| | |
|---|---|
| Base | Qwen3.5-4B (Apache 2.0) |
| Quantização | Q8_0 (~4,5 GB) |
| Roda em | Ollama, inclusive só na CPU |

O Qwen2.5-3B **não** serve de base: ele saiu sob a Qwen Research License,
que é restritiva. Os outros tamanhos da linha 2.5 são Apache. Para um projeto
AGPL que empresas vão rodar, a base precisa ser Apache.

## Subir

Num PC Windows com GPU, servindo o modelo pra rede: siga o
[RODAR-NO-PC.md](RODAR-NO-PC.md). Na mesma máquina do Nomade:

```bash
ollama create patricj -f modelo/Modelfile    # baixa a base e cria o patricj
```

No `.env`:

```bash
OLLAMA_URL=http://localhost:11434            # ou o IP do PC com GPU na rede
OLLAMA_TEXT_MODEL=patricj
```

Com isso, título e tag de memória, embeddings, o classificador de memória e
`POST /api/office/decisoes` passam a usar o PatricJ. No painel, o orquestrador
ganha a opção **Local (Ollama)**.

## Decisões (sistema 1)

`POST /api/office/decisoes` responde perguntas fechadas com probabilidade, no
mesmo formato do `/v1/decisions` do LLM Gateway:

```bash
curl -X POST $PAINEL_URL/api/office/decisoes -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
  "input": "Os pagamentos falham há 3 dias.",
  "questions": [
    {"type": "predicate", "name": "urgente", "instructions": "Exige ação hoje?"},
    {"type": "choice", "name": "frente", "choices": [{"value": "comercial"}, {"value": "entrega"}, {"value": "financeiro"}]},
    {"type": "score", "name": "risco", "levels": [{"label": "nenhum"}, {"label": "baixo"}, {"label": "alto"}]}
  ]}'
```

Os dois motores:

- **jev**: o Jev, da TypeSafe, pelo LLM Gateway. Calibrado e na nuvem. Liga
  com `LLMGATEWAY_API_KEY`.
- **local**: o PatricJ. A probabilidade sai dos logprobs do primeiro token:
  cada opção vira uma letra ou um dígito, e a distribuição desse token é a
  resposta. Precisa do Ollama 0.12 ou mais novo. Sem logprobs, a resposta
  vem com `calibrado: false`.

`DECISOES_MOTOR` escolhe o motor. Vazio, usa o Jev se tiver chave e, sem
chave, o motor local. O limiar de confiança fica no código de quem chama,
nunca no prompt.

O mesmo recurso está no MCP do CLI como a ferramenta `decidir`.

## Medir

```bash
node --env-file=.env modelo/eval.mjs --motor=local
```

O script mede acerto, Brier (calibração) e a confiança nos acertos e nos
erros. Os resultados ficam em `modelo/evals/resultados/`, para comparar a base
com cada fine-tune. Rode o eval **antes** de treinar: é a nota a bater.

## Treinar

1. Monte os dados em `modelo/treinar/dados/`. O formato e o que pode entrar
   estão em [dados/LEIAME.md](treinar/dados/LEIAME.md).
2. Rode o script da sua máquina:
   - Mac com chip M: `bash modelo/treinar/mlx.sh`
   - GPU NVIDIA: `python modelo/treinar/unsloth.py`
3. Troque o `FROM` do `Modelfile` pelo `.gguf` gerado e rode
   `ollama create patricj -f modelo/Modelfile`.
4. Rode o eval de novo. Se a nota não subiu, o fine-tune não entra.
