# Civs Paper 26.1.2 — migration status

**Branch:** `master` (migration line landed via PR #16)  
**Target:** Paper 26.1.2, Java 25  
**Remote:** https://github.com/Daniel730/Civs  
**Plugin version:** 1.11.7 (`v1.11.7`)

## Current status

Core migration **compiles and tests pass**. Server pack in `Civs_servidor/` is the authoritative deploy set. Runtime fixes through Phase 3 are merged (Adventure API, async saves, housing recalc, GUI ordering, water/cauldron farms, safe-worldedit). Recent batches: placement mode menu, CVItem Adventure helpers, auction menus, Nashorn-free spell arithmetic (Java 25), guide NPC dialog + RPG event bridge, farms/combat HUD coexistence.

## Done

- [x] Phase 0: Java 25 + Maven + Paper 26.1.2 API
- [x] Phase 1: Source API updates, Adventure migration, test mocks
- [x] Phase 2: `Civs_servidor/` server pack + hybrid resource refresh
- [x] Phase 3: Async YAML, housing/villager recalc, invite validation, effects clone
- [x] Bug fixes: menu ordering, placeholder substitution, town center scans, port/town scope
- [x] Plot rename: `displayName` on Region, `/cv rename-plot`, region menu, en/pt_br
- [x] Placement mode menu + instant-build housing-only config fix
- [x] Auction house menus synced to `Civs_servidor/`; CVItem Adventure lore/display writes
- [x] Guide NPC dialog system + tutorial/quest-mob event bridge for RPG
- [x] Auction browse hardening; bank/`/cv recalc` feedback
- [x] **Master reconciliation** — PR #16 (`56a30d19`) merged the diverged Sprint 3 + migration lines; `paper-26.1.2-migration` tip is on master
- [x] Cursor project brain: `.cursor/skills/`, `.cursor/rules/`, this doc

## master merge status

**Resolved.** The hard divergence at `96d2c50a` was reconciled in PR #16. Deploy source is **`master`** / tag `v1.11.7`. The old `paper-26.1.2-migration` branch tip matches master and is safe to delete as a leftover remote.

## HUD note (2026-07-17)

Prefer `mana-hud: bossbar` (vanilla hearts + Civs mana BossBar). Do **not** default to `composed` / RPG hearts-slot bitmap packs — UX rejected. See `docs/WIP-AUDIT.md`.

## Backlog

- [ ] ItemMeta → Adventure `Component` for remaining item display names and lore
- [ ] Folia-compatible scheduling (if targeting Folia servers)
- [ ] MMOItems / MythicLib versions tested on Paper 26.1.2 (optional)
- [ ] Wire or delete dead config: `allow-changing-gov-type`, `turret-fire-particles`, `custom-mob-region-spawn-cooldown-seconds`
- [ ] Write `ownerBound` to item PDC in `createItemStack`
- [ ] `/cv leave` + bank feedback polish

## Deploy checklist

1. Build: `mvn package` (or `mvn test` then package)
2. Copy `target/civs-1.11.7.jar` → server `plugins/`
3. Ensure **Vault** + economy installed
4. Sync **`Civs_servidor/`** contents into plugin data folder on Linux server (config, menus, item-types, translations) — **exclude** live `towns/`/`regions/`/`players/`
5. `safe-worldedit: true` in config if using FAWE/WorldEdit
6. Restart server; run `/cv recalc` if housing counts look wrong after upgrade
7. Smoke test: place farm (water req), open blueprints/port/shop menus, town invite, plot rename

## Tests

```powershell
& "C:\Users\Danie\tools\apache-maven-3.9.10\bin\mvn.cmd" test
```

Expect ~386+ tests (some skipped). Mockito 5.23.0 required for Java 25.
