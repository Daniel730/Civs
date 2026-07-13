# Blueprint sources

Bundled `.schem` files are copied to `plugins/Civs/blueprints/` on first run.
If a file is missing, Civs generates a fallback survival house that satisfies `build-reqs`.

## Download candidates (minecraft-schematics.com)

| Civs type | Source ID | URL | Notes |
|-----------|-----------|-----|-------|
| shack | 5373 | https://www.minecraft-schematics.com/schematic/5373/ | Small 7x7 House (.schematic legacy) |
| hovel | 4189 | https://www.minecraft-schematics.com/schematic/4189/ | Spruce Starter Cabin 9x11 |
| dwelling | 10853 | https://www.minecraft-schematics.com/schematic/10853/ | Minimalist Home 11x9 |
| house | 20035 | https://www.minecraft-schematics.com/schematic/20035/ | Small Survival House (.schem) |
| mansion | 19527 | https://www.minecraft-schematics.com/schematic/19527/ | Wooden Starter House 21x13 |

Farm blueprints (`wheat_farm.schem`, etc.) are generated at runtime when missing; drop custom `.schem` files into the same folder to override.

Replace bundled files by dropping validated `.schem` into the server `plugins/Civs/blueprints/` folder.
Use `/cv reload` or restart to refresh the in-memory cache.

## Validation

Run `mvn test` — `BlueprintValidatorTests` checks generated fallbacks against `build-reqs`.
