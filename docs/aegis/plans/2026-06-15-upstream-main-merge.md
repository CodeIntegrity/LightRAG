# 2026-06-15 upstream/main merge plan

## Goal

Merge `upstream/main@6232cd54` into the local integration branch
`integrate/2026-06-15-upstream-main`, then promote to `main` only after the
local product surface and upstream platform changes are both verified green.

Pre-merge safety tag: `aegis/2026-06-15-pre-upstream-merge` → `158eb09d`.
Integration worktree: `.worktrees/integrate-2026-06-15-upstream-main`.

## Architecture (ownership boundary)

Upstream is canonical owner for framework/platform internals:

- parser package under `lightrag/parser/`, chunker, sidecar
- pipeline concurrency and parse/analyze/insert metadata
- role-specific LLM wiring and config defaults
- storage correctness fixes (OpenSearch, Postgres, Mongo, Qdrant, NetworkX,
  FAISS, Milvus) — including new **workspace name path-traversal validation**

Local retains ownership for product extensions upstream does not provide:

- API workspace runtime / registry / routes, guest access behavior
- graph workbench contracts, revision-token mutation guards, graph UI
- custom chunk insertion (`ainsert_custom_chunks`) and graph rebuild flows
- workspace-bound prompt editor and LLM-assisted prompt authoring
- Nebula deployment adaptation (keep unless explicitly retired)

## Baseline / Authority Refs

- `AGENTS.md`
- `docs/aegis/sop/upstream-merge-sop.md`
- `docs/aegis/plans/2026-06-08-upstream-main-merge.md` (previous merge)
- Local `HEAD` / `origin/main`: `158eb09d fix(prompt): generate complete assist profiles`
- `upstream/main`: `6232cd54 Fix linting`
- Merge base: `3da423bf` (2026-06-07)
- ahead/behind `HEAD...upstream/main`: 257 / 230
- Version: local `1.5.1` / API `0306` → upstream `1.5.3` / API `0311`
- Upstream changed 194 files (tests 83, webui 22, core 20, parser 19,
  docs 15, kg 14, api/routers 3, api 3).

## Compatibility Boundary

- Do not silently drop local workspace, guest, graph workbench, custom chunks,
  prompt assistant/editor, or Nebula behavior.
- Do not reintroduce retired prompt-version-store / legacy Prompt Management.
- Keep API route behavior explicit where upstream and local touch the same router.
- Regenerate lockfiles from resolved manifests; never hand-edit lock conflicts.
- Preserve upstream defaults only after checking local `.env` / `env.example` /
  Docker / setup / version impact.
- No hidden fallback paths, mock-success, swallowed exceptions, or duplicate
  source-of-truth owners.

## Verification gates (every one must be green before promotion)

```bash
cd .worktrees/integrate-2026-06-15-upstream-main
git diff --check
uv run ruff check lightrag/ tests/
./scripts/test.sh tests --test-workers 4
cd lightrag_webui && bun install --frozen-lockfile && bun run build && bun run lint && bun test
```

## Plan Basis

- Dry merge `git merge --no-commit --no-ff upstream/main` exits non-zero with
  **13 conflict files**:

```text
lightrag/api/lightrag_server.py
lightrag/api/routers/document_routes.py
lightrag/lightrag.py
lightrag/utils_graph.py
lightrag_webui/bun.lock
lightrag_webui/package.json
lightrag_webui/src/App.tsx
lightrag_webui/src/api/lightrag.test.ts
lightrag_webui/src/api/lightrag.ts
lightrag_webui/src/components/retrieval/ChatMessage.tsx
lightrag_webui/src/features/RetrievalView.tsx
lightrag_webui/src/stores/settings.ts
tests/api/routes/test_document_routes_docx_archive.py
```

- Storage backends merged cleanly this round (no `kg/*_impl.py` conflicts).

## Tasks (by conflict domain)

- **Task 0** — record clean pre-merge baseline (separate pre-existing vs
  merge-introduced failures). No source edits.
- **Task 1** — deps/version/env: `package.json`, `bun.lock`, `pyproject.toml`,
  `_version.py`, `env.example`. Resolve manifests, regenerate locks.
- **Task 2** — backend API: `lightrag_server.py`, `document_routes.py`. Take
  upstream pipeline/validation behavior; reapply local workspace runtime + routes.
- **Task 3** — core/graph: `lightrag.py`, `utils_graph.py`. Upstream mixin/core
  base; reapply local custom-chunk + directed-KG + graph-workbench behavior.
- **Task 4** — WebUI: `api/lightrag.ts` (+ `.test.ts`), `App.tsx`,
  `ChatMessage.tsx`, `RetrievalView.tsx`, `settings.ts`. Merge upstream
  fields/UI into local workspace/graph/prompt contracts.
- **Task 5** — tests: `test_document_routes_docx_archive.py` and any fakes
  needing current upstream contracts.
- **Task 6** — full verification + merge receipt; baseline entry if defaults
  changed; promote to `main` with `--no-ff` only after green gates.

## Rollback Surface

Before merge commit: `git merge --abort`.
After integration commits, before promotion:
`git worktree remove .worktrees/integrate-2026-06-15-upstream-main`,
`git branch -D integrate/2026-06-15-upstream-main`,
`git tag -d aegis/2026-06-15-pre-upstream-merge`.
After promotion: `git revert -m 1 <merge-commit-sha>`.
`git reset --hard` requires explicit approval.

## Verification Notes

### 2026-06-15 pre-merge baseline (clean integration branch == main @ 158eb09d)

```text
git diff --check                              PASS (clean)
uv run ruff check lightrag/ tests/            PASS (All checks passed!)
./scripts/test.sh tests --test-workers 1      PASS: 2493 passed, 33 skipped in 44.06s
./scripts/test.sh tests --test-workers 4      2 failed, 2491 passed, 33 skipped  (see note)
lightrag_webui bun install --frozen-lockfile  PASS
lightrag_webui bun run build                  PASS (built in ~0.9s)
lightrag_webui bun run lint                   PASS (exit 0; 71 pre-existing warnings, 0 errors)
```

**Pre-existing parallel-test flakiness (NOT a product bug, NOT merge-introduced):**
Under `--test-workers 4` a small set of API tests fail due to shared-global-state
leakage between xdist workers (e.g. `test_path_prefixes.py`,
`test_graph_routes_pipeline_busy.py`). The exact set varies with worker
distribution; all pass in isolation and the full **serial** run is green
(2493 passed). The authoritative pre/post comparison gate for this merge is the
**serial** run. Fixing the isolation leakage is out of scope for this merge.

### Per-conflict-file change profile (vs merge-base 3da423bf)

```text
lightrag/api/lightrag_server.py                local[+635 -165]   upstream[+413 -385]  both-heavy
lightrag/api/routers/document_routes.py        local[+1407 -1184] upstream[+131 -662]  both-heavy
lightrag/lightrag.py                           local[+962 -86]    upstream[+238 -47]   both-heavy
lightrag/utils_graph.py                        local[+1147 -14]   upstream[+162 -20]   local-base+graft
lightrag_webui/src/api/lightrag.ts             local[+847 -145]   upstream[+234 -220]  both-heavy
lightrag_webui/src/App.tsx                     local[+95 -20]     upstream[+2 -2]      local-base+graft
lightrag_webui/src/components/.../ChatMessage  local[+106 -458]   upstream[+8 -1]      local-base+graft
lightrag_webui/src/stores/settings.ts          local[+476 -309]   upstream[+14 -3]     local-base+graft
lightrag_webui/src/features/RetrievalView.tsx  local[none]        upstream[+920 -0]    rename: local→RetrievalTesting.tsx
tests/api/routes/test_document_routes_docx...  local[+5 -0]       upstream[+240 -38]   upstream-base+graft
```

### Merge resolution log

### 2026-06-15 post-merge verification

```text
git diff --check (staged)                     PASS (clean, 0 conflict markers anywhere)
uv run ruff check lightrag/ tests/            PASS (All checks passed!)
./scripts/test.sh tests                       2879 passed, 1 failed, 34 skipped  (see flake note)
lightrag_webui bun install --frozen-lockfile  PASS
lightrag_webui bun run build                  PASS
lightrag_webui bun run lint                   PASS (exit 0; 71 pre-existing warnings)
lightrag_webui bun test                       231 passed, 0 failed  (== pre-merge baseline)
```

Pre-merge baseline was 2493 backend tests; upstream added ~386 → 2880 total.

**Resolution decisions (13 conflicts):**

- deps/version: `_version.py` → upstream 1.5.3/0311; `package.json` kept local
  `@uiw/react-codemirror` + took upstream `axios ^1.17.0`; regenerated `bun.lock`;
  `pyproject.toml` auto-merged (+`lightrag-rebuild-vdb` script).
- `utils_graph.py`: union import (local `remove_think_tags` + upstream
  `VectorStorageConsistencyError`/`safe_vdb_operation_with_exception`).
- `document_routes.py`: adopted upstream **defer-all parser architecture**
  (removed dead inline legacy extractors → now in `lightrag/parser/legacy/`,
  validated by upstream's new docx-defer test); kept local workspace-runtime
  upload path + synchronous `FilenameParserHintError` rejection; kept local
  compact `run_scanning_process` classification (uses `valid_files`).
- `lightrag.py`: union module helpers + upstream `_run_sync`; kept local lazy
  `initialize_storages` + grafted upstream `_owning_loop`; converted
  `insert_custom_chunks`/`insert_custom_kg` sync wrappers to `_run_sync` while
  preserving local `file_path`/`directed_relation_dedup` args + local
  `arebuild_all_custom_chunks_graphs`.
- `lightrag_server.py`: union imports (local workspace routes + upstream parser
  plugins/routing); kept local nested embedding architecture (rejected upstream's
  duplicate module-level `create_optimized_embedding_function`/
  `create_embedding_function_from_args`); absorbed upstream parser-plugin startup
  discovery; union `get_status` (local capabilities + upstream server_mode/workers).
- WebUI: kept local lazy-import `App.tsx`; kept local `ChatMessage.tsx` (rejected
  inert `isAborted`); kept local `settings.ts` v31 (rejected upstream
  `suggestedUserPrompts` seed); restored local `RetrievalTesting.tsx` + dropped
  upstream `RetrievalView.tsx`; replaced `api/lightrag.ts` streaming section with
  local version (preserves `onReferences`/`processNDJSONStream` references
  feature); kept local NDJSON test, removed upstream `lightrag-stream.test.ts`
  (tested rejected upstream streaming refactor + globally `mock.module`-polluted
  the suite — root cause of an initial 61 frontend failures).
- env: synced `env.example` ≡ `env.zh.example` and added code-defined
  `MILVUS_MIGRATION_BATCH_SLEEP` + `TIKTOKEN_MODEL_NAME`.

**Known flake (NOT a merge defect, NOT a 二开 issue):**
`tests/api/routes/test_query_stream_routes.py::TestQueryStreamResponseContentType::
test_stream_response_has_ndjson_content_type` — a NEW upstream test. It **passes
in isolation** (alone, in its file, in `tests/api/routes`, in `tests/api`) but
fails only in the full suite: another test leaves global auth state enabled
(request gets `401 application/json` instead of the ndjson stream — confirmed via
debug). This is the same pre-existing, suite-wide test-isolation fragility already
present at baseline (e.g. `test_path_prefixes`, `test_graph_routes_pipeline_busy`,
`test_document_routes_chunking` all fail in various subset/parallel runs on local
`main` too). The `/query/stream` endpoint itself is correct. Targeted resets
(shared_storage / workspace-runtime ContextVars / registry path / auth accounts)
did not isolate it — the leak is cumulative/order-dependent. Fixing the systemic
suite isolation is out of scope for this merge; the upstream test is left as-is.
