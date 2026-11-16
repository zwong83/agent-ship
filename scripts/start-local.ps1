param([switch]$Build)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'AgentShip/runtime'
$jdk = Get-ChildItem $runtimeRoot -Directory -Filter 'jdk-21*' | Select-Object -First 1
if (!$jdk) { throw "Java 21 is required in $runtimeRoot." }
$env:JAVA_HOME = $jdk.FullName
$env:Path = "$env:JAVA_HOME/bin;$env:Path"
$postgresBin = 'C:/Program Files/PostgreSQL/16/bin'
$dataDir = Join-Path $env:LOCALAPPDATA 'AgentShip/postgres-data'
$passwordFile = Join-Path $projectRoot '.agentship/postgres-password'
if (!(Test-Path $passwordFile) -or !(Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
    throw 'The local AgentShip PostgreSQL database has not been initialized.'
}
& "$postgresBin/pg_ctl.exe" -D $dataDir status *> $null
if ($LASTEXITCODE -ne 0) {
    & "$postgresBin/pg_ctl.exe" -D $dataDir -l (Join-Path $env:LOCALAPPDATA 'AgentShip/postgres.log') -o '-h 127.0.0.1 -p 55432' start
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start.' }
}
if ($Build) {
    Push-Location frontend
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        & npx.cmd --no-install tsc --noEmit
        if ($LASTEXITCODE -ne 0) { throw 'TypeScript validation failed.' }
        & npx.cmd --no-install vite build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
    & mvn.cmd --batch-mode --no-transfer-progress -f platform/pom.xml package -DskipTests
    if ($LASTEXITCODE -ne 0) { throw 'Platform build failed.' }
}
$verificationFile = Join-Path $projectRoot '.agentship/verification-key'
if (!(Test-Path $verificationFile)) {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') | Set-Content -NoNewline $verificationFile
}
$env:AGENTSHIP_JDBC_URL = 'jdbc:postgresql://127.0.0.1:55432/agentship'
$env:AGENTSHIP_DB_USER = 'agentship_dev'
$env:AGENTSHIP_DB_PASSWORD = Get-Content $passwordFile -Raw
$env:AGENTSHIP_VERIFICATION_KEY = Get-Content $verificationFile -Raw
$env:AGENTSHIP_LOCAL_VERIFICATION = 'true'
$env:AGENTSHIP_REQUIRE_CONTACT_VERIFICATION = 'false'
$env:AGENTSHIP_SECURE_COOKIE = 'false'
$env:AGENTSHIP_BIND_ADDRESS = '127.0.0.1'
$env:AGENTSHIP_PORT = '4173'
Write-Host 'Starting AgentShip at http://127.0.0.1:4173. Press Ctrl+C to stop the website.'
try {
    & "$env:JAVA_HOME/bin/java.exe" -jar platform/target/agentship-platform-0.1.0-SNAPSHOT.jar
} finally {
    Remove-Item Env:AGENTSHIP_DB_PASSWORD, Env:AGENTSHIP_VERIFICATION_KEY -ErrorAction SilentlyContinue
}
