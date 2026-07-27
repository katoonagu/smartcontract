import { createHash } from "node:crypto";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import {
  forensicRouteEdgeHasExactMovementIdentity,
  forensicRouteEdgeIdentity
} from "../forensics/localTronUsdtIndex";
import { parseRawTransactionPreflightV1 } from "../tron/rawTransactionPreflight";
import type { ForensicRouteEdge } from "../types";
import type { Db } from "./db";

const HASH = /^[0-9a-f]{64}$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
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
    readonly movement: TransactionProviderMovementWitnessV1 | null;
  };
  readonly payloadSha256: string;
  readonly payload: unknown;
};

export type TransactionProviderMovementWitnessV1 = {
  readonly txHash: string;
  readonly transferId?: string;
  readonly eventIndex?: number | null;
  readonly provider?: string;
  readonly providerRowOrdinalInTx?: number | null;
  readonly contractAddress: string;
  readonly callerAddress: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly amountRaw: string;
  readonly confirmed: boolean;
  readonly reverted: boolean;
  readonly contractRet: string;
  readonly finalResult: string;
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

function endpointWitnessProjection(
  identity: TransactionProviderEvidenceIdentityV1,
  payload: Record<string, unknown>,
  status: TronTransactionProviderEvidenceV1["finality"]["status"],
  movement: TransactionProviderMovementWitnessV1 | null
): Readonly<Record<string, unknown>> {
  if (identity.endpoint === "gettransactionbyid") {
    const rawData = record(payload.raw_data);
    if (
      typeof payload.txID !== "string" ||
      payload.hash !== undefined ||
      payload.receipt !== undefined ||
      payload.confirmed !== undefined ||
      payload.contractRet !== undefined ||
      payload.contract_ret !== undefined ||
      payload.finalResult !== undefined ||
      payload.result !== undefined ||
      payload.status !== undefined ||
      payload.revert !== undefined ||
      !rawData ||
      !Array.isArray(rawData.contract) ||
      rawData.contract.length === 0 ||
      !Array.isArray(payload.ret) ||
      payload.ret.length === 0
    ) {
      throw new TypeError("transaction_provider_evidence_not_permanent");
    }
    const txHash = normalizedHash(payload.txID, "transaction_provider_evidence_not_permanent");
    if (txHash !== identity.txHash) {
      throw new TypeError("transaction_provider_evidence_not_permanent");
    }
    const contractResults = payload.ret.map((item) => {
      const result = record(item);
      const contractRet = result?.contractRet ?? result?.contract_ret;
      if (typeof contractRet !== "string" || !contractRet.trim()) {
        throw new TypeError("transaction_provider_evidence_not_permanent");
      }
      return contractRet.trim().toUpperCase();
    });
    if (!movement) throw new TypeError("transaction_provider_evidence_not_permanent");
    const transferIdValid = movement.transferId === undefined || (
      typeof movement.transferId === "string" &&
      movement.transferId.trim() === movement.transferId &&
      movement.transferId.length > 0 &&
      movement.transferId.length <= 512
    );
    const eventIndexValid = movement.eventIndex === undefined || movement.eventIndex === null || (
      Number.isSafeInteger(movement.eventIndex) && movement.eventIndex >= 0
    );
    const providerValid = movement.provider === undefined || (
      typeof movement.provider === "string" &&
      movement.provider.trim() === movement.provider &&
      movement.provider.length > 0 &&
      movement.provider.length <= 128
    );
    const ordinalValid = movement.providerRowOrdinalInTx === undefined ||
      movement.providerRowOrdinalInTx === null || (
        Number.isSafeInteger(movement.providerRowOrdinalInTx) &&
        movement.providerRowOrdinalInTx >= 0
      );
    if (!transferIdValid || !eventIndexValid || !providerValid || !ordinalValid) {
      throw new TypeError("transaction_provider_evidence_not_permanent");
    }
    const normalizedMovement: TransactionProviderMovementWitnessV1 = {
      txHash: normalizedHash(movement.txHash, "transaction_provider_evidence_not_permanent"),
      ...(movement.transferId ? { transferId: movement.transferId } : {}),
      ...(movement.eventIndex !== undefined ? { eventIndex: movement.eventIndex } : {}),
      ...(movement.provider ? { provider: movement.provider } : {}),
      ...(movement.providerRowOrdinalInTx !== undefined
        ? { providerRowOrdinalInTx: movement.providerRowOrdinalInTx }
        : {}),
      contractAddress: movement.contractAddress,
      callerAddress: movement.callerAddress,
      fromAddress: movement.fromAddress,
      toAddress: movement.toAddress,
      amountRaw: movement.amountRaw,
      confirmed: movement.confirmed,
      reverted: movement.reverted,
      contractRet: movement.contractRet,
      finalResult: movement.finalResult
    };
    const identityEdge = {
      ...normalizedMovement,
      id: "",
      timestamp: new Date(0),
      method: "transfer",
      edgeType: "normal_transfer"
    } as ForensicRouteEdge;
    const rawPreflight = parseRawTransactionPreflightV1(payload);
    const movementResult = resultStatus(normalizedMovement.finalResult.toUpperCase());
    const parsedFieldsAgree = rawPreflight.status === "ambiguous" || (
      rawPreflight.contractAddress === normalizedMovement.contractAddress &&
      rawPreflight.callerAddress === normalizedMovement.callerAddress &&
      (rawPreflight.selector !== "a9059cbb" || rawPreflight.callerAddress === normalizedMovement.fromAddress) &&
      (rawPreflight.recipientAddress === null || rawPreflight.recipientAddress === normalizedMovement.toAddress) &&
      (rawPreflight.amountRaw === null || rawPreflight.amountRaw === normalizedMovement.amountRaw)
    );
    if (
      normalizedMovement.txHash !== identity.txHash ||
      !forensicRouteEdgeHasExactMovementIdentity(identityEdge) ||
      !TRON_ADDRESS.test(normalizedMovement.contractAddress) ||
      !TRON_ADDRESS.test(normalizedMovement.callerAddress) ||
      !TRON_ADDRESS.test(normalizedMovement.fromAddress) ||
      !TRON_ADDRESS.test(normalizedMovement.toAddress) ||
      !/^(0|[1-9][0-9]*)$/u.test(normalizedMovement.amountRaw) ||
      normalizedMovement.confirmed !== true ||
      normalizedMovement.reverted !== (status === "confirmed_reverted") ||
      normalizedMovement.contractRet.trim().length === 0 ||
      normalizedMovement.finalResult.trim().length === 0 ||
      normalizedMovement.contractRet !== normalizedMovement.contractRet.toUpperCase() ||
      normalizedMovement.finalResult !== normalizedMovement.finalResult.toUpperCase() ||
      resultStatus(normalizedMovement.contractRet.toUpperCase()) !== status ||
      movementResult !== status ||
      !parsedFieldsAgree
    ) {
      throw new TypeError("transaction_provider_evidence_not_permanent");
    }
    return {
      txHash,
      rawPreflight,
      contractResults,
      movementIdentity: forensicRouteEdgeIdentity(identityEdge),
      movement: normalizedMovement
    };
  }

  if (
    typeof payload.hash !== "string" ||
    payload.txID !== undefined ||
    payload.raw_data !== undefined ||
    payload.ret !== undefined ||
    payload.confirmed !== true ||
    movement !== null
  ) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  const txHash = normalizedHash(payload.hash, "transaction_provider_evidence_not_permanent");
  if (txHash !== identity.txHash) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  const receipt = record(payload.receipt);
  return {
    txHash,
    confirmed: true,
    contractRet: typeof payload.contractRet === "string" ? payload.contractRet.trim().toUpperCase() : null,
    finalResult: typeof payload.finalResult === "string" ? payload.finalResult.trim().toUpperCase() : null,
    result: payload.result ?? null,
    status: payload.status ?? null,
    revert: payload.revert ?? null,
    receiptResult: typeof receipt?.result === "string" ? receipt.result.trim().toUpperCase() : null,
    receiptSuccess: typeof receipt?.success === "boolean" ? receipt.success : null
  };
}

export function transactionProviderFinalityWitnessSha256(input: {
  readonly identity: TransactionProviderEvidenceIdentityV1;
  readonly status: TronTransactionProviderEvidenceV1["finality"]["status"];
  readonly payload: unknown;
  readonly movement: TransactionProviderMovementWitnessV1 | null;
}): string {
  const identity = normalizeIdentity(input.identity);
  const payload = record(input.payload);
  if (!payload || endpointFinalityStatus(identity, payload) !== input.status) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  const witnessKind = identity.endpoint === "gettransactionbyid"
    ? "indexed_tron_usdt_transfer"
    : "tronscan_transaction_info";
  return fingerprintCanonicalArtifact({
    version: "tron-transaction-provider-finality-witness-v1",
    identity,
    finality: { status: input.status, witnessKind },
    endpointEvidence: endpointWitnessProjection(identity, payload, input.status, input.movement)
  });
}

function resultStatus(result: string): TronTransactionProviderEvidenceV1["finality"]["status"] {
  if (result === "SUCCESS") return "confirmed_success";
  if (result.includes("REVERT")) return "confirmed_reverted";
  return "confirmed_failed";
}

function endpointFinalityStatus(
  identity: TransactionProviderEvidenceIdentityV1,
  payload: Record<string, unknown>
): TronTransactionProviderEvidenceV1["finality"]["status"] | null {
  if (identity.endpoint === "gettransactionbyid") {
    if (
      payload.hash !== undefined ||
      payload.receipt !== undefined ||
      payload.confirmed !== undefined ||
      payload.contractRet !== undefined ||
      payload.contract_ret !== undefined ||
      payload.finalResult !== undefined ||
      payload.result !== undefined ||
      payload.status !== undefined ||
      payload.revert !== undefined ||
      !Array.isArray(payload.ret) ||
      payload.ret.length === 0
    ) return null;
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

  if (
    payload.txID !== undefined ||
    payload.raw_data !== undefined ||
    payload.ret !== undefined ||
    payload.confirmed !== true
  ) return null;
  const receipt = record(payload.receipt);
  const statuses: Array<TronTransactionProviderEvidenceV1["finality"]["status"]> = [];
  for (const value of [
    receipt?.result,
    payload.finalResult,
    payload.contractRet,
    payload.contract_ret,
    payload.result
  ]) {
    if (value === undefined) continue;
    statuses.push(typeof value === "string" && value.trim()
      ? resultStatus(value.trim().toUpperCase())
      : "confirmed_failed");
  }
  if (typeof receipt?.success === "boolean") {
    statuses.push(receipt.success ? "confirmed_success" : "confirmed_failed");
  }
  if (payload.revert !== undefined) {
    if (payload.revert === true) statuses.push("confirmed_reverted");
    else if (payload.revert !== false) statuses.push("confirmed_failed");
  }
  if (payload.status !== undefined) {
    const status = payload.status;
    statuses.push(status === 0 || status === "0" || status === "SUCCESS"
      ? "confirmed_success"
      : typeof status === "string" && status.toUpperCase().includes("REVERT")
        ? "confirmed_reverted"
        : "confirmed_failed");
  }
  if (statuses.length === 0) return null;
  if (statuses.includes("confirmed_reverted")) return "confirmed_reverted";
  if (statuses.includes("confirmed_failed")) return "confirmed_failed";
  return "confirmed_success";
}

function validatePermanentEvidence(
  evidence: TronTransactionProviderEvidenceV1
): TronTransactionProviderEvidenceV1 {
  const identity = providerIdentityFromEvidence(evidence);
  const payload = record(evidence.payload);
  if (!payload) {
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
  if (endpointFinalityStatus(identity, payload) !== evidence.finality.status) {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  const expectedWitnessKind = identity.endpoint === "gettransactionbyid"
    ? "indexed_tron_usdt_transfer"
    : "tronscan_transaction_info";
  let expectedWitnessSha256: string;
  try {
    expectedWitnessSha256 = transactionProviderFinalityWitnessSha256({
      identity,
      status: evidence.finality.status,
      payload: evidence.payload,
      movement: evidence.finality.movement
    });
  } catch {
    throw new TypeError("transaction_provider_evidence_not_permanent");
  }
  if (
    evidence.finality.witnessKind !== expectedWitnessKind ||
    !HASH.test(evidence.finality.witnessSha256) ||
    evidence.finality.witnessSha256 !== expectedWitnessSha256 ||
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
  const { fetchedAt: _savedFetchedAt, ...savedSemanticEvidence } = saved;
  const { fetchedAt: _candidateFetchedAt, ...candidateSemanticEvidence } = validated;
  if (canonicalizeArtifactJson(savedSemanticEvidence) !== canonicalizeArtifactJson(candidateSemanticEvidence)) {
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
  const rawPlain = providers.length === 1 && providers[0].endpoint === "gettransactionbyid"
    ? parseRawTransactionPreflightV1(providers[0].payload)
    : null;
  const decisionProven = normalized.decision === "plain_usdt_raw_proven"
    ? providers.length === 1 &&
      normalized.triggerCodes.length === 0 &&
      providers[0].endpoint === "gettransactionbyid" &&
      providers[0].finality.status === "confirmed_success" &&
      providers[0].finality.witnessSha256 === normalized.movementWitnessSha256 &&
      rawPlain?.status === "parsed" &&
      rawPlain.successful === true
    : normalized.decision === "full_transaction_info_confirmed"
      ? normalized.triggerCodes.length > 0 &&
        providers.every((provider) => provider.finality.status === "confirmed_success") &&
        providers.some((provider) =>
          provider.endpoint === "transaction-info" &&
          provider.finality.status === "confirmed_success" &&
          provider.finality.witnessSha256 === normalized.movementWitnessSha256)
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
