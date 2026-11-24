# Start the Spring JR!TER (the jar) on a machine nobody is sitting at, and keep it started.
#
# The jar's twin of Start-Jriter.ps1, which starts the Python server. Run it on the same
# repeating schedule: on a run where the library answers it does nothing, on a run where it
# does not it starts one. Switching the "JRITER Server" task over is the owner's step:
# hostsetup\Switch-JriterServer.ps1 -To jar (docs/REWORK.md, step 6). Keep Start-Jriter.ps1 as the way back.
#
# HOW AN UPDATE LANDS. The updater (Updater.java) pulls, rebuilds server\target\jriter.jar with
# Maven, and ends the process. This script then starts again, and before it does it copies
# target\jriter.jar to server\run\jriter.jar and runs THAT COPY. Windows locks a jar while it
# runs, so running target\ directly would make the next rebuild fail. The jar being replaced is
# kept as server\run\jriter.prev.jar, the way back if a new build will not start.

$ErrorActionPreference = 'Stop'

$Root   = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root 'data'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log    = Join-Path $LogDir 'host-jriter.log'
$Port   = 7900
$Built  = Join-Path $Root 'server\target\jriter.jar'
$RunDir = Join-Path $Root 'server\run'
$RunJar = Join-Path $RunDir 'jriter.jar'
$PrevJar = Join-Path $RunDir 'jriter.prev.jar'

# Logs are capped (they live in the data directory a backup copies); one previous file is kept.
$LogCap = 512KB

function Roll($path) {
    if (-not (Test-Path $path)) { return }
    if ((Get-Item $path).Length -lt $LogCap) { return }
    Move-Item -Path $path -Destination ($path + '.1') -Force -ErrorAction SilentlyContinue
}

function Say($text) {
    Roll $Log
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
    Add-Content -Path $Log -Value $line -Encoding utf8
}

# Java 21, found the same way whether or not this account has it on PATH.
function Find-Java {
    $candidates = @()
    if ($env:JRITER_JAVA) { $candidates += $env:JRITER_JAVA }
    $candidates += 'C:\Java\jdk-21\bin\java.exe'
    $onPath = (Get-Command java.exe -ErrorAction SilentlyContinue)
    if ($onPath) { $candidates += $onPath.Source }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c) -and ($c -notlike '*WindowsApps*')) { return $c }
    }
    return $null
}

# Is the library actually serving. Two tries: a request in the half second while the process
# is still binding is not a fault worth acting on.
function Test-Serving {
    foreach ($attempt in 1..2) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" `
                                   -UseBasicParsing -TimeoutSec 6
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        if ($attempt -lt 2) { Start-Sleep -Seconds 3 }
    }
    return $false
}

function Get-JriterProcesses {
    # Matched on this checkout's own copy of the jar, not on a word in a folder name.
    Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$RunJar*" }
}

if (Test-Serving) { exit 0 }        # the common case: nothing to do, say nothing

$java = Find-Java
if (-not $java) {
    Say 'no Java found; cannot start'
    exit 1
}

# Not answering. Anything still holding the jar or the port is wedged or half dead, and
# leaving it there means this script could never get the library back.
$stale = Get-JriterProcesses
if ($stale) {
    Say ("not answering but {0} process(es) present; stopping them" -f @($stale).Count)
    foreach ($p in $stale) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
    }
    Start-Sleep -Seconds 3
}

# Take a newer build into server\run, keeping the one it replaces.
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
if (Test-Path $Built) {
    if (-not (Test-Path $RunJar) -or (Get-Item $Built).LastWriteTime -gt (Get-Item $RunJar).LastWriteTime) {
        try {
            if (Test-Path $RunJar) { Copy-Item -Path $RunJar -Destination $PrevJar -Force }
            Copy-Item -Path $Built -Destination $RunJar -Force
            Say 'took the new build into server\run'
        } catch {
            Say ("could not take the new build: {0}" -f $_.Exception.Message)
        }
    }
}
if (-not (Test-Path $RunJar)) {
    Say 'no jar to run; build it with: mvn -f server package'
    exit 1
}

$env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $java)
$env:JRITER_HOME = $Root
$env:JRITER_HOST = '0.0.0.0'
# This task starts the server again whenever it stops, so the server may restart itself onto
# an update it pulled and rebuilt. See Updater.startAuto.
$env:JRITER_WATCHDOG = '1'
$env:JRITER_PORT = "$Port"

Say ("starting {0} with {1}" -f $RunJar, $java)

# Straight to a file rather than through a pipe, so nothing sits between the server and its log.
$out = Join-Path $LogDir 'host-jriter-out.log'
Roll $out
# A line on the server's stderr must not kill this script: under 'Stop', PowerShell 5.1 turns
# every redirected stderr line into a terminating error. See Start-Jriter.ps1 for the history.
$ErrorActionPreference = 'Continue'
& $java -jar $RunJar *>> $out
$ErrorActionPreference = 'Stop'
Say ("server exited with {0}" -f $LASTEXITCODE)
