# EvidenceBundleDraft

## 1. 远程与基线

命令：

```bash
git remote -v
git fetch upstream --prune
git rev-parse --short=12 HEAD origin/main upstream/main
git merge-base HEAD upstream/main
git merge-base origin/main upstream/main
git show -s --format='%h %ci %s' 5d738ae98f8644bd7939196527beed45686b98db
```

关键证据：

- `HEAD=b874837497ac`
- `origin/main=7b6170f36812`
- `upstream/main=b62c26066142`
- 共同祖先：`5d738ae98f8644bd7939196527beed45686b98db`

## 2. 双边规模

命令：

```bash
git rev-list --left-right --count origin/main...upstream/main
git diff --name-only $(git merge-base origin/main upstream/main)..origin/main
git diff --name-only $(git merge-base origin/main upstream/main)..upstream/main
```

关键证据：

- `origin/main ahead=194`
- `upstream/main ahead=649`
- 本地改动文件数：`291`
- 上游改动文件数：`240`
- 重叠文件数：`47`

## 3. 真实 merge 演练

命令：

```bash
git worktree add --detach .worktrees/upstream-merge-analysis-20260521 HEAD
cd .worktrees/upstream-merge-analysis-20260521
git merge --no-commit --no-ff upstream/main
git diff --name-only --diff-filter=U
```

关键证据：

- 真实冲突文件数：`16`
- 其中高风险代码冲突集中在：
  - `lightrag/api/lightrag_server.py`
  - `lightrag/api/routers/document_routes.py`
  - `lightrag/lightrag.py`
  - `lightrag/operate.py`
  - `lightrag/prompt.py`
  - `lightrag_webui/src/api/lightrag.ts`
  - `lightrag_webui/src/features/DocumentManager.tsx`
  - `lightrag_webui/src/stores/state.ts`

## 4. 自动合并但需复核的共享文件

命令：

```bash
git diff --name-only $(git merge-base origin/main upstream/main)..origin/main
git diff --name-only $(git merge-base origin/main upstream/main)..upstream/main
```

关键证据：

- 双方都改过但自动合上的文件还有 `31` 个
- 高风险样本：
  - `scripts/setup/setup.sh`
  - `lightrag/kg/mongo_impl.py`
  - `lightrag/kg/opensearch_impl.py`
  - `lightrag/kg/postgres_impl.py`
  - `lightrag/api/config.py`

## 5. 验证覆盖范围

- 已验证：抓取、分叉、改动面、冲突面、核心冲突语义
- 未验证：冲突解决后的 lint / pytest / bun build / bun test
