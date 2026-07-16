# Civs QA findings & backlog (Paper 26.1.2)

Living map of bugs and enhancement opportunities discovered by a code + runtime
(real Minecraft client + server-log) QA pass on the reconciled `master`. Items are
verified against source before being marked for a fix batch. Work is done TDD-style:
write a failing test, then fix, then verify in-game.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done (PR linked)

## Batch 1 — correctness fixes (unit-tested)

- [~] **CVItem.clone() corrupts drop chance** — `items/CVItem.java` `clone()` passes
  `(int) chance` into a constructor that divides by 100 again, so `chance` (stored as
  a 0–1 fraction) collapses (50% → 0%, 100% → 1%). Also drops `ownerBound`. Impacts
  weighted upkeep payouts/loot and any cloned `RegionType` reqs. Fix: preserve the
  fraction and copy `ownerBound`. Test: `ItemsTests`.
- [~] **Region center-block scan uses X radius for the Z axis** —
  `regions/Region.java` `hasRequiredBlocksOnCenter()` computes `zMax/zMin` from
  `getBuildRadiusX()` instead of `getBuildRadiusZ()`. Non-cubic region footprints
  validate the wrong volume. Fix: use `getBuildRadiusZ()`. Test: `RegionsTests`.
- [~] **DailyScheduler.doVotes() NPE on invalid government** —
  `scheduler/DailyScheduler.java` calls `government.getGovernmentType()` with no null
  guard (unlike `addDailyPower`). A town with pending votes + a bad `gov-type` aborts
  the whole daily tick. Fix: null-guard. Test: `SchedulerTests`/`RegionsTests`.
- [~] **Hardship depreciation divide-by-(near-)zero** —
  `scheduler/DailyScheduler.java` `depreciateHardship()` divides `town.getPrice()` by
  `getRawPeople().size()` with no empty guard → NaN hardship for an empty town. Fix:
  guard size > 0. Test: `SchedulerTests`.

## Batch 5 — silent playability (shop / farms / evolve)

- [x] **Buy emerald gated on Vault Permission** — `RegionTypeMenu` / `TownTypeMenu` /
  `MainMenu` used `Civs.perm != null && Civs.perm.has(...)`. With no Vault Permission
  provider (or defaults not wired through Vault), the shop emerald was AIR even when
  `plugin.yml` says `civs.shop` default:true. Fix: `PermissionUtil.hasShopAccess` via
  `Player.hasPermission`. Tests: `RegionTypeShopBuyTests`.
- [x] **Farm upkeep stuck after failed tick** — `Region.runUpkeep` only loaded the input
  chest when `hasRegionChestChanged`; after a failed reagents tick the region stayed
  "checked" and later cycles never re-read the chest (silent no-output until chest GUI
  open). Also exclusive chest scan + `TRAPPED_CHEST` ignored. Fix + tests:
  `FarmChestDepositTests`.
- [x] **Town evolve ally roster** — `TownManager` copied `getPeople()` (ally-injected)
  into the upgraded town. Fix: copy `getRawPeople()`; power check uses `intersectTown`.
  Test: `TownTests.getPeopleInjectsAlliesButRawPeopleDoesNot`.
- [x] **Missing barracks1 / bandit_camp translations** — live bot-server spammed SEVERE
  on every `/cv` that rendered those items (jar hybrid example + evolve-invisible). Fix:
  add en/pt_br keys; hide `bandit_camp` from shop; LocaleManager logs missing keys once
  at WARNING.

## Batch 2 — correctness (needs heavier test setup / event mocking)

- [x] **Region rebuild group-limit check inverted** — `RegionManager.isSameGroupRebuild`
  now treats same-group rebuild as exempt (was `!contains`). Tests:
  `RebuildGroupLimitTests`.
- [x] **Town evolve copies ally-expanded roster** — fixed in Batch 5.
- [ ] **Null-government / null-world NPEs** — several call sites read
  `government.getGovernmentType()` or `location.getWorld().getName()` without guards
  (`Region.runUpkeep` payout, `TownMenu`, `RegionMenu` location icon,
  `TownManager.canJoinAnotherTown` when `Civs.perm` null). Communism payout also
  divides by `getRawPeople().size()`.
- [ ] **CVItem owner-binding not persisted to item PDC** — `setOwnerBound` is never
  written in `createItemStack`, so break-and-return / anti-sharing lose binding.

## Batch 3 — config wiring (dead config flags)

- [x] **`use-classes-and-spells`** — wired in PR #19 (`ConfigManager` + menu gates).
- [ ] **`allow-changing-gov-type`** loaded but never honored in gov menus.
- [ ] **`custom-mob-region-spawn-cooldown-seconds`**, **`turret-fire-particles`**
  loaded from defaults only / never read.

## Batch 4 — small enhancements (high value)

- [ ] **`/cv leave`** self-service leave-town command (+ tab-complete).
- [ ] **Bank command feedback** — deposit/withdraw silently `return true` on unknown town.
- [x] **Tutorial permission rewards** — `TutorialManager.applyRewardsToStep` now calls
  `setPermissions` (was wrongly `setCommands`). Test: `TutorialRewardParseTests`.
- [ ] **StatManager unit tests** — territorial stat ADD/MULTIPLY + friendly-territory
  gating currently have zero coverage.
- [ ] **README command reference** — many Sprint 2–4 commands undocumented.

## Batch 6 — RPG / civs-quests pack alignment

- [x] **Hub Magias/Combate menus in `Civs_servidor`** — copy `class.yml`,
  `class-list.yml`, `class-type-list.yml`, `spell-list.yml` into servidor menus so
  RPG hub opens do not rely only on jar hybrid fallback.
- [x] **Guide NPCs + custom mobs in `Civs_servidor`** — add `npc/guides.yml` and
  `mobs/*.yml` (wild_boar, bandit_*, guild_thief, stone_golem, sand_raider,
  frost_wraith) so live deploy pack matches quest hunt / guide interact flows.
- [x] **Guide NPC duplicate spawn on reload** — `GuideNpcManager.spawnAll()`
  stacked deferred tasks and did not sweep world-tagged orphans, so `/cv reload`
  (and world persistence across restarts) left multiple villagers per guide id.
  Fix: cancel pending spawn task; despawn by PDC tag across worlds before spawn.
  Test: `GuideNpcKeysTests`.

## Batch 7 — Cloud VM live QA (Smokeshow / Paper 26.1.2)

Smoke results (official offline client `Smokeshow`, TestEconomy, Civs_servidor pack):

| Check | Result |
|-------|--------|
| `/cv menu` main | PASS |
| `/rpg hub` + starter quest progress | PASS (objective "Abra a Central do Reino" completed) |
| Magias (`spell-list`) / Combate (`class-list`) | PASS via `/cv menu spell-list` / `class-list` |
| `/rpg journal` | PASS |
| `/rpg sync` | PASS |
| Guide NPCs spawn (4) | PASS after QA coords near spawn + dedupe fix |
| Guide right-click dialog | PARTIAL (entities present; cursor aim under llvmpipe flaky) |
| Economy hook | PASS (`Hooked into Economy plugin: TestEconomy`) |
| RPG 56 quests | PASS |

## Batch 8 — AuraSkills ActionBar coexistence + UX polish

- [x] **Mana HUD fights AuraSkills ActionBar** — `Civilian.setMana` refreshed
  ActionBar every regen tick (~1/s), overwriting AuraSkills idle HUD.
  Fix: `mana-hud: auto|actionbar|bossbar|when-needed|off` (default `auto` =
  BossBar when AuraSkills present). `ManaHud` + `ManaHudModeTests`.
- [x] **Farm/region silent stuck upkeep** — throttled chat tips via
  `RegionUpkeepNotifier` (`region-upkeep-missing` / `region-upkeep-output-full`).
- [x] **Spell/class UX copy** — clearer `/cv spells` + empty-slot + combat-bar
  lore; class-list tip; pt_BR `need-more-mana` includes `$2`.

## Notes / non-bugs (from client QA)
- Menus render correctly (localization clean); shop purchase works end-to-end with a
  Vault economy provider; no server-side exceptions from client interactions.
- `/cv money`, `/cv shop` are not commands (menu-driven) — "Invalid command" is correct.
- Main-menu language button shows an invisible icon under software OpenGL (llvmpipe);
  server-side the item is a valid named `BOOK` with no parse warnings — a client render
  artifact, not a plugin defect.
- Startup "Null world" region/town skips are expected when the `Civs_servidor` pack's
  saved data references a world absent on a fresh test world (handled gracefully).
- Production `guides.yml` coords (~2030,-2010) do not match a fresh flat spawn; for local
  QA relocate guides near world spawn (or teleport) before testing interact.
