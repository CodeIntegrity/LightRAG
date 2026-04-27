# Nebula `name` 语义对齐实施计划

## 目标
将 `NebulaGraphStorage` 的节点写入语义调整为与 `Neo4j` / `Memgraph` / `Postgres` 一致：`entity_id` 作为真实主标识，`name` 仅表示可选展示名；当调用方未提供 `name` 时，不再自动使用 `entity_id` 回填。

## 本次范围
- 仅修改 `NebulaGraphStorage.upsert_node`
- 仅补充/调整 `Nebula` 相关测试
- 不修改前端
- 不修改其他后端
- 不处理历史数据迁移

## 背景结论
- 当前 `WebUI` 的显示优先级是 `name -> entity_id -> labels[0] -> id`
- 当前 `Nebula` 写入逻辑会把 `name` 缺失场景自动回填为 `entity_id`
- 这使 `Nebula` 的 `name` 语义与其他图后端不一致
- 本次改动后，新写入的 `Nebula` 数据将与其他后端保持一致；旧数据保持原样

## 方案结论
- 把 `NebulaGraphStorage.upsert_node` 中的
  - `name = str(node_data.get("name", entity_id))`
- 调整为
  - 仅使用调用方提供的真实 `name`
  - 未提供时写入空字符串
- 不改 `WebUI` 回退显示逻辑，让前端在 `name` 为空时继续自动显示 `entity_id`

## 影响范围

### 直接修改
- `lightrag/kg/nebula_impl.py`
- `tests/test_nebula_graph_storage.py`

### 受影响但预计无需改动
- `lightrag_webui/src/utils/graphLabel.ts`
- `lightrag_webui/src/utils/graphProperties.ts`

## 非目标
- 不引入 `UUID` 主键模型
- 不调整实体向量库字段结构
- 不修改 `RAG` 查询链路
- 不修改 `search_labels` 的匹配策略
- 不清理历史 `name == entity_id` 数据

## 实施步骤

### Step 1: 锁定最小改动点
- 仅收敛到 `NebulaGraphStorage.upsert_node`
- 确认读取路径无需同步改协议，只保留现有 `name` 返回

### Step 2: 调整写入语义
- 当 `node_data` 含 `name` 时，按原值写入
- 当 `node_data` 不含 `name` 时，写入空字符串
- 不再自动复制 `entity_id` 到 `name`

### Step 3: 补充测试
- 新增或调整 `Nebula` 单测，覆盖：
  - 提供 `name` 时按真实值写入
  - 未提供 `name` 时不再写入 `entity_id`

### Step 4: 跑最小回归
- 至少执行 `tests/test_nebula_graph_storage.py`
- 额外人工确认 `WebUI` 在 `name` 为空时仍会显示 `entity_id`

## 验收标准
- `Nebula` 新写入节点在未传 `name` 时，落库值不等于 `entity_id`
- `Nebula` 在传入真实 `name` 时，仍能原样写入和读出
- 现有 `WebUI` 不需要改代码即可继续显示节点名
- 改动范围不扩散到其他图后端

## 测试命令
- `rtk ./scripts/test.sh tests/test_nebula_graph_storage.py -v`
- `rtk ruff check lightrag/kg/nebula_impl.py tests/test_nebula_graph_storage.py`

## 风险点
- `Nebula` 旧数据仍保留 `name == entity_id`，新旧数据展示语义会并存
- 如果测试对现有 SQL 字符串有强假设，可能需要同步更新断言
- `search_labels` 仍会综合 `entity_id` 和 `name`，本次不改变该行为

## 完成定义
- 代码改动完成
- `Nebula` 定向测试通过
- 文档与实现一致

## 知识库同步评估
- 本次不改变系统边界，不需要重新运行 `nexus-mapper`
