# Civs — WIP audit (2026-07-17)

Living map from branch/PR/issue scan **plus commit archaeology**. GitHub issues are recent; many unfinished threads only exist as commits/docs.

## Snapshot

| Item | State |
|------|--------|
| `origin/master` | `85110acc` (PRs #23/#24 merged); tag `v1.11.7` |
| Open PR | [#25](https://github.com/Daniel730/Civs/pull/25) `cursor/fix-gui-spells-farms` — **split**: keep farms/combat/mobs; simplify/abandon `mana-hud: composed` / hearts-slot coupling |
| Local dirty | `mana-hud: bossbar` already in working tree (hearts abandon); untracked `scripts/_*.sh|_*.py` live deploy/patch helpers |
| Stashes | `pre-deploy-stash`, `agent-commit-stash` — mostly Cursor rules/skills + servidor pack noise |
| Doc drift | `docs/MIGRATION-STATUS.md` still claims master merge blocked; reconciliation landed in `56a30d19` / PR #16 |

## Branch tips vs master

| Branch | Ahead | Actual content | Verdict |
|--------|-------|----------------|---------|
| `cursor/fix-gui-spells-farms` | 9 | Farms filter/upkeep, combat no-scroll-cast, mob offset, ManaHud modes, composed PAPI | **Finish** non-HUD; **simplify** composed/hearts |
| `cursor/qa-correctness-batch1-f094` | 3* | Squash-merged as #18 | **Delete** (squash leftover) |
| `cursor/enable-classes-spells-config-f094` | 2* | Squash-merged as #19 | **Delete** |
| `cursor/harden-invalid-government-f094` | 1* | Squash-merged as #20 | **Delete** |
| `cursor/fix-null-civ-item-reqs-f094` | 1* | Squash-merged as #22 | **Delete** |
| `cursor/manual-testing-notes-f094` | 1* | Squash-merged as #17 | **Delete** |
| `cursor/civs-rpg-integration-qa-b9d5` | 0 | Merged #24 | **Delete** |
| `cursor/fix-rebuild-tutorial-rpg-pack` | 0 | Merged #23 | **Delete** |
| `cursor/fix-shop-perm-and-farm-chests-f094` | 0 | On master | **Delete** |
| `paper-26.1.2-migration` | 0 | Merged via #16 | **Delete** (keep tag/history) |
| `paper-26.1.2-phase0-migration` | 1 | Orphan Phase 0 commit | **Delete** remote |
| `sprint-2/*`, `sprint-3/civs-features` | 0 | Merged | **Delete** local-only sprint-006/007/008 (0 ahead) |

\*Commit ancestry not on master (squash); file content is.

## Committed but unfinished (no issue)

| Commit(s) | Date | Summary | Recommend |
|-----------|------|---------|-----------|
| `ba7c92b8` StatManager; QA still asks for unit tests | 2026-07-03 | Feature shipped, **zero territorial-stat tests** | **Finish** tests (S) |
| `5f1bbe43` auction BIN; menus polished later | 2026-07-03 | Live; bank/`/cv leave` still open in QA | **Finish** leave + bank feedback (S–M) |
| `61e3b71a` SpellPreCastEvent | 2026-07-03 | Fires; RPG quest `cast_spell` may still note uncertainty in docs | Mark done in RPG QA docs |
| `4058eb3b` + `293d494b` guide NPCs | 2026-07-09/16 | System + dedupe done; interact QA partial under llvmpipe | **Reuse**; track live aim QA separately |
| `cd436716` placement/blueprint instant-build | 2026-07-09 | Merged; WorldEdit defer fixes followed | Done — ensure servidor pack synced |
| `fca8332e` QA map; Batch 1 `[~]` in `QA-FINDINGS.md` | 2026-07-14 | Fixes on master; **doc checkboxes stale** | **Fix docs** → `[x]` |
| Loaded-not-honored: `allow-changing-gov-type`, `turret-fire-particles`, `custom-mob-region-spawn-cooldown-seconds` | Sprint 2–3 era | ConfigManager fields, no menu/effect readers | **Wire or delete** (S each) |
| `ownerBound` clone fixed; **not written to item PDC** in `createItemStack` | QA Batch 2 | Anti-share still weak | **Finish** (M) |
| Archer/alchemist spell YAML `#TODO` stubs | hybrid classes | Listed spells missing | **Park** content pack |
| `AI.java` / `AIManager` TODO stubs | ancient | Unfinished town AI | **Abandon** unless product wants AI towns |
| `docs/MIGRATION-STATUS.md` merge-blocker section | 2026-07-09 | Superseded by PR #16 | **Rewrite** status (S) |
| Open PR commits `0485c4c3`/`dcda8a30` composed/hearts notes | 2026-07-16 | Couples to RPG hearts experiment | **Abandon/simplify** with parallel HUD revert; keep BossBar/`auto` modes |

## Production errors (commits fixed, issues lagged)

Stacks filed against `civs-1.11.6.jar` (Jul 5). On current master:

- TreeMap→HashMap cast → `Map` cast (`842b730b` line)
- null `regionType` / null `town` / `$uuid$` → guards + `MenuParams.resolveUuid`
- qty 0 ItemStack → `qty > 0 ? qty : 1`
- POTATOES block→item → `MenuUtil.toItemMaterial`

**Action:** deploy 1.11.7, close civs-quests server-error canonicals if quiet.

## Cleanup recommendations

```bash
# squash leftovers (safe after verifying #17–#22 on master)
for b in cursor/qa-correctness-batch1-f094 cursor/enable-classes-spells-config-f094 \
  cursor/harden-invalid-government-f094 cursor/fix-null-civ-item-reqs-f094 \
  cursor/manual-testing-notes-f094 cursor/civs-rpg-integration-qa-b9d5 \
  cursor/fix-rebuild-tutorial-rpg-pack cursor/fix-shop-perm-and-farm-chests-f094 \
  paper-26.1.2-migration paper-26.1.2-phase0-migration \
  sprint-2/civs-polish sprint-3/civs-features; do
  git push origin --delete "$b"   # recommend only
  git branch -D "$b" 2>/dev/null
done

# do not commit scripts/_patch_* / _deploy_* until reviewed; treat as local ops
```
