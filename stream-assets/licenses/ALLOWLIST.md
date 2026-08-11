# Music / audio license allowlist

Labels: **FACT** · **BLOCKED** · **TODO**

## Rule

Only assets that are **reasonably verifiable** for YouTube livestream use may be placed under `stream-assets/`. Unclear licenses → **DO NOT USE**.

## Allowed categories

| Category | Requirement | Status |
|----------|-------------|--------|
| Original procedural audio generated for this repo | Authored here; no third-party sample packs | **ALLOWED** |
| Explicit CC0 / public domain with durable source URL + checksum | Document in `metadata/*.json` | **ALLOWED** |
| YouTube Audio Library tracks marked free for reuse (incl. commercial / livestream) | Save YT library screenshot or track ID + download date in metadata | **ALLOWED** |
| Licensed stock with written livestream rights | Invoice / license PDF in `licenses/` (do **not** commit secrets) | **ALLOWED** |
| “No copyright” random downloads, TikTok packs, unverified FreePD mirrors | — | **FORBIDDEN** |
| Commercial game OSTs, popular songs, AI scrapes of copyrighted works | — | **FORBIDDEN** |

## Current inventory

| File | Source | License | YouTube livestream OK? |
|------|--------|---------|------------------------|
| `ambience/soft-pad-procedural.wav` | Generated in-repo (PowerShell PCM) | Original work for Civs stream prep | **YES** |
| `music/soft-loop-procedural.wav` | Generated in-repo (PowerShell PCM) | Original work for Civs stream prep | **YES** |

## Adding a new track

1. Confirm allowlist category.
2. Copy file into `music/` or `ambience/`.
3. Add `metadata/<id>.json` with: title, artist, source_url, license, download_date, checksum_sha256, youtube_ok=true.
4. Append a row to this table.
5. Never commit stream keys or paid-account cookies.
