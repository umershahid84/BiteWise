#!/usr/bin/env bash
# Installs Rescue Bites as a systemd service, so it keeps running after you close your editor or log out,
# restarts if it crashes, and starts when the server boots.
#
#   sudo bash scripts/server/install-service.sh [--port 3000] [--host 0.0.0.0] [--user NAME] [--node /path/to/node]
#
# Then: sudo systemctl start rescuebites   (status: systemctl status rescuebites, logs: sudo journalctl -u rescuebites -f)
#
# On a server still running the old "biteback" service (from before the rename to Rescue Bites), it takes over that
# service's port, address, user and Node.js, removes it, and starts rescuebites in its place.
set -euo pipefail

SERVICE=rescuebites
UNIT=/etc/systemd/system/$SERVICE.service
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PORT=3000
HOST=0.0.0.0
APP_USER=${SUDO_USER:-}
NODE_BIN=
OLD_UNIT=/etc/systemd/system/biteback.service
if [ -f "$OLD_UNIT" ]; then
  PORT=$(sed -n 's/^Environment=PORT=//p' "$OLD_UNIT" | head -n 1); PORT=${PORT:-3000}
  HOST=$(sed -n 's/.* --hostname \([^ ]*\).*/\1/p' "$OLD_UNIT" | head -n 1); HOST=${HOST:-0.0.0.0}
  OLD_USER=$(sed -n 's/^User=//p' "$OLD_UNIT" | head -n 1); APP_USER=${OLD_USER:-$APP_USER}
  NODE_BIN=$(sed -n 's/^ExecStart=\([^ ]*\) .*/\1/p' "$OLD_UNIT" | head -n 1)
fi

while [ $# -gt 0 ]; do
  case $1 in
    --port) PORT=$2; shift 2 ;;
    --host) HOST=$2; shift 2 ;;
    --user) APP_USER=$2; shift 2 ;;
    --node) NODE_BIN=$2; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

fail() { echo "Error: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "run this with sudo: sudo bash scripts/server/install-service.sh"
command -v systemctl >/dev/null && [ -d /run/systemd/system ] || fail "systemd is not running on this machine."
[ -n "$APP_USER" ] && [ "$APP_USER" != root ] || fail "run it with sudo from your normal account, or pass --user NAME (the service should not run as root)."
id "$APP_USER" >/dev/null 2>&1 || fail "user '$APP_USER' does not exist."
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "--port must be a number."
APP_GROUP=$(id -gn "$APP_USER")

# Find the same Node.js the user runs (nvm, fnm, volta and system installs all end up on their PATH).
if [ -z "$NODE_BIN" ]; then
  NODE_BIN=$(sudo -u "$APP_USER" -H bash -ic 'command -v node' 2>/dev/null | tail -n 1 || true)
  [ -n "$NODE_BIN" ] || NODE_BIN=$(sudo -u "$APP_USER" -H bash -lc 'command -v node' 2>/dev/null | tail -n 1 || true)
fi
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || fail "could not find node for $APP_USER. Pass it with --node \$(which node)."
NODE_BIN=$(readlink -f "$NODE_BIN")
NODE_DIR=$(dirname "$NODE_BIN")
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=9)?0:1)' \
  || fail "Node.js 20.9 or newer is needed (found $("$NODE_BIN" --version))."

as_user() { sudo -u "$APP_USER" -H env PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin" "$@"; }

cd "$APP_DIR"
[ -f .env.local ] || echo "Warning: $APP_DIR/.env.local not found. Create it (see .env.example) before starting the service."
if [ ! -d node_modules ]; then
  echo "Installing packages..."
  as_user npm ci
fi
if [ ! -f .next/BUILD_ID ]; then
  echo "Building the app (first time)..."
  as_user npm run build
  as_user bash -c 'git rev-parse HEAD > .next/DEPLOYED_COMMIT'
fi

sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@APP_USER@|$APP_USER|g" -e "s|@APP_GROUP@|$APP_GROUP|g" \
    -e "s|@NODE_BIN@|$NODE_BIN|g" -e "s|@NODE_DIR@|$NODE_DIR|g" -e "s|@PORT@|$PORT|g" -e "s|@HOST@|$HOST|g" \
    deploy/rescuebites.service > "$UNIT"
chmod 644 "$UNIT"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1

if [ -f "$OLD_UNIT" ]; then
  echo "Replacing the old biteback service with $SERVICE..."
  systemctl disable --now biteback >/dev/null 2>&1 || true
  rm -f "$OLD_UNIT"
  systemctl daemon-reload
  systemctl start "$SERVICE"
  echo "The old biteback service is removed and $SERVICE is running."
fi

cat <<MSG

Installed $UNIT
  runs as:  $APP_USER, from $APP_DIR
  node:     $NODE_BIN ($("$NODE_BIN" --version))
  address:  http://$HOST:$PORT (starts automatically when the server boots)

Start it now:        sudo systemctl start $SERVICE
Check it:            systemctl status $SERVICE
Follow the logs:     sudo journalctl -u $SERVICE -f
Deploy an update:    npm run update      (pulls, builds while the site keeps running, then restarts)
Stop / restart:      sudo systemctl stop $SERVICE   /   sudo systemctl restart $SERVICE

If "npm start" is still running in a terminal, stop it first (Ctrl+C) so the port is free.
MSG
