import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillSummary } from "../domain/types.js";

type RegisteredSkill = Omit<SkillSummary, "registered"> & { registeredAt: string };

export class SkillRegistry {
  constructor(private readonly registryPath: string) {}

  async list(): Promise<RegisteredSkill[]> {
    try {
      const content = JSON.parse(await readFile(this.registryPath, "utf8")) as {
        items?: RegisteredSkill[];
      };
      return content.items ?? [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async register(skill: SkillSummary): Promise<RegisteredSkill> {
    const items = await this.list();
    const existing = items.find((item) => item.id === skill.id);
    if (existing) return existing;
    const registered = {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      sourcePath: path.posix.join(skill.id, "SKILL.md"),
      fingerprint: skill.fingerprint,
      registeredAt: new Date().toISOString(),
    };
    const next = [...items, registered].sort((left, right) => left.name.localeCompare(right.name));
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    const temporaryPath = `${this.registryPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ items: next }, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.registryPath);
    return registered;
  }
}
