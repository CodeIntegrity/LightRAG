# Custom KG Import Follow-up Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复自定义图谱导入剩余缺口，保证无 chunk 导入的一致性、`delete_by_doc_id` 可完整清理、接口变更有明确兼容边界。

**Architecture:** 当前 `ainsert_custom_kg` 已补齐 `doc_status/full_docs`、图锁、去重和入参校验，但文档级图索引仍未落库，且无 chunk 导入会留下“有 status 无 full_docs”的不一致状态。本计划只补这两个闭环，并同步更新接口文档与定向测试，避免继续扩大改动面。

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pytest, LightRAG storage abstractions (`BaseKVStorage` / `BaseDocStatusStorage` / `BaseGraphStorage` / `BaseVectorStorage`)

---

## 文件范围

- 修改：`lightrag/lightrag.py`
  - `ainsert_custom_kg()`：补 `full_entities/full_relations` 文档级索引；补无 chunk 导入时的 `full_docs` 一致性策略。
- 修改：`tests/test_batch_graph_operations.py`
  - 新增删除链路、chunkless 导入、一致性保护用例。
- 修改：`tests/test_graph_routes.py`
  - 只补接口契约断言，不扩路由行为范围。
- 修改：`examples/insert_custom_kg.py`
  - 让示例展示返回值和 `full_doc_id` 的新语义。
- 修改：`README.md`
  - 补 Python API 返回值变化。
- 修改：`docs/ProgramingWithCore.md`
  - 补 `insert_custom_kg()` / `ainsert_custom_kg()` 返回值和删除能力说明。

## 已知缺口

1. `full_docs` 仅在 `joined_content` 非空时写入。无 chunk 的 custom KG 导入会写 `doc_status`，但后续一致性检查使用 `full_docs.get_by_id(doc_id)` 判定文档是否存在，导致“仅实体/关系导入”后续会被视为不一致数据。
2. `full_entities` / `full_relations` 仍未由 `ainsert_custom_kg` 写入。`adelete_by_doc_id` 依赖这两份文档级索引分析受影响节点与边，不补这两份索引，删除只能删文档状态和 chunk，图谱与实体/关系向量会残留。
3. 外部接口行为已变更但文档未同步：
   - 路由层非法 payload 返回 `422`
   - `insert_custom_kg()` / `ainsert_custom_kg()` 返回汇总 dict
   - `track_id`、`chunk_count`、`entity_count`、`relationship_count` 成为正式返回字段

## 成功标准

- `ainsert_custom_kg()` 在以下三类输入下都不会制造一致性坏数据：
  - 只有 chunks
  - 只有 entities / relationships
  - chunks + entities + relationships 混合
- `adelete_by_doc_id(full_doc_id)` 能清掉该 custom KG 关联的：
  - `doc_status`
  - `full_docs`
  - `full_entities`
  - `full_relations`
  - text chunks / chunk vectors
  - graph nodes / edges（按剩余 chunk 引用重建后状态正确）
- 文档明确声明 Python API 和 HTTP API 的新返回契约。

---

### Task 1: 先写 chunkless 一致性失败测试

**Files:**
- Modify: `tests/test_batch_graph_operations.py`
- Test: `tests/test_batch_graph_operations.py`

- [ ] **Step 1: 写失败用例，固定“无 chunk 导入也必须有 full_docs 记录”**

```python
@pytest.mark.offline
@pytest.mark.asyncio
async def test_ainsert_custom_kg_chunkless_import_still_writes_full_docs():
    from lightrag import LightRAG

    with tempfile.TemporaryDirectory() as tmp:
        rag = LightRAG(
            working_dir=tmp,
            llm_model_func=AsyncMock(return_value=""),
            embedding_func=mock_embedding_func,
        )
        await rag.initialize_storages()

        graph = rag.chunk_entity_relation_graph
        graph.upsert_nodes_batch = AsyncMock()
        graph.has_nodes_batch = AsyncMock(return_value=set())
        graph.upsert_edges_batch = AsyncMock()
        rag.entities_vdb.upsert = AsyncMock()
        rag.relationships_vdb.upsert = AsyncMock()
        rag.relationships_vdb.delete = AsyncMock()

        result = await rag.ainsert_custom_kg(
            {
                "chunks": [],
                "entities": [
                    {
                        "entity_name": "EntityA",
                        "entity_type": "CONCEPT",
                        "description": "Entity only import",
                    }
                ],
                "relationships": [],
            }
        )

        full_doc = await rag.full_docs.get_by_id(result["full_doc_id"])
        assert full_doc is not None
        assert full_doc["file_path"] == "custom_kg"
        assert isinstance(full_doc["content"], str)
        assert full_doc["content"]

        await rag.finalize_storages()
```

- [ ] **Step 2: 运行单测，确认当前实现失败**

Run:

```bash
./scripts/test.sh tests/test_batch_graph_operations.py -k chunkless_import_still_writes_full_docs -v
```

Expected: FAIL，`full_doc` 为 `None`

- [ ] **Step 3: 在 `ainsert_custom_kg()` 补最小实现**

```python
if joined_content:
    full_doc_content = joined_content
else:
    full_doc_content = (
        f"Custom KG import\n"
        f"Entities: {len(entities_input)}\n"
        f"Relationships: {len(relationships_input)}"
    )

await self.full_docs.upsert(
    {
        full_doc_id_resolved: {
            "content": full_doc_content,
            "file_path": primary_file_path,
        }
    }
)
```

- [ ] **Step 4: 运行单测，确认通过**

Run:

```bash
./scripts/test.sh tests/test_batch_graph_operations.py -k chunkless_import_still_writes_full_docs -v
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lightrag/lightrag.py tests/test_batch_graph_operations.py
git commit -m "fix(graph): 补齐自定义图谱无chunk文档记录"
```

---

### Task 2: 为 custom KG 写入 `full_entities` / `full_relations`

**Files:**
- Modify: `lightrag/lightrag.py`
- Test: `tests/test_batch_graph_operations.py`

- [ ] **Step 1: 写失败用例，固定文档级图索引必须落库**

```python
@pytest.mark.offline
@pytest.mark.asyncio
async def test_ainsert_custom_kg_writes_full_entity_and_relation_indexes():
    from lightrag import LightRAG

    with tempfile.TemporaryDirectory() as tmp:
        rag = LightRAG(
            working_dir=tmp,
            llm_model_func=AsyncMock(return_value=""),
            embedding_func=mock_embedding_func,
        )
        await rag.initialize_storages()

        result = await rag.ainsert_custom_kg(
            {
                "chunks": [
                    {"content": "chunk text", "source_id": "s1", "chunk_order_index": 0}
                ],
                "entities": [
                    {"entity_name": "EntityA", "description": "A", "source_id": "s1"},
                    {"entity_name": "EntityB", "description": "B", "source_id": "s1"},
                ],
                "relationships": [
                    {
                        "src_id": "EntityA",
                        "tgt_id": "EntityB",
                        "description": "A to B",
                        "keywords": "link",
                        "source_id": "s1",
                    }
                ],
            }
        )

        full_entities = await rag.full_entities.get_by_id(result["full_doc_id"])
        full_relations = await rag.full_relations.get_by_id(result["full_doc_id"])

        assert full_entities == {
            "entity_names": ["EntityA", "EntityB"],
            "count": 2,
        }
        assert full_relations == {
            "relation_pairs": [["EntityA", "EntityB"]],
            "count": 1,
        }

        await rag.finalize_storages()
```

- [ ] **Step 2: 运行单测，确认当前实现失败**

Run:

```bash
./scripts/test.sh tests/test_batch_graph_operations.py -k writes_full_entity_and_relation_indexes -v
```

Expected: FAIL，`full_entities` / `full_relations` 为 `None`

- [ ] **Step 3: 在 `ainsert_custom_kg()` 写最小实现**

```python
full_entities_data = {
    full_doc_id_resolved: {
        "entity_names": [dp["entity_name"] for dp in all_entities_data],
        "count": len(all_entities_data),
    }
}

full_relations_data = {
    full_doc_id_resolved: {
        "relation_pairs": [
            [dp["src_id"], dp["tgt_id"]] for dp in all_relationships_data
        ],
        "count": len(all_relationships_data),
    }
}

storage_tasks: list[Awaitable[Any]] = []
if all_entities_data:
    storage_tasks.append(self.full_entities.upsert(full_entities_data))
if all_relationships_data:
    storage_tasks.append(self.full_relations.upsert(full_relations_data))
if storage_tasks:
    await asyncio.gather(*storage_tasks)
```

- [ ] **Step 4: 去重后再写索引，避免重复实体和关系**

```python
entity_names_for_doc = [dp["entity_name"] for dp in all_entities_data]
relation_pairs_for_doc = [[dp["src_id"], dp["tgt_id"]] for dp in all_relationships_data]
```

要求：
- 直接使用 `all_entities_data` 和 `all_relationships_data`
- 不单独扫描图数据库
- 保持与当前 custom KG 去重语义一致

- [ ] **Step 5: 运行单测，确认通过**

Run:

```bash
./scripts/test.sh tests/test_batch_graph_operations.py -k "writes_full_entity_and_relation_indexes or returns_dict_summary" -v
```

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add lightrag/lightrag.py tests/test_batch_graph_operations.py
git commit -m "fix(graph): 补齐自定义图谱文档级图索引"
```

---

### Task 3: 写删除链路回归测试

**Files:**
- Modify: `tests/test_batch_graph_operations.py`
- Test: `tests/test_batch_graph_operations.py`

- [ ] **Step 1: 新增端到端删除测试**

```python
@pytest.mark.offline
@pytest.mark.asyncio
async def test_adelete_by_doc_id_removes_custom_kg_graph_metadata():
    from lightrag import LightRAG

    with tempfile.TemporaryDirectory() as tmp:
        rag = LightRAG(
            working_dir=tmp,
            llm_model_func=AsyncMock(return_value=""),
            embedding_func=mock_embedding_func,
        )
        await rag.initialize_storages()

        result = await rag.ainsert_custom_kg(
            {
                "chunks": [
                    {"content": "chunk text", "source_id": "s1", "chunk_order_index": 0}
                ],
                "entities": [
                    {"entity_name": "EntityA", "description": "A", "source_id": "s1"},
                    {"entity_name": "EntityB", "description": "B", "source_id": "s1"},
                ],
                "relationships": [
                    {
                        "src_id": "EntityA",
                        "tgt_id": "EntityB",
                        "description": "A to B",
                        "keywords": "link",
                        "source_id": "s1",
                    }
                ],
            }
        )

        delete_result = await rag.adelete_by_doc_id(result["full_doc_id"])
        assert delete_result.status == "success"

        assert await rag.doc_status.get_by_id(result["full_doc_id"]) is None
        assert await rag.full_docs.get_by_id(result["full_doc_id"]) is None
        assert await rag.full_entities.get_by_id(result["full_doc_id"]) is None
        assert await rag.full_relations.get_by_id(result["full_doc_id"]) is None

        await rag.finalize_storages()
```

- [ ] **Step 2: 运行单测，确认当前实现失败**

Run:

```bash
./scripts/test.sh tests/test_batch_graph_operations.py -k removes_custom_kg_graph_metadata -v
```

Expected: FAIL，删除后 `full_entities` / `full_relations` 仍存在，或删除链路未正确分析受影响图元素

- [ ] **Step 3: 若失败点在删除链路，做最小修正**

优先修正顺序：

```python
# 先补 ainsert_custom_kg 的 full_entities/full_relations 写入
# 不扩展 adelete_by_doc_id 逻辑，除非测试证明已有删除逻辑仍无法消费 custom KG 写出的数据结构
```

- [ ] **Step 4: 运行关联回归**

Run:

```bash
./scripts/test.sh tests/test_batch_graph_operations.py -k "custom_kg and delete_by_doc_id" -v
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lightrag/lightrag.py tests/test_batch_graph_operations.py
git commit -m "fix(graph): 打通自定义图谱按文档删除链路"
```

---

### Task 4: 固定接口契约文档

**Files:**
- Modify: `README.md`
- Modify: `docs/ProgramingWithCore.md`
- Modify: `examples/insert_custom_kg.py`

- [ ] **Step 1: 更新 Python API 示例**

```python
result = rag.insert_custom_kg(custom_kg, full_doc_id="doc-custom-kg-1")
print(result["full_doc_id"])
print(result["track_id"])
print(result["chunk_count"])
```

- [ ] **Step 2: 在 `README.md` 明确返回值和删除语义**

文档内容必须包含：

```md
- `insert_custom_kg()` 返回 `dict`
- 返回字段：`full_doc_id` / `track_id` / `chunk_count` / `entity_count` / `relationship_count`
- 如需后续删除，建议显式传入 `full_doc_id`
```

- [ ] **Step 3: 在 `docs/ProgramingWithCore.md` 明确 HTTP 行为变化**

文档内容必须包含：

```md
- `POST /graph/import/custom-kg` 对缺字段或空字符串返回 `422`
- `full_doc_id` 为空白字符串时会被规范化为 `null`
- 成功响应会带 `track_id` 和计数字段
```

- [ ] **Step 4: 校验示例脚本可运行**

Run:

```bash
python3 -m py_compile examples/insert_custom_kg.py
```

Expected: 无输出

- [ ] **Step 5: 提交**

```bash
git add README.md docs/ProgramingWithCore.md examples/insert_custom_kg.py
git commit -m "docs(graph): 更新自定义图谱导入契约说明"
```

---

### Task 5: 最终验证

**Files:**
- Modify: `lightrag/lightrag.py`
- Modify: `tests/test_batch_graph_operations.py`
- Modify: `tests/test_graph_routes.py`
- Modify: `README.md`
- Modify: `docs/ProgramingWithCore.md`
- Modify: `examples/insert_custom_kg.py`

- [ ] **Step 1: 跑 custom KG 核心单测**

Run:

```bash
./scripts/test.sh tests/test_batch_graph_operations.py -k custom_kg -v
```

Expected: PASS

- [ ] **Step 2: 跑路由定向测试**

Run:

```bash
./scripts/test.sh tests/test_graph_routes.py -k custom_kg -v
```

Expected: PASS  
注意：若本地 `TestClient` 仍挂起，只记录为测试基础设施问题，不扩大本次代码修复范围。

- [ ] **Step 3: 跑 lint**

Run:

```bash
ruff check lightrag/lightrag.py tests/test_batch_graph_operations.py tests/test_graph_routes.py examples/insert_custom_kg.py
```

Expected: `All checks passed!`

- [ ] **Step 4: 汇总变更**

输出必须覆盖：

```text
1. 无 chunk 导入现在也会生成可回读 full_docs
2. custom KG 导入现在会写 full_entities/full_relations
3. delete_by_doc_id 可完整清理 custom KG 文档级图索引
4. 文档已同步 Python / HTTP 新契约
```

- [ ] **Step 5: 提交**

```bash
git add lightrag/lightrag.py tests/test_batch_graph_operations.py tests/test_graph_routes.py README.md docs/ProgramingWithCore.md examples/insert_custom_kg.py
git commit -m "fix(graph): 收口自定义图谱导入剩余兼容缺口"
```

---

## 自检

- 覆盖性：只覆盖审查后剩余缺口，不重复 `doc_status`、图锁、清洗、基础入参校验等已完成项。
- 无占位：所有任务都给出了明确文件、测试、命令和最小代码方向。
- 类型一致性：
  - `ainsert_custom_kg()` 继续返回 `dict[str, Any]`
  - `full_entities` 格式保持 `{"entity_names": [...], "count": N}`
  - `full_relations` 格式保持 `{"relation_pairs": [[src, tgt], ...], "count": N}`

## 风险说明

1. `full_entities/full_relations` 的写入内容必须与 `adelete_by_doc_id()` 现有消费格式完全一致，不能自定义字段名。
2. 无 chunk 的 `full_docs.content` 只要求“存在且可回读”，不要求可检索质量，避免在本次修复里引入新的摘要策略。
3. 路由测试若继续挂起，优先归因 `TestClient` / anyio 环境，不在本计划里顺手重构测试框架。

## 回滚策略

- 若 `full_entities/full_relations` 写入导致删除链路异常，先回滚该写入逻辑，不回滚 `doc_status/full_docs` 和路由校验。
- 若 chunkless `full_docs` 占位内容影响 UI 展示，再降级为更短的固定字符串，不取消写入。

Plan complete and saved to `.trellis/workspace/codex-agent/custom_kg_import_followup_fix_strategy.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
