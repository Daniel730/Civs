# AI World Population

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Status

**TODO** — not started as a subsystem. Depends on P1 capabilities being empirically stable on Paper 26.1.2.

## Intent

Long-running AI-controlled characters that explore, gather, trade, quest, and react to real server events so the world feels alive without a human player.

## Constraints from recon

- FACT: Mineflayer cannot provide navigation/combat on this Paper version.
- FACT: Raw protocol can keep players online; server-side APIs can act.
- OBSERVED: WSL QA server runs Civs + RPGServer + Vault + WorldEdit + TestEconomy when up.
- UNKNOWN: max concurrent online agents before TPS degradation on the production host.

## Design sketch (not implemented)

```text
identity / role / goals / memory / schedule
        ↓
profession policies (farmer, miner, merchant, …)
        ↓
capability layer (shared with QA agents)
        ↓
online player presence
```

Rules:

- Goals and memory are structured and bounded.
- No LLM call every tick.
- Configurable max agents, decision frequency, memory size.
- Events derived from real server state when possible (no fake camera bait).

## Next concrete step (when P1 done)

1. One `traveller` agent loop: observe → choose nearby POI → teleport-or-step → idle → log.
2. Measure TPS impact for N=1,3,5 on testserver.
3. Only then add professions and RPG quest participation.
