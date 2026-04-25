> generated_by: nexus-mapper v2
> verified_at: 2026-04-25
> provenance: Derived from `.nexus-map/raw/git_stats.json` over the most recent 30 days; system interpretation is supplemented by the current file tree and the carried-forward validated architecture map.

# Git 热点与耦合

## 热点结论

- 近 30 天的主热点已经从 setup 主脚本转向“PostgreSQL 存储 + WebUI API client + 本地化 + workspace 服务联动”。
- 当前仓库的高变更面主要有三条：
  - 存储与检索后端：`lightrag/kg/postgres_impl.py`、`lightrag/api/lightrag_server.py`
  - WebUI 交付面：`lightrag_webui/src/api/lightrag.ts`、`src/locales/en.json`、`src/locales/zh.json`
  - 文档与配置收尾：`README.md`、`README-zh.md`、`env.example`、`scripts/setup/lib/file_ops.sh`
- prompt version management 仍是结构重要的跨系统能力，但最近 30 天的显著热点更偏向存储、workspace 服务和前端契约层。

## Top Hotspots

1. `lightrag/kg/postgres_impl.py` — 30 次变更，`high`
2. `lightrag_webui/src/api/lightrag.ts` — 20 次变更，`high`
3. `lightrag_webui/src/locales/en.json` — 18 次变更，`high`
4. `lightrag_webui/src/locales/zh.json` — 18 次变更，`high`
5. `tests/test_interactive_setup_outputs.py` — 16 次变更，`high`
6. `lightrag_webui/package.json` — 14 次变更，`medium`
7. `lightrag_webui/bun.lock` — 14 次变更，`medium`
8. `README-zh.md` — 13 次变更，`medium`
9. `lightrag/api/lightrag_server.py` — 12 次变更，`medium`
10. `README.md` — 12 次变更，`medium`
11. `env.example` — 12 次变更，`medium`
12. `scripts/setup/lib/file_ops.sh` — 12 次变更，`medium`

## 强耦合对

- `lightrag_webui/src/locales/en.json` ↔ `lightrag_webui/src/locales/zh.json`
  - `co_changes=18`
  - `coupling_score=1.00`
  - 含义：当前前端多语言文案仍然完全成对演进。
- `lightrag_webui/bun.lock` ↔ `lightrag_webui/package.json`
  - `co_changes=13`
  - `coupling_score=0.929`
  - 含义：前端依赖升级仍然高度联动。
- `README-zh.md` ↔ `README.md`
  - `co_changes=12`
  - `coupling_score=1.00`
  - 含义：中英文文档仍然需要同步维护。
- `scripts/setup/lib/file_ops.sh` ↔ `tests/test_interactive_setup_outputs.py`
  - `co_changes=12`
  - `coupling_score=1.00`
  - 含义：配置输出逻辑与 setup 回归测试仍是强联动区。
- `lightrag_webui/src/api/lightrag.ts` ↔ `lightrag_webui/src/locales/en.json`
  - `co_changes=11`
  - `coupling_score=0.611`
  - 含义：前端 API 契约变化经常伴随英文文案一起调整。
- `lightrag_webui/src/api/lightrag.ts` ↔ `lightrag_webui/src/locales/zh.json`
  - `co_changes=11`
  - `coupling_score=0.611`
  - 含义：同一批前端 API 改动也会同步推高中文文案更新。
- `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.test.tsx` ↔ `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
  - `co_changes=9`
  - `coupling_score=1.00`
  - 含义：workspace 管理 UI 仍然保持实现与测试强绑定。
- `lightrag/api/lightrag_server.py` ↔ `lightrag/api/routers/workspace_routes.py`
  - `co_changes=7`
  - `coupling_score=0.70`
  - 含义：服务主入口和 workspace 路由仍有明显联动。

## 新兴风险区

- `lightrag/kg/postgres_impl.py` 已成为全仓头号热点，说明存储层风险中心已经明显偏向 PostgreSQL。
- `lightrag_webui/src/api/lightrag.ts` 与 `src/locales/*.json` 同时进入热点榜，说明前端契约和文案层在并行快速演进。
- `lightrag/api/lightrag_server.py` 重新进入热点榜，并与 workspace 路由形成强耦合，服务层改动风险在回升。
- prompt version management 虽然未进入当前热点前列，但它仍横跨 `lightrag/`、`lightrag/api/`、`lightrag_webui/src/` 和测试层，风险来自语义一致性而不是单点热度。

## 风险解释

- 高风险不等于“代码差”，而是意味着改动频繁、联动多、回归面大。
- 当前最危险的错误假设是：
  - 认为 `lightrag/kg/postgres_impl.py` 只是局部存储优化，不会牵动检索行为和回归面。
  - 认为 `lightrag_webui/src/api/lightrag.ts` 只是薄客户端，不会牵动前后端协同和本地化文案。
  - 认为 `lightrag/api/lightrag_server.py` 的变化只影响启动层，不会连到 workspace 路由和健康摘要。
  - 认为 prompt 版本化文件不在热点榜里，就不会牵动核心运行时、API、UI 和文档。

## 后续改动建议

- 改 PostgreSQL / OpenSearch 存储：
  - 先看对应实现文件
  - 再看对应测试簇与迁移 / 性能测试
- 改前端 API client 或本地化：
  - 连看 `lightrag_webui/src/api/lightrag.ts`
  - `lightrag_webui/src/locales/en.json`
  - `lightrag_webui/src/locales/zh.json`
  - 以及受影响的 workspace / graph / document 页面
- 改 workspace 服务：
  - 连看 `lightrag/api/lightrag_server.py`
  - `lightrag/api/routers/workspace_routes.py`
  - 相关 API 与 WebUI 测试
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
