# Retrieval Page Optimization Plan

## Internal Grade Decision
M — 单个前端子系统内的链路、交互、展示与测试补强，部分任务可能牵涉 API 契约调整。

## Goal
降低检索页单次查询的额外开销，收紧参数输入质量，提升引用与调试数据的可读性，并补齐核心回归测试。

## Current Findings
- 当前一次检索通常会先走 `/query` 或 `/query/stream`，结束后再补打一遍 `/query/data`，存在重复召回与重复 rerank 风险。
- 当用户选择非 `active` 的 retrieval prompt 版本时，提交前还会额外请求一次版本详情，导致查询链路变长。
- 数值参数直接写入持久化 store，编辑中可能写入 `''` 或 `0` 这类无效值。
- 检索页实际依赖 `history_turns`、`include_references` 等参数，但页面没有完整暴露这些控制项。
- references 与 retrieval data 区当前偏“原始回显”，对大结果集的可读性与性能保护都不够。
- 当前缺少针对 `RetrievalTesting` 主流程的专门测试覆盖。

## File Map

### Modify
- `lightrag_webui/src/features/RetrievalTesting.tsx`
- `lightrag_webui/src/components/retrieval/QuerySettings.tsx`
- `lightrag_webui/src/components/retrieval/RetrievalPromptVersionSelector.tsx`
- `lightrag_webui/src/components/retrieval/PromptOverridesEditor.tsx`
- `lightrag_webui/src/api/lightrag.ts`
- `lightrag_webui/src/stores/settings.ts`
- `lightrag_webui/src/locales/en.json`
- `lightrag_webui/src/locales/zh.json`

### Create
- `lightrag_webui/src/features/RetrievalTesting.test.tsx`
- `lightrag_webui/src/components/retrieval/QuerySettings.test.tsx`
- `lightrag_webui/src/utils/retrievalPromptCache.ts`

### Verify Against
- `lightrag_webui/src/api/lightrag.test.ts`
- `lightrag_webui/src/components/retrieval/RetrievalPromptVersionSelector.test.ts`
- `lightrag_webui/src/utils/promptOverrides.test.ts`
- `lightrag_webui/src/utils/promptVersioning.test.ts`

## Ownership Boundaries
- 优先保持现有 `RetrievalTesting + QuerySettings + Zustand + lightrag.ts` 架构不变。
- 前端能独立落地的优化先做，不先引入大规模页面拆分。
- 若要合并 `/query` 与 `/query/data` 契约，必须明确区分“前端降本方案”和“需要后端配合的增强方案”。
- 不修改检索语义本身，只优化请求次数、状态建模、参数输入与结果展示。

## Wave 1: 压缩检索请求链路
- [ ] 评估 `/query/data` 改为按需加载的前端方案，默认不在每次检索结束后自动请求。
- [ ] 设计 retrieval data 的懒加载触发点，只在用户展开调试区时请求。
- [ ] 若后端可配合，补一版“主查询直接返回调试数据”的候选契约，避免双请求。
- [ ] 为非 `active` prompt version 增加预取或缓存，避免提交时额外等待版本详情接口。
- [ ] 保证流式与非流式路径都使用同一套请求保护逻辑，避免旧请求覆盖新状态。

## Wave 2: 收紧参数输入与状态可见性
- [ ] 将 `top_k`、`chunk_top_k`、`max_entity_tokens`、`max_relation_tokens`、`max_total_tokens` 改为本地草稿态。
- [ ] 在 `blur` 或提交前统一做数值校验、回填默认值与最小值裁剪。
- [ ] 为 `history_turns`、`include_references` 增加显式控件，避免隐藏状态影响结果。
- [ ] 重新梳理 `only_need_context`、`only_need_prompt`、`stream`、`include_chunk_content` 的互斥或依赖关系。
- [ ] 确保参数面板改动不会破坏现有本地持久化迁移。

## Wave 3: 优化结果区可读性与渲染成本
- [ ] 调整 references 展示，支持多 snippet 展开，不再只显示首段内容。
- [ ] 为 retrieval data 区增加懒加载、分页、截断或虚拟渲染中的至少一种保护。
- [ ] 为 entities、relationships、chunks、references 四类结果提供更稳定的空态和计数提示。
- [ ] 保持复制、流式增量渲染、thinking 展示和引用回填不回退。

## Wave 4: 补齐回归测试
- [ ] 为 `RetrievalTesting` 增加流式、非流式、abort、错误态、references 更新测试。
- [ ] 为 `RetrievalTesting` 增加“retrieval data 按需加载”测试，防止恢复成自动双请求。
- [ ] 为 `QuerySettings` 增加数值输入校验与互斥开关测试。
- [ ] 为 prompt version 切换补缓存命中与回退行为测试。
- [ ] 同步补 `lightrag.ts` 中相关 API helper 的测试。

## Verification Commands
- `rtk bash -lc 'cd lightrag_webui && bun test src/features/RetrievalTesting.test.tsx src/components/retrieval/QuerySettings.test.tsx src/api/lightrag.test.ts src/components/retrieval/RetrievalPromptVersionSelector.test.ts'`
- `rtk bash -lc 'cd lightrag_webui && bun run build'`

## Delivery Acceptance Plan
- 检索页默认一次查询不再自动触发第二次 `/query/data` 请求。
- 非 `active` prompt version 的提交流程不再额外阻塞一次详情拉取，或该请求已被本地缓存命中。
- 参数输入不会把明显非法值直接写入持久化 store。
- 用户能在页面上显式理解并控制影响检索行为的关键参数。
- references 与 retrieval data 在大结果集下仍可读，且不会明显拖慢页面。
- 新增测试覆盖核心交互链路，避免回归。

## Rollback Rules
- 若 `/query/data` 懒加载导致调试体验割裂，保留开关能力，但不要恢复为默认自动双请求。
- 若 prompt version 缓存引入脏数据风险，优先缩短缓存生命周期，不回退到每次提交现拉。
- 若结果区渲染优化影响信息完整性，优先保留完整数据，再缩小性能优化范围。

## Completion Language Rules
仅在检索主链路、参数面板、结果区和对应测试都验证后，才能宣告完成。
