# 任务计划：上游大版本合并后二次开发冲突审计

## 目标
基于当前集成分支，系统检查本地二次开发能力与本次 upstream 大版本更新之间的冲突、契约漂移和回归风险，并输出模块级处理清单。

## 当前阶段
阶段 3

## 各阶段

### 阶段 1：基线取证
- [x] 记录当前分支、工作区脏状态和未提交文件
- [x] 确认上游 authority remote、merge base 和 merge 提交
- [x] 汇总已有兼容性分析、SOP 和上次 merge 计划
- [x] 将发现记录到 findings.md
- **状态：** complete

### 阶段 2：审计计划
- [x] 确定审计对象与兼容边界
- [x] 拆分高风险模块和验证入口
- [x] 写出正式计划到 `docs/aegis/plans/2026-05-22-post-merge-custom-conflict-audit.md`
- **状态：** complete

### 阶段 3：执行冲突审计
- [ ] 在独立 worktree 中冻结审计现场
- [ ] 重建二次开发 inventory 和 merge 后补丁清单
- [ ] 按模块输出风险矩阵和冲突结论
- **状态：** in_progress

### 阶段 4：定向验证
- [ ] 跑后端高风险测试
- [ ] 跑前端关键测试和构建
- [ ] 将验证结果记录到 progress.md
- **状态：** pending

### 阶段 5：交付清单
- [ ] 输出 `docs/analysis/2026-05-22-post-merge-custom-conflict-audit.md`
- [ ] 标注修复轨与退役轨
- [ ] 给出下一步执行顺序
- **状态：** pending

## 关键问题
1. 哪些本地 owner 必须保留，不能被 upstream 平台化改动覆盖？
2. 哪些文件虽然已自动合并，但仍存在 silent conflict 或契约漂移？

## 已做决策
| 决策 | 理由 |
|------|------|
| 审计以 `upstream/main` 为平台能力 authority | 本次更新来自 upstream 大版本，pipeline/parser/chunker/role-llm 等应先以 upstream 行为为准 |
| 本地 `workspace`、`graph workbench`、`custom-chunks`、`workspace runtime` 作为重点保留 owner | merge 后补回提交集中落在这些区域，说明它们是本地产品化差异核心 |
| Prompt Management 保持退役，不纳入本轮保留范围 | 现有 merge 计划和兼容性报告已明确该能力回归 upstream prompt profile 机制 |
| 审计执行必须在独立 worktree 中进行 | 当前工作区有未提交修改，不能把现场污染进冲突判定 |

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| 无 | 0 | 无 |

## 备注
- 执行阶段开始前先重新读取本文件、`findings.md` 和 `progress.md`
- 若新增审计模块，直接在阶段 3/4/5 下补项，不另起散乱文档
