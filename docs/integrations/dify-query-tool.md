# Dify 接入 LightRAG Query 工具

目标：把 LightRAG 的 `POST /query` 暴露成 Dify `Custom Tool`。

## 1. 准备接口地址

默认 LightRAG API Server 地址是 `http://127.0.0.1:9621`。

如果你的服务地址不是这个值，先修改 `./dify-query-tool.openapi.json` 里的 `servers[0].url`。

## 2. 确认鉴权方式

这个工具定义默认走 `X-API-Key` 请求头，因为它最适合 Dify Custom Tool。

如果你的 LightRAG 部署只开放 JWT 登录，没有固定 API Key，建议在 Dify 和 LightRAG 之间加一个轻量代理，把固定密钥换成登录态，避免让 Dify 处理交互式登录。

## 3. 在 Dify 中导入

1. 进入 `Tools`
2. 新建 `Custom Tool`
3. 粘贴 `./dify-query-tool.openapi.json` 内容，或把这个文件托管成 URL 后让 Dify 读取
4. 配置凭据：
   - Header 名：`X-API-Key`
   - 值：你的 LightRAG API Key
5. 保存后，Dify 会生成 `queryLightRAG` 工具

## 4. 参数覆盖范围

当前 schema 已尽量覆盖 `QueryRequest` 的全部顶层参数，包括：

- 基础查询参数：`query`、`mode`、`response_type`
- 结果控制参数：`only_need_context`、`only_need_prompt`、`include_references`、`include_chunk_content`
- 检索控制参数：`top_k`、`chunk_top_k`、`enable_rerank`
- token 预算参数：`max_entity_tokens`、`max_relation_tokens`、`max_total_tokens`
- 关键词参数：`hl_keywords`、`ll_keywords`
- 上下文参数：`conversation_history`、`user_prompt`
- 高级模板参数：`prompt_overrides`
- 兼容保留参数：`stream`

其中 `prompt_overrides` 仍受 LightRAG 服务端能力开关控制；如果服务端没有允许通过 API 覆盖提示词，请不要在 Dify 中传这个字段。

## 5. 为什么不用整站 `/openapi.json`

LightRAG 现有服务已经提供 `/openapi.json`，但直接给 Dify 导入会把 `/documents`、`/graph`、`/query/raw` 等无关接口一起暴露成工具。

这个裁剪后的 schema 只保留 `/query`，更适合作为面向问答 Agent 的工具入口。
