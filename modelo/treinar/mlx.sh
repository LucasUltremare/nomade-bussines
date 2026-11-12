#!/usr/bin/env bash
# Fine-tune LoRA do PatricJ num Mac com chip M (MLX) → GGUF Q8_0.
#
#   pip install mlx-lm            # uma vez
#   git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp && pip install -r ~/llama.cpp/requirements.txt
#   bash modelo/treinar/mlx.sh
#
# Precisa de modelo/treinar/dados/{train,valid}.jsonl (formato em dados/LEIAME.md).
# Mac com 8 GB: use a base em 4 bits (BASE=mlx-community/Qwen3.5-4B-4bit) e
# feche o resto. Com 16 GB+, a base cheia treina melhor.
set -euo pipefail
cd "$(dirname "$0")"

BASE="${BASE:-Qwen/Qwen3.5-4B}"
DADOS="${DADOS:-dados}"
ITERS="${ITERS:-600}"
LLAMA_CPP="${LLAMA_CPP:-$HOME/llama.cpp}"
SAIDA=saida

[ -f "$DADOS/train.jsonl" ] && [ -f "$DADOS/valid.jsonl" ] || { echo "falta $DADOS/train.jsonl e valid.jsonl — veja dados/LEIAME.md"; exit 1; }
mkdir -p "$SAIDA"

# --mask-prompt: aprende só a RESPOSTA, não a decorar a pergunta
mlx_lm.lora --model "$BASE" --train --data "$DADOS" \
  --iters "$ITERS" --batch-size 1 --num-layers 16 \
  --max-seq-length 2048 --grad-checkpoint --mask-prompt \
  --adapter-path "$SAIDA/adapters"

mlx_lm.fuse --model "$BASE" --adapter-path "$SAIDA/adapters" \
  --save-path "$SAIDA/fundido" --dequantize

python "$LLAMA_CPP/convert_hf_to_gguf.py" "$SAIDA/fundido" \
  --outtype q8_0 --outfile "$SAIDA/patricj-q8_0.gguf"

echo
echo "pronto: $SAIDA/patricj-q8_0.gguf"
echo "agora troque o FROM do modelo/Modelfile para ./treinar/saida/patricj-q8_0.gguf e rode:"
echo "  ollama create patricj -f modelo/Modelfile && node --env-file=.env modelo/eval.mjs --motor=local"
