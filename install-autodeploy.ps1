<#
.SYNOPSIS
    Turns automatic deploys on or off on the shared server.

.DESCRIPTION
    Adds a Windows scheduled task that runs ".\deploy.ps1 -Auto" every few minutes while you
    are signed in. It deploys main only when it has changed on GitHub, so merging a pull request
    updates the shared app within a few minutes. Results go to .deploy\deploy.log.

.EXAMPLE
    .\install-autodeploy.ps1
    Turns automatic deploys on (every 5 minutes).

.EXAMPLE
    .\install-autodeploy.ps1 -Minutes 10

.EXAMPLE
    .\install-autodeploy.ps1 -Remove
    Turns automatic deploys off.
#>
param(
    [int]$Minutes = 5,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$TaskName = "CAIC app automatic deploy"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Automatic deploys are off."
    exit 0
}

$script = Join-Path $PSScriptRoot "deploy.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Auto" `
    -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
# Runs as you, only while you're signed in, so it can use your GitHub sign-in and Docker Desktop
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description "Deploys main from GitHub when it changes (deploy.ps1 -Auto)." -Force | Out-Null

Write-Host "Automatic deploys are on: main is checked every $Minutes minutes."
Write-Host "Log: $(Join-Path $PSScriptRoot '.deploy\deploy.log')   Turn off: .\install-autodeploy.ps1 -Remove"
