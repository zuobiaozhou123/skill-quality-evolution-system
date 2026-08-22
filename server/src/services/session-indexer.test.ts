import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { indexSessions } from "./session-indexer.js";

describe("indexSessions", () => {
  it("extracts session metadata, loaded skills and candidate signals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-indexer-"));
    const nested = path.join(root, "2026", "08", "22");
    await mkdir(nested, { recursive: true });
    const sessionFile = path.join(nested, "rollout-sample.jsonl");
    const lines = [
      {
        timestamp: "2026-08-22T08:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "session-1",
          timestamp: "2026-08-22T08:00:00.000Z",
          cwd: "/workspace/example",
        },
      },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "请分析这个表格" },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          content: "Available: /Users/example/.codex/skills/system-only/SKILL.md",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          input: 'const patch = \'tools.exec_command({cmd:"head -n 20 /Users/example/.codex/skills/patch-only/SKILL.md"})\'; await tools.apply_patch(patch);',
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: '{"cmd":"sed -n 1,200p /Users/example/.codex/skills/xlsx/SKILL.md"}',
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input: 'const r = await tools.exec_command({cmd:"head -n 40 /Users/example/.codex/skills/brainstorming/SKILL.md"});',
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          output: '{"exit_code":1,"output":"failed"}',
        },
      },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "不对，请重新检查公式" },
      },
    ];
    await writeFile(sessionFile, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    await writeFile(
      path.join(nested, "duplicate-session.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "session-1", timestamp: "2026-08-22T07:00:00.000Z", cwd: "/old" },
      })}\n${JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "旧的重复记录" },
      })}\n`,
    );

    const sessions = await indexSessions(root, 10);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "session-1",
      timestamp: "2026-08-22T08:00:00.000Z",
      cwd: "/workspace/example",
      taskSummary: "请分析这个表格",
      loadedSkills: ["brainstorming", "xlsx"],
      signalTypes: ["tool_failure", "user_correction"],
      sourcePath: sessionFile,
    });
  });

  it("attributes skills loaded through parallel tool calls and plugin paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-indexer-"));
    const sessionFile = path.join(root, "rollout-parallel.jsonl");
    const lines = [
      {
        type: "session_meta",
        payload: {
          id: "session-parallel",
          timestamp: "2026-08-22T09:00:00.000Z",
          cwd: "/workspace/example",
        },
      },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "请设计一个治理页面" },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input:
            'const results = await Promise.all([tools.exec_command({cmd:"cat /Users/example/.codex/skills/brainstorming/SKILL.md"}), tools.exec_command({cmd:"sed -n 1,200p /Users/example/.codex/plugins/cache/openai-bundled/visualize/1.0.22/skills/visualize/SKILL.md"})]);',
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          input:
            'await tools.exec_command({workdir:"/workspace/example", cmd:`head -n 20 /Users/example/.codex/skills/product-thinking-partner/SKILL.md`});',
        },
      },
    ];
    await writeFile(sessionFile, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

    const sessions = await indexSessions(root, 10);

    expect(sessions[0]?.loadedSkills).toEqual([
      "brainstorming",
      "product-thinking-partner",
      "visualize:visualize",
    ]);
  });
});
