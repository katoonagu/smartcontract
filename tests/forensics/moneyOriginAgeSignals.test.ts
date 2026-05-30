import { describe, expect, it } from "vitest";
import { buildMoneyOriginAgeSignals } from "../../src/forensics/moneyOriginAgeSignals";
import type { BalanceFormingTransfer, ForensicRouteEdge } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const newSender = "TNewSender11111111111111111111111111";
const upstream = "TUpstream111111111111111111111111111";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, at: string): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(at),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function transfer(txHash: string, fromAddress: string, amountRaw: string, at: string): BalanceFormingTransfer {
  return {
    txHash,
    fromAddress,
    toAddress: subject,
    amountRaw,
    timestamp: at,
    coverageShare: 0.5,
    selectedReason: "covers_current_balance"
  };
}

describe("buildMoneyOriginAgeSignals", () => {
  it("adds dampeners for long-lived subject, long-lived sender, and repeated relationship", () => {
    const signals = buildMoneyOriginAgeSignals({
      subjectAddress: subject,
      balanceFormingTransfers: [
        transfer("tx-old-relationship-1", oldSender, "100000000000", "2026-05-20T10:00:00.000Z"),
        transfer("tx-old-relationship-2", oldSender, "50000000000", "2026-05-22T10:00:00.000Z")
      ],
      edgesByAddress: new Map([
        [subject, [
          edge("tx-first-subject", "TFirst11111111111111111111111111111", subject, "1000000", "2025-01-01T10:00:00.000Z"),
          edge("tx-mid-subject", subject, "TMid111111111111111111111111111111", "1000000", "2025-09-01T10:00:00.000Z"),
          edge("tx-old-relationship-1", oldSender, subject, "100000000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-old-relationship-2", oldSender, subject, "50000000000", "2026-05-22T10:00:00.000Z")
        ]],
        [oldSender, [
          edge("tx-first-old-sender", upstream, oldSender, "1000000", "2025-02-01T10:00:00.000Z"),
          edge("tx-old-relationship-1", oldSender, subject, "100000000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-old-relationship-2", oldSender, subject, "50000000000", "2026-05-22T10:00:00.000Z")
        ]]
      ]),
      now: new Date("2026-05-29T00:00:00.000Z"),
      largeBalanceRaw: "225240325624"
    });

    expect(signals.subjectAgeDays).toBeGreaterThan(500);
    expect(signals.subjectActiveDays).toBeGreaterThanOrEqual(3);
    expect(signals.repeatedRelationshipCount).toBe(1);
    expect(signals.directSenderMedianAgeDays).toBeGreaterThanOrEqual(480);
    expect(signals.oldestDirectSenderAgeDays).toBeGreaterThanOrEqual(480);
    expect(signals.longestRelationshipAgeDays).toBeGreaterThanOrEqual(8);
    expect(signals.signals.map((signal) => signal.code)).toEqual(expect.arrayContaining([
      "subject_long_lived",
      "sender_long_lived",
      "relationship_repeated"
    ]));
    expect(signals.signals.filter((signal) => signal.scoreImpact < 0).length).toBeGreaterThanOrEqual(3);
  });

  it("adds boosters for new large relationships and dormancy gaps", () => {
    const signals = buildMoneyOriginAgeSignals({
      subjectAddress: subject,
      balanceFormingTransfers: [
        transfer("tx-new-large", newSender, "225240325624", "2026-05-28T10:00:00.000Z")
      ],
      edgesByAddress: new Map([
        [subject, [
          edge("tx-old-dust", upstream, subject, "1000000", "2025-01-01T10:00:00.000Z"),
          edge("tx-new-large", newSender, subject, "225240325624", "2026-05-28T10:00:00.000Z")
        ]]
      ]),
      now: new Date("2026-05-29T00:00:00.000Z"),
      largeBalanceRaw: "225240325624"
    });

    expect(signals.maxDormancyGapDays).toBeGreaterThan(300);
    expect(signals.signals.map((signal) => signal.code)).toEqual(expect.arrayContaining([
      "relationship_new",
      "dormancy_gap"
    ]));
    expect(signals.signals.some((signal) => signal.scoreImpact > 0)).toBe(true);
  });

  it("adds the new large-wallet booster when the subject is newly observed with a large balance", () => {
    const signals = buildMoneyOriginAgeSignals({
      subjectAddress: subject,
      balanceFormingTransfers: [
        transfer("tx-new-large", newSender, "50000000000", "2026-05-28T10:00:00.000Z")
      ],
      edgesByAddress: new Map([
        [subject, [
          edge("tx-new-large", newSender, subject, "50000000000", "2026-05-28T10:00:00.000Z")
        ]]
      ]),
      now: new Date("2026-05-29T00:00:00.000Z"),
      largeBalanceRaw: "50000000000"
    });

    expect(signals.subjectAgeDays).toBe(0);
    expect(signals.signals.map((signal) => signal.code)).toEqual(expect.arrayContaining([
      "subject_new_large_wallet",
      "relationship_new"
    ]));
  });

  it("does not cite an unrelated relationship edge for a large balance-forming transfer", () => {
    const signals = buildMoneyOriginAgeSignals({
      subjectAddress: subject,
      balanceFormingTransfers: [
        transfer("tx-large-missing", newSender, "50000000000", "2026-05-28T10:00:00.000Z")
      ],
      edgesByAddress: new Map([
        [subject, [
          edge("tx-small-observed", newSender, subject, "1000000", "2026-05-28T09:00:00.000Z")
        ]]
      ]),
      now: new Date("2026-05-29T00:00:00.000Z"),
      largeBalanceRaw: "50000000000"
    });

    expect(signals.signals.map((signal) => signal.code)).not.toContain("relationship_new");
  });
});
