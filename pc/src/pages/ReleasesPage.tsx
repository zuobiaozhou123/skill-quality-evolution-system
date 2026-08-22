import { Empty } from "antd";
import { PageHeader } from "../components/PageHeader";

export function ReleasesPage() {
  return (
    <>
      <PageHeader eyebrow="RELEASE / HUMAN GATE" title="发布中心" />
      <div className="empty-workspace"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待发布版本" /></div>
    </>
  );
}
