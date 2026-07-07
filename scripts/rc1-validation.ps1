# BANCO STORE RC-1 Release Validation
# Usage: .\scripts\rc1-validation.ps1
# Logs: audit/rc1/*.log

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "audit\rc1"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$env:Path = "C:\Users\waelz\tools\node;$env:Path"
$env:ESBUILD_BINARY_PATH = "C:\Users\waelz\tools\esbuild-win32\package\esbuild.exe"
if (-not $env:DATABASE_URL) {
  $env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/banco_test"
}
$env:TZ = "UTC"
$env:CI = "true"

$results = @()

function Log-Step([string]$Name, [scriptblock]$Block) {
  $logFile = Join-Path $LogDir (($Name -replace '[^\w\-]', '-') + ".log")
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    & $Block 2>&1 | Tee-Object -FilePath $logFile
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
  } catch {
    $_ | Tee-Object -FilePath $logFile
    $code = 1
  }
  $sw.Stop()
  $status = if ($code -eq 0) { "PASS" } else { "FAIL" }
  $results += [PSCustomObject]@{ Step = $Name; Status = $status; ExitCode = $code; Ms = $sw.ElapsedMilliseconds; Log = $logFile }
  Write-Host "[$status] $Name ($($sw.ElapsedMilliseconds)ms)" -ForegroundColor $(if ($status -eq "PASS") { "Green" } else { "Red" })
}

Set-Location $Root

Log-Step "01-typecheck" { pnpm run typecheck; exit $LASTEXITCODE }

Log-Step "02-api-server-build" { pnpm --filter @workspace/api-server run build; exit $LASTEXITCODE }

Log-Step "03-dealer-os-build" { pnpm --filter @workspace/dealer-os run build; exit $LASTEXITCODE }

Log-Step "04-admin-os-build" { pnpm --filter @workspace/admin-os run build; exit $LASTEXITCODE }

Log-Step "05-landing-build" { pnpm --filter @workspace/landing run build; exit $LASTEXITCODE }

Log-Step "06-mobile-typecheck" { pnpm --filter @workspace/banco-mobile run typecheck; exit $LASTEXITCODE }

Log-Step "07-mobile-icons-test" { pnpm --filter @workspace/banco-mobile run test:icons; exit $LASTEXITCODE }

Log-Step "07b-mobile-resilience-test" { pnpm --filter @workspace/banco-mobile run test:resilience; exit $LASTEXITCODE }

Log-Step "07c-mobile-lib-test" { pnpm --filter @workspace/banco-mobile run test:lib; exit $LASTEXITCODE }

# DB + tests
$dbUp = Get-NetTCPConnection -State Listen -LocalPort 5433 -ErrorAction SilentlyContinue
if (-not $dbUp) {
  Write-Host "[rc1] Starting Postgres on 5433..." -ForegroundColor Yellow
  Start-Process -FilePath "C:\Users\waelz\tools\pgsql\bin\pg_ctl.exe" `
    -ArgumentList '-D',"C:\Users\waelz\tools\pgdata",'-o','"-p 5433"','-l',"C:\Users\waelz\tools\pgdata\server.log",'start' `
    -WindowStyle Hidden -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
}

Log-Step "08-db-push" { pnpm --filter @workspace/db run push-force; exit $LASTEXITCODE }

Log-Step "09-db-seed" { pnpm --filter @workspace/api-server run seed; exit $LASTEXITCODE }

Log-Step "10-api-server-tests" { pnpm --filter @workspace/api-server run test; exit $LASTEXITCODE }

# Bundle size (web apps)
Log-Step "11-bundle-sizes" {
  Get-ChildItem -Recurse -File artifacts\admin-os\dist,artifacts\dealer-os\dist,artifacts\landing\dist,artifacts\api-server\dist -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum |
    ForEach-Object { "Total dist bytes: $($_.Sum)"; Get-ChildItem -Recurse -File artifacts\admin-os\dist,artifacts\dealer-os\dist,artifacts\landing\dist,artifacts\api-server\dist -ErrorAction SilentlyContinue |
      Sort-Object Length -Descending | Select-Object -First 15 FullName,Length }
  exit 0
}

# Summary
$pass = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$fail = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$summary = @"
RC-1 VALIDATION SUMMARY
=======================
PASS: $pass
FAIL: $fail
TOTAL: $($results.Count)
RATE: $([math]::Round(100 * $pass / [math]::Max(1,$results.Count), 1))%

$($results | Format-Table -AutoSize | Out-String)
"@
$summary | Tee-Object -FilePath (Join-Path $LogDir "SUMMARY.txt")
Write-Host $summary

if ($fail -gt 0) { exit 1 }
exit 0
