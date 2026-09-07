# Put JR!TER on this machine, in one line.
#
#     irm https://raw.githubusercontent.com/Lonezsi/JR-TER/main/install.ps1 | iex
#
# It finds or installs Python, fetches the code, makes a Start menu and desktop shortcut,
# and starts the library. Run it again later and it updates in place: your data directory
# is never touched, so an update is safe on a machine that already holds music.
#
# Options come from environment variables rather than parameters, because a script being
# piped into iex has no way to receive parameters:
#
#     $env:JRITER_DIR       where to put it        (default: %LOCALAPPDATA%\Programs\JR-TER)
#     $env:JRITER_BRANCH    which branch to take   (default: main)
#     $env:JRITER_PORT      which port to serve on (default: 7900)
#     $env:JRITER_NOSTART   set to 1 to install without starting it
#
# Nothing here chooses a password, and nothing here needs administrator. The server prints
# a one time setup code the first time it runs and the first person to present that code
# chooses the password.

$ErrorActionPreference = 'Stop'

# GitHub has not accepted TLS 1.0 for years, and Windows PowerShell still offers it first
# on an untouched machine. Without this line the download fails with a closed connection
# and no explanation of which end closed it.
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol
} catch { }

$Repo   = 'Lonezsi/JR-TER'
$Branch = if ($env:JRITER_BRANCH) { $env:JRITER_BRANCH } else { 'main' }
$Port   = if ($env:JRITER_PORT)   { $env:JRITER_PORT }   else { '7900' }
$Dir    = if ($env:JRITER_DIR)    { $env:JRITER_DIR }
          else { Join-Path $env:LOCALAPPDATA 'Programs\JR-TER' }

function Say  ($t) { Write-Host "  $t" }
function Step ($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Warn ($t) { Write-Host "  $t" -ForegroundColor Yellow }

Write-Host ''
Write-Host 'JR!TER' -ForegroundColor Green
Write-Host '  a personal music workspace'

# ── Python ───────────────────────────────────────────────────────────────────
# Standard library only, so this is the entire dependency list. 3.9 is the floor because
# the code uses dict merging and a few typing niceties from around then; anything newer is
# fine and nothing here pins a version.
Step 'Looking for Python'

function Find-Python {
  # py.exe first: the launcher knows about every Python on the machine and picks the
  # newest, which "python" on PATH does not. On a machine with the Store's stub python.exe
  # in PATH, asking for "python" opens the Store instead of running anything, and the
  # launcher is how you get past that.
  foreach ($try in @(@('py', '-3'), @('python3'), @('python'))) {
    $exe = $try[0]
    $found = Get-Command $exe -ErrorAction SilentlyContinue
    if (-not $found) { continue }
    $args = @()
    if ($try.Count -gt 1) { $args = $try[1..($try.Count - 1)] }
    # No quotes anywhere in that one liner, and it is not a style choice.
    #
    # Windows PowerShell builds the command line for a native exe by joining the arguments
    # and it does not escape double quotes inside them, so a perfectly ordinary
    # 'print("%d.%d" % sys.version_info[:2])' reaches python.exe as
    # 'print(%d.%d%sys.version_info[:2])' and dies of a SyntaxError. Measured, not guessed:
    # the first version of this function reported no Python on a machine with three, and
    # then installed a fourth that it also could not see.
    try {
      $out = & $exe @args '-c' 'import sys;print(sys.version_info[0], sys.version_info[1])' 2>$null
    } catch { continue }
    if ($LASTEXITCODE -ne 0 -or -not $out) { continue }
    $parts = "$out".Trim().Split(' ')
    if ($parts.Count -lt 2) { continue }
    if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 9) {
      return [pscustomobject]@{
        Exe = $found.Source; Args = $args
        Version = ($parts[0] + '.' + $parts[1])
      }
    }
  }
  return $null
}

$py = Find-Python
if (-not $py) {
  Say 'not found'
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Step 'Installing Python'
    Say 'this takes a minute and asks nothing of you'
    winget install --id Python.Python.3.12 --source winget `
      --accept-package-agreements --accept-source-agreements --silent
    # winget puts it on the PATH of new processes, not of this one, so the machine's PATH
    # is re-read here rather than making the person open a new window and start again.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
    $py = Find-Python
  }
  if (-not $py) {
    Warn 'Python 3.9 or newer is needed and could not be installed automatically.'
    Warn 'Get it from https://www.python.org/downloads/ , tick "Add python.exe to PATH",'
    Warn 'then run this line again.'
    return
  }
}
Say ("Python {0} at {1}" -f $py.Version, $py.Exe)

# ── the code ─────────────────────────────────────────────────────────────────
Step 'Fetching JR!TER'

$git = Get-Command git -ErrorAction SilentlyContinue
$isCheckout = Test-Path (Join-Path $Dir '.git')

if ($isCheckout -and $git) {
  # An update, and it must not throw away work done on this machine. --ff-only rather than
  # a merge or a reset: if the checkout has its own commits the pull stops and says so,
  # which is the right outcome for the machine JR!TER is developed on.
  Say "updating the checkout at $Dir"
  Push-Location $Dir
  try {
    & git fetch --quiet origin $Branch
    & git merge --ff-only ("origin/" + $Branch)
    if ($LASTEXITCODE -ne 0) {
      Warn 'this checkout has changes of its own, so it was left alone.'
      Warn 'commit or stash them and run this again to update.'
    }
  } finally { Pop-Location }
}
elseif ($git -and -not (Test-Path $Dir)) {
  Say "cloning into $Dir"
  & git clone --quiet --branch $Branch ("https://github.com/{0}.git" -f $Repo) $Dir
  if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
}
else {
  # No git, or a directory that is not a checkout. Take the zip GitHub builds for any
  # branch: it needs nothing installed and it is the same tree.
  $zipUrl = "https://codeload.github.com/$Repo/zip/refs/heads/$Branch"
  $work = Join-Path ([IO.Path]::GetTempPath()) ("jriter-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  try {
    $zip = Join-Path $work 'jriter.zip'
    Say 'downloading'
    # The progress bar makes Invoke-WebRequest many times slower on a large file, and this
    # is several megabytes of it.
    $before = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try { Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing }
    finally { $ProgressPreference = $before }

    Expand-Archive -Path $zip -DestinationPath $work -Force
    $tree = Get-ChildItem -Path $work -Directory | Where-Object { $_.Name -like 'JR-TER-*' } |
            Select-Object -First 1
    if (-not $tree) { throw 'the download did not contain the expected folder' }

    New-Item -ItemType Directory -Path $Dir -Force | Out-Null
    # Everything except data. This is the line that makes re-running safe on a machine
    # that already holds a library: the code is replaced, the music is not.
    Say "writing to $Dir"
    Get-ChildItem -Path $tree.FullName -Force |
      Where-Object { $_.Name -ne 'data' } |
      ForEach-Object { Copy-Item $_.FullName -Destination $Dir -Recurse -Force }
  } finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path (Join-Path $Dir 'server.py'))) {
  throw "something went wrong: there is no server.py in $Dir"
}

# ── the shortcuts ────────────────────────────────────────────────────────────
Step 'Making shortcuts'

# Two shortcuts, because there are two different things a machine can be.
#
# The app is the everyday one: it watches your render folders, sends what lands in them, and
# is the icon that sits on the taskbar. The server is the library itself, which one machine
# somewhere has to be running; on a laptop that is usually not this one, and the app's Open
# library button goes wherever the library actually lives.
#
# A .cmd for the server rather than a shortcut straight to python, so double clicking works
# from anywhere and the window stays up long enough to read if it refuses to start.
$launcher = Join-Path $Dir 'JR-TER.cmd'
@(
  '@echo off'
  'rem Start JR!TER and open it in a browser. Made by install.ps1; safe to delete and remake.'
  'title JR!TER'
  ('cd /d "{0}"' -f $Dir)
  ('"{0}" {1} server.py --port {2} --open' -f $py.Exe, ($py.Args -join ' '), $Port)
  'echo.'
  'echo JR!TER has stopped. Press a key to close this window.'
  'pause >nul'
) | Set-Content -Path $launcher -Encoding ASCII

function New-Shortcut($linkPath, $target, $workdir, $icon, $arguments) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($linkPath)
  $link.TargetPath = $target
  if ($arguments) { $link.Arguments = $arguments }
  $link.WorkingDirectory = $workdir
  $link.Description = 'JR!TER, a personal music workspace'
  if ($icon -and (Test-Path $icon)) { $link.IconLocation = $icon }
  $link.Save()
}

$icon = Join-Path $Dir 'web\favicon.ico'
$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$deskDir  = [Environment]::GetFolderPath('Desktop')

# pythonw for the app, so logon does not put a console in the taskbar beside the window.
$appScript = Join-Path $Dir 'client\jriter_app.py'
$windowless = Join-Path (Split-Path $py.Exe -Parent) 'pythonw.exe'
$appRunner = if (Test-Path $windowless) { $windowless } else { $py.Exe }

foreach ($pair in @(
    @{ Name = 'JR!TER.lnk';        Target = $appRunner; Args = ('"{0}"' -f $appScript) },
    @{ Name = 'JR!TER Server.lnk'; Target = $launcher;  Args = '' })) {
  foreach ($into in @($programs, $deskDir)) {
    $link = Join-Path $into $pair.Name
    try {
      New-Shortcut $link $pair.Target $Dir $icon $pair.Args
      Say ("{0} in {1}" -f $pair.Name, (Split-Path $into -Leaf))
    } catch {
      Warn ("could not make " + $pair.Name + ": " + $_.Exception.Message)
    }
  }
}

# ── part of the machine ──────────────────────────────────────────────────────
# Autostart and the right click menu, both per user, both reversible, neither needing an
# administrator. This is the difference between a folder of code and something installed.
Step 'Wiring it into Windows'
Push-Location (Join-Path $Dir 'client')
try {
  & $py.Exe @($py.Args) 'jriter_client.py' 'install'
} catch {
  Warn ('autostart and the right click menu could not be set up: ' + $_.Exception.Message)
} finally { Pop-Location }

# ── go ───────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host 'Installed.' -ForegroundColor Green
Say "code      $Dir"
Say "data      $Dir\data"
Say "library   http://127.0.0.1:$Port"
Write-Host ''
Say 'From now on: the JR!TER shortcut on your desktop. It watches your render folders and'
Say 'starts by itself when you log on. JR!TER Server is the library itself, for whichever'
Say 'machine is meant to be holding it.'
Say 'To update:   run this same line again.'
Say 'To keep it running with nobody logged in, so you can reach it from your phone:'
Say ("  powershell -ExecutionPolicy Bypass -File `"{0}\hostsetup\Install-JriterHost.ps1`"" -f $Dir)

if ($env:JRITER_NOSTART -eq '1') { return }

Write-Host ''
Step 'Starting it'
Say 'the first run prints a setup code; the browser will ask you for it'
Start-Process -FilePath $launcher -WorkingDirectory $Dir
