import { describe, expect, it } from "vitest";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import { resolveLegacyWhereIsMoneyRunInput } from "../../src/forensics/deepForensicJob";
import {
  buildWhereLatencyReplayV1,
  assertExpectedStableWhereFacts,
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
  resolvedConfig: { tronscanBaseUrl: "https://apilist.tronscanapi.com" },
  resolvedOptions: { maxDepth: 20 },
  routeCriticalTxHashes: ["a".repeat(64)],
  frozenClockIso: "2026-07-26T00:00:00.000Z",
  job: { sourceAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z", options: { maxDepth: 20 } },
  dependencies: [
    { method: "getTrc20Balance", args: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", "TR7"], response: "1", origin: "legacy_observed" as const },
    { method: "getTransaction", args: ["a".repeat(64)], response: { txID: "a".repeat(64) }, origin: "supplemental_stage_b_fixture" as const }
  ],
  indexedMovements: [{ txHashes: ["a".repeat(64)], rows: [{ txHash: "a".repeat(64), eventIndex: 0, transferId: "t-1", providerRowOrdinalInTx: 0, callerAddress: null, contractRet: "SUCCESS", finalResult: "SUCCESS", reverted: false, confirmed: true }] }],
  assertionQueries: [{ chain: "tron", addresses: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"], txHashes: ["a".repeat(64)], rows: [] }],
  rawTransactions: [{ txHash: "a".repeat(64), response: { txID: "a".repeat(64) } }],
  baselineRequestCounts: { getTrc20Balance: 1 },
  expectedStableFacts: { subjectAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", balanceFormingTransfers: [{ txHash: "a".repeat(64) }] } as any
};

function built() {
  return buildWhereLatencyReplayV1(base);
}

describe("where latency replay v1", () => {
  it("uses the same resolved legacy input contract as the production worker", () => {
    const input = resolveLegacyWhereIsMoneyRunInput({
      subjectAddress: base.job.sourceAddress,
      windowStart: new Date(base.job.windowStart), windowEnd: new Date(base.job.windowEnd),
      progressJson: { mode: "where_is_money", requestedAmountRaw: "7" }
    } as any, { maxEdgesPerAddress: 77 });
    expect(input).toMatchObject({
      sourceAddress: base.job.sourceAddress, maxEdgesPerAddress: 77,
      contractTransactionInfoMinIntervalMs: 1000, requestedAmountRaw: "7"
    });
  });
  it("collects a conservative route-critical transaction superset", () => {
    expect(collectRouteCriticalTransactionHashes({
      balanceFormingTransfers: [{ txHash: "a".repeat(64) }],
      originPaths: [{ txHashes: ["b".repeat(64)], steps: [{ txHash: "c".repeat(64) }] }],
      approvalDrainProvenanceProfiles: [{ drainTxHash: "d".repeat(64) }],
      contractDrivenTransferProfiles: [{ txHash: "e".repeat(64), approvalTxHash: "h".repeat(64), pathTxHashes: ["i".repeat(64)] }]
    } as any, {
      unresolvedEconomicRoleInputs: [{ txHash: "f".repeat(64) }],
      legacyObservedTransactionHashes: ["g".repeat(64)]
    })).toEqual(["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64), "e".repeat(64), "h".repeat(64), "i".repeat(64), "f".repeat(64), "g".repeat(64)]);
  });
  it("round-trips canonical, hash-bound envelope and replays a recorded dependency", async () => {
    const { canonicalJson } = built();
    const replay = parseWhereLatencyReplayV1(canonicalJson);
    await expect(createWhereReplayDeps(replay).getTrc20Balance(base.job.sourceAddress, "TR7")).resolves.toBe("1");
    expect(projectStableWhereFacts({ subjectAddress: base.job.sourceAddress, transactionInfoEnrichment: { providerCalls: 1 } } as any)).toEqual({ subjectAddress: base.job.sourceAddress });
  });

  it("rejects unsupported version, noncanonical JSON and payload tampering", () => {
    const noRouteList = structuredClone(built().envelope) as any;
    delete noRouteList.routeCriticalTxHashes;
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(noRouteList))).toThrow("where_latency_replay_route_critical_hash_missing");
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson({ ...built().envelope, baselineGitCommit: "b".repeat(40) }))).toThrow("where_latency_replay_baseline_binding_missing");
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
    const noAssertions = structuredClone(built().envelope) as any;
    noAssertions.assertionQueries = [];
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(noAssertions))).toThrow("where_latency_replay_assertion_query_missing");
  });

  it("replays Date arguments and leaves absent optional dependencies absent", async () => {
    const replay = parseWhereLatencyReplayV1(buildWhereLatencyReplayV1({
      ...base,
      baselineRequestCounts: { fetchEdgesForAddress: 1, getTransaction: 1 },
      dependencies: [{ method: "fetchEdgesForAddress", args: [base.job.sourceAddress, { latestTimestamp: new Date("2026-01-02T00:00:00.000Z") }], response: [], origin: "legacy_observed" as const }, {
        method: "getTransaction", args: ["a".repeat(64)], response: { txID: "a".repeat(64) }, origin: "legacy_observed"
      }]
    } as any).canonicalJson);
    const deps = createWhereReplayDeps(replay);
    await expect(deps.fetchEdgesForAddress(base.job.sourceAddress, { latestTimestamp: new Date("2026-01-02T00:00:00.000Z") })).resolves.toEqual([]);
    expect(deps.getFastWalletRisk).toBeUndefined();
  });

  it("redacts forbidden identifiers from captured dependency responses before hashing", () => {
    const { envelope } = buildWhereLatencyReplayV1({
      ...base,
      dependencies: [...base.dependencies, { method: "getLabelsForAddress", args: [base.job.sourceAddress], response: [{ address: base.job.sourceAddress, createdByTelegramId: "9001" }] }]
    } as any);
    expect(envelope.dependencies.at(-1)?.response).toEqual([{ address: base.job.sourceAddress }]);
  });

  it("keeps one canonical tape entry while preserving repeated legacy invocation counts", () => {
    const { envelope } = buildWhereLatencyReplayV1({
      ...base,
      baselineRequestCounts: { getTrc20Balance: 2 },
      dependencies: [{ ...base.dependencies[0], invocationCount: 2 }, base.dependencies[1]]
    } as any);
    expect(envelope.dependencies).toHaveLength(2);
    expect(envelope.baselineRequestCounts).toEqual({ getTrc20Balance: 2 });
  });

  it("fails closed for an unrecorded request", async () => {
    await expect(createWhereReplayDeps(parseWhereLatencyReplayV1(built().canonicalJson))
      .getTrc20Balance("Tother", "TR7")).rejects.toThrow("where_latency_replay_request_missing");
  });

  it("compares every stable report fact exactly", () => {
    const replay = parseWhereLatencyReplayV1(built().canonicalJson);
    expect(() => assertExpectedStableWhereFacts(replay, { subjectAddress: "different" } as any)).toThrow("where_latency_replay_stable_fact_mismatch");
    expect(() => assertExpectedStableWhereFacts(replay, { subjectAddress: base.job.sourceAddress, balanceFormingTransfers: [{ txHash: "a".repeat(64) }] } as any)).not.toThrow();
  });

  it("runs Where offline from the dependency tape without a live fallback", async () => {
    const replay = parseWhereLatencyReplayV1(buildWhereLatencyReplayV1({
      ...base,
      baselineRequestCounts: { getTrc20Balance: 1, fetchEdgesForAddress: 1, getTransaction: 1 },
      dependencies: [
        { method: "getTrc20Balance", args: [base.job.sourceAddress, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"], response: "0", origin: "legacy_observed" as const },
        { method: "fetchEdgesForAddress", args: [base.job.sourceAddress, { latestTimestamp: undefined, deferBroadTargetedHistory: undefined, targetEdge: undefined, expectedAmountRaw: undefined }], response: [], origin: "legacy_observed" as const },
        { method: "getTransaction", args: ["a".repeat(64)], response: { txID: "a".repeat(64) }, origin: "legacy_observed" }
      ]
    } as any).canonicalJson);
    const deps = createWhereReplayDeps(replay);
    await expect(runWhereIsMoneyCheck(deps, {
      sourceAddress: base.job.sourceAddress,
      windowStart: new Date(base.job.windowStart), windowEnd: new Date(base.job.windowEnd)
    })).resolves.toMatchObject({ subjectAddress: base.job.sourceAddress, balanceFormingTransfers: [] });
  });
});
