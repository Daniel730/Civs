# Isolated camera recovery via RCON on WSL Paper QA. Does not touch OBS.
param(
  [string]$Camera = 'Cam',
  [string]$Target = 'Steve',
  [string]$RconPassword = 'civsqa'
)

$ErrorActionPreference = 'Continue'
Write-Host "RECOVERING camera=$Camera target=$Target"

# Write script into the repo (always mounted at /mnt/c/...) to avoid broken wslpath
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$tmp = Join-Path $repoRoot 'integration-tests\runner\reports\stream\recover-camera-tmp.py'
New-Item -ItemType Directory -Force -Path (Split-Path $tmp) | Out-Null

$py = @'
import socket, struct, sys
host, port, pwd = "127.0.0.1", 25575, sys.argv[1]
camera, target = sys.argv[2], sys.argv[3]

def rcon(cmd):
    s = socket.create_connection((host, port), timeout=5)
    def send(req_id, req_type, payload):
        body = struct.pack("<ii", req_id, req_type) + payload.encode("utf8") + b"\x00\x00"
        s.sendall(struct.pack("<i", len(body)) + body)
    def recv():
        raw = s.recv(4)
        if len(raw) < 4:
            return b""
        (length,) = struct.unpack("<i", raw)
        return s.recv(length)
    send(1, 3, pwd)
    recv()
    send(2, 2, cmd)
    out = recv()
    s.close()
    return out

for c in [f"gamemode spectator {camera}", f"execute as {camera} run spectate {target}"]:
    try:
        print(c, rcon(c))
    except Exception as e:
        print("FAILED", c, e)
        sys.exit(2)
print("PASS")
'@

Set-Content -Path $tmp -Value $py -Encoding UTF8
$mnt = '/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner/reports/stream/recover-camera-tmp.py'
wsl -e bash -lc "python3 $mnt '$RconPassword' '$Camera' '$Target'"
$code = $LASTEXITCODE
if ($code -eq 0) { Write-Host 'HEALTHY: spectate re-asserted' } else { Write-Host "FAILED: exit $code" }
exit $code
