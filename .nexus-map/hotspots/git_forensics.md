> generated_by: nexus-mapper v2
> verified_at: 2026-03-31
> provenance: Derived from `.nexus-map/raw/git_stats.json` over the most recent 30 days; hotspot interpretation is supplemented by current architecture inspection for prompt version management, workspace runtime, and WebUI test expansion.

# Git 热点与耦合

## 热点结论

- 近 30 天的主热点仍然不是单纯算法文件，而是“配置向导 + 配套测试 + 环境模板 + 交付文档”。
- 当前仓库的高变更面主要有三条：
  - 部署与配置体验：`scripts/setup/`、`env.example`、`docs/InteractiveSetup.md`
  - 图 / 向量存储演进：`lightrag/kg/nebula_impl.py`、`lightrag/kg/postgres_impl.py`、`lightrag/kg/opensearch_impl.py`
  - API / WebUI 交付面：`lightrag/lightrag.py`、`lightrag_webui/src/api/lightrag.ts`、README 双语文档
- prompt version management 仍是结构重要的跨系统能力，但最近 30 天的显著热点更偏向 setup、存储与 API client / 文档交付。

## Top Hotspots

1. `scripts/setup/setup.sh` — 134 次变更，`high`
2. `tests/test_interactive_setup_outputs.py` — 118 次变更，`high`
3. `env.example` — 64 次变更，`high`
4. `scripts/setup/lib/file_ops.sh` — 53 次变更，`high`
5. `tests/test_nebula_graph_storage.py` — 30 次变更，`high`
6. `scripts/setup/lib/validation.sh` — 27 次变更，`high`
7. `README.md` — 26 次变更，`high`
8. `README-zh.md` — 25 次变更，`high`
9. `lightrag/kg/nebula_impl.py` — 25 次变更，`high`
10. `lightrag/lightrag.py` — 24 次变更，`high`
11. `lightrag/kg/postgres_impl.py` — 23 次变更，`high`
12. `lightrag/kg/opensearch_impl.py` — 20 次变更，`high`
13. `docs/InteractiveSetup.md` — 20 次变更，`high`
14. `lightrag_webui/src/api/lightrag.ts` — 18 次变更，`high`
15. `lightrag_webui/bun.lock` — 17 次变更，`high`
16. `lightrag_webui/package.json` — 17 次变更，`high`
17. `docs/DockerDeployment.md` — 16 次变更，`high`
18. `Makefile` — 15 次变更，`high`
19. `tests/test_opensearch_storage.py` — 13 次变更，`medium`
20. `lightrag_webui/src/locales/en.json` — 12 次变更，`medium`

## 强耦合对

- `scripts/setup/setup.sh` ↔ `tests/test_interactive_setup_outputs.py`
  - `co_changes=81`
  - `coupling_score=0.686`
  - 含义：改配置向导时，测试同步变化依旧非常频繁。
- `scripts/setup/lib/file_ops.sh` ↔ `tests/test_interactive_setup_outputs.py`
  - `co_changes=40`
  - `coupling_score=0.755`
  - 含义：环境文件输出逻辑和 setup 回归测试强耦合。
- `scripts/setup/lib/file_ops.sh` ↔ `scripts/setup/setup.sh`
  - `co_changes=33`
  - `coupling_score=0.623`
  - 含义：向导主脚本和文件输出逻辑持续联动演化。
- `env.example` ↔ `scripts/setup/setup.sh`
  - `co_changes=29`
  - `coupling_score=0.453`
  - 含义：环境模板仍然直接牵动向导逻辑。
- `README-zh.md` ↔ `README.md`
  - `co_changes=25`
  - `coupling_score=1.00`
  - 含义：中英文文档仍然需要同步维护。
- `scripts/setup/lib/validation.sh` ↔ `scripts/setup/setup.sh`
  - `co_changes=25`
  - `coupling_score=0.926`
  - 含义：配置校验与主向导逻辑高度绑定。
- `lightrag/kg/nebula_impl.py` ↔ `tests/test_nebula_graph_storage.py`
  - `co_changes=25`
  - `coupling_score=1.00`
  - 含义：Nebula 图存储支持仍在快速演化，改实现几乎一定要改测试。
- `lightrag_webui/bun.lock` ↔ `lightrag_webui/package.json`
  - `co_changes=17`
  - `coupling_score=1.00`
  - 含义：前端依赖升级几乎总是成对出现。

## 新兴风险区

- `lightrag_webui/src/api/lightrag.ts` 已进入最近 30 天热点榜，说明 API 客户端与后端契约仍在快速演进；不要把它当成“纯类型薄封装”。
- `lightrag/kg/postgres_impl.py` 与 `lightrag/kg/opensearch_impl.py` 都已进入高风险区，存储层优化不再只集中在 Nebula。
- prompt version management 虽然未进入当前热点前列，但它仍横跨 `lightrag/`、`lightrag/api/`、`lightrag_webui/src/` 和测试层，风险来自语义一致性而不是单点热度。

## 风险解释

- 高风险不等于“代码差”，而是意味着改动频繁、联动多、回归面大。
- 当前最危险的错误假设是：
  - 认为 `scripts/setup/` 只是部署脚本，可以随手改。
  - 认为 `lightrag/kg/postgres_impl.py`、`opensearch_impl.py` 只是局部性能优化，不会牵动契约和测试。
  - 认为 `lightrag_webui/src/api/lightrag.ts` 只是薄客户端，不会牵动前后端协同。
  - 认为 prompt 版本化文件不在热点榜里，就不会牵动核心运行时、API、UI 和文档。

## 后续改动建议

- 改配置向导：
  - 连看 `scripts/setup/setup.sh`
  - `scripts/setup/lib/file_ops.sh`
  - `scripts/setup/lib/validation.sh`
  - `tests/test_interactive_setup_outputs.py`
  - `docs/InteractiveSetup.md`
- 改 Nebula / PostgreSQL / OpenSearch 存储：
  - 先看对应实现文件
  - 再看对应测试簇与迁移 / 性能测试
- 改 prompt 版本化：
  - 必看 `lightrag/prompt.py`
  - `lightrag/prompt_versions.py`
  - `lightrag/prompt_version_store.py`
  - `lightrag/lightrag.py`
  - `lightrag/operate.py`
  - `lightrag/api/routers/prompt_config_routes.py`
  - `lightrag_webui/src/features/PromptManagement.tsx`
  - `tests/test_prompt_version_runtime.py`
  - `tests/test_prompt_config_routes.py`
- 改 `lightrag_webui/src/api/lightrag.ts`：
  - 连看 `lightrag_webui/src/api/lightrag.test.ts`
  - `lightrag_webui/src/api/lightrag.workspace.test.ts`
  - 以及受影响的 workspace / graph / document 页面
