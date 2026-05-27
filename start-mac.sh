#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="${1:-dev}"
TARGET="${2:-}"
PORT="${PORT:-3100}"
WEB_PORT="5173"

print_usage() {
  cat <<'EOF'
Usage:
  ./start-mac.sh
  ./start-mac.sh dev
  ./start-mac.sh web
  ./start-mac.sh server
  ./start-mac.sh prod
  ./start-mac.sh check
  ./start-mac.sh status [all|web|server]
  ./start-mac.sh stop [all|web|server]
  ./start-mac.sh restart [dev|web|server|prod]

Modes:
  dev     Start frontend and backend development servers
  web     Start frontend development server only
  server  Start backend development server only
  prod    Build and start local production server
  check   Only verify Node.js and npm are available
  status  Show the current listener status for managed ports
  stop    Stop listeners on the managed ports
  restart Stop the target ports first, then start again
EOF
}

require_command() {
  local command_name="$1"
  local label="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[start-mac] ERROR: $label was not found in PATH."
    echo "[start-mac] Please install $label and reopen the terminal."
    exit 1
  fi
}

ensure_dependencies() {
  if [[ ! -d "node_modules" ]]; then
    echo "[start-mac] root node_modules is missing. Installing dependencies first..."
    npm install
    echo
  fi

  if [[ ! -d "apps/node_modules" ]]; then
    echo "[start-mac] apps/node_modules is missing. Installing frontend dependencies..."
    npm install --prefix apps
    echo
  fi
}

port_pids() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

is_port_busy() {
  local port="$1"
  [[ -n "$(port_pids "$port")" ]]
}

print_port_status() {
  local port="$1"
  local label="$2"

  if ! is_port_busy "$port"; then
    echo "[start-mac] ${label} port ${port}: free"
    return 0
  fi

  echo "[start-mac] ${label} port ${port}: listening"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN
}

stop_port() {
  local port="$1"
  local label="$2"
  local pids
  local remaining

  pids="$(port_pids "$port")"
  if [[ -z "$pids" ]]; then
    echo "[start-mac] ${label} port ${port} is already free."
    return 0
  fi

  echo "[start-mac] Stopping ${label} listener on port ${port}: ${pids//$'\n'/ }"
  kill $pids
  sleep 1

  remaining="$(port_pids "$port")"
  if [[ -n "$remaining" ]]; then
    echo "[start-mac] ${label} listener is still running. Sending SIGKILL."
    kill -9 $remaining
    sleep 1
  fi

  if is_port_busy "$port"; then
    echo "[start-mac] ERROR: failed to free ${label} port ${port}."
    return 1
  fi

  echo "[start-mac] ${label} port ${port} is now free."
}

ensure_port_free() {
  local port="$1"
  local label="$2"

  if ! is_port_busy "$port"; then
    return 0
  fi

  echo "[start-mac] ERROR: ${label} port ${port} is already in use."
  print_port_status "$port" "$label"
  echo "[start-mac] Run ./start-mac.sh stop or ./start-mac.sh stop ${3:-all} first."
  exit 1
}

run_status() {
  local target="${1:-all}"

  case "$target" in
    all)
      print_port_status "$WEB_PORT" "frontend"
      print_port_status "$PORT" "backend"
      ;;
    web)
      print_port_status "$WEB_PORT" "frontend"
      ;;
    server)
      print_port_status "$PORT" "backend"
      ;;
    *)
      echo "[start-mac] Unknown status target: $target"
      print_usage
      exit 1
      ;;
  esac
}

run_stop() {
  local target="${1:-all}"

  case "$target" in
    all)
      stop_port "$WEB_PORT" "frontend"
      stop_port "$PORT" "backend"
      ;;
    web)
      stop_port "$WEB_PORT" "frontend"
      ;;
    server)
      stop_port "$PORT" "backend"
      ;;
    *)
      echo "[start-mac] Unknown stop target: $target"
      print_usage
      exit 1
      ;;
  esac
}

ensure_start_ports() {
  case "$1" in
    dev)
      ensure_port_free "$WEB_PORT" "frontend" "web"
      ensure_port_free "$PORT" "backend" "server"
      ;;
    web)
      ensure_port_free "$WEB_PORT" "frontend" "web"
      ;;
    server|prod)
      ensure_port_free "$PORT" "backend" "server"
      ;;
  esac
}

run_start() {
  case "$1" in
    dev)
      npm run dev
      ;;
    web)
      npm run dev:web
      ;;
    server)
      npm run dev:server
      ;;
    prod)
      npm run build
      npm run start
      ;;
  esac
}

echo
echo "[start-mac] Project: $ROOT_DIR"

case "$MODE" in
  dev)
    echo "[start-mac] Starting full development stack."
    echo "[start-mac] Web: http://localhost:5173"
    echo "[start-mac] API: http://localhost:${PORT}"
    ;;
  web)
    echo "[start-mac] Starting frontend development server."
    echo "[start-mac] Web: http://localhost:5173"
    ;;
  server)
    echo "[start-mac] Starting backend development server."
    echo "[start-mac] API: http://localhost:${PORT}"
    ;;
  prod)
    echo "[start-mac] Building and starting local production server."
    echo "[start-mac] App: http://localhost:${PORT}"
    ;;
  check)
    echo "[start-mac] Checking runtime dependencies."
    ;;
  status)
    echo "[start-mac] Checking managed port status."
    ;;
  stop)
    echo "[start-mac] Stopping managed ports."
    ;;
  restart)
    echo "[start-mac] Restarting stack target: ${TARGET:-dev}."
    ;;
  *)
    echo "[start-mac] Unknown mode: $MODE"
    print_usage
    exit 1
    ;;
esac
echo

if [[ "$MODE" == "status" || "$MODE" == "stop" || "$MODE" == "restart" ]]; then
  require_command lsof "lsof"
fi

if [[ "$MODE" == "status" ]]; then
  run_status "$TARGET"
  exit 0
fi

if [[ "$MODE" == "stop" ]]; then
  run_stop "$TARGET"
  exit 0
fi

require_command node "Node.js"
require_command npm "npm"

if [[ "$MODE" == "check" ]]; then
  echo "[start-mac] Check passed. Node.js and npm are available."
  exit 0
fi

if [[ "$MODE" == "restart" ]]; then
  case "${TARGET:-dev}" in
    dev)
      run_stop all
      MODE="dev"
      ;;
    web)
      run_stop web
      MODE="web"
      ;;
    server|prod)
      run_stop server
      MODE="$TARGET"
      ;;
    *)
      echo "[start-mac] Unknown restart target: ${TARGET:-dev}"
      print_usage
      exit 1
      ;;
  esac
fi

ensure_dependencies
ensure_start_ports "$MODE"

echo "[start-mac] Press Ctrl+C to stop."
echo

run_start "$MODE"
