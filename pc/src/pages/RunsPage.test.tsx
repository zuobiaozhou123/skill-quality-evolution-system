import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { RunsPage } from "./RunsPage";

vi.mock("../api", () => ({
  api: {
    getDeliveryUnits: vi.fn(),
    getDeliveryUnit: vi.fn(),
    createBadCase: vi.fn(),
  },
}));

const summary = {
  deliveryRef: "thread-1:turn-1",
  threadId: "thread-1",
  turnId: "turn-1",
  completedAt: "2026-08-22T08:00:00.000Z",
  cwd: "/workspace/example",
  requestSummary: "检查客户表格并保留公式",
  resultSummary: "已经更新客户表格",
  actualSkills: ["xlsx"],
  hasUserFeedback: true,
};

const detail = {
  ...summary,
  startedAt: "2026-08-22T07:59:00.000Z",
  userRequest: "请检查客户表格，并完整保留所有原始公式。",
  finalAnswer: "已更新客户表格，但输出文件中的公式被替换成静态值。",
  nextUserFeedback: "不对，你覆盖了原始公式，请重做。",
  failureReason: "交付覆盖了原始公式",
  captureStatus: "captured" as const,
  governanceStatus: "pending_confirmation" as const,
};

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <RunsPage />
    </MemoryRouter>,
  );
}

describe("RunsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getDeliveryUnits).mockResolvedValue({
      items: [summary],
      pagination: { offset: 0, limit: 20, hasMore: false },
      degradedCount: 0,
    });
    vi.mocked(api.getDeliveryUnit).mockResolvedValue(detail);
    vi.mocked(api.createBadCase).mockResolvedValue({ id: "case-1" } as never);
  });

  it("loads summaries first and fetches the six judgment elements on demand", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(summary.requestSummary)).toBeInTheDocument();
    expect(screen.getByText(summary.resultSummary)).toBeInTheDocument();
    expect(api.getDeliveryUnit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "查看" }));

    expect(api.getDeliveryUnit).toHaveBeenCalledWith(summary.deliveryRef);
    const drawer = await screen.findByRole("dialog", { name: "Delivery Unit 详情" });
    expect(within(drawer).getByText(detail.userRequest)).toBeInTheDocument();
    expect(within(drawer).getByText(detail.finalAnswer)).toBeInTheDocument();
    expect(within(drawer).getByText(detail.nextUserFeedback)).toBeInTheDocument();
    expect(within(drawer).getByText(detail.failureReason)).toBeInTheDocument();
    expect(within(drawer).getByText("xlsx")).toBeInTheDocument();
    expect(within(drawer).getByText("已采集 · 待确认")).toBeInTheDocument();
  });

  it("keeps complete judgment context available for long deliveries", async () => {
    const user = userEvent.setup();
    const longDetail = {
      ...detail,
      userRequest: `请核对完整请求。${"请求细节".repeat(80)}`,
      finalAnswer: `这是完整交付。${"交付细节".repeat(100)}`,
      nextUserFeedback: `这里不对。${"反馈细节".repeat(30)}`,
      failureReason: "未保留需要继续计算的公式",
    };
    vi.mocked(api.getDeliveryUnit).mockResolvedValue(longDetail);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "查看" }));

    const drawer = await screen.findByRole("dialog", { name: "Delivery Unit 详情" });
    expect(within(drawer).getByText(longDetail.userRequest)).toBeVisible();
    expect(within(drawer).getByText(longDetail.finalAnswer)).toBeVisible();
    expect(within(drawer).getByText(longDetail.nextUserFeedback)).toBeVisible();
    expect(within(drawer).getByText(longDetail.failureReason)).toBeVisible();
    expect(within(drawer).getByText("xlsx")).toBeVisible();
    expect(within(drawer).getByText("已采集 · 待确认")).toBeVisible();
  });

  it("shows a clear source-log degradation inside the detail drawer", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getDeliveryUnit).mockRejectedValue(new Error("Delivery Unit 源日志不可用"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "查看" }));

    const drawer = await screen.findByRole("dialog", { name: "Delivery Unit 详情" });
    expect(within(drawer).getByText("Delivery Unit 源日志不可用")).toBeInTheDocument();
    expect(within(drawer).getByText("完整上下文暂时无法读取，请保留当前记录后重试。")).toBeInTheDocument();
  });

  it("requests the next delivery page from the server", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getDeliveryUnits)
      .mockResolvedValueOnce({
        items: [summary],
        pagination: { offset: 0, limit: 20, hasMore: true },
        degradedCount: 0,
      })
      .mockResolvedValueOnce({
        items: [{ ...summary, deliveryRef: "thread-1:turn-21", turnId: "turn-21", requestSummary: "第二页交付" }],
        pagination: { offset: 20, limit: 20, hasMore: false },
        degradedCount: 0,
      });
    renderPage();

    const nextPage = await screen.findByTitle("Next Page");
    await user.click(within(nextPage).getByRole("button"));

    await waitFor(() => expect(api.getDeliveryUnits).toHaveBeenCalledWith(20, 20));
    expect(await screen.findByText("第二页交付")).toBeInTheDocument();
  });

  it("preserves manual bad-case capture from a delivery summary", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "查看" }));
    await user.click(await screen.findByRole("button", { name: "标记为 Bad Case" }));
    await user.type(screen.getByLabelText("哪里不对"), "公式没有保留");
    await user.type(screen.getByLabelText("期望结果"), "保留原公式");
    await user.click(screen.getByRole("button", { name: "创建 Bad Case" }));

    await waitFor(() =>
      expect(api.createBadCase).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSessionId: summary.threadId,
          taskSummary: summary.requestSummary,
          problem: "公式没有保留",
          expectedOutcome: "保留原公式",
          skillNames: ["xlsx"],
        }),
      ),
    );
  });
});
