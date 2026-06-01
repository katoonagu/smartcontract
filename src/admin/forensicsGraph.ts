import type { ForensicCheckJob, ForensicCheckJobStatus } from "../storage/repositories";

export type AdminForensicsDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN";
export type AdminForensicsRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AdminForensicsConfidence = "low" | "medium" | "high";

export type AdminForensicsJobSummary = {
  id: string;
  kind: ForensicCheckJob["kind"];
  status: Extract<ForensicCheckJobStatus, "partial" | "completed" | "failed">;
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  requestedBy: string | null;
};

export type AdminForensicsAddressSummary = {
  address: string;
  displayLabel: string | null;
  knownLabels: string[];
  role: "checked_wallet" | "sender" | "receiver" | "unknown";
};

export type AdminForensicsSummary = {
  decision: AdminForensicsDecision;
  riskScore: number | null;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  coverageRatio: number | null;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  topReasons: string[];
};

export type AdminForensicsNode = {
  id: string;
  address: string | null;
  kind: "subject" | "wallet" | "service" | "contract" | "label" | "stop";
  label: string;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  weight: number | null;
  metadata: Record<string, unknown>;
};

export type AdminForensicsEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "transfer" | "inferred_provenance" | "approval" | "service_boundary" | "stop";
  amountRaw: string | null;
  amountShare: number | null;
  txHash: string | null;
  timestamp: string | null;
  weight: number | null;
  verdict: "clean" | "review" | "risk" | "unknown";
  evidenceIds: string[];
  metadata: Record<string, unknown>;
};

export type AdminForensicsPath = {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  verdict: AdminForensicsDecision;
  riskContribution: number;
  amountRaw: string | null;
  amountShare: number | null;
  stoppedAtNodeId: string | null;
  stopReason: string | null;
  evidenceIds: string[];
};

export type AdminForensicsWeight = {
  id: string;
  source: string;
  label: string;
  value: number;
  direction: "raises_risk" | "lowers_risk" | "context";
  pathId: string | null;
  nodeId: string | null;
  edgeId: string | null;
  explanation: string;
};

export type AdminForensicsLimitation = {
  code: string;
  label: string;
  severity: "info" | "review" | "blocking";
  pathId: string | null;
  explanation: string;
};

export type AdminForensicsEvidenceRef = {
  id: string;
  source: string;
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  pathIds: string[];
};

export type AdminForensicsGraph = {
  job: AdminForensicsJobSummary;
  subject: AdminForensicsAddressSummary;
  summary: AdminForensicsSummary;
  nodes: AdminForensicsNode[];
  edges: AdminForensicsEdge[];
  paths: AdminForensicsPath[];
  weights: AdminForensicsWeight[];
  limitations: AdminForensicsLimitation[];
  evidence: AdminForensicsEvidenceRef[];
};

export type AdminForensicsProjectionResult =
  | { ok: true; graph: AdminForensicsGraph }
  | { ok: false; status: "not_ready" | "unsupported" | "malformed"; message: string };

export function projectForensicJobGraph(_job: ForensicCheckJob): AdminForensicsProjectionResult {
  return {
    ok: false,
    status: "unsupported",
    message: "Graph projection is not implemented for this job."
  };
}
