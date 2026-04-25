# WebUI Bugfix And Optimization Plan

## Internal Grade Decision
M — 单个前端子系统内的多点修复，包含回归、工具链和性能优化。

## Goal
先恢复 WebUI 的测试与 lint 基线，再做首屏与重组件加载优化，避免后续开发建立在失真的质量状态上。

## Current Findings
- `bun test` 当前失败 3 项，集中在 `Tabs` 与 `WorkspaceSwitcher` 的 SSR/字符串渲染路径。
- `bun run lint` 当前因 `@stylistic/eslint-plugin` 解析失败而不可用。
- `bun run build` 可通过，但产物已出现大包告警；`vendor-markdown`、`index` 主包体积偏大。

## File Map

### Modify
- `lightrag_webui/src/components/ui/Tabs.tsx`
- `lightrag_webui/src/components/ui/Tabs.test.tsx`
- `lightrag_webui/src/components/workspace/WorkspaceSwitcher.tsx`
- `lightrag_webui/src/components/workspace/WorkspaceSwitcher.test.tsx`
- `lightrag_webui/eslint.config.js`
- `lightrag_webui/package.json`
- `lightrag_webui/src/App.tsx`
- `lightrag_webui/src/components/retrieval/ChatMessage.tsx`

### Verify Against
- `lightrag_webui/src/components/workspace/WorkspaceManagerDialog.tsx`
- `lightrag_webui/src/features/GraphViewer.tsx`
- `lightrag_webui/src/features/RetrievalTesting.tsx`
- `lightrag_webui/src/api/lightrag.test.ts`
- `lightrag_webui/src/features/PromptManagement.test.tsx`

## Ownership Boundaries
- 只处理 WebUI 自身问题，不改后端 API 契约。
- 先修质量基线，再做性能拆分；不把两类问题混成一次大重构。
- 性能优化优先使用懒加载和动态导入，避免改动业务语义。

## Wave 1: 恢复测试基线
- [ ] 修复 `Tabs` 的 SSR/测试递归问题。
- [ ] 确认 `TabsContent` 在 inactive 状态仍保留 `hidden` 语义，不引入布局回流。
- [ ] 修复 `WorkspaceSwitcher` 的字符串渲染兼容性，避免测试因对话框依赖导致栈溢出。
- [ ] 补充或调整对应回归测试，确保失败用例稳定转绿。

## Wave 2: 恢复 lint 基线
- [ ] 查明 `@stylistic/eslint-plugin` 解析失败是依赖缺失、Bun 安装行为还是配置兼容问题。
- [ ] 修复 `eslint.config.js` 或依赖声明，使 `bun run lint` 可执行。
- [ ] 确认修复不会破坏现有 TS/React 规则集。

## Wave 3: 首屏性能优化
- [ ] 将 `App.tsx` 中的重页面改为按 tab 懒加载。
- [ ] 优先拆分 `RetrievalTesting`、`GraphViewer`、`PromptManagement` 等重页面。
- [ ] 保持当前 tab 切换与默认首屏行为不变。
- [ ] 重新构建并记录 chunk 变化，确认大包告警下降或主包缩小。

## Wave 4: 检索消息渲染优化
- [ ] 将 `ChatMessage.tsx` 中 markdown、KaTeX、Mermaid、代码高亮相关重依赖延迟加载。
- [ ] 保持流式输出、Mermaid 渲染和 LaTeX 渲染现有功能不回退。
- [ ] 避免引入新的闪烁、重复渲染或 hydration/SSR 兼容问题。

## Verification Commands
- `rtk bun test`
- `rtk bun run lint`
- `rtk bun run build`

## Delivery Acceptance Plan
- `bun test` 全绿。
- `bun run lint` 可正常执行并通过。
- `bun run build` 仍通过，且首屏相关主包体积有下降或 chunk 拆分更合理。
- WebUI 主导航、工作区切换、检索页消息渲染、图谱页加载不出现功能回退。

## Rollback Rules
- 若 `Tabs` 修复影响 tab 保活语义，优先保留保活，再改测试实现。
- 若 `WorkspaceSwitcher` 修复需要绕开重量级对话框，使用惰性挂载，不直接删功能。
- 若性能拆分导致交互闪烁或状态丢失，先回退拆分点，再缩小懒加载范围。

## Completion Language Rules
仅在代码改动完成且 `bun test`、`bun run lint`、`bun run build` 都验证后，才能宣告完成。
