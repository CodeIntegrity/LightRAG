# NebulaGraph KG Load Optimization Plan

Date: 2026-06-09

Status: Reorganized after feasibility review

Owner: Codex

## Goal

Improve NebulaGraph-backed knowledge graph loading performance for WebUI graph visualization and custom KG import without changing LightRAG's public graph semantics.

Primary success criteria:

- Reduce graph-load query count and latency for `/graphs?label=*` on Nebula-backed deployments.
- Accelerate `ainsert_custom_kg` / batch graph construction for Nebula by adding real batch writes.
- Keep retrieval semantics compatible with existing graph APIs.
- Use regression tests to prevent query-count and SQL-shape regressions.

Non-goals for the first implementation wave:

- Do not replace bounded BFS semantics with `GO N STEPS` until live evidence proves equivalence or an acceptable semantic difference.
- Do not cache full `get_all_labels()` results in the first pass.
- Do not introduce a custom Nebula session-pool abstraction before query-count and batch-write wins are measured.
- Do not change WebUI default graph load behavior in this plan.

## Skills

- `aegis:writing-plans`
- `aegis:anti-entropy-governance`
- `aegis:first-principles-review`

## Evidence

### Current WebUI Load Path

- WebUI defaults graph query label to `*`:
  - `lightrag_webui/src/lib/constants.ts`
  - `defaultQueryLabel = '*'`
- WebUI graph loader requests:
  - `GET /graphs?label=${queryLabel}&max_depth=...&min_degree=...&inclusive=...`
  - implemented in `lightrag_webui/src/api/lightrag.ts`
- Therefore the default visualization path enters server graph retrieval with label `*`.

### Current Nebula Global Graph Path

`lightrag/kg/nebula_impl.py::_build_global_knowledge_graph()` currently performs these broad operations:

1. `get_popular_labels(max_nodes + 1)`
2. conditionally `get_all_labels()`
3. `get_nodes_batch(selected_ids)`
4. `get_nodes_edges_batch(selected_ids)`
5. `get_edges_batch(edge_pairs)`

`get_popular_labels()` performs an edge scan and degree aggregation:

```cypher
MATCH (v:entity)-[e:relationship]-()
RETURN v.entity_id AS entity_id, count(e) AS degree
ORDER BY degree DESC
LIMIT {limit}
```

This is a plausible hot path for `/graphs?label=*`.

### Current Nebula Read Shape

Nebula reads commonly use `MATCH ... WHERE entity_id == ...`, for example `get_node`, `get_node_edges`, and batch helpers.

The storage writes entities with internal VID produced by `_nebula_vid(entity_id)`, while the user-facing `entity_id` remains a property. This gives a possible path for future `FETCH PROP ON entity <vid>` / VID-driven `GO` optimization, but that migration is not mechanically safe without compatibility tests.

### Existing Safety Tests

`tests/test_nebula_graph_storage.py` includes tests around long Chinese entity IDs and currently asserts that `get_node` does not use `FETCH PROP ON entity`.

Implication:

- A direct `FETCH` migration would intentionally break existing SQL-shape tests.
- It should be implemented as a separately gated experimental phase, not mixed into the low-risk graph-load plan.

### Current Batch Write Gap

`BaseGraphStorage.upsert_nodes_batch()` and `upsert_edges_batch()` default to serial loops over `upsert_node()` / `upsert_edge()`.

`NebulaGraphStorage` does not override these methods, so custom KG import and extraction writeback currently miss an obvious Nebula batch-write optimization.

## Feasibility Conclusion

The optimization is feasible, but the implementation should be staged:

1. First reduce query count and duplicate graph-load work without changing query language semantics.
2. Then add a narrow popular-label cache, not a full label-list cache.
3. Then add Nebula batch-write overrides for import/build acceleration.
4. Only after that, evaluate VID-native `FETCH` / `GO` read paths with dedicated tests and live Nebula evidence.

The highest-confidence first wins are:

- query-count regression tests,
- parallelizing independent graph reads,
- reusing BFS adjacency gathered during bounded traversal,
- implementing real Nebula batch writes.

The riskiest suggestions are:

- replacing BFS with `GO N STEPS`,
- changing all property-based `MATCH` reads to `FETCH`,
- caching full label lists,
- session reuse before measuring whether session overhead is material.

## Architecture Decision

### Principle

Optimize the hot path by removing duplicate work and adding backend-specific batch operations before changing graph-query semantics.

### Phase Order

| Phase | Scope | Risk | Default Action |
|---|---:|---:|---|
| Phase 1 | Test harness, read-path parallelization, adjacency reuse | Low | Implement first |
| Phase 2 | Bounded in-memory popular-label cache | Low to medium | Implement after tests |
| Phase 3 | Nebula batch writes | Medium | Implement after read-path tests |
| Phase 4 | VID-native `FETCH` / `GO` experiments | Medium to high | Gate behind evidence |
| Phase 5 | Docs and operations guidance | Low | Ship with implementation |

### Stop Gate

After Phase 3, stop and compare:

- query count before/after,
- unit test coverage,
- custom KG batch SQL shape,
- any live Nebula smoke-test result if available.

Phase 4 should not be merged as a semantic replacement unless tests and live Nebula evidence show no regression for:

- long Unicode entity IDs,
- quote escaping,
- special characters,
- missing nodes,
- direction-insensitive edge listing,
- bounded depth traversal semantics.

## Anti-Entropy Declaration

### Source of Truth

NebulaGraph remains the only persistent source of truth for graph data.

Any in-memory cache is a derived acceleration structure only:

- scoped to a `NebulaGraphStorage` instance,
- invalidated on graph mutations,
- rebuilt from Nebula on miss,
- never persisted,
- never used to hide query failures.

### New Behavior Track

New behavior should be introduced in these controlled paths:

- graph-load query-count tests define the expected hot-path behavior;
- `_build_global_knowledge_graph()` executes independent reads concurrently where semantics are independent;
- bounded subgraph load reuses adjacency collected during BFS;
- `get_popular_labels(limit)` may use a bounded in-memory cache;
- `NebulaGraphStorage.upsert_nodes_batch()` and `upsert_edges_batch()` issue grouped Nebula statements.

### Retirement Track

The following old behavior should be retired or reduced:

- serial execution of independent global graph reads;
- duplicate edge-neighborhood queries after BFS has already collected adjacency;
- serial fallback batch writes for Nebula custom KG import.

The following behavior is explicitly retained for now:

- property-based `MATCH` read semantics for core methods;
- direct `get_all_labels()` read from Nebula when fallback label completion is needed;
- current WebUI `*` graph-load entrypoint.

The following suggestions are deferred:

- full `get_all_labels()` cache,
- session reuse,
- persistent degree cache,
- replacing BFS with `GO N STEPS`.

## Implementation Plan

### Task 1: Add Graph-Load Query-Count Regression Tests

Purpose:

Create a measurable safety net before changing performance-sensitive behavior.

Files:

- `tests/test_nebula_graph_storage.py`
- optionally new helper inside the same file

Implementation:

1. Add a fake Nebula client/session that records executed SQL strings and returns controlled rows.
2. Add a test for `_build_global_knowledge_graph("*", max_nodes=N)` query shape/count.
3. Add a test for bounded label traversal query shape/count.
4. Assert that the optimized path does not reissue avoidable duplicate adjacency queries.
5. Keep existing SQL escaping and Unicode tests intact.

Test expectations should focus on:

- number of calls,
- which methods issue which high-level query shape,
- graph result equivalence,
- no regression in long Chinese entity ID handling.

Avoid:

- fragile wall-clock timing assertions,
- live Nebula dependency in unit tests,
- large fixture data.

Verification:

```bash
./scripts/test.sh tests/test_nebula_graph_storage.py
```

Acceptance:

- Tests fail on current duplicate/serial behavior where intended.
- Existing Nebula tests continue to pass after implementation.

### Task 2: Parallelize Independent Global Graph Reads

Purpose:

Reduce latency in `_build_global_knowledge_graph()` when selected nodes and their edges can be loaded independently.

Files:

- `lightrag/kg/nebula_impl.py`
- `tests/test_nebula_graph_storage.py`

Current pattern:

```python
node_datas = await self.get_nodes_batch(selected_ids)
edges_by_node = await self.get_nodes_edges_batch(selected_ids)
```

Target pattern:

```python
node_datas, edges_by_node = await asyncio.gather(
    self.get_nodes_batch(selected_ids),
    self.get_nodes_edges_batch(selected_ids),
)
```

Constraints:

- Only parallelize reads that do not depend on each other's result.
- Keep error propagation visible; do not swallow partial failures.
- Do not change selected label semantics.

Verification:

```bash
./scripts/test.sh tests/test_nebula_graph_storage.py
```

Acceptance:

- Same graph output as before.
- Query-count tests remain stable.
- No broad `try/except` fallback.

### Task 3: Reuse Bounded-Subgraph BFS Adjacency

Purpose:

Avoid issuing `get_nodes_edges_batch(visited_nodes)` after BFS already discovered adjacency for the bounded subgraph.

Files:

- `lightrag/kg/nebula_impl.py`
- `tests/test_nebula_graph_storage.py`

Current likely pattern:

1. BFS gathers neighbors for each frontier.
2. After traversal, implementation calls `get_nodes_batch(visited_nodes)`.
3. Then calls `get_nodes_edges_batch(visited_nodes)` again.
4. Then calls `get_edges_batch(edge_pairs)`.

Target behavior:

- During BFS, accumulate `edges_by_node` in a local mapping.
- After traversal, use the accumulated adjacency to produce `edge_pairs`.
- Still call `get_nodes_batch(visited_nodes)` for node properties.
- Still call `get_edges_batch(edge_pairs)` for edge properties unless enough edge data is already available and tests prove equivalence.

Constraints:

- Preserve current depth semantics.
- Preserve `inclusive` behavior.
- Preserve `min_degree` behavior.
- Preserve undirected edge visibility if the current method treats relationships as undirected.
- Deduplicate edge pairs deterministically.

Verification:

```bash
./scripts/test.sh tests/test_nebula_graph_storage.py
```

Acceptance:

- Bounded traversal produces the same node/edge set as before.
- Query-count test proves the duplicate adjacency pass is removed.

### Task 4: Add Bounded In-Memory Popular-Label Cache

Purpose:

Avoid repeated full edge-degree scans for repeated global graph loads, while avoiding a broad full-label cache in the first pass.

Files:

- `lightrag/kg/nebula_impl.py`
- `tests/test_nebula_graph_storage.py`

Cache contract:

```python
_popular_labels_cache: list[str] | None
_popular_labels_cache_limit: int
```

Rules:

- `get_popular_labels(limit)` may return from cache when `_popular_labels_cache_limit >= limit`.
- A larger requested limit refreshes the cache.
- Cache stores only the ranked popular labels returned by the degree query.
- Cache does not replace `get_all_labels()`.
- Cache is invalidated on graph writes and destructive operations.
- Cache miss or invalidation always rebuilds from Nebula.

Invalidation points:

- `upsert_node`
- `upsert_edge`
- `upsert_nodes_batch`
- `upsert_edges_batch`
- `delete_node`
- `remove_nodes`
- `remove_edges`
- `drop`
- `index_done_callback` if it can follow external mutation or pending writes

Conservative invalidation on all graph writes is acceptable because correctness is more important than maximizing cache hit rate.

Avoid:

- caching unbounded all-label results,
- persisting cache to disk,
- returning stale results after a write,
- hiding Nebula query errors behind stale cache fallback.

Verification:

```bash
./scripts/test.sh tests/test_nebula_graph_storage.py
```

Acceptance:

- Repeated `get_popular_labels(limit)` reads use one Nebula query until invalidated.
- Larger limit refreshes the cache.
- Mutation invalidates cache.
- `get_all_labels()` remains a direct read.

### Task 5: Add Nebula Batch Write Methods for Custom KG Import

Purpose:

Accelerate custom KG loading and graph build/writeback by replacing serial fallback batch writes with grouped Nebula statements.

Files:

- `lightrag/kg/nebula_impl.py`
- `tests/test_nebula_graph_storage.py`
- optionally `tests/kg/nebula_impl/` only if the repository already has that layout for Nebula tests

Methods:

```python
async def upsert_nodes_batch(self, nodes_data: dict[str, dict[str, Any]]) -> None
async def upsert_edges_batch(self, edges_data: dict[tuple[str, str], dict[str, Any]]) -> None
```

Node write target:

- Emit `INSERT VERTEX ... VALUES` statements in chunks.
- Use `_nebula_vid(entity_id)` for VID.
- Preserve `entity_id` property.
- Preserve existing property normalization and escaping behavior.

Edge write target:

- Emit `INSERT EDGE ... VALUES` statements in chunks.
- Use `_nebula_vid(source)` and `_nebula_vid(target)`.
- Preserve existing edge property fields.
- Preserve existing relationship identity semantics.

Batch size:

- Add a local private constant or instance attribute with conservative default, for example `100` or `200`.
- Keep statement size bounded.
- Do not expose a public API unless there is already a backend pattern for it.

Error behavior:

- If one chunk fails, raise the Nebula error.
- Do not silently fall back to serial writes.
- Do not report success for partial failure.

Cache interaction:

- Batch node/edge writes invalidate popular-label cache.
- Invalidation can happen before the first chunk or after successful chunks.
- If a chunk fails, cache should not remain trusted.

Verification:

```bash
./scripts/test.sh tests/test_nebula_graph_storage.py
```

Acceptance:

- Unit tests prove batch SQL uses grouped statements, not serial fallback calls.
- Existing single-node and single-edge upsert tests remain valid.
- Custom KG import can use backend-specific batch path through the existing `BaseGraphStorage` interface.

### Task 6: Experimental VID-Native `FETCH` Read Path

Purpose:

Evaluate whether direct VID-based reads can replace selected property-based `MATCH` reads safely.

Status:

Experimental. Do not merge as default behavior without evidence.

Files:

- `lightrag/kg/nebula_impl.py`
- `tests/test_nebula_graph_storage.py`
- optional live integration test gated by `LIGHTRAG_RUN_INTEGRATION=true`

Candidate methods:

- `get_node`
- `get_nodes_batch`
- possibly `has_node`

Example direction:

```cypher
FETCH PROP ON entity "escaped_vid"
YIELD properties(vertex).entity_id AS entity_id, properties(vertex).entity_type AS entity_type, ...
```

Required evidence:

- exact Nebula syntax works for string VID in supported Nebula versions;
- long Unicode names mapped through `_nebula_vid()` remain retrievable;
- escaping tests pass;
- missing-node behavior matches current return values;
- performance benefit is visible or query count/query shape materially improves.

Compatibility gate:

- Existing test that currently rejects `FETCH PROP ON entity` must be replaced only after new evidence-backed tests prove semantic equivalence.

Acceptance:

- Either produce a small, separately reviewable experimental branch/patch,
- or document why `FETCH` is not worth adopting now.

### Task 7: Experimental `GO`-Based Adjacency Proof

Purpose:

Assess Nebula-native traversal syntax as a future optimization without replacing current BFS semantics prematurely.

Status:

Experimental. Not part of the default optimization wave.

Candidate usage:

- direct one-hop adjacency lookup by VID,
- frontier expansion with fewer round-trips,
- not full replacement of bounded BFS until proven.

Risk:

`GO N STEPS` can return paths/edges with semantics that differ from the current Python BFS around:

- exact max-depth inclusion,
- frontier deduplication,
- edge direction,
- `inclusive` handling,
- `min_degree` filtering,
- result ordering.

Required tests:

- depth 0,
- depth 1,
- depth 2 with cycles,
- disconnected nodes,
- directed edge asymmetry if Nebula stores direction,
- `inclusive=True` and `inclusive=False`,
- `min_degree > 0`.

Acceptance:

- Keep current BFS unless the `GO` path proves equivalent for all required cases.
- If adopted later, guard it behind focused tests and remove the old path only when equivalent.

### Task 8: Documentation and Operational Guidance

Purpose:

Document the practical Nebula optimization behavior and tuning expectations.

Files:

- `docs/`
- optionally backend-specific docs if present

Content:

- Graph visualization with `label=*` can trigger broad graph reads.
- Popular-label cache is in-memory and invalidated on graph mutation.
- Batch custom KG import is supported through Nebula batch write overrides.
- Experimental `FETCH` / `GO` paths require integration verification before production use.
- Live benchmarking should report dataset scale:
  - node count,
  - edge count,
  - `max_nodes`,
  - `max_depth`,
  - Nebula version,
  - query count,
  - p50/p95 latency if available.

Verification:

```bash
rg -n "Nebula|NebulaGraph|graph load|popular labels" docs lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
```

Acceptance:

- Operators understand what is optimized now and what remains experimental.

## Test Strategy

### Unit Tests

Run after each implementation task:

```bash
./scripts/test.sh tests/test_nebula_graph_storage.py
```

Expected coverage:

- global graph load query count,
- bounded graph traversal query count,
- popular-label cache hit/miss/invalidation,
- Nebula batch node writes,
- Nebula batch edge writes,
- existing Unicode and escaping cases.

### Broader Backend Tests

Run before final handoff:

```bash
./scripts/test.sh tests/kg/test_graph_storage.py
```

Reason:

Backend-specific changes must still satisfy shared graph storage expectations.

### Optional Live Nebula Smoke Test

Only run when a Nebula service is available and integration tests are enabled:

```bash
LIGHTRAG_RUN_INTEGRATION=true ./scripts/test.sh tests/test_nebula_graph_storage.py -m integration
```

Live evidence should capture:

- Nebula version,
- dataset size,
- query count if instrumented,
- before/after latency for `/graphs?label=*`,
- custom KG import time before/after batch writes.

## Rollout Plan

1. Merge Task 1 tests.
2. Implement Task 2 and Task 3 together if their tests share the same fixture.
3. Implement Task 4 cache after query-count tests are stable.
4. Implement Task 5 batch writes.
5. Stop and evaluate measured gains.
6. Decide whether Task 6/7 experimental work is justified.
7. Update docs and handoff notes.

## Risk Register

| Risk | Impact | Mitigation |
|---|---:|---|
| Cache returns stale popular labels | Incorrect graph visualization order | Invalidate on all graph writes; never persist cache |
| Query-count tests become too brittle | Test churn | Assert high-level operation count and SQL shape, not exact whitespace |
| Batch SQL exceeds Nebula statement limits | Import failure on large KG | Chunk writes conservatively |
| Batch failure leaves partial writes | Partial graph import | Raise visibly; do not mask partial failure |
| `FETCH` handles VID differently than expected | Missing nodes or broken Unicode IDs | Keep experimental until live tests pass |
| `GO` traversal differs from BFS | Changed graph visualization | Do not replace BFS until equivalence tests pass |
| Session reuse adds complexity without measured gain | Maintenance cost | Defer until after query-count and batch wins |

## Out of Scope / Future Design

Deferred items:

- full `get_all_labels()` cache with generation/version tracking,
- persistent popular-label or degree table,
- Nebula session reuse/session pool tuning,
- configurable Nebula batch sizes as public API,
- replacing property-based `MATCH` reads globally,
- replacing Python BFS with `GO N STEPS`,
- raising WebUI/API batch filter defaults,
- requiring new Nebula indexes or schema migrations.

Criteria to revisit:

- query-count and batch-write work does not produce sufficient gain;
- live Nebula profiling shows session acquisition dominates latency;
- global label fallback becomes a measured bottleneck;
- operators can accept schema/index migration requirements.

## Handoff Checklist

Before marking implementation complete:

- `git diff` reviewed for hidden fallback, duplicate logic, or broad unrelated refactor.
- `./scripts/test.sh tests/test_nebula_graph_storage.py` run and reported.
- `./scripts/test.sh tests/kg/test_graph_storage.py` run or blocker documented.
- Query-count evidence included in final handoff.
- Batch-write behavior and failure mode documented.
- Experimental `FETCH` / `GO` status explicitly stated.
