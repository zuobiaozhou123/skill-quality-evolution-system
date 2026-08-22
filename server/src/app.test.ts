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
  return {
    root,
    skillsRoot,
    sessionsRoot,
    governanceRoot,
    runtimeRoot,
    registryPath: path.join(governanceRoot, "registry", "skills.json"),
    evidenceRoot: path.join(governanceRoot, "evidence"),
    databasePath: path.join(runtimeRoot, "state.sqlite"),
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

  it("moves a bad case through confirmation, attribution and evidence", async () => {
    const fixture = await createFixture();
    app = await buildApp(fixture);
    const sessions = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(sessions.json()).toMatchObject({ items: [{ id: "s1", taskSummary: "检查表格公式" }] });

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
