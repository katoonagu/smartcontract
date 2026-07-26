import { createHash } from "node:crypto";
import type { WhereIsMoneyDeps } from "../check/whereIsMoneyCheck";
import type { WhereIsMoneyReport } from "../types";
import { canonicalizeArtifactJson } from "./canonicalJson";

export type StableWhereFactsV1 = Omit<WhereIsMoneyReport, "transactionInfoEnrichment">;

type ReplayDependency = {
  method: string;
  args: unknown[];
  response: unknown;
  payloadSha256: string;
  origin?: "legacy_observed" | "supplemental_stage_b_fixture";
};

export type WhereLatencyReplayV1 = {
  schema: "where-latency-replay-v1";
  version: 1;
  baselineGitCommit: string;
  resolvedConfigHash: string;
  frozenClockIso: string;
  job: Record<string, unknown>;
  dependencies: ReplayDependency[];
  indexedMovements: Array<{ txHashes: string[]; rows: Array<Record<string, unknown>> }>;
  assertionQueries: Array<{ chain: string; addresses: string[]; txHashes: string[]; rows: Array<Record<string, unknown>> }>;
  rawTransactions: Array<{ txHash: string; response: unknown; payloadSha256: string }>;
  baselineRequestCounts: Record<string, number>;
  expectedStableFacts: StableWhereFactsV1;
};

export type BuildWhereLatencyReplayV1Input = Omit<WhereLatencyReplayV1, "dependencies" | "rawTransactions"> & {
  dependencies: Array<Omit<ReplayDependency, "payloadSha256">>;
  rawTransactions: Array<Omit<WhereLatencyReplayV1["rawTransactions"][number], "payloadSha256">>;
};

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const FORBIDDEN_FIELD = /(?:api[_-]?key|authorization|database[_-]?url|chat[_-]?id|telegram(?:[_-]?id)?|cookie|headers?)/i;

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalizeArtifactJson(normalizeReplayValue(value))).digest("hex");
}

function requestKey(method: string, args: unknown[]): string {
  return sha256({ method, args: normalizeReplayValue(args) });
}

function normalizeReplayValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeReplayValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeReplayValue(child)]));
}

function sanitizeReplayValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeReplayValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !FORBIDDEN_FIELD.test(key))
    .map(([key, child]) => [key, sanitizeReplayValue(child)]));
}

function fail(code: string): never {
  throw new Error(code);
}

function assertNoForbiddenFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key)) fail("where_latency_replay_forbidden_field");
    assertNoForbiddenFields(child);
  }
}

function asObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function assertEnvelope(envelope: WhereLatencyReplayV1): void {
  assertNoForbiddenFields(envelope);
  if (envelope.schema !== "where-latency-replay-v1" || envelope.version !== 1) {
    fail("where_latency_replay_version_unsupported");
  }
  if (!COMMIT.test(envelope.baselineGitCommit) || !SHA256.test(envelope.resolvedConfigHash)) {
    fail("where_latency_replay_baseline_binding_missing");
  }
  if (!Number.isFinite(Date.parse(envelope.frozenClockIso))) fail("where_latency_replay_clock_invalid");
  const job = asObject(envelope.job, "where_latency_replay_job_invalid");
  if (typeof job.sourceAddress !== "string" || !Number.isFinite(Date.parse(String(job.windowStart)))
    || !Number.isFinite(Date.parse(String(job.windowEnd))) || Date.parse(String(job.windowStart)) >= Date.parse(String(job.windowEnd))
    || !job.options || typeof job.options !== "object" || Array.isArray(job.options)) {
    fail("where_latency_replay_job_invalid");
  }
  const requestKeys = new Set<string>();
  for (const dependency of envelope.dependencies) {
    if (!dependency || typeof dependency.method !== "string" || !Array.isArray(dependency.args)) {
      fail("where_latency_replay_request_invalid");
    }
    if (!("response" in dependency)) fail("where_latency_replay_response_missing");
    if (dependency.origin !== undefined && dependency.origin !== "legacy_observed" && dependency.origin !== "supplemental_stage_b_fixture") {
      fail("where_latency_replay_request_origin_invalid");
    }
    if (!SHA256.test(dependency.payloadSha256) || dependency.payloadSha256 !== sha256(dependency.response)) {
      fail("where_latency_replay_payload_sha256_mismatch");
    }
    const key = requestKey(dependency.method, dependency.args);
    if (requestKeys.has(key)) fail("where_latency_replay_request_duplicate");
    requestKeys.add(key);
  }
  const movementKeys = new Set<string>();
  for (const movement of envelope.indexedMovements) {
    const key = requestKey("indexedMovements", movement.txHashes);
    if (movementKeys.has(key)) fail("where_latency_replay_indexed_movement_duplicate");
    movementKeys.add(key);
    for (const row of movement.rows) {
      const required = ["transferId", "txHash", "eventIndex", "providerRowOrdinalInTx", "callerAddress", "contractRet", "finalResult", "reverted", "confirmed"];
      if (required.some((field) => !(field in row))) fail("where_latency_replay_indexed_movement_incomplete");
      if (!movement.txHashes.includes(String(row.txHash))) fail("where_latency_replay_indexed_movement_binding_mismatch");
    }
    if (movement.txHashes.some((txHash) => !movement.rows.some((row) => row.txHash === txHash))) {
      fail("where_latency_replay_indexed_movement_missing");
    }
  }
  const movementHashes = new Set(envelope.indexedMovements.flatMap((entry) => entry.txHashes));
  if (movementHashes.size === 0 || envelope.indexedMovements.some((entry) => entry.rows.length === 0)) {
    fail("where_latency_replay_indexed_movement_missing");
  }
  for (const txHash of movementHashes) {
    const raw = envelope.rawTransactions.find((entry) => entry.txHash === txHash);
    if (!raw || raw.payloadSha256 !== sha256(raw.response)) fail("where_latency_replay_raw_transaction_missing");
    const response = asObject(raw.response, "where_latency_replay_raw_transaction_invalid");
    if (typeof response.txID !== "string" || response.txID.toLowerCase() !== txHash.toLowerCase()) {
      fail("where_latency_replay_raw_transaction_binding_mismatch");
    }
    const full = envelope.dependencies.find((entry) => requestKey(entry.method, entry.args) === requestKey("getTransaction", [txHash]));
    if (!full || (full.origin !== "legacy_observed" && full.origin !== "supplemental_stage_b_fixture")) {
      fail("where_latency_replay_transaction_info_missing");
    }
  }
  if (envelope.assertionQueries.length === 0) fail("where_latency_replay_assertion_query_missing");
  const assertionKeys = new Set<string>();
  for (const query of envelope.assertionQueries) {
    if (query.chain !== "tron" || !Array.isArray(query.addresses) || !Array.isArray(query.txHashes) || !Array.isArray(query.rows)) {
      fail("where_latency_replay_assertion_query_missing");
    }
    const key = requestKey("assertionQuery", [query.chain, query.addresses, query.txHashes]);
    if (assertionKeys.has(key)) fail("where_latency_replay_assertion_query_duplicate");
    assertionKeys.add(key);
  }
  for (const txHash of movementHashes) {
    if (!envelope.assertionQueries.some((query) => query.txHashes.includes(txHash))) {
      fail("where_latency_replay_assertion_query_missing");
    }
  }
}

export function buildWhereLatencyReplayV1(input: BuildWhereLatencyReplayV1Input): {
  envelope: WhereLatencyReplayV1;
  canonicalJson: string;
} {
  const envelope = sanitizeReplayValue({
    ...input,
    job: normalizeReplayValue(input.job) as Record<string, unknown>,
    dependencies: input.dependencies.map((entry) => ({
      ...entry,
      args: sanitizeReplayValue(entry.args) as unknown[],
      response: sanitizeReplayValue(entry.response),
      payloadSha256: sha256(sanitizeReplayValue(entry.response))
    })),
    rawTransactions: input.rawTransactions.map((entry) => ({
      ...entry,
      response: sanitizeReplayValue(entry.response),
      payloadSha256: sha256(sanitizeReplayValue(entry.response))
    }))
  }) as WhereLatencyReplayV1;
  assertEnvelope(envelope);
  return { envelope, canonicalJson: canonicalizeArtifactJson(envelope) };
}

export function parseWhereLatencyReplayV1(bytes: string): WhereLatencyReplayV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    fail("where_latency_replay_json_invalid");
  }
  const envelope = asObject(parsed, "where_latency_replay_envelope_invalid") as unknown as WhereLatencyReplayV1;
  if (canonicalizeArtifactJson(envelope) !== bytes) fail("where_latency_replay_json_not_canonical");
  assertEnvelope(envelope);
  return envelope;
}

export function projectStableWhereFacts(report: WhereIsMoneyReport): StableWhereFactsV1 {
  const facts = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  delete facts.transactionInfoEnrichment;
  return facts as StableWhereFactsV1;
}

export function assertExpectedStableWhereFacts(replay: WhereLatencyReplayV1, report: WhereIsMoneyReport): void {
  if (canonicalizeArtifactJson(projectStableWhereFacts(report)) !== canonicalizeArtifactJson(replay.expectedStableFacts)) {
    fail("where_latency_replay_stable_fact_mismatch");
  }
}

/** Conservative fixture prefetch: only transaction identities already present in the legacy report. */
export function collectRouteCriticalTransactionHashes(report: Pick<WhereIsMoneyReport,
  "balanceFormingTransfers" | "originPaths" | "approvalDrainProvenanceProfiles" | "contractDrivenTransferProfiles">,
input: {
  unresolvedEconomicRoleInputs?: Array<{ txHash?: string | null }>;
  legacyObservedTransactionHashes?: string[];
} = {}): string[] {
  const hashes = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === "txHash" || key === "drainTxHash") && typeof child === "string" && child.length > 0) hashes.add(child);
      else if (key === "txHashes" && Array.isArray(child)) child.forEach((hash) => {
        if (typeof hash === "string" && hash.length > 0) hashes.add(hash);
      });
      else visit(child);
    }
  };
  visit(report);
  for (const item of input.unresolvedEconomicRoleInputs ?? []) {
    if (item.txHash) hashes.add(item.txHash);
  }
  for (const hash of input.legacyObservedTransactionHashes ?? []) {
    if (hash.length > 0) hashes.add(hash);
  }
  return [...hashes];
}

export function createWhereReplayDeps(replay: WhereLatencyReplayV1): WhereIsMoneyDeps {
  assertEnvelope(replay);
  const tape = new Map(replay.dependencies.map((entry) => [requestKey(entry.method, entry.args), entry]));
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (!replay.dependencies.some((entry) => entry.method === property)) return undefined;
      return async (...args: unknown[]) => {
        const entry = tape.get(requestKey(property, args));
        if (!entry) fail("where_latency_replay_request_missing");
        return structuredClone(entry.response);
      };
    }
  }) as WhereIsMoneyDeps;
}
