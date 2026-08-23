import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type {
  DeliveryUnit,
  DeliveryUnitDegradationReason,
  DeliveryUnitDiagnostic,
  DeliveryUnitIndexResult,
} from "../domain/types.js";
import {
  listJsonlFiles,
  loadedSkillsFromToolInput,
  toolCallFromSessionPayload,
} from "./session-indexer.js";

type SessionEvent = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

type TurnDraft = {
  turnId: string;
  startedAt: string;
  cwd: string;
  requests: string[];
  finalAnswers: string[];
  actualSkills: Set<string>;
};

function eventTimestamp(event: SessionEvent, fallback = ""): string {
  if (typeof event.timestamp === "string" && event.timestamp) return event.timestamp;
  const seconds = event.payload?.started_at ?? event.payload?.completed_at;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return new Date(seconds * 1000).toISOString();
  }
  return fallback;
}

function diagnostic(
  sourcePath: string,
  threadId: string | null,
  turnId: string | null,
  reason: DeliveryUnitDegradationReason,
): DeliveryUnitDiagnostic {
  return { threadId, turnId, sourcePath, reason };
}

function degradationReason(draft: TurnDraft, finalAnswer: string): DeliveryUnitDegradationReason | null {
  if (!draft.requests.some((request) => request.trim())) return "missing_user_request";
  if (!finalAnswer.trim()) return "missing_final_answer";
  if (draft.actualSkills.size === 0) return "skill_not_proven";
  return null;
}

async function parseDeliverySession(sourcePath: string): Promise<DeliveryUnitIndexResult> {
  const stream = createReadStream(sourcePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let threadId: string | null = null;
  let sessionCwd = "";
  let sessionTimestamp = "";
  let active: TurnDraft | null = null;
  let sawTaskBoundary = false;
  const units: DeliveryUnit[] = [];
  const diagnostics: DeliveryUnitDiagnostic[] = [];

  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: SessionEvent;
    try {
      event = JSON.parse(line) as SessionEvent;
    } catch {
      continue;
    }

    const payload = event.payload ?? {};
    if (event.type === "session_meta") {
      const id = payload.id ?? payload.session_id;
      threadId = typeof id === "string" && id ? id : threadId;
      sessionCwd = typeof payload.cwd === "string" ? payload.cwd : sessionCwd;
      sessionTimestamp = eventTimestamp(event, sessionTimestamp);
      continue;
    }

    if (event.type === "event_msg" && payload.type === "task_started") {
      sawTaskBoundary = true;
      if (active) {
        diagnostics.push(diagnostic(sourcePath, threadId, active.turnId, "incomplete_turn"));
      }
      const turnId = typeof payload.turn_id === "string" ? payload.turn_id : "";
      if (!turnId) {
        active = null;
        diagnostics.push(diagnostic(sourcePath, threadId, null, "incomplete_turn"));
        continue;
      }
      active = {
        turnId,
        startedAt: eventTimestamp(event, sessionTimestamp),
        cwd: sessionCwd,
        requests: [],
        finalAnswers: [],
        actualSkills: new Set<string>(),
      };
      continue;
    }

    if (event.type === "turn_context" && active) {
      const contextTurnId = typeof payload.turn_id === "string" ? payload.turn_id : active.turnId;
      if (contextTurnId === active.turnId && typeof payload.cwd === "string") active.cwd = payload.cwd;
      continue;
    }

    if (event.type === "event_msg" && payload.type === "user_message" && active) {
      const message = typeof payload.message === "string" ? payload.message : "";
      const previousUnit = units.at(-1);
      if (previousUnit && previousUnit.nextUserFeedback === null) {
        previousUnit.nextUserFeedback = message;
      }
      active.requests.push(message);
      continue;
    }

    const toolCall = active ? toolCallFromSessionPayload(payload) : null;
    if (active && toolCall) {
      for (const skillName of loadedSkillsFromToolInput(toolCall.input)) {
        active.actualSkills.add(skillName);
      }
      continue;
    }

    if (
      event.type === "event_msg" &&
      payload.type === "agent_message" &&
      payload.phase === "final_answer" &&
      active
    ) {
      if (typeof payload.message === "string") active.finalAnswers.push(payload.message);
      continue;
    }

    if (event.type === "event_msg" && payload.type === "task_complete") {
      sawTaskBoundary = true;
      const completedTurnId = typeof payload.turn_id === "string" ? payload.turn_id : "";
      if (!active || !completedTurnId || active.turnId !== completedTurnId) {
        diagnostics.push(
          diagnostic(sourcePath, threadId, completedTurnId || active?.turnId || null, "incomplete_turn"),
        );
        active = null;
        continue;
      }

      const lastAgentMessage =
        typeof payload.last_agent_message === "string" && payload.last_agent_message
          ? payload.last_agent_message
          : (active.finalAnswers.at(-1) ?? "");
      const reason = degradationReason(active, lastAgentMessage);
      if (!threadId) {
        diagnostics.push(diagnostic(sourcePath, null, active.turnId, "legacy_format"));
      } else if (reason) {
        diagnostics.push(diagnostic(sourcePath, threadId, active.turnId, reason));
      } else {
        const deliveryRef = `${threadId}:${active.turnId}`;
        units.push({
          id: deliveryRef,
          deliveryRef,
          threadId,
          turnId: active.turnId,
          startedAt: active.startedAt,
          completedAt: eventTimestamp(event, active.startedAt),
          cwd: active.cwd,
          userRequest: active.requests.join("\n\n").trim(),
          finalAnswer: lastAgentMessage,
          actualSkills: [...active.actualSkills].sort(),
          nextUserFeedback: null,
          sourcePath,
        });
      }
      active = null;
    }
  }

  if (active) diagnostics.push(diagnostic(sourcePath, threadId, active.turnId, "incomplete_turn"));
  if (!sawTaskBoundary) diagnostics.push(diagnostic(sourcePath, threadId, null, "legacy_format"));
  return { units, diagnostics };
}

export async function indexDeliveryUnits(
  root: string,
  limit = 50,
): Promise<DeliveryUnitIndexResult> {
  if (limit <= 0) return { units: [], diagnostics: [] };
  const sourcePaths = await listJsonlFiles(root);
  const selected = (
    await Promise.all(
      sourcePaths.map(async (sourcePath) => ({ sourcePath, mtime: (await stat(sourcePath)).mtimeMs })),
    )
  )
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, limit * 2)
    .map(({ sourcePath }) => sourcePath);
  const parsed = await Promise.all(selected.map(parseDeliverySession));

  const seenUnits = new Set<string>();
  const units = parsed
    .flatMap((result) => result.units)
    .filter((unit) => {
      if (seenUnits.has(unit.deliveryRef)) return false;
      seenUnits.add(unit.deliveryRef);
      return true;
    })
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, limit);

  const seenDiagnostics = new Set<string>();
  const diagnostics = parsed.flatMap((result) => result.diagnostics).filter((item) => {
    const key = `${path.resolve(item.sourcePath)}:${item.turnId ?? ""}:${item.reason}`;
    if (seenDiagnostics.has(key)) return false;
    seenDiagnostics.add(key);
    return true;
  });
  return { units, diagnostics };
}

export async function findDeliveryUnit(root: string, deliveryRef: string): Promise<DeliveryUnit | null> {
  if (!deliveryRef) return null;
  const sourcePaths = await listJsonlFiles(root);
  const byRecency = (
    await Promise.all(
      sourcePaths.map(async (sourcePath) => ({ sourcePath, mtime: (await stat(sourcePath)).mtimeMs })),
    )
  ).sort((left, right) => right.mtime - left.mtime);

  for (const { sourcePath } of byRecency) {
    const parsed = await parseDeliverySession(sourcePath);
    const unit = parsed.units.find((candidate) => candidate.deliveryRef === deliveryRef);
    if (unit) return unit;
  }
  return null;
}
