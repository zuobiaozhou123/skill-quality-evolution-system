import { Alert, Button, Form, Input, Modal, Space, Table, Tag, Tooltip, message } from "antd";
import dayjs from "dayjs";
import { FileWarning, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import type { SessionSignal, SessionSummary } from "../types";

const signalLabels: Record<SessionSignal, { label: string; color: string }> = {
  tool_failure: { label: "工具失败", color: "red" },
  user_correction: { label: "用户纠正", color: "orange" },
};

export function RunsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setSessions((await api.getSessions()).items);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openCapture = (session: SessionSummary) => {
    setSelected(session);
    form.setFieldsValue({ title: `${session.taskSummary.slice(0, 42)} · 待核查`, problem: "", expectedOutcome: "" });
  };

  const createBadCase = async (values: { title: string; problem: string; expectedOutcome: string }) => {
    if (!selected) return;
    try {
      await api.createBadCase({
        ...values,
        sourceSessionId: selected.id,
        sourcePath: selected.sourcePath,
        taskSummary: selected.taskSummary,
        skillNames: selected.loadedSkills,
        signalTypes: selected.signalTypes,
      });
      message.success("已加入 Bad Case 收集箱");
      setSelected(undefined);
      form.resetFields();
      navigate("/bad-cases");
    } catch (reason) {
      message.error((reason as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="OBSERVATION / LOCAL SESSIONS"
        title="运行发现"
        extra={<Button icon={<RefreshCw size={15} />} onClick={() => void load()}>刷新</Button>}
      />
      {error && <Alert className="page-alert" message={error} showIcon type="error" />}
      <section className="content-section flush-section">
        <Table
          columns={[
            {
              title: "时间",
              dataIndex: "timestamp",
              key: "timestamp",
              width: 136,
              render: (value: string) => dayjs(value).format("MM-DD HH:mm"),
            },
            {
              title: "任务",
              dataIndex: "taskSummary",
              key: "taskSummary",
              ellipsis: true,
              render: (value: string, item: SessionSummary) => (
                <div className="primary-cell"><strong>{value}</strong><span>{item.cwd}</span></div>
              ),
            },
            {
              title: "加载 Skill",
              dataIndex: "loadedSkills",
              key: "loadedSkills",
              width: 230,
              render: (items: string[]) => items.length ? (
                <Space size={[4, 4]} wrap>{items.slice(0, 3).map((item) => <Tag key={item}>{item}</Tag>)}</Space>
              ) : <span className="muted">未观察到</span>,
            },
            {
              title: "候选信号",
              dataIndex: "signalTypes",
              key: "signalTypes",
              width: 180,
              render: (items: SessionSignal[]) => items.length ? items.map((item) => (
                <Tag color={signalLabels[item].color} key={item}>{signalLabels[item].label}</Tag>
              )) : <span className="muted">无明显信号</span>,
            },
            {
              title: "操作",
              key: "action",
              width: 100,
              render: (_: unknown, item: SessionSummary) => (
                <Tooltip title="加入收集箱">
                  <Button icon={<FileWarning size={15} />} onClick={() => openCapture(item)}>标记</Button>
                </Tooltip>
              ),
            },
          ]}
          dataSource={sessions}
          loading={loading}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          rowKey="id"
          size="middle"
        />
      </section>
      <Modal
        cancelText="取消"
        destroyOnHidden
        okButtonProps={{ htmlType: "submit", form: "capture-form" }}
        okText="创建 Bad Case"
        onCancel={() => setSelected(undefined)}
        open={Boolean(selected)}
        title="标记为 Bad Case"
      >
        <Form form={form} id="capture-form" layout="vertical" onFinish={createBadCase}>
          <Form.Item label="标题" name="title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="哪里不对" name="problem" rules={[{ required: true, message: "请描述实际问题" }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item label="期望结果" name="expectedOutcome" rules={[{ required: true, message: "请描述期望结果" }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
