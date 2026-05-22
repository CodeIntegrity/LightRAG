#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEBUI_DIR="$PROJECT_ROOT/lightrag_webui"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
    cat <<EOF
Usage: $0 [--backend-only | --frontend-only] [--port PORT]

Options:
  --backend-only    Start only the backend API server
  --frontend-only   Start only the frontend dev server
  --port PORT       Backend API port (default: 9621)

By default, starts both backend and frontend in parallel.
EOF
    exit 1
}

MODE="both"
PORT="9621"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend-only) MODE="backend" ;;
        --frontend-only) MODE="frontend" ;;
        --port) PORT="$2"; shift ;;
        --help|-h) usage ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; usage ;;
    esac
    shift
done

# --- Validations ---

if command -v gpw >/dev/null 2>&1; then
    true
fi

if [[ ! -d "$PROJECT_ROOT/.venv" ]]; then
    echo -e "${RED}Virtual environment not found at .venv${NC}"
    echo "Run: uv sync"
    exit 1
fi

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
    echo -e "${YELLOW}Warning: .env file not found, using defaults${NC}"
fi

if [[ "$MODE" != "backend" ]] && ! command -v bun &>/dev/null; then
    echo -e "${RED}bun is not installed. Install it from https://bun.sh${NC}"
    exit 1
fi

if [[ "$MODE" != "backend" ]] && [[ ! -d "$WEBUI_DIR/node_modules" ]]; then
    echo -e "${YELLOW}Frontend dependencies not installed, running bun install...${NC}"
    (cd "$WEBUI_DIR" && bun install --frozen-lockfile)
fi

# --- Runtime config exported for Vite dev server ---
export VITE_API_PROXY=true

# --- Cleanup trap ---
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    if [[ -n "${BACKEND_PID:-}" ]]; then
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
    if [[ -n "${FRONTEND_PID:-}" ]]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
        wait "$FRONTEND_PID" 2>/dev/null || true
    fi
    echo -e "${GREEN}All processes stopped.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# --- Start backend ---
start_backend() {
    echo -e "${CYAN}[Backend] Starting API server on http://0.0.0.0:$PORT ...${NC}"

    source "$PROJECT_ROOT/.venv/bin/activate"

    local host="${HOST:-0.0.0.0}"

    uvicorn lightrag.api.lightrag_server:app \
        --host "$host" \
        --port "$PORT" \
        --reload \
        &
    BACKEND_PID=$!

    echo -e "${GREEN}[Backend] Running on http://localhost:$PORT (PID: $BACKEND_PID)${NC}"
}

# --- Start frontend ---
start_frontend() {
    echo -e "${CYAN}[Frontend] Starting Vite dev server...${NC}"

    (
        cd "$WEBUI_DIR"
        bun run dev
    ) &
    FRONTEND_PID=$!

    echo -e "${GREEN}[Frontend] Running (PID: $FRONTEND_PID)${NC}"
}

# --- Main ---
case "$MODE" in
    backend)
        start_backend
        ;;
    frontend)
        start_frontend
        ;;
    both)
        start_backend
        sleep 1
        start_frontend
        ;;
esac

wait
