#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# Nomade Business — instalador de um comando
#
#   bash instalar.sh
#
# Faz: confere o Docker, cria o .env com segredos novos, pergunta 4 coisas
# (idioma, nome da empresa, seu e-mail, uma senha) e sobe tudo. No fim
# mostra o endereço pra abrir. Rodar de novo só atualiza.
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

# ── idioma das mensagens ──────────────────────────────────────────────────
echo
echo "  1) English   2) Português   3) Español"
read -rp "  > " L; L="${L:-1}"
case "$L" in 2) LANG_=pt;; 3) LANG_=es;; *) LANG_=en;; esac

say() { # say <en> <pt> <es>
  case "$LANG_" in pt) echo -e "$2";; es) echo -e "$3";; *) echo -e "$1";; esac
}
ask() { # ask <var> <default> <en> <pt> <es>
  local v=$1 d=$2; local p
  case "$LANG_" in pt) p=$4;; es) p=$5;; *) p=$3;; esac
  if [ -n "$d" ]; then read -rp "  $p [$d]: " r; else read -rp "  $p: " r; fi
  printf -v "$v" '%s' "${r:-$d}"
}
secret() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32; else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi; }
setenv() { # setenv KEY VALUE — troca ou acrescenta no .env
  local k=$1 v=$2
  if grep -qE "^${k}=" .env; then
    # sed portátil (mac e linux): escreve num temporário
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env > .env.tmp && mv .env.tmp .env
  else echo "${k}=${v}" >> .env; fi
}

echo
say "  Nomade Business — setup" "  Nomade Business — instalação" "  Nomade Business — instalación"
say "  Four questions and it runs on this computer." "  Quatro perguntas e ele roda neste computador." "  Cuatro preguntas y corre en esta computadora."
echo

# ── Docker ────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  say "  ✗ Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/ then run this again." \
      "  ✗ O Docker não está instalado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/ e rode de novo." \
      "  ✗ Docker no está instalado. Instala Docker Desktop: https://www.docker.com/products/docker-desktop/ y vuelve a ejecutar."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  say "  ✗ Docker is installed but not running. Open Docker Desktop, wait for the whale icon, then run this again." \
      "  ✗ O Docker está instalado mas não está aberto. Abra o Docker Desktop, espere o ícone da baleia ficar parado e rode de novo." \
      "  ✗ Docker está instalado pero no abierto. Abre Docker Desktop, espera el ícono de la ballena y vuelve a ejecutar."
  exit 1
fi

# ── .env ──────────────────────────────────────────────────────────────────
NOVO=0
if [ ! -f .env ]; then cp .env.example .env; NOVO=1; fi

if [ "$NOVO" = 1 ]; then
  ask EMPRESA "" "Company name" "Nome da empresa" "Nombre de la empresa"
  ask EMAIL "" "Your e-mail (this is your login)" "Seu e-mail (vai ser o seu login)" "Tu correo (será tu usuario)"
  ask SENHA "" "Choose a password (8+ characters)" "Escolha uma senha (8+ caracteres)" "Elige una contraseña (8+ caracteres)"
  while [ "${#SENHA}" -lt 8 ]; do
    say "  Password too short." "  Senha muito curta." "  Contraseña muy corta."
    ask SENHA "" "Choose a password (8+ characters)" "Escolha uma senha (8+ caracteres)" "Elige una contraseña (8+ caracteres)"
  done
  setenv EMPRESA_NOME "$EMPRESA"
  setenv ADMIN_EMAILS "$EMAIL"
  setenv ADMIN_SENHA "$SENHA"
  setenv JWT_SECRET "$(secret)"
  setenv HQ_PROXY_SECRET "$(secret)"
  setenv BASE_URL "http://localhost:5002"
  setenv PAINEL_URL "http://localhost:5004"
  setenv IDIOMA_PADRAO "$LANG_"
else
  say "  .env already exists — keeping your settings, just updating the app." \
      "  O .env já existe — mantendo suas configurações, só atualizando o app." \
      "  El .env ya existe — mantengo tu configuración, solo actualizo la app."
fi

# ── sobe ──────────────────────────────────────────────────────────────────
echo
say "  Building and starting (first time takes a few minutes)…" "  Montando e subindo (a primeira vez leva alguns minutos)…" "  Construyendo y arrancando (la primera vez tarda unos minutos)…"
docker compose up -d --build

say "  Waiting for the panel…" "  Esperando o painel…" "  Esperando el panel…"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null http://localhost:5004/robots.txt 2>/dev/null; then break; fi
  sleep 2
done

EMAIL_ATUAL=$(grep -E '^ADMIN_EMAILS=' .env | cut -d= -f2- | cut -d, -f1)
echo
say "  ✓ Ready. Open:  http://localhost:5004" "  ✓ Pronto. Abra:  http://localhost:5004" "  ✓ Listo. Abre:  http://localhost:5004"
say "    Sign in with ${EMAIL_ATUAL} and the password you chose." "    Entre com ${EMAIL_ATUAL} e a senha que você escolheu." "    Entra con ${EMAIL_ATUAL} y la contraseña que elegiste."
say "    Forgot it? Edit ADMIN_SENHA in the .env file and run this again." "    Esqueceu? Edite ADMIN_SENHA no arquivo .env e rode isto de novo." "    ¿La olvidaste? Edita ADMIN_SENHA en el archivo .env y vuelve a ejecutar."
say "    To stop:  docker compose down     To see logs:  docker compose logs -f" "    Pra parar:  docker compose down     Pra ver os logs:  docker compose logs -f" "    Para detener:  docker compose down     Para ver logs:  docker compose logs -f"
echo
if command -v open >/dev/null 2>&1; then open http://localhost:5004 >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:5004 >/dev/null 2>&1 || true
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start http://localhost:5004 >/dev/null 2>&1 || true; fi
