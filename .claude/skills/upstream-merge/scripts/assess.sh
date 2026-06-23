#!/usr/bin/env bash
# Upstream merge assessment for the LightRAG fork.
#
# Fetches upstream, reports divergence + version delta + changed-file areas,
# creates a pre-merge safety tag and an integration worktree, then dry-merges
# to enumerate the conflict set and each conflict file's local-vs-upstream
# change profile, and aborts the dry merge (leaving the worktree clean for the
# real, baseline-gated merge).
#
# Usage: scripts/assess.sh [YYYY-MM-DD]      (date defaults to today)
# Env:   UPSTREAM_REF (default upstream/main), LOCAL_REF (default main)
set -euo pipefail

DATE="${1:-$(date +%F)}"
UP="${UPSTREAM_REF:-upstream/main}"
LOCAL="${LOCAL_REF:-main}"
BR="integrate/${DATE}-upstream-main"
WT=".worktrees/integrate-${DATE}-upstream-main"
TAG="aegis/${DATE}-pre-upstream-merge"

cd "$(git rev-parse --show-toplevel)"

echo "== fetch ${UP%%/*} =="
git fetch "${UP%%/*}" --tags

BASE="$(git merge-base "$LOCAL" "$UP")"
echo
echo "== divergence =="
echo "local    ($LOCAL): $(git rev-parse --short "$LOCAL")"
echo "upstream ($UP): $(git rev-parse --short "$UP")"
echo "merge-base:        $(git rev-parse --short "$BASE")  $(git show -s --format=%ci "$BASE")"
echo "behind (upstream new): $(git rev-list --count "$LOCAL..$UP")"
echo "ahead  (local 二开):   $(git rev-list --count "$UP..$LOCAL")"

echo
echo "== version delta =="
echo "local:    $(git show "$LOCAL:lightrag/_version.py" | grep -E '__version__|__api_version__' | tr '\n' ' ')"
echo "upstream: $(git show "$UP:lightrag/_version.py" | grep -E '__version__|__api_version__' | tr '\n' ' ')"

echo
echo "== upstream-changed files by area =="
git diff --name-only "$BASE..$UP" | awk -F/ '
/^lightrag\/api\/routers\//{print "lightrag/api/routers";next}
/^lightrag\/api\//{print "lightrag/api";next}
/^lightrag\/kg\//{print "lightrag/kg";next}
/^lightrag\/llm\//{print "lightrag/llm";next}
/^lightrag\/parser\//{print "lightrag/parser";next}
/^lightrag\/chunker\//{print "lightrag/chunker";next}
/^lightrag\//{print "lightrag (other)";next}
/^lightrag_webui\//{print "lightrag_webui";next}
/^tests\//{print "tests";next}
/^docs\//{print "docs";next}
/^scripts\//{print "scripts";next}
{print $1" (root)"}' | sort | uniq -c | sort -rn
echo "total upstream-changed files: $(git diff --name-only "$BASE..$UP" | wc -l)"

echo
echo "== safety tag + worktree =="
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "tag $TAG already exists -> $(git rev-parse --short "$TAG")"
else
  git tag "$TAG" "$LOCAL" && echo "tagged $TAG -> $(git rev-parse --short "$LOCAL")"
fi
if git worktree list | grep -q "$WT"; then
  echo "worktree exists: $WT"
else
  git worktree add -b "$BR" "$WT" "$LOCAL"
fi

echo
echo "== dry merge: conflict set + change profile =="
git -C "$WT" merge --no-commit --no-ff "$UP" >/dev/null 2>&1 || true
CONFLICTS="$(git -C "$WT" diff --name-only --diff-filter=U || true)"
if [ -z "$CONFLICTS" ]; then
  echo "(no conflicts — upstream merges cleanly)"
else
  echo "$CONFLICTS" | nl
  echo
  echo "per-file change profile (insertions/deletions vs merge-base):"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    L="$(git diff --numstat "$BASE..$LOCAL" -- "$f" | awk '{print "+"$1" -"$2}')"
    U="$(git diff --numstat "$BASE..$UP"   -- "$f" | awk '{print "+"$1" -"$2}')"
    printf '  %-56s local[%s] upstream[%s]\n' "$f" "${L:-none}" "${U:-none}"
  done <<< "$CONFLICTS"
fi

echo
echo "== abort dry merge (worktree clean) =="
git -C "$WT" merge --abort 2>/dev/null || true

cat <<EOF

Next:
  1. Baseline (must be GREEN) in the worktree:
       cd $WT && uv sync --extra api --extra test --extra offline-storage --extra offline-llm
       uv run ruff check lightrag/ tests/ && ./scripts/test.sh tests --test-workers 1
       (cd lightrag_webui && bun install --frozen-lockfile && bun run build && bun run lint && bun test)
  2. Real merge:    git -C $WT merge --no-commit --no-ff $UP
  3. Resolve by domain (references/ownership-boundary.md + references/conflict-playbook.md),
     regenerate locks (uv lock / bun install).
  4. Gate:          scripts/verify.sh $WT
  5. Record docs/aegis/plans/${DATE}-upstream-main-merge.md, commit on $BR, promote to $LOCAL.
EOF
