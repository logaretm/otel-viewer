#!/usr/bin/env bash
# Re-record the CLI screenshots in docs/screenshots.
#
#   ./record.sh              # all of them
#   ./record.sh navigation   # just one
#
# Needs vhs (brew install vhs) and SF Mono registered as a font family. See
# README.md in this directory.
set -euo pipefail

cd "$(dirname "$0")"
VHS_DIR="$PWD"
OUT="$VHS_DIR/../../docs/screenshots"
PORT=8788

mkdir -p raw "$OUT"

# A throwaway room, so the published images never carry a real one. --demo and
# --local both read it from $HOME/.teley/session.json.
mkdir -p .home/.teley
cat > .home/.teley/session.json <<'JSON'
{
  "roomId": "Kq7mXt2vB9dL",
  "receiveToken": "demoTokenNotRealDoNotUse01"
}
JSON

targets=("${@:-navigation metrics metrics-histogram mcp json local}")
# shellcheck disable=SC2128
read -ra targets <<< "${targets[*]}"

has() { [[ " ${targets[*]} " == *" $1 "* ]]; }

if has navigation; then
  echo "==> navigation"
  vhs navigation.tape
  python3 frame.py raw/navigation.gif "$OUT/teley-cli-navigation.gif"
fi

if has metrics; then
  echo "==> metrics"
  vhs metrics.tape
  python3 frame.py raw/metrics.png "$OUT/teley-cli-metrics.png" --width 2000
fi

if has metrics-histogram; then
  echo "==> metrics-histogram"
  vhs metrics-histogram.tape
  python3 frame.py raw/metrics-histogram.png \
    "$OUT/teley-cli-metrics-histogram.png" --width 2000
fi

if has mcp; then
  echo "==> mcp"
  pkill -f "index.tsx mcp" 2>/dev/null || true
  sleep 1
  vhs mcp.tape
  python3 frame.py raw/mcp.gif "$OUT/teley-cli-mcp.gif"
fi

if has json; then
  echo "==> json"
  vhs json.tape
  python3 frame.py raw/json.png "$OUT/teley-cli-json.png" --width 2000
fi

if has local; then
  echo "==> local"
  pkill -f "index.tsx --local" 2>/dev/null || true
  sleep 1
  # The trace has to be posted from outside the recording pty: a background job
  # started inside it prints job control output over the TUI.
  (
    cd ..
    for _ in $(seq 1 150); do
      nc -z localhost "$PORT" 2>/dev/null && break
      sleep 0.3
    done
    sleep 3
    HOME="$VHS_DIR/.home" bun scripts/send-test-trace.ts --host "localhost:$PORT" >/dev/null 2>&1
  ) &
  sender=$!
  vhs local.tape
  wait "$sender" 2>/dev/null || true
  python3 frame.py raw/local.png "$OUT/teley-cli-local.png" --width 2000
fi

echo
echo "done. raw captures kept in $VHS_DIR/raw"
