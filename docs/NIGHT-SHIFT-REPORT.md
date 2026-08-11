# Night shift report — 2026-08-11 (continued unattended → dawn)

Unattended dual mandate: **NPCs work** on WSL Paper QA + **engineering PRs**.  
Labels: **FACT** · **OBSERVED** · **BLOCKED** · **INFERRED**.

## NIGHT SHIFT SUMMARY (continuation #3)

### NPC activity (live)

| Check | Result | Label |
|-------|--------|-------|
| Paper `civs-qa` tmux | UP | **FACT** |
| `village-npc` tmux | Running `village-worker.js` (recover after approach deploy) | **FACT** |
| Players | Steve, Alex, Cam (+ Viewer when watching) | **OBSERVED** |
| Town `NpcPad` | exists | **FACT** |
| Pad origin | 5200,80,5200 | **FACT** |
| Work ticks | ~1100+ continuous PASS; lumberjack/guard live | **FACT** |
| Director | `director_start` PASS; job→camera mode map (#61) | **FACT** |
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
| [#62](https://github.com/Daniel730/Civs/issues/62) | [#63](https://github.com/Daniel730/Civs/pull/63) | Approach aprons + footing clear + recover teleport | **GREEN** (prior run; docs push recheck) |
| [#60](https://github.com/Daniel730/Civs/issues/60) | [#61](https://github.com/Daniel730/Civs/pull/61) | Job-site affinity + lumberjack/guard + camera modes | **GREEN** |
| [#37](https://github.com/Daniel730/Civs/issues/37) | [#58](https://github.com/Daniel730/Civs/pull/58) | Stryker | **GREEN** |
| [#51](https://github.com/Daniel730/Civs/issues/51) | [#52](https://github.com/Daniel730/Civs/pull/52) | Stream nightshift | **GREEN** |
| [#44](https://github.com/Daniel730/Civs/issues/44) | [#56](https://github.com/Daniel730/Civs/pull/56) | GitHub templates | **GREEN** |
| [#36](https://github.com/Daniel730/Civs/issues/36) | [#55](https://github.com/Daniel730/Civs/pull/55) | Arch-contract | **GREEN** |
| [#43](https://github.com/Daniel730/Civs/issues/43) | [#57](https://github.com/Daniel730/Civs/pull/57) | Java Checkstyle/ArchUnit | **GREEN** |
| [#34](https://github.com/Daniel730/Civs/issues/34) | [#59](https://github.com/Daniel730/Civs/pull/59) | Datadog APM choice | **GREEN** |

Village stack: #50 → #54 → #61 → #62 (approach). Hygiene PRs #52/#55–#59 all **GREEN** (no CI red left).

### Move reliability evidence

Before apron fix (**FACT** tally of jsonl): ~346 `move_to` fails / ~1099 ticks — farmer `no_progress` 147, patrol `stuck` 88. Root cause: farmer stand at `oz-2` inside potato_farm footprint (radius 4).

After recover-npc with #63 (**FACT** ticks ≥1148): 40 work ticks all **PASS**, **0** move fails, `recoverTeleport` unused (apron walks finished).

### Worker diversity (live evidence)

- `farmer` → `farm` / farm_pad (**FACT**)
- `miner` → `quarry` (**FACT**)
- `lumberjack` → oak_log break + oak_planks place (**FACT**)
- `guard` → barracks_pad (**FACT**)
- State preserved: barracks + potato_farm completed; inn blocked (**FACT**)

### Tests

- Village jobs unit **12/12** (#62 apron + prior affinity) (**FACT**)
- Stream planner **7/7** (**FACT**)
- Open hygiene/stream/village PRs CI **GREEN** (**FACT**)

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

- Active approach branch: `feat/worker-approach-reliability-62` (stacks on `feat/worker-job-affinity-60` / #61)
- Live worker runs workspace files via WSL mount (recover-npc after deploy)
- Production `Civs_servidor` live world: **not touched** (**FACT**)

### Next for parent / later shifts

1. Merge stack: #50 → #54 → #61 → approach PR, plus #55/#56/#57/#58/#52/#59 when ready  
2. #38/#33 only after secrets  
3. Re-tally move fails in jsonl after approach deploy (expect farmer `no_progress` drop)  
4. #31/#45 Issues→PR docs once master protection allows merge
