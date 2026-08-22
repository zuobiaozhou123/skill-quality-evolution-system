import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { MainLayout } from "./MainLayout";

describe("MainLayout", () => {
  it("shows the complete governance navigation", () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <MainLayout content={<div>content</div>} />
      </MemoryRouter>,
    );

    for (const label of [
      "治理总览",
      "运行发现",
      "Bad Case",
      "Evidence",
      "Skill 资产",
      "变更提案",
      "发布中心",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
