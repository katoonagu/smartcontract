import { describe, expect, it } from "vitest";
import { buildMoneyOriginSenderInteractionProfile } from "../../src/forensics/moneyOriginInteractions";
import type { BalanceFormingTransfer, ForensicRouteEdge } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const sender = "TSender11111111111111111111111111111";
const funderA = "TFunderA111111111111111111111111111";
const funderB = "TFunderB111111111111111111111111111";
const otherReceiver = "TOtherReceiver111111111111111111111";

function edge(
  id: string,
  fromAddress: string,
  toAddress: string,
  amountRaw: string,
  timestamp: string,
  overrides: Partial<ForensicRouteEdge> = {}
): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer",
    ...overrides
  };
}

function balanceTransfer(): BalanceFormingTransfer {
  return {
    txHash: "tx-sender-subject",
    fromAddress: sender,
    toAddress: subject,
    amountRaw: "1000000000",
    timestamp: "2026-05-22T10:15:00.000Z",
    coverageShare: 1,
    selectedReason: "covers_current_balance"
  };
}

describe("buildMoneyOriginSenderInteractionProfile", () => {
  it("summarizes sender counterparties and funding candidates before the balance transfer", () => {
    const profile = buildMoneyOriginSenderInteractionProfile({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(),
      edges: [
        edge("tx-a", funderA, sender, "980000000", "2026-05-22T10:10:00.000Z"),
        edge("tx-b", funderB, sender, "100000000", "2026-05-22T10:11:00.000Z"),
        edge("tx-late", funderB, sender, "1000000000", "2026-05-22T10:16:00.000Z"),
        edge("tx-sender-subject", sender, subject, "1000000000", "2026-05-22T10:15:00.000Z"),
        edge("tx-sender-other", sender, otherReceiver, "200000000", "2026-05-22T10:20:00.000Z")
      ],
      minFundingCandidatePreservationRatio: 0.4
    });

    expect(profile).toMatchObject({
      balanceTransferTxHash: "tx-sender-subject",
      senderAddress: sender,
      incomingVolumeRaw: "2080000000",
      outgoingVolumeRaw: "1200000000",
      incomingTxCount: 3,
      outgoingTxCount: 2
    });
    expect(profile.fundingCandidates).toEqual([
      expect.objectContaining({
        txHash: "tx-a",
        fromAddress: funderA,
        toAddress: sender,
        amountPreservationRatio: 0.98
      })
    ]);
    expect(profile.topIncomingCounterparties).toEqual([
      expect.objectContaining({ address: funderB, volumeRaw: "1100000000", txCount: 2 }),
      expect.objectContaining({ address: funderA, volumeRaw: "980000000", txCount: 1 })
    ]);
    expect(profile.topOutgoingCounterparties).toEqual([
      expect.objectContaining({ address: subject, volumeRaw: "1000000000", txCount: 1 }),
      expect.objectContaining({ address: otherReceiver, volumeRaw: "200000000", txCount: 1 })
    ]);
  });

  it("does not count approval allowance edges as sender money flow", () => {
    const maxAllowance = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const profile = buildMoneyOriginSenderInteractionProfile({
      subjectAddress: subject,
      balanceTransfer: balanceTransfer(),
      edges: [
        edge("tx-real", sender, subject, "282693000000", "2026-07-01T12:51:54.000Z"),
        edge("tx-approve", sender, otherReceiver, maxAllowance, "2026-07-01T12:51:51.000Z", {
          method: "approve",
          edgeType: "unknown"
        })
      ]
    });

    expect(profile.outgoingVolumeRaw).toBe("282693000000");
    expect(profile.outgoingTxCount).toBe(1);
    expect(profile.topOutgoingCounterparties).toEqual([
      expect.objectContaining({
        address: subject,
        volumeRaw: "282693000000",
        txCount: 1,
        txHashes: ["tx-real"]
      })
    ]);
  });
});
