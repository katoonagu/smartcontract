import { canonicalizeArtifactJson } from "./canonicalJson.js";
import {
  runChronologicalProportionalLedgerV1,
  selectLedgerProvenanceV1,
  type LedgerEventV1,
  type LedgerFailureReasonV1,
  type LedgerInputV1,
  type LedgerQueryV1,
  type LedgerSelectionReasonV1,
  type SnapshotBalanceWitnessV1
} from "./chronologicalProportionalLedger.js";
import type { OfflineCorpusV1 } from "./offlineForensicModelReplay.js";

export type LedgerCorpusActualV1 = {
  readonly state: "complete" | "unresolved" | "not_applicable";
  readonly reason:
    | "canonical_event_identity_unresolved"
    | "temporal_order_unresolved"
    | "history_incomplete_before_anchor"
    | "outgoing_exceeds_reconstructed_inventory"
    | "requested_amount_not_positive"
    | null;
  readonly authoritative: boolean;
  readonly targetRaw: string;
  readonly coveredRaw: string;
  readonly allocations: readonly {
    readonly lotId: string;
    readonly sourceEventId: string;
    readonly sourceAddress: string;
    readonly usedAmountRaw: string;
    readonly sourceOriginalRaw: string;
  }[];
};

export type ForensicModelOfflineCorpusV1 = OfflineCorpusV1 & {
  readonly schemaVersion: "forensic-model-offline-corpus-v1";
};

export type LedgerCorpusReplayV1 = {
  readonly caseResults: readonly {
    readonly caseId: string;
    readonly actual: LedgerCorpusActualV1;
  }[];
  readonly mismatches: readonly {
    readonly caseId: string;
    readonly code: "ledger_expectation_mismatch" | "ledger_expectation_invalid";
  }[];
};

const RAW_AMOUNT = /^(0|[1-9][0-9]*)$/u;
const ACTUAL_REASONS = new Set<LedgerCorpusActualV1["reason"]>([
  null,
  "canonical_event_identity_unresolved",
  "temporal_order_unresolved",
  "history_incomplete_before_anchor",
  "outgoing_exceeds_reconstructed_inventory",
  "requested_amount_not_positive"
]);

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(code);
  }
  return value as Record<string, unknown>;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: string
): Record<string, unknown> {
  const result = record(value, code);
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(code);
  }
  return result;
}

function string(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(code);
  }
  return value;
}

function integer(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(code);
  }
  return value;
}

function rawAmount(value: unknown, code: string): string {
  if (typeof value !== "string" || !RAW_AMOUNT.test(value)) throw new TypeError(code);
  return value;
}

function strings(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(code);
  return value.map((item) => string(item, code));
}

function ledgerEvent(value: unknown): LedgerEventV1 {
  const code = "offline_corpus_ledger_event_invalid";
  const source = exactRecord(value, [
    "canonicalEventId",
    "providerEventIds",
    "txHash",
    "blockNumber",
    "transactionIndex",
    "eventIndex",
    "eventIndexAuthority",
    "occurredAtMs",
    "fromAddress",
    "toAddress",
    "amountRaw"
  ], code);
  if (source.eventIndexAuthority !== "receipt_log_index") throw new TypeError(code);
  return {
    canonicalEventId: source.canonicalEventId === null
      ? null
      : string(source.canonicalEventId, code),
    providerEventIds: strings(source.providerEventIds, code),
    txHash: string(source.txHash, code),
    blockNumber: integer(source.blockNumber, code),
    transactionIndex: source.transactionIndex === null
      ? null
      : integer(source.transactionIndex, code),
    eventIndex: integer(source.eventIndex, code),
    eventIndexAuthority: "receipt_log_index",
    occurredAtMs: integer(source.occurredAtMs, code),
    fromAddress: string(source.fromAddress, code),
    toAddress: string(source.toAddress, code),
    amountRaw: BigInt(rawAmount(source.amountRaw, code))
  };
}

function ledgerInput(value: unknown): LedgerInputV1 {
  const code = "offline_corpus_ledger_input_invalid";
  const source = exactRecord(value, [
    "subjectAddress",
    "snapshotBlockNumber",
    "snapshotBlockHash",
    "snapshotEvidenceRef",
    "historyCompleteness",
    "openingBalanceRaw",
    "events"
  ], code);
  if (source.historyCompleteness !== "genesis_complete" && source.historyCompleteness !== "partial") {
    throw new TypeError(code);
  }
  if (!Array.isArray(source.events)) throw new TypeError(code);
  return {
    subjectAddress: string(source.subjectAddress, code),
    snapshotBlockNumber: integer(source.snapshotBlockNumber, code),
    snapshotBlockHash: string(source.snapshotBlockHash, code),
    snapshotEvidenceRef: string(source.snapshotEvidenceRef, code),
    historyCompleteness: source.historyCompleteness,
    openingBalanceRaw: BigInt(rawAmount(source.openingBalanceRaw, code)),
    events: source.events.map(ledgerEvent)
  };
}

function balanceWitness(value: unknown): SnapshotBalanceWitnessV1 {
  const code = "offline_corpus_balance_witness_invalid";
  const source = exactRecord(value, [
    "amountRaw",
    "pinned",
    "independent",
    "subjectAddress",
    "snapshotBlockNumber",
    "snapshotBlockHash",
    "evidenceRef"
  ], code);
  if (typeof source.pinned !== "boolean" || typeof source.independent !== "boolean") {
    throw new TypeError(code);
  }
  return {
    amountRaw: BigInt(rawAmount(source.amountRaw, code)),
    pinned: source.pinned,
    independent: source.independent,
    subjectAddress: string(source.subjectAddress, code),
    snapshotBlockNumber: integer(source.snapshotBlockNumber, code),
    snapshotBlockHash: string(source.snapshotBlockHash, code),
    evidenceRef: string(source.evidenceRef, code)
  };
}

function ledgerQuery(value: unknown, ledger: LedgerQueryV1["ledger"]): LedgerQueryV1 {
  const code = "offline_corpus_ledger_query_invalid";
  const source = record(value, code);
  const allowed = new Set([
    "purpose",
    "requestedAmountRaw",
    "exactEventId",
    "snapshotBalanceWitness",
    "exactRedContributorLotIds"
  ]);
  if (Object.keys(source).some((key) => !allowed.has(key))) throw new TypeError(code);
  const purpose = source.purpose;
  if (purpose !== "current_balance" && purpose !== "amount_only" && purpose !== "exact_episode") {
    throw new TypeError(code);
  }
  const redLotIds = source.exactRedContributorLotIds === undefined
    ? undefined
    : strings(source.exactRedContributorLotIds, code);
  return {
    ledger,
    purpose,
    requestedAmountRaw: source.requestedAmountRaw === undefined
      ? undefined
      : BigInt(rawAmount(source.requestedAmountRaw, code)),
    exactEventId: source.exactEventId === undefined
      ? undefined
      : string(source.exactEventId, code),
    snapshotBalanceWitness: source.snapshotBalanceWitness === undefined
      ? undefined
      : balanceWitness(source.snapshotBalanceWitness),
    exactRedContributorLotIds: redLotIds
  };
}

function publicReason(
  reason: LedgerFailureReasonV1 | LedgerSelectionReasonV1
): NonNullable<LedgerCorpusActualV1["reason"]> {
  switch (reason) {
    case "identity_collision":
    case "identity_unresolved":
      return "canonical_event_identity_unresolved";
    case "order_unresolved":
      return "temporal_order_unresolved";
    case "history_incomplete":
      return "history_incomplete_before_anchor";
    case "debit_exceeds_inventory":
      return "outgoing_exceeds_reconstructed_inventory";
    case "requested_amount_not_positive":
      return "requested_amount_not_positive";
    case "snapshot_inconsistent":
    case "balance_witness_missing":
    case "balance_witness_binding_mismatch":
    case "snapshot_balance_mismatch":
    case "requested_amount_missing":
    case "requested_amount_exceeds_balance":
    case "exact_event_missing":
    case "requested_amount_exceeds_episode":
    default:
      throw new TypeError("offline_corpus_ledger_reason_invalid");
  }
}

function replayCase(value: unknown): { readonly caseId: string; readonly actual: LedgerCorpusActualV1 } {
  const source = record(value, "offline_corpus_ledger_case_invalid");
  const caseId = string(source.id, "offline_corpus_ledger_case_invalid");
  const ledger = runChronologicalProportionalLedgerV1(ledgerInput(source.replayInput));
  const selection = selectLedgerProvenanceV1(ledgerQuery(source.query, ledger));
  return {
    caseId,
    actual: {
      state: selection.state,
      reason: selection.reason === null ? null : publicReason(selection.reason),
      authoritative: ledger.authoritative && selection.state !== "unresolved",
      targetRaw: selection.targetRaw.toString(),
      coveredRaw: selection.coveredRaw.toString(),
      allocations: selection.allocations.map((allocation) => ({
        lotId: allocation.lotId,
        sourceEventId: allocation.sourceEventId,
        sourceAddress: allocation.sourceAddress,
        usedAmountRaw: allocation.amountRaw.toString(),
        sourceOriginalRaw: allocation.sourceOriginalRaw.toString()
      }))
    }
  };
}

function expectedActual(value: unknown): LedgerCorpusActualV1 {
  const code = "offline_corpus_ledger_expectation_invalid";
  const source = exactRecord(value, [
    "state",
    "reason",
    "authoritative",
    "targetRaw",
    "coveredRaw",
    "allocations"
  ], code);
  if (source.state !== "complete" && source.state !== "unresolved" && source.state !== "not_applicable") {
    throw new TypeError(code);
  }
  if (!ACTUAL_REASONS.has(source.reason as LedgerCorpusActualV1["reason"])) {
    throw new TypeError(code);
  }
  if (typeof source.authoritative !== "boolean" || !Array.isArray(source.allocations)) {
    throw new TypeError(code);
  }
  const allocations = source.allocations.map((value) => {
    const item = exactRecord(value, [
      "lotId",
      "sourceEventId",
      "sourceAddress",
      "usedAmountRaw",
      "sourceOriginalRaw"
    ], code);
    return {
      lotId: string(item.lotId, code),
      sourceEventId: string(item.sourceEventId, code),
      sourceAddress: string(item.sourceAddress, code),
      usedAmountRaw: rawAmount(item.usedAmountRaw, code),
      sourceOriginalRaw: rawAmount(item.sourceOriginalRaw, code)
    };
  });
  if (
    (source.state === "unresolved") !== (source.reason !== null) ||
    (source.state === "unresolved" && (source.authoritative || allocations.length > 0))
  ) throw new TypeError(code);
  return {
    state: source.state,
    reason: source.reason as LedgerCorpusActualV1["reason"],
    authoritative: source.authoritative,
    targetRaw: rawAmount(source.targetRaw, code),
    coveredRaw: rawAmount(source.coveredRaw, code),
    allocations
  };
}

export function replayChronologicalLedgerCorpusV1(
  corpus: Pick<ForensicModelOfflineCorpusV1, "ledgerCases">
): LedgerCorpusReplayV1 {
  const caseResults = corpus.ledgerCases.map(replayCase);
  const mismatches: Array<LedgerCorpusReplayV1["mismatches"][number]> = [];
  caseResults.forEach(({ caseId, actual }, index) => {
    try {
      const expected = expectedActual(corpus.ledgerCases[index]?.expectedActual);
      if (canonicalizeArtifactJson(expected) !== canonicalizeArtifactJson(actual)) {
        mismatches.push({ caseId, code: "ledger_expectation_mismatch" });
      }
    } catch {
      mismatches.push({ caseId, code: "ledger_expectation_invalid" });
    }
  });
  return { caseResults, mismatches };
}
