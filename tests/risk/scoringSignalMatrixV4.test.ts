import { describe, expect, it } from "vitest";
import {
  canonicalizeEvidenceFacts,
  type CanonicalFactInput,
  type CanonicalFactV1
} from "../../src/unifiedCheck/canonicalFacts";
import { scoreSignalMatrixV4 } from "../../src/risk/scoringSignalMatrixV4";

const subjectAddress = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
let sequence = 0;

function fact(overrides: Partial<CanonicalFactInput> = {}): CanonicalFactV1 {
  sequence += 1;
  const input: CanonicalFactInput = {
    profile: "state",
    chain: "tron",
    factType: `ordinary_transfer_${sequence}`,
    subject: subjectAddress,
    counterpartyOrObject: null,
    subjectRole: "subject",
    effectiveAt: null,
    snapshotBlock: "84713573",
    lane: "neutral",
    strength: "exact",
    sourceBranch: "fast",
    directness: "direct",
    timing: "current",
    payload: null,
    ...overrides
  } as CanonicalFactInput;
  return canonicalizeEvidenceFacts({ facts: [input] }).inventory.facts[0]!;
}

describe("scoring signal matrix v4", () => {
  it("is invariant to coverage, duplicate facts and input reorder", () => {
    const facts = [
      fact({
        factType: "dense_fan_in_fan_out",
        lane: "pattern",
        strength: "corroborated"
      }),
      fact()
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

  it("does not let safe volume lower a semantically bound hard floor", () => {
    const hard = fact({
      profile: "event",
      tokenContract: "USDT",
      txHash: "a".repeat(64),
      eventIndex: 1,
      counterparty: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
      factType: "blacklisted_at_transfer",
      lane: "hard",
      subjectRole: "receiver",
      directness: "direct",
      timing: "at_event"
    });
    const baseline = scoreSignalMatrixV4({ subjectAddress, facts: [hard] });
    const diluted = scoreSignalMatrixV4({
      subjectAddress,
      facts: [
        hard,
        ...Array.from({ length: 99 }, () => fact())
      ]
    });
    expect(baseline).toMatchObject({
      score: 90,
      decision: "DECLINE",
      matrixRow: "direct_blacklist_at_event"
    });
    expect(diluted.score).toBe(baseline.score);
  });

  it("does not trust a caller lane without an allowlisted semantic fact", () => {
    const forgedClassification = fact({
      factType: "ordinary_transfer",
      lane: "hard",
      strength: "exact",
      subjectRole: "receiver",
      directness: "direct",
      timing: "at_event"
    });
    expect(scoreSignalMatrixV4({
      subjectAddress,
      facts: [forgedClassification]
    })).toMatchObject({
      score: 0,
      decision: "ACCEPTABLE",
      matrixRow: "neutral_no_observed_risk"
    });
  });

  it("adds no risk for an unknown address without a correlated pattern", () => {
    const result = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact({
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
    const direct = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact({
        profile: "event",
        tokenContract: "USDT",
        txHash: "b".repeat(64),
        eventIndex: 1,
        counterparty: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
        factType: "blacklisted_at_transfer",
        lane: "hard",
        subjectRole: "receiver",
        directness: "direct",
        timing: "at_event"
      })]
    });
    const indirect = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact({
        profile: "path",
        chain: "tron",
        orderedEventFactIds: ["event-a"],
        factType: "indirect_blacklist_relation",
        lane: "context",
        strength: "corroborated",
        subjectRole: "receiver",
        directness: "indirect",
        timing: "at_event"
      })]
    });
    const later = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact({
        factType: "counterparty_later_frozen",
        lane: "context",
        subjectRole: "receiver",
        directness: "direct",
        timing: "later"
      })]
    });
    const victim = scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact({
        factType: "confirmed_victim_debit",
        lane: "hard",
        subjectRole: "victim",
        directness: "direct",
        timing: "at_event"
      })]
    });
    expect(direct.score).toBe(90);
    expect(indirect.score).toBe(45);
    expect(later.score).toBe(0);
    expect(victim.score).toBe(50);
  });

  it("uses adjudicated rules for approval without debit and confirmed victim debit", () => {
    expect(scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact({
        factType: "dangerous_unlimited_approval",
        lane: "pattern",
        subjectRole: "approval_owner",
        directness: "direct",
        timing: "current"
      })]
    })).toMatchObject({ score: 55, decision: "REVIEW" });
    expect(scoreSignalMatrixV4({
      subjectAddress,
      facts: [fact({
        factType: "confirmed_victim_debit",
        lane: "hard",
        subjectRole: "victim",
        directness: "direct",
        timing: "at_event"
      })]
    })).toMatchObject({ score: 50, decision: "REVIEW" });
  });
});
