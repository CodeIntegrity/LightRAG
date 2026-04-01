# P1 API Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LightRAG 增加 5 个 P1 HTTP API，暴露现有的 custom chunk import、custom KG import、按文档 ID 批量查询、实体详情查询和关系详情查询能力。

**Architecture:** 在现有 `document_routes.py` 与 `graph_routes.py` 上增量扩展接口，不新增独立路由模块，不改变服务挂载方式。文档类接口复用 `DocStatusResponse` 及现有输入验证模式；图谱类接口复用现有 `ValueError -> HTTPException` 映射模式。

**Tech Stack:** FastAPI, Pydantic, pytest, TestClient, LightRAG core methods

---

### Task 1: 增加文档路由失败测试

**Files:**
- Modify: `tests/test_document_additional_routes.py`
- Reference: `tests/test_document_rebuild_route.py`

- [ ] **Step 1: 写失败测试，覆盖 `POST /documents/import/custom-chunks` 成功路径**

- [ ] **Step 2: 运行 `pytest tests/test_document_additional_routes.py -q`，确认缺少路由而失败**

- [ ] **Step 3: 写失败测试，覆盖 `POST /documents/by-ids` 的成功序列化路径**

- [ ] **Step 4: 再次运行 `pytest tests/test_document_additional_routes.py -q`，确认仍然失败**

### Task 2: 增加图谱路由失败测试

**Files:**
- Modify: `tests/test_graph_routes.py`

- [ ] **Step 1: 扩展 `_DummyRAG`，为 custom KG import、entity detail、relation detail 预留记录字段和 stub 方法**

- [ ] **Step 2: 写失败测试，覆盖 `POST /graph/import/custom-kg` 成功路径**

- [ ] **Step 3: 写失败测试，覆盖 `GET /graph/entity/detail` 成功路径**

- [ ] **Step 4: 写失败测试，覆盖 `GET /graph/relation/detail` 成功路径**

- [ ] **Step 5: 运行 `pytest tests/test_graph_routes.py -q`，确认新增用例按“路由不存在/实现缺失”失败**

### Task 3: 实现文档新增接口

**Files:**
- Modify: `lightrag/api/routers/document_routes.py`

- [ ] **Step 1: 增加 `CustomChunksImportRequest`、`CustomChunksImportResponse`、`DocumentsByIdsRequest`、`DocumentsByIdsResponse` 模型**

- [ ] **Step 2: 实现 `POST /documents/import/custom-chunks`，直接调用 `current_rag.ainsert_custom_chunks(...)`**

- [ ] **Step 3: 实现 `POST /documents/by-ids`，调用 `current_rag.aget_docs_by_ids(...)` 并复用 `DocStatusResponse` 组装响应**

- [ ] **Step 4: 运行 `pytest tests/test_document_additional_routes.py -q`，确认通过**

### Task 4: 实现图谱新增接口

**Files:**
- Modify: `lightrag/api/routers/graph_routes.py`

- [ ] **Step 1: 增加 `CustomKGImportRequest` 与必要的 query 参数校验**

- [ ] **Step 2: 实现 `POST /graph/import/custom-kg`，调用 `rag.ainsert_custom_kg(...)`**

- [ ] **Step 3: 实现 `GET /graph/entity/detail`，调用 `rag.get_entity_info(...)`**

- [ ] **Step 4: 实现 `GET /graph/relation/detail`，调用 `rag.get_relation_info(...)`**

- [ ] **Step 5: 对 `ValueError` / not found 场景做 HTTP 状态码映射**

- [ ] **Step 6: 运行 `pytest tests/test_graph_routes.py -q`，确认通过**

### Task 5: 回归验证

**Files:**
- Reference: `tests/test_document_rebuild_route.py`
- Reference: `tests/test_document_routes_workspace_runtime.py`

- [ ] **Step 1: 运行 `pytest tests/test_document_additional_routes.py tests/test_graph_routes.py tests/test_document_rebuild_route.py tests/test_document_routes_workspace_runtime.py -q`**

- [ ] **Step 2: 如有回归失败，修正最小代码并重跑相同命令**

- [ ] **Step 3: 记录未运行的更大范围验证项，不宣称全量通过**
