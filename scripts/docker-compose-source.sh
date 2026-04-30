#!/usr/bin/env bash

set -euo pipefail

# 固定使用源码构建版 compose 文件，并启用 BuildKit。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.source.yml"

export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"
export COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-1}"

usage() {
  cat <<'EOF'
用法:
  scripts/docker-compose-source.sh [build|up|down|restart|logs|ps|pull] [额外 docker compose 参数]

示例:
  scripts/docker-compose-source.sh up -d
  scripts/docker-compose-source.sh build
  scripts/docker-compose-source.sh logs -f lightrag
EOF
}

cmd="${1:-up}"
shift || true

case "${cmd}" in
  build)
    exec docker compose -f "${COMPOSE_FILE}" build "$@"
    ;;
  up)
    exec docker compose -f "${COMPOSE_FILE}" up --build "$@"
    ;;
  down)
    exec docker compose -f "${COMPOSE_FILE}" down "$@"
    ;;
  restart)
    exec docker compose -f "${COMPOSE_FILE}" restart "$@"
    ;;
  logs)
    exec docker compose -f "${COMPOSE_FILE}" logs "$@"
    ;;
  ps)
    exec docker compose -f "${COMPOSE_FILE}" ps "$@"
    ;;
  pull)
    exec docker compose -f "${COMPOSE_FILE}" pull "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "未知命令: ${cmd}" >&2
    usage >&2
    exit 1
    ;;
esac
