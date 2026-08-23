import { Alert, Button, Divider, Form, Input, Select, Space, Spin, Tag } from "antd";
import dayjs from "dayjs";
import { ArrowUpRight, Check, MessageSquareText, Save, X } from "lucide-react";
import type {
  AttributionType,
  BadCase,
  DeliveryUnitDetail,
  SessionContext,
  SessionContextEventType,
} from "../types";

const attributionOptions: Array<{ value: AttributionType; label: string }> = [
  { value: "skill_content_missing", label: "Skill 内容缺失" },
  { value: "skill_content_defect", label: "Skill 内容错误" },
  { value: "skill_optimization", label: "Skill 执行优化" },
  { value: "execution_lapse", label: "执行疏漏" },
  { value: "routing_issue", label: "路由问题" },
  { value: "tool_environment", label: "工具或环境故障" },
  { value: "task_input", label: "任务输入问题" },
  { value: "insufficient_evidence", label: "证据不足" },
];

const eventLabels: Record<SessionContextEventType, string> = {
  task_started: "任务开始",
  task_complete: "任务完成",
  turn_context: "运行上下文",
  user_message: "用户",
  agent_message: "AI",
  skill_read: "Skill 读取",
  tool_call: "工具调用",
  tool_output: "工具结果",
};

export const statusLabels: Record<BadCase["status"], { label: string; color: string }> = {
  pending_confirmation: { label: "待确认", color: "orange" },
  confirmed: { label: "已确认", color: "blue" },
  rejected: { label: "已驳回", color: "default" },
  attributed: { label: "已归因", color: "cyan" },
  assetized: { label: "已资产化", color: "green" },
};

type DetailProps = {
  item: BadCase;
  delivery?: DeliveryUnitDetail;
  deliveryError?: string;
  deliveryLoading?: boolean;
  sessionContext?: SessionContext;
  sessionContextError?: string;
  sessionContextLoading?: boolean;
  onSave: (values: Pick<BadCase, "title" | "problem" | "expectedOutcome">) => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onAttribute: (attribution: AttributionType, note: string) => void | Promise<void>;
  onPromote: () => void | Promise<void>;
};

export function BadCaseDetail({
  item,
  delivery,
  deliveryError,
  deliveryLoading,
  sessionContext,
  sessionContextError,
  sessionContextLoading,
  onSave,
  onConfirm,
  onReject,
  onAttribute,
  onPromote,
}: DetailProps) {
  const [form] = Form.useForm();
  const [attributionForm] = Form.useForm();
  const editable = item.status === "pending_confirmation" || item.status === "confirmed";

  return (
    <div className="bad-case-detail">
      <div className="detail-meta-row">
        <Space size={6}>
          <Tag color={statusLabels[item.status].color}>{statusLabels[item.status].label}</Tag>
          <Tag>{item.captureSource === "prompt_first" ? "自动采集" : "人工提交"}</Tag>
        </Space>
        <span>{item.deliveryRef ? `交付 ${item.deliveryRef}` : item.sourceSessionId ? `会话 ${item.sourceSessionId.slice(0, 12)}` : "无运行关联"}</span>
      </div>

      {item.captureSource === "prompt_first" && (
        <div className="capture-evidence">
          <section>
            <h3>用户下一轮反馈</h3>
            <div className="delivery-content">{item.userFeedback || "未读取到用户反馈"}</div>
          </section>
          <section>
            <h3>AI 识别的不满原因</h3>
            <div className="delivery-content">{item.failureReason || item.problem || "等待人工核查"}</div>
          </section>
        </div>
      )}

      {deliveryLoading && <div className="drawer-loading"><Spin size="small" /></div>}
      {deliveryError && <Alert className="detail-context-alert" message={deliveryError} showIcon type="warning" />}
      {delivery && (
        <div className="bad-case-delivery-context">
          <div className="detail-section-title">Delivery Context</div>
          <section><h3>用户请求</h3><div className="delivery-content">{delivery.userRequest}</div></section>
          <section><h3>最终交付</h3><div className="delivery-content">{delivery.finalAnswer}</div></section>
          <section>
            <h3>实际使用 Skill</h3>
            <Space size={[4, 4]} wrap>
              {delivery.actualSkills.map((skill) => <Tag key={skill}>{skill}</Tag>)}
            </Space>
          </section>
        </div>
      )}

      {sessionContextLoading && (
        <div className="session-context-loading">
          <Spin size="small" />
          <span>正在读取 Session 完整上下文</span>
        </div>
      )}
      {sessionContextError && (
        <Alert
          className="detail-context-alert"
          description="Bad Case 记录和治理操作仍然可用，可稍后重试读取原始会话。"
          message={sessionContextError}
          showIcon
          type="warning"
        />
      )}
      {sessionContext && (
        <section aria-labelledby="session-context-heading" className="session-context-section">
          <div className="session-context-heading">
            <div>
              <span>SESSION CONTEXT</span>
              <h2 id="session-context-heading">Session 完整上下文</h2>
            </div>
            <code>{sessionContext.threadId.slice(0, 12)}</code>
          </div>
          <div className="session-turn-list" role="list">
            {sessionContext.turns.map((turn, index) => (
              <article
                className={`session-turn${turn.isTrigger ? " is-trigger" : ""}${turn.isFeedback ? " is-feedback" : ""}`}
                key={turn.turnId}
                role="listitem"
              >
                <header>
                  <div>
                    <span className="turn-index">第 {index + 1} 轮</span>
                    <code>{turn.turnId}</code>
                  </div>
                  <Space size={4} wrap>
                    {turn.isTrigger && <Tag color="orange">触发交付</Tag>}
                    {turn.isFeedback && <Tag color="cyan">用户反馈</Tag>}
                  </Space>
                </header>
                <div className="session-events">
                  {turn.events.map((event, eventIndex) => (
                    <div className={`session-event event-${event.type}`} key={`${event.timestamp}-${event.type}-${eventIndex}`}>
                      <div className="session-event-meta">
                        <span>{eventLabels[event.type]}</span>
                        <time dateTime={event.timestamp}>{event.timestamp ? dayjs(event.timestamp).format("HH:mm:ss") : "--:--:--"}</time>
                      </div>
                      <div className="session-event-content">{event.content || event.summary}</div>
                      {event.truncated && <span className="context-truncated">内容过长，已在安全上限处截断</span>}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {!item.deliveryRef && (
        <div className="session-context-empty">
          <MessageSquareText aria-hidden size={18} />
          <div>
            <strong>无关联 Session 上下文</strong>
            <span>该记录为人工提交，可继续确认、归因和资产化。</span>
          </div>
        </div>
      )}

      {(item.captureSource === "prompt_first" || delivery || deliveryError || sessionContext || sessionContextError || !item.deliveryRef) && <Divider />}

      <Form
        form={form}
        initialValues={{ title: item.title, problem: item.problem, expectedOutcome: item.expectedOutcome }}
        layout="vertical"
        onFinish={onSave}
      >
        <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
          <Input disabled={!editable} />
        </Form.Item>
        <Form.Item label="实际问题" name="problem" rules={[{ required: true, message: "请描述哪里不对" }]}>
          <Input.TextArea disabled={!editable} rows={4} />
        </Form.Item>
        <Form.Item label="期望结果" name="expectedOutcome" rules={[{ required: true, message: "请描述期望结果" }]}>
          <Input.TextArea disabled={!editable} rows={4} />
        </Form.Item>
        {editable && (
          <Button htmlType="submit" icon={<Save size={15} />}>
            保存
          </Button>
        )}
      </Form>

      {item.skillNames.length > 0 && (
        <div className="detail-skills">
          <span>关联 Skill</span>
          <Space size={[4, 4]} wrap>{item.skillNames.map((skill) => <Tag key={skill}>{skill}</Tag>)}</Space>
        </div>
      )}

      {item.status === "pending_confirmation" && (
        <>
          <Divider />
          <Space>
            <Button type="primary" icon={<Check size={15} />} onClick={onConfirm}>确认问题</Button>
            <Button danger icon={<X size={15} />} onClick={onReject}>驳回</Button>
          </Space>
        </>
      )}

      {item.status === "confirmed" && (
        <>
          <Divider orientation="left">失败归因</Divider>
          <Form
            form={attributionForm}
            layout="vertical"
            onFinish={(values: { attribution: AttributionType; note?: string }) =>
              onAttribute(values.attribution, values.note ?? "")
            }
          >
            <Form.Item label="归因类型" name="attribution" rules={[{ required: true, message: "请选择归因" }]}>
              <Select options={attributionOptions} placeholder="选择问题归属" />
            </Form.Item>
            <Form.Item label="判断依据" name="note">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">完成归因</Button>
              <Button danger onClick={onReject}>驳回</Button>
            </Space>
          </Form>
        </>
      )}

      {item.status === "attributed" && (
        <>
          <Divider />
          <div className="attribution-summary">
            <span>归因结果</span>
            <strong>{attributionOptions.find((option) => option.value === item.attribution)?.label}</strong>
            {item.attributionNote && <p>{item.attributionNote}</p>}
          </div>
          <Button type="primary" icon={<ArrowUpRight size={15} />} onClick={onPromote}>
            转为 Evidence
          </Button>
        </>
      )}
    </div>
  );
}
