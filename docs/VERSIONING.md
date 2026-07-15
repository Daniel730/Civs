# Plugin versioning & release tags

Both custom plugins ship **Maven `project.version` → `plugin.yml` version** (resource filtering) and use **git tags** that match the release.

| Repo | Artifact | Tag pattern | Deploy JAR name |
|------|----------|-------------|-----------------|
| [Civs](https://github.com/Daniel730/Civs) | `org.redcastlemedia.multitallented:civs` | `v1.11.x` | `civs-<version>.jar` |
| [civs-quests / RPGServer](https://github.com/Daniel730/civs-quests) | `dev.daniel730:rpg-server` | `v0.1.x` | `rpg-server-<version>.jar` |

## Rules

1. **Bump `pom.xml` `<version>`** for every production deploy (no silent SNAPSHOT overwrites on the live server).
2. **Tag** the release commit: `git tag -a vX.Y.Z -m "Civs vX.Y.Z"` (or RPG equivalent), then `git push origin vX.Y.Z`.
3. **Deploy** the shaded/built jar under the versioned filename; **remove** older `civs-*.jar` / `rpg-server-*.jar` from `plugins/` so Paper does not double-load.
4. Server pack configs stay in **`Civs_servidor/`**; sync menus/item-types/translations carefully and **never** wipe live `towns/`, `regions/`, or `players/`.
5. Prefer building from **`master`** (reconciled Paper 26.1.2 line) or a release branch that has already been merged and tested.

## Verify on server

```bash
unzip -p plugins/civs-*.jar plugin.yml | head -15
unzip -p plugins/rpg-server-*.jar plugin.yml | head -15
sha256sum plugins/civs-*.jar plugins/rpg-server-*.jar
```
