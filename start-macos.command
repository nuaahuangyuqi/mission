#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PORT="${PORT:-3100}"

MODE="${1:-dev}"
if [[ $# -gt 0 ]]; then
  shift
fi
CHECK_ONLY=0

if [[ "$MODE" == "--check" ]]; then
  CHECK_ONLY=1
  MODE="dev"
fi

case "$MODE" in
  dev|production|backend|server|web|stop|stop-ports)
    ;;
  -h|--help|help)
    cat <<'USAGE'
Mission macOS launcher

Usage:
  ./start-macos.command [mode]
  ./start-macos.command --check
  ./start-macos.command stop [ports...]

Modes:
  dev         Start frontend + backend development servers (default)
  production  Build frontend + server, then start local production service
  backend     Start local production backend and reuse/build frontend dist
  server      Start backend development server only
  web         Start frontend development server only
  stop        Stop listeners on the project ports, defaults to 5173 and 3100

Addresses:
  Web dev:     http://localhost:5173
  API/prod:    http://localhost:3100

Environment:
  PORT=3200 ./start-macos.command server
  MISSION_FORCE_WEB_BUILD=1 ./start-macos.command backend

Examples:
  ./start-macos.command stop
  ./start-macos.command stop 5173 3100
USAGE
    exit 0
    ;;
  *)
    echo "[start-macos] ERROR: Unknown mode: $MODE" >&2
    echo "[start-macos] Run './start-macos.command --help' for usage." >&2
    exit 1
    ;;
esac

log() {
  printf '[start-macos] %s\n' "$*"
}

require_command() {
  local command_name="$1"
  local display_name="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    log "ERROR: $display_name was not found in PATH."
    log "Install $display_name, then reopen Terminal and run this launcher again."
    exit 1
  fi
}

ensure_dependencies() {
  if [[ ! -d node_modules ]]; then
    log "node_modules is missing. Installing dependencies first..."
    npm install
    echo
  fi
}

stop_port_listeners() {
  require_command lsof "lsof"

  if [[ "$#" -eq 0 ]]; then
    set -- 5173 "$PORT"
  fi

  local unique_ports=""
  local port
  for port in "$@"; do
    if [[ ! "$port" =~ ^[0-9]+$ ]]; then
      log "Skipping invalid port: $port"
      continue
    fi
    case " $unique_ports " in
      *" $port "*) ;;
      *) unique_ports="$unique_ports $port" ;;
    esac
  done

  if [[ -z "${unique_ports// /}" ]]; then
    log "No valid ports were provided."
    return 0
  fi

  for port in $unique_ports; do
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
    if [[ -z "${pids// /}" ]]; then
      log "Port $port: no listener."
      continue
    fi

    log "Port $port: stopping listener PID(s): $pids"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    kill $pids 2>/dev/null || true
    sleep 1

    local remaining
    remaining="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
    if [[ -n "${remaining// /}" ]]; then
      log "Port $port: force stopping remaining PID(s): $remaining"
      kill -9 $remaining 2>/dev/null || true
    fi
  done
}

log "Mission macOS launcher"
log "Project: $SCRIPT_DIR"
log "Mode: $MODE"

if [[ "$MODE" == "stop" || "$MODE" == "stop-ports" ]]; then
  stop_port_listeners "$@"
  log "Stop command finished."
  exit 0
fi

require_command node "Node.js"
require_command npm "npm"

if [[ ! -f package.json ]]; then
  log "ERROR: package.json was not found. Run this file from the project root."
  exit 1
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  log "Check passed. Node.js and npm are available."
  log "Node: $(node --version)"
  log "npm: $(npm --version)"
  exit 0
fi

ensure_dependencies

case "$MODE" in
  dev)
    log "Starting full development stack."
    log "Web: http://localhost:5173"
    log "API: http://localhost:$PORT"
    log "Press Ctrl+C to stop."
    echo
    npm run dev
    ;;
  production)
    log "Running production build..."
    npm run build
    echo
    log "Starting local production server."
    log "App: http://localhost:$PORT"
    log "Press Ctrl+C to stop."
    echo
    npm run start
    ;;
  backend)
    log "Starting local production backend."
    log "App: http://localhost:$PORT"
    log "The launcher will reuse apps/web/dist/client when it exists."
    log "Press Ctrl+C to stop."
    echo
    npm run start
    ;;
  server)
    log "Starting backend development server."
    log "API: http://localhost:$PORT"
    log "Press Ctrl+C to stop."
    echo
    npm run dev:server
    ;;
  web)
    log "Starting frontend development server."
    log "Web: http://localhost:5173"
    log "Press Ctrl+C to stop."
    echo
    npm run dev:web
    ;;
esac
