# Launch official Minecraft 26.1.2 offline against WSL Paper QA and auto-join.
#
# FACT (2026-08-11): MC 26.1.2 ignores --server/--port (removed since 23w14a).
#   Use --quickPlayMultiplayer host:port instead.
# FACT: From Windows, TCP to 127.0.0.1:25565 fails; localhost / ::1 / WSL eth0 succeed
#   (WSL2 localhost forwarding is IPv6-oriented on this machine). Default host = localhost.
#
# Watch: Steve builds NpcPad; Cam spectates Steve. This client joins as Viewer and
# the script RCON-forces spectator + /spectate Cam once Viewer is online.
param(
  [string]$HostName = "",
  [int]$Port = 25565,
  [int]$RconPort = 25575,
  [string]$RconPassword = "civsqa",
  [string]$Username = "Viewer",
  [string]$Version = "26.1.2",
  [string]$SpectateTarget = "Cam",
  [int]$Width = 1280,
  [int]$Height = 720,
  [bool]$KillExisting = $true,
  [switch]$SkipAutoSpectate,
  [int]$JoinTimeoutSec = 120
)

$ErrorActionPreference = "Stop"

function Test-TcpOpen([string]$TargetHost, [int]$TargetPort, [int]$TimeoutMs = 1500) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect($TargetHost, $TargetPort, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs) -and $client.Connected
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

function Resolve-QaHost([string]$Preferred, [int]$TargetPort) {
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($Preferred) { [void]$candidates.Add($Preferred) }
  # Prefer WSL eth0 IPv4: Java resolves "localhost" -> 127.0.0.1 which is OBSERVED broken
  # for WSL2 Paper on this machine (TcpClient to 127.0.0.1:25565 fails; eth0 works).
  try {
    $wslIp = (wsl -e bash -lc "hostname -I | awk '{print `$1}'").Trim()
    if ($wslIp -and $wslIp -match '^\d+\.\d+\.\d+\.\d+$' -and -not $candidates.Contains($wslIp)) {
      [void]$candidates.Add($wslIp)
    }
  } catch {}
  foreach ($h in @("localhost", "::1")) {
    if (-not $candidates.Contains($h)) { [void]$candidates.Add($h) }
  }
  # Last resort - usually fails on this host
  if (-not $candidates.Contains("127.0.0.1")) { [void]$candidates.Add("127.0.0.1") }

  foreach ($h in $candidates) {
    if (Test-TcpOpen $h $TargetPort) {
      return $h
    }
  }
  throw "BLOCKED: Paper QA not reachable on port $TargetPort (tried: $($candidates -join ', ')). Is tmux civs-qa up?"
}

function Write-ServersDat([string]$Path, [string]$Name, [string]$Address) {
  # Uncompressed NBT: root compound -> list "servers" of one compound {hidden, ip, name}
  $enc = [System.Text.Encoding]::UTF8
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $be16 = { param([int]$n) $bw.Write([byte](($n -shr 8) -band 0xFF)); $bw.Write([byte]($n -band 0xFF)) }
  $be32 = {
    param([int]$n)
    $bw.Write([byte](($n -shr 24) -band 0xFF)); $bw.Write([byte](($n -shr 16) -band 0xFF))
    $bw.Write([byte](($n -shr 8) -band 0xFF)); $bw.Write([byte]($n -band 0xFF))
  }
  $nbtStr = {
    param([string]$s)
    $bytes = $enc.GetBytes($s)
    & $be16 $bytes.Length
    $bw.Write($bytes)
  }

  $bw.Write([byte]0x0A); & $be16 0                          # TAG_Compound ""
  $bw.Write([byte]0x09); & $nbtStr "servers"               # TAG_List "servers"
  $bw.Write([byte]0x0A); & $be32 1                         # compounds, count=1
  $bw.Write([byte]0x01); & $nbtStr "hidden"; $bw.Write([byte]0)
  $bw.Write([byte]0x08); & $nbtStr "ip"; & $nbtStr $Address
  $bw.Write([byte]0x08); & $nbtStr "name"; & $nbtStr $Name
  $bw.Write([byte]0x00)                                    # end element
  $bw.Write([byte]0x00)                                    # end root
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($Path, $ms.ToArray())
  $bw.Close(); $ms.Close()
}

function Update-ViewerOptions([string]$OptionsPath, [string]$LastServer) {
  $lines = @()
  if (Test-Path $OptionsPath) {
    $lines = Get-Content $OptionsPath
  }
  $map = @{
    "skipMultiplayerWarning" = "true"
    "joinedFirstServer"      = "true"
    "onboardAccessibility"   = "false"
    "lastServer"             = $LastServer
    "fullscreen"             = "false"
  }
  $keysDone = @{}
  $out = foreach ($line in $lines) {
    if ($line -match '^([^:]+):(.*)$') {
      $k = $Matches[1]
      if ($map.ContainsKey($k)) {
        $keysDone[$k] = $true
        "${k}:$($map[$k])"
        continue
      }
    }
    $line
  }
  foreach ($k in $map.Keys) {
    if (-not $keysDone.ContainsKey($k)) { $out += "${k}:$($map[$k])" }
  }
  [System.IO.File]::WriteAllLines($OptionsPath, [string[]]$out)
}

function Send-Rcon([string]$RconHost, [int]$Port, [string]$Password, [string]$Command) {
  # Always use WSL node + committed helper (Windows PATH often lacks node).
  $runner = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  $script = Join-Path $PSScriptRoot "_rcon_once.js"
  if (-not (Test-Path $script)) { throw "Missing $script" }
  $toWsl = {
    param([string]$winPath)
    $p = $winPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):') { return '/mnt/' + $Matches[1].ToLower() + $p.Substring(2) }
    return $p
  }
  $runnerWsl = & $toWsl $runner
  $scriptWsl = & $toWsl $script
  $cmdEsc = $Command -replace "'", "'\''"
  return (wsl -e bash -lc "export PATH=`"`$HOME/.nvm/versions/node/v25.8.0/bin:`$PATH`"; cd '$runnerWsl'; H='$RconHost' P='$Port' PW='$Password' CMD='$cmdEsc' node '$scriptWsl'")
}

function Show-MinecraftWindow([int]$WinWidth, [int]$WinHeight) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CivsWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@ -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Get-Process java -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "Minecraft*" -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
    ForEach-Object {
      [void][CivsWin]::ShowWindow($_.MainWindowHandle, 9) # SW_RESTORE
      [void][CivsWin]::SetWindowPos($_.MainWindowHandle, [IntPtr]::Zero, 80, 80, $WinWidth + 16, $WinHeight + 39, 0x0040)
      [void][CivsWin]::SetForegroundWindow($_.MainWindowHandle)
      Write-Host "Focused window: $($_.MainWindowTitle) pid=$($_.Id)"
    }
}

# --- main ---
$mc = Join-Path $env:APPDATA ".minecraft"
$verDir = Join-Path $mc "versions\$Version"
$clientJar = Join-Path $verDir "$Version.jar"
$verJsonPath = Join-Path $verDir "$Version.json"
$java = "C:\Program Files\Eclipse Adoptium\jdk-25.0.3.9-hotspot\bin\java.exe"
if (-not (Test-Path $java)) { $java = (Get-Command java).Source }
if (-not (Test-Path $clientJar)) { throw "Missing client jar: $clientJar" }
if (-not (Test-Path $verJsonPath)) { throw "Missing version json: $verJsonPath" }

$HostName = Resolve-QaHost -Preferred $HostName -TargetPort $Port
$quickPlay = "${HostName}:${Port}"
Write-Host "QA reachable at $quickPlay"

if ($KillExisting) {
  Get-Process java -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "Minecraft*" } |
    ForEach-Object {
      Write-Host "Stopping stale Minecraft pid=$($_.Id) ($($_.MainWindowTitle))"
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
  Start-Sleep -Milliseconds 500
}

$ver = Get-Content $verJsonPath -Raw | ConvertFrom-Json
$libs = Join-Path $mc "libraries"
$cp = New-Object System.Collections.Generic.List[string]
foreach ($lib in $ver.libraries) {
  $rulesOk = $true
  if ($lib.rules) {
    $rulesOk = $false
    foreach ($rule in $lib.rules) {
      $osOk = $true
      if ($rule.os -and $rule.os.name -and $rule.os.name -ne "windows") { $osOk = $false }
      if ($rule.action -eq "allow" -and $osOk) { $rulesOk = $true }
      if ($rule.action -eq "disallow" -and $osOk) { $rulesOk = $false }
    }
  }
  if (-not $rulesOk) { continue }
  if ($lib.natives -and $lib.natives.windows) { continue }
  $artifact = $lib.downloads.artifact
  if (-not $artifact -or -not $artifact.path) { continue }
  $p = Join-Path $libs ($artifact.path -replace "/", "\")
  if (Test-Path $p) { [void]$cp.Add($p) }
}
[void]$cp.Add($clientJar)
$classpath = ($cp | Select-Object -Unique) -join ";"

$natives = Join-Path $verDir "natives"
$assets = Join-Path $mc "assets"
# Deterministic offline-ish UUID (not Mojang); online-mode=false accepts it.
$uuid = "00000000000000000000000000000001"

$gameDir = Join-Path $mc "civs-qa-viewer"
New-Item -ItemType Directory -Force -Path $gameDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $gameDir "logs") | Out-Null

Write-ServersDat -Path (Join-Path $gameDir "servers.dat") -Name "Civs QA NpcPad" -Address $quickPlay
Update-ViewerOptions -OptionsPath (Join-Path $gameDir "options.txt") -LastServer $quickPlay

$quickPlayLog = Join-Path $gameDir "quickPlayLog.json"
$argList = @(
  "-Xmx2G",
  "-Djava.library.path=$natives",
  "-Djna.tmpdir=$natives",
  "-Dorg.lwjgl.system.SharedLibraryExtractPath=$natives",
  "-Dio.netty.native.workdir=$natives",
  "-cp", $classpath,
  $ver.mainClass,
  "--username", $Username,
  "--version", $Version,
  "--gameDir", $gameDir,
  "--assetsDir", $assets,
  "--assetIndex", $ver.assetIndex.id,
  "--uuid", $uuid,
  "--accessToken", "0",
  "--versionType", "release",
  "--width", "$Width",
  "--height", "$Height",
  "--quickPlayMultiplayer", $quickPlay,
  "--quickPlayPath", $quickPlayLog
)

Write-Host "Launching $Username -> quickPlayMultiplayer $quickPlay (version $Version)"
Write-Host "Client will auto-join; RCON will set spectator + spectate $SpectateTarget"

$proc = Start-Process -FilePath $java -ArgumentList $argList -WorkingDirectory $gameDir -PassThru
Write-Host "Client PID $($proc.Id) started."

Show-MinecraftWindow -WinWidth $Width -WinHeight $Height

Write-Host ""
Write-Host "WATCH NOW:"
Write-Host "  1. Minecraft window titled 'Minecraft $Version' (pid $($proc.Id))"
Write-Host "  2. Should auto-connect to $quickPlay as $Username"
Write-Host "  3. If stuck on title: Multiplayer -> 'Civs QA NpcPad' (address $quickPlay - NOT 127.0.0.1)"
Write-Host "  4. Village pad ~ 5200 80 5200; Cam follows Steve"
Write-Host ""
Write-Host "Log: $gameDir\logs\latest.log"

# Wait briefly and report join evidence from client log
Start-Sleep -Seconds 10
$logPath = Join-Path $gameDir "logs\latest.log"
if (Test-Path $logPath) {
  $tail = Get-Content $logPath -Tail 50
  $ignored = @($tail | Where-Object { $_ -match "Completely ignored arguments" })
  $connErr = @($tail | Where-Object { $_ -match "Couldn.t connect|Connection refused" })
  $connecting = @($tail | Where-Object { $_ -match "Connecting to|\[CHAT\]|Logged in" })
  if ($ignored.Count) { Write-Host "LOG: $($ignored[-1])" }
  if ($connErr.Count) { Write-Host "LOG ERROR: $($connErr[-1])" -ForegroundColor Red }
  if ($connecting.Count) { Write-Host "LOG: $($connecting[-1])" -ForegroundColor Green }
}

if (-not $SkipAutoSpectate) {
  $rconHost = Resolve-QaHost -Preferred $HostName -TargetPort $RconPort
  $runnerDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  Write-Host "Waiting for $Username on RCON ${rconHost}:$RconPort (max ${JoinTimeoutSec}s)..."
  $deadline = (Get-Date).AddSeconds($JoinTimeoutSec)
  $joined = $false
  Push-Location $runnerDir
  try {
    while ((Get-Date) -lt $deadline) {
      try {
        $list = Send-Rcon -RconHost $rconHost -Port $RconPort -Password $RconPassword -Command "list"
        Write-Host "  /list => $list"
        if ($list -match "\b$([regex]::Escape($Username))\b") {
          $joined = $true
          break
        }
      } catch {
        Write-Host "  RCON poll: $_"
      }
      Start-Sleep -Seconds 3
    }
    if (-not $joined) {
      Write-Host "AUTO-SPECTATE TIMEOUT: $Username never appeared in /list" -ForegroundColor Yellow
    } else {
      Start-Sleep -Seconds 2
      foreach ($op in @(
        "gamemode spectator $Username",
        "execute as $Username run spectate $SpectateTarget",
        "tp $Username $SpectateTarget"
      )) {
        $r = Send-Rcon -RconHost $rconHost -Port $RconPort -Password $RconPassword -Command $op
        Write-Host "RCON: $op => $r"
      }
      Write-Host "PASS: $Username should now be spectating $SpectateTarget" -ForegroundColor Green
      Write-Host "Starting continuous Viewer follow loop (Ctrl+C in this window stops re-assert only)..."
      $followDeadline = (Get-Date).AddHours(12)
      $n = 0
      while ((Get-Date) -lt $followDeadline) {
        Start-Sleep -Seconds 3
        $n++
        try {
          foreach ($op in @(
            "gamemode spectator $Username",
            "execute as $Username run spectate $SpectateTarget"
          )) {
            $null = Send-Rcon -RconHost $rconHost -Port $RconPort -Password $RconPassword -Command $op
          }
          if ($n -eq 1 -or $n % 20 -eq 0) {
            Write-Host "VIEWER_FOLLOW sync #$n -> spectate $SpectateTarget"
          }
        } catch {
          Write-Host "VIEWER_FOLLOW error: $_" -ForegroundColor Yellow
        }
      }
    }
  } finally {
    Pop-Location
  }
}
