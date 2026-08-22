import { Button, Divider, Form, Input, Select, Space, Tag } from "antd";
import { ArrowUpRight, Check, Save, X } from "lucide-react";
import type { AttributionType, BadCase } from "../types";

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

export const statusLabels: Record<BadCase["status"], { label: string; color: string }> = {
  pending_confirmation: { label: "待确认", color: "orange" },
  confirmed: { label: "已确认", color: "blue" },
  rejected: { label: "已驳回", color: "default" },
  attributed: { label: "已归因", color: "cyan" },
  assetized: { label: "已资产化", color: "green" },
};

type DetailProps = {
  item: BadCase;
  onSave: (values: Pick<BadCase, "title" | "problem" | "expectedOutcome">) => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onAttribute: (attribution: AttributionType, note: string) => void | Promise<void>;
  onPromote: () => void | Promise<void>;
};

export function BadCaseDetail({ item, onSave, onConfirm, onReject, onAttribute, onPromote }: DetailProps) {
  const [form] = Form.useForm();
  const [attributionForm] = Form.useForm();
  const editable = item.status === "pending_confirmation" || item.status === "confirmed";

  return (
    <div className="bad-case-detail">
      <div className="detail-meta-row">
        <Tag color={statusLabels[item.status].color}>{statusLabels[item.status].label}</Tag>
        <span>{item.sourceSessionId ? `会话 ${item.sourceSessionId.slice(0, 12)}` : "人工提交"}</span>
      </div>

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
