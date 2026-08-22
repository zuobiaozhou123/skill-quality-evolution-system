---
title: Bad Case First 治理工作台架构设计
date: 2026-08-23
status: approved
scope: bad-case-first-governance-workbench
---

# Bad Case First 治理工作台架构设计

## 1. 目标

第一阶段的核心目标是自动采集用户明确指出的 Skill 交付问题，并让用户在一个入口中完成核查、确认、归因和后续证据治理。前台不再要求用户先浏览全部运行记录，再人工寻找 Bad Case。

## 2. 核心决策

1. **移除前台独立的“运行发现”主入口**：运行发现不是自动采集 Bad Case 的必要用户流程，继续展示全部 Delivery Unit 会增加噪声并混淆观察数据与治理数据。
2. **保留后台运行索引**：Delivery Unit、Session 索引、稳定 `deliveryRef`、Skill 归属和按需读取能力继续存在，作为自动采集的关联与取证底座。
3. **Bad Case 成为前台治理主入口**：只有满足自动采集条件或人工补录条件的案例进入 Bad Case 列表。
4. **详情页承载完整 Session 上下文**：Bad Case 通过 `deliveryRef` 打开关联 Session 时间线，并高亮触发反馈对应的上一轮 Skill 交付。
5. **诊断能力后台化**：采集事件、关联失败、outbox 和运行索引诊断不进入主导航，但必须保留可访问的低优先级诊断入口或 API。

## 3. 目标数据流

```text
Codex 会话日志
  ↓
后台 Delivery Unit / Session 索引
  ↓（仅提供稳定引用与 Skill 证据）
下一轮用户反馈
  ↓
当前 AI 按精简提示识别明确否定、纠错或返工
  ↓
record_bad_case（精简失败原因）
  ↓
后台精确关联上一轮 Delivery Unit、去重、持久化
  ↓
Bad Case 列表（pending_confirmation）
  ↓
Bad Case 详情：用户反馈 + AI 原因 + 完整 Session 时间线
  ↓
确认 / 驳回 / 归因 / Evidence 资产化
```

## 4. Bad Case 自动准入

自动采集必须同时满足：

- 上一轮有完整任务边界和最终交付；
- 上一轮实际读取或调用过 Skill；
- 用户已经发起下一轮沟通；
- 当前 AI 识别为明确否定、纠错或返工；
- AI 能从用户原话概括具体失败点；
- 工具和后台能通过稳定 `deliveryRef` 精确关联上一轮。

补充要求、继续推进、认可结果、新任务和无法确认的不满默认不创建候选。关联失败必须只记录诊断事件，不写入 Bad Case。

自动采集只创建 `pending_confirmation`，不直接确认、归因、资产化或修改 Skill。人工创建入口继续保留，作为补录和采集异常时的兜底。

## 5. Bad Case 列表

列表只展示 Bad Case 对象，不展示全部运行。核心字段包括：

- 标题、问题摘要和创建时间；
- 用户原始反馈；
- AI 识别出的失败原因；
- 上一轮实际使用的 Skill；
- 自动采集或人工提交来源；
- 当前治理状态；
- 是否存在可打开的关联 Session。

列表支持按状态、来源和 Skill 筛选。没有案例时明确展示“暂无 Bad Case”，不再用“暂无反馈”代替案例状态。

## 6. 完整 Session 详情

Bad Case 详情通过 `deliveryRef` 懒加载关联上下文，不把长文本复制进列表或自动采集工具参数。详情时间线至少展示：

- 当前案例对应的上一轮用户请求；
- 上一轮 AI 最终交付；
- 用户下一轮反馈；
- 实际读取的 Skill；
- 同一 Session 前后相关轮次；
- 关键工具调用、工具结果和任务边界；
- 当前案例与触发轮次的明确关联。

Session 原文继续只读本地 JSONL，不进入 Git 或自动生成的 Evidence。读取失败时详情明确显示上下文不可用，但不影响 Bad Case 的确认或驳回操作。

## 7. 导航与模块调整

- 主导航移除“运行发现”。
- Bad Case 页面承担候选列表、筛选、详情和治理动作。
- 总览保留自动候选数量、采集失败数量和采集健康状态。
- 后台保留 `/api/delivery-units`、`/api/delivery-units/:deliveryRef` 和诊断数据接口，供详情、测试和故障排查使用。
- 旧 Session API 暂时保留兼容，不作为前台主入口。

## 8. 成功标准

- 明确负反馈能够在真实对话中触发 `record_bad_case`，并在 Bad Case 列表出现待确认案例。
- 每个自动案例都能打开关联的请求、交付、Skill、用户反馈和完整 Session 时间线。
- 自动案例的 Delivery Unit 关联准确率为 100%。
- 补充、继续、认可、新任务不会进入 Bad Case 列表。
- 采集失败不影响生产回答，并可在诊断区域定位原因。
- 用户不需要先浏览全部运行记录才能完成 Bad Case 治理。

## 9. 非目标

- 删除后台 Delivery Unit 或 Session 索引器。
- 在后台新增一个独立模型对上一轮交付做二次质检。
- 自动确认 Bad Case、自动归因或自动修改 Skill。
- 将完整 Session 原文复制到 SQLite、Git 或工具上下文。

