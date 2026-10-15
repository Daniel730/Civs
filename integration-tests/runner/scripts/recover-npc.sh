#!/usr/bin/env bash
# Recover Paper QA NPC overnight worker (disposable WSL only).
set -eu
export PATH="${HOME}/.nvm/versions/node/v25.8.0/bin:${PATH}"
ROOT="/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner"
cd "$ROOT"
if ! tmux has-session -t civs-qa 2>/dev/null; then
  echo "BLOCKED: civs-qa tmux missing - start Paper first"
  exit 2
fi
# From inside WSL, Paper is on localhost (FACT). Do NOT use eth0 IP for actors —
# rapid multi-login via eth0 was OBSERVED to ECONNRESET / login timeout Cam+Alex.
tmux kill-session -t village-npc 2>/dev/null || true
sleep 2
# Kick stale protocol ghosts so login slots are free
python3 - <<'PY' || true
import socket, struct, time, os
host, port, pwd = "127.0.0.1", 25575, "civsqa"
def req(cmd):
    s = socket.create_connection((host, port), 5)
    def send(t, p):
        b = p.encode("utf8") + b"\x00\x00"
        s.send(struct.pack("<iii", 10+len(b), 0, t) + b)
    send(3, pwd); s.recv(4096)
    send(2, cmd); s.recv(4096)
    s.close()
for c in ["kick Alex", "kick Cam", "kick Steve"]:
    try: req(c)
    except Exception as e: print("kick", c, e)
time.sleep(1)
PY
sleep 1
tmux new-session -d -s village-npc \
  "RCON_HOST=127.0.0.1 RCON_PASSWORD=civsqa MC_HOST=127.0.0.1 ENABLE_HELPER=1 ENABLE_VIEWER_FOLLOW=1 CAM_DWELL_MS=15000 node scripts/village-worker.js 2>&1 | tee -a reports/village-worker.log"
echo "PASS: village-npc restarted (observation director + viewer follow, localhost actors)"
tmux ls
