import { Alert, Empty, Spin, Table, Tag } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import { PipelineStrip } from "../components/PipelineStrip";
import { statusLabels } from "../components/BadCaseDetail";
import type { Dashboard } from "../types";

export function OverviewPage() {
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState("");

  useEffect(() => {
    api.getDashboard().then(setData).catch((reason: Error) => setError(reason.message));
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
            <div><span>最近运行</span><strong>{data.totals.sessions}</strong></div>
            <div><span>Bad Case</span><strong>{data.totals.badCases}</strong></div>
            <div><span>Evidence</span><strong>{data.totals.evidence}</strong></div>
            <div><span>已登记 Skill</span><strong>{data.totals.registeredSkills}</strong></div>
          </section>
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
