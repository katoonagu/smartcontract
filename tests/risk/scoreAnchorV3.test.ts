import { describe, expect, it } from "vitest";
import {
  buildScoreAnchorV3,
  validateScoreAnchorV3
} from "../../src/risk/scoreAnchorV3";
import {
  scoreSignalMatrixV4,
  type ScoringFactV4
} from "../../src/risk/scoringSignalMatrixV4";
import { canonicalizeEvidenceFacts } from "../../src/unifiedCheck/canonicalFacts";

const subjectAddress = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const hardFact: ScoringFactV4 = canonicalizeEvidenceFacts({ facts: [{
  profile: "event",
  chain: "tron",
  tokenContract: "USDT",
  txHash: "a".repeat(64),
  eventIndex: 1,
  factType: "blacklisted_at_transfer",
  subject: subjectAddress,
  counterparty: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
  subjectRole: "receiver",
  lane: "hard",
  strength: "exact",
  sourceBranch: "deep",
  payload: null,
  directness: "direct",
  timing: "at_event"
}] }).inventory.facts[0]!;

describe("ScoreAnchorV3", () => {
  it("binds one active v4 anchor to the exact subject and canonical facts", () => {
    const matrix = scoreSignalMatrixV4({
      subjectAddress,
      facts: [hardFact]
    });
    const anchor = buildScoreAnchorV3({ subjectAddress, matrix });
    expect(anchor).toMatchObject({
      version: "score-anchor-v3",
      policyVersion: "scoring-signal-matrix-v4",
      subjectAddress,
      score: 90,
      decision: "DECLINE"
    });
    expect(validateScoreAnchorV3({
      anchor,
      subjectAddress,
      facts: matrix.facts,
      activeAnchors: [anchor]
    })).toBe(anchor);
    expect(anchor).not.toHaveProperty("coverageDependency");
  });

  it("rejects another subject, an unregistered row and multiple active anchors", () => {
    const matrix = scoreSignalMatrixV4({
      subjectAddress,
      facts: [hardFact]
    });
    const anchor = buildScoreAnchorV3({ subjectAddress, matrix });
    expect(() => validateScoreAnchorV3({
      anchor: { ...anchor, subjectAddress: "other" },
      subjectAddress,
      facts: matrix.facts,
      activeAnchors: [anchor]
    })).toThrow("score_anchor_v3_fact_binding_failed");
    const forgedAuthority = {
      ...anchor,
      evidenceClass: "neutral",
      proofLevel: "contextual",
      authority: "behavior"
    };
    expect(() => validateScoreAnchorV3({
      anchor: forgedAuthority,
      subjectAddress,
      facts: matrix.facts,
      activeAnchors: [forgedAuthority]
    })).toThrow("score_anchor_v3_fact_binding_failed");
    expect(() => validateScoreAnchorV3({
      anchor: { ...anchor, matrixRow: "invented" },
      subjectAddress,
      facts: matrix.facts,
      activeAnchors: [anchor]
    })).toThrow("score_anchor_v3_fact_binding_failed");
    expect(() => validateScoreAnchorV3({
      anchor,
      subjectAddress,
      facts: matrix.facts,
      activeAnchors: [anchor, { ...anchor }]
    })).toThrow("score_anchor_v3_fact_binding_failed");
  });

  it("creates a bound neutral fact for an otherwise empty completed wallet", () => {
    const matrix = scoreSignalMatrixV4({
      subjectAddress,
      facts: [],
      neutralCandidate: "no_usdt_activity"
    });
    const anchor = buildScoreAnchorV3({ subjectAddress, matrix });
    expect(anchor.score).toBe(0);
    expect(anchor.canonicalFactIds).toHaveLength(1);
    expect(matrix.facts[0]?.factType).toBe("no_usdt_activity");
    expect(() => validateScoreAnchorV3({
      anchor,
      subjectAddress,
      facts: matrix.facts,
      activeAnchors: [anchor]
    })).not.toThrow();
  });
});
