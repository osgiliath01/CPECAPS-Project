<#
.SYNOPSIS
    Deploys the app on the shared server from GitHub.

.DESCRIPTION
    Builds the code exactly as it is on GitHub (main by default), in a separate folder
    (.deploy\live) so your own working folder, branch and unsaved changes are never touched.
    Then rebuilds and restarts the Docker stack (database, backend, app, AI model server).
    Data in the database and the downloaded AI model are kept.

    Push your changes to GitHub first: only pushed commits are deployed.

.EXAMPLE
    .\deploy.ps1
    Deploys the latest main.

.EXAMPLE
    .\deploy.ps1 -Branch feature/activity-log-archiving
    Deploys a branch instead (e.g. before it is merged).

.EXAMPLE
    .\deploy.ps1 -Preview -Branch feature/new-screen
    Builds only the app screens of a branch and serves them on port 8080 as a preview,
    using the live backend and data. The live app on port 80 is not affected.

.EXAMPLE
    .\deploy.ps1 -StopPreview
    Removes the preview.

.EXAMPLE
    .\deploy.ps1 -Auto
    Deploys main only if it changed since the last deploy. Used by the automatic-deploy task
    (see install-autodeploy.ps1).
#>
param(
    [string]$Branch = "main",
    [switch]$Preview,
    [switch]$StopPreview,
    [switch]$Auto
)

# Native commands (git, docker) are checked one by one with Assert-Ok; "Stop" would make
# Windows PowerShell 5 treat their harmless messages on stderr as errors.
$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot
$DeployDir = Join-Path $Root ".deploy"
$Project = "backend"                      # Docker Compose project name: keeps the same containers and data
$Network = "${Project}_default"
$LogFile = Join-Path $DeployDir "deploy.log"

function Log([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction Stop
}

function Assert-Ok([string]$What) {
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function Get-Checkout([string]$Name, [string]$Commit) {
    # A separate checkout of the given commit in .deploy\<Name>, so the working folder is untouched
    $path = Join-Path $DeployDir $Name
    if (-not (Test-Path (Join-Path $path ".git"))) {
        if (Test-Path $path) { Remove-Item -Recurse -Force $path -ErrorAction Stop }
        git -C $Root worktree prune | Out-Null
        git -C $Root worktree add --detach --force $path $Commit | Out-Null
        Assert-Ok "Preparing $Name checkout"
    } else {
        git -C $path checkout --detach --force $Commit | Out-Null
        Assert-Ok "Switching $Name checkout"
        git -C $path reset --hard $Commit | Out-Null
        Assert-Ok "Resetting $Name checkout"
    }
    return $path
}

function Set-VersionStamp([string]$Commit, [string]$BranchName) {
    $env:APP_COMMIT = "$(git -C $Root rev-parse --short $Commit)".Trim()
    $env:APP_VERSION = "$(git -C $Root log -1 --format=%cs $Commit)".Trim() -replace "-", "."
    $env:APP_BRANCH = $BranchName
    $env:APP_BUILT = Get-Date -Format "yyyy-MM-dd HH:mm"
}

function Remove-Preview {
    $existing = docker ps -a -q --filter "name=^caic-web-preview$"
    if ($existing) { docker rm -f caic-web-preview | Out-Null }
}

try {
    if (-not (Test-Path $DeployDir)) { New-Item -ItemType Directory -Path $DeployDir -ErrorAction Stop | Out-Null }

    if ($StopPreview) {
        Remove-Preview
        Log "Preview removed."
        exit 0
    }

    docker info --format "{{.ServerVersion}}" | Out-Null
    Assert-Ok "Docker (is Docker Desktop running?)"

    git -C $Root fetch origin --prune --quiet
    Assert-Ok "Getting the latest code from GitHub"
    $commit = "$(git -C $Root rev-parse --verify --quiet "refs/remotes/origin/$Branch")".Trim()
    if (-not $commit) { throw "Branch '$Branch' isn't on GitHub. Push it first." }
    $short = "$(git -C $Root rev-parse --short $commit)".Trim()

    if ($Preview) {
        $path = Get-Checkout "preview" $commit
        Set-VersionStamp $commit $Branch
        Log "Building preview of $Branch ($short)..."
        docker build -t caic-web:preview `
            --build-arg "APP_VERSION=$env:APP_VERSION" --build-arg "APP_COMMIT=$env:APP_COMMIT" `
            --build-arg "APP_BRANCH=$env:APP_BRANCH" --build-arg "APP_BUILT=$env:APP_BUILT" `
            (Join-Path $path "Frontend")
        Assert-Ok "Building the preview"
        Remove-Preview
        docker run -d --name caic-web-preview --restart unless-stopped --network $Network `
            -p 8080:80 caic-web:preview | Out-Null
        Assert-Ok "Starting the preview (is the live stack running?)"
        Log "Preview of $Branch ($short) is on port 8080. It uses the live backend and data."
        exit 0
    }

    $stateFile = Join-Path $DeployDir "live.commit"
    $previous = if (Test-Path $stateFile) { "$(Get-Content $stateFile -Raw)".Trim() } else { "" }
    if ($Auto -and $previous -eq $commit) { exit 0 }   # nothing new: stay quiet

    $path = Get-Checkout "live" $commit
    Set-VersionStamp $commit $Branch
    Log "Deploying $Branch ($short)..."
    $compose = Join-Path $path "Backend\docker-compose.yml"
    # Secrets (JWT_SECRET_KEY) live in the working folder's Backend\.env, which isn't in Git,
    # so the checkout doesn't have it: pass it explicitly.
    $envFile = Join-Path $Root "Backend\.env"
    if (-not (Test-Path $envFile)) {
        throw "Backend\.env is missing. Copy Backend\.env.example to Backend\.env and set JWT_SECRET_KEY (see README)."
    }
    # Backups folder (see Backend\backup): BACKUP_DIR from Backend\.env, else .\backups here
    $configured = Select-String -Path $envFile -Pattern '^\s*BACKUP_DIR\s*=\s*(\S.*)$' | Select-Object -First 1
    $backupDir = if ($configured) { $configured.Matches[0].Groups[1].Value.Trim().Trim('"') } else { Join-Path $Root "backups" }
    if (-not $configured) { $env:BACKUP_DIR = $backupDir }
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    docker compose -p $Project -f $compose --env-file $envFile up -d --build
    Assert-Ok "Building and starting the stack"
    Set-Content -Path $stateFile -Value $commit -ErrorAction Stop
    Log "Deployed $Branch ($short), version $($env:APP_VERSION). Open http://localhost/ to check."
    docker image prune -f | Out-Null
}
catch {
    Log "DEPLOY FAILED: $($_.Exception.Message)"
    exit 1
}
