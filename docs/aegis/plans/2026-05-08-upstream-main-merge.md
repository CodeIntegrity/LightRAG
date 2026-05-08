# Goal

在不破坏本项目二次开发行为的前提下，把 `upstream/main` 的最新 34 个提交安全集成到本仓库，形成一个可回归、可审计、可回滚的集成分支。

# Architecture

本次不是普通功能开发，而是一次跨系统集成。核心边界分成 5 个区：

1. Git 集成区：分支、备份点、冲突记录
2. 后端核心区：`lightrag/api/`、`lightrag/kg/`、`lightrag/lightrag.py`
3. 前端契约区：`lightrag_webui/src/api/` 与受影响页面
4. 配置部署区：`scripts/setup/`、`Makefile`、`env.example`
5. 回归验证区：`tests/`、`./scripts/test.sh`、WebUI tests

# Tech Stack

- Git
- Python 3 / LightRAG backend
- Bun / React WebUI
- Shell 验证命令

# Baseline/Authority Refs

- `.nexus-map/INDEX.md`
- `.nexus-map/arch/systems.md`
- `.nexus-map/arch/dependencies.md`
- `.nexus-map/arch/test_coverage.md`
- `.nexus-map/hotspots/git_forensics.md`
- `docs/aegis/baseline/2026-05-08-initial-baseline.md`

# Compatibility Boundary

- 保持本地二开能力不退化：图谱工作台、自定义图谱导入、workspace 生命周期、guest/workspace 能力、Nebula/Postgres 本地修复、setup 本地镜像与 compose 逻辑。
- 不在 `main` 直接试错。
- 不接受“代码能合上但关键行为丢失”的结果。
- 对共享文件采用 3 类规则：
  - 本地优先：本地业务增强、环境适配、部署差异、存储兼容修复
  - 上游优先：纯通用 bugfix、依赖修复、lint/文案修复、无业务偏差的安全修复
  - 人工拼接：共享入口、共享 API 契约、共享存储实现

# Verification

- `git rev-list --left-right --count upstream/main...HEAD`
- `git status --short --branch`
- `./scripts/test.sh`
- `cd lightrag_webui && bun test`
- `python3 -m pytest tests/test_interactive_setup_outputs.py tests/test_interactive_setup -q`
- 需要时补跑：
  - `python3 -m pytest tests/test_graph_storage.py tests/test_nebula_graph_storage.py -q`
  - `python3 -m pytest tests/test_postgres_upsert_edge_cypher.py tests/test_postgres_client_manager.py -q`

# Problem Summary

当前仓库不是轻度 fork：`main` 相对 `upstream/main` 已累计 `ahead 321 / behind 34`。双方同时改过 124 个文件，冲突集中在 API、存储、前端 API、setup 脚本与测试。必须先做一次受控集成，再评估哪些上游修复进入主线。

# File Ownership Map

- Git 集成记录：
  - `docs/aegis/baseline/2026-05-08-initial-baseline.md`
  - `docs/aegis/plans/2026-05-08-upstream-main-merge.md`
- 高风险后端：
  - `lightrag/api/lightrag_server.py`
  - `lightrag/api/routers/query_routes.py`
  - `lightrag/api/config.py`
  - `lightrag/api/auth.py`
  - `lightrag/api/utils_api.py`
  - `lightrag/kg/postgres_impl.py`
  - `lightrag/kg/opensearch_impl.py`
  - `lightrag/kg/neo4j_impl.py`
  - `lightrag/kg/memgraph_impl.py`
  - `lightrag/kg/mongo_impl.py`
  - `lightrag/kg/networkx_impl.py`
- 高风险前端：
  - `lightrag_webui/src/api/lightrag.ts`
- 配置部署：
  - `scripts/setup/setup.sh`
  - `scripts/setup/lib/file_ops.sh`
  - `scripts/setup/lib/validation.sh`
  - `scripts/setup/templates/postgres.yml`
  - `scripts/setup/templates/mongodb.yml`
  - `Makefile`
  - `env.example`
- 关键回归：
  - `tests/test_interactive_setup_outputs.py`
  - `tests/test_interactive_setup/`
  - `tests/test_graph_storage.py`
  - `tests/test_nebula_graph_storage.py`
  - `tests/test_opensearch_storage.py`
  - `tests/test_postgres_*`

# Merge Policy

## 本地优先

- workspace 管理与访客访问语义
- 自定义图谱导入与图工作台行为
- setup 对本地镜像、compose、Atlas Local、设备提示保留的逻辑
- Nebula / Postgres / OpenSearch 的已落地兼容修复

## 上游优先

- 纯文案、lint、依赖升级
- 没有本地业务分歧的安全修复
- 与本地逻辑不冲突的 API 版本号、测试补齐、通用稳定性修复

## 必须人工拼接

- `lightrag/api/lightrag_server.py`
- `lightrag/api/routers/query_routes.py`
- `lightrag/kg/postgres_impl.py`
- `lightrag_webui/src/api/lightrag.ts`
- `scripts/setup/setup.sh`
- `Makefile`
- `env.example`

# Risks

- 共享入口文件冲突解法错误，会出现“能启动但功能静默退化”。
- 存储层如果误选上游整块实现，可能覆盖本地 Nebula/Postgres 修复。
- setup 脚本若直接取上游，可能破坏本地部署预设。
- 前端 API client 若只保一边，可能造成 UI 与后端契约错位。

# Rollback Surface

- 任何时候只在集成分支上操作
- 合并前打标签或备份分支
- 每完成一块风险区就单独提交
- 无法判定时退回共同祖先对比，不强行“一把梭”解冲突

# Task 1 - 建立集成分支与快照

Files:
- 无源码修改
- `docs/aegis/baseline/2026-05-08-initial-baseline.md`

Why:
- 给后续 merge 提供独立试验面和回滚锚点

Impact/Compatibility:
- 不影响现有 `main`

Verification:
- `git status --short --branch`
- `git branch --show-current`

- [ ] 记录当前工作树必须为干净状态：`git status --short --branch`
- [ ] 创建备份分支：`git branch backup/main-before-upstream-merge-20260508`
- [ ] 创建集成分支：`git switch -c merge/upstream-main-20260508`
- [ ] 验证已切到新分支：`git branch --show-current`
- [ ] 提交仅限后续真实代码合并，当前不提交

# Task 2 - 执行一次受控 merge 并生成冲突清单

Files:
- Git 索引中的冲突文件

Why:
- 先看到真实冲突面，再决定局部保留策略

Impact/Compatibility:
- 此步只在集成分支生效；不能直接解决冲突后立即提交，必须先分类

Verification:
- `git merge --no-commit --no-ff upstream/main`
- `git status --short`

- [ ] 先执行受控合并：`git merge --no-commit --no-ff upstream/main`
- [ ] 预期出现冲突或 staged 变更；若无冲突，仍禁止直接提交
- [ ] 导出冲突文件清单：`git diff --name-only --diff-filter=U`
- [ ] 将冲突文件按 API / 存储 / WebUI / setup / docs 分类
- [ ] 当前不提交，进入下一任务逐类处理

# Task 3 - 先处理低风险上游吸收项

Files:
- `.github/workflows/*`
- `README.md`
- `README-zh.md`
- 文案/依赖/非业务脚本

Why:
- 先消化低风险文件，缩小人工判定面

Impact/Compatibility:
- 不能把本地部署说明、本地环境约束误删

Verification:
- `git diff --stat`
- `git diff -- README.md README-zh.md`

- [ ] 对纯文档、workflow、依赖元数据优先接受上游版本
- [ ] 保留本地 fork 必需的说明与环境差异
- [ ] 检查文档是否误删本地部署方法
- [ ] 完成这一组后执行：`git diff --stat`
- [ ] 单独提交：`git commit -m "chore(merge): 吸收上游低风险改动"`

# Task 4 - 处理后端共享入口与存储冲突

Files:
- `lightrag/api/*.py`
- `lightrag/kg/*.py`
- `tests/test_graph_storage.py`
- `tests/test_nebula_graph_storage.py`
- `tests/test_opensearch_storage.py`
- `tests/test_postgres_*`

Why:
- 这是最可能破坏二开能力的核心区

Impact/Compatibility:
- 必须保住本地 workspace、graph、自定义导入、Nebula/Postgres 兼容逻辑

Verification:
- `python3 -m pytest tests/test_graph_storage.py tests/test_nebula_graph_storage.py -q`
- `python3 -m pytest tests/test_opensearch_storage.py tests/test_postgres_upsert_edge_cypher.py tests/test_postgres_client_manager.py -q`

- [ ] 逐文件对比 `:1:` 共同祖先、`:2:` 本地、`:3:` 上游版本后再解冲突
- [ ] 本地增强保留；上游安全修复与稳定性修复择优吸收
- [ ] 先跑图谱与存储定向测试，失败时只修当前冲突引入的问题
- [ ] 测试转绿后复查 API 返回结构是否保持本地语义
- [ ] 单独提交：`git commit -m "merge(api): 融合上游后端与存储修复"`

# Task 5 - 处理前端 API 契约与页面联动

Files:
- `lightrag_webui/src/api/lightrag.ts`
- 受影响的 `src/features/`、`src/components/`、`src/locales/`

Why:
- 前端 API client 同时被本地和上游高频修改，容易发生契约错位

Impact/Compatibility:
- 保持本地 workspace、graph、retrieval 流程可用

Verification:
- `cd lightrag_webui && bun test`

- [ ] 优先对齐后端最终返回结构，再解 `lightrag.ts`
- [ ] 本地页面能力不删减，上游通用修复按需吸收
- [ ] 跑前端测试，重点看 workspace、PromptManagement、graph workbench
- [ ] 若仅文案变化，确保中英文同步
- [ ] 单独提交：`git commit -m "merge(webui): 融合上游前端契约修复"`

# Task 6 - 处理 setup / Makefile / env 冲突

Files:
- `scripts/setup/`
- `Makefile`
- `env.example`
- `tests/test_interactive_setup_outputs.py`
- `tests/test_interactive_setup/`

Why:
- 这块同时承载上游安装流程和本地部署差异，误合会直接影响交付

Impact/Compatibility:
- 不能丢本地镜像、compose、storage prompt、runtime target 相关行为

Verification:
- `python3 -m pytest tests/test_interactive_setup_outputs.py tests/test_interactive_setup -q`

- [ ] setup 冲突按“保本地部署语义，吸收上游通用校验”处理
- [ ] 检查 `Makefile` 与 `.env` 示例是否仍匹配脚本输出
- [ ] 跑 setup 定向测试
- [ ] 若失败，只修当前 merge 引入的不一致
- [ ] 单独提交：`git commit -m "merge(setup): 融合上游配置向导改动"`

# Task 7 - 全量回归与交付判断

Files:
- 若测试失败，回修对应文件

Why:
- 防止局部转绿但整体行为退化

Impact/Compatibility:
- 必须在集成分支验证完，才有资格准备回合并 `main`

Verification:
- `./scripts/test.sh`
- `cd lightrag_webui && bun test`

- [ ] 跑后端主回归：`./scripts/test.sh`
- [ ] 跑前端主回归：`cd lightrag_webui && bun test`
- [ ] 若有失败，按失败面最小修复，不做无关重构
- [ ] 所有关键测试通过后检查 `git status --short`
- [ ] 最终提交：`git commit -m "merge(upstream): 集成 upstream main 最新改动"`

# Retirement / Keep Rules

- 保留：本地 workspace、graph、自定义导入、部署差异、存储兼容修复
- 缩减：若上游已完整覆盖本地通用修复，可删本地重复补丁
- 删除触发条件：仅当共同祖先、本地版本、上游版本三方对比能证明本地补丁已被上游等价覆盖

# Self-Review

- 已覆盖问题范围、基线来源、文件边界、兼容边界、验证命令、风险与回滚面。
- 未包含任何直接改写 `main` 的步骤。
- 冲突最重的入口文件都被列入“必须人工拼接”。
