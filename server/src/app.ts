import Fastify, { type FastifyInstance } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AttributionType,
  CaptureDiagnostics,
  SessionContextErrorCode,
  SessionSignal,
} from "./domain/types.js";
import { BadCaseService } from "./services/bad-case-service.js";
import { CaptureService } from "./services/capture-service.js";
import { findDeliveryUnit, indexDeliveryUnits } from "./services/delivery-unit-indexer.js";
import { indexSessions } from "./services/session-indexer.js";
import { findSessionContext } from "./services/session-context-indexer.js";
import { SkillRegistry } from "./services/skill-registry.js";
import { scanSkills } from "./services/skill-scanner.js";
import { createDatabase } from "./storage/database.js";

export type AppOptions = {
  skillsRoot: string;
  sessionsRoot: string;
  registryPath: string;
  evidenceRoot: string;
  databasePath: string;
  outboxPath?: string;
};

type OutboxEntrySnapshot = {
  lastError?: unknown;
};

async function readEvidence(root: string): Promise<unknown[]> {
  try {
    const files = (await readdir(root)).filter((file) => file.endsWith(".json")).sort().reverse();
    return Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 0), maximum);
}

function summarize(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 3)}...`;
}

function contextError(code: SessionContextErrorCode, error: string) {
  return { code, error };
}

async function readOutboxDiagnostics(outboxPath: string): Promise<CaptureDiagnostics["outbox"]> {
  try {
    const parsed = JSON.parse(await readFile(outboxPath, "utf8")) as {
      version?: unknown;
      items?: unknown;
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) throw new Error("Invalid outbox");
    const items = parsed.items as OutboxEntrySnapshot[];
    let lastError: string | null = null;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const candidate = items[index]?.lastError;
      if (typeof candidate === "string") {
        lastError = candidate;
        break;
      }
    }
    return {
      status: items.length > 0 ? "pending" : "clear",
      pendingCount: items.length,
      lastError,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "clear", pendingCount: 0, lastError: null };
    }
    return { status: "unavailable", pendingCount: 0, lastError: "Outbox 状态不可读" };
  }
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const database = createDatabase(options.databasePath);
  const badCases = new BadCaseService(database, options.evidenceRoot);
  const captures = new CaptureService(database, badCases, options.sessionsRoot);
  const registry = new SkillRegistry(options.registryPath);

  app.addHook("onClose", async () => database.close());
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = /不存在/.test(message) ? 404 : 400;
    void reply.status(status).send({ error: message });
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/skills", async () => {
    const [discovered, registered] = await Promise.all([scanSkills(options.skillsRoot), registry.list()]);
    const registeredIds = new Set(registered.map((skill) => skill.id));
    return { items: discovered.map((skill) => ({ ...skill, registered: registeredIds.has(skill.id) })) };
  });

  app.post<{ Params: { id: string } }>("/api/skills/:id/register", async (request) => {
    const discovered = await scanSkills(options.skillsRoot);
    const skill = discovered.find((item) => item.id === request.params.id);
    if (!skill) throw new Error("Skill 不存在");
    await registry.register(skill);
    return { ...skill, registered: true };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/sessions", async (request) => {
    const requestedLimit = Number(request.query.limit ?? 40);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 40;
    return { items: await indexSessions(options.sessionsRoot, limit) };
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/api/delivery-units",
    async (request) => {
      const limit = Math.max(boundedInteger(request.query.limit, 40, 100), 1);
      const offset = boundedInteger(request.query.offset, 0, 10_000);
      const indexed = await indexDeliveryUnits(options.sessionsRoot, offset + limit + 1);
      const page = indexed.units.slice(offset, offset + limit);
      return {
        items: page.map((unit) => ({
          deliveryRef: unit.deliveryRef,
          threadId: unit.threadId,
          turnId: unit.turnId,
          completedAt: unit.completedAt,
          cwd: unit.cwd,
          requestSummary: summarize(unit.userRequest, 120),
          resultSummary: summarize(unit.finalAnswer, 160),
          actualSkills: unit.actualSkills,
          hasUserFeedback: Boolean(unit.nextUserFeedback?.trim()),
        })),
        pagination: {
          offset,
          limit,
          hasMore: indexed.units.length > offset + limit,
        },
        degradedCount: indexed.diagnostics.length,
      };
    },
  );

  app.get<{ Params: { deliveryRef: string } }>(
    "/api/delivery-units/:deliveryRef",
    async (request) => {
      const unit = await findDeliveryUnit(options.sessionsRoot, request.params.deliveryRef);
      if (!unit) throw new Error("Delivery Unit 不存在");
      const badCase = badCases.findByDeliveryRef(unit.deliveryRef);
      const captureEvent = captures
        .listEvents()
        .find((event) => event.deliveryRef === unit.deliveryRef);
      return {
        deliveryRef: unit.deliveryRef,
        threadId: unit.threadId,
        turnId: unit.turnId,
        startedAt: unit.startedAt,
        completedAt: unit.completedAt,
        cwd: unit.cwd,
        userRequest: unit.userRequest,
        finalAnswer: unit.finalAnswer,
        actualSkills: unit.actualSkills,
        nextUserFeedback: unit.nextUserFeedback,
        failureReason: badCase?.failureReason ?? captureEvent?.failureReason ?? "",
        captureStatus: captureEvent?.status ?? "not_captured",
        governanceStatus: badCase?.status ?? null,
      };
    },
  );

  app.get<{ Params: { deliveryRef: string } }>(
    "/api/delivery-units/:deliveryRef/session-context",
    async (request, reply) => {
      const deliveryRef = request.params.deliveryRef.trim();
      const separator = deliveryRef.indexOf(":");
      if (separator <= 0 || separator === deliveryRef.length - 1) {
        return reply
          .status(400)
          .send(contextError("delivery_ref_invalid", "Delivery Unit 引用格式无效"));
      }

      let delivery;
      try {
        delivery = await findDeliveryUnit(options.sessionsRoot, deliveryRef);
      } catch {
        return reply
          .status(503)
          .send(contextError("source_unavailable", "Session 源文件不可用"));
      }
      if (!delivery) {
        return reply
          .status(404)
          .send(contextError("delivery_not_found", "Delivery Unit 不存在"));
      }

      let context;
      try {
        context = await findSessionContext(options.sessionsRoot, deliveryRef);
      } catch {
        return reply
          .status(503)
          .send(contextError("source_unavailable", "Session 源文件不可用"));
      }
      if (
        !context ||
        context.deliveryRef !== delivery.deliveryRef ||
        context.threadId !== delivery.threadId ||
        context.triggerTurnId !== delivery.turnId
      ) {
        return reply
          .status(422)
          .send(contextError("context_parse_failed", "Session 上下文无法精确关联"));
      }
      return context;
    },
  );

  app.post<{
    Body: { deliveryRef?: string; failureReason?: string };
  }>("/api/captures/record-bad-case", async (request, reply) => {
    const result = await captures.capture({
      deliveryRef: String(request.body?.deliveryRef ?? ""),
      failureReason: String(request.body?.failureReason ?? ""),
      captureSource: "prompt_first",
    });
    const response = {
      status: result.status,
      created: result.created,
      deliveryRef: result.event.deliveryRef,
      badCaseId: result.badCase?.id ?? null,
      badCaseStatus: result.badCase?.status ?? null,
      captureEventId: result.event.id,
      associationError: result.event.associationError,
    };
    if (result.status === "association_failed") return reply.status(422).send(response);
    if (result.status === "captured") return reply.status(201).send(response);
    return response;
  });

  app.get("/api/capture-diagnostics", async (): Promise<CaptureDiagnostics> => {
    const events = captures.listEvents();
    const outboxPath =
      options.outboxPath ?? path.join(path.dirname(options.databasePath), "bad-case-capture-outbox.json");
    const [outbox, index] = await Promise.all([
      readOutboxDiagnostics(outboxPath),
      indexDeliveryUnits(options.sessionsRoot, 100).then(
        (result): CaptureDiagnostics["index"] => ({
          status: result.diagnostics.length > 0 ? "degraded" : "healthy",
          degradedCount: result.diagnostics.length,
        }),
        (): CaptureDiagnostics["index"] => ({ status: "unavailable", degradedCount: 0 }),
      ),
    ]);
    const associationFailed = events.filter((event) => event.status === "association_failed").length;
    const needsAttention =
      associationFailed > 0 || outbox.status !== "clear" || index.status !== "healthy";
    return {
      status: needsAttention ? "attention" : "healthy",
      serviceStatus: "available",
      checkedAt: new Date().toISOString(),
      summary: {
        total: events.length,
        captured: events.filter((event) => event.status === "captured").length,
        duplicate: events.filter((event) => event.status === "duplicate").length,
        associationFailed,
      },
      outbox,
      index,
      recentEvents: events.slice(0, 10).map((event) => ({
        id: event.id,
        deliveryRef: event.deliveryRef,
        status: event.status,
        failureReason: event.failureReason,
        associationError: event.associationError,
        createdAt: event.createdAt,
      })),
    };
  });

  app.get("/api/bad-cases", async () => ({ items: badCases.list() }));

  app.post<{
    Body: {
      title: string;
      problem?: string;
      expectedOutcome?: string;
      sourceSessionId?: string;
      sourcePath?: string;
      taskSummary?: string;
      skillNames?: string[];
      signalTypes?: SessionSignal[];
    };
  }>("/api/bad-cases", async (request) => badCases.create(request.body));

  app.patch<{
    Params: { id: string };
    Body: { title?: string; problem?: string; expectedOutcome?: string };
  }>("/api/bad-cases/:id", async (request) => badCases.update(request.params.id, request.body));

  app.post<{ Params: { id: string } }>("/api/bad-cases/:id/confirm", async (request) =>
    badCases.confirm(request.params.id),
  );

  app.post<{ Params: { id: string } }>("/api/bad-cases/:id/reject", async (request) =>
    badCases.reject(request.params.id),
  );

  app.post<{
    Params: { id: string };
    Body: { attribution: AttributionType; note?: string };
  }>("/api/bad-cases/:id/attribute", async (request) =>
    badCases.attribute(request.params.id, request.body.attribution, request.body.note),
  );

  app.post<{ Params: { id: string } }>("/api/bad-cases/:id/promote", async (request) => {
    const promoted = await badCases.promoteToEvidence(request.params.id);
    return promoted.badCase;
  });

  app.get("/api/evidence", async () => ({ items: await readEvidence(options.evidenceRoot) }));
  app.get("/api/proposals", async () => ({ items: [] }));
  app.get("/api/releases", async () => ({ items: [] }));

  app.get("/api/dashboard", async () => {
    const [sessions, deliveries, cases, registered, evidence] = await Promise.all([
      indexSessions(options.sessionsRoot, 40),
      indexDeliveryUnits(options.sessionsRoot, 100),
      Promise.resolve(badCases.list()),
      registry.list(),
      readEvidence(options.evidenceRoot),
    ]);
    const automaticCandidates = cases.filter(
      (item) =>
        item.captureSource === "prompt_first" &&
        ["pending_confirmation", "confirmed"].includes(item.status),
    ).length;
    return {
      pipeline: {
        discovered: deliveries.units.length,
        pendingConfirmation: cases.filter((item) =>
          ["pending_confirmation", "confirmed"].includes(item.status),
        ).length,
        attributed: cases.filter((item) => item.status === "attributed").length,
        assetized: cases.filter((item) => item.status === "assetized").length,
        candidateValidation: 0,
        pendingRelease: 0,
      },
      totals: {
        sessions: sessions.length,
        deliveryUnits: deliveries.units.length,
        automaticCandidates,
        badCases: cases.length,
        evidence: evidence.length,
        registeredSkills: registered.length,
      },
      recentBadCases: cases.slice(0, 5),
    };
  });

  return app;
}
