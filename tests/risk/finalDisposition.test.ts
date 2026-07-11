import { describe, expect, it } from "vitest";
import type { DecisionCoverage } from "../../src/types";
import type {
  MatrixCandidate,
  MatrixCandidateContext,
  MatrixDecision,
  MatrixEvidenceAuthority,
  MatrixScoringResult
} from "../../src/risk/scoringSignalMatrix";
import { scoreMatrixCandidates } from "../../src/risk/scoringSignalMatrix";
import { resolveFinalDisposition } from "../../src/risk/finalDisposition";

const address = "TDisposition11111111111111111111111";
const otherAddress = "TOtherDisposition111111111111111111";

const coverage = (
  required: DecisionCoverage["required"],
  overall: DecisionCoverage["overall"] = "complete"
): DecisionCoverage => ({
  required,
  overall,
  invalidModes: required === "invalid" ? ["where_is_money"] : [],
  caveats: required === "invalid" ? ["where provenance incomplete"] : []
});

const matrixContext = (subjectAddress: string): MatrixCandidateContext => ({
  decisionScope: "wallet_unified",
  subjectAddress,
  subjectTxHash: null,
  requiredCoverage: "wallet_provenance"
});

const matrixCandidate = (
  subjectAddress: string,
  input: Partial<MatrixCandidate> = {},
  authority: MatrixEvidenceAuthority = { kind: "context" }
): MatrixCandidate => ({
  row: "behavior_only_prior",
  actionUnit: "wallet",
  score: 45,
  evidenceIds: ["evidence:1"],
  evidenceEpisodeIds: ["episode:1"],
  atomicSignals: ["context"],
  modifiers: [],
  caps: [],
  dampeners: [],
  caveats: [],
  subject: {
    decisionScope: "wallet_unified",
    address: subjectAddress,
    txHash: null
  },
  authority,
  ...input
});

function matrixResult(subjectAddress: string, decision: MatrixDecision, score: number | null): MatrixScoringResult {
  if (decision === "INSUFFICIENT_EVIDENCE") {
    return scoreMatrixCandidates([matrixCandidate(subjectAddress, {
      row: "coverage_uncertainty",
      score: 0
    }, { kind: "coverage", coverageDependency: "wallet_provenance" })], matrixContext(subjectAddress));
  }
  if (decision === "DECLINE") {
    return scoreMatrixCandidates([matrixCandidate(subjectAddress, {
      row: "source_policy",
      actionUnit: "source_path",
      score: score ?? 70
    }, {
      kind: "policy",
      decisionEligibility: "can_decline",
      coverageDependency: "wallet_provenance"
    })], matrixContext(subjectAddress));
  }
  if (decision === "ACCEPTABLE") {
    return scoreMatrixCandidates([matrixCandidate(subjectAddress, {
      row: "clean_or_operational",
      score: score ?? 10
    }, { kind: "clean", coverageDependency: "wallet_provenance" })], matrixContext(subjectAddress));
  }
  return scoreMatrixCandidates([matrixCandidate(subjectAddress, { score: score ?? 45 })], matrixContext(subjectAddress));
}

const hardMatrix = (subjectAddress: string, score: number): MatrixScoringResult => scoreMatrixCandidates([
  matrixCandidate(subjectAddress, {
    row: "hard_proof",
    score,
    modifiers: ["hard_anchor"]
  }, { kind: "exact_hard", proofSource: "stablecoin_restriction" })
], matrixContext(subjectAddress));

const contextMatrix = (subjectAddress: string, score: number): MatrixScoringResult =>
  scoreMatrixCandidates([matrixCandidate(subjectAddress, { score })], matrixContext(subjectAddress));

const directPolicyMatrix = (subjectAddress: string, score = 60): MatrixScoringResult =>
  scoreMatrixCandidates([matrixCandidate(subjectAddress, {
    row: "direct_counterparty_policy",
    score
  }, {
    kind: "policy",
    decisionEligibility: "can_decline",
    coverageDependency: "none"
  })], matrixContext(subjectAddress));

describe("resolveFinalDisposition", () => {
  it("keeps exact hard DECLINE when unrelated coverage is partial", () => {
    const result = resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore: hardMatrix(address, 95),
      coverage: coverage("invalid", "partial"),
      observedContextScore: 45
    });

    expect(result).toMatchObject({
      decision: "DECLINE",
      finalScore: 95,
      observedContextScore: 45,
      scoreValid: true,
      decisionBasis: "exact_hard_proof",
      coverage: { overall: "partial", invalidModes: ["where_is_money"] },
      hardProofEvidenceIds: ["evidence:1"]
    });
  });

  it("returns no final score for invalid required coverage without hard proof", () => {
    expect(resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore: contextMatrix(address, 59),
      coverage: coverage("invalid", "partial"),
      observedContextScore: 90
    })).toMatchObject({
      decision: "NO_FINAL_DECISION",
      finalScore: null,
      observedContextScore: 90,
      scoreValid: false,
      decisionBasis: "technical_stop",
      hardProofEvidenceIds: []
    });
  });

  it("keeps structurally validated direct counterparty policy decisive through unrelated partial coverage", () => {
    expect(resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore: directPolicyMatrix(address, 73),
      coverage: coverage("invalid", "partial"),
      observedContextScore: 88
    })).toMatchObject({
      decision: "DECLINE",
      finalScore: 73,
      observedContextScore: 88,
      scoreValid: true,
      decisionBasis: "independent_policy",
      coverage: { required: "invalid", overall: "partial" },
      hardProofEvidenceIds: []
    });
  });

  it("keeps exact hard proof ahead of a higher-scoring independent direct policy", () => {
    const matrixScore = scoreMatrixCandidates([
      matrixCandidate(address, {
        row: "hard_proof",
        score: 80,
        evidenceIds: ["hard:1"],
        evidenceEpisodeIds: ["hard-episode"]
      }, { kind: "exact_hard", proofSource: "approval_drain_exact" }),
      matrixCandidate(address, {
        row: "direct_counterparty_policy",
        score: 90,
        evidenceIds: ["policy:1"],
        evidenceEpisodeIds: ["policy-episode"]
      }, { kind: "policy", decisionEligibility: "can_decline", coverageDependency: "none" })
    ], matrixContext(address));

    expect(resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore,
      coverage: coverage("invalid", "partial"),
      observedContextScore: 90
    })).toMatchObject({
      decision: "DECLINE",
      finalScore: 80,
      decisionBasis: "exact_hard_proof",
      hardProofEvidenceIds: ["hard:1"]
    });
  });

  it.each([
    ["score below decline threshold", 59, { kind: "policy", decisionEligibility: "can_decline", coverageDependency: "none" }],
    ["review-only authority", 80, { kind: "policy", decisionEligibility: "review_only", coverageDependency: "none" }],
    ["coverage-dependent authority", 80, { kind: "policy", decisionEligibility: "can_decline", coverageDependency: "wallet_provenance" }]
  ] as const)("does not bypass invalid coverage for direct policy with %s", (_label, score, authority) => {
    const matrixScore = scoreMatrixCandidates([matrixCandidate(address, {
      row: "direct_counterparty_policy",
      score
    }, authority)], matrixContext(address));

    expect(resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore,
      coverage: coverage("invalid", "partial"),
      observedContextScore: score
    })).toMatchObject({
      decision: "NO_FINAL_DECISION",
      finalScore: null,
      scoreValid: false,
      decisionBasis: "technical_stop"
    });
  });

  it.each([
    ["DECLINE", "DECLINE", 70],
    ["REVIEW", "REVIEW", 45],
    ["ACCEPTABLE", "ACCEPTABLE", 10],
    ["INSUFFICIENT_EVIDENCE", "NO_FINAL_DECISION", null]
  ] as const)("maps matrix %s losslessly to %s", (matrixDecision, decision, finalScore) => {
    const result = resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore: matrixResult(address, matrixDecision, finalScore),
      coverage: coverage("valid"),
      observedContextScore: 55
    });

    expect(result.decision).toBe(decision);
    expect(result.finalScore).toBe(finalScore);
  });

  it("ignores hard evidence linked to another subject", () => {
    const result = resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore: hardMatrix(otherAddress, 95),
      coverage: coverage("invalid", "partial"),
      observedContextScore: 55
    });

    expect(result.decision).toBe("NO_FINAL_DECISION");
    expect(result.hardProofEvidenceIds).toEqual([]);
  });

  it.each([
    ["review context", contextMatrix(otherAddress, 45)],
    ["decline policy", matrixResult(otherAddress, "DECLINE", 70)]
  ])("rejects a valid-coverage matrix %s linked to another subject", (_label, matrixScore) => {
    expect(resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore,
      coverage: coverage("valid"),
      observedContextScore: 55
    })).toMatchObject({
      decision: "NO_FINAL_DECISION",
      finalScore: null,
      scoreValid: false,
      decisionBasis: "technical_stop",
      hardProofEvidenceIds: []
    });
  });

  it("clamps observed context without changing a valid matrix result", () => {
    const result = resolveFinalDisposition({
      subject: { decisionScope: "wallet_unified", address, txHash: null },
      matrixScore: matrixResult(address, "REVIEW", 45),
      coverage: coverage("valid"),
      observedContextScore: 180.6
    });

    expect(result).toMatchObject({
      decision: "REVIEW",
      finalScore: 45,
      observedContextScore: 100,
      scoreValid: true,
      decisionBasis: "matrix"
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "normalizes non-finite observed context %s to zero",
    (observedContextScore) => {
      expect(resolveFinalDisposition({
        subject: { decisionScope: "wallet_unified", address, txHash: null },
        matrixScore: matrixResult(address, "REVIEW", 45),
        coverage: coverage("valid"),
        observedContextScore
      }).observedContextScore).toBe(0);
    }
  );
});
