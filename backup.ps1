# Makes an encrypted backup of the database right now (saved in backups\manual).
#   .\backup.ps1                      e.g. before a big import or before moving the server
#   .\backup.ps1 -Label before-import
# The nightly backups run by themselves (the "backup" container); see README, Backups.
param([string]$Label = "manual")

$safe = ($Label -replace '[^A-Za-z0-9_-]', '-')
docker exec caic-backup backup.sh now $safe
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backup failed. Is the stack running? Check with: docker ps" -ForegroundColor Red
    exit 1
}
