---
name: LightRAG Upstream Merge
description: This skill should be used when the user asks to "检查上游更新", "合并上游", "把上游更新融合进来", "merge upstream", "integrate upstream/main", "上游合并", "同步 HKUDS/LightRAG", or otherwise wants to pull changes from the upstream HKUDS/LightRAG repo into this fork's `main` without breaking secondary-development (二开) features. Provides the worktree-based assess→baseline→merge→resolve→verify→promote workflow, the upstream/local ownership boundary, a conflict-resolution playbook, and verification gates.
version: 1.0.0
---

# LightRAG Upstream Merge

This repository is a fork of `HKUDS/LightRAG` (remote `upstream`) carrying
substantial secondary development (二开). This skill encodes the repeatable
process for absorbing upstream platform improvements **without regressing any
二开 feature**, distilled from prior integrations (see `docs/aegis/plans/`).

The companion discipline doc is [`docs/aegis/sop/upstream-merge-sop.md`](../../../docs/aegis/sop/upstream-merge-sop.md)
(hard stops, rollback). This skill adds the executable steps, the decision
knowledge, and helper scripts that a fresh Claude session needs.

## Golden rules

- **Never `git merge upstream/main` directly on `main`.** Work in a dedicated
  worktree + integration branch; promote only after green gates.
- **Establish a GREEN baseline BEFORE merging** so merge-introduced failures are
  distinguishable from pre-existing ones.
- **Preserve 二开 by default.** When a conflict is genuinely ambiguous, keep
  local behavior and note it — do not silently adopt upstream.
- **Regenerate lockfiles** from resolved manifests; never hand-edit lock hunks.
- Never use `--no-verify`, never `--amend` the merge commit, never leave a red
  ruff/pytest/bun gate "for later".

## Workflow

### 1. Assess (deterministic — use the script)

Run `scripts/assess.sh [YYYY-MM-DD]`. It fetches `upstream`, reports divergence
(ahead/behind, merge-base, version delta), summarizes upstream-changed file
areas, creates the safety tag `aegis/<date>-pre-upstream-merge`, creates the
worktree `.worktrees/integrate-<date>-upstream-main` on branch
`integrate/<date>-upstream-main`, then dry-merges to print the **conflict set**
and each conflict file's **local-vs-upstream change profile**, and aborts the
dry merge (leaving the worktree clean).

The change profile drives strategy selection — see
`references/conflict-playbook.md`.

### 2. Pre-merge baseline (must be green)

In the worktree: sync the full env, then run the gates. ruff + WebUI build/lint
should be clean and the **serial** backend suite green:

```bash
cd .worktrees/integrate-<date>-upstream-main
uv sync --extra api --extra test --extra offline-storage --extra offline-llm
uv run ruff check lightrag/ tests/
./scripts/test.sh tests --test-workers 1          # serial = deterministic gate
cd lightrag_webui && bun install --frozen-lockfile && bun run build && bun run lint && bun test
```

If the baseline is red, classify each failure as pre-existing vs needing a fix
**before** merging. Note: the suite has pre-existing test-isolation fragility —
see `references/verification-and-gotchas.md`.

### 3. Merge and resolve by domain

```bash
git -C .worktrees/integrate-<date>-upstream-main merge --no-commit --no-ff upstream/main
```

Resolve conflicts **one domain at a time**, using:
- `references/ownership-boundary.md` — who owns what (upstream platform vs local 二开).
- `references/conflict-playbook.md` — strategy per change-profile, the
  git-archaeology technique, and the specific recurring decisions (parser
  defer-all, `_run_sync`, nested embedding, references streaming, settings
  version, `RetrievalTesting` vs `RetrievalView`, `validate_workspace`, env sync).

After each file: strip markers, `git add` it, and keep `git diff --check` clean.
Regenerate `uv.lock` (`uv lock`) and `bun.lock` (`bun install`) from the resolved
manifests, not by editing lock conflicts.

### 4. Verify (all gates green)

Run `scripts/verify.sh .worktrees/integrate-<date>-upstream-main`. It runs
`git diff --check`, ruff, the **serial** backend suite, and WebUI
build/lint/test. Compare counts against the baseline. Any merge-introduced
red is a hard stop. For a failure that passes in isolation but fails in the
full suite, see the test-isolation triage in
`references/verification-and-gotchas.md` before treating it as a real defect.

### 5. Record and promote

- Write `docs/aegis/plans/<date>-upstream-main-merge.md` (goal, ownership
  boundary, conflict set, per-domain resolution decisions, verification counts,
  any known flake). Add a `docs/aegis/baseline/` entry if defaults/APIs/storage/
  deployment behavior changed materially.
- Commit the merge on the integration branch (preserve the two-parent structure;
  no `--amend`).
- Promote to `main` only after green gates. The established result is the merge
  commit landing on `main` (fast-forward, since the integration branch's first
  parent is `main`). `git push` is a separate, explicitly-confirmed step.

## Rollback

Before the merge commit: `git -C <worktree> merge --abort`. After integration
commits but before promotion: remove the worktree/branch and delete the tag.
After promotion: `git revert -m 1 <merge-commit>`. `git reset --hard
aegis/<date>-pre-upstream-merge` requires explicit user approval.

## Resources

- **`scripts/assess.sh`** — fetch, divergence/version report, tag+worktree, dry-merge conflict set + change profile.
- **`scripts/verify.sh`** — run all gates in the worktree.
- **`references/ownership-boundary.md`** — upstream-owned vs local-owned (二开) areas and per-area resolution defaults.
- **`references/conflict-playbook.md`** — change-profile strategies, git-archaeology, and recurring per-file decisions.
- **`references/verification-and-gotchas.md`** — gates, serial-vs-parallel testing, test-isolation triage, frontend `mock.module` pollution, env-example sync, lock regeneration.
