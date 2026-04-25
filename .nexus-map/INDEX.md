> generated_by: nexus-mapper v2
> verified_at: 2026-04-25
> provenance: AST-backed for Python/JavaScript/TypeScript/TSX/Bash. The extractor now supports the current `tree-sitter-language-pack` runtime API; Bash remains module-only coverage, and WebUI internal `@/...` alias edges still need人工补证。

# LightRAG 知识库索引

LightRAG 当前仍是一个“核心运行时 + 多后端存储 + FastAPI 服务 + React WebUI + 交互式配置向导 + workspace 级 prompt 版本管理”的复合仓库；这次知识库更新基于 2026-04-25 的文件树、现有系统边界和最近 30 天 Git 历史。

## 一眼看懂

- 主运行时仍由 `lightrag/lightrag.py` 中的 `LightRAG` 驱动，并继续通过 `PromptVersionStore` 把 `indexing` / `retrieval` 两组激活版本注入 `active_prompt_groups`。
- 服务主入口仍是 `lightrag/api/lightrag_server.py`，并继续挂接 document / query / graph / workspace / prompt-config 路由。
- `lightrag/kg/` 仍是四类存储契约的实现中心；最近 30 天热点改成以 PostgreSQL 和 API/WebUI 契约演进更显著。
- `lightrag_webui/src/` 仍承载文档、图谱、检索、workspace 与 prompt 管理主界面；最近 30 天最活跃文件是 `src/api/lightrag.ts` 与中英文本地化文件。
- 最近 30 天的第一热点已从 setup 主脚本转为 `lightrag/kg/postgres_impl.py`，说明变更重心已经偏到存储和前后端交付面。

## 关键事实

- prompt 版本管理仍是 workspace 级持久化能力：核心定义在 `lightrag/prompt.py`、`lightrag/prompt_versions.py`、`lightrag/prompt_version_store.py`，运行时在 `lightrag/operate.py` 先应用激活 retrieval 版本，再允许单次请求 `prompt_overrides` 覆盖它。
- `lightrag/api/lightrag_server.py` 仍位于最近 30 天中风险热点榜，且与 `workspace_routes.py` 保持显著耦合。
- `tests/` 与 `lightrag_webui/src/*.test.*` 仍是主要回归保护面；最近 Git 耦合里新增了 `WorkspaceManagerDialog.tsx` 与其测试文件的强绑定。
- API 启动面仍需分清两层：`lightrag-server` 直接走 `lightrag_server.py`，`lightrag-gunicorn` 通过 `run_with_gunicorn.py` 复用同一应用工厂。

## 测试面速览

- `tests/` 当前静态可见 60 个模块，覆盖核心运行时、prompt 版本、workspace/runtime、document rebuild、存储后端与 setup 向导。
- `lightrag_webui/src/` 当前静态可见 18 个前端测试文件，已覆盖 `PromptManagement`、`WorkspaceManagerDialog`、`LoginPage`、`lightrag.ts` API client、graph workbench store 与多个 prompt / graph util。
- 当前知识库只做静态测试面分析，未执行 `pytest`、`./scripts/test.sh` 或 `bun test` 作为知识库生成的一部分。

## 证据缺口

- 本次 AST 已重建成功：`parse_errors=0`，当前仍因 `--max-nodes` 截断保留 Module/Class 优先视图，`truncated_nodes=12747`。
- Bash 只有 Module 级覆盖，所以 `scripts/setup/` 的依赖关系仍主要来自 `Makefile`、文档与 Git 耦合，而非细粒度 AST 边。
- WebUI 使用 `@/` 别名导入，即使 AST 兼容问题修复后，前端页面之间的组合关系仍需要人工补证。

## [操作指南] 强制执行步骤

> 本节是对所有读取本文件的 AI 发出的硬性操作指令，不是建议。

### 步骤1 — 必须先读完以下所有文件（顺序不限）

读完本文件后，在执行任何任务之前，必须依次 read 以下文件完整内容：

- `.nexus-map/arch/systems.md` — 系统边界与代码位置
- `.nexus-map/arch/dependencies.md` — 系统间依赖关系与 Mermaid 图
- `.nexus-map/arch/test_coverage.md` — 测试面与证据缺口
- `.nexus-map/hotspots/git_forensics.md` — Git 热点与耦合风险
- `.nexus-map/concepts/domains.md` — 核心领域概念

> 这些文件均为高密度摘要，总量通常 < 5000 tokens，是必要的上下文成本。
> 不得以"任务简单"或"只改一个文件"为由跳过。

### 步骤2 — 按任务类型追加操作（步骤1 完成后执行）

- 若任务涉及**接口修改、新增跨模块调用、删除/重命名公共函数**：
  → 必须运行 `query_graph.py --impact <目标文件>` 确认影响半径后再写代码。
- 若任务需要**判断某文件被谁引用**：
  → 运行 `query_graph.py --who-imports <模块名>`。
- 若仓库结构已发生重大变化（新增系统、重构模块边界）或 prompt 版本管理边界继续外扩：
  → 任务完成后评估是否需要重新运行 nexus-mapper 更新知识库。
