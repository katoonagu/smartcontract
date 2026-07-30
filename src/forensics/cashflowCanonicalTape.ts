import { fingerprintCanonicalArtifact } from "./canonicalJson.js";
import {
  runChronologicalProportionalLedgerV1,
  type LedgerFailureReasonV1,
  type LedgerInputV1,
  type LedgerQueryV1,
  type LedgerSelectionReasonV1
} from "./chronologicalProportionalLedger.js";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser.js";

export type CashflowPublicUnresolvedReasonV1 =
  | "canonical_event_identity_unresolved"
  | "temporal_order_unresolved"
  | "history_incomplete_before_anchor"
  | "anchor_balance_witness_missing"
  | "snapshot_balance_mismatch"
  | "outgoing_exceeds_reconstructed_inventory"
  | "requested_amount_missing"
  | "requested_amount_not_positive"
  | "requested_amount_exceeds_snapshot_balance"
  | "economic_role_unresolved"
  | "provider_or_snapshot_inconsistent";

export const PUBLIC_REASONS = new Set<CashflowPublicUnresolvedReasonV1>([
  "canonical_event_identity_unresolved",
  "temporal_order_unresolved",
  "history_incomplete_before_anchor",
  "anchor_balance_witness_missing",
  "snapshot_balance_mismatch",
  "outgoing_exceeds_reconstructed_inventory",
  "requested_amount_missing",
  "requested_amount_not_positive",
  "requested_amount_exceeds_snapshot_balance",
  "economic_role_unresolved",
  "provider_or_snapshot_inconsistent"
]);

export function publicReason(value: unknown): value is CashflowPublicUnresolvedReasonV1 {
  return typeof value === "string"
    && PUBLIC_REASONS.has(value as CashflowPublicUnresolvedReasonV1);
}

export type CashflowTapeQueryV1 =
  | {
      readonly purpose: "current_balance";
      readonly exactRedContributorLotIds: readonly string[];
    }
  | {
      readonly purpose: "amount_only";
      readonly requestedAmountRaw: string;
      readonly exactRedContributorLotIds: readonly string[];
    }
  | {
      readonly purpose: "exact_episode";
      readonly exactEventId: string;
      readonly exactRedContributorLotIds: readonly string[];
    };

export type CashflowCanonicalTapeBodyV1 = {
  readonly tapeId: string;
  readonly chain: "tron";
  readonly tokenContract: typeof TRON_USDT_CONTRACT_ADDRESS;
  readonly subjectAddress: string;
  readonly snapshot: {
    readonly blockNumber: number;
    readonly blockHash: string;
    readonly evidenceRef: string;
    readonly balance: {
      readonly amountRaw: string | null;
      readonly pinned: boolean;
      readonly independent: boolean;
      readonly evidenceRef: string | null;
    };
  };
  readonly history: {
    readonly completeness: "genesis_complete" | "partial";
    readonly openingBalanceRaw: string | null;
    readonly evidenceRef: string | null;
  };
  readonly movements: readonly {
    readonly canonicalEventId: string;
    readonly providerEventIds: readonly string[];
    readonly txHash: string;
    readonly blockNumber: number;
    readonly transactionIndex: number | null;
    readonly eventIndex: number;
    readonly eventIndexAuthority: "receipt_log_index";
    readonly occurredAtMs: number;
    readonly fromAddress: string;
    readonly toAddress: string;
    readonly amountRaw: string;
    readonly finality: "confirmed_success";
    readonly identityEvidenceRef: string;
    readonly finalityEvidenceRef: string;
    readonly orderEvidenceRef: string | null;
  }[];
  readonly query: CashflowTapeQueryV1;
  readonly economicRoleCoverage: "complete" | "incomplete";
  readonly evidenceRefs: readonly string[];
};

export type CashflowCanonicalTapeArtifactV1 = {
  readonly schemaVersion: "cashflow-canonical-tape-v1";
  readonly artifactSha256: string;
  readonly body: CashflowCanonicalTapeBodyV1;
};

export type CashflowAuthorityEnvelopeV1 =
  | {
      readonly kind: "unavailable";
      readonly typedReason: CashflowPublicUnresolvedReasonV1;
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly kind: "canonical_tape";
      readonly tape: CashflowCanonicalTapeArtifactV1;
    };

const RAW_AMOUNT = /^(0|[1-9][0-9]*)$/u;
const TX_HASH = /^[0-9a-f]{64}$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EXACT_EVENT_ID = /^receipt:[0-9a-f]{64}:[0-9]+$/u;

function fail(): never {
  throw new TypeError("cashflow_canonical_tape_invalid");
}

function record(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => {
    const descriptor = descriptors[key as string];
    return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
  })) return fail();
  return value as Record<string, unknown>;
}

function string(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    return fail();
  }
  return value;
}

function nullableString(value: unknown, pattern?: RegExp): string | null {
  return value === null ? null : string(value, pattern);
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail();
  return value;
}

function boolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail();
}

function rawAmount(value: unknown): string {
  return string(value, RAW_AMOUNT);
}

function sortedStrings(value: unknown, allowEmpty = true): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return fail();
  const values = value.map((item) => string(item));
  if (
    new Set(values).size !== values.length
    || values.some((item, index) => index > 0 && values[index - 1]! >= item)
  ) return fail();
  return values;
}

function parseMovement(
  value: unknown
): CashflowCanonicalTapeBodyV1["movements"][number] {
  const source = record(value, [
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
    "amountRaw",
    "finality",
    "identityEvidenceRef",
    "finalityEvidenceRef",
    "orderEvidenceRef"
  ]);
  const txHash = string(source.txHash, TX_HASH);
  const eventIndex = integer(source.eventIndex);
  const transactionIndex = source.transactionIndex === null
    ? null
    : integer(source.transactionIndex);
  const orderEvidenceRef = nullableString(source.orderEvidenceRef);
  if ((transactionIndex === null) !== (orderEvidenceRef === null)) return fail();
  const canonicalEventId = string(source.canonicalEventId);
  if (canonicalEventId !== `receipt:${txHash}:${eventIndex}`) return fail();
  if (
    source.eventIndexAuthority !== "receipt_log_index"
    || source.finality !== "confirmed_success"
  ) return fail();
  return {
    canonicalEventId,
    providerEventIds: sortedStrings(source.providerEventIds, false),
    txHash,
    blockNumber: integer(source.blockNumber),
    transactionIndex,
    eventIndex,
    eventIndexAuthority: "receipt_log_index",
    occurredAtMs: integer(source.occurredAtMs),
    fromAddress: string(source.fromAddress, TRON_ADDRESS),
    toAddress: string(source.toAddress, TRON_ADDRESS),
    amountRaw: rawAmount(source.amountRaw),
    finality: "confirmed_success",
    identityEvidenceRef: string(source.identityEvidenceRef),
    finalityEvidenceRef: string(source.finalityEvidenceRef),
    orderEvidenceRef
  };
}

function parseQuery(value: unknown): CashflowTapeQueryV1 {
  const source = record(value, [
    "purpose",
    "requestedAmountRaw",
    "exactEventId",
    "exactRedContributorLotIds"
  ]);
  if (source.purpose === "current_balance") {
    const query = record(value, ["purpose", "exactRedContributorLotIds"]);
    return {
      purpose: "current_balance",
      exactRedContributorLotIds: sortedStrings(query.exactRedContributorLotIds)
    };
  }
  if (source.purpose === "amount_only") {
    const query = record(value, ["purpose", "requestedAmountRaw", "exactRedContributorLotIds"]);
    const requestedAmountRaw = rawAmount(query.requestedAmountRaw);
    if (requestedAmountRaw === "0") return fail();
    return {
      purpose: "amount_only",
      requestedAmountRaw,
      exactRedContributorLotIds: sortedStrings(query.exactRedContributorLotIds)
    };
  }
  if (source.purpose === "exact_episode") {
    const query = record(value, ["purpose", "exactEventId", "exactRedContributorLotIds"]);
    return {
      purpose: "exact_episode",
      exactEventId: string(query.exactEventId, EXACT_EVENT_ID),
      exactRedContributorLotIds: sortedStrings(query.exactRedContributorLotIds)
    };
  }
  return fail();
}

function parseTapeBody(value: unknown): CashflowCanonicalTapeBodyV1 {
  const source = record(value, [
    "tapeId",
    "chain",
    "tokenContract",
    "subjectAddress",
    "snapshot",
    "history",
    "movements",
    "query",
    "economicRoleCoverage",
    "evidenceRefs"
  ]);
  if (source.chain !== "tron" || source.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) {
    return fail();
  }

  const snapshotSource = record(source.snapshot, [
    "blockNumber",
    "blockHash",
    "evidenceRef",
    "balance"
  ]);
  const balanceSource = record(snapshotSource.balance, [
    "amountRaw",
    "pinned",
    "independent",
    "evidenceRef"
  ]);
  const balance = {
    amountRaw: balanceSource.amountRaw === null ? null : rawAmount(balanceSource.amountRaw),
    pinned: boolean(balanceSource.pinned),
    independent: boolean(balanceSource.independent),
    evidenceRef: nullableString(balanceSource.evidenceRef)
  };
  const authoritativeBalance = balance.amountRaw !== null
    && balance.pinned
    && balance.independent
    && balance.evidenceRef !== null;
  const absentBalance = balance.amountRaw === null
    && !balance.pinned
    && !balance.independent
    && balance.evidenceRef === null;
  if (!authoritativeBalance && !absentBalance) return fail();

  const historySource = record(source.history, [
    "completeness",
    "openingBalanceRaw",
    "evidenceRef"
  ]);
  if (
    historySource.completeness !== "genesis_complete"
    && historySource.completeness !== "partial"
  ) return fail();
  const completeness: CashflowCanonicalTapeBodyV1["history"]["completeness"] =
    historySource.completeness;
  const history = {
    completeness,
    openingBalanceRaw: historySource.openingBalanceRaw === null
      ? null
      : rawAmount(historySource.openingBalanceRaw),
    evidenceRef: nullableString(historySource.evidenceRef)
  };
  if (
    history.completeness === "genesis_complete"
      ? history.openingBalanceRaw === null || history.evidenceRef === null
      : history.openingBalanceRaw !== null
  ) return fail();

  if (!Array.isArray(source.movements)) return fail();
  const movements = source.movements.map(parseMovement);
  if (movements.some((movement, index) =>
    index > 0 && movements[index - 1]!.canonicalEventId >= movement.canonicalEventId
  )) return fail();

  if (
    source.economicRoleCoverage !== "complete"
    && source.economicRoleCoverage !== "incomplete"
  ) return fail();

  return {
    tapeId: string(source.tapeId),
    chain: "tron",
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    subjectAddress: string(source.subjectAddress, TRON_ADDRESS),
    snapshot: {
      blockNumber: integer(snapshotSource.blockNumber),
      blockHash: string(snapshotSource.blockHash, SHA256),
      evidenceRef: string(snapshotSource.evidenceRef),
      balance
    },
    history,
    movements,
    query: parseQuery(source.query),
    economicRoleCoverage: source.economicRoleCoverage,
    evidenceRefs: sortedStrings(source.evidenceRefs, false)
  };
}

export function parseCashflowCanonicalTapeArtifactV1(
  value: unknown
): CashflowCanonicalTapeArtifactV1 {
  try {
    const source = record(value, ["schemaVersion", "artifactSha256", "body"]);
    if (source.schemaVersion !== "cashflow-canonical-tape-v1") return fail();
    const body = parseTapeBody(source.body);
    const artifactSha256 = string(source.artifactSha256, SHA256);
    if (fingerprintCanonicalArtifact(body) !== artifactSha256) return fail();
    return { schemaVersion: "cashflow-canonical-tape-v1", artifactSha256, body };
  } catch {
    return fail();
  }
}

export function parseCashflowAuthorityEnvelopeV1(value: unknown): CashflowAuthorityEnvelopeV1 {
  try {
    const discriminated = record(value, ["kind", "tape", "typedReason", "evidenceRefs"]);
    if (discriminated.kind === "canonical_tape") {
      const source = record(value, ["kind", "tape"]);
      return { kind: "canonical_tape", tape: parseCashflowCanonicalTapeArtifactV1(source.tape) };
    }
    const source = record(value, ["kind", "typedReason", "evidenceRefs"]);
    if (source.kind !== "unavailable" || !publicReason(source.typedReason)) return fail();
    return {
      kind: "unavailable",
      typedReason: source.typedReason,
      evidenceRefs: sortedStrings(source.evidenceRefs)
    };
  } catch {
    return fail();
  }
}

export function materializeCashflowCanonicalTapeV1(
  tape: CashflowCanonicalTapeArtifactV1
): { readonly input: LedgerInputV1; readonly query: LedgerQueryV1 } {
  const body = tape.body;
  const input: LedgerInputV1 = {
    subjectAddress: body.subjectAddress,
    snapshotBlockNumber: body.snapshot.blockNumber,
    snapshotBlockHash: body.snapshot.blockHash,
    snapshotEvidenceRef: body.snapshot.evidenceRef,
    historyCompleteness: body.history.completeness,
    openingBalanceRaw: BigInt(body.history.openingBalanceRaw ?? "0"),
    events: [...body.movements]
      .sort((left, right) =>
        left.canonicalEventId < right.canonicalEventId
          ? -1
          : left.canonicalEventId > right.canonicalEventId ? 1 : 0
      )
      .map((movement) => ({
        canonicalEventId: movement.canonicalEventId,
        providerEventIds: movement.providerEventIds,
        txHash: movement.txHash,
        blockNumber: movement.blockNumber,
        transactionIndex: movement.transactionIndex,
        eventIndex: movement.eventIndex,
        eventIndexAuthority: movement.eventIndexAuthority,
        occurredAtMs: movement.occurredAtMs,
        fromAddress: movement.fromAddress,
        toAddress: movement.toAddress,
        amountRaw: BigInt(movement.amountRaw)
      }))
  };
  const ledger = runChronologicalProportionalLedgerV1(input);
  const balance = body.snapshot.balance;
  const query: LedgerQueryV1 = {
    ledger,
    purpose: body.query.purpose,
    ...(body.query.purpose === "amount_only"
      ? { requestedAmountRaw: BigInt(body.query.requestedAmountRaw) }
      : {}),
    ...(body.query.purpose === "exact_episode"
      ? { exactEventId: body.query.exactEventId }
      : {}),
    exactRedContributorLotIds: body.query.exactRedContributorLotIds,
    ...(balance.amountRaw === null
      ? {}
      : {
          snapshotBalanceWitness: {
            amountRaw: BigInt(balance.amountRaw),
            pinned: true,
            independent: true,
            subjectAddress: body.subjectAddress,
            snapshotBlockNumber: body.snapshot.blockNumber,
            snapshotBlockHash: body.snapshot.blockHash,
            evidenceRef: balance.evidenceRef as string
          }
        })
  };
  return { input, query };
}

export function cashflowPublicReasonV1(
  reason: LedgerFailureReasonV1 | LedgerSelectionReasonV1
): CashflowPublicUnresolvedReasonV1 {
  switch (reason) {
    case "identity_collision":
    case "identity_unresolved":
    case "exact_event_missing":
      return "canonical_event_identity_unresolved";
    case "order_unresolved":
      return "temporal_order_unresolved";
    case "history_incomplete":
      return "history_incomplete_before_anchor";
    case "snapshot_inconsistent":
    case "balance_witness_binding_mismatch":
    case "requested_amount_exceeds_episode":
      return "provider_or_snapshot_inconsistent";
    case "debit_exceeds_inventory":
      return "outgoing_exceeds_reconstructed_inventory";
    case "balance_witness_missing":
      return "anchor_balance_witness_missing";
    case "snapshot_balance_mismatch":
      return "snapshot_balance_mismatch";
    case "requested_amount_missing":
      return "requested_amount_missing";
    case "requested_amount_not_positive":
      return "requested_amount_not_positive";
    case "requested_amount_exceeds_balance":
      return "requested_amount_exceeds_snapshot_balance";
  }
}
