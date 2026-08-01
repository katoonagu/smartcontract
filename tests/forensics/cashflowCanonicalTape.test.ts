import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import {
  cashflowPublicReasonV1,
  materializeCashflowCanonicalTapeV1,
  parseCashflowAuthorityEnvelopeV1,
  parseCashflowCanonicalTapeArtifactV1,
  type CashflowPublicUnresolvedReasonV1
} from "../../src/forensics/cashflowCanonicalTape.js";
import {
  runChronologicalProportionalLedgerV1,
  selectLedgerProvenanceV1,
  type LedgerSelectionReasonV1
} from "../../src/forensics/chronologicalProportionalLedger.js";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser.js";

type MutableTape = {
  schemaVersion: string;
  artifactSha256: string;
  body: Record<string, unknown> & {
    chain: string;
    tokenContract: string;
    snapshot: Record<string, unknown> & {
      blockHash: string;
      balance: Record<string, unknown> & { pinned: boolean };
    };
    history: Record<string, unknown> & { completeness: string };
    movements: Array<Record<string, unknown> & {
      canonicalEventId: string;
      providerEventIds: string[];
      txHash: string;
      amountRaw: string;
      transactionIndex: number | null;
      orderEvidenceRef: string | null;
      identityEvidenceRef: string;
      finality: string;
    }>;
    query: Record<string, unknown>;
    evidenceRefs: string[];
    economicRoleCoverage: string;
  };
};

const acceptancePath = new URL(
  "../../docs/superpowers/verification/2026-07-30-pacgy-canonical-tape-acceptance.json",
  import.meta.url
);
const acceptance = JSON.parse(readFileSync(acceptancePath, "utf8")) as {
  readonly tapeArtifactPath: string;
  readonly tapeArtifactSha256: string;
};
const rawTape = JSON.parse(readFileSync(acceptance.tapeArtifactPath, "utf8")) as MutableTape;

function changedTape(mutate: (copy: MutableTape) => void): MutableTape {
  const copy = structuredClone(rawTape);
  mutate(copy);
  copy.artifactSha256 = fingerprintCanonicalArtifact(copy.body);
  return copy;
}

describe("cashflow canonical tape v1", () => {
  it("parses the independently accepted real tape before materializing bigint values", () => {
    const tape = parseCashflowCanonicalTapeArtifactV1(rawTape as unknown);

    expect(tape.artifactSha256).toBe(acceptance.tapeArtifactSha256);
    expect(fingerprintCanonicalArtifact(tape.body)).toBe(tape.artifactSha256);
    expect(JSON.stringify(tape)).not.toMatch(/\d+n\b/u);
    expect(tape.body).toMatchObject({
      chain: "tron",
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      history: { completeness: "partial", openingBalanceRaw: null },
      economicRoleCoverage: "incomplete"
    });

    const materialized = materializeCashflowCanonicalTapeV1(tape);
    expect(materialized.input.historyCompleteness).toBe("partial");
    expect(materialized.input.openingBalanceRaw).toBe(0n);
    expect(materialized.input.events[0]?.amountRaw).toBe(180000000n);
    expect(materialized.query).toMatchObject({
      purpose: "exact_episode",
      exactEventId: "receipt:676a97390c99f997e3c9af9a57e8c684c7b6253710e8b009950f73b8b25fe7ca:0"
    });
  });

  it.each<readonly [string, (copy: MutableTape) => void]>([
    ["chain", (copy) => { copy.body.chain = "ethereum"; }],
    ["token", (copy) => { copy.body.tokenContract = `T${"1".repeat(33)}`; }],
    ["full tx", (copy) => { copy.body.movements[0]!.txHash = "0".repeat(64); }],
    ["canonical id", (copy) => { copy.body.movements[0]!.canonicalEventId += "x"; }],
    ["amount", (copy) => { copy.body.movements[0]!.amountRaw = "0180000000"; }],
    ["finality", (copy) => { copy.body.movements[0]!.finality = "unknown"; }],
    ["order", (copy) => { copy.body.movements[0]!.orderEvidenceRef = "forbidden"; }],
    ["history", (copy) => { copy.body.history.completeness = "genesis_complete"; }],
    ["balance", (copy) => { copy.body.snapshot.balance.pinned = true; }],
    ["refs", (copy) => { copy.body.evidenceRefs.push(copy.body.evidenceRefs[0]!); }],
    ["identity evidence", (copy) => { copy.body.movements[0]!.identityEvidenceRef = ""; }],
    ["provider refs", (copy) => {
      const movement = copy.body.movements[0]!;
      movement.providerEventIds.push(movement.providerEventIds[0]!);
    }],
    ["provider ref order", (copy) => {
      copy.body.movements[0]!.providerEventIds.push("aaa:out-of-order");
    }],
    ["movement order", (copy) => {
      const movement = copy.body.movements[0]!;
      const txHash = "0".repeat(64);
      copy.body.movements.push({
        ...movement,
        canonicalEventId: `receipt:${txHash}:0`,
        providerEventIds: ["synthetic:second"],
        txHash
      });
    }],
    ["unsafe integer", (copy) => {
      copy.body.movements[0]!.blockNumber = Number.MAX_SAFE_INTEGER + 1;
    }],
    ["address", (copy) => { copy.body.movements[0]!.fromAddress = "not-tron"; }],
    ["finality evidence", (copy) => { copy.body.movements[0]!.finalityEvidenceRef = ""; }],
    ["snapshot hash", (copy) => { copy.body.snapshot.blockHash = "bad"; }],
    ["query", (copy) => { copy.body.query.purpose = "other"; }],
    ["economic role", (copy) => { copy.body.economicRoleCoverage = "partial"; }],
    ["evidence ref order", (copy) => { copy.body.evidenceRefs.reverse(); }],
    ["unknown key", (copy) => { copy.body.extra = true; }]
  ])("rejects tampered %s even with a recomputed body hash", (_name, mutate) => {
    expect(() => parseCashflowCanonicalTapeArtifactV1(changedTape(mutate)))
      .toThrow("cashflow_canonical_tape_invalid");
  });

  it("rejects body-hash tampering and non-JSON amounts with one stable error", () => {
    const staleHash = structuredClone(rawTape);
    staleHash.body.economicRoleCoverage = "complete";
    expect(() => parseCashflowCanonicalTapeArtifactV1(staleHash))
      .toThrow("cashflow_canonical_tape_invalid");

    const bigintAmount = structuredClone(rawTape) as MutableTape;
    bigintAmount.body.movements[0]!.amountRaw = 1n as unknown as string;
    expect(() => parseCashflowCanonicalTapeArtifactV1(bigintAmount as unknown))
      .toThrow("cashflow_canonical_tape_invalid");
  });

  it.each([
    ["current extra", { purpose: "current_balance", requestedAmountRaw: null, exactRedContributorLotIds: [] }],
    ["amount missing", { purpose: "amount_only", exactRedContributorLotIds: [] }],
    ["amount zero", { purpose: "amount_only", requestedAmountRaw: "0", exactRedContributorLotIds: [] }],
    ["amount exact", {
      purpose: "amount_only",
      requestedAmountRaw: "1",
      exactEventId: `receipt:${"0".repeat(64)}:0`,
      exactRedContributorLotIds: []
    }],
    ["episode missing", { purpose: "exact_episode", exactRedContributorLotIds: [] }],
    ["episode amount", {
      purpose: "exact_episode",
      exactEventId: `receipt:${"0".repeat(64)}:0`,
      requestedAmountRaw: "1",
      exactRedContributorLotIds: []
    }]
  ])("rejects purpose-specific query shape: %s", (_name, query) => {
    expect(() => parseCashflowCanonicalTapeArtifactV1(changedTape((copy) => {
      copy.body.query = query;
    }))).toThrow("cashflow_canonical_tape_invalid");
  });

  it("accepts the exact current-balance query variant", () => {
    const parsed = parseCashflowCanonicalTapeArtifactV1(changedTape((copy) => {
      copy.body.query = { purpose: "current_balance", exactRedContributorLotIds: [] };
    }));
    expect(parsed.body.query).toEqual({ purpose: "current_balance", exactRedContributorLotIds: [] });
  });

  it("rejects cross-variant authority envelope fields", () => {
    const tape = parseCashflowCanonicalTapeArtifactV1(rawTape);
    const unavailable = {
      kind: "unavailable",
      typedReason: "history_incomplete_before_anchor",
      evidenceRefs: ["accepted:gap:history"]
    } as const;

    expect(parseCashflowAuthorityEnvelopeV1(unavailable)).toEqual(unavailable);
    expect(() => parseCashflowAuthorityEnvelopeV1({ ...unavailable, tape }))
      .toThrow("cashflow_canonical_tape_invalid");
    expect(() => parseCashflowAuthorityEnvelopeV1({
      kind: "canonical_tape",
      tape,
      typedReason: "history_incomplete_before_anchor"
    })).toThrow("cashflow_canonical_tape_invalid");
  });

  it("requires a positive amount-only request after a valid balance witness", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress: "subject",
      snapshotBlockNumber: 1,
      snapshotBlockHash: "snapshot",
      snapshotEvidenceRef: "synthetic:snapshot",
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [{
        canonicalEventId: "receipt:in:0",
        providerEventIds: ["synthetic:in"],
        txHash: "in",
        blockNumber: 1,
        transactionIndex: 0,
        eventIndex: 0,
        eventIndexAuthority: "receipt_log_index",
        occurredAtMs: 1_000,
        fromAddress: "funder",
        toAddress: "subject",
        amountRaw: 10n
      }]
    });
    const witness = {
      amountRaw: 10n,
      pinned: true,
      independent: true,
      subjectAddress: "subject",
      snapshotBlockNumber: 1,
      snapshotBlockHash: "snapshot",
      evidenceRef: "synthetic:balance"
    } as const;

    expect(selectLedgerProvenanceV1({ ledger, purpose: "amount_only", snapshotBalanceWitness: witness }))
      .toMatchObject({ state: "unresolved", reason: "requested_amount_missing" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 0n,
      snapshotBalanceWitness: witness
    })).toMatchObject({ state: "unresolved", reason: "requested_amount_not_positive" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: -1n,
      snapshotBalanceWitness: witness
    })).toMatchObject({ state: "unresolved", reason: "requested_amount_not_positive" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 11n,
      snapshotBalanceWitness: witness
    })).toMatchObject({ state: "unresolved", reason: "requested_amount_exceeds_balance" });
  });

  it.each<readonly [LedgerSelectionReasonV1, CashflowPublicUnresolvedReasonV1]>([
    ["identity_collision", "canonical_event_identity_unresolved"],
    ["identity_unresolved", "canonical_event_identity_unresolved"],
    ["order_unresolved", "temporal_order_unresolved"],
    ["history_incomplete", "history_incomplete_before_anchor"],
    ["snapshot_inconsistent", "provider_or_snapshot_inconsistent"],
    ["debit_exceeds_inventory", "outgoing_exceeds_reconstructed_inventory"],
    ["balance_witness_missing", "anchor_balance_witness_missing"],
    ["balance_witness_binding_mismatch", "provider_or_snapshot_inconsistent"],
    ["snapshot_balance_mismatch", "snapshot_balance_mismatch"],
    ["requested_amount_missing", "requested_amount_missing"],
    ["requested_amount_not_positive", "requested_amount_not_positive"],
    ["requested_amount_exceeds_balance", "requested_amount_exceeds_snapshot_balance"],
    ["exact_event_missing", "canonical_event_identity_unresolved"],
    ["requested_amount_exceeds_episode", "provider_or_snapshot_inconsistent"]
  ])("maps internal reason %s", (internal, expected) => {
    expect(cashflowPublicReasonV1(internal)).toBe(expected);
  });
});
