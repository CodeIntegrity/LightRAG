# Conflict-Resolution Playbook

## Pick strategy from the change profile

`assess.sh` prints, per conflict file, `local[+ins -del] upstream[+ins -del]`
vs the merge-base. Read it as:

| Profile | Meaning | Strategy |
|---|---|---|
| local-heavy + upstream-tiny | local rewrote it; upstream barely touched | Keep **local** as base; graft the small upstream delta (`git diff <base>..<upstream> -- <file>` to see exactly what it is). |
| upstream-heavy + local-tiny | upstream rewrote it; local barely touched | Take **upstream** as base; reapply the small local bits. |
| both-heavy | genuine divergence | Resolve **hunk-by-hunk**. If the conflict is one function in an upstream-owned area, splice upstream's whole function (consistency beats partial merge). |
| `local[none]` but conflicting | usually a **rename**: local renamed/removed the file, upstream modified it | Keep local's rename target; `git rm` the upstream-named file. |
| add/add, disjoint content | both added different code at the same spot | **Union** — keep both. |

## Decide intent with git archaeology

When unsure whether local *intentionally* diverged or merely inherited base:

```bash
git show <merge-base>:<file>      # what both started from
git show main:<file>             # local
git show upstream/main:<file>    # upstream
```

- If `local == base` and upstream evolved → local has no intent here → **take upstream**.
- If `local != base` → local deliberately changed it → **preserve local**, graft upstream.

Use the same technique on a single function: extract it from each ref and diff
to confirm feature-equivalence before choosing.

## After every resolution

- Strip all markers; `git add` the file; keep `git diff --check` clean.
- Verify each grafted symbol **exists and is used**: `uv run ruff check <file>`
  catches unused imports (F401) and undefined names (F821); for cross-module
  symbols run `uv run python -c "from lightrag.x import y"`.
- Run the file's targeted test as you go (e.g. the docx-defer test validates the
  document-route parser resolution; `bun test <file>` for a WebUI file).

## Lockfiles — regenerate, never hand-edit

1. Resolve `pyproject.toml` / `lightrag_webui/package.json` first (keep local
   deps like `@uiw/react-codemirror`; absorb upstream version bumps).
2. `git checkout --ours lightrag_webui/bun.lock && (cd lightrag_webui && bun install)`
   then verify with `bun install --frozen-lockfile`.
3. `uv lock` from the worktree root; inspect the diff for unexpected removals.

## Recurring decisions (verified 2026-06; re-confirm each cycle)

- **Parser defer-all**: upstream moved legacy text extractors out of
  `document_routes.py` into `lightrag/parser/legacy/extractors.py` and defers
  extraction to the worker (`LegacyParser`). Local never customized that path
  (it matched base) → **adopt upstream**: remove the dead inline `_extract_*`
  defs and the eager-legacy branch in `pipeline_enqueue_file`; take upstream's
  unified deferral. Validated by the new `test_document_routes_docx_archive.py`
  defer test. Drop the now-unused `PARSER_ENGINE_LEGACY` import.
- **`_run_sync`**: upstream wraps all sync wrappers for event-loop safety
  (`_owning_loop`). Union the `_run_sync` def; graft `self._owning_loop =
  asyncio.get_running_loop()` into `initialize_storages`' CREATED branch (keep
  local's `storages`/`storage_status` lazy-init); convert
  `insert_custom_chunks`/`insert_custom_kg` to `_run_sync` **keeping local args**
  (`file_path`, `directed_relation_dedup`) and keep `arebuild_all_custom_chunks_graphs`.
- **Embedding function**: local keeps `create_optimized_embedding_function`
  **nested inside `create_app`**; upstream promoted it to module level + added
  `create_embedding_function_from_args`. They are feature-equivalent (asymmetric
  / prefixes / dimensions) → **keep local nested** version (take HEAD for those
  regions); reject upstream's duplicate module-level defs to avoid a duplicate
  `_PROVIDER_LOG_LABELS` / `create_optimized_embedding_function`.
- **Streaming / references**: local owns `onReferences` + `processNDJSONStream`.
  Replace the whole `api/lightrag.ts` streaming section
  (`getDocumentsScanProgress` → before `insertText`) with **local main's**
  version. Remove upstream `src/api/lightrag-stream.test.ts` (it tests the
  rejected `_readNdjsonStream`/`isUserAbortError` refactor AND globally
  `mock.module`s the suite — see verification-and-gotchas). Keep local's NDJSON
  test in `lightrag.test.ts`.
- **settings.ts**: keep local (higher persist `version`); reject upstream's
  `suggestedUserPrompts` seeding of `userPromptHistory`.
- **`RetrievalView` → `RetrievalTesting`**: rename conflict — `git rm` the
  upstream `RetrievalView.tsx`, restore `RetrievalTesting.tsx` from `main`,
  keep `App.tsx` importing `RetrievalTesting`.
- **`validate_workspace` / parser plugins / `get_status`**: union — absorb
  upstream (`validate_workspace` in document_routes, `load_third_party_parsers`
  + `validate_parser_routing_config` startup discovery, `server_mode`/`workers`)
  while keeping local (workspace import, `capabilities` block).
- **env**: after merge, sync `env.example` ≡ `env.zh.example` and add any new
  code-defined vars (see verification-and-gotchas — env-example sync).
