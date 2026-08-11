# Night shift report — 2026-08-11 (late)

Unattended dual mandate: **NPCs work** on WSL Paper QA + **engineering PRs**.  
Labels: **FACT** · **OBSERVED** · **BLOCKED** · **INFERRED**.

## NIGHT SHIFT SUMMARY

### NPC activity (live)

| Check | Result | Label |
|-------|--------|-------|
| Paper `civs-qa` tmux | UP | **FACT** |
| `village-npc` tmux | Running `village-worker.js` | **FACT** |
| Players | Viewer, Steve, Alex, Cam | **OBSERVED** |
| Town `NpcPad` | exists (recovered after mid-shift wipe) | **FACT** |
| Pad origin | 5200,80,5200 | **FACT** |
| Work ticks (JSONL) | 119 ticks; **116 PASS** / 3 BLOCKED | **FACT** |
| Job mix | builder/miner/farmer/stockpile/patrol ×23; placeregion ×4 | **FACT** |
| Capabilities exercised | `move_to`, `look_at`, `break_block`, `place_block` (BlockPlaceEvent), `swing`, `jump` | **FACT** |
| Helper actor | Alex (`ENABLE_HELPER=1`) | **FACT** |
| Watch | `launch-viewer.ps1` → WSL IP `192.168.152.149:25565` (not 127.0.0.1) | **FACT** |

Evidence: `integration-tests/runner/reports/village-worker.jsonl`.

### Soft goals / village structures

| Structure | Status | Notes |
|-----------|--------|-------|
| council_room / shelter / hovel / cobble_quarry / smithy | Present from #49/#50 | **OBSERVED** |
| shack | Briefly placed @5210 then later `region=none` | **OBSERVED** — overnight dig/place can disturb pads; worker now uses dig pits + work aprons |
| inn / barracks / potato_farm | **BLOCKED** | placeregion FAIL on build-reqs (honest stockpile retries logged) |
| Hamlet upgrade | **BLOCKED** | Needs build-reqs / evolve path — not forced |

### Engineering shipped this shift

| Issue | PR | Title |
|-------|-----|-------|
| [#53](https://github.com/Daniel730/Civs/issues/53) | [#54](https://github.com/Daniel730/Civs/pull/54) | Overnight NPC village worker (real capabilities) |
| [#36](https://github.com/Daniel730/Civs/issues/36) | [#55](https://github.com/Daniel730/Civs/pull/55) | dependency-cruiser arch-contract |
| [#44](https://github.com/Daniel730/Civs/issues/44) | [#56](https://github.com/Daniel730/Civs/pull/56) | GitHub issue/PR templates (área/prioridade) |

Pre-existing open: [#50](https://github.com/Daniel730/Civs/pull/50) village builder, [#52](https://github.com/Daniel730/Civs/pull/52) stream prep, [#45](https://github.com/Daniel730/Civs/pull/45) docs→master.

### Tests

- `npm run test:village-unit` — **5/5 PASS** (**FACT**)
- `npm run arch` — **0 violations** (14 modules) (**FACT**)
- Biome on WSL: **BLOCKED** locally (missing `@biomejs/cli-linux-x64` in this node_modules install) — CI on Ubuntu still authoritative

### Blocked (do not spin)

| Item | Cause | Min action |
|------|-------|------------|
| #38 Codecov | No `CODECOV_TOKEN` visible in repo secrets listing | Add secret → wire JaCoCo/c8 upload |
| #33 Sentry | Needs DSN after OTel stack merge | Wait secrets + #32 lineage |
| Public YouTube | Explicitly out of scope | Keep local OBS only (#51/#52) |
| inn/barracks/potato_farm | build-reqs / overlap | Improve stockpile profiles or hamlet evolve |

### How to watch / monitor

```powershell
powershell -ExecutionPolicy Bypass -File integration-tests/runner/scripts/launch-viewer.ps1
```

```bash
tmux attach -t village-npc
tail -f integration-tests/runner/reports/village-worker.jsonl
```

Docs: `docs/NPC-NIGHT-SHIFT.md`.

### Repo state

- Active overnight NPC branch: `feat/npc-village-worker-53` → PR **#54**
- Paper + worker left running in WSL tmux
- Production `Civs_servidor` live world: **not touched** (**FACT**)

### Next

1. Merge stack hygiene: #50 → #54 (NPC), #55 (arch), #56 (templates); stream #52 when ready  
2. #38 Codecov once token exists  
3. Safer placeregion stockpile profiles + optional hamlet evolve experiment on disposable QA only  
