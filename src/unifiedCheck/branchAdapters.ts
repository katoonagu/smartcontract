import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../types";
import type { AnalysisManifestV1 } from "./contracts";

export type UnifiedBranchContext = {
  readonly runId: string;
  readonly manifest: AnalysisManifestV1;
  readonly directHistoryArtifactSha256: string;
  readonly directEvents: readonly IndexedTronUsdtTransfer[];
  readonly labelsDatasetSha256: string;
  readonly deliveryAuthority: false;
};

export type UnifiedDiagnosticScore = {
  readonly authority: "diagnostic";
  readonly value: number;
  readonly source: string;
};

export type UnifiedBranchAnalysis = {
  readonly evidence: readonly unknown[];
  readonly facts: readonly unknown[];
  readonly patterns: readonly unknown[];
  readonly boundaries: readonly unknown[];
  readonly roles: readonly unknown[];
  readonly candidates: readonly unknown[];
  readonly diagnosticScore?: UnifiedDiagnosticScore | null;
};

export type UnifiedBranchArtifactV1 = {
  readonly version: "unified-branch-artifact-v1";
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly branchId: "fast" | "where" | "deep";
  readonly status: "COMPLETED";
  readonly scopeStatus: {
    readonly provenance: "COMPLETED" | "NOT_APPLICABLE";
    readonly security: "COMPLETED";
  };
  readonly snapshotHash: string;
  readonly directHistoryArtifactSha256: string;
  readonly directEventIndexHash: string;
  readonly labelsDatasetSha256: string;
  readonly deliveryAuthority: false;
  readonly analysis: UnifiedBranchAnalysis;
};

const ANALYSIS_KEYS = [
  "evidence",
  "facts",
  "patterns",
  "boundaries",
  "roles",
  "candidates",
  "diagnosticScore"
] as const;

function validateAnalysis(value: UnifiedBranchAnalysis): void {
  const record = value as unknown as Record<string, unknown>;
  if (
    Object.keys(record).some((key) =>
      !ANALYSIS_KEYS.includes(key as typeof ANALYSIS_KEYS[number])
    ) ||
    ![
      value.evidence,
      value.facts,
      value.patterns,
      value.boundaries,
      value.roles,
      value.candidates
    ].every(Array.isArray)
  ) {
    throw new TypeError("unified_branch_analysis_invalid");
  }
  if (
    value.diagnosticScore !== undefined &&
    value.diagnosticScore !== null &&
    (
      value.diagnosticScore.authority !== "diagnostic" ||
      !Number.isInteger(value.diagnosticScore.value) ||
      value.diagnosticScore.value < 0 ||
      value.diagnosticScore.value > 100 ||
      value.diagnosticScore.source.trim().length === 0
    )
  ) {
    throw new TypeError("unified_branch_diagnostic_score_invalid");
  }
  fingerprintCanonicalArtifact(value);
}

function validateContext(context: UnifiedBranchContext): void {
  if (
    context.deliveryAuthority !== false ||
    context.runId !== context.manifest.runId ||
    context.labelsDatasetSha256 !== context.manifest.labelDatasetSha256 ||
    !/^[0-9a-f]{64}$/u.test(context.directHistoryArtifactSha256)
  ) {
    throw new Error("unified_branch_context_mismatch");
  }
}

function directEventIndexHash(
  events: readonly IndexedTronUsdtTransfer[]
): string {
  return fingerprintCanonicalArtifact(
    [...new Set(events.map((event) => canonicalTronUsdtEventKey(event)))].sort()
  );
}

async function runBranch(
  branchId: "fast" | "where" | "deep",
  context: UnifiedBranchContext,
  analyze: (context: UnifiedBranchContext) => Promise<UnifiedBranchAnalysis>
): Promise<UnifiedBranchArtifactV1> {
  validateContext(context);
  const analysis = await analyze(context);
  validateAnalysis(analysis);
  return {
    version: "unified-branch-artifact-v1",
    schemaVersion: 1,
    runId: context.runId,
    branchId,
    status: "COMPLETED",
    scopeStatus: {
      provenance: context.directEvents.length === 0
        ? "NOT_APPLICABLE"
        : "COMPLETED",
      security: "COMPLETED"
    },
    snapshotHash: context.manifest.snapshotHash,
    directHistoryArtifactSha256: context.directHistoryArtifactSha256,
    directEventIndexHash: directEventIndexHash(context.directEvents),
    labelsDatasetSha256: context.labelsDatasetSha256,
    deliveryAuthority: false,
    analysis
  };
}

export function runUnifiedFastBranch(input: {
  context: UnifiedBranchContext;
  analyze: (context: UnifiedBranchContext) => Promise<UnifiedBranchAnalysis>;
}): Promise<UnifiedBranchArtifactV1> {
  return runBranch("fast", input.context, input.analyze);
}

export function runUnifiedWhereBranch(input: {
  context: UnifiedBranchContext;
  analyze: (context: UnifiedBranchContext) => Promise<UnifiedBranchAnalysis>;
}): Promise<UnifiedBranchArtifactV1> {
  return runBranch("where", input.context, input.analyze);
}

export function runUnifiedDeepBranch(input: {
  context: UnifiedBranchContext;
  analyze: (context: UnifiedBranchContext) => Promise<UnifiedBranchAnalysis>;
}): Promise<UnifiedBranchArtifactV1> {
  return runBranch("deep", input.context, input.analyze);
}
