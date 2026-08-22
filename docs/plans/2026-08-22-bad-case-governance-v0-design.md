---
title: Skill 治理工作台 V0 设计
date: 2026-08-22
status: approved
scope: bad-case-discovery-and-evidence
---

# Skill 治理工作台 V0 设计

## 1. 目标

V0 先搭建可感知、可操作的治理架子，不启动 Skill 测试、候选优化或正式发布。用户应能在本地工作台中看到一条 Bad Case 从运行发现、人工确认、失败归因到 Evidence 资产化的完整过程。

## 2. 本轮验收路径

```text
打开本地工作台
→ 查看最近 Codex 运行
→ 选择一次运行并标记 Bad Case
→ 填写问题和期望结果
→ 确认或驳回
→ 选择失败归因
→ 转为 Evidence
→ 总览数量和状态同步变化
```

正式 Skill 目录在本轮全程只读。

## 3. 主流程

```text
运行发现
→ Bad Case 收集箱
→ 人工确认
→ 失败归因
→ Evidence 证据库
→ 等待后续变更提案
```

Bad Case 状态为：

```text
待确认
├── 驳回
└── 已确认
      ↓
    已归因
      ↓
    已资产化
```

失败归因分为：Skill 内容缺失、Skill 内容错误、Skill 执行优化、执行疏漏、路由问题、工具或环境故障、任务输入问题、证据不足。

## 4. 前台信息架构

### 4.1 治理总览

- 展示发现异常、待确认、已归因、已资产化、候选验证、待发布六阶段数量。
- 展示最近 Bad Case 和已登记 Skill。
- 数量来自后台真实状态，不使用静态演示数字。

### 4.2 运行发现

- 只读索引本机最近 Codex 会话。
- 展示时间、项目、任务摘要、加载 Skill 和候选异常信号。
- 支持选择运行并标记为 Bad Case。
- 默认只展示元数据；原始片段按需查看且不进入 Git。

### 4.3 Bad Case 收集箱

- 汇总自动发现候选与人工提交记录。
- 支持补充问题描述和期望结果。
- 支持确认、驳回、失败归因和转为 Evidence。
- 每个动作都更新流水线状态并保留时间记录。

### 4.4 Evidence 证据库

- 展示已确认、已脱敏、可长期保留的证据。
- Evidence 记录来源 Bad Case、关联 Skill、问题、期望行为和归因。
- Evidence 文件进入项目 Git，原始会话不进入。

### 4.5 Skill 资产库

- 真实扫描 `~/.codex/skills`。
- 展示 Skill 名称、描述、路径、内容指纹和治理登记状态。
- V0 仅支持只读发现和登记。

### 4.6 变更提案与发布中心

- 建立导航、列表和真实空状态。
- V0 不生成候选、不评测、不修改正式 Skill。

## 5. 后台逻辑

| 模块 | 职责 |
|---|---|
| SessionIndexer | 只读索引 Codex JSONL 会话元数据和 Skill 加载记录 |
| SignalDetector | 识别工具失败、Skill 加载和用户纠正候选信号 |
| BadCaseService | 创建、更新、确认、驳回和状态校验 |
| AttributionService | 保存失败归因并控制可用状态迁移 |
| EvidenceService | 将已归因 Bad Case 转成可提交 Evidence |
| SkillRegistry | 扫描 Skill、生成内容指纹并登记治理对象 |
| PipelineService | 聚合各阶段数量和最近状态变化 |

## 6. 数据边界

```text
governance/
├── registry/        # 可提交的 Skill 登记信息
└── evidence/        # 脱敏后的 Evidence

.runtime/
├── state.sqlite     # 本地状态和索引
└── session-cache/   # 临时会话索引
```

- `.runtime/` 不进入 Git。
- 完整 Codex 会话不复制到项目仓库。
- Evidence 只保存人工确认后的必要信息。
- 正式 Skill 路径和内容指纹用于只读追踪。

## 7. 技术结构

```text
pc/       React 18 + Vite + Ant Design 5
server/   Fastify + TypeScript
```

前台通过 HTTP 调用本地 API。需要运行进度时使用 SSE；V0 的索引和状态操作无需 WebSocket。治理文件是可审查事实来源，SQLite 只保存本地运行状态和索引。

## 8. V0 非目标

- 不运行 Skill 测试。
- 不生成候选 Skill。
- 不调用模型做自动归因。
- 不发布或回滚正式 Skill。
- 不自动扫描全量历史会话产生 Bad Case。
- 不建设账号、权限、通知或云端服务。

## 9. 完成条件

1. 前后台均可本地启动。
2. Skill 资产库能读取真实本机 Skill。
3. 运行发现能读取最近 Codex 会话和 Skill 加载信号。
4. Bad Case 可以创建、确认、驳回、归因和资产化。
5. Evidence 真实写入 `governance/evidence/`。
6. 总览数量随状态变化同步更新。
7. `.runtime/`、原始会话和正式 Skill 不被提交或修改。
