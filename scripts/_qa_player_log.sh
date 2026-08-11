#!/usr/bin/env bash
LOG="${CIVS_TESTSERVER:-$HOME/civs-testserver}/logs/latest.log"
echo "=== SMOKESHOW JOIN CONTEXT ==="
grep -i smokeshow "$LOG"
echo "=== RPG WELCOME/HUB ==="
grep -iE 'welcome|hub|Central|Bem-vindo' "$LOG" | tail -20
echo "=== QUEST ==="
grep -iE 'quest|rescue_stonemason|merchant_path' "$LOG" | tail -20
echo "=== MOB SPAWN ==="
grep -iE 'spawn|guild_thief|wild_boar|custom-mob' "$LOG" | tail -15
echo "=== NPC/GUIDE ==="
grep -iE 'guide|NPC|Guardião|Capitão' "$LOG" | tail -10
