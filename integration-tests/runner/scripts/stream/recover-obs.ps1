# Isolated OBS restart for local stream-test / recording. Never starts YouTube.
param(
  [switch]$StartRecording
)

$ErrorActionPreference = 'Stop'
Get-Process obs64 -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Stopping OBS pid=$($_.Id)"
  Stop-Process -Id $_.Id -Force
  Start-Sleep -Seconds 2
}

& (Join-Path $PSScriptRoot 'start-stream-test.ps1') -SkipInstall -StartRecording:$StartRecording
Write-Host 'RECOVERING→ local OBS relaunch requested'
