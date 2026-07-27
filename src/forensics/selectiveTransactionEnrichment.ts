import { fingerprintCanonicalArtifact } from "./canonicalJson";
import {
  forensicRouteEdgeHasExactMovementIdentity,
  forensicRouteEdgeIdentity
} from "./localTronUsdtIndex";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import {
  transactionProviderEvidenceId,
  transactionProviderFinalityWitnessSha256,
  type TransactionEnrichmentDecisionEvidenceV1,
  type TransactionProviderEvidenceIdentityV1,
  type TransactionProviderMovementWitnessV1,
  type TronTransactionProviderEvidenceV1
} from "../storage/transactionEvidenceRepository";
import { parseRawTransactionPreflightV1, type RawTransactionPreflightV1 } from "../tron/rawTransactionPreflight";
import type {
  ForensicRouteEdge,
  FullTransactionInfoTrigger,
  TransactionEnrichmentDecisionV1,
  WhereTransactionInfoEnrichmentSummary
} from "../types";

const HASH = /^[0-9a-f]{64}$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
const POLICY_VERSION = "selective-transaction-enrichment-v1" as const;
const RAW_PROVIDER = {
  provider: "tron_fullnode",
  endpoint: "gettransactionbyid"
} as const;
const FULL_PROVIDER = {
  provider: "tronscan",
  endpoint: "transaction-info"
} as const;

export type SelectiveTransactionEnrichmentMode = "subject" | "intermediate_boundary";

export type RouteLinkedAssertionInput = {
  chain: string;
  address: string;
  status: string;
  evidenceJson: unknown;
};

export type SelectiveTransactionEnrichmentInput = {
  mode: SelectiveTransactionEnrichmentMode;
  routeEdges: readonly ForensicRouteEdge[];
  movements: readonly ForensicRouteEdge[];
  assertions?: readonly RouteLinkedAssertionInput[];
  hardTxHashes?: readonly string[];
  unresolvedEconomicRoleTxHashes?: readonly string[];
};

export type SelectiveTransactionCandidate = {
  readonly id: string;
  readonly txHash: string;
  readonly priority: "hard" | "optional";
  readonly triggerCodes: readonly FullTransactionInfoTrigger[];
  readonly routeEdges: readonly ForensicRouteEdge[];
  readonly movements: readonly ForensicRouteEdge[];
};

export type SelectiveTransactionEnrichmentResult = WhereTransactionInfoEnrichmentSummary & {
  adverseGate: "complete" | "incomplete";
  inferredStopAllowed: boolean;
  continueTraversal: boolean;
};

export type SelectiveTransactionEnricher = {
  enrich(
    input: SelectiveTransactionEnrichmentInput,
    options?: { signal?: AbortSignal }
  ): Promise<SelectiveTransactionEnrichmentResult>;
};

type ProviderResolution =
  | { kind: "evidence"; id: string; evidence: TronTransactionProviderEvidenceV1; savedHit: boolean; inFlightHit: boolean; providerRequest: boolean; awaitMs: number }
  | { kind: "unavailable"; observedPayload?: unknown; savedHit: boolean; inFlightHit: boolean; providerRequest: boolean; awaitMs: number }
  | { kind: "corrupt"; savedHit: boolean; inFlightHit: boolean; providerRequest: boolean; awaitMs: number }
  | { kind: "capped"; savedHit: boolean; inFlightHit: boolean; providerRequest: boolean; awaitMs: number };

type CandidateResolution = {
  decision: TransactionEnrichmentDecisionV1;
  evidenceIds: string[];
  rawProviderRequests: number;
  fullProviderRequests: number;
  savedEvidenceHits: number;
  inFlightHits: number;
  schedulerAwaitMs: number;
  incomplete: boolean;
};

function normalizeHash(value: string): string {
  const normalized = value.toLowerCase();
  if (!HASH.test(normalized)) throw new TypeError("selective_transaction_enrichment_invalid_tx_hash");
  return normalized;
}

function identity(
  txHash: string,
  endpoint: "raw" | "full"
): TransactionProviderEvidenceIdentityV1 {
  return {
    version: "tron-transaction-provider-evidence-v1",
    chain: "tron",
    txHash,
    ...(endpoint === "raw" ? RAW_PROVIDER : FULL_PROVIDER),
    providerSchemaVersion: 1
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strictAssertionLinks(assertion: RouteLinkedAssertionInput): {
  hashes: Set<string>;
  addresses: Set<string>;
} | null {
  if (assertion.chain !== "tron" || assertion.status !== "active" || !TRON_ADDRESS.test(assertion.address)) return null;
  const evidence = record(assertion.evidenceJson);
  if (!evidence) return null;
  const hashes = new Set<string>();
  for (const key of ["approvalTxHash", "drainTxHash"] as const) {
    const value = evidence[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !HASH.test(value.toLowerCase())) return null;
    hashes.add(value.toLowerCase());
  }
  if (evidence.pathTxHashes !== undefined) {
    if (!Array.isArray(evidence.pathTxHashes)) return null;
    for (const value of evidence.pathTxHashes) {
      if (typeof value !== "string" || !HASH.test(value.toLowerCase())) return null;
      hashes.add(value.toLowerCase());
    }
  }
  const addresses = new Set<string>();
  for (const key of [
    "subjectAddress",
    "victimAddress",
    "spenderAddress",
    "firstReceiverAddress",
    "fromAddress",
    "toAddress",
    "callerAddress",
    "contractAddress"
  ] as const) {
    const value = evidence[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !TRON_ADDRESS.test(value)) return null;
    addresses.add(value);
  }
  if (evidence.pathAddresses !== undefined) {
    if (!Array.isArray(evidence.pathAddresses)) return null;
    for (const value of evidence.pathAddresses) {
      if (typeof value !== "string" || !TRON_ADDRESS.test(value)) return null;
      addresses.add(value);
    }
  }
  return hashes.size > 0 || addresses.size > 0 ? { hashes, addresses } : null;
}

function assertionMatchesCandidate(input: {
  assertion: RouteLinkedAssertionInput;
  candidateHash: string;
  candidateAddresses: ReadonlySet<string>;
  routeAddresses: ReadonlySet<string>;
}): boolean {
  const links = strictAssertionLinks(input.assertion);
  if (!links || [...links.addresses].some((address) => !input.routeAddresses.has(address))) return false;
  return (
    input.candidateAddresses.has(input.assertion.address) ||
    links.hashes.has(input.candidateHash)
  );
}

function addTrigger(target: FullTransactionInfoTrigger[], trigger: FullTransactionInfoTrigger): void {
  if (!target.includes(trigger)) target.push(trigger);
}

export function buildSelectiveTransactionCandidates(
  input: SelectiveTransactionEnrichmentInput
): SelectiveTransactionCandidate[] {
  const byHash = new Map<string, { routeEdges: ForensicRouteEdge[]; movements: ForensicRouteEdge[] }>();
  const pushUnique = (target: ForensicRouteEdge[], edge: ForensicRouteEdge) => {
    // ponytail: per-transaction event groups are small; use identity maps if provider fan-out makes this scan material.
    const edgeIdentity = forensicRouteEdgeIdentity(edge);
    if (!target.some((candidate) => forensicRouteEdgeIdentity(candidate) === edgeIdentity)) target.push(edge);
  };
  for (const edge of input.routeEdges) {
    const txHash = normalizeHash(edge.txHash);
    const group = byHash.get(txHash) ?? { routeEdges: [], movements: [] };
    pushUnique(group.routeEdges, edge);
    byHash.set(txHash, group);
  }
  for (const movement of input.movements) {
    const txHash = normalizeHash(movement.txHash);
    const group = byHash.get(txHash);
    if (group) pushUnique(group.movements, movement);
  }
  const forcedHard = new Set((input.hardTxHashes ?? []).map(normalizeHash));
  const unresolved = new Set((input.unresolvedEconomicRoleTxHashes ?? []).map(normalizeHash));
  const routeAddresses = new Set(input.routeEdges.flatMap((edge) => [
    edge.fromAddress,
    edge.toAddress,
    ...(edge.callerAddress ? [edge.callerAddress] : []),
    ...(edge.contractAddress ? [edge.contractAddress] : [])
  ]));
  const candidates: SelectiveTransactionCandidate[] = [];
  for (const [txHash, group] of byHash) {
    const triggers: FullTransactionInfoTrigger[] = [];
    if (group.routeEdges.some((edge) => edge.contractAddress !== null && edge.contractAddress !== undefined && edge.contractAddress !== TRON_USDT_CONTRACT_ADDRESS)) {
      addTrigger(triggers, "non_official_usdt_contract");
    }
    if (group.routeEdges.some((edge) => edge.method !== "transfer" || edge.edgeType !== "normal_transfer")) {
      addTrigger(triggers, "non_plain_transfer_method");
    }
    if (group.movements.length > 1) addTrigger(triggers, "multiple_official_usdt_movements");
    if (unresolved.has(txHash)) {
      addTrigger(triggers, "unresolved_economic_role");
    }
    const candidateAddresses = new Set(group.routeEdges.flatMap((edge) => [
      edge.fromAddress,
      edge.toAddress,
      ...(edge.callerAddress ? [edge.callerAddress] : []),
      ...(edge.contractAddress ? [edge.contractAddress] : [])
    ]));
    if ((input.assertions ?? []).some((assertion) => assertionMatchesCandidate({
      assertion,
      candidateHash: txHash,
      candidateAddresses,
      routeAddresses
    }))) addTrigger(triggers, "exact_route_linked_assertion");
    const priority = forcedHard.has(txHash) || triggers.length > 0 ? "hard" : "optional";
    candidates.push({
      id: `selective-tx:${txHash}`,
      txHash,
      priority,
      triggerCodes: triggers,
      routeEdges: group.routeEdges.sort((left, right) => forensicRouteEdgeIdentity(left).localeCompare(forensicRouteEdgeIdentity(right))),
      movements: group.movements.sort((left, right) => forensicRouteEdgeIdentity(left).localeCompare(forensicRouteEdgeIdentity(right)))
    });
  }
  return candidates.sort((left, right) =>
    (left.priority === right.priority ? 0 : left.priority === "hard" ? -1 : 1) ||
    left.txHash.localeCompare(right.txHash)
  );
}

function rawPlain(raw: RawTransactionPreflightV1): raw is Extract<RawTransactionPreflightV1, { status: "parsed" }> {
  return raw.status === "parsed" &&
    raw.successful === true &&
    raw.contractType === "TriggerSmartContract" &&
    raw.contractAddress === TRON_USDT_CONTRACT_ADDRESS &&
    raw.selector === "a9059cbb" &&
    raw.rawContractCount === 1;
}

function movementPlain(movement: ForensicRouteEdge | undefined): movement is ForensicRouteEdge {
  return movement !== undefined &&
    movement.eventIndex !== null && movement.eventIndex !== undefined &&
    movement.confirmed === true &&
    movement.reverted === false &&
    movement.contractRet === "SUCCESS" &&
    movement.finalResult === "SUCCESS";
}

function rawEdgeMismatchReasons(
  raw: Extract<RawTransactionPreflightV1, { status: "parsed" }>,
  movement: ForensicRouteEdge | undefined
): string[] {
  if (!movement) return ["movement_missing"];
  const reasons: string[] = [];
  if (!forensicRouteEdgeHasExactMovementIdentity(movement) || movement.eventIndex === null || movement.eventIndex === undefined) reasons.push("event_identity_unknown");
  if (movement.edgeType !== "normal_transfer") reasons.push("event_type_mismatch");
  if (!movement.callerAddress || movement.callerAddress !== raw.callerAddress) reasons.push("caller_mismatch");
  if (!movement.contractAddress || movement.contractAddress !== raw.contractAddress) reasons.push("contract_mismatch");
  if (movement.fromAddress !== raw.callerAddress) reasons.push("sender_mismatch");
  if (!raw.recipientAddress || movement.toAddress !== raw.recipientAddress) reasons.push("receiver_mismatch");
  if (raw.amountRaw === null || movement.amountRaw !== raw.amountRaw) reasons.push("amount_mismatch");
  if (movement.confirmed !== true) reasons.push("confirmation_unknown_or_mismatch");
  if (movement.reverted !== false) reasons.push("reverted_unknown_or_mismatch");
  if (movement.contractRet !== "SUCCESS") reasons.push("contract_ret_unknown_or_mismatch");
  if (movement.finalResult !== "SUCCESS") reasons.push("final_result_unknown_or_mismatch");
  return reasons;
}

function movementWitness(movement: ForensicRouteEdge): TransactionProviderMovementWitnessV1 | null {
  if (
    !forensicRouteEdgeHasExactMovementIdentity(movement) ||
    !movement.contractAddress || !movement.callerAddress ||
    movement.confirmed !== true || typeof movement.reverted !== "boolean" ||
    !movement.contractRet || !movement.finalResult
  ) return null;
  return {
    txHash: normalizeHash(movement.txHash),
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
}

function rawProviderMovementWitness(
  movement: ForensicRouteEdge,
  status: TronTransactionProviderEvidenceV1["finality"]["status"]
): TransactionProviderMovementWitnessV1 | null {
  if (
    !forensicRouteEdgeHasExactMovementIdentity(movement) ||
    !movement.contractAddress || !movement.callerAddress
  ) return null;
  const result = status === "confirmed_success"
    ? "SUCCESS"
    : status === "confirmed_reverted" ? "REVERT" : "FAILED";
  return {
    txHash: normalizeHash(movement.txHash),
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
    confirmed: true,
    reverted: status === "confirmed_reverted",
    contractRet: result,
    finalResult: result
  };
}

function savedRawEvidenceMatchesCurrentMovement(
  evidence: TronTransactionProviderEvidenceV1,
  movement: ForensicRouteEdge | undefined
): boolean {
  if (evidence.endpoint !== "gettransactionbyid" || !movement) return false;
  const current = movementWitness(movement);
  const saved = evidence.finality.movement;
  if (!current || !saved) return false;
  const sameRichIdentity =
    (current.transferId ?? null) === (saved.transferId ?? null) &&
    (current.eventIndex ?? null) === (saved.eventIndex ?? null) &&
    (current.provider ?? null) === (saved.provider ?? null) &&
    (current.providerRowOrdinalInTx ?? null) === (saved.providerRowOrdinalInTx ?? null);
  if (!sameRichIdentity) return false;
  try {
    return transactionProviderFinalityWitnessSha256({
      identity: evidence,
      status: evidence.finality.status,
      payload: evidence.payload,
      movement: current
    }) === evidence.finality.witnessSha256;
  } catch {
    return false;
  }
}

function rawFinality(payload: unknown): TronTransactionProviderEvidenceV1["finality"]["status"] | null {
  const value = record(payload);
  if (!value || !Array.isArray(value.ret) || value.ret.length === 0) return null;
  const results = value.ret.map((item) => {
    const result = record(item);
    const text = result?.contractRet ?? result?.contract_ret;
    return typeof text === "string" && text.trim() ? text.trim().toUpperCase() : null;
  });
  if (results.some((result) => result === null)) return null;
  if (results.some((result) => result!.includes("REVERT"))) return "confirmed_reverted";
  return results.every((result) => result === "SUCCESS") ? "confirmed_success" : "confirmed_failed";
}

function fullFinality(payload: unknown): TronTransactionProviderEvidenceV1["finality"]["status"] | null {
  const value = record(payload);
  if (!value || value.confirmed !== true) return null;
  const receipt = record(value.receipt);
  const observations: string[] = [];
  for (const item of [receipt?.result, value.finalResult, value.contractRet, value.contract_ret, value.result, value.status]) {
    if (item !== undefined) observations.push(String(item).trim().toUpperCase());
  }
  if (receipt?.success !== undefined) observations.push(receipt.success === true ? "SUCCESS" : "FAILED");
  if (value.revert !== undefined) observations.push(value.revert === true ? "REVERT" : value.revert === false ? "SUCCESS" : "FAILED");
  if (observations.length === 0) return null;
  if (observations.some((item) => item.includes("REVERT"))) return "confirmed_reverted";
  if (observations.some((item) => item !== "SUCCESS" && item !== "0")) return "confirmed_failed";
  return "confirmed_success";
}

function providerEvidence(input: {
  providerIdentity: TransactionProviderEvidenceIdentityV1;
  payload: unknown;
  fetchedAt: string;
  movement: TransactionProviderMovementWitnessV1 | null;
  status: TronTransactionProviderEvidenceV1["finality"]["status"];
}): TronTransactionProviderEvidenceV1 {
  const witnessKind = input.providerIdentity.endpoint === "gettransactionbyid"
    ? "indexed_tron_usdt_transfer" as const
    : "tronscan_transaction_info" as const;
  return {
    ...input.providerIdentity,
    fetchedAt: input.fetchedAt,
    finality: {
      status: input.status,
      witnessKind,
      witnessSha256: transactionProviderFinalityWitnessSha256({
        identity: input.providerIdentity,
        status: input.status,
        payload: input.payload,
        movement: input.movement
      }),
      movement: input.movement
    },
    payloadSha256: fingerprintCanonicalArtifact(input.payload),
    payload: input.payload
  };
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("selective_transaction_enrichment_aborted");
}

export function createSelectiveTransactionEnricher(deps: {
  getSavedEvidence(identity: TransactionProviderEvidenceIdentityV1): Promise<TronTransactionProviderEvidenceV1 | null>;
  saveProviderEvidence(evidence: TronTransactionProviderEvidenceV1): Promise<{ id: string }>;
  saveDecisionEvidence(evidence: TransactionEnrichmentDecisionEvidenceV1): Promise<{ id: string }>;
  getRawTransaction(txHash: string): Promise<unknown>;
  getFullTransactionInfo(txHash: string): Promise<unknown>;
  now(): Date;
  maxConcurrentSubmissions?: number;
}): SelectiveTransactionEnricher {
  const inFlight = new Map<string, Promise<ProviderResolution>>();
  const workerCount = Math.max(1, Math.min(4, Math.floor(deps.maxConcurrentSubmissions ?? 4)));

  async function loadProvider(input: {
    txHash: string;
    endpoint: "raw" | "full";
    movement: ForensicRouteEdge | undefined;
    acquireProviderSlot?: () => boolean;
  }, signal?: AbortSignal): Promise<ProviderResolution> {
    const providerIdentity = identity(input.txHash, input.endpoint);
    const evidenceId = transactionProviderEvidenceId(providerIdentity);
    try {
      const saved = await deps.getSavedEvidence(providerIdentity);
      aborted(signal);
      if (saved) return { kind: "evidence", id: evidenceId, evidence: saved, savedHit: true, inFlightHit: false, providerRequest: false, awaitMs: 0 };
    } catch {
      aborted(signal);
      return { kind: "corrupt", savedHit: false, inFlightHit: false, providerRequest: false, awaitMs: 0 };
    }
    aborted(signal);
    const shared = inFlight.get(evidenceId);
    if (shared) {
      const started = deps.now().getTime();
      const result = await shared;
      return { ...result, savedHit: false, inFlightHit: true, providerRequest: false, awaitMs: Math.max(0, deps.now().getTime() - started) };
    }
    if (input.acquireProviderSlot && !input.acquireProviderSlot()) {
      return { kind: "capped", savedHit: false, inFlightHit: false, providerRequest: false, awaitMs: 0 };
    }
    const promise = (async (): Promise<ProviderResolution> => {
      const started = deps.now().getTime();
      let observedPayload: unknown;
      try {
        const payload = input.endpoint === "raw"
          ? await deps.getRawTransaction(input.txHash)
          : await deps.getFullTransactionInfo(input.txHash);
        observedPayload = payload;
        const status = input.endpoint === "raw" ? rawFinality(payload) : fullFinality(payload);
        if (!status) return { kind: "unavailable", observedPayload: payload, savedHit: false, inFlightHit: false, providerRequest: true, awaitMs: Math.max(0, deps.now().getTime() - started) };
        const witness = input.endpoint === "raw" && input.movement
          ? rawProviderMovementWitness(input.movement, status)
          : null;
        if (input.endpoint === "raw" && !witness) {
          return { kind: "unavailable", observedPayload: payload, savedHit: false, inFlightHit: false, providerRequest: true, awaitMs: Math.max(0, deps.now().getTime() - started) };
        }
        const evidence = providerEvidence({
          providerIdentity,
          payload,
          fetchedAt: deps.now().toISOString(),
          movement: witness,
          status
        });
        const saved = await deps.saveProviderEvidence(evidence);
        return { kind: "evidence", id: saved.id, evidence, savedHit: false, inFlightHit: false, providerRequest: true, awaitMs: Math.max(0, deps.now().getTime() - started) };
      } catch {
        return {
          kind: "unavailable",
          ...(observedPayload === undefined ? {} : { observedPayload }),
          savedHit: false,
          inFlightHit: false,
          providerRequest: true,
          awaitMs: Math.max(0, deps.now().getTime() - started)
        };
      }
    })();
    inFlight.set(evidenceId, promise);
    try {
      return await promise;
    } finally {
      if (inFlight.get(evidenceId) === promise) inFlight.delete(evidenceId);
    }
  }

  async function saveDecision(input: {
    candidate: SelectiveTransactionCandidate;
    decision: "plain_usdt_raw_proven" | "full_transaction_info_confirmed" | "confirmed_failed_or_reverted";
    triggerCodes: FullTransactionInfoTrigger[];
    providers: Array<{ id: string; evidence: TronTransactionProviderEvidenceV1 }>;
    witnessSha256: string;
  }): Promise<{ decision: TransactionEnrichmentDecisionV1; evidenceIds: string[] }> {
    const saved = await deps.saveDecisionEvidence({
      version: "transaction-enrichment-decision-evidence-v1",
      policyVersion: POLICY_VERSION,
      chain: "tron",
      txHash: input.candidate.txHash,
      decision: input.decision,
      triggerCodes: input.triggerCodes,
      providerEvidenceIds: input.providers.map(({ id }) => id),
      movementWitnessSha256: input.witnessSha256
    });
    return {
      decision: {
        txHash: input.candidate.txHash,
        candidateId: input.candidate.id,
        priority: input.triggerCodes.length > 0 ? "hard" : input.candidate.priority,
        triggerCodes: input.triggerCodes,
        decision: input.decision,
        providerEvidenceIds: input.providers.map(({ id }) => id),
        decisionEvidenceId: saved.id,
        continueTraversal: false
      },
      evidenceIds: [...input.providers.map(({ id }) => id), saved.id]
    };
  }

  async function resolveCandidate(
    candidate: SelectiveTransactionCandidate,
    signal: AbortSignal | undefined,
    acquireFullSlot: () => boolean
  ): Promise<CandidateResolution> {
    const metrics = { rawProviderRequests: 0, fullProviderRequests: 0, savedEvidenceHits: 0, inFlightHits: 0, schedulerAwaitMs: 0 };
    const account = (resolution: ProviderResolution, endpoint: "raw" | "full") => {
      if (resolution.providerRequest) metrics[endpoint === "raw" ? "rawProviderRequests" : "fullProviderRequests"] += 1;
      if (resolution.savedHit) metrics.savedEvidenceHits += 1;
      if (resolution.inFlightHit) metrics.inFlightHits += 1;
      metrics.schedulerAwaitMs += resolution.awaitMs;
    };
    aborted(signal);
    const movement = candidate.movements.length === 1 ? candidate.movements[0] : undefined;
    const raw = await loadProvider({ txHash: candidate.txHash, endpoint: "raw", movement }, signal);
    account(raw, "raw");
    aborted(signal);
    const triggers = [...candidate.triggerCodes];
    let parsed: RawTransactionPreflightV1 | null = null;
    if (raw.kind === "corrupt" || raw.kind === "capped") {
      return {
        ...metrics,
        decision: {
          txHash: candidate.txHash,
          candidateId: candidate.id,
          priority: "hard",
          triggerCodes: ["raw_unavailable_or_ambiguous"],
          decision: "technical_unknown",
          providerEvidenceIds: [],
          decisionEvidenceId: null,
          continueTraversal: true
        },
        evidenceIds: [],
        incomplete: true
      };
    }
    if (raw.kind !== "evidence") addTrigger(triggers, "raw_unavailable_or_ambiguous");
    if (raw.kind === "evidence" || raw.observedPayload !== undefined) {
      parsed = parseRawTransactionPreflightV1(raw.kind === "evidence" ? raw.evidence.payload : raw.observedPayload);
      if (parsed.status !== "parsed") addTrigger(triggers, "raw_unavailable_or_ambiguous");
      else {
        if (parsed.contractAddress !== TRON_USDT_CONTRACT_ADDRESS) addTrigger(triggers, "non_official_usdt_contract");
        if (parsed.selector !== "a9059cbb") addTrigger(triggers, "non_plain_transfer_selector");
        if (!rawPlain(parsed) || !movementPlain(movement) || rawEdgeMismatchReasons(parsed, movement).length > 0) {
          addTrigger(triggers, "raw_edge_mismatch");
        }
      }
      if (raw.kind === "evidence" && raw.evidence.finality.status !== "confirmed_success") {
        addTrigger(triggers, "raw_edge_mismatch");
      }
      if (raw.kind === "evidence" && !savedRawEvidenceMatchesCurrentMovement(raw.evidence, movement)) {
        addTrigger(triggers, "raw_edge_mismatch");
      }
    }
    if (
      raw.kind === "evidence" &&
      triggers.length === 0 &&
      parsed && rawPlain(parsed) &&
      movementPlain(movement) &&
      savedRawEvidenceMatchesCurrentMovement(raw.evidence, movement)
    ) {
      const saved = await saveDecision({
        candidate,
        decision: "plain_usdt_raw_proven",
        triggerCodes: [],
        providers: [{ id: raw.id, evidence: raw.evidence }],
        witnessSha256: raw.evidence.finality.witnessSha256
      });
      aborted(signal);
      return { ...metrics, ...saved, incomplete: false };
    }
    aborted(signal);
    const full = await loadProvider({
      txHash: candidate.txHash,
      endpoint: "full",
      movement,
      acquireProviderSlot: acquireFullSlot
    }, signal);
    account(full, "full");
    aborted(signal);
    const rawNegative = raw.kind === "evidence" && raw.evidence.finality.status !== "confirmed_success"
      ? raw
      : null;
    if (full.kind === "capped") {
      if (rawNegative) {
        const saved = await saveDecision({
          candidate,
          decision: "confirmed_failed_or_reverted",
          triggerCodes: triggers,
          providers: [{ id: rawNegative.id, evidence: rawNegative.evidence }],
          witnessSha256: rawNegative.evidence.finality.witnessSha256
        });
        aborted(signal);
        return { ...metrics, ...saved, incomplete: true };
      }
      return {
        ...metrics,
        decision: {
          txHash: candidate.txHash,
          candidateId: candidate.id,
          priority: "hard",
          triggerCodes: triggers,
          decision: "missing_evidence",
          providerEvidenceIds: raw.kind === "evidence" ? [raw.id] : [],
          decisionEvidenceId: null,
          continueTraversal: true
        },
        evidenceIds: raw.kind === "evidence" ? [raw.id] : [],
        incomplete: true
      };
    }
    if (full.kind !== "evidence") {
      if (rawNegative) {
        const saved = await saveDecision({
          candidate,
          decision: "confirmed_failed_or_reverted",
          triggerCodes: triggers,
          providers: [{ id: rawNegative.id, evidence: rawNegative.evidence }],
          witnessSha256: rawNegative.evidence.finality.witnessSha256
        });
        aborted(signal);
        return { ...metrics, ...saved, incomplete: true };
      }
      return {
        ...metrics,
        decision: {
          txHash: candidate.txHash,
          candidateId: candidate.id,
          priority: "hard",
          triggerCodes: triggers,
          decision: "technical_unknown",
          providerEvidenceIds: raw.kind === "evidence" ? [raw.id] : [],
          decisionEvidenceId: null,
          continueTraversal: true
        },
        evidenceIds: raw.kind === "evidence" ? [raw.id] : [],
        incomplete: true
      };
    }
    if (rawNegative) {
      const saved = await saveDecision({
        candidate,
        decision: "confirmed_failed_or_reverted",
        triggerCodes: triggers,
        providers: [
          { id: rawNegative.id, evidence: rawNegative.evidence },
          { id: full.id, evidence: full.evidence }
        ],
        witnessSha256: rawNegative.evidence.finality.witnessSha256
      });
      aborted(signal);
      return { ...metrics, ...saved, incomplete: true };
    }
    const failed = full.evidence.finality.status !== "confirmed_success";
    const providers = [
      ...(raw.kind === "evidence" && (failed || raw.evidence.finality.status === "confirmed_success")
        ? [{ id: raw.id, evidence: raw.evidence }]
        : []),
      { id: full.id, evidence: full.evidence }
    ];
    const saved = await saveDecision({
      candidate,
      decision: failed ? "confirmed_failed_or_reverted" : "full_transaction_info_confirmed",
      triggerCodes: triggers,
      providers,
      witnessSha256: full.evidence.finality.witnessSha256
    });
    aborted(signal);
    return { ...metrics, ...saved, incomplete: failed };
  }

  return {
    async enrich(input, options = {}) {
      aborted(options.signal);
      const candidates = buildSelectiveTransactionCandidates(input);
      const results: Array<CandidateResolution | undefined> = new Array(candidates.length);
      let cursor = 0;
      let fullSlots = 0;
      let stopped = false;
      const acquireFullSlot = () => {
        if (input.mode === "subject") return true;
        if (fullSlots >= 5) return false;
        fullSlots += 1;
        return true;
      };
      const workers = Array.from({ length: Math.min(workerCount, candidates.length) }, async () => {
        while (!stopped) {
          aborted(options.signal);
          const index = cursor++;
          if (index >= candidates.length) return;
          try {
            results[index] = await resolveCandidate(candidates[index], options.signal, acquireFullSlot);
          } catch (error) {
            if ((error as Error).message === "selective_transaction_enrichment_aborted") stopped = true;
            throw error;
          }
        }
      });
      await Promise.all(workers);
      const resolved = results.filter((item): item is CandidateResolution => item !== undefined);
      const incomplete = resolved.some((item) => item.incomplete);
      const evidenceIds = [...new Set(resolved.flatMap((item) => item.evidenceIds))];
      return {
        policyVersion: POLICY_VERSION,
        coverageStatus: incomplete ? "coverage_incomplete" : "complete",
        technicalStatus: resolved.some((item) => item.decision.decision === "technical_unknown")
          ? "technical_unknown"
          : "proven",
        candidateCount: candidates.length,
        hardCandidateCount: resolved.filter((item) => item.decision.priority === "hard").length,
        rawProviderRequests: resolved.reduce((sum, item) => sum + item.rawProviderRequests, 0),
        fullProviderRequests: resolved.reduce((sum, item) => sum + item.fullProviderRequests, 0),
        savedEvidenceHits: resolved.reduce((sum, item) => sum + item.savedEvidenceHits, 0),
        inFlightHits: resolved.reduce((sum, item) => sum + item.inFlightHits, 0),
        schedulerAwaitMs: resolved.reduce((sum, item) => sum + item.schedulerAwaitMs, 0),
        evidenceIds,
        decisions: resolved.map((item) => item.decision),
        adverseGate: incomplete ? "incomplete" : "complete",
        inferredStopAllowed: !incomplete,
        continueTraversal: resolved.some((item) => item.decision.continueTraversal)
      };
    }
  };
}
