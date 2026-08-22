import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { SessionSignal, SessionSummary } from "../domain/types.js";

const CORRECTION_PATTERN = /(?:不对|错了|错误|重新|重做|修正|wrong|incorrect|redo|retry)/i;
const SKILL_PATH_PATTERN = /\.codex\/skills\/(?:\.system\/)?([^/"\\]+)\/SKILL\.md/g;
const READ_COMMAND_PATTERN = /^\s*(?:sed|cat|head|tail|less|bat)\b/;

function loadedSkillsFromToolInput(input: unknown): string[] {
  const serialized = typeof input === "string" ? input : JSON.stringify(input ?? "");
  const commands: string[] = [];
  try {
    const parsed = JSON.parse(serialized) as { cmd?: unknown };
    if (typeof parsed.cmd === "string") commands.push(parsed.cmd);
  } catch {
    // Current Codex sessions store the inner tool call as JavaScript source.
  }
  for (const match of serialized.matchAll(
    /\bawait\s+tools\.exec_command\(\s*\{\s*["']?cmd["']?\s*:\s*"((?:\\.|[^"\\])*)"/g,
  )) {
    try {
      commands.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      continue;
    }
  }

  const found = new Set<string>();
  for (const command of commands) {
    for (const segment of command.split(/[;\n]/)) {
      if (!READ_COMMAND_PATTERN.test(segment)) continue;
      for (const match of segment.matchAll(SKILL_PATH_PATTERN)) found.add(match[1]);
    }
  }
  return [...found];
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(entryPath);
        if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(entryPath);
      }),
    );
  }

  try {
    await visit(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return found;
}

function hasToolFailure(value: unknown): boolean {
  if (typeof value === "string") {
    try {
      return hasToolFailure(JSON.parse(value));
    } catch {
      const match = value.match(/exit_code[^0-9-]*(-?\d+)/);
      return match ? Number(match[1]) !== 0 : false;
    }
  }
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  if (typeof record.exit_code === "number" && record.exit_code !== 0) return true;
  return Object.values(record).some(hasToolFailure);
}

function conciseTask(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 160) || "未命名任务";
}

async function parseSession(sourcePath: string): Promise<SessionSummary | null> {
  const stream = createReadStream(sourcePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let id = path.basename(sourcePath, ".jsonl");
  let timestamp = "";
  let cwd = "";
  let taskSummary = "";
  let userMessageCount = 0;
  const loadedSkills = new Set<string>();
  const signalTypes = new Set<SessionSignal>();

  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: { type?: string; timestamp?: string; payload?: Record<string, unknown> };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }

    const payload = event.payload ?? {};
    if (event.type === "session_meta") {
      id = String(payload.id ?? payload.session_id ?? id);
      timestamp = String(payload.timestamp ?? event.timestamp ?? timestamp);
      cwd = String(payload.cwd ?? cwd);
    }

    if (event.type === "event_msg" && payload.type === "user_message") {
      const message = String(payload.message ?? "");
      userMessageCount += 1;
      if (!taskSummary) taskSummary = conciseTask(message);
      if (userMessageCount > 1 && CORRECTION_PATTERN.test(message)) {
        signalTypes.add("user_correction");
      }
    }

    if (payload.type === "custom_tool_call") {
      for (const skill of loadedSkillsFromToolInput(payload.input)) loadedSkills.add(skill);
    }

    if (payload.type === "custom_tool_call_output" && hasToolFailure(payload.output)) {
      signalTypes.add("tool_failure");
    }
  }

  if (!timestamp) {
    const fileStats = await stat(sourcePath);
    timestamp = fileStats.mtime.toISOString();
  }

  return {
    id,
    timestamp,
    cwd,
    taskSummary: taskSummary || "未命名任务",
    loadedSkills: [...loadedSkills].sort(),
    signalTypes: [...signalTypes],
    sourcePath,
  };
}

export async function indexSessions(root: string, limit = 50): Promise<SessionSummary[]> {
  const files = await listJsonlFiles(root);
  const withTimes = await Promise.all(
    files.map(async (sourcePath) => ({ sourcePath, mtime: (await stat(sourcePath)).mtimeMs })),
  );
  const selected = withTimes
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, limit * 2)
    .map(({ sourcePath }) => sourcePath);
  const sessions = await Promise.all(selected.map(parseSession));
  const seen = new Set<string>();
  return sessions
    .filter((session): session is SessionSummary => session !== null)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    })
    .slice(0, limit);
}
