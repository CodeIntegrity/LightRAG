# Knowledge Graph Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a graph workbench that adds structured multi-dimensional filtering, graph CRUD, manual merge, suggestion-assisted merge, and i18n-safe UI behavior without breaking the existing graph viewer entry points.

**Architecture:** Keep graph storage backends responsible for bounded base subgraph retrieval, move advanced filter evaluation into a new API-layer graph workbench helper, and preserve existing `GET /graphs` compatibility by adapting it to the new structured query flow. Extend graph mutation APIs with optimistic concurrency tokens and alias-preserving merge behavior, then layer a new frontend workbench store plus left-filter/right-action panels around the existing Sigma graph experience.

**Tech Stack:** Python 3.10+, FastAPI, Pydantic, LightRAG core/runtime, `utils_graph.py`, pytest, Bun, React 19, Zustand, `react-i18next`, Vitest, Ruff

---

## File Map

### Create

- `lightrag/api/graph_workbench.py`
- `tests/test_graph_routes.py`
- `tests/test_graph_workbench.py`
- `lightrag_webui/src/stores/graphWorkbench.ts`
- `lightrag_webui/src/components/graph/FilterWorkbench.tsx`
- `lightrag_webui/src/components/graph/ActionInspector.tsx`
- `lightrag_webui/src/components/graph/CreateNodeForm.tsx`
- `lightrag_webui/src/components/graph/CreateRelationForm.tsx`
- `lightrag_webui/src/components/graph/DeleteGraphObjectPanel.tsx`
- `lightrag_webui/src/components/graph/MergeEntityPanel.tsx`
- `lightrag_webui/src/components/graph/MergeSuggestionList.tsx`
- `lightrag_webui/src/components/graph/GraphWorkbenchSummary.tsx`
- `lightrag_webui/src/components/graph/FilterWorkbench.test.tsx`
- `lightrag_webui/src/components/graph/ActionInspector.test.tsx`
- `lightrag_webui/src/stores/graphWorkbench.test.ts`

### Modify

- `lightrag/api/routers/graph_routes.py`
- `lightrag/api/routers/document_routes.py`
- `lightrag/lightrag.py`
- `lightrag/utils_graph.py`
- `tests/test_description_api_validation.py`
- `lightrag_webui/src/api/lightrag.ts`
- `lightrag_webui/src/features/GraphViewer.tsx`
- `lightrag_webui/src/hooks/useLightragGraph.tsx`
- `lightrag_webui/src/components/graph/PropertiesView.tsx`
- `lightrag_webui/src/components/graph/EditablePropertyRow.tsx`
- `lightrag_webui/src/components/graph/MergeDialog.tsx`
- `lightrag_webui/src/stores/graph.ts`
- `lightrag_webui/src/stores/settings.ts`
- `lightrag_webui/src/i18n.ts`
- `lightrag_webui/src/locales/en.json`
- `lightrag_webui/src/locales/zh.json`
- `lightrag_webui/src/locales/zh_TW.json`
- `lightrag_webui/src/locales/fr.json`
- `lightrag_webui/src/locales/ar.json`
- `lightrag_webui/src/locales/ru.json`
- `lightrag_webui/src/locales/ja.json`
- `lightrag_webui/src/locales/de.json`
- `lightrag_webui/src/locales/uk.json`
- `lightrag_webui/src/locales/ko.json`
- `lightrag_webui/src/locales/vi.json`

### Verify Against

- `lightrag/base.py`
- `lightrag/operate.py`
- `lightrag/api/lightrag_server.py`
- `lightrag_webui/src/components/graph/GraphControl.tsx`
- `lightrag_webui/src/components/graph/GraphLabels.tsx`
- `lightrag_webui/src/locales/*.json`

## Task 1: Lock In Backend Route Contracts First

**Files:**
- Create: `tests/test_graph_routes.py`
- Modify: `lightrag/api/routers/graph_routes.py`
- Verify: `lightrag/api/lightrag_server.py`

- [ ] Write failing route tests for:
  - `POST /graph/query`
  - `DELETE /graph/entity`
  - `DELETE /graph/relation`
  - `POST /graph/merge/suggestions`
  - legacy `GET /graphs` compatibility
- [ ] Include assertions that v1 query semantics are:
  - field groups use `AND`
  - array values inside a field use `OR`
  - responses include truncation metadata
- [ ] Add Pydantic request/response models in `graph_routes.py` for:
  - structured query payloads
  - delete payloads
  - merge suggestion payloads
  - error code / metadata envelopes
- [ ] Keep existing create/edit/merge endpoints unchanged while adding the new routes.
- [ ] Run:

```bash
./scripts/test.sh tests/test_graph_routes.py -v
```

Expected: FAIL initially on missing routes/models, then PASS after implementation.

## Task 2: Add API-Layer Graph Query Engine With Guardrails

**Files:**
- Create: `lightrag/api/graph_workbench.py`
- Modify: `lightrag/api/routers/graph_routes.py`
- Create: `tests/test_graph_workbench.py`

- [ ] Write failing unit tests for the helper layer covering:
  - bounded base graph filtering
  - `AND`/`OR` filter semantics
  - `was_truncated_before_filtering` / `was_truncated_after_filtering`
  - `effective_max_nodes` never exceeding backend/runtime limits
- [ ] Implement a helper module that:
  - accepts the structured filter request
  - calls existing graph retrieval primitives with bounded `max_nodes`
  - applies post-retrieval filtering in Python
  - returns result metadata for truncation, applied limits, and hit counts
- [ ] Add an optional pushdown hook shape in the helper API so future backends can override selected predicates without changing route contracts.
- [ ] Adapt `GET /graphs` to call the new helper via a compatibility wrapper instead of maintaining a separate query path.
- [ ] Run:

```bash
./scripts/test.sh tests/test_graph_workbench.py tests/test_graph_routes.py -k "query or truncation or max_nodes or compatibility" -v
```

Expected: PASS

## Task 3: Add Concurrency Tokens and Alias-Preserving Merge Semantics

**Files:**
- Modify: `lightrag/utils_graph.py`
- Modify: `lightrag/lightrag.py`
- Modify: `lightrag/api/routers/graph_routes.py`
- Modify: `tests/test_description_api_validation.py`
- Modify: `tests/test_graph_workbench.py`

- [ ] Write failing tests for stale-write handling:
  - entity edit with stale token is rejected
  - relation edit/delete with stale token is rejected
  - merge with stale token is rejected
- [ ] Implement a backend-agnostic concurrency token strategy:
  - prefer an opaque `revision_token` derived from the current graph object payload
  - keep room to switch to `updated_at` or `version` later without breaking the route contract
- [ ] Write failing tests for alias preservation:
  - source entity names merged into a target are retained in canonical alias data
  - merge responses surface aliases
- [ ] Extend merge helpers in `utils_graph.py` so merged source names are appended into an alias field using a backend-friendly canonical representation.
- [ ] Thread the concurrency token through route handlers and public `LightRAG` wrappers without breaking existing callers.
- [ ] Run:

```bash
./scripts/test.sh tests/test_description_api_validation.py tests/test_graph_workbench.py -k "alias or merge or stale or revision_token" -v
```

Expected: PASS

## Task 4: Normalize Graph Mutation API Client Calls

**Files:**
- Modify: `lightrag_webui/src/api/lightrag.ts`
- Modify: `lightrag_webui/src/hooks/useLightragGraph.tsx`
- Modify: `lightrag_webui/src/stores/graph.ts`
- Create: `lightrag_webui/src/stores/graphWorkbench.ts`
- Create: `lightrag_webui/src/stores/graphWorkbench.test.ts`

- [ ] Write failing frontend store tests for:
  - filter draft vs applied query state
  - merge candidate selection queue
  - mutation conflict/error states
  - refetch triggers after invalidating mutations
- [ ] Extend `api/lightrag.ts` with typed client helpers for:
  - `queryGraphWorkbench`
  - `deleteGraphEntity`
  - `deleteGraphRelation`
  - `fetchMergeSuggestions`
  - updated create/edit/merge calls carrying `revision_token`
- [ ] Create a dedicated `graphWorkbench` Zustand store that owns:
  - filter drafts
  - applied query
  - query metadata
  - create/delete/merge form state
  - candidate suggestions
  - mutation errors/conflicts
- [ ] Update `useLightragGraph.tsx` to consume applied structured query state instead of only `queryLabel + depth + maxNodes`.
- [ ] Preserve `graph.ts` as render-state ownership only.
- [ ] Run:

```bash
cd lightrag_webui && bun test src/stores/graphWorkbench.test.ts
```

Expected: PASS

## Task 5: Build the Left Filter Workbench

**Files:**
- Create: `lightrag_webui/src/components/graph/FilterWorkbench.tsx`
- Create: `lightrag_webui/src/components/graph/GraphWorkbenchSummary.tsx`
- Modify: `lightrag_webui/src/features/GraphViewer.tsx`
- Create: `lightrag_webui/src/components/graph/FilterWorkbench.test.tsx`
- Modify: `lightrag_webui/src/stores/settings.ts`

- [ ] Write failing component tests covering:
  - five filter families render
  - apply/reset behavior
  - summary metadata display
  - filter inputs emit the correct structured payload shape
- [ ] Implement the left workbench with sections for:
  - node filters
  - edge filters
  - scope filters
  - source filters
  - view controls
- [ ] Keep long-lived defaults such as max depth / max nodes in `settings.ts`, but keep mutable workbench draft state in `graphWorkbench.ts`.
- [ ] Update `GraphViewer.tsx` layout from a pure canvas shell into a three-column workbench without breaking existing Sigma controls.
- [ ] Run:

```bash
cd lightrag_webui && bun test src/components/graph/FilterWorkbench.test.tsx
```

Expected: PASS

## Task 6: Build the Right Action Inspector and CRUD Panels

**Files:**
- Create: `lightrag_webui/src/components/graph/ActionInspector.tsx`
- Create: `lightrag_webui/src/components/graph/CreateNodeForm.tsx`
- Create: `lightrag_webui/src/components/graph/CreateRelationForm.tsx`
- Create: `lightrag_webui/src/components/graph/DeleteGraphObjectPanel.tsx`
- Modify: `lightrag_webui/src/components/graph/PropertiesView.tsx`
- Modify: `lightrag_webui/src/components/graph/EditablePropertyRow.tsx`
- Create: `lightrag_webui/src/components/graph/ActionInspector.test.tsx`

- [ ] Write failing tests for:
  - tab switching among `Inspect / Create / Delete / Merge`
  - `Create Relation` prefill from current selected nodes
  - delete confirmation copy and error persistence
  - stale-write conflict feedback
- [ ] Implement `ActionInspector` as a wrapper around the current property view plus new create/delete panels.
- [ ] Keep `Inspect` backed by the existing property inspection code so existing inline edit behavior keeps working.
- [ ] Add strict confirmation UX for entity delete vs relation delete.
- [ ] Update inline edit flows to pass and react to `revision_token`.
- [ ] Run:

```bash
cd lightrag_webui && bun test src/components/graph/ActionInspector.test.tsx
```

Expected: PASS

## Task 7: Build Manual and Suggested Merge UI

**Files:**
- Create: `lightrag_webui/src/components/graph/MergeEntityPanel.tsx`
- Create: `lightrag_webui/src/components/graph/MergeSuggestionList.tsx`
- Modify: `lightrag_webui/src/components/graph/MergeDialog.tsx`
- Modify: `lightrag_webui/src/features/GraphViewer.tsx`
- Modify: `lightrag_webui/src/stores/graphWorkbench.ts`
- Modify: `lightrag_webui/src/components/graph/ActionInspector.test.tsx`

- [ ] Add failing tests for:
  - manual source/target entity selection
  - suggested merge candidate load and evidence display
  - one-click candidate import into the merge form
  - post-merge “focus merged target / refresh results / continue review” behavior
- [ ] Implement the merge panel with two entry paths:
  - manual merge
  - suggested merge
- [ ] Make both paths converge into one confirmation panel that shows:
  - source entities to remove
  - target entity to retain
  - alias retention preview
  - suggestion evidence
- [ ] Replace the current lightweight merge follow-up dialog with a richer post-merge workbench feedback flow while preserving the useful “jump to merged entity” choice.
- [ ] Run:

```bash
cd lightrag_webui && bun test src/components/graph/ActionInspector.test.tsx -t "merge"
```

Expected: PASS

## Task 8: Internationalization and Locale Loading Groundwork

**Files:**
- Modify: `lightrag_webui/src/i18n.ts`
- Modify: `lightrag_webui/src/locales/en.json`
- Modify: `lightrag_webui/src/locales/zh.json`
- Modify: `lightrag_webui/src/locales/zh_TW.json`
- Modify: `lightrag_webui/src/locales/fr.json`
- Modify: `lightrag_webui/src/locales/ar.json`
- Modify: `lightrag_webui/src/locales/ru.json`
- Modify: `lightrag_webui/src/locales/ja.json`
- Modify: `lightrag_webui/src/locales/de.json`
- Modify: `lightrag_webui/src/locales/uk.json`
- Modify: `lightrag_webui/src/locales/ko.json`
- Modify: `lightrag_webui/src/locales/vi.json`
- Modify: `lightrag_webui/src/components/graph/FilterWorkbench.test.tsx`
- Modify: `lightrag_webui/src/components/graph/ActionInspector.test.tsx`

- [ ] Add failing tests that assert the new graph workbench keys exist in at least `en` and `zh`, then extend the same key set to all supported locale files.
- [ ] Add translation namespaces/keys for:
  - filter labels
  - action inspector tabs
  - create/delete/merge form copy
  - merge suggestion reasons
  - stale-write conflict messages
- [ ] If time permits in this implementation, switch `i18n.ts` to lazy locale loading at the shared bootstrap layer; otherwise leave a small adapter seam and keep the workbench code compatible with the current eager-loading setup.
- [ ] Run:

```bash
cd lightrag_webui && bun test src/components/graph/FilterWorkbench.test.tsx src/components/graph/ActionInspector.test.tsx
```

Expected: PASS

## Task 9: Full Verification and Documentation Touch-Up

**Files:**
- Verify: `lightrag/api/graph_workbench.py`
- Verify: `lightrag/api/routers/graph_routes.py`
- Verify: `lightrag/utils_graph.py`
- Verify: `lightrag_webui/src/features/GraphViewer.tsx`
- Verify: `tests/test_graph_routes.py`
- Verify: `tests/test_graph_workbench.py`
- Verify: `tests/test_description_api_validation.py`
- Verify: `lightrag_webui/src/components/graph/*.test.tsx`
- Verify: `lightrag_webui/src/stores/graphWorkbench.test.ts`

- [ ] Run:

```bash
./scripts/test.sh tests/test_graph_routes.py tests/test_graph_workbench.py tests/test_description_api_validation.py -v
uv run ruff check lightrag/api/graph_workbench.py lightrag/api/routers/graph_routes.py lightrag/lightrag.py lightrag/utils_graph.py tests/test_graph_routes.py tests/test_graph_workbench.py tests/test_description_api_validation.py
cd lightrag_webui && bun test src/components/graph/FilterWorkbench.test.tsx src/components/graph/ActionInspector.test.tsx src/stores/graphWorkbench.test.ts
```

Expected: PASS

- [ ] If manual smoke testing is available, verify in the browser:
  - filter apply/reset
  - entity create
  - relation create
  - entity delete
  - relation delete
  - manual merge
  - suggested merge
  - locale switch keeps workbench copy intact
