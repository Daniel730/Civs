# Start OBS Studio for Minecraft window capture (best-effort).
# User may need a scene with "Game Capture" / "Window Capture" for javaw/Minecraft.
# Recordings default to Videos\ unless OBS profile overrides.
param(
  [switch]$StartRecording
)

$obs = "C:\Program Files\obs-studio\bin\64bit\obs64.exe"
if (-not (Test-Path $obs)) {
  Write-Host "BLOCKED: OBS not found at $obs"
  exit 2
}

$obsArgs = @("--disable-updater")
if ($StartRecording) {
  $obsArgs += "--startrecording"
}

Start-Process -FilePath $obs -ArgumentList $obsArgs -WorkingDirectory (Split-Path $obs)
Write-Host "OBS launched. Configure Window Capture → Minecraft / javaw if needed."
Write-Host "Recordings typically: $env:USERPROFILE\Videos\"
