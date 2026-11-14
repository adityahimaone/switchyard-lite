#!/usr/bin/env bash
#
# One-command deploy for switchyard-lite (like in kanban-board).
#
# Usage:
#   make ship          # verify + build + deploy
#   make ship-fast     # skip tests, deploy the tree as it stands
#   SHIP_HOST=vps-pub ./scripts/ship.sh
#

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SHIP_HOST="${SHIP_HOST:-vps}"
SHIP_APP_DIR="${SHIP_APP_DIR:-apps/switchyard-lite}"
SHIP_SKIP_TESTS="${SHIP_SKIP_TESTS:-0}"
SHIP_PORT="${SHIP_PORT:-8791}"
SHIP_SERVICE="${SHIP_SERVICE:-switchyard-lite}"

STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$ROOT/.ship"
BIN="$STAGE/switchyard-lite"

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31m==> %s\033[0m\n' "$*" >&2; exit 1; }

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

# --- 1. preflight -----------------------------------------------------------
say "Preflight"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repository"
if [ -n "$(git status --porcelain)" ]; then
  printf '\033[33m    working tree is dirty; shipping what is on disk, not what is committed\033[0m\n'
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REV="$(git rev-parse --short HEAD)"
printf '    host=%s branch=%s rev=%s\n' "$SHIP_HOST" "$BRANCH" "$REV"

# Test host reachability (try SHIP_HOST, fallback to vps-pub if default vps fails)
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$SHIP_HOST" true 2>/dev/null; then
  if [ "$SHIP_HOST" = "vps" ] && ssh -o ConnectTimeout=5 -o BatchMode=yes vps-pub true 2>/dev/null; then
    printf '    vps unreachable, falling back to vps-pub\n'
    SHIP_HOST="vps-pub"
  else
    die "cannot reach host $SHIP_HOST over SSH"
  fi
fi

# --- 2. verify --------------------------------------------------------------
if [ "$SHIP_SKIP_TESTS" != "1" ]; then
  say "Go vet & tests"
  go vet ./...
  go test -race ./...
  say "Web tsc & tests"
  pnpm -C web exec tsc --noEmit
  pnpm -C web test
else
  say "Skipping tests (SHIP_SKIP_TESTS=1)"
fi

# --- 3. build ---------------------------------------------------------------
say "Build web assets"
pnpm -C web install --frozen-lockfile
pnpm -C web build

say "Build linux/amd64 binary with embedded webui"
mkdir -p "$STAGE"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags="-s -w" -o "$BIN" ./cmd/switchyard-lite

BIN_SHA="$(shasum -a 256 "$BIN" | awk '{print $1}')"
printf '    binary %s (%s)\n' "$BIN_SHA" "$(du -h "$BIN" | cut -f1)"

# --- 4. upload --------------------------------------------------------------
say "Upload binary"
scp -q -o BatchMode=yes "$BIN" "$SHIP_HOST:/tmp/switchyard-lite.$STAMP"

# --- 5. remote swap + health check + rollback ------------------------------
say "Swap, restart, health check"
set +e
ssh -o BatchMode=yes "$SHIP_HOST" bash -s -- "$BIN_SHA" "$STAMP" "$SHIP_APP_DIR" "$SHIP_PORT" "$SHIP_SERVICE" <<'REMOTE'
set -euo pipefail
SHA="$1"; STAMP="$2"; APP_DIR="$3"; PORT="$4"; SERVICE="$5"
cd "$HOME/$APP_DIR"

# Keep host source tree updated
git fetch -q origin main 2>/dev/null || true
git merge --ff-only -q origin/main 2>/dev/null || true
echo "    source $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

echo "$SHA  /tmp/switchyard-lite.$STAMP" | sha256sum -c - >/dev/null \
  || { echo "uploaded binary does not match the local build checksum"; exit 3; }

BK="$HOME/backups/switchyard-lite-$STAMP"
mkdir -p "$BK"
if [ -f bin/switchyard-lite ]; then
  cp -a bin/switchyard-lite "$BK/switchyard-lite"
  echo "    backup $BK/switchyard-lite"
fi

mkdir -p bin
chmod 755 "/tmp/switchyard-lite.$STAMP"
cp "/tmp/switchyard-lite.$STAMP" bin/switchyard-lite.new
chmod 755 bin/switchyard-lite.new
mv -f bin/switchyard-lite.new bin/switchyard-lite

# Restart service
sudo systemctl restart "$SERVICE"

code=""
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/" || true)"
  [ "$code" = "200" ] && break
  sleep 1
done

if [ "$code" != "200" ]; then
  echo "    health check failed (HTTP ${code:-none}) — rolling back" >&2
  if [ -f "$BK/switchyard-lite" ]; then
    cp -a "$BK/switchyard-lite" bin/switchyard-lite
    sudo systemctl restart "$SERVICE" || true
  fi
  exit 5
fi

rm -f "/tmp/switchyard-lite.$STAMP"
echo "    live sha=$SHA"
echo "    health OK (HTTP 200)"
REMOTE
REMOTE_STATUS=$?
set -e

if [ "$REMOTE_STATUS" -ne 0 ]; then
  die "remote deploy failed (exit $REMOTE_STATUS); the previous build is running again"
fi

say "Shipped $REV to $SHIP_HOST successfully!"
