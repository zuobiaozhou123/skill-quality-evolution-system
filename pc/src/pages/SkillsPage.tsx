import { Alert, Button, Empty, Input, Table, Tag, Tooltip, message } from "antd";
import { Check, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { PageHeader } from "../components/PageHeader";
import type { SkillSummary } from "../types";

export function SkillsPage() {
  const [items, setItems] = useState<SkillSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.getSkills().then((data) => setItems(data.items)).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);
  const filtered = useMemo(() => items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const register = async (item: SkillSummary) => {
    try {
      const updated = await api.registerSkill(item.id);
      setItems((current) => current.map((skill) => skill.id === item.id ? updated : skill));
      message.success(`已登记 ${item.name}`);
    } catch (reason) { message.error((reason as Error).message); }
  };
  return (
    <>
      <PageHeader eyebrow="REGISTRY / READ ONLY" title="Skill 资产库" />
      {error && <Alert className="page-alert" message={error} showIcon type="error" />}
      <div className="filter-bar single-filter">
        <Input allowClear onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Skill" prefix={<Search size={15} />} value={query} />
      </div>
      <section className="content-section flush-section">
        <Table
          columns={[
            { title: "Skill", dataIndex: "name", key: "name", width: 210, render: (value: string, item: SkillSummary) => <div className="primary-cell"><strong>{value}</strong><span>{item.id}</span></div> },
            { title: "路由描述", dataIndex: "description", key: "description", ellipsis: true },
            { title: "内容指纹", dataIndex: "fingerprint", key: "fingerprint", width: 150, render: (value: string) => <Tooltip title={value}><code>{value.slice(0, 12)}</code></Tooltip> },
            { title: "状态", dataIndex: "registered", key: "registered", width: 110, render: (value: boolean) => <Tag color={value ? "green" : "default"}>{value ? "已登记" : "只读发现"}</Tag> },
            { title: "操作", key: "action", width: 104, render: (_: unknown, item: SkillSummary) => item.registered ? <Button disabled icon={<Check size={15} />}>已登记</Button> : <Button icon={<Plus size={15} />} onClick={() => void register(item)}>登记</Button> },
          ]}
          dataSource={filtered}
          loading={loading}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现 Skill" /> }}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          rowKey="id"
          size="middle"
        />
      </section>
    </>
  );
}
