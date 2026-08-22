import { Empty } from "antd";
import { PageHeader } from "../components/PageHeader";

export function ProposalsPage() {
  return (
    <>
      <PageHeader eyebrow="EVOLUTION / CANDIDATES" title="变更提案" />
      <div className="empty-workspace"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无变更提案" /></div>
    </>
  );
}
