import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  BadCase,
  BadCaseCaptureSource,
  CaptureAssociationError,
  CaptureEvent,
  CaptureEventStatus,
} from "../domain/types.js";
import type { BadCaseService } from "./bad-case-service.js";
import { findDeliveryUnit } from "./delivery-unit-indexer.js";

type CaptureEventRow = {
  id: string;
  delivery_ref: string;
  capture_source: BadCaseCaptureSource;
  status: CaptureEventStatus;
  user_feedback: string;
  failure_reason: string;
  association_error: CaptureAssociationError | null;
  bad_case_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CaptureInput = {
  deliveryRef: string;
  captureSource: Exclude<BadCaseCaptureSource, "manual">;
  failureReason: string;
};

export type CaptureResult = {
  status: CaptureEventStatus;
  created: boolean;
  badCase: BadCase | null;
  event: CaptureEvent;
};

function fromEventRow(row: CaptureEventRow): CaptureEvent {
  return {
    id: row.id,
    deliveryRef: row.delivery_ref,
    captureSource: row.capture_source,
    status: row.status,
    userFeedback: row.user_feedback,
    failureReason: row.failure_reason,
    associationError: row.association_error,
    badCaseId: row.bad_case_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function conciseTitle(request: string): string {
  const summary = request.replace(/\s+/g, " ").trim().slice(0, 80) || "Skill 交付";
  return `${summary} · 待核查`;
}

export class CaptureService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly badCases: BadCaseService,
    private readonly sessionsRoot: string,
  ) {}

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const deliveryRef = input.deliveryRef.trim();
    const failureReason = input.failureReason.trim();
    if (!failureReason) throw new Error("失败原因不能为空");
    if (!deliveryRef) return this.associationFailure(input, "delivery_invalid");

    const existing = this.badCases.findByDeliveryRef(deliveryRef);
    if (existing) {
      const event = this.recordEvent({
        deliveryRef,
        captureSource: input.captureSource,
        status: "duplicate",
        userFeedback: existing.userFeedback,
        failureReason,
        associationError: null,
        badCaseId: existing.id,
      });
      return { status: "duplicate", created: false, badCase: existing, event };
    }

    let delivery;
    try {
      delivery = await findDeliveryUnit(this.sessionsRoot, deliveryRef);
    } catch {
      return this.associationFailure(input, "source_unavailable");
    }
    if (!delivery) return this.associationFailure(input, "delivery_not_found");
    if (
      delivery.deliveryRef !== deliveryRef ||
      !delivery.threadId ||
      !delivery.turnId ||
      !delivery.completedAt ||
      !delivery.userRequest.trim() ||
      !delivery.finalAnswer.trim() ||
      !delivery.sourcePath ||
      delivery.actualSkills.length === 0 ||
      !delivery.nextUserFeedback?.trim()
    ) {
      return this.associationFailure(input, "delivery_invalid");
    }
    const userFeedback = delivery.nextUserFeedback.trim();

    return this.inTransaction(() => {
      const captured = this.badCases.createFromCapture({
        title: conciseTitle(delivery.userRequest),
        problem: failureReason,
        deliveryRef,
        captureSource: input.captureSource,
        userFeedback,
        failureReason,
        sourceSessionId: delivery.threadId,
        sourcePath: delivery.sourcePath,
        taskSummary: delivery.userRequest,
        skillNames: delivery.actualSkills,
        signalTypes: ["user_correction"],
      });
      const status = captured.created ? "captured" : "duplicate";
      const event = this.recordEvent({
        deliveryRef,
        captureSource: input.captureSource,
        status,
        userFeedback,
        failureReason,
        associationError: null,
        badCaseId: captured.badCase.id,
      });
      return { status, created: captured.created, badCase: captured.badCase, event };
    });
  }

  listEvents(): CaptureEvent[] {
    const rows = this.database
      .prepare("SELECT * FROM capture_events ORDER BY created_at DESC, rowid DESC")
      .all() as unknown as CaptureEventRow[];
    return rows.map(fromEventRow);
  }

  private associationFailure(
    input: CaptureInput,
    associationError: CaptureAssociationError,
  ): CaptureResult {
    const event = this.recordEvent({
      deliveryRef: input.deliveryRef.trim(),
      captureSource: input.captureSource,
      status: "association_failed",
      userFeedback: "",
      failureReason: input.failureReason.trim(),
      associationError,
      badCaseId: null,
    });
    return { status: "association_failed", created: false, badCase: null, event };
  }

  private recordEvent(input: {
    deliveryRef: string;
    captureSource: BadCaseCaptureSource;
    status: CaptureEventStatus;
    userFeedback: string;
    failureReason: string;
    associationError: CaptureAssociationError | null;
    badCaseId: string | null;
  }): CaptureEvent {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO capture_events (
          id, delivery_ref, capture_source, status, user_feedback, failure_reason,
          association_error, bad_case_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.deliveryRef,
        input.captureSource,
        input.status,
        input.userFeedback,
        input.failureReason,
        input.associationError,
        input.badCaseId,
        now,
        now,
      );
    return this.getEvent(id);
  }

  private getEvent(id: string): CaptureEvent {
    const row = this.database.prepare("SELECT * FROM capture_events WHERE id = ?").get(id) as
      | CaptureEventRow
      | undefined;
    if (!row) throw new Error("采集事件不存在");
    return fromEventRow(row);
  }

  private inTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The original error is the actionable failure if SQLite already ended the transaction.
      }
      throw error;
    }
  }
}
