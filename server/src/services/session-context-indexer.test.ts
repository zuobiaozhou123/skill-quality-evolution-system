import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findSessionContext } from "./session-context-indexer.js";

async function writeSession(
  root: string,
  name: string,
  events: Array<object | string>,
): Promise<string> {
  const sourcePath = path.join(root, name);
  const content = events
    .map((event) => (typeof event === "string" ? event : JSON.stringify(event)))
    .join("\n");
  await writeFile(sourcePath, `${content}\n`);
  return sourcePath;
}

describe("findSessionContext", () => {
  it("returns a structured multi-turn timeline and highlights the delivery and feedback turns", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-context-"));
    const sourcePath = await writeSession(root, "session.jsonl", [
      {
        timestamp: "2026-08-23T08:00:00.000Z",
        type: "session_meta",
        payload: { id: "thread-context", cwd: "/workspace" },
      },
      {
        timestamp: "2026-08-23T08:01:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1" },
      },
      {
        timestamp: "2026-08-23T08:01:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "请按 xlsx skill 检查公式" },
      },
      {
        timestamp: "2026-08-23T08:01:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: '{"cmd":"cat /Users/example/.codex/skills/xlsx/SKILL.md"}',
        },
      },
      {
        timestamp: "2026-08-23T08:01:03.000Z",
        type: "event_msg",
        payload: { type: "agent_message", phase: "final_answer", message: "已完成公式检查" },
      },
      {
        timestamp: "2026-08-23T08:02:00.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: "已完成公式检查" },
      },
      {
        timestamp: "2026-08-23T08:03:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-2" },
      },
      {
        timestamp: "2026-08-23T08:03:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "不对，公式被覆盖了，请重做" },
      },
      {
        timestamp: "2026-08-23T08:03:02.000Z",
        type: "event_msg",
        payload: { type: "agent_message", phase: "final_answer", message: "已修正" },
      },
      {
        timestamp: "2026-08-23T08:04:00.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-2", last_agent_message: "已修正" },
      },
    ]);

    const context = await findSessionContext(root, "thread-context:turn-1");

    expect(context).toMatchObject({
      threadId: "thread-context",
      deliveryRef: "thread-context:turn-1",
      sourcePath,
      triggerTurnId: "turn-1",
      feedbackTurnId: "turn-2",
      feedback: "不对，公式被覆盖了，请重做",
    });
    expect(context?.turns).toHaveLength(2);
    expect(context?.turns[0]).toMatchObject({
      turnId: "turn-1",
      isTrigger: true,
      isFeedback: false,
    });
    expect(context?.turns[1]).toMatchObject({
      turnId: "turn-2",
      isTrigger: false,
      isFeedback: true,
    });
    expect(context?.turns[0].events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "user_message", summary: "请按 xlsx skill 检查公式" }),
        expect.objectContaining({ type: "skill_read", skillName: "xlsx" }),
        expect.objectContaining({ type: "agent_message", summary: "已完成公式检查" }),
      ]),
    );
  });

  it("skips malformed lines and truncates event summaries without losing event order", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-context-"));
    const longMessage = "长".repeat(500);
    await writeSession(root, "session.jsonl", [
      { type: "session_meta", payload: { id: "thread-truncate", cwd: "/workspace" } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
      { type: "event_msg", payload: { type: "user_message", message: longMessage } },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: '{"cmd":"cat /Users/example/.codex/skills/xlsx/SKILL.md"}',
        },
      },
      "{not-json",
      {
        type: "event_msg",
        payload: { type: "agent_message", phase: "final_answer", message: "交付" },
      },
      { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1" } },
    ]);

    const context = await findSessionContext(root, "thread-truncate:turn-1");
    const userEvent = context?.turns[0].events.find((event) => event.type === "user_message");
    expect(userEvent?.summary.length).toBeLessThanOrEqual(240);
    expect(userEvent?.content).toBe(longMessage);
    expect(context?.turns[0].events.map((event) => event.type)).toEqual([
      "task_started",
      "user_message",
      "skill_read",
      "agent_message",
      "task_complete",
    ]);
  });

  it("fails closed for an invalid or unknown delivery reference", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-context-"));
    await expect(findSessionContext(root, "missing:turn")).resolves.toBeNull();
    await expect(findSessionContext(root, "missing")).resolves.toBeNull();
  });

  it("redacts common credential fields from tool events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-context-"));
    await writeSession(root, "session.jsonl", [
      { type: "session_meta", payload: { id: "thread-redact", cwd: "/workspace" } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
      { type: "event_msg", payload: { type: "user_message", message: "执行任务" } },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: '{"cmd":"cat /Users/example/.codex/skills/xlsx/SKILL.md"}',
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: '{"cmd":"curl -H \\"Authorization: Bearer top-secret-token\\" https://example.test"}',
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          output: '{"api_key":"private-value","status":"ok"}',
        },
      },
      {
        type: "event_msg",
        payload: { type: "agent_message", phase: "final_answer", message: "交付" },
      },
      { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1" } },
    ]);

    const context = await findSessionContext(root, "thread-redact:turn-1");
    const toolText = context?.turns[0].events
      .filter((event) => event.type === "tool_call" || event.type === "tool_output")
      .map((event) => event.content)
      .join("\n");
    expect(toolText).toContain("[REDACTED]");
    expect(toolText).not.toContain("top-secret-token");
    expect(toolText).not.toContain("private-value");
  });
});
