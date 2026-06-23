# Ownership Boundary — upstream platform vs local 二开

The single most important decision in each conflict is **who owns the
contract**. Default rule: absorb upstream for platform internals; preserve
local for product extensions upstream does not provide. When genuinely
ambiguous, keep local behavior and note it.

## Upstream owns (absorb fixes / structure)

- `lightrag/parser/**` — parser package layout, routing, legacy extractors
  (`lightrag/parser/legacy/`), external mineru/docling adapters.
- `lightrag/chunker/**` — chunking strategies.
- Pipeline concurrency contract (`lightrag/pipeline.py`, `utils_pipeline.py`):
  enqueue reservation, busy/scanning/destructive-busy semantics, parse/analyze
  metadata. (See `AGENTS.md` "Pipeline concurrency contract".)
- `lightrag/llm_roles.py` + role-LLM wiring; embedding/LLM provider装配 logic.
- `lightrag/kg/*_impl.py` — storage backend persistence semantics and
  correctness fixes (batch ops, canonical edge IDs, deferred embedding, atomic
  writes, failure surfacing, `validate_workspace` path-traversal guard).
- `lightrag/_version.py` — take upstream version/API version.
- `lightrag/utils.py` shared helpers (e.g. `VectorStorageConsistencyError`,
  `safe_vdb_operation_with_exception`, `_run_sync` infrastructure).

## Local owns — 二开 (preserve; never silently drop)

- **Workspace runtime/registry/routes**: `lightrag/api/workspace_runtime.py`
  (the `_current_runtime`/`_current_workspace` ContextVars + `bind_current_runtime`),
  `lightrag/api/workspace_registry.py`, `lightrag/api/routers/workspace_routes.py`,
  guest access / `enable_guest_login_entry`, workspace selection in routes.
- **Graph workbench**: `lightrag/api/graph_workbench.py`, revision-token mutation
  guards + workbench routes in `routers/graph_routes.py`, and the large local
  additions in `lightrag/utils_graph.py`.
- **Custom chunks / custom KG**: `ainsert_custom_chunks` (with the `file_path`
  arg), `arebuild_all_custom_chunks_graphs`, `ainsert_custom_kg` (with
  `directed_relation_dedup`), and the module helpers in `lightrag.py`
  (`_chunk_fields_from_status_doc`, `_custom_kg_relation_key`, etc.).
- **Prompt editor + LLM-assisted prompt authoring**: `routers/prompt_routes.py`,
  `lightrag_webui/src/pages/Prompts*`, settings store prompt history. (The old
  prompt-version-store / Prompt Management was RETIRED — do not revive it.)
- **WebUI product flows**:
  - `src/App.tsx` — lazy-import + guest-visible-tab + Suspense tab structure,
    includes the local `prompts` tab. Uses `RetrievalTesting`, not `RetrievalView`.
  - `src/features/RetrievalTesting.tsx` — local rewrite of the retrieval UI
    (abort handling that silently keeps partial content). Upstream's
    `RetrievalView.tsx` is the superseded version — keep RetrievalTesting.
  - `src/components/retrieval/ChatMessage.tsx` — local rewrite.
  - `src/api/lightrag.ts` — query **references** feature (`onReferences`,
    `processNDJSONStream`, `dispatchNDJSONPayload`, `ReferenceItem`) and
    workspace headers (`resolveWorkspaceHeader`/`LIGHTRAG-WORKSPACE`).
  - `src/stores/settings.ts` — local persist `version` (currently 31) and the
    local default state (workspace fields, graph-layout params, `mode: 'mix'`,
    `prompt_overrides`, `include_references`).
- **Nebula** deployment adaptation (`lightrag/kg/nebula_impl.py`, setup wiring)
  unless an explicit product decision retires it.

## Mixed — combine at the smallest correct owner

These files carry both upstream platform contracts and local product behavior;
resolve hunk-by-hunk, taking the upstream-owned base and re-applying local
behavior at the route/runtime boundary:

- `lightrag/lightrag.py` — upstream mixin/core base + local custom-chunk/KG APIs.
- `lightrag/api/lightrag_server.py` — upstream app/config/embedding base +
  local workspace routes, guest capabilities, nested embedding function.
- `lightrag/api/routers/document_routes.py` — upstream pipeline/parser-deferral
  + local workspace-runtime binding, custom-chunks import/rebuild, pagination.
- `lightrag_webui/src/api/lightrag.ts` — merged API types; preserve the local
  streaming/references section.

## Retirement check

If upstream now provides equivalent behavior for a local feature, retire the
local owner ONLY with a named migration and passing local behavior tests —
never by silently adopting upstream. Record the retirement in the plan and a
`docs/aegis/baseline/` entry.
