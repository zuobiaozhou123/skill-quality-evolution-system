import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDeliveryUnit, indexDeliveryUnits } from "./delivery-unit-indexer.js";

async function writeSession(root: string, name: string, events: Array<object | string>): Promise<string> {
  const sourcePath = path.join(root, name);
  const content = events
    .map((event) => (typeof event === "string" ? event : JSON.stringify(event)))
    .join("\n");
  await writeFile(sourcePath, `${content}\n`);
  return sourcePath;
}

describe("indexDeliveryUnits", () => {
  it("builds stable task-bounded units and assigns the next request as feedback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "delivery-indexer-"));
    const sourcePath = await writeSession(root, "rollout-current.jsonl", [
      {
        timestamp: "2026-08-22T08:00:00.000Z",
        type: "session_meta",
        payload: { id: "thread-1", cwd: "/workspace/example" },
      },
      "{broken-json",
      {
        timestamp: "2026-08-22T08:01:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1" },
      },
      {
        timestamp: "2026-08-22T08:01:00.010Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", cwd: "/workspace/turn-one" },
      },
      {
        timestamp: "2026-08-22T08:01:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "请分析这个表格" },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: '{"cmd":"cat /Users/example/.codex/skills/xlsx/SKILL.md"}',
        },
      },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "第一版", phase: "final_answer" },
      },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "最终交付", phase: "final_answer" },
      },
      {
        timestamp: "2026-08-22T08:02:00.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1" },
      },
      {
        timestamp: "2026-08-22T08:03:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-2" },
      },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "不对，请重新核对公式" },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input:
            'const results = await Promise.all([tools.exec_command({cmd:"head -n 20 /Users/example/.codex/skills/brainstorming/SKILL.md"}), tools.exec_command({cmd:"sed -n 1,80p /Users/example/.codex/plugins/cache/openai-bundled/visualize/1.0.22/skills/visualize/SKILL.md"})]);',
        },
      },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "备用交付", phase: "final_answer" },
      },
      {
        timestamp: "2026-08-22T08:04:00.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-2",
          last_agent_message: "修正后的交付",
        },
      },
    ]);

    const result = await indexDeliveryUnits(root, 10);

    expect(result.diagnostics).toEqual([]);
    expect(result.units).toHaveLength(2);
    expect(result.units[0]).toMatchObject({
      id: "thread-1:turn-2",
      deliveryRef: "thread-1:turn-2",
      threadId: "thread-1",
      turnId: "turn-2",
      userRequest: "不对，请重新核对公式",
      finalAnswer: "修正后的交付",
      actualSkills: ["brainstorming", "visualize:visualize"],
      nextUserFeedback: null,
      sourcePath,
    });
    expect(result.units[1]).toMatchObject({
      id: "thread-1:turn-1",
      deliveryRef: "thread-1:turn-1",
      threadId: "thread-1",
      turnId: "turn-1",
      startedAt: "2026-08-22T08:01:00.000Z",
      completedAt: "2026-08-22T08:02:00.000Z",
      cwd: "/workspace/turn-one",
      userRequest: "请分析这个表格",
      finalAnswer: "最终交付",
      actualSkills: ["xlsx"],
      nextUserFeedback: "不对，请重新核对公式",
      sourcePath,
    });
  });

  it("reports old, incomplete and unproven-skill logs without inventing units", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "delivery-indexer-"));
    await writeSession(root, "rollout-legacy.jsonl", [
      { type: "session_meta", payload: { id: "thread-legacy", cwd: "/legacy" } },
      { type: "event_msg", payload: { type: "user_message", message: "旧请求" } },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "旧回答", phase: "final_answer" },
      },
    ]);
    await writeSession(root, "rollout-incomplete.jsonl", [
      { type: "session_meta", payload: { id: "thread-incomplete", cwd: "/incomplete" } },
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-incomplete" },
      },
      { type: "event_msg", payload: { type: "user_message", message: "未完成请求" } },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: '{"cmd":"cat /Users/example/.codex/skills/xlsx/SKILL.md"}',
        },
      },
    ]);
    await writeSession(root, "rollout-no-skill.jsonl", [
      { type: "session_meta", payload: { id: "thread-no-skill", cwd: "/no-skill" } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "turn-no-skill" } },
      { type: "event_msg", payload: { type: "user_message", message: "普通请求" } },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "普通回答", phase: "final_answer" },
      },
      { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-no-skill" } },
    ]);

    const result = await indexDeliveryUnits(root, 10);

    expect(result.units).toEqual([]);
    expect(result.diagnostics.map(({ reason }) => reason).sort()).toEqual([
      "incomplete_turn",
      "legacy_format",
      "skill_not_proven",
    ]);
  });

  it("looks up detail by the exact delivery reference", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "delivery-indexer-"));
    await writeSession(root, "rollout-lookup.jsonl", [
      { type: "session_meta", payload: { id: "thread-lookup", cwd: "/lookup" } },
      {
        timestamp: "2026-08-22T10:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-lookup" },
      },
      { type: "event_msg", payload: { type: "user_message", message: "查找请求" } },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: '{"cmd":"cat /Users/example/.codex/skills/xlsx/SKILL.md"}',
        },
      },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "查找交付", phase: "final_answer" },
      },
      {
        timestamp: "2026-08-22T10:01:00.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-lookup" },
      },
    ]);
    await expect(findDeliveryUnit(root, "thread-lookup:turn-lookup")).resolves.toMatchObject({
      userRequest: "查找请求",
      finalAnswer: "查找交付",
      actualSkills: ["xlsx"],
    });
    await expect(findDeliveryUnit(root, "thread-lookup:missing")).resolves.toBeNull();
  });

  it("never cross-associates identical turn ids from different threads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "delivery-indexer-"));
    for (const [threadId, request, answer, skill] of [
      ["thread-objective", "检查公式", "公式交付", "xlsx"],
      ["thread-open", "构思方案", "方案交付", "brainstorming"],
      ["thread-routing", "分析需求", "需求交付", "requirements-analysis"],
    ]) {
      await writeSession(root, `${threadId}.jsonl`, [
        { type: "session_meta", payload: { id: threadId, cwd: "/pilot" } },
        {
          timestamp: "2026-08-22T10:00:00.000Z",
          type: "event_msg",
          payload: { type: "task_started", turn_id: "same-turn" },
        },
        { type: "event_msg", payload: { type: "user_message", message: request } },
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            input: `{"cmd":"cat /Users/example/.codex/skills/${skill}/SKILL.md"}`,
          },
        },
        {
          type: "event_msg",
          payload: { type: "agent_message", message: answer, phase: "final_answer" },
        },
        {
          timestamp: "2026-08-22T10:01:00.000Z",
          type: "event_msg",
          payload: { type: "task_complete", turn_id: "same-turn" },
        },
      ]);
    }

    await expect(findDeliveryUnit(root, "thread-objective:same-turn")).resolves.toMatchObject({
      userRequest: "检查公式",
      finalAnswer: "公式交付",
      actualSkills: ["xlsx"],
    });
    await expect(findDeliveryUnit(root, "thread-open:same-turn")).resolves.toMatchObject({
      userRequest: "构思方案",
      finalAnswer: "方案交付",
      actualSkills: ["brainstorming"],
    });
    await expect(findDeliveryUnit(root, "thread-routing:same-turn")).resolves.toMatchObject({
      userRequest: "分析需求",
      finalAnswer: "需求交付",
      actualSkills: ["requirements-analysis"],
    });
  });
});
