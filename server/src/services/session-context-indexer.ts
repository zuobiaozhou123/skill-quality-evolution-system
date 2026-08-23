import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import readline from "node:readline";
import type {
  SessionContext,
  SessionContextEvent,
  SessionContextEventType,
  SessionContextTurn,
} from "../domain/types.js";
import { findDeliveryUnit } from "./delivery-unit-indexer.js";
import {
  loadedSkillsFromToolInput,
  toolCallFromSessionPayload,
  toolOutputFromSessionPayload,
} from "./session-indexer.js";

const SUMMARY_LIMIT = 240;
const CONTENT_LIMIT = 20_000;
const CREDENTIAL_FIELD_PATTERN =
  /((?:api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|token)\s*["']?\s*[:=]\s*["']?)([^"'\\\s,}]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

type SessionEvent = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

type TurnDraft = {
  turnId: string;
  startedAt: string;
  completedAt: string | null;
  events: SessionContextEvent[];
};

function eventTimestamp(event: SessionEvent, fallback = ""): string {
  if (typeof event.timestamp === "string" && event.timestamp) return event.timestamp;
  const seconds = event.payload?.started_at ?? event.payload?.completed_at;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return new Date(seconds * 1000).toISOString();
  }
  return fallback;
}

function summarize(value: string): { summary: string; content: string; truncated: boolean } {
  const content = value.slice(0, CONTENT_LIMIT);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= SUMMARY_LIMIT) {
    return { summary: normalized, content, truncated: content.length < value.length };
  }
  return {
    summary: `${normalized.slice(0, SUMMARY_LIMIT - 3)}...`,
    content,
    truncated: true,
  };
}

function messageValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}

function redactSensitive(value: string): string {
  return value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(CREDENTIAL_FIELD_PATTERN, "$1[REDACTED]");
}

function appendEvent(
  turn: TurnDraft,
  type: SessionContextEventType,
  timestamp: string,
  value: string,
  extra: Pick<SessionContextEvent, "skillName" | "phase"> = {},
): void {
  const text = summarize(value);
  turn.events.push({
    type,
    timestamp,
    turnId: turn.turnId,
    summary: text.summary,
    content: text.content,
    truncated: text.truncated,
    ...extra,
  });
}

async function parseContext(
  sourcePath: string,
  deliveryRef: string,
  triggerTurnId: string,
): Promise<SessionContext | null> {
  const stream = createReadStream(sourcePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const turns: TurnDraft[] = [];
  let threadId = "";
  let sessionTimestamp = "";
  let active: TurnDraft | null = null;

  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: SessionEvent;
    try {
      event = JSON.parse(line) as SessionEvent;
    } catch {
      continue;
    }

    const payload = event.payload ?? {};
    const timestamp = eventTimestamp(event, sessionTimestamp);
    if (event.type === "session_meta") {
      const id = payload.id ?? payload.session_id;
      if (typeof id === "string" && id) threadId = id;
      sessionTimestamp = timestamp || sessionTimestamp;
      continue;
    }

    if (event.type === "event_msg" && payload.type === "task_started") {
      const turnId = typeof payload.turn_id === "string" ? payload.turn_id : "";
      if (!turnId) {
        active = null;
        continue;
      }
      active = { turnId, startedAt: timestamp, completedAt: null, events: [] };
      turns.push(active);
      appendEvent(active, "task_started", timestamp, "任务开始");
      continue;
    }

    if (!active) continue;

    if (event.type === "turn_context") {
      appendEvent(active, "turn_context", timestamp, redactSensitive(JSON.stringify(payload)));
      continue;
    }

    if (event.type === "event_msg" && payload.type === "user_message") {
      appendEvent(active, "user_message", timestamp, messageValue(payload, "message"));
      continue;
    }

    const toolCall = toolCallFromSessionPayload(payload);
    if (toolCall) {
      const skills = loadedSkillsFromToolInput(toolCall.input);
      if (skills.length > 0) {
        for (const skillName of skills) {
          appendEvent(active, "skill_read", timestamp, `读取 Skill: ${skillName}`, { skillName });
        }
      } else {
        const input = redactSensitive(
          typeof toolCall.input === "string"
            ? toolCall.input
            : toolCall.input == null
              ? ""
              : JSON.stringify(toolCall.input),
        );
        appendEvent(active, "tool_call", timestamp, input, {
          phase: toolCall.name,
        });
      }
      continue;
    }

    const toolOutput = toolOutputFromSessionPayload(payload);
    if (toolOutput !== null) {
      appendEvent(
        active,
        "tool_output",
        timestamp,
        redactSensitive(
          typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput),
        ),
      );
      continue;
    }

    if (event.type === "event_msg" && payload.type === "agent_message") {
      const phase = typeof payload.phase === "string" ? payload.phase : undefined;
      appendEvent(active, "agent_message", timestamp, messageValue(payload, "message"), { phase });
      continue;
    }

    if (event.type === "event_msg" && payload.type === "task_complete") {
      const completedTurnId = typeof payload.turn_id === "string" ? payload.turn_id : "";
      if (completedTurnId && completedTurnId === active.turnId) {
        const lastAgentMessage = messageValue(payload, "last_agent_message");
        const latestAgentMessage = active.events.at(-1);
        if (
          lastAgentMessage.trim() &&
          !(latestAgentMessage?.type === "agent_message" && latestAgentMessage.content === lastAgentMessage)
        ) {
          appendEvent(active, "agent_message", timestamp, lastAgentMessage, { phase: "final_answer" });
        }
        active.completedAt = timestamp;
        appendEvent(active, "task_complete", timestamp, "任务完成");
        active = null;
      }
    }
  }

  if (!threadId || !turns.some((turn) => turn.turnId === triggerTurnId)) return null;
  const triggerIndex = turns.findIndex((turn) => turn.turnId === triggerTurnId);
  const feedbackTurn = turns.slice(triggerIndex + 1).find((turn) =>
    turn.events.some((event) => event.type === "user_message" && event.summary.trim()),
  );
  const feedbackEvent = feedbackTurn?.events.find(
    (event) => event.type === "user_message" && event.content?.trim(),
  );
  const normalizedTurns: SessionContextTurn[] = turns.map((turn) => ({
    ...turn,
    isTrigger: turn.turnId === triggerTurnId,
    isFeedback: turn.turnId === feedbackTurn?.turnId,
  }));
  return {
    threadId,
    deliveryRef,
    sourcePath,
    triggerTurnId,
    feedbackTurnId: feedbackTurn?.turnId ?? null,
    feedback: feedbackEvent?.content?.trim() ?? null,
    turns: normalizedTurns,
  };
}

export async function findSessionContext(
  root: string,
  deliveryRef: string,
): Promise<SessionContext | null> {
  const normalizedRef = deliveryRef.trim();
  if (!normalizedRef || !normalizedRef.includes(":")) return null;
  const delivery = await findDeliveryUnit(root, normalizedRef);
  if (!delivery || delivery.deliveryRef !== normalizedRef || !delivery.sourcePath) return null;
  try {
    await stat(delivery.sourcePath);
  } catch {
    return null;
  }
  return parseContext(delivery.sourcePath, normalizedRef, delivery.turnId);
}
