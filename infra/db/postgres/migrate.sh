#!/usr/bin/env bash
# =============================================================================
# NetGeo — PostgreSQL migration runner (authoritative tree)
# =============================================================================
# Plain psql-based runner for the numbered SQL migrations in this directory.
# No ORM / external tool lock-in (works with the same files as dbmate/migrate).
#
# Usage:
#   ./migrate.sh up                 # apply every pending *.up.sql in order
#   ./migrate.sh up    0003         # apply up to & including version 0003
#   ./migrate.sh down  0005         # roll back a single version (its *.down.sql)
#   ./migrate.sh status             # show applied vs available versions
#
# Connection (first match wins):
#   DATABASE_URL=postgres://user:pass@host:5432/db   (asyncpg/+driver suffix is
#                                                      stripped automatically)
#   or standard libpq vars: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
#
# Tracking: applied versions live in netgeo.schema_migrations (each migration
# inserts its own row). `status` reads that table; `up` relies on the migrations
# being idempotent (IF NOT EXISTS + ON CONFLICT DO NOTHING) so re-applying an
# already-applied version is a no-op.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="${HERE}/migrations"

# --- resolve a psql connection argument -------------------------------------
if [[ -n "${DATABASE_URL:-}" ]]; then
    # Strip SQLAlchemy-style "+driver" (postgresql+asyncpg://) -> libpq URL.
    CONN="$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres(ql)?\+[a-z0-9]+://#postgresql://#')"
    PSQL=(psql -v ON_ERROR_STOP=1 "$CONN")
else
    PSQL=(psql -v ON_ERROR_STOP=1)   # falls back to PG* env vars
fi

cmd="${1:-status}"
target="${2:-}"

apply_file() {
    local file="$1"
    echo "==> applying $(basename "$file")"
    "${PSQL[@]}" -f "$file"
}

case "$cmd" in
  up)
    found=0
    for f in "${MIG_DIR}"/*.up.sql; do
        ver="$(basename "$f" | cut -d_ -f1)"
        apply_file "$f"; found=1
        [[ -n "$target" && "$ver" == "$target" ]] && break
    done
    [[ "$found" == 1 ]] || { echo "no migrations found in ${MIG_DIR}"; exit 1; }
    echo "up: complete."
    ;;
  down)
    [[ -n "$target" ]] || { echo "down requires a version, e.g. ./migrate.sh down 0005"; exit 2; }
    f="$(ls "${MIG_DIR}/${target}_"*.down.sql 2>/dev/null | head -1 || true)"
    [[ -n "$f" ]] || { echo "no down migration for version ${target}"; exit 1; }
    echo "WARNING: rolling back ${target} is DESTRUCTIVE."
    apply_file "$f"
    echo "down: complete."
    ;;
  status)
    echo "Available migrations:"
    ls "${MIG_DIR}"/*.up.sql | xargs -n1 basename
    echo
    echo "Applied (netgeo.schema_migrations):"
    "${PSQL[@]}" -tA -c \
      "SELECT version || '  ' || coalesce(description,'') FROM netgeo.schema_migrations ORDER BY version;" \
      2>/dev/null || echo "  (schema_migrations not reachable — DB empty or unmigrated)"
    ;;
  *)
    echo "usage: ./migrate.sh {up [VERSION] | down VERSION | status}"; exit 2 ;;
esac
