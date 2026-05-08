# Upstream Merge SOP

适用于把 `upstream/main` 合并进本仓库 `main` 的反复性流程。每次合并前对照执行；任何步骤红了就**停止合并**而不是把红线推进 `main`。

本 SOP 是 [`plans/2026-05-08-upstream-main-merge.md`](../plans/2026-05-08-upstream-main-merge.md) 提炼出的可重用骨架，记录从过往合并里学到的硬性闭环。

## 触发条件

- 主动 `git merge upstream/main`、`git pull upstream main`、或 cherry-pick 上游提交批
- 接收 fork 远端的回流改动到 `main`

仅 README/docs 类无代码改动的合并可豁免本 SOP。

## 合并前 (Pre-merge)

1. **基线快照**：`git tag aegis/<date>-pre-merge` 给当前 `main` 打标签，方便回滚
2. **回归基线**：在合并前**先**跑一次完整自证（命令见下方"自证闭环"）。如果合并前就有 fail，先记入新建 plan 的 *Problem Summary* 段，区分"既有"与"合并引入"
3. **lock 同步先行**：若上游修改了 `pyproject.toml` / `lightrag_webui/package.json`，**先**单独跑：
   - `uv lock --upgrade-package <pkg>` 或 `uv sync --extra api --extra test --extra offline-storage --extra offline-llm`
   - `cd lightrag_webui && bun install --frozen-lockfile`
   一次只动锁、不动代码，便于二分定位

## 合并中 (During-merge)

1. 在专用集成分支上做：`git checkout -b integrate/<date>-upstream-main`，**绝不**直接在 `main` 上 merge
2. 解决冲突后**立刻**做以下三件事（顺序固定）：
   - `ruff check --fix lightrag/ tests/` —— 修掉 import 重复 / 顺序问题（合并冲突最常见的副产物）
   - `git diff --check` —— 检查行尾空白与冲突标记残留
   - 跑下方 §自证闭环

## 自证闭环 (Verification gates)

**每条命令必须为绿。**任何一条红，回到合并步骤继续解决，不要往前推进。

```bash
# 1. Python lint —— 0 错误
ruff check lightrag/ tests/

# 2. Python 单元 / 离线测试 —— 全绿
uv sync --extra api --extra test --extra offline-storage --extra offline-llm
python -m pytest tests/ -q

# 3. WebUI 依赖锁与构建 —— 必须能装、能 build
cd lightrag_webui
bun install --frozen-lockfile
bun run build
bun run lint
cd ..
```

> 历史教训：
> - 跳过 (1) → `lightrag/api/config.py` 在合并里留下重复 `import get_env_value`（aff4adb9）
> - 跳过 (3) → `vite.config.ts` 引用 `@vitejs/plugin-react`（Babel 版）但 lock 是 `plugin-react-swc`，构建直接挂（5fc4ff94 才修）

## 离线测试环境注意

离线测试涵盖 `voyageai` / `anthropic` / `postgres` / `qdrant` / `opensearch` 等 provider。**不要**只跑 `--extra test`：那只装 lint/pytest 工具，会让 `tests/test_voyageai_embed.py`、`tests/test_postgres_*.py` 在 collection 阶段就 ImportError。完整环境请用：

```bash
uv sync --extra api --extra test --extra offline-storage --extra offline-llm
```

## 测试 fixture 隔离 (.env 漏入)

写或改测试 fixture 时，如果模块加载会读 `.env`（典型如 `lightrag_server.create_app`），fixture 必须**显式覆盖**敏感全局，不要假设环境干净：

- `args.auth_accounts` —— 默认 `.env` 可能配了 `AUTH_ACCOUNTS=admin:admin123`，会让 guest-only 路径走拒绝分支
- `auth_handler.accounts` —— `_sync_auth_handler` 会基于 `args.auth_accounts` 重建，需在 `create_app` 调用 *之后* 再设到测试期望状态
- 任何 `LIGHTRAG_*` 环境变量 —— 用 `monkeypatch.delenv` 或 `monkeypatch.setattr(args, ...)` 覆盖

参考实现：[`tests/test_prompt_config_routes.py::_build_test_client`](../../../tests/test_prompt_config_routes.py)。

## 合并后 (Post-merge)

1. 在**集成分支**上额外跑一次"开发者最常用路径"冒烟：
   - `lightrag-server` 启动一次（接 `.env`）—— 看启动日志是否有警告（如 `POSTGRES_ENABLE_VECTOR is deprecated`、`Workspace registry default path changed`）
   - 用 httpyac 跑 `docs/api/*.http` 中至少一个 happy-path 请求
2. 在 [`plans/<date>-upstream-main-merge.md`](../plans/) **回写** *Verification* 段实际命令输出（passed/skipped/failed 数）
3. 在 `docs/aegis/baseline/` 追加一条变更条目（如关键默认值变更、废弃环境变量、迁移提示）
4. 仅当上述全部完成，才把集成分支合到 `main`：`git checkout main && git merge --no-ff integrate/<date>-upstream-main`

## 红线 (Hard stops)

- ❌ 在 `main` 直接 `git merge upstream/main`
- ❌ 用 `--no-verify` 跳过 pre-commit 钩子
- ❌ 用 `git commit --amend` 修复合并 commit（破坏合并提交的双父结构）
- ❌ 把红的 ruff/pytest/bun build 留到下一次提交"再说"
- ❌ 静默改默认值或删除环境变量而不在 baseline/plans 留下迁移说明

## 回滚

如果合并后才发现关键回归：

1. `git revert -m 1 <merge-commit-sha>` —— 优先回退合并提交本身（保留历史）
2. 实在没法 revert（已被多个后续提交依赖）：`git reset --hard aegis/<date>-pre-merge` —— 仅在集成分支上做，回到合并前快照
3. 在 `plans/<date>-upstream-main-merge.md` 的 *Rollback Surface* 段记录回滚原因与下一步计划
