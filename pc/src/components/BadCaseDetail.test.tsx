import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BadCaseDetail } from "./BadCaseDetail";
import type { BadCase } from "../types";

const baseCase: BadCase = {
  id: "case-1",
  title: "公式丢失",
  problem: "公式被覆盖",
  expectedOutcome: "保留公式",
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
});
