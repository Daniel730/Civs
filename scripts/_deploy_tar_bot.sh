#!/usr/bin/env bash
# Deploy Civs (+ RPG) to bot-server mineserver.
# Prefer WSL SSH (keys live there). From Windows OpenSSH without keys, use:
#   wsl -e bash scripts/_deploy_tar_bot.sh
# Host: Tailscale MagicDNS bot-server, or override HOST=daniel@100.115.208.23
set -euo pipefail
HOST="${HOST:-daniel@bot-server}"
SERVER=/home/daniel/mineserver
PLUGINS="$SERVER/plugins"
CIVS_JAR=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/target/civs-1.11.7.jar
RPG_JAR=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/rpg-server-plugin/target/rpg-server-0.1.2.jar
CIVS_CFG=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/Civs_servidor
QUARANTINE="$SERVER/mineserver_cleanup_$(date +%Y%m%d_%H%M%S)"

# Use systemd user unit so heap stays -Xms1536M -Xmx2G (MemoryMax=2800M).
# Do NOT start via mineserver-control-remote.sh defaults (-Xms4G -Xmx4G) on this host.
stop_server() {
  ssh -o BatchMode=yes "$HOST" 'systemctl --user stop minecraft.service'
}
start_server() {
  ssh -o BatchMode=yes "$HOST" 'systemctl --user start minecraft.service'
}

test -f "$CIVS_JAR"
test -f "$RPG_JAR"
test -d "$CIVS_CFG"

echo "== stopping server (systemd) =="
stop_server

echo "== quarantine backup =="
ssh -o BatchMode=yes "$HOST" "mkdir -p \"$QUARANTINE\" && cp -a \"$PLUGINS/Civs\" \"$QUARANTINE/Civs\" && cp -a \"$PLUGINS\"/civs-*.jar \"$QUARANTINE/\" 2>/dev/null || true && cp -a \"$PLUGINS\"/rpg-server-*.jar \"$QUARANTINE/\" 2>/dev/null || true"
echo "QUARANTINE=$QUARANTINE"

echo "== tar Civs_servidor -> plugins/Civs (preserve live data) =="
tar -C "$CIVS_CFG" \
  --exclude=towns \
  --exclude=regions \
  --exclude=players \
  --exclude=alliances \
  --exclude=block-data.yml \
  -cf - . \
  | ssh -o BatchMode=yes "$HOST" "mkdir -p \"$PLUGINS/Civs\" && tar -C \"$PLUGINS/Civs\" -xf -"

echo "== deploy JARs =="
ssh -o BatchMode=yes "$HOST" "rm -f \"$PLUGINS\"/civs-*.jar \"$PLUGINS\"/rpg-server-*.jar"
scp -o BatchMode=yes "$CIVS_JAR" "${HOST}:${PLUGINS}/civs-1.11.7.jar"
scp -o BatchMode=yes "$RPG_JAR" "${HOST}:${PLUGINS}/rpg-server-0.1.2.jar"

BOOT_MARK="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== starting server (systemd) mark=$BOOT_MARK =="
start_server

LOG="$SERVER/logs/latest.log"
for i in $(seq 1 90); do
  if ssh -o BatchMode=yes "$HOST" "grep -q 'Done (' \"$LOG\" 2>/dev/null && systemctl --user is-active minecraft.service >/dev/null"; then
    # Prefer a Done line after we started; fall through after waits if log rotated oddly.
    if ssh -o BatchMode=yes "$HOST" "tail -n 80 \"$LOG\" | grep -q 'Done ('"; then
      break
    fi
  fi
  sleep 3
done
sleep 8

echo "=== boot verification ==="
ssh -o BatchMode=yes "$HOST" "systemctl --user is-active minecraft.service; pgrep -af 'Xmx2G.*server.jar' | head -2; grep -iE 'Civs|RPGServer|custom mob|Carregad|Enabling|Done \\(' \"$LOG\" | tail -30"
echo "=== civs/rpg errors ==="
ssh -o BatchMode=yes "$HOST" "grep -E 'ERROR|ClassNotFoundException|NoClassDefFoundError' \"$LOG\" | grep -iE 'Civs|RPGServer|custom' | tail -15 || true"
echo "DEPLOY_OK quarantine=$QUARANTINE"
