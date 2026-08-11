# Launch official Minecraft 26.1.2 client offline against local QA (online-mode=false).
# Watch the village build: join as Viewer, then `/spectate Cam` or `/tp Viewer Cam`.
param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 25565,
  [string]$Username = "Viewer",
  [string]$Version = "26.1.2",
  [int]$Width = 1280,
  [int]$Height = 720
)

$ErrorActionPreference = "Stop"
$mc = Join-Path $env:APPDATA ".minecraft"
$verDir = Join-Path $mc "versions\$Version"
$clientJar = Join-Path $verDir "$Version.jar"
$verJsonPath = Join-Path $verDir "$Version.json"
$java = "C:\Program Files\Eclipse Adoptium\jdk-25.0.3.9-hotspot\bin\java.exe"
if (-not (Test-Path $java)) { $java = (Get-Command java).Source }
if (-not (Test-Path $clientJar)) { throw "Missing client jar: $clientJar" }
if (-not (Test-Path $verJsonPath)) { throw "Missing version json: $verJsonPath" }

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
  if ($lib.natives -and $lib.natives.windows) { continue } # natives on -Djava.library.path
  $artifact = $lib.downloads.artifact
  if (-not $artifact -or -not $artifact.path) { continue }
  $p = Join-Path $libs ($artifact.path -replace "/", "\")
  if (Test-Path $p) { [void]$cp.Add($p) }
}
[void]$cp.Add($clientJar)
$classpath = ($cp | Select-Object -Unique) -join ";"

$natives = Join-Path $verDir "natives"
$assets = Join-Path $mc "assets"
$uuid = [guid]::NewGuid().ToString("N").Substring(0, 32)
# Offline UUID-ish
$uuid = "00000000000000000000000000000001"

$gameDir = Join-Path $mc "civs-qa-viewer"
New-Item -ItemType Directory -Force -Path $gameDir | Out-Null

$quickPlay = "${HostName}:${Port}"
Write-Host "Launching $Username → $quickPlay (version $Version)"
Write-Host "After join: /gamemode spectator then /spectate Cam   (or /tp @s Cam)"

$args = @(
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
  "--userType", "legacy",
  "--versionType", "release",
  "--width", "$Width",
  "--height", "$Height",
  "--server", $HostName,
  "--port", "$Port"
)

Start-Process -FilePath $java -ArgumentList $args -WorkingDirectory $gameDir
Write-Host "Client process started. Window should appear if GPU/drivers OK."
