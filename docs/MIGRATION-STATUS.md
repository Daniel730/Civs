# Civs Paper 26.1.2 — migration status

**Branch:** `paper-26.1.2-migration`  
**Target:** Paper 26.1.2, Java 25  
**Remote:** https://github.com/Daniel730/Civs  

## Current status

Core migration **compiles and tests pass** on Windows dev machine. Server pack in `Civs_servidor/` is the authoritative deploy set. Runtime fixes through Phase 3 are merged (Adventure API, async saves, housing recalc, GUI ordering, water/cauldron farms, safe-worldedit).

## Done

- [x] Phase 0: Java 25 + Maven + Paper 26.1.2 API
- [x] Phase 1: Source API updates, Adventure migration, test mocks
- [x] Phase 2: `Civs_servidor/` server pack + hybrid resource refresh
- [x] Phase 3: Async YAML, housing/villager recalc, invite validation, effects clone
- [x] Bug fixes: menu ordering, placeholder substitution, town center scans, port/town scope
- [x] Plot rename: `displayName` on Region, `/cv rename-plot`, region menu, en/pt_br
- [x] Cursor project brain: `.cursor/skills/`, `.cursor/rules/`, this doc

## Backlog

- [ ] ItemMeta → Adventure `Component` for item display names and lore
- [ ] Folia-compatible scheduling (if targeting Folia servers)
- [ ] MMOItems / MythicLib versions tested on Paper 26.1.2 (optional)
- [ ] Pl3xMap / Dynmap marker updates for custom plot display names (optional)

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

Expect ~260 tests. Mockito 5.23.0 required for Java 25.
