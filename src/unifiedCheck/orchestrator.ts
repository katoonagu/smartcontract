import { fingerprintCanonicalJson } from "../forensics/canonicalJson";
import type {
  AnalysisManifestV1,
  ChildAttemptArtifactV1,
  EvidenceBundleV1,
  ScoringBundleV1,
  TraversalClosureCertificateV1,
  UnifiedBranchStatus,
  UnifiedWalletReportV1
} from "./contracts";
import type { AnalysisRunRecord } from "./requestService";

export type MinimalBranchResult = {
  readonly branchId: "fast" | "deep" | "where";
  readonly attemptId: string;
  readonly inputHash: string;
  readonly status: Extract<UnifiedBranchStatus, "COMPLETED" | "NOT_APPLICABLE">;
  readonly output: unknown | null;
  readonly createdAt: string;
};

type CompletedSlice = {
  readonly status: "COMPLETED";
  readonly manifest: AnalysisManifestV1;
  readonly evidence: EvidenceBundleV1;
  readonly closure: TraversalClosureCertificateV1;
  readonly scoring: ScoringBundleV1;
  readonly report: UnifiedWalletReportV1;
  readonly frontier: readonly never[];
  readonly artifacts: ReadonlyMap<string, unknown>;
  readonly delivery: null;
  readonly fingerprint: typeof fingerprintCanonicalJson;
};

function add(artifacts: Map<string, unknown>, artifact: unknown): string {
  const sha256 = fingerprintCanonicalJson(artifact);
  const prior = artifacts.get(sha256);
  if (prior !== undefined && fingerprintCanonicalJson(prior) !== sha256) {
    throw new Error("unified_artifact_hash_collision");
  }
  artifacts.set(sha256, artifact);
  return sha256;
}

function requireArtifact(artifacts: Map<string, unknown>, sha256: string, code: string): void {
  if (!artifacts.has(sha256)) throw new Error(code);
}

export async function completeMinimalUnifiedCheck(input: {
  run: AnalysisRunRecord;
  branches: readonly MinimalBranchResult[];
  commit?: (candidate: CompletedSlice) => Promise<void>;
}): Promise<CompletedSlice> {
  if (input.run.status !== "RUNNING") throw new Error("unified_run_not_running");
  if (fingerprintCanonicalJson(input.run.analysisManifest) !== input.run.analysisManifestSha256) {
    throw new Error("unified_analysis_manifest_hash_mismatch");
  }
  const byBranch = new Map(input.branches.map((branch) => [branch.branchId, branch]));
  if (byBranch.size !== 3 || !["fast", "deep", "where"].every((branch) => byBranch.has(branch as MinimalBranchResult["branchId"]))) {
    throw new Error("unified_incomplete_branch_set");
  }

  const artifacts = new Map<string, unknown>();
  add(artifacts, input.run.analysisManifest);
  for (const branchId of ["fast", "deep", "where"] as const) {
    const branch = byBranch.get(branchId)!;
    if (branch.inputHash !== input.run.analysisManifest.branchArtifactHashes[branchId]) {
      throw new Error(`unified_branch_input_mismatch:${branchId}`);
    }
    const outputHash = branch.output === null ? null : add(artifacts, branch.output);
    const attempt: ChildAttemptArtifactV1 = {
      version: "child-attempt-artifact-v1",
      schemaVersion: 1,
      runId: input.run.id,
      branchId,
      attemptId: branch.attemptId,
      previousAttemptHash: null,
      inputHash: branch.inputHash,
      outputHash,
      status: branch.status,
      createdAt: branch.createdAt
    };
    add(artifacts, attempt);
  }

  const neutralFact = {
    version: "canonical-fact-v1",
    id: fingerprintCanonicalJson([
      "canonical-fact-key-v1",
      "state",
      "tron",
      "neutral_no_observed_risk",
      input.run.subjectAddress,
      "none",
      "subject",
      "not_applicable",
      input.run.snapshotHash
    ]),
    lane: "neutral",
    code: "neutral_no_observed_risk",
    subjectAddress: input.run.subjectAddress
  } as const;
  const facts = { version: "canonical-fact-inventory-v1", facts: [neutralFact] } as const;
  const canonicalFactsHash = add(artifacts, facts);
  const manifestHash = input.run.analysisManifestSha256;
  const evidence: EvidenceBundleV1 = {
    version: "evidence-bundle-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    canonicalFactsHash,
    canonicalFactIds: [neutralFact.id]
  };
  const evidenceHash = add(artifacts, evidence);
  const visited = { version: "traversal-visited-state-v1", states: [input.run.subjectAddress] };
  const frontier = { version: "traversal-frontier-v1", states: [] };
  const visitedHash = add(artifacts, visited);
  const frontierHash = add(artifacts, frontier);
  const closure: TraversalClosureCertificateV1 = {
    version: "traversal-closure-certificate-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    snapshotHash: input.run.snapshotHash,
    visitedStateHash: visitedHash,
    frontierHash,
    closed: true
  };
  const closureHash = add(artifacts, closure);
  const scoreAnchor = {
    version: "score-anchor-v3",
    policyVersion: "scoring-signal-matrix-v4",
    subjectAddress: input.run.subjectAddress,
    mode: "unified",
    score: 0,
    decision: "ACCEPTABLE",
    matrixRow: "neutral_no_observed_risk",
    canonicalFactIds: [neutralFact.id]
  } as const;
  const scoreAnchorHash = add(artifacts, scoreAnchor);
  const scoring: ScoringBundleV1 = {
    version: "scoring-bundle-v1",
    schemaVersion: 1,
    evidenceBundleHash: evidenceHash,
    traversalClosureHash: closureHash,
    policyVersion: "scoring-signal-matrix-v4",
    scoreAnchorHash,
    score: 0,
    decision: "ACCEPTABLE"
  };
  const scoringHash = add(artifacts, scoring);
  const factInventory = {
    version: "report-fact-inventory-v1",
    canonicalFactIds: [neutralFact.id]
  } as const;
  const factInventoryHash = add(artifacts, factInventory);
  const report: UnifiedWalletReportV1 = {
    version: "unified-wallet-report-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    evidenceBundleHash: evidenceHash,
    traversalClosureHash: closureHash,
    scoringBundleHash: scoringHash,
    subjectAddress: input.run.subjectAddress,
    score: 0,
    decision: "ACCEPTABLE",
    factInventoryHash
  };
  add(artifacts, report);

  for (const [hash, code] of [
    [evidence.analysisManifestHash, "unified_missing_analysis_manifest"],
    [evidence.canonicalFactsHash, "unified_missing_canonical_facts"],
    [closure.visitedStateHash, "unified_missing_visited_state"],
    [closure.frontierHash, "unified_missing_frontier"],
    [scoring.evidenceBundleHash, "unified_missing_evidence_bundle"],
    [scoring.traversalClosureHash, "unified_missing_closure"],
    [scoring.scoreAnchorHash, "unified_missing_score_anchor"],
    [report.scoringBundleHash, "unified_missing_scoring_bundle"],
    [report.factInventoryHash, "unified_missing_fact_inventory"]
  ] as const) requireArtifact(artifacts, hash, code);

  const completed: CompletedSlice = {
    status: "COMPLETED",
    manifest: input.run.analysisManifest,
    evidence,
    closure,
    scoring,
    report,
    frontier: [],
    artifacts,
    delivery: null,
    fingerprint: fingerprintCanonicalJson
  };
  await input.commit?.(completed);
  return completed;
}
