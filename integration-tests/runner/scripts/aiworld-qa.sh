#!/usr/bin/env bash
# aiworld-qa.sh — bring-up/tear-down do QA server (Paper) + worker (village-worker.js)
# Roda DENTRO do WSL (Debian). Paths Windows montados em /mnt/c/...
# Uso: source este arquivo OU chame direto:
#   qa-up      -> sobe Paper (tmux: civs-qa) + worker (tmux: village-npc)
#   qa-down    -> mata Paper + worker
#   qa-status  -> tmux ls + healthcheck RCON
#   qa-log     -> tail -f do log do worker (qa*.log mais recente)
set -u

RUNNER="/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner"
SERVER="/home/dansilva/civs-qa-server"
NODE="/home/dansilva/.nvm/versions/node/v25.8.0/bin/node"
LOGDIR="/home/dansilva/.hermes/logs"
PAPER_SESSION="civs-qa"
NPC_SESSION="village-npc"

export RCON_HOST=192.168.152.149
export RCON_PORT=25576
export MC_HOST=192.168.152.149
export MC_PORT=25566
export RCON_PASSWORD=civsqa
export SURFACE_FALLBACK=1
export DETERMINISTIC_MODE=1
export AIWORLD_POLICY=ollama
export OLLAMA_MODEL=qwen3:4b
export OLLAMA_MODEL_FAST=qwen3:1.7b
export AIWORLD_DEBUG=1
export SURFACE_FALLBACK_DEBUG=1
export ENABLE_PERCEIVE_AROUND=1
export RCON_MAX_PENDING=2

qa-up() {
  mkdir -p "$LOGDIR"
  # 1) Paper server
  if tmux has-session -t "$PAPER_SESSION" 2>/dev/null; then
    echo "[qa-up] Paper ja rodando (tmux $PAPER_SESSION)"
  else
    tmux new-session -d -s "$PAPER_SESSION" "cd $SERVER && java -Xmx2G -jar paper.jar --nogui"
    echo "[qa-up] Paper subindo (tmux $PAPER_SESSION)..."
  fi
  # Espera o RCON abrir (ate 60s)
  local i=0
  until timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/25576" 2>/dev/null; do
    i=$((i+1)); [ $i -ge 30 ] && { echo "[qa-up] AVISO: RCON nao abriu em 60s"; break; }
    sleep 2
  done
  [ $i -lt 30 ] && echo "[qa-up] RCON 25576 aberto"

  # 2) Worker (village-worker.js)
  tmux kill-session -t "$NPC_SESSION" 2>/dev/null || true
  sleep 1
  tmux new-session -d -s "$NPC_SESSION" \
    "cd $RUNNER && RCON_HOST=$RCON_HOST RCON_PORT=$RCON_PORT MC_HOST=$MC_HOST MC_PORT=$MC_PORT RCON_PASSWORD=$RCON_PASSWORD SURFACE_FALLBACK=$SURFACE_FALLBACK DETERMINISTIC_MODE=$DETERMINISTIC_MODE AIWORLD_POLICY=$AIWORLD_POLICY OLLAMA_MODEL=$OLLAMA_MODEL OLLAMA_MODEL_FAST=$OLLAMA_MODEL_FAST AIWORLD_DEBUG=$AIWORLD_DEBUG SURFACE_FALLBACK_DEBUG=$SURFACE_FALLBACK_DEBUG ENABLE_PERCEIVE_AROUND=$ENABLE_PERCEIVE_AROUND RCON_MAX_PENDING=$RCON_MAX_PENDING $NODE scripts/village-worker.js 2>&1 | tee -a $RUNNER/reports/village-worker-qa$(date +%s).log"
  echo "[qa-up] Worker subindo (tmux $NPC_SESSION)..."
  sleep 4
  qa-status
}

qa-down() {
  tmux kill-session -t "$NPC_SESSION" 2>/dev/null && echo "[qa-down] worker morto" || echo "[qa-down] worker ja parado"
  tmux kill-session -t "$PAPER_SESSION" 2>/dev/null && echo "[qa-down] Paper morto" || echo "[qa-down] Paper ja parado"
}

qa-status() {
  echo "=== tmux sessions ==="
  tmux ls 2>/dev/null || echo "(nenhuma)"
  echo "=== RCON healthcheck ==="
  timeout 3 bash -c "echo > /dev/tcp/127.0.0.1/25576" 2>/dev/null && echo "RCON 25576: ABERTO" || echo "RCON 25576: FECHADO"
  timeout 3 bash -c "echo > /dev/tcp/127.0.0.1/25566" 2>/dev/null && echo "MC 25566: ABERTO" || echo "MC 25566: FECHADO"
  echo "=== processos ==="
  ps aux | grep -E 'paper.jar|village-worker' | grep -v grep | awk '{print $2, $11, $12, $13}' | head
}

qa-log() {
  local LATEST
  LATEST=$(ls -t "$RUNNER"/reports/village-worker-qa*.log 2>/dev/null | head -1)
  [ -n "$LATEST" ] && tail -f "$LATEST" || echo "sem log de worker ainda"
}

# Se chamado direto (nao source), dispatch
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-status}" in
    up) qa-up ;;
    down) qa-down ;;
    status) qa-status ;;
    log) qa-log ;;
    *) echo "uso: qa-up | qa-down | qa-status | qa-log" ;;
  esac
fi
