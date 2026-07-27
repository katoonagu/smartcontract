import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { TronWeb } from "tronweb";
import type { Db } from "../../src/storage/db";
import {
  getTransactionProviderEvidence,
  saveTransactionEnrichmentDecisionEvidence,
  saveTransactionProviderEvidence,
  transactionProviderFinalityWitnessSha256,
  transactionProviderEvidenceId,
  type TransactionEnrichmentDecisionEvidenceV1,
  type TransactionProviderMovementWitnessV1,
  type TransactionProviderEvidenceIdentityV1,
  type TronTransactionProviderEvidenceV1
} from "../../src/storage/transactionEvidenceRepository";
import { canonicalizeArtifactJson } from "../../src/forensics/canonicalJson";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const WITNESS = createHash("sha256").update("movement-witness").digest("hex");
const CALLER = "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm";
const RECIPIENT = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";

function addressWord(address: string): string {
  return TronWeb.address.toHex(address).slice(2).padStart(64, "0").toLowerCase();
}

function uintWord(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function rawPayload(txHash: string, contractRet: string): Record<string, unknown> {
  return {
    txID: txHash,
    raw_data: {
      contract: [{
        type: "TriggerSmartContract",
        parameter: {
          type_url: "type.googleapis.com/protocol.TriggerSmartContract",
          value: {
            owner_address: TronWeb.address.toHex(CALLER),
            contract_address: TronWeb.address.toHex(TRON_USDT_CONTRACT_ADDRESS),
            data: `a9059cbb${addressWord(RECIPIENT)}${uintWord(12_345_678n)}`
          }
        }
      }]
    },
    ret: [{ contractRet }]
  };
}

function movementWitness(
  txHash: string,
  status: TronTransactionProviderEvidenceV1["finality"]["status"]
): TransactionProviderMovementWitnessV1 {
  const result = status === "confirmed_success"
    ? "SUCCESS"
    : status === "confirmed_reverted" ? "REVERT" : "FAILED";
  return {
    txHash,
    transferId: `transfer-${txHash}`,
    eventIndex: 0,
    provider: "tronscan",
    providerRowOrdinalInTx: 0,
    contractAddress: TRON_USDT_CONTRACT_ADDRESS,
    callerAddress: CALLER,
    fromAddress: CALLER,
    toAddress: RECIPIENT,
    amountRaw: "12345678",
    confirmed: true,
    reverted: status === "confirmed_reverted",
    contractRet: result,
    finalResult: result
  };
}

function rawIdentity(txHash = HASH_A): TransactionProviderEvidenceIdentityV1 {
  return {
    version: "tron-transaction-provider-evidence-v1",
    chain: "tron",
    txHash,
    provider: "tron_fullnode",
    endpoint: "gettransactionbyid",
    providerSchemaVersion: 1
  };
}

function rawEvidence(input: {
  txHash?: string;
  status?: TronTransactionProviderEvidenceV1["finality"]["status"];
  payload?: unknown;
} = {}): TronTransactionProviderEvidenceV1 {
  const txHash = input.txHash ?? HASH_A;
  const status = input.status ?? "confirmed_success";
  const contractRet = status === "confirmed_success"
    ? "SUCCESS"
    : status === "confirmed_reverted" ? "REVERT" : "FAILED";
  const payload = input.payload ?? rawPayload(txHash, contractRet);
  const identity = rawIdentity(txHash);
  const movement = movementWitness(txHash, status);
  let witnessSha256 = WITNESS;
  try {
    witnessSha256 = transactionProviderFinalityWitnessSha256({ identity, status, payload, movement });
  } catch {
    // Deliberately malformed fixtures reach the repository's fail-closed validation.
  }
  return {
    ...identity,
    fetchedAt: "2026-07-26T12:00:00.000Z",
    finality: {
      status,
      witnessKind: "indexed_tron_usdt_transfer",
      witnessSha256,
      movement
    },
    payloadSha256: createHash("sha256").update(canonicalizeArtifactJson(payload)).digest("hex"),
    payload
  };
}

function fullEvidence(input: {
  txHash?: string;
  status?: TronTransactionProviderEvidenceV1["finality"]["status"];
  payload?: unknown;
} = {}): TronTransactionProviderEvidenceV1 {
  const txHash = input.txHash ?? HASH_A;
  const status = input.status ?? "confirmed_success";
  const contractRet = status === "confirmed_success"
    ? "SUCCESS"
    : status === "confirmed_reverted" ? "REVERT" : "FAILED";
  const payload = input.payload ?? { hash: txHash, confirmed: true, contractRet };
  const identity: TransactionProviderEvidenceIdentityV1 = {
    version: "tron-transaction-provider-evidence-v1",
    chain: "tron",
    txHash,
    provider: "tronscan",
    endpoint: "transaction-info",
    providerSchemaVersion: 1
  };
  let witnessSha256 = WITNESS;
  try {
    witnessSha256 = transactionProviderFinalityWitnessSha256({ identity, status, payload, movement: null });
  } catch {
    // Deliberately malformed fixtures reach the repository's fail-closed validation.
  }
  return {
    ...identity,
    fetchedAt: "2026-07-26T12:00:00.000Z",
    finality: {
      status,
      witnessKind: "tronscan_transaction_info",
      witnessSha256,
      movement: null
    },
    payloadSha256: createHash("sha256").update(canonicalizeArtifactJson(payload)).digest("hex"),
    payload
  };
}

type StoredRow = {
  id: string;
  source: string;
  source_type: string;
  chain: string;
  address: string | null;
  tx_hash: string | null;
  observed_transaction_hash: string | null;
  evidence_json: unknown;
};

function memoryDb(initial: StoredRow[] = []): {
  db: Db;
  rows: Map<string, StoredRow>;
  queries: Array<{ sql: string; params: unknown[] }>;
} {
  const rows = new Map(initial.map((row) => [row.id, row]));
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (/^\s*insert into raw_evidence/i.test(sql)) {
        const [id, source, sourceType, chain, txHash, evidenceJson] = params;
        if (!rows.has(String(id))) {
          rows.set(String(id), {
            id: String(id),
            source: String(source),
            source_type: String(sourceType),
            chain: String(chain),
            address: null,
            tx_hash: String(txHash),
            observed_transaction_hash: String(txHash),
            evidence_json: JSON.parse(String(evidenceJson))
          });
        }
        return { rows: [], rowCount: rows.has(String(id)) ? 1 : 0 };
      }
      const row = rows.get(String(params[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
  } as unknown as Db;
  return { db, rows, queries };
}

describe("transaction evidence repository", () => {
  it("derives restart-stable IDs and separates raw from transaction-info identities", () => {
    const identity = rawIdentity();
    expect(transactionProviderEvidenceId(identity)).toBe(transactionProviderEvidenceId({ ...identity }));
    expect(transactionProviderEvidenceId(identity)).toBe(transactionProviderEvidenceId({
      ...identity,
      apiKey: "must-not-enter-identity"
    } as TransactionProviderEvidenceIdentityV1));
    expect(transactionProviderEvidenceId(identity)).not.toBe(transactionProviderEvidenceId({
      ...identity,
      provider: "tronscan",
      endpoint: "transaction-info"
    }));
  });

  it("inserts immutable provider_response evidence and validates the read-back", async () => {
    const store = memoryDb();
    const evidence = rawEvidence();
    const saved = await saveTransactionProviderEvidence(store.db, evidence);
    expect(saved.evidence).toEqual(evidence);
    const insert = store.queries.find(({ sql }) => /insert into raw_evidence/i.test(sql));
    expect(insert?.sql).toContain("on conflict (id) do nothing");
    expect(insert?.params.slice(1, 4)).toEqual([
      "tron_transaction_provider_evidence_v1",
      "provider_response",
      "tron"
    ]);
    await expect(getTransactionProviderEvidence(store.db, rawIdentity())).resolves.toEqual(evidence);
  });

  it("binds each endpoint to its real payload shape and a recomputed finality witness", async () => {
    const raw = rawEvidence();
    const full = fullEvidence();
    await expect(saveTransactionProviderEvidence(memoryDb().db, raw)).resolves.toBeTruthy();
    await expect(saveTransactionProviderEvidence(memoryDb().db, full)).resolves.toBeTruthy();
    await expect(saveTransactionProviderEvidence(memoryDb().db, rawEvidence({ payload: full.payload })))
      .rejects.toThrow("transaction_provider_evidence_not_permanent");
    await expect(saveTransactionProviderEvidence(memoryDb().db, fullEvidence({ payload: raw.payload })))
      .rejects.toThrow("transaction_provider_evidence_not_permanent");
    await expect(saveTransactionProviderEvidence(memoryDb().db, {
      ...raw,
      finality: { ...raw.finality, witnessSha256: WITNESS }
    })).rejects.toThrow("transaction_provider_evidence_not_permanent");
  });

  it("binds a raw witness to one exact rich movement identity", async () => {
    const raw = rawEvidence();
    const withUnhashedMovement = {
      ...raw,
      finality: {
        ...raw.finality,
        movement: { ...raw.finality.movement!, eventIndex: 7 }
      }
    } as unknown as TronTransactionProviderEvidenceV1;
    await expect(saveTransactionProviderEvidence(memoryDb().db, withUnhashedMovement))
      .rejects.toThrow("transaction_provider_evidence_not_permanent");
  });

  it("fails closed when an immutable row has a different source, identity, or payload hash", async () => {
    const evidence = rawEvidence();
    const id = transactionProviderEvidenceId(rawIdentity());
    const base: StoredRow = {
      id,
      source: "wrong_source",
      source_type: "provider_response",
      chain: "tron",
      address: null,
      tx_hash: HASH_A,
      observed_transaction_hash: HASH_A,
      evidence_json: evidence
    };
    for (const row of [
      base,
      { ...base, source: "tron_transaction_provider_evidence_v1", chain: "eth" },
      { ...base, source: "tron_transaction_provider_evidence_v1", evidence_json: { ...evidence, txHash: HASH_B } },
      { ...base, source: "tron_transaction_provider_evidence_v1", evidence_json: { ...evidence, payloadSha256: HASH_B } }
    ]) {
      await expect(getTransactionProviderEvidence(memoryDb([row]).db, rawIdentity()))
        .rejects.toThrow("transaction_provider_evidence_conflict");
    }
  });

  it.each([
    ["transient error", { error: "timeout", transient: true }],
    ["empty response", {}],
    ["not found", { txID: "", found: false }],
    ["foreign transaction", { txID: HASH_B, ret: [{ contractRet: "SUCCESS" }] }],
    ["unconfirmed", { txID: HASH_A, confirmed: false, ret: [{ contractRet: "SUCCESS" }] }],
    ["partial", { txID: HASH_A, partial: true, ret: [{ contractRet: "SUCCESS" }] }],
    ["pending", { txID: HASH_A, status: "pending", ret: [{ contractRet: "SUCCESS" }] }]
  ])("rejects %s payloads instead of negative-caching them", async (_label, payload) => {
    await expect(saveTransactionProviderEvidence(memoryDb().db, rawEvidence({ payload })))
      .rejects.toThrow("transaction_provider_evidence_not_permanent");
  });

  it.each([
    ["unconfirmed", { hash: HASH_A, confirmed: false, contractRet: "SUCCESS" }],
    ["missing final result", { hash: HASH_A, confirmed: true }],
    ["partial", { hash: HASH_A, confirmed: true, partial: true, contractRet: "SUCCESS" }]
  ])("rejects %s transaction-info payloads", async (_label, payload) => {
    await expect(saveTransactionProviderEvidence(memoryDb().db, fullEvidence({ payload })))
      .rejects.toThrow("transaction_provider_evidence_not_permanent");
  });

  it("persists finalized success, failure, and revert distinctly and preserves the non-clean statuses", async () => {
    const store = memoryDb();
    const successful = rawEvidence({ txHash: HASH_A, status: "confirmed_success" });
    const failed = rawEvidence({ txHash: HASH_B, status: "confirmed_failed" });
    const reverted = fullEvidence({ txHash: "c".repeat(64), status: "confirmed_reverted" });
    await saveTransactionProviderEvidence(store.db, successful);
    await saveTransactionProviderEvidence(store.db, failed);
    await saveTransactionProviderEvidence(store.db, reverted);
    expect((await getTransactionProviderEvidence(store.db, rawIdentity(HASH_A)))?.finality.status)
      .toBe("confirmed_success");
    expect((await getTransactionProviderEvidence(store.db, rawIdentity(HASH_B)))?.finality.status)
      .toBe("confirmed_failed");
    expect((await getTransactionProviderEvidence(store.db, {
      version: "tron-transaction-provider-evidence-v1",
      chain: "tron",
      txHash: "c".repeat(64),
      provider: "tronscan",
      endpoint: "transaction-info",
      providerSchemaVersion: 1
    }))?.finality.status).toBe("confirmed_reverted");
    expect(store.queries.filter(({ sql }) => /^\s*insert/i.test(sql))).toHaveLength(3);
  });

  it("accepts a finalized raw payload that remains policy-ambiguous", async () => {
    const payload = {
      txID: HASH_A,
      raw_data: { contract: [{ type: "TriggerSmartContract" }, { type: "TransferContract" }] },
      ret: [{ contractRet: "SUCCESS" }]
    };
    await expect(saveTransactionProviderEvidence(memoryDb().db, rawEvidence({ payload })))
      .resolves.toMatchObject({ evidence: { payload } });
  });

  it("does not let an earlier successful contract hide a later reverted result", async () => {
    const payload = {
      txID: HASH_A,
      raw_data: { contract: [{ type: "TriggerSmartContract" }, { type: "TriggerSmartContract" }] },
      ret: [{ contractRet: "SUCCESS" }, { contractRet: "REVERT" }]
    };
    await expect(saveTransactionProviderEvidence(memoryDb().db, rawEvidence({ payload })))
      .rejects.toThrow("transaction_provider_evidence_not_permanent");
    await expect(saveTransactionProviderEvidence(memoryDb().db, rawEvidence({
      payload,
      status: "confirmed_reverted"
    }))).resolves.toMatchObject({ evidence: { finality: { status: "confirmed_reverted" } } });
  });

  it("concurrent inserts converge on one immutable row", async () => {
    const store = memoryDb();
    const evidence = rawEvidence();
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      saveTransactionProviderEvidence(store.db, evidence)));
    expect(new Set(results.map(({ id }) => id))).toEqual(new Set([transactionProviderEvidenceId(rawIdentity())]));
    expect(store.rows).toHaveLength(1);
  });

  it("stores deterministic decision evidence as detector_output with exact provider and movement witnesses", async () => {
    const store = memoryDb();
    const raw = rawEvidence();
    const providerEvidenceId = (await saveTransactionProviderEvidence(store.db, raw)).id;
    const decision: TransactionEnrichmentDecisionEvidenceV1 = {
      version: "transaction-enrichment-decision-evidence-v1",
      policyVersion: "selective-transaction-enrichment-v1",
      chain: "tron",
      txHash: HASH_A,
      decision: "plain_usdt_raw_proven",
      triggerCodes: [],
      providerEvidenceIds: [providerEvidenceId],
      movementWitnessSha256: raw.finality.witnessSha256
    };
    const first = await saveTransactionEnrichmentDecisionEvidence(store.db, decision);
    const second = await saveTransactionEnrichmentDecisionEvidence(store.db, { ...decision });
    expect(second.id).toBe(first.id);
    const row = store.rows.get(first.id);
    expect(row).toMatchObject({
      source: "selective_transaction_enrichment_v1",
      source_type: "detector_output",
      chain: "tron",
      tx_hash: HASH_A,
      observed_transaction_hash: HASH_A,
      evidence_json: decision
    });
    expect(row?.source_type).not.toBe("provider_response");
  });

  it("fails closed rather than overwriting conflicting decision evidence", async () => {
    const store = memoryDb();
    const raw = rawEvidence();
    const providerEvidenceId = (await saveTransactionProviderEvidence(store.db, raw)).id;
    const decision: TransactionEnrichmentDecisionEvidenceV1 = {
      version: "transaction-enrichment-decision-evidence-v1",
      policyVersion: "selective-transaction-enrichment-v1",
      chain: "tron",
      txHash: HASH_A,
      decision: "plain_usdt_raw_proven",
      triggerCodes: [],
      providerEvidenceIds: [providerEvidenceId],
      movementWitnessSha256: raw.finality.witnessSha256
    };
    const saved = await saveTransactionEnrichmentDecisionEvidence(store.db, decision);
    store.rows.set(saved.id, { ...store.rows.get(saved.id)!, source_type: "provider_response" });
    await expect(saveTransactionEnrichmentDecisionEvidence(store.db, decision))
      .rejects.toThrow("transaction_enrichment_decision_evidence_conflict");
  });

  it("never records plain raw proof from finalized failed or reverted provider evidence", async () => {
    const store = memoryDb();
    const failed = rawEvidence({ status: "confirmed_failed" });
    const providerEvidenceId = (await saveTransactionProviderEvidence(store.db, failed)).id;
    await expect(saveTransactionEnrichmentDecisionEvidence(store.db, {
      version: "transaction-enrichment-decision-evidence-v1",
      policyVersion: "selective-transaction-enrichment-v1",
      chain: "tron",
      txHash: HASH_A,
      decision: "plain_usdt_raw_proven",
      triggerCodes: [],
      providerEvidenceIds: [providerEvidenceId],
      movementWitnessSha256: WITNESS
    })).rejects.toThrow("transaction_enrichment_decision_evidence_invalid");
  });

  it.each(["confirmed_failed", "confirmed_reverted"] as const)(
    "rejects a plain decision that mixes successful raw evidence with %s full evidence",
    async (status) => {
      const store = memoryDb();
      const raw = rawEvidence();
      const contradictory = fullEvidence({ status });
      const rawId = (await saveTransactionProviderEvidence(store.db, raw)).id;
      const contradictoryId = (await saveTransactionProviderEvidence(store.db, contradictory)).id;
      await expect(saveTransactionEnrichmentDecisionEvidence(store.db, {
        version: "transaction-enrichment-decision-evidence-v1",
        policyVersion: "selective-transaction-enrichment-v1",
        chain: "tron",
        txHash: HASH_A,
        decision: "plain_usdt_raw_proven",
        triggerCodes: [],
        providerEvidenceIds: [rawId, contradictoryId],
        movementWitnessSha256: raw.finality.witnessSha256
      })).rejects.toThrow("transaction_enrichment_decision_evidence_invalid");
    }
  );
});

const postgresDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;

postgresDescribe("transaction evidence repository (PostgreSQL)", () => {
  it("converges concurrent immutable inserts and reads provider and decision rows back exactly", async () => {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const firstClient = await pool.connect();
    const secondClient = await pool.connect();
    const cleanupIds: string[] = [];
    try {
      const txHash = createHash("sha256").update(randomUUID()).digest("hex");
      const evidence = rawEvidence({ txHash });
      cleanupIds.push(transactionProviderEvidenceId(rawIdentity(txHash)));
      let arrivals = 0;
      let releaseBarrier!: () => void;
      const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
      const concurrentDb = (client: pg.PoolClient): Db => ({
        query: async (sql: string, params?: unknown[]) => {
          if (/^\s*insert into raw_evidence/i.test(sql)) {
            arrivals += 1;
            if (arrivals === 2) releaseBarrier();
            await barrier;
          }
          return client.query(sql, params);
        }
      }) as unknown as Db;
      const saved = await Promise.all([
        saveTransactionProviderEvidence(concurrentDb(firstClient), evidence),
        saveTransactionProviderEvidence(concurrentDb(secondClient), evidence)
      ]);
      expect(arrivals).toBe(2);
      expect(new Set(saved.map(({ id }) => id))).toHaveLength(1);
      expect((await pool.query(
        "select count(*)::int as count from raw_evidence where id = $1",
        [saved[0].id]
      )).rows[0].count).toBe(1);

      const decision: TransactionEnrichmentDecisionEvidenceV1 = {
        version: "transaction-enrichment-decision-evidence-v1",
        policyVersion: "selective-transaction-enrichment-v1",
        chain: "tron",
        txHash,
        decision: "plain_usdt_raw_proven",
        triggerCodes: [],
        providerEvidenceIds: [saved[0].id],
        movementWitnessSha256: evidence.finality.witnessSha256
      };
      const storedDecision = await saveTransactionEnrichmentDecisionEvidence(
        pool,
        decision
      );
      cleanupIds.push(storedDecision.id);
      expect(storedDecision.evidence).toEqual(decision);
      expect((await pool.query(
        "select source_type from raw_evidence where id = $1",
        [storedDecision.id]
      )).rows[0].source_type).toBe("detector_output");
    } finally {
      firstClient.release();
      secondClient.release();
      if (cleanupIds.length > 0) {
        await pool.query("delete from raw_evidence where id = any($1::text[])", [cleanupIds]);
      }
      await pool.end();
    }
  });
});
