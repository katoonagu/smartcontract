import type { ForensicCheckJob, ForensicCheckJobStatus } from "../storage/repositories";
import { buildRiskClaritySummary, riskClarityLevelFromScore, type RiskClaritySummary } from "../risk/riskClarity";
import {
  classifyContractDrivenReceiver,
  classifySourcePostDebitActivity
} from "../forensics/contractDrivenEvidence";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import {
  buildWhereFundingCandidateVisibility,
  type WhereFundingCandidateCaveat,
  type WhereFundingCandidateGroup,
  type WhereFundingCandidateItem
} from "./whereFundingCandidateVisibility";

export type AdminForensicsDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN";
export type AdminForensicsRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AdminForensicsConfidence = "low" | "medium" | "high";

export type AdminForensicsJobSummary = {
  id: string;
  kind: ForensicCheckJob["kind"];
  status: ForensicCheckJobStatus;
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
  riskClarity: RiskClaritySummary;
  confidence: AdminForensicsConfidence | null;
  coverageRatio: number | null;
  checkedScope: string | null;
  anchorCoverageRatio: number | null;
  episodeCoverageRatio: number | null;
  drainEpisode: Record<string, unknown> | null;
  layerSummary: Record<string, unknown> | null;
  contractDrivenCampaign: Record<string, unknown> | null;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  topReasons: string[];
};

export type AdminForensicsNodeDisplayKind =
  | "subject_wallet"
  | "wallet"
  | "bridge"
  | "cex"
  | "smart_contract"
  | "contract_adapter"
  | "contract_router"
  | "dex_contract"
  | "service_boundary"
  | "funding_bundle"
  | "trace_stop";

export type AdminNodeIntelligenceRole =
  | "drainer"
  | "victim"
  | "mule_transit"
  | "collector";

export type AdminNodeIntelligenceEvidenceStrength =
  | "hard"
  | "behavior"
  | "context";

export type AdminNodeIntelligence = {
  role: AdminNodeIntelligenceRole;
  label: string;
  evidenceStrength: AdminNodeIntelligenceEvidenceStrength;
  source: string;
  confidence: number | null;
  explanation: string;
  signals: string[];
};

export type AdminForensicsNode = {
  id: string;
  address: string | null;
  kind: "subject" | "wallet" | "service" | "contract" | "label" | "bundle" | "stop";
  displayKind?: AdminForensicsNodeDisplayKind;
  displayLabel?: string;
  label: string;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  weight: number | null;
  metadata: Record<string, unknown>;
};

export type AdminForensicsEdgeDisplayRole =
  | "real_transfer"
  | "allocated_transfer"
  | "profile_context"
  | "inferred_provenance"
  | "stop";

type AdminForensicsStopCategory =
  | "data_quality"
  | "continuity"
  | "terminal_boundary"
  | "service_boundary"
  | "unknown";

type StopDisplaySemantics = {
  category: AdminForensicsStopCategory;
  title: string;
  canvasLabel: string;
  meaning: string;
  scoreLabel: string;
  scoreMeaning: string;
};

export type AdminForensicsEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "transfer" | "inferred_provenance" | "approval" | "service_boundary" | "stop";
  displayRole?: AdminForensicsEdgeDisplayRole;
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
  timeSpanMs?: number | null;
  stoppedAtNodeId: string | null;
  stopReason: string | null;
  stopReasonLabel?: string | null;
  stopCategory?: AdminForensicsStopCategory | null;
  lastRealEdgeId?: string | null;
  evidenceIds: string[];
};

export type AdminForensicsWeight = {
  id: string;
  code?: string;
  source: string;
  label: string;
  value: number;
  direction: "raises_risk" | "lowers_risk" | "context";
  pathId: string | null;
  nodeId: string | null;
  edgeId: string | null;
  explanation: string;
  metadata: Record<string, unknown>;
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

const BOUNDARY_CONTEXT_ONLY_MEANING = "Investigation stop, not a stored money transfer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function evidenceHintsFromResult(result: Record<string, unknown>, assessment: Record<string, unknown>): string[] {
  return [
    ...stringArrayFromUnknown(result.reasons),
    ...stringArrayFromUnknown(assessment.reasons),
    ...stringArrayFromUnknown(result.missingChecks)
  ];
}

function hardEvidenceObserved(result: Record<string, unknown>, assessment: Record<string, unknown>): boolean {
  const hardBadEvidence = assessment.hardBadEvidence;
  if (Array.isArray(hardBadEvidence) && hardBadEvidence.length > 0) return true;
  const proofLevel = typeof result.proofLevel === "string" ? result.proofLevel.toLowerCase() : "";
  return proofLevel.includes("exact") || proofLevel.includes("blacklist") || proofLevel.includes("hard");
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function riskLevelFromScore(score: number | null): AdminForensicsRiskLevel | null {
  return riskClarityLevelFromScore(score);
}

function confidenceFromNumber(value: number | null): AdminForensicsConfidence | null {
  if (value === null) return null;
  if (value >= 70) return "high";
  if (value >= 40) return "medium";
  return "low";
}

function riskClarityExecutionStatus(
  status: ForensicCheckJobStatus
): Extract<ForensicCheckJobStatus, "queued" | "running" | "completed" | "partial" | "failed"> {
  return status === "queued" || status === "running" || status === "completed" || status === "partial"
    ? status
    : "failed";
}

function decision(value: unknown): AdminForensicsDecision {
  return value === "ACCEPTABLE" || value === "REVIEW" || value === "DECLINE" ? value : "UNKNOWN";
}

function summaryDecisionFromRisk(score: number | null): AdminForensicsDecision {
  if (score === null) return "UNKNOWN";
  if (score >= 60) return "DECLINE";
  if (score >= 30) return "REVIEW";
  return "ACCEPTABLE";
}

function completedJobSummary(job: ForensicCheckJob): AdminForensicsJobSummary | null {
  if (job.status !== "completed" && job.status !== "partial" && job.status !== "failed") return null;
  return jobSummary(job);
}

function jobSummary(job: ForensicCheckJob): AdminForensicsJobSummary {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    subjectAddress: job.subjectAddress,
    windowStart: job.windowStart.toISOString(),
    windowEnd: job.windowEnd.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    requestedBy: job.requestedBy
  };
}

function isWaitingForTargetedIndex(job: ForensicCheckJob): boolean {
  if (job.kind !== "where_is_money_check") return false;
  if (job.status !== "queued" && job.status !== "running") return false;
  const progress = isRecord(job.progressJson) ? job.progressJson : {};
  const targeted = recordField(progress, "targetedIndex");
  return stringField(progress, "jobPhase") === "waiting_for_targeted_index" ||
    stringField(progress, "jobPhase") === "checking_candidate_windows" ||
    stringField(targeted ?? {}, "phase") === "waiting_for_targeted_index" ||
    stringField(targeted ?? {}, "phase") === "checking_candidate_windows";
}

function nodeId(address: string): string {
  return `addr:${address}`;
}

function stopNodeId(pathIndex: number, reason: string): string {
  return `stop:${pathIndex}:${reason}`;
}

function bundleNodeId(pathIndex: number, bundleIndex: number): string {
  return `bundle:${pathIndex}:${bundleIndex}`;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  return arrayField(record, key).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function riskReasonMessagesField(record: Record<string, unknown>, key: string): string[] {
  return arrayField(record, key).flatMap((value) => {
    if (typeof value === "string" && value.length > 0) return [value];
    if (!isRecord(value)) return [];
    const message = stringField(value, "message") ?? stringField(value, "label") ?? stringField(value, "code");
    return message ? [message] : [];
  });
}

function recordArrayField(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return arrayField(record, key).filter(isRecord);
}

function nodeIntelligenceRoleLabel(role: AdminNodeIntelligenceRole): string {
  const labels: Record<AdminNodeIntelligenceRole, string> = {
    drainer: "Drainer",
    victim: "Victim",
    mule_transit: "Mule / Transit",
    collector: "Collector"
  };
  return labels[role];
}

function nodeIntelligenceEvidenceStrength(value: unknown): AdminNodeIntelligenceEvidenceStrength {
  if (value === "exact") return "hard";
  if (value === "strong_behavior") return "behavior";
  return "context";
}

function nodeIntelligenceRoleFromWalletRole(value: unknown): AdminNodeIntelligenceRole | null {
  if (value === "drainer_spender") return "drainer";
  if (value === "victim") return "victim";
  if (value === "mule") return "mule_transit";
  if (value === "collector") return "collector";
  return null;
}

function confidenceFromWalletRoleProfile(profile: Record<string, unknown>): number | null {
  const scores = recordArrayField(profile, "roles")
    .map((role) => numberField(role, "score"))
    .filter((score): score is number => score !== null);
  return scores.length === 0 ? null : Math.max(...scores);
}

function explanationFromWalletRoleProfile(profile: Record<string, unknown>): string {
  const featureLabel = recordArrayField(profile, "features")
    .map((feature) => stringField(feature, "label"))
    .find((label): label is string => Boolean(label));
  if (featureLabel) return featureLabel;

  for (const role of recordArrayField(profile, "roles")) {
    const reasonLabel = recordArrayField(role, "reasons")
      .map((reason) => stringField(reason, "label"))
      .find((label): label is string => Boolean(label));
    if (reasonLabel) return reasonLabel;
  }

  return "Backend wallet role classifier emitted this node role.";
}

function signalsFromWalletRoleProfile(profile: Record<string, unknown>): string[] {
  const featureCodes = recordArrayField(profile, "features")
    .map((feature) => stringField(feature, "code"))
    .filter((code): code is string => Boolean(code));
  const roleReasonCodes = recordArrayField(profile, "roles").flatMap((role) =>
    recordArrayField(role, "reasons")
      .map((reason) => stringField(reason, "code"))
      .filter((code): code is string => Boolean(code))
  );
  return Array.from(new Set([...featureCodes, ...roleReasonCodes]));
}

function nodeIntelligenceFromWalletRoleProfile(profile: Record<string, unknown>): AdminNodeIntelligence | null {
  const role = nodeIntelligenceRoleFromWalletRole(stringField(profile, "primaryRole"));
  if (!role) return null;

  const evidenceStrength = nodeIntelligenceEvidenceStrength(profile["evidenceStrength"]);
  if ((role === "drainer" || role === "victim") && evidenceStrength !== "hard") return null;

  return {
    role,
    label: nodeIntelligenceRoleLabel(role),
    evidenceStrength,
    source: "wallet_role_classifier",
    confidence: confidenceFromWalletRoleProfile(profile),
    explanation: explanationFromWalletRoleProfile(profile),
    signals: signalsFromWalletRoleProfile(profile)
  };
}

function attachNodeIntelligence(
  nodesById: Map<string, AdminForensicsNode>,
  walletRoleProfiles: Record<string, unknown>[]
): void {
  for (const profile of walletRoleProfiles) {
    const address = stringField(profile, "subjectAddress");
    if (!address) continue;

    const node = nodesById.get(nodeId(address));
    if (!node) continue;
    if (!["subject", "wallet", "label"].includes(node.kind)) continue;

    const intelligence = nodeIntelligenceFromWalletRoleProfile(profile);
    if (!intelligence) continue;

    setNodeIntelligence(nodesById, address, intelligence);
  }
}

function setNodeIntelligence(
  nodesById: Map<string, AdminForensicsNode>,
  address: string | null,
  intelligence: AdminNodeIntelligence
): void {
  if (!address) return;
  const node = nodesById.get(nodeId(address));
  if (!node) return;
  if (!["subject", "wallet", "contract", "label"].includes(node.kind)) return;
  const current = node.metadata.nodeIntelligence as AdminNodeIntelligence | undefined;
  if (current?.evidenceStrength === "hard" && intelligence.evidenceStrength !== "hard") return;
  if (current?.source === "contract_driven_evidence" && intelligence.source === "wallet_role_classifier") return;
  if (current?.source === "approval_drain_provenance" && intelligence.source !== "approval_drain_provenance") return;
  node.metadata = {
    ...node.metadata,
    nodeIntelligence: intelligence
  };
}

function approvalDrainProfileIsExact(profile: Record<string, unknown>): boolean {
  return stringField(profile, "evidenceStrength") === "exact_approval_and_transfer_from" &&
    Boolean(stringField(profile, "approvalTxHash")) &&
    Boolean(stringField(profile, "drainTxHash")) &&
    Boolean(stringField(profile, "spenderAddress"));
}

function approvalDrainProfileHasGraphableTransfer(profile: Record<string, unknown>): boolean {
  return Boolean(stringField(profile, "victimAddress")) &&
    Boolean(firstString(stringField(profile, "firstReceiverAddress"), stringField(profile, "subjectAddress"))) &&
    Boolean(stringField(profile, "spenderAddress")) &&
    Boolean(stringField(profile, "drainTxHash"));
}

function approvalDrainProfileFeatureCodes(profile: Record<string, unknown>): string[] {
  return recordArrayField(profile, "features").flatMap((feature) => {
    const code = stringField(feature, "code");
    return code ? [code] : [];
  });
}

function approvalDrainProfileHasExactDrainRoot(profile: Record<string, unknown>): boolean {
  return approvalDrainProfileIsExact(profile) ||
    approvalDrainProfileFeatureCodes(profile).includes("approval_drain_exact_transfer_from");
}

function sameAdminAddress(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function methodLooksPlainTransferSignature(method: string | null): boolean {
  if (!method) return false;
  const compact = method.replace(/\s+/g, "").toLowerCase();
  const canonical = compact.replace(/transfer\(address[a-z0-9_]*,uint256[a-z0-9_]*\)/, "transfer(address,uint256)");
  return canonical === "transfer" ||
    canonical === "transfer(address,uint256)" ||
    canonical === "a9059cbb" ||
    canonical === "transfera9059cbb" ||
    canonical === "transfer(address,uint256)a9059cbb";
}

function contractDrivenProfileLooksPlainUsdtTransfer(profile: Record<string, unknown>): boolean {
  const contractAddress = firstString(
    stringField(profile, "contractAddress"),
    stringField(profile, "spenderAddress"),
    stringField(profile, "contract"),
    stringField(profile, "spender")
  );
  return methodLooksPlainTransferSignature(stringField(profile, "method")) &&
    sameAdminAddress(contractAddress, TRON_USDT_CONTRACT_ADDRESS);
}

function contractDrivenTransferDuplicateKey(
  txHash: string | null,
  sourceAddress: string | null,
  receiverAddress: string | null,
  amountRaw: string | null
): string | null {
  if (!txHash || !sourceAddress || !receiverAddress || !amountRaw) return null;
  return `${txHash.toLowerCase()}:${sourceAddress.toLowerCase()}->${receiverAddress.toLowerCase()}:${amountRaw}`;
}

function contractDrivenAddressAmountDuplicateKey(
  sourceAddress: string | null,
  receiverAddress: string | null,
  amountRaw: string | null
): string | null {
  const pairKey = contractDrivenAddressPairKey(sourceAddress, receiverAddress);
  if (!pairKey || !amountRaw) return null;
  return `${pairKey}:${amountRaw}`;
}

function contractDrivenAddressPairKey(
  sourceAddress: string | null,
  receiverAddress: string | null
): string | null {
  if (!sourceAddress || !receiverAddress) return null;
  return `${sourceAddress.toLowerCase()}->${receiverAddress.toLowerCase()}`;
}

function attachApprovalDrainProvenanceNodeIntelligence(
  nodesById: Map<string, AdminForensicsNode>,
  profiles: Record<string, unknown>[]
): void {
  for (const profile of profiles) {
    if (!approvalDrainProfileHasExactDrainRoot(profile)) continue;
    const confidence = numberField(profile, "score");
    const drainTxHash = stringField(profile, "drainTxHash");
    const signals = ["approval_drain_exact_provenance", ...(drainTxHash ? [`drain_tx:${drainTxHash}`] : [])];
    const drainer: AdminNodeIntelligence = {
      role: "drainer",
      label: nodeIntelligenceRoleLabel("drainer"),
      evidenceStrength: "hard",
      source: "approval_drain_provenance",
      confidence,
      explanation: "Exact approval-drain provenance reaches this wallet.",
      signals
    };
    const victim: AdminNodeIntelligence = {
      role: "victim",
      label: nodeIntelligenceRoleLabel("victim"),
      evidenceStrength: "hard",
      source: "approval_drain_provenance",
      confidence,
      explanation: "This address is the victim in an exact approval-drain provenance profile.",
      signals
    };

    const firstReceiverAddress = stringField(profile, "firstReceiverAddress");
    const subjectAddress = stringField(profile, "subjectAddress");
    setNodeIntelligence(nodesById, firstReceiverAddress, drainer);
    if (sameAdminAddress(subjectAddress, firstReceiverAddress) || approvalDrainProfileIsExact(profile)) {
      setNodeIntelligence(nodesById, subjectAddress, drainer);
    }
    setNodeIntelligence(nodesById, stringField(profile, "spenderAddress"), drainer);
    setNodeIntelligence(nodesById, stringField(profile, "victimAddress"), victim);
  }
}

function contractDrivenAdminEvidenceStrength(value: string): AdminNodeIntelligenceEvidenceStrength {
  if (value === "hard") return "hard";
  if (value === "strong") return "behavior";
  return "context";
}

function contractDrivenReceiverAdminRole(value: string): AdminNodeIntelligenceRole | null {
  if (value === "drainer_receiver_collector") return "drainer";
  if (value === "drainer_like_collector") return "drainer";
  if (value === "collector") return "collector";
  return null;
}

function contractDrivenConfidence(value: string): number | null {
  if (value === "hard") return 95;
  if (value === "strong") return 75;
  if (value === "context") return 40;
  return null;
}

function appendContractDrivenEvidence(input: {
  result: Record<string, unknown>;
  subjectAddress: string;
  nodesById: Map<string, AdminForensicsNode>;
  upsertNode: (address: string, kind: AdminForensicsNode["kind"], metadata?: Record<string, unknown>) => string;
  edges: AdminForensicsEdge[];
}): void {
  const receiverProfile = recordField(input.result, "contractDrivenReceiverProfile");
  const contractNames = receiverProfile ? stringArrayField(receiverProfile, "contractNames") : [];
  const receiverClassification = receiverProfile
    ? classifyContractDrivenReceiver({
      totalIncomingTxCount: firstNumber(numberField(receiverProfile, "totalIncomingTxCount")) ?? 0,
      totalIncomingAmountRaw: stringField(receiverProfile, "totalIncomingAmountRaw"),
      contractDrivenIncomingTxCount: firstNumber(numberField(receiverProfile, "contractDrivenIncomingTxCount")) ?? 0,
      contractDrivenIncomingAmountRaw: stringField(receiverProfile, "contractDrivenIncomingAmountRaw"),
      uniqueSourceCount: firstNumber(numberField(receiverProfile, "uniqueSourceCount")) ?? 0,
      dominantMethod: stringField(receiverProfile, "dominantMethod"),
      contractNames,
      knownServiceIdentity: stringField(receiverProfile, "knownServiceIdentity"),
      exactApprovalDrainCount: firstNumber(numberField(receiverProfile, "exactApprovalDrainCount")) ?? 0
    })
    : null;
  const receiverRole = receiverClassification
    ? contractDrivenReceiverAdminRole(receiverClassification.primaryRole)
    : null;
  const receiverEvidenceStrength = receiverClassification
    ? contractDrivenAdminEvidenceStrength(receiverClassification.evidenceStrength)
    : "context";
  const receiverConfidence = receiverClassification
    ? contractDrivenConfidence(receiverClassification.evidenceStrength)
    : null;

  if (receiverProfile && receiverClassification) {
    const receiverNodeId = input.upsertNode(input.subjectAddress, "subject", {
      contractDrivenReceiverCampaign: {
        evidenceType: "contract_driven_receiver_campaign",
        totalIncomingTxCount: firstNumber(numberField(receiverProfile, "totalIncomingTxCount")) ?? 0,
        totalIncomingAmountRaw: stringField(receiverProfile, "totalIncomingAmountRaw"),
        contractDrivenIncomingTxCount: firstNumber(numberField(receiverProfile, "contractDrivenIncomingTxCount")) ?? 0,
        contractDrivenIncomingAmountRaw: stringField(receiverProfile, "contractDrivenIncomingAmountRaw"),
        ...(numberField(receiverProfile, "txInfoEnrichedIncomingTx") !== null
          ? { txInfoEnrichedIncomingTx: numberField(receiverProfile, "txInfoEnrichedIncomingTx") }
          : {}),
        ...(stringField(receiverProfile, "campaignClassificationStatus")
          ? { campaignClassificationStatus: stringField(receiverProfile, "campaignClassificationStatus") }
          : {}),
        ...(booleanField(receiverProfile, "countsAreLowerBounds") !== null
          ? { countsAreLowerBounds: booleanField(receiverProfile, "countsAreLowerBounds") }
          : {}),
        ...(numberField(receiverProfile, "plainUsdtTransferTxCount") !== null
          ? { plainUsdtTransferTxCount: numberField(receiverProfile, "plainUsdtTransferTxCount") }
          : {}),
        ...(numberField(receiverProfile, "wrapperDrivenIncomingTxCount") !== null
          ? { wrapperDrivenIncomingTxCount: numberField(receiverProfile, "wrapperDrivenIncomingTxCount") }
          : {}),
        ...(numberField(receiverProfile, "verify20WrapperTxCount") !== null
          ? { verify20WrapperTxCount: numberField(receiverProfile, "verify20WrapperTxCount") }
          : {}),
        uniqueSourceCount: firstNumber(numberField(receiverProfile, "uniqueSourceCount")) ?? 0,
        dominantMethod: stringField(receiverProfile, "dominantMethod"),
        contractNames,
        knownServiceIdentity: stringField(receiverProfile, "knownServiceIdentity"),
        exactApprovalDrainCount: firstNumber(numberField(receiverProfile, "exactApprovalDrainCount")) ?? 0,
        classification: receiverClassification
      }
    });
    const receiverSignals = [
      `contract_driven:${receiverClassification.level}`,
      ...(receiverClassification.reasons.length > 0 ? receiverClassification.reasons : []),
      ...(stringField(receiverProfile, "dominantMethod") ? [`method:${stringField(receiverProfile, "dominantMethod")}`] : [])
    ];
    if (receiverRole) {
      setNodeIntelligence(input.nodesById, input.subjectAddress, {
        role: receiverRole,
        label: nodeIntelligenceRoleLabel(receiverRole),
        evidenceStrength: receiverEvidenceStrength,
        source: "contract_driven_evidence",
        confidence: receiverConfidence,
        explanation: receiverClassification.label,
        signals: receiverSignals
      });
    }
    const receiverNode = input.nodesById.get(receiverNodeId);
    if (receiverNode && receiverClassification.primaryRole === "service_context") {
      receiverNode.metadata = {
        ...receiverNode.metadata,
        role: "service_context"
      };
    }
  }

  const seenContractDrivenProfileKeys = new Set<string>();
  const contractDrivenTransferGroups = new Map<string, AdminForensicsEdge>();
  recordArrayField(input.result, "contractDrivenTransferProfiles").forEach((profile, index) => {
    if (contractDrivenProfileLooksPlainUsdtTransfer(profile)) return;
    const txHash = stringField(profile, "txHash");
    const timestamp = stringField(profile, "timestamp");
    const amountRaw = stringField(profile, "amountRaw");
    const method = stringField(profile, "method");
    const callerAddress = firstString(
      stringField(profile, "callerAddress"),
      stringField(profile, "operatorAddress"),
      stringField(profile, "caller"),
      stringField(profile, "operator")
    );
    const contractAddress = firstString(
      stringField(profile, "contractAddress"),
      stringField(profile, "spenderAddress"),
      stringField(profile, "contract"),
      stringField(profile, "spender")
    );
    const sourceAddress = firstString(
      stringField(profile, "sourceAddress"),
      stringField(profile, "victimAddress"),
      stringField(profile, "fromAddress"),
      stringField(profile, "source"),
      stringField(profile, "victim")
    );
    const receiverAddress = firstString(
      stringField(profile, "receiverAddress"),
      stringField(profile, "toAddress"),
      stringField(profile, "receiver"),
      input.subjectAddress
    );
    const profileKey = JSON.stringify([txHash, sourceAddress, receiverAddress, contractAddress, method, amountRaw, timestamp]);
    if (seenContractDrivenProfileKeys.has(profileKey)) return;
    seenContractDrivenProfileKeys.add(profileKey);

    const sourcePostDebitActivity = recordField(profile, "sourcePostDebitActivity");
    const sourceActivityClassification = sourcePostDebitActivity
      ? classifySourcePostDebitActivity({
        debitAmountRaw: stringField(sourcePostDebitActivity, "debitAmountRaw"),
        laterIncomingAmountRaw: stringField(sourcePostDebitActivity, "laterIncomingAmountRaw"),
        laterOutgoingAmountRaw: stringField(sourcePostDebitActivity, "laterOutgoingAmountRaw"),
        laterTxCount: firstNumber(numberField(sourcePostDebitActivity, "laterTxCount")) ?? 0,
        repeatedContractDrivenDebitToSameReceiver: booleanField(sourcePostDebitActivity, "repeatedContractDrivenDebitToSameReceiver") ?? false,
        checked: booleanField(sourcePostDebitActivity, "checked") ?? false
      })
      : null;
    const evidenceIds = stringArrayField(profile, "evidenceIds");
    const contractName = stringField(profile, "contractName") ?? contractNames[0] ?? null;
    const showCallerContext = booleanField(profile, "showCallerContext") === true;
    const methodKey = method ? method.toLowerCase() : "";
    const receiverIsDrainerLike = receiverRole === "drainer";
    const sourceDiffersFromReceiver = Boolean(sourceAddress && receiverAddress && !sameAdminAddress(sourceAddress, receiverAddress));
    const verify20SourceDebit = methodKey === "verify20" && sourceDiffersFromReceiver;
    const shouldMarkSourceVictim = Boolean(sourceAddress && receiverIsDrainerLike && verify20SourceDebit);
    const sourceIsVictimLike = Boolean(sourceDiffersFromReceiver && (sourceActivityClassification?.victimLike || shouldMarkSourceVictim));

    const currentReceiverRole = receiverAddress
      ? stringField(input.nodesById.get(nodeId(receiverAddress))?.metadata ?? {}, "role")
      : null;
    const receiverNodeId = receiverAddress
      ? input.upsertNode(receiverAddress, receiverAddress === input.subjectAddress ? "subject" : "wallet", {
        source: "contractDrivenTransferProfile",
        ...(currentReceiverRole ? {} : { role: "contract_driven_receiver" }),
        txHash,
        method
      })
      : null;
    const sourceNodeId = sourceAddress
      ? input.upsertNode(sourceAddress, sourceAddress === input.subjectAddress ? "subject" : "wallet", {
        source: "contractDrivenTransferProfile",
        role: sourceIsVictimLike ? "victim_like_source" : "source",
        txHash,
        method
      })
      : null;
    const contractNodeId = contractAddress
      ? input.upsertNode(contractAddress, "contract", {
        source: "contractDrivenTransferProfile",
        role: "contract_driven_contract",
        txHash,
        method,
        contractName
      })
      : null;
    const callerNodeId = callerAddress && showCallerContext
      ? input.upsertNode(callerAddress, "wallet", {
        source: "contractDrivenTransferProfile",
        role: "operator",
        txHash,
        method
      })
      : null;

    if (sourceIsVictimLike && sourceAddress) {
      setNodeIntelligence(input.nodesById, sourceAddress, {
        role: "victim",
        label: nodeIntelligenceRoleLabel("victim"),
        evidenceStrength: receiverEvidenceStrength === "hard" ? "hard" : "behavior",
        source: "contract_driven_evidence",
        confidence: receiverConfidence,
        explanation: sourceActivityClassification?.label ||
          "Verify20 debit into a drainer-like receiver campaign.",
        signals: [
          "contract_driven_source_debit",
          ...(sourceActivityClassification ? [
            "contract_driven_source_post_debit_activity",
            `source_activity:${sourceActivityClassification.status}`
          ] : []),
          ...(method ? [`method:${method}`] : []),
          ...(txHash ? [`tx:${txHash}`] : [])
        ]
      });
    }

    if (contractAddress && receiverRole === "drainer") {
      setNodeIntelligence(input.nodesById, contractAddress, {
        role: "drainer",
        label: "Drainer contract",
        evidenceStrength: receiverEvidenceStrength,
        source: "contract_driven_evidence",
        confidence: receiverConfidence,
        explanation: "Contract called in a contract-driven transfer scene feeding a drainer receiver.",
        signals: [
          "contract_driven_drainer_contract",
          ...(method ? [`method:${method}`] : []),
          ...(txHash ? [`tx:${txHash}`] : [])
        ]
      });
    }

    const transferDetails: Record<string, unknown> = {
      txHash,
      amountRaw,
      amount: stringField(profile, "amount"),
      timestamp,
      method,
      callerAddress,
      contractAddress,
      sourceAddress,
      receiverAddress,
      fromAddress: sourceAddress,
      toAddress: receiverAddress,
      role: "contract_driven_transfer"
    };

    if (contractNodeId && receiverNodeId) {
      const groupKey = `${contractNodeId}->${receiverNodeId}`;
      const existingEdge = contractDrivenTransferGroups.get(groupKey);
      if (existingEdge) {
        const existingTransfers = recordArrayField(existingEdge.metadata, "underlyingTransfers");
        const nextTransfers = [...existingTransfers, transferDetails];
        const sourceAddresses = [
          ...stringArrayField(existingEdge.metadata, "sourceAddresses"),
          ...(sourceAddress ? [sourceAddress] : [])
        ];
        const callerAddresses = [
          ...stringArrayField(existingEdge.metadata, "callerAddresses"),
          ...(callerAddress ? [callerAddress] : [])
        ];
        const methods = [
          ...stringArrayField(existingEdge.metadata, "methods"),
          ...(method ? [method] : [])
        ];

        existingEdge.amountRaw = addRawDecimalStrings(existingEdge.amountRaw, amountRaw);
        existingEdge.txHash = null;
        existingEdge.timestamp = null;
        existingEdge.evidenceIds = [...new Set([...existingEdge.evidenceIds, ...evidenceIds])];
        existingEdge.metadata = {
          ...existingEdge.metadata,
          evidenceTypeLabel: "Grouped contract-driven USDT transfers",
          evidenceMeaning: "USDT moved into the receiver through this smart contract. Source wallets are shown as trigger-context lines; open the transaction list for every debit.",
          txHash: null,
          sourceAddress: null,
          callerAddress: null,
          aggregateAmountRaw: addRawDecimalStrings(stringField(existingEdge.metadata, "aggregateAmountRaw"), amountRaw),
          aggregateTransferCount: nextTransfers.length,
          sourceAddresses: [...new Set(sourceAddresses)],
          callerAddresses: [...new Set(callerAddresses)],
          methods: [...new Set(methods)],
          underlyingTransfers: nextTransfers
        };
      } else {
        const edge: AdminForensicsEdge = {
          id: `edge:contract_driven:${index}:transfer`,
          fromNodeId: contractNodeId,
          toNodeId: receiverNodeId,
          type: "transfer",
          amountRaw,
          amountShare: null,
          txHash,
          timestamp,
          weight: receiverConfidence,
          verdict: receiverRole === "drainer" ? "risk" : "review",
          evidenceIds,
          metadata: {
            source: "contractDrivenTransferProfile",
            evidenceType: "contract_driven_transfer",
            evidenceTypeLabel: "Contract-driven USDT transfer",
            evidenceMeaning: "USDT moved into the receiver through a smart-contract call. The source wallet is shown in the transaction evidence, not as a direct wallet-transfer line.",
            txHash,
            method,
            methods: method ? [method] : [],
            callerAddress,
            callerAddresses: callerAddress ? [callerAddress] : [],
            contractAddress,
            sourceAddress,
            sourceAddresses: sourceAddress ? [sourceAddress] : [],
            receiverAddress,
            aggregateAmountRaw: amountRaw,
            aggregateTransferCount: 1,
            underlyingTransfers: [transferDetails],
            sourcePostDebitActivity: sourcePostDebitActivity && sourceActivityClassification ? {
              checked: booleanField(sourcePostDebitActivity, "checked"),
              debitAmountRaw: stringField(sourcePostDebitActivity, "debitAmountRaw"),
              laterIncomingAmountRaw: stringField(sourcePostDebitActivity, "laterIncomingAmountRaw"),
              laterOutgoingAmountRaw: stringField(sourcePostDebitActivity, "laterOutgoingAmountRaw"),
              laterTxCount: firstNumber(numberField(sourcePostDebitActivity, "laterTxCount")),
              repeatedContractDrivenDebitToSameReceiver: booleanField(sourcePostDebitActivity, "repeatedContractDrivenDebitToSameReceiver"),
              classification: sourceActivityClassification
            } : undefined
          }
        };
        contractDrivenTransferGroups.set(groupKey, edge);
        input.edges.push(edge);
      }
    }

    if (sourceNodeId && contractNodeId) {
      input.edges.push({
        id: `edge:contract_driven:${index}:trigger`,
        fromNodeId: sourceNodeId,
        toNodeId: contractNodeId,
        type: "transfer",
        displayRole: "profile_context",
        amountRaw,
        amountShare: null,
        txHash,
        timestamp,
        weight: receiverConfidence,
        verdict: receiverRole === "drainer" ? "risk" : "review",
        evidenceIds,
        metadata: {
          source: "contractDrivenTransferProfile",
          evidenceType: "contract_trigger_context",
          evidenceTypeLabel: "Source debit through spender contract",
          evidenceMeaning: "This source wallet was debited through the spender contract. The grouped contract-to-receiver edge summarizes the receiver inflow.",
          txHash,
          method,
          callerAddress,
          contractAddress,
          contractName,
          sourceAddress,
          receiverAddress,
          fromAddress: sourceAddress,
          toAddress: contractAddress,
          relatedDebitTxHash: txHash,
          relatedDebitAmountRaw: amountRaw,
          relatedDebitTimestamp: timestamp,
          aggregateAmountRaw: amountRaw,
          aggregateTransferCount: 1,
          proofLevel: receiverClassification?.level || receiverClassification?.primaryRole || null,
          underlyingTransfers: [transferDetails]
        }
      });
    }

    if (callerNodeId && contractNodeId && showCallerContext) {
      input.edges.push({
        id: `edge:contract_driven:${index}:contract_call`,
        fromNodeId: callerNodeId,
        toNodeId: contractNodeId,
        type: "approval",
        displayRole: "profile_context",
        amountRaw: null,
        amountShare: null,
        txHash: null,
        timestamp,
        weight: receiverConfidence,
        verdict: receiverRole === "drainer" ? "risk" : "review",
        evidenceIds,
        metadata: {
          source: "contractDrivenTransferProfile",
          evidenceType: "contract_call_context",
          evidenceTypeLabel: "Contract call context",
          evidenceMeaning: "The caller and contract explain how the transfer was triggered; this edge is not token movement.",
          txHash,
          method,
          callerAddress,
          contractAddress,
          sourceAddress,
          receiverAddress,
          boundaryContextOnly: true,
          underlyingTransfers: []
        }
      });
    }
  });
}

function projectApprovalDrainProvenanceEventClusters(input: {
  profiles: Record<string, unknown>[];
  upsertNode: (address: string, kind: AdminForensicsNode["kind"], metadata?: Record<string, unknown>) => string;
  edges: AdminForensicsEdge[];
  paths: AdminForensicsPath[];
  weights: AdminForensicsWeight[];
}): void {
  type CampaignDraft = {
    txCount: number;
    victims: Set<string>;
    spenders: Set<string>;
    operators: Set<string>;
    drainTxHashes: Set<string>;
    totalAmountRaw: string | null;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  const campaignsByReceiver = new Map<string, CampaignDraft>();
  const campaignsBySpender = new Map<string, CampaignDraft>();
  const campaignsByOperator = new Map<string, CampaignDraft>();
  const emptyCampaign = (): CampaignDraft => ({
    txCount: 0,
    victims: new Set(),
    spenders: new Set(),
    operators: new Set(),
    drainTxHashes: new Set(),
    totalAmountRaw: null,
    firstSeen: null,
    lastSeen: null
  });
  const addCampaign = (map: Map<string, CampaignDraft>, key: string | null, profile: Record<string, unknown>): void => {
    if (!key) return;
    const draft = map.get(key) ?? emptyCampaign();
    const victimAddress = stringField(profile, "victimAddress");
    const spenderAddress = stringField(profile, "spenderAddress");
    const operatorAddress = stringField(profile, "operatorAddress");
    const drainTxHash = stringField(profile, "drainTxHash");
    const drainAt = stringField(profile, "drainAt");
    draft.txCount += 1;
    if (victimAddress) draft.victims.add(victimAddress);
    if (spenderAddress) draft.spenders.add(spenderAddress);
    if (operatorAddress) draft.operators.add(operatorAddress);
    if (drainTxHash) draft.drainTxHashes.add(drainTxHash);
    draft.totalAmountRaw = addRawDecimalStrings(draft.totalAmountRaw, stringField(profile, "amountRaw"));
    draft.firstSeen = firstString(
      draft.firstSeen && drainAt ? (draft.firstSeen <= drainAt ? draft.firstSeen : drainAt) : null,
      draft.firstSeen,
      drainAt
    );
    draft.lastSeen = firstString(
      draft.lastSeen && drainAt ? (draft.lastSeen >= drainAt ? draft.lastSeen : drainAt) : null,
      draft.lastSeen,
      drainAt
    );
    map.set(key, draft);
  };
  input.profiles.forEach((profile) => {
    if (!approvalDrainProfileHasExactDrainRoot(profile)) return;
    const receiverAddress = firstString(stringField(profile, "firstReceiverAddress"), stringField(profile, "subjectAddress"));
    const spenderAddress = stringField(profile, "spenderAddress");
    const operatorAddress = stringField(profile, "operatorAddress");
    addCampaign(campaignsByReceiver, receiverAddress, profile);
    addCampaign(campaignsBySpender, spenderAddress, profile);
    addCampaign(campaignsByOperator, operatorAddress, profile);
  });
  const campaignSummary = (map: Map<string, CampaignDraft>, key: string | null): Record<string, unknown> | undefined => {
    if (!key) return undefined;
    const draft = map.get(key);
    if (!draft || draft.txCount < 2) return undefined;
    return {
      evidenceType: "drainer_campaign",
      txCount: draft.txCount,
      victimCount: draft.victims.size,
      spenderContractCount: draft.spenders.size,
      operatorCount: draft.operators.size,
      totalAmountRaw: draft.totalAmountRaw,
      firstSeen: draft.firstSeen,
      lastSeen: draft.lastSeen,
      drainTxHashes: Array.from(draft.drainTxHashes)
    };
  };

  input.profiles.forEach((profile, index) => {
    if (!approvalDrainProfileHasGraphableTransfer(profile)) return;

    const victimAddress = stringField(profile, "victimAddress");
    const receiverAddress = firstString(stringField(profile, "firstReceiverAddress"), stringField(profile, "subjectAddress"));
    const spenderAddress = stringField(profile, "spenderAddress");
    const operatorAddress = stringField(profile, "operatorAddress");
    const drainTxHash = stringField(profile, "drainTxHash");
    const approvalTxHash = stringField(profile, "approvalTxHash");
    const amountRaw = stringField(profile, "amountRaw");
    const drainAt = stringField(profile, "drainAt");
    const approvalAt = stringField(profile, "approvalAt");
    const score = numberField(profile, "score") ?? 95;
    const spenderResolution = stringField(profile, "spenderResolution");
    const isExactProfile = approvalDrainProfileIsExact(profile);
    const hasExactDrainRoot = approvalDrainProfileHasExactDrainRoot(profile);
    const edgeVerdict = hasExactDrainRoot ? "risk" : "review";
    const pathVerdict = hasExactDrainRoot ? "DECLINE" : "REVIEW";
    const evidenceKind = isExactProfile ? "exact" : hasExactDrainRoot ? "route_linked_exact_root" : "route_linked_review";
    if (!victimAddress || !receiverAddress || !spenderAddress || !drainTxHash) return;

    const victimNodeId = input.upsertNode(victimAddress, "wallet", {
      source: "approvalDrainProvenanceProfile",
      drainTxHash
    });
    const receiverNodeId = input.upsertNode(receiverAddress, "wallet", {
      source: "approvalDrainProvenanceProfile",
      drainTxHash,
      role: "first_receiver",
      drainerCampaign: campaignSummary(campaignsByReceiver, receiverAddress)
    });
    const spenderNodeId = input.upsertNode(spenderAddress, spenderResolution === "wrapper_contract" ? "contract" : "wallet", {
      source: "approvalDrainProvenanceProfile",
      drainTxHash,
      approvalTxHash,
      spenderResolution,
      role: "spender_contract",
      drainerCampaign: campaignSummary(campaignsBySpender, spenderAddress)
    });
    const operatorNodeId = operatorAddress
      ? input.upsertNode(operatorAddress, "wallet", {
        source: "approvalDrainProvenanceProfile",
        drainTxHash,
        role: "operator",
        drainerCampaign: campaignSummary(campaignsByOperator, operatorAddress)
      })
      : null;

    const evidenceIds = stringArrayField(profile, "evidenceIds");
    const pathId = `path:approval_drain:${index}`;
    const edgeIds: string[] = [];

    if (operatorNodeId) {
      const edgeId = `edge:approval_drain:${index}:contract_call`;
      input.edges.push({
        id: edgeId,
        fromNodeId: operatorNodeId,
        toNodeId: spenderNodeId,
        type: "approval",
        amountRaw: null,
        amountShare: null,
        txHash: drainTxHash,
        timestamp: drainAt,
        weight: score,
        verdict: edgeVerdict,
        evidenceIds,
        metadata: {
          source: "approvalDrainProvenanceProfile",
          evidenceType: "approval_drain_contract_call",
          evidenceTypeLabel: "Drainer contract call",
          evidenceMeaning: "An operator called a smart contract that moved USDT from the victim address to the receiver. This line is the contract call context, not the USDT transfer itself.",
          method: "contract-driven token transfer",
          pathId,
          approvalTxHash,
          drainTxHash,
          victimAddress,
          spenderAddress,
          operatorAddress,
          receiverAddress,
          spenderResolution,
          evidenceKind
        }
      });
      edgeIds.push(edgeId);
    }

    const authorityEdgeId = `edge:approval_drain:${index}:spender_authority`;
    input.edges.push({
      id: authorityEdgeId,
      fromNodeId: victimNodeId,
      toNodeId: spenderNodeId,
      type: "approval",
      displayRole: "profile_context",
      amountRaw: null,
      amountShare: null,
      txHash: approvalTxHash,
      timestamp: approvalAt,
      weight: score,
      verdict: edgeVerdict,
      evidenceIds,
      metadata: {
        source: "approvalDrainProvenanceProfile",
        evidenceType: "approval_drain_spender_authority",
        evidenceTypeLabel: "Approval-drain authority",
        evidenceMeaning: "The victim is linked to the spender/contract by approval-drain evidence. This line explains debit authority context and is not a normal money transfer.",
        pathId,
        approvalTxHash,
        drainTxHash,
        victimAddress,
        spenderAddress,
        fromAddress: victimAddress,
        toAddress: spenderAddress,
        operatorAddress,
        receiverAddress,
        spenderResolution,
        evidenceKind,
        boundaryContextOnly: true
      }
    });
    edgeIds.push(authorityEdgeId);

    const transferEdgeId = `edge:approval_drain:${index}:transfer`;
    input.edges.push({
      id: transferEdgeId,
      fromNodeId: spenderNodeId,
      toNodeId: receiverNodeId,
      type: "transfer",
      amountRaw,
      amountShare: numberField(profile, "amountPreservationRatio"),
      txHash: drainTxHash,
      timestamp: drainAt,
      weight: score,
      verdict: edgeVerdict,
      evidenceIds,
      metadata: {
        source: "approvalDrainProvenanceProfile",
        evidenceType: "approval_drain_transfer",
        evidenceTypeLabel: "Contract-driven USDT transfer",
        evidenceMeaning: "USDT moved into the receiver through a smart-contract call. The victim/source wallet is shown in the transaction evidence, not as a direct wallet-transfer line.",
        aggregateAmountRaw: amountRaw,
        aggregateTransferCount: 1,
        underlyingTransfers: [{
          txHash: drainTxHash,
          amountRaw,
          timestamp: drainAt,
          role: "drain_transfer",
          fromAddress: victimAddress,
          toAddress: receiverAddress
        }],
        pathId,
        approvalTxHash,
        drainTxHash,
        victimAddress,
        spenderAddress,
        operatorAddress,
        receiverAddress,
        spenderResolution,
        evidenceKind
      }
    });
    edgeIds.push(transferEdgeId);

    input.paths.push({
      id: pathId,
      nodeIds: [
        ...(operatorNodeId ? [operatorNodeId] : []),
        spenderNodeId,
        victimNodeId,
        receiverNodeId
      ],
      edgeIds,
      verdict: pathVerdict,
      riskContribution: score,
      amountRaw,
      amountShare: numberField(profile, "amountPreservationRatio"),
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds
    });
    input.weights.push({
      id: `weight:approval_drain:${index}`,
      source: "approval_drain_provenance",
      label: hasExactDrainRoot ? "Exact approval-drain provenance" : "Approval-drain review context",
      value: score,
      direction: hasExactDrainRoot ? "raises_risk" : "context",
      pathId,
      nodeId: receiverNodeId,
      edgeId: transferEdgeId,
      explanation: hasExactDrainRoot
        ? "Exact approval-drain evidence links victim, spender contract/operator, and receiver."
        : "Approval-drain review evidence links victim, spender contract/operator, and receiver context.",
      metadata: {
        drainTxHash,
        approvalTxHash,
        victimAddress,
        spenderAddress,
        operatorAddress,
        receiverAddress,
        spenderResolution,
        evidenceKind
      }
    });
  });
}

function shareDetailMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const metadata: Record<string, unknown> = {};
  for (const key of [
    "scope",
    "targetAmountRaw",
    "affectedAmountRaw",
    "rawShare",
    "effectiveShare",
    "sourceSeverity",
    "valueWeightedRaw",
    "pathContextAdjustment",
    "repeatedExposureAdjustment",
    "dataQualityAdjustment",
    "walletRoleAdjustment",
    "shareFloor",
    "shareCap",
    "finalContribution"
  ]) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      metadata[key] = item;
    }
  }
  return metadata;
}

function shareLabel(value: number): string {
  const percent = Number((value * 100).toFixed(2));
  return `${percent}%`;
}

function incomingAttributedShareMetadata(
  balanceShare: number | null,
  amountCoverageRatio: number | null
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (amountCoverageRatio !== null) metadata.amountCoverageRatio = amountCoverageRatio;
  if (balanceShare !== null) {
    metadata.balanceShare = balanceShare;
    metadata.attributedShare = balanceShare;
    metadata.attributedShareLabel = shareLabel(balanceShare);
  }
  return metadata;
}

function sourcePolicyEvidenceMetadata(evidence: Record<string, unknown>): Record<string, unknown> {
  const metadata = shareDetailMetadata(evidence["shareDetail"]);
  for (const key of ["aggregateShare", "effectiveShare", "pathCount", "score"]) {
    const value = numberField(evidence, key);
    if (value !== null) metadata[key] = value;
  }
  for (const key of ["kind", "proofLevel", "riskBand"]) {
    const value = stringField(evidence, key);
    if (value !== null) metadata[key] = value;
  }
  return metadata;
}

function sourceBundleExposureMetadata(exposure: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const key of ["scope", "targetAmountRaw", "coveredAmountRaw", "dominantSource"]) {
    const value = stringField(exposure, key);
    if (value !== null) metadata[key] = value;
  }
  const coveredAmountRaw = stringField(exposure, "coveredAmountRaw");
  if (coveredAmountRaw !== null) metadata.affectedAmountRaw = coveredAmountRaw;
  const coverageRatio = numberField(exposure, "coverageRatio");
  if (coverageRatio !== null) metadata.coverageRatio = coverageRatio;
  const evidenceTxHashes = stringArrayField(exposure, "evidenceTxHashes");
  if (evidenceTxHashes.length > 0) metadata.evidenceTxHashes = evidenceTxHashes;
  const reasons = stringArrayField(exposure, "reasons");
  if (reasons.length > 0) metadata.reasons = reasons;
  const warnings = stringArrayField(exposure, "warnings");
  if (warnings.length > 0) metadata.warnings = warnings;
  const budget = recordField(exposure, "budget");
  if (budget) {
    metadata.budget = {
      maxDepth: numberField(budget, "maxDepth"),
      fetchedAddressCount: numberField(budget, "fetchedAddressCount"),
      maxAddressFetches: numberField(budget, "maxAddressFetches"),
      liveTransferReadCount: numberField(budget, "liveTransferReadCount"),
      skippedAddressCount: numberField(budget, "skippedAddressCount"),
      exhausted: budget["exhausted"] === true,
      exhaustedPhase: stringField(budget, "exhaustedPhase")
    };
  }
  return metadata;
}

function addSourceBundleExposureWeights(input: {
  weights: AdminForensicsWeight[];
  limitations: AdminForensicsLimitation[];
  nodeId: string;
  mode: "where" | "incoming";
  exposure: Record<string, unknown> | null;
}): void {
  if (!input.exposure) return;
  const metadata = sourceBundleExposureMetadata(input.exposure);
  const base = `weight:${input.mode}:source_bundle`;
  const shares: Array<{
    field: string;
    code: string;
    label: string;
    direction: AdminForensicsWeight["direction"];
    explanation: string;
  }> = [
    {
      field: "htxHuobiShare",
      code: "source_bundle_htx_huobi_share",
      label: "Fresh HTX/Huobi selected-amount share",
      direction: "raises_risk",
      explanation: "Fresh HTX/Huobi source-bundle share for the selected amount."
    },
    {
      field: "cleanCexShare",
      code: "source_bundle_clean_cex_share",
      label: "Fresh clean CEX selected-amount share",
      direction: "lowers_risk",
      explanation: "Fresh clean CEX source-bundle share for the selected amount."
    },
    {
      field: "bridgeRouterDexShare",
      code: "source_bundle_bridge_router_dex_share",
      label: "Fresh bridge/router/DEX selected-amount share",
      direction: "raises_risk",
      explanation: "Fresh bridge/router/DEX source-bundle share for the selected amount."
    },
    {
      field: "unknownContractShare",
      code: "source_bundle_unknown_contract_share",
      label: "Fresh unknown-contract selected-amount share",
      direction: "raises_risk",
      explanation: "Fresh unknown-contract source-bundle share for the selected amount."
    },
    {
      field: "riskyLabelShare",
      code: "source_bundle_risky_label_share",
      label: "Fresh risky-label selected-amount share",
      direction: "raises_risk",
      explanation: "Fresh risky-label source-bundle share for the selected amount."
    },
    {
      field: "unknownShare",
      code: "source_bundle_unknown_share",
      label: "Fresh unknown selected-amount share",
      direction: "context",
      explanation: "Fresh source-bundle share that remains unknown for the selected amount."
    },
    {
      field: "coverageRatio",
      code: "source_bundle_coverage_ratio",
      label: "Fresh source-bundle coverage ratio",
      direction: "context",
      explanation: "Coverage ratio for selected-amount source-bundle attribution."
    }
  ];

  shares.forEach((share) => {
    const value = numberField(input.exposure!, share.field) ?? 0;
    input.weights.push({
      id: `${base}:${share.code}`,
      code: share.code,
      source: "source_bundle_exposure",
      label: share.label,
      value,
      direction: value > 0 ? share.direction : "context",
      pathId: null,
      nodeId: input.nodeId,
      edgeId: null,
      explanation: share.explanation,
      metadata: { ...metadata }
    });
  });

  const budget = recordField(input.exposure, "budget");
  if (budget?.["exhausted"] === true) {
    const exhaustedPhase = stringField(budget, "exhaustedPhase") ?? "unknown";
    input.limitations.push({
      code: "source_bundle_budget_exhausted",
      label: "Source bundle budget exhausted",
      severity: "review",
      pathId: null,
      explanation: `Source-bundle graph budget was exhausted during ${exhaustedPhase}.`
    });
  }

  const unresolvedBoundary = recordField(input.exposure, "unresolvedBoundary");
  if (unresolvedBoundary) {
    const scoreFloor = numberField(unresolvedBoundary, "scoreFloor") ?? 0;
    const boundaryMetadata = {
      kind: stringField(unresolvedBoundary, "kind"),
      affectedShare: numberField(unresolvedBoundary, "affectedShare"),
      scoreFloor,
      evidenceTxHashes: stringArrayField(unresolvedBoundary, "evidenceTxHashes"),
      reason: stringField(unresolvedBoundary, "reason")
    };
    input.weights.push({
      id: `${base}:source_bundle_unresolved_boundary`,
      code: "source_bundle_unresolved_boundary",
      source: "source_bundle_exposure",
      label: "Unresolved source-bundle boundary",
      value: scoreFloor,
      direction: scoreFloor > 0 ? "raises_risk" : "context",
      pathId: null,
      nodeId: input.nodeId,
      edgeId: null,
      explanation: stringField(unresolvedBoundary, "reason") ?? "Source-bundle graph stopped before resolving a material boundary.",
      metadata: boundaryMetadata
    });
    input.limitations.push({
      code: "source_bundle_unresolved_boundary",
      label: "Unresolved source-bundle boundary",
      severity: "review",
      pathId: null,
      explanation: stringField(unresolvedBoundary, "reason") ?? "Source-bundle graph stopped before resolving a material boundary."
    });
  }
}

function attachNodeRelatedLimitations(
  nodesById: Map<string, AdminForensicsNode>,
  nodeId: string,
  limitations: AdminForensicsLimitation[],
  codes: string[]
): void {
  const node = nodesById.get(nodeId);
  if (!node) return;
  const codeSet = new Set(codes);
  const relatedLimitations = limitations
    .map((limitation) => limitation.code)
    .filter((code) => codeSet.has(code));
  if (relatedLimitations.length === 0) return;
  const existing = Array.isArray(node.metadata.relatedLimitations)
    ? node.metadata.relatedLimitations.filter((value): value is string => typeof value === "string")
    : [];
  node.metadata = {
    ...node.metadata,
    relatedLimitations: Array.from(new Set([...existing, ...relatedLimitations]))
  };
}

function addSubjectExposureProfileWeights(input: {
  weights: AdminForensicsWeight[];
  limitations: AdminForensicsLimitation[];
  nodeId: string;
  mode: "where" | "incoming";
  profile: Record<string, unknown> | null;
}): void {
  if (!input.profile) return;
  const metadata = {
    subjectAddress: stringField(input.profile, "subjectAddress"),
    windowStart: stringField(input.profile, "windowStart"),
    windowEnd: stringField(input.profile, "windowEnd"),
    transferEventsScanned: numberField(input.profile, "transferEventsScanned"),
    incomingVolumeRaw: stringField(input.profile, "incomingVolumeRaw"),
    outgoingVolumeRaw: stringField(input.profile, "outgoingVolumeRaw"),
    reasons: stringArrayField(input.profile, "reasons"),
    warnings: stringArrayField(input.profile, "warnings")
  };
  const fields: Array<{ field: string; code: string; label: string; explanation: string }> = [
    {
      field: "scoreContribution",
      code: "subject_exposure_score_contribution",
      label: "Historical subject exposure background score",
      explanation: "Historical subject exposure profile background context; not selected-amount source proof."
    },
    {
      field: "htxHuobiIncomingShare",
      code: "subject_exposure_htx_huobi_incoming_share",
      label: "Historical subject HTX/Huobi incoming share",
      explanation: "Historical subject HTX/Huobi incoming share; context only, not selected-amount source proof."
    },
    {
      field: "bridgeRouterDexVolumeShare",
      code: "subject_exposure_bridge_router_dex_volume_share",
      label: "Historical subject bridge/router/DEX volume share",
      explanation: "Historical subject bridge/router/DEX volume share; context only, not selected-amount source proof."
    },
    {
      field: "unknownContractVolumeShare",
      code: "subject_exposure_unknown_contract_volume_share",
      label: "Historical subject unknown-contract volume share",
      explanation: "Historical subject unknown-contract volume share; context only, not selected-amount source proof."
    },
    {
      field: "unknownSourceShare",
      code: "subject_exposure_unknown_source_share",
      label: "Historical subject unknown-source share",
      explanation: "Historical subject unknown-source share; context only, not selected-amount source proof."
    }
  ];
  fields.forEach((field) => {
    input.weights.push({
      id: `weight:${input.mode}:subject_exposure:${field.code}`,
      code: field.code,
      source: "subject_exposure_profile",
      label: field.label,
      value: numberField(input.profile!, field.field) ?? 0,
      direction: "context",
      pathId: null,
      nodeId: input.nodeId,
      edgeId: null,
      explanation: field.explanation,
      metadata: { ...metadata }
    });
  });
  input.limitations.push({
    code: "subject_exposure_context_not_source_proof",
    label: "Subject exposure profile is historical context",
    severity: "info",
    pathId: null,
    explanation: "Historical subject exposure profile is background context and does not prove the selected amount source."
  });
}

function attachWeakSubjectExposureServiceHints(
  nodesById: Map<string, AdminForensicsNode>,
  profile: Record<string, unknown> | null
): void {
  if (!profile) return;
  const rows = [
    ...recordArrayField(profile, "topIncoming"),
    ...recordArrayField(profile, "topIncomingCounterparties"),
    ...recordArrayField(profile, "topOutgoing"),
    ...recordArrayField(profile, "topOutgoingCounterparties")
  ];
  rows.forEach((row) => {
    const address = stringField(row, "address") ?? stringField(row, "counterpartyAddress");
    if (!address) return;
    const node = nodesById.get(nodeId(address));
    if (!node || node.metadata.boundaryIdentity) return;
    const category = firstString(stringField(row, "serviceCategory"), stringField(row, "category"));
    const identity = firstString(stringField(row, "serviceIdentity"), stringField(row, "identity"));
    const source = firstString(stringField(row, "serviceIdentitySource"), stringField(row, "identitySource"), stringField(row, "source"));
    if (hasStrongServiceIdentity({
      category,
      identity,
      source,
      isContract: booleanField(row, "isContract"),
      evidenceType: stringField(row, "evidenceType")
    })) return;
    const hint = weakServiceHint(category, identity, source);
    if (!hint) return;
    node.metadata = {
      ...node.metadata,
      weakServiceHint: hint
    };
  });
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function strictProvenanceSummary(
  progress: Record<string, unknown>,
  result: Record<string, unknown>
): Record<string, unknown> | null {
  if (progress.strictProvenanceBenchmark !== true) return null;
  const strict = isRecord(progress.strictProvenance) ? progress.strictProvenance : {};
  const scoreValid = result.score_valid === true
    ? true
    : result.score_valid === false
      ? false
      : null;
  return {
    benchmark: true,
    phase: stringField(strict, "phase") ?? stringField(progress, "jobPhase"),
    scoreValid,
    scoreBlockedReason: stringField(result, "score_blocked_reason") ?? stringField(strict, "scoreBlockedReason"),
    technicalStatus: stringField(result, "technical_status") ?? stringField(strict, "technicalStatus"),
    coveredHopCount: numberField(strict, "coveredHopCount"),
    totalHopCount: numberField(strict, "totalHopCount")
  };
}

function targetedIndexSummary(progress: Record<string, unknown>, result: Record<string, unknown>): Record<string, unknown> | null {
  const targeted = recordField(progress, "targetedIndex");
  if (!targeted) return null;
  const waitingFor = recordField(targeted, "waitingFor");
  const candidateWindows = recordField(targeted, "candidateWindows");
  return {
    phase: stringField(targeted, "phase") ?? stringField(progress, "jobPhase"),
    scoreValid: booleanField(targeted, "scoreValid"),
    scoreBlockedReason: stringField(targeted, "scoreBlockedReason") ?? stringField(result, "score_blocked_reason"),
    technicalStatus: stringField(targeted, "technicalStatus") ?? stringField(result, "technical_status"),
    candidateWindows: candidateWindows ? {
      total: numberField(candidateWindows, "total"),
      queued: numberField(candidateWindows, "queued"),
      running: numberField(candidateWindows, "running"),
      complete: numberField(candidateWindows, "complete"),
      terminal: numberField(candidateWindows, "terminal"),
      pending: numberField(candidateWindows, "pending")
    } : null,
    broadFallback: stringField(targeted, "broadFallback"),
    waitingForAddress: waitingFor ? stringField(waitingFor, "address") : null,
    waitingForTargetTimestamp: waitingFor ? stringField(waitingFor, "targetTimestamp") : null,
    waitingForReason: waitingFor ? stringField(waitingFor, "queuedReason") : null,
    requiredFor: waitingFor ? stringField(waitingFor, "requiredFor") : null,
    lastIndexedAddress: stringField(targeted, "lastIndexedAddress"),
    lastIndexedTargetTimestamp: stringField(targeted, "lastIndexedTargetTimestamp"),
    lastCandidateWindowStartTimestamp: stringField(targeted, "lastCandidateWindowStartTimestamp"),
    lastCandidateTxHash: stringField(targeted, "lastCandidateTxHash"),
    lastIndexStatus: stringField(targeted, "lastIndexStatus"),
    statusReason: stringField(targeted, "statusReason"),
    pagesFetched: numberField(targeted, "pagesFetched"),
    transfersFetched: numberField(targeted, "transfersFetched"),
    uniqueCanonicalHashCount: numberField(targeted, "uniqueCanonicalHashCount"),
    repeatRatio: numberField(targeted, "repeatRatio"),
    oldestFetchedTransferAt: stringField(targeted, "oldestFetchedTransferAt"),
    newestFetchedTransferAt: stringField(targeted, "newestFetchedTransferAt"),
    targetTimestamp: stringField(targeted, "targetTimestamp"),
    budgetPages: numberField(targeted, "budgetPages"),
    attemptCount: numberField(targeted, "attemptCount"),
    maxAttempts: numberField(targeted, "maxAttempts"),
    retryCount: numberField(targeted, "retryCount"),
    providerCapHit: booleanField(targeted, "providerCapHit"),
    budgetExhausted: booleanField(targeted, "budgetExhausted"),
    providerInconsistent: booleanField(targeted, "providerInconsistent"),
    requestCount: numberField(targeted, "requestCount"),
    rateLimitedCount: numberField(targeted, "rateLimitedCount"),
    forbiddenCount: numberField(targeted, "forbiddenCount"),
    serverErrorCount: numberField(targeted, "serverErrorCount")
  };
}

function targetedHistorySummary(progress: Record<string, unknown>): Record<string, unknown> | null {
  const history = recordField(progress, "targetedHistory");
  if (!history) return null;
  const states = recordArrayField(history, "states").map((state) => ({
    address: stringField(state, "address"),
    requestKind: stringField(state, "requestKind"),
    windowStartTimestamp: stringField(state, "windowStartTimestamp"),
    windowEndTimestamp: stringField(state, "windowEndTimestamp"),
    relatedHopTxHash: stringField(state, "relatedHopTxHash"),
    candidateTxHash: stringField(state, "candidateTxHash"),
    targetTimestamp: stringField(state, "targetTimestamp"),
    requiredFor: stringField(state, "requiredFor"),
    waitStatus: stringField(state, "waitStatus"),
    status: stringField(state, "status"),
    statusReason: stringField(state, "statusReason"),
    budgetPages: numberField(state, "budgetPages"),
    fetchedPageCount: numberField(state, "fetchedPageCount"),
    fetchedTransferCount: numberField(state, "fetchedTransferCount"),
    uniqueCanonicalHashCount: numberField(state, "uniqueCanonicalHashCount"),
    repeatRatio: numberField(state, "repeatRatio"),
    oldestTransferAt: stringField(state, "oldestTransferAt"),
    newestTransferAt: stringField(state, "newestTransferAt"),
    attemptCount: numberField(state, "attemptCount"),
    maxAttempts: numberField(state, "maxAttempts"),
    retryCount: numberField(state, "retryCount"),
    providerCapHit: booleanField(state, "providerCapHit"),
    budgetExhausted: booleanField(state, "budgetExhausted"),
    providerInconsistent: booleanField(state, "providerInconsistent"),
    lockedUntil: stringField(state, "lockedUntil"),
    lockOwner: stringField(state, "lockOwner"),
    nextRunAt: stringField(state, "nextRunAt"),
    lastError: stringField(state, "lastError")
  }));
  const candidateWindows = recordField(history, "candidateWindows");
  return {
    totalTargetedStates: numberField(history, "totalTargetedStates"),
    queuedCount: numberField(history, "queuedCount"),
    runningCount: numberField(history, "runningCount"),
    completeCount: numberField(history, "completeCount"),
    partialCount: numberField(history, "partialCount"),
    failedCount: numberField(history, "failedCount"),
    waitingCount: numberField(history, "waitingCount"),
    readyCount: numberField(history, "readyCount"),
    terminalCount: numberField(history, "terminalCount"),
    staleRunningCount: numberField(history, "staleRunningCount"),
    maxBudgetPages: numberField(history, "maxBudgetPages"),
    fetchedPageCount: numberField(history, "fetchedPageCount"),
    fetchedTransferCount: numberField(history, "fetchedTransferCount"),
    uniqueCanonicalHashCount: numberField(history, "uniqueCanonicalHashCount"),
    repeatRatio: numberField(history, "repeatRatio"),
    oldestTransferAt: stringField(history, "oldestTransferAt"),
    newestTransferAt: stringField(history, "newestTransferAt"),
    providerCapHit: booleanField(history, "providerCapHit"),
    budgetExhausted: booleanField(history, "budgetExhausted"),
    providerInconsistent: booleanField(history, "providerInconsistent"),
    requestCount: numberField(history, "requestCount"),
    rateLimitedCount: numberField(history, "rateLimitedCount"),
    forbiddenCount: numberField(history, "forbiddenCount"),
    serverErrorCount: numberField(history, "serverErrorCount"),
    candidateWindows: candidateWindows ? {
      total: numberField(candidateWindows, "total"),
      queued: numberField(candidateWindows, "queued"),
      running: numberField(candidateWindows, "running"),
      complete: numberField(candidateWindows, "complete"),
      terminal: numberField(candidateWindows, "terminal"),
      pending: numberField(candidateWindows, "pending")
    } : null,
    states
  };
}

function hasTargetedProviderCapTerminal(
  progress: Record<string, unknown>,
  result: Record<string, unknown>
): boolean {
  const targeted = recordField(progress, "targetedIndex");
  if (!targeted) return false;
  const providerCapBlocked =
    stringField(result, "score_blocked_reason") === "provider_cap_unresolved" ||
    stringField(result, "technical_status") === "provider_cap_unresolved" ||
    stringField(targeted, "scoreBlockedReason") === "provider_cap_unresolved" ||
    stringField(targeted, "technicalStatus") === "provider_cap_unresolved";
  if (!providerCapBlocked) return false;
  return stringField(targeted, "phase") === "provider_limited" ||
    stringField(targeted, "statusReason") === "partial_provider_cap" ||
    booleanField(targeted, "providerCapHit") === true;
}

function strictBenchmarkMetricsSummary(progress: Record<string, unknown>): Record<string, unknown> | null {
  const metrics = isRecord(progress.strictBenchmarkMetrics) ? progress.strictBenchmarkMetrics : null;
  const total = metrics && isRecord(metrics.total) ? metrics.total : {};
  const stages = metrics && isRecord(metrics.stages) ? metrics.stages : {};
  if (!metrics) return null;
  return {
    elapsedMs: numberField(total, "elapsedMs"),
    requestCount: numberField(total, "requestCount"),
    rateLimitedCount: numberField(total, "rateLimitedCount"),
    forbiddenCount: numberField(total, "forbiddenCount"),
    serverErrorCount: numberField(total, "serverErrorCount"),
    effectiveRps: numberField(total, "effectiveRps"),
    keyCount: numberField(total, "keyCount"),
    accountGroupCount: numberField(total, "accountGroupCount"),
    apiMs: numberField(stages, "apiMs"),
    dbWriteMs: numberField(stages, "dbWriteMs"),
    dbReadMs: numberField(stages, "dbReadMs"),
    traceMs: numberField(stages, "traceMs"),
    scoringMs: numberField(stages, "scoringMs")
  };
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-6)}` : address;
}

type BoundaryIdentityConfidence = "high" | "medium" | "low";

type BoundaryIdentityMetadata = {
  displayName: string;
  category: string;
  categoryLabel: string;
  confidence: BoundaryIdentityConfidence;
  source: string;
  evidence: string[];
  isBoundary: boolean;
  flowVerdict?: string;
  flowVerdictConfidence?: number;
};

function boundaryCategoryLabel(category: string | null | undefined): string {
  switch (category) {
    case "cex":
      return "CEX";
    case "hot_wallet":
      return "Hot wallet";
    case "bridge":
    case "bridge_pool":
      return "Cross-chain bridge";
    case "dex":
      return "DEX";
    case "router":
      return "Router";
    case "swap_adapter":
      return "Swap adapter";
    case "service":
      return "Service";
    case "protocol":
      return "Protocol";
    case "unknown_contract":
    case "contract":
      return "Contract boundary";
    default:
      return "Boundary";
  }
}

function boundaryIdentitySource(category: string | null, identity: string | null, source: string | null): string {
  if (source) return source;
  if (category === "cex" && identity) return "known_cex_rule";
  if (identity) return "metadata";
  if (category === "unknown_contract" || category === "contract") return "weak_contract_metadata";
  if (!category || category === "unknown") return "unknown";
  if (category) return "mixed";
  return "unknown";
}

function boundaryIdentityConfidence(
  category: string | null,
  identity: string | null,
  source: string
): BoundaryIdentityConfidence {
  if (
    source === "known_cex_rule" ||
    source === "service_registry" ||
    source === "provider_tag" ||
    source === "public_tag"
  ) {
    return "high";
  }
  if (identity || category === "unknown_contract" || category === "contract") return "medium";
  return "low";
}

function hasStrongServiceIdentity(input: {
  category: string | null;
  identity?: string | null;
  source?: string | null;
  isContract?: boolean | null;
  evidenceType?: string | null;
}): boolean {
  if (!input.category) return false;
  const source = (input.source ?? "").toLowerCase();
  const strongIdentitySource = /known_cex_rule|registry|metadata|provider|tag|service_route/.test(source);
  if (input.identity && strongIdentitySource) return true;
  const strongContractSource = /contract|metadata|provider|registry/.test(source);
  if (input.isContract === true && input.category !== "cex" && strongContractSource) return true;
  return input.evidenceType === "service_boundary" ||
    input.evidenceType === "boundary_exposure" ||
    input.evidenceType === "grouped_boundary";
}

function weakServiceHint(
  category: string | null,
  identity?: string | null,
  source?: string | null
): Record<string, unknown> | null {
  if (!category) return null;
  return {
    category,
    ...(identity ? { identity } : {}),
    ...(source ? { source } : {}),
    reason: "weak service label not promoted to service node"
  };
}

function normalizeBoundaryIdentity(input: {
  address: string;
  identity?: string | null;
  category?: string | null;
  source?: string | null;
  evidence?: string[];
  displayName?: string | null;
  flowVerdict?: string | null;
  flowVerdictConfidence?: number | null;
}): BoundaryIdentityMetadata {
  const category = input.category || "unknown";
  const displayName = input.displayName || input.identity || (input.category ? boundaryCategoryLabel(category) : shortAddress(input.address));
  const source = boundaryIdentitySource(input.category ?? null, input.identity ?? null, input.source ?? null);
  const evidence = input.evidence && input.evidence.length > 0
    ? input.evidence
    : input.identity
      ? [`identity:${input.identity}`]
      : [`category:${category}`];
  const result: BoundaryIdentityMetadata = {
    displayName,
    category,
    categoryLabel: boundaryCategoryLabel(category),
    confidence: boundaryIdentityConfidence(category, input.identity ?? null, source),
    source,
    evidence,
    isBoundary: category !== "none"
  };
  if (input.flowVerdict) result.flowVerdict = input.flowVerdict;
  if (typeof input.flowVerdictConfidence === "number" && Number.isFinite(input.flowVerdictConfidence)) {
    result.flowVerdictConfidence = input.flowVerdictConfidence;
  }
  return result;
}

const KNOWN_CEX_IDENTITIES: Array<{ label: string; needles: string[] }> = [
  { label: "Binance", needles: ["binance"] },
  { label: "Bybit", needles: ["bybit"] },
  { label: "KuCoin", needles: ["kucoin", "ku coin"] },
  { label: "OKX", needles: ["okx"] },
  { label: "HTX/Huobi", needles: ["htx", "huobi"] },
  { label: "WhiteBIT", needles: ["whitebit", "white bit"] },
  { label: "Coinbase", needles: ["coinbase"] },
  { label: "Kraken", needles: ["kraken"] },
  { label: "Bitget", needles: ["bitget"] },
  { label: "MEXC", needles: ["mexc"] }
];

function knownCexIdentityFromText(value: string | null): string | null {
  if (!value) return null;
  const text = value.toLowerCase();
  return KNOWN_CEX_IDENTITIES.find((item) => item.needles.some((needle) => text.includes(needle)))?.label ?? null;
}

function structuredRootSourceIdentity(path: Record<string, unknown>): string | null {
  const explicit = firstString(
    stringField(path, "rootSourceIdentity"),
    stringField(path, "rootSourceLabel"),
    stringField(path, "exposureSourceLabel")
  );
  if (explicit) return explicit;
  const reasonText = stringArrayField(path, "reasons").join(" ");
  return knownCexIdentityFromText(reasonText);
}

function promoteBoundaryIdentityNode(node: AdminForensicsNode, identity: BoundaryIdentityMetadata): void {
  if (node.kind === "subject") return;
  const promotedKind = boundaryNodeKind(identity.category);
  if (promotedKind !== "wallet") node.kind = promotedKind;
}

function attachBoundaryIdentity(node: AdminForensicsNode, identity: BoundaryIdentityMetadata): void {
  promoteBoundaryIdentityNode(node, identity);
  node.metadata.boundaryIdentity = identity;
  node.metadata.identity = identity.displayName;
  node.displayLabel = identity.displayName;
  node.label = identity.displayName;
}

function attachStructuredRootSourceBoundary(
  node: AdminForensicsNode | undefined,
  path: Record<string, unknown>,
  address: string
): void {
  if (!node || node.kind === "subject") return;
  const rootSourceType = stringField(path, "rootSourceType");
  const sourceExposureKind = stringField(path, "sourceExposureKind");
  const isCexSource =
    rootSourceType === "allowlist_cex" ||
    sourceExposureKind === "allowlisted_cex" ||
    sourceExposureKind === "unknown_cex";
  if (!isCexSource) return;

  const identity = structuredRootSourceIdentity(path);
  node.metadata = {
    ...node.metadata,
    category: "cex",
    serviceCategory: "cex",
    rootSourceType,
    sourceExposureKind,
    ...(identity ? { identity } : {})
  };
  attachBoundaryIdentity(node, normalizeBoundaryIdentity({
    address,
    category: "cex",
    identity,
    source: identity ? "known_cex_rule" : "root_source",
    evidence: [
      rootSourceType ? `rootSourceType:${rootSourceType}` : "",
      sourceExposureKind ? `sourceExposureKind:${sourceExposureKind}` : ""
    ].filter(Boolean)
  }));
}

function edgeVerdict(value: unknown): AdminForensicsEdge["verdict"] {
  if (value === "ACCEPTABLE" || value === "clean") return "clean";
  if (value === "REVIEW" || value === "review") return "review";
  if (value === "DECLINE" || value === "risk") return "risk";
  return "unknown";
}

function firstNumber(...values: Array<number | null>): number | null {
  return values.find((value): value is number => value !== null) ?? null;
}

function firstString(...values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

function addRawDecimalStrings(left: string | null, right: string | null): string | null {
  const leftRaw = rawBigInt(left);
  const rightRaw = rawBigInt(right);
  if (leftRaw === null && rightRaw === null) return null;
  return ((leftRaw ?? 0n) + (rightRaw ?? 0n)).toString();
}

function boundaryUnderlyingTransfer(input: {
  txHash: string | null;
  amountRaw: string | null;
  timestamp: string | null;
  role: string;
}): Record<string, unknown> | null {
  if (!input.txHash) return null;
  return {
    txHash: input.txHash,
    amountRaw: input.amountRaw,
    timestamp: input.timestamp,
    role: input.role
  };
}

function mergeBoundaryEvidenceSummary(
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): Record<string, unknown> {
  const currentSummary = current ?? {};
  const currentCount = numberField(current ?? {}, "transferCount") ?? 0;
  const nextCount = numberField(next, "transferCount") ?? 0;
  const currentAmount = stringField(current ?? {}, "totalAmountRaw");
  const nextAmount = stringField(next, "totalAmountRaw");
  const currentTransfers = recordArrayField(current ?? {}, "underlyingTransfers");
  const nextTransfers = recordArrayField(next, "underlyingTransfers");
  const result: Record<string, unknown> = {
    ...current,
    ...next,
    evidenceType: firstString(stringField(next, "evidenceType"), stringField(currentSummary, "evidenceType")) ?? "boundary_context",
    transferCount: currentCount + nextCount,
    totalAmountRaw: addRawDecimalStrings(currentAmount, nextAmount),
    underlyingTransfers: [...currentTransfers, ...nextTransfers].slice(0, 25)
  };
  assignBoundarySummaryValues(result, currentSummary, next, "direction", "directions", stringValues);
  assignBoundarySummaryValues(result, currentSummary, next, "category", "categories", stringValues);
  assignBoundarySummaryValues(result, currentSummary, next, "identity", "identities", stringValues);
  assignBoundarySummaryValues(result, currentSummary, next, "depth", "depths", numberValues);
  assignBoundarySummaryValues(result, currentSummary, next, "boundaryAmountRaw", "boundaryAmountRaws", stringValues);
  assignBoundarySummaryValues(
    result,
    currentSummary,
    next,
    "amountPreservationRatio",
    "amountPreservationRatios",
    numberValues
  );
  return result;
}

function assignBoundarySummaryValues<T extends string | number>(
  result: Record<string, unknown>,
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  singular: string,
  plural: string,
  collect: (record: Record<string, unknown>, singular: string, plural: string) => T[]
): void {
  const values: T[] = [];
  for (const value of [...collect(current, singular, plural), ...collect(next, singular, plural)]) {
    appendUniqueValue(values, value);
  }
  if (values.length > 0) result[plural] = values;
  else delete result[plural];
  if (values.length === 1) result[singular] = values[0];
  else delete result[singular];
}

function stringValues(record: Record<string, unknown>, singular: string, plural: string): string[] {
  return [...arrayField(record, plural), record[singular]].filter((value): value is string =>
    typeof value === "string" && value.length > 0
  );
}

function numberValues(record: Record<string, unknown>, singular: string, plural: string): number[] {
  return [...arrayField(record, plural), record[singular]].filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
}

function edgeHasStoredMoneyEvidence(edge: AdminForensicsEdge): boolean {
  if (typeof edge.txHash === "string" && edge.txHash.length > 0) return true;
  if (recordArrayField(edge.metadata, "underlyingTransfers").length > 0) return true;
  if (stringField(edge.metadata, "evidenceType") === "approval_drain_transfer") return true;

  const groupedCount = firstNumber(
    numberField(edge.metadata, "aggregateTransferCount"),
    numberField(edge.metadata, "transferCount"),
    numberField(edge.metadata, "txCount")
  );
  const groupedAmount = firstString(
    stringField(edge.metadata, "aggregateAmountRaw"),
    stringField(edge.metadata, "totalAmountRaw"),
    stringField(edge.metadata, "boundaryAmountRaw"),
    edge.amountRaw
  );
  return groupedCount !== null && groupedCount > 0 && groupedAmount !== null;
}

function deepCheckAllTimeCoverageSummary(
  result: Record<string, unknown>,
  progress: Record<string, unknown> | null
): Record<string, unknown> | null {
  const coverage = recordField(result, "coverage") ?? {};
  const allTime = recordField(coverage, "allTime") ?? (progress ? recordField(progress, "allTimeCoverage") : null);
  if (!allTime) return null;

  return {
    mode: stringField(allTime, "mode"),
    subjectIndexStatus: stringField(allTime, "subjectIndexStatus"),
    subjectCoverageMode: stringField(allTime, "subjectCoverageMode"),
    subjectAllTimeComplete: booleanField(allTime, "subjectAllTimeComplete"),
    subjectTransfersFetched: numberField(allTime, "subjectTransfersFetched"),
    subjectUniqueDirectWallets: numberField(allTime, "subjectUniqueDirectWallets"),
    directWalletsHardEvidenceChecked: numberField(allTime, "directWalletsHardEvidenceChecked"),
    directWalletsHardEvidenceLiveChecked: numberField(allTime, "directWalletsHardEvidenceLiveChecked"),
    directHardEvidenceStatus: stringField(allTime, "directHardEvidenceStatus"),
    directWalletsQueuedForIndexing: numberField(allTime, "directWalletsQueuedForIndexing"),
    secondLayerActiveBudget: numberField(allTime, "secondLayerActiveBudget"),
    secondLayerQueued: numberField(allTime, "secondLayerQueued"),
    secondLayerComplete: numberField(allTime, "secondLayerComplete"),
    providerCapHit: booleanField(allTime, "providerCapHit"),
    providerInconsistent: booleanField(allTime, "providerInconsistent")
  };
}

function deepCheckCoverageSummary(
  result: Record<string, unknown>,
  progress: Record<string, unknown> | null = null,
  projectionFacts: Record<string, unknown> = {}
): Record<string, unknown> {
  const coverage = recordField(result, "coverage") ?? {};
  const debug = recordField(result, "coverageDebug");
  const debugSummary = debug ? recordField(debug, "summary") : null;
  const missingChecks = stringArrayField(result, "missingChecks");
  const allTimeCoverage = deepCheckAllTimeCoverageSummary(result, progress);
  return {
    directCounterpartiesAnalyzed: firstNumber(
      numberField(debugSummary ?? {}, "analyzedCounterpartyCount"),
      recordArrayField(result, "directCounterpartyInteractionProfiles").length
    ),
    directCounterpartiesExpanded: firstNumber(
      numberField(debugSummary ?? {}, "expandedCounterpartyCount"),
      numberField(coverage, "inboundSendersExpanded")
    ),
    transferEdgesCollected: numberField(coverage, "transferEdges"),
    sourceTransferPages: numberField(coverage, "sourceTransferPages"),
    extendedAddressesFetched: numberField(coverage, "extendedFetchedAddresses"),
    extendedIndexedEdges: numberField(coverage, "extendedIndexedEdges"),
    boundaryStopCount: missingChecks.filter((item) => item.includes("Expansion stopped at service boundary")).length,
    metadataEnrichmentLimited: missingChecks.some((item) => item.includes("Metadata enrichment limited")),
    ...projectionFacts,
    ...(allTimeCoverage ? { allTimeCoverage } : {})
  };
}

function deepCheckPathAddresses(path: Record<string, unknown>, subjectAddress: string): string[] {
  const explicit = stringArrayField(path, "pathAddresses");
  if (explicit.length >= 2) return explicit;
  const sourceAddress = stringField(path, "sourceAddress");
  if (!sourceAddress) return [];
  return [sourceAddress, ...stringArrayField(path, "viaAddresses"), subjectAddress];
}

function deepCheckPathDepth(path: Record<string, unknown>, addresses: string[]): number {
  return numberField(path, "depth") ?? Math.max(0, addresses.length - 1);
}

function deepCheckPathStopReason(path: Record<string, unknown>): string | null {
  return firstString(
    stringField(path, "stopReason"),
    stringField(path, "stoppedReason"),
    stringField(path, "stoppedAtReason")
  );
}

function secondLayerRelationshipPathAddresses(path: Record<string, unknown>, subjectAddress: string): string[] {
  const explicit = stringArrayField(path, "pathAddresses");
  if (explicit.length > 0) return explicit.length >= 3 ? explicit : [];
  const pathSubject = stringField(path, "subjectAddress") ?? subjectAddress;
  const directWalletAddress = firstString(
    stringField(path, "directWalletAddress"),
    stringField(path, "anchorAddress")
  );
  const secondHopAddress = firstString(
    stringField(path, "secondHopAddress"),
    stringField(path, "neighborAddress")
  );
  if (!pathSubject || !directWalletAddress || !secondHopAddress) return [];
  return [pathSubject, directWalletAddress, secondHopAddress];
}

function secondLayerRelationshipPathAmountRaw(path: Record<string, unknown>): string | null {
  return firstString(stringField(path, "amountRaw"), stringField(path, "totalAmountRaw"));
}

function secondLayerRelationshipPathHasEvidence(path: Record<string, unknown>): boolean {
  return stringArrayField(path, "txHashes").length > 0 ||
    (numberField(path, "txCount") ?? 0) > 0 ||
    secondLayerRelationshipPathAmountRaw(path) !== null ||
    stringArrayField(path, "evidenceIds").length > 0;
}

function projectableSecondLayerRelationshipPathAddresses(path: Record<string, unknown>, subjectAddress: string): string[] {
  const addresses = secondLayerRelationshipPathAddresses(path, subjectAddress);
  return addresses.length >= 3 && secondLayerRelationshipPathHasEvidence(path) ? addresses : [];
}

function secondLayerRelationshipMembers(group: Record<string, unknown>): string[] {
  return arrayField(group, "members").flatMap((member) => {
    if (typeof member === "string" && member.length > 0) return [member];
    if (!isRecord(member)) return [];
    const address = stringField(member, "address") ?? stringField(member, "memberAddress");
    return address ? [address] : [];
  });
}

function secondLayerRelationshipGroupAddress(group: Record<string, unknown>): string | null {
  return firstString(
    stringField(group, "directWalletAddress"),
    stringField(group, "anchorAddress")
  );
}

function secondLayerRelationshipGroupAmountRaw(group: Record<string, unknown>): string | null {
  return firstString(stringField(group, "amountRaw"), stringField(group, "totalAmountRaw"));
}

function secondLayerRelationshipGroupCount(group: Record<string, unknown>, members: string[]): number {
  return firstNumber(numberField(group, "memberCount"), numberField(group, "collapsedCount"), members.length) ?? members.length;
}

function isProjectableSecondLayerRelationshipGroup(group: Record<string, unknown>): boolean {
  if (!secondLayerRelationshipGroupAddress(group)) return false;
  const members = secondLayerRelationshipMembers(group);
  const memberCount = firstNumber(numberField(group, "memberCount"), numberField(group, "collapsedCount"));
  return members.length > 0 ||
    (memberCount ?? 0) > 0 ||
    (numberField(group, "txCount") ?? 0) > 0 ||
    secondLayerRelationshipGroupAmountRaw(group) !== null;
}

function secondLayerRelationshipCounter(
  profile: Record<string, unknown> | null,
  key: string,
  fallback: number | null
): number | null {
  if (!profile) return fallback;
  const counters = recordField(profile, "counters");
  return firstNumber(counters ? numberField(counters, key) : null, fallback) ?? fallback;
}

function secondLayerRelationshipMaxSavedDepth(profile: Record<string, unknown> | null, subjectAddress: string): number {
  if (!profile) return 0;
  const depths = recordArrayField(profile, "paths").map((path) => {
    const addresses = projectableSecondLayerRelationshipPathAddresses(path, subjectAddress);
    return addresses.length >= 3 ? Math.max(0, addresses.length - 1) : null;
  }).filter((depth): depth is number => depth !== null);
  return Math.max(0, ...depths);
}

function countDeepCheckExtendedPaths(profiles: Record<string, unknown>[]): number {
  return profiles.reduce((sum, profile) => sum + recordArrayField(profile, "paths").length, 0);
}

function maxDeepCheckSavedDepth(input: {
  directCounterpartyProfiles: Record<string, unknown>[];
  inboundProfiles: Record<string, unknown>[];
  boundaryProfiles: Record<string, unknown>[];
  approvalDrainProvenanceProfiles: Record<string, unknown>[];
  extendedProfiles: Record<string, unknown>[];
  secondLayerProfile: Record<string, unknown> | null;
  subjectAddress: string;
}): number {
  const depths: number[] = [];
  if (input.directCounterpartyProfiles.length > 0) depths.push(1);
  for (const profile of input.inboundProfiles) {
    for (const path of recordArrayField(profile, "paths")) {
      const addresses = deepCheckPathAddresses(path, input.subjectAddress);
      depths.push(deepCheckPathDepth(path, addresses));
    }
  }
  for (const profile of input.boundaryProfiles) {
    for (const flow of recordArrayField(profile, "flows")) {
      depths.push(numberField(flow, "depth") ?? (stringField(flow, "viaAddress") ? 2 : 1));
    }
  }
  for (const profile of input.approvalDrainProvenanceProfiles) {
    const addresses = stringArrayField(profile, "pathAddresses");
    depths.push(numberField(profile, "depth") ?? Math.max(0, addresses.length - 1));
  }
  for (const profile of input.extendedProfiles) {
    for (const path of recordArrayField(profile, "paths")) {
      const addresses = deepCheckPathAddresses(path, input.subjectAddress);
      depths.push(deepCheckPathDepth(path, addresses));
    }
  }
  const secondLayerDepth = secondLayerRelationshipMaxSavedDepth(input.secondLayerProfile, input.subjectAddress);
  if (secondLayerDepth > 0) depths.push(secondLayerDepth);
  return Math.max(0, ...depths);
}

function mergeDeepCheckWalletClusterMetadata(
  current: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(isRecord(current) ? current : {}),
    ...patch
  };
}

function markDeepCheckNodeCluster(
  node: AdminForensicsNode | undefined,
  patch: Record<string, unknown>
): void {
  if (!node) return;
  node.metadata = {
    ...node.metadata,
    deepCheckWalletCluster: mergeDeepCheckWalletClusterMetadata(node.metadata.deepCheckWalletCluster, patch)
  };
}

function isDeepCheckServiceBoundaryCategory(value: string | null): boolean {
  return value === "bridge" ||
    value === "bridge_pool" ||
    value === "dex" ||
    value === "router" ||
    value === "cex" ||
    value === "hot_wallet" ||
    value === "swap_adapter" ||
    value === "service" ||
    value === "protocol" ||
    value === "unknown_contract";
}

function deepCheckNodeClusterType(node: AdminForensicsNode): string {
  if (node.kind === "subject") return "subject_wallet";
  if (
    node.kind === "service" ||
    node.kind === "contract" ||
    node.metadata.boundaryRole === "service_boundary" ||
    node.metadata.source === "deepExpansionBoundaryStop" ||
    isDeepCheckServiceBoundaryCategory(stringField(node.metadata, "serviceCategory")) ||
    isDeepCheckServiceBoundaryCategory(stringField(node.metadata, "serviceType")) ||
    isDeepCheckServiceBoundaryCategory(stringField(node.metadata, "category"))
  ) {
    return "boundary";
  }
  if (node.kind === "bundle") return "funding_cluster";
  if (node.kind === "stop") return "history_stop";
  return "ordinary_wallet";
}

function deepCheckEdgeClusterType(edge: AdminForensicsEdge): string {
  const evidenceType = stringField(edge.metadata, "evidenceType");
  const serviceBoundaryContext = stringField(edge.metadata, "evidenceClass") === "service_boundary_context" ||
    stringField(edge.metadata, "skippedReason") === "service_boundary_context" ||
    recordField(edge.metadata, "boundaryIdentity") !== null;
  if (edge.type === "stop" || edge.displayRole === "stop") return "history_stop";
  if (evidenceType === "boundary_context" || serviceBoundaryContext || edge.type === "service_boundary") return "context_boundary";
  if (evidenceType === "grouped_transfers" && edgeHasStoredMoneyEvidence(edge)) return "grouped_real_transfers";
  if (
    evidenceType === "deepcheck_relationship_second_hop" &&
    stringField(edge.metadata, "relationship") === "direct_subject_edge"
  ) {
    return "profile_context";
  }
  if (edge.displayRole === "profile_context") return "profile_context";
  return "proven_transaction";
}

function deepCheckEdgeClusterRelationship(
  edge: AdminForensicsEdge,
  nodesById: Map<string, AdminForensicsNode>
): string {
  const edgeType = deepCheckEdgeClusterType(edge);
  if (edgeType === "context_boundary") return "shared_service_or_boundary";
  if (edgeType === "history_stop") return "investigation_stop";
  if (edgeType === "proven_transaction") return "wallet_to_wallet";
  const from = nodesById.get(edge.fromNodeId);
  const to = nodesById.get(edge.toNodeId);
  if (from?.kind !== "subject" && to?.kind !== "subject") return "wallet_to_wallet";
  return "subject_neighborhood";
}

function deepCheckHopDepths(subjectNodeId: string, edges: AdminForensicsEdge[]): Map<string, number> {
  const neighbors = new Map<string, string[]>();
  edges.forEach((edge) => {
    neighbors.set(edge.fromNodeId, [...(neighbors.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    neighbors.set(edge.toNodeId, [...(neighbors.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  });

  // ponytail: UI hop depth uses projected undirected edges; use stored traversal depth if direction-specific depth becomes required.
  const depths = new Map<string, number>([[subjectNodeId, 0]]);
  const queue = [subjectNodeId];
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    const nextDepth = (depths.get(nodeId) ?? 0) + 1;
    for (const neighbor of neighbors.get(nodeId) ?? []) {
      if (depths.has(neighbor)) continue;
      depths.set(neighbor, nextDepth);
      queue.push(neighbor);
    }
  }
  return depths;
}

function allocateRawByShare(amountRaw: string | null, share: number | null): string | null {
  if (!amountRaw || share === null || !Number.isFinite(share) || share <= 0) return null;
  if (!/^\d+$/.test(amountRaw)) return null;
  const scaledShare = BigInt(Math.round(Math.min(1, share) * 1_000_000));
  if (scaledShare <= 0n) return null;
  return ((BigInt(amountRaw) * scaledShare) / 1_000_000n).toString();
}

function rawBigInt(value: string | null): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function sumRaw(values: string[]): string | null {
  let total = 0n;
  let seen = false;
  values.forEach((value) => {
    const parsed = rawBigInt(value);
    if (parsed === null) return;
    total += parsed;
    seen = true;
  });
  return seen ? total.toString() : null;
}

const DIRECT_COUNTERPARTY_EPISODE_GAP_MS = 30 * 24 * 60 * 60 * 1000;

type DirectCounterpartyStoredTransfer = {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  timestamp: string;
  method: string | null;
  edgeType: string | null;
  evidenceType: string;
};

function directCounterpartyTransferTime(transfer: DirectCounterpartyStoredTransfer): number {
  const parsed = Date.parse(transfer.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function directCounterpartyTransferGroupingKey(input: {
  transfer: DirectCounterpartyStoredTransfer;
  direction: string | null;
  evidenceClass: string | null;
  skippedReason: string | null;
}): string {
  return JSON.stringify([
    input.transfer.fromAddress,
    input.transfer.toAddress,
    input.direction,
    input.transfer.edgeType,
    input.transfer.method,
    input.transfer.evidenceType,
    input.evidenceClass,
    input.skippedReason
  ]);
}

function directCounterpartyTransferEpisodes(input: {
  transfers: DirectCounterpartyStoredTransfer[];
  direction: string | null;
  evidenceClass: string | null;
  skippedReason: string | null;
}): DirectCounterpartyStoredTransfer[][] {
  const groups = new Map<string, DirectCounterpartyStoredTransfer[]>();
  input.transfers.forEach((transfer) => {
    const key = directCounterpartyTransferGroupingKey({
      transfer,
      direction: input.direction,
      evidenceClass: input.evidenceClass,
      skippedReason: input.skippedReason
    });
    const current = groups.get(key) ?? [];
    current.push(transfer);
    groups.set(key, current);
  });

  const episodes: DirectCounterpartyStoredTransfer[][] = [];
  groups.forEach((transfers) => {
    const sorted = [...transfers].sort((left, right) => {
      const time = directCounterpartyTransferTime(left) - directCounterpartyTransferTime(right);
      return time !== 0 ? time : left.txHash.localeCompare(right.txHash);
    });
    let current: DirectCounterpartyStoredTransfer[] = [];
    sorted.forEach((transfer) => {
      const previous = current[current.length - 1];
      if (previous && directCounterpartyTransferTime(transfer) - directCounterpartyTransferTime(previous) > DIRECT_COUNTERPARTY_EPISODE_GAP_MS) {
        episodes.push(current);
        current = [];
      }
      current.push(transfer);
    });
    if (current.length > 0) episodes.push(current);
  });

  return episodes.sort((left, right) => {
    const time = directCounterpartyTransferTime(left[0]) - directCounterpartyTransferTime(right[0]);
    if (time !== 0) return time;
    return (left[0]?.txHash ?? "").localeCompare(right[0]?.txHash ?? "");
  });
}

function directCounterpartyEpisodeId(baseId: string, episodeIndex: number): string {
  return episodeIndex === 0 ? baseId : `${baseId}:episode:${episodeIndex}`;
}

function isDirectCounterpartyProfileEdge(edge: AdminForensicsEdge): boolean {
  return edge.metadata.source === "directCounterpartyInteractionProfile" ||
    edge.metadata.source === "senderInteractionProfile" ||
    String(edge.metadata.pathId ?? "").startsWith("path:direct_counterparty:");
}

function reciprocalDirectCounterpartyPairKey(edge: AdminForensicsEdge): string {
  return [edge.fromNodeId, edge.toNodeId].sort().join("|");
}

function annotateReciprocalDirectCounterpartyFlows(edges: AdminForensicsEdge[]): void {
  const edgesByPair = new Map<string, AdminForensicsEdge[]>();
  for (const edge of edges) {
    if (!isDirectCounterpartyProfileEdge(edge)) continue;
    const pairKey = reciprocalDirectCounterpartyPairKey(edge);
    const pairEdges = edgesByPair.get(pairKey) ?? [];
    pairEdges.push(edge);
    edgesByPair.set(pairKey, pairEdges);
  }

  edgesByPair.forEach((pairEdges, pairKey) => {
    const directions = new Set(pairEdges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`));
    if (directions.size < 2) return;

    const reciprocalEdgeIds = pairEdges.map((edge) => edge.id).sort();
    pairEdges.forEach((edge) => {
      edge.metadata = {
        ...edge.metadata,
        reciprocalFlow: true,
        reciprocalPairKey: pairKey,
        reciprocalEdgeIds
      };
    });
  });
}

function compareRawDesc(left: string, right: string): number {
  const leftRaw = rawBigInt(left) ?? 0n;
  const rightRaw = rawBigInt(right) ?? 0n;
  if (leftRaw === rightRaw) return 0;
  return leftRaw > rightRaw ? -1 : 1;
}

function bundleTopFundersFromMembers(members: Record<string, unknown>[]): {
  topFunders: Array<{ address: string; amountRaw: string; txHashes: string[]; memberCount: number }>;
  smallTailAmountRaw: string | null;
  smallTailCount: number;
  funderCount: number;
} {
  const grouped = new Map<string, { amountRaw: bigint; txHashes: string[]; memberCount: number }>();
  members.forEach((member) => {
    const address = stringField(member, "fromAddress");
    if (!address) return;
    const amountRaw = firstString(
      stringField(member, "usedAmountRaw"),
      stringField(member, "coveredAmountRaw"),
      stringField(member, "originalAmountRaw")
    );
    const parsed = rawBigInt(amountRaw);
    const current = grouped.get(address) ?? { amountRaw: 0n, txHashes: [], memberCount: 0 };
    if (parsed !== null) current.amountRaw += parsed;
    const txHash = stringField(member, "txHash");
    if (txHash && !current.txHashes.includes(txHash)) current.txHashes.push(txHash);
    current.memberCount += 1;
    grouped.set(address, current);
  });
  const funders = [...grouped.entries()]
    .map(([address, funder]) => ({
      address,
      amountRaw: funder.amountRaw.toString(),
      txHashes: funder.txHashes,
      memberCount: funder.memberCount
    }))
    .sort((left, right) => compareRawDesc(left.amountRaw, right.amountRaw));
  const topFunders = funders.slice(0, 3);
  const tail = funders.slice(3);
  return {
    topFunders,
    smallTailAmountRaw: sumRaw(tail.map((item) => item.amountRaw)),
    smallTailCount: tail.length,
    funderCount: funders.length
  };
}

function bundleTopFundersFromIncomingFunders(funders: Record<string, unknown>[]): {
  topFunders: Array<{ address: string; amountRaw: string; txHashes: string[]; memberCount: number }>;
  smallTailAmountRaw: string | null;
  smallTailCount: number;
  funderCount: number;
} {
  const allFunders = funders
    .map((funder) => ({
      address: stringField(funder, "address"),
      amountRaw: stringField(funder, "amountRaw"),
      txHashes: stringArrayField(funder, "txHashes")
    }))
    .filter((funder): funder is { address: string; amountRaw: string; txHashes: string[] } =>
      !!funder.address && !!funder.amountRaw)
    .map((funder) => ({ ...funder, memberCount: funder.txHashes.length }))
    .sort((left, right) => compareRawDesc(left.amountRaw, right.amountRaw));
  const topFunders = allFunders.slice(0, 3);
  const tail = allFunders.slice(3);
  return {
    topFunders,
    smallTailAmountRaw: sumRaw(tail.map((item) => item.amountRaw)),
    smallTailCount: tail.length,
    funderCount: allFunders.length
  };
}

function daysBetweenIso(left: string | null, right: string | null): number | null {
  if (!left || !right) return null;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.abs(rightTime - leftTime) / 86_400_000;
}

function stopDisplaySemantics(reason: string | null): StopDisplaySemantics {
  switch (reason) {
    case "incoming_history_not_fetched":
      return {
        category: "data_quality",
        title: "History not fully fetched",
        canvasLabel: "History incomplete",
        meaning: "Fetched incoming history did not reach the required hop time, so source provenance remains unproven.",
        scoreLabel: "Path uncertainty penalty",
        scoreMeaning: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven."
      };
    case "data_budget_exhausted":
      return {
        category: "data_quality",
        title: "Search budget exhausted",
        canvasLabel: "Budget stop",
        meaning: "The trace hit a configured search budget before reaching a terminal source.",
        scoreLabel: "Path uncertainty penalty",
        scoreMeaning: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven."
      };
    case "no_previous_transfer":
      return {
        category: "continuity",
        title: "No prior inbound found",
        canvasLabel: "No prior input",
        meaning: "Fetched history reached the required time, but no earlier inbound USDT transfer was found for this hop.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "no_incoming_transfers_seen":
      return {
        category: "continuity",
        title: "No previous incoming",
        canvasLabel: "No incoming",
        meaning: "Fetched history reached the required time and no inbound USDT transfers were seen.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "incoming_seen_but_below_continuity":
      return {
        category: "continuity",
        title: "Prior inputs do not match",
        canvasLabel: "Inputs mismatch",
        meaning: "Prior inbound transfers exist, but none match amount/time continuity thresholds.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "weak_amount_or_time_continuity":
      return {
        category: "continuity",
        title: "Weak continuity",
        canvasLabel: "Weak continuity",
        meaning: "A possible connection exists, but amount or time continuity is too weak to prove provenance.",
        scoreLabel: "Continuity penalty",
        scoreMeaning: "Prior transfer evidence was absent or did not meet amount/time continuity."
      };
    case "unlabeled_service_boundary":
    case "service_boundary":
      return {
        category: "service_boundary",
        title: "Service boundary",
        canvasLabel: "Service boundary",
        meaning: "The trace reached a service or contract boundary where normal wallet-to-wallet provenance should stop.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached service boundary."
      };
    case "allowlist_cex_reached":
      return {
        category: "terminal_boundary",
        title: "Allowlisted CEX reached",
        canvasLabel: "Allowlisted CEX",
        meaning: "The trace reached a known allowlisted centralized exchange source.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    case "decline_boundary_reached":
      return {
        category: "terminal_boundary",
        title: "Decline boundary reached",
        canvasLabel: "Risk boundary",
        meaning: "The trace reached a policy boundary that can raise risk.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    case "risky_label_reached":
    case "risky_source_wallet":
      return {
        category: "terminal_boundary",
        title: "Risky label reached",
        canvasLabel: "Risky label",
        meaning: "The trace reached a known risky label.",
        scoreLabel: "Boundary contribution",
        scoreMeaning: "This contribution is scoped to the reached terminal boundary."
      };
    default:
      return {
        category: "unknown",
        title: reason ? reason.replace(/_/g, " ") : "Trace stop",
        canvasLabel: "Trace stop",
        meaning: "The trace stopped before reaching a complete provenance source.",
        scoreLabel: "Path contribution",
        scoreMeaning: "This contribution belongs to the stopped path, not to a wallet by itself."
      };
  }
}

function stopDiagnostics(input: {
  path: Record<string, unknown>;
  pathId: string;
  stopReason: string;
  riskContribution: number;
}): Record<string, unknown> {
  const historyCoverage = recordArrayField(input.path, "historyCoverage");
  const latestCoverage = historyCoverage[historyCoverage.length - 1] ?? null;
  const totalFetchedTransferCount = historyCoverage.reduce((sum, coverage) =>
    sum + (numberField(coverage, "fetchedTransferCount") ?? 0), 0);
  const totalFetchedPageCount = historyCoverage.reduce((sum, coverage) =>
    sum + (numberField(coverage, "fetchedPageCount") ?? 0), 0);
  const targetTimestamp = latestCoverage ? stringField(latestCoverage, "targetTimestamp") : null;
  const oldestFetchedTransferAt = latestCoverage ? stringField(latestCoverage, "oldestFetchedTransferAt") : null;
  return {
    stopReason: input.stopReason,
    pathId: input.pathId,
    riskContribution: input.riskContribution,
    reason: stringArrayField(input.path, "reasons")[0] ?? null,
    timeSpanMs: numberField(input.path, "timeSpanMs"),
    amountPreservationRatio: numberField(input.path, "amountPreservationRatio"),
    historyCoverage,
    historyCoverageCount: historyCoverage.length,
    totalFetchedTransferCount,
    hadIncomingTransfers: totalFetchedTransferCount > 0,
    reachedTargetHop: latestCoverage ? latestCoverage["reachedTargetHop"] === true : null,
    historyFullyFetched: booleanField(input.path, "historyFullyFetched"),
    enoughHistoryForHop: booleanField(input.path, "enoughHistoryForHop"),
    targetTimestamp,
    oldestFetchedTransferAt,
    historyDaysChecked: daysBetweenIso(oldestFetchedTransferAt, targetTimestamp),
    historySource: latestCoverage ? stringField(latestCoverage, "source") : null,
    pagesChecked: historyCoverage.length > 0 ? totalFetchedPageCount : null,
    rejectedCandidates: recordArrayField(input.path, "rejectedCandidates").slice(0, 5)
  };
}

function transferBaseLookupKey(txHash: string | null, fromAddress: string | null, toAddress: string | null): string | null {
  return txHash && fromAddress && toAddress ? `${txHash}\u0000${fromAddress}\u0000${toAddress}` : null;
}

function transferAmountLookupKey(
  txHash: string | null,
  fromAddress: string | null,
  toAddress: string | null,
  amountRaw: string | null
): string | null {
  const baseKey = transferBaseLookupKey(txHash, fromAddress, toAddress);
  return baseKey && amountRaw ? `${baseKey}\u0000${amountRaw}` : null;
}

function transferAmountTimestampLookupKey(
  txHash: string | null,
  fromAddress: string | null,
  toAddress: string | null,
  amountRaw: string | null,
  timestamp: string | null
): string | null {
  const amountKey = transferAmountLookupKey(txHash, fromAddress, toAddress, amountRaw);
  return amountKey && timestamp ? `${amountKey}\u0000${timestamp}` : null;
}

function whereIsMoneyResultFromJob(job: ForensicCheckJob): Record<string, unknown> | null {
  if (!isRecord(job.resultJson)) return null;
  const nested = job.resultJson["whereIsMoneyReport"];
  return isRecord(nested) ? nested : job.resultJson;
}

function evidenceRefs(
  allEvidenceIds: string[],
  paths: AdminForensicsPath[],
  edges: AdminForensicsEdge[]
): AdminForensicsEvidenceRef[] {
  const refs = new Map<string, AdminForensicsEvidenceRef>();
  const ensureRef = (id: string): AdminForensicsEvidenceRef => {
    const existing = refs.get(id);
    if (existing) return existing;
    const ref = {
      id,
      source: "raw_evidence",
      label: id,
      nodeIds: [],
      edgeIds: [],
      pathIds: []
    };
    refs.set(id, ref);
    return ref;
  };
  const appendUnique = (target: string[], values: string[]): void => {
    values.forEach((value) => {
      if (!target.includes(value)) target.push(value);
    });
  };

  allEvidenceIds.forEach((id) => ensureRef(id));
  paths.forEach((path) => {
    path.evidenceIds.forEach((evidenceId) => {
      const ref = ensureRef(evidenceId);
      appendUnique(ref.pathIds, [path.id]);
      appendUnique(ref.nodeIds, path.nodeIds);
      appendUnique(ref.edgeIds, path.edgeIds);
    });
  });
  edges.forEach((edge) => {
    edge.evidenceIds.forEach((evidenceId) => {
      const ref = ensureRef(evidenceId);
      appendUnique(ref.edgeIds, [edge.id]);
      appendUnique(ref.nodeIds, [edge.fromNodeId, edge.toNodeId]);
    });
  });

  return Array.from(refs.values());
}

function edgeTimestampMs(edge: AdminForensicsEdge): number | null {
  if (!edge.timestamp) return null;
  const value = new Date(edge.timestamp).getTime();
  return Number.isFinite(value) ? value : null;
}

function appendUniqueValue<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

function addRaw(map: Map<string, bigint>, nodeId: string, amountRaw: string | null): void {
  const parsed = rawBigInt(amountRaw);
  if (parsed === null) return;
  map.set(nodeId, (map.get(nodeId) ?? 0n) + parsed);
}

function textMarker(...values: unknown[]): string {
  return values
    .filter((value) => value !== null && value !== undefined && String(value).length > 0)
    .map((value) => String(value).toLowerCase())
    .join(" ");
}

function nodeDisplayKind(node: AdminForensicsNode): AdminForensicsNodeDisplayKind {
  const marker = textMarker(
    node.kind,
    node.metadata.category,
    node.metadata.serviceCategory,
    node.metadata.serviceType,
    node.metadata.identity,
    node.metadata.sourceExposureKind,
    node.metadata.exposureSourceKey,
    node.metadata.rootSourceType,
    node.metadata.stopReasons
  );

  if (node.kind === "subject") return "subject_wallet";
  if (node.kind === "bundle") return "funding_bundle";
  if (node.kind === "stop") return "trace_stop";
  if (Array.isArray(node.metadata.stopReasons) && node.metadata.stopReasons.length > 0) return "service_boundary";
  if (node.metadata.source === "fastCounterpartyTopsProfile") {
    return fastCheckDisplayKind(stringField(node.metadata, "category"));
  }
  if (marker.includes("bridge")) return "bridge";
  if (marker.includes("cex") || marker.includes("exchange")) return "cex";
  if (marker.includes("adapter")) return "contract_adapter";
  if (marker.includes("router")) return "contract_router";
  if (marker.includes("dex")) return "dex_contract";
  if (marker.includes("contract")) return "smart_contract";
  if (node.kind === "service") return "service_boundary";
  if (node.kind === "contract") return "smart_contract";
  return "wallet";
}

function nodeDisplayLabel(node: AdminForensicsNode): string {
  if (node.kind === "stop") {
    return firstString(
      stringField(node.metadata, "stopCanvasLabel"),
      stringField(node.metadata, "stopTitle"),
      node.label
    ) ?? node.id;
  }
  return firstString(
    stringField(node.metadata, "identity"),
    stringField(node.metadata, "exposureSourceLabel"),
    node.label,
    node.address
  ) ?? node.id;
}

function rawString(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function hasPartialAllocation(edge: AdminForensicsEdge): boolean {
  const original = rawString(edge.metadata.originalAmountRaw);
  const used = rawString(edge.metadata.usedAmountRaw);
  return original !== null && used !== null && original !== used;
}

function physicalTransferAmountRaw(edge: AdminForensicsEdge): string | null {
  return rawString(edge.metadata.originalAmountRaw) ?? edge.amountRaw;
}

function duplicateTransferKey(edge: AdminForensicsEdge): string | null {
  if (!edge.txHash || edge.type === "stop") return null;
  const physicalAmountRaw = physicalTransferAmountRaw(edge);
  if (!physicalAmountRaw) return null;
  const evidenceType = stringField(edge.metadata, "evidenceType");
  let evidenceKey = "";
  if (evidenceType === "contract_driven_transfer") {
    evidenceKey = `:${evidenceType}:${stringField(edge.metadata, "sourceAddress") ?? ""}`;
  } else if (evidenceType === "deepcheck_relationship_second_hop") {
    evidenceKey = `:${[
      stringField(edge.metadata, "source"),
      evidenceType,
      stringField(edge.metadata, "relationship"),
      stringField(edge.metadata, "pathId"),
      stringField(edge.metadata, "pathSourceId")
    ].join(":")}`;
  }
  return `${edge.fromNodeId}->${edge.toNodeId}:${edge.txHash}:${physicalAmountRaw}${evidenceKey}`;
}

function edgeSource(edge: AdminForensicsEdge): string | null {
  return stringField(edge.metadata, "source");
}

function preferDuplicateTransferEdge(
  current: AdminForensicsEdge,
  next: AdminForensicsEdge
): AdminForensicsEdge {
  const currentSource = edgeSource(current);
  const nextSource = edgeSource(next);
  if (nextSource === "approvalDrainProvenanceProfile" && currentSource !== "approvalDrainProvenanceProfile") {
    return next;
  }
  if (currentSource === "approvalDrainProvenanceProfile") return current;
  if (nextSource === "directCounterpartyInteractionProfile" && currentSource !== "directCounterpartyInteractionProfile") {
    return next;
  }
  if (currentSource === "directCounterpartyInteractionProfile") return current;
  if (next.type !== "service_boundary" && current.type === "service_boundary") return next;
  return current;
}

function boundaryContextSnapshot(edge: AdminForensicsEdge): Record<string, unknown> {
  return {
    edgeId: edge.id,
    source: edgeSource(edge),
    pathId: stringField(edge.metadata, "pathId"),
    evidenceType: stringField(edge.metadata, "evidenceType"),
    evidenceTypeLabel: stringField(edge.metadata, "evidenceTypeLabel"),
    evidenceMeaning: stringField(edge.metadata, "evidenceMeaning"),
    boundaryEntityName: stringField(edge.metadata, "boundaryEntityName"),
    boundaryCategoryLabel: stringField(edge.metadata, "boundaryCategoryLabel"),
    category: stringField(edge.metadata, "category"),
    identity: stringField(edge.metadata, "identity"),
    boundaryAddress: stringField(edge.metadata, "boundaryAddress"),
    viaAddress: stringField(edge.metadata, "viaAddress"),
    subjectTxHash: stringField(edge.metadata, "subjectTxHash"),
    boundaryTxHash: stringField(edge.metadata, "boundaryTxHash"),
    aggregateAmountRaw: stringField(edge.metadata, "aggregateAmountRaw"),
    aggregateTransferCount: numberField(edge.metadata, "aggregateTransferCount"),
    underlyingTransfers: recordArrayField(edge.metadata, "underlyingTransfers")
  };
}

function transferAllocationSnapshot(edge: AdminForensicsEdge): Record<string, unknown> {
  return {
    edgeId: edge.id,
    pathId: stringField(edge.metadata, "pathId"),
    originalAmountRaw: rawString(edge.metadata.originalAmountRaw) ?? edge.amountRaw,
    usedAmountRaw: rawString(edge.metadata.usedAmountRaw) ?? edge.amountRaw,
    anchorAmountRaw: rawString(edge.metadata.anchorAmountRaw),
    amountRaw: edge.amountRaw,
    amountShare: edge.amountShare,
    amountRole: stringField(edge.metadata, "amountRole")
  };
}

function transferAllocationDetails(edge: AdminForensicsEdge): Record<string, unknown>[] {
  const existing = recordArrayField(edge.metadata, "allocationDetails");
  if (existing.length > 0) return existing;
  return hasPartialAllocation(edge) ? [transferAllocationSnapshot(edge)] : [];
}

function mergeAllocationDetails(
  target: AdminForensicsEdge,
  duplicate: AdminForensicsEdge
): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  [...transferAllocationDetails(target), ...transferAllocationDetails(duplicate)].forEach((allocation, index) => {
    const key = stringField(allocation, "edgeId") ?? `${stringField(allocation, "pathId") ?? "path"}:${index}`;
    byKey.set(key, allocation);
  });
  return [...byKey.values()];
}

function sumRawFields(items: Record<string, unknown>[], fieldName: string): string | null {
  let total = 0n;
  let found = false;
  for (const item of items) {
    const value = rawString(item[fieldName]);
    if (!value) continue;
    total += BigInt(value);
    found = true;
  }
  return found ? String(total) : null;
}

function mergeTransferEdgeMetadata(
  target: AdminForensicsEdge,
  duplicate: AdminForensicsEdge
): Record<string, unknown> {
  const txHashes = [
    ...stringArrayField(target.metadata, "txHashes"),
    ...stringArrayField(duplicate.metadata, "txHashes"),
    target.txHash,
    duplicate.txHash
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const metadata: Record<string, unknown> = {
    ...target.metadata,
    txHashes: [...new Set(txHashes)]
  };

  if (duplicate.type === "service_boundary" || stringField(duplicate.metadata, "evidenceType") === "boundary_context") {
    metadata.mergedBoundaryContexts = [
      ...recordArrayField(metadata, "mergedBoundaryContexts"),
      boundaryContextSnapshot(duplicate)
    ];
  }

  if (!metadata.aggregateTransferCount) {
    metadata.aggregateTransferCount = numberField(duplicate.metadata, "aggregateTransferCount") ??
      numberField(duplicate.metadata, "txCount") ??
      undefined;
  }
  if (!metadata.aggregateAmountRaw) {
    metadata.aggregateAmountRaw = stringField(duplicate.metadata, "aggregateAmountRaw") ??
      duplicate.amountRaw ??
      undefined;
  }

  const allocations = mergeAllocationDetails(target, duplicate);
  if (allocations.length > 0) {
    const usedAmountRaw = sumRawFields(allocations, "usedAmountRaw");
    const anchorAmountRaw = sumRawFields(allocations, "anchorAmountRaw");
    metadata.allocationDetails = allocations;
    metadata.mergedAllocationEdgeIds = allocations
      .map((allocation) => stringField(allocation, "edgeId"))
      .filter((value): value is string => value !== null);
    metadata.mergedAllocationPathIds = [...new Set(allocations
      .map((allocation) => stringField(allocation, "pathId"))
      .filter((value): value is string => value !== null))];
    metadata.originalAmountRaw = physicalTransferAmountRaw(target) ?? physicalTransferAmountRaw(duplicate) ?? metadata.originalAmountRaw;
    if (usedAmountRaw) metadata.usedAmountRaw = usedAmountRaw;
    if (anchorAmountRaw) metadata.anchorAmountRaw = anchorAmountRaw;
  }

  return metadata;
}

function mergeDuplicateTransferEdges(
  edges: AdminForensicsEdge[],
  paths: AdminForensicsPath[]
): void {
  const byKey = new Map<string, AdminForensicsEdge>();
  const replacements = new Map<string, string>();
  const removeIds = new Set<string>();

  for (const edge of edges) {
    const key = duplicateTransferKey(edge);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, edge);
      continue;
    }

    const keeper = preferDuplicateTransferEdge(current, edge);
    const duplicate = keeper === current ? edge : current;
    keeper.metadata = mergeTransferEdgeMetadata(keeper, duplicate);
    const physicalAmountRaw = physicalTransferAmountRaw(keeper) ?? physicalTransferAmountRaw(duplicate);
    if ((hasPartialAllocation(keeper) || hasPartialAllocation(duplicate)) && physicalAmountRaw) {
      keeper.amountRaw = physicalAmountRaw;
    }
    replacements.set(duplicate.id, keeper.id);
    removeIds.add(duplicate.id);
    byKey.set(key, keeper);
  }

  if (removeIds.size === 0) return;
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    if (removeIds.has(edges[index].id)) edges.splice(index, 1);
  }
  for (const path of paths) {
    path.edgeIds = path.edgeIds.map((edgeId) => replacements.get(edgeId) ?? edgeId);
    if (path.lastRealEdgeId && replacements.has(path.lastRealEdgeId)) {
      path.lastRealEdgeId = replacements.get(path.lastRealEdgeId) ?? path.lastRealEdgeId;
    }
  }
}

function noTxTransferDuplicateKey(edge: AdminForensicsEdge): string | null {
  if (edge.type === "stop" || edge.metadata.bundleRole || edge.metadata.bundleNodeId) return null;
  if (edge.txHash || edge.timestamp || !edge.amountRaw || edgeMetadataTxHashes(edge).length > 0) return null;
  return `${edge.fromNodeId}->${edge.toNodeId}:${edge.amountRaw}`;
}

function realTransferAmountKey(edge: AdminForensicsEdge): string | null {
  if (edge.type === "stop" || !edge.amountRaw) return null;
  if (!edge.txHash && edgeMetadataTxHashes(edge).length === 0) return null;
  return `${edge.fromNodeId}->${edge.toNodeId}:${edge.amountRaw}`;
}

function removeNoTxTransferDuplicates(
  edges: AdminForensicsEdge[],
  paths: AdminForensicsPath[]
): void {
  const realTransferKeys = new Set<string>();
  for (const edge of edges) {
    const key = realTransferAmountKey(edge);
    if (key) realTransferKeys.add(key);
  }
  if (realTransferKeys.size === 0) return;

  const removeIds = new Set<string>();
  for (const edge of edges) {
    const key = noTxTransferDuplicateKey(edge);
    if (key && realTransferKeys.has(key)) removeIds.add(edge.id);
  }
  if (removeIds.size === 0) return;

  for (let index = edges.length - 1; index >= 0; index -= 1) {
    if (removeIds.has(edges[index].id)) edges.splice(index, 1);
  }
  for (const path of paths) {
    path.edgeIds = path.edgeIds.filter((edgeId) => !removeIds.has(edgeId));
    if (path.lastRealEdgeId && removeIds.has(path.lastRealEdgeId)) path.lastRealEdgeId = null;
  }
}

type FundingBundleMemberTransfer = {
  bundleNodeId: string;
  fromNodeId: string;
  toNodeId: string;
  txHashes: Set<string>;
  amountRawValues: Set<string>;
  timestamps: Set<string>;
};

function edgeMetadataTxHashes(edge: AdminForensicsEdge): string[] {
  return [
    edge.txHash,
    ...stringArrayField(edge.metadata, "txHashes"),
    ...recordArrayField(edge.metadata, "underlyingTransfers")
      .map((transfer) => stringField(transfer, "txHash"))
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

const MAX_REASONABLE_PROFILE_CONTEXT_RAW = 1_000_000_000_000_000_000n;

function unreasonableProfileContextAmount(value: string | null): boolean {
  const raw = rawBigInt(value);
  return raw !== null && raw > MAX_REASONABLE_PROFILE_CONTEXT_RAW;
}

function groupedProfileContextDuplicateKey(edge: AdminForensicsEdge): string | null {
  if (edge.type === "stop" || edge.metadata.bundleRole || edge.metadata.bundleNodeId) return null;
  if (stringField(edge.metadata, "evidenceType") !== "grouped_transfers") return null;
  const txHashes = [...new Set(edgeMetadataTxHashes(edge))].sort();
  if (txHashes.length === 0) return null;
  const source = edgeSource(edge) ?? "unknown";
  const amount = firstString(rawString(edge.metadata.aggregateAmountRaw), edge.amountRaw) ?? "";
  return [source, edge.fromNodeId, edge.toNodeId, amount, txHashes.join(",")].join("|");
}

function mergeGroupedProfileContextMetadata(
  target: AdminForensicsEdge,
  duplicate: AdminForensicsEdge
): Record<string, unknown> {
  const txHashes = [...new Set([...edgeMetadataTxHashes(target), ...edgeMetadataTxHashes(duplicate)])];
  const balanceTransferTxHashes = [
    stringField(target.metadata, "balanceTransferTxHash"),
    stringField(duplicate.metadata, "balanceTransferTxHash"),
    ...stringArrayField(target.metadata, "balanceTransferTxHashes"),
    ...stringArrayField(duplicate.metadata, "balanceTransferTxHashes")
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return {
    ...target.metadata,
    txHashes,
    balanceTransferTxHashes: [...new Set(balanceTransferTxHashes)],
    mergedProfileContextEdgeIds: [
      ...stringArrayField(target.metadata, "mergedProfileContextEdgeIds"),
      duplicate.id
    ]
  };
}

function sanitizeApprovalLikeProfileContextAmounts(edges: AdminForensicsEdge[]): void {
  edges.forEach((edge) => {
    if (edgeSource(edge) !== "senderInteractionProfile") return;
    const rawAmount = firstString(rawString(edge.metadata.aggregateAmountRaw), edge.amountRaw);
    if (!unreasonableProfileContextAmount(rawAmount)) return;
    edge.metadata.excludedApprovalLikeAmountRaw = rawAmount;
    edge.metadata.approvalLikeAmountExcluded = true;
    edge.metadata.evidenceType = "profile_context";
    edge.metadata.evidenceTypeLabel = "Grouped wallet interaction context";
    edge.metadata.evidenceMeaning = "This summarized interaction contained an approval-sized allowance value, so the amount is hidden instead of being shown as USDT flow.";
    delete edge.metadata.aggregateAmountRaw;
    edge.amountRaw = null;
  });
}

function dedupeGroupedProfileContextEdges(
  edges: AdminForensicsEdge[],
  paths: AdminForensicsPath[]
): void {
  const byKey = new Map<string, AdminForensicsEdge>();
  const replacements = new Map<string, string>();
  const removeIds = new Set<string>();

  for (const edge of edges) {
    const key = groupedProfileContextDuplicateKey(edge);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, edge);
      continue;
    }
    current.metadata = mergeGroupedProfileContextMetadata(current, edge);
    replacements.set(edge.id, current.id);
    removeIds.add(edge.id);
  }

  if (removeIds.size > 0) {
    for (let index = edges.length - 1; index >= 0; index -= 1) {
      if (removeIds.has(edges[index].id)) edges.splice(index, 1);
    }
    for (const path of paths) {
      path.edgeIds = path.edgeIds.map((edgeId) => replacements.get(edgeId) ?? edgeId);
      if (path.lastRealEdgeId && replacements.has(path.lastRealEdgeId)) {
        path.lastRealEdgeId = replacements.get(path.lastRealEdgeId) ?? path.lastRealEdgeId;
      }
    }
  }

  sanitizeApprovalLikeProfileContextAmounts(edges);
}

function bundleMemberTransferKey(fromNodeId: string, toNodeId: string): string {
  return `${fromNodeId}->${toNodeId}`;
}

function collectFundingBundleMemberTransfers(nodesById: Map<string, AdminForensicsNode>): Map<string, FundingBundleMemberTransfer[]> {
  const byDirectedPair = new Map<string, FundingBundleMemberTransfer[]>();
  const pushTransfer = (transfer: FundingBundleMemberTransfer): void => {
    const key = bundleMemberTransferKey(transfer.fromNodeId, transfer.toNodeId);
    const current = byDirectedPair.get(key) ?? [];
    current.push(transfer);
    byDirectedPair.set(key, current);
  };

  nodesById.forEach((node) => {
    if (node.kind !== "bundle") return;
    const bundleNodeId = node.id;
    const explicitTransfers = recordArrayField(node.metadata, "memberTransfers");
    explicitTransfers.forEach((transfer) => {
      const fromAddress = stringField(transfer, "fromAddress");
      const toAddress = stringField(transfer, "toAddress");
      if (!fromAddress || !toAddress) return;
      const txHash = stringField(transfer, "txHash");
      const amountRaw = stringField(transfer, "amountRaw");
      const timestamp = stringField(transfer, "timestamp");
      pushTransfer({
        bundleNodeId,
        fromNodeId: nodeId(fromAddress),
        toNodeId: nodeId(toAddress),
        txHashes: new Set(txHash ? [txHash] : []),
        amountRawValues: new Set(amountRaw ? [amountRaw] : []),
        timestamps: new Set(timestamp ? [timestamp] : [])
      });
    });

    if (explicitTransfers.length > 0) return;
    const targetAddress = firstString(
      stringField(node.metadata, "hopAddress"),
      stringField(node.metadata, "targetFromAddress")
    );
    if (!targetAddress) return;
    recordArrayField(node.metadata, "topFunders").forEach((funder) => {
      const address = stringField(funder, "address");
      if (!address) return;
      const amountRaw = stringField(funder, "amountRaw");
      pushTransfer({
        bundleNodeId,
        fromNodeId: nodeId(address),
        toNodeId: nodeId(targetAddress),
        txHashes: new Set(stringArrayField(funder, "txHashes")),
        amountRawValues: new Set(amountRaw ? [amountRaw] : []),
        timestamps: new Set()
      });
    });
  });

  return byDirectedPair;
}

function edgeMatchesBundleMemberTransfer(edge: AdminForensicsEdge, transfer: FundingBundleMemberTransfer): boolean {
  const txHashes = edgeMetadataTxHashes(edge);
  if (txHashes.some((txHash) => transfer.txHashes.has(txHash))) return true;

  const edgeAmount = firstString(
    edge.amountRaw,
    rawString(edge.metadata.aggregateAmountRaw),
    rawString(edge.metadata.usedAmountRaw),
    rawString(edge.metadata.originalAmountRaw)
  );
  if (!edgeAmount || !transfer.amountRawValues.has(edgeAmount)) return false;

  const edgeTimestamp = edge.timestamp ?? stringField(edge.metadata, "lastSeen") ?? stringField(edge.metadata, "firstSeen");
  if (transfer.timestamps.size === 0) return txHashes.length === 0;
  if (!edgeTimestamp) return false;
  return transfer.timestamps.has(edgeTimestamp);
}

function suppressFundingBundleDuplicateEdges(
  edges: AdminForensicsEdge[],
  paths: AdminForensicsPath[],
  nodesById: Map<string, AdminForensicsNode>
): void {
  const memberTransfers = collectFundingBundleMemberTransfers(nodesById);
  if (memberTransfers.size === 0) return;

  const removeIds = new Set<string>();
  for (const edge of edges) {
    if (edge.type === "stop" || edge.metadata.bundleRole || edge.metadata.bundleNodeId) continue;
    const transfers = memberTransfers.get(bundleMemberTransferKey(edge.fromNodeId, edge.toNodeId));
    if (!transfers) continue;
    const matched = transfers.find((transfer) => edgeMatchesBundleMemberTransfer(edge, transfer));
    if (!matched) continue;
    removeIds.add(edge.id);
    const bundleNode = nodesById.get(matched.bundleNodeId);
    if (bundleNode) {
      const hiddenEdgeIds = stringArrayField(bundleNode.metadata, "hiddenDuplicateEdgeIds");
      bundleNode.metadata.hiddenDuplicateEdgeIds = [...new Set([...hiddenEdgeIds, edge.id])];
    }
  }
  if (removeIds.size === 0) return;

  for (let index = edges.length - 1; index >= 0; index -= 1) {
    if (removeIds.has(edges[index].id)) edges.splice(index, 1);
  }
  for (const path of paths) {
    path.edgeIds = path.edgeIds.filter((edgeId) => !removeIds.has(edgeId));
    if (path.lastRealEdgeId && removeIds.has(path.lastRealEdgeId)) path.lastRealEdgeId = null;
  }
}

function edgeDisplayRole(edge: AdminForensicsEdge, jobKind: ForensicCheckJob["kind"]): AdminForensicsEdgeDisplayRole {
  const evidenceType = stringField(edge.metadata, "evidenceType");
  if (edge.type === "stop") return "stop";
  if (edge.displayRole === "profile_context") return "profile_context";
  if (edge.type === "approval") return "profile_context";
  if (
    evidenceType === "contract_trigger_context" ||
    evidenceType === "contract_call_context" ||
    evidenceType === "debit_authority_context" ||
    evidenceType === "approval_drain_contract_call" ||
    evidenceType === "approval_drain_spender_authority"
  ) {
    return "profile_context";
  }
  if (
    jobKind === "address_deep_check" &&
    edge.type !== "transfer" &&
    (
      edge.metadata.source === "directCounterpartyInteractionProfile" ||
      String(edge.metadata.pathId ?? "").startsWith("path:direct_counterparty:")
    )
  ) {
    return "profile_context";
  }
  if (jobKind === "address_fast_check" && edge.metadata.source === "fastCounterpartyTopsProfile") {
    return "profile_context";
  }
  if (jobKind === "where_is_money_check" && edge.metadata.source === "senderInteractionProfile") {
    return "profile_context";
  }
  if (
    jobKind === "address_deep_check" &&
    (edge.metadata.source === "boundaryExposureProfile" || edge.metadata.source === "deepExpansionBoundaryStop")
  ) {
    return "profile_context";
  }
  if (hasPartialAllocation(edge)) return "allocated_transfer";
  if (edge.type === "inferred_provenance") return "inferred_provenance";
  return "real_transfer";
}

function lastRealEdgeForPath(edgeIds: string[], edges: AdminForensicsEdge[]): AdminForensicsEdge | null {
  for (let index = edgeIds.length - 1; index >= 0; index -= 1) {
    const edge = edges.find((item) => item.id === edgeIds[index]);
    if (edge && edge.type !== "stop") return edge;
  }
  return null;
}

function stopDisplayMetadata(input: {
  reason: string;
  pathId: string;
  diagnostics: Record<string, unknown>;
  lastRealEdge: AdminForensicsEdge | null;
}): Record<string, unknown> {
  const semantics = stopDisplaySemantics(input.reason);
  return {
    reason: input.reason,
    pathId: input.pathId,
    stopDetails: [input.diagnostics],
    stopCategory: semantics.category,
    stopTitle: semantics.title,
    stopCanvasLabel: semantics.canvasLabel,
    stopMeaning: semantics.meaning,
    scoreLabel: semantics.scoreLabel,
    scoreMeaning: semantics.scoreMeaning,
    stopAmountLabel: "not a transfer",
    historyFullyFetched: booleanField(input.diagnostics, "historyFullyFetched"),
    enoughHistoryForHop: booleanField(input.diagnostics, "enoughHistoryForHop"),
    lastRealEdgeId: input.lastRealEdge?.id ?? null,
    lastRealHopAmountRaw: input.lastRealEdge?.amountRaw ?? null,
    lastRealHopTimestamp: input.lastRealEdge?.timestamp ?? null,
    lastRealHopTxHash: input.lastRealEdge?.txHash ?? null
  };
}

function annotateGraphDerivedMetrics(
  nodesById: Map<string, AdminForensicsNode>,
  edges: AdminForensicsEdge[],
  paths: AdminForensicsPath[],
  weights: AdminForensicsWeight[],
  jobKind: ForensicCheckJob["kind"]
): void {
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const relatedEdgeIdsByNode = new Map<string, string[]>();
  const relatedPathIdsByNode = new Map<string, string[]>();
  const relatedWeightsByNode = new Map<string, AdminForensicsWeight[]>();
  const incomingRawByNode = new Map<string, bigint>();
  const outgoingRawByNode = new Map<string, bigint>();
  const maxRiskByNode = new Map<string, number>();

  edges.forEach((edge) => {
    edge.displayRole = edgeDisplayRole(edge, jobKind);
  });

  const bumpRisk = (nodeId: string | null | undefined, score: number | null | undefined): void => {
    if (!nodeId || score === null || score === undefined || !Number.isFinite(score)) return;
    maxRiskByNode.set(nodeId, Math.max(maxRiskByNode.get(nodeId) ?? 0, score));
  };

  const appendRelatedEdge = (nodeId: string, edgeId: string): void => {
    const related = relatedEdgeIdsByNode.get(nodeId) ?? [];
    appendUniqueValue(related, edgeId);
    relatedEdgeIdsByNode.set(nodeId, related);
  };

  const appendRelatedPath = (nodeId: string, pathId: string): void => {
    const related = relatedPathIdsByNode.get(nodeId) ?? [];
    appendUniqueValue(related, pathId);
    relatedPathIdsByNode.set(nodeId, related);
  };

  edges.forEach((edge) => {
    appendRelatedEdge(edge.fromNodeId, edge.id);
    appendRelatedEdge(edge.toNodeId, edge.id);
    addRaw(outgoingRawByNode, edge.fromNodeId, edge.amountRaw);
    addRaw(incomingRawByNode, edge.toNodeId, edge.amountRaw);
    bumpRisk(edge.fromNodeId, edge.weight);
    bumpRisk(edge.toNodeId, edge.weight);
  });

  paths.forEach((path) => {
    let previousTimestampMs: number | null = null;
    let firstTimestampMs: number | null = null;
    let lastTimestampMs: number | null = null;
    path.nodeIds.forEach((nodeId) => {
      appendRelatedPath(nodeId, path.id);
      if (path.riskContribution > 0) bumpRisk(nodeId, path.riskContribution);
    });
    path.edgeIds.forEach((edgeId) => {
      const edge = edgesById.get(edgeId);
      if (!edge) return;
      appendRelatedPath(edge.fromNodeId, path.id);
      appendRelatedPath(edge.toNodeId, path.id);
      if (path.riskContribution > 0) {
        bumpRisk(edge.fromNodeId, path.riskContribution);
        bumpRisk(edge.toNodeId, path.riskContribution);
      }
      const timestampMs = edgeTimestampMs(edge);
      if (timestampMs === null) return;
      edge.metadata = {
        ...edge.metadata,
        txGapMs: previousTimestampMs === null ? null : Math.abs(timestampMs - previousTimestampMs)
      };
      previousTimestampMs = timestampMs;
      firstTimestampMs = firstTimestampMs === null ? timestampMs : Math.min(firstTimestampMs, timestampMs);
      lastTimestampMs = lastTimestampMs === null ? timestampMs : Math.max(lastTimestampMs, timestampMs);
    });
    path.timeSpanMs = firstTimestampMs !== null && lastTimestampMs !== null
      ? Math.abs(lastTimestampMs - firstTimestampMs)
      : null;
  });

  weights.forEach((weight) => {
    const nodeIds = new Set<string>();
    if (weight.nodeId) nodeIds.add(weight.nodeId);
    if (weight.edgeId) {
      const edge = edgesById.get(weight.edgeId);
      if (edge) {
        nodeIds.add(edge.fromNodeId);
        nodeIds.add(edge.toNodeId);
      }
    }
    if (weight.pathId) {
      paths.find((path) => path.id === weight.pathId)?.nodeIds.forEach((nodeId) => nodeIds.add(nodeId));
    }
    nodeIds.forEach((nodeId) => {
      const related = relatedWeightsByNode.get(nodeId) ?? [];
      related.push(weight);
      relatedWeightsByNode.set(nodeId, related);
      bumpRisk(nodeId, weight.value);
    });
  });

  nodesById.forEach((node, nodeId) => {
    const maxRisk = maxRiskByNode.get(nodeId);
    const incoming = incomingRawByNode.get(nodeId);
    const outgoing = outgoingRawByNode.get(nodeId);
    const relatedEdgeIds = relatedEdgeIdsByNode.get(nodeId) ?? [];
    const relatedPathIds = relatedPathIdsByNode.get(nodeId) ?? [];
    const relatedWeights = relatedWeightsByNode.get(nodeId) ?? [];
    if (node.kind !== "subject" && node.kind !== "stop" && maxRisk !== undefined) {
      node.weight = maxRisk;
      node.riskLevel = riskLevelFromScore(maxRisk);
    }
    node.metadata = {
      ...node.metadata,
      ...(relatedEdgeIds.length > 0 ? { relatedEdgeIds } : {}),
      ...(relatedPathIds.length > 0 ? { relatedPathIds } : {}),
      ...(relatedWeights.length > 0 ? { relatedWeights } : {}),
      ...(incoming !== undefined ? { incomingAmountRaw: incoming.toString() } : {}),
      ...(outgoing !== undefined ? { outgoingAmountRaw: outgoing.toString() } : {})
    };
    node.displayKind = nodeDisplayKind(node);
    node.displayLabel = nodeDisplayLabel(node);
  });
}

function sourceProvenanceMaterialityOutcomeIsScoreValidCaveat(outcome: string | null): boolean {
  return outcome === "residual_unresolved_below_materiality" ||
    outcome === "dense_hop_unresolved_below_materiality";
}

function projectWhereIsMoneyJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const topLevelResult = isRecord(job.resultJson) ? job.resultJson : null;
  const result = whereIsMoneyResultFromJob(job);
  if (!result) {
    return {
      ok: false,
      status: "malformed",
      message: "Forensic graph cannot be projected from malformed job result JSON."
    };
  }

  const assessment = isRecord(result["assessment"]) ? result["assessment"] : {};
  const coverage = isRecord(result["coverage"]) ? result["coverage"] : {};
  const progress = isRecord(job.progressJson) ? job.progressJson : {};
  const resultForStrictStatus = topLevelResult ?? result;
  const sourceProvenanceMateriality =
    recordField(result, "sourceProvenanceMateriality") ??
    recordField(assessment, "sourceProvenanceMateriality");
  const sourceProvenanceMaterialityOutcome = stringField(sourceProvenanceMateriality ?? {}, "outcome");
  const sourceProvenanceMaterialityScoreValidCaveat =
    sourceProvenanceMaterialityOutcomeIsScoreValidCaveat(sourceProvenanceMaterialityOutcome);
  const subjectAddress = stringField(result, "subjectAddress") ?? (topLevelResult ? stringField(topLevelResult, "subjectAddress") : null) ?? job.subjectAddress;
  const riskScore = firstNumber(numberField(result, "riskScore"), numberField(assessment, "riskScore"));
  const confidence = confidenceFromNumber(firstNumber(
    numberField(assessment, "provenanceConfidence"),
    numberField(result, "provenanceConfidence")
  ));
  const coverageRatio = firstNumber(
    numberField(coverage, "coverageRatio"),
    numberField(coverage, "currentBalanceCoverageRatio")
  );
  const originPaths = recordArrayField(result, "originPaths");
  const approvalDrainProvenanceProfiles = recordArrayField(result, "approvalDrainProvenanceProfiles");
  const senderInteractionProfiles = recordArrayField(result, "senderInteractionProfiles");
  const sourceBundleExposure = recordField(result, "sourceBundleExposure");
  const subjectExposureProfile = recordField(result, "subjectExposureProfile");
  const evidenceIds = job.rawEvidenceIds;
  const existingFundingBundleHopTxHashes = new Set<string>();
  originPaths.forEach((path) => {
    recordArrayField(path, "fundingBundles").forEach((bundle) => {
      const hopTxHash = stringField(bundle, "hopTxHash");
      if (hopTxHash) existingFundingBundleHopTxHashes.add(hopTxHash);
    });
  });
  const whereFundingCandidateVisibility = buildWhereFundingCandidateVisibility({
    subjectAddress,
    selectedAmountRaw: stringField(coverage, "selectedAmountRaw"),
    targetAmountRaw: stringField(coverage, "targetAmountRaw"),
    originPaths,
    existingFundingBundleHopTxHashes
  });

  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];
  const limitations: AdminForensicsLimitation[] = [];

  const upsertAddressNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind !== "subject" && kind === "subject") existing.kind = "subject";
      existing.metadata = { ...existing.metadata, ...metadata };
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      label: shortAddress(address),
      riskLevel: kind === "subject" ? riskLevelFromScore(riskScore) : null,
      confidence: kind === "subject" ? confidence : null,
      weight: null,
      metadata
    });
    return id;
  };

  const subjectNodeId = upsertAddressNode(subjectAddress, "subject");

  originPaths.forEach((item, pathIndex) => {
    const pathId = `path:${pathIndex}`;
    const pathEvidenceIds = stringArrayField(item, "evidenceIds");
    const steps = recordArrayField(item, "steps");
    const addresses = stringArrayField(item, "addresses");
    const pathAddresses = stringArrayField(item, "pathAddresses");
    const rootSourceAddress = stringField(item, "rootSourceAddress");
    const addressChain = addresses.length > 0
      ? addresses
      : pathAddresses.length > 0
        ? pathAddresses
        : [
            ...(rootSourceAddress ? [rootSourceAddress] : []),
            ...steps.flatMap((step) => [
              stringField(step, "fromAddress"),
              stringField(step, "toAddress")
            ]).filter((address): address is string => address !== null)
          ];
    const uniqueAddressChain = Array.from(new Set(addressChain.length > 0 ? addressChain : [subjectAddress]));
    const pathNodeIds = uniqueAddressChain.map((address) =>
      upsertAddressNode(address, address === subjectAddress ? "subject" : "wallet")
    );
    if (rootSourceAddress) {
      attachStructuredRootSourceBoundary(nodesById.get(nodeId(rootSourceAddress)), item, rootSourceAddress);
    }
    const txHashes = stringArrayField(item, "txHashes");
    const pathEdgeIds: string[] = [];
    const amountRaw = firstString(stringField(item, "amountRaw"), stringField(item, "selectedAmountRaw"));
    const amountShare = firstNumber(numberField(item, "balanceShare"), numberField(item, "amountShare"));
    const pathAllocatedAmountRaw = firstString(
      stringField(item, "usedAmountRaw"),
      stringField(item, "selectedAmountRaw"),
      allocateRawByShare(firstString(stringField(coverage, "selectedAmountRaw"), stringField(coverage, "targetAmountRaw")), amountShare)
    );
    const verdict = decision(item["verdict"]);
    const riskContribution = numberField(item, "riskScoreContribution") ?? 0;
    const fundingBundles = recordArrayField(item, "fundingBundles");
    const sourceProvenanceItems = recordArrayField(item, "sourceProvenance");
    const fundingBundleByHopTxHash = new Map<string, Record<string, unknown>>();
    const fundingBundleMembersByAmountTimestampKey = new Map<string, Record<string, unknown>[]>();
    const fundingBundleMembersByAmountKey = new Map<string, Record<string, unknown>[]>();
    const fundingBundleMembersByBaseKey = new Map<string, Record<string, unknown>[]>();
    const fundingBundleMembersByTxHash = new Map<string, Record<string, unknown>[]>();
    const bundleNodeIds: string[] = [];
    const appendMember = (
      map: Map<string, Record<string, unknown>[]>,
      key: string | null,
      member: Record<string, unknown>
    ): void => {
      if (!key) return;
      const members = map.get(key) ?? [];
      members.push(member);
      map.set(key, members);
    };
    const singleMember = (members: Record<string, unknown>[] | undefined): Record<string, unknown> | undefined =>
      members?.length === 1 ? members[0] : undefined;
    fundingBundles.forEach((bundle) => {
      const hopTxHash = stringField(bundle, "hopTxHash");
      if (hopTxHash) fundingBundleByHopTxHash.set(hopTxHash, bundle);
      recordArrayField(bundle, "members").forEach((member) => {
        const memberTxHash = stringField(member, "txHash");
        const memberFromAddress = stringField(member, "fromAddress");
        const memberToAddress = stringField(member, "toAddress");
        const memberUsedAmountRaw = firstString(stringField(member, "usedAmountRaw"), stringField(member, "coveredAmountRaw"));
        const memberTimestamp = stringField(member, "timestamp");
        appendMember(
          fundingBundleMembersByAmountTimestampKey,
          transferAmountTimestampLookupKey(memberTxHash, memberFromAddress, memberToAddress, memberUsedAmountRaw, memberTimestamp),
          member
        );
        appendMember(
          fundingBundleMembersByAmountKey,
          transferAmountLookupKey(memberTxHash, memberFromAddress, memberToAddress, memberUsedAmountRaw),
          member
        );
        appendMember(
          fundingBundleMembersByBaseKey,
          transferBaseLookupKey(memberTxHash, memberFromAddress, memberToAddress),
          member
        );
        if (memberTxHash) {
          const members = fundingBundleMembersByTxHash.get(memberTxHash) ?? [];
          members.push(member);
          fundingBundleMembersByTxHash.set(memberTxHash, members);
        }
      });
    });

    const visualFundingBundles = fundingBundles
      .map((bundle, bundleIndex) => {
        const members = recordArrayField(bundle, "members");
        const funderSummary = bundleTopFundersFromMembers(members);
        return { bundle, bundleIndex, members, funderSummary };
      })
      .filter((item) => item.funderSummary.funderCount >= 2);

    if (visualFundingBundles.length > 0) {
      limitations.push({
        code: "multi_input_bundle_used",
        label: "Multi-input bundle used",
        severity: "info",
        pathId,
        explanation: "This path used multiple inbound transfers to explain one outgoing hop."
      });
      visualFundingBundles.forEach(({ bundle, bundleIndex, members, funderSummary }) => {
        const bundleId = bundleNodeId(pathIndex, bundleIndex);
        const hopAddress = stringField(bundle, "hopAddress");
        const hopNodeId = hopAddress
          ? upsertAddressNode(hopAddress, hopAddress === subjectAddress ? "subject" : "wallet")
          : pathNodeIds[pathNodeIds.length - 1] ?? subjectNodeId;
        const hopTxHash = stringField(bundle, "hopTxHash");
        const expectedAmountRaw = stringField(bundle, "expectedAmountRaw");
        const coveredAmountRaw = stringField(bundle, "coveredAmountRaw");
        const relatedEdgeIds: string[] = [];
        const topFunderNodeIds: string[] = [];
        const memberTransfers = members
          .map((member) => ({
            txHash: stringField(member, "txHash"),
            fromAddress: stringField(member, "fromAddress"),
            toAddress: stringField(member, "toAddress"),
            originalAmountRaw: firstString(
              stringField(member, "originalAmountRaw"),
              stringField(member, "usedAmountRaw"),
              stringField(member, "coveredAmountRaw")
            ),
            usedAmountRaw: firstString(
              stringField(member, "usedAmountRaw"),
              stringField(member, "coveredAmountRaw"),
              stringField(member, "originalAmountRaw")
            ),
            amountRaw: firstString(
              stringField(member, "usedAmountRaw"),
              stringField(member, "coveredAmountRaw"),
              stringField(member, "originalAmountRaw")
            ),
            timestamp: stringField(member, "timestamp")
          }))
          .filter((member): member is {
            txHash: string | null;
            fromAddress: string;
            toAddress: string;
            originalAmountRaw: string | null;
            usedAmountRaw: string | null;
            amountRaw: string | null;
            timestamp: string | null;
          } => !!member.fromAddress && !!member.toAddress);

        funderSummary.topFunders.forEach((funder, funderIndex) => {
          const funderNodeId = upsertAddressNode(funder.address, funder.address === subjectAddress ? "subject" : "wallet");
          topFunderNodeIds.push(funderNodeId);
          const edgeId = `edge:${pathIndex}:bundle:${bundleIndex}:funder:${funderIndex}`;
          edges.push({
            id: edgeId,
            fromNodeId: funderNodeId,
            toNodeId: bundleId,
            type: "inferred_provenance",
            amountRaw: funder.amountRaw,
            amountShare: null,
            txHash: null,
            timestamp: null,
            weight: riskContribution,
            verdict: "review",
            evidenceIds: pathEvidenceIds,
            metadata: {
              pathId,
              bundleIndex,
              bundleNodeId: bundleId,
              bundleRole: "top_funder",
              txHashes: funder.txHashes,
              memberCount: funder.memberCount,
              originalAmountRaw: funder.amountRaw,
              usedAmountRaw: funder.amountRaw,
              anchorAmountRaw: expectedAmountRaw,
              amountRole: "bundle_top_funder",
              graphDirection: "funder_to_bundle",
              moneyDirection: "inbound_to_subject",
              direction: "inbound"
            }
          });
          relatedEdgeIds.push(edgeId);
        });

        const bundleHopEdgeId = `edge:${pathIndex}:bundle:${bundleIndex}:hop`;
        edges.push({
          id: bundleHopEdgeId,
          fromNodeId: bundleId,
          toNodeId: hopNodeId,
          type: "inferred_provenance",
          amountRaw: coveredAmountRaw ?? expectedAmountRaw,
          amountShare: numberField(bundle, "coverageRatio"),
          txHash: null,
          timestamp: null,
          weight: riskContribution,
          verdict: "review",
          evidenceIds: pathEvidenceIds,
          metadata: {
            pathId,
            bundleIndex,
            bundleNodeId: bundleId,
            bundleRole: "bundle_to_hop",
            hopTxHash,
            hiddenNodeIds: topFunderNodeIds,
            hiddenEdgeIds: relatedEdgeIds,
            txHashes: [...new Set(memberTransfers.map((member) => member.txHash).filter((value): value is string => value !== null))],
            originalAmountRaw: sumRaw(members.map((member) => firstString(
              stringField(member, "originalAmountRaw"),
              stringField(member, "usedAmountRaw"),
              stringField(member, "coveredAmountRaw")
            )).filter((value): value is string => value !== null)),
            usedAmountRaw: coveredAmountRaw,
            anchorAmountRaw: expectedAmountRaw,
            amountRole: "bundle_coverage",
            graphDirection: "bundle_to_hop",
            moneyDirection: "inbound_to_subject",
            direction: "inbound"
          }
        });
        relatedEdgeIds.push(bundleHopEdgeId);

        nodesById.set(bundleId, {
          id: bundleId,
          address: null,
          kind: "bundle",
          label: "Funding bundle",
          riskLevel: riskLevelFromScore(riskContribution),
          confidence: null,
          weight: riskContribution,
          metadata: {
            pathId,
            relatedPathIds: [pathId],
            relatedEdgeIds,
            bundleIndex,
            bundleKind: "money_origin_funding_bundle",
            hopTxHash,
            hopAddress,
            expectedAmountRaw,
            coveredAmountRaw,
            coverageRatio: numberField(bundle, "coverageRatio"),
            memberCount: funderSummary.funderCount,
            txCount: members.length,
            txHashes: [...new Set(memberTransfers.map((member) => member.txHash).filter((value): value is string => value !== null))],
            memberTransfers,
            funderCount: funderSummary.funderCount,
            topFunders: funderSummary.topFunders,
            smallTailAmountRaw: funderSummary.smallTailAmountRaw,
            smallTailCount: funderSummary.smallTailCount
          }
        });
        bundleNodeIds.push(bundleId);
      });
    }

    sourceProvenanceItems.forEach((sourceProvenance, sourceProvenanceIndex) => {
      const proofClass = stringField(sourceProvenance, "proofClass");
      const targetTxHash = stringField(sourceProvenance, "targetTxHash");
      const amountContinuity = stringField(sourceProvenance, "amountContinuity");
      const stopReason = stringField(sourceProvenance, "stopReason");
      const coverageWindow = isRecord(sourceProvenance["coverageWindow"]) ? sourceProvenance["coverageWindow"] : null;
      const sourceProvenanceMetadata = {
        mode: "source_provenance",
        proofClass,
        amountContinuity,
        coverageWindow,
        stopReason
      };
      if (proofClass === "exact") {
        limitations.push({
          code: "funding_first_exact_source",
          label: "Funding source proven",
          severity: "info",
          pathId,
          explanation: "Funding-first source provenance found an exact covered funding window for this hop."
        });
      } else if (proofClass === "probable") {
        limitations.push({
          code: "funding_first_probable_source",
          label: "Probable funding source",
          severity: "review",
          pathId,
          explanation: "Funding-first source provenance found amount-matching funding, but the coverage window is not exact."
        });
      } else if (proofClass === "service_boundary") {
        limitations.push({
          code: "funding_first_service_boundary",
          label: "Service boundary",
          severity: "info",
          pathId,
          explanation: "Funding-first source provenance reached a service boundary for this hop."
        });
      } else if (proofClass === "unresolved") {
        limitations.push({
          code: "funding_first_unresolved",
          label: "Funding source unresolved",
          severity: "review",
          pathId,
          explanation: "Funding-first source provenance could not prove the source for this hop."
        });
      }
      if (amountContinuity === "broken") {
        limitations.push({
          code: "amount_continuity_broken",
          label: "Amount continuity broken",
          severity: "review",
          pathId,
          explanation: "This hop amount is not coherent with the larger downstream amount being explained."
        });
      }

      const fundingBundle = isRecord(sourceProvenance["fundingBundle"]) ? sourceProvenance["fundingBundle"] : null;
      if (!fundingBundle || (targetTxHash && fundingBundleByHopTxHash.has(targetTxHash))) return;
    });

    whereFundingCandidateVisibility.candidates
      .filter((candidate) => candidate.pathIndex === pathIndex && candidate.shouldRender)
      .forEach((candidate) => {
        const fromNodeId = upsertAddressNode(candidate.fromAddress, candidate.fromAddress === subjectAddress ? "subject" : "wallet");
        const toNodeId = upsertAddressNode(candidate.toAddress, candidate.toAddress === subjectAddress ? "subject" : "wallet");
        const edgeId = `edge:${pathIndex}:where-funding:${candidate.sourceProvenanceIndex}:member:${candidate.memberIndex}`;
        const exactWithTx = candidate.proofClass === "exact" && candidate.txHash !== null;
        edges.push({
          id: edgeId,
          fromNodeId,
          toNodeId,
          type: exactWithTx ? "transfer" : "inferred_provenance",
          displayRole: exactWithTx ? "allocated_transfer" : "inferred_provenance",
          amountRaw: candidate.amountRaw,
          amountShare: candidate.candidateCoverageRatio,
          txHash: candidate.txHash,
          timestamp: candidate.timestamp,
          weight: riskContribution,
          verdict: "review",
          evidenceIds: pathEvidenceIds,
          metadata: whereFundingCandidateEdgeMetadata(candidate, pathId)
        });
      });

    whereFundingCandidateVisibility.groups
      .filter((group) => group.pathIndex === pathIndex)
      .forEach((group) => {
        const hopAddress = group.targetFromAddress;
        const hopNodeId = hopAddress
          ? upsertAddressNode(hopAddress, hopAddress === subjectAddress ? "subject" : "wallet")
          : pathNodeIds[pathNodeIds.length - 1] ?? subjectNodeId;
        const groupNodeId = `bundle:where-funding:${group.pathIndex}:${group.sourceProvenanceIndex}:${group.proofClass}`;
        const edgeId = `edge:${pathIndex}:where-funding-group:${group.sourceProvenanceIndex}:${group.proofClass}`;
        nodesById.set(groupNodeId, {
          id: groupNodeId,
          address: null,
          kind: "bundle",
          displayKind: "funding_bundle",
          displayLabel: "Grouped funding candidates",
          label: "Funding candidates",
          riskLevel: riskLevelFromScore(riskContribution),
          confidence: null,
          weight: riskContribution,
          metadata: {
            source: "where_funding_candidate_visibility",
            whereFundingRole: group.role,
            proofClass: group.proofClass,
            pathId: group.pathId,
            relatedPathIds: [group.pathId],
            relatedEdgeIds: [edgeId],
            targetTxHash: group.targetTxHash,
            targetHopEdgeId: group.targetHopEdgeId,
            targetFromAddress: group.targetFromAddress,
            targetToAddress: group.targetToAddress,
            hiddenCount: group.hiddenCount,
            hiddenCandidateIds: group.hiddenCandidateIds,
            amountRaw: group.amountRaw,
            visibilityReason: group.visibilityReason
          }
        });
        edges.push({
          id: edgeId,
          fromNodeId: groupNodeId,
          toNodeId: hopNodeId,
          type: "inferred_provenance",
          displayRole: "inferred_provenance",
          amountRaw: group.amountRaw,
          amountShare: null,
          txHash: null,
          timestamp: null,
          weight: riskContribution,
          verdict: "review",
          evidenceIds: pathEvidenceIds,
          metadata: whereFundingGroupEdgeMetadata(group, pathId)
        });
      });

    whereFundingCandidateVisibility.caveats
      .filter((caveat) => caveat.pathIndex === pathIndex)
      .forEach((caveat) => {
        const hopAddress = caveat.targetFromAddress;
        const hopNodeId = hopAddress
          ? upsertAddressNode(hopAddress, hopAddress === subjectAddress ? "subject" : "wallet")
          : pathNodeIds[pathNodeIds.length - 1] ?? subjectNodeId;
        const caveatNodeId = `stop:where-funding:${caveat.pathIndex}:${caveat.sourceProvenanceIndex}:${caveat.role}`;
        const edgeId = `edge:${pathIndex}:where-funding-caveat:${caveat.sourceProvenanceIndex}`;
        const serviceBoundary = caveat.role === "service_boundary";
        nodesById.set(caveatNodeId, {
          id: caveatNodeId,
          address: null,
          kind: serviceBoundary ? "service" : "stop",
          displayKind: serviceBoundary ? "service_boundary" : "trace_stop",
          displayLabel: whereFundingCaveatLabel(caveat),
          label: whereFundingCaveatLabel(caveat),
          riskLevel: null,
          confidence: null,
          weight: null,
          metadata: {
            source: "where_funding_candidate_visibility",
            whereFundingRole: caveat.role,
            proofClass: caveat.proofClass,
            pathId: caveat.pathId,
            relatedPathIds: [caveat.pathId],
            relatedEdgeIds: [edgeId],
            targetTxHash: caveat.targetTxHash,
            targetHopEdgeId: caveat.targetHopEdgeId,
            targetFromAddress: caveat.targetFromAddress,
            targetToAddress: caveat.targetToAddress,
            targetTimestamp: caveat.targetTimestamp,
            targetAmountRaw: caveat.targetAmountRaw,
            amountContinuity: caveat.amountContinuity,
            coverageWindow: caveat.coverageWindow,
            stopReason: caveat.stopReason,
            visibilityReason: caveat.visibilityReason
          }
        });
        edges.push({
          id: edgeId,
          fromNodeId: caveatNodeId,
          toNodeId: hopNodeId,
          type: serviceBoundary ? "service_boundary" : "stop",
          displayRole: serviceBoundary ? "inferred_provenance" : "stop",
          amountRaw: null,
          amountShare: null,
          txHash: null,
          timestamp: caveat.targetTimestamp,
          weight: null,
          verdict: "review",
          evidenceIds: pathEvidenceIds,
          metadata: whereFundingCaveatEdgeMetadata(caveat, pathId)
        });
      });

    if (steps.length > 0) {
      steps.forEach((step, stepIndex) => {
        const fromAddress = stringField(step, "fromAddress");
        const toAddress = stringField(step, "toAddress");
        if (!fromAddress || !toAddress) return;
        const fromNodeId = upsertAddressNode(fromAddress, fromAddress === subjectAddress ? "subject" : "wallet");
        const toNodeId = upsertAddressNode(toAddress, toAddress === subjectAddress ? "subject" : "wallet");
        const edgeId = `edge:${pathIndex}:${stepIndex}`;
        const stepTxHash = stringField(step, "txHash") ?? txHashes[stepIndex] ?? null;
        const stepAmountRaw = stringField(step, "amountRaw") ?? amountRaw;
        const stepTimestamp = stringField(step, "timestamp");
        const amountUsage = isRecord(step["amountUsage"]) ? step["amountUsage"] : {};
        const fundingBundle = stepTxHash ? fundingBundleByHopTxHash.get(stepTxHash) : undefined;
        const stepAmountTimestampLookupKey = transferAmountTimestampLookupKey(stepTxHash, fromAddress, toAddress, stepAmountRaw, stepTimestamp);
        const stepAmountLookupKey = transferAmountLookupKey(stepTxHash, fromAddress, toAddress, stepAmountRaw);
        const stepBaseLookupKey = transferBaseLookupKey(stepTxHash, fromAddress, toAddress);
        const fundingBundleMember = singleMember(stepAmountTimestampLookupKey
          ? fundingBundleMembersByAmountTimestampKey.get(stepAmountTimestampLookupKey)
          : undefined)
          ?? singleMember(stepAmountLookupKey ? fundingBundleMembersByAmountKey.get(stepAmountLookupKey) : undefined)
          ?? singleMember(stepBaseLookupKey ? fundingBundleMembersByBaseKey.get(stepBaseLookupKey) : undefined)
          ?? (stepTxHash && fundingBundleMembersByTxHash.get(stepTxHash)?.length === 1
            ? fundingBundleMembersByTxHash.get(stepTxHash)?.[0]
            : undefined);
        edges.push({
          id: edgeId,
          fromNodeId,
          toNodeId,
          type: "transfer",
          amountRaw: stepAmountRaw,
          amountShare,
          txHash: stepTxHash,
          timestamp: stepTimestamp,
          weight: riskContribution,
          verdict: edgeVerdict(item["verdict"]),
          evidenceIds: pathEvidenceIds,
          metadata: {
            pathId,
            originalAmountRaw: stringField(amountUsage, "originalAmountRaw") ?? (fundingBundleMember ? stringField(fundingBundleMember, "originalAmountRaw") : null) ?? stepAmountRaw,
            usedAmountRaw: stringField(amountUsage, "usedAmountRaw")
              ?? (fundingBundleMember ? firstString(stringField(fundingBundleMember, "usedAmountRaw"), stringField(fundingBundleMember, "coveredAmountRaw")) : null)
              ?? (fundingBundle ? stringField(fundingBundle, "coveredAmountRaw") : null)
              ?? pathAllocatedAmountRaw
              ?? stepAmountRaw,
            anchorAmountRaw: stringField(amountUsage, "anchorAmountRaw")
              ?? (fundingBundleMember ? firstString(stringField(fundingBundleMember, "anchorAmountRaw"), stringField(fundingBundleMember, "expectedAmountRaw"), stringField(fundingBundleMember, "coveredAmountRaw")) : null)
              ?? (fundingBundle ? stringField(fundingBundle, "expectedAmountRaw") : null)
              ?? stringField(coverage, "targetAmountRaw"),
            amountRole: stringField(amountUsage, "role") ?? "funding_candidate",
            graphDirection: "path_step",
            moneyDirection: "inbound_to_subject",
            direction: "inbound"
          }
        });
        pathEdgeIds.push(edgeId);
      });
    } else {
      for (let index = 0; index < uniqueAddressChain.length - 1; index += 1) {
        const edgeId = `edge:${pathIndex}:${index}`;
        const fallbackOriginalAmountRaw = stringField(item, "originalAmountRaw") ?? amountRaw;
        const fallbackUsedAmountRaw = pathAllocatedAmountRaw ?? amountRaw;
        const fallbackAnchorAmountRaw = stringField(item, "anchorAmountRaw") ?? stringField(coverage, "targetAmountRaw");
        edges.push({
          id: edgeId,
          fromNodeId: nodeId(uniqueAddressChain[index]),
          toNodeId: nodeId(uniqueAddressChain[index + 1]),
          type: "transfer",
          amountRaw,
          amountShare,
          txHash: txHashes[index] ?? null,
          timestamp: null,
          weight: riskContribution,
          verdict: edgeVerdict(item["verdict"]),
          evidenceIds: pathEvidenceIds,
          metadata: {
            pathId,
            originalAmountRaw: fallbackOriginalAmountRaw,
            usedAmountRaw: fallbackUsedAmountRaw,
            anchorAmountRaw: fallbackAnchorAmountRaw,
            amountRole: stringField(item, "amountRole") ?? "funding_candidate",
            graphDirection: "path_step",
            moneyDirection: "inbound_to_subject",
            direction: "inbound"
          }
        });
        pathEdgeIds.push(edgeId);
      }
    }

    const stoppedReason = stringField(item, "stoppedReason");
    let stoppedAtNodeId: string | null = null;
    let stopReasonLabel: string | null = null;
    let stopCategory: AdminForensicsStopCategory | null = null;
    let lastRealEdgeId: string | null = null;
    if (stoppedReason) {
      const diagnostics = stopDiagnostics({ path: item, pathId, stopReason: stoppedReason, riskContribution });
      const lastRealEdge = lastRealEdgeForPath(pathEdgeIds, edges);
      const stopMetadataBase = stopDisplayMetadata({
        reason: stoppedReason,
        pathId,
        diagnostics,
        lastRealEdge
      });
      const sourceProvenanceCaveatStop =
        sourceProvenanceMaterialityScoreValidCaveat && stoppedReason === "incoming_history_not_fetched";
      const stopSemantics = sourceProvenanceCaveatStop
        ? sourceProvenanceMaterialityOutcome === "dense_hop_unresolved_below_materiality"
          ? {
              category: "data_quality" as const,
              title: "Dense hop caveat",
              canvasLabel: "Dense hop caveat",
              meaning: "Dense hop caveat: this dense-hop source was not fully proven, but the unresolved amount is below materiality and is shown as a caveat.",
              scoreLabel: "Dense hop caveat",
              scoreMeaning: "This is not a terminal coverage failure for the job-level score."
            }
          : {
              category: "data_quality" as const,
              title: "Residual source caveat",
              canvasLabel: "Residual caveat",
              meaning: "This residual source was not fully proven, but the unresolved amount is below materiality and is shown as a caveat.",
              scoreLabel: "Residual caveat",
              scoreMeaning: "This is not a terminal coverage failure for the job-level score."
            }
        : stopDisplaySemantics(stoppedReason);
      const stopMetadata = sourceProvenanceCaveatStop
        ? {
            ...stopMetadataBase,
            stopTitle: stopSemantics.title,
            stopCanvasLabel: stopSemantics.canvasLabel,
            stopMeaning: stopSemantics.meaning,
            scoreLabel: stopSemantics.scoreLabel,
            scoreMeaning: stopSemantics.scoreMeaning,
            ...(sourceProvenanceMaterialityOutcome === "dense_hop_unresolved_below_materiality"
              ? { denseHopUnresolvedBelowMateriality: true }
              : { residualUnresolvedBelowMateriality: true })
          }
        : stopMetadataBase;
      stopReasonLabel = stopSemantics.title;
      stopCategory = stopSemantics.category;
      lastRealEdgeId = lastRealEdge?.id ?? null;
      stoppedAtNodeId = stopNodeId(pathIndex, stoppedReason);
      nodesById.set(stoppedAtNodeId, {
        id: stoppedAtNodeId,
        address: null,
        kind: "stop",
        label: stoppedReason,
        riskLevel: riskLevelFromScore(riskContribution),
        confidence: null,
        weight: riskContribution,
        metadata: stopMetadata
      });
      const priorNodeId = pathNodeIds[pathNodeIds.length - 1] ?? subjectNodeId;
      const edgeId = `edge:${pathIndex}:stop`;
      edges.push({
        id: edgeId,
        fromNodeId: priorNodeId,
        toNodeId: stoppedAtNodeId,
        type: "stop",
        amountRaw: null,
        amountShare: null,
        txHash: null,
        timestamp: null,
        weight: riskContribution,
        verdict: edgeVerdict(item["verdict"]),
        evidenceIds: pathEvidenceIds,
        metadata: stopMetadata
      });
      pathEdgeIds.push(edgeId);
      limitations.push({
        code: stoppedReason,
        label: stopSemantics.title,
        severity: verdict === "DECLINE" ? "blocking" : "review",
        pathId,
        explanation: `Origin path stopped at ${stoppedReason}; fetched ${diagnostics.totalFetchedTransferCount} prior transfer(s), history source ${diagnostics.historySource ?? "n/a"}.`
      });
      if (stoppedReason === "no_previous_transfer") {
        limitations.push({
          code: "legacy_no_previous_transfer",
          label: "Legacy no_previous_transfer stop",
          severity: "review",
          pathId,
          explanation: "Old reports used no_previous_transfer for several conditions. Rerun recommended for precise stop classification."
        });
        if (diagnostics.hadIncomingTransfers === true) {
          limitations.push({
            code: "previous_transfers_found_but_not_matching",
            label: "Previous transfers found but not matching",
            severity: "review",
            pathId,
            explanation: `Prior incoming transfers were found (${diagnostics.totalFetchedTransferCount}), but none met the amount/time continuity threshold.`
          });
        }
      }
      if (stoppedReason === "incoming_seen_but_below_continuity") {
        limitations.push({
          code: "previous_transfers_found_but_not_matching",
          label: "Previous transfers found but not matching",
          severity: "review",
          pathId,
          explanation: `Prior incoming transfers were found (${diagnostics.totalFetchedTransferCount}), but none met the amount/time continuity threshold.`
        });
      }
    }

    weights.push({
      id: `weight:${pathIndex}:risk`,
      source: "origin_path",
      label: "Path risk contribution",
      value: riskContribution,
      direction: riskContribution > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: stoppedAtNodeId,
      edgeId: pathEdgeIds[0] ?? null,
      explanation: stringArrayField(item, "reasons")[0] ?? "Origin path risk contribution.",
      metadata: {}
    });
    paths.push({
      id: pathId,
      nodeIds: stoppedAtNodeId ? [...pathNodeIds, ...bundleNodeIds, stoppedAtNodeId] : [...pathNodeIds, ...bundleNodeIds],
      edgeIds: pathEdgeIds,
      verdict,
      riskContribution,
      amountRaw,
      amountShare,
      stoppedAtNodeId,
      stopReason: stoppedReason,
      stopReasonLabel,
      stopCategory,
      lastRealEdgeId,
      evidenceIds: pathEvidenceIds
    });
  });

  const addSenderInteractionCounterparties = (
    profile: Record<string, unknown>,
    profileIndex: number,
    counterparties: Record<string, unknown>[],
    direction: "incoming" | "outgoing"
  ): void => {
    const senderAddress = stringField(profile, "senderAddress");
    if (!senderAddress) return;
    const senderNodeId = upsertAddressNode(senderAddress, senderAddress === subjectAddress ? "subject" : "wallet", {
      source: "senderInteractionProfile"
    });
    const profileEvidenceIds = stringArrayField(profile, "evidenceIds");
    counterparties.forEach((counterparty, counterpartyIndex) => {
      const counterpartyAddress = stringField(counterparty, "address") ?? stringField(counterparty, "counterpartyAddress");
      if (!counterpartyAddress) return;
      const txHashes = stringArrayField(counterparty, "txHashes");
      const txCount = firstNumber(numberField(counterparty, "txCount"), txHashes.length > 0 ? txHashes.length : null);
      if (txCount === null || txCount <= 1) return;

      const counterpartyNodeId = upsertAddressNode(
        counterpartyAddress,
        counterpartyAddress === subjectAddress ? "subject" : "wallet",
        {
          source: "senderInteractionProfile",
          profileSenderAddress: senderAddress,
          txCount,
          volumeRaw: stringField(counterparty, "volumeRaw"),
          firstSeen: stringField(counterparty, "firstSeen"),
          lastSeen: stringField(counterparty, "lastSeen")
        }
      );
      const fromNodeId = direction === "incoming" ? counterpartyNodeId : senderNodeId;
      const toNodeId = direction === "incoming" ? senderNodeId : counterpartyNodeId;
      const pathId = `path:where_sender_interaction:${profileIndex}:${direction}:${counterpartyIndex}`;
      const edgeId = `edge:where_sender_interaction:${profileIndex}:${direction}:${counterpartyIndex}`;
      const amountRaw = stringField(counterparty, "volumeRaw");
      const timestamp = firstString(stringField(counterparty, "lastSeen"), stringField(counterparty, "firstSeen"));
      const evidenceIdsForEdge = profileEvidenceIds.length > 0 ? profileEvidenceIds : evidenceIds;

      edges.push({
        id: edgeId,
        fromNodeId,
        toNodeId,
        type: "inferred_provenance",
        amountRaw,
        amountShare: null,
        txHash: null,
        timestamp,
        weight: null,
        verdict: "review",
        evidenceIds: evidenceIdsForEdge,
        metadata: {
          source: "senderInteractionProfile",
          pathId,
          profileSenderAddress: senderAddress,
          direction: direction === "incoming" ? "counterparty -> profile wallet" : "profile wallet -> counterparty",
          evidenceType: "grouped_transfers",
          evidenceTypeLabel: "Grouped wallet interaction transfers",
          txHashes,
          txCount,
          aggregateTransferCount: txCount,
          aggregateAmountRaw: amountRaw,
          firstSeen: stringField(counterparty, "firstSeen"),
          lastSeen: stringField(counterparty, "lastSeen"),
          balanceTransferTxHash: stringField(profile, "balanceTransferTxHash"),
          relationshipRole: "sender_interaction_context"
        }
      });
      paths.push({
        id: pathId,
        nodeIds: [fromNodeId, toNodeId],
        edgeIds: [edgeId],
        verdict: "UNKNOWN",
        riskContribution: 0,
        amountRaw,
        amountShare: null,
        stoppedAtNodeId: null,
        stopReason: null,
        evidenceIds: evidenceIdsForEdge
      });
    });
  };

  senderInteractionProfiles.forEach((profile, profileIndex) => {
    addSenderInteractionCounterparties(
      profile,
      profileIndex,
      recordArrayField(profile, "topIncomingCounterparties"),
      "incoming"
    );
    addSenderInteractionCounterparties(
      profile,
      profileIndex,
      recordArrayField(profile, "topOutgoingCounterparties"),
      "outgoing"
    );
  });

  if (originPaths.length === 0 && !hasTargetedProviderCapTerminal(progress, resultForStrictStatus)) {
    const pathId = "path:where:no_graphable_origin_path";
    const stopId = "stop:where:no_graphable_origin_path";
    const edgeId = "edge:where:no_graphable_origin_path";
    const syntheticDecision = decision(result["decision"] ?? assessment["decision"]) !== "UNKNOWN"
      ? decision(result["decision"] ?? assessment["decision"])
      : summaryDecisionFromRisk(riskScore);
    const riskContribution = riskScore ?? 0;
    const explanation = stringArrayField(assessment, "warnings")[0] ??
      stringArrayField(assessment, "reasons")[0] ??
      "Where-is-money finished with no graphable origin path.";
    const stopMetadata = {
      reason: "no_graphable_origin_path",
      lastStopReason: "No balance-forming transfers",
      stopCategory: "data_quality",
      stopTitle: "No balance-forming transfers",
      stopCanvasLabel: "No origin path",
      selectedAmountRaw: stringField(coverage, "selectedAmountRaw"),
      targetAmountRaw: stringField(coverage, "targetAmountRaw"),
      coverageRatio: numberField(coverage, "coverageRatio"),
      anchorCoverageRatio: numberField(coverage, "anchorCoverageRatio"),
      episodeCoverageRatio: numberField(coverage, "episodeCoverageRatio")
    };

    nodesById.set(stopId, {
      id: stopId,
      address: null,
      kind: "stop",
      displayKind: "trace_stop",
      displayLabel: "No balance-forming transfers",
      label: "No balance-forming transfers",
      riskLevel: riskLevelFromScore(riskContribution),
      confidence: null,
      weight: riskContribution,
      metadata: stopMetadata
    });
    edges.push({
      id: edgeId,
      fromNodeId: subjectNodeId,
      toNodeId: stopId,
      type: "stop",
      displayRole: "stop",
      amountRaw: null,
      amountShare: null,
      txHash: null,
      timestamp: null,
      weight: riskContribution,
      verdict: edgeVerdict(syntheticDecision),
      evidenceIds: [],
      metadata: stopMetadata
    });
    paths.push({
      id: pathId,
      nodeIds: [subjectNodeId, stopId],
      edgeIds: [edgeId],
      verdict: syntheticDecision,
      riskContribution,
      amountRaw: stringField(coverage, "selectedAmountRaw"),
      amountShare: numberField(coverage, "coverageRatio"),
      stoppedAtNodeId: stopId,
      stopReason: "no_graphable_origin_path",
      stopReasonLabel: "No balance-forming transfers",
      stopCategory: "data_quality",
      lastRealEdgeId: null,
      evidenceIds: []
    });
    weights.push({
      id: "weight:where:no_graphable_origin_path",
      code: "where_origin_paths_missing",
      source: "where_is_money",
      label: "No graphable origin path",
      value: riskContribution,
      direction: riskContribution > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: stopId,
      edgeId,
      explanation,
      metadata: stopMetadata
    });
    limitations.push({
      code: "where_origin_paths_missing",
      label: "Where-is-money has no graphable origin path",
      severity: "review",
      pathId,
      explanation
    });
  }

  recordArrayField(assessment, "sourcePolicyEvidence").forEach((evidence, index) => {
    const score = numberField(evidence, "score") ?? 0;
    weights.push({
      id: `weight:source_policy:${index}`,
      source: "source_policy",
      label: stringField(evidence, "kind") ?? "Source policy",
      value: score,
      direction: score >= 45 ? "raises_risk" : "context",
      pathId: null,
      nodeId: subjectNodeId,
      edgeId: null,
      explanation: stringArrayField(evidence, "reasons")[0] ?? "Source-policy amount-weighted contribution.",
      metadata: sourcePolicyEvidenceMetadata(evidence)
    });
  });
  addSourceBundleExposureWeights({
    weights,
    limitations,
    nodeId: subjectNodeId,
    mode: "where",
    exposure: sourceBundleExposure
  });
  addSubjectExposureProfileWeights({
    weights,
    limitations,
    nodeId: subjectNodeId,
    mode: "where",
    profile: subjectExposureProfile
  });
  attachWeakSubjectExposureServiceHints(nodesById, subjectExposureProfile);
  attachNodeRelatedLimitations(nodesById, subjectNodeId, limitations, [
    "source_bundle_budget_exhausted",
    "source_bundle_unresolved_boundary",
    "subject_exposure_context_not_source_proof"
  ]);
  if (sourceProvenanceMaterialityScoreValidCaveat) {
    const amountUsdt = numberField(sourceProvenanceMateriality ?? {}, "unresolvedAmountUsdt");
    const checkedShare = numberField(sourceProvenanceMateriality ?? {}, "unresolvedShareOfCheckedBalance");
    const shareText = checkedShare !== null ? ` / ${shareLabel(checkedShare)} of checked balance` : "";
    if (sourceProvenanceMaterialityOutcome === "dense_hop_unresolved_below_materiality") {
      limitations.push({
        code: "dense_hop_unresolved_source",
        label: "Dense hop caveat",
        severity: "info",
        pathId: null,
        explanation: `Dense hop caveat: dense-hop unresolved source ${amountUsdt ?? "unknown"} USDT${shareText}; below relative materiality, shown as a caveat rather than a terminal coverage block.`
      });
    } else {
      limitations.push({
        code: "residual_unresolved_source",
        label: "Residual unresolved source",
        severity: "info",
        pathId: null,
        explanation: `Residual unresolved source ${amountUsdt ?? "unknown"} USDT${shareText}; below materiality, shown as a caveat rather than a terminal coverage block.`
      });
    }
  }

  dedupeGroupedProfileContextEdges(edges, paths);
  mergeDuplicateTransferEdges(edges, paths);
  suppressFundingBundleDuplicateEdges(edges, paths, nodesById);
  removeNoTxTransferDuplicates(edges, paths);
  annotateReciprocalDirectCounterpartyFlows(edges);
  attachApprovalDrainProvenanceNodeIntelligence(nodesById, approvalDrainProvenanceProfiles);
  annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);
  const summaryDecision = decision(result["decision"] ?? assessment["decision"]);
  const riskClarity = buildRiskClaritySummary({
    kind: job.kind,
    executionStatus: riskClarityExecutionStatus(summary.status),
    finalRiskScore: riskScore,
    explicitDecision: summaryDecision,
    missingChecks: stringArrayFromUnknown(result["missingChecks"]),
    coveragePartial: summary.status === "partial" || coverage["partial"] === true,
    fetchedAddressCount: numberField(coverage, "fetchedAddressCount"),
    hardEvidenceObserved: hardEvidenceObserved(result, assessment),
    evidenceHints: evidenceHintsFromResult(result, assessment)
  });
  const strictProvenance = strictProvenanceSummary(progress, resultForStrictStatus);
  const targetedIndex = targetedIndexSummary(progress, resultForStrictStatus);
  const strictBenchmarkMetrics = strictBenchmarkMetricsSummary(progress);
  const storedLayerSummary = recordField(result, "layerSummary");
  const layerSummary = storedLayerSummary || strictProvenance || targetedIndex || strictBenchmarkMetrics || sourceProvenanceMateriality || whereFundingCandidateVisibility.summary
    ? {
        ...(storedLayerSummary ?? {}),
        strictProvenance,
        targetedIndex,
        strictBenchmarkMetrics,
        sourceProvenanceMateriality,
        whereFundingCandidateVisibility: whereFundingCandidateVisibility.summary
      }
    : null;

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: summaryDecision,
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        riskClarity,
        confidence,
        coverageRatio,
        checkedScope: stringField(coverage, "checkedScope"),
        anchorCoverageRatio: numberField(coverage, "anchorCoverageRatio"),
        episodeCoverageRatio: numberField(coverage, "episodeCoverageRatio"),
        drainEpisode: recordField(coverage, "drainEpisode"),
        layerSummary,
        contractDrivenCampaign: null,
        selectedAmountRaw: stringField(coverage, "selectedAmountRaw"),
        targetAmountRaw: stringField(coverage, "targetAmountRaw"),
        topReasons: stringArrayField(assessment, "reasons")
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: evidenceRefs(evidenceIds, paths, edges)
    }
  };
}

function whereFundingCandidateEdgeMetadata(
  candidate: WhereFundingCandidateItem,
  pathId: string
): Record<string, unknown> {
  return {
    source: "where_funding_candidate_visibility",
    whereFundingRole: candidate.role,
    evidenceType: candidate.role,
    evidenceTypeLabel: candidate.role === "exact_funding_candidate"
      ? "Exact funding candidate"
      : "Probable funding context",
    pathId,
    sourceProvenanceIndex: candidate.sourceProvenanceIndex,
    memberIndex: candidate.memberIndex,
    candidateRank: candidate.candidateRank,
    proofClass: candidate.proofClass,
    targetTxHash: candidate.targetTxHash,
    targetHopEdgeId: candidate.targetHopEdgeId,
    targetFromAddress: candidate.targetFromAddress,
    targetToAddress: candidate.targetToAddress,
    targetTimestamp: candidate.targetTimestamp,
    candidateCoverageRatio: candidate.candidateCoverageRatio,
    amountContinuity: candidate.amountContinuity,
    coverageWindow: candidate.coverageWindow,
    stopReason: candidate.stopReason,
    visibilityReason: candidate.visibilityReason,
    sourceProvenance: {
      mode: "source_provenance",
      proofClass: candidate.proofClass,
      amountContinuity: candidate.amountContinuity,
      coverageWindow: candidate.coverageWindow,
      stopReason: candidate.stopReason
    },
    originalAmountRaw: candidate.originalAmountRaw,
    usedAmountRaw: candidate.usedAmountRaw,
    anchorAmountRaw: candidate.anchorAmountRaw,
    amountRole: candidate.role,
    graphDirection: "source_to_hop",
    moneyDirection: "inbound_to_subject",
    direction: "inbound"
  };
}

function whereFundingGroupEdgeMetadata(
  group: WhereFundingCandidateGroup,
  pathId: string
): Record<string, unknown> {
  return {
    source: "where_funding_candidate_visibility",
    whereFundingRole: group.role,
    evidenceType: group.role,
    evidenceTypeLabel: "Grouped funding candidates",
    pathId,
    sourceProvenanceIndex: group.sourceProvenanceIndex,
    proofClass: group.proofClass,
    targetTxHash: group.targetTxHash,
    targetHopEdgeId: group.targetHopEdgeId,
    targetFromAddress: group.targetFromAddress,
    targetToAddress: group.targetToAddress,
    hiddenCount: group.hiddenCount,
    hiddenCandidateIds: group.hiddenCandidateIds,
    visibilityReason: group.visibilityReason,
    amountRole: "grouped_candidate_tail",
    graphDirection: "group_to_hop",
    moneyDirection: "context",
    direction: "context"
  };
}

function whereFundingCaveatEdgeMetadata(
  caveat: WhereFundingCandidateCaveat,
  pathId: string
): Record<string, unknown> {
  return {
    source: "where_funding_candidate_visibility",
    whereFundingRole: caveat.role,
    evidenceType: caveat.role,
    evidenceTypeLabel: whereFundingCaveatLabel(caveat),
    pathId,
    sourceProvenanceIndex: caveat.sourceProvenanceIndex,
    proofClass: caveat.proofClass,
    targetTxHash: caveat.targetTxHash,
    targetHopEdgeId: caveat.targetHopEdgeId,
    targetFromAddress: caveat.targetFromAddress,
    targetToAddress: caveat.targetToAddress,
    targetTimestamp: caveat.targetTimestamp,
    targetAmountRaw: caveat.targetAmountRaw,
    amountContinuity: caveat.amountContinuity,
    coverageWindow: caveat.coverageWindow,
    stopReason: caveat.stopReason,
    visibilityReason: caveat.visibilityReason,
    amountRole: caveat.role,
    graphDirection: "caveat_to_hop",
    moneyDirection: "context",
    direction: "context"
  };
}

function whereFundingCaveatLabel(caveat: WhereFundingCandidateCaveat): string {
  if (caveat.role === "pre_existing_balance_caveat") return "Pre-existing balance caveat";
  if (caveat.role === "service_boundary") return "Service boundary";
  return "Unresolved source caveat";
}

function projectWhereTargetedIndexProgressJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const progress = isRecord(job.progressJson) ? job.progressJson : {};
  const result = isRecord(job.resultJson) ? job.resultJson : {};
  const targetedIndex = targetedIndexSummary(progress, result);
  const targetedHistory = targetedHistorySummary(progress);
  const phase = targetedIndex ? stringField(targetedIndex, "phase") : stringField(progress, "jobPhase");
  const checkingCandidateWindows = phase === "checking_candidate_windows";
  const waitingAddress = targetedIndex ? stringField(targetedIndex, "waitingForAddress") : null;
  const waitingTargetTimestamp = targetedIndex ? stringField(targetedIndex, "waitingForTargetTimestamp") : null;
  const subjectAddress = job.subjectAddress;
  const subjectNodeId = nodeId(subjectAddress);
  const progressCode = checkingCandidateWindows ? "checking_candidate_windows" : "waiting_for_targeted_index";
  const progressLabel = checkingCandidateWindows ? "Checking candidate windows" : "Waiting for targeted history";
  const waitNodeId = waitingAddress ? nodeId(waitingAddress) : `stop:where:${progressCode}`;
  const edgeId = `edge:where:${progressCode}`;
  const pathId = `path:where:${progressCode}`;
  const explanation = checkingCandidateWindows
    ? "Checking candidate windows before broad targeted fallback. Final score is pending until candidate windows complete and Where re-runs funding provenance."
    : "Waiting for targeted history, not stuck. Final score is pending until required hop coverage completes.";

  const subjectNode: AdminForensicsNode = {
    id: subjectNodeId,
    address: subjectAddress,
    kind: "subject",
    displayKind: "subject_wallet",
    displayLabel: "Subject wallet",
    label: subjectAddress,
    riskLevel: null,
    confidence: null,
    weight: null,
    metadata: { source: "where_targeted_index_progress" }
  };
  const waitNode: AdminForensicsNode = waitingAddress
    ? {
        id: waitNodeId,
        address: waitingAddress,
        kind: "wallet",
        displayKind: "wallet",
        displayLabel: progressLabel,
        label: waitingAddress,
        riskLevel: null,
        confidence: null,
        weight: null,
        metadata: {
          source: "where_targeted_index_progress",
          targetTimestamp: waitingTargetTimestamp
        }
      }
    : {
        id: waitNodeId,
        address: null,
        kind: "stop",
        displayKind: "trace_stop",
        displayLabel: progressLabel,
        label: progressLabel,
        riskLevel: null,
        confidence: null,
        weight: null,
        metadata: {
          source: "where_targeted_index_progress"
        }
      };
  const riskClarity = buildRiskClaritySummary({
    kind: job.kind,
    executionStatus: summary.status === "running" ? "running" : "queued",
    finalRiskScore: null,
    explicitDecision: "UNKNOWN",
    missingChecks: [progressCode],
    coveragePartial: true,
    hardEvidenceObserved: false,
    evidenceHints: [checkingCandidateWindows ? "checking candidate windows" : "waiting for targeted history"]
  });
  const layerSummary = {
    targetedIndex,
    targetedHistory
  };

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: "UNKNOWN",
        riskScore: null,
        riskLevel: null,
        riskClarity,
        confidence: null,
        coverageRatio: null,
        checkedScope: checkingCandidateWindows ? "candidate_window_indexing" : "targeted_history_indexing",
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary,
        contractDrivenCampaign: null,
        selectedAmountRaw: null,
        targetAmountRaw: null,
        topReasons: [explanation]
      },
      nodes: [subjectNode, waitNode],
      edges: [{
        id: edgeId,
        fromNodeId: waitingAddress ? waitNodeId : subjectNodeId,
        toNodeId: waitingAddress ? subjectNodeId : waitNodeId,
        type: waitingAddress ? "inferred_provenance" : "stop",
        displayRole: "profile_context",
        amountRaw: null,
        amountShare: null,
        txHash: null,
        timestamp: waitingTargetTimestamp,
        weight: null,
        verdict: "unknown",
        evidenceIds: [],
        metadata: {
          source: "where_targeted_index_progress",
          progressOnly: true,
          waitingForAddress: waitingAddress,
          targetTimestamp: waitingTargetTimestamp
        }
      }],
      paths: [{
        id: pathId,
        nodeIds: waitingAddress ? [waitNodeId, subjectNodeId] : [subjectNodeId, waitNodeId],
        edgeIds: [edgeId],
        verdict: "UNKNOWN",
        riskContribution: 0,
        amountRaw: null,
        amountShare: null,
        stoppedAtNodeId: waitNodeId,
        stopReason: progressCode,
        stopReasonLabel: progressLabel,
        stopCategory: "data_quality",
        lastRealEdgeId: null,
        evidenceIds: []
      }],
      weights: [],
      limitations: [{
        code: progressCode,
        label: progressLabel,
        severity: "info",
        pathId,
        explanation
      }],
      evidence: []
    }
  };
}

function projectAddressDeepJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const result = isRecord(job.resultJson) ? job.resultJson : null;
  if (!result) {
    return {
      ok: false,
      status: "malformed",
      message: "Forensic graph cannot be projected from malformed job result JSON."
    };
  }

  const subjectAddress = stringField(result, "subjectAddress") ?? job.subjectAddress;
  const coverage = isRecord(result["coverage"]) ? result["coverage"] : {};
  const coverageDebugRaw = result["coverageDebug"];
  const hasCoverageDebug = isRecord(coverageDebugRaw);
  const coverageDebug: Record<string, unknown> = hasCoverageDebug ? coverageDebugRaw : {};
  const legacyCoverageDebugLimitation = hasCoverageDebug ? null : "Legacy job has no coverage debug object";
  const counterpartyProfiles = recordArrayField(result, "counterpartyRiskProfiles");
  const directCounterpartyProfiles = recordArrayField(result, "directCounterpartyInteractionProfiles");
  const inboundProfiles = recordArrayField(result, "inboundProvenanceProfiles");
  const boundaryProfiles = recordArrayField(result, "boundaryExposureProfiles");
  const serviceProfiles = recordArrayField(result, "serviceExposureProfiles");
  const walletRoleProfiles = recordArrayField(result, "walletRoleProfiles");
  const approvalDrainProvenanceProfiles = recordArrayField(result, "approvalDrainProvenanceProfiles");
  const extendedProfiles = recordArrayField(result, "extendedProvenanceProfiles");
  const secondLayerProfile = recordField(result, "secondLayerRelationshipProfiles");
  const stopReasonRecords = recordArrayField(result, "stopReasons");
  const boundaryStopRecords = recordArrayField(result, "boundaryStops");
  const assessment = isRecord(result["assessment"]) ? result["assessment"] : {};

  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];
  const limitations: AdminForensicsLimitation[] = [];
  const profileContextScores: number[] = [];
  const serviceBoundaryAddresses = new Set<string>();
  const contractDrivenDirectTransferKeys = new Set<string>();
  const contractDrivenAddressAmountKeys = new Set<string>();
  const contractDrivenAddressPairAmounts = new Map<string, string[]>();
  recordArrayField(result, "contractDrivenTransferProfiles").forEach((profile) => {
    if (contractDrivenProfileLooksPlainUsdtTransfer(profile)) return;
    const sourceAddress = firstString(
      stringField(profile, "sourceAddress"),
      stringField(profile, "victimAddress"),
      stringField(profile, "fromAddress"),
      stringField(profile, "source"),
      stringField(profile, "victim")
    );
    const receiverAddress = firstString(
      stringField(profile, "receiverAddress"),
      stringField(profile, "toAddress"),
      stringField(profile, "receiver"),
      subjectAddress
    );
    const amountRaw = stringField(profile, "amountRaw");
    const key = contractDrivenTransferDuplicateKey(stringField(profile, "txHash"), sourceAddress, receiverAddress, amountRaw);
    if (key) contractDrivenDirectTransferKeys.add(key);
    const addressAmountKey = contractDrivenAddressAmountDuplicateKey(sourceAddress, receiverAddress, amountRaw);
    if (addressAmountKey) contractDrivenAddressAmountKeys.add(addressAmountKey);
    const pairKey = contractDrivenAddressPairKey(sourceAddress, receiverAddress);
    if (pairKey && amountRaw) {
      const amounts = contractDrivenAddressPairAmounts.get(pairKey) ?? [];
      amounts.push(amountRaw);
      contractDrivenAddressPairAmounts.set(pairKey, amounts);
    }
  });
  contractDrivenAddressPairAmounts.forEach((amounts, pairKey) => {
    const totalAmountRaw = sumRaw(amounts);
    if (totalAmountRaw) contractDrivenAddressAmountKeys.add(`${pairKey}:${totalAmountRaw}`);
  });
  const isContractDrivenDirectDuplicate = (
    txHash: string | null,
    fromAddress: string | null,
    toAddress: string | null,
    amountRaw: string | null
  ): boolean => {
    const key = contractDrivenTransferDuplicateKey(txHash, fromAddress, toAddress, amountRaw);
    return key !== null && contractDrivenDirectTransferKeys.has(key);
  };
  const isContractDrivenExtendedPathDuplicate = (
    txHash: string | null,
    fromAddress: string | null,
    toAddress: string | null,
    amountRaw: string | null
  ): boolean => Boolean(txHash && (
    isContractDrivenDirectDuplicate(txHash, fromAddress, toAddress, amountRaw) ||
    isContractDrivenDirectDuplicate(txHash, toAddress, fromAddress, amountRaw)
  ));
  const isContractDrivenProfileContextDuplicate = (
    fromAddress: string | null,
    toAddress: string | null,
    amountRaw: string | null
  ): boolean => {
    const key = contractDrivenAddressAmountDuplicateKey(fromAddress, toAddress, amountRaw);
    return key !== null && contractDrivenAddressAmountKeys.has(key);
  };
  serviceProfiles.forEach((profile) => {
    const profileAddress = stringField(profile, "serviceAddress") ?? stringField(profile, "address");
    if (profileAddress) serviceBoundaryAddresses.add(profileAddress);
    recordArrayField(profile, "topServiceCounterparties").forEach((counterparty) => {
      const address = stringField(counterparty, "address");
      if (address) serviceBoundaryAddresses.add(address);
    });
    recordArrayField(profile, "topMergedServiceFlows").forEach((flow) => {
      const address = stringField(flow, "serviceAddress");
      if (address) serviceBoundaryAddresses.add(address);
    });
  });

  const upsertNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind !== "subject" && kind === "subject") existing.kind = "subject";
      existing.metadata = { ...existing.metadata, ...metadata };
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      label: shortAddress(address),
      riskLevel: null,
      confidence: null,
      weight: null,
      metadata
    });
    return id;
  };

  const subjectNodeId = upsertNode(subjectAddress, "subject");

  stopReasonRecords.forEach((stop, index) => {
    const reason = stringField(stop, "reason") ?? stringField(stop, "stopReason") ?? stringField(stop, "stoppedReason");
    if (!reason) return;
    const stopAddress = stringField(stop, "address") ?? stringField(stop, "walletAddress");
    const pathId = stringField(stop, "pathId") ?? `path:deep_stop:${index}`;
    const riskContribution = firstNumber(
      numberField(stop, "riskContribution"),
      numberField(stop, "riskScoreContribution"),
      numberField(stop, "score")
    ) ?? 0;
    const diagnostics = {
      stopReason: reason,
      pathId,
      riskContribution,
      reason: stringField(stop, "message") ?? stringField(stop, "detail"),
      historyFullyFetched: booleanField(stop, "historyFullyFetched"),
      enoughHistoryForHop: booleanField(stop, "enoughHistoryForHop")
    };
    const metadata = {
      ...stopDisplayMetadata({ reason, pathId, diagnostics, lastRealEdge: null }),
      source: "stopReasons",
      stopPosition: "deep_check_boundary",
      address: stopAddress
    };
    const stopId = `stop:deep:${index}:${reason}`;
    nodesById.set(stopId, {
      id: stopId,
      address: stopAddress,
      kind: "stop",
      label: reason,
      riskLevel: riskLevelFromScore(riskContribution),
      confidence: null,
      weight: riskContribution,
      metadata
    });
  });

  boundaryStopRecords.forEach((stop, index) => {
    const reason = stringField(stop, "reason") ?? stringField(stop, "stopReason") ?? stringField(stop, "stoppedReason");
    if (!reason) return;
    const pathId = stringField(stop, "pathId") ?? `path:boundary_stop:${index}`;
    const riskContribution = firstNumber(
      numberField(stop, "riskContribution"),
      numberField(stop, "riskScoreContribution"),
      numberField(stop, "score")
    ) ?? 0;
    const evidenceIds = stringArrayField(stop, "evidenceIds");
    const txHash = stringField(stop, "txHash");
    const amountRaw = stringField(stop, "amountRaw");
    const timestamp = stringField(stop, "timestamp") ?? stringField(stop, "firstTransferAt") ?? stringField(stop, "lastTransferAt");
    const transferRows = recordArrayField(stop, "underlyingTransfers");
    const underlyingTransfers = transferRows.length > 0
      ? transferRows
      : txHash
        ? [boundaryUnderlyingTransfer({ txHash, amountRaw, timestamp, role: "boundary_stop" })].filter((item): item is Record<string, unknown> => item !== null)
        : [];
    const contextOnly = booleanField(stop, "boundaryContextOnly") === true && underlyingTransfers.length === 0 && !txHash;
    const diagnostics = {
      stopReason: reason,
      pathId,
      riskContribution,
      reason: stringField(stop, "message") ?? stringField(stop, "detail") ?? stringField(stop, "label"),
      historyFullyFetched: booleanField(stop, "historyFullyFetched"),
      enoughHistoryForHop: booleanField(stop, "enoughHistoryForHop")
    };
    const stopMetadata: Record<string, unknown> = {
      ...stopDisplayMetadata({ reason, pathId, diagnostics, lastRealEdge: null }),
      source: "boundaryStops",
      stopPosition: "deep_check_boundary",
      stopReasons: [reason]
    };
    const stopId = `stop:boundary:${index}:${reason}`;
    nodesById.set(stopId, {
      id: stopId,
      address: null,
      kind: "stop",
      label: stringField(stop, "label") ?? reason,
      riskLevel: riskLevelFromScore(riskContribution),
      confidence: null,
      weight: riskContribution,
      metadata: stopMetadata
    });

    const edgeId = `edge:boundary_stop:${index}`;
    edges.push({
      id: edgeId,
      fromNodeId: stopId,
      toNodeId: subjectNodeId,
      type: "service_boundary",
      amountRaw: contextOnly ? null : amountRaw,
      amountShare: numberField(stop, "amountShare"),
      txHash: contextOnly ? null : txHash,
      timestamp: contextOnly ? null : timestamp,
      weight: riskContribution,
      verdict: "review",
      evidenceIds,
      metadata: {
        ...stopMetadata,
        source: "deepExpansionBoundaryStop",
        evidenceType: contextOnly ? "boundary_context_only" : stringField(stop, "evidenceType") ?? "boundary_context",
        evidenceTypeLabel: contextOnly ? "Investigation stop" : stringField(stop, "label") ?? "Boundary context",
        evidenceMeaning: contextOnly ? BOUNDARY_CONTEXT_ONLY_MEANING : "DeepCheck recorded boundary stop context.",
        meaning: contextOnly ? BOUNDARY_CONTEXT_ONLY_MEANING : undefined,
        boundaryContextOnly: contextOnly,
        underlyingTransfers: contextOnly ? [] : underlyingTransfers,
        pathId
      }
    });
    paths.push({
      id: pathId,
      nodeIds: [stopId, subjectNodeId],
      edgeIds: [edgeId],
      verdict: "UNKNOWN",
      riskContribution,
      amountRaw: contextOnly ? null : amountRaw,
      amountShare: numberField(stop, "amountShare"),
      stoppedAtNodeId: stopId,
      stopReason: reason,
      stopReasonLabel: stringField(stop, "label"),
      stopCategory: stopMetadata.stopCategory as AdminForensicsStopCategory,
      lastRealEdgeId: null,
      evidenceIds
    });
  });

  counterpartyProfiles.forEach((profile, index) => {
    const counterpartyAddress = stringField(profile, "counterpartyAddress") ?? stringField(profile, "address");
    if (!counterpartyAddress) return;

    const rawScore = numberField(profile, "score");
    const score = rawScore ?? 0;
    if (rawScore !== null) profileContextScores.push(rawScore);
    const profileEvidenceIds = stringArrayField(profile, "evidenceIds");
    const label = stringField(profile, "label");
    const direction = stringField(profile, "direction");
    const counterpartyNodeId = upsertNode(counterpartyAddress, "wallet", {
      label,
      direction,
      score,
      localRiskProfile: {
        localRisk: rawScore,
        source: "DeepCheck",
        sourceMode: "counterpartyRiskProfiles",
        scope: "observed graph",
        relationshipType: direction ?? "observed counterparty",
        reason: label ?? "Counterparty profile context.",
        amountShare: numberField(profile, "amountShare"),
        hopDistance: numberField(profile, "hopDistance"),
        freshness: firstString(stringField(profile, "timestamp"), stringField(profile, "lastSeen"), stringField(profile, "firstSeen"))
      }
    });
    const fromNodeId = direction === "outbound" ? subjectNodeId : counterpartyNodeId;
    const toNodeId = direction === "outbound" ? counterpartyNodeId : subjectNodeId;
    const fromAddress = direction === "outbound" ? subjectAddress : counterpartyAddress;
    const toAddress = direction === "outbound" ? counterpartyAddress : subjectAddress;
    const amountRaw = stringField(profile, "amountRaw");
    const txHash = stringField(profile, "txHash");
    if (
      isContractDrivenDirectDuplicate(txHash, fromAddress, toAddress, amountRaw) ||
      (!txHash && isContractDrivenProfileContextDuplicate(fromAddress, toAddress, amountRaw))
    ) {
      return;
    }
    const pathId = `path:counterparty:${index}`;
    const edgeId = `edge:counterparty:${index}`;

    edges.push({
      id: edgeId,
      fromNodeId,
      toNodeId,
      type: "inferred_provenance",
      amountRaw,
      amountShare: numberField(profile, "amountShare"),
      txHash,
      timestamp: stringField(profile, "timestamp"),
      weight: rawScore,
      verdict: edgeVerdict(profile["verdict"]),
      evidenceIds: profileEvidenceIds,
      metadata: {
        label: stringField(profile, "label"),
        direction
      }
    });
    paths.push({
      id: pathId,
      nodeIds: [fromNodeId, toNodeId],
      edgeIds: [edgeId],
      verdict: decision(profile["verdict"]),
      riskContribution: score,
      amountRaw,
      amountShare: numberField(profile, "amountShare"),
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds: profileEvidenceIds
    });
    if (rawScore !== null) {
      weights.push({
        id: `weight:counterparty:${index}`,
        source: "counterparty_risk_profile",
        label: stringField(profile, "label") ?? "Counterparty risk profile",
        value: score,
        direction: score > 0 ? "raises_risk" : "context",
        pathId,
        nodeId: counterpartyNodeId,
        edgeId,
        explanation: stringField(profile, "label") ?? "Counterparty risk profile.",
        metadata: {}
      });
    }
  });

  directCounterpartyProfiles.forEach((profile, index) => {
    const counterpartyAddress = stringField(profile, "counterpartyAddress") ?? stringField(profile, "address");
    if (!counterpartyAddress) return;

    const rawScore = firstNumber(numberField(profile, "scoreContribution"), numberField(profile, "interactionWeight"));
    const score = rawScore ?? 0;
    if (rawScore !== null) profileContextScores.push(rawScore);
    const profileEvidenceIds = stringArrayField(profile, "evidenceIds");
    const direction = stringField(profile, "direction");
    const counterpartyNodeId = upsertNode(counterpartyAddress, "wallet", {
      source: "directCounterpartyInteractionProfile",
      direction,
      volumeRaw: stringField(profile, "volumeRaw"),
      volumeRatio: numberField(profile, "volumeRatio"),
      txCount: numberField(profile, "txCount"),
      evidenceClass: stringField(profile, "evidenceClass"),
      skippedReason: stringField(profile, "skippedReason"),
      serviceCategory: stringField(profile, "serviceCategory"),
      identity: stringField(profile, "identity"),
      localRiskProfile: {
        localRisk: rawScore,
        source: "DeepCheck",
        sourceMode: "directCounterpartyInteractionProfiles",
        scope: "observed graph",
        relationshipType: direction ?? "direct counterparty interaction",
        reason: firstString(stringField(profile, "evidenceClass"), stringField(profile, "skippedReason")) ?? "Observed direct counterparty interaction.",
        amountShare: numberField(profile, "volumeRatio"),
        txCount: numberField(profile, "txCount"),
        freshness: firstString(stringField(profile, "lastSeen"), stringField(profile, "firstSeen"))
      }
    });
    const counterpartyNode = nodesById.get(counterpartyNodeId);
    if (counterpartyNode && rawScore !== null) {
      counterpartyNode.weight = score;
      counterpartyNode.riskLevel = riskLevelFromScore(score);
    }

    const fromNodeId = direction === "inbound" ? counterpartyNodeId : subjectNodeId;
    const toNodeId = direction === "inbound" ? subjectNodeId : counterpartyNodeId;
    const basePathId = `path:direct_counterparty:${index}`;
    const baseEdgeId = `edge:direct_counterparty:${index}`;
    const txHashes = stringArrayField(profile, "txHashes");
    const txCount = numberField(profile, "txCount");
    const volumeRaw = stringField(profile, "volumeRaw");
    const serviceBoundaryContext = stringField(profile, "evidenceClass") === "service_boundary_context" ||
      stringField(profile, "skippedReason") === "service_boundary_context" ||
      stringField(profile, "serviceCategory") !== null ||
      serviceBoundaryAddresses.has(counterpartyAddress);
    const storedTransfers = recordArrayField(profile, "transfers")
      .map((transfer, transferIndex) => {
        const txHash = stringField(transfer, "txHash") ?? txHashes[transferIndex] ?? null;
        const transferFrom = stringField(transfer, "fromAddress") ?? (direction === "inbound" ? counterpartyAddress : subjectAddress);
        const transferTo = stringField(transfer, "toAddress") ?? (direction === "inbound" ? subjectAddress : counterpartyAddress);
        const amountRaw = stringField(transfer, "amountRaw");
        const timestamp = stringField(transfer, "timestamp");
        if (!txHash || !transferFrom || !transferTo || !amountRaw || !timestamp) return null;
        return {
          txHash,
          fromAddress: transferFrom,
          toAddress: transferTo,
          amountRaw,
          timestamp,
          method: stringField(transfer, "method"),
          edgeType: stringField(transfer, "edgeType"),
          evidenceType: stringField(transfer, "evidenceType") ?? "direct_counterparty_transfer"
        };
      })
      .filter((transfer): transfer is {
        txHash: string;
        fromAddress: string;
        toAddress: string;
        amountRaw: string;
        timestamp: string;
        method: string | null;
        edgeType: string | null;
        evidenceType: string;
      } => transfer !== null);
    const projectedStoredTransfers = storedTransfers.filter((transfer) => {
      const key = contractDrivenTransferDuplicateKey(
        transfer.txHash,
        transfer.fromAddress,
        transfer.toAddress,
        transfer.amountRaw
      );
      return !key || !contractDrivenDirectTransferKeys.has(key);
    });
    if (storedTransfers.length > 0 && projectedStoredTransfers.length === 0) return;
    const profileOnlyContractDrivenKey = txHashes.length === 1 && txCount === 1
      ? contractDrivenTransferDuplicateKey(
        txHashes[0] ?? null,
        direction === "inbound" ? counterpartyAddress : subjectAddress,
        direction === "inbound" ? subjectAddress : counterpartyAddress,
        volumeRaw
      )
      : null;
    if (storedTransfers.length === 0 && profileOnlyContractDrivenKey && contractDrivenDirectTransferKeys.has(profileOnlyContractDrivenKey)) {
      return;
    }
    const storedTransferEpisodes = directCounterpartyTransferEpisodes({
      transfers: projectedStoredTransfers,
      direction,
      evidenceClass: stringField(profile, "evidenceClass"),
      skippedReason: stringField(profile, "skippedReason")
    });
    const episodeCount = storedTransferEpisodes.length > 0 ? storedTransferEpisodes.length : 1;

    for (let episodeIndex = 0; episodeIndex < episodeCount; episodeIndex += 1) {
      const episodeTransfers = storedTransferEpisodes[episodeIndex] ?? [];
      const hasStoredEpisode = episodeTransfers.length > 0;
      const pathId = directCounterpartyEpisodeId(basePathId, episodeIndex);
      const edgeId = directCounterpartyEpisodeId(baseEdgeId, episodeIndex);
      const firstTransfer = episodeTransfers[0];
      const lastTransfer = episodeTransfers[episodeTransfers.length - 1];
      const episodeFromNodeId = firstTransfer
        ? upsertNode(firstTransfer.fromAddress, firstTransfer.fromAddress === subjectAddress ? "subject" : "wallet")
        : fromNodeId;
      const episodeToNodeId = firstTransfer
        ? upsertNode(firstTransfer.toAddress, firstTransfer.toAddress === subjectAddress ? "subject" : "wallet")
        : toNodeId;
      const aggregateTransferCount = hasStoredEpisode ? episodeTransfers.length : txCount;
      const aggregateAmountRaw = hasStoredEpisode ? sumRaw(episodeTransfers.map((transfer) => transfer.amountRaw)) : volumeRaw;
      const hasGroupedEvidence = aggregateTransferCount !== null && aggregateTransferCount > 1;
      const episodeTxHashes = hasStoredEpisode ? episodeTransfers.map((transfer) => transfer.txHash) : txHashes;
      const aggregateTimestamp = hasStoredEpisode
        ? firstString(lastTransfer?.timestamp ?? null, firstTransfer?.timestamp ?? null)
        : firstString(stringField(profile, "lastSeen"), stringField(profile, "firstSeen"));
      const walletTransferGroup = hasGroupedEvidence && !serviceBoundaryContext;
      const walletTransferEvidenceType = hasStoredEpisode && !serviceBoundaryContext
        ? (walletTransferGroup ? "grouped_transfers" : "direct_counterparty_transfer")
        : undefined;
      const episodeTxHash = aggregateTransferCount === 1 ||
        (!hasStoredEpisode && aggregateTransferCount === null && episodeTxHashes.length === 1)
        ? (episodeTxHashes[0] ?? null)
        : null;

      edges.push({
        id: edgeId,
        fromNodeId: episodeFromNodeId,
        toNodeId: episodeToNodeId,
        type: "inferred_provenance",
        amountRaw: aggregateAmountRaw,
        amountShare: numberField(profile, "volumeRatio"),
        txHash: episodeTxHash,
        timestamp: aggregateTimestamp,
        weight: rawScore,
        verdict: score > 0 ? "review" : "unknown",
        evidenceIds: profileEvidenceIds,
        metadata: {
          source: "directCounterpartyInteractionProfile",
          pathId,
          direction,
          txHashes: episodeTxHashes,
          txCount: aggregateTransferCount,
          evidenceType: walletTransferEvidenceType,
          evidenceTypeLabel: walletTransferGroup ? "Grouped direct counterparty transfers" : undefined,
          aggregateTransferCount: walletTransferGroup ? aggregateTransferCount : undefined,
          aggregateAmountRaw: walletTransferGroup ? aggregateAmountRaw : undefined,
          underlyingTransfers: hasStoredEpisode ? episodeTransfers : undefined,
          evidenceClass: stringField(profile, "evidenceClass"),
          skippedReason: stringField(profile, "skippedReason")
        }
      });
      paths.push({
        id: pathId,
        nodeIds: [episodeFromNodeId, episodeToNodeId],
        edgeIds: [edgeId],
        verdict: score > 0 ? "REVIEW" : "UNKNOWN",
        riskContribution: score,
        amountRaw: aggregateAmountRaw,
        amountShare: numberField(profile, "volumeRatio"),
        stoppedAtNodeId: null,
        stopReason: null,
        evidenceIds: profileEvidenceIds
      });
      if (rawScore !== null) {
        weights.push({
          id: directCounterpartyEpisodeId(`weight:direct_counterparty:${index}`, episodeIndex),
          source: "direct_counterparty_interaction",
          label: stringField(profile, "evidenceClass") ?? "Direct counterparty interaction",
          value: score,
          direction: score > 0 ? "raises_risk" : "context",
          pathId,
          nodeId: counterpartyNodeId,
          edgeId,
          explanation: stringField(profile, "evidenceClass") ?? "Direct counterparty interaction context.",
          metadata: {}
        });
      }
    }
  });

  inboundProfiles.forEach((profile, profileIndex) => {
    const rawProfileScore = numberField(profile, "score");
    const profileScore = rawProfileScore ?? 0;
    recordArrayField(profile, "paths").forEach((path, pathIndex) => {
      const sourceAddress = stringField(path, "sourceAddress");
      if (!sourceAddress) return;
      if (rawProfileScore !== null) profileContextScores.push(rawProfileScore);
      const viaAddresses = stringArrayField(path, "viaAddresses");
      const addressChain = [sourceAddress, ...viaAddresses, subjectAddress];
      const pathId = `path:inbound_provenance:${profileIndex}:${pathIndex}`;
      const pathNodeIds = addressChain.map((address) =>
        upsertNode(address, address === subjectAddress ? "subject" : "wallet", {
          source: "inboundProvenanceProfile",
          label: stringField(path, "label")
        })
      );
      const txHashes = stringArrayField(path, "txHashes");
      const pathEdgeIds: string[] = [];

      for (let edgeIndex = 0; edgeIndex < addressChain.length - 1; edgeIndex += 1) {
        const edgeId = `edge:inbound_provenance:${profileIndex}:${pathIndex}:${edgeIndex}`;
        edges.push({
          id: edgeId,
          fromNodeId: pathNodeIds[edgeIndex],
          toNodeId: pathNodeIds[edgeIndex + 1],
          type: "inferred_provenance",
          amountRaw: stringField(path, "amountRaw"),
          amountShare: numberField(path, "amountPreservationRatio"),
          txHash: txHashes[edgeIndex] ?? null,
          timestamp: edgeIndex === 0 ? stringField(path, "firstTransferAt") : stringField(path, "lastTransferAt"),
          weight: profileScore,
          verdict: profileScore > 0 ? "review" : "unknown",
          evidenceIds: stringArrayField(path, "evidenceIds"),
          metadata: {
            source: "inboundProvenanceProfile",
            pathId,
            label: stringField(path, "label"),
            amountPreservationRatio: numberField(path, "amountPreservationRatio")
          }
        });
        pathEdgeIds.push(edgeId);
      }

      paths.push({
        id: pathId,
        nodeIds: pathNodeIds,
        edgeIds: pathEdgeIds,
        verdict: profileScore > 0 ? "REVIEW" : "UNKNOWN",
        riskContribution: profileScore,
        amountRaw: stringField(path, "amountRaw"),
        amountShare: numberField(path, "amountPreservationRatio"),
        stoppedAtNodeId: null,
        stopReason: null,
        evidenceIds: stringArrayField(path, "evidenceIds")
      });
      weights.push({
        id: `weight:inbound_provenance:${profileIndex}:${pathIndex}`,
        source: "inbound_provenance",
        label: stringField(path, "label") ?? "Inbound provenance",
        value: profileScore,
        direction: profileScore > 0 ? "raises_risk" : "context",
        pathId,
        nodeId: pathNodeIds[0] ?? null,
        edgeId: pathEdgeIds[0] ?? null,
        explanation: stringField(path, "label") ?? "Inbound provenance path.",
        metadata: {}
      });
    });
  });

  extendedProfiles.forEach((profile, profileIndex) => {
    const direction = stringField(profile, "direction");
    const profileScore = numberField(profile, "score") ?? 0;
    recordArrayField(profile, "paths").forEach((path, pathIndex) => {
      const addressChain = deepCheckPathAddresses(path, subjectAddress);
      if (addressChain.length < 2) return;

      const txHashes = stringArrayField(path, "txHashes");
      const amountRaw = stringField(path, "amountRaw");
      const duplicatesContractDrivenTransfer = addressChain.some((fromAddress, edgeIndex) => {
        const toAddress = addressChain[edgeIndex + 1] ?? null;
        return isContractDrivenExtendedPathDuplicate(txHashes[edgeIndex] ?? null, fromAddress, toAddress, amountRaw);
      });
      if (duplicatesContractDrivenTransfer) return;

      const depth = deepCheckPathDepth(path, addressChain);
      const stopReason = deepCheckPathStopReason(path);
      const stopSemantics = stopReason ? stopDisplaySemantics(stopReason) : null;
      const pathScore = firstNumber(numberField(path, "candidateScore"), numberField(path, "score"), profileScore);
      if (pathScore !== null) profileContextScores.push(pathScore);
      const evidenceStrength = stringField(path, "evidenceStrength");
      const label = stringField(path, "label");
      const pathId = `path:extended_provenance:${profileIndex}:${pathIndex}`;
      const evidenceIds = stringArrayField(path, "evidenceIds");
      const pathNodeIds = addressChain.map((address, addressIndex) => {
        const finalStopNode = stopReason && addressIndex === addressChain.length - 1;
        return upsertNode(address, address === subjectAddress ? "subject" : "wallet", {
          ...(address === subjectAddress
            ? {}
            : {
              source: "deepcheck_extended_path",
              direction,
              depth,
              pathId,
              pathIndex,
              evidenceStrength,
              label,
              candidateScore: pathScore
            }),
          ...(finalStopNode
            ? {
              stopReason,
              stopReasonLabel: stopSemantics?.title ?? stopReason,
              limitationCode: "deepcheck_extended_path_stopped"
            }
            : {})
        });
      });
      const edgeIds: string[] = [];

      for (let edgeIndex = 0; edgeIndex < addressChain.length - 1; edgeIndex += 1) {
        const fromAddress = addressChain[edgeIndex];
        const toAddress = addressChain[edgeIndex + 1];
        const relationship = fromAddress === subjectAddress || toAddress === subjectAddress
          ? "direct_subject_edge"
          : "cross_wallet_edge";
        const finalEdge = edgeIndex === addressChain.length - 2;
        const edgeId = `edge:extended_provenance:${profileIndex}:${pathIndex}:${edgeIndex}`;
        edges.push({
          id: edgeId,
          fromNodeId: pathNodeIds[edgeIndex],
          toNodeId: pathNodeIds[edgeIndex + 1],
          type: "inferred_provenance",
          amountRaw: stringField(path, "amountRaw"),
          amountShare: numberField(path, "amountPreservationRatio"),
          txHash: txHashes[edgeIndex] ?? null,
          timestamp: edgeIndex === 0 ? stringField(path, "firstTransferAt") : stringField(path, "lastTransferAt"),
          weight: pathScore,
          verdict: (pathScore ?? 0) > 0 ? "review" : "unknown",
          evidenceIds,
          metadata: {
            source: "deepcheck_extended_path",
            sourceProfile: "extendedProvenanceProfile",
            evidenceType: "deepcheck_extended_path",
            pathId,
            profileIndex,
            pathIndex,
            edgeIndex,
            direction,
            depth,
            relationship,
            label,
            evidenceStrength,
            candidateScore: pathScore,
            stopReason: finalEdge ? stopReason : null,
            stopReasonLabel: finalEdge && stopSemantics ? stopSemantics.title : null,
            stopCategory: finalEdge && stopSemantics ? stopSemantics.category : null,
            limitationCode: finalEdge && stopReason ? "deepcheck_extended_path_stopped" : null
          }
        });
        edgeIds.push(edgeId);
      }

      paths.push({
        id: pathId,
        nodeIds: pathNodeIds,
        edgeIds,
        verdict: (pathScore ?? 0) > 0 ? "REVIEW" : "UNKNOWN",
        riskContribution: pathScore ?? 0,
        amountRaw: stringField(path, "amountRaw"),
        amountShare: numberField(path, "amountPreservationRatio"),
        stoppedAtNodeId: stopReason ? pathNodeIds[pathNodeIds.length - 1] ?? null : null,
        stopReason,
        stopReasonLabel: stopSemantics?.title ?? null,
        stopCategory: stopSemantics?.category ?? null,
        lastRealEdgeId: edgeIds[edgeIds.length - 1] ?? null,
        evidenceIds
      });
      weights.push({
        id: `weight:extended_provenance:${profileIndex}:${pathIndex}`,
        source: "deepcheck_extended_path",
        label: label ?? "Extended DeepCheck path",
        value: pathScore ?? 0,
        direction: (pathScore ?? 0) > 0 ? "raises_risk" : "context",
        pathId,
        nodeId: pathNodeIds[0] ?? null,
        edgeId: edgeIds[0] ?? null,
        explanation: stopReason
          ? `Saved extended DeepCheck path stopped at ${stopReason}.`
          : "Saved extended DeepCheck path.",
        metadata: {
          profileIndex,
          pathIndex,
          direction,
          depth,
          evidenceStrength,
          stopReason
        }
      });
    });
  });

  if (secondLayerProfile) {
    recordArrayField(secondLayerProfile, "directWalletStatuses").forEach((status) => {
      const address = stringField(status, "address") ?? stringField(status, "directWalletAddress") ?? stringField(status, "walletAddress");
      if (!address) return;
      const secondLayerStatus = stringField(status, "status");
      const stopReason = firstString(
        stringField(status, "stopReason"),
        stringField(status, "reason"),
        stringField(status, "stoppedReason")
      );
      upsertNode(address, address === subjectAddress ? "subject" : "wallet", {
        source: "deepcheck_relationship_second_layer",
        secondLayerStatus,
        secondLayerReason: stringField(status, "reason"),
        stopReason,
        limitationCode: stringField(status, "limitationCode"),
        queued: booleanField(status, "queued") ?? (secondLayerStatus === "queued" ? true : null),
        index: recordField(status, "index") ?? undefined,
        savedPathCount: numberField(status, "savedPathCount"),
        groupedNeighborCount: numberField(status, "groupedNeighborCount"),
        serviceCategory: stringField(status, "serviceCategory"),
        identity: stringField(status, "identity")
      });
    });

    recordArrayField(secondLayerProfile, "paths").forEach((path, pathIndex) => {
      const addressChain = projectableSecondLayerRelationshipPathAddresses(path, subjectAddress);
      if (addressChain.length < 3) return;

      const depth = numberField(path, "depth") ?? Math.max(0, addressChain.length - 1);
      const pathId = `path:second_layer_relationship:${pathIndex}`;
      const pathSourceId = stringField(path, "id");
      const evidenceIds = stringArrayField(path, "evidenceIds");
      const pathNodeIds = addressChain.map((address) =>
        upsertNode(address, address === subjectAddress ? "subject" : "wallet", {
          ...(address === subjectAddress
            ? {}
            : {
              source: "deepcheck_relationship_second_layer",
              pathId,
              pathSourceId,
              depth,
              selectionReason: stringField(path, "selectionReason")
            })
        })
      );
      const txHashes = stringArrayField(path, "txHashes");
      const firstSeen = firstString(stringField(path, "firstSeen"), stringField(path, "firstTransferAt"));
      const lastSeen = firstString(stringField(path, "lastSeen"), stringField(path, "lastTransferAt"));
      const edgeIds: string[] = [];
      const edgeCount = addressChain.length - 1;

      for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
        const fromAddress = addressChain[edgeIndex];
        const toAddress = addressChain[edgeIndex + 1];
        const relationship = fromAddress === subjectAddress || toAddress === subjectAddress
          ? "direct_subject_edge"
          : "second_hop_edge";
        const isSecondHopEdge = relationship === "second_hop_edge";
        const txHash = isSecondHopEdge ? txHashes.at(-1) ?? null : null;
        const amountRaw = isSecondHopEdge ? secondLayerRelationshipPathAmountRaw(path) : null;
        const amountShare = isSecondHopEdge ? numberField(path, "amountPreservationRatio") : null;
        const edgeId = `edge:second_layer_relationship:${pathIndex}:${edgeIndex}`;
        edges.push({
          id: edgeId,
          fromNodeId: pathNodeIds[edgeIndex],
          toNodeId: pathNodeIds[edgeIndex + 1],
          type: "inferred_provenance",
          displayRole: "inferred_provenance",
          amountRaw,
          amountShare,
          txHash,
          timestamp: isSecondHopEdge ? lastSeen : null,
          weight: null,
          verdict: "unknown",
          evidenceIds,
          metadata: {
            source: "deepcheck_relationship_second_hop",
            evidenceType: "deepcheck_relationship_second_hop",
            relationship,
            pathId,
            pathSourceId,
            edgeIndex,
            depth,
            selectionReason: stringField(path, "selectionReason"),
            ...(isSecondHopEdge
              ? {
                txHashes,
                txCount: numberField(path, "txCount"),
                firstSeen,
                lastSeen
              }
              : {})
          }
        });
        edgeIds.push(edgeId);
      }

      paths.push({
        id: pathId,
        nodeIds: pathNodeIds,
        edgeIds,
        verdict: "UNKNOWN",
        riskContribution: 0,
        amountRaw: secondLayerRelationshipPathAmountRaw(path),
        amountShare: numberField(path, "amountPreservationRatio"),
        stoppedAtNodeId: null,
        stopReason: null,
        evidenceIds
      });
    });

    recordArrayField(secondLayerProfile, "groups").forEach((group, groupIndex) => {
      if (!isProjectableSecondLayerRelationshipGroup(group)) return;
      const directWalletAddress = secondLayerRelationshipGroupAddress(group);
      if (!directWalletAddress) return;

      const groupId = stringField(group, "id") ?? `second_layer_group:${groupIndex}`;
      const groupKind = stringField(group, "kind") ?? "unknown";
      const members = secondLayerRelationshipMembers(group);
      const collapsedCount = secondLayerRelationshipGroupCount(group, members);
      const groupNodeId = `bundle:deep_second_layer:${groupIndex}`;
      const directWalletNodeId = upsertNode(directWalletAddress, directWalletAddress === subjectAddress ? "subject" : "wallet", {
        source: "deepcheck_relationship_second_layer"
      });
      nodesById.set(groupNodeId, {
        id: groupNodeId,
        address: null,
        kind: "bundle",
        label: stringField(group, "label") ?? "Collapsed second-layer wallets",
        riskLevel: null,
        confidence: null,
        weight: null,
        metadata: {
          source: "deepcheck_relationship_second_layer",
          groupId,
          groupKind,
          groupReason: `deep_second_layer_${groupKind}`,
          realGroupKind: "deep_second_layer_group",
          collapsedCount,
          memberCount: collapsedCount,
          members,
          subjectAddress: stringField(group, "subjectAddress") ?? subjectAddress,
          directWalletAddress,
          amountRaw: secondLayerRelationshipGroupAmountRaw(group),
          txCount: numberField(group, "txCount"),
          firstSeen: firstString(stringField(group, "firstSeen"), stringField(group, "firstTransferAt")),
          lastSeen: firstString(stringField(group, "lastSeen"), stringField(group, "lastTransferAt"))
        }
      });

      edges.push({
        id: `edge:second_layer_group:${groupIndex}`,
        fromNodeId: directWalletNodeId,
        toNodeId: groupNodeId,
        type: "inferred_provenance",
        displayRole: "profile_context",
        amountRaw: secondLayerRelationshipGroupAmountRaw(group),
        amountShare: null,
        txHash: null,
        timestamp: firstString(stringField(group, "lastSeen"), stringField(group, "lastTransferAt"), stringField(group, "firstSeen"), stringField(group, "firstTransferAt")),
        weight: null,
        verdict: "unknown",
        evidenceIds: stringArrayField(group, "evidenceIds"),
        metadata: {
          source: "deepcheck_relationship_second_hop",
          evidenceType: "deepcheck_second_layer_group",
          relationship: "grouped_tail",
          groupId,
          groupKind,
          aggregateTransferCount: numberField(group, "txCount"),
          aggregateAmountRaw: secondLayerRelationshipGroupAmountRaw(group),
          collapsedCount,
          memberCount: collapsedCount
        }
      });
    });
  }

  boundaryProfiles.forEach((profile, profileIndex) => {
    const rawProfileScore = firstNumber(numberField(profile, "contextScore"), numberField(profile, "score"));
    const profileScore = rawProfileScore ?? 0;
    if (rawProfileScore !== null) profileContextScores.push(rawProfileScore);
    const flows = recordArrayField(profile, "flows");

    flows.forEach((flow, flowIndex) => {
      const boundaryAddress = stringField(flow, "boundaryAddress");
      if (!boundaryAddress) return;

      const direction = stringField(flow, "direction");
      const viaAddress = stringField(flow, "viaAddress");
      const category = stringField(flow, "boundaryCategory");
      const identity = stringField(flow, "boundaryIdentity");
      const boundaryIdentityMetadata = normalizeBoundaryIdentity({
        address: boundaryAddress,
        identity,
        category,
        source: stringField(flow, "boundaryIdentitySource"),
        evidence: identity ? [`identity:${identity}`] : category ? [`category:${category}`] : ["category:unknown"]
      });
      const amountRaw = stringField(flow, "amountRaw");
      const boundaryAmountRaw = firstString(stringField(flow, "boundaryAmountRaw"), amountRaw);
      const amountShare = numberField(flow, "amountPreservationRatio");
      const pathId = `path:boundary_exposure:${profileIndex}:${flowIndex}`;
      const boundaryNodeId = upsertNode(boundaryAddress, boundaryNodeKind(category), {
        source: "boundaryExposureProfile",
        direction,
        category,
        identity,
        depth: numberField(flow, "depth"),
        boundaryRole: "service_boundary"
      });
      const boundaryNode = nodesById.get(boundaryNodeId);
      if (boundaryNode) {
        attachBoundaryIdentity(boundaryNode, boundaryIdentityMetadata);
        boundaryNode.weight = Math.max(boundaryNode.weight ?? 0, profileScore);
        boundaryNode.riskLevel = riskLevelFromScore(boundaryNode.weight);
      }

      const includeVia = viaAddress && viaAddress !== subjectAddress && viaAddress !== boundaryAddress;
      const viaNodeId = includeVia
        ? upsertNode(viaAddress, "wallet", {
          source: "boundaryExposureProfile",
          direction,
          boundaryAddress,
          boundaryCategory: category,
          boundaryIdentity: identity,
          boundaryRole: "via"
        })
        : null;
      const nodeChain = direction === "outbound"
        ? [subjectNodeId, ...(viaNodeId ? [viaNodeId] : []), boundaryNodeId]
        : [boundaryNodeId, ...(viaNodeId ? [viaNodeId] : []), subjectNodeId];
      const subjectHop = {
        txHash: stringField(flow, "subjectTxHash"),
        amountRaw,
        timestamp: direction === "outbound" ? stringField(flow, "firstTransferAt") : stringField(flow, "lastTransferAt"),
        role: "subject_hop"
      };
      const boundaryHop = {
        txHash: stringField(flow, "boundaryTxHash"),
        amountRaw: boundaryAmountRaw,
        timestamp: direction === "outbound" ? stringField(flow, "lastTransferAt") : stringField(flow, "firstTransferAt"),
        role: "boundary_hop"
      };
      const hopDetails = nodeChain.length === 2
        ? [{
          txHash: firstString(subjectHop.txHash, boundaryHop.txHash),
          amountRaw,
          timestamp: firstString(subjectHop.timestamp, boundaryHop.timestamp),
          role: "direct_boundary_hop"
        }]
        : direction === "outbound"
          ? [subjectHop, boundaryHop]
          : [boundaryHop, subjectHop];
      const pathEdgeIds: string[] = [];
      const flowEvidenceIds = stringArrayField(flow, "evidenceIds");
      const flowUnderlyingTransfers = hopDetails
        .map((hop) => boundaryUnderlyingTransfer({
          txHash: hop.txHash,
          amountRaw: hop.amountRaw,
          timestamp: hop.timestamp,
          role: hop.role
        }))
        .filter((item): item is Record<string, unknown> => item !== null);
      const flowHasStoredMoneyEvidence = flowUnderlyingTransfers.length > 0;
      const flowContextOnly = !flowHasStoredMoneyEvidence;
      const boundarySummary = {
        evidenceType: flowContextOnly ? "boundary_context_only" : "boundary_context",
        category,
        identity,
        direction,
        depth: numberField(flow, "depth"),
        transferCount: flowHasStoredMoneyEvidence ? 1 : 0,
        totalAmountRaw: flowHasStoredMoneyEvidence ? amountRaw : null,
        boundaryAmountRaw,
        amountPreservationRatio: amountShare,
        underlyingTransfers: flowUnderlyingTransfers,
        boundaryContextOnly: flowContextOnly,
        meaning: flowContextOnly ? BOUNDARY_CONTEXT_ONLY_MEANING : undefined
      };
      if (boundaryNode) {
        boundaryNode.metadata = {
          ...boundaryNode.metadata,
          boundaryEvidenceSummary: mergeBoundaryEvidenceSummary(
            boundaryNode.metadata.boundaryEvidenceSummary as Record<string, unknown> | undefined,
            boundarySummary
          )
        };
      }

      for (let edgeIndex = 0; edgeIndex < nodeChain.length - 1; edgeIndex += 1) {
        const hop = hopDetails[edgeIndex] ?? hopDetails[hopDetails.length - 1];
        const hopUnderlyingTransfer = boundaryUnderlyingTransfer({
          txHash: hop.txHash,
          amountRaw: hop.amountRaw,
          timestamp: hop.timestamp,
          role: hop.role
        });
        const hopHasStoredMoneyEvidence = hopUnderlyingTransfer !== null;
        const hopContextOnly = !hopHasStoredMoneyEvidence && flowUnderlyingTransfers.length === 0;
        const fromAddress = nodesById.get(nodeChain[edgeIndex])?.address ?? null;
        const toAddress = nodesById.get(nodeChain[edgeIndex + 1])?.address ?? null;
        if (
          isContractDrivenDirectDuplicate(hop.txHash, fromAddress, toAddress, hop.amountRaw) ||
          (!hop.txHash && isContractDrivenProfileContextDuplicate(fromAddress, toAddress, hop.amountRaw))
        ) {
          continue;
        }
        const edgeId = `edge:boundary_exposure:${profileIndex}:${flowIndex}:${edgeIndex}`;
        edges.push({
          id: edgeId,
          fromNodeId: nodeChain[edgeIndex],
          toNodeId: nodeChain[edgeIndex + 1],
          type: "service_boundary",
          amountRaw: hop.amountRaw,
          amountShare,
          txHash: hop.txHash,
          timestamp: hop.timestamp,
          weight: profileScore,
          verdict: "review",
          evidenceIds: flowEvidenceIds,
          metadata: {
            evidenceType: hopContextOnly ? "boundary_context_only" : "boundary_context",
            evidenceTypeLabel: hopContextOnly ? "Investigation stop" : "Boundary context",
            evidenceMeaning: hopContextOnly
              ? BOUNDARY_CONTEXT_ONLY_MEANING
              : "DeepCheck reached service, exchange, bridge, DEX, or contract infrastructure while expanding wallet context.",
            meaning: hopContextOnly ? BOUNDARY_CONTEXT_ONLY_MEANING : undefined,
            aggregateAmountRaw: hopHasStoredMoneyEvidence ? hop.amountRaw : undefined,
            aggregateTransferCount: hopHasStoredMoneyEvidence ? 1 : undefined,
            underlyingTransfers: hopContextOnly ? [] : hopUnderlyingTransfer ? [hopUnderlyingTransfer] : flowUnderlyingTransfers,
            source: "boundaryExposureProfile",
            boundaryContextOnly: hopContextOnly,
            pathId,
            direction,
            category,
            identity,
            boundaryIdentity: boundaryIdentityMetadata,
            boundaryEntityName: boundaryIdentityMetadata.displayName,
            boundaryCategoryLabel: boundaryIdentityMetadata.categoryLabel,
            depth: numberField(flow, "depth"),
            hopRole: hop.role,
            boundaryAddress,
            viaAddress,
            subjectTxHash: stringField(flow, "subjectTxHash"),
            boundaryTxHash: stringField(flow, "boundaryTxHash"),
            boundaryAmountRaw,
            amountPreservationRatio: amountShare
          }
        });
        pathEdgeIds.push(edgeId);
      }
      if (pathEdgeIds.length === 0) return;

      paths.push({
        id: pathId,
        nodeIds: nodeChain,
        edgeIds: pathEdgeIds,
        verdict: "REVIEW",
        riskContribution: profileScore,
        amountRaw,
        amountShare,
        stoppedAtNodeId: boundaryNodeId,
        stopReason: "service_boundary",
        stopReasonLabel: "Service boundary",
        stopCategory: "service_boundary",
        lastRealEdgeId: pathEdgeIds[pathEdgeIds.length - 1] ?? null,
        evidenceIds: flowEvidenceIds
      });
    });

    weights.push({
      id: `weight:boundary_exposure:${profileIndex}`,
      source: "boundary_exposure_profile",
      label: "Boundary exposure",
      value: profileScore,
      direction: "context",
      pathId: null,
      nodeId: subjectNodeId,
      edgeId: null,
      explanation: "Deep check found CEX/DEX/bridge/contract boundary context around the checked wallet.",
      metadata: {
        flowCount: flows.length,
        directBoundaryTxCount: numberField(profile, "directBoundaryTxCount"),
        twoHopBoundaryTxCount: numberField(profile, "twoHopBoundaryTxCount")
      }
    });
  });

  const expansionBoundaryStops = deepExpansionBoundaryStops(stringArrayField(result, "missingChecks"));
  expansionBoundaryStops.forEach((stop, index) => {
    limitations.push({
      code: "deep_expansion_service_boundary",
      label: "Deep expansion service boundary",
      severity: "review",
      pathId: null,
      explanation: stop.note
    });
  });

  serviceProfiles.forEach((profile, index) => {
    const rawScore = firstNumber(numberField(profile, "exposureScore"), numberField(profile, "score"));
    const score = rawScore ?? 0;
    if (rawScore !== null) profileContextScores.push(rawScore);
    const serviceNodeIds: string[] = [];
    const upsertServiceNode = (
      address: string | null,
      category: string | null,
      identity: string | null,
      metadata: Record<string, unknown>
    ): void => {
      if (!address) return;
      const serviceCategory = category ?? "service";
      const serviceIdentityMetadata = normalizeBoundaryIdentity({
        address,
        identity,
        category: serviceCategory,
        source: "metadata",
        evidence: identity ? [`identity:${identity}`] : [`category:${serviceCategory}`]
      });
      const serviceNodeId = upsertNode(address, "service", {
        ...metadata,
        category: serviceCategory,
        identity,
        score
      });
      const node = nodesById.get(serviceNodeId);
      if (node) attachBoundaryIdentity(node, serviceIdentityMetadata);
      edges.forEach((edge) => {
        if (edge.fromNodeId !== serviceNodeId && edge.toNodeId !== serviceNodeId) return;
        const source = stringField(edge.metadata, "source");
        const pathId = stringField(edge.metadata, "pathId");
        if (source !== "directCounterpartyInteractionProfile" && !pathId?.startsWith("path:direct_counterparty:")) return;
        edge.metadata = {
          ...edge.metadata,
          boundaryIdentity: serviceIdentityMetadata,
          boundaryEntityName: serviceIdentityMetadata.displayName,
          boundaryCategoryLabel: serviceIdentityMetadata.categoryLabel
        };
      });
      serviceNodeIds.push(serviceNodeId);
    };

    upsertServiceNode(
      stringField(profile, "serviceAddress") ?? stringField(profile, "address"),
      firstString(stringField(profile, "serviceType"), stringField(profile, "category")),
      stringField(profile, "identity"),
      { source: "serviceExposureProfile" }
    );
    recordArrayField(profile, "topServiceCounterparties").forEach((counterparty) => {
      upsertServiceNode(
        stringField(counterparty, "address"),
        stringField(counterparty, "category"),
        stringField(counterparty, "identity"),
        {
          source: "topServiceCounterparties",
          volumeRaw: stringField(counterparty, "volumeRaw"),
          txCount: numberField(counterparty, "txCount")
        }
      );
    });
    recordArrayField(profile, "topMergedServiceFlows").forEach((flow) => {
      upsertServiceNode(
        stringField(flow, "serviceAddress"),
        stringField(flow, "category"),
        stringField(flow, "identity"),
        {
          source: "topMergedServiceFlows",
          intermediateAddress: stringField(flow, "intermediateAddress"),
          incomingRaw: stringField(flow, "incomingRaw"),
          outgoingServiceRaw: stringField(flow, "outgoingServiceRaw"),
          sourceTxCount: numberField(flow, "sourceTxCount"),
          serviceTxCount: numberField(flow, "serviceTxCount")
        }
      );
    });

    weights.push({
      id: `weight:service:${index}`,
      source: "service_exposure_profile",
      label: stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory") ?? "Service exposure",
      value: score,
      direction: "context",
      pathId: null,
      nodeId: serviceNodeIds[0] ?? null,
      edgeId: null,
      explanation: stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory")
        ? `Exposure to ${stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory")}.`
        : "Service exposure profile.",
      metadata: {}
    });
  });

  if ((numberField(coverage, "transferEdges") ?? 0) > 0 && edges.length === 0) {
    limitations.push({
      code: "deep_profiles_without_projected_connections",
      label: "Deep transfer context was collected but no graphable profile edges were emitted",
      severity: "review",
      pathId: null,
      explanation: "The deep job fetched transfers, but the persisted risk/profile arrays contain no address-to-address paths for the admin graph."
    });
  }

  projectApprovalDrainProvenanceEventClusters({
    profiles: approvalDrainProvenanceProfiles,
    upsertNode,
    edges,
    paths,
    weights
  });
  appendContractDrivenEvidence({
    result,
    subjectAddress,
    nodesById,
    upsertNode,
    edges
  });

  const finalRiskScore = firstNumber(
    numberField(result, "riskScore"),
    numberField(result, "score"),
    numberField(assessment, "riskScore"),
    numberField(assessment, "score")
  );
  const profileContextScore = finalRiskScore === null && profileContextScores.length > 0
    ? Math.max(...profileContextScores)
    : null;
  const summaryRiskScore = finalRiskScore ?? profileContextScore;
  const explicitDecision = decision(result["decision"] ?? assessment["decision"]);
  const summaryDecision = explicitDecision !== "UNKNOWN"
    ? explicitDecision
    : summaryDecisionFromRisk(finalRiskScore);
  const riskDisplayMode = finalRiskScore !== null
    ? "final_result"
    : profileContextScore !== null
      ? "profile_context"
      : summary.status === "partial"
        ? "partial_not_ready"
        : "missing";

  dedupeGroupedProfileContextEdges(edges, paths);
  mergeDuplicateTransferEdges(edges, paths);
  removeNoTxTransferDuplicates(edges, paths);
  annotateReciprocalDirectCounterpartyFlows(edges);
  attachApprovalDrainProvenanceNodeIntelligence(nodesById, approvalDrainProvenanceProfiles);
  attachNodeIntelligence(nodesById, walletRoleProfiles);
  annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);
  const hopDepths = deepCheckHopDepths(subjectNodeId, edges);
  for (const node of nodesById.values()) {
    const nodeType = deepCheckNodeClusterType(node);
    const boundarySummary = isRecord(node.metadata.boundaryEvidenceSummary)
      ? node.metadata.boundaryEvidenceSummary
      : {};
    markDeepCheckNodeCluster(node, {
      nodeType,
      hopDepth: node.kind === "subject"
        ? 0
        : firstNumber(
          numberField(node.metadata, "hopDepth"),
          numberField(node.metadata, "depth"),
          hopDepths.get(node.id) ?? null
        ),
      boundaryType: firstString(
        stringField(boundarySummary, "category"),
        stringField(node.metadata, "category"),
        stringField(node.metadata, "serviceCategory"),
        stringField(node.metadata, "serviceType")
      ),
      expandedStatus: node.kind === "subject"
        ? "checked_subject"
        : nodeType === "boundary"
          ? "boundary_context"
          : nodeType === "history_stop"
            ? "history_stop"
            : "expanded_or_observed"
    });
  }
  for (const edge of edges) {
    edge.metadata = {
      ...edge.metadata,
      deepCheckWalletCluster: {
        edgeType: deepCheckEdgeClusterType(edge),
        relationship: deepCheckEdgeClusterRelationship(edge, nodesById),
        evidenceType: stringField(edge.metadata, "evidenceType")
      }
    };
  }
  const progressRecord = isRecord(job.progressJson) ? job.progressJson : null;
  const allTimeCoverage = deepCheckAllTimeCoverageSummary(result, progressRecord);
  const debugSummary = recordField(coverageDebug, "summary");
  const extendedStopReasonsCount = extendedProfiles.reduce((sum, profile) =>
    sum + recordArrayField(profile, "paths").filter((path) => deepCheckPathStopReason(path) !== null).length,
  0);
  const renderedDirectEdges = edges.filter((edge) =>
    edge.metadata.source === "directCounterpartyInteractionProfile" ||
    String(edge.metadata.pathId ?? "").startsWith("path:direct_counterparty:")
  ).length;
  const renderedExtendedEdges = edges.filter((edge) => edge.metadata.source === "deepcheck_extended_path").length;
  const secondLayerRelationshipPaths = secondLayerProfile
    ? recordArrayField(secondLayerProfile, "paths").filter((path) =>
      projectableSecondLayerRelationshipPathAddresses(path, subjectAddress).length >= 3
    ).length
    : 0;
  const secondLayerRelationshipGroups = secondLayerProfile
    ? recordArrayField(secondLayerProfile, "groups").filter(isProjectableSecondLayerRelationshipGroup).length
    : 0;
  const deepProjectionFacts = {
    directWalletsCount: firstNumber(
      allTimeCoverage ? numberField(allTimeCoverage, "subjectUniqueDirectWallets") : null,
      numberField(debugSummary ?? {}, "directCounterpartyCount"),
      directCounterpartyProfiles.length
    ),
    renderedDirectEdges,
    extendedPathsCount: countDeepCheckExtendedPaths(extendedProfiles),
    renderedExtendedEdges,
    maxSavedDepth: maxDeepCheckSavedDepth({
      directCounterpartyProfiles,
      inboundProfiles,
      boundaryProfiles,
      approvalDrainProvenanceProfiles,
      extendedProfiles,
      secondLayerProfile,
      subjectAddress
    }),
    stopReasonsCount: stopReasonRecords.length + boundaryStopRecords.length + extendedStopReasonsCount,
    secondLayerActiveBudget: allTimeCoverage ? numberField(allTimeCoverage, "secondLayerActiveBudget") : null,
    secondLayerRelationshipPaths,
    secondLayerRelationshipGroups,
    secondLayerQueued: secondLayerRelationshipCounter(
      secondLayerProfile,
      "queued",
      allTimeCoverage ? numberField(allTimeCoverage, "secondLayerQueued") : null
    ),
    secondLayerComplete: secondLayerRelationshipCounter(
      secondLayerProfile,
      "complete",
      allTimeCoverage ? numberField(allTimeCoverage, "secondLayerComplete") : null
    )
  };
  const riskClarity = buildRiskClaritySummary({
    kind: job.kind,
    executionStatus: riskClarityExecutionStatus(summary.status),
    finalRiskScore,
    explicitDecision: summaryDecision,
    missingChecks: [
      ...stringArrayFromUnknown(result["missingChecks"]),
      ...stringArrayFromUnknown(coverageDebug["missingChecks"]),
      ...(legacyCoverageDebugLimitation ? [legacyCoverageDebugLimitation] : [])
    ],
    coveragePartial: summary.status === "partial" || coverage["partial"] === true || legacyCoverageDebugLimitation !== null,
    fetchedAddressCount: legacyCoverageDebugLimitation ? 0 : numberField(coverage, "fetchedAddressCount"),
    hardEvidenceObserved: hardEvidenceObserved(result, assessment),
    evidenceHints: evidenceHintsFromResult(result, assessment)
  });

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: summaryDecision,
        riskScore: summaryRiskScore,
        riskLevel: riskLevelFromScore(summaryRiskScore),
        riskClarity,
        confidence: confidenceFromNumber(summaryRiskScore),
        coverageRatio: numberField(coverage, "coverageRatio"),
        checkedScope: stringField(coverage, "checkedScope") ?? riskDisplayMode,
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary: {
          deepCoverage: coverage,
          deepCheckCoverage: deepCheckCoverageSummary(result, progressRecord, deepProjectionFacts),
          riskDisplayMode,
          projectedProfiles: {
            counterpartyRiskProfiles: counterpartyProfiles.length,
            directCounterpartyInteractionProfiles: directCounterpartyProfiles.length,
            inboundProvenancePaths: inboundProfiles.reduce((sum, profile) => sum + recordArrayField(profile, "paths").length, 0),
            boundaryExposureProfiles: boundaryProfiles.length,
            boundaryExposureFlows: boundaryProfiles.reduce((sum, profile) => sum + recordArrayField(profile, "flows").length, 0),
            expansionBoundaryStops: expansionBoundaryStops.length,
            serviceExposureProfiles: serviceProfiles.length,
            approvalDrainProvenanceProfiles: approvalDrainProvenanceProfiles.length,
            extendedProvenanceProfiles: extendedProfiles.length,
            extendedProvenancePaths: countDeepCheckExtendedPaths(extendedProfiles),
            secondLayerRelationshipPaths,
            secondLayerRelationshipGroups
          }
        },
        contractDrivenCampaign: recordField(result, "contractDrivenCampaignSummary") ?? null,
        selectedAmountRaw: null,
        targetAmountRaw: null,
        topReasons: [
          ...stringArrayField(assessment, "reasons"),
          ...stringArrayField(result, "reasons"),
          ...stringArrayField(result, "missingChecks")
        ].slice(0, 8)
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: evidenceRefs(job.rawEvidenceIds, paths, edges)
    }
  };
}

function fastCheckDisplayKind(category: string | null): AdminForensicsNodeDisplayKind {
  if (category === "bridge" || category === "bridge_pool") return "bridge";
  if (category === "cex" || category === "hot_wallet") return "cex";
  if (category === "dex" || category === "router" || category === "swap_adapter") return "dex_contract";
  if (category === "unknown_contract") return "smart_contract";
  return "wallet";
}

function fastCheckNodeKind(displayKind: AdminForensicsNodeDisplayKind): AdminForensicsNode["kind"] {
  if (displayKind === "bridge" || displayKind === "cex") return "service";
  if (displayKind === "dex_contract" || displayKind === "smart_contract") return "contract";
  return "wallet";
}

function boundaryNodeKind(category: string | null): AdminForensicsNode["kind"] {
  if (category === "cex" || category === "hot_wallet" || category === "bridge" || category === "bridge_pool" || category === "service" || category === "protocol") {
    return "service";
  }
  if (category === "dex" || category === "router" || category === "swap_adapter" || category === "unknown_contract") {
    return "contract";
  }
  return "wallet";
}

function deepExpansionBoundaryStops(notes: string[]): Array<{ address: string; category: string | null; note: string }> {
  const seen = new Set<string>();
  const stops: Array<{ address: string; category: string | null; note: string }> = [];
  for (const note of notes) {
    const match = /^Expansion stopped at service boundary ([^\s()]+)(?: \(([^)]+)\))?$/.exec(note);
    if (!match) continue;
    const address = match[1];
    const category = match[2] ?? null;
    const key = `${address}:${category ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stops.push({ address, category, note });
  }
  return stops;
}

function riskLevelField(value: unknown): AdminForensicsRiskLevel | null {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL" ? value : null;
}

function confidenceField(value: unknown): AdminForensicsConfidence | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function projectAddressFastCheckJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const result = isRecord(job.resultJson) ? job.resultJson : null;
  const profile = result && isRecord(result["fastCounterpartyTopsProfile"])
    ? result["fastCounterpartyTopsProfile"]
    : null;
  if (
    !result ||
    !profile ||
    !Array.isArray(profile["topIncomingCounterparties"]) ||
    !Array.isArray(profile["topOutgoingCounterparties"]) ||
    !Array.isArray(profile["topServiceCounterparties"])
  ) {
    return {
      ok: false,
      status: "malformed",
      message: "Address fast check graph requires usable fast counterparty tops arrays."
    };
  }

  const riskReport: Record<string, unknown> = isRecord(result["fastRiskReport"]) ? result["fastRiskReport"] : {};
  const followUpJobs: Record<string, unknown> = isRecord(result["followUpJobs"]) ? result["followUpJobs"] : {};
  const subjectAddress = stringField(result, "subjectAddress") ?? stringField(profile, "subjectAddress") ?? job.subjectAddress;
  const riskScore = firstNumber(numberField(riskReport, "riskScore"), numberField(riskReport, "score"));
  const summaryRiskScore = riskScore;
  const riskLevel = summaryRiskScore !== null
    ? riskLevelFromScore(summaryRiskScore)
    : riskLevelField(riskReport["riskLevel"]) ?? riskLevelField(riskReport["level"]);
  const confidence = confidenceField(riskReport["confidence"]) ?? confidenceFromNumber(riskScore);
  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];
  const seenEdges = new Set<string>();

  const upsertNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    displayKind: AdminForensicsNodeDisplayKind,
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind === "wallet" && kind !== "wallet") existing.kind = kind;
      if (existing.displayKind === "wallet" && displayKind !== "wallet") existing.displayKind = displayKind;
      existing.metadata = { ...existing.metadata, ...metadata };
      if (!existing.displayLabel && typeof metadata.identity === "string") existing.displayLabel = metadata.identity;
      if (typeof metadata.identity === "string") existing.label = metadata.identity;
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      displayKind,
      displayLabel: typeof metadata.identity === "string" ? metadata.identity : undefined,
      label: typeof metadata.identity === "string" ? metadata.identity : shortAddress(address),
      riskLevel: kind === "subject" ? riskLevel : null,
      confidence: kind === "subject" ? confidence : null,
      weight: kind === "subject" ? riskScore : null,
      metadata
    });
    return id;
  };

  const subjectNodeId = upsertNode(subjectAddress, "subject", "subject_wallet", { role: "checked_wallet" });
  const addRows = (rows: Record<string, unknown>[], direction: "incoming" | "outgoing" | "service"): void => {
    rows.forEach((row, index) => {
      const address = stringField(row, "address");
      if (!address) return;
      const category = stringField(row, "category");
      const identity = stringField(row, "identity");
      const displayKind = fastCheckDisplayKind(category);
      const boundaryIdentity = displayKind === "wallet"
        ? null
        : normalizeBoundaryIdentity({ address, category, identity });
      const counterpartyNodeId = upsertNode(address, fastCheckNodeKind(displayKind), displayKind, {
        source: "fastCounterpartyTopsProfile",
        direction,
        category,
        identity,
        ...(boundaryIdentity ? { boundaryIdentity } : {}),
        volumeRaw: stringField(row, "volumeRaw"),
        volumeRatio: numberField(row, "volumeRatio"),
        txCount: numberField(row, "txCount"),
        selectedAsDeepPriorityHint: row["selectedAsDeepPriorityHint"] === true
      });
      const fromNodeId = direction === "incoming" ? counterpartyNodeId : subjectNodeId;
      const toNodeId = direction === "incoming" ? subjectNodeId : counterpartyNodeId;
      const edgeKey = `${fromNodeId}->${toNodeId}`;
      if (seenEdges.has(edgeKey)) return;
      seenEdges.add(edgeKey);

      const pathId = `path:fast_check:${direction}:${index}`;
      const edgeId = `edge:fast_check:${direction}:${index}`;
      const txHashes = stringArrayField(row, "sampleTxHashes");
      edges.push({
        id: edgeId,
        fromNodeId,
        toNodeId,
        type: "inferred_provenance",
        amountRaw: stringField(row, "volumeRaw"),
        amountShare: numberField(row, "volumeRatio"),
        txHash: txHashes.length === 1 ? txHashes[0] : null,
        timestamp: firstString(stringField(row, "lastSeen"), stringField(row, "firstSeen")),
        weight: null,
        verdict: "unknown",
        evidenceIds: [],
        metadata: {
          source: "fastCounterpartyTopsProfile",
          pathId,
          direction,
          category,
          identity: stringField(row, "identity"),
          txCount: numberField(row, "txCount"),
          txHashes,
          selectedAsDeepPriorityHint: row["selectedAsDeepPriorityHint"] === true
        }
      });
      paths.push({
        id: pathId,
        nodeIds: [fromNodeId, toNodeId],
        edgeIds: [edgeId],
        verdict: "UNKNOWN",
        riskContribution: 0,
        amountRaw: stringField(row, "volumeRaw"),
        amountShare: numberField(row, "volumeRatio"),
        stoppedAtNodeId: null,
        stopReason: null,
        evidenceIds: []
      });
    });
  };

  const incoming = recordArrayField(profile, "topIncomingCounterparties");
  const outgoing = recordArrayField(profile, "topOutgoingCounterparties");
  const services = recordArrayField(profile, "topServiceCounterparties");
  addRows(incoming, "incoming");
  addRows(outgoing, "outgoing");
  addRows(services, "service");

  const limitations = stringArrayField(result, "missingChecks").map((code): AdminForensicsLimitation => ({
    code,
    label: code.replace(/_/g, " "),
    severity: "review",
    pathId: null,
    explanation: `Fast check did not include ${code.replace(/_/g, " ")}.`
  }));

  if (riskScore !== null) {
    weights.push({
      id: "weight:fast_check:risk",
      source: "address_fast_check",
      label: "Fast check risk score",
      value: riskScore,
      direction: riskScore > 0 ? "raises_risk" : "context",
      pathId: null,
      nodeId: subjectNodeId,
      edgeId: null,
      explanation: "Bounded fast-check risk score.",
      metadata: {}
    });
  }

  dedupeGroupedProfileContextEdges(edges, paths);
  mergeDuplicateTransferEdges(edges, paths);
  removeNoTxTransferDuplicates(edges, paths);
  annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);
  const summaryDecision = decision(riskReport["decision"]);
  const riskClarity = buildRiskClaritySummary({
    kind: job.kind,
    executionStatus: riskClarityExecutionStatus(summary.status),
    finalRiskScore: summaryRiskScore,
    explicitDecision: summaryDecision,
    missingChecks: stringArrayFromUnknown(result["missingChecks"]),
    coveragePartial: summary.status === "partial",
    fetchedAddressCount: null,
    hardEvidenceObserved: hardEvidenceObserved(result, riskReport),
    evidenceHints: evidenceHintsFromResult(result, riskReport)
  });

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: summaryDecision,
        riskScore,
        riskLevel,
        riskClarity,
        confidence,
        coverageRatio: null,
        checkedScope: "fast_check",
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary: {
          fastCheckTops: { incoming, outgoing, services },
          followUpJobs: {
            whereIsMoneyJobId: stringField(followUpJobs, "whereIsMoneyJobId"),
            addressDeepCheckJobId: stringField(followUpJobs, "addressDeepCheckJobId")
          }
        },
        contractDrivenCampaign: null,
        selectedAmountRaw: null,
        targetAmountRaw: null,
        topReasons: riskReasonMessagesField(riskReport, "reasons")
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: evidenceRefs(job.rawEvidenceIds, paths, edges)
    }
  };
}

function projectIncomingDepositJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const progress = isRecord(job.progressJson) ? job.progressJson : {};
  const result = isRecord(job.resultJson) ? job.resultJson : {};
  const senderAddress = stringField(progress, "sender") ?? job.subjectAddress;
  const receiverAddress = firstString(
    stringField(progress, "watchedWallet"),
    stringField(progress, "receiver")
  );
  if (!senderAddress || !receiverAddress) {
    return {
      ok: false,
      status: "malformed",
      message: "Incoming deposit graph requires both sender and receiver wallet addresses."
    };
  }
  const riskScore = firstNumber(numberField(result, "depositRiskScore"), numberField(result, "riskScore"));
  const originPaths = recordArrayField(result, "originPaths");
  const freshBundleExposure = recordField(result, "freshBundleExposure");
  const walletExposureProfile = recordField(result, "walletExposureProfile");
  const sourceBundleExposure = recordField(result, "sourceBundleExposure");
  const subjectExposureProfile = recordField(result, "subjectExposureProfile");
  const walletRoleProfiles = recordArrayField(result, "walletRoleProfiles");
  const contractDrivenSubjectAddress = firstString(
    stringField(result, "contractDrivenSubjectAddress"),
    stringField(result, "subjectAddress"),
    senderAddress
  ) ?? senderAddress;
  const contractDrivenDirectTransferKeys = new Set<string>();
  recordArrayField(result, "contractDrivenTransferProfiles").forEach((profile) => {
    if (contractDrivenProfileLooksPlainUsdtTransfer(profile)) return;
    const key = contractDrivenTransferDuplicateKey(
      stringField(profile, "txHash"),
      firstString(
        stringField(profile, "sourceAddress"),
        stringField(profile, "victimAddress"),
        stringField(profile, "fromAddress"),
        stringField(profile, "source"),
        stringField(profile, "victim")
      ),
      firstString(
        stringField(profile, "receiverAddress"),
        stringField(profile, "toAddress"),
        stringField(profile, "receiver"),
        contractDrivenSubjectAddress
      ),
      stringField(profile, "amountRaw")
    );
    if (key) contractDrivenDirectTransferKeys.add(key);
  });
  const isContractDrivenDirectDuplicate = (
    txHash: string | null,
    fromAddress: string | null,
    toAddress: string | null,
    amountRaw: string | null
  ): boolean => {
    const key = contractDrivenTransferDuplicateKey(txHash, fromAddress, toAddress, amountRaw);
    return key !== null && contractDrivenDirectTransferKeys.has(key);
  };
  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const limitations: AdminForensicsLimitation[] = [];
  const weights: AdminForensicsWeight[] = [
    {
      id: "weight:deposit:risk",
      source: "incoming_deposit",
      label: "Deposit risk score",
      value: riskScore ?? 0,
      direction: riskScore !== null && riskScore > 0 ? "raises_risk" : "context",
      pathId: originPaths.length > 0 ? null : "path:deposit:0",
      nodeId: nodeId(senderAddress),
      edgeId: originPaths.length > 0 ? null : "edge:deposit:0",
      explanation: "Incoming deposit risk score.",
      metadata: {}
    }
  ];

  const upsertNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind !== "subject" && kind === "subject") existing.kind = "subject";
      existing.metadata = { ...existing.metadata, ...metadata };
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      label: shortAddress(address),
      riskLevel: kind === "subject" ? riskLevelFromScore(riskScore) : null,
      confidence: kind === "subject" ? confidenceFromNumber(riskScore) : null,
      weight: kind === "subject" ? riskScore : null,
      metadata
    });
    return id;
  };

  const senderNodeId = upsertNode(senderAddress, "subject", { role: "sender" });
  const receiverNodeId = upsertNode(
    receiverAddress,
    receiverAddress === senderAddress ? "subject" : "wallet",
    { role: "receiver" }
  );

  if (originPaths.length > 0) {
    originPaths.forEach((path, pathIndex) => {
      const pathId = `path:origin:${pathIndex}`;
      const pathEvidenceIds = stringArrayField(path, "evidenceIds");
      const steps = recordArrayField(path, "steps");
      const txHashes = stringArrayField(path, "txHashes");
      const pathAddresses = stringArrayField(path, "pathAddresses");
      const addressChain = pathAddresses.length > 0
        ? pathAddresses
        : [
            ...steps.flatMap((step) => [
              stringField(step, "fromAddress"),
              stringField(step, "toAddress")
            ]).filter((address): address is string => address !== null)
          ];
      const uniqueAddressChain = Array.from(new Set(addressChain.length > 0 ? addressChain : [senderAddress, receiverAddress]));
      const pathNodeIds = uniqueAddressChain.map((address) =>
        upsertNode(address, address === senderAddress ? "subject" : "wallet", {
          source: "incomingDepositOriginPath"
        })
      );
      const pathEdgeIds: string[] = [];
      const bundleNodeIds: string[] = [];
      const pathScore = numberField(path, "score") ?? 0;
      const amountShare = numberField(path, "amountCoverageRatio");
      const sourcePolicyShareMetadata = shareDetailMetadata(path["sourcePolicyShareDetail"]);
      const attributedShareMetadata = incomingAttributedShareMetadata(numberField(path, "balanceShare"), amountShare);

      if (steps.length > 0) {
        steps.forEach((step, stepIndex) => {
          const fromAddress = stringField(step, "fromAddress");
          const toAddress = stringField(step, "toAddress");
          if (!fromAddress || !toAddress) return;
          const fromNodeId = upsertNode(fromAddress, fromAddress === senderAddress ? "subject" : "wallet");
          const toNodeId = upsertNode(toAddress, toAddress === senderAddress ? "subject" : "wallet");
          const edgeId = `edge:origin:${pathIndex}:${stepIndex}`;
          const txHash = stringField(step, "txHash") ?? txHashes[stepIndex] ?? null;
          const amountRaw = stringField(step, "amountRaw");
          if (isContractDrivenDirectDuplicate(txHash, fromAddress, toAddress, amountRaw)) return;
          edges.push({
            id: edgeId,
            fromNodeId,
            toNodeId,
            type: "transfer",
            amountRaw,
            amountShare,
            txHash,
            timestamp: stringField(step, "timestamp"),
            weight: pathScore,
            verdict: edgeVerdict(path["verdict"]),
            evidenceIds: pathEvidenceIds,
            metadata: {
              pathId,
              source: "incomingDepositOriginPath",
              sourcePolicy: stringField(path, "sourcePolicy"),
              amountContinuity: stringField(path, "amountContinuity"),
              proximityHops: numberField(path, "proximityHops"),
              ...attributedShareMetadata,
              ...sourcePolicyShareMetadata
            }
          });
          pathEdgeIds.push(edgeId);
        });
      } else {
        for (let index = 0; index < uniqueAddressChain.length - 1; index += 1) {
          const txHash = txHashes[index] ?? null;
          const amountRaw = stringField(progress, "amountRaw");
          if (isContractDrivenDirectDuplicate(
            txHash,
            uniqueAddressChain[index] ?? null,
            uniqueAddressChain[index + 1] ?? null,
            amountRaw
          )) continue;
          const edgeId = `edge:origin:${pathIndex}:${index}`;
          edges.push({
            id: edgeId,
            fromNodeId: pathNodeIds[index],
            toNodeId: pathNodeIds[index + 1],
            type: "transfer",
            amountRaw,
            amountShare,
            txHash,
            timestamp: null,
            weight: pathScore,
            verdict: edgeVerdict(path["verdict"]),
            evidenceIds: pathEvidenceIds,
            metadata: {
              pathId,
              source: "incomingDepositOriginPath",
              sourcePolicy: stringField(path, "sourcePolicy"),
              amountContinuity: stringField(path, "amountContinuity"),
              ...attributedShareMetadata,
              ...sourcePolicyShareMetadata
            }
          });
          pathEdgeIds.push(edgeId);
        }
      }

      recordArrayField(path, "fundingBundles").forEach((bundle, bundleIndex) => {
        const fundingFunders = recordArrayField(bundle, "fundingFunders");
        const funderSummary = bundleTopFundersFromIncomingFunders(fundingFunders);
        if (funderSummary.funderCount < 2) return;

        const bundleId = bundleNodeId(pathIndex, bundleIndex);
        const targetFromAddress = stringField(bundle, "targetFromAddress");
        const targetNodeId = targetFromAddress
          ? upsertNode(targetFromAddress, targetFromAddress === senderAddress ? "subject" : "wallet")
          : pathNodeIds[0] ?? senderNodeId;
        const targetTxHash = stringField(bundle, "targetTxHash");
        const targetAmountRaw = stringField(bundle, "targetAmountRaw");
        const bundleAmountRaw = stringField(bundle, "bundleAmountRaw");
        const relatedEdgeIds: string[] = [];
        const memberTransfers = fundingFunders
          .flatMap((funder) => {
            const fromAddress = stringField(funder, "address");
            if (!fromAddress || !targetFromAddress) return [];
            const amountRaw = stringField(funder, "amountRaw");
            return stringArrayField(funder, "txHashes").map((txHash) => ({
              txHash,
              fromAddress,
              toAddress: targetFromAddress,
              originalAmountRaw: amountRaw,
              usedAmountRaw: amountRaw,
              amountRaw,
              timestamp: null
            }));
          });

        funderSummary.topFunders.forEach((funder, funderIndex) => {
          const funderNodeId = upsertNode(funder.address, funder.address === senderAddress ? "subject" : "wallet");
          const edgeId = `edge:origin:${pathIndex}:bundle:${bundleIndex}:funder:${funderIndex}`;
          edges.push({
            id: edgeId,
            fromNodeId: funderNodeId,
            toNodeId: bundleId,
            type: "inferred_provenance",
            amountRaw: funder.amountRaw,
            amountShare: null,
            txHash: null,
            timestamp: null,
            weight: pathScore,
            verdict: "review",
            evidenceIds: pathEvidenceIds,
            metadata: {
              pathId,
              bundleIndex,
              bundleNodeId: bundleId,
              bundleRole: "top_funder",
              txHashes: funder.txHashes,
              memberCount: funder.memberCount,
              originalAmountRaw: funder.amountRaw,
              usedAmountRaw: funder.amountRaw,
              anchorAmountRaw: targetAmountRaw,
              amountRole: "bundle_top_funder"
            }
          });
          relatedEdgeIds.push(edgeId);
        });

        const bundleTargetEdgeId = `edge:origin:${pathIndex}:bundle:${bundleIndex}:target`;
        edges.push({
          id: bundleTargetEdgeId,
          fromNodeId: bundleId,
          toNodeId: targetNodeId,
          type: "inferred_provenance",
          amountRaw: bundleAmountRaw ?? targetAmountRaw,
          amountShare: numberField(bundle, "bundleCoverageRatio"),
          txHash: null,
          timestamp: stringField(bundle, "windowEnd"),
          weight: pathScore,
          verdict: "review",
          evidenceIds: pathEvidenceIds,
          metadata: {
            pathId,
            bundleIndex,
            bundleNodeId: bundleId,
            bundleRole: "bundle_to_target",
            targetTxHash,
            originalAmountRaw: bundleAmountRaw,
            usedAmountRaw: bundleAmountRaw,
            anchorAmountRaw: targetAmountRaw,
            amountRole: "bundle_coverage"
          }
        });
        relatedEdgeIds.push(bundleTargetEdgeId);

        nodesById.set(bundleId, {
          id: bundleId,
          address: null,
          kind: "bundle",
          label: "Funding bundle",
          riskLevel: riskLevelFromScore(pathScore),
          confidence: null,
          weight: pathScore,
          metadata: {
            pathId,
            relatedPathIds: [pathId],
            relatedEdgeIds,
            bundleIndex,
            bundleKind: "incoming_deposit_funding_bundle",
            targetTxHash,
            targetFromAddress,
            targetToAddress: stringField(bundle, "targetToAddress"),
            targetAmountRaw,
            bundleAmountRaw,
            coverageRatio: numberField(bundle, "bundleCoverageRatio"),
            windowStart: stringField(bundle, "windowStart"),
            windowEnd: stringField(bundle, "windowEnd"),
            fundingTxHashes: stringArrayField(bundle, "fundingTxHashes"),
            fundingAddresses: stringArrayField(bundle, "fundingAddresses"),
            memberCount: funderSummary.funderCount,
            txCount: stringArrayField(bundle, "fundingTxHashes").length,
            memberTransfers,
            funderCount: funderSummary.funderCount,
            topFunders: funderSummary.topFunders,
            smallTailAmountRaw: funderSummary.smallTailAmountRaw,
            smallTailCount: funderSummary.smallTailCount,
            deepExpansion: recordField(bundle, "deepExpansion")
          }
        });
        bundleNodeIds.push(bundleId);
        limitations.push({
          code: "incoming_funding_bundle",
          label: "Incoming funding bundle used",
          severity: "info",
          pathId,
          explanation: `Funding bundle ${bundleIndex + 1} covered ${bundleAmountRaw ?? "unknown"} raw USDT for target ${targetTxHash ?? "unknown tx"}.`
        });
      });

      let stoppedAtNodeId: string | null = null;
      const stoppedReason = stringField(path, "stoppedReason");
      if (stoppedReason) {
        const diagnostics = stopDiagnostics({ path, pathId, stopReason: stoppedReason, riskContribution: pathScore });
        stoppedAtNodeId = `stop:origin:${pathIndex}:${stoppedReason}`;
        nodesById.set(stoppedAtNodeId, {
          id: stoppedAtNodeId,
          address: null,
          kind: "stop",
          label: stoppedReason,
          riskLevel: riskLevelFromScore(pathScore),
          confidence: null,
          weight: pathScore,
          metadata: { reason: stoppedReason, pathId, stopPosition: "upstream_source", stopDetails: [diagnostics] }
        });
        const edgeId = `edge:origin:${pathIndex}:stop`;
        edges.push({
          id: edgeId,
          fromNodeId: stoppedAtNodeId,
          toNodeId: pathNodeIds[0] ?? senderNodeId,
          type: "stop",
          amountRaw: null,
          amountShare: null,
          txHash: null,
          timestamp: null,
          weight: pathScore,
          verdict: edgeVerdict(path["verdict"]),
          evidenceIds: pathEvidenceIds,
          metadata: { reason: stoppedReason, pathId, stopPosition: "upstream_source", stopDetails: [diagnostics] }
        });
        pathEdgeIds.unshift(edgeId);
        limitations.push({
          code: stoppedReason,
          label: stoppedReason,
          severity: path["verdict"] === "DECLINE" ? "blocking" : "review",
          pathId,
          explanation: `Incoming deposit origin path stopped at ${stoppedReason}; fetched ${diagnostics.totalFetchedTransferCount} prior transfer(s), history source ${diagnostics.historySource ?? "n/a"}.`
        });
        if (stoppedReason === "no_previous_transfer") {
          limitations.push({
            code: "legacy_no_previous_transfer",
            label: "Legacy no_previous_transfer stop",
            severity: "review",
            pathId,
            explanation: "Incoming deposit reports still expose no_previous_transfer; rerun or inspect path context before treating it as no history."
          });
          if (diagnostics.hadIncomingTransfers === true) {
            limitations.push({
              code: "previous_transfers_found_but_not_matching",
              label: "Previous transfers found but not matching",
              severity: "review",
              pathId,
              explanation: `Prior incoming transfers were found (${diagnostics.totalFetchedTransferCount}), but none met the amount/time continuity threshold.`
            });
          }
        }
        if (stoppedReason === "incoming_seen_but_below_continuity") {
          limitations.push({
            code: "previous_transfers_found_but_not_matching",
            label: "Previous transfers found but not matching",
            severity: "review",
            pathId,
            explanation: `Prior incoming transfers were found (${diagnostics.totalFetchedTransferCount}), but none met the amount/time continuity threshold.`
          });
        }
      }

      paths.push({
        id: pathId,
        nodeIds: stoppedAtNodeId ? [stoppedAtNodeId, ...pathNodeIds, ...bundleNodeIds] : [...pathNodeIds, ...bundleNodeIds],
        edgeIds: pathEdgeIds,
        verdict: decision(path["verdict"]),
        riskContribution: pathScore,
        amountRaw: stringField(progress, "amountRaw"),
        amountShare,
        stoppedAtNodeId,
        stopReason: stoppedReason,
        evidenceIds: pathEvidenceIds
      });
      weights.push({
        id: `weight:incoming_origin:${pathIndex}`,
        source: "incoming_deposit_origin_path",
        label: stringArrayField(path, "reasons")[0] ?? "Incoming deposit origin path",
        value: pathScore,
        direction: pathScore > 0 ? "raises_risk" : "context",
        pathId,
        nodeId: stoppedAtNodeId ?? pathNodeIds[0] ?? null,
        edgeId: pathEdgeIds[0] ?? null,
        explanation: stringArrayField(path, "reasons")[0] ?? "Incoming deposit origin path.",
        metadata: { ...attributedShareMetadata, ...sourcePolicyShareMetadata }
      });

    });
  } else {
    const edgeId = "edge:deposit:0";
    const pathId = "path:deposit:0";
    const txHash = stringField(progress, "depositTxHash") ?? stringField(progress, "txHash");
    const amountRaw = stringField(progress, "amountRaw");
    const directDepositIsContractDriven = isContractDrivenDirectDuplicate(txHash, senderAddress, receiverAddress, amountRaw);
    if (!directDepositIsContractDriven) {
      edges.push({
        id: edgeId,
        fromNodeId: senderNodeId,
        toNodeId: receiverNodeId,
        type: "transfer",
        amountRaw,
        amountShare: null,
        txHash,
        timestamp: stringField(progress, "timestamp"),
        weight: riskScore,
        verdict: edgeVerdict(result["decision"]),
        evidenceIds: [],
        metadata: {}
      });
    }
    paths.push({
      id: pathId,
      nodeIds: [senderNodeId, receiverNodeId],
      edgeIds: directDepositIsContractDriven ? [] : [edgeId],
      verdict: decision(result["decision"]),
      riskContribution: riskScore ?? 0,
      amountRaw,
      amountShare: null,
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds: []
    });
  }

  recordArrayField(result, "sourcePolicyEvidence").forEach((evidence, index) => {
    const score = numberField(evidence, "score") ?? 0;
    weights.push({
      id: `weight:incoming_source_policy:${index}`,
      source: "source_policy",
      label: stringField(evidence, "kind") ?? "Source policy",
      value: score,
      direction: score >= 45 ? "raises_risk" : "context",
      pathId: null,
      nodeId: senderNodeId,
      edgeId: null,
      explanation: stringArrayField(evidence, "reasons")[0] ?? "Incoming deposit source-policy amount-weighted contribution.",
      metadata: sourcePolicyEvidenceMetadata(evidence)
    });
  });

  if (freshBundleExposure) {
    const htxHuobiShare = numberField(freshBundleExposure, "htxHuobiShare") ?? 0;
    const cleanCexShare = numberField(freshBundleExposure, "cleanCexShare") ?? 0;
    const bridgeRouterDexShare = numberField(freshBundleExposure, "bridgeRouterDexShare") ?? 0;
    const unknownContractShare = numberField(freshBundleExposure, "unknownContractShare") ?? 0;
    const riskyLabelShare = numberField(freshBundleExposure, "riskyLabelShare") ?? 0;
    const unknownShare = numberField(freshBundleExposure, "unknownShare") ?? 0;
    const dominantFreshSource = stringField(freshBundleExposure, "dominantFreshSource");
    weights.push(
      {
        id: "weight:incoming_fresh_htx_huobi_share",
        code: "incoming_fresh_htx_huobi_share",
        source: "incoming_fresh_bundle",
        label: "Fresh HTX/Huobi bundle share",
        value: htxHuobiShare,
        direction: htxHuobiShare > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Fresh HTX/Huobi bundle share.",
        metadata: {
          dominantFreshSource
        }
      },
      {
        id: "weight:incoming_fresh_clean_cex_share",
        code: "incoming_fresh_clean_cex_share",
        source: "incoming_fresh_bundle",
        label: "Fresh clean CEX bundle share",
        value: cleanCexShare,
        direction: cleanCexShare > 0 ? "lowers_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Fresh clean CEX bundle share.",
        metadata: {
          dominantFreshSource
        }
      },
      {
        id: "weight:incoming_fresh_bridge_router_dex_share",
        code: "incoming_fresh_bridge_router_dex_share",
        source: "incoming_fresh_bundle",
        label: "Fresh bridge/router/DEX bundle share",
        value: bridgeRouterDexShare,
        direction: bridgeRouterDexShare > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Fresh bridge/router/DEX bundle share.",
        metadata: {
          dominantFreshSource
        }
      },
      {
        id: "weight:incoming_fresh_unknown_contract_share",
        code: "incoming_fresh_unknown_contract_share",
        source: "incoming_fresh_bundle",
        label: "Fresh unknown-contract bundle share",
        value: unknownContractShare,
        direction: unknownContractShare > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Fresh unknown-contract bundle share.",
        metadata: {
          dominantFreshSource
        }
      },
      {
        id: "weight:incoming_fresh_risky_label_share",
        code: "incoming_fresh_risky_label_share",
        source: "incoming_fresh_bundle",
        label: "Fresh risky-label bundle share",
        value: riskyLabelShare,
        direction: riskyLabelShare > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Fresh risky-label bundle share.",
        metadata: {
          dominantFreshSource
        }
      },
      {
        id: "weight:incoming_fresh_unknown_share",
        code: "incoming_fresh_unknown_share",
        source: "incoming_fresh_bundle",
        label: "Fresh unknown bundle share",
        value: unknownShare,
        direction: "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Fresh unknown bundle share.",
        metadata: {
          dominantFreshSource
        }
      }
    );
  }

  if (walletExposureProfile) {
    const htxHuobiIncomingShare = numberField(walletExposureProfile, "htxHuobiIncomingShare") ?? 0;
    const bridgeRouterDexVolumeShare = numberField(walletExposureProfile, "bridgeRouterDexVolumeShare") ?? 0;
    const unknownContractVolumeShare = numberField(walletExposureProfile, "unknownContractVolumeShare") ?? 0;
    const unknownSourceShare = numberField(walletExposureProfile, "unknownSourceShare") ?? 0;
    const inOutVelocityScore = numberField(walletExposureProfile, "inOutVelocityScore") ?? 0;
    const scoreContribution = numberField(walletExposureProfile, "scoreContribution") ?? 0;
    const walletExposureMetadata = {
      windowStart: stringField(walletExposureProfile, "windowStart"),
      windowEnd: stringField(walletExposureProfile, "windowEnd")
    };
    weights.push(
      {
        id: "weight:incoming_wallet_htx_huobi_incoming_share",
        code: "incoming_wallet_htx_huobi_incoming_share",
        source: "incoming_wallet_exposure_profile",
        label: "Historical sender HTX/Huobi incoming share",
        value: htxHuobiIncomingShare,
        direction: htxHuobiIncomingShare > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Historical sender HTX/Huobi incoming share.",
        metadata: { ...walletExposureMetadata }
      },
      {
        id: "weight:incoming_wallet_bridge_router_dex_volume_share",
        code: "incoming_wallet_bridge_router_dex_volume_share",
        source: "incoming_wallet_exposure_profile",
        label: "Historical sender bridge/router/DEX volume share",
        value: bridgeRouterDexVolumeShare,
        direction: bridgeRouterDexVolumeShare > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Historical sender bridge/router/DEX volume share.",
        metadata: { ...walletExposureMetadata }
      },
      {
        id: "weight:incoming_wallet_unknown_contract_volume_share",
        code: "incoming_wallet_unknown_contract_volume_share",
        source: "incoming_wallet_exposure_profile",
        label: "Historical sender unknown-contract volume share",
        value: unknownContractVolumeShare,
        direction: unknownContractVolumeShare > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Historical sender unknown-contract volume share.",
        metadata: { ...walletExposureMetadata }
      },
      {
        id: "weight:incoming_wallet_unknown_source_share",
        code: "incoming_wallet_unknown_source_share",
        source: "incoming_wallet_exposure_profile",
        label: "Historical sender unknown-source share",
        value: unknownSourceShare,
        direction: unknownSourceShare > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Historical sender unknown-source share.",
        metadata: { ...walletExposureMetadata }
      },
      {
        id: "weight:incoming_wallet_in_out_velocity_score",
        code: "incoming_wallet_in_out_velocity_score",
        source: "incoming_wallet_exposure_profile",
        label: "Sender in/out velocity score",
        value: inOutVelocityScore,
        direction: inOutVelocityScore > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Sender in/out velocity score.",
        metadata: { ...walletExposureMetadata }
      },
      {
        id: "weight:incoming_wallet_background_score",
        code: "incoming_wallet_background_score",
        source: "incoming_wallet_exposure_profile",
        label: "Sender exposure profile background score",
        value: scoreContribution,
        direction: scoreContribution > 0 ? "raises_risk" : "context",
        pathId: null,
        nodeId: senderNodeId,
        edgeId: null,
        explanation: "Sender exposure profile background score.",
        metadata: { ...walletExposureMetadata }
      }
    );
    limitations.push({
      code: "incoming_exposure_context_not_source_proof",
      label: "Incoming exposure context is not source proof",
      severity: "info",
      pathId: null,
      explanation: "Historical wallet exposure profile is context and does not prove the checked deposit source."
    });
  }
  addSourceBundleExposureWeights({
    weights,
    limitations,
    nodeId: senderNodeId,
    mode: "incoming",
    exposure: sourceBundleExposure
  });
  addSubjectExposureProfileWeights({
    weights,
    limitations,
    nodeId: senderNodeId,
    mode: "incoming",
    profile: subjectExposureProfile
  });
  attachWeakSubjectExposureServiceHints(nodesById, subjectExposureProfile);
  attachNodeRelatedLimitations(nodesById, senderNodeId, limitations, [
    "source_bundle_budget_exhausted",
    "source_bundle_unresolved_boundary",
    "subject_exposure_context_not_source_proof"
  ]);

  const layerSummary = {
    fundingCoverage: recordField(result, "fundingCoverage"),
    corridorSummary: recordField(result, "corridorSummary"),
    fastSenderRisk: recordField(result, "fastSenderRisk"),
    originPathCount: originPaths.length
  };

  appendContractDrivenEvidence({
    result,
    subjectAddress: contractDrivenSubjectAddress,
    nodesById,
    upsertNode,
    edges
  });
  attachNodeIntelligence(nodesById, walletRoleProfiles);
  suppressFundingBundleDuplicateEdges(edges, paths, nodesById);
  dedupeGroupedProfileContextEdges(edges, paths);
  mergeDuplicateTransferEdges(edges, paths);
  removeNoTxTransferDuplicates(edges, paths);
  annotateGraphDerivedMetrics(nodesById, edges, paths, weights, job.kind);
  const summaryDecision = decision(result["decision"]);
  const riskClarity = buildRiskClaritySummary({
    kind: job.kind,
    executionStatus: riskClarityExecutionStatus(summary.status),
    finalRiskScore: riskScore,
    explicitDecision: summaryDecision,
    missingChecks: stringArrayFromUnknown(result["missingChecks"]),
    coveragePartial: summary.status === "partial",
    fetchedAddressCount: null,
    hardEvidenceObserved: hardEvidenceObserved(result, {}),
    evidenceHints: evidenceHintsFromResult(result, {})
  });

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: senderAddress,
        displayLabel: null,
        knownLabels: [],
        role: "sender"
      },
      summary: {
        decision: summaryDecision,
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        riskClarity,
        confidence: confidenceFromNumber(riskScore),
        coverageRatio: numberField(result, "originCoverage"),
        checkedScope: originPaths.length > 0 ? "incoming_deposit_origin" : null,
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary,
        contractDrivenCampaign: null,
        selectedAmountRaw: stringField(progress, "amountRaw"),
        targetAmountRaw: null,
        topReasons: stringArrayField(result, "reasons")
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: evidenceRefs(job.rawEvidenceIds, paths, edges)
    }
  };
}

export function projectForensicJobGraph(job: ForensicCheckJob): AdminForensicsProjectionResult {
  const summary = completedJobSummary(job);
  if (!summary) {
    if (isWaitingForTargetedIndex(job)) {
      return projectWhereTargetedIndexProgressJob(job, jobSummary(job));
    }
    return {
      ok: false,
      status: "not_ready",
      message: "Forensic graph is available after the job completes."
    };
  }
  if (job.kind === "address_fast_check") {
    return projectAddressFastCheckJob(job, summary);
  }
  if (job.kind === "where_is_money_check") {
    return projectWhereIsMoneyJob(job, summary);
  }
  if (job.kind === "address_deep_check") {
    return projectAddressDeepJob(job, summary);
  }
  if (job.kind === "incoming_deposit_check") {
    return projectIncomingDepositJob(job, summary);
  }
  return {
    ok: false,
    status: "unsupported",
    message: `Graph projection is not implemented for ${job.kind}.`
  };
}
