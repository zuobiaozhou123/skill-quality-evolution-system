import { Alert, Empty, Table, Tag } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import type { Evidence } from "../types";

export function EvidencePage() {
  const [items, setItems] = useState<Evidence[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.getEvidence().then((data) => setItems(data.items)).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);
  return (
    <>
      <PageHeader eyebrow="EVIDENCE / CURATED" title="Evidence 证据库" />
      {error && <Alert className="page-alert" message={error} showIcon type="error" />}
      <section className="content-section flush-section">
        <Table
          columns={[
            { title: "证据", dataIndex: "title", key: "title", render: (value: string, item: Evidence) => <div className="primary-cell"><strong>{value}</strong><span>{item.problem}</span></div> },
            { title: "期望行为", dataIndex: "expectedOutcome", key: "expectedOutcome" },
            { title: "关联 Skill", dataIndex: "skillNames", key: "skillNames", width: 210, render: (values: string[]) => values.map((value) => <Tag key={value}>{value}</Tag>) },
            { title: "归因", dataIndex: "attribution", key: "attribution", width: 180 },
            { title: "确认时间", dataIndex: "confirmedAt", key: "confirmedAt", width: 150, render: (value: string) => dayjs(value).format("MM-DD HH:mm") },
          ]}
          dataSource={items}
          loading={loading}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Evidence" /> }}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          rowKey="id"
          size="middle"
        />
      </section>
    </>
  );
}
