#!/usr/bin/env bash
set -u
echo "=== api/ps ==="
curl -sS -m 5 http://127.0.0.1:11434/api/ps || true
echo
echo "=== connections 11434 ==="
ss -tpn | grep 11434 || echo none
echo "=== llama-server ==="
pgrep -a llama-server || echo none
echo "=== slots if up ==="
port=$(pgrep -a llama-server | sed -n 's/.*--port \([0-9]*\).*/\1/p' | head -1)
if [ -n "${port:-}" ]; then
  curl -sS -m 5 "http://127.0.0.1:${port}/slots" || true
  echo
fi
echo "=== gpu ==="
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv
echo "=== local ssh hermes ==="
ps -u dansilva -o pid=,etime=,cmd= | grep -E 'bot-server|hermes' | grep -v grep || echo none
