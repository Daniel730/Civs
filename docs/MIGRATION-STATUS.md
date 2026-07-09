# Civs Paper 26.1.2 — migration status

**Branch:** `paper-26.1.2-migration`  
**Target:** Paper 26.1.2, Java 25  
**Remote:** https://github.com/Daniel730/Civs  

## Current status

Core migration **compiles and tests pass** on Windows dev machine (386 tests, 6 skipped). Server pack in `Civs_servidor/` is the authoritative deploy set. Runtime fixes through Phase 3 are merged (Adventure API, async saves, housing recalc, GUI ordering, water/cauldron farms, safe-worldedit). Recent batches: placement mode menu, CVItem Adventure read/write helpers, instant-build housing-only server fix, auction menus synced to `Civs_servidor/`, Nashorn-free spell arithmetic fallback (Java 25), RPG CivsHook reload lifecycle listener, `/cv sell` feedback fixes (batch 17), guide NPC dialog system + tutorial/quest-mob event bridge for the RPG plugin, auction browse hardening (batch 18).

## Done

- [x] Phase 0: Java 25 + Maven + Paper 26.1.2 API
- [x] Phase 1: Source API updates, Adventure migration, test mocks
- [x] Phase 2: `Civs_servidor/` server pack + hybrid resource refresh
- [x] Phase 3: Async YAML, housing/villager recalc, invite validation, effects clone
- [x] Bug fixes: menu ordering, placeholder substitution, town center scans, port/town scope
- [x] Plot rename: `displayName` on Region, `/cv rename-plot`, region menu, en/pt_br
- [x] Placement mode menu + instant-build housing-only config fix
- [x] Auction house menus synced to `Civs_servidor/`; CVItem Adventure lore/display writes (auction menus)
- [x] Batch 14: skull menu meta via `CVItem.applySkullOwner`, plot rename map marker refresh (Dynmap/Pl3xMap), `AuctionSellMenu` tests
- [x] Batch 15: spell `getLevelAdjustedValue` arithmetic fallback (no Nashorn on Java 25), `TownManager.safeWorld` for unloaded-world lookups, `Government.getIcon` null guard, RPG `CivsIntegrationLifecycleListener` + `CivsHook.withCivs` hardening
- [x] Batch 17: `/cv sell` invalid-price and cancel-sale player feedback; `region-sale-cancelled` locale; hybrid `auction-purchase-feedback` config drift fix; `SellRegionCommandTest` + `ServerPackSyncTests` hybrid auction config guard
- [x] Batch 18: guide NPC dialog system (`GuideNpcManager`/`GuideNpcListener`, `npc/guides.yml`) firing `GuideNpcInteractEvent`; `TutorialChooseCompleteEvent` on path selection; quest-owner PDC on `spawnForQuest` custom mobs surfaced via `CustomMobKillEvent`; auction browse/my-listings page-param clamping and null/AIR listing-item skip; `RegionMenu`/`TownManager`/`Government`/`VillagerEffect` null/unloaded-world guards; bank command and `/cv recalc` player feedback
- [x] Cursor project brain: `.cursor/skills/`, `.cursor/rules/`, this doc

## Backlog

- [ ] ItemMeta → Adventure `Component` for remaining item display names and lore (skull menus migrated; TNTCannon wand uses CVItem helpers)
- [ ] Folia-compatible scheduling (if targeting Folia servers)
- [ ] MMOItems / MythicLib versions tested on Paper 26.1.2 (optional)

## Deploy checklist

1. Build: `mvn package` (or `mvn test` then package)
2. Copy `target/civs-1.11.6.jar` → server `plugins/`
3. Ensure **Vault** + economy installed
4. Sync **`Civs_servidor/`** contents into plugin data folder on Linux server (config, menus, item-types, translations)
5. `safe-worldedit: true` in config if using FAWE/WorldEdit
6. Restart server; run `/cv recalc` if housing counts look wrong after upgrade
7. Smoke test: place farm (water req), open blueprints/port/shop menus, town invite, plot rename

## Tests

```powershell
& "C:\Users\Danie\tools\apache-maven-3.9.10\bin\mvn.cmd" test
```

Expect ~386 tests (6 skipped). Mockito 5.23.0 required for Java 25.
