import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BadCaseDetail } from "./BadCaseDetail";
import type { BadCase, SessionContext } from "../types";

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

const sessionContext: SessionContext = {
  threadId: "thread-1",
  deliveryRef: "thread-1:turn-1",
  sourcePath: "/private/session.jsonl",
  triggerTurnId: "turn-1",
  feedbackTurnId: "turn-2",
  feedback: "不对，你覆盖了原始公式，请重做。",
  turns: [
    {
      turnId: "turn-1",
      startedAt: "2026-08-22T07:59:00.000Z",
      completedAt: "2026-08-22T08:00:00.000Z",
      isTrigger: true,
      isFeedback: false,
      events: [
        {
          type: "user_message",
          timestamp: "2026-08-22T07:59:01.000Z",
          turnId: "turn-1",
          summary: "请更新表格并保留公式",
          content: "请更新表格并保留公式",
        },
        {
          type: "skill_read",
          timestamp: "2026-08-22T07:59:02.000Z",
          turnId: "turn-1",
          summary: "读取 Skill: xlsx",
          content: "读取 Skill: xlsx",
          skillName: "xlsx",
        },
        {
          type: "agent_message",
          timestamp: "2026-08-22T08:00:00.000Z",
          turnId: "turn-1",
          summary: "已更新表格",
          content: "已更新表格",
          phase: "final_answer",
        },
      ],
    },
    {
      turnId: "turn-2",
      startedAt: "2026-08-22T08:01:00.000Z",
      completedAt: null,
      isTrigger: false,
      isFeedback: true,
      events: [
        {
          type: "user_message",
          timestamp: "2026-08-22T08:01:01.000Z",
          turnId: "turn-2",
          summary: "不对，你覆盖了原始公式，请重做。",
          content: "不对，你覆盖了原始公式，请重做。",
        },
      ],
    },
  ],
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
    expect(screen.getByRole("button", { name: "确认问题" })).toBeInTheDocument();
  });

  it("renders the complete session timeline and highlights trigger and feedback turns", () => {
    render(
      <BadCaseDetail
        item={{ ...baseCase, deliveryRef: "thread-1:turn-1", captureSource: "prompt_first" }}
        sessionContext={sessionContext}
        {...actions}
      />,
    );

    expect(screen.getByRole("heading", { name: "Session 完整上下文" })).toBeInTheDocument();
    expect(screen.getByText("触发交付")).toBeInTheDocument();
    expect(screen.getByText("用户反馈")).toBeInTheDocument();
    expect(screen.getByText("读取 Skill: xlsx")).toBeInTheDocument();
    expect(screen.getAllByText("已更新表格").length).toBeGreaterThan(0);
  });

  it("explains that manual cases have no linked session without blocking governance", () => {
    render(<BadCaseDetail item={{ ...baseCase, sourceSessionId: null }} {...actions} />);

    expect(screen.getByText("无关联 Session 上下文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认问题" })).toBeInTheDocument();
  });
});
