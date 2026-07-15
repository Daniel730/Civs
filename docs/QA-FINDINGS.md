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

- [ ] **Region rebuild group-limit check inverted** — `regions/RegionManager.java`
  sets `rebuildWithinSameGroup = true` when the rebuild type does NOT contain the
  group (`!contains`). Rebuilding within the same group is wrongly blocked; different
  group bypasses the limit. Fix: drop the `!`. (Embedded in placement event handling.)
- [x] **Town evolve copies ally-expanded roster** — fixed in Batch 5.
- [ ] **Null-government / null-world NPEs** — several call sites read
  `government.getGovernmentType()` or `location.getWorld().getName()` without guards
  (`Region.runUpkeep` payout, `TownMenu`, `RegionMenu` location icon,
  `TownManager.canJoinAnotherTown` when `Civs.perm` null). Communism payout also
  divides by `getRawPeople().size()`.
- [ ] **CVItem owner-binding not persisted to item PDC** — `setOwnerBound` is never
  written in `createItemStack`, so break-and-return / anti-sharing lose binding.

## Batch 3 — config wiring (dead config flags)

- [ ] **`use-classes-and-spells`** never loaded from YAML → classes/spells UI is
  effectively always off. Wire in `ConfigManager.loadFile()` + add YAML key.
- [ ] **`allow-changing-gov-type`** loaded but never honored in gov menus.
- [ ] **`custom-mob-region-spawn-cooldown-seconds`**, **`turret-fire-particles`**
  loaded from defaults only / never read.

## Batch 4 — small enhancements (high value)

- [ ] **`/cv leave`** self-service leave-town command (+ tab-complete).
- [ ] **Bank command feedback** — deposit/withdraw silently `return true` on unknown town.
- [ ] **Tutorial permission rewards** — `TutorialManager` assigns `permissions` via
  `setCommands` (mis-wired); permission rewards never apply.
- [ ] **StatManager unit tests** — territorial stat ADD/MULTIPLY + friendly-territory
  gating currently have zero coverage.
- [ ] **README command reference** — many Sprint 2–4 commands undocumented.

## Notes / non-bugs (from client QA)
- Menus render correctly (localization clean); shop purchase works end-to-end with a
  Vault economy provider; no server-side exceptions from client interactions.
- `/cv money`, `/cv shop` are not commands (menu-driven) — "Invalid command" is correct.
- Main-menu language button shows an invisible icon under software OpenGL (llvmpipe);
  server-side the item is a valid named `BOOK` with no parse warnings — a client render
  artifact, not a plugin defect.
- Startup "Null world" region/town skips are expected when the `Civs_servidor` pack's
  saved data references a world absent on a fresh test world (handled gracefully).
