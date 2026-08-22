import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanSkills } from "./skill-scanner.js";

describe("scanSkills", () => {
  it("discovers valid skills and returns a stable content fingerprint", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-scanner-"));
    const skillDir = path.join(root, "sample-skill");
    await mkdir(skillDir);
    await mkdir(path.join(root, "not-a-skill"));
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: sample\ndescription: Use for sample tasks.\n---\n\n# Sample\n`,
      "utf8",
    );

    const first = await scanSkills(root);
    const second = await scanSkills(root);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      id: "sample-skill",
      name: "sample",
      description: "Use for sample tasks.",
      sourcePath: path.join(skillDir, "SKILL.md"),
    });
    expect(first[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second[0].fingerprint).toBe(first[0].fingerprint);
  });
});
