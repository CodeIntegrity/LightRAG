# Plan: 为实体删除补全乐观并发控制

**目标**: 保留上游引入的 `revision_token` 乐观并发控制，为 `/graph/entity` 删除端点补充完整的 token 校验链路，与关系删除、实体编辑、实体合并保持一致。

## 背景

- 上游在 `utils_graph.py` 引入了 `revision_token`（基于 graph_data 的 SHA-256 hash）
- 实体编辑 (`/graph/entity/edit`) 和实体合并 (`/graph/entity/merge`) 已支持 `expected_revision_token`
- 关系删除 (`/graph/relation`) 已支持 `expected_revision_token`（本次已修复 `LightRAG.adelete_by_relation` 透传）
- 但实体删除缺少此机制：`GraphDeleteEntityRequest` 无该字段，`adelete_by_entity` 不接受该参数

## 修改清单

### 后端

#### 1. `lightrag/utils_graph.py:343-350` — `adelete_by_entity()` 加 token 校验

在 `entity_name` 参数后添加 `expected_revision_token: str | None = None`。

在确认实体存在后（`has_node` 检查通过后）、执行删除前，插入校验逻辑：
```python
if expected_revision_token:
    node_data = await chunk_entity_relation_graph.get_node(entity_name)
    _validate_expected_revision_token(
        current_payload=_build_entity_revision_payload(entity_name, node_data),
        expected_revision_token=expected_revision_token,
        object_type="entity",
    )
```

（`_build_entity_revision_payload` 和 `_validate_expected_revision_token` 已在模块内定义，无需新增）

#### 2. `lightrag/lightrag.py:4086-4102` — `LightRAG.adelete_by_entity()` 透传参数

添加 `expected_revision_token: str | None = None` 参数，透传至 `utils_graph.adelete_by_entity()`。

参照已有的 `adelete_by_relation` 模式：
```python
async def adelete_by_entity(
    self, entity_name: str, expected_revision_token: str | None = None
) -> DeletionResult:
    return await adelete_by_entity(
        self.chunk_entity_relation_graph,
        self.entities_vdb,
        self.relationships_vdb,
        entity_name,
        expected_revision_token=expected_revision_token,
    )
```

#### 3. `lightrag/api/routers/graph_routes.py:333-344` — `GraphDeleteEntityRequest` 加字段

添加 `expected_revision_token` 字段：
```python
class GraphDeleteEntityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entity_name: str = Field(..., min_length=1)
    expected_revision_token: Optional[str] = None  # 新增
```

#### 4. `lightrag/api/routers/graph_routes.py:808-813` — 路由处理函数透传

修改 `delete_graph_entity` 调用：
```python
raw_result = await rag.adelete_by_entity(
    entity_name=request.entity_name,
    expected_revision_token=request.expected_revision_token,
)
```

### 前端

#### 5. `lightrag_webui/src/api/lightrag.ts:884-895` — 还原 `expectedRevisionToken`

还原之前移除的 `expectedRevisionToken` 参数：
```typescript
export const deleteGraphEntity = async (
  entityName: string,
  expectedRevisionToken?: string
): Promise<GraphDeletionResponse> => {
  const response = await axiosInstance.delete('/graph/entity', {
    data: {
      entity_name: entityName,
      ...(expectedRevisionToken ? { expected_revision_token: expectedRevisionToken } : {})
    }
  })
  return response.data
}
```

#### 6. `lightrag_webui/src/components/graph/DeleteGraphObjectPanel.tsx:216` — 还原传参

还原：
```typescript
await deleteGraphEntity(entityName, selection.node.revision_token)
```

## 兼容性

- 所有新增参数均为 `None` 默认值，不传 token 时行为不变
- `_build_node_revision_token`（响应端）已在上一步修复中统一使用 `normalize_graph_node_data`，与校验端 `_build_entity_revision_payload` 一致
- 前端 `selection.node.revision_token` 来自 graph 响应（`graph_workbench.py:677-683`），与校验端 token 同源

## 验证

1. `ruff check lightrag/utils_graph.py lightrag/lightrag.py lightrag/api/routers/graph_routes.py` — 零问题
2. `uv run pytest tests/test_graph_routes.py -q -k "revision or delete"` — 全部通过
3. `cd lightrag_webui && bun run build` — 构建通过
