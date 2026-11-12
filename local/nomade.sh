#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# Nomade Business — rodar neste computador (Mac e Linux), sem Docker e sem admin
#
#   ./nomade.sh                 liga o Nomade
#   ./nomade.sh configurar      refaz as perguntas
#   ./nomade.sh diagnostico     confere o que funciona nesta máquina
#
# Usa o Node do sistema se for 20.19 ou mais novo; senão baixa um Node
# portátil (conferido com o SHASUMS256 do nodejs.org) pra pasta de dados.
# O resto é com local/iniciar.mjs.
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$AQUI/package.json" ]; then RAIZ="$AQUI"; else RAIZ="$(cd "$AQUI/.." && pwd)"; fi
cd "$RAIZ"

NODE_VER="24.22.2"
case "$(uname -s)" in
  Darwin) OS=darwin; DADOS_PADRAO="$HOME/Library/Application Support/NomadeBusiness" ;;
  Linux)  OS=linux;  DADOS_PADRAO="${XDG_DATA_HOME:-$HOME/.local/share}/nomade-business" ;;
  *) echo "  Use Nomade.cmd on Windows."; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  *) echo "  Unsupported CPU: $(uname -m)"; exit 1 ;;
esac
DADOS="${NOMADE_DADOS:-$DADOS_PADRAO}"
RUNTIME="$DADOS/runtime"
NOME="node-v$NODE_VER-$OS-$ARCH"
NODE="$RUNTIME/$NOME/bin/node"

# proxy da empresa configurado só no macOS (não no ambiente): o curl precisa saber
if [ "$OS" = darwin ] && [ -z "${HTTPS_PROXY:-}${https_proxy:-}" ]; then
  P="$(scutil --proxy 2>/dev/null | awk '/HTTPSEnable : 1/{on=1} /HTTPSProxy :/{h=$3} /HTTPSPort :/{p=$3} END{if(on&&h)print "http://"h":"(p?p:80)}')"
  if [ -n "$P" ]; then export HTTPS_PROXY="$P" https_proxy="$P"; fi
fi

node_serve() { # o node do sistema serve? (20.19+)
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' 2>/dev/null
}

if [ ! -x "$NODE" ]; then
  if [ "${NOMADE_NODE_PORTATIL:-}" != "1" ] && node_serve; then
    NODE="$(command -v node)"
  else
    mkdir -p "$RUNTIME"
    ARQ="$RUNTIME/$NOME.tar.gz"
    URL="https://nodejs.org/dist/v$NODE_VER/$NOME.tar.gz"
    echo
    echo "  Node.js $NODE_VER (~50 MB, once / uma vez / una vez)…"
    # quem baixou pelo navegador pode ter deixado em Downloads
    if [ ! -f "$ARQ" ] && [ -f "$HOME/Downloads/$NOME.tar.gz" ]; then cp "$HOME/Downloads/$NOME.tar.gz" "$ARQ"; fi
    if [ ! -f "$ARQ" ] && ! curl -fL --retry 2 --connect-timeout 20 --progress-bar -o "$ARQ" "$URL"; then
      rm -f "$ARQ"
      echo
      echo "  ✗ Download failed / Não deu pra baixar / No se pudo descargar:"
      echo "    $URL"
      echo "    → $RUNTIME/"
      echo "  Download it in the browser, put it in that folder and open Nomade again."
      echo "  Baixe pelo navegador, coloque nessa pasta e abra o Nomade de novo."
      exit 1
    fi
    ESPERADO="$(curl -fsSL "https://nodejs.org/dist/v$NODE_VER/SHASUMS256.txt" | awk -v f="$NOME.tar.gz" '$2==f{print $1}')" || ESPERADO=""
    if command -v shasum >/dev/null 2>&1; then OBTIDO="$(shasum -a 256 "$ARQ" | awk '{print $1}')"; else OBTIDO="$(sha256sum "$ARQ" | awk '{print $1}')"; fi
    if [ -n "$ESPERADO" ] && [ "$ESPERADO" != "$OBTIDO" ]; then
      rm -f "$ARQ"
      echo "  ✗ The Node download is corrupted. Open Nomade again. / O download veio corrompido. Abra de novo."
      exit 1
    fi
    tar -xzf "$ARQ" -C "$RUNTIME"
    rm -f "$ARQ"
  fi
fi

exec "$NODE" "$RAIZ/local/iniciar.mjs" "$@"
