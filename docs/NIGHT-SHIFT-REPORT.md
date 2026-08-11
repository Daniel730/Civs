# Night shift report — 2026-08-11 (continued unattended → dawn)

Unattended dual mandate: **NPCs work** on WSL Paper QA + **engineering PRs**.  
Labels: **FACT** · **OBSERVED** · **BLOCKED** · **INFERRED**.

## NIGHT SHIFT SUMMARY (continuation #2)

### NPC activity (live)

| Check | Result | Label |
|-------|--------|-------|
| Paper `civs-qa` tmux | UP | **FACT** |
| `village-npc` tmux | Running `village-worker.js` (recovered after affinity deploy) | **FACT** |
| Players | Steve, Alex, Cam (+ Viewer when watching) | **OBSERVED** |
| Town `NpcPad` | exists | **FACT** |
| Pad origin | 5200,80,5200 | **FACT** |
| Work ticks | ~1000+ continuous PASS; lumberjack/guard live | **FACT** |
| Director | `director_start` PASS; job→camera mode map shipped (#61) | **FACT** |
| Watch | `launch-viewer.ps1` → WSL IP `192.168.152.149:25565` (not 127.0.0.1) | **FACT** |

Evidence: `integration-tests/runner/reports/village-worker.jsonl` + `village-worker-state.json`.

### Soft goals / village structures

| Structure | Status | Notes |
|-----------|--------|-------|
| council_room / shelter / hovel / cobble_quarry / smithy | Present | **OBSERVED** |
| shack | **PASS** placeregion | **FACT** |
| potato_farm | **PASS** `@ 5200,80,5186` | **FACT** |
| barracks | **PASS** `@ 5214,80,5190` | **FACT** |
| inn | **BLOCKED** | exclusive vs barracks — barracks kept | **FACT** |
| Hamlet upgrade | **BLOCKED** | Needs evolve path — not forced |

### Engineering shipped this continuation

| Issue | PR | Title | CI |
|-------|-----|-------|-----|
| [#60](https://github.com/Daniel730/Civs/issues/60) | [#61](https://github.com/Daniel730/Civs/pull/61) | Job-site affinity + lumberjack/guard + camera modes | opened (stacks on #54) |
| [#37](https://github.com/Daniel730/Civs/issues/37) | [#58](https://github.com/Daniel730/Civs/pull/58) | Stryker knip false-positive fix | **GREEN** |
| [#51](https://github.com/Daniel730/Civs/issues/51) | [#52](https://github.com/Daniel730/Civs/pull/52) | Biome format + knip stream entries | pushed fix |
| [#44](https://github.com/Daniel730/Civs/issues/44) | [#56](https://github.com/Daniel730/Civs/pull/56) | PR title lowercase hygiene | retitled + empty commit |

Prior stack still open: #50→#54 village; #55 arch; #57 java static; #59 datadog; #45 docs (master protection).

### Worker diversity (live evidence)

- `farmer` → `farm` / farm_pad (**FACT** tick ~1011)
- `miner` → `quarry` (**FACT** tick ~1010)
- `lumberjack` → oak_log break + oak_planks place (**FACT** tick ~1013)
- `guard` → barracks_pad (**FACT** tick ~1014)
- State preserved: barracks + potato_farm completed; inn blocked (**FACT**)

### Tests

- Village jobs unit **11/11** (#61) (**FACT**)
- Stream planner **7/7** after #52 format fix (**FACT**)
- #58 Biome+knip + stryker-mutation **GREEN** (**FACT**)

### Blocked (do not spin)

| Item | Cause | Min action |
|------|-------|------------|
| #38 Codecov | Needs `CODECOV_TOKEN` | User secret |
| #33 Sentry | Needs DSN | User secret |
| Public YouTube | Out of scope | Local OBS only (#52) |
| inn + barracks together | Civs exclusive effect | Pick one (barracks won) |
| #45 → master | Branch protection | Maintainer merge rights |

### How to watch / recover

```powershell
powershell -ExecutionPolicy Bypass -File integration-tests/runner/scripts/launch-viewer.ps1
```

```bash
bash integration-tests/runner/scripts/recover-npc.sh   # LF-only; *.sh eol=lf in .gitattributes
tmux attach -t village-npc
tail -f integration-tests/runner/reports/village-worker.jsonl
```

### Repo state

- Active affinity branch: `feat/worker-job-affinity-60` → PR **#61** (base `#54`)
- Live worker runs workspace files via WSL mount (affinity loaded after recover-npc)
- Production `Civs_servidor` live world: **not touched** (**FACT**)

### Next for parent / later shifts

1. Merge stack: #50 → #54 → #61, plus #55/#56/#57/#58/#52/#59 when green  
2. #38/#33 only after secrets  
3. Optional: tighten move_to near farm/barracks (occasional `no_progress`/`stuck`, still PASS place/break)  
4. #31/#45 Issues→PR docs once master protection allows merge
