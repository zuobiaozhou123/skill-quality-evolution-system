import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../storage/database.js";
import { BadCaseService } from "./bad-case-service.js";

describe("BadCaseService", () => {
  it("requires confirmed expectations before attribution and evidence promotion", async () => {
    const evidenceRoot = await mkdtemp(path.join(tmpdir(), "evidence-"));
    const database = createDatabase(":memory:");
    const service = new BadCaseService(database, evidenceRoot);
    const badCase = service.create({
      title: "公式在修改后丢失",
      sourceSessionId: "session-1",
      sourcePath: "/private/raw-session.jsonl",
      taskSummary: "更新表格输入行",
      skillNames: ["xlsx"],
      signalTypes: ["tool_failure"],
    });

    expect(badCase.status).toBe("pending_confirmation");
    expect(() => service.confirm(badCase.id)).toThrow("请先补充问题描述和期望结果");

    service.update(badCase.id, {
      problem: "输入更新后，原有公式被替换为常量。",
      expectedOutcome: "更新输入数据，同时保留原有公式。",
    });
    const confirmed = service.confirm(badCase.id);
    expect(confirmed).toMatchObject({ status: "confirmed", confirmedAt: expect.any(String) });
    const attributed =
      service.attribute(badCase.id, "skill_content_defect", "Skill 未约束写入行为");
    expect(attributed).toMatchObject({
      status: "attributed",
      attribution: "skill_content_defect",
      attributedAt: expect.any(String),
    });

    const promoted = await service.promoteToEvidence(badCase.id);
    expect(promoted.badCase).toMatchObject({ status: "assetized", assetizedAt: expect.any(String) });
    const evidenceContent = await readFile(promoted.evidencePath, "utf8");
    expect(evidenceContent).toContain("输入更新后，原有公式被替换为常量");
    expect(evidenceContent).not.toContain("/private/raw-session.jsonl");
    expect(evidenceContent).not.toContain("session-1");
    expect(evidenceContent).not.toContain("更新表格输入行");
    expect(JSON.parse(evidenceContent).confirmedAt).toBe(confirmed.confirmedAt);
  });

  it("does not allow attribution before confirmation", async () => {
    const evidenceRoot = await mkdtemp(path.join(tmpdir(), "evidence-"));
    const service = new BadCaseService(createDatabase(":memory:"), evidenceRoot);
    const badCase = service.create({ title: "待确认问题" });

    expect(() => service.attribute(badCase.id, "execution_lapse", "规则已经存在"))
      .toThrow("只有已确认的 Bad Case 才能归因");
  });

  it("locks confirmed facts after attribution", () => {
    const service = new BadCaseService(createDatabase(":memory:"), "/tmp/evidence-unused");
    const badCase = service.create({
      title: "待归因问题",
      problem: "实际结果",
      expectedOutcome: "期望结果",
    });
    service.confirm(badCase.id);
    service.attribute(badCase.id, "execution_lapse", "规则已经存在");

    expect(() => service.update(badCase.id, { problem: "改写后的事实" }))
      .toThrow("当前状态不允许编辑");
  });

  it("keeps required facts complete after confirmation", () => {
    const service = new BadCaseService(createDatabase(":memory:"), "/tmp/evidence-unused");
    const badCase = service.create({
      title: "已确认问题",
      problem: "实际结果",
      expectedOutcome: "期望结果",
    });
    service.confirm(badCase.id);

    expect(() => service.update(badCase.id, { expectedOutcome: "" }))
      .toThrow("已确认的 Bad Case 必须保留问题描述和期望结果");
  });

  it("returns an edited confirmed case to confirmation", () => {
    const service = new BadCaseService(createDatabase(":memory:"), "/tmp/evidence-unused");
    const badCase = service.create({
      title: "已确认问题",
      problem: "实际结果",
      expectedOutcome: "期望结果",
    });
    service.confirm(badCase.id);

    expect(service.update(badCase.id, { problem: "修订后的实际结果" })).toMatchObject({
      status: "pending_confirmation",
      confirmedAt: null,
    });
  });

  it("rejects unsupported attribution values", () => {
    const service = new BadCaseService(createDatabase(":memory:"), "/tmp/evidence-unused");
    const badCase = service.create({
      title: "已确认问题",
      problem: "实际结果",
      expectedOutcome: "期望结果",
    });
    service.confirm(badCase.id);

    expect(() => service.attribute(badCase.id, "not-a-real-type" as never, ""))
      .toThrow("无效的归因类型");
  });
});
