import { describe, expect, it } from "vitest";
import { selectBalanceFormingTransfers } from "../../src/forensics/balanceFormingTransfers";
import type { ForensicRouteEdge } from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const senderA = "TSenderA111111111111111111111111111";
const senderB = "TSenderB111111111111111111111111111";
const senderC = "TSenderC111111111111111111111111111";
const outbound = "TOutbound111111111111111111111111111";

function edge(id: string, fromAddress: string, toAddress: string, amountRaw: string, timestamp: string): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("selectBalanceFormingTransfers", () => {
  it("selects newest inbound transfers until they explain the current balance", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "5000000000",
      edges: [
        edge("tx-old", oldSender, subject, "10000000000", "2026-05-20T10:00:00.000Z"),
        edge("tx-outbound", subject, outbound, "900000000", "2026-05-22T09:00:00.000Z"),
        edge("tx-a", senderA, subject, "2000000000", "2026-05-22T10:00:00.000Z"),
        edge("tx-b", senderB, subject, "2000000000", "2026-05-22T10:05:00.000Z"),
        edge("tx-c", senderC, subject, "1000000000", "2026-05-22T10:10:00.000Z")
      ]
    });

    expect(result.transfers.map((transfer) => transfer.txHash)).toEqual(["tx-c", "tx-b", "tx-a"]);
    expect(result.selectedVolumeRaw).toBe("5000000000");
    expect(result.currentBalanceCoverageRatio).toBe(1);
    expect(result.partial).toBe(false);
    expect(result.transfers).toEqual([
      expect.objectContaining({
        txHash: "tx-c",
        fromAddress: senderC,
        toAddress: subject,
        amountRaw: "1000000000",
        coverageShare: 0.2,
        selectedReason: "covers_current_balance"
      }),
      expect.objectContaining({ txHash: "tx-b", coverageShare: 0.4 }),
      expect.objectContaining({ txHash: "tx-a", coverageShare: 0.4 })
    ]);
  });

  it("selects newest inbound transfers until they cover the requested amount", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "5000000000",
      requestedAmountRaw: "1000000000",
      edges: [
        edge("tx-old-large", oldSender, subject, "4000000000", "2026-05-22T10:00:00.000Z"),
        edge("tx-older-700", senderA, subject, "700000000", "2026-05-22T10:05:00.000Z"),
        edge("tx-newer-700", senderB, subject, "700000000", "2026-05-22T10:10:00.000Z")
      ]
    });

    expect(result.transfers.map((transfer) => transfer.txHash)).toEqual(["tx-newer-700", "tx-older-700"]);
    expect(result.currentBalanceRaw).toBe("5000000000");
    expect(result.requestedAmountRaw).toBe("1000000000");
    expect(result.targetAmountRaw).toBe("1000000000");
    expect(result.selectedAmountRaw).toBe("1400000000");
    expect(result.selectedVolumeRaw).toBe("1400000000");
    expect(result.coverageRatio).toBe(1);
    expect(result.partial).toBe(false);
    expect(result.selectionMethod).toBe("requested_amount");
  });

  it("selects requested amount transfers even when current balance is zero", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      requestedAmountRaw: "1000000000",
      edges: [
        edge("tx-old-large", oldSender, subject, "4000000000", "2026-05-22T10:00:00.000Z"),
        edge("tx-older-700", senderA, subject, "700000000", "2026-05-22T10:05:00.000Z"),
        edge("tx-newer-700", senderB, subject, "700000000", "2026-05-22T10:10:00.000Z")
      ]
    });

    expect(result.transfers.map((transfer) => transfer.txHash)).toEqual(["tx-newer-700", "tx-older-700"]);
    expect(result.currentBalanceRaw).toBe("0");
    expect(result.requestedAmountRaw).toBe("1000000000");
    expect(result.targetAmountRaw).toBe("1000000000");
    expect(result.selectedAmountRaw).toBe("1400000000");
    expect(result.coverageRatio).toBe(1);
    expect(result.currentBalanceCoverageRatio).toBe(0);
    expect(result.transfers).toEqual([
      expect.objectContaining({ txHash: "tx-newer-700", coverageShare: 0.7 }),
      expect.objectContaining({ txHash: "tx-older-700", coverageShare: 0.3 })
    ]);
    expect(result.partial).toBe(false);
    expect(result.selectionMethod).toBe("requested_amount");
  });

  it("marks selection partial when indexed inbound volume cannot explain the balance", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "5000000000",
      edges: [
        edge("tx-a", senderA, subject, "2000000000", "2026-05-22T10:00:00.000Z"),
        edge("tx-b", senderB, subject, "1000000000", "2026-05-22T10:05:00.000Z")
      ]
    });

    expect(result.transfers.map((transfer) => transfer.txHash)).toEqual(["tx-b", "tx-a"]);
    expect(result.selectedVolumeRaw).toBe("3000000000");
    expect(result.currentBalanceCoverageRatio).toBe(0.6);
    expect(result.partial).toBe(true);
    expect(result.notes).toEqual([
      "Selected inbound USDT transfers cover 60% of the current balance; balance-origin coverage is partial."
    ]);
  });

  it("caps the final transfer coverage share when a large inbound overcovers the balance", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "5000000000",
      edges: [
        edge("tx-small", senderA, subject, "1000000000", "2026-05-22T10:05:00.000Z"),
        edge("tx-large", senderB, subject, "100000000000", "2026-05-22T10:00:00.000Z")
      ]
    });

    expect(result.currentBalanceCoverageRatio).toBe(1);
    expect(result.coverageRatio).toBe(1);
    expect(result.transfers).toEqual([
      expect.objectContaining({ txHash: "tx-small", coverageShare: 0.2 }),
      expect.objectContaining({ txHash: "tx-large", coverageShare: 0.8 })
    ]);
  });

  it("returns an incomplete empty selection for zero or missing balance", () => {
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge("tx-a", senderA, subject, "2000000000", "2026-05-22T10:00:00.000Z")
      ]
    });

    expect(result.transfers).toEqual([]);
    expect(result.selectedVolumeRaw).toBe("0");
    expect(result.currentBalanceCoverageRatio).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.notes).toEqual(["Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]);
  });

  it("[REQ-31][AC-13][DATA] records the ordinary inbound denominator before selection", () => {
    const inbound = Array.from({ length: 24 }, (_, index) => edge(
      `coverage-${index}`,
      `TSyntheticSender${index.toString().padStart(2, "0")}`,
      subject,
      "100000000",
      new Date(Date.UTC(2026, 6, 12, 12, 0, index)).toISOString()
    ));
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "1000000000",
      edges: inbound
    });

    expect(result.transfers).toHaveLength(10);
    expect(result.availableInboundTxCount).toBe(24);
    expect(result.coverageExclusions).toEqual([{
      reason: "different_selected_scope",
      direction: "incoming",
      txCount: 14,
      amountRaw: "1400000000",
      evidenceIds: Array.from({ length: 14 }, (_, index) => `coverage-${index}`)
    }]);
  });

  it("[REQ-31][AC-13][DATA] preserves distinct event evidence when one transaction has multiple transfers", () => {
    const duplicateTxA = {
      ...edge("event-a", senderA, subject, "100000000", "2026-07-12T12:00:00.000Z"),
      txHash: "shared-transaction"
    };
    const duplicateTxB = {
      ...edge("event-b", senderB, subject, "200000000", "2026-07-12T12:00:01.000Z"),
      txHash: "shared-transaction"
    };
    const selected = edge("selected-event", senderC, subject, "300000000", "2026-07-12T12:00:02.000Z");
    const result = selectBalanceFormingTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "300000000",
      edges: [duplicateTxA, duplicateTxB, selected]
    });
    expect(result.availableInboundTxCount).toBe(3);
    expect(result.coverageExclusions).toEqual([{
      reason: "different_selected_scope",
      direction: "incoming",
      txCount: 2,
      amountRaw: "300000000",
      evidenceIds: ["event-a", "event-b"]
    }]);
  });
});
