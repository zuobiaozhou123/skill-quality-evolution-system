import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { SkillSummary } from "../domain/types.js";

export async function scanSkills(root: string): Promise<SkillSummary[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map(async (entry): Promise<SkillSummary | null> => {
        const sourcePath = path.join(root, entry.name, "SKILL.md");
        try {
          const content = await readFile(sourcePath, "utf8");
          const parsed = matter(content);
          return {
            id: entry.name,
            name: String(parsed.data.name ?? entry.name),
            description: String(parsed.data.description ?? ""),
            sourcePath,
            fingerprint: createHash("sha256").update(content).digest("hex"),
            registered: false,
          };
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return null;
          throw error;
        }
      }),
  );

  return skills
    .filter((skill): skill is SkillSummary => skill !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
