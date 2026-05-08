# Initial Baseline

日期：2026-05-08

## 当前事实

- 当前分支：`main`
- 远端：`origin` 指向 fork，`upstream` 指向 `HKUDS/LightRAG`
- 分叉状态：`main` 相对 `upstream/main` 为 `ahead 321 / behind 34`
- 文件层重叠：本地独有 399、上游独有 144、双方重叠 124

## 高风险重叠区域

- `lightrag/api/`
- `lightrag/kg/`
- `lightrag_webui/src/api/`
- `scripts/setup/`
- `Makefile`
- `env.example`

## 本地二开热点

- `lightrag/kg/nebula_impl.py`
- `lightrag/kg/postgres_impl.py`
- `lightrag/api/lightrag_server.py`
- `lightrag/lightrag.py`
- `lightrag_webui/src/api/lightrag.ts`

## 合并约束

- 不在 `main` 直接执行合并
- 不覆盖本地工作区/图谱/访客访问/自定义图谱导入相关行为
- 冲突优先按“保本地业务语义，吸收上游通用修复”处理
