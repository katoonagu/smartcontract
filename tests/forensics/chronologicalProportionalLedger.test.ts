import { describe, expect, it } from "vitest";
import {
  apportionRawLargestRemainderV1,
  canonicalizeChronologicalLedgerEventsV1,
  runChronologicalProportionalLedgerV1,
  selectLedgerProvenanceV1,
  type LedgerEventV1,
  type LedgerLotV1,
  type SnapshotBalanceWitnessV1
} from "../../src/forensics/chronologicalProportionalLedger.js";
import { loadForensicModelOfflineCorpusV1 } from "../fixtures/forensics/loadForensicModelCorpus.js";

const corpus = loadForensicModelOfflineCorpusV1();
const subjectAddress = "subject";
const ledgerSnapshot = {
  snapshotBlockNumber: 100,
  snapshotBlockHash: "snapshot-block-hash",
  snapshotEvidenceRef: "fixture:snapshot"
} as const;

function ledgerEvent(input: Partial<LedgerEventV1> & {
  canonicalEventId: string | null;
  blockNumber: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
}): LedgerEventV1 {
  return {
    providerEventIds: [`provider:${input.canonicalEventId ?? input.blockNumber}`],
    txHash: `tx:${input.canonicalEventId ?? input.blockNumber}`,
    transactionIndex: 0,
    eventIndex: 0,
    eventIndexAuthority: "receipt_log_index",
    occurredAtMs: input.blockNumber * 1_000,
    ...input
  };
}

function lot(lotId: string, remainingRaw: bigint): LedgerLotV1 {
  return {
    lotId,
    sourceEventId: lotId,
    sourceAddress: `source:${lotId}`,
    originalRaw: remainingRaw,
    remainingRaw
  };
}

function balanceWitness(
  amountRaw: bigint,
  overrides: Partial<SnapshotBalanceWitnessV1> = {}
): SnapshotBalanceWitnessV1 {
  return {
    amountRaw,
    pinned: true,
    independent: true,
    subjectAddress,
    snapshotBlockNumber: ledgerSnapshot.snapshotBlockNumber,
    snapshotBlockHash: ledgerSnapshot.snapshotBlockHash,
    evidenceRef: "fixture:independent-balance",
    ...overrides
  };
}

describe("chronological proportional ledger v1", () => {
  const zeroOpeningEvents = [
    ledgerEvent({ canonicalEventId: "in-300", blockNumber: 1, fromAddress: "funder-old", toAddress: subjectAddress, amountRaw: 300n }),
    ledgerEvent({ canonicalEventId: "out-70", blockNumber: 2, fromAddress: subjectAddress, toAddress: "recipient-70", amountRaw: 70n }),
    ledgerEvent({ canonicalEventId: "out-12", blockNumber: 3, fromAddress: subjectAddress, toAddress: "recipient-12", amountRaw: 12n }),
    ledgerEvent({ canonicalEventId: "out-180", blockNumber: 4, fromAddress: subjectAddress, toAddress: "recipient-180", amountRaw: 180n }),
    ledgerEvent({ canonicalEventId: "out-38", blockNumber: 5, fromAddress: subjectAddress, toAddress: "recipient-38", amountRaw: 38n })
  ] as const;

  it("covers the exact 180 episode while using 180 of the original 300 lot", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: zeroOpeningEvents
    });
    const selection = selectLedgerProvenanceV1({
      ledger,
      purpose: "exact_episode",
      exactEventId: "receipt:tx:out-180:0"
    });

    expect(ledger.state).toBe("complete");
    expect(selection).toMatchObject({
      state: "complete",
      targetRaw: 180n,
      coveredRaw: 180n,
      allocations: [{ lotId: "receipt:tx:in-300:0", amountRaw: 180n }]
    });
    expect(selection.allocations[0]).toMatchObject({
      sourceOriginalRaw: 300n,
      sourceUtilizedRaw: 180n
    });
  });

  it("keeps the recorded PacGy fixture unresolved without authoritative opening history", () => {
    const recorded = corpus.ledgerCases.find(({ id }) => id === "pacgy-recorded-chronology");
    const result = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "partial",
      openingBalanceRaw: 0n,
      events: []
    });

    expect(recorded?.expectedAuthoritativeState).toBe("history_incomplete");
    expect(result).toMatchObject({ state: "unresolved", reason: "history_incomplete" });
  });

  it("is invariant to provider row permutation after canonical ordering", () => {
    const forward = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: zeroOpeningEvents
    });
    const reversed = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [...zeroOpeningEvents].reverse()
    });

    expect(reversed).toEqual(forward);
  });

  it("dedupes exact receipt identity and preserves provider aliases", () => {
    const first = ledgerEvent({
      canonicalEventId: "caller:a",
      providerEventIds: ["provider:a"],
      txHash: "TX-1",
      blockNumber: 1,
      fromAddress: "funder",
      toAddress: subjectAddress,
      amountRaw: 5n
    });
    const result = canonicalizeChronologicalLedgerEventsV1([
      first,
      { ...first, canonicalEventId: "caller:b", providerEventIds: ["provider:b"] }
    ]);

    expect(result).toMatchObject({ state: "complete" });
    expect(result.events).toEqual([{
      ...first,
      canonicalEventId: "receipt:tx-1:0",
      txHash: "tx-1",
      providerEventIds: ["provider:a", "provider:b"]
    }]);
  });

  it("rejects conflicting payloads under one canonical identity", () => {
    const first = ledgerEvent({ canonicalEventId: "caller:a", txHash: "same-receipt", blockNumber: 1, fromAddress: "a", toAddress: subjectAddress, amountRaw: 5n });
    const events = [
      first,
      { ...first, canonicalEventId: "caller:b", providerEventIds: ["provider:b"], amountRaw: 7n }
    ];
    expect(canonicalizeChronologicalLedgerEventsV1(events)).toMatchObject({
      state: "unresolved",
      reason: "identity_collision",
      canonicalEventId: "receipt:same-receipt:0"
    });
    expect(runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events
    })).toMatchObject({
      state: "unresolved",
      reason: "identity_collision",
      totalIncomingRaw: 0n
    });
  });

  it("gives receipt collisions deterministic precedence over unresolved synthetic identity", () => {
    const receipt = ledgerEvent({ canonicalEventId: "caller:a", txHash: "collision", blockNumber: 1, fromAddress: "a", toAddress: subjectAddress, amountRaw: 5n });
    const collision = { ...receipt, canonicalEventId: "caller:b", amountRaw: 7n };
    const unresolved = ledgerEvent({
      canonicalEventId: "synthetic",
      txHash: "synthetic",
      blockNumber: 2,
      eventIndexAuthority: "provider_synthetic",
      fromAddress: "b",
      toAddress: subjectAddress,
      amountRaw: 3n
    });
    const forward = canonicalizeChronologicalLedgerEventsV1([unresolved, receipt, collision]);
    const reversed = canonicalizeChronologicalLedgerEventsV1([collision, receipt, unresolved]);

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({
      state: "unresolved",
      reason: "identity_collision",
      canonicalEventId: "receipt:collision:0"
    });
  });

  it("rejects synthetic-only event identity", () => {
    expect(canonicalizeChronologicalLedgerEventsV1([
      ledgerEvent({
        canonicalEventId: null,
        blockNumber: 1,
        eventIndex: 99,
        eventIndexAuthority: "provider_synthetic",
        fromAddress: "a",
        toAddress: subjectAddress,
        amountRaw: 5n
      })
    ])).toMatchObject({ state: "unresolved", reason: "identity_unresolved" });
  });

  it("rejects missing authoritative same-block transaction order", () => {
    expect(canonicalizeChronologicalLedgerEventsV1([
      ledgerEvent({ canonicalEventId: "in", blockNumber: 10, transactionIndex: null, fromAddress: "a", toAddress: subjectAddress, amountRaw: 10n }),
      ledgerEvent({ canonicalEventId: "out", blockNumber: 10, transactionIndex: 1, fromAddress: subjectAddress, toAddress: "b", amountRaw: 8n })
    ])).toMatchObject({ state: "unresolved", reason: "order_unresolved", blockNumber: 10 });
  });

  it("does not use a shared transaction hash to replace missing same-block transaction order", () => {
    expect(canonicalizeChronologicalLedgerEventsV1([
      ledgerEvent({
        canonicalEventId: "same-tx:0",
        txHash: "same-tx",
        blockNumber: 10,
        transactionIndex: null,
        eventIndex: 0,
        fromAddress: "a",
        toAddress: subjectAddress,
        amountRaw: 10n
      }),
      ledgerEvent({
        canonicalEventId: "same-tx:1",
        txHash: "same-tx",
        blockNumber: 10,
        transactionIndex: null,
        eventIndex: 1,
        fromAddress: subjectAddress,
        toAddress: "b",
        amountRaw: 8n
      })
    ])).toMatchObject({ state: "unresolved", reason: "order_unresolved", blockNumber: 10 });
  });

  it("rejects one transaction hash mapped to different transaction positions", () => {
    const events = [
      ledgerEvent({
        canonicalEventId: "caller:0",
        txHash: "shared-tx",
        blockNumber: 10,
        transactionIndex: 0,
        eventIndex: 0,
        fromAddress: "a",
        toAddress: subjectAddress,
        amountRaw: 5n
      }),
      ledgerEvent({
        canonicalEventId: "caller:1",
        txHash: "shared-tx",
        blockNumber: 10,
        transactionIndex: 1,
        eventIndex: 1,
        fromAddress: "b",
        toAddress: subjectAddress,
        amountRaw: 7n
      })
    ];
    const forward = canonicalizeChronologicalLedgerEventsV1(events);
    const reversed = canonicalizeChronologicalLedgerEventsV1([...events].reverse());

    expect(reversed).toEqual(forward);
    expect(forward).toMatchObject({
      state: "unresolved",
      reason: "order_unresolved",
      blockNumber: 10
    });
  });

  it("rejects different transaction hashes mapped to one block transaction slot", () => {
    const events = [
      ledgerEvent({
        canonicalEventId: "caller:a",
        txHash: "tx-a",
        blockNumber: 10,
        transactionIndex: 0,
        eventIndex: 0,
        fromAddress: "a",
        toAddress: subjectAddress,
        amountRaw: 5n
      }),
      ledgerEvent({
        canonicalEventId: "caller:b",
        txHash: "tx-b",
        blockNumber: 10,
        transactionIndex: 0,
        eventIndex: 1,
        fromAddress: "b",
        toAddress: subjectAddress,
        amountRaw: 7n
      })
    ];
    const forward = canonicalizeChronologicalLedgerEventsV1(events);
    const reversed = canonicalizeChronologicalLedgerEventsV1([...events].reverse());

    expect(reversed).toEqual(forward);
    expect(forward).toMatchObject({
      state: "unresolved",
      reason: "order_unresolved",
      blockNumber: 10
    });
  });

  it("breaks equal largest-remainder ties by canonical lot ID", () => {
    expect(apportionRawLargestRemainderV1(1n, [lot("b", 1n), lot("a", 1n)]))
      .toEqual([
        { lotId: "a", amountRaw: 1n },
        { lotId: "b", amountRaw: 0n }
      ]);
  });

  it("uses code-unit order for Unicode lot ID ties independent of input order", () => {
    const composed = "\u00e9";
    const decomposed = "e\u0301";
    const expected = [
      { lotId: decomposed, amountRaw: 1n },
      { lotId: composed, amountRaw: 0n }
    ];

    expect(apportionRawLargestRemainderV1(1n, [lot(composed, 1n), lot(decomposed, 1n)]))
      .toEqual(expected);
    expect(apportionRawLargestRemainderV1(1n, [lot(decomposed, 1n), lot(composed, 1n)]))
      .toEqual(expected);
  });

  it("treats exact self-transfer as a balance and provenance no-op", () => {
    const result = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [
        ledgerEvent({ canonicalEventId: "in", blockNumber: 1, fromAddress: "funder", toAddress: subjectAddress, amountRaw: 10n }),
        ledgerEvent({ canonicalEventId: "self", blockNumber: 2, fromAddress: subjectAddress, toAddress: subjectAddress, amountRaw: 7n })
      ]
    });

    expect(result).toMatchObject({ state: "complete", remainingRaw: 10n, totalOutgoingRaw: 0n });
    expect(result.consumptionVectors).toEqual([]);
    expect(result.lots).toHaveLength(1);
  });

  it("invalidates the whole ledger when a debit exceeds inventory", () => {
    const result = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [
        ledgerEvent({ canonicalEventId: "in", blockNumber: 1, fromAddress: "funder", toAddress: subjectAddress, amountRaw: 10n }),
        ledgerEvent({ canonicalEventId: "out", blockNumber: 2, fromAddress: subjectAddress, toAddress: "recipient", amountRaw: 11n })
      ]
    });

    expect(result).toMatchObject({
      state: "unresolved",
      reason: "debit_exceeds_inventory",
      unresolvedRaw: 1n,
      authoritative: false
    });
    expect(selectLedgerProvenanceV1({ ledger: result, purpose: "exact_episode", exactEventId: "receipt:tx:out:0" }))
      .toMatchObject({ state: "unresolved", reason: "debit_exceeds_inventory" });
  });

  it("requires a matching pinned independent witness for balance projections", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [ledgerEvent({ canonicalEventId: "in", blockNumber: 1, fromAddress: "funder", toAddress: subjectAddress, amountRaw: 10n })]
    });

    expect(ledger).toMatchObject({ subjectAddress, ...ledgerSnapshot });
    expect(selectLedgerProvenanceV1({ ledger, purpose: "current_balance" }))
      .toMatchObject({ state: "unresolved", reason: "balance_witness_missing" });
    expect(selectLedgerProvenanceV1({ ledger, purpose: "amount_only", requestedAmountRaw: 5n }))
      .toMatchObject({ state: "unresolved", reason: "balance_witness_missing" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "current_balance",
      snapshotBalanceWitness: balanceWitness(10n, { subjectAddress: "other-subject" })
    })).toMatchObject({ state: "unresolved", reason: "balance_witness_binding_mismatch" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(10n, { snapshotBlockNumber: 101 })
    })).toMatchObject({ state: "unresolved", reason: "balance_witness_binding_mismatch" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(10n, { snapshotBlockHash: "other-hash" })
    })).toMatchObject({ state: "unresolved", reason: "balance_witness_binding_mismatch" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(10n, { evidenceRef: "" })
    })).toMatchObject({ state: "unresolved", reason: "balance_witness_missing" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(9n)
    })).toMatchObject({ state: "unresolved", reason: "snapshot_balance_mismatch" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(10n)
    })).toMatchObject({ state: "complete", targetRaw: 5n, coveredRaw: 5n });
  });

  it("rejects events after the ledger snapshot before allocation or episode selection", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [ledgerEvent({
        canonicalEventId: "after-snapshot",
        blockNumber: ledgerSnapshot.snapshotBlockNumber + 1,
        fromAddress: "funder",
        toAddress: subjectAddress,
        amountRaw: 10n
      })]
    });

    expect(ledger).toMatchObject({
      state: "unresolved",
      reason: "snapshot_inconsistent",
      authoritative: false,
      totalIncomingRaw: 0n,
      remainingRaw: 0n
    });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "current_balance",
      snapshotBalanceWitness: balanceWitness(10n)
    })).toMatchObject({ state: "unresolved", reason: "snapshot_inconsistent" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "exact_episode",
      exactEventId: "receipt:tx:after-snapshot:0"
    })).toMatchObject({ state: "unresolved", reason: "snapshot_inconsistent" });
  });

  it("does not make exact episode selection depend on a current live balance", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: zeroOpeningEvents
    });
    const selection = selectLedgerProvenanceV1({
      ledger,
      purpose: "exact_episode",
      exactEventId: "receipt:tx:out-180:0",
      snapshotBalanceWitness: balanceWitness(999n, {
        pinned: false,
        independent: false,
        subjectAddress: "other-subject",
        snapshotBlockNumber: 999,
        snapshotBlockHash: "other-hash",
        evidenceRef: ""
      })
    });

    expect(selection).toMatchObject({ state: "complete", targetRaw: 180n, coveredRaw: 180n });
  });

  it("retains an exact-red contributor below the ordinary 95 percent cutoff", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [
        ledgerEvent({ canonicalEventId: "lot-94", blockNumber: 1, fromAddress: "ordinary-a", toAddress: subjectAddress, amountRaw: 94n }),
        ledgerEvent({ canonicalEventId: "lot-5", blockNumber: 2, fromAddress: "ordinary-b", toAddress: subjectAddress, amountRaw: 5n }),
        ledgerEvent({ canonicalEventId: "lot-red-1", blockNumber: 3, fromAddress: "red", toAddress: subjectAddress, amountRaw: 1n })
      ]
    });
    const selection = selectLedgerProvenanceV1({
      ledger,
      purpose: "current_balance",
      snapshotBalanceWitness: balanceWitness(100n),
      exactRedContributorLotIds: ["receipt:tx:lot-red-1:0"]
    });

    expect(selection.deepSelectedLotIds).toEqual([
      "receipt:tx:lot-94:0",
      "receipt:tx:lot-5:0",
      "receipt:tx:lot-red-1:0"
    ]);
  });

  it("conserves integer value across deterministic replay cases", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const incomingA = BigInt(seed * 3 + 1);
      const incomingB = BigInt(seed * 2 + 3);
      const outgoing = BigInt(seed % Number(incomingA + incomingB));
      const result = runChronologicalProportionalLedgerV1({
        subjectAddress,
        ...ledgerSnapshot,
        historyCompleteness: "genesis_complete",
        openingBalanceRaw: 0n,
        events: [
          ledgerEvent({ canonicalEventId: `a-${seed}`, blockNumber: 1, fromAddress: "a", toAddress: subjectAddress, amountRaw: incomingA }),
          ledgerEvent({ canonicalEventId: `b-${seed}`, blockNumber: 2, fromAddress: "b", toAddress: subjectAddress, amountRaw: incomingB }),
          ledgerEvent({ canonicalEventId: `out-${seed}`, blockNumber: 3, fromAddress: subjectAddress, toAddress: "recipient", amountRaw: outgoing })
        ]
      });

      expect(result.state).toBe("complete");
      expect(result.totalIncomingRaw).toBe(result.totalOutgoingRaw + result.remainingRaw);
      expect(result.consumptionVectors.flatMap((item) => item.allocations)
        .every((item) => item.amountRaw >= 0n)).toBe(true);
    }
  });
});
