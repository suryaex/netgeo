#!/bin/sh
# =============================================================================
# NetGeo — Postgres first-boot bootstrap (docker-entrypoint-initdb.d)
# =============================================================================
# Applies the AUTHORITATIVE migration tree (infra/db/postgres/migrations) in
# order the first time the data volume is empty. The official postgres
# entrypoint runs every *.sh / *.sql in the TOP LEVEL of
# /docker-entrypoint-initdb.d (sorted, non-recursive); the migration files are
# mounted in a sub-directory so ONLY this script drives them — never the
# *.down.sql siblings.
#
# Idempotency: each migration guards its own schema_migrations ledger row, and
# DDL uses IF NOT EXISTS / DO-block enum guards, so a re-run is harmless. On a
# fresh volume this runs exactly once.
#
# Env provided by the postgres image entrypoint: POSTGRES_USER, POSTGRES_DB.
# =============================================================================
set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/docker-entrypoint-initdb.d/migrations}"

echo "[bootstrap] applying NetGeo migrations from ${MIGRATIONS_DIR}"

for f in "${MIGRATIONS_DIR}"/*.up.sql; do
    [ -e "$f" ] || { echo "[bootstrap] no *.up.sql found — nothing to apply"; break; }
    echo "[bootstrap] ==> $(basename "$f")"
    psql -v ON_ERROR_STOP=1 \
         --username "${POSTGRES_USER}" \
         --dbname   "${POSTGRES_DB}" \
         -f "$f"
done

echo "[bootstrap] done."
