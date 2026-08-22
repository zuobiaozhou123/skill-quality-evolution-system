import { Alert, Button, Drawer, Empty, Input, Select, Space, Table, Tag, message } from "antd";
import dayjs from "dayjs";
import { Eye, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { BadCaseDetail, statusLabels } from "../components/BadCaseDetail";
import { PageHeader } from "../components/PageHeader";
import type { AttributionType, BadCase, BadCaseStatus, DeliveryUnitDetail } from "../types";

export function BadCasesPage() {
  const [items, setItems] = useState<BadCase[]>([]);
  const [selected, setSelected] = useState<BadCase>();
  const [delivery, setDelivery] = useState<DeliveryUnitDetail>();
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [status, setStatus] = useState<BadCaseStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setItems((await api.getBadCases()).items); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const replace = (next: BadCase) => {
    setItems((current) => current.map((item) => item.id === next.id ? next : item));
    setSelected(next);
  };
  const openDetail = async (item: BadCase) => {
    setSelected(item);
    setDelivery(undefined);
    setDeliveryError("");
    if (!item.deliveryRef) return;
    setDeliveryLoading(true);
    try { setDelivery(await api.getDeliveryUnit(item.deliveryRef)); }
    catch (reason) { setDeliveryError((reason as Error).message); }
    finally { setDeliveryLoading(false); }
  };
  const act = async (operation: () => Promise<BadCase>, success: string) => {
    try { replace(await operation()); message.success(success); }
    catch (reason) { message.error((reason as Error).message); }
  };
  const filtered = useMemo(() => items.filter((item) => {
    const matchesStatus = status === "all" || item.status === status;
    const text = `${item.title} ${item.problem} ${item.failureReason} ${item.userFeedback} ${item.skillNames.join(" ")}`.toLowerCase();
    return matchesStatus && text.includes(query.toLowerCase());
  }), [items, query, status]);

  return (
    <>
      <PageHeader eyebrow="TRIAGE / INBOX" title="Bad Case 收集箱" />
      {error && <Alert className="page-alert" message={error} showIcon type="error" />}
      <div className="filter-bar">
        <Input allowClear onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题或 Skill" prefix={<Search size={15} />} value={query} />
        <Select
          onChange={setStatus}
          options={[{ value: "all", label: "全部状态" }, ...Object.entries(statusLabels).map(([value, item]) => ({ value, label: item.label }))]}
          value={status}
        />
      </div>
      <section className="content-section flush-section">
        <Table
          columns={[
            { title: "问题", dataIndex: "title", key: "title", render: (value: string, item: BadCase) => <div className="primary-cell"><strong>{value}</strong><span>{item.problem || "等待补充问题描述"}</span></div> },
            { title: "关联 Skill", dataIndex: "skillNames", key: "skillNames", width: 220, render: (values: string[]) => values.length ? values.map((value) => <Tag key={value}>{value}</Tag>) : "-" },
            { title: "来源", dataIndex: "captureSource", key: "captureSource", width: 110, render: (value: BadCase["captureSource"]) => <Tag>{value === "prompt_first" ? "自动采集" : "人工提交"}</Tag> },
            { title: "状态", dataIndex: "status", key: "status", width: 120, render: (value: BadCaseStatus) => <Tag color={statusLabels[value].color}>{statusLabels[value].label}</Tag> },
            { title: "更新时间", dataIndex: "updatedAt", key: "updatedAt", width: 150, render: (value: string) => dayjs(value).format("MM-DD HH:mm") },
            { title: "操作", key: "action", width: 100, render: (_: unknown, item: BadCase) => <Button icon={<Eye size={15} />} onClick={() => void openDetail(item)}>查看</Button> },
          ]}
          dataSource={filtered}
          loading={loading}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Bad Case" /> }}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          rowKey="id"
          size="middle"
        />
      </section>
      <Drawer
        destroyOnHidden
        onClose={() => {
          setSelected(undefined);
          setDelivery(undefined);
          setDeliveryError("");
        }}
        open={Boolean(selected)}
        title="Bad Case 详情"
        width="min(680px, 100vw)"
      >
        {selected && (
          <BadCaseDetail
            delivery={delivery}
            deliveryError={deliveryError}
            deliveryLoading={deliveryLoading}
            item={selected}
            onAttribute={(attribution: AttributionType, note: string) => act(() => api.attributeBadCase(selected.id, attribution, note), "归因已保存")}
            onConfirm={() => act(() => api.confirmBadCase(selected.id), "问题已确认")}
            onPromote={() => act(() => api.promoteBadCase(selected.id), "已转为 Evidence")}
            onReject={() => act(() => api.rejectBadCase(selected.id), "已驳回")}
            onSave={(values) => act(() => api.updateBadCase(selected.id, values), "已保存")}
          />
        )}
      </Drawer>
    </>
  );
}
