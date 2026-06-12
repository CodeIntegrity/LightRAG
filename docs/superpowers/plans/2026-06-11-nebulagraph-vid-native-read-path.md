# NebulaGraph VID-Native Read Path Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace property-based MATCH reads with VID-native FETCH/GO queries in NebulaGraphStorage to reduce knowledge-graph load latency by ~6–8× (measured on 14.5k-node production data).

**Architecture:** All Nebula writes already use `_nebula_vid(entity_id)` (SHA1 hash) as Nebula VID. Read methods currently filter by `v.entity.entity_id ==` via OR-chain MATCH, which triggers full-graph Traverse after index scan. Switching reads to FETCH PROP (by VID) and GO FROM (by VID) bypasses the property filter entirely, going straight to GetVertices/Expand operators. Session acquisition overhead (52ms/query vs 2.5ms reuse) is eliminated by adopting `nebula3.gclient.net.SessionPool.SessionPool` bound to the workspace space. The initialization order is: ConnectionPool → CREATE SPACE → wait for space → SessionPool → schema/index (SessionPool requires the space to already exist).

**Tech Stack:** Python 3.12, asyncio, nebula3-python (`from nebula3.gclient.net.SessionPool import SessionPool`), pytest + unittest.mock

---

## Live Evidence Summary (pre-implementation, read-only benchmarks)

All measurements on `lightrag__work_a4` (14,526 vertices, 14,525 edges, graphd 2025.10.28-nightly, max_nodes=1000):

| Operation | Current (MATCH OR-chain) | VID-native (FETCH/GO) | Speedup |
|---|---:|---:|---:|
| `get_nodes_edges_batch` (1000 ids) | 4,754ms / 5 queries | 597ms / 1 GO | **8×** |
| `get_edges_batch` (537 pairs) | 2,751ms / 3 queries | 63ms / 1 FETCH | **44×** |
| `get_nodes_batch` (1000 ids) | 596ms / 5 queries | 99ms / 1 FETCH | **6×** |
| BFS single-layer expansion (1 node) | 448ms / MATCH | 11ms / GO | **40×** |
| Session per query (acquire+auth+USE+release) | 52.7ms | 2.5ms (pool reuse) | **21×** |

Equivalence verified:
- Node properties: MATCH vs FETCH — 120-sample field-level match ✅
- Adjacency: endpoint OR MATCH vs GO BIDIRECT — 8,657 directed pairs identical ✅
- Edge properties: pair OR MATCH vs FETCH PROP ON relation — 250-pair field-level match, 0 mismatches ✅
- Long CJK entity_id roundtrip via FETCH: 888 samples ✅
- FETCH with missing VID: returns 0 rows, no error ✅
- FETCH mixed real+missing VID: returns only existing, no error ✅
- GO from missing VID: returns 0 rows ✅
- Large statement (4000 VIDs ≈ 187KB): executes in 175ms ✅

## File Map

| File | Responsibility |
|---|---|
| `lightrag/kg/nebula_impl.py` | **Primary:** all read-method SQL changes, dual-channel SessionPool/ConnectionPool integration, `__init__`/`initialize`/`finalize`/`_execute_in_space` refactoring |
| `tests/test_nebula_graph_storage.py` | **Primary:** update SQL-shape assertions, add VID-native equivalence tests, add session-pool tests |

No other files need changes — the public `BaseGraphStorage` interface is unchanged.

## Constants Reference (from `nebula_impl.py`)

```python
_MAX_BATCH_FILTER_ITEMS = 200   # max items per OR/FETCH chunk
_DEFAULT_BATCH_WRITE_ITEMS = 100
_NODE_FIELDS = ("entity_id", "name", "entity_type", "description", "keywords",
                "source_id", "file_path", "created_at", "truncate", "custom_properties_json")
_EDGE_FIELDS = ("source_id", "target_id", "relationship", "description", "keywords",
                "weight", "file_path", "custom_properties_json")
```

## Test Fixture Pattern (established in existing tests)

```python
def build_storage(workspace="finance"):
    return NebulaGraphStorage(
        namespace="test", workspace=workspace,
        global_config={}, embedding_func=lambda *a, **kw: None,
    )

# Patch _execute_in_space to control SQL and return values:
execute_in_space = AsyncMock(return_value=[{...}])
with patch.object(storage, "_execute_in_space", execute_in_space):
    result = await storage.some_method(...)

# Inspect emitted SQL:
sql = execute_in_space.await_args_list[0].args[0]

# SQL whitespace normalization:
def _normalize_sql_whitespace(sql): return " ".join(str(sql).split())

# Bounded-query assertion helper:
def _assert_bounded_nebula_query(sql, *, required_tokens, forbidden_patterns): ...
```

---

### Task 1: Replace `get_node` with FETCH PROP ON entity

**Files:**
- Modify: `lightrag/kg/nebula_impl.py:1431-1451`
- Modify: `tests/test_nebula_graph_storage.py:966-1014` (roundtrip test), `:1172-1222` (long entity_id test), `:1218` (FETCH assertion)

- [ ] **Step 1: Write the failing test**

In `tests/test_nebula_graph_storage.py`, update `test_nebula_upsert_and_get_node_roundtrip` (line ~966). Change the get_sql assertion from:

```python
get_sql = execute_in_space.await_args_list[1].args[0]
assert "MATCH (v:entity)" in get_sql
assert "v.entity.entity_id ==" in get_sql
assert '"A"' in get_sql
```

To:

```python
get_sql = execute_in_space.await_args_list[1].args[0]
assert "FETCH PROP ON entity" in get_sql
vid_a = _nebula_vid("A")
assert _ngql_quote(vid_a) in get_sql
```

Also update `test_nebula_long_entity_id_uses_internal_vid_and_property_lookup` (line ~1218). Change:

```python
get_sql = execute_in_space.await_args_list[1].args[0]
assert "FETCH PROP ON entity" not in get_sql
assert "v.entity.entity_id ==" in get_sql
assert entity_id in get_sql
```

To:

```python
get_sql = execute_in_space.await_args_list[1].args[0]
assert "FETCH PROP ON entity" in get_sql
assert _ngql_quote(_nebula_vid(entity_id)) in get_sql
# The human-readable entity_id should NOT appear as a VID in the SQL
assert f'VALUES "{entity_id}"' not in get_sql
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py::test_nebula_upsert_and_get_node_roundtrip tests/test_nebula_graph_storage.py::test_nebula_long_entity_id_uses_internal_vid_and_property_lookup -v`
Expected: FAIL — `assert "FETCH PROP ON entity" in get_sql` fails because current code uses MATCH.

- [ ] **Step 3: Implement FETCH PROP in `get_node`**

Replace `lightrag/kg/nebula_impl.py` lines 1431–1451:

```python
async def get_node(self, node_id: str) -> dict[str, str] | None:
    vertex_vid = _nebula_vid(node_id)
    yield_fields = ", ".join(
        f"properties(vertex).{f} AS {f}" for f in _NODE_FIELDS
    )
    result = await self._execute_in_space(
        f"FETCH PROP ON entity {_ngql_quote(vertex_vid)} "
        f"YIELD {yield_fields};"
    )
    row = _first_row(result)
    if row is None:
        return None
    return self._extract_node_props(row, fallback_entity_id=node_id)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS. Confirm no other test breaks — the only SQL-shape changes are in `get_node`, and other tests that call `get_node` (e.g. `test_nebula_get_node_edges_returns_none_when_node_missing`) patch it out.

- [ ] **Step 5: Commit**

```bash
git add lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
git commit -m "perf(nebula): replace get_node MATCH with FETCH PROP by VID"
```

---

### Task 2: Replace `has_node` with FETCH PROP existence probe

**Files:**
- Modify: `lightrag/kg/nebula_impl.py:958-965`
- Modify: `tests/test_nebula_graph_storage.py:1873-1889`

- [ ] **Step 1: Write the failing test**

Update `test_nebula_has_node_uses_lightweight_existence_probe` (line ~1873). Change the SQL assertion to expect FETCH:

```python
sql = execute_in_space.await_args_list[0].args[0]
assert "FETCH PROP ON entity" in _normalize_sql_whitespace(sql)
assert "LIMIT 1" not in _normalize_sql_whitespace(sql)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py::test_nebula_has_node_uses_lightweight_existence_probe -v`
Expected: FAIL — current SQL is a MATCH with `LIMIT 1`.

- [ ] **Step 3: Implement**

Replace `lightrag/kg/nebula_impl.py` lines 958–965:

```python
async def has_node(self, node_id: str) -> bool:
    vertex_vid = _nebula_vid(node_id)
    result = await self._execute_in_space(
        f"FETCH PROP ON entity {_ngql_quote(vertex_vid)} "
        "YIELD properties(vertex).entity_id AS entity_id;"
    )
    return _first_row(result) is not None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
git commit -m "perf(nebula): replace has_node MATCH with FETCH PROP by VID"
```

---

### Task 3: Replace `has_edge` with FETCH PROP ON relation

**Files:**
- Modify: `lightrag/kg/nebula_impl.py:967-975`
- Modify: `tests/test_nebula_graph_storage.py:1891-1907`

- [ ] **Step 1: Write the failing test**

Update `test_nebula_has_edge_uses_lightweight_existence_probe` (line ~1891). Change the SQL assertion:

```python
sql = execute_in_space.await_args_list[0].args[0]
assert "FETCH PROP ON relation" in _normalize_sql_whitespace(sql)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py::test_nebula_has_edge_uses_lightweight_existence_probe -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `lightrag/kg/nebula_impl.py` lines 967–975:

```python
async def has_edge(self, source_node_id: str, target_node_id: str) -> bool:
    src_vid, tgt_vid = _nebula_edge_vids(source_node_id, target_node_id)
    result = await self._execute_in_space(
        f"FETCH PROP ON relation {_ngql_quote(src_vid)}->{_ngql_quote(tgt_vid)} "
        "YIELD properties(edge).source_id AS source_id;"
    )
    return _first_row(result) is not None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
git commit -m "perf(nebula): replace has_edge MATCH with FETCH PROP ON relation by VID"
```

---

### Task 4: Replace `get_edge` with FETCH PROP ON relation

**Files:**
- Modify: `lightrag/kg/nebula_impl.py:1453-1483`
- Modify: `tests/test_nebula_graph_storage.py:1224-1275` (long entity_id edge test), `:1276-1333` (edge reads preserve direction)

- [ ] **Step 1: Write the failing tests**

Update `test_nebula_long_entity_ids_use_internal_vids_for_edges_and_property_filters` (line ~1270). Change:

```python
fetch_sql = execute_in_space.await_args_list[1].args[0]
assert "a.entity.entity_id ==" in fetch_sql
assert "b.entity.entity_id ==" in fetch_sql
```

To:

```python
fetch_sql = execute_in_space.await_args_list[1].args[0]
assert "FETCH PROP ON relation" in fetch_sql
assert _ngql_quote(src_vid) in fetch_sql
assert _ngql_quote(tgt_vid) in fetch_sql
```

Update `test_nebula_edge_reads_preserve_direction` (line ~1327). Change:

```python
fetch_sql_1 = execute_in_space.await_args_list[1].args[0]
fetch_sql_2 = execute_in_space.await_args_list[2].args[0]
assert 'WHERE a.entity.entity_id == "B" AND b.entity.entity_id == "A"' in fetch_sql_1
assert 'WHERE a.entity.entity_id == "A" AND b.entity.entity_id == "B"' in fetch_sql_2
```

To:

```python
fetch_sql_1 = execute_in_space.await_args_list[1].args[0]
fetch_sql_2 = execute_in_space.await_args_list[2].args[0]
assert "FETCH PROP ON relation" in fetch_sql_1
assert "FETCH PROP ON relation" in fetch_sql_2
src_vid_ba, tgt_vid_ba = _nebula_edge_vids("B", "A")
src_vid_ab, tgt_vid_ab = _nebula_edge_vids("A", "B")
assert f"{_ngql_quote(src_vid_ba)}->{_ngql_quote(tgt_vid_ba)}" in fetch_sql_1
assert f"{_ngql_quote(src_vid_ab)}->{_ngql_quote(tgt_vid_ab)}" in fetch_sql_2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py::test_nebula_long_entity_ids_use_internal_vids_for_edges_and_property_filters tests/test_nebula_graph_storage.py::test_nebula_edge_reads_preserve_direction -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `lightrag/kg/nebula_impl.py` lines 1453–1483:

```python
async def get_edge(
    self, source_node_id: str, target_node_id: str
) -> dict[str, Any] | None:
    src_vid, tgt_vid = _nebula_edge_vids(source_node_id, target_node_id)
    yield_fields = ", ".join(
        f"properties(edge).{f} AS {f}" for f in _EDGE_FIELDS
    )
    result = await self._execute_in_space(
        f"FETCH PROP ON relation {_ngql_quote(src_vid)}->{_ngql_quote(tgt_vid)} "
        f"YIELD src(edge) AS sv, dst(edge) AS dv, {yield_fields};"
    )
    row = _first_row(result)
    if row is None:
        return None
    output = self._extract_edge_props(row)
    output["source"] = source_node_id
    output["target"] = target_node_id
    return output
```

Note: `src(edge)`/`dst(edge)` are yielded but not consumed — they exist so that `_result_to_rows` processes the row correctly if the Nebula client includes them. The source/target are set from the arguments (which is the current pattern in `_build_bounded_subgraph` line 1417).

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
git commit -m "perf(nebula): replace get_edge MATCH with FETCH PROP ON relation by VID"
```

---

### Task 5: Replace `get_nodes_batch` with FETCH PROP ON entity (chunked)

**Files:**
- Modify: `lightrag/kg/nebula_impl.py:1485-1526`
- Modify: `tests/test_nebula_graph_storage.py:1526-1652` (two batch tests)

This is the **biggest single win** for node property loading (6× speedup measured).

- [ ] **Step 1: Write the failing tests**

Update `test_nebula_get_nodes_batch_uses_single_lookup_query` (line ~1526). Replace the SQL assertions:

```python
sql = execute_in_space.await_args_list[0].args[0]
_assert_bounded_nebula_query(
    sql,
    required_tokens=['"A"', '"B"'],
    forbidden_patterns=[
        "MATCH (v:entity) RETURN id(v) AS entity_id",
    ],
)
assert "v.entity.name AS name" in sql
assert "v.entity.entity_type AS entity_type" in sql
assert "v.entity.file_path AS file_path" in sql
assert "v.entity.created_at AS created_at" in sql
assert "v.entity.truncate AS truncate" in sql
assert "v.entity.entity_id AS entity_id" in sql
```

With:

```python
sql = execute_in_space.await_args_list[0].args[0]
assert "FETCH PROP ON entity" in sql
vid_a = _ngql_quote(_nebula_vid("A"))
vid_b = _ngql_quote(_nebula_vid("B"))
assert vid_a in sql
assert vid_b in sql
for field in _NODE_FIELDS:
    assert f"properties(vertex).{field} AS {field}" in sql
```

Update `test_nebula_get_nodes_batch_splits_large_id_filters` (line ~1601). The inner `fake_execute` must be updated to handle FETCH SQL instead of MATCH SQL. Replace the entire `fake_execute`:

```python
async def fake_execute(sql: str):
    normalized_sql = _normalize_sql_whitespace(sql)
    vid_first = _ngql_quote(_nebula_vid("node-000"))
    vid_last = _ngql_quote(_nebula_vid("node-599"))
    has_first = vid_first in normalized_sql
    has_last = vid_last in normalized_sql
    assert not (
        has_first and has_last
    ), "large node filter should be split across multiple Nebula queries"
    rows: list[dict[str, object]] = []
    if has_first:
        rows.append(
            {
                "entity_id": "node-000",
                "name": "Node 0",
                "entity_type": "TypeA",
                "description": "first node",
                "keywords": "k0",
                "source_id": "s0",
                "file_path": "doc/0.md",
                "created_at": 100,
                "truncate": "",
            }
        )
    if has_last:
        rows.append(
            {
                "entity_id": "node-599",
                "name": "Node 599",
                "entity_type": "TypeZ",
                "description": "last node",
                "keywords": "k599",
                "source_id": "s599",
                "file_path": "doc/599.md",
                "created_at": 599,
                "truncate": "",
            }
        )
    return rows
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py::test_nebula_get_nodes_batch_uses_single_lookup_query tests/test_nebula_graph_storage.py::test_nebula_get_nodes_batch_splits_large_id_filters -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `lightrag/kg/nebula_impl.py` lines 1485–1526:

```python
async def get_nodes_batch(self, node_ids: list[str]) -> dict[str, dict]:
    requested_ids = [str(node_id) for node_id in node_ids]
    unique_ids = self._unique_preserve_order(
        [node_id for node_id in requested_ids if node_id]
    )
    if not unique_ids:
        return {}

    yield_fields = ", ".join(
        f"properties(vertex).{f} AS {f}" for f in _NODE_FIELDS
    )
    rows: list[dict[str, Any]] = []
    for id_chunk in _chunk_items(unique_ids, _MAX_BATCH_FILTER_ITEMS):
        vid_list = ", ".join(
            _ngql_quote(_nebula_vid(eid)) for eid in id_chunk
        )
        result = await self._execute_in_space(
            f"FETCH PROP ON entity {vid_list} YIELD {yield_fields};"
        )
        rows.extend(_result_to_rows(result))

    found_by_entity_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        entity_id = row.get("entity_id")
        if entity_id is None:
            continue
        found_by_entity_id[str(entity_id)] = row

    output: dict[str, dict] = {}
    for node_id in requested_ids:
        row = found_by_entity_id.get(node_id)
        if row is None:
            continue
        output[node_id] = self._extract_node_props(row, fallback_entity_id=node_id)
    return output
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
git commit -m "perf(nebula): replace get_nodes_batch OR-MATCH with FETCH PROP by VID"
```

---

### Task 6: Replace `get_edges_batch` with FETCH PROP ON relation (chunked)

**Files:**
- Modify: `lightrag/kg/nebula_impl.py:1561-1604`
- Modify: `tests/test_nebula_graph_storage.py:1708-1813` (two batch tests)

This is the **second biggest win** (44× for edge property loading).

- [ ] **Step 1: Write the failing tests**

Update `test_nebula_get_edges_batch_preserves_requested_direction` (line ~1708). Replace the SQL assertions:

```python
sql = execute_in_space.await_args_list[0].args[0]
_assert_bounded_nebula_query(
    sql,
    required_tokens=['"A"', '"B"', '"C"'],
    forbidden_patterns=[
        "MATCH (a:entity)-[e:relation]->(b:entity) RETURN id(a) AS source, id(b) AS target, e.source_id AS source_id, e.target_id AS target_id, e.relationship AS relationship, e.description AS description, e.weight AS weight;",
    ],
)
assert "a.entity.entity_id AS source" in sql
assert "b.entity.entity_id AS target" in sql
assert "e.keywords AS keywords" in sql
assert "e.file_path AS file_path" in sql
```

With:

```python
sql = execute_in_space.await_args_list[0].args[0]
assert "FETCH PROP ON relation" in sql
vid_a = _ngql_quote(_nebula_vid("A"))
vid_b = _ngql_quote(_nebula_vid("B"))
vid_c = _ngql_quote(_nebula_vid("C"))
# At least the A->B pair should be present
assert f"{vid_a}->{vid_b}" in sql
for field in _EDGE_FIELDS:
    assert f"properties(edge).{field} AS {field}" in sql
```

Update `test_nebula_get_edges_batch_splits_large_pair_filters` (line ~1763). Replace `fake_execute`:

```python
async def fake_execute(sql: str):
    normalized_sql = _normalize_sql_whitespace(sql)
    vid_l0 = _ngql_quote(_nebula_vid("left-000"))
    vid_r0 = _ngql_quote(_nebula_vid("right-000"))
    vid_l599 = _ngql_quote(_nebula_vid("left-599"))
    vid_r599 = _ngql_quote(_nebula_vid("right-599"))
    has_first = vid_l0 in normalized_sql and vid_r0 in normalized_sql
    has_last = vid_l599 in normalized_sql and vid_r599 in normalized_sql
    assert not (
        has_first and has_last
    ), "large edge pair filter should be split across multiple Nebula queries"
    rows: list[dict[str, object]] = []
    if has_first:
        rows.append(
            {
                "source": "left-000",
                "target": "right-000",
                "source_id": "left-000",
                "target_id": "right-000",
                "relationship": "first-edge",
                "description": "first chunk",
                "keywords": "k0",
                "weight": 1.0,
                "file_path": "doc/0.md",
            }
        )
    if has_last:
        rows.append(
            {
                "source": "left-599",
                "target": "right-599",
                "source_id": "left-599",
                "target_id": "right-599",
                "relationship": "last-edge",
                "description": "last chunk",
                "keywords": "k599",
                "weight": 2.0,
                "file_path": "doc/599.md",
            }
        )
    return rows
```

Note: FETCH PROP ON relation returns rows with `sv`/`dv` VID columns but the mock returns `source`/`target` as entity_ids. The mock data must include entity_id-friendly keys so that `_extract_edge_props` and the result-handling code work. Add `sv`/`dv` keys pointing to the VID strings, and also preserve `source`/`target` as entity_ids. Update both `if has_first` and `if has_last` dicts to add:

```python
"sv": _nebula_vid("left-000"),   # or "left-599" for second
"dv": _nebula_vid("right-000"),  # or "right-599" for second
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py::test_nebula_get_edges_batch_preserves_requested_direction tests/test_nebula_graph_storage.py::test_nebula_get_edges_batch_splits_large_pair_filters -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `lightrag/kg/nebula_impl.py` lines 1561–1604:

```python
async def get_edges_batch(self, pairs: list[dict[str, str]]) -> dict[tuple[str, str], dict]:
    requested_pairs: list[tuple[str, str]] = []
    for pair in pairs:
        src = str(pair.get("src", ""))
        tgt = str(pair.get("tgt", ""))
        if not src or not tgt:
            continue
        requested_pairs.append((src, tgt))

    if not requested_pairs:
        return {}

    yield_fields = ", ".join(
        f"properties(edge).{f} AS {f}" for f in _EDGE_FIELDS
    )
    output: dict[tuple[str, str], dict] = {}
    for pair_chunk in _chunk_items(
        list(dict.fromkeys(requested_pairs)), _MAX_BATCH_FILTER_ITEMS
    ):
        vid_pairs = ", ".join(
            f"{_ngql_quote(_nebula_vid(s))}->{_ngql_quote(_nebula_vid(t))}"
            for s, t in pair_chunk
        )
        result = await self._execute_in_space(
            f"FETCH PROP ON relation {vid_pairs} "
            f"YIELD src(edge) AS sv, dst(edge) AS dv, {yield_fields};"
        )
        rows = _result_to_rows(result)
        for row in rows:
            src_vid = row.get("sv")
            tgt_vid = row.get("dv")
            if src_vid is None or tgt_vid is None:
                continue
            # Reverse-lookup VID to entity_id via the requested_pairs in this chunk
            src_id = None
            tgt_id = None
            for s, t in pair_chunk:
                if _nebula_vid(s) == str(src_vid) and _nebula_vid(t) == str(tgt_vid):
                    src_id = s
                    tgt_id = t
                    break
            if src_id is None or tgt_id is None:
                continue
            props = self._extract_edge_props(row)
            props["source"] = src_id
            props["target"] = tgt_id
            output[(src_id, tgt_id)] = props
    return output
```

The VID-to-entity_id reverse lookup iterates over the chunk (max 200 pairs), which is fast. No additional data structure is needed because the chunk is small.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
git commit -m "perf(nebula): replace get_edges_batch OR-MATCH with FETCH PROP ON relation by VID"
```

---

### Task 7: Replace `get_nodes_edges_batch` and `node_degrees_batch` with GO FROM OVER relation

**Files:**
- Modify: `lightrag/kg/nebula_impl.py:1528-1559` (node_degrees_batch), `1613-1654` (get_nodes_edges_batch)
- Modify: `tests/test_nebula_graph_storage.py:1653-1707` (degrees tests), `1815-1871` (adjacency tests), `:2378-2428` (direction test)

This is the **largest single win** (8× for adjacency, 40× for BFS single-node expansion). Both methods currently use `_build_relation_endpoint_clause` which generates OR-chains that trigger full-graph Traverse.

**GO direction semantics (verified on live Nebula):**
- `GO FROM ... OVER relation` — outbound edges only (default)
- `GO FROM ... OVER relation REVERSELY` — inbound edges only
- `GO FROM ... OVER relation BIDIRECT` — both directions

**Dedup rule (verified on live Nebula):** `GO FROM A,B OVER relation BIDIRECT` returns each edge once per anchor. When both endpoints are in the FROM list, the same physical edge appears as two rows (one with anchor=A, one with anchor=B). The correct aggregation is to **only count/append to the anchor node's list** — this matches the MATCH undirected degree exactly. Adding to both anchor and neighbor produces duplicate edges and double-counted degrees.

- [ ] **Step 1: Write the failing tests**

Update `test_nebula_node_degrees_batch_aggregates_with_single_query` (line ~1653). Change the SQL assertion:

```python
assert execute_in_space.await_count == 1
sql = execute_in_space.await_args_list[0].args[0]
assert "GO FROM" in sql
assert "OVER relation" in sql
assert "BIDIRECT" in sql
```

Update `test_nebula_node_degrees_batch_splits_large_endpoint_filters` (line ~1680). Replace `fake_execute`:

```python
async def fake_execute(sql: str):
    normalized_sql = _normalize_sql_whitespace(sql)
    vid_first = _ngql_quote(_nebula_vid("node-000"))
    vid_last = _ngql_quote(_nebula_vid("node-599"))
    has_first = vid_first in normalized_sql
    has_last = vid_last in normalized_sql
    assert not (
        has_first and has_last
    ), "large degree filter should be split across multiple Nebula queries"
    rows: list[dict[str, str]] = []
    if has_first:
        rows.append({"anchor": "node-000", "neighbor": "neighbor-000"})
    if has_last:
        rows.append({"anchor": "neighbor-599", "neighbor": "node-599"})
    return rows
```

Update `test_nebula_get_nodes_edges_batch_returns_adjacency_mapping` (line ~1815). Replace SQL assertions:

```python
assert execute_in_space.await_count == 1
sql = execute_in_space.await_args_list[0].args[0]
assert "GO FROM" in sql
assert "OVER relation" in sql
assert "BIDIRECT" in sql
```

Update `test_nebula_get_nodes_edges_batch_splits_large_endpoint_filters` (line ~1845). Replace `fake_execute`:

```python
async def fake_execute(sql: str):
    normalized_sql = _normalize_sql_whitespace(sql)
    vid_first = _ngql_quote(_nebula_vid("node-000"))
    vid_last = _ngql_quote(_nebula_vid("node-599"))
    has_first = vid_first in normalized_sql
    has_last = vid_last in normalized_sql
    assert not (
        has_first and has_last
    ), "large endpoint filter should be split across multiple Nebula queries"
    rows: list[dict[str, str]] = []
    if has_first:
        rows.append({"anchor": "node-000", "neighbor": "neighbor-000"})
    if has_last:
        rows.append({"anchor": "neighbor-599", "neighbor": "node-599"})
    return rows
```

Update `test_nebula_get_knowledge_graph_entity_respects_direction` (line ~2378). The direction test currently expects the mock `get_nodes_edges_batch` to be called with `direction` kwarg. This test patches `get_nodes_edges_batch` directly so it will continue to pass without changes. But we must add new direction-specific GO SQL tests in Task 10 to cover the REVERSELY/BIDIRECT path.

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -k "node_degrees_batch or get_nodes_edges_batch" -v`
Expected: FAIL.

- [ ] **Step 3: Implement `get_nodes_edges_batch`**

Replace `lightrag/kg/nebula_impl.py` lines 1613–1654:

```python
async def get_nodes_edges_batch(
    self, node_ids: list[str], direction: str = "both"
) -> dict[str, list[tuple[str, str]]]:
    requested_ids = [str(node_id) for node_id in node_ids]
    output = {node_id: [] for node_id in requested_ids}
    unique_ids = self._unique_preserve_order(
        [node_id for node_id in requested_ids if node_id]
    )
    if not unique_ids:
        return output

    normalized_direction = str(direction or "both").strip().lower()
    if normalized_direction not in {"both", "outbound", "inbound"}:
        normalized_direction = "both"

    go_yield = (
        "properties($^).entity_id AS anchor, "
        "properties($$).entity_id AS neighbor, "
        "src(edge) AS src_vid, id($^) AS anchor_vid"
    )

    for id_chunk in _chunk_items(unique_ids, _MAX_BATCH_FILTER_ITEMS):
        vid_list = ", ".join(
            _ngql_quote(_nebula_vid(eid)) for eid in id_chunk
        )

        if normalized_direction == "both":
            direction_clause = "BIDIRECT"
        elif normalized_direction == "inbound":
            direction_clause = "REVERSELY"
        else:
            direction_clause = ""

        result = await self._execute_in_space(
            f"GO FROM {vid_list} OVER relation {direction_clause} "
            f"YIELD {go_yield};"
        )
        rows = _result_to_rows(result)
        for row in rows:
            anchor = row.get("anchor")
            neighbor = row.get("neighbor")
            if anchor is None or neighbor is None:
                continue
            anchor_id = str(anchor)
            neighbor_id = str(neighbor)
            if anchor_id not in output:
                continue
            src_vid = str(row.get("src_vid", ""))
            anchor_is_src = src_vid == str(row.get("anchor_vid", ""))

            if anchor_is_src:
                edge = (anchor_id, neighbor_id)
            else:
                edge = (neighbor_id, anchor_id)

            output[anchor_id].append(edge)
    return output
```

Direction handling explanation:
- **outbound**: `GO FROM ... OVER relation` — returns edges where anchor is the source vertex. Each row's anchor is a requested node; the edge is `(anchor, neighbor)`.
- **inbound**: `GO FROM ... OVER relation REVERSELY` — returns edges where anchor is the destination vertex. The edge's stored source is the neighbor. We use `src_vid != anchor_vid` to determine direction: edge is `(neighbor, anchor)`.
- **both**: `GO FROM ... OVER relation BIDIRECT` — returns all edges touching the anchor. Each row belongs to exactly one anchor (the `$^` vertex). We **only append to the anchor's list**, never to the neighbor's. This avoids duplicate edges when both endpoints are in the requested set (verified: anchor-only produces the same edge set and degree as MATCH undirected).
- The `anchor_id not in output` guard skips anchors that aren't in the requested set (e.g. neighbors of our anchors that weren't themselves requested).

- [ ] **Step 4: Implement `node_degrees_batch`**

Replace `lightrag/kg/nebula_impl.py` lines 1528–1559:

```python
async def node_degrees_batch(self, node_ids: list[str]) -> dict[str, int]:
    requested_ids = [str(node_id) for node_id in node_ids]
    output = {node_id: 0 for node_id in requested_ids}
    unique_ids = self._unique_preserve_order(
        [node_id for node_id in requested_ids if node_id]
    )
    if not unique_ids:
        return output

    go_yield = "properties($^).entity_id AS anchor, properties($$).entity_id AS neighbor"

    for id_chunk in _chunk_items(unique_ids, _MAX_BATCH_FILTER_ITEMS):
        vid_list = ", ".join(
            _ngql_quote(_nebula_vid(eid)) for eid in id_chunk
        )
        result = await self._execute_in_space(
            f"GO FROM {vid_list} OVER relation BIDIRECT "
            f"YIELD {go_yield};"
        )
        rows = _result_to_rows(result)
        for row in rows:
            anchor = row.get("anchor")
            if anchor is None:
                continue
            anchor_id = str(anchor)
            if anchor_id in output:
                output[anchor_id] += 1
    return output
```

Degree counting explanation:
- GO BIDIRECT returns one row per (anchor, neighbor) pair. Each row counts as degree 1 for the anchor.
- We count **only the anchor** — not the neighbor. This matches the MATCH undirected degree (verified: anchor-only counting on 14.5k-node dataset matches MATCH count exactly).
- Counting both anchor and neighbor would double-count when both endpoints are in the requested set.

- [ ] **Step 5: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
git commit -m "perf(nebula): replace adjacency/degree OR-MATCH with GO FROM by VID"
```

---

### Task 8: Adopt SessionPool for space-bound query execution

**Files:**
- Modify: `lightrag/kg/nebula_impl.py:443-620` (`__init__`, `initialize`, `finalize`, `_load_nebula_session_pool_types`, `_bootstrap_session_pool`, `_execute_in_space`, `_close_connection_pool`, `drop`)
- Modify: `tests/test_nebula_graph_storage.py:414-620`, `:936-965`, `:1498-1518` (bootstrap/initialize/finalize/execute/drop tests)

Current pattern: every `_execute_in_space` call acquires a new session (auth + USE space), executes one query, then releases. Measured overhead: 52.7ms per call vs 2.5ms for session reuse. At 13 queries per `label=*` load, this wastes ~650ms.

Target pattern: keep the existing `ConnectionPool` for no-space/system/DDL/cross-space operations, and add `nebula3.gclient.net.SessionPool.SessionPool` for workspace-space queries only. `SessionPool` executes `USE <space>` during `init()`, so it must be initialized **after** `CREATE SPACE` and `_wait_for_space_ready()`.

**Repair Track**
- Root cause: read methods pay per-query auth + `USE <space>` overhead, but some Nebula operations still require a plain session not bound to the workspace space.
- Canonical owner: `NebulaGraphStorage` owns both query channels.
- Minimal stable repair: `_execute_in_space()` routes through a space-bound `SessionPool`; `_execute()` / `_acquire_session()` / `_release_session()` / `_use_space()` remain for no-space DDL, `SHOW SPACES`, `SHOW TEXT SEARCH CLIENTS`, and listener discovery.
- Compatibility boundary: public `BaseGraphStorage` API stays unchanged; existing env vars keep working.
- Verification: unit tests assert initialization order, import path, session-pool execution, and cleanup of both pools.

**Retirement Track**
- Old owner: per-query `_execute_in_space()` session acquisition.
- Active status after this task: retired for workspace-space query execution, retained for system and cross-space operations via `_execute()` and named-space helpers.
- Deletion trigger: only delete `_acquire_session` / `_release_session` / `_use_space` if a later plan proves all no-space and cross-space paths were replaced by a safe alternative.

- [ ] **Step 1: Write the failing test**

Add these tests after `test_bootstrap_client_initializes_connection_pool_only` (line ~414):

Update the `lightrag.kg.nebula_impl` test import list to include `_load_nebula_session_pool_types`.

```python
@pytest.mark.asyncio
async def test_bootstrap_client_creates_session_pool_bound_to_space():
    storage = build_storage()
    storage._hosts = [("127.0.0.1", 9669)]
    storage._user = "root"
    storage._password = "nebula"
    session_pool = Mock()
    session_pool.init.return_value = True
    session_pool_cls = Mock(return_value=session_pool)
    config = Mock()

    with patch(
        "lightrag.kg.nebula_impl._load_nebula_session_pool_types",
        return_value=(Mock(return_value=config), session_pool_cls),
    ):
        await storage._bootstrap_session_pool()

    session_pool_cls.assert_called_once_with(
        "root", "nebula", storage._space_name, storage._hosts
    )
    session_pool.init.assert_called_once_with(config, None)
    assert storage._session_pool is session_pool
```

Add an initialization-order test:

```python
@pytest.mark.asyncio
async def test_initialize_creates_space_before_session_pool():
    storage = build_storage()
    storage._hosts = [("127.0.0.1", 9669)]
    storage._user = "root"
    storage._password = "nebula"
    calls: list[str] = []

    def recorder(name: str):
        async def _record(*args, **kwargs):
            calls.append(name)

        return _record

    with (
        patch.object(storage, "_bootstrap_client", AsyncMock(side_effect=recorder("connection_pool"))),
        patch.object(storage, "_create_space_if_needed", AsyncMock(side_effect=recorder("create_space"))),
        patch.object(storage, "_wait_for_space_ready", AsyncMock(side_effect=recorder("wait_space"))),
        patch.object(storage, "_bootstrap_session_pool", AsyncMock(side_effect=recorder("session_pool"))),
        patch.object(storage, "_create_schema_if_needed", AsyncMock(side_effect=recorder("schema"))),
        patch.object(storage, "_wait_for_schema_ready", AsyncMock(side_effect=recorder("wait_schema"))),
        patch.object(storage, "_create_indexes_if_needed", AsyncMock(side_effect=recorder("indexes"))),
    ):
        await storage.initialize()

    assert calls == [
        "connection_pool",
        "create_space",
        "wait_space",
        "session_pool",
        "schema",
        "wait_schema",
        "indexes",
    ]
```

Add a test for `_execute_in_space` using session pool:

```python
@pytest.mark.asyncio
async def test_execute_in_space_uses_session_pool():
    storage = build_storage()
    mock_pool = Mock()
    mock_result = object()
    mock_pool.execute.return_value = mock_result
    storage._session_pool = mock_pool
    storage._connection_pool = None

    result = await storage._execute_in_space("YIELD 1;")

    mock_pool.execute.assert_called_once_with("YIELD 1;")
    assert result is mock_result
```

Add a test for `_execute()` staying available for no-space system queries:

```python
@pytest.mark.asyncio
async def test_execute_still_uses_connection_pool_for_system_queries():
    storage = build_storage()
    storage._user = "root"
    storage._password = "nebula"
    session = Mock()
    result = object()
    session.execute.return_value = result
    storage._connection_pool = Mock()
    storage._connection_pool.get_session.return_value = session

    actual = await storage._execute("SHOW SPACES;")

    assert actual is result
    storage._connection_pool.get_session.assert_called_once_with(
        storage._user, storage._password
    )
    session.execute.assert_called_once_with("SHOW SPACES;")
    session.release.assert_called_once()
```

Add a test for `_close_connection_pool` cleaning up both pools:

```python
@pytest.mark.asyncio
async def test_close_connection_pool_closes_session_and_connection_pools():
    storage = build_storage()
    mock_session_pool = Mock()
    mock_connection_pool = Mock()
    storage._session_pool = mock_session_pool
    storage._connection_pool = mock_connection_pool

    await storage._close_connection_pool()

    mock_session_pool.close.assert_called_once()
    mock_connection_pool.close.assert_called_once()
    assert storage._session_pool is None
    assert storage._connection_pool is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -k "session_pool or initialize_creates_space_before_session_pool or system_queries or close_connection_pool" -v`
Expected: FAIL — `_session_pool`, `_bootstrap_session_pool`, and `_load_nebula_session_pool_types` do not exist yet.

- [ ] **Step 3: Implement SessionPool without removing the system query channel**

Add a new helper near `_load_nebula_client_types()`:

```python
def _load_nebula_session_pool_types() -> tuple[Any, Any]:
    try:
        from nebula3.Config import SessionPoolConfig  # type: ignore
        from nebula3.gclient.net.SessionPool import SessionPool  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on optional package
        raise ImportError(
            "nebula3-python is required for NebulaGraphStorage. "
            "Install the storage extras with `uv sync --extra offline-storage`, "
            "or set LIGHTRAG_GRAPH_STORAGE=NetworkXStorage if you do not intend "
            "to use NebulaGraph."
        ) from exc
    return SessionPoolConfig, SessionPool
```

In `__init__` (line ~489), add:

```python
self._session_pool: Any | None = None
```

Keep `_bootstrap_client()` as the plain `ConnectionPool` bootstrap. Do **not** replace it with `SessionPool`.

Add `_bootstrap_session_pool()` after `_bootstrap_client()`:

```python
async def _bootstrap_session_pool(self) -> None:
    if self._session_pool is not None:
        return

    SessionPoolConfig, SessionPool = _load_nebula_session_pool_types()
    pool_config = SessionPoolConfig()
    pool_config.timeout = self._timeout_ms
    pool_config.max_size = _env_int("NEBULA_MAX_CONNECTION_POOL_SIZE", 10)
    pool_config.min_size = _env_int("NEBULA_MIN_CONNECTION_POOL_SIZE", 1)
    pool_config.use_http2 = self._use_http2

    session_pool = SessionPool(
        self._user or "",
        self._password or "",
        self._space_name,
        self._hosts,
    )
    _, _, SSLConfig = _load_nebula_client_types()
    ssl_config = SSLConfig() if self._ssl_enabled else None
    ok = await asyncio.to_thread(session_pool.init, pool_config, ssl_config)
    if not ok:
        raise RuntimeError("Failed to initialize Nebula session pool.")

    self._session_pool = session_pool
```

Update `_ensure_space_ready()` so `SessionPool` is created only after the space can be used:

```python
async def _ensure_space_ready(self, *, rebuild_indexes: bool = False) -> None:
    await self._create_space_if_needed()
    await self._wait_for_space_ready()
    await self._bootstrap_session_pool()
    await self._create_schema_if_needed()
    await self._wait_for_schema_ready()
    await self._create_indexes_if_needed(rebuild=rebuild_indexes)
```

Replace `_execute_in_space` (lines 588–596):

```python
async def _execute_in_space(self, statement: str) -> Any:
    if self._session_pool is None:
        raise RuntimeError("Nebula session pool is not initialized.")
    result = await asyncio.to_thread(self._session_pool.execute, statement)
    if hasattr(result, "is_succeeded") and not result.is_succeeded():
        error_msg = "unknown error"
        if hasattr(result, "error_msg"):
            raw = result.error_msg()
            if isinstance(raw, bytes):
                error_msg = raw.decode("utf-8", errors="ignore")
            else:
                error_msg = str(raw)
        raise RuntimeError(f"Nebula query failed: {statement} ({error_msg})")
    return result
```

Keep `_execute()`, `_acquire_session()`, `_release_session()`, and `_use_space()` because they still own no-space DDL/system queries and cross-space listener discovery.

Replace `_close_connection_pool` (lines 515–518):

```python
async def _close_connection_pool(self) -> None:
    if self._session_pool is not None:
        await asyncio.to_thread(self._session_pool.close)
        self._session_pool = None
    if self._connection_pool is not None:
        await asyncio.to_thread(self._connection_pool.close)
        self._connection_pool = None
```

Update `drop()` (line ~936) to close the space-bound session pool before dropping the space, while still using the plain connection pool for the no-space DDL:

```python
async def drop(self) -> dict[str, str]:
    try:
        if self._session_pool is not None:
            await asyncio.to_thread(self._session_pool.close)
            self._session_pool = None
        if self._connection_pool is None:
            self._validate_required_env()
            await self._bootstrap_client()

        await self._execute(f"DROP SPACE IF EXISTS `{self._space_name}`;")
        return {
            "status": "success",
            "message": f"workspace '{self._space_name}' dropped",
        }
    except Exception as exc:
        logger.error(
            f"[{self.workspace}] Error dropping Nebula space '{self._space_name}': {exc}"
        )
        return {"status": "error", "message": str(exc)}
    finally:
        self._invalidate_popular_labels_cache()
        self._fulltext_init_error = None
        self._initialized = False
        await self._close_connection_pool()
```

- [ ] **Step 4: Update existing tests without erasing system-query coverage**

Several existing tests mock the old session-per-query architecture. They need updating:

1. `test_initialize_creates_space_and_schema` (line ~272): keep coverage that `_create_space_if_needed` uses `_execute()` before `_bootstrap_session_pool()`, and update expected call order.

2. `test_execute_in_space_uses_same_session_for_use_and_query` (line ~946): this test verifies the old USE+query-on-same-session pattern. Replace it with the new `test_execute_in_space_uses_session_pool` test added in Step 1.

3. `test_wait_for_space_ready_*` tests (lines ~553–685): keep them on `_acquire_session` / `_release_session` / `_use_space`, because waiting for space readiness happens before `SessionPool` exists.

4. `test_bootstrap_client_*` tests (lines ~414–486): keep existing `ConnectionPool` tests and add separate `_bootstrap_session_pool` tests.

5. `test_finalize_closes_client_resources` (line ~539): update to assert both `_session_pool` and `_connection_pool` are closed and set to `None`.

6. `test_nebula_drop_drops_space_and_resets_state` (line ~1498): keep patching `_execute`, and add a session-pool close assertion when `_session_pool` is present.

For each test, the principle is:
- `_execute_in_space` should use `_session_pool`.
- `_execute` should keep using `_connection_pool`.
- Space creation and readiness should happen before `_bootstrap_session_pool`.
- Finalization/drop should clean up both pools.

- [ ] **Step 5: Run tests to verify they pass**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
git commit -m "perf(nebula): adopt SessionPool for space-bound query execution"
```

---

### Task 9: Clean up dead code

**Files:**
- Modify: `lightrag/kg/nebula_impl.py`

- [ ] **Step 1: Remove unused methods and imports**

Remove the following from `NebulaGraphStorage`:
- `_build_or_equals_clause` (only used by the old `get_nodes_batch` MATCH — now replaced by FETCH)
- `_build_relation_endpoint_clause` (only used by old `get_nodes_edges_batch` / `node_degrees_batch` — now replaced by GO)
- `_build_relation_pair_clause` (only used by old `get_edges_batch` — now replaced by FETCH)

Do **not** remove `_acquire_session`, `_release_session`, `_execute`, or `_use_space`. They remain active for no-space/system queries and space readiness/listener discovery before `SessionPool` is available.

Before removing, verify with grep that no other code references them:

```bash
grep -rn '_build_or_equals_clause\|_build_relation_endpoint_clause\|_build_relation_pair_clause' lightrag/ tests/
```

Expected: only `nebula_impl.py` definitions and the test file references (which were updated in previous tasks). If any test still references them, that test needs updating first.

Also verify the retained session methods still have real call sites:

```bash
grep -rn '_acquire_session\|_release_session\|_use_space\|_execute(' lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py
```

Expected: `_execute()` / `_acquire_session()` / `_release_session()` / `_use_space()` are still referenced by system-query, DDL/drop, space-ready, and listener-discovery tests.

- [ ] **Step 2: Run full test suite**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add lightrag/kg/nebula_impl.py
git commit -m "refactor(nebula): remove dead MATCH clause builders after VID migration"
```

---

### Task 10: Add VID-native equivalence regression tests

**Files:**
- Modify: `tests/test_nebula_graph_storage.py`

These tests guard against regressions in the VID-based read path. They are unit tests (mocked `_execute_in_space`) that verify the SQL shape contains VID-native patterns and the result-handling logic is correct.

- [ ] **Step 1: Write FETCH PROP node roundtrip with CJK id**

```python
@pytest.mark.asyncio
async def test_nebula_get_node_fetch_prop_roundtrip_cjk():
    storage = build_storage(workspace="finance")
    cjk_id = "拆采油树，组装防喷器组"
    vid = _nebula_vid(cjk_id)
    execute_in_space = AsyncMock(
        return_value=[
            {
                "entity_id": cjk_id,
                "name": cjk_id,
                "entity_type": "TypeX",
                "description": "desc",
                "keywords": "",
                "source_id": "s1",
                "file_path": "",
                "created_at": 0,
                "truncate": "",
            }
        ]
    )
    with patch.object(storage, "_execute_in_space", execute_in_space):
        node = await storage.get_node(cjk_id)

    assert node is not None
    assert node["entity_id"] == cjk_id
    sql = execute_in_space.await_args_list[0].args[0]
    assert "FETCH PROP ON entity" in sql
    assert _ngql_quote(vid) in sql
    assert cjk_id not in sql  # entity_id should not appear as a VID
```

- [ ] **Step 2: Write FETCH PROP edge roundtrip test**

```python
@pytest.mark.asyncio
async def test_nebula_get_edge_fetch_prop_returns_edge_by_vid():
    storage = build_storage(workspace="finance")
    src_vid, tgt_vid = _nebula_edge_vids("A", "B")
    execute_in_space = AsyncMock(
        return_value=[
            {
                "sv": src_vid,
                "dv": tgt_vid,
                "source_id": "chunk-1",
                "target_id": "chunk-2",
                "relationship": "rel",
                "description": "d",
                "keywords": "k1",
                "weight": 1.0,
                "file_path": "",
            }
        ]
    )
    with patch.object(storage, "_execute_in_space", execute_in_space):
        edge = await storage.get_edge("A", "B")

    assert edge is not None
    assert edge["source"] == "A"
    assert edge["target"] == "B"
    sql = execute_in_space.await_args_list[0].args[0]
    assert "FETCH PROP ON relation" in sql
    assert f"{_ngql_quote(src_vid)}->{_ngql_quote(tgt_vid)}" in sql
```

- [ ] **Step 3: Write GO BIDIRECT adjacency and de-dup test**

```python
@pytest.mark.asyncio
async def test_nebula_get_nodes_edges_batch_uses_go_bidirect_without_double_append():
    storage = build_storage(workspace="finance")
    vid_a = _nebula_vid("A")
    vid_b = _nebula_vid("B")
    execute_in_space = AsyncMock(
        return_value=[
            {
                "anchor": "A",
                "neighbor": "B",
                "src_vid": vid_a,
                "anchor_vid": vid_a,
            },
            {
                "anchor": "B",
                "neighbor": "A",
                "src_vid": vid_a,
                "anchor_vid": vid_b,
            },
        ]
    )
    with patch.object(storage, "_execute_in_space", execute_in_space):
        result = await storage.get_nodes_edges_batch(["A", "B"])

    assert result == {"A": [("A", "B")], "B": [("A", "B")]}
    sql = execute_in_space.await_args_list[0].args[0]
    assert "GO FROM" in sql
    assert "OVER relation" in sql
    assert "BIDIRECT" in sql
    assert _ngql_quote(vid_a) in sql
```

- [ ] **Step 4: Write GO direction tests (outbound and inbound)**

```python
@pytest.mark.asyncio
async def test_nebula_get_nodes_edges_batch_outbound_direction_skips_bidirect():
    storage = build_storage(workspace="finance")
    execute_in_space = AsyncMock(
        return_value=[
            {
                "anchor": "A",
                "neighbor": "B",
                "src_vid": _nebula_vid("A"),
                "anchor_vid": _nebula_vid("A"),
            },
        ]
    )
    with patch.object(storage, "_execute_in_space", execute_in_space):
        result = await storage.get_nodes_edges_batch(["A"], direction="outbound")

    sql = execute_in_space.await_args_list[0].args[0]
    assert "BIDIRECT" not in sql
    assert "REVERSELY" not in sql
    assert "GO FROM" in sql
    assert "OVER relation" in sql
    assert result["A"] == [("A", "B")]


@pytest.mark.asyncio
async def test_nebula_get_nodes_edges_batch_inbound_direction_uses_reversely():
    storage = build_storage(workspace="finance")
    execute_in_space = AsyncMock(
        return_value=[
            {
                "anchor": "A",
                "neighbor": "C",
                "src_vid": _nebula_vid("C"),
                "anchor_vid": _nebula_vid("A"),
            },
        ]
    )
    with patch.object(storage, "_execute_in_space", execute_in_space):
        result = await storage.get_nodes_edges_batch(["A"], direction="inbound")

    sql = execute_in_space.await_args_list[0].args[0]
    assert "GO FROM" in sql
    assert "OVER relation REVERSELY" in sql
    assert "BIDIRECT" not in sql
    assert result["A"] == [("C", "A")]
```

- [ ] **Step 5: Write node_degrees_batch GO de-dup test**

```python
@pytest.mark.asyncio
async def test_nebula_node_degrees_batch_uses_go_bidirect_without_double_counting():
    storage = build_storage(workspace="finance")
    execute_in_space = AsyncMock(
        return_value=[
            {"anchor": "A", "neighbor": "B"},
            {"anchor": "B", "neighbor": "A"},
        ]
    )
    with patch.object(storage, "_execute_in_space", execute_in_space):
        degrees = await storage.node_degrees_batch(["A", "B"])

    assert degrees == {"A": 1, "B": 1}
    sql = execute_in_space.await_args_list[0].args[0]
    assert "GO FROM" in sql
    assert "OVER relation BIDIRECT" in sql
```

- [ ] **Step 6: Write SessionPool import-path regression test**

```python
def test_load_nebula_session_pool_types_imports_class_not_module():
    SessionPoolConfig, SessionPool = _load_nebula_session_pool_types()

    assert SessionPoolConfig.__name__ == "SessionPoolConfig"
    assert SessionPool.__name__ == "SessionPool"
    assert callable(SessionPool)
```

- [ ] **Step 7: Run all new tests**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -k "fetch_prop_roundtrip or fetch_prop_returns_edge or go_bidirect or outbound_direction or inbound_direction or degrees_batch_uses_go or session_pool_types" -v`
Expected: ALL PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/test_nebula_graph_storage.py
git commit -m "test(nebula): add VID-native FETCH/GO equivalence regression tests"
```

---

### Task 11: Run full test suite and verify no regressions

**Files:** None (verification only)

- [ ] **Step 1: Run the complete Nebula test suite**

Run: `./scripts/test.sh tests/test_nebula_graph_storage.py -v`
Expected: ALL PASS, 0 failures.

- [ ] **Step 2: Run the shared graph storage test suite**

Run: `./scripts/test.sh tests/kg/test_graph_storage.py -v`
Expected: ALL PASS — backend-specific changes must still satisfy shared graph storage expectations.

- [ ] **Step 3: Run the full test suite (smoke check)**

Run: `./scripts/test.sh tests/ -x --timeout=120`
Expected: No failures introduced by this change. (Other pre-existing failures are not this plan's responsibility.)

- [ ] **Step 4: Commit (no-op if clean)**

```bash
git status
# If clean, no commit needed. If any test fixups were needed, commit them.
```

---

## Self-Review Checklist

### Spec Coverage
- ✅ `get_node` → FETCH: Task 1
- ✅ `has_node` → FETCH: Task 2
- ✅ `has_edge` → FETCH: Task 3
- ✅ `get_edge` → FETCH: Task 4
- ✅ `get_nodes_batch` → FETCH (chunked): Task 5
- ✅ `get_edges_batch` → FETCH (chunked): Task 6
- ✅ `get_nodes_edges_batch` → direction-aware GO (`outbound` default, `REVERSELY`, `BIDIRECT`): Task 7
- ✅ `node_degrees_batch` → GO BIDIRECT: Task 7
- ✅ Space-bound SessionPool plus retained system ConnectionPool: Task 8
- ✅ Dead code removal: Task 9
- ✅ Regression tests: Task 10
- ✅ Full verification: Task 11

### Placeholder Scan
- No "TBD", "TODO", "implement later" found.
- No "add appropriate error handling" without code.
- No "write tests for the above" without actual test code.
- No "similar to Task N" — each task has complete code.

### Type Consistency
- `_nebula_vid()` returns `str` — used consistently as VID throughout.
- `_ngql_quote()` wraps a string in double quotes for nGQL — used for all VID references in FETCH/GO.
- `_ngql_literal()` wraps strings in double quotes for nGQL property values — not used in VID-native paths (correct).
- `_nebula_edge_vids()` returns `tuple[str, str]` — used in `has_edge`, `get_edge`, `get_edges_batch`.
- `_EDGE_FIELDS` / `_NODE_FIELDS` tuples referenced consistently across all tasks.
- `_MAX_BATCH_FILTER_ITEMS = 200` used for chunking in all batch methods.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| FETCH with duplicate VID returns 2 rows | Current code uses dict aggregation (`found_by_entity_id`) which naturally deduplicates by entity_id. No change needed. |
| GO BIDIRECT returns one row per requested anchor | Task 7 aggregates only to the anchor node, not to both anchor and neighbor. Task 10 adds de-dup and no-double-count tests. |
| `direction="inbound"` accidentally behaves like outbound | Task 7 maps inbound to `GO ... REVERSELY`; Task 10 adds a `REVERSELY` SQL-shape regression test. |
| SessionPool cannot execute before the space exists | Task 8 keeps `ConnectionPool` first, runs `CREATE SPACE` + `_wait_for_space_ready()`, then initializes `SessionPool`. |
| Some Nebula queries are no-space or cross-space (`SHOW SPACES`, text search clients, listener discovery, `DROP SPACE`) | Task 8 keeps `_execute()` / `_acquire_session()` / `_release_session()` / `_use_space()` on the plain `ConnectionPool`; Task 9 explicitly forbids deleting them. |
| Wrong SessionPool import returns a module instead of the callable class | Task 8 uses `from nebula3.gclient.net.SessionPool import SessionPool`; Task 10 adds an import-path regression test. |
| Statement length for 200 VIDs in FETCH/GO | Measured: 4000 VIDs ≈ 187KB, executes fine. 200 VIDs ≈ 9KB, well within limits. |
