import { Alert, Button, Drawer, Form, Input, Modal, Space, Spin, Table, Tag, Tooltip, message } from "antd";
import dayjs from "dayjs";
import { Eye, FileWarning, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { statusLabels } from "../components/BadCaseDetail";
import { PageHeader } from "../components/PageHeader";
import type { DeliveryUnitDetail, DeliveryUnitSummary } from "../types";

const captureLabels: Record<DeliveryUnitDetail["captureStatus"], string> = {
  not_captured: "未采集",
  captured: "已采集",
  duplicate: "重复采集",
  association_failed: "关联失败",
};
const pageSize = 20;

function deliveryStatus(detail: DeliveryUnitDetail) {
  const capture = captureLabels[detail.captureStatus];
  return detail.governanceStatus
    ? `${capture} · ${statusLabels[detail.governanceStatus].label}`
    : capture;
}

export function RunsPage() {
  const [items, setItems] = useState<DeliveryUnitSummary[]>([]);
  const [selected, setSelected] = useState<DeliveryUnitSummary>();
  const [captureItem, setCaptureItem] = useState<DeliveryUnitSummary>();
  const [detail, setDetail] = useState<DeliveryUnitDetail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [degradedCount, setDegradedCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const load = async (nextPage = 1) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getDeliveryUnits((nextPage - 1) * pageSize, pageSize);
      setItems(result.items);
      setDegradedCount(result.degradedCount);
      setHasMore(result.pagination.hasMore);
      setPage(nextPage);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(1); }, []);

  const openDetail = async (item: DeliveryUnitSummary) => {
    setSelected(item);
    setDetail(undefined);
    setDetailError("");
    setDetailLoading(true);
    try {
      setDetail(await api.getDeliveryUnit(item.deliveryRef));
    } catch (reason) {
      setDetailError((reason as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const openCapture = (item: DeliveryUnitSummary) => {
    setSelected(undefined);
    setCaptureItem(item);
    form.setFieldsValue({
      title: `${item.requestSummary.slice(0, 42)} · 待核查`,
      problem: "",
      expectedOutcome: "",
    });
  };

  const createBadCase = async (values: { title: string; problem: string; expectedOutcome: string }) => {
    if (!captureItem) return;
    try {
      await api.createBadCase({
        ...values,
        sourceSessionId: captureItem.threadId,
        taskSummary: captureItem.requestSummary,
        skillNames: captureItem.actualSkills,
        signalTypes: captureItem.hasUserFeedback ? ["user_correction"] : [],
      });
      message.success("已加入 Bad Case 收集箱");
      setCaptureItem(undefined);
      form.resetFields();
      navigate("/bad-cases");
    } catch (reason) {
      message.error((reason as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="OBSERVATION / DELIVERY UNITS"
        title="运行发现"
        extra={<Button icon={<RefreshCw size={15} />} onClick={() => void load(page)}>刷新</Button>}
      />
      {error && <Alert className="page-alert" message={error} showIcon type="error" />}
      {degradedCount > 0 && (
        <Alert
          className="page-alert"
          message={`${degradedCount} 条旧记录缺少可靠的交付边界，已从列表中排除`}
          showIcon
          type="warning"
        />
      )}
      <section className="content-section flush-section delivery-table">
        <Table
          columns={[
            {
              title: "完成时间",
              dataIndex: "completedAt",
              key: "completedAt",
              width: 126,
              render: (value: string) => dayjs(value).format("MM-DD HH:mm"),
            },
            {
              title: "用户请求",
              dataIndex: "requestSummary",
              key: "requestSummary",
              width: 270,
              render: (value: string, item: DeliveryUnitSummary) => (
                <div className="primary-cell"><strong>{value}</strong><span>{item.cwd}</span></div>
              ),
            },
            {
              title: "交付摘要",
              dataIndex: "resultSummary",
              key: "resultSummary",
              width: 210,
              render: (value: string) => <div className="summary-cell">{value}</div>,
            },
            {
              title: "实际 Skill",
              dataIndex: "actualSkills",
              key: "actualSkills",
              width: 180,
              render: (skills: string[]) => skills.length
                ? <Space size={[4, 4]} wrap>{skills.map((skill) => <Tag key={skill}>{skill}</Tag>)}</Space>
                : <span className="muted">未观察到</span>,
            },
            {
              title: "反馈",
              dataIndex: "hasUserFeedback",
              key: "hasUserFeedback",
              width: 88,
              render: (hasFeedback: boolean) => hasFeedback
                ? <Tag color="blue">已有</Tag>
                : <span className="muted">暂无</span>,
            },
            {
              title: "操作",
              key: "action",
              width: 60,
              render: (_: unknown, item: DeliveryUnitSummary) => (
                <Tooltip title="查看完整交付">
                  <Button aria-label="查看" icon={<Eye size={15} />} onClick={() => void openDetail(item)} />
                </Tooltip>
              ),
            },
          ]}
          dataSource={items}
          loading={loading}
          pagination={{
            current: page,
            onChange: (nextPage) => void load(nextPage),
            pageSize,
            showSizeChanger: false,
            total: hasMore
              ? page * pageSize + 1
              : (page - 1) * pageSize + items.length,
          }}
          rowKey="deliveryRef"
          scroll={{ x: 934 }}
          size="middle"
        />
      </section>

      <Drawer
        className="delivery-drawer"
        destroyOnHidden
        footer={selected && (
          <Button icon={<FileWarning size={15} />} onClick={() => openCapture(selected)}>
            标记为 Bad Case
          </Button>
        )}
        onClose={() => setSelected(undefined)}
        open={Boolean(selected)}
        title="Delivery Unit 详情"
        width="min(720px, 100vw)"
      >
        {detailLoading && <div className="drawer-loading"><Spin /></div>}
        {detailError && (
          <Alert
            description="完整上下文暂时无法读取，请保留当前记录后重试。"
            message={detailError}
            showIcon
            type="warning"
          />
        )}
        {detail && (
          <div className="delivery-detail">
            <div className="delivery-detail-meta">
              <span>{dayjs(detail.completedAt).format("YYYY-MM-DD HH:mm")}</span>
              <code>{detail.deliveryRef}</code>
            </div>
            <section><h3>用户请求</h3><div className="delivery-content">{detail.userRequest}</div></section>
            <section><h3>最终交付</h3><div className="delivery-content">{detail.finalAnswer}</div></section>
            <section>
              <h3>实际使用 Skill</h3>
              <Space size={[4, 4]} wrap>{detail.actualSkills.map((skill) => <Tag key={skill}>{skill}</Tag>)}</Space>
            </section>
            <section><h3>下一轮反馈</h3><div className="delivery-content feedback-content">{detail.nextUserFeedback || "暂无后续反馈"}</div></section>
            <section><h3>候选原因</h3><div className="delivery-content">{detail.failureReason || "尚未形成 Bad Case 判定"}</div></section>
            <section><h3>采集与治理状态</h3><Tag color={detail.captureStatus === "association_failed" ? "red" : "orange"}>{deliveryStatus(detail)}</Tag></section>
          </div>
        )}
      </Drawer>

      <Modal
        cancelText="取消"
        destroyOnHidden
        okButtonProps={{ htmlType: "submit", form: "capture-form" }}
        okText="创建 Bad Case"
        onCancel={() => setCaptureItem(undefined)}
        open={Boolean(captureItem)}
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
