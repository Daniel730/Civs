#!/bin/bash
# Restart workers com config QA correta + debug de surface fallback.
set -u
RUNNER="/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner"
LOGDIR="/home/dansilva/.hermes/logs"
mkdir -p "$LOGDIR"

cd "$RUNNER" || exit 1

# Kill any old workers
pkill -f 'scripts/village-worker.js' 2>/dev/null || true
pkill -f 'scripts/steve-chat.js'     2>/dev/null || true
sleep 2

# QA server env (192.168.152.149 is local QA on Dan's LAN — see scripts/aiworld-learn-loop.sh)
export RCON_HOST=192.168.152.149
export RCON_PORT=25576
export MC_HOST=192.168.152.149
export MC_PORT=25566
export RCON_PASSWORD=civsqa
# Surface-fallback warnings ON — lets us spot RCON drift / hard-coded origin.y in logs
export SURFACE_FALLBACK_DEBUG=1
export AIWORLD_DEBUG=1
# FASE A (wiki lower-latency): modelos trocados para qwen3 (4b default + 1.7b ultra-rápido)
# ASSIM QUE o pull terminar (veja /tmp/pull_qwen4b.log). Por ora mantemos civs-brain
# (ja existe local) ate os qwen3 estarem baixados, para o worker nao crashar no Ollama.
export OLLAMA_MODEL=civs-brain
export OLLAMA_MODEL_FAST=qwen3:1.7b
# RCON client: maxPending=2 (queries independentes em paralelo; benchmark no wiki).
export RCON_MAX_PENDING=2

# Launch
setsid nohup /home/dansilva/.nvm/versions/node/v25.8.0/bin/node \
  scripts/village-worker.js > "$LOGDIR/village-worker.log" 2>&1 < /dev/null &
disown 2>/dev/null || true

setsid nohup /home/dansilva/.nvm/versions/node/v25.8.0/bin/node \
  scripts/steve-chat.js > "$LOGDIR/steve-chat.log" 2>&1 < /dev/null &
disown 2>/dev/null || true

sleep 6
echo "=== PROCESSOS ==="
ps aux | grep -E 'village-worker|steve-chat' | grep -v grep
echo "=== LOG village-worker (ultimas 25 linhas) ==="
tail -n 25 "$LOGDIR/village-worker.log" 2>&1
echo "=== LOG steve-chat (ultimas 8 linhas) ==="
tail -n 8 "$LOGDIR/steve-chat.log" 2>&1