# Install CivsNightshift OBS profile (+ optional scene stub). Never configures YouTube.
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
# integration-tests/runner/scripts/stream → repo root (4 levels up)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$srcProfile = Join-Path $repoRoot 'stream-assets\obs\profiles\CivsNightshift'
$srcScenesDoc = Join-Path $repoRoot 'stream-assets\obs\SCENES.md'
$obsBasic = Join-Path $env:APPDATA 'obs-studio\basic'
$dstProfile = Join-Path $obsBasic 'profiles\CivsNightshift'
$dstScenes = Join-Path $obsBasic 'scenes\CivsNightshift.json'
$videos = Join-Path $env:USERPROFILE 'Videos\CivsNightshift'

if (-not (Test-Path $srcProfile)) {
  Write-Error "BLOCKED: missing template profile at $srcProfile"
  exit 2
}

New-Item -ItemType Directory -Force -Path $videos | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $obsBasic 'profiles') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $obsBasic 'scenes') | Out-Null

if ((Test-Path $dstProfile) -and -not $Force) {
  Write-Host "OBSERVED: profile already exists at $dstProfile (use -Force to overwrite)"
} else {
  New-Item -ItemType Directory -Force -Path $dstProfile | Out-Null
  Copy-Item -Force (Join-Path $srcProfile 'basic.ini') (Join-Path $dstProfile 'basic.ini')
  Write-Host "FACT: installed profile CivsNightshift -> $dstProfile"
}

# Minimal scene collection stub (color boards). Minecraft capture bound manually — see SCENES.md
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$sceneGen = Join-Path $PSScriptRoot 'generate-obs-scenes.js'
$overlayWin = Join-Path $repoRoot 'stream-assets\overlays\cinematic.html'
$musicWin = Join-Path $repoRoot 'stream-assets\music\soft-loop-procedural.wav'
$repoScenes = Join-Path $repoRoot 'stream-assets\obs\scenes\CivsNightshift.json'

if (Test-Path $sceneGen) {
  if ($nodeCmd) {
    & $nodeCmd.Source $sceneGen --out $dstScenes --overlay $overlayWin --music $musicWin
    Copy-Item -Force $dstScenes $repoScenes -ErrorAction SilentlyContinue
    Write-Host "FACT: wrote scene collection stub $dstScenes"
  } else {
    $repoMnt = '/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6'
    $appMnt = '/mnt/c/Users/Danie/AppData/Roaming/obs-studio/basic/scenes/CivsNightshift.json'
    wsl -e bash -lc "export PATH=`$HOME/.nvm/versions/node/v25.8.0/bin:`$PATH; node $repoMnt/integration-tests/runner/scripts/stream/generate-obs-scenes.js --out $repoMnt/stream-assets/obs/scenes/CivsNightshift.json --overlay 'C:/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/stream-assets/overlays/cinematic.html' --music 'C:/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/stream-assets/music/soft-loop-procedural.wav' && cp -f $repoMnt/stream-assets/obs/scenes/CivsNightshift.json $appMnt && echo SCENE_OK"
    Write-Host "FACT: scene stub via WSL node"
  }
} else {
  Write-Host "UNKNOWN: generate-obs-scenes.js missing; create scenes manually per $srcScenesDoc"
}

Write-Host "Next: open OBS → Profile CivsNightshift → Collection CivsNightshift → bind Game/Window Capture (see stream-assets/obs/SCENES.md)"
Write-Host "Recordings folder: $videos"
Write-Host "NEVER pass stream keys to automation."
