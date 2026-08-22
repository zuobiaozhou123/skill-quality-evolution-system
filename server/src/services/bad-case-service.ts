import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  AttributionType,
  BadCase,
  BadCaseStatus,
  SessionSignal,
} from "../domain/types.js";

type BadCaseRow = {
  id: string;
  title: string;
  problem: string;
  expected_outcome: string;
  source_session_id: string | null;
  source_path: string | null;
  task_summary: string;
  skill_names: string;
  signal_types: string;
  status: BadCaseStatus;
  attribution: AttributionType | null;
  attribution_note: string;
  evidence_path: string | null;
  confirmed_at: string | null;
  attributed_at: string | null;
  rejected_at: string | null;
  assetized_at: string | null;
  created_at: string;
  updated_at: string;
};

type CreateBadCaseInput = {
  title: string;
  problem?: string;
  expectedOutcome?: string;
  sourceSessionId?: string;
  sourcePath?: string;
  taskSummary?: string;
  skillNames?: string[];
  signalTypes?: SessionSignal[];
};

const attributionTypes = new Set<AttributionType>([
  "skill_content_missing",
  "skill_content_defect",
  "skill_optimization",
  "execution_lapse",
  "routing_issue",
  "tool_environment",
  "task_input",
  "insufficient_evidence",
]);

function fromRow(row: BadCaseRow): BadCase {
  return {
    id: row.id,
    title: row.title,
    problem: row.problem,
    expectedOutcome: row.expected_outcome,
    sourceSessionId: row.source_session_id,
    sourcePath: row.source_path,
    taskSummary: row.task_summary,
    skillNames: JSON.parse(row.skill_names) as string[],
    signalTypes: JSON.parse(row.signal_types) as SessionSignal[],
    status: row.status,
    attribution: row.attribution,
    attributionNote: row.attribution_note,
    evidencePath: row.evidence_path,
    confirmedAt: row.confirmed_at,
    attributedAt: row.attributed_at,
    rejectedAt: row.rejected_at,
    assetizedAt: row.assetized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BadCaseService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly evidenceRoot: string,
  ) {}

  create(input: CreateBadCaseInput): BadCase {
    if (!input.title.trim()) throw new Error("标题不能为空");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO bad_cases (
          id, title, problem, expected_outcome, source_session_id, source_path,
          task_summary, skill_names, signal_types, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?)
      `)
      .run(
        id,
        input.title.trim(),
        input.problem?.trim() ?? "",
        input.expectedOutcome?.trim() ?? "",
        input.sourceSessionId ?? null,
        input.sourcePath ?? null,
        input.taskSummary?.trim() ?? "",
        JSON.stringify(input.skillNames ?? []),
        JSON.stringify(input.signalTypes ?? []),
        now,
        now,
      );
    return this.get(id);
  }

  list(): BadCase[] {
    const rows = this.database
      .prepare("SELECT * FROM bad_cases ORDER BY created_at DESC")
      .all() as unknown as BadCaseRow[];
    return rows.map(fromRow);
  }

  get(id: string): BadCase {
    const row = this.database.prepare("SELECT * FROM bad_cases WHERE id = ?").get(id) as
      | BadCaseRow
      | undefined;
    if (!row) throw new Error("Bad Case 不存在");
    return fromRow(row);
  }

  update(
    id: string,
    input: Partial<Pick<BadCase, "title" | "problem" | "expectedOutcome">>,
  ): BadCase {
    const current = this.get(id);
    if (!["pending_confirmation", "confirmed"].includes(current.status)) {
      throw new Error("当前状态不允许编辑");
    }
    const next = {
      title: input.title?.trim() ?? current.title,
      problem: input.problem?.trim() ?? current.problem,
      expectedOutcome: input.expectedOutcome?.trim() ?? current.expectedOutcome,
    };
    if (!next.title) throw new Error("标题不能为空");
    if (current.status === "confirmed" && (!next.problem || !next.expectedOutcome)) {
      throw new Error("已确认的 Bad Case 必须保留问题描述和期望结果");
    }
    const requiresReconfirmation = current.status === "confirmed";
    this.database
      .prepare(`
        UPDATE bad_cases
        SET title = ?, problem = ?, expected_outcome = ?, status = ?, confirmed_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.title,
        next.problem,
        next.expectedOutcome,
        requiresReconfirmation ? "pending_confirmation" : current.status,
        requiresReconfirmation ? null : current.confirmedAt,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  confirm(id: string): BadCase {
    const current = this.get(id);
    if (current.status !== "pending_confirmation") throw new Error("当前状态不能确认");
    if (!current.problem.trim() || !current.expectedOutcome.trim()) {
      throw new Error("请先补充问题描述和期望结果");
    }
    return this.setStatus(id, "confirmed", "confirmed_at");
  }

  reject(id: string): BadCase {
    const current = this.get(id);
    if (!["pending_confirmation", "confirmed"].includes(current.status)) {
      throw new Error("当前状态不能驳回");
    }
    return this.setStatus(id, "rejected", "rejected_at");
  }

  attribute(id: string, attribution: AttributionType, note = ""): BadCase {
    const current = this.get(id);
    if (current.status !== "confirmed") throw new Error("只有已确认的 Bad Case 才能归因");
    if (!attributionTypes.has(attribution)) throw new Error("无效的归因类型");
    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE bad_cases
        SET status = 'attributed', attribution = ?, attribution_note = ?, attributed_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(attribution, note.trim(), now, now, id);
    return this.get(id);
  }

  async promoteToEvidence(id: string): Promise<{ badCase: BadCase; evidencePath: string }> {
    const current = this.get(id);
    if (current.status !== "attributed" || !current.attribution) {
      throw new Error("只有已归因的 Bad Case 才能资产化");
    }
    await mkdir(this.evidenceRoot, { recursive: true });
    const evidencePath = path.join(this.evidenceRoot, `${current.id}.json`);
    const evidence = {
      id: current.id,
      sourceBadCaseId: current.id,
      title: current.title,
      problem: current.problem,
      expectedOutcome: current.expectedOutcome,
      skillNames: current.skillNames,
      signalTypes: current.signalTypes,
      attribution: current.attribution,
      attributionNote: current.attributionNote,
      confirmedAt: current.confirmedAt,
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    const now = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE bad_cases
        SET status = 'assetized', evidence_path = ?, assetized_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(evidencePath, now, now, id);
    return { badCase: this.get(id), evidencePath };
  }

  private setStatus(
    id: string,
    status: BadCaseStatus,
    timestampColumn: "confirmed_at" | "rejected_at",
  ): BadCase {
    const now = new Date().toISOString();
    this.database
      .prepare(`UPDATE bad_cases SET status = ?, ${timestampColumn} = ?, updated_at = ? WHERE id = ?`)
      .run(status, now, now, id);
    return this.get(id);
  }
}
