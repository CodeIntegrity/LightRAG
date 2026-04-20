# Expand API Docs For Documents And Query

## Goal
扩展公开 API 文档，补齐每个已暴露接口的用途、参数说明、返回结构、错误语义和可直接运行的请求示例。

## Requirements
- 以现有路由实现为准，不写不存在的接口
- 文档覆盖 documents、query、graph、prompt-config、workspaces、ollama `/api/*`
- 对 documents 和 query 提供更细的参数说明与示例
- 修正主 README 中失效的 API 文档入口链接
- 中英文文档保持一致

## Acceptance Criteria
- [x] `docs/LightRAG-API-Server.md` 增加结构化 API Reference
- [x] `docs/LightRAG-API-Server-zh.md` 增加对应中文 API Reference
- [x] `README.md` 中 API 文档链接改为有效路径
- [x] `README-zh.md` 中 API 文档链接改为有效路径
- [x] 文档明确说明鉴权、workspace、流式与非流式差异

## Technical Notes
- 主手册路径使用 `docs/LightRAG-API-Server*.md`
- 事实来源以 `lightrag/api/routers/*.py` 与现有测试为准
