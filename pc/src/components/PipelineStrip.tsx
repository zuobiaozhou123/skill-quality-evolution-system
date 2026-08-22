import type { PipelineCounts } from "../types";

const stages: Array<{ key: keyof PipelineCounts; label: string }> = [
  { key: "discovered", label: "发现异常" },
  { key: "pendingConfirmation", label: "待确认" },
  { key: "attributed", label: "已归因" },
  { key: "assetized", label: "已资产化" },
  { key: "candidateValidation", label: "候选验证" },
  { key: "pendingRelease", label: "待发布" },
];

export function PipelineStrip({ pipeline }: { pipeline: PipelineCounts }) {
  return (
    <div className="pipeline-strip" aria-label="治理流水线">
      {stages.map((stage, index) => (
        <div className="pipeline-stage" key={stage.key}>
          <span className="pipeline-index">{String(index + 1).padStart(2, "0")}</span>
          <strong>{pipeline[stage.key]}</strong>
          <span>{stage.label}</span>
        </div>
      ))}
    </div>
  );
}
