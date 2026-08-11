# Agent workflow — issues, PRs, quality, motion

**Audience:** any Cursor / Hermes / Claude / GPT agent working on this repo.  
**Status:** mandatory process. Do not ship features without following this file.  
**Related:** `AGENTS.md`, `docs/AGENT_PLATFORM.md`, `DECISIONS.md`, `.cursor/skills/design-motion-principles/`.

Labels used below: **FACT** · **OBSERVED** · **INFERRED** · **TODO**

---

## 1. Work always goes through GitHub Issues → PR → merge

1. **Before coding**, open (or reuse) a GitHub issue on `Daniel730/Civs`.
2. Classify every issue with **exactly one** type label:
   - `tipo:correção` — bug / regression / broken behavior
   - `tipo:melhoria` — quality, performance, DX, observability, lint, coverage
   - `tipo:nova-função` — new capability or product surface
3. Add priority (`P0`/`P1`/`P2`) and area (`civs`, `integration`, `rpg` when relevant).
4. Branch from the agreed work branch (e.g. `cursor/agent-platform-p1` or `paper-26.1.2-migration`).
5. Open a **PR** for deploy/review. Never push straight to `master` for product changes.
6. PR description **must** mention the issue (`Closes #N` or `Refs #N`) and include a short test plan.
7. Merge only after CI gates relevant to the change pass (see §3).

### PR body template

```markdown
## Summary
- …

## Issue
Closes #N

## Test plan
- [ ] `mvn -B test` (if Java touched)
- [ ] runner scenarios / Playwright (if JS/UI touched)
- [ ] manual / WSL testserver notes (if runtime)
```

### Hermes / multi-agent rule

- Prefer cheapest Hermes tier for surveys and draft checklists; **parent agent** reviews, edits, commits, creates issues/PRs.
- Log non-trivial decisions in `DECISIONS.md`.
- Do not invent parallel harnesses; extend `integration-tests/` per `docs/AGENT_PLATFORM.md`.

---

## 2. Observability (required stack)

**Primary contract: OpenTelemetry (OTel).**  
Sentry / Datadog / New Relic are **exporters or optional APM backends**, not three parallel instrumentation layers.

| Layer | Target | Tooling | Status |
|-------|--------|---------|--------|
| Traces + metrics + logs correlation | Plugin JVM + Node runner + future operator UI | **OpenTelemetry** SDK + OTLP exporter | **PARTIAL** — Node runner + Agent Gateway MCP instrumented (#32); JVM plugin **TODO** |
| Error tracking (exceptions, breadcrumbs) | Same | **Sentry** (OTel bridge or native SDK) | **TODO** (#33) |
| Infra / APM dashboard | Ops choice | **Datadog** *or* **New Relic** (one primary; second optional) | **TODO** (#34) |
| Local / CI | Dev | OTel Collector → file/console / `CIVS_OTEL_FILE`; no cloud keys in repo | **DONE** (runner) — see `docs/OBSERVABILITY.md` |

Rules:

- Instrument at capability boundaries (`/test act`, RCON scenarios, MCP tools, menu open, region save).
- Never commit DSN / API keys; use env / GitHub Secrets.
- Prefer one metrics path (OTel → chosen backend). Avoid duplicate custom metrics APIs.
- Telemetry must be optional: unset exporter ⇒ no-op; Minecraft QA must never fail because an exporter is down.

**Node runner how-to:** `docs/OBSERVABILITY.md` (env vars, span names, validate script).

Java equivalents while JVM OTel lands: structured logging with correlation ids; JaCoCo coverage already via Maven when wired; bStats remains product analytics, not APM.

---

## 3. Code quality & lint

### Node (`integration-tests/runner` and any future web/UI package)

| Tool | Role | Status |
|------|------|--------|
| **Biome** | Format + lint | **DONE** (#35) — `cd integration-tests/runner && npm run lint` |
| **commitlint** | Conventional commits on PR titles / commit messages | **DONE** (#35) — CI on PRs touching the runner; local: pipe title into `npx commitlint` |
| **knip** | Dead files / unused & unlisted deps | **DONE** (#35) — `npm run knip` (CJS export-member noise off; see D-AP-015) |
| **arch-contract** (dependency-cruiser or eslint-plugin-boundaries) | Forbidden import edges (runner ↛ plugin internals, UI ↛ secrets) | **TODO** (#36) |
| **Stryker** | Mutation testing on critical runner libs (`harness`, `capabilities`, `dsl`) | **TODO** (#37) |

**Runner quality scripts (FACT):** from `integration-tests/runner`:

- `npm run lint` — Biome format + lint (check only)
- `npm run lint:fix` / `npm run format` — apply Biome fixes / format only
- `npm run knip` — unused files & dependency graph (CI fails on critical dead-ends)
- `npm run test:unit` — also re-run after lint/format changes

CI: `.github/workflows/runner-quality.yml` (Biome + knip + unit + conventional PR title; always reports on PRs). Maven: `.github/workflows/maven-ci.yml` (`maven-test`). Broader notes: `docs/TESTING.md` § CI gates. Merge on `master` requires the named checks via branch protection (#42).

### Java (Civs plugin)

| Tool | Role | Status |
|------|------|--------|
| `javac` + `mvn test` | Current gate (**FACT**) — CI job `maven-test` (#42) | **DONE** |
| Checkstyle (minimal ruleset) | Unused/redundant/star imports, modifier order | **DONE** (#43) — `mvn -B -DskipTests checkstyle:check` |
| ArchUnit | Package contracts (main ↛ junit/mockito/sun internals) | **DONE** (#43 phase 1) |
| SpotBugs / Error Prone | Deeper static quality | **TODO** (follow-up) |
| PIT / other Java mutation (optional) | Parallel to Stryker for Java hotspots | **TODO** |

Config: `config/checkstyle/checkstyle.xml`. Rules start strict-but-narrow so the legacy tree stays mergeable; expand via `tipo:melhoria` issues.

Agents must not weaken these gates in CI without an issue of type `tipo:melhoria` explaining why.

---

## 4. Tests & coverage

| Layer | Tool | Scope |
|-------|------|--------|
| Unit | JUnit + Mockito (`mvn test`) | Plugin |
| Integration / E2E (server) | `integration-tests/` runner + Paper testserver | Capabilities, RPG observe, scenarios |
| E2E (browser / operator UI) | **Playwright** | Future dashboards, motion/UI surfaces |
| Coverage upload | **Codecov** | Maven JaCoCo + Node coverage |

Known gotcha (**FACT**): `RegionsTests.dailyRegionShouldUpkeepDaily` can flake in full-suite order — see `AGENTS.md`. Do not “fix” it inside unrelated PRs.

---

## 5. Motion & UI quality (design-motion-principles)

Skill installed at:

- `.cursor/skills/design-motion-principles/` (repo)
- `~/.cursor/skills/design-motion-principles/` (global)

Upstream: [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles).

**Any operator UI, web HUD overlay, OBS companion page, or React/HTML surface** must satisfy:

| Requirement | Expectation |
|-------------|-------------|
| Skeleton | Placeholder UI for async data (no blank flash) |
| Lazy loading | Route/component/data deferral; load only what is visible |
| Enter / exit | Paired animations; no hard cut for shared elements |
| Loading | Distinct loading state (skeleton and/or spinner as skill recommends) |
| Progress | Determinate progress when duration is known; indeterminate otherwise |
| Reduced motion | Honor `prefers-reduced-motion` |
| Frequency gate | High-frequency actions: no decorative motion |

Minecraft inventory GUIs are not CSS apps — apply the *spirit* (feedback, progress BossBar/ActionBar, no spammy redraws). Full motion skill applies to web/overlay surfaces.

Context weighting for this project: **Emil (primary) + Jakub (secondary)** — productivity QA tools and livestream ops; Jhey only for empty/delight states.

---

## 6. Deploy management

- Production plugin JAR deploys only from **merged PRs** (or a release tag cut from merge).
- Server config live edits: `Civs_servidor/` (not bundled `Civs/`) — see migration skill.
- Document deploy notes in the PR; user validates on Linux server when runtime-sensitive.

---

## 7. Backlog issues (filed 2026-08-11)

| # | Type | Title |
|---|------|--------|
| [#31](https://github.com/Daniel730/Civs/issues/31) | Melhoria | Enforce Issues→PR workflow |
| [#32](https://github.com/Daniel730/Civs/issues/32) | Nova função | OpenTelemetry (JVM + runner) |
| [#33](https://github.com/Daniel730/Civs/issues/33) | Melhoria | Sentry ↔ OTel |
| [#34](https://github.com/Daniel730/Civs/issues/34) | Melhoria | Datadog XOR New Relic via OTLP |
| [#35](https://github.com/Daniel730/Civs/issues/35) | Melhoria | Biome + commitlint + knip |
| [#36](https://github.com/Daniel730/Civs/issues/36) | Melhoria | Arch-contract |
| [#37](https://github.com/Daniel730/Civs/issues/37) | Melhoria | Stryker |
| [#38](https://github.com/Daniel730/Civs/issues/38) | Melhoria | Codecov |
| [#39](https://github.com/Daniel730/Civs/issues/39) | Nova função | Playwright E2E |
| [#40](https://github.com/Daniel730/Civs/issues/40) | Nova função | Motion-compliant UI shell |
| [#41](https://github.com/Daniel730/Civs/issues/41) | Correção | Flaky RegionsTests isolation |
| [#42](https://github.com/Daniel730/Civs/issues/42) | Melhoria | CI lint/unit/integration gates |
| [#43](https://github.com/Daniel730/Civs/issues/43) | Melhoria | Java Checkstyle/SpotBugs/ArchUnit |
| [#44](https://github.com/Daniel730/Civs/issues/44) | Nova função | PR + issue templates |

## 8. Checklist before an agent claims “done”

- [ ] Issue exists with type label
- [ ] PR references issue
- [ ] Relevant tests run
- [ ] Observability / lint / motion requirements considered (or deferred with linked issue)
- [ ] `DECISIONS.md` updated if a non-trivial choice was made
- [ ] No secrets committed
