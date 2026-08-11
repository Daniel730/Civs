# Architecture — Civs + Agent Platform

Labels: **FACT** (verified in repo/API/runtime) · **OBSERVED** (seen in logs/runs) · **INFERRED** · **UNKNOWN** · **TODO**

## System map (as of 2026-08-10)

```text
Daniel730/Civs (this repo, master / v1.11.7)
├── src/                          Civs Paper plugin (Java 25)
├── Civs_servidor/                FACT: authoritative live server config pack
├── Civs/                         FACT: bundled defaults (not deploy source)
├── integration-tests/            FACT: RCON harness + Node scenario runner + actors
├── scripts/qa/                   FACT: Python RCON structure/menu QA (WSL testserver)
└── docs/                         migration + integration-testing + this platform set

Companion (separate repo):
└── Daniel730/civs-quests         FACT: RPGServer plugin (quests/profiles/perks/HUD)
```

## Runtime target

| Item | Value | Label |
|------|-------|-------|
| Paper / MC | 26.1.2 (paper-api `26.1.2.build.72-stable`) | FACT (`pom.xml`) |
| Java | 25 | FACT |
| Civs version | 1.11.7 | FACT |
| RPGServer on WSL QA | 0.1.2 jar; source tip 0.1.3 locally | OBSERVED / FACT |
| Economy | Vault + TestEconomy/QAEcon | OBSERVED |
| WorldEdit | worldedit-bukkit 7.4.3 on WSL QA | OBSERVED |

## Existing test / agent surfaces (do not replace)

| Surface | Role | Label |
|---------|------|-------|
| `integration-tests/test-harness-plugin` | Server-side **observation / reset** via `/test` over RCON | FACT |
| `integration-tests/runner` | Node scenario DSL → harness + actor → JUnit XML + evidence | FACT |
| `RawKeepAliveActor` | Offline `minecraft-protocol` client = real online `Player` on 26.1.2 | FACT |
| `actor-mineflayer.js` | Mineflayer actor for ≤1.21.x only | FACT (gated) |
| `scripts/qa/*` | Fast RCON structure I/O smoke + optional window bot | FACT |
| Real MC 26.1.2 client | Visual / GUI QA (computer-use) | FACT (`AGENTS.md`, `DECISIONS.md`) |

## Hard constraint: Mineflayer on Paper 26.1.2

**FACT** (empirical probe `integration-tests/MINEFLAYER-PROBE-RESULTS.txt`):

- Mineflayer high-level API **cannot** drive this server (version gate + packet shape mismatch).
- Raw `minecraft-protocol` **can** login/keep-alive on 26.1.2.
- Rebuilding movement/inventory/GUI on raw packets ≈ reimplementing Mineflayer.

**Decision (prior):** harness is the version-proof backbone; Mineflayer is optional on supported servers.

**Decision (this platform):** for Paper 26.1.2 player *physics/actions*, extend the harness with a **server-side capability layer** that calls verified Paper `Player` APIs (`breakBlock`, `setSneaking`, `attack`, …) against the online actor player. See `DECISIONS.md` D-AP-001.

## Intended layered architecture (target)

```text
LLM / Planner          (P4 — not yet built)
      ↓
High-Level Goal
      ↓
Task Planner           (P2 scenario DSL exists; LLM planner TODO)
      ↓
Game Capability Layer  (P1 — in progress: /test act + runner capabilities.js)
      ↓
Navigation / Combat / Inventory / Interaction
      ↓
Minecraft presence     (RawKeepAliveActor | Mineflayer≤1.21 | real client)
```

LLM must decide **what**; deterministic capabilities decide **how**.

## Plugin responsibility boundaries

| Concern | Owner | Rule |
|---------|-------|------|
| Towns/regions/items/menus | Civs | Do not reimplement in agents |
| Quests/profiles/perks/archetypes | RPGServer | Agents consume APIs/commands/state |
| Economy API | Vault provider | Agents observe/assert via harness |
| Observation/assert/reset for CI | CivsTestHarness | No Civs game-state creation |
| Player actions | Actor + server-side capabilities | Must hit production event paths where possible |

## Local environments

| Env | Path | Status |
|-----|------|--------|
| WSL QA testserver | `/home/dansilva/civs-testserver` | OBSERVED: exists; was **stopped** at recon (last stop 2026-07-17) |
| RCON | `25575` / password `civsqa` (WSL) vs `civs-itest` (docs default) | FACT / OBSERVED |
| Cloud VM testserver | `/workspace/testserver` (gitignored) | FACT (`AGENTS.md`) — not this Windows host |

## UNKNOWN / TODO (platform)

- UNKNOWN: production Linux game-server deploy topology for 24/7 AI world + OBS.
- UNKNOWN: whether a FakePlayer library is acceptable on prod (avoid until justified).
- TODO: RPG observe adapters (`/test rpg …`) without modifying RPG unless needed.
- TODO: LLM provider adapter + exploratory QA agent.
- TODO: world population + cinematic director (P5–P7).
