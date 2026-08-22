# Skill 质量保障与自进化系统

这是一个个人优先、可演进到团队和企业形态的 Skill 治理控制台。V0 已搭建人工治理骨架；当前正在接入 Prompt-first 自动采集，把用户对上一轮 Skill 交付的明确负反馈沉淀为待确认 Bad Case。系统暂不生成候选版本、运行 Skill 评测或修改正式 Skill。

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

## Prompt-first 本地适配器

`adapter/` 提供 stdio MCP 工具 `record_bad_case`。工具参数只有精简失败原因，不接收请求全文、交付全文或由模型填写的 Delivery Unit 引用。适配器从一次性元数据绑定中读取 `threadId` 和 `previousCompletedTurnId`，组合出后台冻结的 `deliveryRef`，先写本地 outbox，再投递到 `/api/captures/record-bad-case`。

构建和自检：

```bash
npm run build -w adapter
node adapter/dist/index.js self-check
```

审查后可按以下命令注册本地 MCP。仓库不会自动执行该命令，也不会修改用户级 Codex 配置：

```bash
codex mcp add skill-governance -- node "/绝对路径/adapter/dist/index.js" serve
codex mcp get skill-governance --json
```

提示片段位于 [`integration/AGENTS.bad-case-capture.md`](integration/AGENTS.bad-case-capture.md)。个人验证时只把标记之间的短正文加入全局 `AGENTS.md`；本仓库不会自动修改全局提示词。

### 元数据桥接边界

每次用户提交反馈后，运行时桥接必须用已经验证的线程 ID 和上一已完成轮次 ID 覆盖一次性上下文文件：

```bash
node adapter/dist/index.js bind-context \
  --thread-id "<verified-thread-id>" \
  --previous-completed-turn-id "<verified-previous-turn-id>"
```

这个命令只搬运元数据，不读取或判断用户反馈。上下文带过期时间且只消费一次；缺失、过期、格式错误或无法关联时，适配器不会按时间猜测，也不会创建 Bad Case。API 暂时不可用时，事件保留在 `.runtime/bad-case-capture-outbox.json`，MCP 进程每 30 秒重试；后台通过同一 `deliveryRef` 保证幂等。

本机 `codex-cli 0.133.0` 已验证 `hooks`、`plugin_hooks` 为 stable，且 `codex mcp add` 支持 stdio 服务。但官方 Codex Hooks 页面在当前网络环境返回 403，`codex mcp --help` 也没有证明工具调用会自动携带线程和轮次。因此当前实现不假设存在未文档化的逐调用上下文，也不提供未经真实 Hook 载荷验证的字段映射。Hook 的最终配置和端到端安装留到真实对话试点；即使桥接或投递失败，也不得在用户回复中播报治理状态。

可覆盖的适配器环境变量：

| 环境变量 | 用途 |
|---|---|
| `SKILL_GOVERNANCE_CAPTURE_ENDPOINT` | 本地采集 API，默认 `http://127.0.0.1:4317/api/captures/record-bad-case`；只允许 localhost |
| `SKILL_GOVERNANCE_RUNTIME_ROOT` | 适配器运行目录，默认仓库 `.runtime/` |
| `SKILL_GOVERNANCE_CONTEXT_PATH` | 一次性元数据上下文文件 |
| `SKILL_GOVERNANCE_OUTBOX_PATH` | 持久 outbox 文件 |

## 数据位置

默认读取：

- `~/.codex/skills`：本机正式 Skill，只读扫描。
- `~/.codex/sessions`：最近 Codex 会话，只读索引。

默认写入：

- `.runtime/state.sqlite`：本机 Bad Case 状态和索引，不进入 Git。
- `.runtime/bad-case-capture-context.json`：一次性线程与上一轮引用，不进入 Git。
- `.runtime/bad-case-capture-outbox.json`：尚未成功投递的采集事件，不进入 Git。
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

## 当前边界

- 人工 Bad Case 治理链路已可用；Prompt-first 的后台 API 和本地适配器已进入实施，真实 Codex Hook 映射与端到端试点尚未完成。
- 请求和交付全文继续只从本机会话按需读取，不写入 outbox 或 Git。
- 总览展示登记数量，完整 Skill 清单和登记状态在“Skill 资产”页面查看。
- 变更提案、自动评测、候选生成、审批、发布和回滚只有结构占位，需在确定首批试点和成功标准后启用。

## 文档

- [总体架构设计](docs/plans/2026-08-22-skill-quality-evolution-architecture-design.md)
- [Bad Case 治理工作台 V0 设计](docs/plans/2026-08-22-bad-case-governance-v0-design.md)
- [Prompt-first Bad Case 自动采集架构设计](docs/plans/2026-08-22-prompt-first-bad-case-capture-design.md)
