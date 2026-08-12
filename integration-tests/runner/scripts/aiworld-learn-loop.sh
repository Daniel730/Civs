#!/usr/bin/env bash
# aiworld-learn-loop.sh — close the continuous-learning loop for the Civs AI World NPC brain.
#
# Pipeline (all local, no external API cost):
#   1. aiworld-finetune.py  -> reports/aiworld-finetune/dataset.jsonl (+ Modelfile, manifest.json)
#   2. ollama create civs-brain -f Modelfile   (ONLY if `ollama` CLI is on PATH; otherwise skip)
#   3. print the worker-launch command that uses the freshly trained model (OLLAMA_MODEL=civs-brain)
#
# The worker itself records rated experiences (Task A) into reports/aiworld-experiences/*.jsonl.
# Run this loop after a live session to distill those into a better brain, then relaunch the worker.
#
# Safe by design: if `ollama` is missing, the script only regenerates the dataset (the worker
# keeps running on the deterministic brain or an already-trained model). Nothing destructive.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_MODEL="${OLLAMA_MODEL:-llama3.1:8b}"
TRAINED_MODEL="${AIWORLD_TRAINED_MODEL:-civs-brain}"
SRC="${AIWORLD_EXP_DIR:-reports/aiworld-experiences}"
OUT="${AIWORLD_FT_DIR:-reports/aiworld-finetune}"

echo "== [1/3] generate fine-tune dataset from rated experiences =="
PYBIN="$(command -v python3 || command -v python || echo python)"
"$PYBIN" scripts/aiworld-finetune.py --src "$SRC" --out "$OUT" --base "$BASE_MODEL"

echo "== [2/3] create Ollama model (skipped if 'ollama' not installed) =="
if command -v ollama >/dev/null 2>&1; then
  echo "ollama found -> creating $TRAINED_MODEL from $OUT/Modelfile"
  ollama create "$TRAINED_MODEL" -f "$OUT/Modelfile"
  echo "created model: $TRAINED_MODEL"
else
  echo "ollama NOT on PATH. Dataset written to $OUT; install Ollama and run:"
  echo "    ollama create $TRAINED_MODEL -f $OUT/Modelfile"
  echo "then relaunch the worker with OLLAMA_MODEL=$TRAINED_MODEL"
fi

echo "== [3/3] relaunch command (copy/paste into the WSL tmux session) =="
cat <<EOF
wsl -e bash -lic "tmux new-session -d -s aiworld-ollama 'cd /mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner && \\
  MC_HOST=192.168.152.149 RCON_HOST=192.168.152.149 MC_PORT=25565 RCON_PORT=25575 RCON_PASSWORD=[REDACTED] \\
  ACTOR_NAME=Steve HELPER_NAME=Alex CAMERA_NAME=Cam ENABLE_HELPER=1 \\
  AIWORLD_POLICY=ollama OLLAMA_MODEL=$TRAINED_MODEL node scripts/village-worker.js > /home/dansilva/aiworld-ollama.log 2>&1' && echo STARTED"
EOF
echo "done."
