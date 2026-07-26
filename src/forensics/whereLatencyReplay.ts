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
  return createHash("sha256").update(canonicalizeArtifactJson(value)).digest("hex");
}

function requestKey(method: string, args: unknown[]): string {
  return sha256({ method, args });
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
  const requestKeys = new Set<string>();
  for (const dependency of envelope.dependencies) {
    if (!dependency || typeof dependency.method !== "string" || !Array.isArray(dependency.args)) {
      fail("where_latency_replay_request_invalid");
    }
    if (!("response" in dependency)) fail("where_latency_replay_response_missing");
    if (!SHA256.test(dependency.payloadSha256) || dependency.payloadSha256 !== sha256(dependency.response)) {
      fail("where_latency_replay_payload_sha256_mismatch");
    }
    const key = requestKey(dependency.method, dependency.args);
    if (requestKeys.has(key)) fail("where_latency_replay_request_duplicate");
    requestKeys.add(key);
  }
  const movementHashes = new Set(envelope.indexedMovements.flatMap((entry) => entry.txHashes));
  if (movementHashes.size === 0 || envelope.indexedMovements.some((entry) => entry.rows.length === 0)) {
    fail("where_latency_replay_indexed_movement_missing");
  }
  for (const txHash of movementHashes) {
    const raw = envelope.rawTransactions.find((entry) => entry.txHash === txHash);
    if (!raw || raw.payloadSha256 !== sha256(raw.response)) fail("where_latency_replay_raw_transaction_missing");
    const response = asObject(raw.response, "where_latency_replay_raw_transaction_invalid");
    if (response.txID !== txHash) fail("where_latency_replay_raw_transaction_binding_mismatch");
    if (!requestKeys.has(requestKey("getTransaction", [txHash]))) {
      fail("where_latency_replay_transaction_info_missing");
    }
  }
  for (const query of envelope.assertionQueries) {
    if (query.chain !== "tron" || !Array.isArray(query.addresses) || !Array.isArray(query.txHashes) || !Array.isArray(query.rows)) {
      fail("where_latency_replay_assertion_query_missing");
    }
  }
}

export function buildWhereLatencyReplayV1(input: BuildWhereLatencyReplayV1Input): {
  envelope: WhereLatencyReplayV1;
  canonicalJson: string;
} {
  const envelope: WhereLatencyReplayV1 = {
    ...input,
    dependencies: input.dependencies.map((entry) => ({ ...entry, payloadSha256: sha256(entry.response) })),
    rawTransactions: input.rawTransactions.map((entry) => ({ ...entry, payloadSha256: sha256(entry.response) }))
  };
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

/** Conservative fixture prefetch: only transaction identities already present in the legacy report. */
export function collectRouteCriticalTransactionHashes(report: Pick<WhereIsMoneyReport,
  "balanceFormingTransfers" | "originPaths" | "approvalDrainProvenanceProfiles" | "contractDrivenTransferProfiles">): string[] {
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
  return [...hashes];
}

export function createWhereReplayDeps(replay: WhereLatencyReplayV1): WhereIsMoneyDeps {
  assertEnvelope(replay);
  const tape = new Map(replay.dependencies.map((entry) => [requestKey(entry.method, entry.args), entry]));
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      return async (...args: unknown[]) => {
        const entry = tape.get(requestKey(property, args));
        if (!entry) fail("where_latency_replay_request_missing");
        return structuredClone(entry.response);
      };
    }
  }) as WhereIsMoneyDeps;
}
