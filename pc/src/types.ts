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
    badCases: number;
    evidence: number;
    registeredSkills: number;
  };
  recentBadCases: BadCase[];
};
