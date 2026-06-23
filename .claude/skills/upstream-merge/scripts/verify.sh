#!/usr/bin/env bash
# Run all upstream-merge verification gates in the integration worktree.
#
# Serial pytest is the deterministic gate: the `--test-workers` flag is a
# stress-test option in tests/conftest.py and does NOT parallelize the main
# suite, so the suite always runs serially regardless of its value.
#
# Assumes the env is already synced:
#   uv sync --extra api --extra test --extra offline-storage --extra offline-llm
#
# Usage: scripts/verify.sh [worktree-path]   (defaults to current dir)
set -uo pipefail

WT="${1:-.}"
cd "$WT"
fail=0

echo "== git diff --check (whitespace / leftover conflict markers) =="
git diff --check || fail=1

echo "== ruff (lightrag/ tests/) =="
uv run ruff check lightrag/ tests/ || fail=1

echo "== backend suite (serial = deterministic) =="
./scripts/test.sh tests --test-workers 1 || fail=1

echo "== WebUI (install / build / lint / test) =="
(
  cd lightrag_webui \
    && bun install --frozen-lockfile \
    && bun run build \
    && bun run lint \
    && bun test
) || fail=1

echo
if [ "$fail" -eq 0 ]; then
  echo "== RESULT: GREEN =="
else
  echo "== RESULT: RED — see references/verification-and-gotchas.md for triage =="
  echo "   (a failure that passes in isolation but fails in the full suite is"
  echo "    pre-existing test-isolation pollution, not a merge defect)"
fi
exit "$fail"
