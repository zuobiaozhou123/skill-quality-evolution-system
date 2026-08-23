# Prompt-first Bad Case 采集试点验收

- 日期：2026-08-23
- 范围：Prompt-first 采集合同、Bad Case First 工作台与真实 Codex 有界试点
- 结论：**自动化合同和本地持久化链路通过；真实模型已能识别并发起工具调用，但非交互 CLI 审批取消写调用，正式端到端门槛仍未签署。**

## 1. 试点范围

首批合成矩阵继续覆盖 `xlsx`、`brainstorming`、`requirements-analysis` 和 `prd-writer`。本轮额外使用 `zhangxuefeng-perspective` 回归用户提出的真实问题形态：上一轮确实读取 Skill，下一轮明确指出“口吻不像指定人物”。

治理边界不变：只根据用户下一轮反馈判断，不做 AI 自评；自动案例只进入 `pending_confirmation`；请求、交付和完整 Session 不写入工具参数或 outbox。

## 2. 自动化证据

[`governance/evaluation/feedback-capture-cases.json`](../../governance/evaluation/feedback-capture-cases.json) 是 26 条脱敏合成标注，不是模型实测结果：9 条明确负反馈、12 条非负反馈、3 条模糊反馈、2 条上一轮未使用 Skill 的边界样本。

| 验收项 | 自动化证据 | 结果 |
|---|---|---|
| 反馈边界与门槛 | 合成矩阵冻结 `90% / 5% / 100%` 目标，不把 expectedAction 当实测 | 通过 |
| 当前 Codex 日志兼容 | 同时识别旧 `custom_tool_call` 与新 `function_call`，支持 `cat/sed/head/tail/less/bat/rg/grep` 的显式 Skill 文件读取 | 通过 |
| 精确关联与幂等 | `threadId:turnId` 关联、错配失败关闭、重复不重建 | 通过 |
| Bad Case First 页面 | 自动候选展示反馈、AI 原因、Skill、来源和状态；旧 `/runs` 跳转 | 通过 |
| 完整 Session | 详情按需读取多轮时间线，高亮交付和反馈，缺失源不阻断治理 | 通过 |
| 诊断与恢复 | captured / duplicate / association_failed、outbox 和索引降级可见 | 通过 |
| 静默边界 | MCP 工具结果为空，异常不进入生产回答 | 通过 |

## 3. 用户级接入状态

- 已用 `codex mcp add skill-governance -- node <repo>/adapter/dist/index.js serve` 注册用户级 stdio MCP。
- 已将 `integration/AGENTS.bad-case-capture.md` 标记之间的 104 字正文追加到全局 `~/.codex/AGENTS.md`，未复制安装说明或传输字段。
- 已保留原有模型 provider、项目 trust、插件和记忆规则。
- 本地 API `GET /api/health` 返回 200；适配器构建、自检和 8 项测试通过。
- 桌面应用的既有会话不会热加载新增 MCP；需要新建进程或重启后再做桌面试点。

## 4. 真实 Codex 有界试点

使用 `codex-cli 0.133.0` 和当前用户配置完成同一 Session 的三轮只读对话：

1. 第一轮明确使用 `zhangxuefeng-perspective` 回答专业选择问题，正常完成；JSONL 证明读取了 `using-superpowers` 和 `zhangxuefeng-perspective`。
2. 第二轮反馈“有没有用张雪峰 Skill，口吻不像张雪峰”。模型准确发起 `record_bad_case`，失败原因概括为“已调用 Skill，但成品口吻不像张雪峰，需要返工”。
3. 第三轮进一步指出缺少东北大哥式短句、反问和明确判断。模型再次准确发起工具调用，并输出正常返工结果。

两次模型工具调用都被非交互 CLI 返回 `user cancelled MCP tool call`。即使显式使用 `approval_policy=never` 和只读 sandbox，写工具仍不会自动获批。本轮未使用 `--dangerously-bypass-approvals-and-sandbox`，因为它会扩大到与采集无关的系统权限。

模型的两次正常回复均未出现“已记录、已采集、Bad Case、治理状态”等播报。由此可以确认**反馈识别和零治理播报真实通过**，但不能声称模型调用已真实持久化。

为分离验证下游链路，随后使用相同 stdio MCP 协议直接调用已注册适配器：

- 原始负反馈创建 1 条 `pending_confirmation`，关联原始交付、用户原话和 `zhangxuefeng-perspective`。
- 第二条事件首次因新日志格式未被索引而失败关闭；兼容修复后由 durable outbox 重试并创建 1 条 `pending_confirmation`。
- outbox 最终为 0；诊断保留 1 条历史 `association_failed` 和 2 条 `captured`，没有删除审计记录。
- Session Context API 能返回完整三轮时间线，并高亮触发交付与反馈轮次。

这部分证明**绑定、MCP 协议、outbox、后台关联、列表入场和完整 Session 读取**可工作，但由于持久化调用不是模型进程实际获批执行，仍归类为“组合集成验证”，不是完整端到端。

## 5. 第一阶段成功标准

| 成功标准 | 门槛 | 当前真实证据 | 签署 |
|---|---:|---|---|
| 明确负反馈采集率 | `>= 90%` | 2/2 识别并尝试调用；0/2 由非交互模型进程获批持久化，样本量也不足 10 | **未完成** |
| 非负反馈误报率 | `<= 5%` | 本轮真实非负样本 0 条 | **未完成** |
| 已创建案例关联正确率 | `100%` | 组合集成创建 2/2 精确关联；模型进程直接创建 0 条 | **自动化/组合通过，真实 E2E 未完成** |
| 高置信反馈零治理播报 | `0` 条 | 2/2 正常回复无治理播报 | **当前样本通过** |
| 模糊反馈每任务最多澄清一次 | `<= 1` | 本轮没有真实模糊样本 | **未完成** |
| 采集失败不影响主回答 | 不抛出治理错误 | 两次工具取消后均正常完成返工回答 | **当前样本通过** |
| 工作台完整判断上下文 | 反馈、原因、请求、交付、Skill、Session | 2 条待确认案例可按引用读取完整时间线 | **通过** |

**总签署：仍未达到扩大试点门槛。** 当前最小系统已可运行并能暴露真实阻塞；下一步不是扩大 Skill 自进化，而是让桌面新会话在不打断用户的前提下获批执行本地 `record_bad_case`，再补足 10 条明确负反馈和 20 条非负反馈。

## 6. 下一次复验

1. 重启 Codex 桌面应用或新建确认已加载 `skill-governance` 的会话。
2. 在每条反馈前由可信运行时绑定准确的上一已完成轮次；不按时间猜测。
3. 检查桌面是否对 `record_bad_case` 弹出审批；若弹出，先设计仅授权该工具的安全策略，不启用全局危险绕过。
4. 采集至少 10 条明确负反馈和 20 条非负反馈，交叉核对工具事件、Capture Event、Bad Case 和 Session Context。
5. 指标达标后再签署真实试点；在此之前不启动候选 Skill 生成或正式 Skill 修改。
