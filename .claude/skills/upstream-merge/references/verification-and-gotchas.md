# Verification & Gotchas

## The gates

```bash
git diff --check                                   # no whitespace / leftover markers
uv run ruff check lightrag/ tests/                 # ruff is NOT on PATH → use `uv run`
./scripts/test.sh tests --test-workers 1           # serial backend suite
(cd lightrag_webui && bun install --frozen-lockfile && bun run build && bun run lint && bun test)
```

Compare post-merge counts against the pre-merge baseline. Any **merge-introduced**
red is a hard stop; pre-existing reds are documented, not silently carried.

## Tooling

- `ruff` is not on PATH — always `uv run ruff`.
- Use the full extras for the env, or provider tests ImportError at collection:
  `uv sync --extra api --extra test --extra offline-storage --extra offline-llm`
  (just `--extra test` only installs lint/pytest tooling).

## `--test-workers` does NOT parallelize the main suite

`--test-workers` is a custom option in `tests/conftest.py` consumed only by
stress tests; the main pytest run is **serial regardless**. So `--test-workers 1`
and `--test-workers 4` give identical results. Use the serial full-suite run as
the deterministic gate and baseline-comparison point.

## Pre-existing test-isolation fragility (triage before treating as a defect)

The suite has cumulative, order-dependent global-state leakage between tests
that **do not reset** shared globals:

- `auth_handler.accounts` / `global_args.auth_accounts` (module-level auth),
- `shared_storage` Manager (`initialize_share_data` without `finalize_share_data`),
- workspace-runtime ContextVars (`_current_runtime` / `_current_workspace`),
- the workspace registry.

Symptoms: a test **passes in isolation** (alone / in its file / in its dir) but
**fails in the full suite**; the failing set varies with collection order. This
exists on local `main` independent of any merge — e.g. `test_path_prefixes`,
`test_graph_routes_pipeline_busy`, `test_document_routes_chunking`,
`test_document_routes_paginated` all fail in various subset runs on `main`.

**Triage a new full-suite failure:**
1. Run it alone, then in its file, then in its directory.
2. If it passes isolated, it is **isolation pollution, not a code defect**.
3. Confirm the symptom: e.g. `/query/stream` returning `application/json` instead
   of `application/x-ndjson` is a leaked global **auth** state producing a
   `401 "No credentials provided"` (auth gate fires from module-level
   `auth_enabled`/`api_key_configured`, not the request's own config).
4. Fixing the systemic suite isolation is **out of scope for a merge** — document
   the flake in the plan and move on. Targeted per-test resets
   (shared_storage / ContextVars / registry / auth accounts) often do **not**
   isolate it because the leak is multi-layered.

Known flake (2026-06-15): a NEW upstream test,
`tests/api/routes/test_query_stream_routes.py::TestQueryStreamResponseContentType::test_stream_response_has_ndjson_content_type`
— correct in isolation, fails in full suite via leaked global auth.

## Frontend `mock.module` pollution

Bun's `mock.module()` is **process-global and leaks across test files**. An
upstream test file that `mock.module`s shared modules (`@/stores/settings`,
`@/lib/utils`, etc.) will break dozens of unrelated tests that run after it in
the same `bun test` process (symptom: `useSettingsStore.setState is not a
function`, `useSettingsStore.use.X` undefined).

Confirm by running the broken test file **alone** (it passes). If the polluting
file tests a **rejected** upstream refactor, remove it (e.g. 2026-06-15:
removed `src/api/lightrag-stream.test.ts`, which fixed 61 frontend failures at
once). Otherwise scope its mocks so they don't leak.

## env-example sync (`tests/test_env_examples_completeness.py`)

The suite enforces:
1. `env.example` and `env.zh.example` define the **same variable set**.
2. Both cover every code-defined var (anything read via `get_env_value` /
   `os.getenv` / `os.environ.get`).

The regex counts commented forms too (`# VAR=` matches). After a merge, add any
new code-defined vars to **both** files (e.g. 2026-06-15:
`MILVUS_MIGRATION_BATCH_SLEEP`, `TIKTOKEN_MODEL_NAME`). Mirror Milvus migration /
provider sections between the two files.

## Frontend debugging

For WebUI bugs visible only in the rendered DOM, drive the dev server with the
webapp-testing approach (see `AGENTS.md` "Frontend Debugging"). Seed state via
`localStorage` key `settings-storage` (schema in `src/stores/settings.ts`).
