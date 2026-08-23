import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isValidElement } from "react";
import { MemoryRouter, Navigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { BadCase, DeliveryUnitDetail, SessionContext } from "../types";
import { BadCasesPage } from "./BadCasesPage";

vi.mock("../api", () => ({
  api: {
    getBadCases: vi.fn(),
    getDeliveryUnit: vi.fn(),
    getSessionContext: vi.fn(),
    updateBadCase: vi.fn(),
    confirmBadCase: vi.fn(),
    rejectBadCase: vi.fn(),
    attributeBadCase: vi.fn(),
    promoteBadCase: vi.fn(),
  },
}));

const automaticCase: BadCase = {
  id: "case-automatic",
  title: "未遵循指定口吻",
  problem: "交付没有体现张雪峰的表达风格",
  expectedOutcome: "",
  deliveryRef: "thread-1:turn-1",
  captureSource: "prompt_first",
  userFeedback: "你有没有用张雪峰skill，我觉得你的口吻不像张雪峰的口吻",
  failureReason: "交付语气与张雪峰 Skill 的风格不一致",
  sourceSessionId: "thread-1",
  sourcePath: "/private/session.jsonl",
  taskSummary: "用张雪峰的视角分析专业选择",
  skillNames: ["zhangxuefeng-perspective"],
  signalTypes: ["user_correction"],
  status: "pending_confirmation",
  attribution: null,
  attributionNote: "",
  evidencePath: null,
  confirmedAt: null,
  attributedAt: null,
  rejectedAt: null,
  assetizedAt: null,
  createdAt: "2026-08-23T08:00:00.000Z",
  updatedAt: "2026-08-23T08:00:00.000Z",
};

const delivery: DeliveryUnitDetail = {
  deliveryRef: "thread-1:turn-1",
  threadId: "thread-1",
  turnId: "turn-1",
  startedAt: "2026-08-23T07:59:00.000Z",
  completedAt: "2026-08-23T08:00:00.000Z",
  cwd: "/workspace/example",
  userRequest: "用张雪峰的视角分析专业选择",
  finalAnswer: "以下是专业选择建议",
  actualSkills: ["zhangxuefeng-perspective"],
  nextUserFeedback: automaticCase.userFeedback,
  failureReason: automaticCase.failureReason,
  captureStatus: "captured",
  governanceStatus: "pending_confirmation",
};

const sessionContext: SessionContext = {
  threadId: "thread-1",
  deliveryRef: "thread-1:turn-1",
  sourcePath: "/private/session.jsonl",
  triggerTurnId: "turn-1",
  feedbackTurnId: "turn-2",
  feedback: automaticCase.userFeedback,
  turns: [
    {
      turnId: "turn-1",
      startedAt: "2026-08-23T07:59:00.000Z",
      completedAt: "2026-08-23T08:00:00.000Z",
      isTrigger: true,
      isFeedback: false,
      events: [
        { type: "user_message", timestamp: "2026-08-23T07:59:01.000Z", turnId: "turn-1", summary: delivery.userRequest, content: delivery.userRequest },
        { type: "skill_read", timestamp: "2026-08-23T07:59:02.000Z", turnId: "turn-1", summary: "读取 Skill: zhangxuefeng-perspective", content: "读取 Skill: zhangxuefeng-perspective", skillName: "zhangxuefeng-perspective" },
        { type: "agent_message", timestamp: "2026-08-23T08:00:00.000Z", turnId: "turn-1", summary: delivery.finalAnswer, content: delivery.finalAnswer, phase: "final_answer" },
      ],
    },
    {
      turnId: "turn-2",
      startedAt: "2026-08-23T08:01:00.000Z",
      completedAt: null,
      isTrigger: false,
      isFeedback: true,
      events: [
        { type: "user_message", timestamp: "2026-08-23T08:01:01.000Z", turnId: "turn-2", summary: automaticCase.userFeedback, content: automaticCase.userFeedback },
      ],
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <BadCasesPage />
    </MemoryRouter>,
  );
}

describe("BadCasesPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getBadCases).mockResolvedValue({ items: [automaticCase] });
    vi.mocked(api.getDeliveryUnit).mockResolvedValue(delivery);
    vi.mocked(api.getSessionContext).mockResolvedValue(sessionContext);
  });

  it("shows every automatic-capture signal in the governance inbox", async () => {
    renderPage();

    expect(await screen.findByText(automaticCase.userFeedback)).toBeInTheDocument();
    expect(screen.getByText(automaticCase.failureReason)).toBeInTheDocument();
    expect(screen.getByText("zhangxuefeng-perspective")).toBeInTheDocument();
    expect(screen.getByText("自动采集")).toBeInTheDocument();
    expect(screen.getByText("待确认")).toBeInTheDocument();
  });

  it("loads the delivery and complete session timeline only after opening a case", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(automaticCase.userFeedback)).toBeInTheDocument();
    expect(api.getSessionContext).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "查看" }));

    expect(api.getDeliveryUnit).toHaveBeenCalledWith(automaticCase.deliveryRef);
    expect(api.getSessionContext).toHaveBeenCalledWith(automaticCase.deliveryRef);
    const drawer = await screen.findByRole("dialog", { name: "Bad Case 详情" });
    expect(within(drawer).getByRole("heading", { name: "Session 完整上下文" })).toBeInTheDocument();
    expect(within(drawer).getByText("触发交付")).toBeInTheDocument();
    expect(within(drawer).getByText("用户反馈")).toBeInTheDocument();
  });

  it("keeps governance actions available when the session context cannot be loaded", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSessionContext).mockRejectedValue(new Error("Session 源文件不可用"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "查看" }));

    const drawer = await screen.findByRole("dialog", { name: "Bad Case 详情" });
    expect(await within(drawer).findByText("Session 源文件不可用")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "确认问题" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "驳回" })).toBeInTheDocument();
  });

  it("does not request context for a manual case without a delivery reference", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getBadCases).mockResolvedValue({
      items: [{ ...automaticCase, id: "case-manual", captureSource: "manual", deliveryRef: null }],
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "查看" }));

    expect(api.getSessionContext).not.toHaveBeenCalled();
    const drawer = await screen.findByRole("dialog", { name: "Bad Case 详情" });
    expect(within(drawer).getByText("无关联 Session 上下文")).toBeInTheDocument();
  });

  it("ignores stale context when switching to a manual case", async () => {
    const user = userEvent.setup();
    let resolveDelivery!: (value: DeliveryUnitDetail) => void;
    let resolveContext!: (value: SessionContext) => void;
    vi.mocked(api.getBadCases).mockResolvedValue({
      items: [
        automaticCase,
        { ...automaticCase, id: "case-manual", title: "人工案例", captureSource: "manual", deliveryRef: null },
      ],
    });
    vi.mocked(api.getDeliveryUnit).mockReturnValue(new Promise((resolve) => { resolveDelivery = resolve; }));
    vi.mocked(api.getSessionContext).mockReturnValue(new Promise((resolve) => { resolveContext = resolve; }));
    renderPage();

    const actions = await screen.findAllByRole("button", { name: "查看" });
    await user.click(actions[0]);
    await user.click(actions[1]);
    resolveDelivery(delivery);
    resolveContext(sessionContext);

    const drawer = await screen.findByRole("dialog", { name: "Bad Case 详情" });
    expect(within(drawer).getByText("无关联 Session 上下文")).toBeInTheDocument();
    await waitFor(() => expect(within(drawer).queryByRole("heading", { name: "Session 完整上下文" })).not.toBeInTheDocument());
    expect(within(drawer).queryByText("正在读取 Session 完整上下文")).not.toBeInTheDocument();
  });

  it("keeps actions visible after asynchronously loading context", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "查看" }));

    await waitFor(() => expect(api.getSessionContext).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "确认问题" })).toBeInTheDocument();
  });

  it("redirects the legacy runs route to the Bad Case inbox", async () => {
    const { appRoutes } = await import("../App");
    const legacyRoute = appRoutes[0].children?.find((route) => route.path === "runs");

    expect(isValidElement(legacyRoute?.element)).toBe(true);
    expect(legacyRoute?.element).toMatchObject({
      type: Navigate,
      props: { replace: true, to: "/bad-cases" },
    });
  });
});
