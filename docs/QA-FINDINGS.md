# Civs QA findings & backlog (Paper 26.1.2)

Living map of bugs and enhancement opportunities discovered by a code + runtime
(real Minecraft client + server-log) QA pass on the reconciled `master`. Items are
verified against source before being marked for a fix batch. Work is done TDD-style:
write a failing test, then fix, then verify in-game.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done (PR linked)

## Batch 1 — correctness fixes (unit-tested)

- [x] **CVItem.clone() corrupts drop chance** — fixed in PR #18 (`fca8332e`); clone
  preserves 0–1 fraction + `ownerBound`. Test: `ItemsTests`.
- [x] **Region center-block scan uses X radius for the Z axis** — fixed in PR #18.
  Test: `RegionsTests` / `FarmRequirementTests`.
- [x] **DailyScheduler.doVotes() NPE on invalid government** — fixed in PR #20.
- [x] **Hardship depreciation divide-by-(near-)zero** — fixed in PR #20.

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

## Batch 9 — Unified composed HUD

- [x] **`mana-hud: composed`** — Civs yields ActionBar/BossBar to RPGServer
  composer; adds `%civs_max_mana%` / `%civs_mana_pair%` for PAPI merges.

## Batch 10 — Combat hotbar, hearts pack, mob spawn offset

- [x] **Scroll-cast fights tool wheel** — `AllowedActionsListener` cancelled
  hotbar change and cast on scroll. Fix: cast only on right-click
  (`SpellListener`); combat mode `/cv spells` still toggles temporary hotbar
  with clear enter/exit restore.
- [x] **`guild_thief` (and all custom mobs) spawn on player** —
  `CustomMobManager.findSafeSpawn` only nudged Y. Fix: horizontal ring 3–7
  blocks + ground snap.

## Batch 11 — Hearts-slot HP/mana (RPG pack) — REVERTED

- [x] **Hearts-slot UX rejected** — bitmap bars + hide-hearts pack looked terrible
  in-game. Reverted to vanilla hearts + Civs `mana-hud: bossbar` + quest BossBar.
  RPG composed HUD / hide-hearts pack default OFF. Readable > clever.

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
