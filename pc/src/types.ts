export type PipelineCounts = {
  discovered: number;
  pendingConfirmation: number;
  attributed: number;
  assetized: number;
  candidateValidation: number;
  pendingRelease: number;
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

export type DeliveryUnitSummary = {
  deliveryRef: string;
  threadId: string;
  turnId: string;
  completedAt: string;
  cwd: string;
  requestSummary: string;
  resultSummary: string;
  actualSkills: string[];
  hasUserFeedback: boolean;
};

export type DeliveryUnitCaptureStatus =
  | "not_captured"
  | "captured"
  | "duplicate"
  | "association_failed";

export type DeliveryUnitDetail = {
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
  failureReason: string;
  captureStatus: DeliveryUnitCaptureStatus;
  governanceStatus: BadCaseStatus | null;
};

export type DeliveryUnitPage = {
  items: DeliveryUnitSummary[];
  pagination: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  degradedCount: number;
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

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  fingerprint: string;
  registered: boolean;
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
  recentEvents: Array<{
    id: string;
    deliveryRef: string;
    status: CaptureEventStatus;
    failureReason: string;
    associationError: CaptureAssociationError | null;
    createdAt: string;
  }>;
};

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

export type Evidence = {
  id: string;
  sourceBadCaseId: string;
  title: string;
  problem: string;
  expectedOutcome: string;
  skillNames: string[];
  signalTypes: SessionSignal[];
  attribution: AttributionType;
  attributionNote: string;
  confirmedAt: string;
};

export type Dashboard = {
  pipeline: PipelineCounts;
  totals: {
    sessions: number;
    deliveryUnits?: number;
    automaticCandidates?: number;
    badCases: number;
    evidence: number;
    registeredSkills: number;
  };
  recentBadCases: BadCase[];
};
