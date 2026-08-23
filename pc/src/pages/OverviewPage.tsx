import { Alert, Collapse, Empty, Space, Spin, Table, Tag } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import { PipelineStrip } from "../components/PipelineStrip";
import { statusLabels } from "../components/BadCaseDetail";
import type { CaptureDiagnostics, Dashboard } from "../types";

const captureStatusLabels = {
  captured: { label: "已采集", color: "green" },
  duplicate: { label: "重复", color: "default" },
  association_failed: { label: "关联失败", color: "red" },
} as const;

function CaptureDiagnosticsPanel({ data }: { data: CaptureDiagnostics }) {
  const health = data.status === "healthy"
    ? { label: "采集正常", color: "green" }
    : { label: "采集需关注", color: "orange" };
  return (
    <Collapse
      size="small"
      style={{ marginTop: 14 }}
      items={[
        {
          key: "capture-diagnostics",
          label: (
            <Space wrap>
              <strong>自动采集诊断</strong>
              <Tag color={health.color}>{health.label}</Tag>
              <span className="muted">关联失败 {data.summary.associationFailed}</span>
              <span className="muted">待重试 {data.outbox.pendingCount}</span>
            </Space>
          ),
          children: (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Space wrap>
                <Tag>已接收 {data.summary.total}</Tag>
                <Tag color="green">成功 {data.summary.captured}</Tag>
                <Tag>重复 {data.summary.duplicate}</Tag>
                <Tag color={data.summary.associationFailed > 0 ? "red" : "default"}>
                  关联失败 {data.summary.associationFailed}
                </Tag>
                <Tag color={data.index.status === "healthy" ? "default" : "orange"}>
                  索引降级 {data.index.degradedCount}
                </Tag>
                <Tag color={data.outbox.status === "clear" ? "default" : "orange"}>
                  Outbox {data.outbox.status === "clear" ? "畅通" : data.outbox.status === "pending" ? "待重试" : "不可读"}
                </Tag>
              </Space>
              <Table
                columns={[
                  {
                    title: "时间",
                    dataIndex: "createdAt",
                    key: "createdAt",
                    width: 130,
                    render: (value: string) => dayjs(value).format("MM-DD HH:mm"),
                  },
                  {
                    title: "结果",
                    dataIndex: "status",
                    key: "status",
                    width: 100,
                    render: (status: keyof typeof captureStatusLabels) => (
                      <Tag color={captureStatusLabels[status].color}>{captureStatusLabels[status].label}</Tag>
                    ),
                  },
                  { title: "交付引用", dataIndex: "deliveryRef", key: "deliveryRef" },
                  { title: "识别原因", dataIndex: "failureReason", key: "failureReason" },
                ]}
                dataSource={data.recentEvents}
                locale={{
                  emptyText: (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未收到自动采集事件" />
                  ),
                }}
                pagination={false}
                rowKey="id"
                size="small"
              />
            </Space>
          ),
        },
      ]}
    />
  );
}

export function OverviewPage() {
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<CaptureDiagnostics>();
  const [diagnosticError, setDiagnosticError] = useState(false);

  useEffect(() => {
    api.getDashboard().then(setData).catch((reason: Error) => setError(reason.message));
    const diagnosticsRequest = api.getCaptureDiagnostics;
    if (diagnosticsRequest) {
      diagnosticsRequest().then(setDiagnostics).catch(() => setDiagnosticError(true));
    }
  }, []);

  return (
    <>
      <PageHeader eyebrow="CONTROL PLANE / OVERVIEW" title="治理总览" />
      {error && <Alert message={error} showIcon type="error" />}
      {!data ? (
        <div className="center-loading"><Spin /></div>
      ) : (
        <>
          <PipelineStrip pipeline={data.pipeline} />
          <section className="totals-band" aria-label="运行统计">
            <div><span>Delivery Unit</span><strong>{data.totals.deliveryUnits ?? data.totals.sessions}</strong></div>
            <div><span>自动候选</span><strong>{data.totals.automaticCandidates ?? 0}</strong></div>
            <div><span>Bad Case</span><strong>{data.totals.badCases}</strong></div>
            <div><span>Evidence</span><strong>{data.totals.evidence}</strong></div>
            <div><span>已登记 Skill</span><strong>{data.totals.registeredSkills}</strong></div>
          </section>
          {diagnostics && <CaptureDiagnosticsPanel data={diagnostics} />}
          {diagnosticError && (
            <Alert
              message="采集诊断暂时不可用"
              type="warning"
              showIcon
              style={{ marginTop: 14 }}
            />
          )}
          <section className="content-section">
            <div className="section-heading">
              <div><span>RECENT CASES</span><h2>最近进入治理的问题</h2></div>
            </div>
            <Table
              columns={[
                { title: "问题", dataIndex: "title", key: "title" },
                {
                  title: "关联 Skill",
                  dataIndex: "skillNames",
                  key: "skillNames",
                  render: (items: string[]) => items.length ? items.map((item) => <Tag key={item}>{item}</Tag>) : "-",
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  key: "status",
                  width: 110,
                  render: (status: keyof typeof statusLabels) => <Tag color={statusLabels[status].color}>{statusLabels[status].label}</Tag>,
                },
                {
                  title: "更新时间",
                  dataIndex: "updatedAt",
                  key: "updatedAt",
                  width: 170,
                  render: (value: string) => dayjs(value).format("MM-DD HH:mm"),
                },
              ]}
              dataSource={data.recentBadCases}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Bad Case" /> }}
              pagination={false}
              rowKey="id"
              size="middle"
            />
          </section>
        </>
      )}
    </>
  );
}
