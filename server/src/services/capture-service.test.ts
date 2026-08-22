import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../storage/database.js";
import { BadCaseService } from "./bad-case-service.js";
import { CaptureService } from "./capture-service.js";

async function writeSession(
  root: string,
  name: string,
  options: { skill?: boolean; complete?: boolean } = {},
): Promise<string> {
  const sourcePath = path.join(root, `${name}.jsonl`);
  const events: object[] = [
    { type: "session_meta", payload: { id: name, cwd: "/workspace/example" } },
    {
      timestamp: "2026-08-22T08:00:00.000Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: "delivery" },
    },
    {
      type: "event_msg",
      payload: { type: "user_message", message: "检查表格公式" },
    },
  ];
  if (options.skill !== false) {
    events.push({
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        input: '{"cmd":"cat /Users/example/.codex/skills/xlsx/SKILL.md"}',
      },
    });
  }
  events.push({
    type: "event_msg",
    payload: { type: "agent_message", message: "公式已更新", phase: "final_answer" },
  });
  if (options.complete !== false) {
    events.push(
      {
        timestamp: "2026-08-22T08:01:00.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "delivery" },
      },
      {
        timestamp: "2026-08-22T08:02:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "feedback" },
      },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "不对，请重新核对原公式" },
      },
    );
  }
  await writeFile(sourcePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return sourcePath;
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "capture-service-"));
  const database = createDatabase(":memory:");
  const badCases = new BadCaseService(database, path.join(root, "evidence"));
  return { root, database, badCases, service: new CaptureService(database, badCases, root) };
}

describe("CaptureService", () => {
  it("freezes a balanced feedback classification matrix and its phase-one thresholds", async () => {
    const matrixPath = path.resolve(
      import.meta.dirname,
      "../../../governance/evaluation/feedback-capture-cases.json",
    );
    const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as {
      thresholds: {
        negativeCaptureRateMin: number;
        nonNegativeFalsePositiveRateMax: number;
        createdCaseAssociationAccuracyMin: number;
      };
      pilotSkills: Array<{ category: string; skills: string[] }>;
      cases: Array<{
        id: string;
        skillCategory: string;
        previousSkillUsed: boolean;
        feedbackType: string;
        expectedAction: "record" | "ignore" | "clarify";
      }>;
    };

    expect(matrix.pilotSkills.map(({ category }) => category)).toEqual([
      "objective",
      "open_ended",
      "routing_conflict",
    ]);
    expect(new Set(matrix.cases.map(({ skillCategory }) => skillCategory))).toEqual(
      new Set(["objective", "open_ended", "routing_conflict", "none"]),
    );
    expect(new Set(matrix.cases.map(({ id }) => id)).size).toBe(matrix.cases.length);
    expect(new Set(matrix.cases.map(({ feedbackType }) => feedbackType))).toEqual(
      new Set([
        "explicit_rejection",
        "local_correction",
        "rework_request",
        "supplement",
        "continue",
        "positive",
        "new_task",
        "ambiguous_dissatisfaction",
      ]),
    );

    const clearNegatives = matrix.cases.filter(
      ({ previousSkillUsed, feedbackType }) =>
        previousSkillUsed &&
        ["explicit_rejection", "local_correction", "rework_request"].includes(feedbackType),
    );
    const nonNegatives = matrix.cases.filter(({ previousSkillUsed, feedbackType }) =>
      previousSkillUsed && ["supplement", "continue", "positive", "new_task"].includes(feedbackType),
    );
    const ambiguous = matrix.cases.filter(
      ({ previousSkillUsed, feedbackType }) =>
        previousSkillUsed && feedbackType === "ambiguous_dissatisfaction",
    );

    expect(clearNegatives).toHaveLength(9);
    expect(clearNegatives.every(({ expectedAction }) => expectedAction === "record")).toBe(true);
    expect(nonNegatives).toHaveLength(12);
    expect(nonNegatives.every(({ expectedAction }) => expectedAction === "ignore")).toBe(true);
    expect(ambiguous).toHaveLength(3);
    expect(ambiguous.every(({ expectedAction }) => expectedAction === "clarify")).toBe(true);
    expect(
      matrix.cases
        .filter(({ previousSkillUsed }) => !previousSkillUsed)
        .every(({ expectedAction }) => expectedAction === "ignore"),
    ).toBe(true);
    expect(matrix.thresholds).toEqual({
      negativeCaptureRateMin: 0.9,
      nonNegativeFalsePositiveRateMax: 0.05,
      createdCaseAssociationAccuracyMin: 1,
    });
  });

  it("creates a pending case from a valid delivery reference without inventing expectations", async () => {
    const fixture = await createFixture();
    const sourcePath = await writeSession(fixture.root, "thread-valid");

    const result = await fixture.service.capture({
      deliveryRef: "thread-valid:delivery",
      captureSource: "prompt_first",
      failureReason: "交付没有保留原公式",
    });

    expect(result).toMatchObject({
      status: "captured",
      created: true,
      badCase: {
        status: "pending_confirmation",
        expectedOutcome: "",
        problem: "交付没有保留原公式",
        deliveryRef: "thread-valid:delivery",
        captureSource: "prompt_first",
        userFeedback: "不对，请重新核对原公式",
        failureReason: "交付没有保留原公式",
        sourceSessionId: "thread-valid",
        sourcePath,
        taskSummary: "检查表格公式",
        skillNames: ["xlsx"],
        signalTypes: ["user_correction"],
      },
      event: {
        status: "captured",
        deliveryRef: "thread-valid:delivery",
        badCaseId: expect.any(String),
      },
    });
    expect(() => fixture.badCases.confirm(result.badCase!.id)).toThrow(
      "请先补充问题描述和期望结果",
    );
  });

  it("returns the same case for duplicate delivery captures and never resurrects rejection", async () => {
    const fixture = await createFixture();
    const sourcePath = await writeSession(fixture.root, "thread-duplicate");
    const input = {
      deliveryRef: "thread-duplicate:delivery",
      captureSource: "prompt_first" as const,
      failureReason: "公式不正确",
    };

    const first = await fixture.service.capture(input);
    fixture.badCases.reject(first.badCase!.id);
    await unlink(sourcePath);
    const duplicate = await fixture.service.capture({ ...input, failureReason: "又一次重复投递" });

    expect(duplicate).toMatchObject({
      status: "duplicate",
      created: false,
      badCase: { id: first.badCase!.id, status: "rejected", failureReason: "公式不正确" },
      event: { status: "duplicate", badCaseId: first.badCase!.id },
    });
    expect(fixture.badCases.list()).toHaveLength(1);
    expect(fixture.service.listEvents().map((event) => event.status)).toEqual([
      "duplicate",
      "captured",
    ]);
  });

  it.each([
    ["missing reference", ""],
    ["wrong thread", "missing-thread:delivery"],
    ["completed turn without a proven Skill", "thread-no-skill:delivery"],
    ["incomplete turn", "thread-incomplete:delivery"],
    ["missing source log", "thread-vanished:delivery"],
  ])("fails closed for %s and records only an association event", async (_label, deliveryRef) => {
    const fixture = await createFixture();
    await writeSession(fixture.root, "thread-no-skill", { skill: false });
    await writeSession(fixture.root, "thread-incomplete", { complete: false });

    const result = await fixture.service.capture({
      deliveryRef,
      captureSource: "prompt_first",
      failureReason: "需要重做",
    });

    expect(result).toMatchObject({
      status: "association_failed",
      created: false,
      badCase: null,
      event: {
        deliveryRef,
        status: "association_failed",
        associationError: deliveryRef ? "delivery_not_found" : "delivery_invalid",
        badCaseId: null,
      },
    });
    expect(fixture.badCases.list()).toEqual([]);
    expect(fixture.service.listEvents()).toHaveLength(1);
  });

  it("rolls back an automatic case when its captured event cannot be persisted", async () => {
    const fixture = await createFixture();
    await writeSession(fixture.root, "thread-atomic");
    fixture.database.exec(`
      CREATE TRIGGER reject_capture_event
      BEFORE INSERT ON capture_events
      BEGIN
        SELECT RAISE(ABORT, 'capture event blocked');
      END;
    `);

    await expect(
      fixture.service.capture({
        deliveryRef: "thread-atomic:delivery",
        captureSource: "prompt_first",
        failureReason: "公式不正确",
      }),
    ).rejects.toThrow("capture event blocked");
    expect(fixture.badCases.list()).toEqual([]);
    expect(fixture.service.listEvents()).toEqual([]);
  });

  it("isolates a failed association and still captures the next exact delivery", async () => {
    const fixture = await createFixture();
    await writeSession(fixture.root, "thread-after-failure");

    const failed = await fixture.service.capture({
      deliveryRef: "unknown-thread:unknown-turn",
      captureSource: "prompt_first",
      failureReason: "不应该影响主任务",
    });
    const captured = await fixture.service.capture({
      deliveryRef: "thread-after-failure:delivery",
      captureSource: "prompt_first",
      failureReason: "原公式未保留",
    });

    expect(failed).toMatchObject({ status: "association_failed", created: false });
    expect(captured).toMatchObject({
      status: "captured",
      created: true,
      badCase: {
        deliveryRef: "thread-after-failure:delivery",
        sourceSessionId: "thread-after-failure",
        taskSummary: "检查表格公式",
        userFeedback: "不对，请重新核对原公式",
      },
    });
    expect(fixture.badCases.list()).toHaveLength(1);
    expect(fixture.service.listEvents().map(({ status }) => status).sort()).toEqual([
      "association_failed",
      "captured",
    ]);
  });
});
