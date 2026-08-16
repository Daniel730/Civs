#!/bin/bash
# Civs AI World - launch workers persistentes (executado DENTRO do WSL)
# Padrão que funciona: setsid + nohup para desanexar do shell pai.
set -u

RUNNER="/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner"
LOGDIR="/home/dansilva/.hermes/logs"
NODE="/home/dansilva/.nvm/versions/node/v25.8.0/bin/node"

mkdir -p "$LOGDIR"
cd "$RUNNER"

# Mata workers antigos (evita dois controladores do mesmo NPC)
pkill -9 -f "village-worker.js" 2>/dev/null
pkill -9 -f "steve-chat.js" 2>/dev/null
sleep 2

# Lança workers desanexados (setsid + nohup + redireção WSL)
setsid nohup "$NODE" scripts/village-worker.js > "$LOGDIR/village-worker.log" 2>&1 < /dev/null &
setsid nohup "$NODE" scripts/steve-chat.js > "$LOGDIR/steve-chat.log" 2>&1 < /dev/null &

sleep 4

# Evidência: quantos workers vivos
ALIVE=$(ps aux | grep -E "village-worker|steve-chat" | grep -v grep | wc -l)
echo "WORKERS_ATIVOS=$ALIVE"
echo "--- LOGS ---"
for f in village-worker steve-chat; do
  echo "[$f]"
  tail -3 "$LOGDIR/$f.log" 2>/dev/null || echo "  (sem log)"
done