# Switch the host's "JRITER Server" task between the Spring jar and the Python server.
#
#   Switch-JriterServer.ps1 -To jar      run Start-JriterJar.ps1 (the jar on 7900)
#   Switch-JriterServer.ps1 -To python   run Start-Jriter.ps1 (server.py on 7900), the way back
#
# Run it from an ELEVATED PowerShell: the task runs as SYSTEM. It only changes what the task
# runs; triggers and account are left alone. Before changing anything it saves the task as XML in
# hostsetup\task-backup\, and if the jar does not answer within 90 seconds it switches back to
# Python by itself. Same data either way (the jar reads the same library).
#
# To restore a saved task by hand:
#   Register-ScheduledTask -Xml (Get-Content FILE -Raw) -TaskName 'JRITER Server' -Force

param([Parameter(Mandatory)][ValidateSet('jar', 'python')][string]$To)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Task = 'JRITER Server'
$Port = 7900

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Run this from an elevated PowerShell.'; exit 1 }

if ($To -eq 'jar' -and -not (Test-Path (Join-Path $Root 'server\target\jriter.jar'))) {
    Write-Host 'No jar built yet. Build it with:'
    Write-Host "  `$env:JAVA_HOME='C:\Java\jdk-21'; mvn -f `"$Root\server`" package -DskipTests"
    exit 1
}

$script = if ($To -eq 'jar') { 'Start-JriterJar.ps1' } else { 'Start-Jriter.ps1' }

# Back the task up first.
$bdir = Join-Path $PSScriptRoot 'task-backup'
New-Item -ItemType Directory -Force -Path $bdir | Out-Null
$backup = Join-Path $bdir ("JRITER-Server-{0}.xml" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Export-ScheduledTask -TaskName $Task | Set-Content -Path $backup -Encoding unicode
Write-Host "Task saved to $backup"

$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Root\hostsetup\$script`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $Root
Set-ScheduledTask -TaskName $Task -Action $action | Out-Null

# Stop whatever serves now, matched on this checkout's own paths.
Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
$py  = Join-Path $Root 'server.py'
$jar = Join-Path $Root 'server\run\jriter.jar'
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and (
        ($_.Name -eq 'python.exe' -and $_.CommandLine -like "*$py*") -or
        ($_.Name -eq 'java.exe' -and $_.CommandLine -like "*$jar*")) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName $Task

$ok = $false
foreach ($i in 1..30) {
    Start-Sleep -Seconds 3
    try {
        if ((Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { $ok = $true; break }
    } catch { }
}

if ($ok) { Write-Host "JR!TER now runs on $To."; exit 0 }
if ($To -eq 'jar') {
    Write-Host 'The jar did not answer in 90 seconds. Going back to Python.'
    & $PSCommandPath -To python
    exit 1
}
Write-Host "Python did not answer either. Logs: $Root\data\host-jriter.log and host-jriter-out.log"
Write-Host "Restore the saved task: Register-ScheduledTask -Xml (Get-Content '$backup' -Raw) -TaskName '$Task' -Force"
exit 1
