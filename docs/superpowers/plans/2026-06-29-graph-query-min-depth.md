# Graph Query Min Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add `scope.min_depth` to structured graph queries so callers can request a bounded subgraph and hide nodes closer than a minimum hop distance from the root.

**Architecture:** Keep the backend storage contract unchanged. `/graph/query` fetches the existing `max_depth` graph, normalizes it in `graph_workbench`, then applies a post-fetch hop-distance filter for non-wildcard scopes before existing node, edge, source, and view filters run.

**Tech Stack:** Python, FastAPI/Pydantic, pytest, existing LightRAG graph workbench helpers.

---

### Task 1: Add failing tests for `min_depth`

**Files:**
- Modify: `tests/test_graph_workbench.py`

- [x] **Step 1: Write tests that describe the new behavior**

Add imports and tests:

```python
from pydantic import ValidationError
from lightrag.api.routers.graph_routes import GraphQueryScope
```

```python
@pytest.mark.asyncio
async def test_query_min_depth_filters_out_nodes_closer_than_requested_outbound():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [
                _node("root", "ROOT"),
                _node("hop1", "ENTITY"),
                _node("hop2", "ENTITY"),
                _node("hop3", "ENTITY"),
                _node("side", "ENTITY"),
            ],
            "edges": [
                _edge("e-root-hop1", "root", "hop1", "rel"),
                _edge("e-hop1-hop2", "hop1", "hop2", "rel"),
                _edge("e-hop2-hop3", "hop2", "hop3", "rel"),
                _edge("e-side-root", "side", "root", "rel"),
            ],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {
            "scope": {
                "label": "root",
                "min_depth": 2,
                "max_depth": 3,
                "max_nodes": 100,
                "direction": "outbound",
            }
        },
    )

    assert rag.last_graph_call == {
        "node_label": "root",
        "max_depth": 3,
        "max_nodes": 100,
        "direction": "outbound",
    }
    assert [node["id"] for node in result["data"]["nodes"]] == ["hop2", "hop3"]
    assert [edge["id"] for edge in result["data"]["edges"]] == ["e-hop2-hop3"]
```

```python
@pytest.mark.asyncio
async def test_query_min_depth_is_ignored_for_wildcard_scope():
    rag = _DummyRAG(
        graph_payload={
            "nodes": [_node("root", "ROOT"), _node("hop1", "ENTITY")],
            "edges": [_edge("e-root-hop1", "root", "hop1", "rel")],
            "is_truncated": False,
        }
    )

    result = await query_graph_workbench(
        rag,
        {
            "scope": {
                "label": "*",
                "min_depth": 2,
                "max_depth": 3,
                "max_nodes": 100,
                "direction": "outbound",
            }
        },
    )

    assert [node["id"] for node in result["data"]["nodes"]] == ["root", "hop1"]
    assert [edge["id"] for edge in result["data"]["edges"]] == ["e-root-hop1"]
```

```python
def test_graph_query_scope_rejects_min_depth_greater_than_max_depth():
    with pytest.raises(ValidationError):
        GraphQueryScope(label="root", min_depth=4, max_depth=3)
```

- [x] **Step 2: Run the tests and verify they fail for the missing feature**

Run:

```bash
./scripts/test.sh tests/test_graph_workbench.py \
  -k "min_depth or rejects_min_depth" -v
```

Expected: FAIL because `GraphQueryScope` has no `min_depth` field or because workbench does not filter by `min_depth`.

### Task 2: Add request validation

**Files:**
- Modify: `lightrag/api/routers/graph_routes.py`
- Test: `tests/test_graph_workbench.py`

- [x] **Step 1: Add `min_depth` and cross-field validation to `GraphQueryScope`**

Update imports:

```python
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
```

Update `GraphQueryScope`:

```python
class GraphQueryScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(default="*", min_length=1)
    min_depth: int = Field(default=0, ge=0)
    max_depth: int = Field(default=3, ge=1)
    max_nodes: int = Field(default=DEFAULT_MAX_GRAPH_NODES, ge=1)
    direction: Literal["both", "outbound", "inbound"] = Field(
        default="both",
        description="Traversal direction: both, outbound, or inbound",
    )
    only_matched_neighborhood: bool = False

    @field_validator("label", mode="after")
    @classmethod
    def validate_label(cls, label: str) -> str:
        normalized = label.strip()
        if not normalized:
            raise ValueError("label cannot be empty")
        return normalized

    @model_validator(mode="after")
    def validate_depth_range(self) -> "GraphQueryScope":
        if self.min_depth > self.max_depth:
            raise ValueError("min_depth cannot be greater than max_depth")
        return self
```

- [x] **Step 2: Run the validation test**

Run:

```bash
./scripts/test.sh tests/test_graph_workbench.py::test_graph_query_scope_rejects_min_depth_greater_than_max_depth -v
```

Expected: PASS.

### Task 3: Apply post-fetch `min_depth` filtering

**Files:**
- Modify: `lightrag/api/graph_workbench.py`
- Test: `tests/test_graph_workbench.py`

- [x] **Step 1: Add a helper that computes directed hop distances and filters retained nodes**

Add a helper near `_apply_directional_scope`:

```python
def _apply_min_depth_scope(
    *,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    scope_label: str,
    min_depth: int,
    direction: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if min_depth <= 0 or scope_label == "*":
        return nodes, edges

    root_ids = {
        _normalize_text(node.get("id"))
        for node in nodes
        if _node_matches_scope_label(node, scope_label)
    }
    root_ids.discard("")
    if not root_ids:
        return nodes, edges

    normalized_direction = _normalize_query_direction(direction)
    adjacency: dict[str, list[str]] = {}
    for edge in edges:
        source = _normalize_text(edge.get("source"))
        target = _normalize_text(edge.get("target"))
        if not source or not target:
            continue
        if normalized_direction in {"outbound", "both"}:
            adjacency.setdefault(source, []).append(target)
        if normalized_direction in {"inbound", "both"}:
            adjacency.setdefault(target, []).append(source)

    distances = {root_id: 0 for root_id in root_ids}
    queue: deque[str] = deque(root_ids)
    while queue:
        current_id = queue.popleft()
        next_depth = distances[current_id] + 1
        for neighbor_id in adjacency.get(current_id, []):
            if neighbor_id in distances:
                continue
            distances[neighbor_id] = next_depth
            queue.append(neighbor_id)

    retained_ids = {
        node_id for node_id, depth in distances.items() if depth >= min_depth
    }
    filtered_nodes = [
        node for node in nodes if _normalize_text(node.get("id")) in retained_ids
    ]
    filtered_edges = [
        edge
        for edge in edges
        if _normalize_text(edge.get("source")) in retained_ids
        and _normalize_text(edge.get("target")) in retained_ids
    ]
    return filtered_nodes, filtered_edges
```

- [x] **Step 2: Call the helper after `_apply_directional_scope`**

Update the workbench flow:

```python
    normalized_nodes, normalized_edges = _apply_directional_scope(
        nodes=normalized_nodes,
        edges=normalized_edges,
        scope_label=_normalize_text(scope.get("label")) or "*",
        max_depth=_to_int(scope.get("max_depth"), 3, 1),
        direction=scope.get("direction"),
    )
    normalized_nodes, normalized_edges = _apply_min_depth_scope(
        nodes=normalized_nodes,
        edges=normalized_edges,
        scope_label=_normalize_text(scope.get("label")) or "*",
        min_depth=_to_int(scope.get("min_depth"), 0, 0),
        direction=scope.get("direction"),
    )
```

- [x] **Step 3: Run the targeted min-depth tests**

Run:

```bash
./scripts/test.sh tests/test_graph_workbench.py \
  -k "min_depth or rejects_min_depth" -v
```

Expected: PASS.

### Task 4: Verify existing graph workbench behavior

**Files:**
- Test: `tests/test_graph_workbench.py`

- [x] **Step 1: Run the full graph workbench test file**

Run:

```bash
./scripts/test.sh tests/test_graph_workbench.py
```

Expected: PASS.

- [x] **Step 2: Run a lightweight diff audit**

Run:

```bash
git diff --check
git diff -- lightrag/api/graph_workbench.py lightrag/api/routers/graph_routes.py tests/test_graph_workbench.py
```

Expected: no whitespace errors; diff only contains `min_depth` request validation, helper filtering, and tests.

