#!/usr/bin/env bash
# Deploys the latest code to a server running the rescuebites systemd service:
# pulls, installs packages if they changed, builds into .next-build while the live site keeps running,
# then swaps the new build in and restarts (about a second of downtime). If the new version doesn't
# answer, the previous build is put back.
#
#   npm run update            (or: bash scripts/server/update.sh [--no-pull] [--force])
#     --no-pull   deploy the code that is already in the folder
#     --force     rebuild and restart even if that commit is already live
set -euo pipefail

SERVICE=rescuebites
STAMP=.next/DEPLOYED_COMMIT # the commit the live build was made from

fail() { echo "Error: $*" >&2; exit 1; }

# Waits up to 30 seconds for the home page to answer; prints the last HTTP status.
healthy() {
  local code=000
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$1/" || true)
    [ "$code" = 200 ] && break
    sleep 1
  done
  echo "$code"
}

# Everything runs from this function, so bash has read the whole script before `git pull` can replace it.
main() {
  local pull=1 force=0
  for arg in "$@"; do
    case $arg in
      --no-pull) pull=0 ;;
      --force) force=1 ;;
      *) fail "unknown option: $arg" ;;
    esac
  done
  cd "$(dirname "${BASH_SOURCE[0]}")/../.."
  [ "$(id -u)" != 0 ] || fail "run this as your normal user (it asks for sudo only to restart the service)."
  if ! systemctl cat "$SERVICE" >/dev/null 2>&1 && systemctl cat biteback >/dev/null 2>&1; then
    echo "==> Renaming the biteback service to $SERVICE (asks for your password)"
    sudo bash scripts/server/install-service.sh
  fi
  systemctl cat "$SERVICE" >/dev/null 2>&1 || fail "the $SERVICE service isn't installed. Run: npm run service:install"

  local before head base
  before=$(git rev-parse HEAD)
  if [ "$pull" = 1 ]; then
    echo "==> Pulling the latest code"
    git pull --ff-only
  fi
  head=$(git rev-parse HEAD)
  if [ "$force" = 0 ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$head" ]; then
    echo "==> Already up to date: $(git log -1 --format='%h %s') is live. (Use --force to rebuild anyway.)"
    return
  fi
  # Compare with the live commit (or, without one, the code before pulling).
  base=$before
  if [ -f "$STAMP" ] && git cat-file -e "$(cat "$STAMP")^{commit}" 2>/dev/null; then base=$(cat "$STAMP"); fi
  changed() { ! git diff --quiet "$base" HEAD -- "$@"; }

  if changed package-lock.json || [ ! -d node_modules ]; then
    echo "==> Packages changed: installing"
    npm ci
  fi

  echo "==> Building (the live site keeps running)"
  rm -rf .next-build
  NEXT_DIST_DIR=.next-build npm run build
  echo "$head" > .next-build/DEPLOYED_COMMIT

  echo "==> Switching to the new build and restarting"
  rm -rf .next-old
  if [ -d .next ]; then mv .next .next-old; fi
  mv .next-build .next
  sudo systemctl restart "$SERVICE"

  local port code
  port=$(systemctl show "$SERVICE" -p Environment --value | tr ' ' '\n' | sed -n 's/^PORT=//p')
  port=${port:-3000}
  code=$(healthy "$port")
  if [ "$code" != 200 ]; then
    echo "The new version didn't respond (HTTP $code). Putting the previous build back." >&2
    if [ -d .next-old ]; then
      rm -rf .next-failed && mv .next .next-failed && mv .next-old .next
      sudo systemctl restart "$SERVICE"
      [ "$(healthy "$port")" = 200 ] && echo "The previous version is running again." >&2
    fi
    fail "update failed, so the site is still on the previous version, but the code folder now has $(git log -1 --format=%h).
Look at the error with: sudo journalctl -u $SERVICE -n 100
then fix it, push, and run npm run update again."
  fi
  rm -rf .next-old .next-failed

  echo "==> Done: $(git log -1 --format='%h %s') is live on port $port"
  if changed supabase/migrations; then
    echo "Note: this update includes database changes (supabase/migrations). Apply them with: npx supabase db push"
  fi
}

main "$@"
exit
