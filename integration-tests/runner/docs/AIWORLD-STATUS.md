# AI World — Status (honest, measured) — UPDATED 2026-08-13

Branch local: `fix/camera-observation-alex-steve`. Two Hermes agents work in back-and-forth:
**brain agent** (cognition/memory/learning) and **body agent** (locomotion/objective-selector).
Neither pushes (per coordination rule). No force-push.

## QA bring-up (CLEAN, 2026-08-13 — verified live)
- MC server: tmux `mc-qa` (paper.jar, WSL `/home/dansilva/civs-testserver`). RCON `127.0.0.1:25575`
  pw `civsqa`, MC `192.168.152.149:25565`. `online-mode=false`, `white-list=false` → anyone
  (incl. **Smokeshow** as Viewer) joins directly, no whitelist/op needed.
- AI World worker: tmux `aiworld-civs` → `node scripts/village-worker.js` (persistent, `setsid`+
  `disown` so it survives the shell). Env: `AIWORLD_POLICY=ollama OLLAMA_MODEL=civs-brain
  OLLAMA_ENDPOINT=http://127.0.0.1:11434 MC_HOST=192.168.152.149 RCON_HOST=192.168.152.149
  RCON_PORT=25575 RCON_PASSWORD=civsqa AIWORLD_NO_EQUIP=1 ENABLE_VIEWER_FOLLOW=0 AIWORLD_SELFTRAIN=1`.
- Steve text chat: tmux `steve-chat` → `node scripts/steve-chat.js`. Reads `/tmp/steve-chat.txt`
  (`Steve: <msg>` lines) and replies in-game via `say Steve: <reply>`; also proactively narrates
  brain decisions + self-train events. OLLAMA_CHAT_MODEL=hermes-agent-mc.
- **LIVE PROOF of clean bring-up:** `ollama_decision=3`, `work_tick` climbing, `call_failed=0`,
  real reasoned focus e.g. *"settlement is established and I am safe; I have learned to prioritize
  building over other tasks in this state; blockBelow is AIR, not a threat"*. steve-chat RCON connected.

## What is DONE + verified (brain agent, this session + prior)
| Capability | Evidence | Status |
|---|---|---|
| Brain decides live with world context via civs-brain | WSL snapshot → `focus=survive`; live ollama_decision on QA | ✅ |
| Brain does NOT latch OFF after one Ollama blip | `isAvailable()` cooldown 30s + re-enable on success; ad-hoc PASS (WSL) | ✅ |
| Ollama timeout 8s→60s (slow first inference no longer fails) | code + live call_failed=0 | ✅ |
| World memory absorbs deaths/damage/light/block | ad-hoc 5/5 `world-memory.js` | ✅ |
| Anti-oscillation cognition | `decision.js` breaks A↔B via `invalidatePlan` + alt goal | ✅ |
| Anti phantom-flee (LLM invented mob) | `sanitizeFocus` overrides survive when no real hostile | ✅ |
| No gear storm (constant re-equip) | `AIWORLD_NO_EQUIP=1` default on in launcher | ✅ |
| Worker survives camera failure (headless) | camera setup fully timeout-wrapped; headlessObservation stub | ✅ |
| Worker survives ONE hanging job | `runJob` 25s Promise.race timeout | ✅ |
| Worker survives shell exit | `setsid`+`disown` launch | ✅ |
| Self-train learns weights live | enabled by default; self-train event logged | ✅ |
| Steve text chat (PT) + proactive narration | steve-chat tmux alive, RCON connected | ✅ |
| Learning loop CLOSED | decision→reward→experience→dataset→brain bias | ✅ |
| Suite green | `npm run test:nightshift-unit` → 131/131 | ✅ |

## Honest limitations (NOT claimed fixed)
- QA harness runs god-mode + peaceful (mobs cleared) so combat/survive path is lightly exercised;
  prod (real mobs) is the real test of the survival/defend branch.
- Construction jobs (builder/farmer/beautify) route through the BODY agent's `construction.runProject`
  (own latency); the 25s runJob timeout guarantees it can't stall the loop but the module itself is
  the body agent's domain.
- Harness-unsupported verbs (eat/heal/consume/craft/smelt/fish/breed/trade) remain prod-only on QA —
  not exercised here (CivsTestHarness.jar has no such API; confirmed earlier).
- Work cadence ~1 job/30s (FOCUS_TTL=45s + LLM latency) — functional, not frenetic.
- Camera (spectator Cam) intentionally NOT started (user decree) → observation is headless no-op;
  the work loop runs fine without it.

## How to verify live (Viewer = Smokeshow joins the game)
1. Join MC `192.168.152.149:25565` as **Smokeshow** (no whitelist/op needed).
2. Watch Steve: should pick foci (build/gather/mine) with `ollama_decision` reasons in the log and
   perform jobs (walk/breakBlock/place) — not loop or idle.
3. Talk to Steve: write `Steve: <your question>` to `/tmp/steve-chat.txt` on the QA host (or via the
   Hermes chat relay) → Steve replies in-game `say Steve: ...`. He also volunteers what he's doing.
4. Evidence commands (on QA host): `grep ollama_decision /home/dansilva/aiworld-civs-live.log`,
   `grep work_tick /home/dansilva/aiworld-civs-live.log`, `cat /home/dansilva/steve-chat-live.log`.

## Known blockers (unchanged)
- LoRA real training blocked (`ollama create civs-brain-lora` fails on gemma4). Dataset ready.
- Push: none yet (coordination rule — neither agent pushes without explicit user go-ahead).
