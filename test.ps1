<#
Runs the backend's automated tests (Backend/tests) in Docker.

    .\test.ps1                 # all tests
    .\test.ps1 -k sessions     # only tests whose name contains "sessions"
    .\test.ps1 -x              # stop at the first failure

It starts its OWN throwaway Postgres container on a private Docker network, runs the tests in a
fresh Python container, then removes both. The real database (postgres-db / caic_db), the
running app and Backend\.env are never used or touched, so it's safe to run any time, even
while the app is live. Backend is mounted read-only.

First run downloads the images and Python packages (a minute or two); later runs reuse them.
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PytestArgs)

# Not "Stop": in Windows PowerShell, docker writing to stderr would then count as a failure
$ErrorActionPreference = "Continue"
$code = 1
$backend = Join-Path $PSScriptRoot "Backend"
$net = "caic-test-net"
$db = "caic-test-db"

function Remove-TestContainers {
    docker rm -f $db 2>$null | Out-Null
    docker network rm $net 2>$null | Out-Null
}

docker version --format "{{.Server.Version}}" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Docker isn't running. Start Docker Desktop and try again." -ForegroundColor Red; exit 1 }

Remove-TestContainers  # leftovers from a run that was interrupted
try {
    Write-Host "Starting a throwaway test database..." -ForegroundColor Cyan
    docker network create $net | Out-Null
    docker run -d --rm --name $db --network $net `
        -e POSTGRES_PASSWORD=test -e POSTGRES_DB=caic_db_test `
        postgres:16-alpine -c fsync=off -c synchronous_commit=off | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Couldn't start the test database container." }

    $ready = $false
    foreach ($i in 1..60) {
        docker exec $db pg_isready -U postgres -d caic_db_test 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "The test database didn't start." }

    Write-Host "Running the tests..." -ForegroundColor Cyan
    $cmd = "pip install --quiet --disable-pip-version-check --root-user-action=ignore -r requirements-dev.txt " +
           "&& python -m pytest -q " + ($PytestArgs -join " ")
    docker run --rm --network $net `
        -v "${backend}:/app:ro" -w /app `
        -v caic-test-pip-cache:/root/.cache/pip `
        -e PYTHONDONTWRITEBYTECODE=1 `
        -e "TEST_DATABASE_URL=postgresql+psycopg://postgres:test@${db}:5432/caic_db_test" `
        python:3.13-slim sh -c $cmd
    $code = $LASTEXITCODE
}
finally {
    Remove-TestContainers
}

if ($code -eq 0) { Write-Host "All tests passed." -ForegroundColor Green }
else { Write-Host "Some tests failed (see above)." -ForegroundColor Red }
exit $code
