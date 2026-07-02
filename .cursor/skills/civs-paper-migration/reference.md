# Civs migration reference

## Key paths

| Path | Purpose |
|------|---------|
| `src/main/java/org/redcastlemedia/multitallented/civs/` | Plugin source |
| `src/test/java/org/redcastlemedia/multitallented/civs/` | JUnit 4 tests |
| `Civs_servidor/` | Deploy configs + live world data |
| `src/main/java/resources/hybrid/` | Default hybrid pack (source) |
| `pom.xml` | Paper API, Java 25, shade config |

## Important classes

| Class | Role |
|-------|------|
| `RegionManager` | Load/save regions, placement, `getRegionAt` |
| `TownManager` | Towns, housing recalc, `recalculateHousingAndVillagers` |
| `CustomMenu` | Menu framework, `replaceVariables`, `LinkedHashSet` icons |
| `HousingEffect` | KEY = `housing` |
| `VillagerEffect` | Town villager counts |
| `AsyncFileWriter` | Off-thread YAML writes |
| `Region` | Instance data; `displayName` for plot labels |

## Test entry points

| Test class | Covers |
|------------|--------|
| `RegionsTests` | Region lifecycle, `createNewRegion` helpers |
| `TownTests` | Towns, housing |
| `MenuVariableSubstitutionTest` | Menu placeholders |
| `BlueprintsMenuTests`, `PortMenuTest`, `ShopMenuTest` | GUI ordering |
| `RenamePlotCommandTest` | Plot rename command + persistence |

## Region YAML (runtime)

Saved under `regions/<id>.yml`:

```yaml
type: plot11x11
location: <worldUuid~x~y~z>
display-name: My Shop Plot   # optional, plots only
effects:
- plot
- forsale
people:
  <uuid>: owner
```

## Commands (cv)

| Command | Notes |
|---------|-------|
| `/cv rename <oldTown> <newTown>` | Town rename (owner) |
| `/cv rename-plot <name>` | Standing in plot |
| `/cv rename-plot <regionId> <name>` | From menu suggest |
| `/cv sell <price>` | Plot/region sale |
| `/cv recalc [town]` | Admin housing/villager fix |

## Commit style (recent)

```
Fix town intersection checks and test isolation.
Clone region type effects when creating regions.
Add WATER and CAULDRON aliases for build requirement scans.
```

Imperative, sentence case, no ticket prefix.
