#!/usr/bin/env bash
# Mac: dois cliques aqui abrem o Terminal e ligam o Nomade.
# Na primeira vez o macOS pode avisar que o arquivo veio da internet:
# clique com o botão direito → Abrir → Abrir.
AQUI="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$AQUI/nomade.sh" ]; then exec bash "$AQUI/nomade.sh" "$@"; fi
exec bash "$AQUI/local/nomade.sh" "$@"
