# Test coverage expansion

A QA pass focused on **meaningful behavioral coverage**, not line-count for its own sake.
It adds regression tests for previously untested execution paths and establishes
data-driven patterns future contributors can extend.

## Summary

| Metric | Before | After |
| --- | --- | --- |
| Tests (full `mvn test`) | 605 | **764** (+159) |
| Instruction coverage (JaCoCo) | 33.9% | 34.7% |
| `stats` package coverage | 0–53% | **100%** |
| `Util` coverage | 54% | 57% |

The instruction-coverage delta is intentionally modest: the highest-value additions
(the 44-command contract suite, edge-case and serialization tests) assert **correctness
and contracts** rather than executing large bodies of code, and the biggest remaining
untested classes are Bukkit event listeners that cannot be unit-tested without a live
server (see *Architectural blockers*). Per the brief, the goal was behavior, not a
coverage percentage.

### How coverage was measured
JaCoCo is not wired into `pom.xml` (kept the build unchanged). It was run ad-hoc by
temporarily prepending `-javaagent:org.jacoco.agent…` to the surefire `argLine`, then
reverting `pom.xml`. JaCoCo 0.8.13 instruments the Java 25 classes fine. To reproduce:
temporarily add the agent to the surefire `<argLine>`, `mvn test`, then
`mvn org.jacoco:jacoco-maven-plugin:0.8.13:report`.

## Newly tested components

| Priority | Component | Why important | Tested? |
| --- | --- | --- | --- |
| 1/2 Regions | `Region` ownership/roles, people passthrough, id round-trip, tick cooldown | Core region behavior beyond "it loads" | ✅ `RegionBehaviorTest` |
| 4 Commands | **All 44** `@CivsCommand` classes (contract) | A bad new command NPEs/collides at load | ✅ `CommandRegistryTest` (data-driven) |
| 5/econ | `stats` modifiers (ADD/MULTIPLY totals, RPG perk stats) | Damage/discount/siege math; economy-adjacent | ✅ `StatsTest` (100%) |
| 6 Serialization | `RegionManager` save/load round-trip, missing-field, corrupt YAML, invalid location | Data loss / crash-on-load risk | ✅ `RegionSerializationTest` |
| — Utilities | `Util` file-name, number-format, location-equivalence, solid-block edges | Widely-used helpers with tricky edges | ✅ `UtilBehaviorTest` |
| 4 UI | Region GUI title (from the prior pass) | Player-facing correctness | ✅ `RegionTypeMenuTitleTest` |
| — Structures | All 174 region-type definitions load valid on Paper 26.1.2 (prior pass) | Migration regression net | ✅ `ServerPackRegionTypesTest` |

### Test design (avoiding duplication)
- **Data-driven / parameterized** for large families: `CommandRegistryTest` (all commands),
  `ServerPackRegionTypesTest` (all 174 structures). One case per member; no copy-paste.
- **Reflection seams** for private persistence (`saveRegionToFile`/`loadRegion`) so the
  real serialization code is exercised without duplicating its format in the test.
- **Pure-logic isolation**: `stats` tests need no Bukkit harness; they run in milliseconds.
- New tests only assert **new** behaviors; existing `UtilTests` cases were checked first to
  avoid re-testing the same paths.

## Prioritized component status (ranked)

| Priority | Component | Why important | Tested? |
| --- | --- | --- | --- |
| P1 | `stats` package | Territorial stat math (combat/economy) | ✅ 100% |
| P1 | Command load contract (44) | Plugin fails to load a broken command | ✅ contract-tested |
| P1 | Region serialization | Save/load = player data integrity | ✅ round-trip + edges |
| P2 | `Region` ownership/cooldown/id | Permissions, ticking, identity | ✅ core paths |
| P2 | `Util` helpers | Cross-cutting correctness | ⚠️ 57% (key edges done) |
| P3 | Region **effects** (Conveyor, TNTCannon, AntiCamp, Siege, ArrowTurret, RaidPort, Hunt) | Structure runtime behavior | ❌ event-driven; see blockers |
| P3 | Event **listeners** (AllowedActions, Civilian, Death, Protection) | Core gameplay rules | ❌ event-driven; see blockers |
| P3 | Command **behavior** (runCommand bodies) | Business logic per command | ⚠️ contract only; bodies need heavy mocks |
| P4 | GUIs (`MemberActionMenu`, `RegionTypeListMenu`, …) | Player interaction | ❌ heavy inventory/menu mocking |
| P4 | External hooks (`Pl3xMapHook`, `DynmapHook`) | Optional integrations | ❌ require third-party plugins |
| P5 | Spell **particle** effects (`Spider`, `FairyWings`, …) | Cosmetic only | ❌ low behavioral value |

## Remaining untested areas (largest first)

Biggest 0-coverage classes and why they resist unit testing:

- `civilians/AllowedActionsListener` (1982 instr), `CivilianListener` (1885) — very large
  `@EventHandler` bodies reacting to block/interact/inventory events with world state.
- Region effects: `RaidPortEffect` (1373), `ConveyorEffect` (1067), `TNTCannon` (880),
  `AntiCampEffect` (730), `SiegeEffect` (712), `ArrowTurret` (648), `HuntEffect` (544) —
  behavior only manifests through fired Bukkit events acting on live blocks/entities/scheduler.
- `tutorials/AnnouncementUtil` (1008), `regions/placement/BlueprintGenerator` (1003),
  `towns/RingBuilder` (622), `regions/StructureUtil` (11%) — world-geometry/building.
- `menus/people/MemberActionMenu` (943), `menus/regions/RegionTypeListMenu` (613) — GUI build.
- `mobs/CustomMobManager` (732), hooks (`Pl3xMapHook`), particle effects — runtime/external.

## Architectural blockers

1. **Listeners/effects are `Listener`s coupled to the Bukkit runtime.** Their behavior is
   only reachable by firing real events against live world/entity/scheduler state. Unit
   testing them means either MockBukkit or extensive hand-mocking that ends up asserting
   implementation details. `pom.xml` already notes MockBukkit for 26.1.x is not yet
   published, so the manual mock harness (`TestUtil`) is the only option and it does not
   model event dispatch. **Recommendation:** cover these via an integration harness on a
   real Paper server (the QA server from the previous pass) rather than unit tests.
2. **Command bodies (`runCommand`) mix parsing + manager mutation + messaging.** Testable,
   but each needs a `CommandSender`/`Player`, `Civilian`, `Town`/`Region`, and often
   `Civs.econ`. The existing command tests show the pattern; expanding it is worthwhile but
   high-effort per command. Contract testing (done) is the cheap, high-value first layer.
3. **Static singletons carry state across tests.** New data-driven tests that load real
   config into `ItemManager` must restore it (`@AfterClass reload()`, as
   `ServerPackRegionTypesTest` does) to avoid polluting later tests.
4. **JUnit is pinned to 4.12** — no `assertThrows`; use `@Test(expected=…)` or a small
   try/catch helper (see `StatsTest`).

## Suggested future tests (ranked)

1. **Effect behavior via integration tests** on the QA Paper server: place a structure,
   fire the relevant event (or wait a tick), assert the effect (e.g. Conveyor moves items,
   AntiCamp blocks placement, ForSale transfers ownership on buy).
2. **Command behavior**, one focused test per logic-heavy command
   (`BountyCommand`, `PowerCommand`, `DepositBankCommand`/`WithdrawBankCommand`,
   `AddMemberCommand`/`RemoveMemberCommand`, `RenameCommand`) covering valid/invalid args,
   permissions, and console-vs-player senders.
3. **Economy edge cases** (`AuctionManager`, region/town buy): Vault absent, insufficient
   balance, negative amounts, refunds, failed transactions.
4. **Town serialization** round-trip mirroring `RegionSerializationTest`.
5. **GUI contract family test** over all `@CivsMenu` (like `CommandRegistryTest`): each
   menu instantiates, has a routable name, and builds an inventory without throwing.
6. **Scheduler** lifecycle (`CommonScheduler`): startup/shutdown/reload, player logout,
   world unload — likely needs light scheduler mocking.

## Coverage observations

- Pure-logic packages (`stats`) reached 100% cheaply and are the best ROI.
- The command family test is high value per line: 44 classes, real load-time failure modes,
  ~1 maintainable file.
- The dominant untested mass is event-listener/effect code — a genuine architectural
  testability limit, best addressed with integration tests, not more unit mocks.
- No production behavior was changed in this pass; only tests and this document were added.
