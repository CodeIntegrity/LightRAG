# 自定义图谱导入接口修复计划

接口：`POST /graph/import/custom-kg` → `LightRAG.ainsert_custom_kg`

涉及文件：
- [lightrag/api/routers/graph_routes.py](lightrag/api/routers/graph_routes.py) (Pydantic 模型 + 路由)
- [lightrag/lightrag.py](lightrag/lightrag.py) (`ainsert_custom_kg`, 行 2444-2693)

约束：所有改动必须保持与 JSON / NetworkX / Neo4j / Memgraph / PostgreSQL / MongoDB / Redis / Milvus / Qdrant / Faiss / OpenSearch 等后端的兼容性，仅使用各 `BaseKVStorage` / `BaseVectorStorage` / `BaseGraphStorage` / `BaseDocStatusStorage` 已有的抽象方法。

---

## 1. 现有问题清单

### P0 — 数据完整性 / 后端一致性

#### 1.1 `full_docs` 与 `doc_status` 完全未写入
- **现象**：常规入库走 `apipeline_enqueue_documents` → `full_docs.upsert` + `doc_status.upsert(PENDING→PROCESSING→PROCESSED)` ([lightrag/lightrag.py:1582-1594](lightrag/lightrag.py#L1582-L1594), [lightrag/lightrag.py:2226-2229](lightrag/lightrag.py#L2226-L2229))；`ainsert_custom_kg` 只写 `chunks_vdb` / `text_chunks` / 图存储 / 实体关系 vdb，从不写 `full_docs` 或 `doc_status`。
- **影响**：
  - WebUI 文档列表看不到导入的图谱，所有依赖 `doc_status` 的页面（Documents、统计、清理）失效。
  - `request.full_doc_id` 参数被接受但只塞进了 chunk 的 `full_doc_id` 字段，没有任何文档级元数据。
  - 后续 `adelete_by_doc_id` 无法找到该文档 → 自定义图谱无法清理。
  - 重复导入相同内容时缺少 `track_id`、状态历史。

#### 1.2 缺少 `graph_db_lock` 串行化
- **现象**：[utils_graph.py:366/469/906/1087/1277/1396/1940](lightrag/utils_graph.py) 所有图变更（创建/更新/合并/删除实体关系）都通过 `get_storage_keyed_lock(namespace="graph_db_lock", ...)` 串行；`ainsert_custom_kg` 全程未加锁。
- **影响**：
  - 与 `apipeline_process_*` 的 `merge_nodes_and_edges`、`utils_graph` 的 CRUD 并发执行时，同一节点 `upsert_nodes_batch` 与 `upsert_node` 交叉，可能在 Neo4j/PostgreSQL/Memgraph 的事务边界内出现读后写不一致或唯一约束冲突。
  - vdb 与图存储双写不再原子。

#### 1.3 `doc_status.chunks_list` 未填充 → 删除链路断裂
- **现象**：常规链路在 `doc_status` 中保存 `chunks_list`（chunk id 数组），删除文档时按列表清理 ([lightrag/lightrag.py:954](lightrag/lightrag.py#L954))；自定义导入未写入 → 删除时找不到 chunk → 残留向量。
- **影响**：所有后端删除接口失效（特别是 Postgres / Mongo / OpenSearch / Qdrant，这些后端依赖 `chunks_list` 做精确删除）。

### P1 — 数据正确性

#### 1.4 `chunk_to_source_map` 在重复 `source_id` 上发生覆盖
- **位置**：[lightrag/lightrag.py:2483](lightrag/lightrag.py#L2483) `chunk_to_source_map[source_id] = chunk_id`
- **问题**：用户载荷允许多个 chunk 共享同一 `source_id`（例如同一段落多条切片），后导入的 chunk 会覆盖前一条；同时 `chunks_vdb` 用 `compute_mdhash_id(content)` 作为 key，相同内容也会相互覆盖。后续实体/关系按 `source_id` 反查 chunk_id 时拿到的并非自己的来源。

#### 1.5 缺失字段抛 `KeyError` → HTTP 500
- **位置**：`chunk_data["content"]`、`entity_data["entity_name"]`、`relationship_data["src_id"]/["tgt_id"]`
- **问题**：路由层 `custom_kg: Dict[str, Any]` 完全裸用，缺字段时抛 `KeyError` 走到 500，未走 `ValueError → 400` 分支；用户也不知道哪个字段缺失。

#### 1.6 占位节点继承"当前关系"的 `source_id` / `file_path`
- **位置**：[lightrag/lightrag.py:2585-2601](lightrag/lightrag.py#L2585-L2601)
- **问题**：在关系循环中为缺失端点构造占位节点时，`source_id` / `file_path` 取自当前迭代的关系；如果同一节点出现在多条关系中，只有第一条的来源被记录，且与节点真实归属无关。

#### 1.7 `edge_list` 与 `all_relationships_data` 端点排序不一致
- **位置**：[lightrag/lightrag.py:2604-2622](lightrag/lightrag.py#L2604-L2622)
- **问题**：
  - `edge_list` 用原始 `(src_id, tgt_id)` 调用 `upsert_edges_batch`
  - `all_relationships_data` 使用 `sorted` 后的 `normalized_src_id/normalized_tgt_id`
  - vdb id 由 `compute_mdhash_id(dp["src_id"]+dp["tgt_id"])` 生成
  - 后果：vdb 行的 `src_id/tgt_id` 与图边的方向不一致；对于按方向存储的后端（部分 OpenSearch / Memgraph 配置），同一逻辑边会被存成两条不同方向的边。

### P2 — 健壮性 / 体验

#### 1.8 实体描述、关系描述未做 `sanitize_text_for_encoding`
- 仅 chunk content 做了清洗 ([lightrag/lightrag.py:2460](lightrag/lightrag.py#L2460))；含代理对 / NULL 字符的实体描述会让 PostgreSQL `text`、MongoDB BSON、OpenSearch JSON 报错。

#### 1.9 失败回滚缺失
- chunks_vdb 已写入但图存储 batch 失败时，已写入的 chunk 无法回滚；与常规链路一致，但自定义导入是用户主动一次性提交，应至少保证幂等可重入（参见 §2.6）。

#### 1.10 响应字段不准
- `entity_count` / `relationship_count` 直接返回 `len(custom_kg.get("entities", []))`，不反映去重 / 占位节点 / 实际写入数量。

#### 1.11 `track_id` 缺失
- 用户无法通过 `/documents/track_status/{track_id}` 查询导入进度（虽然自定义导入是同步的，但保持 UI 一致性需要返回 `track_id`）。

---

## 2. 修复方案（按优先级排序）

### 2.1 写 `full_docs` 与 `doc_status` 元数据【P0】
**目标**：让自定义导入与常规导入在文档维度等价可见。

**改动点**：`ainsert_custom_kg` 入口新增文档级处理逻辑：

1. 计算 / 接受 `full_doc_id`：
   - 若用户传入 `full_doc_id`，校验非空字符串。
   - 若未传入，按常规链路 `compute_mdhash_id(joined_content, prefix="doc-")` 生成（拼接所有 chunk content）。
2. 在 chunk 写入之前：
   - `full_docs.upsert({full_doc_id: {"content": joined_content_or_summary, "file_path": file_path}})`
   - `doc_status.upsert({full_doc_id: {"status": DocStatus.PROCESSING, "chunks_count": -1, "content_summary": summary, "content_length": ..., "created_at": iso, "updated_at": iso, "file_path": file_path, "track_id": track_id}})`
3. chunk / 实体 / 关系全部成功后：
   - `doc_status.upsert({full_doc_id: {"status": DocStatus.PROCESSED, "chunks_count": len(chunks), "chunks_list": list(all_chunks_data.keys()), "updated_at": iso}})`
4. 异常时：
   - `doc_status.upsert({full_doc_id: {"status": DocStatus.FAILED, "error_msg": str(e)}})`

**兼容性**：`full_docs` (`BaseKVStorage`) 与 `doc_status` (`BaseDocStatusStorage`) 的 `upsert` 接口在所有后端实现一致；字段集合与 [lightrag/lightrag.py:1582-1594](lightrag/lightrag.py#L1582-L1594) 的常规链路完全对齐，已有所有 schema/索引覆盖。**不引入新字段、不改抽象基类**。

**chunk 关联**：每个 chunk 的 `full_doc_id` 字段已写入 ([lightrag/lightrag.py:2476-2478](lightrag/lightrag.py#L2476-L2478))；只需把 fallback 从 `source_id` 改为新生成的 `full_doc_id`，同时把 chunk_id 加入 `chunks_list`。

### 2.2 加 `graph_db_lock` 串行化【P0】
在图变更阶段（`upsert_nodes_batch` + `upsert_edges_batch` + 实体关系 vdb upsert）外层包裹：

```python
async with get_storage_keyed_lock(
    [self.workspace, "graph_db"],
    namespace="graph_db_lock",
    enable_logging=False,
):
    # upsert_nodes_batch / upsert_edges_batch / vdb upsert
```

**兼容性**：与 [utils_graph.py:366](lightrag/utils_graph.py#L366) 等位置使用完全相同的 lock 命名空间和 keys，不变更 `KeyedUnifiedLock`。chunk vdb / full_docs / doc_status 的写入按现有 pipeline 顺序保持在锁外（与常规链路一致）。

### 2.3 修复 `chunk_to_source_map` 冲突【P1】
- 数据结构改为 `dict[str, list[str]]`；entity / relation 反查时取第一条（或全部 join 入 `source_id` 字段，与 `_merge_nodes_then_upsert` 的 `GRAPH_FIELD_SEP` 拼接习惯一致）。
- chunk vdb key 仍按 `compute_mdhash_id(content)`：若两条 chunk 内容相同（哈希冲突），日志 warning 并合并为一条，保留两个 `source_id` 的映射指向同一 chunk_id。

**兼容性**：纯 Python 内存逻辑，不影响存储后端。

### 2.4 路由层入参严校验【P1】
在 `CustomKGImportRequest` 增加结构化模型：

```python
class CustomKGChunk(BaseModel):
    content: str = Field(..., min_length=1)
    source_id: str = Field(..., min_length=1)
    file_path: Optional[str] = None
    chunk_order_index: Optional[int] = Field(default=None, ge=0)

class CustomKGEntity(BaseModel):
    entity_name: str = Field(..., min_length=1)
    entity_type: Optional[str] = None
    description: Optional[str] = None
    source_id: Optional[str] = None
    file_path: Optional[str] = None
    custom_properties: Dict[str, Any] = Field(default_factory=dict)

class CustomKGRelation(BaseModel):
    src_id: str = Field(..., min_length=1)
    tgt_id: str = Field(..., min_length=1)
    description: Optional[str] = None
    keywords: Optional[str] = None
    weight: float = 1.0
    source_id: Optional[str] = None
    file_path: Optional[str] = None
    custom_properties: Dict[str, Any] = Field(default_factory=dict)

class CustomKGPayload(BaseModel):
    chunks: List[CustomKGChunk] = Field(default_factory=list)
    entities: List[CustomKGEntity] = Field(default_factory=list)
    relationships: List[CustomKGRelation] = Field(default_factory=list)

class CustomKGImportRequest(BaseModel):
    custom_kg: CustomKGPayload
    full_doc_id: Optional[str] = None
```

- Pydantic 校验失败 → 422 自动返回。
- 路由层把 `request.custom_kg.model_dump()` 传给 `ainsert_custom_kg`，保持向后兼容（核心方法继续接受 `dict`）。
- 增加非空检查：`chunks` / `entities` / `relationships` 至少一个非空，否则 400。

**兼容性**：仅 API 层增强；`ainsert_custom_kg(custom_kg: dict)` 签名不变，第三方直接调用核心方法的代码不受影响。

### 2.5 占位节点 source_id 复合化【P1】
- 在第一遍循环里收集 `endpoint_to_sources: dict[str, set[str]]`；构造占位节点时用 `GRAPH_FIELD_SEP.join(sorted(sources))` 作为 `source_id`，与 `_merge_nodes_then_upsert` 行为一致。
- 当端点被显式声明为实体时（在 `entity_nodes` 中），跳过占位（已存在）。

### 2.6 边端点排序统一【P1】
- 选定一种规范：**保留用户原始方向**写入图边（保持有向后端语义），但 vdb id 与 `all_relationships_data.src_id/tgt_id` 都用 `sorted` 后的端点，确保去重一致。
- 修复方法：
  ```python
  edge_list.append((src_id, tgt_id, edge_data))     # 保留原方向
  ...
  all_relationships_data.append({
      "src_id": normalized_src_id,                    # 排序后用于 vdb
      "tgt_id": normalized_tgt_id,
      ...
  })
  ```
  当前代码已部分如此，问题在于 `make_relation_vdb_ids(dp["src_id"], dp["tgt_id"])` 接到的是已排序端点 → 与 `_merge_edges_then_upsert` 中的调用方式一致即可，无需改动；需补齐文档/单元测试断言。

### 2.7 全字段 `sanitize_text_for_encoding`【P2】
对实体的 `name` / `description`、关系的 `description` / `keywords` / `custom_properties`（深度遍历字符串值）统一做清洗。封装一个 `_sanitize_metadata` 小函数，在归一化后调用。

**兼容性**：`sanitize_text_for_encoding` 是纯字符串清理，不改变语义；规避 PostgreSQL bytea / Mongo BSON / OpenSearch UTF-8 解析问题。

### 2.8 失败时 `doc_status` 标 FAILED + 已写入 chunk 的清理策略【P2】
- 异常进入 `except`：调用 `doc_status.upsert({full_doc_id: {"status": FAILED, "error_msg": ...}})`。
- 不强制回滚已写 chunk_vdb（与常规 pipeline 行为一致，避免跨后端事务），通过 `chunks_list` 让用户调用 `delete_by_doc_id` 清理。

### 2.9 响应字段精确化 + 返回 track_id【P2】
```python
class GraphImportResponse(BaseModel):
    status: Literal["success"]
    message: str
    full_doc_id: str
    track_id: str
    chunk_count: int        # 实际写入条数（去重后）
    entity_count: int       # 实际写入实体数（去重 + 占位）
    relationship_count: int # 实际写入关系数（去重）
```
- `ainsert_custom_kg` 返回一个 dataclass / dict（含上述字段），路由层透传。

### 2.10 文档与测试

- 更新 [examples/insert_custom_kg.py](examples/insert_custom_kg.py)：演示 `full_doc_id` 与新返回结构。
- 新增 / 扩展测试：
  - [tests/test_graph_routes.py](tests/test_graph_routes.py)：缺字段返回 422、空 payload 返回 400、成功返回新字段。
  - [tests/test_batch_graph_operations.py](tests/test_batch_graph_operations.py)：自定义导入后 `aget_docs_by_status(PROCESSED)` 能查到、`adelete_by_doc_id` 能完整清理（含 chunks_list、实体、关系、vdb）。
  - 新增并发测试：`asyncio.gather(ainsert_custom_kg(...), apipeline_process_enqueue_documents(...))` 不抛异常、最终图状态一致。
  - 在 JSON / NetworkX 后端跑 unit 套件；Postgres / Neo4j 跑 `--run-integration`，确认 `chunks_list` 字段写入。

---

## 3. 改动文件清单与顺序

| 顺序 | 文件                                   | 类型     | 说明                                                                                                                                                     |
| ---- | -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `lightrag/lightrag.py`                 | refactor | `ainsert_custom_kg` 重构：full_doc_id 生成 / full_docs+doc_status 写入 / graph_db_lock / chunks_list / 占位节点 source 修正 / sanitize 扩展 / 返回值结构 |
| 2    | `lightrag/api/routers/graph_routes.py` | API      | Pydantic 严校验、新响应模型、track_id 透传                                                                                                               |
| 3    | `examples/insert_custom_kg.py`         | docs     | 同步示例                                                                                                                                                 |
| 4    | `tests/test_graph_routes.py`           | test     | 路由层用例                                                                                                                                               |
| 5    | `tests/test_batch_graph_operations.py` | test     | end-to-end 用例（含可见性、删除、并发）                                                                                                                  |

每一步 commit 后执行：

```bash
ruff check .
python -m pytest tests -k "custom_kg or graph_routes or batch_graph"
# 集成（如有 Postgres / Neo4j 环境）
LIGHTRAG_RUN_INTEGRATION=true python -m pytest tests --run-integration -k "custom_kg"
```

---

## 4. 兼容性自检清单（合入前必过）

- [ ] `ainsert_custom_kg(dict)` 签名向后兼容（dict 入参，关键字段沿用旧名）。
- [ ] 不在 `BaseKVStorage` / `BaseVectorStorage` / `BaseGraphStorage` / `BaseDocStatusStorage` 中新增抽象方法。
- [ ] 不修改任何 `kg/*_impl.py` 后端实现。
- [ ] 不变更 chunk / 实体 / 关系 vdb 的 id 生成规则（`compute_mdhash_id` 前缀、`make_relation_vdb_ids` 排序行为）。
- [ ] `full_docs` / `doc_status` 写入字段集合与 [lightrag/lightrag.py:1582-1594](lightrag/lightrag.py#L1582-L1594) 完全对齐。
- [ ] `graph_db_lock` 命名空间与 [utils_graph.py](lightrag/utils_graph.py) 的现有用法一致。
- [ ] `DocStatus` 取值仅使用现有枚举（PROCESSING / PROCESSED / FAILED）。
- [ ] 路由变更只在 graph_routes 内，不影响 Ollama-compatible API。

---

## 5. 风险与回滚

- **风险**：自定义导入开始写 `doc_status` 后，已有数据库中由旧版导入产生的图谱仍无对应 doc_status 行 → WebUI 文档列表不会显示历史导入。需要文档说明：可选地提供一次性迁移脚本扫描 `chunks_vdb` 中 `full_doc_id` 字段不在 `doc_status` 的 chunk，回填 PROCESSED 行。
- **回滚**：所有改动集中在 `ainsert_custom_kg` 与路由层；如出现问题可单 commit 回滚，不会污染存储 schema。
