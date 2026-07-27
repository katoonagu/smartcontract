import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import { resolveLegacyWhereIsMoneyRunInput } from "../../src/forensics/deepForensicJob";
import {
  assertLegacyWhereSourceRevision,
  analyzeWhereLatencyReplay,
  assertWhereLatencyReplayAcceptance,
  assertWhereReplayConsumed,
  buildWhereLatencyReplayV1,
  assertExpectedStableWhereFacts,
  collectRouteCriticalAddresses,
  collectRouteCriticalTransactionHashes,
  collectExpectedOrdinaryOfficialUsdtTxHashes,
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
  expectedOrdinaryOfficialUsdtTxHashes: ["a".repeat(64)],
  routeCriticalAddresses: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"],
  frozenClockIso: "2026-07-26T00:00:00.000Z",
  job: { sourceAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z", options: { maxDepth: 20, sourceAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z" } },
  dependencies: [
    { method: "getTrc20Balance", args: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", "TR7"], response: "1", origin: "legacy_observed" as const },
    { method: "getTransaction", args: ["a".repeat(64)], response: { hash: "a".repeat(64), confirmed: true, contractRet: "SUCCESS" }, origin: "supplemental_stage_b_fixture" as const }
  ],
  indexedMovements: [{ txHashes: ["a".repeat(64)], rows: [{
    txHash: "a".repeat(64), blockNumber: 1, blockTimestamp: "2026-06-01T00:00:00.000Z",
    eventIndex: 0, transferId: "t-1", provider: "tronscan", providerRowOrdinalInTx: 0,
    fromAddress: "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm", toAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
    amountRaw: "1", method: "transfer", eventType: "Transfer",
    callerAddress: "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm", contractRet: "SUCCESS", finalResult: "SUCCESS", reverted: false,
    riskTransaction: false, confirmed: true
  }] }],
  assertionQueries: [{ chain: "tron", addresses: ["TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"], txHashes: ["a".repeat(64)], rows: [] }],
  rawTransactions: [{ txHash: "a".repeat(64), response: rawTransfer("a".repeat(64), "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm", "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", "1") }],
  expectedStableFacts: { subjectAddress: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", balanceFormingTransfers: [{ txHash: "a".repeat(64) }] } as any
};
const execFile = promisify(execFileCallback);

function wordAddress(address: string): string {
  return TronWeb.address.toHex(address).slice(2).padStart(64, "0").toLowerCase();
}

function rawTransfer(txHash: string, caller: string, recipient: string, amountRaw: string): Record<string, unknown> {
  return {
    txID: txHash,
    raw_data: {
      contract: [{
        type: "TriggerSmartContract",
        parameter: {
          type_url: "type.googleapis.com/protocol.TriggerSmartContract",
          value: {
            owner_address: TronWeb.address.toHex(caller),
            contract_address: TronWeb.address.toHex("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"),
            data: `a9059cbb${wordAddress(recipient)}${BigInt(amountRaw).toString(16).padStart(64, "0")}`
          }
        }
      }]
    },
    ret: [{ contractRet: "SUCCESS" }]
  };
}

function built() {
  return buildWhereLatencyReplayV1(base);
}

async function successfulReplay(overrides: { rawResponse?: unknown; fullResponse?: unknown; assertionRows?: Record<string, unknown>[] } = {}) {
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
      { method: "getTransaction", args: ["a".repeat(64)], response: overrides.fullResponse ?? { hash: "a".repeat(64), confirmed: true, contractRet: "SUCCESS" }, origin: "legacy_observed" as const },
      { method: "getTransaction", args: ["a".repeat(64)], response: overrides.fullResponse ?? { hash: "a".repeat(64), confirmed: true, contractRet: "SUCCESS" }, origin: "legacy_observed" as const }
    ],
    indexedMovements: [{ txHashes: routeCriticalTxHashes, rows: [{ ...base.indexedMovements[0]!.rows[0] }] }],
    assertionQueries: [{ chain: "tron", addresses: routeCriticalAddresses, txHashes: routeCriticalTxHashes, rows: overrides.assertionRows ?? [] }],
    rawTransactions: [{ txHash: "a".repeat(64), response: overrides.rawResponse ?? base.rawTransactions[0]!.response }],
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
      requestedAmountRaw: "7"
    });
    expect(input).not.toHaveProperty("contractTransactionInfoMinIntervalMs");
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
  it("freezes ordinary official-USDT hashes from baseline tape independently of resolver decisions", () => {
    const input = {
      routeCriticalTxHashes: base.routeCriticalTxHashes,
      rawTransactions: base.rawTransactions,
      indexedMovementRows: base.indexedMovements[0]!.rows
    };
    expect(collectExpectedOrdinaryOfficialUsdtTxHashes(input)).toEqual(["a".repeat(64)]);
    expect(collectExpectedOrdinaryOfficialUsdtTxHashes({
      ...input,
      knownHardTxHashes: ["a".repeat(64)]
    })).toEqual([]);
    expect(collectExpectedOrdinaryOfficialUsdtTxHashes({
      ...input,
      assertionRows: [{ chain: "tron", address: base.job.sourceAddress, status: "active", evidenceJson: { approvalTxHash: "a".repeat(64) } }]
    })).toEqual([]);
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
    const noOrdinaryManifest = structuredClone(built().envelope) as any;
    delete noOrdinaryManifest.expectedOrdinaryOfficialUsdtTxHashes;
    expect(() => parseWhereLatencyReplayV1(canonicalizeArtifactJson(noOrdinaryManifest))).toThrow("where_latency_replay_expected_ordinary_manifest_invalid");
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
      expect.objectContaining({ method: "same", args: ["key"], response: "response-1", origin: "legacy_observed", payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ method: "same", args: ["key"], error: { name: "TypeError", message: "second failed" }, origin: "legacy_observed", payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    ]);
    expect(capture.baselineRequestCounts()).toEqual({ same: 2 });
    expect(JSON.stringify(capture.invocations)).not.toContain("pending");
  });

  it("reserves invocation order at call start even when later calls settle first", async () => {
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    const firstResult = new Promise<string>((resolve) => { resolveFirst = resolve; });
    const secondResult = new Promise<string>((resolve) => { resolveSecond = resolve; });
    const capture = createDependencyInvocationTapeRecorder();

    const first = capture.record("first", [1], () => firstResult);
    const second = capture.record("second", [2], () => secondResult);
    resolveSecond("second-response");
    await expect(second).resolves.toBe("second-response");
    resolveFirst("first-response");
    await expect(first).resolves.toBe("first-response");

    expect(capture.invocations.map((entry) => entry.method)).toEqual(["first", "second"]);
    const replay = parseWhereLatencyReplayV1(buildWhereLatencyReplayV1({
      ...base,
      dependencies: [...capture.invocations, base.dependencies[1]]
    } as any).canonicalJson);
    const deps = createWhereReplayDeps(replay) as any;
    await expect(deps.first(1)).resolves.toBe("first-response");
    await expect(deps.second(2)).resolves.toBe("second-response");
    expect(() => assertWhereReplayConsumed(deps)).not.toThrow();
  });

  it("rejects a recorder slot that is still pending", async () => {
    let resolve!: (value: string) => void;
    const pendingResult = new Promise<string>((done) => { resolve = done; });
    const capture = createDependencyInvocationTapeRecorder();
    const pending = capture.record("pending", [], () => pendingResult);

    expect(() => buildWhereLatencyReplayV1({
      ...base,
      dependencies: [...capture.invocations, base.dependencies[1]]
    } as any)).toThrow("where_latency_replay_invocation_pending");

    resolve("done");
    await pending;
    expect(JSON.stringify(capture.invocations)).not.toContain('"state":"pending"');
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

  it("fences the extracted production execution builder and its runtime options adapter", () => {
    expect(LEGACY_WHERE_BEHAVIOR_SOURCE_FILES).toContain("src/forensics/deepForensicJob.ts");
    expect(LEGACY_WHERE_BEHAVIOR_SOURCE_FILES).toContain("src/runtime/deepForensicRuntimeOptions.ts");
    expect(() => assertLegacyWhereSourceRevision({
      recorderGitCommit: "a".repeat(40),
      behaviorSourceFiles: [...LEGACY_WHERE_BEHAVIOR_SOURCE_FILES],
      sourceTreeHash: LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH,
      approvedSourceTreeHash: LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH,
      recorderTreeClean: true
    })).not.toThrow();
    const changedDeepForensicJobHash = `${LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH.slice(0, -1)}${LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH.endsWith("0") ? "1" : "0"}`;
    expect(() => assertLegacyWhereSourceRevision({
      recorderGitCommit: "a".repeat(40),
      behaviorSourceFiles: [...LEGACY_WHERE_BEHAVIOR_SOURCE_FILES],
      sourceTreeHash: changedDeepForensicJobHash,
      approvedSourceTreeHash: LEGACY_WHERE_BEHAVIOR_SOURCE_TREE_HASH,
      recorderTreeClean: true
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

  it("replays Stage B selectively, preserves explicit facts, and reuses deterministic evidence in a second job", async () => {
    const replay = await successfulReplay();
    const liveFetch = vi.spyOn(globalThis, "fetch");

    const analysis = await analyzeWhereLatencyReplay(replay);

    expect(liveFetch).not.toHaveBeenCalled();
    expect(analysis.stableFactsEqual).toBe(true);
    expect(analysis.explicitStableFactsEqual).toEqual({
      coverage: true,
      coverageV2: true,
      decisionReasons: true,
      fastWalletRisk: true,
      sourceProvenanceMateriality: true,
      crossChainCorridor: true,
      riskCaseFile: true
    });
    expect(analysis.requestCounts).toEqual({
      baseline: { raw: 0, full: 2 },
      firstRun: { raw: 1, full: 0 },
      secondRun: { raw: 0, full: 0 }
    });
    expect(analysis.firstRun.report.transactionInfoEnrichment).toMatchObject({
      coverageStatus: "complete",
      fullProviderRequests: 0,
      rawProviderRequests: 1,
      decisions: [{ decision: "plain_usdt_raw_proven" }]
    });
    expect(analysis.secondRun.evidenceIds).toEqual(analysis.firstRun.evidenceIds);
    expect(analysis.secondRun.report.transactionInfoEnrichment?.savedEvidenceHits).toBeGreaterThan(0);
    liveFetch.mockRestore();
  });

  it("uses at most one full tape response for a hard hash and reuses it across jobs", async () => {
    const analysis = await analyzeWhereLatencyReplay(await successfulReplay({
      assertionRows: [{
        chain: "tron",
        address: base.job.sourceAddress,
        status: "active",
        evidenceJson: { approvalTxHash: "a".repeat(64) }
      }]
    }));

    expect(analysis.requestCounts.firstRun).toEqual({ raw: 1, full: 1 });
    expect(analysis.requestCounts.secondRun).toEqual({ raw: 0, full: 0 });
    expect(analysis.firstRun.report.transactionInfoEnrichment).toMatchObject({
      coverageStatus: "complete",
      decisions: [{ decision: "full_transaction_info_confirmed", priority: "hard" }]
    });
    expect(analysis.maxFullCallsPerIdentity).toBe(1);
  });

  it("turns bound but unusable raw/full tape responses into incomplete coverage, never an unchanged clean projection", async () => {
    const analysis = await analyzeWhereLatencyReplay(await successfulReplay({
      rawResponse: { txID: "a".repeat(64) },
      fullResponse: { hash: "a".repeat(64), confirmed: false }
    }));

    expect(analysis.stableFactsEqual).toBe(false);
    expect(analysis.firstRun.report.transactionInfoEnrichment).toMatchObject({
      coverageStatus: "coverage_incomplete",
      technicalStatus: "technical_unknown",
      decisions: [{ decision: "technical_unknown", continueTraversal: true }]
    });
    expect(analysis.firstRun.report.coverage).not.toEqual(analysis.expectedStableFacts.coverage);
  });

  it("accepts an explicitly incomplete manifest with missing raw tape and reports technical-unknown coverage", async () => {
    const incomplete = structuredClone(await successfulReplay());
    incomplete.rawTransactions = [];

    const analysis = await analyzeWhereLatencyReplay(parseWhereLatencyReplayV1(canonicalizeArtifactJson(incomplete)));

    expect(analysis.stableFactsEqual).toBe(false);
    expect(analysis.firstRun.report.transactionInfoEnrichment).toMatchObject({
      coverageStatus: "coverage_incomplete",
      technicalStatus: "technical_unknown",
      decisions: [{ decision: "technical_unknown", continueTraversal: true }]
    });
  });

  it("accepts an explicitly incomplete manifest with missing hard-required full tape and reports technical-unknown coverage", async () => {
    const incomplete = structuredClone(await successfulReplay({
      assertionRows: [{
        chain: "tron",
        address: base.job.sourceAddress,
        status: "active",
        evidenceJson: { approvalTxHash: "a".repeat(64) }
      }]
    }));
    incomplete.dependencies = incomplete.dependencies
      .filter((entry) => entry.method !== "getTransaction")
      .map((entry, sequence) => ({ ...entry, sequence }));
    delete incomplete.baselineRequestCounts.getTransaction;

    const analysis = await analyzeWhereLatencyReplay(parseWhereLatencyReplayV1(canonicalizeArtifactJson(incomplete)));

    expect(analysis.stableFactsEqual).toBe(false);
    expect(analysis.firstRun.report.transactionInfoEnrichment).toMatchObject({
      coverageStatus: "coverage_incomplete",
      technicalStatus: "technical_unknown",
      decisions: [{ decision: "technical_unknown", continueTraversal: true }]
    });
  });

  it("fails acceptance when the new resolver reclassifies a frozen ordinary hash and makes a full call", async () => {
    const raw = structuredClone(base.rawTransactions[0]!.response) as any;
    raw.raw_data.contract[0].parameter.value.data = `deadbeef${raw.raw_data.contract[0].parameter.value.data.slice(8)}`;
    const analysis = await analyzeWhereLatencyReplay(await successfulReplay({ rawResponse: raw }));

    expect(analysis.firstRun.report.transactionInfoEnrichment?.decisions[0]).toMatchObject({ priority: "hard" });
    expect(() => assertWhereLatencyReplayAcceptance(analysis)).toThrow("where_latency_replay_plain_transfer_full_request");
  });

  it("runs the canonical replay command from a fixture without capture configuration or writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "where-latency-replay-"));
    const fixture = join(directory, "fixture.json");
    try {
      await writeFile(fixture, canonicalizeArtifactJson(await successfulReplay()), "utf8");
      const { stdout, stderr } = await execFile(process.execPath, [
        "--import", "tsx", "scripts/captureWhereLatencyReplay.ts", "replay", "--fixture", fixture
      ], { cwd: process.cwd(), encoding: "utf8", windowsHide: true });

      expect(stderr).toBe("");
      expect(stdout).toBe(canonicalizeArtifactJson({
        baseline: { raw: 0, full: 2 },
        new: { raw: 1, full: 0 },
        stableFactsEqual: true
      }) + "\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
