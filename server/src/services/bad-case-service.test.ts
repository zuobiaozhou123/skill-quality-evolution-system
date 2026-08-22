import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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

  it("migrates a V0 database and enforces one automatic case per delivery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "governance-migration-"));
    const databasePath = path.join(root, "state.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE bad_cases (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        problem TEXT NOT NULL DEFAULT '',
        expected_outcome TEXT NOT NULL DEFAULT '',
        source_session_id TEXT,
        source_path TEXT,
        task_summary TEXT NOT NULL DEFAULT '',
        skill_names TEXT NOT NULL DEFAULT '[]',
        signal_types TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        attribution TEXT,
        attribution_note TEXT NOT NULL DEFAULT '',
        evidence_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO bad_cases (
        id, title, status, created_at, updated_at
      ) VALUES ('legacy-case', '旧案例', 'pending_confirmation', '2026-08-22', '2026-08-22');
    `);
    legacy.close();

    const database = createDatabase(databasePath);
    const service = new BadCaseService(database, path.join(root, "evidence"));

    expect(service.get("legacy-case")).toMatchObject({
      captureSource: "manual",
      deliveryRef: null,
      userFeedback: "",
      failureReason: "",
    });
    expect(database.prepare("PRAGMA index_list(bad_cases)").all()).toContainEqual(
      expect.objectContaining({ name: "bad_cases_delivery_ref_unique", unique: 1 }),
    );
    const first = service.createFromCapture({
      title: "公式被覆盖 · 待核查",
      problem: "没有保留公式",
      deliveryRef: "thread-1:turn-1",
      captureSource: "prompt_first",
      userFeedback: "不对，请重新核对公式",
      failureReason: "没有保留公式",
      sourceSessionId: "thread-1",
      sourcePath: "/private/session.jsonl",
      taskSummary: "检查表格公式",
      skillNames: ["xlsx"],
      signalTypes: ["user_correction"],
    });
    const duplicate = service.createFromCapture({
      title: "重复标题",
      problem: "重复原因",
      deliveryRef: "thread-1:turn-1",
      captureSource: "prompt_first",
      userFeedback: "重复反馈",
      failureReason: "重复原因",
      skillNames: ["xlsx"],
    });

    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({ created: false, badCase: { id: first.badCase.id } });
    expect(service.list()).toHaveLength(2);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM capture_events").get(),
    ).toMatchObject({ count: 0 });
    database.close();
  });
});
