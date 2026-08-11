# Night shift report — 2026-08-11 (continued unattended)

Unattended dual mandate: **NPCs work** on WSL Paper QA + **engineering PRs**.  
Labels: **FACT** · **OBSERVED** · **BLOCKED** · **INFERRED**.

## NIGHT SHIFT SUMMARY (continuation)

### NPC activity (live)

| Check | Result | Label |
|-------|--------|-------|
| Paper `civs-qa` tmux | UP | **FACT** |
| `village-npc` tmux | Running `village-worker.js` (recovered) | **FACT** |
| Players | Steve, Alex, Cam (+ Viewer when watching) | **OBSERVED** |
| Town `NpcPad` | exists | **FACT** |
| Pad origin | 5200,80,5200 | **FACT** |
| Work ticks | ~827+; continuous PASS work_tick | **FACT** |
| Director | `director_start` PASS (FallbackDirector / ShotPlanner) | **FACT** |
| Watch | `launch-viewer.ps1` → WSL IP `192.168.152.149:25565` (not 127.0.0.1) | **FACT** |

Evidence: `integration-tests/runner/reports/village-worker.jsonl` + `village-worker-state.json`.

### Soft goals / village structures

| Structure | Status | Notes |
|-----------|--------|-------|
| council_room / shelter / hovel / cobble_quarry / smithy | Present | **OBSERVED** |
| shack | **PASS** placeregion | **FACT** |
| potato_farm | **PASS** `@ 5200,80,5186` after stockpile v2 | **FACT** |
| barracks | **PASS** `@ 5214,80,5190` | **FACT** |
| inn | **BLOCKED** | Failed build-reqs ×3, then exclusive vs barracks (**FACT** Civs `exclusive:barracks`) |
| Hamlet upgrade | **BLOCKED** | Needs evolve path — not forced |

### Engineering shipped this continuation

| Issue | PR | Title | CI |
|-------|-----|-------|-----|
| [#53](https://github.com/Daniel730/Civs/issues/53) | [#54](https://github.com/Daniel730/Civs/pull/54) | Overnight NPC village worker (+ stockpile/director follow-ups) | **GREEN** |
| [#49](https://github.com/Daniel730/Civs/issues/49) | [#50](https://github.com/Daniel730/Civs/pull/50) | Village builder + Cam (biome + title hygiene) | **GREEN** |
| [#36](https://github.com/Daniel730/Civs/issues/36) | [#55](https://github.com/Daniel730/Civs/pull/55) | dependency-cruiser arch-contract | open |
| [#44](https://github.com/Daniel730/Civs/issues/44) | [#56](https://github.com/Daniel730/Civs/pull/56) | GitHub templates | open |
| [#43](https://github.com/Daniel730/Civs/issues/43) | [#57](https://github.com/Daniel730/Civs/pull/57) | Java Checkstyle + ArchUnit phase-1 | **GREEN** checks |

Also: PR titles normalized to commitlint `subject-case` (lowercase).

### Tests

- Runner: village unit **8/8**, stream planner tests, knip clean, biome clean on touched files (**FACT**)
- Java (#57): `checkstyle:check` PASS; ArchUnit **2/2**; full `mvn test` **766** run / 6 skipped (**FACT**)

### Blocked (do not spin)

| Item | Cause | Min action |
|------|-------|------------|
| #38 Codecov | Needs `CODECOV_TOKEN` | User secret |
| #33 Sentry | Needs DSN | User secret |
| Public YouTube | Out of scope | Local OBS only (#52) |
| inn + barracks together | Civs exclusive effect | Pick one (barracks won) |

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

- Active overnight NPC branch: `feat/npc-village-worker-53` → PR **#54**
- Paper + worker left running in WSL tmux
- Production `Civs_servidor` live world: **not touched** (**FACT**)

### Next for parent / later shifts

1. Merge stack: #50 → #54, plus #55/#56/#57 when ready  
2. #37 Stryker (unblocked, no secrets)  
3. #38/#33 only after secrets  
4. Optional: prefer inn over barracks on a fresh pad if desired (exclusive)
