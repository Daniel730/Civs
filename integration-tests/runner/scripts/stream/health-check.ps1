# Lightweight health probe for stream nightshift subsystems.
param(
  [string]$OutJson = ''
)

$ErrorActionPreference = 'Continue'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
if (-not $OutJson) {
  $OutJson = Join-Path $repoRoot 'integration-tests\runner\reports\stream\health.json'
}

function Component($state, $detail) {
  [pscustomobject]@{ state = $state; detail = $detail; checkedAt = (Get-Date).ToUniversalTime().ToString('o') }
}

$components = [ordered]@{}

# Minecraft / WSL QA
try {
  $tmux = wsl -e bash -lc "tmux has-session -t civs-qa 2>/dev/null && echo UP || echo DOWN"
  $ports = wsl -e bash -lc "ss -ltn 2>/dev/null | grep -E ':25565|:25575' || true"
  if ($tmux -match 'UP' -and $ports -match '25565') {
    $components.minecraft = Component 'HEALTHY' "tmux civs-qa; ports ok"
  } elseif ($tmux -match 'UP') {
    $components.minecraft = Component 'DEGRADED' "tmux up but ports unclear: $ports"
  } else {
    $components.minecraft = Component 'FAILED' 'tmux civs-qa not running'
  }
} catch {
  $components.minecraft = Component 'BLOCKED' $_.Exception.Message
}

# OBS
$obsProc = Get-Process obs64 -ErrorAction SilentlyContinue
$obsBin = 'C:\Program Files\obs-studio\bin\64bit\obs64.exe'
if ($obsProc) {
  $components.obs = Component 'HEALTHY' "pid=$($obsProc.Id)"
} elseif (Test-Path $obsBin) {
  $components.obs = Component 'DEGRADED' 'installed but not running'
} else {
  $components.obs = Component 'FAILED' 'obs64.exe missing'
}

# Camera / NPC (best-effort via WSL log presence)
try {
  $cam = wsl -e bash -lc "grep -E 'Cam|Steve' /home/dansilva/civs-testserver/logs/latest.log 2>/dev/null | tail -3"
  if ($cam) {
    $components.camera = Component 'HEALTHY' 'Cam/Steve mentioned in latest.log'
    $components.npc = Component 'HEALTHY' 'builder actor log present'
  } else {
    $components.camera = Component 'DEGRADED' 'no recent Cam/Steve log lines'
    $components.npc = Component 'DEGRADED' 'no recent Steve log lines'
  }
} catch {
  $components.camera = Component 'UNKNOWN' 'log probe failed'
  $components.npc = Component 'UNKNOWN' 'log probe failed'
}

# Director
$directorDoc = Join-Path $repoRoot 'docs\CINEMATIC_DIRECTOR.md'
$fallback = Join-Path $repoRoot 'integration-tests\runner\lib\stream\fallback-director.js'
if (Test-Path $fallback) {
  $components.director = Component 'DEGRADED' 'full Director TODO; fallback-director.js present'
} else {
  $components.director = Component 'BLOCKED' 'no director/fallback'
}

# Music / audio assets
$music = Join-Path $repoRoot 'stream-assets\music\soft-loop-procedural.wav'
$allow = Join-Path $repoRoot 'stream-assets\licenses\ALLOWLIST.md'
if ((Test-Path $music) -and (Test-Path $allow)) {
  $components.music = Component 'HEALTHY' 'license-verified procedural track present'
  $components.audio = Component 'DEGRADED' 'assets ready; listening mix not auto-validated'
} else {
  $components.music = Component 'FAILED' 'music asset or allowlist missing'
  $components.audio = Component 'FAILED' 'audio assets missing'
}

# Network (local)
try {
  $tn = Test-NetConnection -ComputerName 127.0.0.1 -Port 25565 -WarningAction SilentlyContinue
  if ($tn.TcpTestSucceeded) {
    $components.network = Component 'HEALTHY' '127.0.0.1:25565 open'
  } else {
    $components.network = Component 'DEGRADED' '25565 not reachable from Windows'
  }
} catch {
  $components.network = Component 'UNKNOWN' $_.Exception.Message
}

# Stream = local test only
$components.stream = Component 'BLOCKED' 'YouTube credentials NOT CONFIGURED; public livestream NOT STARTED (by design)'

$order = @('FAILED', 'BLOCKED', 'RECOVERING', 'DEGRADED', 'HEALTHY', 'UNKNOWN')
$worst = 'HEALTHY'
foreach ($c in $components.Values) {
  $i = $order.IndexOf($c.state)
  if ($i -ge 0 -and $i -lt $order.IndexOf($worst)) { $worst = $c.state }
}

$report = [ordered]@{
  overall = $worst
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  mode = 'local-stream-test'
  publicLivestream = 'NOT_STARTED'
  youtubeCredentials = 'NOT_CONFIGURED'
  components = $components
}

New-Item -ItemType Directory -Force -Path (Split-Path $OutJson) | Out-Null
($report | ConvertTo-Json -Depth 6) | Set-Content -Path $OutJson -Encoding UTF8
Write-Host "overall=$worst written=$OutJson"
$report | ConvertTo-Json -Depth 6
