# Workspace Management Hardening Plan

> 目标：修正当前工作区管理中的一致性、性能和可运维性问题，降低半初始化状态、误导性状态展示和运行时抖动风险。

## 背景

当前工作区管理已具备创建、切换、软删除、硬删除、恢复和统计展示能力，但实现上仍有三类明显短板：

1. 创建流程不是原子操作，注册成功后初始化失败会留下状态不完整的 workspace。
2. 新 workspace 的 prompt seed 语言被硬编码为 `zh`，与实例语言或用户初始化语言可能不一致。
3. WebUI 工作区管理弹窗会主动拉取所有 ready workspace 的 stats，间接触发运行时预热，导致打开弹窗的成本过高。

## 范围

- 后端：`lightrag/api/workspace_registry.py`
- 路由：`lightrag/api/routers/workspace_routes.py`
- 服务编排：`lightrag/api/lightrag_server.py`
- 前端：`lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
- 测试：`tests/test_workspace_management_routes.py`、相关 WebUI Vitest

## 改进计划

### P0：创建流程原子化

目标：避免创建失败后留下 `ready` 但资源未初始化完成的 workspace。

- 给 workspace 增加显式创建中/创建失败状态，例如 `creating`、`create_failed`
- 将创建流程拆成“注册记录”与“资源初始化”两个阶段
- 仅在初始化全部成功后切换到 `ready`
- 初始化失败时记录错误原因，并提供明确的重试或回滚路径
- 路由层返回稳定错误语义，避免前端把初始化失败误解为网络错误

验收：

- 初始化失败后，`list_workspaces` 不会把该 workspace 当成 `ready`
- 重试初始化或删除失败 workspace 有明确状态流转
- 新增后端测试覆盖创建成功、初始化失败、重复重试三条路径

### P1：统一 prompt seed 初始化策略

目标：让新 workspace 的默认 prompt 配置与实例语言策略一致。

- 移除 `initialize_workspace_assets()` 中硬编码的 `locale="zh"`
- 优先使用实例默认语言或显式传入语言初始化 prompt seed
- 明确“首次创建时初始化”和“手动 `/prompt-config/initialize`”之间的职责边界
- 补充文档，说明新 workspace 的 prompt seed 来源

验收：

- 英文实例创建 workspace 后，默认 seed 为英文
- 手动初始化不会无意覆盖已有 seed
- 测试覆盖 `en`、`zh` 至少两种 locale

### P1：降低 stats 拉取成本

目标：避免工作区管理弹窗把查看列表放大成批量运行时预热。

- 前端改为懒加载 stats，只对可见项、展开项或当前 workspace 拉取
- 对 stats 请求增加并发上限，避免一次性并发打满
- 后端将轻量统计与重运行时统计分层
- 能直接从 registry 或本地元数据得到的字段，不再通过 `acquire_runtime()` 获取
- 为高成本统计增加缓存或后台刷新策略

验收：

- 打开弹窗时，请求数与当前可视项数量近似，而不是所有 workspace 总数
- 大量 workspace 场景下，弹窗首屏时间明显下降
- 不再因查看 stats 触发大规模 runtime 缓存抖动

### P2：补足可观测性与运维语义

目标：让失败状态可定位、可恢复、可审计。

- 为创建失败、硬删除失败、stats 获取失败增加结构化日志
- 在 operation 或 workspace 详情中暴露最近一次失败原因
- 区分“暂不可用”“后端不支持”“正在初始化”三类状态
- 在前端统一映射错误提示，减少原始异常直接透出

验收：

- 运维可以从日志直接判断失败阶段
- 前端能区分权限问题、状态流转问题和内部错误

## 执行顺序

1. 先做 P0，先解决错误状态写入问题。
2. 再做 prompt seed 初始化策略统一。
3. 然后收敛 stats 拉取模型。
4. 最后补可观测性和错误语义。

## 测试计划

- 后端：
  - `./scripts/test.sh tests/test_workspace_management_routes.py tests/test_workspace_registry_store.py -q`
- 前端：
  - `cd lightrag_webui && bun test WorkspaceManagerDialog`
- 新增场景：
  - 创建后初始化失败不会进入 `ready`
  - locale 不同的 workspace seed 初始化正确
  - 多 workspace 场景下 stats 懒加载与节流生效

## 风险

- 引入新状态后，现有前端筛选逻辑需要同步更新
- 创建失败可重试后，需避免和硬删除状态机冲突
- stats 改懒加载后，列表展示需要接受短暂的占位状态

## 产出物

- 状态机收敛后的后端实现
- 对应回归测试
- 工作区管理交互与 stats 拉取策略更新
- README / API 文档按实际行为补充说明
