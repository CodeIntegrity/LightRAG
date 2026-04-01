# P1 API Extensions Design

## Goal

为 LightRAG 补齐第一批高价值但当前未暴露的 HTTP API，使现有核心能力可以直接被 WebUI、自动化脚本或外部系统调用，而不需要绕过服务层直接访问 `LightRAG` 实例。

本轮范围限定为 5 个接口：

- `POST /documents/import/custom-chunks`
- `POST /documents/by-ids`
- `POST /graph/import/custom-kg`
- `GET /graph/entity/detail`
- `GET /graph/relation/detail`

不包含：

- OpenAI `/v1/*` 协议兼容层
- `/graph/export`
- 新的前端页面或 UI 交互
- 对核心 `LightRAG` 语义的重构

## Recommended Approach

### Approach A: 直接在现有 document / graph 路由模块中增量扩展

在 `lightrag/api/routers/document_routes.py` 中新增 2 个文档类接口，在 `lightrag/api/routers/graph_routes.py` 中新增 3 个图谱类接口，尽量复用现有：

- 鉴权依赖
- Pydantic 请求/响应模型
- `DocStatusResponse` 序列化逻辑
- 图谱路由里的错误映射与输入校验模式

优点：

- 改动面小，挂载方式不变
- 与现有接口分组一致，用户易发现
- 现有测试夹具可直接复用

缺点：

- `document_routes.py` 已经很长，本轮继续扩展会加重体量

### Approach B: 新建独立扩展路由模块

为新增接口单独创建例如 `import_routes.py`、`detail_routes.py`。

优点：

- 模块职责更清晰

缺点：

- 会引入额外挂载与维护成本
- 对这轮仅 5 个接口来说拆分过度

### Approach C: 复用 `/query` 或 `/graphs` 做多态扩展

通过给现有接口增加更多 mode 或 query 参数实现相同行为。

优点：

- 路由数量最少

缺点：

- 语义混乱
- 文档与客户端调用复杂度更高

## Decision

采用 Approach A。

原因：

- 与现有 REST 分组最一致。
- 能以最小改动复用当前测试模式。
- 本轮目标是“把已存在核心能力暴露成 API”，不是重构路由层。

## API Design

### 1. `POST /documents/import/custom-chunks`

请求体包含：

- `full_text`
- `text_chunks`
- `doc_id` 可选

行为：

- 直接调用 `LightRAG.ainsert_custom_chunks(...)`
- 成功后返回 `{"status": "success", "message": "...", "doc_id": ...}`
- 不引入后台任务与 `track_id`

### 2. `POST /documents/by-ids`

请求体包含：

- `doc_ids: list[str]`

行为：

- 调用 `LightRAG.aget_docs_by_ids(...)`
- 复用 `DocStatusResponse` 做单文档序列化
- 返回 `{"documents": [...], "found_count": N, "requested_count": M}`

### 3. `POST /graph/import/custom-kg`

请求体包含：

- `custom_kg`
- `full_doc_id` 可选

行为：

- 直接调用 `LightRAG.ainsert_custom_kg(...)`
- 成功后返回 `{"status": "success", "message": "..."}`

### 4. `GET /graph/entity/detail`

查询参数：

- `entity_name`
- `include_vector_data` 可选，默认 `false`

行为：

- 调用 `LightRAG.get_entity_info(...)`
- 若核心层抛 `ValueError`，映射成 `400`
- 若返回空或抛出“not found”类错误，映射成 `404`

### 5. `GET /graph/relation/detail`

查询参数：

- `source_entity`
- `target_entity`
- `include_vector_data` 可选，默认 `false`

行为：

- 调用 `LightRAG.get_relation_info(...)`
- 错误映射策略与实体详情一致

## Error Handling

- 输入为空或仅空白：由 Pydantic / validator 返回 `422` 或 `400`
- `ValueError`：优先映射为 `400`
- 明确 not found 语义：映射为 `404`
- 未预期异常：统一记录日志并返回 `500`

## Testing Strategy

新增测试优先走离线路径：

- 在 `tests/test_graph_routes.py` 中扩展 `_DummyRAG`
- 为实体详情、关系详情、自定义 KG 导入补测试
- 新增 `tests/test_document_additional_routes.py`
  - 自定义 chunk 导入成功
  - `documents/by-ids` 返回序列化结果

测试顺序遵循 TDD：

1. 先写失败测试
2. 确认按预期失败
3. 做最小实现
4. 运行相关测试直到通过

## Out of Scope Follow-up

完成本轮后可继续评估：

- `POST /graph/export`
- OpenAI `/v1/*` 协议兼容
- 将 `document_routes.py` 拆分减重
