import { describe, expect, it } from "vitest";
import { SCORING_POLICY_V4 } from "../../src/risk/scoringPolicyV4.generated";
import {
  scoreSignalMatrixV4,
  type ScoringFactV4
} from "../../src/risk/scoringSignalMatrixV4";

const subjectAddress = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";

function fact(
  id: string,
  overrides: Partial<ScoringFactV4> = {}
): ScoringFactV4 {
  return {
    version: "canonical-fact-v1",
    id,
    profile: "event",
    factType: "ordinary_transfer",
    subject: subjectAddress,
    subjectRole: "receiver",
    lane: "neutral",
    strength: "exact",
    sourceBranches: ["fast"],
    payload: null,
    directness: "direct",
    timing: "at_event",
    ...overrides
  };
}

describe("scoring signal matrix v4", () => {
  it("reproduces every adjudicated Golden score and decision", () => {
    for (const row of SCORING_POLICY_V4.rows) {
      const facts = row.facts.map((item) =>
        fact(item.canonicalFactId, {
          lane: item.lane,
          subjectRole: item.role,
          directness: item.directness,
          timing: item.timing
        })
      );
      const result = scoreSignalMatrixV4({
        subjectAddress,
        facts,
        goldenCaseId: row.rowId
      });
      expect(
        [result.score, result.decision],
        row.rowId
      ).toEqual([row.exactScore, row.expectedDecision]);
    }
  });

  it("is invariant to coverage, duplicate facts and input reorder", () => {
    const facts = [
      fact("pattern-a", {
        factType: "dense_fan_in_fan_out",
        lane: "pattern",
        strength: "corroborated"
      }),
      fact("safe-b")
    ];
    const left = scoreSignalMatrixV4({
      subjectAddress,
      facts,
      coverage: { depth: 1 }
    } as Parameters<typeof scoreSignalMatrixV4>[0] & { coverage: unknown });
    const right = scoreSignalMatrixV4({
      subjectAddress,
      facts: [facts[1]!, facts[0]!, facts[0]!],
      coverage: { depth: 999 }
    } as Parameters<typeof scoreSignalMatrixV4>[0] & { coverage: unknown });
    expect(right).toEqual(left);
  });

  it("does not let safe volume lower a hard floor", () => {
    const hard = fact("hard", {
      factType: "blacklisted_at_transfer",
      lane: "hard",
      subjectRole: "receiver"
    });
    const baseline = scoreSignalMatrixV4({ subjectAddress, facts: [hard] });
    const diluted = scoreSignalMatrixV4({
      subjectAddress,
      facts: [
        hard,
        ...Array.from({ length: 99 }, (_, index) => fact(`safe-${index}`))
      ]
    });
    expect(baseline).toMatchObject({ score: 90, decision: "DECLINE" });
    expect(diluted.score).toBe(baseline.score);
  });

  it("adds no risk for an unknown address without a correlated pattern", () => {
    const result = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact("unknown", {
        profile: "state",
        factType: "unknown_source",
        subjectRole: "subject"
      })],
      neutralCandidate: "unknown_without_risk_pattern"
    });
    expect(result).toMatchObject({
      score: 0,
      decision: "ACCEPTABLE",
      neutralCandidate: "unknown_without_risk_pattern"
    });
    expect(result.facts.some((item) =>
      item.factType === "unknown_without_risk_pattern"
    )).toBe(true);
  });

  it("keeps directness, event timing and victim role semantically distinct", () => {
    const base = {
      factType: "blacklisted_counterparty",
      lane: "hard" as const,
      subjectRole: "receiver",
      directness: "direct" as const,
      timing: "at_event" as const
    };
    const direct = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact("direct", base)]
    });
    const indirect = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact("indirect", { ...base, directness: "indirect" })]
    });
    const later = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact("later", { ...base, timing: "later" })]
    });
    const victim = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact("victim", { ...base, subjectRole: "victim" })]
    });
    expect(new Set([
      direct.score,
      indirect.score,
      later.score,
      victim.score
    ]).size).toBeGreaterThan(1);
    expect(direct.score).toBe(90);
    expect(victim.score).toBe(50);
  });

  it("uses adjudicated rows for approval without debit and confirmed victim debit", () => {
    expect(scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact("approval", {
        profile: "state",
        factType: "dangerous_unlimited_approval",
        lane: "pattern",
        subjectRole: "approval_owner"
      })]
    })).toMatchObject({ score: 55, decision: "REVIEW" });
    expect(scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact("victim-debit", {
        profile: "state",
        factType: "confirmed_victim_debit",
        lane: "hard",
        subjectRole: "victim"
      })]
    })).toMatchObject({ score: 50, decision: "REVIEW" });
  });
});
