# Goal

系统检查 `integrate/2026-05-22-upstream-main-prompt-retire` 上的本地二次开发能力，确认其与 `upstream/main` 大版本更新的冲突、契约漂移和回归风险，输出按模块分组的修复轨/退役轨处理清单。

# Architecture

- 审计对象：
  - 当前集成分支：`integrate/2026-05-22-upstream-main-prompt-retire`
  - authority upstream：`upstream/main`
  - merge base：`b62c2606`
  - 上游集成 merge commit：`3d9e5df2`
- 审计方法分三层：
  1. `Git delta inventory`：分别看 `merge base -> HEAD` 与 `merge commit -> HEAD`
  2. `Module risk matrix`：按 owner 和契约边界拆成 `workspace`、`pipeline`、`graph workbench`、`custom-chunks`、`role-llm`、`frontend`、`storage/deploy`
  3. `Focused verification`：只跑与高风险模块直接相关的后端测试、前端测试和构建
- 审计输出：
  - 本计划：`docs/aegis/plans/2026-05-22-post-merge-custom-conflict-audit.md`
  - 后续报告：`docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`

# Tech Stack

- `git`：历史、差异、worktree 隔离
- `uv` / `./scripts/test.sh` / `ruff`：后端验证
- `bun test` / `bun run build`：前端验证
- `ctx_execute` / `ctx_execute_file`：结构化取证

# Baseline/Authority Refs

- `docs/analysis/2026-05-21-upstream-main-compatibility-report.md`
- `docs/aegis/sop/upstream-merge-sop.md`
- `docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`
- 当前分支状态证据：
  - `git status --short --branch`
  - `git log --merges --oneline --decorate --max-count=5`
  - `git log --oneline --decorate 3d9e5df2..HEAD`

# Compatibility Boundary

- 必须保留的本地 owner：
  - `workspace` / `guest` 生命周期与 registry/runtime
  - `graph workbench` 及其实体/关系编辑契约
  - `custom-chunks` 与 rebuild 端点行为
  - 本地图谱/文档管理前端交互能力
- 必须吸收的 upstream owner：
  - `pipeline` / `parser` / `chunker`
  - `role-llm` / `vlm` 平台化能力
  - upstream 当前 `prompt.py` / `prompts/` 文件型 prompt 机制
- 已确认退役，不应回流：
  - 本地 Prompt Management UI / API / 版本库
- 审计期间不得破坏：
  - 当前未提交工作区
  - merge commit 双父结构
  - 现有 lockfile 与构建链可复现性

# Verification

- 基线冻结：
  - `git status --short --branch`
  - `git worktree add ../LightRAG-audit-2026-05-22 --detach HEAD`
  - `git -C ../LightRAG-audit-2026-05-22 switch -c audit/2026-05-22-post-merge-conflicts`
- 差异清单：
  - `git -C ../LightRAG-audit-2026-05-22 log --reverse --oneline 3d9e5df2..HEAD`
  - `git -C ../LightRAG-audit-2026-05-22 diff --name-only 3d9e5df2..HEAD`
  - `git -C ../LightRAG-audit-2026-05-22 diff --name-only b62c2606..HEAD | awk -F/ 'NF{print $1}' | sort | uniq -c | sort -nr`
- 后端验证：
  - `ruff check lightrag tests`
  - `./scripts/test.sh tests/test_graph_workbench.py -q`
  - `./scripts/test.sh tests/test_workspace_runtime_manager.py -q`
  - `./scripts/test.sh tests/test_workspace_runtime_app_integration.py -q`
  - `./scripts/test.sh tests/test_document_rebuild_route.py -q`
  - `./scripts/test.sh tests/test_query_raw_route.py -q`
  - `./scripts/test.sh tests/test_llm_role_runtime.py -q`
  - `./scripts/test.sh tests/test_pipeline_analyze_multimodal.py -q`
  - `./scripts/test.sh tests/test_document_routes_workspace_runtime.py -q`
- 前端验证：
  - `cd lightrag_webui && bun test src/api/lightrag.workspace.test.ts src/stores/backendState.workspace.test.ts src/stores/graphWorkbench.test.ts src/components/retrieval/QuerySettings.test.tsx`
  - `cd lightrag_webui && bun test src/components/workspace/WorkspaceManagerDialog.test.tsx src/components/workspace/WorkspaceSwitcher.test.tsx`
  - `cd lightrag_webui && bun run build`

# Plan Basis

## Facts

- 当前分支是 `integrate/2026-05-22-upstream-main-prompt-retire`
- 当前工作区非干净：
  - 已修改：`lightrag/api/graph_workbench.py`
  - 已修改：`lightrag/lightrag.py`
  - 已修改：`lightrag/utils_graph.py`
  - 已修改：`tests/test_graph_workbench.py`
  - 未跟踪：`.kilo/plans/1779434193677-mighty-panda.md`
  - 未跟踪：`.kilo/plans/1779451778086-stellar-canyon.md`
  - 未跟踪：`.kilo/plans/entitiy-delete-optimistic-concurrency.md`
  - 未跟踪：`scripts/dev.sh`
- authority upstream remote 为 `upstream`
- 当前分支相对 `upstream/main` 领先 `211` 个提交
- 自 `merge base` 起，改动主要集中在：
  - `lightrag_webui`
  - `docs`
  - `tests`
  - `lightrag`
- merge 后本地继续补回的关键提交包括：
  - `1272c844 port(workspace): restore workspace/guest features to server and document routes`
  - `000866f3 port(role-llm): backport upstream role_llm/vlm/pipeline features to server`
  - `2ec1f4fe port(custom-chunks): port arebuild_all_custom_chunks_graphs and helpers`
  - `bda681b9 port(frontend): restore pre-merge api/lightrag.ts with workspace support`
  - `bb8272d2 port(pipeline): restore document status pipeline, storage methods, and frontend features after merge`
  - `31e0ed45 feat(graph): 实体/关系删除增加乐观并发控制(revision_token)与前端联动`
- 兼容性报告已经确认：这次不是“小步同步”，而是需要结构化吸收的集成合并

## Assumptions

- `liukai` 的提交基本代表本地二次开发主线
- Prompt Management 退役结论已经稳定，不需要在本轮重新争论 owner
- 当前未提交的 8 个工作区变更不属于这次冲突审计的 authority 结论

## Unknowns

- 哪些文件虽然没有文本冲突，但已经出现 silent conflict
- 哪些补回提交只是在 merge 当天止血，后续仍存在未覆盖测试
- 哪些前端行为依赖了已经被 upstream 改写的后端默认值

# Ripple Signal Triage

- Owner 扩散：是。涉及 `backend/api/frontend/tests/docs/build`
- Downstream 扩散：是。涉及 `/documents`、`/query`、`/graph`、workspace 切换、文档 rebuild
- Contract 扩散：是。`revision_token`、workspace headers、pipeline status、query settings 均可能漂移
- Source-of-truth 争议：是。`pipeline/parser/chunker` 取 upstream，`workspace/graph/custom-chunks` 取本地 owner
- Verification 扩散：是。必须覆盖 Python + WebUI

# File Map

## 审计输出

- `docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
- `findings.md`
- `progress.md`

## 必查后端

- `lightrag/api/workspace_runtime.py`
- `lightrag/api/workspace_registry.py`
- `lightrag/api/routers/workspace_routes.py`
- `lightrag/api/routers/document_routes.py`
- `lightrag/api/routers/query_routes.py`
- `lightrag/api/graph_workbench.py`
- `lightrag/api/lightrag_server.py`
- `lightrag/lightrag.py`
- `lightrag/pipeline.py`
- `lightrag/utils_pipeline.py`
- `lightrag/utils_graph.py`
- `lightrag/llm_roles.py`

## 必查前端

- `lightrag_webui/src/api/lightrag.ts`
- `lightrag_webui/src/stores/state.ts`
- `lightrag_webui/src/stores/graphWorkbench.ts`
- `lightrag_webui/src/components/retrieval/QuerySettings.tsx`
- `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
- `lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx`

## 必查验证文件

- `tests/test_graph_workbench.py`
- `tests/test_workspace_runtime_manager.py`
- `tests/test_workspace_runtime_app_integration.py`
- `tests/test_document_rebuild_route.py`
- `tests/test_query_raw_route.py`
- `tests/test_llm_role_runtime.py`
- `tests/test_pipeline_analyze_multimodal.py`
- `tests/test_document_routes_workspace_runtime.py`
- `lightrag_webui/src/api/lightrag.workspace.test.ts`
- `lightrag_webui/src/stores/backendState.workspace.test.ts`
- `lightrag_webui/src/stores/graphWorkbench.test.ts`
- `lightrag_webui/src/components/retrieval/QuerySettings.test.tsx`

# Task 1 - 冻结审计基线并隔离当前脏工作区

Files:

- 修改：`progress.md`
- 修改：`findings.md`
- 创建（后续执行时）：`../LightRAG-audit-2026-05-22/`

Why:

- 先把“当前用户未提交变更”和“本次冲突审计基线”拆开，否则后续每个差异都无法判断是 merge 后冲突还是新的 WIP

Impact/Compatibility:

- 不动源码，只创建隔离 worktree；原工作区保持原样

Repair Track:

- 冻结 authority 基线：当前 branch / HEAD / merge base / merge commit / dirty files

Retirement Track:

- 本轮审计中停止依赖“直接在当前脏工作区上判断冲突”的旧做法

Verification:

- `git status --short --branch`
- `git worktree add ../LightRAG-audit-2026-05-22 --detach HEAD`
- `git -C ../LightRAG-audit-2026-05-22 switch -c audit/2026-05-22-post-merge-conflicts`
- `git -C ../LightRAG-audit-2026-05-22 status --short --branch`

- [ ] 记录当前脏工作区文件清单到 `progress.md`
- [ ] 创建 detached worktree
- [ ] 在新 worktree 建审计分支
- [ ] 确认新 worktree 干净
- [ ] 在 `findings.md` 追加审计路径与目录

# Task 2 - 重建二次开发 inventory 与 merge 后补丁清单

Files:

- 创建（后续执行时）：`docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
- 修改：`findings.md`
- 修改：`progress.md`

Why:

- 不先重建 inventory，就会把“长期本地 owner”和“merge 当天补丁”混成一团，无法判断该保留什么、该回归什么

Impact/Compatibility:

- 只产出差异清单，不改行为

Repair Track:

- 分别输出 `b62c2606..HEAD` 和 `3d9e5df2..HEAD` 的文件与提交清单

Retirement Track:

- 把已退役的 Prompt Management 相关路径单独标记为“不再纳入保留 owner”

Verification:

- `git -C ../LightRAG-audit-2026-05-22 log --reverse --oneline 3d9e5df2..HEAD`
- `git -C ../LightRAG-audit-2026-05-22 diff --name-only 3d9e5df2..HEAD`
- `git -C ../LightRAG-audit-2026-05-22 diff --name-only b62c2606..HEAD | awk -F/ 'NF{print $1}' | sort | uniq -c | sort -nr`
- `git -C ../LightRAG-audit-2026-05-22 log --format='%an' b62c2606..HEAD | sort | uniq -c | sort -nr`

- [ ] 导出 merge 后本地提交列表
- [ ] 导出 merge 后文件补回清单
- [ ] 导出自 merge base 起的顶层目录分布
- [ ] 标记 prompt 退役文件为 out-of-scope owner
- [ ] 在审计报告里建立“模块 / 文件 / owner / 风险级别”表头

# Task 3 - 按模块建立风险矩阵并逐块比对 authority

Files:

- 修改（后续执行时）：`docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
- 修改：`findings.md`
- 修改：`progress.md`

Why:

- 这次冲突不是集中在一个文件，而是多个 owner 面并行冲突；必须按模块切片，不然无法做到“修复轨”和“退役轨”同时清晰

Impact/Compatibility:

- 只做对比和判定，不在本任务里直接改源码

Repair Track:

- 对以下模块分别判断“取 upstream / 取本地 / 人工拼接”：
  - `workspace/runtime`
  - `pipeline/document routes`
  - `graph workbench`
  - `custom-chunks/rebuild`
  - `role-llm`
  - `frontend state/api/query/workspace`

Retirement Track:

- 标出所有 compat-only shim、临时 merge 止血补丁、旧默认值依赖

Verification:

- `git -C ../LightRAG-audit-2026-05-22 diff --stat upstream/main -- lightrag/api/workspace_runtime.py lightrag/api/workspace_registry.py lightrag/api/routers/workspace_routes.py lightrag/api/lightrag_server.py`
- `git -C ../LightRAG-audit-2026-05-22 diff --stat upstream/main -- lightrag/pipeline.py lightrag/utils_pipeline.py lightrag/api/routers/document_routes.py lightrag/api/routers/query_routes.py lightrag/llm_roles.py`
- `git -C ../LightRAG-audit-2026-05-22 diff --stat upstream/main -- lightrag/api/graph_workbench.py lightrag/utils_graph.py lightrag/lightrag.py`
- `git -C ../LightRAG-audit-2026-05-22 diff --stat upstream/main -- lightrag_webui/src/api/lightrag.ts lightrag_webui/src/stores/state.ts lightrag_webui/src/stores/graphWorkbench.ts lightrag_webui/src/components/retrieval/QuerySettings.tsx`

- [ ] 输出 workspace/runtime 风险结论
- [ ] 输出 pipeline/document routes 风险结论
- [ ] 输出 graph workbench 与 optimistic concurrency 风险结论
- [ ] 输出 custom-chunks/rebuild 风险结论
- [ ] 输出 frontend state/api/query/workspace 风险结论
- [ ] 为每个模块标注 authority、冲突类型、建议动作

# Task 4 - 跑高风险后端验证，确认是否存在已知回归

Files:

- 修改（后续执行时）：`docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
- 修改：`progress.md`

Why:

- 只看 diff 不足以发现 silent conflict；高风险模块至少要拿现成测试和 lint 做一轮证据确认

Impact/Compatibility:

- 不新增测试，只使用已有测试作为冲突探针

Repair Track:

- 用后端测试确认 `workspace`、`graph workbench`、`custom-chunks`、`query raw`、`pipeline` 是否仍满足本地行为预期

Retirement Track:

- 若某个测试只覆盖已退役路径，记录为“测试资产待退役”，不再作为功能 owner 证据

Verification:

- `ruff check lightrag tests`
- `./scripts/test.sh tests/test_graph_workbench.py -q`
- `./scripts/test.sh tests/test_workspace_runtime_manager.py -q`
- `./scripts/test.sh tests/test_workspace_runtime_app_integration.py -q`
- `./scripts/test.sh tests/test_document_rebuild_route.py -q`
- `./scripts/test.sh tests/test_query_raw_route.py -q`
- `./scripts/test.sh tests/test_llm_role_runtime.py -q`
- `./scripts/test.sh tests/test_pipeline_analyze_multimodal.py -q`
- `./scripts/test.sh tests/test_document_routes_workspace_runtime.py -q`

- [ ] 跑 `ruff`
- [ ] 跑 graph/workspace 相关测试
- [ ] 跑 rebuild/query raw 相关测试
- [ ] 跑 role-llm/pipeline 相关测试
- [ ] 在审计报告中记录失败用例与对应模块

# Task 5 - 跑前端关键验证并确认前后端契约是否对齐

Files:

- 修改（后续执行时）：`docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
- 修改：`progress.md`

Why:

- 本地二开主战场之一是 WebUI；如果只测后端，workspace/graph/query 行为的漂移会漏掉一半

Impact/Compatibility:

- 只跑现有前端测试和 build，不引入新的 UI 变更

Repair Track:

- 验证 `api/lightrag.ts`、workspace state、graphWorkbench、QuerySettings 等关键契约

Retirement Track:

- 标记仍依赖已退役 prompt/version 语义的前端测试或分支

Verification:

- `cd lightrag_webui && bun test src/api/lightrag.workspace.test.ts src/stores/backendState.workspace.test.ts src/stores/graphWorkbench.test.ts src/components/retrieval/QuerySettings.test.tsx`
- `cd lightrag_webui && bun test src/components/workspace/WorkspaceManagerDialog.test.tsx src/components/workspace/WorkspaceSwitcher.test.tsx`
- `cd lightrag_webui && bun run build`

- [ ] 跑 API/state/graph/query 前端测试
- [ ] 跑 workspace 组件测试
- [ ] 跑 WebUI build
- [ ] 在审计报告中记录前端契约漂移点

# Task 6 - 交付模块级处理清单与下一步执行顺序

Files:

- 修改（后续执行时）：`docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
- 修改：`findings.md`
- 修改：`progress.md`

Why:

- 用户要的不是一堆 diff，而是“接下来按什么顺序处理”的可执行结论

Impact/Compatibility:

- 只产出结论，不改源码

Repair Track:

- 输出每个模块的建议动作：保留本地、吸收 upstream、人工拼接、补测、延期

Retirement Track:

- 输出需要删除、停止依赖、或降级为历史文档的旧路径和旧测试

Verification:

- 审计报告中每个模块都必须写明：
  - 证据命令
  - 证据覆盖范围
  - 残余风险

- [ ] 完成模块风险矩阵
- [ ] 完成修复轨清单
- [ ] 完成退役轨清单
- [ ] 给出执行优先级：先后端 owner，再前端契约，最后文档/测试退役
- [ ] 回填 `findings.md` 和 `progress.md`

# Risks

- 当前工作区有未提交改动，若不使用独立 worktree，所有审计结论都会被污染
- `211` 个本地提交里可能包含已经被后续补丁覆盖的旧实验性路径，需要用测试和当前源码再次筛掉
- 自动合并文件存在 silent conflict 风险，尤其是默认值、状态字段、前后端约定字段
- 前端测试覆盖的是显式契约，不一定能覆盖所有交互路径；仍需在报告中注明残余风险

# Rollback Surface

- 本计划阶段不改源码，只有文档与跟踪文件变更
- 执行阶段若使用独立 worktree，删除 worktree 即可回滚审计现场：
  - `git worktree remove ../LightRAG-audit-2026-05-22`

# Retirement

## Delete

- 任何仍试图把本地 Prompt Management 当作当前 owner 的判断口径
- 以当前脏工作区直接作为 authority 基线的做法

## Keep

- `workspace` / `graph workbench` / `custom-chunks` / `role-llm` 的本地 owner 审计优先级
- `docs/analysis/2026-05-21-upstream-main-compatibility-report.md` 和 `docs/aegis/sop/upstream-merge-sop.md` 作为 authority refs

## Deletion Trigger

- 审计完成并形成新的模块级处理清单后，可将本计划从“活动计划”降为历史记录

# Self-Review

- 范围覆盖：已覆盖 branch 基线、模块 owner、后端/前端验证、交付清单
- Placeholder：无 `TODO/TBD`
- Compatibility：已明确保留 owner、upstream owner、退役范围
- Verification：每个任务都附了具体命令
- Dual-track：每个关键任务都写了修复轨和退役轨
