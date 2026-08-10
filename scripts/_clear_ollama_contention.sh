#!/usr/bin/env bash
# Clear local SSH→bot-server Hermes flood so Windows Hermes can use Ollama.
set -u
echo "Killing local ssh hermes clients..."
ps -u dansilva -o pid=,cmd= | while read -r pid cmd; do
  case "$cmd" in
    *'daniel@bot-server'*hermes*|*'daniel@bot-server'*)
      echo "kill $pid"
      kill -9 "$pid" 2>/dev/null || true
      ;;
    *'_probe_focused'*|*'_probe_ollama'*)
      echo "kill probe $pid"
      kill -9 "$pid" 2>/dev/null || true
      ;;
  esac
done

echo "Killing hermes on bot-server..."
ssh -o ConnectTimeout=8 -o BatchMode=yes daniel@bot-server \
  'pgrep -af "/venv/bin/hermes" || true; pkill -9 -f "/home/daniel/.hermes/hermes-agent/venv/bin/hermes" || true; sleep 1; pgrep -af "/venv/bin/hermes" || echo bot_hermes_cleared' || echo "ssh_kill_failed"

sleep 2
echo "Stopping loaded models..."
for m in hermes-fast hermes-agent hermes-coder hermes-qwen14 hermes-fast-mc hermes-agent-mc hermes-coder-mc; do
  ollama stop "$m" >/dev/null 2>&1 || true
done
sleep 2
curl -sS -m 5 http://127.0.0.1:11434/api/ps || true
echo
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv
