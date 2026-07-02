---
name: civs-paper-migration
description: >-
  Civs plugin migration to Paper 26.1.2 / Java 25. Use when editing Civs source,
  configs, tests, or deployment for the paper-26.1.2-migration branch.
---

# Civs Paper 26.1.2 Migration

## Target

| Item | Value |
|------|-------|
| Minecraft / Paper | **26.1.2** (`paper-api` pinned in `pom.xml`, e.g. `26.1.2.build.72-stable`) |
| Java | **25** |
| Branch | `paper-26.1.2-migration` |
| Remote | https://github.com/Daniel730/Civs |
| Plugin version | 1.11.6 (artifact unchanged) |

## Build

Maven: `C:\Users\Danie\tools\apache-maven-3.9.10\bin\mvn.cmd`

```powershell
& "C:\Users\Danie\tools\apache-maven-3.9.10\bin\mvn.cmd" "-Dmaven.test.skip=true" compile
& "C:\Users\Danie\tools\apache-maven-3.9.10\bin\mvn.cmd" test
```

Output JAR: `target/civs-1.11.6.jar` (shade). Deploy to server `plugins/`.

## Server configs (authoritative)

**Use `Civs_servidor/`** — live server data (menus, item-types, translations, regions, towns, `config.yml`).

**Do not treat `Civs/`** as the deploy source; it is the bundled/default pack. Hybrid templates live under `src/main/java/resources/hybrid/`.

## Architecture (mental model)

```
Civs.java → managers (Region, Town, Item, Menu, Locale, Config)
├── Regions: Region, RegionType, RegionManager, effects/* (HousingEffect, VillagerEffect, plot, port, …)
├── Towns: Town, TownManager, Government
├── Menus: CustomMenu + @CivsMenu classes; YAML in menus/
├── Commands: @CivsCommand + CivCommand (reflections scan)
└── Persistence: YAML per region/town/civilian under plugin data folder
```

- **No NMS** in plugin code — Paper API + optional hooks (Dynmap, Pl3xMap, Vault).
- **Region identity** = location string (`worldUuid~x~y~z`), not display name.
- **Effects** on regions are `Map<String,String>` cloned from RegionType on create.

## Completed work (Phases 0–3 + fixes)

### Phase 0 — Toolchain
- Java 25, Paper 26.1.2 `pom.xml`, maven-shade 3.6.2, Mockito 5.23.0 / Byte Buddy for Java 25.

### Phase 1 — API migration
- Source updates for Paper 26.1.2 (Material enums, potions, DamageSource, etc.).
- Removed `adventure-platform-bukkit`; native Paper `Audience` / Adventure in ChatManager, ActionBarUtil, AnnouncementUtil, AntiCampEffect, InviteTownCommand.
- `CVItem` hardened for unknown Material names.
- Test mocks: World, ItemMeta, ServiceLoader fakes, `UnsafeValues` delegation.

### Phase 2 — Server pack
- `Civs_servidor/` added: config, menus, item-types, gov-types, skills, translations, runtime regions/towns/players.

### Phase 3 — Runtime stability
- `AsyncFileWriter` for region/town/civilian YAML (async default; sync when urgent).
- Housing/villager recalc on load; `/cv recalc`; urgent save when counters change.
- `acceptInvite` revalidates housing.
- Region type **effects map cloned** on create (`RegionManager` ~693).
- Town requirement scans use **town center**, not player location.
- **WATER / CAULDRON** aliases in `Region.matchesBuildReqMaterial`; farm YAMLs use WATER; menus show water bucket for cauldron reqs.
- GUI ordering: `TreeMap` / `LinkedHashSet`; `replaceVariables` in `putActions` and `openMenuFromString`.
- safe-worldedit + WorldEdit `PluginEnableEvent` fallback; FAWE = WorldEdit for this feature.
- Port menu town-scoped ports; council_room `port:town` restored.

## Known pitfalls

| Issue | Fix |
|-------|-----|
| HashMap/HashSet in dynamic menus | Use `TreeMap` / `LinkedHashSet` |
| Menu placeholders not substituted | `replaceVariables` in **both** `putActions` and `openMenuFromString` |
| Shared region effects mutated | **Clone** `regionType.getEffects()` when creating region |
| Town region requirements wrong | Scan from **town center** location |
| Farm water detection | YAML: `WATER`; code aliases `CAULDRON` ↔ `WATER` in `Region.java` |
| Housing counters drift | Recalc on load; `/cv recalc`; destroy uses region housing effect |
| Town invite over housing cap | `acceptInvite` revalidates housing |
| Legacy Adventure platform | Use Paper native `Audience`, not bungee adventure-platform |
| YAML save lag | `AsyncFileWriter`; `saveRegion(..., false)` only when consistency critical |

## Required / recommended plugins

| Plugin | Role |
|--------|------|
| **Vault** | Mandatory (economy API) |
| Economy impl + **LuckPerms** | Recommended |
| **FAWE** (FastAsyncWorldEdit) | Acts as WorldEdit for `safe-worldedit` |

## Workflow

1. One logical change per commit; message = what/why (match recent history).
2. `mvn test` (~260 tests) before push.
3. Push to `origin paper-26.1.2-migration`.
4. User validates on **Linux** game server with `Civs_servidor/` configs.
5. Read `docs/MIGRATION-STATUS.md` for current backlog.

## Backlog

- [x] Plot rename (`displayName` on Region, `/cv rename-plot`, region menu) — see latest commits
- [ ] ItemMeta → Adventure `Component` (display names / lore)
- [ ] Folia scheduler / region threading
- [ ] MMOItems / MythicLib Paper 26.1.2 compatible builds (optional server jars)

## When editing

1. Read surrounding class style; minimal diff.
2. Prefer server YAML in `Civs_servidor/` for user-facing config.
3. Main thread for Bukkit API; async only for file I/O.
4. See `reference.md` for file paths and test layout.
