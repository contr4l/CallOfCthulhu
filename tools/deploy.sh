#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: bash tools/deploy.sh [--dry-run | --rollback]
Linux + user systemd deployment. Defaults: ~/coc, coc-game.service, port 10086.
Settings: DEPLOY_ROOT, SERVICE_NAME, SOURCE_DIR, NODE_BIN, DEPLOY_PORT,
          DATABASE_PATH, ENV_FILE, SOURCE_REVISION.
Existing ENV_FILE is preserved. See docs/deployment.md.
EOF
}
mode=deploy
case "${1:-}" in
  '') ;;
  --dry-run) mode=dry-run ;;
  --rollback) mode=rollback ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }
SOURCE_DIR=${SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
DEPLOY_ROOT=${DEPLOY_ROOT:-$HOME/coc}
SERVICE_NAME=${SERVICE_NAME:-coc-game}
ENV_FILE=${ENV_FILE:-$DEPLOY_ROOT/coc-game.env}
[[ $DEPLOY_ROOT = /* && $ENV_FILE = /* && $SOURCE_DIR = /* ]] || { echo 'Paths must be absolute.' >&2; exit 2; }
[[ $DEPLOY_ROOT != *[[:space:]]* && $ENV_FILE != *[[:space:]]* ]] || { echo 'Deployment paths must not contain whitespace.' >&2; exit 2; }
[[ $SERVICE_NAME =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid SERVICE_NAME.' >&2; exit 2; }
if [[ $mode == dry-run ]]; then
  printf 'Source: %s\nRoot: %s\nService: %s.service\nEnvironment: %s\n' "$SOURCE_DIR" "$DEPLOY_ROOT" "$SERVICE_NAME" "$ENV_FILE"
  echo 'Plan: isolated build -> smoke test -> database backup -> service switch -> health check.'
  exit 0
fi
[[ $(uname -s) == Linux ]] || { echo 'Deployment requires Linux.' >&2; exit 2; }
for dependency in python3 rsync curl flock systemctl; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 2; }
done
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}
systemctl --user show-environment >/dev/null
mkdir -p "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/backups"
exec 9>"$DEPLOY_ROOT/.deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
unit_dir=$HOME/.config/systemd/user
unit_file=$unit_dir/$SERVICE_NAME.service
current=$DEPLOY_ROOT/current
previous=$DEPLOY_ROOT/previous
health() {
  local port=$1
  for attempt in {1..20}; do
    if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" |
      python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)' 2>/dev/null; then
      curl --fail --silent --max-time 2 "http://127.0.0.1:$port/" -o /dev/null && return 0
    fi
    sleep 1
  done
  return 1
}
switch_link() {
  rm -f "$current.next"
  ln -s "$1" "$current.next"
  mv -Tf "$current.next" "$current"
}
config_port() {
  python3 "$SOURCE_DIR/tools/deploy/config.py" "$ENV_FILE" PORT
}
service_health() {
  systemctl --user is-active --quiet "$SERVICE_NAME.service" && health "$(config_port)"
}
if [[ $mode == rollback ]]; then
  [[ -L $previous ]] || { echo 'No previous release is available.' >&2; exit 1; }
  rollback_target=$(readlink -f "$previous")
  [[ -f $rollback_target/apps/api/dist/server.js ]] || { echo 'Previous release is incomplete.' >&2; exit 1; }
  active_target=$(readlink -f "$current")
  switch_link "$rollback_target"
  systemctl --user restart "$SERVICE_NAME.service"
  if ! service_health; then
    switch_link "$active_target"
    systemctl --user restart "$SERVICE_NAME.service"
    echo 'Rollback failed; restored the active release.' >&2
    exit 1
  fi
  ln -sfn "$active_target" "$previous"
  echo "Rolled back to $rollback_target. Database was not overwritten."
  exit 0
fi
if [[ -z ${NODE_BIN:-} ]]; then
  for candidate in "$DEPLOY_ROOT"/runtime/node-v22.16.0-linux-*/bin/node; do
    [[ ! -x $candidate ]] || { NODE_BIN=$candidate; break; }
  done
  NODE_BIN=${NODE_BIN:-$(command -v node || true)}
fi
[[ -x $NODE_BIN && $NODE_BIN = /* && $NODE_BIN != *[[:space:]]* ]] || { echo 'Set NODE_BIN to an absolute Node.js path.' >&2; exit 2; }
"$NODE_BIN" -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22||(major===22&&minor<16))process.exit(1)' || { echo 'Node.js 22.16+ is required.' >&2; exit 2; }
export PATH="$(dirname "$NODE_BIN"):$PATH"
revision=${SOURCE_REVISION:-$(git -C "$SOURCE_DIR" rev-parse --short HEAD 2>/dev/null || echo local)}
[[ $revision =~ ^[a-zA-Z0-9._-]+$ ]] || { echo 'Invalid SOURCE_REVISION.' >&2; exit 2; }
release=$DEPLOY_ROOT/releases/$revision-$(date -u +%Y%m%dT%H%M%SZ)-$$
mkdir "$release"
# Copy application sources, never the checkout's credentials, dependencies or live database.
rsync -a --exclude=node_modules --exclude=dist --exclude=data --exclude=.env --exclude='*.sqlite*' \
  "$SOURCE_DIR/package.json" "$SOURCE_DIR/package-lock.json" "$SOURCE_DIR/tsconfig.json" \
  "$SOURCE_DIR/playwright.config.ts" "$SOURCE_DIR/apps" "$SOURCE_DIR/packages" \
  "$SOURCE_DIR/stories" "$SOURCE_DIR/chars" "$SOURCE_DIR/scripts" "$SOURCE_DIR/tools" \
  "$SOURCE_DIR/tests" "$release/"
(
  cd "$release"
  npm ci --include=dev
  npm run build
  npm test
  npm run story:validate
  npm run chars:validate
) >"$release/build.log" 2>&1 || { tail -60 "$release/build.log" >&2; exit 1; }
smoke_pid=''
activated=false
old_target=''
old_unit=''
backup=$DEPLOY_ROOT/backups/$(basename "$release")
mkdir "$backup"
cleanup() {
  [[ -z $smoke_pid ]] || { kill "$smoke_pid" 2>/dev/null || true; wait "$smoke_pid" 2>/dev/null || true; }
  rm -f "$current.next"
}
recover() {
  local code=${1:-$?}
  trap - ERR INT TERM
  if [[ $activated == true ]]; then
    echo 'Deployment failed; restoring the prior service.' >&2
    systemctl --user stop "$SERVICE_NAME.service" || true
    if [[ -n $old_target ]]; then switch_link "$old_target"; else rm -f "$current"; fi
    if [[ -n $old_unit ]]; then
      cp "$old_unit" "$unit_file"
      systemctl --user daemon-reload
      systemctl --user restart "$SERVICE_NAME.service" || true
      service_health || echo 'Prior service needs manual attention; see journalctl.' >&2
    else
      systemctl --user disable "$SERVICE_NAME.service" || true
      rm -f "$unit_file"
      systemctl --user daemon-reload
    fi
    echo "Database backup: $backup/game.sqlite (not automatically restored)." >&2
  fi
  exit "$code"
}
trap cleanup EXIT
trap recover ERR
trap 'recover 130' INT
trap 'recover 143' TERM
smoke_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
HOST=127.0.0.1 PORT=$smoke_port DATABASE_PATH="$release/.smoke.sqlite" \
  "$NODE_BIN" "$release/apps/api/dist/server.js" >"$release/smoke.log" 2>&1 9>&- &
smoke_pid=$!
health "$smoke_port"
kill "$smoke_pid"
wait "$smoke_pid" || true
smoke_pid=''
rm -f "$release"/.smoke.sqlite*
python3 "$SOURCE_DIR/tools/deploy/config.py" "$ENV_FILE" --ensure "$DEPLOY_ROOT"
database=$(python3 "$SOURCE_DIR/tools/deploy/config.py" "$ENV_FILE" DATABASE_PATH)
python3 - "$database" "$backup/game.sqlite" <<'PY'
import pathlib,sqlite3,sys
source=pathlib.Path(sys.argv[1])
source.parent.mkdir(parents=True,exist_ok=True)
if source.exists():
    pathlib.Path(sys.argv[2]).touch(mode=0o600,exist_ok=False)
    with sqlite3.connect(source) as db, sqlite3.connect(sys.argv[2]) as target:
        db.backup(target)
        assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    print('Live database backup verified.')
PY
[[ ! -L $current ]] || old_target=$(readlink -f "$current")
mkdir -p "$unit_dir"
if [[ -f $unit_file ]]; then
  old_unit=$backup/service-before.service
  cp "$unit_file" "$old_unit"
  if [[ -z $old_target ]]; then
    old_target=$(systemctl --user show "$SERVICE_NAME.service" -p WorkingDirectory --value)
  fi
fi
# Validate configuration before replacing the currently running service.
activated=true
cat >"$unit_file" <<EOF
[Unit]
Description=Call of Cthulhu solo game
After=network.target

[Service]
Type=simple
WorkingDirectory=$current
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $current/apps/api/dist/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
switch_link "$release"
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME.service"
systemctl --user restart "$SERVICE_NAME.service"
service_health
[[ -z $old_target ]] || ln -sfn "$old_target" "$previous"
activated=false
printf 'Deployment healthy: %s\nPort: %s\n' "$release" "$(config_port)"
