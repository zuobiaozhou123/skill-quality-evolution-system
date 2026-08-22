---
title: "落地 Prompt-first Bad Case 自动采集闭环"
type: "feat"
status: active
date: "2026-08-22"
origin: "inline-spec"
depth: "Deep"
---

## Overview

本计划落实已批准的 Prompt-first Bad Case 自动采集设计：把运行发现从会话摘要升级为 Delivery Unit，以用户下一轮反馈触发静默采集，并复用现有待确认、归因和 Evidence 状态机。第一阶段只覆盖个人本机 Codex，交付全局提示规则、本地记录工具、后台关联逻辑和可判断的工作台，不进入 Skill 候选优化与正式插件发布。

## Problem Frame

现有 V0 主要依赖用户离开生产对话后，从粗粒度会话摘要中人工标记 Bad Case。这个入口既看不到完整请求和交付，也无法持续捕捉自然发生的纠错与返工反馈。新闭环必须在不打断主任务、不复制长上下文、不把普通 AI 质量问题混入 Skill 治理的前提下，将明确负反馈可靠关联到上一轮实际使用 Skill 的交付。

## Requirements Trace

以下 R 编号是对已批准设计章节和用户逐段确认结果的稳定计划追踪，不增加新需求。

- **R1**：只解释用户下一轮反馈；上一轮实际调用 Skill 且本轮明确否定、纠错或返工时，Prompt 静默触发采集，不做 AI 自我质检。
- **R2**：以 Delivery Unit 表示一次可判断的 Skill 交付，完整包含请求、最终交付、实际 Skill、会话与轮次引用及下一轮反馈。
- **R3**：`record_bad_case` 只传 Delivery Unit 引用和精简失败原因，不重传请求与交付全文；关联失败必须关闭写入。
- **R4**：运行时桥接只提供线程和上一已完成轮次引用，不参与反馈判断；Prompt 仍是 Bad Case 判定主体。
- **R5**：自动采集只创建待确认 Bad Case，复用人工确认、驳回、归因和 Evidence 资产化链路。
- **R6**：运行发现和 Bad Case 详情必须显示请求、交付、实际 Skill、用户反馈、判定原因及采集状态。
- **R7**：明确负反馈采集率不低于 90%，正常补充和新任务误报率不高于 5%，已创建案例关联正确率为 100%；治理播报为零且单任务最多澄清一次。
- **R8**：保留人工补录和现有 V0 状态操作，并确保采集或记录失败不影响生产回答。

## Scope Boundaries

### In Scope

- 从 Codex JSONL 的任务边界构建稳定 Delivery Unit，并按轮次归属实际 Skill。
- 以线程和轮次引用完成幂等的自动 Bad Case 创建、失败关闭和本地重试。
- 提供本机 `record_bad_case` 工具适配器及精简的全局 `AGENTS.md` 提示片段。
- 将运行发现升级为 Delivery Unit 摘要列表和按需详情，并扩展 Bad Case 详情上下文。
- 修复无请求体 POST 仍携带 JSON 请求头的已知前端缺陷，保持现有治理动作可用。
- 建立反馈判定样本、关联测试和真实 Codex 端到端试点。

### Out of Scope

- AI 对自身交付进行二次质检。
- 普通非 Skill 回答的质量治理。
- 根据一次负反馈直接归因、资产化、修改或发布 Skill。
- 跨 AI 产品、团队、多租户和云端采集。
- 候选 Skill 生成、对照评测、发布与回滚。

### Deferred to Follow-Up Work

- 将提示片段、工具和配置打包为正式 Codex 插件。
- 对不同 Codex 版本或其他 Agent 运行时建立统一上下文适配层。
- 在 Prompt-first 采集验证通过后确定候选优化和发布门方案。

## Context & Research

- `server/src/services/session-indexer.ts` 已有 JSONL 文件发现、流式解析、损坏行跳过和粗粒度 Skill 读取观察，可扩展底层解析，但当前按整场会话聚合，不能直接承担 Delivery Unit 归属。
- `server/src/services/bad-case-service.ts` 已实现待确认到 Evidence 的完整状态机，应增加幂等自动采集入口而不是复制流程。
- `server/src/storage/database.ts` 使用 SQLite 与轻量迁移，可延续该模式增加引用、来源、反馈和采集状态。
- `server/src/app.ts` 集中承载本地 Fastify API、错误映射与 Dashboard，可扩展 Delivery Unit 列表、详情和采集端点。
- `pc/src/pages/RunsPage.tsx`、`pc/src/components/BadCaseDetail.tsx` 已有 Table、Drawer 和治理操作形态，可升级而无需新增一级导航。
- `pc/src/api.ts` 当前对无 Body POST 仍设置 `Content-Type: application/json`，会导致现有确认、驳回和资产化请求返回 400，本计划一并修复。
- 当前仓库不存在 `docs/solutions/`，没有可引用的既有解决方案文档。

## Key Technical Decisions

1. **扩展现有本地模块化单体**：保留 SessionSummary 兼容入口，新增独立 Delivery Unit 索引器；避免把轮次模型硬塞进会话聚合对象。
2. **采用稳定复合引用并失败关闭**：Delivery Unit 由线程与已完成轮次标识定位；引用缺失、轮次未完成或 Skill 归属不可靠时只记录采集异常，不按时间猜测。
3. **Prompt 判断与元数据桥接分离**：Prompt 解释反馈，桥接层只提供线程和上一已完成轮次引用；若插件运行时不能直接提供上下文，允许使用最小元数据 Hook，但 Hook 不做质量判断。
4. **数据库约束保证幂等**：服务层校验之外使用唯一约束防止重复工具调用创建多个案例；第一阶段每个 Delivery Unit 最多对应一条自动采集记录。
5. **重试归属于调用适配器**：请求尚未到达后台时后台无法重试，因此适配器先写本地 outbox，再投递本机 API；后台只记录已接收事件的状态和关联错误。
6. **摘要列表、详情按需读取**：列表不返回完整请求和长交付，详情通过 Delivery Unit 引用实时读取本地日志，保持性能与隐私边界。
7. **人工补齐期望结果**：自动采集只预填用户反馈中可证实的失败原因，不推测期望结果；现有确认校验继续要求人工补齐。
8. **个人验证先于插件化**：第一阶段使用全局 `AGENTS.md` 和本地适配器验证闭环，正式插件打包在指标达标后另立计划。

## Open Questions

### Resolved During Planning

- Q1. Bad Case 是否由 AI 自评产生？**Resolved**：否，只解释用户下一轮反馈，见 R1。
- Q2. 是否治理所有 AI 回答？**Resolved**：否，仅上一轮实际调用 Skill 时触发，见 R1。
- Q3. 如何避免工具重复传输长上下文？**Resolved**：使用 Delivery Unit 引用，全文由后台按需读取，见 R2、R3。
- Q4. 是否允许运行时 Hook？**Resolved**：允许最小元数据桥接或 Hook 只提供线程与轮次引用，Prompt 仍负责判定，见 R4。
- Q5. 自动记录是否直接进入 Evidence？**Resolved**：否，只进入待确认并复用人工治理链路，见 R5。

### Deferred to Implementation

- Q6. [U1] 当前 Codex JSONL 的全部任务边界、最终答案和 Skill 调用事件变体有哪些？用真实脱敏夹具完成兼容性清单后冻结解析规则。
- Q7. [U3] 当前 Codex 插件或工具运行时能否直接提供每次调用的线程与轮次上下文？不能时启用已批准的最小元数据 Hook。
- Q8. [U6] 首批真实试点 Skill 的具体名单、会话数量和观察周期是什么？在自动化测试通过后、启动真实试点前确认。

## Implementation Units

#### U1: 建立 Delivery Unit 索引与真实 Skill 归属
- **Goal**: 将 Codex 会话解析为按任务边界划分、可稳定引用且能证明实际 Skill 使用的 Delivery Unit 列表和详情。
- **Requirements**: R1, R2, R3
- **Dependencies**: None
- **Files**: server/src/domain/types.ts, server/src/services/session-indexer.ts, server/src/services/session-indexer.test.ts, server/src/services/delivery-unit-indexer.ts, server/src/services/delivery-unit-indexer.test.ts
- **Approach**: 复用现有 JSONL 流式读取与文件筛选，将任务开始、用户消息、最后一个最终回答、任务完成和下一用户反馈归入明确轮次。为线程和已完成轮次生成稳定引用，并把 Skill 读取限制在对应任务边界内；同时修正当前只识别部分 `exec_command` 形态和部分 Skill 根目录的问题。保留 SessionSummary 作为兼容模型，Delivery Unit 成为新页面和自动采集的主模型。遇到旧日志、未完成任务或无法证明 Skill 使用时返回明确降级状态，不伪造交付单元。
- **Test scenarios**: 多轮会话正确拆分；同轮多条最终答案取任务完成前最后一条；Promise 并行读取和插件 Skill 路径可识别；下一轮反馈回填上一已完成交付；损坏行、未完成轮次和旧格式安全降级。
- **Verification**: 运行 `npm run test -w server -- delivery-unit-indexer.test.ts session-indexer.test.ts`，确认所有夹具按预期生成稳定引用和 Skill 归属。

#### U2: 扩展幂等采集状态与 Bad Case 服务
- **Goal**: 通过有效 Delivery Unit 引用幂等创建待确认 Bad Case，并可靠保存采集来源、用户反馈、失败原因和采集异常。
- **Requirements**: R3, R5, R8
- **Dependencies**: U1
- **Files**: server/src/domain/types.ts, server/src/storage/database.ts, server/src/services/bad-case-service.ts, server/src/services/bad-case-service.test.ts, server/src/services/capture-service.ts, server/src/services/capture-service.test.ts
- **Approach**: 延续 SQLite 轻量迁移，为 Bad Case 增加 Delivery 引用、采集来源和反馈证据，并建立数据库唯一约束。新增 CaptureService 校验引用、确认上一轮实际使用 Skill、读取 Delivery Unit 并调用现有 BadCaseService 的待确认入口。自动记录允许期望结果为空，但确认时继续执行现有完整性校验；重复调用返回同一记录，已驳回记录不自动复活。关联失败写入独立采集事件状态，不污染 Bad Case 表。
- **Test scenarios**: 有效引用创建待确认案例；同一引用重复调用不重复写入；无 Skill、错误线程、未完成轮次和缺失源日志不创建案例；自动案例仍需人工补齐后才能确认；现有人工创建与 Evidence 状态机保持兼容。
- **Verification**: 运行 `npm run test -w server -- capture-service.test.ts bad-case-service.test.ts`，并检查数据库迁移在新库和旧 V0 库上均通过。

#### U3: 接入运行时元数据桥接与 record_bad_case 适配器
- **Goal**: 在本机 Codex 中用极短提示规则静默调用 `record_bad_case`，并以可靠线程和轮次引用将事件投递给本地治理 API。
- **Requirements**: R1, R3, R4, R7, R8
- **Dependencies**: U1, U2, U4
- **Files**: package.json, adapter/package.json, adapter/tsconfig.json, adapter/src/index.ts, adapter/src/outbox.ts, adapter/src/index.test.ts, integration/AGENTS.bad-case-capture.md, README.md
- **Approach**: 新建独立本地适配器工作区，将已批准的提示片段、`record_bad_case` 工具契约和线程轮次上下文绑定为一个可验证安装单元。先验证当前运行时是否直接提供逐调用上下文；如果不能，使用只传递元数据的最小 Hook，禁止 Hook 解释反馈或创建案例。适配器在调用本地 API 前写入本地 outbox，使用幂等引用投递并在失败时后台重试，任何错误都不得进入用户可见回答。提示片段保持紧凑，工具定义承担参数校验。
- **Test scenarios**: 明确负反馈触发一次静默工具调用；正常补充和新任务不调用；引用缺失时失败关闭；本地 API 暂时不可用时事件进入 outbox 且回答正常；恢复后重试不产生重复案例；工具缺失时有可诊断安装状态但不播报治理结果。
- **Verification**: 运行适配器测试与本机安装自检，再用一个受控 Codex 会话确认调用携带准确线程和上一已完成轮次引用。

#### U4: 提供 Delivery Unit 与自动采集 API
- **Goal**: 暴露 Delivery Unit 摘要列表、按需详情和 `record_bad_case` 写入契约，并让 Dashboard 使用新的交付语义。
- **Requirements**: R2, R3, R5, R6, R8
- **Dependencies**: U1, U2
- **Files**: server/src/app.ts, server/src/app.test.ts, server/src/index.ts
- **Approach**: 在现有 Fastify 应用中增加 Delivery Unit 列表和详情端点，列表按交付单元分页并只返回摘要，详情按引用实时读取本地日志。新增自动采集端点调用 CaptureService，冻结幂等键、成功响应和关联错误契约，继续保持 localhost 与无跨域开放边界。Dashboard 的发现数量切换到 Delivery Unit 和自动候选口径，原 Session API 暂时保留兼容。对源日志缺失、引用失效和重复投递返回稳定、可测试的结果。
- **Test scenarios**: 列表不含完整长文本；详情包含六项判断信息；有效采集返回待确认案例；错误关联不落 Bad Case；重复投递返回同一记录；Dashboard 使用新口径；原有 API 回归通过。
- **Verification**: 运行 `npm run test -w server -- app.test.ts`，并通过 Fastify 注入测试核对列表、详情、采集与错误响应。

#### U5: 将工作台升级为可判断的 Delivery Unit 视图
- **Goal**: 用户可以在运行发现和 Bad Case 详情中查看完整交付上下文、自动判定原因与采集状态，同时保留人工补录和治理动作。
- **Requirements**: R5, R6, R8
- **Dependencies**: U4
- **Files**: pc/src/types.ts, pc/src/api.ts, pc/src/api.test.ts, pc/src/pages/RunsPage.tsx, pc/src/pages/RunsPage.test.tsx, pc/src/components/BadCaseDetail.tsx, pc/src/components/BadCaseDetail.test.tsx, pc/src/pages/BadCasesPage.tsx, pc/src/pages/OverviewPage.tsx, pc/src/styles.css
- **Approach**: 将 RunsPage 数据源替换为 Delivery Unit 摘要，保留表格、刷新和人工补录入口，并使用按需详情 Drawer 展示请求、交付、实际 Skill、下一轮反馈、判定原因和状态。BadCaseDetail 增加只读 Delivery Context，自动案例预填失败原因而不虚构期望结果。扩展前端类型和 API，同时修复无 Body 请求不应发送 JSON Content-Type 的公共请求缺陷。保持现有 Ant Design 扁平工作台布局，不新增一级导航或重复治理页面。
- **Test scenarios**: 列表稳定展示摘要且长文本不撑破布局；详情六项信息完整；源日志缺失时有清晰降级；自动案例可补齐、确认、驳回、归因和资产化；人工补录仍可用；所有无 Body POST 不再返回 400。
- **Verification**: 运行 `npm run test -w pc` 和 `npm run build -w pc`，并在桌面及窄屏视口手动检查列表、Drawer 和治理操作。

#### U6: 建立采集评测矩阵并完成真实 Codex 试点
- **Goal**: 用可复现样本和真实对话证明采集准确性、关联准确性、低干扰和工作台可判断性达到第一阶段标准。
- **Requirements**: R1, R2, R3, R4, R6, R7, R8
- **Dependencies**: U3, U5
- **Files**: governance/evaluation/feedback-capture-cases.json, docs/validation/prompt-first-bad-case-capture-pilot.md, server/src/services/delivery-unit-indexer.test.ts, server/src/services/capture-service.test.ts, pc/src/pages/RunsPage.test.tsx
- **Approach**: 建立覆盖明确否定、局部纠错、返工、补充、继续、正面、新任务和模糊不满的标注矩阵，并分别计算负反馈采集率和非负反馈误报率。先运行解析、幂等和页面自动化测试，再选择首批真实 Skill 进行 Codex 端到端试点。逐条核对 Delivery Unit 引用、对话中是否出现治理播报、澄清次数和工作台六项信息，记录失败样本但不启动 Skill 候选优化。若关联正确率低于 100%，不得扩大试点。
- **Test scenarios**: 明确负反馈采集率达到门槛；补充与新任务误报率达标；所有已创建案例关联正确；高置信反馈无治理文案；模糊反馈最多澄清一次；采集服务故障不影响回答；工作台可完成判断与后续治理。
- **Verification**: 运行 `npm test` 与 `npm run build`，按试点文档完成真实 Codex 对话并人工签署五项成功标准结果。

### Parallel Execution Plan

```text
Wave 1:
  U1  Delivery Unit 索引与 Skill 归属

Wave 2 after U1:
  U2  幂等采集状态与 Bad Case 服务

Wave 3 after U2:
  U4  Delivery Unit 与自动采集 API

Wave 4 after U4, parallel:
  U3  运行时桥接与 record_bad_case 适配器
  U5  工作台 Delivery Unit 视图

Wave 5 after U3 and U5:
  U6  评测矩阵与真实 Codex 试点

Critical path: U1 -> U2 -> U4 -> U3 -> U6
Max parallelism: 2
```

## System-Wide Impact

- **数据迁移**：`bad_cases` 增加 Delivery 引用、采集来源与反馈证据；新增采集事件或 outbox 状态存储。迁移必须兼容现有 `.runtime/state.sqlite`。
- **API**：新增 Delivery Unit 列表、详情和自动采集端点；Session API 暂时兼容保留。
- **本地配置**：增加适配器工作区、治理 API 地址、运行时元数据来源和全局提示片段安装说明。
- **隐私**：请求与交付全文继续只存在于 Codex 本地会话；列表返回摘要，详情按需读取；原始内容不进入 Git。
- **共享文件**：`server/src/domain/types.ts` 由 U1 先冻结 Delivery Unit 契约，U2 后续扩展 Bad Case 字段；`pc/src/types.ts` 继续显式同步，不在本轮引入共享类型包。
- **兼容性**：人工创建、确认、驳回、归因和 Evidence 资产化必须保持可用；原 SessionSummary 暂不移除。

## Risks & Dependencies

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RK1 | Codex 日志事件格式或 Skill 调用信号不稳定 | High | High | 以真实脱敏夹具冻结支持矩阵；无法证明 Skill 使用时失败关闭 |
| RK2 | 运行时工具拿不到逐调用线程与轮次上下文 | Medium | High | U3 先验证原生上下文；不可用时只增加已批准的最小元数据 Hook |
| RK3 | 重复调用或并发投递创建多个 Bad Case | Medium | High | 数据库唯一约束、幂等 API 和适配器 outbox 使用同一 Delivery 引用 |
| RK4 | 长交付导致列表慢或扩大隐私暴露 | Medium | Medium | 摘要分页、详情按需读取、localhost 与无 CORS、原文不入 Git |
| RK5 | 自动采集污染 Evidence 或误改 Skill | Low | High | 所有自动记录停在待确认；沿用人工确认、归因和资产化门 |
| RK6 | 提示规则或澄清干扰正常任务体验 | Medium | High | 提示片段限长、高置信静默、每任务最多澄清一次，以试点指标验收 |
| RK7 | 现有无 Body POST 缺陷阻断治理操作 | High | Medium | U5 修复公共请求封装并补 API 回归测试 |

- 依赖本机 Codex 会话 JSONL 可读，并能提供或桥接稳定的线程与轮次元数据。
- 依赖本地 Fastify 服务和 SQLite 运行目录可用；服务短暂不可用时由适配器 outbox 缓冲。
- 真实试点依赖在 U6 开始前确认首批 Skill 名单和观察周期。

## Sources & References

1. `docs/plans/2026-08-22-prompt-first-bad-case-capture-design.md`
2. `docs/plans/2026-08-22-bad-case-governance-v0-design.md`
3. `docs/plans/2026-08-22-skill-quality-evolution-architecture-design.md`
4. `server/src/services/session-indexer.ts`
5. `server/src/services/bad-case-service.ts`
6. `server/src/storage/database.ts`
7. `server/src/app.ts`
8. `pc/src/pages/RunsPage.tsx`
9. `pc/src/components/BadCaseDetail.tsx`
10. `pc/src/api.ts`

## Completion Status

`DONE_WITH_CONCERNS`

### Execution Log (2026-08-23)

**Waves executed:** W1 (U1) · W2 (U2) · W3 (U4) · W4 (U3, U5) · W5 (U6)

**Artifacts:** Delivery Unit indexer and tests; capture migrations/service/tests; Delivery Unit and capture APIs; stdio MCP adapter with one-shot metadata bridge and durable outbox; Delivery Unit workbench views and no-body POST regression fix; synthetic feedback matrix and pilot report.

**Verification:** `npm test` passed with 62 tests (adapter 8, server 32, PC 22); `npm run build` passed for adapter, server and PC; `git diff --check` passed; local Delivery Unit API returned HTTP 200 with summary-only list payload.

**Oracle verdict:** UNAVAILABLE - the single final Oracle call could not run because the configured model provider rejected the request for insufficient subscription quota.

**Concerns:**

- U6 automated contract evidence passed, but two isolated real Codex runs stalled after `task_started` without a model message, Skill read, tool call or `task_complete`; live trigger, false-positive, clarification and real association metrics remain incomplete.
- The real pilot is explicitly blocked from expansion until a working model connection produces complete Skill deliveries and the five first-phase success criteria are measured.
- Formal plugin installation and automatic per-call thread/turn injection remain deferred; the current adapter requires an explicit one-shot metadata bridge and fails closed when it is unavailable.
