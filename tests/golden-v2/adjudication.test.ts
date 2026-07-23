import { describe, expect, it } from "vitest";
import { compareAttributionPolicies } from "../../tools/golden-pilot-v2/attribution";
import {
  finalizeAdjudication,
  openAdjudication,
  type AdjudicationDraftV2
} from "../../tools/golden-pilot-v2/adjudication";
import type { LockedReviewV2 } from "../../tools/golden-pilot-v2/reviewWorkspace";

const attributionResults = compareAttributionPolicies({
  selectedAmountRaw: "1000000",
  inbound: [
    {
      eventId: "event-1",
      amountRaw: "2000000",
      timestamp: "2026-07-22T23:59:58.000Z"
    }
  ]
});
const canonicalFactId = [
  "tron",
  "a".repeat(64),
  "0",
  "trc20_transfer",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKT76qbH",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKLxmGkn"
].join(":");

function review(
  reviewerId: string,
  reviewSha256: string,
  overrides: Partial<LockedReviewV2> = {}
): LockedReviewV2 {
  return {
    version: "golden-review-v2",
    status: "submitted",
    caseId: "synthetic-one-legitimate-transfer",
    reviewerId,
    neutralBundleSha256: "1".repeat(64),
    provenanceManifestSha256: "2".repeat(64),
    validatorReceiptSha256: "3".repeat(64),
    decision: "ACCEPTABLE",
    reason: "No hard evidence.",
    findings: [
      {
        canonicalFactId,
        evidenceRefs: [canonicalFactId],
        subjectRole: "recipient",
        counterpartyRole: "sender",
        directness: "direct",
        timing: "at_event",
        lane: "neutral"
      }
    ],
    terminalBoundaries: ["known_exchange"],
    preferredAttributionPolicy: "fifo",
    attributionResults,
    dossierAggregates: { incoming_amount_raw: "2000000" },
    scoreProperties: ["coverage_does_not_change_score"],
    reviewedAt: "2026-07-23T01:00:00.000Z",
    reviewSha256,
    artifact: {
      relativePath: "submitted-review.json",
      sha256: reviewSha256,
      byteLength: 1
    },
    ...overrides
  };
}

const reviewA = review("reviewer-a", "a".repeat(64));
const reviewB = review("reviewer-b", "b".repeat(64), {
  decision: "REVIEW",
  preferredAttributionPolicy: "proportional",
  findings: [
    {
      ...review("reviewer-b", "c".repeat(64)).findings[0]!,
      lane: "context"
    }
  ]
});

function resolvedDraft(draft: AdjudicationDraftV2): AdjudicationDraftV2 {
  return {
    ...structuredClone(draft),
    disagreements: draft.disagreements.map((disagreement) => ({
      ...disagreement,
      resolution:
        disagreement.field === "decision"
          ? "ACCEPTABLE"
          : disagreement.field === "preferredAttributionPolicy"
            ? "fifo"
            : disagreement.field.endsWith(".lane")
              ? "neutral"
              : disagreement.reviewerValues[0]
    })),
    resolution: {
      resolvedFacts: [
        {
          canonicalFactId,
          lane: "neutral",
          role: "recipient",
          directness: "direct",
          timing: "at_event"
        }
      ],
      selectedAttributionPolicy: "fifo",
      expectedDecision: "ACCEPTABLE",
      exactScore: 22,
      scoreProperties: ["coverage_does_not_change_score"],
      dossierAggregates: { incoming_amount_raw: "2000000" },
      telegramExpectation: [
        {
          locale: "ru",
          exactHtml: "<b>22/100 — низкий риск</b>"
        }
      ],
      adjudicatorId: "adjudicator-1",
      adjudicatedAt: "2026-07-23T02:00:00.000Z"
    }
  };
}

describe("Golden V2 explicit adjudication", () => {
  it("requires two reviews and exposes every decision disagreement", () => {
    expect(() => openAdjudication([reviewA])).toThrow(
      "golden_two_reviews_required"
    );
    const draft = openAdjudication([reviewA, reviewB]);
    expect(draft.disagreements).toContainEqual(
      expect.objectContaining({
        field: "decision",
        reviewerHashes: ["a".repeat(64), "b".repeat(64)]
      })
    );
    expect(draft.disagreements).toContainEqual(
      expect.objectContaining({ field: `findings.${canonicalFactId}.lane` })
    );
  });

  it("refuses unresolved drafts and finalizes an explicit bounded score", () => {
    const draft = openAdjudication([reviewA, reviewB]);
    expect(() => finalizeAdjudication(draft)).toThrow(
      "golden_adjudication_unresolved"
    );

    const final = finalizeAdjudication(resolvedDraft(draft));
    expect(final.selectedAttributionPolicy).toMatch(
      /^(fifo|lifo|proportional)$/u
    );
    expect(final.exactScore).toBeGreaterThanOrEqual(0);
    expect(final.exactScore).toBeLessThanOrEqual(100);
    expect(final.expectedDecision).toBe("ACCEPTABLE");
    expect(final.reviewerHashes).toEqual([
      "a".repeat(64),
      "b".repeat(64)
    ]);
  });

  it("rejects multiple lanes for one fact and out-of-range scores", () => {
    const draft = resolvedDraft(openAdjudication([reviewA, reviewB]));
    draft.resolution.resolvedFacts.push({
      ...draft.resolution.resolvedFacts[0]!,
      lane: "hard"
    });
    expect(() => finalizeAdjudication(draft)).toThrow(
      "golden_fact_multiple_scoring_lanes"
    );

    const invalidScore = resolvedDraft(
      openAdjudication([reviewA, reviewB])
    );
    invalidScore.resolution.exactScore = 101;
    expect(() => finalizeAdjudication(invalidScore)).toThrow(
      "golden_invalid_exact_score"
    );
  });
});
