---
title: "收敛为 Bad Case First 治理工作台"
type: "refactor"
status: active
date: "2026-08-23"
origin: "inline-spec"
depth: "Standard"
---

## Overview

本计划落实已批准的 Bad Case First 架构：移除前台独立的运行发现入口，把 Bad Case 列表作为唯一治理主入口，同时保留后台 Delivery Unit/Session 索引作为自动采集、精确关联和证据读取底座。Bad Case 详情将按需展示关联 Session 的完整时间线，并保留现有确认、驳回、归因和 Evidence 资产化链路。

## Problem Frame

当前工作台先让用户浏览全部运行，再人工寻找可能的问题交付，这与“自动采集 Bad Case”目标不一致。运行全集会混淆观察数据和治理数据，且当前 Bad Case 详情只能看到有限的 Delivery Context，无法核查完整 Session。系统需要把前台操作收敛到已满足准入条件的 Bad Case，同时把运行索引退回后台关联和诊断职责。

## Requirements Trace

- **R1**：前台不再以全部运行记录作为主治理入口，Bad Case 列表成为唯一主入口。
- **R2**：后台继续保留 Delivery Unit/Session 索引、稳定引用和 Skill 归属，用于自动采集关联和取证。
- **R3**：自动采集案例必须能在 Bad Case 列表中展示用户反馈、AI 识别原因、关联 Skill、来源和治理状态。
- **R4**：Bad Case 详情按需打开完整 Session 上下文，并高亮触发反馈对应的上一轮交付。
- **R5**：自动案例只进入待确认状态，现有人工治理状态机和人工补录继续可用。
- **R6**：采集失败、关联失败和索引降级必须可诊断，但不占据生产治理主流程。

## Scope Boundaries

### In Scope

- 增加按 `deliveryRef` 读取完整 Session 时间线的后台服务和 API。
- 扩展 Bad Case 详情数据，使自动案例可打开完整上下文并显示关联状态。
- 将 Bad Case 列表升级为自动候选优先的治理入口，保留人工补录和现有状态操作。
- 从主导航移除运行发现，并对旧 `/runs` 路由提供兼容跳转或低优先级诊断入口。
- 在总览或诊断区域展示采集事件、关联失败和索引降级状态。
- 添加后台、前台和端到端合同测试，覆盖真实反馈案例。

### Out of Scope

- 删除 Delivery Unit、Session 索引器或本地 JSONL 读取能力；这些属于后台基础设施。
- 在后台引入第二个模型重新评价上一轮交付；反馈判定仍由对话层完成。
- 自动确认、自动归因、自动生成 Evidence 或修改 Skill；这些属于后续治理阶段。
- 将完整 Session 原文复制进 SQLite、Git 或 `record_bad_case` 工具参数；继续按需读取。

## Context & Research

- 已批准架构见 `docs/plans/2026-08-23-bad-case-first-workbench-design.md`。
- `server/src/services/delivery-unit-indexer.ts` 已能按任务边界生成稳定 Delivery Unit，并关联下一轮反馈和实际 Skill。
- `server/src/services/capture-service.ts` 已提供幂等自动采集和失败关闭能力；`server/src/services/bad-case-service.ts` 已提供完整治理状态机。
- `server/src/app.ts` 已暴露 Delivery Unit 详情和自动采集端点，但尚未提供完整 Session 时间线接口。
- `pc/src/pages/BadCasesPage.tsx` 与 `pc/src/components/BadCaseDetail.tsx` 已有列表、Drawer 和治理动作，可在现有形态上扩展。
- `pc/src/layouts/MainLayout.tsx` 与 `pc/src/App.tsx` 仍把 RunsPage 作为一级主导航和路由。
- 仓库没有 `docs/solutions/`，暂无可复用的历史解决方案文档。

## Key Technical Decisions

1. **保留索引、移除主入口**：运行索引对自动关联不可替代，但把完整运行全集放在主导航会制造噪声；采用后台保留、前台收敛。
2. **新增按引用读取的 Session Context 服务**：复用现有 JSONL 流式解析和 `deliveryRef` 关联，避免复制长上下文或按时间猜测。
3. **详情使用时间线而非大段文本**：按事件类型、轮次和 Skill 读取分组展示，突出触发交付并保持可扫描性。
4. **旧 `/runs` 保持兼容但不进入主导航**：减少书签和外部链接回归风险，同时避免继续把运行发现当作日常入口。
5. **诊断与治理分离**：采集事件和索引降级只在总览/诊断区域呈现，不改变生产对话或 Bad Case 状态机。

## Open Questions

### Resolved During Planning

- Q1. 是否删除后台运行索引？**Resolved**：不删除；它是自动采集的关联和证据底座。
- Q2. 前台主入口是什么？**Resolved**：Bad Case 列表，运行发现退出一级导航。
- Q3. 完整上下文如何关联？**Resolved**：通过稳定 `deliveryRef` 按需读取本地 Session JSONL。
- Q4. 自动案例状态是否改变？**Resolved**：继续从 `pending_confirmation` 开始，人工确认后才进入后续状态。

### Deferred to Implementation

- Q5. [U1] Session 时间线保留哪些事件类型、每类事件的摘要长度和敏感字段过滤规则？由解析单元基于现有 JSONL 夹具冻结。
- Q6. [U3] `/runs` 采用跳转到 `/bad-cases` 还是保留只读诊断视图？由前端兼容性测试决定最小方案。
- Q7. [U4] 诊断数据放在总览卡片还是独立低优先级页面？由现有 Overview 信息密度和响应数据决定。

## Implementation Units

- [ ] U1. **构建完整 Session Context 索引与读取契约**
  **Goal:** 后台可根据 `deliveryRef` 返回关联 Session 的结构化时间线，并标识触发交付和反馈轮次。
  **Requirements:** [R2, R4]
  **Dependencies:** None
  **Files:** Create/Modify/Test `server/src/domain/types.ts`, `server/src/services/session-context-indexer.ts`, `server/src/services/session-context-indexer.test.ts`, `server/src/services/delivery-unit-indexer.ts`
  **Approach:** 复用现有 JSONL 流式读取和任务边界解析，新增结构化 Session Context 模型。按轮次输出用户消息、最终交付、Skill 读取、任务边界和必要工具事件，限制单事件摘要长度并跳过损坏行；无法精确关联时返回明确错误而不是降级到时间猜测。
  **Test scenarios:** 单线程多轮时间线；触发交付高亮；Skill 读取归属；损坏日志和缺失轮次；长消息截断与原文详情读取边界。
  **Verification:** `npm run test -w server -- session-context-indexer.test.ts delivery-unit-indexer.test.ts`

- [ ] U2. **暴露 Bad Case 关联上下文 API**
  **Goal:** Bad Case 详情能够通过 `deliveryRef` 按需取得完整 Session Context，并在源日志不可用时返回可诊断错误。
  **Requirements:** [R2, R3, R4, R6]
  **Dependencies:** U1
  **Files:** Modify `server/src/app.ts`, `server/src/app.test.ts`, `server/src/domain/types.ts`, `pc/src/api.ts`, `pc/src/types.ts`, `pc/src/api.test.ts`
  **Approach:** 在现有 Delivery Unit 详情契约旁增加 Session Context 读取端点，或将上下文作为详情的懒加载资源。响应只返回结构化事件和关联元数据，不改变自动采集写入契约；错误映射区分 delivery 不存在、源文件不可用和上下文解析失败。
  **Test scenarios:** 有效引用返回时间线；跨线程同轮次不串联；缺失源文件；无效 deliveryRef；API 长文本不在列表响应中出现。
  **Verification:** `npm run test -w server -- app.test.ts && npm run test -w pc -- api.test.ts`

- [ ] U3. **收敛 Bad Case 前台与 Session 时间线详情**
  **Goal:** 用户从 Bad Case 列表直接完成核查和治理，不再需要先进入运行发现。
  **Requirements:** [R1, R3, R4, R5]
  **Dependencies:** U2
  **Files:** Modify `pc/src/App.tsx`, `pc/src/layouts/MainLayout.tsx`, `pc/src/pages/BadCasesPage.tsx`, `pc/src/components/BadCaseDetail.tsx`, `pc/src/pages/BadCasesPage.test.tsx`, `pc/src/components/BadCaseDetail.test.tsx`, `pc/src/styles.css`
  **Approach:** 移除 RunsPage 一级导航，保留 `/runs` 兼容跳转或诊断入口。Bad Case 列表突出自动候选的反馈、AI 原因、Skill 和状态；详情 Drawer 增加 Session 时间线，按轮次分组并高亮触发交付，同时保留确认、驳回、编辑、归因和资产化动作。人工案例没有 deliveryRef 时显示明确的“无关联上下文”。
  **Test scenarios:** 自动案例列表展示完整信号；详情成功加载时间线；加载失败不阻断治理；人工案例兼容；旧 `/runs` 链接；窄屏 Drawer 不溢出。
  **Verification:** `npm run test -w pc && npm run build -w pc`

- [ ] U4. **增加后台采集诊断视图和状态契约**
  **Goal:** 用户能判断自动采集是“没有触发”还是“触发后关联失败”，且诊断信息不进入生产对话。
  **Requirements:** [R5, R6]
  **Dependencies:** U2
  **Files:** Modify `server/src/app.ts`, `server/src/domain/types.ts`, `pc/src/pages/OverviewPage.tsx`, `pc/src/types.ts`, `pc/src/api.ts`, `server/src/app.test.ts`, `pc/src/pages/OverviewPage.test.tsx`
  **Approach:** 复用 `capture_events` 和现有 Dashboard 聚合，提供最近采集事件、失败原因、outbox/服务状态和索引降级计数的摘要。诊断只读、不改变 Bad Case 状态，不展示完整会话原文；前台使用低干扰的状态卡或折叠区域。
  **Test scenarios:** 捕获成功、重复、关联失败和源不可用；无事件空态；诊断接口异常；总览不播报治理状态到生产对话。
  **Verification:** `npm run test -w server -- app.test.ts && npm run test -w pc -- OverviewPage.test.tsx`

- [ ] U5. **完成 Bad Case First 回归验证与文档同步**
  **Goal:** 证明自动候选、完整上下文、旧入口兼容和治理状态机在收敛后的工作台中保持一致。
  **Requirements:** [R1, R3, R4, R5, R6]
  **Dependencies:** U3, U4, external: registered record_bad_case MCP and prompt-first runtime trial
  **Files:** Modify `governance/evaluation/feedback-capture-cases.json`, `docs/validation/prompt-first-bad-case-capture-pilot.md`, `README.md`, `server/src/services/capture-service.test.ts`, `pc/src/pages/BadCasesPage.test.tsx`
  **Approach:** 扩展合成矩阵和页面合同，覆盖明确负反馈、非负反馈、模糊反馈、完整上下文读取失败和诊断事件。重跑自动化测试后，用一条真实 Skill 对话验证工具触发、列表入场、Session 时间线和零治理播报；真实 MCP 未安装时明确记录为阻塞，不把历史日志补录当作真实触发率。
  **Test scenarios:** 负反馈进入列表；补充/继续/新任务不进入；关联准确率；详情完整性；采集故障不影响回答；旧 `/runs` 跳转；人工治理回归。
  **Verification:** `npm test && npm run build && git diff --check`

### Parallel Execution Plan

```text
Wave 1 (zero deps):
  └── U1  Session Context 索引

Wave 2 (after U1):
  └── U2  Bad Case 上下文 API

Wave 3 (after U2, parallel):
  ├── U3  Bad Case 前台与时间线
  └── U4  采集诊断

Wave 4 (after U3 and U4):
  └── U5  回归验证与文档同步

Critical path: U1 → U2 → U3 → U5
Max parallelism: 2 (Wave 3)
```

## System-Wide Impact

- **Navigation:** `pc/src/layouts/MainLayout.tsx` 和 `pc/src/App.tsx` 的主导航与 `/runs` 兼容策略改变。
- **API:** 新增 Session Context 读取契约和诊断摘要契约；现有自动采集端点保持兼容。
- **Data:** 不新增必须迁移的 Bad Case 字段；继续使用 `delivery_ref`、`source_path` 和 `capture_events`。
- **Privacy:** 完整 Session 只读本地 JSONL，详情按需读取，不写入 Git、SQLite 长文本或工具参数。
- **Shared touch points:** `server/src/domain/types.ts`、`server/src/app.ts`、`pc/src/types.ts`、`pc/src/api.ts` 同时被 API 与前台单元使用。
- **Compatibility:** 旧 `/runs` 链接不直接 404；人工 Bad Case 无关联上下文时仍可完成原有治理动作。

## Risks & Dependencies

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| RK1 | 完整 Session 时间线读取放大响应或暴露过多原文 | Medium | High | 按需读取、事件摘要截断、详情分段加载，列表不携带原文 |
| RK2 | 移除 Runs 导航后自动采集失败难以发现 | Medium | High | 总览诊断卡、capture_events 状态和旧 API 保留 |
| RK3 | Session 日志格式变体导致上下文缺失 | High | High | 复用夹具、失败关闭、上下文缺失不阻断 Bad Case 治理 |
| RK4 | 真实 Codex 未安装 MCP/提示词，无法验证触发 | High | High | U5 明确依赖真实运行时安装；自动化矩阵不得替代真实指标 |
| RK5 | 旧书签仍访问 `/runs` | Low | Medium | 保留兼容路由并提供明确跳转，不删除后台端点 |

- 依赖本地 Codex JSONL 会话可读。
- 依赖本地治理 API、SQLite 和 `capture_events` 可用。
- U5 依赖正式注册 `record_bad_case` MCP、提示片段和可用的线程/轮次元数据桥接。

## Sources & References

1. `docs/plans/2026-08-23-bad-case-first-workbench-design.md`
2. `docs/plans/2026-08-22-prompt-first-bad-case-capture-design.md`
3. `docs/plans/2026-08-22-001-feature-prompt-first-bad-case-capture-plan.md`
4. `server/src/services/delivery-unit-indexer.ts`
5. `server/src/services/capture-service.ts`
6. `server/src/services/bad-case-service.ts`
7. `server/src/app.ts`
8. `pc/src/pages/BadCasesPage.tsx`
9. `pc/src/components/BadCaseDetail.tsx`

## Completion Status

`DONE_WITH_CONCERNS`

### Execution Log (2026-08-23)

**Waves executed:** W1 (U1) · W2 (U2) · W3 (U3, U4) · W4 (U5)
**Artifacts:** `server/src/services/session-context-indexer.ts`, `server/src/app.ts`, `pc/src/pages/BadCasesPage.tsx`, `pc/src/components/BadCaseDetail.tsx`, `pc/src/pages/OverviewPage.tsx`, `adapter/src/index.ts`, `README.md`, `docs/validation/prompt-first-bad-case-capture-pilot.md`
**Oracle verdict:** PASS - Bad Case First 前台、上下文 API、诊断和组合集成已完成；真实桌面自动采集仍有运行时风险。
**Concerns:**

- 真实模型 2/2 识别负反馈并发起 `record_bad_case`，但非交互 Codex 审批 2/2 取消，模型进程内持久化仍为 0/2。
- 工具审批取消、`runtime_context_unavailable` 等进入后台 API 之前的失败尚未进入工作台诊断。
- MCP 运行时根目录未固定为绝对路径，跨项目会话可能造成 context/outbox 路径漂移。
- `degradedCount` 混入正常无 Skill 轮次和未完成轮次，诊断噪声偏高；Session 事件的 `truncated` 标志也可能仅因摘要截断而误报。
