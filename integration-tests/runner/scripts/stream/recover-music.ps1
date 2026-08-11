# Music recovery notes + playlist refresh (OBS Media Source is source of truth).
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$musicDir = Join-Path $repoRoot 'stream-assets\music'
$playlist = Join-Path $musicDir 'playlist.m3u'
$files = Get-ChildItem $musicDir -Filter *.wav -File | Sort-Object Name
if (-not $files) {
  Write-Host 'FAILED: no license-verified wav files in stream-assets/music'
  exit 2
}
$lines = @('#EXTM3U') + ($files | ForEach-Object { $_.FullName })
$lines | Set-Content -Path $playlist -Encoding UTF8
Write-Host "HEALTHY: wrote $($files.Count) entries -> $playlist"
Write-Host 'In OBS: Media Source -> local file or playlist; loop on; volume about -18 dB'
Write-Host 'Crossfade: use OBS Studio Transition or dual Media Sources (A/B) if desired'
