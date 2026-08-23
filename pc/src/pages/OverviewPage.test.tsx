import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { CaptureDiagnostics, Dashboard } from "../types";
import { OverviewPage } from "./OverviewPage";

vi.mock("../api", () => ({
  api: {
    getDashboard: vi.fn(),
    getCaptureDiagnostics: vi.fn(),
  },
}));

const dashboard: Dashboard = {
  pipeline: {
    discovered: 1,
    pendingConfirmation: 1,
    attributed: 0,
    assetized: 0,
    candidateValidation: 0,
    pendingRelease: 0,
  },
  totals: {
    sessions: 1,
    deliveryUnits: 1,
    automaticCandidates: 1,
    badCases: 1,
    evidence: 0,
    registeredSkills: 1,
  },
  recentBadCases: [],
};

const diagnostics: CaptureDiagnostics = {
  status: "attention",
  serviceStatus: "available",
  checkedAt: "2026-08-23T02:00:00.000Z",
  summary: { total: 3, captured: 1, duplicate: 1, associationFailed: 1 },
  outbox: { status: "clear", pendingCount: 0, lastError: null },
  index: { status: "degraded", degradedCount: 2 },
  recentEvents: [
    {
      id: "event-1",
      deliveryRef: "thread-1:turn-1",
      status: "association_failed",
      failureReason: "无法关联上一轮交付",
      associationError: "delivery_not_found",
      createdAt: "2026-08-23T01:59:00.000Z",
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <OverviewPage />
    </MemoryRouter>,
  );
}

describe("OverviewPage capture diagnostics", () => {
  beforeEach(() => {
    vi.mocked(api.getDashboard).mockResolvedValue(dashboard);
    vi.mocked(api.getCaptureDiagnostics).mockResolvedValue(diagnostics);
  });

  it("keeps capture diagnostics collapsed while showing the health signal", async () => {
    renderPage();

    expect(await screen.findByText("采集需关注")).toBeInTheDocument();
    expect(screen.queryByText("无法关联上一轮交付")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("自动采集诊断"));
    expect(await screen.findByText("无法关联上一轮交付")).toBeInTheDocument();
    expect(screen.getAllByText("关联失败 1").length).toBeGreaterThan(0);
    expect(screen.getByText("索引降级 2")).toBeInTheDocument();
  });

  it("distinguishes no trigger from a diagnostic request failure without blocking overview", async () => {
    vi.mocked(api.getCaptureDiagnostics).mockResolvedValue({
      ...diagnostics,
      status: "healthy",
      summary: { total: 0, captured: 0, duplicate: 0, associationFailed: 0 },
      index: { status: "healthy", degradedCount: 0 },
      recentEvents: [],
    });
    const { unmount } = renderPage();

    expect(await screen.findByText("采集正常")).toBeInTheDocument();
    fireEvent.click(screen.getByText("自动采集诊断"));
    expect(await screen.findByText("尚未收到自动采集事件")).toBeInTheDocument();

    unmount();
    vi.mocked(api.getCaptureDiagnostics).mockRejectedValue(new Error("诊断服务离线"));
    renderPage();
    expect(await screen.findByText("治理总览")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("采集诊断暂时不可用")).toBeInTheDocument());
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });
});
