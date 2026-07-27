import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import {
  buildSelectiveTransactionCandidates,
  createSelectiveTransactionEnricher,
  type SelectiveTransactionEnrichmentInput
} from "../../src/forensics/selectiveTransactionEnrichment";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import {
  getTransactionProviderEvidence,
  saveTransactionEnrichmentDecisionEvidence,
  saveTransactionProviderEvidence,
  transactionProviderEvidenceId,
  type TransactionProviderEvidenceIdentityV1,
  type TronTransactionProviderEvidenceV1
} from "../../src/storage/transactionEvidenceRepository";
import type { Db } from "../../src/storage/db";
import type { ForensicRouteEdge, FullTransactionInfoTrigger } from "../../src/types";

const HASH_A = "a".repeat(64);
const FROM = "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm";
const TO = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";
const OTHER = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";

function wordAddress(address: string): string {
  return TronWeb.address.toHex(address).slice(2).padStart(64, "0").toLowerCase();
}

function wordAmount(amount: bigint): string {
  return amount.toString(16).padStart(64, "0");
}

function rawPayload(input: {
  txHash?: string;
  caller?: string;
  contract?: string;
  selector?: string;
  recipient?: string;
  amountRaw?: string;
  contractRet?: string;
} = {}): Record<string, unknown> {
  const selector = input.selector ?? "a9059cbb";
  return {
    txID: input.txHash ?? HASH_A,
    raw_data: {
      contract: [{
        type: "TriggerSmartContract",
        parameter: {
          type_url: "type.googleapis.com/protocol.TriggerSmartContract",
          value: {
            owner_address: TronWeb.address.toHex(input.caller ?? FROM),
            contract_address: TronWeb.address.toHex(input.contract ?? TRON_USDT_CONTRACT_ADDRESS),
            data: `${selector}${wordAddress(input.recipient ?? TO)}${wordAmount(BigInt(input.amountRaw ?? "1000000"))}`
          }
        }
      }]
    },
    ret: [{ contractRet: input.contractRet ?? "SUCCESS" }]
  };
}

function edge(txHash = HASH_A, overrides: Partial<ForensicRouteEdge> = {}): ForensicRouteEdge {
  return {
    id: `edge-${txHash}`,
    txHash,
    transferId: `transfer-${txHash}`,
    eventIndex: 0,
    provider: "tronscan",
    providerRowOrdinalInTx: 0,
    fromAddress: FROM,
    toAddress: TO,
    amountRaw: "1000000",
    timestamp: new Date("2026-07-26T12:00:00.000Z"),
    method: "transfer",
    edgeType: "normal_transfer",
    callerAddress: FROM,
    contractAddress: TRON_USDT_CONTRACT_ADDRESS,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    confirmed: true,
    reverted: false,
    economicRole: "principal",
    ...overrides
  };
}

function inputFor(route: ForensicRouteEdge, overrides: Partial<SelectiveTransactionEnrichmentInput> = {}): SelectiveTransactionEnrichmentInput {
  return {
    mode: "subject",
    routeEdges: [route],
    movements: [route],
    ...overrides
  };
}

function fullPayload(txHash: string, contractRet = "SUCCESS", confirmed = true): Record<string, unknown> {
  return { hash: txHash, confirmed, contractRet };
}

function harness(overrides: {
  getRawTransaction?: (hash: string) => Promise<unknown>;
  getFullTransactionInfo?: (hash: string) => Promise<unknown>;
  getSavedEvidence?: (identity: TransactionProviderEvidenceIdentityV1) => Promise<TronTransactionProviderEvidenceV1 | null>;
  maxConcurrentSubmissions?: number;
} = {}) {
  const saved = new Map<string, TronTransactionProviderEvidenceV1>();
  const rawCalls: string[] = [];
  const fullCalls: string[] = [];
  const decisionCalls: unknown[] = [];
  const getRawTransaction = overrides.getRawTransaction ?? (async (hash: string) => rawPayload({ txHash: hash }));
  const getFullTransactionInfo = overrides.getFullTransactionInfo ?? (async (hash: string) => fullPayload(hash));
  const enricher = createSelectiveTransactionEnricher({
    getSavedEvidence: overrides.getSavedEvidence ?? (async (identity) => saved.get(transactionProviderEvidenceId(identity)) ?? null),
    async saveProviderEvidence(evidence) {
      const id = transactionProviderEvidenceId(evidence);
      saved.set(id, evidence);
      return { id };
    },
    async saveDecisionEvidence(evidence) {
      decisionCalls.push(evidence);
      return { id: `decision:${evidence.txHash}:${evidence.decision}` };
    },
    async getRawTransaction(hash) {
      rawCalls.push(hash);
      return getRawTransaction(hash);
    },
    async getFullTransactionInfo(hash) {
      fullCalls.push(hash);
      return getFullTransactionInfo(hash);
    },
    now: () => new Date("2026-07-26T12:00:00.000Z"),
    maxConcurrentSubmissions: overrides.maxConcurrentSubmissions
  });
  return { enricher, rawCalls, fullCalls, decisionCalls, saved };
}

function repositoryHarness(overrides: {
  getRawTransaction: (hash: string) => Promise<unknown>;
  getFullTransactionInfo: (hash: string) => Promise<unknown>;
}) {
  type Row = {
    id: string;
    source: string;
    source_type: string;
    chain: string;
    address: null;
    tx_hash: string;
    observed_transaction_hash: string;
    evidence_json: unknown;
  };
  const rows = new Map<string, Row>();
  const db = {
    async query(sql: string, params: unknown[] = []) {
      if (/^\s*insert into raw_evidence/i.test(sql)) {
        const [id, source, sourceType, chain, txHash, evidenceJson] = params.map(String);
        if (!rows.has(id)) {
          rows.set(id, {
            id,
            source,
            source_type: sourceType,
            chain,
            address: null,
            tx_hash: txHash,
            observed_transaction_hash: txHash,
            evidence_json: JSON.parse(evidenceJson)
          });
        }
        return { rows: [], rowCount: 1 };
      }
      const row = rows.get(String(params[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
  } as unknown as Db;
  const rawCalls: string[] = [];
  const fullCalls: string[] = [];
  return {
    rawCalls,
    fullCalls,
    rows,
    enricher: createSelectiveTransactionEnricher({
      getSavedEvidence: (identity) => getTransactionProviderEvidence(db, identity),
      saveProviderEvidence: async (evidence) => saveTransactionProviderEvidence(db, evidence),
      saveDecisionEvidence: async (evidence) => saveTransactionEnrichmentDecisionEvidence(db, evidence),
      getRawTransaction: async (hash) => {
        rawCalls.push(hash);
        return overrides.getRawTransaction(hash);
      },
      getFullTransactionInfo: async (hash) => {
        fullCalls.push(hash);
        return overrides.getFullTransactionInfo(hash);
      },
      now: () => new Date("2026-07-26T12:00:00.000Z")
    })
  };
}

describe("selective transaction enrichment", () => {
  it("deduplicates normalized hashes and constructs deterministic hard-first candidates without provider work", () => {
    const upper = edge(HASH_A.toUpperCase());
    const optional = edge("b".repeat(64));
    const result = buildSelectiveTransactionCandidates({
      mode: "subject",
      routeEdges: [optional, upper, edge(HASH_A)],
      movements: [optional, upper],
      unresolvedEconomicRoleTxHashes: [HASH_A]
    });
    expect(result.map((item) => [item.txHash, item.priority])).toEqual([
      [HASH_A, "hard"],
      ["b".repeat(64), "optional"]
    ]);
  });

  it("proves one exact rich plain official-USDT movement with zero full calls", async () => {
    const route = edge();
    const h = harness();
    const result = await h.enricher.enrich(inputFor(route));
    expect(result).toMatchObject({
      coverageStatus: "complete",
      technicalStatus: "proven",
      rawProviderRequests: 1,
      fullProviderRequests: 0,
      decisions: [{ decision: "plain_usdt_raw_proven", triggerCodes: [] }]
    });
    expect(result.evidenceIds).toHaveLength(2);
    expect(h.fullCalls).toEqual([]);
  });

  it.each([
    ["non_official_usdt_contract", edge(HASH_A, { contractAddress: OTHER }), rawPayload({ contract: OTHER })],
    ["non_plain_transfer_selector", edge(), rawPayload({ selector: "deadbeef" })],
    ["non_plain_transfer_method", edge(HASH_A, { method: "transferFrom", edgeType: "transfer_from" }), rawPayload()],
    ["unresolved_economic_role", edge(), rawPayload()]
  ] as const)("independently forces full enrichment for %s", async (trigger, route, raw) => {
    const h = harness({ getRawTransaction: async () => raw });
    const result = await h.enricher.enrich(inputFor(route, trigger === "unresolved_economic_role"
      ? { unresolvedEconomicRoleTxHashes: [route.txHash] }
      : {}));
    expect(result.fullProviderRequests).toBe(1);
    expect(result.decisions[0].triggerCodes).toContain(trigger as FullTransactionInfoTrigger);
  });

  it("forces full enrichment for multiple official-USDT movements", async () => {
    const route = edge();
    const second = edge(HASH_A, { id: "edge-second", transferId: "second", eventIndex: 1 });
    const h = harness();
    const result = await h.enricher.enrich(inputFor(route, { movements: [route, second] }));
    expect(result.fullProviderRequests).toBe(1);
    expect(result.decisions[0].triggerCodes).toContain("multiple_official_usdt_movements");
  });

  it("does not mistake a repeated copy of one indexed event for multiple movements", async () => {
    const route = edge();
    const h = harness();
    const result = await h.enricher.enrich(inputFor(route, { movements: [route, { ...route }] }));
    expect(result.decisions[0].decision).toBe("plain_usdt_raw_proven");
    expect(result.fullProviderRequests).toBe(0);
  });

  it("uses only exact route-linked assertion hashes and ignores flat labels/text", async () => {
    const route = edge();
    const exact = harness();
    const exactResult = await exact.enricher.enrich(inputFor(route, {
      assertions: [{
        chain: "tron",
        address: FROM,
        status: "active",
        evidenceJson: { drainTxHash: HASH_A, pathAddresses: [FROM, TO] }
      }]
    }));
    expect(exactResult.decisions[0].triggerCodes).toContain("exact_route_linked_assertion");
    expect(exactResult.fullProviderRequests).toBe(1);

    const flat = harness();
    const flatResult = await flat.enricher.enrich(inputFor(route, {
      assertions: [{
        chain: "tron",
        address: FROM,
        status: "active",
        evidenceJson: { label: "drainer", notes: HASH_A }
      }]
    }));
    expect(flatResult.fullProviderRequests).toBe(0);
  });

  it.each([
    ["other chain", { chain: "eth", address: FROM, status: "active", evidenceJson: { drainTxHash: HASH_A, pathAddresses: [FROM, TO] } }],
    ["other address", { chain: "tron", address: OTHER, status: "active", evidenceJson: { drainTxHash: "b".repeat(64) } }],
    ["foreign path", { chain: "tron", address: OTHER, status: "active", evidenceJson: { drainTxHash: HASH_A, pathAddresses: [OTHER] } }],
    ["inactive", { chain: "tron", address: FROM, status: "inactive", evidenceJson: { drainTxHash: HASH_A, pathAddresses: [FROM, TO] } }],
    ["retired", { chain: "tron", address: FROM, status: "retired", evidenceJson: { drainTxHash: HASH_A, pathAddresses: [FROM, TO] } }],
    ["false positive", { chain: "tron", address: FROM, status: "false_positive", evidenceJson: { drainTxHash: HASH_A, pathAddresses: [FROM, TO] } }],
    ["malformed path", { chain: "tron", address: FROM, status: "active", evidenceJson: { drainTxHash: HASH_A, pathAddresses: [123] } }]
  ])("rejects a non-authoritative %s assertion", async (_label, assertion) => {
    const route = edge();
    const h = harness();
    const result = await h.enricher.enrich(inputFor(route, { assertions: [assertion] }));
    expect(result.fullProviderRequests).toBe(0);
    expect(result.decisions[0].triggerCodes).not.toContain("exact_route_linked_assertion");
  });

  it("accepts a foreign assertion address only when exact hash and structured route addresses bind it", async () => {
    const route = edge();
    const h = harness();
    const result = await h.enricher.enrich(inputFor(route, {
      assertions: [{
        chain: "tron",
        address: OTHER,
        status: "active",
        evidenceJson: { approvalTxHash: HASH_A, pathAddresses: [FROM, TO] }
      }]
    }));
    expect(result.decisions[0].triggerCodes).toContain("exact_route_linked_assertion");
  });

  it.each([
    ["caller", { callerAddress: OTHER }],
    ["contract", { contractAddress: OTHER }],
    ["event identity", { transferId: null, eventIndex: null, provider: null, providerRowOrdinalInTx: null }],
    ["event type", { edgeType: "unknown" as const }],
    ["sender", { fromAddress: OTHER }],
    ["receiver", { toAddress: OTHER }],
    ["amount", { amountRaw: "999999" }],
    ["confirmation", { confirmed: null }],
    ["reverted", { reverted: null }],
    ["contractRet", { contractRet: null }],
    ["finalResult", { finalResult: null }]
  ])("forces full enrichment when raw and rich movement disagree on %s", async (_field, change) => {
    const route = edge(HASH_A, change as Partial<ForensicRouteEdge>);
    const h = harness();
    const result = await h.enricher.enrich(inputFor(route));
    expect(result.fullProviderRequests).toBe(1);
    expect(result.decisions[0].triggerCodes).toContain("raw_edge_mismatch");
  });

  it("keeps REVIEW/unknown/service-likelihood/flat context from causing full calls", async () => {
    const route = edge();
    const h = harness();
    const result = await h.enricher.enrich({
      ...inputFor(route),
      assertions: [{
        chain: "tron",
        address: FROM,
        status: "active",
        evidenceJson: { label: "REVIEW", category: "unknown", serviceLikelihood: 0.99 }
      }]
    });
    expect(result.fullProviderRequests).toBe(0);
  });

  it("deduplicates the same hash across paths", async () => {
    const route = edge();
    const h = harness();
    const result = await h.enricher.enrich({
      mode: "subject",
      routeEdges: [route, { ...route, id: "duplicate" }],
      movements: [route]
    });
    expect(result.candidateCount).toBe(1);
    expect(h.rawCalls).toEqual([HASH_A]);
  });

  it("reuses saved raw and full evidence without provider calls", async () => {
    const route = edge();
    const h = harness();
    const enrichmentInput = inputFor(route, { unresolvedEconomicRoleTxHashes: [route.txHash] });
    await h.enricher.enrich(enrichmentInput);
    h.rawCalls.length = 0;
    h.fullCalls.length = 0;
    const second = await h.enricher.enrich(enrichmentInput);
    expect(second.savedEvidenceHits).toBe(2);
    expect(h.rawCalls).toEqual([]);
    expect(h.fullCalls).toEqual([]);
  });

  it("does not reuse a saved raw plain proof for a different rich event identity with the same tuple", async () => {
    const original = edge();
    const h = harness();
    await h.enricher.enrich(inputFor(original));
    h.rawCalls.length = 0;
    h.fullCalls.length = 0;
    const differentEvent = edge(HASH_A, { transferId: "different-transfer", eventIndex: 7 });
    const result = await h.enricher.enrich(inputFor(differentEvent));
    expect(h.rawCalls).toEqual([]);
    expect(result.fullProviderRequests).toBe(1);
    expect(result.decisions[0]).toMatchObject({ priority: "hard" });
    expect(result.decisions[0].triggerCodes).toContain("raw_edge_mismatch");
    expect(result.decisions[0].decision).not.toBe("plain_usdt_raw_proven");
  });

  it("shares one in-flight provider promise per exact evidence identity", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { release = resolve; });
    const h = harness({ getRawTransaction: async () => pending });
    const route = edge();
    const first = h.enricher.enrich(inputFor(route));
    const second = h.enricher.enrich(inputFor(route));
    await vi.waitFor(() => expect(h.rawCalls).toHaveLength(1));
    release(rawPayload());
    const results = await Promise.all([first, second]);
    expect(results.reduce((sum, item) => sum + item.inFlightHits, 0)).toBe(1);
  });

  it.each([
    ["raw provider failure", async () => { throw new Error("timeout"); }],
    ["raw ambiguity", async () => ({ txID: HASH_A, raw_data: { contract: [] }, ret: [{ contractRet: "SUCCESS" }] })]
  ])("falls back to full for %s", async (_label, getRawTransaction) => {
    const h = harness({ getRawTransaction });
    const result = await h.enricher.enrich(inputFor(edge()));
    expect(result.fullProviderRequests).toBe(1);
    expect(result.decisions[0].triggerCodes).toContain("raw_unavailable_or_ambiguous");
  });

  it.each(["FAILED", "REVERT"])("persists finalized raw %s and never treats it as plain", async (contractRet) => {
    const route = edge(HASH_A, {
      contractRet,
      finalResult: contractRet,
      reverted: contractRet === "REVERT"
    });
    const h = harness({ getRawTransaction: async () => rawPayload({ contractRet }) });
    const result = await h.enricher.enrich(inputFor(route));
    expect([...h.saved.values()].some((item) => item.endpoint === "gettransactionbyid" && item.finality.status !== "confirmed_success")).toBe(true);
    expect(result.decisions[0].decision).not.toBe("plain_usdt_raw_proven");
    expect(result.fullProviderRequests).toBe(1);
    expect(result).toMatchObject({ coverageStatus: "coverage_incomplete", technicalStatus: "proven" });
  });

  it.each(["FAILED", "REVERT"])("persists/reuses finalized full %s as proven incomplete evidence", async (contractRet) => {
    const route = edge();
    const h = harness({ getFullTransactionInfo: async (hash) => fullPayload(hash, contractRet) });
    const enrichmentInput = inputFor(route, { unresolvedEconomicRoleTxHashes: [route.txHash] });
    const first = await h.enricher.enrich(enrichmentInput);
    expect(first).toMatchObject({ coverageStatus: "coverage_incomplete", technicalStatus: "proven" });
    expect(first.decisions[0].decision).toBe("confirmed_failed_or_reverted");
    h.rawCalls.length = 0;
    h.fullCalls.length = 0;
    await h.enricher.enrich(enrichmentInput);
    expect(h.fullCalls).toEqual([]);
  });

  it("returns technical unknown when raw and full are both unavailable", async () => {
    const h = harness({
      getRawTransaction: async () => { throw new Error("raw down"); },
      getFullTransactionInfo: async () => { throw new Error("full down"); }
    });
    const result = await h.enricher.enrich(inputFor(edge()));
    expect(result).toMatchObject({ coverageStatus: "coverage_incomplete", technicalStatus: "technical_unknown" });
    expect(result.decisions[0].decision).toBe("technical_unknown");
  });

  it("treats a non-final full response as unavailable and never persists it", async () => {
    const route = edge();
    const h = harness({ getFullTransactionInfo: async (hash) => fullPayload(hash, "SUCCESS", false) });
    const result = await h.enricher.enrich(inputFor(route, { unresolvedEconomicRoleTxHashes: [route.txHash] }));
    expect(result.decisions[0].decision).toBe("technical_unknown");
    expect([...h.saved.values()].some((item) => item.endpoint === "transaction-info")).toBe(false);
  });

  it("fails closed on corrupt saved evidence without provider fallback", async () => {
    const h = harness({ getSavedEvidence: async () => { throw new Error("transaction_provider_evidence_conflict"); } });
    const result = await h.enricher.enrich(inputFor(edge()));
    expect(result).toMatchObject({ coverageStatus: "coverage_incomplete", technicalStatus: "technical_unknown" });
    expect(h.rawCalls).toEqual([]);
    expect(h.fullCalls).toEqual([]);
  });

  it("aborts one caller after a shared request settles without canceling it or taking the next candidate", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { release = resolve; });
    const h = harness({ getRawTransaction: async () => pending, maxConcurrentSubmissions: 1 });
    const controller = new AbortController();
    const firstRoute = edge();
    const secondRoute = edge("b".repeat(64));
    const abortedCall = h.enricher.enrich({
      mode: "subject",
      routeEdges: [firstRoute, secondRoute],
      movements: [firstRoute, secondRoute]
    }, { signal: controller.signal });
    const waiter = h.enricher.enrich(inputFor(firstRoute));
    await vi.waitFor(() => expect(h.rawCalls).toHaveLength(1));
    controller.abort();
    release(rawPayload());
    await expect(abortedCall).rejects.toThrow("selective_transaction_enrichment_aborted");
    await expect(waiter).resolves.toMatchObject({ decisions: [{ decision: "plain_usdt_raw_proven" }] });
    expect(h.rawCalls).toEqual([HASH_A]);
    expect(h.fullCalls).toEqual([]);
  });

  it("dispatches hard candidates first", async () => {
    const order: string[] = [];
    const optional = edge("a".repeat(64));
    const hard = edge("f".repeat(64));
    const h = harness({
      maxConcurrentSubmissions: 1,
      getRawTransaction: async (hash) => { order.push(hash); return rawPayload({ txHash: hash }); }
    });
    await h.enricher.enrich({
      mode: "subject",
      routeEdges: [optional, hard],
      movements: [optional, hard],
      unresolvedEconomicRoleTxHashes: [hard.txHash]
    });
    expect(order[0]).toBe(hard.txHash);
  });

  it("uses no more than four bounded worker submissions", async () => {
    let active = 0;
    let peak = 0;
    const routes = Array.from({ length: 12 }, (_, index) => edge(index.toString(16).padStart(64, "0")));
    const h = harness({
      maxConcurrentSubmissions: 99,
      getRawTransaction: async (hash) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return rawPayload({ txHash: hash });
      }
    });
    await h.enricher.enrich({ mode: "subject", routeEdges: routes, movements: routes });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("does not cap hard triggers in subject mode", async () => {
    const routes = Array.from({ length: 7 }, (_, index) => edge(index.toString(16).padStart(64, "0")));
    const h = harness();
    const result = await h.enricher.enrich({
      mode: "subject",
      routeEdges: routes,
      movements: routes,
      unresolvedEconomicRoleTxHashes: routes.map((route) => route.txHash)
    });
    expect(result.fullProviderRequests).toBe(7);
    expect(result.decisions.every((item) => item.decision === "full_transaction_info_confirmed")).toBe(true);
  });

  it("caps intermediate full calls at five and records overflow as missing continuing evidence", async () => {
    const routes = Array.from({ length: 7 }, (_, index) => edge(index.toString(16).padStart(64, "0")));
    const h = harness();
    const result = await h.enricher.enrich({
      mode: "intermediate_boundary",
      routeEdges: routes,
      movements: routes,
      unresolvedEconomicRoleTxHashes: routes.map((route) => route.txHash)
    });
    expect(result.fullProviderRequests).toBe(5);
    expect(result).toMatchObject({
      coverageStatus: "coverage_incomplete",
      adverseGate: "incomplete",
      inferredStopAllowed: false,
      continueTraversal: true
    });
    const overflow = result.decisions.filter((item) => item.decision === "missing_evidence");
    expect(overflow).toHaveLength(2);
    expect(overflow.every((item) => item.triggerCodes.includes("unresolved_economic_role") && item.continueTraversal)).toBe(true);
  });

  it("reuses saved full evidence beyond the fifth intermediate candidate without consuming the provider cap", async () => {
    const routes = Array.from({ length: 7 }, (_, index) => edge(index.toString(16).padStart(64, "0")));
    const h = harness();
    const enrichmentInput: SelectiveTransactionEnrichmentInput = {
      mode: "subject",
      routeEdges: routes,
      movements: routes,
      unresolvedEconomicRoleTxHashes: routes.map((route) => route.txHash)
    };
    await h.enricher.enrich(enrichmentInput);
    h.rawCalls.length = 0;
    h.fullCalls.length = 0;
    const result = await h.enricher.enrich({ ...enrichmentInput, mode: "intermediate_boundary" });
    expect(result.fullProviderRequests).toBe(0);
    expect(result.savedEvidenceHits).toBe(14);
    expect(result.decisions.some((decision) => decision.decision === "missing_evidence")).toBe(false);
    expect(result.coverageStatus).toBe("complete");
  });

  it.each(["unavailable", "corrupt"])("promotes a dynamic raw %s trigger to hard audit priority", async (kind) => {
    const h = harness(kind === "unavailable"
      ? {
          getRawTransaction: async () => { throw new Error("raw unavailable"); },
          getFullTransactionInfo: async () => { throw new Error("full unavailable"); }
        }
      : { getSavedEvidence: async () => { throw new Error("corrupt saved row"); } });
    const result = await h.enricher.enrich(inputFor(edge()));
    expect(result.hardCandidateCount).toBe(1);
    expect(result.decisions[0]).toMatchObject({ priority: "hard", decision: "technical_unknown" });
    expect(result.decisions[0].triggerCodes).toContain("raw_unavailable_or_ambiguous");
  });

  it("keeps finalized raw failure adverse when indexed movement and full response say SUCCESS", async () => {
    const route = edge();
    const h = repositoryHarness({
      getRawTransaction: async () => rawPayload({ contractRet: "FAILED" }),
      getFullTransactionInfo: async (hash) => fullPayload(hash, "SUCCESS")
    });
    const result = await h.enricher.enrich(inputFor(route));
    expect(result).toMatchObject({
      coverageStatus: "coverage_incomplete",
      technicalStatus: "proven",
      adverseGate: "incomplete",
      inferredStopAllowed: false,
      decisions: [{ decision: "confirmed_failed_or_reverted", priority: "hard" }]
    });
    expect(result.decisions[0].providerEvidenceIds).toHaveLength(2);
    expect(result.evidenceIds.some((id) => id.startsWith("transaction-enrichment-decision-evidence-v1:"))).toBe(true);
    const rawRow = [...h.rows.values()].find((row) =>
      row.source_type === "provider_response" &&
      (row.evidence_json as TronTransactionProviderEvidenceV1).endpoint === "gettransactionbyid");
    expect(rawRow?.evidence_json).toMatchObject({
      finality: {
        status: "confirmed_failed",
        movement: {
          confirmed: true,
          reverted: false,
          contractRet: "SUCCESS",
          finalResult: "SUCCESS"
        }
      },
      payload: { ret: [{ contractRet: "FAILED" }] }
    });
  });

  it.each([
    ["FAILED", false],
    ["REVERT", true]
  ] as const)("keeps indexed %s adverse when raw and full endpoints say SUCCESS", async (indexedResult, reverted) => {
    const route = edge(HASH_A, {
      contractRet: indexedResult,
      finalResult: indexedResult,
      reverted
    });
    const h = repositoryHarness({
      getRawTransaction: async () => rawPayload({ contractRet: "SUCCESS" }),
      getFullTransactionInfo: async (hash) => fullPayload(hash, "SUCCESS")
    });
    const result = await h.enricher.enrich(inputFor(route));
    expect(result).toMatchObject({
      coverageStatus: "coverage_incomplete",
      technicalStatus: "proven",
      adverseGate: "incomplete",
      inferredStopAllowed: false,
      decisions: [{ decision: "confirmed_failed_or_reverted", priority: "hard" }]
    });
    expect(result.decisions[0].providerEvidenceIds).toHaveLength(2);
    expect(result.evidenceIds.some((id) => id.startsWith("transaction-enrichment-decision-evidence-v1:"))).toBe(true);
  });

  it("keeps agreeing indexed/raw/full SUCCESS clean when full enrichment has a real trigger", async () => {
    const route = edge();
    const h = repositoryHarness({
      getRawTransaction: async () => rawPayload({ contractRet: "SUCCESS" }),
      getFullTransactionInfo: async (hash) => fullPayload(hash, "SUCCESS")
    });
    const result = await h.enricher.enrich(inputFor(route, {
      unresolvedEconomicRoleTxHashes: [route.txHash]
    }));
    expect(result).toMatchObject({
      coverageStatus: "complete",
      technicalStatus: "proven",
      adverseGate: "complete",
      inferredStopAllowed: true,
      decisions: [{ decision: "full_transaction_info_confirmed", priority: "hard" }]
    });
  });

  it.each([
    ["unconfirmed", { confirmed: false }],
    ["unknown finality", { finalResult: null }]
  ])("does not synthesize a route-bound adverse raw witness from %s indexed movement", async (_label, overrides) => {
    const route = edge(HASH_A, overrides as Partial<ForensicRouteEdge>);
    const h = repositoryHarness({
      getRawTransaction: async () => rawPayload({ contractRet: "FAILED" }),
      getFullTransactionInfo: async () => { throw new Error("transient full failure"); }
    });
    const result = await h.enricher.enrich(inputFor(route));
    expect(result).toMatchObject({
      coverageStatus: "coverage_incomplete",
      technicalStatus: "technical_unknown",
      adverseGate: "incomplete",
      inferredStopAllowed: false,
      decisions: [{ decision: "technical_unknown", priority: "hard" }]
    });
    expect([...h.rows.values()].some((row) =>
      row.source_type === "provider_response" &&
      (row.evidence_json as TronTransactionProviderEvidenceV1).endpoint === "gettransactionbyid")).toBe(false);
    expect(result.decisions[0].decision).not.toBe("confirmed_failed_or_reverted");
  });

  it.each(["FAILED", "REVERT"])("reuses saved finalized raw %s as proven adverse evidence when full stays transient", async (contractRet) => {
    const route = edge();
    const h = repositoryHarness({
      getRawTransaction: async () => rawPayload({ contractRet }),
      getFullTransactionInfo: async () => { throw new Error("transient full failure"); }
    });
    const first = await h.enricher.enrich(inputFor(route));
    const second = await h.enricher.enrich(inputFor(route));
    for (const result of [first, second]) {
      expect(result).toMatchObject({
        coverageStatus: "coverage_incomplete",
        technicalStatus: "proven",
        adverseGate: "incomplete",
        inferredStopAllowed: false,
        decisions: [{ decision: "confirmed_failed_or_reverted", priority: "hard" }]
      });
      expect(result.decisions[0].providerEvidenceIds).toHaveLength(1);
    }
    expect(h.rawCalls).toEqual([HASH_A]);
    expect(h.fullCalls).toEqual([HASH_A, HASH_A]);
    expect(second.savedEvidenceHits).toBeGreaterThanOrEqual(1);
  });
});
