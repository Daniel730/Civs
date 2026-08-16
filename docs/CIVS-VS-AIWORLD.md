# Civs plugin vs AI World — repository split (for safe push)

The repo is a **monorepo**: the Civs Bukkit/Paper plugin (Java) and the AI World
node runtime (the villager-brain experiment) live in the SAME git tree. They must be
pushed separately so a Civs production server never receives the experimental AI World.

## What belongs to CIVS (safe to push to the plugin remote)
- `src/` (Java plugin sources)
- `pom.xml`, `dependency-reduced-pom.xml`
- `config/`, `Civs/`, `Civs_servidor/`, `AlternativeConfigs/`, `translations/`, `stream-assets/`
- `README.md`, `AGENTS.md`, `DECISIONS.md`, `CHANGELOG.md`, `SUMMARY.md`, `LICENSE`, `help.yml`
- `.github/`, `.gitattributes`, `.gitignore`, `install-dep.sh`, `wsl-build.sh`, `pom-fix.patch`, `power-fix.patch`
- `docs/` EXCEPT the `AIWORLD-*` files (those are AI World)
- `target/` is build output (gitignored)

## What belongs to AI WORLD (keep local / push on a separate branch only)
- `integration-tests/runner/` (the whole node runner: `lib/`, `scripts/`, `gateway/`, `test/`, `docs/`, configs)
- `lib/ai-world/` and `lib/survival/` (brain + body libs)
- `reports/aiworld-*` (generated fine-tune dataset + experiences — gitignored at runtime)
- `scripts/aiworld-*` (fine-tune / learn-loop scripts)
- `docs/AIWORLD-*.md` (coordination / audit / learning / neural docs)

## How to push only Civs (safe)
Run `scripts/civs-clean-branch.sh` — it creates a branch `civs-clean` that untracks the
AI World paths (via `git rm --cached`), leaving your working tree intact. Push THAT branch
to the Civs remote; never push `fix/camera-observation-alex-steve` (which carries AI World).

## Status (2026-08-12)
- Brain (cognition/memory/learning) and body (locomotion/survival) are developed locally on
  `fix/camera-observation-alex-steve`. Neither is pushed. Civs plugin code is unmodified by the
  AI World work (the AI World is a separate node runtime that drives the server via RCON/test
  harness, it does NOT patch `src/`).
