# P2 API Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LightRAG 增加 `POST /query/raw` 和 `POST /graph/export` 两个 P2 HTTP API。

**Architecture:** 在现有 `query_routes.py` 与 `graph_routes.py` 上增量扩展。`/query/raw` 复用 `QueryRequest` 和 `aquery_llm`，强制非流式；`/graph/export` 复用 `aexport_data`，通过临时文件返回下载响应。

**Tech Stack:** FastAPI, Pydantic, pytest, TestClient, tempfile, FileResponse

---

### Task 1: 增加 `/query/raw` 失败测试

**Files:**
- Create: `tests/test_query_raw_route.py`
- Modify: `lightrag/api/routers/query_routes.py`

- [ ] **Step 1: 写失败测试，验证 `/query/raw` 返回完整结构**
- [ ] **Step 2: 写失败测试，验证该接口会强制 `stream=False`**
- [ ] **Step 3: 运行 `./scripts/test.sh tests/test_query_raw_route.py -q`，确认因路由缺失而失败**

### Task 2: 增加 `/graph/export` 失败测试

**Files:**
- Modify: `tests/test_graph_routes.py`
- Modify: `lightrag/api/routers/graph_routes.py`

- [ ] **Step 1: 扩展 `_DummyRAG`，增加 `aexport_data` stub 与调用记录**
- [ ] **Step 2: 写失败测试，验证 `/graph/export` 会生成下载响应并透传参数**
- [ ] **Step 3: 运行 `./scripts/test.sh tests/test_graph_routes.py -q`，确认新增用例因路由缺失而失败**

### Task 3: 实现 `/query/raw`

**Files:**
- Modify: `lightrag/api/routers/query_routes.py`

- [ ] **Step 1: 增加 `QueryRawResponse` 模型**
- [ ] **Step 2: 实现 `POST /query/raw`，复用现有校验逻辑并强制 `stream=False`**
- [ ] **Step 3: 运行 `./scripts/test.sh tests/test_query_raw_route.py -q`，确认通过**

### Task 4: 实现 `/graph/export`

**Files:**
- Modify: `lightrag/api/routers/graph_routes.py`

- [ ] **Step 1: 增加导出请求模型**
- [ ] **Step 2: 实现 `POST /graph/export`，临时写文件并返回 `FileResponse`**
- [ ] **Step 3: 添加响应后的临时文件清理**
- [ ] **Step 4: 运行 `./scripts/test.sh tests/test_graph_routes.py -q`，确认通过**

### Task 5: 回归验证与文档同步

**Files:**
- Modify: `docs/api-support-matrix.md`

- [ ] **Step 1: 运行 `./scripts/test.sh tests/test_query_raw_route.py tests/test_graph_routes.py -q`**
- [ ] **Step 2: 如有必要，再补一轮轻量回归到相关查询测试**
- [ ] **Step 3: 更新 `docs/api-support-matrix.md` 中 P2 状态**
