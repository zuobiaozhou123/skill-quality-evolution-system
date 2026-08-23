export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  fingerprint: string;
  registered: boolean;
};

export type SessionSignal = "tool_failure" | "user_correction";

export type SessionSummary = {
  id: string;
  timestamp: string;
  cwd: string;
  taskSummary: string;
  loadedSkills: string[];
  signalTypes: SessionSignal[];
  sourcePath: string;
};

export type DeliveryUnit = {
  id: string;
  deliveryRef: string;
  threadId: string;
  turnId: string;
  startedAt: string;
  completedAt: string;
  cwd: string;
  userRequest: string;
  finalAnswer: string;
  actualSkills: string[];
  nextUserFeedback: string | null;
  sourcePath: string;
};

export type DeliveryUnitDegradationReason =
  | "legacy_format"
  | "incomplete_turn"
  | "missing_user_request"
  | "missing_final_answer"
  | "skill_not_proven";

export type DeliveryUnitDiagnostic = {
  threadId: string | null;
  turnId: string | null;
  sourcePath: string;
  reason: DeliveryUnitDegradationReason;
};

export type DeliveryUnitIndexResult = {
  units: DeliveryUnit[];
  diagnostics: DeliveryUnitDiagnostic[];
};

export type SessionContextEventType =
  | "task_started"
  | "task_complete"
  | "turn_context"
  | "user_message"
  | "agent_message"
  | "skill_read"
  | "tool_call"
  | "tool_output";

export type SessionContextEvent = {
  type: SessionContextEventType;
  timestamp: string;
  turnId: string;
  summary: string;
  content?: string;
  skillName?: string;
  phase?: string;
  truncated?: boolean;
};

export type SessionContextTurn = {
  turnId: string;
  startedAt: string;
  completedAt: string | null;
  isTrigger: boolean;
  isFeedback: boolean;
  events: SessionContextEvent[];
};

export type SessionContext = {
  threadId: string;
  deliveryRef: string;
  sourcePath: string;
  triggerTurnId: string;
  feedbackTurnId: string | null;
  feedback: string | null;
  turns: SessionContextTurn[];
};

export type SessionContextErrorCode =
  | "delivery_ref_invalid"
  | "delivery_not_found"
  | "source_unavailable"
  | "context_parse_failed";

export type SessionContextError = {
  error: string;
  code: SessionContextErrorCode;
};

export type BadCaseStatus =
  | "pending_confirmation"
  | "confirmed"
  | "rejected"
  | "attributed"
  | "assetized";

export type BadCaseCaptureSource = "manual" | "prompt_first";

export type CaptureEventStatus = "captured" | "duplicate" | "association_failed";

export type CaptureAssociationError =
  | "delivery_not_found"
  | "delivery_invalid"
  | "source_unavailable";

export type AttributionType =
  | "skill_content_missing"
  | "skill_content_defect"
  | "skill_optimization"
  | "execution_lapse"
  | "routing_issue"
  | "tool_environment"
  | "task_input"
  | "insufficient_evidence";

export type BadCase = {
  id: string;
  title: string;
  problem: string;
  expectedOutcome: string;
  deliveryRef: string | null;
  captureSource: BadCaseCaptureSource;
  userFeedback: string;
  failureReason: string;
  sourceSessionId: string | null;
  sourcePath: string | null;
  taskSummary: string;
  skillNames: string[];
  signalTypes: SessionSignal[];
  status: BadCaseStatus;
  attribution: AttributionType | null;
  attributionNote: string;
  evidencePath: string | null;
  confirmedAt: string | null;
  attributedAt: string | null;
  rejectedAt: string | null;
  assetizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CaptureEvent = {
  id: string;
  deliveryRef: string;
  captureSource: BadCaseCaptureSource;
  status: CaptureEventStatus;
  userFeedback: string;
  failureReason: string;
  associationError: CaptureAssociationError | null;
  badCaseId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CaptureDiagnosticEvent = Pick<
  CaptureEvent,
  "id" | "deliveryRef" | "status" | "failureReason" | "associationError" | "createdAt"
>;

export type CaptureDiagnostics = {
  status: "healthy" | "attention";
  serviceStatus: "available";
  checkedAt: string;
  summary: {
    total: number;
    captured: number;
    duplicate: number;
    associationFailed: number;
  };
  outbox: {
    status: "clear" | "pending" | "unavailable";
    pendingCount: number;
    lastError: string | null;
  };
  index: {
    status: "healthy" | "degraded" | "unavailable";
    degradedCount: number;
  };
  recentEvents: CaptureDiagnosticEvent[];
};
