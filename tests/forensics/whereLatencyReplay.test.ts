import { describe, expect, it } from "vitest";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import { resolveLegacyWhereIsMoneyRunInput } from "../../src/forensics/deepForensicJob";
import {
  assertLegacyWhereSourceRevision,
  assertWhereReplayConsumed,
  buildWhereLatencyReplayV1,
  assertExpectedStableWhereFacts,
  collectRouteCriticalAddresses,
  collectRouteCriticalTransactionHashes,
  createDependencyInvocationTapeRecorder,
  createWhereReplayDeps,
  LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH,
  LEGACY_WHERE_BEHAVIOR_SOURCE_FILES,
  parseWhereLatencyReplayV1,
  projectWhereReplayConfig,
  projectStableWhereFacts,
  recordWhereIsMoneyDependencies,
  runWhereLatencyReplay
} from "../../src/forensics/whereLatencyReplay";
import { canonicalizeArtifactJson } from "../../src/forensics/canonicalJson";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";

const base = {
  schema: "where-latency-replay-v1" as const,
  version: 1 as const,
  baselineGitCommit: "4861f22e697652c688489ef4be6ab9698cd6ef9f",
  recorderGitCommit: "a".repeat(40),
  behaviorSourceFiles: [...LEGACY_WHERE_BEHAVIOR_SOURCE_FILES],
  sourceTreeHash: LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH,
  recorderTreeClean: true as const,
  resolvedConfig: projectWhereReplayConfig({
    tronscanBaseUrl: new URL("https://apilist.tronscanapi.com/"),
    tronFullNodeBaseUrl: new URL("https://api.trongrid.io/"),
    rangeBaseUrl: new URL("https://api.range.org/"),
    evmExplorerBaseUrl: new URL("https://api.etherscan.io/"),
    tronscanTimeoutMs: 1,
    tronscanRetryAttempts: 1,
    tronscanRetryBaseDelayMs: 1,
    tronscanRequestMinIntervalMs: 1,
    tronscanGlobalRequestMinIntervalMs: 1,
    tronscanTransferRequestMinIntervalMs: 1,
    tronscanApprovalRequestMinIntervalMs: 1,
    tronscanContractRequestMinIntervalMs: 1,
    tronscanFullNodeRequestMinIntervalMs: 1,
    tronGridRequestMinIntervalMs: 1,
    tronscanAccountGroupRequestMinIntervalMs: 1,
    tronscanRateLimitCooldownMs: 1,
    tronscanPageLimit: 100,
    tronscanMaxInFlight: 1,
    tronscanGroupMaxInFlight: 1,
    tronscanApiKeys: [],
    tronscanApiKeyGroups: [],
    tronFullNodeApiKey: null,
    crossChainStage2Enabled: false,
    crossChainStage2MaxProviderCalls: 1,
    crossChainStage2CacheTtlMs: 1,
    rangeApiKey: null,
    rangeTimeoutMs: 1,
    rangeMaxCallsPerCheck: 1,
    evmExplorerApiKey: null,
    evmExplorerTimeoutMs: 1,
    evmExplorerMaxCallsPerCheck: 1,
    directHardEvidenceLiveLimit: null,
    directHardEvidenceConcurrency: null,
    tronAddressIndexSecondLayerMaxActiveWalletsPerJob: null,
    adminSecondLayerMaxActiveWallets: null
  } as any),
  resolvedOptions: { maxDepth: 20, sourceAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z" },
  routeCriticalTxHashes: ["a".repeat(64)],
  routeCriticalAddresses: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"],
  frozenClockIso: "2026-07-26T00:00:00.000Z",
  job: { sourceAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z", options: { maxDepth: 20, sourceAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z" } },
  dependencies: [
    { method: "getTrc20Balance", args: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", "TR7"], response: "1", origin: "legacy_observed" as const },
    { method: "getTransaction", args: ["a".repeat(64)], response: { txID: "a".repeat(64) }, origin: "supplemental_stage_b_fixture" as const }
  ],
  indexedMovements: [{ txHashes: ["a".repeat(64)], rows: [{ txHash: "a".repeat(64), eventIndex: 0, transferId: "t-1", providerRowOrdinalInTx: 0, callerAddress: null, contractRet: "SUCCESS", finalResult: "SUCCESS", reverted: false, confirmed: true }] }],
  assertionQueries: [{ chain: "tron", addresses: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"], txHashes: ["a".repeat(64)], rows: [] }],
  rawTransactions: [{ txHash: "a".repeat(64), response: { txID: "a".repeat(64) } }],
  expectedStableFacts: { subjectAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", balanceFormingTransfers: [{ txHash: "a".repeat(64) }] } as any
};

function built() {
  return buildWhereLatencyReplayV1(base);
}

async function successfulReplay() {
  const sourceAddress = base.job.sourceAddress;
  const senderAddress = "TSender1111111111111111111111111111";
  const clock = new Date(base.frozenClockIso).getTime();
  const options = {
    sourceAddress,
    requestedAmountRaw: "1",
    seedTransfers: [{
      txHash: "a".repeat(64),
      fromAddress: senderAddress,
      toAddress: sourceAddress,
      amountRaw: "1",
      timestamp: "2026-06-01T00:00:00.000Z",
      coverageShare: 1,
      selectedReason: "covers_current_balance" as const
    }],
    windowStart: new Date(base.job.windowStart),
    windowEnd: new Date(base.job.windowEnd),
    approvalEnrichmentMode: "off" as const,
    crossChainStage2Enabled: false,
    now: () => clock
  };
  const capture = createDependencyInvocationTapeRecorder();
  const dependencies = recordWhereIsMoneyDependencies({
    getTrc20Balance: async () => "1",
    fetchEdgesForAddress: async () => [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => null
  }, capture.record);
  const report = await runWhereIsMoneyCheck(dependencies, options);
  const routeCriticalTxHashes = collectRouteCriticalTransactionHashes(report);
  const routeCriticalAddresses = collectRouteCriticalAddresses(report);
  const storedOptions = { ...options, now: undefined };
  return parseWhereLatencyReplayV1(buildWhereLatencyReplayV1({
    ...base,
    resolvedOptions: storedOptions,
    job: {
      sourceAddress,
      windowStart: base.job.windowStart,
      windowEnd: base.job.windowEnd,
      options: storedOptions
    },
    routeCriticalTxHashes,
    routeCriticalAddresses,
    dependencies: [
      ...capture.invocations,
      { method: "getTransaction", args: ["a".repeat(64)], response: { txID: "a".repeat(64) }, origin: "supplemental_stage_b_fixture" as const }
    ],
    indexedMovements: [{ txHashes: routeCriticalTxHashes, rows: [{ ...base.indexedMovements[0]!.rows[0] }] }],
    assertionQueries: [{ chain: "tron", addresses: routeCriticalAddresses, txHashes: routeCriticalTxHashes, rows: [] }],
    expectedStableFacts: projectStableWhereFacts(report)
  } as any).canonicalJson);
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

  it("rejects missing outcomes, secret fields, mismatched counts and missing frozen evidence", () => {
    const missing = structuredClone(built().envelope) as any;
    delete missing.dependencies[0].response;
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(missing))).toThrow("where_latency_replay_outcome_missing");
    const wrongCounts = structuredClone(built().envelope) as any;
    wrongCounts.baselineRequestCounts.getTrc20Balance = 2;
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(wrongCounts))).toThrow("where_latency_replay_baseline_request_count_mismatch");
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

  it("replays recorded nested cross-chain provider calls", async () => {
    const continuationInput = {
      address: { chain: "tron", chainId: "tron", address: base.job.sourceAddress },
      seed: {
        id: "seed",
        chain: "tron",
        address: base.job.sourceAddress,
        txHash: "a".repeat(64),
        amountRaw: "1",
        assetSymbol: "USDT",
        timestamp: "2026-01-02T00:00:00.000Z",
        labels: [],
        evidenceRefs: []
      },
      budget: {}
    };
    const replay = parseWhereLatencyReplayV1(buildWhereLatencyReplayV1({
      ...base,
      baselineRequestCounts: {
        getTrc20Balance: 1,
        "crossChainDiscoveryProvider.findTransfersByTx": 1,
        "crossChainContinuationProviders.0.listEdgesForAddress": 1,
        "evmEvidenceProvider.listNormalTransactions": 1
      },
      dependencies: [
        ...base.dependencies,
        {
          method: "crossChainDiscoveryProvider.findTransfersByTx",
          args: [{ chain: "tron", txHash: "a".repeat(64) }],
          response: [],
          origin: "legacy_observed" as const
        },
        {
          method: "crossChainContinuationProviders.0.listEdgesForAddress",
          args: [continuationInput],
          response: [],
          origin: "legacy_observed" as const
        },
        {
          method: "evmEvidenceProvider.listNormalTransactions",
          args: [{ chain: "ethereum", address: "0xabc" }],
          response: [],
          origin: "legacy_observed" as const
        }
      ]
    } as any).canonicalJson);
    const deps = createWhereReplayDeps(replay);

    await expect(deps.getTrc20Balance(base.job.sourceAddress, "TR7")).resolves.toBe("1");
    await expect(deps.crossChainDiscoveryProvider?.findTransfersByTx({ chain: "tron", txHash: "a".repeat(64) })).resolves.toEqual([]);
    expect(deps.crossChainContinuationProviders?.map((provider) => provider.chain)).toEqual(["tron"]);
    await expect(deps.crossChainContinuationProviders?.[0]?.listEdgesForAddress({
      ...continuationInput,
      budget: createCrossChainProviderBudget({ maxProviderCalls: 1 })
    })).resolves.toEqual([]);
    await expect(deps.evmEvidenceProvider?.listNormalTransactions({ chain: "ethereum", address: "0xabc" })).resolves.toEqual([]);
  });

  it("redacts forbidden identifiers from captured dependency responses before hashing", () => {
    const { envelope } = buildWhereLatencyReplayV1({
      ...base,
      dependencies: [...base.dependencies, { method: "getLabelsForAddress", args: [base.job.sourceAddress], response: [{ address: base.job.sourceAddress, createdByTelegramId: "9001" }] }]
    } as any);
    expect(envelope.dependencies.at(-1)?.response).toEqual([{ address: base.job.sourceAddress }]);
  });

  it("keeps repeated legacy invocations as separate ordered tape entries", () => {
    const { envelope } = buildWhereLatencyReplayV1({
      ...base,
      dependencies: [base.dependencies[0], base.dependencies[0], base.dependencies[1]]
    } as any);
    expect(envelope.dependencies).toHaveLength(3);
    expect(envelope.baselineRequestCounts).toEqual({ getTrc20Balance: 2 });
  });

  it("records every repeated invocation and preserves a distinct response and serialized error", async () => {
    const capture = createDependencyInvocationTapeRecorder();
    let calls = 0;
    const operation = async () => {
      calls += 1;
      if (calls === 2) throw new TypeError("second failed");
      return `response-${calls}`;
    };

    await expect(capture.record("same", ["key"], operation)).resolves.toBe("response-1");
    await expect(capture.record("same", ["key"], operation)).rejects.toThrow("second failed");

    expect(calls).toBe(2);
    expect(capture.invocations).toEqual([
      expect.objectContaining({ method: "same", args: ["key"], response: "response-1", origin: "legacy_observed" }),
      expect.objectContaining({ method: "same", args: ["key"], error: { name: "TypeError", message: "second failed" }, origin: "legacy_observed" })
    ]);
    expect(capture.baselineRequestCounts()).toEqual({ same: 2 });
  });

  it("consumes repeated calls in global order, rejects excess and detects under-consumption", async () => {
    const replay = parseWhereLatencyReplayV1(buildWhereLatencyReplayV1({
      ...base,
      baselineRequestCounts: { getTrc20Balance: 2, getLabelsForAddress: 1 },
      dependencies: [
        { method: "getTrc20Balance", args: [base.job.sourceAddress, "TR7"], response: "first", origin: "legacy_observed" as const },
        { method: "getLabelsForAddress", args: [base.job.sourceAddress], response: [], origin: "legacy_observed" as const },
        { method: "getTrc20Balance", args: [base.job.sourceAddress, "TR7"], error: { name: "Error", message: "second failed" }, origin: "legacy_observed" as const },
        base.dependencies[1]
      ]
    } as any).canonicalJson);

    const ordered = createWhereReplayDeps(replay);
    await expect(ordered.getTrc20Balance(base.job.sourceAddress, "TR7")).resolves.toBe("first");
    await expect(ordered.getLabelsForAddress(base.job.sourceAddress)).resolves.toEqual([]);
    await expect(ordered.getTrc20Balance(base.job.sourceAddress, "TR7")).rejects.toThrow("second failed");
    expect(() => assertWhereReplayConsumed(ordered)).not.toThrow();
    await expect(ordered.getTrc20Balance(base.job.sourceAddress, "TR7")).rejects.toThrow("where_latency_replay_invocation_excess");

    const underCalled = createWhereReplayDeps(replay);
    await underCalled.getTrc20Balance(base.job.sourceAddress, "TR7");
    expect(() => assertWhereReplayConsumed(underCalled)).toThrow("where_latency_replay_invocation_unconsumed");

    const wrongOrder = createWhereReplayDeps(replay);
    await expect(wrongOrder.getLabelsForAddress(base.job.sourceAddress)).rejects.toThrow("where_latency_replay_invocation_order_mismatch");
  });

  it("binds an explicit non-secret config projection including URL href differences", () => {
    const config = {
      tronscanBaseUrl: new URL("https://one.example/"),
      tronFullNodeBaseUrl: new URL("https://full.example/"),
      rangeBaseUrl: new URL("https://range.example/"),
      evmExplorerBaseUrl: new URL("https://evm.example/"),
      tronscanTimeoutMs: 1,
      tronscanRetryAttempts: 2,
      tronscanRetryBaseDelayMs: 3,
      tronscanRequestMinIntervalMs: 4,
      tronscanGlobalRequestMinIntervalMs: 5,
      tronscanTransferRequestMinIntervalMs: 6,
      tronscanApprovalRequestMinIntervalMs: 7,
      tronscanContractRequestMinIntervalMs: 8,
      tronscanFullNodeRequestMinIntervalMs: 9,
      tronGridRequestMinIntervalMs: 10,
      tronscanAccountGroupRequestMinIntervalMs: 11,
      tronscanRateLimitCooldownMs: 12,
      tronscanPageLimit: 100,
      tronscanMaxInFlight: 2,
      tronscanGroupMaxInFlight: 1,
      tronscanApiKeys: ["secret"],
      tronscanApiKeyGroups: [{ groupId: "primary", apiKeys: ["secret"] }],
      tronFullNodeApiKey: "secret",
      crossChainStage2Enabled: true,
      crossChainStage2MaxProviderCalls: 13,
      crossChainStage2CacheTtlMs: 14,
      rangeApiKey: "secret",
      rangeTimeoutMs: 15,
      rangeMaxCallsPerCheck: 16,
      evmExplorerApiKey: "secret",
      evmExplorerTimeoutMs: 17,
      evmExplorerMaxCallsPerCheck: 18,
      directHardEvidenceLiveLimit: 19,
      directHardEvidenceConcurrency: 20,
      tronAddressIndexSecondLayerMaxActiveWalletsPerJob: 21,
      adminSecondLayerMaxActiveWallets: 22
    };
    const first = projectWhereReplayConfig(config as any);
    const second = projectWhereReplayConfig({ ...config, tronscanBaseUrl: new URL("https://two.example/") } as any);
    const firstBuilt = buildWhereLatencyReplayV1({ ...base, resolvedConfig: first } as any).envelope;
    const secondBuilt = buildWhereLatencyReplayV1({ ...base, resolvedConfig: second } as any).envelope;

    expect(first.tronscanBaseUrl).toBe("https://one.example/");
    expect(JSON.stringify(first)).not.toContain("secret");
    expect(firstBuilt.resolvedConfigHash).not.toBe(secondBuilt.resolvedConfigHash);
  });

  it("rejects recorder source evidence when a behavior source differs from the approved baseline", () => {
    expect(() => assertLegacyWhereSourceRevision({
      recorderGitCommit: "a".repeat(40),
      behaviorSourceFiles: [...LEGACY_WHERE_BEHAVIOR_SOURCE_FILES],
      sourceTreeHash: "b".repeat(64),
      approvedSourceTreeHash: "c".repeat(64)
    })).toThrow("where_latency_replay_behavior_source_mismatch");
  });

  it("fails closed for an unrecorded request", async () => {
    await expect(createWhereReplayDeps(parseWhereLatencyReplayV1(built().canonicalJson))
      .getTrc20Balance("Tother", "TR7")).rejects.toThrow("where_latency_replay_invocation_order_mismatch");
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

  it("keeps the global clock untouched across concurrent successful and failed replays", async () => {
    const originalDate = Date;
    const replay = await successfulReplay();
    const failedReplay = parseWhereLatencyReplayV1(built().canonicalJson);
    const results = await Promise.allSettled([
      runWhereLatencyReplay(replay),
      Promise.resolve().then(() => runWhereLatencyReplay(replay)),
      runWhereLatencyReplay(failedReplay)
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(Date).toBe(originalDate);
  });
});
