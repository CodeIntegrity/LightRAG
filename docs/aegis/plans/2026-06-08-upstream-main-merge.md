# 2026-06-08 upstream/main merge plan

## Goal

Merge `upstream/main@3da423bff93f3b5dba1a8733314ab40ebd304289` into the local integration branch `integrate/2026-06-08-upstream-main`, then only promote the result after the local product surface and upstream platform changes are both verified.

The pre-merge safety tag is `aegis/2026-06-08-pre-upstream-merge`, pointing to `fa34f764acc25f142f47b08052b6ec7034d1209e`.

## Architecture

Use upstream as the canonical owner for framework/platform internals:

- parser consolidation under `lightrag/parser/`
- chunker and sidecar behavior
- pipeline concurrency and parse/analyze/insert metadata
- role-specific LLM wiring and config defaults
- storage correctness improvements for OpenSearch, Postgres, Mongo, Qdrant, NetworkX, FAISS, and Milvus

Preserve local ownership for product extensions that upstream does not provide:

- API workspace runtime, workspace registry, workspace routes, guest access behavior
- graph workbench contracts, revision-token mutation guards, graph UI behavior
- custom chunk insertion and graph rebuild flows
- workspace-bound prompt editor and LLM-assisted prompt authoring added after local Prompt Management retirement
- Nebula/deployment adaptations unless explicitly retired by product decision

## Tech Stack

- Python: `uv`, `pytest`, `ruff`, FastAPI
- Frontend: Bun, Vite, React 19, TypeScript, Tailwind
- Storage backends: JSON, NetworkX, OpenSearch, Postgres, Mongo, Qdrant, Neo4j, Milvus, FAISS, Redis, Memgraph, local Nebula extension

## Baseline/Authority Refs

- `AGENTS.md`
- `docs/aegis/sop/upstream-merge-sop.md`
- `docs/analysis/2026-05-21-upstream-main-compatibility-report.md`
- `docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
- Current local `HEAD`: `fa34f764 docs(prompts): 记录提示词辅助生成接口`
- Current `origin/main`: `fa34f764`
- Current `upstream/main`: `3da423bf Merge branch 'claude/pr-3216-table-splitting-LNMim'`
- Merge base: `b62c26066142c91d690038af46b1d5757b5ccd43`

## Compatibility Boundary

- Do not silently drop local workspace, guest, graph workbench, custom chunks, prompt assistant, or Nebula-facing behavior.
- Do not reintroduce retired prompt-version-store / legacy Prompt Management owners.
- Keep API route behavior explicit when upstream and local both touch the same router.
- Regenerate lockfiles from resolved manifests instead of hand-editing lock conflicts.
- Preserve upstream defaults only after checking local deployment impact for `.env`, `env.example`, Docker/setup scripts, and version/API version values.
- No hidden fallback paths, mock-success behavior, swallowed exceptions, or duplicate source-of-truth owners.

## Verification

Pre-merge baseline commands must run in the integration worktree before starting the merge:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main status --short --branch
git -C .worktrees/integrate-2026-06-08-upstream-main diff --check
git -C .worktrees/integrate-2026-06-08-upstream-main ruff check lightrag/ tests/
git -C .worktrees/integrate-2026-06-08-upstream-main ./scripts/test.sh tests --test-workers 4
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun install --frozen-lockfile && bun run build && bun run lint
```

Post-merge full gates:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main diff --check
git -C .worktrees/integrate-2026-06-08-upstream-main ruff check lightrag/ tests/
git -C .worktrees/integrate-2026-06-08-upstream-main ./scripts/test.sh tests --test-workers 4
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun install --frozen-lockfile && bun run build && bun run lint && bun test
```

Targeted gates are listed in the task slices below. Any red gate stops promotion to `main`.

## Plan Basis

Facts:

- Local and `origin/main` are aligned at `fa34f764`.
- `upstream/main` is `445` commits ahead of merge base; local is `233` commits ahead.
- Upstream changed `342` files from merge base.
- A dry merge in a temporary worktree failed with `18` conflict files.
- The main working tree had one unrelated untracked `.rtk/` directory before preparation.

Conflict files from dry merge:

```text
env.example
lightrag/api/lightrag_server.py
lightrag/api/routers/document_routes.py
lightrag/api/routers/graph_routes.py
lightrag/kg/opensearch_impl.py
lightrag/lightrag.py
lightrag_webui/bun.lock
lightrag_webui/package.json
lightrag_webui/src/api/lightrag.ts
lightrag_webui/src/components/graph/PropertiesView.tsx
lightrag_webui/src/features/DocumentManager.tsx
lightrag_webui/src/features/documentStatusFilters.ts
lightrag_webui/src/locales/en.json
lightrag_webui/src/locales/zh.json
scripts/setup/lib/storage_requirements.sh
tests/kg/test_batch_graph_operations.py
tests/test_opensearch_storage.py
uv.lock
```

Assumptions:

- Local workspace/guest, graph workbench, custom chunks, prompt assistant, and Nebula support remain required.
- Upstream parser/chunker/pipeline/role-LLM/storage fixes should be absorbed unless a local regression is proven.
- The integration branch may carry multiple commits before final merge into `main`.

Unknowns to resolve during execution:

- Whether upstream changes make any local workspace or graph-workbench route redundant.
- Whether TypeScript 6 and dependency bumps introduce frontend type or build failures in local-only components.
- Whether Nebula should remain indefinitely or be scheduled for explicit retirement.

## Architecture Integrity Lens

- Invariant: one behavior owner per contract; local product extensions must not shadow upstream platform owners.
- Canonical owner / contract: upstream owns pipeline/parser/chunker/storage primitives; local owns API workspace/runtime, graph workbench, custom chunks, prompt assistant, and Nebula integration.
- Responsibility overlap: `lightrag/api/lightrag_server.py`, `document_routes.py`, `graph_routes.py`, `lightrag/lightrag.py`, `lightrag_webui/src/api/lightrag.ts`, and the lockfiles are overlap points.
- Higher-level simplification: resolve conflicts by taking upstream structure as the base for upstream-owned areas, then reapply local behavior at the API/product boundary. Do not patch callers when a router/runtime owner should carry the behavior.
- Retirement / falsifier: if upstream now provides equivalent behavior for a local feature, retire the local owner only with a named migration and passing local behavior tests.
- Verdict: proceed in the integration worktree; do not merge directly into `main`.

## Plan Pressure Test

- Owner / contract / retirement: high pressure; explicit owner matrix is required before each conflict group.
- Architecture integrity / higher-level path: use upstream-owned implementation where possible, then layer local behavior at the smallest correct owner.
- Verification scope: full backend test suite plus WebUI build/lint/test is required; targeted smoke is insufficient.
- Task executability: split by conflict domain so each commit has one reason to change.
- Pressure result: proceed with staged merge; promotion blocked until full gates pass.

## Plan-Time Complexity Check

- Target files: `lightrag/api/lightrag_server.py`, `document_routes.py`, `graph_routes.py`, `lightrag/lightrag.py`, `opensearch_impl.py`, `lightrag_webui/src/api/lightrag.ts`, `DocumentManager.tsx`, language JSON, lockfiles.
- Existing size / shape signals: several target files are large cross-cutting owners; conflict resolution in these files can easily create duplicate routing or config paths.
- Owner fit: edit in place for routers and core class because they already own the contracts; extract helpers only when a conflict block creates repeated local adapter logic.
- Add-in-place risk: high for `document_routes.py`, `lightrag.py`, and `lightrag_webui/src/api/lightrag.ts`.
- Better file boundary: keep reusable local workspace selection helpers in existing runtime/registry modules, not duplicated inside every route.
- Recommendation: split task by owner domain and commit after targeted green checks.

## Task 0 - Record clean integration baseline

Files:

- no source edits

Why:

- Separate pre-existing failures from merge-introduced failures.

Impact/Compatibility:

- No behavior change.

Verification:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main status --short --branch
git -C .worktrees/integrate-2026-06-08-upstream-main diff --check
git -C .worktrees/integrate-2026-06-08-upstream-main ruff check lightrag/ tests/
git -C .worktrees/integrate-2026-06-08-upstream-main ./scripts/test.sh tests --test-workers 4
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun install --frozen-lockfile && bun run build && bun run lint
```

Steps:

- [ ] Run the baseline commands above and save output summary in this plan's Verification Notes section.
- [ ] If a command fails before merge, record the failing command, exit code, and first actionable failure.
- [ ] Do not start the merge until pre-merge failures are classified as baseline failures or fixed.
- [ ] Commit only if baseline documentation changes are made in the integration branch.

## Task 1 - Start dry merge in the integration worktree

Files:

- merge index only until conflicts are resolved

Why:

- Reproduce the known conflict set in the durable integration branch.

Impact/Compatibility:

- No promotion to `main`; merge remains uncommitted until resolved and verified.

Verification:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main merge --no-commit --no-ff upstream/main
git -C .worktrees/integrate-2026-06-08-upstream-main diff --name-only --diff-filter=U
git -C .worktrees/integrate-2026-06-08-upstream-main status --short
```

Expected merge result before manual resolution:

- `git merge` exits non-zero.
- Conflict list includes the 18 files recorded in Plan Basis unless upstream changed again.

Steps:

- [ ] Run the merge command in the integration worktree.
- [ ] Save the actual conflict list.
- [ ] Stop if `upstream/main` changed after this plan; fetch and repeat the conflict assessment before resolving.
- [ ] Do not stage unrelated generated files.

## Task 2 - Resolve dependency, version, and environment surfaces

Files:

- `lightrag/_version.py`
- `pyproject.toml`
- `uv.lock`
- `requirements-offline.txt`
- `requirements-offline-storage.txt`
- `env.example`
- `scripts/setup/lib/storage_requirements.sh`
- `lightrag_webui/package.json`
- `lightrag_webui/bun.lock`

Why:

- Lockfile and env conflicts determine whether tests and builds are reproducible.

Impact/Compatibility:

- Absorb upstream `1.5.1 / API 0306`, FastAPI minimum, Redis range, FAISS extra, and frontend package bumps.
- Preserve local dependencies required by local-only UI such as YAML editing and prompt assistant.
- Do not drop Nebula dependency or setup wiring without a separate retirement decision.

Repair Track:

- Root cause: both local and upstream changed dependency manifests and generated lockfiles.
- Canonical owner: manifests are source of truth; lockfiles are regenerated artifacts.
- Minimal repair: resolve manifests first, regenerate `uv.lock` and `bun.lock`, then inspect diff.
- Compatibility boundary: local prompt editor and Nebula flows must still install.
- Verification: lock regeneration plus backend/frontend install/build gates.

Retirement Track:

- Old owner/fallback: hand-edited lock conflict hunks.
- Active status: prohibited for final merge.
- Deletion trigger: generated lockfiles after resolved manifests.

Verification:

```bash
cd .worktrees/integrate-2026-06-08-upstream-main && uv lock
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun install --frozen-lockfile
git -C .worktrees/integrate-2026-06-08-upstream-main diff --check
```

Steps:

- [ ] Resolve `pyproject.toml`, requirements, setup script, and `package.json` conflicts before lockfiles.
- [ ] Run `uv lock` from the integration worktree root.
- [ ] Run `bun install --frozen-lockfile` from `lightrag_webui`.
- [ ] Inspect lockfile diffs for unexpected package removal.
- [ ] Commit as `merge-prep(deps): resolve upstream dependency surfaces`.

## Task 3 - Resolve backend server, config, and document pipeline routes

Files:

- `lightrag/api/config.py`
- `lightrag/api/lightrag_server.py`
- `lightrag/api/routers/document_routes.py`
- `lightrag/api/routers/query_routes.py`
- `lightrag/api/workspace_registry.py`
- `lightrag/api/workspace_runtime.py`
- `lightrag/pipeline.py`
- `lightrag/utils_pipeline.py`
- related tests under `tests/api/`, `tests/pipeline/`, and local workspace runtime tests

Why:

- This is the main contract boundary where upstream pipeline semantics and local workspace runtime must coexist.

Impact/Compatibility:

- Preserve upstream enqueue reservation, pipeline busy/scanning semantics, parser metadata, and role-LLM config export.
- Preserve local workspace runtime object selection, guest visibility, workspace registry, and custom document operations.
- Do not reintroduce retired prompt-version-store state.

Repair Track:

- Root cause: upstream and local both changed route orchestration and app assembly.
- Canonical owner: `workspace_runtime.py` owns local runtime selection; routers call it instead of duplicating workspace resolution.
- Minimal repair: take upstream route behavior for pipeline safety, then inject local runtime binding at route boundaries.
- Compatibility boundary: existing local workspace endpoints and document upload/query behavior remain callable.
- Verification: targeted route tests and full backend suite.

Retirement Track:

- Old owner/fallback: prompt-version-store and prompt override API parameters.
- Active status: retired; do not revive.
- Deletion trigger: any remaining imports or tests referencing retired prompt version store are removed or rewritten.

Verification:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main diff --check
git -C .worktrees/integrate-2026-06-08-upstream-main ruff check lightrag/api lightrag/pipeline.py lightrag/utils_pipeline.py tests/api tests/pipeline
git -C .worktrees/integrate-2026-06-08-upstream-main ./scripts/test.sh tests/api tests/pipeline tests/test_workspace_runtime_manager.py tests/test_document_routes_workspace_runtime.py --test-workers 4
```

Steps:

- [ ] Resolve `lightrag_server.py` with upstream app/config structure plus local workspace routes/runtime.
- [ ] Resolve `document_routes.py` with upstream enqueue guards plus local runtime-bound `rag` selection.
- [ ] Update or remove tests that assert retired prompt-management parameters.
- [ ] Run targeted route/runtime tests.
- [ ] Commit as `merge(api): combine upstream pipeline routes with local workspace runtime`.

## Task 4 - Resolve core LightRAG and graph contracts

Files:

- `lightrag/lightrag.py`
- `lightrag/api/routers/graph_routes.py`
- `lightrag/api/graph_workbench.py`
- `lightrag/utils_graph.py`
- `lightrag/base.py`
- graph/custom-chunk tests under `tests/api/routes/`, `tests/kg/`, and local graph tests

Why:

- Local graph workbench, revision tokens, directed custom KG dedupe, and custom chunk rebuild must survive while upstream graph mutation guards and core mixin behavior are absorbed.

Impact/Compatibility:

- Preserve `LightRAG` mixin composition and upstream prompt-profile behavior.
- Preserve local `ainsert_custom_chunks`, graph rebuild, revision-token mutation, and direction handling behavior.
- Keep graph mutation blocked during pipeline busy states where upstream added protection.

Repair Track:

- Root cause: local core extensions and upstream core refactors both target `lightrag.py` and graph routers.
- Canonical owner: `LightRAG` owns cross-flow core APIs; graph routes own HTTP validation; graph workbench owns product query UX.
- Minimal repair: merge upstream class structure first, then reapply local public APIs with focused tests.
- Compatibility boundary: local custom chunk and graph workbench APIs remain stable.
- Verification: graph/custom chunk route tests and core tests.

Retirement Track:

- Old owner/fallback: caller-side graph direction filtering when storage owner can apply direction earlier.
- Active status: inspect during conflict resolution.
- Deletion trigger: if storage/API owner handles direction, remove duplicate post-filter branches.

Verification:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main ruff check lightrag/lightrag.py lightrag/api/routers/graph_routes.py lightrag/api/graph_workbench.py lightrag/utils_graph.py tests
git -C .worktrees/integrate-2026-06-08-upstream-main ./scripts/test.sh tests/test_graph_routes.py tests/test_graph_workbench.py tests/test_document_additional_routes.py tests/kg/test_graph_storage.py --test-workers 4
```

Steps:

- [ ] Resolve `lightrag.py` using upstream mixin/config behavior as base.
- [ ] Reapply local custom chunk and directed KG behavior with no duplicate prompt-management owner.
- [ ] Resolve `graph_routes.py` by preserving local workbench/revision-token routes and upstream busy guards.
- [ ] Run targeted graph/custom chunk tests.
- [ ] Commit as `merge(graph): preserve local graph workbench over upstream core updates`.

## Task 5 - Resolve storage backend behavior

Files:

- `lightrag/kg/opensearch_impl.py`
- `lightrag/kg/postgres_impl.py`
- `lightrag/kg/mongo_impl.py`
- `lightrag/kg/qdrant_impl.py`
- `lightrag/kg/networkx_impl.py`
- `lightrag/kg/faiss_impl.py`
- `lightrag/kg/nebula_impl.py`
- storage tests under `tests/kg/`

Why:

- Upstream storage fixes include batch operations, canonical edge IDs, deferred embedding, atomic writes, and failure surfacing.

Impact/Compatibility:

- Prefer upstream correctness fixes for shared storage backends.
- Preserve local graph edge direction/custom property behavior where upstream lacks equivalent behavior.
- Keep Nebula support unless explicitly retired.

Repair Track:

- Root cause: storage backends are shared correctness owners with local product-level extensions.
- Canonical owner: backend implementation owns persistence semantics; API/workbench owns product filtering.
- Minimal repair: absorb upstream backend fixes, then reapply only local storage behavior not covered upstream.
- Compatibility boundary: existing data should not need destructive migration for JSON/NetworkX/OpenSearch/Postgres local use.
- Verification: storage-specific tests and full backend suite.

Retirement Track:

- Old owner/fallback: root-level storage tests moved by upstream.
- Active status: migrate local assertions into upstream `tests/kg/...` layout.
- Deletion trigger: remove duplicated root-level test files after assertions are ported.

Verification:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main ruff check lightrag/kg tests/kg
git -C .worktrees/integrate-2026-06-08-upstream-main ./scripts/test.sh tests/kg --test-workers 4
```

Steps:

- [ ] Resolve `opensearch_impl.py` conflict by comparing local assertions against upstream storage tests.
- [ ] Port local `tests/test_opensearch_storage.py` assertions into `tests/kg/opensearch_impl/test_opensearch_storage.py`.
- [ ] Inspect other storage diffs for local edge direction/custom property behavior.
- [ ] Run storage test group.
- [ ] Commit as `merge(storage): absorb upstream backend fixes and local graph semantics`.

## Task 6 - Resolve parser, chunker, sidecar, and test topology

Files:

- `lightrag/parser/`
- `lightrag/native_parser/`
- `lightrag/external_parser/`
- `lightrag/parser_routing.py`
- `lightrag/sidecar/`
- `lightrag/chunker/`
- tests under `tests/parser/`, `tests/chunker/`, `tests/sidecar/`, and local root-level tests affected by upstream moves

Why:

- Upstream reorganized parser modules and tests while adding substantial chunking and sidecar behavior.

Impact/Compatibility:

- Prefer upstream parser package layout.
- Preserve local import compatibility only where public or documented local code still imports old paths.
- Avoid duplicate tests across old and new directories.

Repair Track:

- Root cause: module relocation plus behavior changes.
- Canonical owner: `lightrag/parser/` is the new parser owner.
- Minimal repair: move local test assertions to upstream directory layout; add import shims only when local public API requires them.
- Compatibility boundary: documented parser CLI/debug commands remain usable.
- Verification: parser/chunker/sidecar tests.

Retirement Track:

- Old owner/fallback: `lightrag/native_parser`, `lightrag/external_parser`, root parser test files.
- Active status: keep only if imports are still exposed intentionally.
- Deletion trigger: no local imports or tests need old path.

Verification:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main ruff check lightrag/parser lightrag/chunker lightrag/sidecar tests/parser tests/chunker tests/sidecar
git -C .worktrees/integrate-2026-06-08-upstream-main ./scripts/test.sh tests/parser tests/chunker tests/sidecar --test-workers 4
```

Steps:

- [ ] Accept upstream parser package structure unless local imports prove a compatibility need.
- [ ] Move local test assertions into upstream test folders.
- [ ] Run parser/chunker/sidecar targeted tests.
- [ ] Commit as `merge(parser): align local tests with upstream parser layout`.

## Task 7 - Resolve WebUI API, graph, document, prompt assistant, and i18n

Files:

- `lightrag_webui/src/api/lightrag.ts`
- `lightrag_webui/src/features/DocumentManager.tsx`
- `lightrag_webui/src/components/graph/PropertiesView.tsx`
- `lightrag_webui/src/features/documentStatusFilters.ts`
- `lightrag_webui/src/locales/en.json`
- `lightrag_webui/src/locales/zh.json`
- local prompt assistant/editor files and tests

Why:

- WebUI is where upstream document/parser status additions and local workspace/graph/prompt assistant product flows meet.

Impact/Compatibility:

- Keep local workspace header and workspace API helpers.
- Keep graph workbench and revision-token client contracts.
- Keep prompt assistant/editor UI and dependencies.
- Absorb upstream parser routing/status card fields and document status filter split.

Repair Track:

- Root cause: single frontend API contract file carries both upstream and local product contracts.
- Canonical owner: `src/api/lightrag.ts` owns API types; feature components consume those types.
- Minimal repair: merge upstream fields into local API types, then update affected feature components.
- Compatibility boundary: no local page loses required route, i18n key, or API helper.
- Verification: frontend build, lint, and targeted Bun tests.

Retirement Track:

- Old owner/fallback: stale prompt-management persisted keys and tests.
- Active status: keep only compatibility cleanup code if old browser state can break current UI.
- Deletion trigger: no current store reads the legacy keys.

Verification:

```bash
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun install --frozen-lockfile
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun test src/api/lightrag.test.ts src/api/lightrag.workspace.test.ts src/stores/backendState.workspace.test.ts
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun test src/stores/graphWorkbench.test.ts src/components/workspace/WorkspaceManagerDialog.test.tsx src/components/workspace/WorkspaceSwitcher.test.tsx
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun run build && bun run lint
```

Steps:

- [ ] Resolve `src/api/lightrag.ts` by preserving local workspace/graph/prompt helpers and adding upstream parser/status fields.
- [ ] Resolve document and graph component conflicts against the merged API types.
- [ ] Resolve `en.json` and `zh.json` by keeping local prompt assistant keys plus upstream status/filter keys.
- [ ] Run targeted frontend tests, build, and lint.
- [ ] Commit as `merge(webui): combine upstream status UI with local workspace graph prompt flows`.

## Task 8 - Full verification and merge receipt

Files:

- `docs/aegis/plans/2026-06-08-upstream-main-merge.md`
- `docs/aegis/baseline/2026-06-08-upstream-main-merge.md` if defaults, APIs, storage behavior, or deployment surface changed materially

Why:

- The final merge result needs auditable evidence and baseline sync before promotion.

Impact/Compatibility:

- Documentation-only updates after code is verified.

Verification:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main status --short --branch
git -C .worktrees/integrate-2026-06-08-upstream-main diff --check
git -C .worktrees/integrate-2026-06-08-upstream-main ruff check lightrag/ tests/
git -C .worktrees/integrate-2026-06-08-upstream-main ./scripts/test.sh tests --test-workers 4
cd .worktrees/integrate-2026-06-08-upstream-main/lightrag_webui && bun install --frozen-lockfile && bun run build && bun run lint && bun test
```

Steps:

- [ ] Run every full verification command.
- [ ] Record command, exit code, and summary counts in Verification Notes.
- [ ] Add baseline entry if merged defaults/API/storage/deployment behavior changed.
- [ ] Commit the merge and documentation as separate commits if documentation was updated after code verification.
- [ ] Only after green gates, merge `integrate/2026-06-08-upstream-main` into `main` with `--no-ff`.

## Rollback Surface

Before merge commit:

```bash
git -C .worktrees/integrate-2026-06-08-upstream-main merge --abort
```

After integration branch commits but before promotion:

```bash
git worktree remove .worktrees/integrate-2026-06-08-upstream-main
git branch -D integrate/2026-06-08-upstream-main
git tag -d aegis/2026-06-08-pre-upstream-merge
```

After promotion to `main`:

```bash
git revert -m 1 <merge-commit-sha>
```

`git reset --hard` is not part of the default rollback path and requires explicit approval.

## Verification Notes

Preparation evidence already collected:

```text
main/origin: fa34f764acc25f142f47b08052b6ec7034d1209e
upstream/main: 3da423bff93f3b5dba1a8733314ab40ebd304289
merge-base: b62c26066142c91d690038af46b1d5757b5ccd43
ahead/behind HEAD...upstream/main: 233 / 445
dry merge exit: 1
dry merge conflict files: 18
integration worktree: .worktrees/integrate-2026-06-08-upstream-main
pre-merge safety tag: aegis/2026-06-08-pre-upstream-merge
```

Fresh baseline and post-merge verification results are recorded here during execution.

