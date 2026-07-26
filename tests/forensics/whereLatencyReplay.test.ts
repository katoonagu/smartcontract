import { describe, expect, it } from "vitest";
import {
  buildWhereLatencyReplayV1,
  collectRouteCriticalTransactionHashes,
  createWhereReplayDeps,
  parseWhereLatencyReplayV1,
  projectStableWhereFacts
} from "../../src/forensics/whereLatencyReplay";
import { canonicalizeArtifactJson } from "../../src/forensics/canonicalJson";

const base = {
  schema: "where-latency-replay-v1" as const,
  version: 1 as const,
  baselineGitCommit: "4861f22e697652c688489ef4be6ab9698cd6ef9f",
  resolvedConfigHash: "a".repeat(64),
  frozenClockIso: "2026-07-26T00:00:00.000Z",
  job: { sourceAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z" },
  dependencies: [
    { method: "getTrc20Balance", args: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", "TR7"], response: "1" },
    { method: "getTransaction", args: ["a".repeat(64)], response: { txID: "a".repeat(64) }, origin: "supplemental_stage_b_fixture" as const }
  ],
  indexedMovements: [{ txHashes: ["a".repeat(64)], rows: [{ txHash: "a".repeat(64), eventIndex: 0, transferId: "t-1" }] }],
  assertionQueries: [{ chain: "tron", addresses: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"], txHashes: [], rows: [] }],
  rawTransactions: [{ txHash: "a".repeat(64), response: { txID: "a".repeat(64) } }],
  baselineRequestCounts: { getTrc20Balance: 1 },
  expectedStableFacts: { subjectAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd" } as any
};

function built() {
  return buildWhereLatencyReplayV1(base);
}

describe("where latency replay v1", () => {
  it("collects a conservative route-critical transaction superset", () => {
    expect(collectRouteCriticalTransactionHashes({
      balanceFormingTransfers: [{ txHash: "a".repeat(64) }],
      originPaths: [{ txHashes: ["b".repeat(64)], steps: [{ txHash: "c".repeat(64) }] }],
      approvalDrainProvenanceProfiles: [{ drainTxHash: "d".repeat(64) }],
      contractDrivenTransferProfiles: [{ txHash: "e".repeat(64) }]
    } as any)).toEqual(["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64), "e".repeat(64)]);
  });
  it("round-trips canonical, hash-bound envelope and replays a recorded dependency", async () => {
    const { canonicalJson } = built();
    const replay = parseWhereLatencyReplayV1(canonicalJson);
    await expect(createWhereReplayDeps(replay).getTrc20Balance(base.job.sourceAddress, "TR7")).resolves.toBe("1");
    expect(projectStableWhereFacts({ subjectAddress: base.job.sourceAddress, transactionInfoEnrichment: { providerCalls: 1 } } as any)).toEqual({ subjectAddress: base.job.sourceAddress });
  });

  it("rejects unsupported version, noncanonical JSON and payload tampering", () => {
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson({ ...built().envelope, version: 2 }))).toThrow("where_latency_replay_version_unsupported");
    expect(() => parseWhereLatencyReplayV1(JSON.stringify(built().envelope, null, 2))).toThrow("where_latency_replay_json_not_canonical");
    const tampered = structuredClone(built().envelope) as any;
    tampered.dependencies[0].response = "2";
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(tampered))).toThrow("where_latency_replay_payload_sha256_mismatch");
  });

  it("rejects duplicate requests, missing response, secret fields and missing frozen evidence", () => {
    const duplicate = structuredClone(built().envelope) as any;
    duplicate.dependencies.push(structuredClone(duplicate.dependencies[0]));
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(duplicate))).toThrow("where_latency_replay_request_duplicate");
    const missing = structuredClone(built().envelope) as any;
    delete missing.dependencies[0].response;
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(missing))).toThrow("where_latency_replay_response_missing");
    const secret = structuredClone(built().envelope) as any;
    secret.requestHeaders = { authorization: "nope" };
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(secret))).toThrow("where_latency_replay_forbidden_field");
    const noMovement = structuredClone(built().envelope) as any;
    noMovement.indexedMovements = [];
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(noMovement))).toThrow("where_latency_replay_indexed_movement_missing");
  });

  it("fails closed for an unrecorded request", async () => {
    await expect(createWhereReplayDeps(parseWhereLatencyReplayV1(built().canonicalJson))
      .getTrc20Balance("Tother", "TR7")).rejects.toThrow("where_latency_replay_request_missing");
  });
});
