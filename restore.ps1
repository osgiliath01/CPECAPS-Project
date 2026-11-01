# Restores the database from an encrypted backup.
#
#   .\restore.ps1 -List                                        show the backups
#   .\restore.ps1 -File daily\caic_db_2026-11-02_020000.dump.gpg
#        Restores into a SEPARATE database, caic_db_restore, so you can check it (pgAdmin, or a
#        test backend with DATABASE_URL=.../caic_db_restore). The real data isn't touched.
#   .\restore.ps1 -File daily\caic_db_2026-11-02_020000.dump.gpg -ReplaceLive
#        Replaces the REAL database. A backup of the current data is made first (backups\manual),
#        and the current database is kept under a new name (caic_db_replaced_<date>).
param(
    [string]$File,
    [switch]$ReplaceLive,
    [switch]$List
)

if ($List -or -not $File) {
    docker exec caic-backup backup.sh list
    if (-not $File) { Write-Host "`nThen: .\restore.ps1 -File <folder>\<file name>  (add -ReplaceLive to replace the real data)" }
    exit $LASTEXITCODE
}

# Accept "backups\daily\x.gpg", "daily\x.gpg" or a full path; the container sees the folder as /backups
$rel = $File -replace '\\', '/'
$i = $rel.ToLower().LastIndexOf('backups/')
if ($i -ge 0) { $rel = $rel.Substring($i + 8) }

if ($ReplaceLive) {
    Write-Host "This REPLACES the real database with $rel." -ForegroundColor Yellow
    Write-Host "Everyone using the app is disconnected for a moment, and changes made since that backup are lost"
    Write-Host "(they stay in the previous database, which is kept)."
    $answer = Read-Host "Type YES to continue"
    if ($answer -ne "YES") { Write-Host "Cancelled."; exit 1 }
    docker exec caic-backup backup.sh restore $rel --live
    if ($LASTEXITCODE -ne 0) { exit 1 }
    docker restart caic-api caic-assistant | Out-Null
    Write-Host "Backend restarted. Open the app and check the data." -ForegroundColor Green
} else {
    docker exec caic-backup backup.sh restore $rel
    exit $LASTEXITCODE
}
