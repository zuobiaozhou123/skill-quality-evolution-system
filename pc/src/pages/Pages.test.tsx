import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { BadCasesPage } from "./BadCasesPage";
import { EvidencePage } from "./EvidencePage";
import { OverviewPage } from "./OverviewPage";
import { ProposalsPage } from "./ProposalsPage";
import { ReleasesPage } from "./ReleasesPage";
import { SkillsPage } from "./SkillsPage";

vi.mock("../api", () => ({
  api: {
    getDashboard: vi.fn(),
    getBadCases: vi.fn(),
    getEvidence: vi.fn(),
    getSkills: vi.fn(),
  },
}));

describe("governance pages", () => {
  beforeEach(() => {
    vi.mocked(api.getDashboard).mockResolvedValue({
      pipeline: {
        discovered: 0,
        pendingConfirmation: 0,
        attributed: 0,
        assetized: 0,
        candidateValidation: 0,
        pendingRelease: 0,
      },
      totals: { sessions: 0, badCases: 0, evidence: 0, registeredSkills: 0 },
      recentBadCases: [],
    });
    vi.mocked(api.getBadCases).mockResolvedValue({ items: [] });
    vi.mocked(api.getEvidence).mockResolvedValue({ items: [] });
    vi.mocked(api.getSkills).mockResolvedValue({ items: [] });
  });

  it.each([
    [OverviewPage, "治理总览"],
    [BadCasesPage, "Bad Case 收集箱"],
    [EvidencePage, "Evidence 证据库"],
    [SkillsPage, "Skill 资产库"],
    [ProposalsPage, "变更提案"],
    [ReleasesPage, "发布中心"],
  ])("renders %s", async (Page, heading) => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Page />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });
});
