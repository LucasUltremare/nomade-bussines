# Dados de treino do PatricJ

Esta pasta fica fora do git (`.gitignore`). O que entra aqui ensina
**comportamento**, nunca a empresa.

## Formato

Um exemplo por linha, no formato de chat:

```json
{"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
```

- `train.jsonl`: os exemplos de treino.
- `valid.jsonl`: de 5 a 10% separados para validação. O MLX exige esse arquivo.

## O que entra

- Decisões no formato do motor local (`lib/decisoes.js`): texto, pergunta,
  opções com símbolo, e a resposta com **um símbolo só**.
- Extração: trecho de call ou e-mail → decisão, compromisso, prazo, dono.
- O JSON do orquestrador (`tasks`, `decisoes`, `memorias`) a partir de um pedido.
- Responder com base na memória que veio no contexto, e dizer "não sei"
  quando a memória não cobre o assunto.

## O que não entra

- **Fatos de uma empresa** (clientes, preços, decisões reais). O modelo é o
  mesmo para todas as empresas, e o que é de cada uma mora na memória dela.
  Fato nos pesos vaza para todas as instalações e não tem como apagar depois.
- **Respostas geradas pelo Claude, pelo GPT ou por outro modelo de API.** Os
  termos da Anthropic e da OpenAI proíbem usar as respostas deles para treinar
  outro modelo. Escreva os exemplos à mão, ou aproveite o uso real do sistema
  já revisado por uma pessoa e sem dado de cliente.
- **Os casos de `modelo/evals/`.** Se entrarem no treino, a nota da avaliação
  deixa de valer.
