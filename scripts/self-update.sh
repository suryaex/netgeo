#!/usr/bin/env bash
#
# NetGeo self-update — the single, auditable script the in-app updater runs.
#
# It pulls the latest released tag (or the configured branch) and reinstalls the
# stack by re-running the canonical installer, so the rebuild always matches how
# the operator deployed (dev gateway vs --prod). The backend never executes
# anything else: POST /api/update/apply only triggers *this* file.
#
#   scripts/self-update.sh --check     # print current vs latest, exit
#   scripts/self-update.sh --apply     # pull + reinstall + restart (default)
#   scripts/self-update.sh --watch     # poll for the trigger file, then --apply
#
# Env:
#   GITHUB_REPO          owner/name to compare releases against (default: suryaex/netgeo)
#   UPDATE_BRANCH        branch to fast-forward when no tag is targeted (default: main)
#   UPDATE_TRIGGER_FILE  sentinel written by the backend (default: /var/lib/netgeo/update.request)
#   UPDATE_STATUS_FILE   progress file the UI reads      (default: /var/lib/netgeo/update.status)
#   NETGEO_STATE_DIR     dir holding trigger/status/install.flags (default: /var/lib/netgeo)
#   NETGEO_INSTALL_FLAGS install.sh flags to reuse (e.g. "--prod"); overrides the
#                        persisted $NETGEO_STATE_DIR/install.flags from install time.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITHUB_REPO="${GITHUB_REPO:-suryaex/netgeo}"
UPDATE_BRANCH="${UPDATE_BRANCH:-main}"
STATE_DIR="${NETGEO_STATE_DIR:-/var/lib/netgeo}"
UPDATE_TRIGGER_FILE="${UPDATE_TRIGGER_FILE:-${STATE_DIR}/update.request}"
UPDATE_STATUS_FILE="${UPDATE_STATUS_FILE:-${STATE_DIR}/update.status}"

log()    { printf '[self-update] %s\n' "$*" >&2; }
status() { # state, message
  mkdir -p "$(dirname "$UPDATE_STATUS_FILE")" 2>/dev/null || true
  printf '{"state":"%s","message":"%s","at":%s}\n' "$1" "${2:-}" "$(date +%s)" \
    > "$UPDATE_STATUS_FILE" 2>/dev/null || true
}

latest_tag() {
  # Newest release tag from GitHub; empty on failure.
  curl -fsSL -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null \
    | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

# Flags to pass to install.sh — the persisted set from the original install,
# overridable via NETGEO_INSTALL_FLAGS. Empty (dev gateway) by default.
install_flags() {
  if [ -n "${NETGEO_INSTALL_FLAGS:-}" ]; then echo "$NETGEO_INSTALL_FLAGS"; return 0; fi
  [ -f "${STATE_DIR}/install.flags" ] && cat "${STATE_DIR}/install.flags" || true
}

do_check() {
  local current latest
  current="$(git -C "$REPO_DIR" describe --tags --abbrev=0 2>/dev/null || echo "unknown")"
  latest="$(latest_tag || true)"
  printf 'current=%s latest=%s\n' "$current" "${latest:-<unreachable>}"
}

# Pull latest source. Echoes the resolved tag/branch on stdout (logs go to stderr
# so the caller can capture the value cleanly).
fetch_source() {
  cd "$REPO_DIR"
  # The watcher runs as root while the repo is owned by the deploy user; trust it.
  git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true

  status "updating" "Fetching latest source"
  log "Fetching from origin…"
  if ! git fetch --tags --prune origin >&2; then
    status "error" "git fetch failed — check network / credentials"; return 1
  fi
  local tag
  tag="$(latest_tag 2>/dev/null || true)"
  if [ -n "${tag:-}" ] && git rev-parse "refs/tags/${tag}" >/dev/null 2>&1; then
    log "Checking out release ${tag}"
    git checkout -q "tags/${tag}" >&2
    echo "$tag"
  else
    log "No release tag reachable; fast-forwarding ${UPDATE_BRANCH}"
    git checkout -q "${UPDATE_BRANCH}" >&2
    git merge --ff-only "origin/${UPDATE_BRANCH}" >&2
    echo "$UPDATE_BRANCH"
  fi
}

do_apply() {
  local tag flags
  tag="$(fetch_source)" || return 1
  flags="$(install_flags)"

  # Re-apply the install-time environment (HTTP_PORT, PUBLIC_HOST/IP, …) so the
  # rebuild matches the original deployment, not install.sh's defaults.
  if [ -f "${STATE_DIR}/install.env" ]; then
    set -a; # shellcheck disable=SC1091
    . "${STATE_DIR}/install.env"; set +a
  fi

  status "rebuilding" "Rebuilding & restarting the NetGeo stack"
  log "Reinstalling via install.sh ${flags}…"
  # install.sh is the canonical "build + start" entrypoint: it selects the right
  # compose files (dev gateway vs --prod), env, ports and firewall rules, then
  # rebuilds the images and recreates the containers — a full reinstall.
  # NETGEO_SKIP_WATCHER=1: don't let the re-run re-install/restart THIS watcher
  # service (it would kill the in-progress update). The watcher is already set up.
  # shellcheck disable=SC2086 — $flags is a deliberate, controlled flag list.
  if ! NETGEO_SKIP_WATCHER=1 bash "$REPO_DIR/install.sh" $flags >&2; then
    status "error" "install.sh failed — see logs"; return 1
  fi

  status "done" "Updated to ${tag} and restarted"
  log "Update complete."
  rm -f "$UPDATE_TRIGGER_FILE" 2>/dev/null || true
}

do_watch() {
  log "Watching ${UPDATE_TRIGGER_FILE} for update requests… (Ctrl-C to stop)"
  while true; do
    if [ -f "$UPDATE_TRIGGER_FILE" ]; then
      log "Trigger detected."
      if ! do_apply; then
        status "error" "Update failed — see logs"
        # Consume the trigger so a persistent failure doesn't loop every cycle.
        mv -f "$UPDATE_TRIGGER_FILE" "${UPDATE_TRIGGER_FILE}.failed" 2>/dev/null \
          || rm -f "$UPDATE_TRIGGER_FILE" 2>/dev/null || true
      fi
    fi
    sleep 15
  done
}

case "${1:---apply}" in
  --check) do_check ;;
  --apply) do_apply ;;
  --watch) do_watch ;;
  *) echo "usage: $0 [--check|--apply|--watch]" >&2; exit 2 ;;
esac
