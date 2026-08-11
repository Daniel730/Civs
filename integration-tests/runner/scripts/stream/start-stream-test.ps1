# Local/private stream test — RECORD ONLY. Never starts a public YouTube livestream.
param(
  [switch]$StartRecording,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$obs = 'C:\Program Files\obs-studio\bin\64bit\obs64.exe'
if (-not (Test-Path $obs)) {
  Write-Host 'BLOCKED: OBS not found'
  exit 2
}

$here = $PSScriptRoot
if (-not $SkipInstall) {
  & (Join-Path $here 'install-obs-profile.ps1')
}

New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE 'Videos\CivsNightshift') | Out-Null

$obsArgs = @(
  '--disable-updater',
  '--profile', 'CivsNightshift',
  '--collection', 'CivsNightshift'
)
# Explicitly DO NOT add --startstreaming
if ($StartRecording) {
  $obsArgs += '--startrecording'
}

$proc = Start-Process -FilePath $obs -ArgumentList $obsArgs -WorkingDirectory (Split-Path $obs) -PassThru
Write-Host "FACT: OBS started pid=$($proc.Id) profile=CivsNightshift collection=CivsNightshift"
Write-Host 'FACT: public livestream NOT STARTED (no --startstreaming)'
Write-Host 'Local test mode READY — bind Minecraft capture if first run (stream-assets/obs/SCENES.md)'
