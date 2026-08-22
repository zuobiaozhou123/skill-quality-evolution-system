import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { RunsPage } from "./RunsPage";

vi.mock("../api", () => ({
  api: {
    getSessions: vi.fn(),
    createBadCase: vi.fn(),
  },
}));

describe("RunsPage", () => {
  beforeEach(() => {
    vi.mocked(api.getSessions).mockResolvedValue({
      items: [
        {
          id: "session-1",
          timestamp: "2026-08-22T08:00:00.000Z",
          cwd: "/workspace/example",
          taskSummary: "检查客户表格",
          loadedSkills: ["xlsx"],
          signalTypes: ["tool_failure"],
          sourcePath: "/private/session.jsonl",
        },
      ],
    });
    vi.mocked(api.createBadCase).mockResolvedValue({ id: "case-1" } as never);
  });

  it("creates a bad case from a selected run", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <RunsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("检查客户表格")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "标记" }));
    await user.type(screen.getByLabelText("哪里不对"), "公式没有保留");
    await user.type(screen.getByLabelText("期望结果"), "保留原公式");
    await user.click(screen.getByRole("button", { name: "创建 Bad Case" }));

    await waitFor(() =>
      expect(api.createBadCase).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSessionId: "session-1",
          problem: "公式没有保留",
          expectedOutcome: "保留原公式",
          skillNames: ["xlsx"],
          signalTypes: ["tool_failure"],
        }),
      ),
    );
  });
});
