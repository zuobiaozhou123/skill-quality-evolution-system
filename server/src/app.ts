import Fastify, { type FastifyInstance } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AttributionType, SessionSignal } from "./domain/types.js";
import { BadCaseService } from "./services/bad-case-service.js";
import { indexSessions } from "./services/session-indexer.js";
import { SkillRegistry } from "./services/skill-registry.js";
import { scanSkills } from "./services/skill-scanner.js";
import { createDatabase } from "./storage/database.js";

export type AppOptions = {
  skillsRoot: string;
  sessionsRoot: string;
  registryPath: string;
  evidenceRoot: string;
  databasePath: string;
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

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const database = createDatabase(options.databasePath);
  const badCases = new BadCaseService(database, options.evidenceRoot);
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
    const [sessions, cases, registered, evidence] = await Promise.all([
      indexSessions(options.sessionsRoot, 40),
      Promise.resolve(badCases.list()),
      registry.list(),
      readEvidence(options.evidenceRoot),
    ]);
    return {
      pipeline: {
        discovered: sessions.filter((session) => session.signalTypes.length > 0).length,
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
        badCases: cases.length,
        evidence: evidence.length,
        registeredSkills: registered.length,
      },
      recentBadCases: cases.slice(0, 5),
    };
  });

  return app;
}
