import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PipelineStrip } from "./PipelineStrip";

describe("PipelineStrip", () => {
  it("renders every governance stage with the current count", () => {
    render(
      <PipelineStrip
        pipeline={{
          discovered: 3,
          pendingConfirmation: 2,
          attributed: 1,
          assetized: 1,
          candidateValidation: 0,
          pendingRelease: 0,
        }}
      />,
    );

    expect(screen.getByText("发现异常")).toBeInTheDocument();
    expect(screen.getByText("待确认")).toBeInTheDocument();
    expect(screen.getByText("已归因")).toBeInTheDocument();
    expect(screen.getByText("已资产化")).toBeInTheDocument();
    expect(screen.getByText("候选验证")).toBeInTheDocument();
    expect(screen.getByText("待发布")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
