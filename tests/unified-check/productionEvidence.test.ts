import { describe, expect, it } from "vitest";
import {
  buildUnifiedProductionEvidence,
  evidenceDateWithinSnapshot,
  requireCompleteUnifiedBlacklistTimeline
} from "../../src/unifiedCheck/productionEvidence";
import { canonicalizeEvidenceFacts } from "../../src/unifiedCheck/canonicalFacts";
import { scoreSignalMatrixV4 } from "../../src/risk/scoringSignalMatrixV4";
import type { IndexedTronUsdtTransfer } from "../../src/types";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";

it("excludes approvals not provably present at the pinned snapshot", () => {
  const snapshot = "2026-07-23T13:00:00.000Z";
  expect(evidenceDateWithinSnapshot(
    new Date("2026-07-23T12:59:59.000Z"),
    snapshot
  )).toBe(true);
  expect(evidenceDateWithinSnapshot(
    new Date("2026-07-23T13:00:01.000Z"),
    snapshot
  )).toBe(false);
  expect(evidenceDateWithinSnapshot(null, snapshot)).toBe(false);
});

it("rejects partial blacklist timelines before deriving hard evidence", () => {
  expect(requireCompleteUnifiedBlacklistTimeline({
    events: [],
    pagination: "complete",
    failureReason: null
  })).toEqual([]);
  expect(() => requireCompleteUnifiedBlacklistTimeline({
    events: [],
    pagination: "partial",
    failureReason: "provider_failed"
  })).toThrow(
    "unified_blacklist_timeline_incomplete:provider_failed"
  );
  expect(() => requireCompleteUnifiedBlacklistTimeline({
    events: [{
      eventKind: "added",
      occurredAt: "2026-07-23T12:00:00.000Z",
      txHash: "a".repeat(64),
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      blockNumber: 1,
      logIndex: 0,
      verification: "unverified"
    }],
    pagination: "complete",
    failureReason: null
  })).toThrow(
    "unified_blacklist_timeline_incomplete:event_log_unverified"
  );
});

function event(
  index: number,
  direction: "incoming" | "outgoing",
  counterparty: string,
  amountRaw = "100000000"
): IndexedTronUsdtTransfer {
  return {
    txHash: index.toString(16).padStart(64, "0"),
    blockNumber: 100 + index,
    blockTimestamp: new Date(1_753_276_000_000 + index * 60_000),
    eventIndex: 0,
    fromAddress: direction === "incoming" ? counterparty : SUBJECT,
    toAddress: direction === "incoming" ? SUBJECT : counterparty,
    amountRaw,
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  };
}

function score(events: IndexedTronUsdtTransfer[], extras: Parameters<
  typeof buildUnifiedProductionEvidence
>[0]["hardEvidence"] = {}) {
  const built = buildUnifiedProductionEvidence({
    subjectAddress: SUBJECT,
    snapshotBlock: "200",
    events,
    knownCounterparties: new Map(),
    hardEvidence: extras
  });
  const facts = canonicalizeEvidenceFacts({
    facts: [
      ...built.fast.facts,
      ...built.where.facts,
      ...built.deep.facts
    ]
  }).inventory.facts;
  return scoreSignalMatrixV4({ subjectAddress: SUBJECT, facts });
}

describe("Unified production evidence derivation", () => {
  it("does not score an unknown source without a correlated behavior pattern", () => {
    expect(score([
      event(1, "incoming", "TUnknown11111111111111111111111111111")
    ])).toMatchObject({
      score: 0,
      decision: "ACCEPTABLE",
      matrixRow: "unknown_without_risk_pattern"
    });
  });

  it("scores dense unknown fan-in only when rapid concentrated forwarding is present", () => {
    const incoming = Array.from({ length: 12 }, (_, index) =>
      event(
        index + 1,
        "incoming",
        `TUnknown${String(index).padStart(27, "0")}`,
        "100000000"
      )
    );
    const outgoing = [
      event(20, "outgoing", "TCollector00000000000000000000000000", "900000000")
    ];
    expect(score([...incoming, ...outgoing])).toMatchObject({
      score: 45,
      decision: "REVIEW",
      matrixRow: "correlated_dense_transit"
    });
  });

  it("keeps a direct at-event blacklist floor despite many safe transfers", () => {
    const risky = event(1, "incoming", "TRisky0000000000000000000000000000");
    const safe = Array.from({ length: 99 }, (_, index) =>
      event(
        index + 2,
        "incoming",
        `TSafe${String(index).padStart(30, "0")}`,
        "100000000"
      )
    );
    expect(score([risky, ...safe], {
      blacklistedAtEventKeys: new Set([
        `${risky.txHash}:${risky.eventIndex}`
      ])
    })).toMatchObject({
      score: 90,
      decision: "DECLINE",
      matrixRow: "direct_blacklist_at_event"
    });
  });
});
