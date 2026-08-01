import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { buildScoreAnchorV3 } from "../risk/scoreAnchorV3";
import { scoreSignalMatrixV4 } from "../risk/scoringSignalMatrixV4";
import type {
  AnalysisManifestV1,
  ChildAttemptArtifactV1,
  EvidenceBundleV1,
  ScoringBundleV1,
  TraversalClosureCertificateV1,
  UnifiedBranchStatus,
  UnifiedWalletReportV1
} from "./contracts";
import {
  buildUnifiedBranchInput,
  type AnalysisRunRecord
} from "./requestService";
import type { UnifiedWalletDossierV1 } from "./report";
import {
  renderRequiredUnifiedPresentations,
  type UnifiedPresentationResultV1
} from "./presentation";

export type MinimalBranchResult = {
  readonly branchId: "fast" | "deep" | "where";
  readonly attemptId: string;
  readonly inputHash: string;
  readonly status: Extract<UnifiedBranchStatus, "COMPLETED" | "NOT_APPLICABLE">;
  readonly output: unknown | null;
  readonly createdAt: string;
};

export type CompletedSlice = {
  readonly status: "COMPLETED";
  readonly manifest: AnalysisManifestV1;
  readonly evidence: EvidenceBundleV1;
  readonly closure: TraversalClosureCertificateV1;
  readonly scoring: ScoringBundleV1;
  readonly report: UnifiedWalletReportV1;
  readonly frontier: readonly never[];
  readonly artifacts: ReadonlyMap<string, unknown>;
  readonly artifactKinds: ReadonlyMap<string, string>;
  readonly hashes: {
    readonly evidence: string;
    readonly closure: string;
    readonly scoring: string;
    readonly report: string;
  };
  readonly delivery: null;
  readonly fingerprint: typeof fingerprintCanonicalArtifact;
};

export type UnifiedInitialRecipientV1 = {
  readonly requestId: string;
  readonly deliveryId: string;
  readonly locale: "ru" | "en";
};

export type UnifiedPresentedCompletionCandidateV1 = {
  readonly report: UnifiedWalletDossierV1;
  readonly reportHash: string;
  readonly deliveries: readonly {
    readonly requestId: string;
    readonly deliveryId: string;
    readonly presentation: UnifiedPresentationResultV1;
  }[];
};

function add(
  artifacts: Map<string, unknown>,
  kinds: Map<string, string>,
  kind: string,
  artifact: unknown
): string {
  const sha256 = fingerprintCanonicalArtifact(artifact);
  const prior = artifacts.get(sha256);
  if (prior !== undefined && fingerprintCanonicalArtifact(prior) !== sha256) {
    throw new Error("unified_artifact_hash_collision");
  }
  artifacts.set(sha256, artifact);
  const priorKind = kinds.get(sha256);
  if (priorKind !== undefined && priorKind !== kind) {
    throw new Error("unified_artifact_kind_collision");
  }
  kinds.set(sha256, kind);
  return sha256;
}

function requireArtifact(artifacts: Map<string, unknown>, sha256: string, code: string): void {
  if (!artifacts.has(sha256)) throw new Error(code);
}

export function buildMinimalUnifiedCheckCandidate(input: {
  run: AnalysisRunRecord;
  branches: readonly MinimalBranchResult[];
}): CompletedSlice {
  if (input.run.status !== "RUNNING") throw new Error("unified_run_not_running");
  if (
    input.run.runPurpose !== "synthetic_test" ||
    input.run.sideEffectPolicy !== "isolated"
  ) {
    throw new Error("unified_minimal_slice_must_be_isolated_synthetic");
  }
  if (fingerprintCanonicalArtifact(input.run.analysisManifest) !== input.run.analysisManifestSha256) {
    throw new Error("unified_analysis_manifest_hash_mismatch");
  }
  const byBranch = new Map(input.branches.map((branch) => [branch.branchId, branch]));
  if (byBranch.size !== 3 || !["fast", "deep", "where"].every((branch) => byBranch.has(branch as MinimalBranchResult["branchId"]))) {
    throw new Error("unified_incomplete_branch_set");
  }

  const artifacts = new Map<string, unknown>();
  const artifactKinds = new Map<string, string>();
  if (fingerprintCanonicalArtifact(input.run.snapshot) !== input.run.snapshotHash) {
    throw new Error("unified_snapshot_hash_mismatch");
  }
  if (
    input.run.analysisManifest.snapshotHash !== input.run.snapshotHash ||
    input.run.analysisManifest.subjectAddress !== input.run.subjectAddress
  ) {
    throw new Error("unified_manifest_snapshot_mismatch");
  }
  add(artifacts, artifactKinds, "confirmed_snapshot", input.run.snapshot);
  add(artifacts, artifactKinds, "analysis_manifest", input.run.analysisManifest);
  const acceptedChildAttemptHashes = {} as Record<"fast" | "deep" | "where", string>;
  const branchOutputHashes = {} as Record<"fast" | "deep" | "where", string | null>;
  for (const branchId of ["fast", "deep", "where"] as const) {
    const branch = byBranch.get(branchId)!;
    const branchInput = buildUnifiedBranchInput(
      branchId,
      input.run.snapshotHash,
      {
        labelDatasetSha256: input.run.analysisManifest.labelDatasetSha256,
        scoringPolicyVersion: input.run.analysisManifest.scoringPolicyVersion,
        attributionPolicyVersion: input.run.analysisManifest.attributionPolicyVersion,
        traversalPolicyVersion: input.run.analysisManifest.traversalPolicyVersion,
        runtimeCommit: input.run.analysisManifest.runtimeCommit,
        schemaVersion: input.run.analysisManifest.databaseSchemaVersion
      }
    );
    const branchInputArtifactHash = add(
      artifacts,
      artifactKinds,
      `${branchId}_branch_input`,
      branchInput
    );
    if (branch.inputHash !== input.run.analysisManifest.branchArtifactHashes[branchId]) {
      throw new Error(`unified_branch_input_mismatch:${branchId}`);
    }
    if (branchInputArtifactHash !== branch.inputHash) {
      throw new Error(`unified_branch_input_artifact_mismatch:${branchId}`);
    }
    const outputHash = branch.output === null
      ? null
      : add(artifacts, artifactKinds, `${branchId}_branch_output`, {
          version: "branch-output-envelope-v1",
          schemaVersion: 1,
          runId: input.run.id,
          branchId,
          output: branch.output
        });
    branchOutputHashes[branchId] = outputHash;
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
    acceptedChildAttemptHashes[branchId] = add(
      artifacts,
      artifactKinds,
      "child_attempt",
      attempt
    );
  }

  const matrix = scoreSignalMatrixV4({
    subjectAddress: input.run.subjectAddress,
    facts: [],
    neutralCandidate: "neutral_no_observed_risk"
  });
  const facts = {
    version: "canonical-fact-inventory-v1",
    facts: matrix.facts
  } as const;
  const canonicalFactsHash = add(
    artifacts,
    artifactKinds,
    "canonical_facts",
    facts
  );
  const manifestHash = input.run.analysisManifestSha256;
  const evidence: EvidenceBundleV1 = {
    version: "evidence-bundle-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    canonicalFactsHash,
    canonicalFactIds: matrix.canonicalFactIds,
    acceptedChildAttemptHashes,
    branchOutputHashes
  };
  const evidenceHash = add(artifacts, artifactKinds, "evidence_bundle", evidence);
  const visited = { version: "traversal-visited-state-v1", states: [input.run.subjectAddress] };
  const frontier = { version: "traversal-frontier-v1", states: [] };
  const visitedHash = add(artifacts, artifactKinds, "traversal_visited", visited);
  const frontierHash = add(artifacts, artifactKinds, "traversal_frontier", frontier);
  const closure: TraversalClosureCertificateV1 = {
    version: "traversal-closure-certificate-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    snapshotHash: input.run.snapshotHash,
    visitedStateHash: visitedHash,
    frontierHash,
    closed: true
  };
  const closureHash = add(artifacts, artifactKinds, "traversal_closure", closure);
  const scoreAnchor = buildScoreAnchorV3({
    subjectAddress: input.run.subjectAddress,
    matrix
  });
  const scoreAnchorHash = add(artifacts, artifactKinds, "score_anchor", scoreAnchor);
  const scoring: ScoringBundleV1 = {
    version: "scoring-bundle-v1",
    schemaVersion: 1,
    evidenceBundleHash: evidenceHash,
    traversalClosureHash: closureHash,
    policyVersion: "scoring-signal-matrix-v4",
    scoreAnchorHash,
    score: matrix.score,
    decision: matrix.decision
  };
  const scoringHash = add(artifacts, artifactKinds, "scoring_bundle", scoring);
  const factInventory = {
    version: "report-fact-inventory-v1",
    canonicalFactIds: matrix.canonicalFactIds
  } as const;
  const factInventoryHash = add(
    artifacts,
    artifactKinds,
    "report_fact_inventory",
    factInventory
  );
  const report: UnifiedWalletReportV1 = {
    version: "unified-wallet-report-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    evidenceBundleHash: evidenceHash,
    traversalClosureHash: closureHash,
    scoringBundleHash: scoringHash,
    subjectAddress: input.run.subjectAddress,
    score: matrix.score,
    decision: matrix.decision,
    factInventoryHash
  };
  const reportHash = add(artifacts, artifactKinds, "unified_wallet_report", report);

  for (const [hash, code] of [
    [evidence.analysisManifestHash, "unified_missing_analysis_manifest"],
    [evidence.canonicalFactsHash, "unified_missing_canonical_facts"],
    ...Object.values(evidence.acceptedChildAttemptHashes)
      .map((hash) => [hash, "unified_missing_child_attempt"] as const),
    ...Object.values(evidence.branchOutputHashes)
      .filter((hash): hash is string => hash !== null)
      .map((hash) => [hash, "unified_missing_branch_output"] as const),
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
    artifactKinds,
    hashes: {
      evidence: evidenceHash,
      closure: closureHash,
      scoring: scoringHash,
      report: reportHash
    },
    delivery: null,
    fingerprint: fingerprintCanonicalArtifact
  };
  return completed;
}

export async function completeMinimalUnifiedCheck(input: {
  run: AnalysisRunRecord;
  branches: readonly MinimalBranchResult[];
  commit: (candidate: CompletedSlice) => Promise<void>;
}): Promise<CompletedSlice> {
  const candidate = buildMinimalUnifiedCheckCandidate(input);
  await input.commit(candidate);
  return candidate;
}

export function buildUnifiedPresentedCompletionCandidate(input: {
  readonly report: UnifiedWalletDossierV1;
  readonly recipients: readonly UnifiedInitialRecipientV1[];
}): UnifiedPresentedCompletionCandidateV1 {
  const recipients = [...input.recipients].sort((left, right) =>
    left.requestId.localeCompare(right.requestId)
  );
  if (
    recipients.length === 0 ||
    new Set(recipients.map((item) => item.requestId)).size !==
      recipients.length ||
    new Set(recipients.map((item) => item.deliveryId)).size !==
      recipients.length ||
    recipients.some((item) =>
      item.requestId.trim().length === 0 ||
      item.deliveryId.trim().length === 0
    )
  ) {
    throw new Error("unified_initial_recipients_invalid");
  }
  const presentations = renderRequiredUnifiedPresentations({
    report: input.report,
    locales: recipients.map((item) => item.locale)
  });
  const byLocale = new Map(
    presentations.map((presentation) => [
      presentation.manifest.locale,
      presentation
    ])
  );
  const reportHash = fingerprintCanonicalArtifact(input.report);
  const deliveries = recipients.map((recipient) => {
    const presentation = byLocale.get(recipient.locale);
    if (
      presentation === undefined ||
      presentation.manifest.reportHash !== reportHash ||
      presentation.receipt.presentationHash !==
        presentation.presentationHash
    ) {
      throw new Error("unified_initial_presentation_invalid");
    }
    return {
      requestId: recipient.requestId,
      deliveryId: recipient.deliveryId,
      presentation
    };
  });
  return { report: input.report, reportHash, deliveries };
}

export async function completeUnifiedPresentedCheck(input: {
  readonly report: UnifiedWalletDossierV1;
  readonly recipients: readonly UnifiedInitialRecipientV1[];
  readonly commit: (
    candidate: UnifiedPresentedCompletionCandidateV1
  ) => Promise<void>;
}): Promise<UnifiedPresentedCompletionCandidateV1> {
  const candidate = buildUnifiedPresentedCompletionCandidate(input);
  await input.commit(candidate);
  return candidate;
}
