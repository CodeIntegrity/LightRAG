# 发现与决策

## 需求
- 检查本次 upstream 大版本合并后，本地二次开发部分与当前集成代码的冲突面
- 产出一份可执行、可验证、可跟踪的检查计划

## 研究发现
- 当前分支为 `integrate/2026-05-22-upstream-main-prompt-retire`
- 当前工作区非干净：4 个已修改文件、4 个未跟踪文件
- 隔离审计 worktree 已创建：`/root/project/LightRAG/.worktrees/audit-2026-05-22-post-merge-conflicts`
- 隔离审计分支：`audit/2026-05-22-post-merge-conflicts`
- authority upstream 为 `upstream/main`
- 当前 `HEAD` 与 `upstream/main` 的 merge base 为 `b62c2606`
- 当前分支相对 `upstream/main` 领先 `211` 个提交
- 自 merge base 起，改动主要集中在 `lightrag_webui`、`docs`、`tests`、`lightrag`
- 最近一次上游集成 merge commit 为 `3d9e5df2 merge(upstream): merge upstream/main with prompt management retired`
- merge 后本地又补回的关键模块包括：`workspace`、`pipeline`、`frontend`、`custom-chunks`、`role-llm`
- merge commit `3d9e5df2` 之后到 `HEAD f1bd639e` 共 `13` 个提交、`46` 个直接改动文件
- post-merge 关键补回提交：
  - `1272c844 port(workspace): restore workspace/guest features to server and document routes`
  - `000866f3 port(role-llm): backport upstream role_llm/vlm/pipeline features to server`
  - `2ec1f4fe port(custom-chunks): port arebuild_all_custom_chunks_graphs and helpers`
  - `bda681b9 port(frontend): restore pre-merge api/lightrag.ts with workspace support`
  - `bb8272d2 port(pipeline): restore document status pipeline, storage methods, and frontend features after merge`
  - `31e0ed45 feat(graph): 实体/关系删除增加乐观并发控制(revision_token)与前端联动`
  - `f1bd639e fix(custom-chunks): 修复 ainsert_custom_chunks 与 rebuild 端点的 5 个缺陷和 2 项优化`
- 相对 `upstream/main` 的 diff 规模很大：
  - backend workspace/pipeline 相关：`11 files changed, 4310 insertions(+), 1488 deletions(-)`
  - graph/custom-chunks 相关：`7 files changed, 5037 insertions(+), 41 deletions(-)`
  - frontend workspace/query/graph 相关：`13 files changed, 4239 insertions(+), 917 deletions(-)`
- 已有 authority 文档：
  - `docs/analysis/2026-05-21-upstream-main-compatibility-report.md`
  - `docs/aegis/sop/upstream-merge-sop.md`
  - `docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`

## 技术决策
| 决策 | 理由 |
|------|------|
| 先做审计计划，不直接碰源码 | 用户当前要求是先列计划；工作区也非干净状态 |
| 后续审计输出采用模块风险矩阵 | 这次不是单点冲突，而是多模块 owner 重叠 |
| 同时保留修复轨和退役轨 | 部分本地能力要保留，部分 compat-only 路径应明确停用 |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
| `ctx_search` 在跨批次场景下结果噪声较多 | 改用定向 `ctx_execute` / `ctx_execute_file` 汇总结构化结论 |
| `fast-context` 脚本缺本地依赖 `tree-node-cli` | 在技能目录运行 `npm install` 修复依赖 |
| `fast-context` 缺 Windsurf API Key | 回退到本地 git/rg/ctx 检索和 `search_context` |

## 资源
- `docs/analysis/2026-05-21-upstream-main-compatibility-report.md`
- `docs/aegis/sop/upstream-merge-sop.md`
- `docs/aegis/plans/2026-05-21-upstream-main-merge-with-prompt-retirement.md`
- `docs/aegis/work/2026-05-22-post-merge-custom-conflict-audit/10-intent.md`
- `docs/aegis/work/2026-05-22-post-merge-custom-conflict-audit/20-checkpoint.md`
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

## 视觉/浏览器发现
- 本任务未使用浏览器/多模态取证

---
*每执行2次查看/浏览器/搜索操作后更新此文件*
*防止视觉信息丢失*
