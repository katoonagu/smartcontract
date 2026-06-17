import { createHash } from "node:crypto";
import { calculateRisk, type RiskSignal } from "./riskEngine";
import type {
  AddressLabel,
  RawEvidenceInput,
  RiskConfidence,
  RiskReport,
  RiskSeverity,
  RiskSignalGroup,
  RiskSignalObservationInput
} from "../types";

export const CURRENT_RISK_POLICY_VERSION = "2026-05-21-v1";
export const DEFAULT_CHAIN = "tron";

const criticalLabels = new Set(["scam", "reported_scam", "stolen_funds", "phishing", "mixer_like", "risky_contract", "whitebit", "darknet_exchange"]);
const highRiskLabels = new Set(["darknet_exchange_proximity", "approval_drain_proximity"]);
const mitigatingLabels = new Set(["trusted", "false_positive"]);
const contextOnlyLabels = new Set(["victim"]);

export type RiskEvaluationContext = {
  subjectAddress: string;
  subjectTxHash?: string | null;
  observedTransactionHash?: string | null;
  chain?: string;
  policyVersion?: string;
};

export type RiskEvaluation = {
  report: RiskReport;
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
};

export type EvaluateAddressRiskInput = {
  context: RiskEvaluationContext;
  labels: AddressLabel[];
  graphSignals?: RiskSignal[];
  behaviorSignals?: RiskSignal[];
  amlSignals?: RiskSignal[];
};

type ReasonMetadata = {
  source: string;
  confidence: RiskConfidence;
  severity: RiskSeverity;
  evidenceRef: string | null;
  signalGroup: RiskSignalGroup;
};

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function labelScoreImpact(label: string): number {
  if (contextOnlyLabels.has(label)) return 0;
  if (mitigatingLabels.has(label)) return -40;
  if (highRiskLabels.has(label)) return 80;
  return criticalLabels.has(label) ? 90 : 35;
}

function labelSeverity(label: string): RiskSeverity {
  if (contextOnlyLabels.has(label)) return "info";
  if (mitigatingLabels.has(label)) return "info";
  if (highRiskLabels.has(label)) return "high";
  return criticalLabels.has(label) ? "critical" : "medium";
}

function labelConfidence(label: AddressLabel): RiskConfidence {
  if (label.label === "darknet_exchange_proximity" || label.label === "approval_drain_proximity") return "high";
  return label.source === "service_admin" ? "high" : "medium";
}

function inferSignalGroup(signal: RiskSignal, fallback: RiskSignalGroup): RiskSignalGroup {
  if (signal.source?.startsWith("graph")) return "graph";
  if (signal.source?.startsWith("aml")) return "provider";
  if (signal.source?.startsWith("provider")) return "provider";
  if (signal.source?.startsWith("incoming")) return "incoming_context";
  if (signal.source?.startsWith("approval")) return "approval";
  return fallback;
}

function buildSignalMetadata(
  graphSignals: RiskSignal[],
  behaviorSignals: RiskSignal[],
  amlSignals: RiskSignal[]
): Map<string, ReasonMetadata> {
  const metadata = new Map<string, ReasonMetadata>();
  const add = (signal: RiskSignal, signalGroup: RiskSignalGroup) => {
    metadata.set(signal.code, {
      source: signal.source ?? signalGroup,
      confidence: signal.confidence ?? "medium",
      severity: signal.severity ?? "medium",
      evidenceRef: signal.evidenceRef ?? null,
      signalGroup: inferSignalGroup(signal, signalGroup)
    });
  };

  graphSignals.forEach((signal) => add(signal, "graph"));
  behaviorSignals.forEach((signal) => add(signal, "behavior"));
  amlSignals.forEach((signal) => add(signal, "provider"));
  return metadata;
}

function enrichReportReasons(input: {
  report: RiskReport;
  labels: AddressLabel[];
  signalMetadata: Map<string, ReasonMetadata>;
  chain: string;
}): RiskReport {
  const labelMetadata = new Map<string, ReasonMetadata>();
  for (const label of input.labels) {
    const code = `internal_label_${label.label}`;
    const evidenceRef = stableId([
      "raw",
      input.chain,
      label.address,
      "internal_label",
      label.label,
      label.source,
      label.createdAt.toISOString()
    ]);
    labelMetadata.set(code, {
      source: label.source,
      confidence: labelConfidence(label),
      severity: labelSeverity(label.label),
      evidenceRef,
      signalGroup: "internal_label"
    });
  }

  return {
    ...input.report,
    reasons: input.report.reasons.map((reason) => {
      const metadata = labelMetadata.get(reason.code) ?? input.signalMetadata.get(reason.code);
      if (!metadata) {
        return {
          ...reason,
          source: reason.source ?? "risk_engine",
          confidence: reason.confidence ?? "medium",
          severity: reason.severity ?? "medium"
        };
      }
      return {
        ...reason,
        source: reason.source ?? metadata.source,
        confidence: reason.confidence ?? metadata.confidence,
        severity: reason.severity ?? metadata.severity,
        evidenceRef: reason.evidenceRef ?? metadata.evidenceRef ?? undefined
      };
    })
  };
}

function rawEvidenceFromLabels(input: {
  labels: AddressLabel[];
  chain: string;
  observedTransactionHash: string | null;
}): RawEvidenceInput[] {
  return input.labels.map((label) => ({
    id: stableId([
      "raw",
      input.chain,
      label.address,
      "internal_label",
      label.label,
      label.source,
      label.createdAt.toISOString()
    ]),
    source: label.source,
    sourceType: "internal_label",
    chain: input.chain,
    address: label.address,
    txHash: null,
    observedTransactionHash: input.observedTransactionHash,
    evidenceJson: {
      label: label.label,
      source: label.source,
      createdByTelegramId: label.createdByTelegramId,
      createdAt: label.createdAt.toISOString()
    }
  }));
}

function observationFromReason(input: {
  reason: RiskReport["reasons"][number];
  signalGroup: RiskSignalGroup;
  context: Required<Pick<RiskEvaluationContext, "subjectAddress">> & RiskEvaluationContext;
  chain: string;
  policyVersion: string;
}): RiskSignalObservationInput {
  return {
    id: stableId([
      "observation",
      input.chain,
      input.context.subjectAddress,
      input.context.subjectTxHash ?? null,
      input.context.observedTransactionHash ?? null,
      input.reason.code,
      input.policyVersion
    ]),
    subjectChain: input.chain,
    subjectAddress: input.context.subjectAddress,
    subjectTxHash: input.context.subjectTxHash ?? null,
    observedTransactionHash: input.context.observedTransactionHash ?? null,
    signalGroup: input.signalGroup,
    code: input.reason.code,
    message: input.reason.message,
    scoreImpact: input.reason.scoreImpact,
    confidence: input.reason.confidence ?? "medium",
    severity: input.reason.severity ?? "medium",
    source: input.reason.source ?? "risk_engine",
    policyVersion: input.policyVersion,
    rawEvidenceId: input.reason.evidenceRef ?? null
  };
}

function groupForReason(reason: RiskReport["reasons"][number], metadata: Map<string, ReasonMetadata>): RiskSignalGroup {
  if (reason.code.startsWith("internal_label_")) return "internal_label";
  return metadata.get(reason.code)?.signalGroup ?? "behavior";
}

export function evaluateAddressRisk(input: EvaluateAddressRiskInput): RiskEvaluation {
  const chain = input.context.chain ?? DEFAULT_CHAIN;
  const policyVersion = input.context.policyVersion ?? CURRENT_RISK_POLICY_VERSION;
  const graphSignals = input.graphSignals ?? [];
  const behaviorSignals = input.behaviorSignals ?? [];
  const amlSignals = input.amlSignals ?? [];
  const signalMetadata = buildSignalMetadata(graphSignals, behaviorSignals, amlSignals);
  const rawEvidence = rawEvidenceFromLabels({
    labels: input.labels,
    chain,
    observedTransactionHash: input.context.observedTransactionHash ?? null
  });
  const report = enrichReportReasons({
    report: calculateRisk({
      subjectAddress: input.context.subjectAddress,
      labels: input.labels,
      graphSignals,
      behaviorSignals,
      amlSignals
    }),
    labels: input.labels,
    signalMetadata,
    chain
  });
  const observations = report.reasons.map((reason) =>
    observationFromReason({
      reason,
      signalGroup: groupForReason(reason, signalMetadata),
      context: input.context,
      chain,
      policyVersion
    })
  );

  return { report, rawEvidence, observations };
}
