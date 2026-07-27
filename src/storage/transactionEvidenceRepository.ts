import { createHash } from "node:crypto";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import type { Db } from "./db";

const HASH = /^[0-9a-f]{64}$/u;
const PROVIDER_SOURCE = "tron_transaction_provider_evidence_v1";
const DECISION_SOURCE = "selective_transaction_enrichment_v1";

export type TransactionProviderEvidenceIdentityV1 = {
  readonly version: "tron-transaction-provider-evidence-v1";
  readonly chain: "tron";
  readonly txHash: string;
  readonly provider: "tron_fullnode" | "tronscan";
  readonly endpoint: "gettransactionbyid" | "transaction-info";
  readonly providerSchemaVersion: 1;
};

export type TronTransactionProviderEvidenceV1 = TransactionProviderEvidenceIdentityV1 & {
  readonly fetchedAt: string;
  readonly finality: {
    readonly status: "confirmed_success" | "confirmed_failed" | "confirmed_reverted";
    readonly witnessKind: "indexed_tron_usdt_transfer" | "tronscan_transaction_info";
    readonly witnessSha256: string;
  };
  readonly payloadSha256: string;
  readonly payload: unknown;
};

type FullTransactionInfoTrigger =
  | "non_official_usdt_contract"
  | "non_plain_transfer_selector"
  | "non_plain_transfer_method"
  | "multiple_official_usdt_movements"
  | "raw_edge_mismatch"
  | "unresolved_economic_role"
  | "exact_route_linked_assertion"
  | "raw_unavailable_or_ambiguous";

export type TransactionEnrichmentDecisionEvidenceV1 = {
  readonly version: "transaction-enrichment-decision-evidence-v1";
  readonly policyVersion: "selective-transaction-enrichment-v1";
  readonly chain: "tron";
  readonly txHash: string;
  readonly decision:
    | "plain_usdt_raw_proven"
    | "full_transaction_info_confirmed"
    | "confirmed_failed_or_reverted";
  readonly triggerCodes: readonly FullTransactionInfoTrigger[];
  readonly providerEvidenceIds: readonly string[];
  readonly movementWitnessSha256: string;
};

type RawEvidenceRow = {
  readonly id: unknown;
  readonly source: unknown;
  readonly source_type: unknown;
  readonly chain: unknown;
  readonly address: unknown;
  readonly tx_hash: unknown;
  readonly observed_transaction_hash: unknown;
  readonly evidence_json: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedHash(value: unknown, code: string): string {
  if (typeof value !== "string") throw new TypeError(code);
  const normalized = value.toLowerCase();
  if (!HASH.test(normalized)) throw new TypeError(code);
  return normalized;
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("transaction_provider_evidence_not_permanent");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  return value;
}

function normalizeIdentity(
  identity: TransactionProviderEvidenceIdentityV1
): TransactionProviderEvidenceIdentityV1 {
  if (
    identity.version !== "tron-transaction-provider-evidence-v1" ||
    identity.chain !== "tron" ||
    identity.providerSchemaVersion !== 1
  ) {
    throw new TypeError("transaction_provider_evidence_identity_invalid");
  }
  const validPair =
    (identity.provider === "tron_fullnode" && identity.endpoint === "gettransactionbyid") ||
    (identity.provider === "tronscan" && identity.endpoint === "transaction-info");
  if (!validPair) throw new TypeError("transaction_provider_evidence_identity_invalid");
  return {
    version: "tron-transaction-provider-evidence-v1",
    chain: "tron",
    txHash: normalizedHash(identity.txHash, "transaction_provider_evidence_identity_invalid"),
    provider: identity.provider,
    endpoint: identity.endpoint,
    providerSchemaVersion: 1
  };
}

function providerIdentityFromEvidence(
  evidence: TronTransactionProviderEvidenceV1
): TransactionProviderEvidenceIdentityV1 {
  return normalizeIdentity({
    version: evidence.version,
    chain: evidence.chain,
    txHash: evidence.txHash,
    provider: evidence.provider,
    endpoint: evidence.endpoint,
    providerSchemaVersion: evidence.providerSchemaVersion
  });
}

export function transactionProviderEvidenceId(
  identity: TransactionProviderEvidenceIdentityV1
): string {
  const normalized = normalizeIdentity(identity);
  const sha256 = createHash("sha256")
    .update(canonicalizeArtifactJson(normalized))
    .digest("hex");
  return `tron-transaction-provider-evidence-v1:${sha256}`;
}

function payloadTransactionHash(payload: Record<string, unknown>): string | null {
  for (const value of [
    payload.txID,
    payload.txid,
    payload.hash,
    payload.transactionHash,
    payload.transaction_id
  ]) {
    if (typeof value === "string" && HASH.test(value.toLowerCase())) return value.toLowerCase();
  }
  return null;
}

function explicitResult(payload: Record<string, unknown>): string | null {
  const receipt = record(payload.receipt);
  for (const value of [
    receipt?.result,
    payload.finalResult,
    payload.contractRet,
    payload.contract_ret
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim().toUpperCase();
  }
  if (typeof receipt?.success === "boolean") return receipt.success ? "SUCCESS" : "FAILED";
  return null;
}

function resultStatus(result: string): TronTransactionProviderEvidenceV1["finality"]["status"] {
  if (result === "SUCCESS") return "confirmed_success";
  if (result.includes("REVERT")) return "confirmed_reverted";
  return "confirmed_failed";
}

function payloadFinalityStatus(
  payload: Record<string, unknown>
): TronTransactionProviderEvidenceV1["finality"]["status"] | null {
  if (Array.isArray(payload.ret) && payload.ret.length > 0) {
    const results = payload.ret.map((item) => {
      const entry = record(item);
      const value = entry?.contractRet ?? entry?.contract_ret;
      return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
    });
    if (results.some((result) => result === null)) return null;
    if (results.some((result) => result!.includes("REVERT"))) return "confirmed_reverted";
    if (results.every((result) => result === "SUCCESS")) return "confirmed_success";
    return "confirmed_failed";
  }
  const result = explicitResult(payload);
  return result ? resultStatus(result) : null;
}

function validatePermanentEvidence(
  evidence: TronTransactionProviderEvidenceV1
): TronTransactionProviderEvidenceV1 {
  const identity = providerIdentityFromEvidence(evidence);
  const payload = record(evidence.payload);
  if (!payload || payloadTransactionHash(payload) !== identity.txHash) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  if (
    payload.error !== undefined ||
    payload.Error !== undefined ||
    payload.partial === true ||
    payload.pending === true ||
    payload.confirmed === false ||
    payload.found === false ||
    (typeof payload.status === "string" && ["pending", "unconfirmed", "partial"].includes(payload.status.toLowerCase()))
  ) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  if (identity.endpoint === "transaction-info" && payload.confirmed !== true) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  if (payloadFinalityStatus(payload) !== evidence.finality.status) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  const expectedWitnessKind = identity.endpoint === "gettransactionbyid"
    ? "indexed_tron_usdt_transfer"
    : "tronscan_transaction_info";
  if (
    evidence.finality.witnessKind !== expectedWitnessKind ||
    !HASH.test(evidence.finality.witnessSha256) ||
    !HASH.test(evidence.payloadSha256) ||
    evidence.payloadSha256 !== fingerprintCanonicalArtifact(evidence.payload)
  ) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  isoTimestamp(evidence.fetchedAt);
  return { ...evidence, ...identity };
}

function evidenceJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("transaction_provider_evidence_conflict");
  }
}

function validateProviderRow(
  row: RawEvidenceRow,
  identity: TransactionProviderEvidenceIdentityV1
): TronTransactionProviderEvidenceV1 {
  const expected = normalizeIdentity(identity);
  let evidence: TronTransactionProviderEvidenceV1;
  try {
    evidence = validatePermanentEvidence(evidenceJson(row.evidence_json) as TronTransactionProviderEvidenceV1);
  } catch {
    throw new Error("transaction_provider_evidence_conflict");
  }
  if (
    row.id !== transactionProviderEvidenceId(expected) ||
    row.source !== PROVIDER_SOURCE ||
    row.source_type !== "provider_response" ||
    row.chain !== "tron" ||
    row.tx_hash !== expected.txHash ||
    row.observed_transaction_hash !== expected.txHash ||
    canonicalizeArtifactJson(providerIdentityFromEvidence(evidence)) !== canonicalizeArtifactJson(expected)
  ) {
    throw new Error("transaction_provider_evidence_conflict");
  }
  return evidence;
}

async function readRawEvidenceRow(db: Db, id: string): Promise<RawEvidenceRow | null> {
  const result = await db.query(
    `select id, source, source_type, chain, address, tx_hash,
       observed_transaction_hash, evidence_json
     from raw_evidence
     where id = $1`,
    [id]
  );
  return (result.rows[0] as RawEvidenceRow | undefined) ?? null;
}

export async function getTransactionProviderEvidence(
  db: Db,
  identity: TransactionProviderEvidenceIdentityV1
): Promise<TronTransactionProviderEvidenceV1 | null> {
  const normalized = normalizeIdentity(identity);
  const row = await readRawEvidenceRow(db, transactionProviderEvidenceId(normalized));
  return row ? validateProviderRow(row, normalized) : null;
}

export async function saveTransactionProviderEvidence(
  db: Db,
  evidence: TronTransactionProviderEvidenceV1
): Promise<{ id: string; evidence: TronTransactionProviderEvidenceV1 }> {
  const validated = validatePermanentEvidence(evidence);
  const identity = providerIdentityFromEvidence(validated);
  const id = transactionProviderEvidenceId(identity);
  await db.query(
    `insert into raw_evidence (
       id, source, source_type, chain, address, tx_hash,
       observed_transaction_hash, evidence_json
     ) values ($1, $2, $3, $4, null, $5, $5, $6::jsonb)
     on conflict (id) do nothing`,
    [id, PROVIDER_SOURCE, "provider_response", "tron", identity.txHash, canonicalizeArtifactJson(validated)]
  );
  const row = await readRawEvidenceRow(db, id);
  if (!row) throw new Error("transaction_provider_evidence_conflict");
  const saved = validateProviderRow(row, identity);
  if (canonicalizeArtifactJson(saved) !== canonicalizeArtifactJson(validated)) {
    throw new Error("transaction_provider_evidence_conflict");
  }
  return { id, evidence: saved };
}

const TRIGGERS = new Set<FullTransactionInfoTrigger>([
  "non_official_usdt_contract",
  "non_plain_transfer_selector",
  "non_plain_transfer_method",
  "multiple_official_usdt_movements",
  "raw_edge_mismatch",
  "unresolved_economic_role",
  "exact_route_linked_assertion",
  "raw_unavailable_or_ambiguous"
]);

function normalizeDecision(
  evidence: TransactionEnrichmentDecisionEvidenceV1
): TransactionEnrichmentDecisionEvidenceV1 {
  if (
    evidence.version !== "transaction-enrichment-decision-evidence-v1" ||
    evidence.policyVersion !== "selective-transaction-enrichment-v1" ||
    evidence.chain !== "tron" ||
    !["plain_usdt_raw_proven", "full_transaction_info_confirmed", "confirmed_failed_or_reverted"]
      .includes(evidence.decision)
  ) {
    throw new TypeError("transaction_enrichment_decision_evidence_invalid");
  }
  const txHash = normalizedHash(evidence.txHash, "transaction_enrichment_decision_evidence_invalid");
  const triggerCodes = [...new Set(evidence.triggerCodes)];
  if (triggerCodes.some((code) => !TRIGGERS.has(code))) {
    throw new TypeError("transaction_enrichment_decision_evidence_invalid");
  }
  const providerEvidenceIds = [...new Set(evidence.providerEvidenceIds)].sort();
  if (
    providerEvidenceIds.length === 0 ||
    providerEvidenceIds.some((id) => !/^tron-transaction-provider-evidence-v1:[0-9a-f]{64}$/u.test(id)) ||
    !HASH.test(evidence.movementWitnessSha256)
  ) {
    throw new TypeError("transaction_enrichment_decision_evidence_invalid");
  }
  return { ...evidence, txHash, triggerCodes, providerEvidenceIds };
}

function decisionEvidenceId(evidence: TransactionEnrichmentDecisionEvidenceV1): string {
  return `transaction-enrichment-decision-evidence-v1:${fingerprintCanonicalArtifact({
    version: evidence.version,
    policyVersion: evidence.policyVersion,
    chain: evidence.chain,
    txHash: evidence.txHash,
    decision: evidence.decision,
    providerEvidenceIds: evidence.providerEvidenceIds,
    movementWitnessSha256: evidence.movementWitnessSha256
  })}`;
}

function validateDecisionRow(
  row: RawEvidenceRow,
  expected: TransactionEnrichmentDecisionEvidenceV1,
  id: string
): TransactionEnrichmentDecisionEvidenceV1 {
  let actual: TransactionEnrichmentDecisionEvidenceV1;
  try {
    actual = normalizeDecision(evidenceJson(row.evidence_json) as TransactionEnrichmentDecisionEvidenceV1);
  } catch {
    throw new Error("transaction_enrichment_decision_evidence_conflict");
  }
  if (
    row.id !== id ||
    row.source !== DECISION_SOURCE ||
    row.source_type !== "detector_output" ||
    row.chain !== "tron" ||
    row.tx_hash !== expected.txHash ||
    row.observed_transaction_hash !== expected.txHash ||
    canonicalizeArtifactJson(actual) !== canonicalizeArtifactJson(expected)
  ) {
    throw new Error("transaction_enrichment_decision_evidence_conflict");
  }
  return actual;
}

export async function saveTransactionEnrichmentDecisionEvidence(
  db: Db,
  evidence: TransactionEnrichmentDecisionEvidenceV1
): Promise<{ id: string; evidence: TransactionEnrichmentDecisionEvidenceV1 }> {
  const normalized = normalizeDecision(evidence);
  const providers: TronTransactionProviderEvidenceV1[] = [];
  try {
    for (const providerEvidenceId of normalized.providerEvidenceIds) {
      const row = await readRawEvidenceRow(db, providerEvidenceId);
      if (!row) throw new Error("missing_provider_evidence");
      const stored = evidenceJson(row.evidence_json) as TronTransactionProviderEvidenceV1;
      const identity = providerIdentityFromEvidence(stored);
      const provider = validateProviderRow(row, identity);
      if (provider.txHash !== normalized.txHash) throw new Error("foreign_provider_evidence");
      providers.push(provider);
    }
  } catch {
    throw new TypeError("transaction_enrichment_decision_evidence_invalid");
  }
  const decisionProven = normalized.decision === "plain_usdt_raw_proven"
    ? providers.some((provider) =>
      provider.endpoint === "gettransactionbyid" &&
      provider.finality.status === "confirmed_success" &&
      provider.finality.witnessSha256 === normalized.movementWitnessSha256)
    : normalized.decision === "full_transaction_info_confirmed"
      ? providers.some((provider) =>
        provider.endpoint === "transaction-info" &&
        provider.finality.status === "confirmed_success")
      : providers.some((provider) => provider.finality.status !== "confirmed_success");
  if (!decisionProven) {
    throw new TypeError("transaction_enrichment_decision_evidence_invalid");
  }
  const id = decisionEvidenceId(normalized);
  await db.query(
    `insert into raw_evidence (
       id, source, source_type, chain, address, tx_hash,
       observed_transaction_hash, evidence_json
     ) values ($1, $2, $3, $4, null, $5, $5, $6::jsonb)
     on conflict (id) do nothing`,
    [id, DECISION_SOURCE, "detector_output", "tron", normalized.txHash, canonicalizeArtifactJson(normalized)]
  );
  const row = await readRawEvidenceRow(db, id);
  if (!row) throw new Error("transaction_enrichment_decision_evidence_conflict");
  return { id, evidence: validateDecisionRow(row, normalized, id) };
}
