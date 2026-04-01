# P2 API Extensions Design

## Goal

为 LightRAG 增加第二批对外 HTTP API：

- `POST /query/raw`
- `POST /graph/export`

这两个接口都基于已经存在的核心能力：

- `LightRAG.aquery_llm`
- `LightRAG.aexport_data`

本轮目标不是引入新的核心语义，而是把已有能力以稳定、可测试、可文档化的方式暴露给客户端。

## Scope

### In Scope

- 新增 `/query/raw`
- 新增 `/graph/export`
- 新增对应离线测试
- 更新 API 支持文档

### Out of Scope

- OpenAI `/v1/*` 兼容层
- `/query/llm` 别名路由
- 图导出前端页面
- 导出任务队列化或异步后台任务

## Approaches

### Approach A: `/query/raw` + `/graph/export`

直接按 `api-support-matrix.md` 的建议实现：

- `POST /query/raw` 暴露 `aquery_llm` 完整结果
- `POST /graph/export` 暴露 `aexport_data`

优点：

- 命名直接对应真实用途
- 与现有 `/query`、`/query/data`、`/graph/*` 风格一致
- 最小改动、最少歧义

缺点：

- `/query/raw` 需要明确“强制非流式”，否则 `response_iterator` 无法安全 JSON 化

### Approach B: `/query/llm` + `/graph/export`

把查询接口命名为 `/query/llm`。

优点：

- 能强调它返回 LLM 结果

缺点：

- 容易与上游模型绑定或 provider API 混淆
- 不如 `raw` 稳定，因为未来返回结构可能不仅限于 LLM 字段

### Approach C: 复用现有 `/query` 或 `/query/data`

通过新增参数让现有接口返回原始结果。

优点：

- 少一个路由

缺点：

- 会让现有接口语义继续膨胀
- 更难文档化和测试

## Decision

采用 Approach A。

原因：

- `api-support-matrix.md` 已把候选收敛为 `query/raw` 风格。
- `raw` 能表达“返回后端完整结构”，比 `llm` 更少歧义。
- `graph/export` 则是直接复用现有导出能力的自然入口。

## API Design

### 1. `POST /query/raw`

请求体复用现有 `QueryRequest`。

行为：

- 复用 prompt override 校验逻辑
- 强制 `stream=False`
- 调用 `rag.aquery_llm(...)`
- 原样返回后端结构

约束：

- 不允许以流式方式返回
- `llm_response.response_iterator` 在该接口中应始终为 `null`

返回结构示例：

```json
{
  "status": "success",
  "message": "ok",
  "data": {},
  "metadata": {},
  "llm_response": {
    "content": "echo:hello",
    "response_iterator": null,
    "is_streaming": false
  }
}
```

### 2. `POST /graph/export`

请求体新增轻量模型：

- `file_format`: `csv | excel | md | txt`
- `include_vector_data`: `bool = false`

行为：

- 服务端创建临时文件路径
- 调用 `rag.aexport_data(output_path, file_format, include_vector_data)`
- 以下载形式返回文件
- 响应结束后清理临时文件

返回形式：

- `FileResponse`
- `Content-Disposition` 包含下载文件名

## Error Handling

### `/query/raw`

- 输入校验失败：`422`
- prompt override 非法：沿用现有 `400/403`
- 其他异常：`500`

### `/graph/export`

- 文件格式非法：`422`
- `aexport_data` 抛 `ValueError`：`400`
- 其他异常：`500`

## Testing Strategy

### Query

新增离线测试文件，验证：

- `/query/raw` 返回完整结果结构
- `stream` 被强制置为 `False`

### Graph Export

扩展 `tests/test_graph_routes.py`，验证：

- `/graph/export` 能调用 `aexport_data`
- 导出格式和 `include_vector_data` 能正确透传
- 响应体返回生成文件内容

## Notes

- `graph/export` 本轮只做同步下载，不做后台导出任务。
- `query/raw` 本轮不额外新增 `/query/llm` 别名，避免接口冗余。
