# 图谱自定义属性局部适配改造计划

## 目标
在不大规模重构上游存储契约、且便于后续合并 `HKUDS/LightRAG` 上游代码的前提下，为图谱导入、查询、详情、导出和 WebUI 展示补齐“任意新字段可用”的能力。

## 方案结论
- 采用 **局部适配方案**，不做全后端统一重构。
- 已知系统字段继续按现有逻辑处理。
- 未知字段在 API/导入层收拢为 `custom_properties`。
- `Nebula` 新增固定列保存该数据；其他后端尽量不改写入模型。
- 读取层统一归一化输出，保证 API 和 WebUI 看到的结构一致。

## 与 2026-04-27 Nebula `name` 语义对齐的约束
- 当前仓库节点展示名系统字段仍是 `name`，不是 `entity_name`。
- `name` 的语义是“可选展示名”，`entity_id` 才是主标识。
- `Nebula` 已完成最小语义修正：未提供 `name` 时写入空字符串，不再自动回填 `entity_id`。
- 本计划后续实现不得重新引入 `entity_id -> name` 自动复制逻辑。
- WebUI 现有显示回退顺序保持不变：`name -> entity_id -> labels[0] -> id`。
- 对 `/graph/import/custom-kg` 而言，实体输入仍以 `entity_name` 作为必填主标识；若支持额外传 `name`，其仅作为可选展示名透传到图存储。

## 设计边界

### 系统字段
节点保留：
- `entity_id`
- `name`
- `entity_type`
- `description`
- `source_id`
- `file_path`
- `created_at`

边保留：
- `src_id`
- `tgt_id`
- `description`
- `keywords`
- `weight`
- `source_id`
- `file_path`
- `created_at`

### 自定义字段
- 所有非系统字段统一收拢到 `custom_properties: dict[str, Any]`。
- API 对外响应统一包含 `custom_properties`。
- WebUI 展示时展开 `custom_properties`，而不是只显示一整段 JSON。

## 选型理由
- 对上游侵入最小，冲突集中在 API、Nebula 适配和图谱读路径。
- 不需要一次性修改所有存储实现，后续 rebase / merge 成本更低。
- 用户可见层仍然统一，不把后端内部差异暴露到接口和 WebUI。

## 文件范围

### 核心修改
- `lightrag/lightrag.py`
- `lightrag/api/routers/graph_routes.py`
- `lightrag/api/graph_workbench.py`
- `lightrag/kg/nebula_impl.py`

### WebUI 修改
- `lightrag_webui/src/components/graph/PropertiesView.tsx`
- `lightrag_webui/src/utils/graphProperties.ts`
- `lightrag_webui/src/api/lightrag.ts`

### 测试修改
- `tests/test_graph_routes.py`
- `tests/test_batch_graph_operations.py`
- `tests/test_nebula_graph_storage.py`
- `lightrag_webui/src/utils/graphProperties.test.ts`
- `lightrag_webui/src/components/graph/ActionInspector.test.tsx`

### 如需补文档
- `docs/LightRAG-API-Server.md`
- `docs/LightRAG-API-Server-zh.md`

## 分阶段计划

## Phase 1: 明确输入模型与归一化规则
- 在图谱导入链路定义系统字段白名单。
- 为 `chunks / entities / relationships` 分别定义“已知字段”和“未知字段”的拆分规则。
- 明确 `custom_properties` 为保留字段，避免用户自定义字段覆盖系统字段。
- 明确节点字段白名单使用 `name`，并与已落地的 Nebula `name` 可选语义保持一致。
- 明确 `/graph/import/custom-kg` 的实体输入契约：
  - `entity_name` 为必填主标识，并继续映射到 `entity_id`
  - `name` 为可选展示名
  - 未传 `name` 时按空字符串写入，不回填 `entity_name`
- 明确冲突策略：
  - 系统字段优先
  - 用户传入的同名 `custom_properties` 与自动收拢结果合并
  - 冲突键记录 warning 或直接以后者覆盖，需在实现前固定

**交付结果**
- 一份可执行的字段规则常量与归一化辅助函数设计。

## Phase 2: 改造导入写路径
- 在 `ainsert_custom_kg()` 中对实体和关系做字段拆分。
- 写入图存储时：
  - 系统字段继续按原逻辑写
  - 实体导入允许额外传 `name`，并透传为节点展示名
  - 未传 `name` 时显式写入空字符串，保持与现有 Nebula 语义一致
  - 自定义字段追加到 `custom_properties`
- 写入向量存储时不把 `custom_properties` 混入 `content`，避免影响现有检索语义。
- `chunks` 暂不扩展任意属性，先只支持实体和关系，降低首轮风险。

**交付结果**
- 自定义字段能通过 `/graph/import/custom-kg` 进入图存储。

## Phase 3: 改造 Nebula 持久化模型
- 为 Nebula 节点和边增加固定列：
  - 节点：`custom_properties_json`
  - 边：`custom_properties_json`
- 写入时做 JSON 序列化。
- 保持现有节点基础列语义不变，尤其是：
  - `entity_id` 继续作为真实主标识
  - `name` 继续作为可选展示名
  - `custom_properties` 不承担 `name` 的兜底回填职责
- 读取节点/边详情、图谱查询结果时做 JSON 反序列化。
- 反序列化失败时：
  - 保持主流程可用
  - 记录日志
  - 返回空对象或原始字符串的降级策略需先固定

**交付结果**
- Nebula 支持与其他后端等价的 `custom_properties` 对外能力。

## Phase 4: 统一读路径输出
- 在图谱详情、图谱查询、图谱导出使用的公共读路径增加归一化步骤。
- 对非 Nebula 后端：
  - 从顶层属性中剥离系统字段
  - 将剩余字段收拢为 `custom_properties`
- 对 Nebula：
  - 从 `custom_properties_json` 恢复 `custom_properties`
- API 最终返回统一结构：
  - 顶层系统字段
  - `custom_properties`

**交付结果**
- 所有后端对外 API 结构一致。

## Phase 5: WebUI 展示适配
- 属性面板保留现有系统字段展示逻辑。
- `custom_properties` 展开为独立属性列表展示。
- 对对象、数组做可读展示，不直接压成难读的一行 JSON。
- 保持现有可编辑字段范围不变：
  - `description`
  - `entity_id`
  - `entity_type`
  - `keywords`
- `custom_properties` 首轮只读，不做内联编辑。

**交付结果**
- WebUI 可直接查看导入的任意新字段。

## Phase 6: 回归测试与验收
- 后端测试覆盖：
  - 导入接口接受未知字段
  - 未知字段被收拢到 `custom_properties`
  - Nebula 写入与读取 JSON 正常
  - 非 Nebula 后端读路径输出也统一为 `custom_properties`
- 前端测试覆盖：
  - `custom_properties` 可见
  - 嵌套对象与数组展示稳定
  - 不影响现有属性面板和 Action Inspector

## 测试命令
- `rtk ./scripts/test.sh tests/test_graph_routes.py -v`
- `rtk ./scripts/test.sh tests/test_batch_graph_operations.py -v`
- `rtk ./scripts/test.sh tests/test_nebula_graph_storage.py -v`
- `rtk bash -lc 'cd lightrag_webui && bun test graphProperties ActionInspector -t custom_properties'`
- `rtk ruff check lightrag/lightrag.py lightrag/api/routers/graph_routes.py lightrag/api/graph_workbench.py lightrag/kg/nebula_impl.py tests/test_graph_routes.py tests/test_batch_graph_operations.py tests/test_nebula_graph_storage.py`

## 风险点
- `Nebula` schema 变更需要兼顾初始化、已有空间和测试建库流程。
- 若把 `name` 误当成自定义字段或再次用 `entity_id` 回填，会破坏 2026-04-27 已完成的 Nebula 语义对齐。
- 读路径归一化若散落在多个接口，后续容易漏改；应尽量收敛到共享辅助函数。
- 若把 `custom_properties` 混入检索文本，可能改变现有召回质量；首轮必须避免。
- 若 WebUI 直接平铺深层对象，属性面板可能过长；需要保留折叠或格式化展示能力。

## 不做事项
- 不改 `BaseGraphStorage` 抽象。
- 不统一重写 Neo4j / Mongo / OpenSearch / NetworkX / Postgres 的写入模型。
- 不做 `custom_properties` 的前端编辑。
- 不把任意新字段直接提升为顶层系统字段。
- 不处理旧数据迁移。

## 验收标准
- `/graph/import/custom-kg` 可接受实体和关系上的任意新字段。
- `/graph/import/custom-kg` 的实体可同时传 `entity_name` 和可选 `name`，且未传 `name` 时不会自动回填主标识。
- API 查询、详情、导出对外统一返回 `custom_properties`。
- WebUI 可展示 `custom_properties`。
- Nebula 不再因为固定 schema 丢失自定义字段。
- Nebula 在未传 `name` 时仍保持空字符串写入语义，前端继续通过 `entity_id` 回退显示。
- 非 Nebula 后端无需大改存储实现。
- 本次改造的主要冲突面控制在 API、Nebula 和 WebUI 图谱属性展示相关文件。

## 上游合并策略
- 优先把自定义逻辑收口到：
  - 导入层
  - 图谱读路径归一化层
  - Nebula 适配层
- 避免修改全局抽象和所有后端的公共行为。
- 若后续上游新增图谱属性能力，优先替换本地归一化逻辑，而不是继续扩大 fork 差异。

## 实施顺序建议
1. 先做字段归一化辅助函数。
2. 再改导入写路径。
3. 再改 Nebula 写读。
4. 再统一 API 出参。
5. 最后改 WebUI 和测试。

## 完成定义
- 后端测试通过。
- WebUI 属性展示测试通过。
- 对 Nebula 与至少一个非 Nebula 后端的结果结构完成人工核对。
- 计划执行后若系统边界发生变化，应评估是否需要重新运行 `nexus-mapper` 更新视图。
