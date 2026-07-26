import { createHash } from "node:crypto";
import { runWhereIsMoneyCheck, type RunWhereIsMoneyCheckInput, type WhereIsMoneyDeps } from "../check/whereIsMoneyCheck";
import type { WhereIsMoneyReport } from "../types";
import { canonicalizeArtifactJson } from "./canonicalJson";

export type StableWhereFactsV1 = Omit<WhereIsMoneyReport, "transactionInfoEnrichment">;
export const LEGACY_WHERE_REPLAY_BASELINE_COMMIT = "4861f22e697652c688489ef4be6ab9698cd6ef9f";

type ReplayDependency = {
  method: string;
  args: unknown[];
  response: unknown;
  payloadSha256: string;
  origin?: "legacy_observed" | "supplemental_stage_b_fixture";
  invocationCount?: number;
};

export type WhereLatencyReplayV1 = {
  schema: "where-latency-replay-v1";
  version: 1;
  baselineGitCommit: string;
  resolvedConfigHash: string;
  resolvedConfig: Record<string, unknown>;
  resolvedOptions: Record<string, unknown>;
  frozenClockIso: string;
  job: Record<string, unknown>;
  routeCriticalTxHashes: string[];
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

function canonicalStringSet(values: unknown): string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) fail("where_latency_replay_request_missing");
  return [...new Set(values as string[])].sort();
}

function reviveReplayValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((entry) => reviveReplayValue(entry));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /(?:timestamp|At|windowStart|windowEnd)$/i.test(key) && Number.isFinite(Date.parse(value))) {
      return new Date(value);
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, reviveReplayValue(child, childKey)]));
}

function normalizeReplayValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeReplayValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, normalizeReplayValue(child)]));
}

function sanitizeReplayValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeReplayValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => !FORBIDDEN_FIELD.test(key) && child !== undefined)
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
  if (!COMMIT.test(envelope.baselineGitCommit) || envelope.baselineGitCommit !== LEGACY_WHERE_REPLAY_BASELINE_COMMIT || !SHA256.test(envelope.resolvedConfigHash)
    || sha256({ config: envelope.resolvedConfig, options: envelope.resolvedOptions }) !== envelope.resolvedConfigHash) {
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
  const countedLegacy = new Map<string, number>();
  for (const dependency of envelope.dependencies) {
    if (dependency.origin === "legacy_observed") {
      if (dependency.invocationCount !== undefined && (!Number.isSafeInteger(dependency.invocationCount) || dependency.invocationCount < 1)) {
        fail("where_latency_replay_baseline_request_count_mismatch");
      }
      countedLegacy.set(dependency.method, (countedLegacy.get(dependency.method) ?? 0) + (dependency.invocationCount ?? 1));
    }
  }
  for (const [method, count] of Object.entries(envelope.baselineRequestCounts)) {
    if (!Number.isSafeInteger(count) || count < 0 || countedLegacy.get(method) !== count) {
      fail("where_latency_replay_baseline_request_count_mismatch");
    }
  }
  if ([...countedLegacy.keys()].some((method) => !(method in envelope.baselineRequestCounts))) {
    fail("where_latency_replay_baseline_request_count_mismatch");
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
  if (!Array.isArray(envelope.routeCriticalTxHashes) || envelope.routeCriticalTxHashes.length === 0) {
    fail("where_latency_replay_route_critical_hash_missing");
  }
  const expectedRouteHashes = new Set(collectRouteCriticalTransactionHashes(envelope.expectedStableFacts as WhereIsMoneyReport, {
    legacyObservedTransactionHashes: envelope.dependencies
      .filter((entry) => entry.method === "getTransaction" && entry.origin === "legacy_observed" && typeof entry.args[0] === "string")
      .map((entry) => entry.args[0] as string)
  }));
  const routeHashes = new Set(envelope.routeCriticalTxHashes);
  if (routeHashes.size !== envelope.routeCriticalTxHashes.length
    || routeHashes.size !== expectedRouteHashes.size
    || [...routeHashes].some((hash) => !expectedRouteHashes.has(hash))) {
    fail("where_latency_replay_route_critical_hash_missing");
  }
  for (const txHash of routeHashes) {
    if (!movementHashes.has(txHash)) fail("where_latency_replay_indexed_movement_missing");
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
    const fullResponse = asObject(full.response, "where_latency_replay_transaction_info_identity_missing");
    const fullIdentity = fullResponse.txID ?? fullResponse.hash ?? fullResponse.id;
    if (typeof fullIdentity !== "string" || fullIdentity.toLowerCase() !== txHash.toLowerCase()) {
      fail("where_latency_replay_transaction_info_identity_mismatch");
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
  const resolvedConfig = sanitizeReplayValue(input.resolvedConfig) as Record<string, unknown>;
  const resolvedOptions = sanitizeReplayValue(input.resolvedOptions) as Record<string, unknown>;
  const envelope = sanitizeReplayValue({
    ...input,
    resolvedConfig,
    resolvedOptions,
    resolvedConfigHash: sha256({ config: resolvedConfig, options: resolvedOptions }),
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

export async function runWhereLatencyReplay(replay: WhereLatencyReplayV1): Promise<WhereIsMoneyReport> {
  const fixed = new Date(replay.frozenClockIso).getTime();
  if (!Number.isFinite(fixed)) fail("where_latency_replay_clock_invalid");
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value === undefined ? fixed : value);
    }
    static now(): number { return fixed; }
  }
  Object.setPrototypeOf(FrozenDate, RealDate);
  globalThis.Date = FrozenDate as DateConstructor;
  try {
    const options = reviveReplayValue(replay.job.options) as RunWhereIsMoneyCheckInput;
    const report = await runWhereIsMoneyCheck(createWhereReplayDeps(replay), options);
    assertExpectedStableWhereFacts(replay, report);
    return report;
  } finally {
    globalThis.Date = RealDate;
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
      if ((key === "txHash" || key === "targetTxHash" || key === "drainTxHash" || key === "approvalTxHash") && typeof child === "string" && child.length > 0) hashes.add(child);
      else if ((key === "txHashes" || key === "pathTxHashes") && Array.isArray(child)) child.forEach((hash) => {
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

export type WhereReplayDeps = WhereIsMoneyDeps & {
  getRawTransaction(txHash: string): Promise<unknown>;
  listIndexedTronUsdtTransfersByHashes(txHashes: string[]): Promise<Array<Record<string, unknown>>>;
  listActiveAddressLabelAssertionsForRoute(input: { chain: string; addresses: string[]; txHashes: string[] }): Promise<Array<Record<string, unknown>>>;
};

export function createWhereReplayDeps(replay: WhereLatencyReplayV1): WhereReplayDeps {
  assertEnvelope(replay);
  const tape = new Map(replay.dependencies.map((entry) => [requestKey(entry.method, entry.args), entry]));
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      if (property === "getRawTransaction") return async (txHash: string) => {
        const entry = replay.rawTransactions.find((item) => item.txHash.toLowerCase() === txHash.toLowerCase());
        if (!entry) fail("where_latency_replay_request_missing");
        return reviveReplayValue(structuredClone(entry.response));
      };
      if (property === "listIndexedTronUsdtTransfersByHashes") return async (txHashes: string[]) => {
        const expected = canonicalStringSet(txHashes);
        const movement = replay.indexedMovements.find((item) => canonicalStringSet(item.txHashes).join("\u0000") === expected.join("\u0000"));
        if (!movement) fail("where_latency_replay_request_missing");
        return reviveReplayValue(structuredClone(movement.rows));
      };
      if (property === "listActiveAddressLabelAssertionsForRoute") return async (input: { chain: string; addresses: string[]; txHashes: string[] }) => {
        const addresses = canonicalStringSet(input.addresses);
        const hashes = canonicalStringSet(input.txHashes);
        const query = replay.assertionQueries.find((item) => item.chain === input.chain
          && canonicalStringSet(item.addresses).join("\u0000") === addresses.join("\u0000")
          && canonicalStringSet(item.txHashes).join("\u0000") === hashes.join("\u0000"));
        if (!query) fail("where_latency_replay_request_missing");
        return reviveReplayValue(structuredClone(query.rows));
      };
      if (!replay.dependencies.some((entry) => entry.method === property)) return undefined;
      return async (...args: unknown[]) => {
        const entry = tape.get(requestKey(property, args));
        if (!entry) fail("where_latency_replay_request_missing");
        return reviveReplayValue(structuredClone(entry.response));
      };
    }
  }) as WhereReplayDeps;
}
