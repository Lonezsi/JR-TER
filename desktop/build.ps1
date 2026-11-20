# Builds the JR!TER desktop app: JRITER.exe (tray, no console) and jriter-cli.exe (commands).
# Needs JDK 21 with jpackage and Maven. Output: desktop\target\dist\JRITER and a zip beside it.
$ErrorActionPreference = "Stop"
# JAVA_HOME is often an older JDK, so ask for the 21 explicitly (JRITER_JDK to override).
$jdk = if ($env:JRITER_JDK) { $env:JRITER_JDK } else { "C:\Java\jdk-21" }
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;C:\Maven\apache-maven-3.9.9\bin;$env:Path"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $root
mvn -q -f "$root\pom.xml" package
if ($LASTEXITCODE) { throw "mvn failed" }
$in = "$root\target\input"
Remove-Item -Recurse -Force $in, "$root\target\dist" -ErrorAction SilentlyContinue
New-Item -ItemType Directory $in | Out-Null
Copy-Item "$root\target\jriter-desktop-0.1.0.jar", "$root\target\lib\*.jar" $in
$icon = @()
if (Test-Path "$repo\web\favicon.ico") { $icon = @("--icon", "$repo\web\favicon.ico") }
& "$jdk\bin\jpackage.exe" --type app-image --name JRITER --input $in --main-jar jriter-desktop-0.1.0.jar `
    --main-class dev.jriter.desktop.Main --dest "$root\target\dist" `
    --add-launcher jriter-cli="$root\cli.properties" @icon
if ($LASTEXITCODE) { throw "jpackage failed" }
Compress-Archive -Path "$root\target\dist\JRITER" -DestinationPath "$root\target\JRITER-0.1.0-win.zip" -Force
Write-Host "Built $root\target\dist\JRITER\JRITER.exe and jriter-cli.exe"

