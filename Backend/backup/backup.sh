#!/bin/sh
# CAIC database backups. Runs in the "backup" container (see docker-compose.yml).
#
#   backup.sh schedule            keep running: one backup a day at BACKUP_HOUR (Philippine time),
#                                 or as soon as the server is on if that time was missed
#   backup.sh now [label]         back up right away (saved under manual/)
#   backup.sh list                show the backups
#   backup.sh restore FILE        restore FILE into a separate database, caic_db_restore, to check it
#   backup.sh restore FILE --live replace the real database with FILE (after backing up the current one)
#
# Every file is encrypted with AES-256 (GnuPG, password BACKUP_PASSPHRASE) before it's written to
# the backups folder, so the copy Google Drive uploads can't be read without that password. The
# unencrypted dump only exists briefly in the container's own /tmp, never in the backups folder.
set -u

ROOT=${BACKUP_ROOT:-/backups}
DB=${PGDATABASE:-caic_db}
HOUR=${BACKUP_HOUR:-2}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
KEEP_MONTHLY=${KEEP_MONTHLY:-6}
DAILY=$ROOT/daily
WEEKLY=$ROOT/weekly
MONTHLY=$ROOT/monthly
MANUAL=$ROOT/manual
export GNUPGHOME="${GNUPGHOME:-/tmp/gnupg}"
mkdir -p "$GNUPGHOME" && chmod 700 "$GNUPGHOME"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

need_passphrase() {
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    log "BACKUP_PASSPHRASE is not set (Backend/.env); refusing to make unencrypted backups"
    exit 1
  fi
}

# The password in a private temporary file, so it isn't visible in the process list
passfile() {
  umask 077
  f=$(mktemp)
  printf '%s' "$BACKUP_PASSPHRASE" > "$f"
  echo "$f"
}

decrypt() { gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$2" --decrypt "$1"; }

# Writes a row to the Activity Log, so admins see the result in the app.
# $1 action (backup | backup_failed | restore), $2 summary
record() {
  psql -q -X -v ON_ERROR_STOP=1 -v action="$1" -v summary="$2" >/dev/null 2>&1 <<'SQL' || log "couldn't write to the Activity Log"
INSERT INTO activity_logs (created_at, actor, action, entity_type, entity_id, summary)
VALUES (now(), 'system', :'action', 'backup', NULL, left(:'summary', 500));
SQL
}

wait_for_db() {
  i=0
  until pg_isready -q; do
    i=$((i + 1))
    [ "$i" -ge 30 ] && { log "database not reachable"; return 1; }
    sleep 2
  done
}

# Makes one encrypted, checked backup in folder $1. $2: optional label for the file name.
backup() {
  dir=$1
  label=${2:-}
  need_passphrase
  mkdir -p "$dir"
  name="${DB}_$(date +%Y-%m-%d_%H%M%S)${label:+_$label}.dump.gpg"
  work=$(mktemp -d)
  pf=$(passfile)
  if pg_dump -Fc -Z 6 -d "$DB" -f "$work/db.dump" 2>"$work/err" \
    && gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$pf" \
         --symmetric --cipher-algo AES256 -o "$work/db.gpg" "$work/db.dump" 2>>"$work/err" \
    && decrypt "$work/db.gpg" "$pf" 2>>"$work/err" | pg_restore --list >/dev/null 2>>"$work/err" \
    && cp "$work/db.gpg" "$dir/.$name.part" && mv "$dir/.$name.part" "$dir/$name"; then
    kb=$(du -k "$dir/$name" | cut -f1)
    rm -rf "$work" "$pf"
    log "saved $(basename "$dir")/$name (${kb} KB)"
    record backup "Backup saved: $(basename "$dir")/$name (${kb} KB, encrypted)"
    return 0
  fi
  err=$(tail -c 300 "$work/err" 2>/dev/null | tr '\n\r' '  ')
  rm -rf "$work" "$pf" "$dir/.$name.part"
  log "FAILED: $err"
  record backup_failed "Backup FAILED: ${err:-unknown error}"
  return 1
}

# Keeps a weekly copy (if none in the last 7 days) and a monthly one (if none this month)
promote() {
  newest=$(ls -1t "$DAILY"/*.gpg 2>/dev/null | head -n 1)
  [ -n "$newest" ] || return 0
  mkdir -p "$WEEKLY" "$MONTHLY"
  if [ -z "$(find "$WEEKLY" -name '*.gpg' -mtime -7 2>/dev/null)" ]; then
    cp "$newest" "$WEEKLY/" && log "weekly copy: $(basename "$newest")"
  fi
  month=$(date +%Y-%m)
  if ! ls "$MONTHLY/${DB}_${month}-"*.gpg >/dev/null 2>&1; then
    cp "$newest" "$MONTHLY/" && log "monthly copy: $(basename "$newest")"
  fi
}

# Deletes all but the newest $2 backups in folder $1
prune() {
  [ -d "$1" ] || return 0
  ls -1t "$1"/*.gpg 2>/dev/null | tail -n +"$(($2 + 1))" | while read -r old; do
    rm -f "$old" && log "removed old $(basename "$1")/$(basename "$old")"
  done
}

schedule() {
  need_passphrase
  log "running: daily backup from ${HOUR}:00 Philippine time; keeping $KEEP_DAILY daily, $KEEP_WEEKLY weekly, $KEEP_MONTHLY monthly"
  last_fail=0
  while true; do
    today=$(date +%Y-%m-%d)
    hour=$(date +%H)
    now=$(date +%s)
    if [ "$hour" -ge "$HOUR" ] && ! ls "$DAILY/${DB}_${today}_"*.gpg >/dev/null 2>&1 \
       && [ $((now - last_fail)) -ge 3600 ]; then   # after a failure, try again an hour later
      if wait_for_db && backup "$DAILY"; then
        promote
        prune "$DAILY" "$KEEP_DAILY"
        prune "$WEEKLY" "$KEEP_WEEKLY"
        prune "$MONTHLY" "$KEEP_MONTHLY"
      else
        last_fail=$now
      fi
    fi
    sleep 600
  done
}

restore() {
  file=${1:-}
  live=${2:-}
  [ -n "$file" ] || { echo "Usage: backup.sh restore FILE [--live]"; exit 2; }
  case "$file" in /*) ;; *) file="$ROOT/$file" ;; esac
  [ -f "$file" ] || { echo "No such backup: $file"; exit 1; }
  need_passphrase
  target="${DB}_restore"
  pf=$(passfile)
  work=$(mktemp -d)
  if ! decrypt "$file" "$pf" > "$work/db.dump" 2>"$work/err"; then
    echo "Couldn't decrypt $file (wrong BACKUP_PASSPHRASE, or the file is damaged)."
    rm -rf "$work" "$pf"
    exit 1
  fi
  rm -f "$pf"
  dropdb --if-exists "$target" && createdb "$target" || { rm -rf "$work"; exit 1; }
  if ! pg_restore --no-owner --exit-on-error -d "$target" "$work/db.dump"; then
    echo "Restore into $target failed; the real database was not touched."
    rm -rf "$work"
    exit 1
  fi
  rm -rf "$work"
  echo "Restored $(basename "$file") into the separate database '$target'. The real database ('$DB') was not changed."

  [ "$live" = "--live" ] || exit 0
  echo "Replacing the real database. First, a backup of it as it is now..."
  backup "$MANUAL" "before-restore" || { echo "Couldn't back up the current database; nothing was replaced."; exit 1; }
  old="${DB}_replaced_$(date +%Y%m%d_%H%M%S)"
  # Stop new connections, end the open ones, then swap: the restored copy becomes the real one
  # and the current one is kept (renamed) in case it's needed after all.
  if ! psql -X -q -d postgres -v ON_ERROR_STOP=1 <<SQL
ALTER DATABASE "$DB" WITH ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB', '$target') AND pid <> pg_backend_pid();
ALTER DATABASE "$DB" RENAME TO "$old";
ALTER DATABASE "$target" RENAME TO "$DB";
SQL
  then
    psql -X -q -d postgres -c "ALTER DATABASE \"$DB\" WITH ALLOW_CONNECTIONS true;" >/dev/null 2>&1
    echo "Swap failed; the real database was left as it was."
    exit 1
  fi
  record restore "Database restored from $(basename "$file"); the previous one is kept as $old"
  echo "Done. '$DB' now holds the restored data; the previous database is kept as '$old'."
  echo "Restart the backend so it reconnects: docker restart caic-api caic-assistant"
}

case "${1:-schedule}" in
  schedule) schedule ;;
  now) wait_for_db && backup "$MANUAL" "${2:-manual}" ;;
  list) for d in "$DAILY" "$WEEKLY" "$MONTHLY" "$MANUAL"; do
          echo "== $(basename "$d")"; ls -1t "$d" 2>/dev/null | grep '\.gpg$' || echo "(none)"
        done ;;
  restore) shift; restore "$@" ;;
  *) echo "Usage: backup.sh schedule | now [label] | list | restore FILE [--live]"; exit 2 ;;
esac
