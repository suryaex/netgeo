#!/usr/bin/env bash
# Deploy local main to the live host: bundle -> ff-merge -> rebuild backend -> restart frontend+gateway -> health check.
# Usage: NETGEO_SUDO_PW=... scripts/deploy-host.sh   (prompts for the sudo password if unset)
set -euo pipefail

HOST="${NETGEO_HOST:-<host>}"
SSH_USER="${NETGEO_SSH_USER:?set-user}"
REPO="${NETGEO_REPO:-$HOME/mini-project/netgeo}"

if [[ -z "${NETGEO_SUDO_PW:-}" ]]; then
  read -rsp "sudo password for ${SSH_USER}@${HOST}: " NETGEO_SUDO_PW; echo
fi

ping -c1 -W3 "$HOST" >/dev/null || { echo "host $HOST unreachable" >&2; exit 1; }

BUNDLE="$(mktemp /tmp/netgeo-XXXXXX.bundle)"
trap 'rm -f "$BUNDLE"' EXIT
git -C "$REPO" bundle create "$BUNDLE" main
scp -q "$BUNDLE" "${SSH_USER}@${HOST}:/tmp/netgeo.bundle"

# Password rides stdin (never argv/disk). sudo_() feeds it to sudo -S per call.
{
  printf 'PW=%q\n' "$NETGEO_SUDO_PW"
  cat <<'EOF'
set -euo pipefail
sudo_() { printf '%s\n' "$PW" | sudo -S -p '' "$@"; }
cd ~/netgeo
# root watcher leaves root-owned files in .git; dev container rewrites the lockfile
sudo_ chown -R "$USER:$USER" .git
git checkout -- frontend/package-lock.json 2>/dev/null || true
git checkout -q main
git fetch /tmp/netgeo.bundle +main:main-in
git merge --ff-only main-in
rm -f /tmp/netgeo.bundle
sudo_ docker compose -p netgeo-dev -f infra/docker-compose.yml -f infra/docker-compose.lan.yml build backend
sudo_ docker compose -p netgeo-dev -f infra/docker-compose.yml -f infra/docker-compose.lan.yml up -d
# frontend must restart to re-read package.json (vite dev + bind mount); gateway rides along
sudo_ docker compose -p netgeo-dev -f infra/docker-compose.yml -f infra/docker-compose.lan.yml restart frontend gateway
sleep 5
echo "HEAD: $(git log --oneline -1)"
curl -fsS http://127.0.0.1:8090/api/health && echo
EOF
} | ssh "${SSH_USER}@${HOST}" bash
