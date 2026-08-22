import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "governance-api-"));
  const skillsRoot = path.join(root, "skills");
  const sessionsRoot = path.join(root, "sessions");
  const governanceRoot = path.join(root, "governance");
  const runtimeRoot = path.join(root, ".runtime");
  await mkdir(path.join(skillsRoot, "xlsx"), { recursive: true });
  await mkdir(path.join(sessionsRoot, "2026", "08", "22"), { recursive: true });
  await writeFile(
    path.join(skillsRoot, "xlsx", "SKILL.md"),
    "---\nname: xlsx\ndescription: Handle spreadsheets.\n---\n# XLSX\n",
  );
  await writeFile(
    path.join(sessionsRoot, "2026", "08", "22", "session.jsonl"),
    `${JSON.stringify({
      type: "session_meta",
      payload: { id: "s1", timestamp: "2026-08-22T08:00:00.000Z", cwd: "/work" },
    })}\n${JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "检查表格公式" },
    })}\n`,
  );
  const userRequest = `请检查这份表格的公式，${"请保留原始公式。".repeat(30)}`;
  const finalAnswer = `已完成检查，${"所有公式都已重新写入。".repeat(30)}`;
  await writeFile(
    path.join(sessionsRoot, "2026", "08", "22", "delivery.jsonl"),
    [
      {
        timestamp: "2026-08-22T09:00:00.000Z",
        type: "session_meta",
        payload: { id: "thread-delivery", cwd: "/work/delivery" },
      },
      {
        timestamp: "2026-08-22T09:01:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-delivery" },
      },
      { type: "event_msg", payload: { type: "user_message", message: userRequest } },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: '{"cmd":"cat /Users/example/.codex/skills/xlsx/SKILL.md"}',
        },
      },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: finalAnswer, phase: "final_answer" },
      },
      {
        timestamp: "2026-08-22T09:02:00.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-delivery" },
      },
      {
        timestamp: "2026-08-22T09:03:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-feedback" },
      },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "不对，你覆盖了原始公式，请重做" },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n") + "\n",
  );
  return {
    root,
    skillsRoot,
    sessionsRoot,
    governanceRoot,
    runtimeRoot,
    registryPath: path.join(governanceRoot, "registry", "skills.json"),
    evidenceRoot: path.join(governanceRoot, "evidence"),
    databasePath: path.join(runtimeRoot, "state.sqlite"),
    userRequest,
    finalAnswer,
  };
}

describe("governance API", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => app?.close());

  it("discovers and registers a real skill snapshot", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);

    const before = await app.inject({ method: "GET", url: "/api/skills" });
    expect(before.json()).toMatchObject({ items: [{ id: "xlsx", registered: false }] });

    const registered = await app.inject({ method: "POST", url: "/api/skills/xlsx/register" });
    expect(registered.statusCode).toBe(200);
    expect(registered.json()).toMatchObject({ id: "xlsx", registered: true });
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8"));
    expect(registry.items[0]).toMatchObject({ id: "xlsx", name: "xlsx" });
    expect(registry.items[0].sourcePath).toBe("xlsx/SKILL.md");
    expect(registry.items[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not grant cross-origin browser access to the local API", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { origin: "https://untrusted.example" },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("lists paginated delivery summaries without returning full request or output", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);

    const response = await app.inject({
      method: "GET",
      url: "/api/delivery-units?offset=0&limit=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          deliveryRef: "thread-delivery:turn-delivery",
          threadId: "thread-delivery",
          turnId: "turn-delivery",
          actualSkills: ["xlsx"],
          hasUserFeedback: true,
          requestSummary: expect.any(String),
          resultSummary: expect.any(String),
        },
      ],
      pagination: { offset: 0, limit: 1, hasMore: false },
    });
    const summary = response.json().items[0];
    expect(summary).not.toHaveProperty("userRequest");
    expect(summary).not.toHaveProperty("finalAnswer");
    expect(summary).not.toHaveProperty("sourcePath");
    expect(summary.requestSummary.length).toBeLessThan(fixture.userRequest.length);
    expect(summary.resultSummary.length).toBeLessThan(fixture.finalAnswer.length);
  });

  it("returns the six judgment elements on demand for an exact delivery reference", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);

    const response = await app.inject({
      method: "GET",
      url: "/api/delivery-units/thread-delivery%3Aturn-delivery",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      deliveryRef: "thread-delivery:turn-delivery",
      userRequest: fixture.userRequest,
      finalAnswer: fixture.finalAnswer,
      actualSkills: ["xlsx"],
      nextUserFeedback: "不对，你覆盖了原始公式，请重做",
      failureReason: "",
      captureStatus: "not_captured",
      governanceStatus: null,
    });
  });

  it("freezes an idempotent record_bad_case response contract", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);
    const payload = {
      deliveryRef: "thread-delivery:turn-delivery",
      failureReason: "交付覆盖了原始公式",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/captures/record-bad-case",
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      status: "captured",
      created: true,
      deliveryRef: payload.deliveryRef,
      badCaseId: expect.any(String),
      badCaseStatus: "pending_confirmation",
      captureEventId: expect.any(String),
      associationError: null,
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/captures/record-bad-case",
      payload,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      status: "duplicate",
      created: false,
      deliveryRef: payload.deliveryRef,
      badCaseId: first.json().badCaseId,
      badCaseStatus: "pending_confirmation",
      captureEventId: expect.any(String),
      associationError: null,
    });
    expect((await app.inject({ method: "GET", url: "/api/bad-cases" })).json().items).toHaveLength(1);
  });

  it("fails closed with a stable association error for an invalid delivery reference", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);

    const response = await app.inject({
      method: "POST",
      url: "/api/captures/record-bad-case",
      payload: { deliveryRef: "missing:turn", failureReason: "需要重做" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      status: "association_failed",
      created: false,
      deliveryRef: "missing:turn",
      badCaseId: null,
      badCaseStatus: null,
      captureEventId: expect.any(String),
      associationError: "delivery_not_found",
    });
    expect((await app.inject({ method: "GET", url: "/api/bad-cases" })).json()).toEqual({
      items: [],
    });
  });

  it("uses delivery units and automatic candidates for dashboard discovery semantics", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);
    await app.inject({
      method: "POST",
      url: "/api/captures/record-bad-case",
      payload: {
        deliveryRef: "thread-delivery:turn-delivery",
        failureReason: "交付覆盖了原始公式",
      },
    });

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(dashboard.json()).toMatchObject({
      pipeline: { discovered: 1, pendingConfirmation: 1 },
      totals: { deliveryUnits: 1, automaticCandidates: 1 },
    });

    const legacySessions = await app.inject({ method: "GET", url: "/api/sessions?limit=10" });
    expect(legacySessions.statusCode).toBe(200);
    expect(legacySessions.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "s1" })]),
    );
  });

  it("moves a bad case through confirmation, attribution and evidence", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);
    const sessions = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(sessions.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "s1", taskSummary: "检查表格公式" })]),
    );

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/bad-cases",
      payload: {
        title: "公式丢失",
        sourceSessionId: "s1",
        taskSummary: "检查表格公式",
        skillNames: ["xlsx"],
      },
    });
    const created = createdResponse.json();
    await app.inject({
      method: "PATCH",
      url: `/api/bad-cases/${created.id}`,
      payload: { problem: "公式被覆盖", expectedOutcome: "保留公式" },
    });
    expect(
      (await app.inject({ method: "POST", url: `/api/bad-cases/${created.id}/confirm` })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/bad-cases/${created.id}/attribute`,
          payload: { attribution: "skill_content_defect", note: "缺少写入约束" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/bad-cases/${created.id}/promote`,
        })
      ).json(),
    ).toMatchObject({ status: "assetized" });

    const evidence = await app.inject({ method: "GET", url: "/api/evidence" });
    expect(evidence.json()).toMatchObject({ items: [{ problem: "公式被覆盖" }] });
    expect(evidence.json().items[0]).not.toHaveProperty("sourceSessionId");
    expect(evidence.json().items[0]).not.toHaveProperty("taskSummary");
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(dashboard.json()).toMatchObject({ pipeline: { assetized: 1 } });
  });
});
