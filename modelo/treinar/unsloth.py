"""Fine-tune LoRA do PatricJ numa GPU NVIDIA (Unsloth) → GGUF Q8_0.

    pip install unsloth
    python modelo/treinar/unsloth.py                       # base padrão
    BASE=unsloth/Qwen3.5-4B EPOCAS=3 python modelo/treinar/unsloth.py

Precisa de modelo/treinar/dados/train.jsonl (formato em dados/LEIAME.md).
VRAM: os padrões cabem numa GPU de 6 GB (GTX 1660 Super): 4 bits, contexto
2048, batch 1. Com 12 GB+, suba CONTEXTO=4096 BATCH=2.
GPU sem bf16 (série 16xx/20xx) treina em fp16 sozinho. Se a loss virar nan,
baixe LR=1e-4. Se nem assim couber, use BASE=unsloth/Qwen3.5-2B.
Se a base for multimodal e o FastLanguageModel recusar, troque por FastModel.
No Windows, rode dentro do WSL2 (Ubuntu) com o driver NVIDIA do Windows.
"""
import os
from pathlib import Path

from datasets import load_dataset
from trl import SFTConfig, SFTTrainer
from unsloth import FastLanguageModel, is_bfloat16_supported

AQUI = Path(__file__).parent
BASE = os.environ.get("BASE", "unsloth/Qwen3.5-4B")
DADOS = Path(os.environ.get("DADOS", AQUI / "dados"))
EPOCAS = float(os.environ.get("EPOCAS", "2"))
CONTEXTO = int(os.environ.get("CONTEXTO", "2048"))
BATCH = int(os.environ.get("BATCH", "1"))
LR = float(os.environ.get("LR", "2e-4"))
SAIDA = AQUI / "saida"

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=BASE, max_seq_length=CONTEXTO, load_in_4bit=True,
)
model = FastLanguageModel.get_peft_model(
    model,
    r=16, lora_alpha=16, lora_dropout=0,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
)

treino = load_dataset("json", data_files=str(DADOS / "train.jsonl"), split="train")
# o template de chat é o da base: o mesmo que o Ollama vai usar depois
treino = treino.map(lambda ex: {"text": tokenizer.apply_chat_template(ex["messages"], tokenize=False)})

trainer = SFTTrainer(
    model=model,
    processing_class=tokenizer,
    train_dataset=treino,
    args=SFTConfig(
        dataset_text_field="text",
        max_seq_length=CONTEXTO,
        per_device_train_batch_size=BATCH,
        gradient_accumulation_steps=max(1, 8 // BATCH),  # lote efetivo de 8
        num_train_epochs=EPOCAS,
        learning_rate=LR,
        fp16=not is_bfloat16_supported(),
        bf16=is_bfloat16_supported(),
        optim="adamw_8bit",  # o otimizador em 8 bits libera ~1 GB de VRAM
        logging_steps=10,
        output_dir=str(SAIDA / "checkpoints"),
    ),
)
trainer.train()

model.save_pretrained_gguf(str(SAIDA / "gguf"), tokenizer, quantization_method="q8_0")
print(f"\npronto: {SAIDA / 'gguf'} (o .gguf Q8_0 está lá dentro)")
print("troque o FROM do modelo/Modelfile por esse arquivo e rode:")
print("  ollama create patricj -f modelo/Modelfile && node --env-file=.env modelo/eval.mjs --motor=local")
