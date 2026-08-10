#!/usr/bin/env bash
set -u
echo "=== kill local ssh hermes clients ==="
ps -u dansilva -o pid=,cmd= | while read -r pid cmd; do
  case "$cmd" in
    *'ssh daniel@bot-server'*hermes*|*'hermes --yolo'*|*'hermes -z'*|*'hermes-agent'*)
      echo "killing $pid :: $cmd"
      kill -9 "$pid" 2>/dev/null || true
      ;;
  esac
done

# Windows Hermes may appear only as connections from Tailscale; also drop hung SSH ptys
pkill -u dansilva -f 'ssh daniel@bot-server' 2>/dev/null || true

sleep 2
echo "=== connections after ==="
ss -tpn | grep -E '41493|11434' || echo "(none matching)"

echo "=== slots ==="
curl -sS -m 5 http://127.0.0.1:41493/slots | python3 - <<'PY'
import sys, json
d = json.load(sys.stdin)
s = d[0]
nt = (s.get("next_token") or [{}])[0]
print("processing", s.get("is_processing"), "decoded", nt.get("n_decoded"), "remain", nt.get("n_remain"))
PY

echo "=== try ollama stop ==="
ollama stop hermes-coder || true
sleep 2
curl -sS -m 5 http://127.0.0.1:11434/api/ps
echo
nvidia-smi --query-gpu=memory.used --format=csv
