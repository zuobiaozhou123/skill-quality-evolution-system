# Skill 质量保障与自进化系统

这是一个个人优先、可演进到团队和企业形态的 Skill 治理控制台。当前 V0 先搭建治理骨架：读取本机 Skill 和 Codex 运行记录，把真实问题沉淀为可审查的 Evidence；暂不生成候选版本、运行 Skill 评测或修改正式 Skill。

## 当前闭环

```text
Codex 运行记录（只读）
  -> 运行发现
  -> 人工标记 Bad Case
  -> 确认 / 驳回
  -> 失败归因
  -> Evidence 资产化
  -> 后续变更提案（尚未启用）
  -> 人工审批与发布（尚未启用）
```

前台七个模块分别对应治理总览、运行发现、Bad Case、Evidence、Skill 资产、变更提案和发布中心。后台负责会话索引、Skill 扫描、状态迁移、Evidence 写入和总览聚合。

## 本地启动

要求 Node.js 24 或更高版本。

```bash
npm install
npm run dev
```

- 工作台：<http://127.0.0.1:4318/>
- 本地 API：<http://127.0.0.1:4317/api/health>

测试和构建：

```bash
npm test
npm run build
```

## 数据位置

默认读取：

- `~/.codex/skills`：本机正式 Skill，只读扫描。
- `~/.codex/sessions`：最近 Codex 会话，只读索引。

默认写入：

- `.runtime/state.sqlite`：本机 Bad Case 状态和索引，不进入 Git。
- `governance/registry/skills.json`：人工登记后的 Skill 元数据和相对路径，可进入 Git。
- `governance/evidence/*.json`：人工确认并资产化的 Evidence，可进入 Git。

可通过环境变量覆盖默认位置：

| 环境变量 | 用途 |
|---|---|
| `SKILL_GOVERNANCE_SKILLS_ROOT` | Skill 扫描目录 |
| `SKILL_GOVERNANCE_SESSIONS_ROOT` | Codex 会话目录 |
| `SKILL_GOVERNANCE_RUNTIME_ROOT` | 本地运行状态目录 |
| `SKILL_GOVERNANCE_DATA_ROOT` | 可提交治理数据目录 |
| `SKILL_GOVERNANCE_PORT` | 后台端口，默认 `4317` |

## 隐私与安全边界

- 不复制或提交完整 Codex 会话。
- 不提交 `.runtime/`、数据库或临时索引。
- 不修改 `~/.codex/skills` 下的正式 Skill。
- 只有经过人工确认、归因并主动资产化的必要字段会写入 Evidence；原始任务摘要、会话 ID 和会话路径不会写入。
- 候选变更和正式发布尚未开放；未来正式发布仍必须经过人工批准。

## V0 边界

- 当前 Bad Case 从“运行发现”页面人工标记；独立手工新建入口尚未开放。
- 当前只展示会话元数据，不提供原始会话片段查看，避免扩大敏感信息暴露面。
- 总览展示登记数量，完整 Skill 清单和登记状态在“Skill 资产”页面查看。
- 变更提案、自动评测、候选生成、审批、发布和回滚只有结构占位，需在确定首批试点和成功标准后启用。

## 文档

- [总体架构设计](docs/plans/2026-08-22-skill-quality-evolution-architecture-design.md)
- [Bad Case 治理工作台 V0 设计](docs/plans/2026-08-22-bad-case-governance-v0-design.md)
- [Prompt-first Bad Case 自动采集架构设计](docs/plans/2026-08-22-prompt-first-bad-case-capture-design.md)
