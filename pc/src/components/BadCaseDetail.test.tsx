import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BadCaseDetail } from "./BadCaseDetail";
import type { BadCase } from "../types";

const baseCase: BadCase = {
  id: "case-1",
  title: "公式丢失",
  problem: "公式被覆盖",
  expectedOutcome: "保留公式",
  deliveryRef: null,
  captureSource: "manual",
  userFeedback: "",
  failureReason: "",
  sourceSessionId: "session-1",
  sourcePath: "/private/session.jsonl",
  taskSummary: "更新表格",
  skillNames: ["xlsx"],
  signalTypes: ["tool_failure"],
  status: "pending_confirmation",
  attribution: null,
  attributionNote: "",
  evidencePath: null,
  confirmedAt: null,
  attributedAt: null,
  rejectedAt: null,
  assetizedAt: null,
  createdAt: "2026-08-22T08:00:00.000Z",
  updatedAt: "2026-08-22T08:00:00.000Z",
};

const actions = {
  onSave: vi.fn(),
  onConfirm: vi.fn(),
  onReject: vi.fn(),
  onAttribute: vi.fn(),
  onPromote: vi.fn(),
};

describe("BadCaseDetail", () => {
  it("shows confirmation actions before attribution", () => {
    render(<BadCaseDetail item={baseCase} {...actions} />);
    expect(screen.getByRole("button", { name: "确认问题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "驳回" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "转为 Evidence" })).not.toBeInTheDocument();
  });

  it("only exposes evidence promotion after attribution", () => {
    render(
      <BadCaseDetail
        item={{ ...baseCase, status: "attributed", attribution: "skill_content_defect" }}
        {...actions}
      />,
    );
    expect(screen.getByRole("button", { name: "转为 Evidence" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认问题" })).not.toBeInTheDocument();
  });

  it("shows the delivery evidence for an automatically captured case without inventing the expectation", () => {
    render(
      <BadCaseDetail
        item={{
          ...baseCase,
          problem: "交付覆盖了原始公式",
          expectedOutcome: "",
          deliveryRef: "thread-1:turn-1",
          captureSource: "prompt_first",
          userFeedback: "不对，你覆盖了原始公式，请重做。",
          failureReason: "交付覆盖了原始公式",
        }}
        delivery={{
          deliveryRef: "thread-1:turn-1",
          threadId: "thread-1",
          turnId: "turn-1",
          startedAt: "2026-08-22T07:59:00.000Z",
          completedAt: "2026-08-22T08:00:00.000Z",
          cwd: "/workspace/example",
          userRequest: "请更新表格并保留公式",
          finalAnswer: "已更新表格",
          actualSkills: ["xlsx"],
          nextUserFeedback: "不对，你覆盖了原始公式，请重做。",
          failureReason: "交付覆盖了原始公式",
          captureStatus: "captured",
          governanceStatus: "pending_confirmation",
        }}
        {...actions}
      />,
    );

    expect(screen.getByText("自动采集")).toBeInTheDocument();
    expect(screen.getByText("请更新表格并保留公式")).toBeInTheDocument();
    expect(screen.getByText("已更新表格")).toBeInTheDocument();
    expect(screen.getByText("不对，你覆盖了原始公式，请重做。")).toBeInTheDocument();
    expect(screen.getByLabelText("期望结果")).toHaveValue("");
  });

  it("shows a context warning when an automatic case can no longer read its source", () => {
    render(
      <BadCaseDetail
        item={{ ...baseCase, deliveryRef: "thread-1:turn-1", captureSource: "prompt_first" }}
        deliveryError="Delivery Unit 源日志不可用"
        {...actions}
      />,
    );

    expect(screen.getByText("Delivery Unit 源日志不可用")).toBeInTheDocument();
  });
});
