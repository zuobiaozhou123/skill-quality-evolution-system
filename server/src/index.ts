import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDirectory, "../..");
const runtimeRoot = process.env.SKILL_GOVERNANCE_RUNTIME_ROOT ?? path.join(projectRoot, ".runtime");
const governanceRoot =
  process.env.SKILL_GOVERNANCE_DATA_ROOT ?? path.join(projectRoot, "governance");

const app = await buildApp({
  skillsRoot:
    process.env.SKILL_GOVERNANCE_SKILLS_ROOT ?? path.join(os.homedir(), ".codex", "skills"),
  sessionsRoot:
    process.env.SKILL_GOVERNANCE_SESSIONS_ROOT ?? path.join(os.homedir(), ".codex", "sessions"),
  databasePath: path.join(runtimeRoot, "state.sqlite"),
  registryPath: path.join(governanceRoot, "registry", "skills.json"),
  evidenceRoot: path.join(governanceRoot, "evidence"),
});

await app.listen({ port: Number(process.env.SKILL_GOVERNANCE_PORT ?? 4317), host: "127.0.0.1" });
