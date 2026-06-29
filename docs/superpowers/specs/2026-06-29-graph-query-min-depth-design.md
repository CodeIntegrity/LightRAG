# Graph Query Min Depth Design

## Goal

Add a structured graph query capability that returns a bounded subgraph by
`max_depth` while allowing callers to hide nodes that are closer than
`min_depth` to the requested root label.

The primary use case is an API query equivalent to "show the 3-to-4 hop
neighborhood of `xj_graph_root`" while preserving the current LightRAG graph
payload shape.

## Scope

In scope:

- Add `scope.min_depth` to the structured `/graph/query` contract.
- Apply `min_depth` in `lightrag/api/graph_workbench.py` after the backend graph
  has been fetched and normalized.
- Keep support for existing `scope.max_depth`, `scope.max_nodes`, and
  `scope.direction`.
- Add regression coverage for outbound multi-hop filtering.

Out of scope:

- Exposing arbitrary nGQL or Cypher execution through the API.
- Returning path objects or raw NebulaGraph `MATCH` rows.
- Changing `BaseGraphStorage.get_knowledge_graph` or backend storage method
  signatures.
- Applying `min_depth` to `label="*"` graph queries, because wildcard queries do
  not have a single root node from which hop distance can be defined.

## API Contract

`GraphQueryScope` gains:

```json
{
  "min_depth": 0
}
```

Validation:

- `min_depth` is an integer with a minimum of `0`.
- `max_depth` remains an integer with a minimum of `1`.
- A request with `min_depth > max_depth` is rejected with validation error.

Example request:

```json
{
  "scope": {
    "label": "xj_graph_root",
    "min_depth": 3,
    "max_depth": 4,
    "max_nodes": 1000,
    "direction": "outbound"
  }
}
```

Response shape remains unchanged:

```json
{
  "data": {
    "nodes": [],
    "edges": [],
    "is_truncated": false
  },
  "truncation": {},
  "meta": {}
}
```

## Behavior

The backend is still queried with `max_depth`; `min_depth` is a result-shaping
filter, not a backend traversal limit.

For `label != "*"`:

1. Normalize the graph to the existing `{nodes, edges}` workbench shape.
2. Compute shortest hop distance from `scope.label` over the normalized edges,
   respecting `scope.direction`.
3. If `min_depth > 0`, keep only nodes whose distance is at least `min_depth`.
4. Keep only edges whose source and target are both retained.
5. Continue applying the existing node, edge, source, and view filters.

For `label="*"`:

- `min_depth` is ignored and treated as `0`.
- Existing full-graph and filter-first behavior remains unchanged.

## Direction Semantics

Depth calculation follows the same direction values already accepted by
`/graph/query`:

- `outbound`: traverse source to target.
- `inbound`: traverse target to source.
- `both`: traverse both directions.

This keeps the API behavior aligned with `rag.get_knowledge_graph(...,
direction=...)` and avoids introducing a second direction model.

## Error Handling

Use request validation for invalid `min_depth` values. Do not silently clamp
`min_depth > max_depth`; rejecting the request makes the caller error visible.

No new storage-level errors are introduced because the backend query contract
does not change.

## Testing

Add focused tests in `tests/test_graph_workbench.py`:

- `min_depth=2,max_depth=3,direction="outbound"` excludes the root and first-hop
  nodes while keeping deeper outbound nodes.
- Edges are retained only when both endpoints survive the `min_depth` filter.
- `label="*"` with `min_depth > 0` preserves existing wildcard behavior.
- Invalid `min_depth > max_depth` is rejected at the route model level.

## Risks

- The filter is post-fetch, so large `max_depth` requests can still be expensive.
  Existing `max_nodes` and runtime caps remain the primary safety controls.
- Because only the existing graph payload is returned, callers cannot distinguish
  individual paths with the same endpoint. This is intentional for the selected
  subgraph-query enhancement and not a raw path-query feature.

