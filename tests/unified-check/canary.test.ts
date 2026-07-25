import { describe, expect, it, vi } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import { assertUnifiedWriteAllowed } from "../../src/unifiedCheck/contracts";
import type { UnifiedWatchdogRunV1 } from "../../src/unifiedCheck/watchdog";
import {
  buildUnifiedCanaryProviderConfiguration,
  buildUnifiedCanarySelection,
  parseUnifiedCanaryCli,
  prepareUnifiedCanaryBatch,
  runUnifiedCanaryHarness,
  verifyUnifiedCanaryDiagnosticHypothesis,
  type UnifiedCanaryExecutionBlockedV1,
  type UnifiedCanarySelectionRowV1
} from "../../src/unifiedCheck/canary";

const ADDRESSES = [
  "TYXN5ZiJLuzUyAY2dxdzdNjbwnUkSGB1it",
  "TV6bBsrCXz2sDSBMZhvc7vHqDwjc65ALZX",
  "TSv32fr41xwv3dh99PmtdxkhWguMEEuoVh",
  "TRddZMs7MJmbpQFuBpFxK4BDt5tA4LLPDu",
  "TEognYE7Sy6jiKxkDt2EbFgkUYUfsp9U2j",
  "TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr",
  "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
  "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
  "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9"
] as const;

const TBL7 = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const TQR = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const CUTOFF = "2026-07-23T12:00:00.000Z";
const CANDIDATE = "a".repeat(40);
const DATABASE_SCHEMA = {
  version: 33,
  checksumSha256: "b".repeat(64),
  schema032ChecksumSha256: "c".repeat(64)
} as const;
const PROVIDER_CONFIGURATION =
  buildUnifiedCanaryProviderConfiguration({
    tronscanBaseUrl: new URL("https://apilist.tronscanapi.com"),
    tronFullNodeBaseUrl: new URL("https://api.trongrid.io"),
    timeoutMs: 10_000,
    retryAttempts: 3,
    retryBaseDelayMs: 500,
    rateLimitCooldownMs: 1_000,
    maxInFlight: 20,
    maxInFlightPerGroup: 2,
    requestMinIntervalMs: 100,
    globalRequestMinIntervalMs: 50,
    transferRequestMinIntervalMs: 100,
    approvalRequestMinIntervalMs: 100,
    contractRequestMinIntervalMs: 100,
    fullNodeRequestMinIntervalMs: 100,
    tronGridRequestMinIntervalMs: 100,
    accountGroupRequestMinIntervalMs: 100,
    tronscanKeyCount: 4,
    fullNodeKeyConfigured: true,
    groups: [{ groupId: "default", keyCount: 4 }]
  });

function isolationAudit() {
  return {
    version: "unified-canary-isolation-audit-v1" as const,
    writerPolicyVersion: "unified-write-policy-v1" as const,
    auditedRunCount: 8 as const,
    auditedRequestCount: 8 as const,
    policyViolationCount: 0,
    authoritativeNamespaceWriteCount: 0,
    deliveryIntentWriteCount: 0,
    deliveryOwnershipWriteCount: 0,
    authoritativePresentationArtifactCount: 0,
    namespacedArtifactCount: 16,
    authoritativeNamespaces: [
      "unified_check_deliveries",
      "unified_wallet_delivery_ownership",
      "authoritative_presentation_artifacts"
    ] as const
  };
}
const DIAGNOSTIC_HYPOTHESIS = {
  version: "unified-canary-diagnostic-hypothesis-v1",
  schemaVersion: 1,
  hypothesisId: "provider-configuration-fence",
  reason: "Verify that only the matching deployed worker executes the batch.",
  changedInputs: [
    "provider.configuration",
    "worker.claim-fence"
  ],
  createdAt: CUTOFF
} as const;

function row(
  sourceRowId: string,
  subjectAddress: string,
  observedAt: string,
  runPurpose = "user_check",
  locale: "ru" | "en" = "ru",
  sourceTable: "unified_check_requests" | "forensic_check_jobs" =
    "unified_check_requests"
): UnifiedCanarySelectionRowV1 {
  return {
    sourceTable,
    sourceRowId,
    subjectAddress,
    runPurpose,
    locale,
    acceptedAt: observedAt,
    createdAt: observedAt,
    provenUserOrigin: true
  };
}

function selectionRows(): UnifiedCanarySelectionRowV1[] {
  const eligible = ADDRESSES.map((address, index) =>
    row(
      `eligible-${index}`,
      address,
      `2026-07-23T${String(11 - index).padStart(2, "0")}:00:00.000Z`,
      "user_check",
      index % 2 === 0 ? "ru" : "en",
      index === 7 ? "forensic_check_jobs" : "unified_check_requests"
    )
  );
  return [
    ...eligible,
    row("duplicate-old", ADDRESSES[0], "2026-07-22T01:00:00.000Z"),
    row("future", ADDRESSES[8], "2026-07-23T12:00:00.001Z"),
    row("canary", ADDRESSES[8], "2026-07-23T11:59:00.000Z", "release_canary"),
    row("synthetic", ADDRESSES[8], "2026-07-23T11:58:00.000Z", "synthetic_test"),
    row("admin", ADDRESSES[8], "2026-07-23T11:57:00.000Z", "admin_diagnostic"),
    row("maintenance", ADDRESSES[8], "2026-07-23T11:56:00.000Z", "maintenance"),
    row("invalid", "not-a-tron-address", "2026-07-23T11:55:00.000Z"),
    row("tbl7", TBL7, "2026-07-23T11:54:00.000Z"),
    row("tqr", TQR, "2026-07-23T11:53:00.000Z")
  ];
}

function selectionManifest(
  rows: readonly UnifiedCanarySelectionRowV1[] = selectionRows()
) {
  return buildUnifiedCanarySelection({
    rows,
    cutoffAt: CUTOFF,
    candidateCommit: CANDIDATE,
    databaseSchema: DATABASE_SCHEMA
  });
}

describe("Unified eight-wallet release canary", () => {
  it("requires an exact candidate and rejects ambiguous CLI retries", () => {
    expect(parseUnifiedCanaryCli([
      "--candidate",
      CANDIDATE,
      "--cutoff",
      CUTOFF,
      "--output",
      "artifacts/canary",
      "--hypothesis",
      "diagnostic-hypothesis.json"
    ])).toEqual({
      candidateCommit: CANDIDATE,
      cutoffAt: CUTOFF,
      diagnosticHypothesisPath: "diagnostic-hypothesis.json",
      resumeBatchIdentitySha256: null,
      outputDirectory: "artifacts/canary"
    });
    expect(parseUnifiedCanaryCli([
      "--candidate",
      CANDIDATE,
      "--resume",
      "e".repeat(64)
    ]).resumeBatchIdentitySha256).toBe("e".repeat(64));
    expect(() => parseUnifiedCanaryCli([]))
      .toThrow("unified_canary_candidate_invalid");
    expect(() => parseUnifiedCanaryCli([
      "--candidate",
      CANDIDATE,
      "--unknown",
      "value"
    ])).toThrow("unified_canary_cli_invalid");
    expect(() => parseUnifiedCanaryCli([
      "--candidate",
      CANDIDATE,
      "--candidate",
      CANDIDATE
    ])).toThrow("unified_canary_cli_invalid");
    expect(() => parseUnifiedCanaryCli([
      "--candidate",
      CANDIDATE,
      "--resume",
      "e".repeat(64),
      "--cutoff",
      CUTOFF
    ])).toThrow("unified_canary_resume_invalid");
  });

  it("freezes and hashes exactly eight recent unique proven user checks", () => {
    const manifest = selectionManifest();

    expect(manifest.selected).toHaveLength(8);
    expect(manifest.selected.map((item) => item.subjectAddress)).toEqual(
      ADDRESSES.slice(0, 8)
    );
    expect(manifest.selected[0]).toMatchObject({
      sourceRowId: "eligible-0",
      latestAt: "2026-07-23T11:00:00.000Z"
    });
    expect(manifest.source).toMatchObject({
      table: "unified_check_requests",
      provenLegacyTable: "forensic_check_jobs",
      databaseSchemaVersion: 33,
      databaseSchemaChecksumSha256: DATABASE_SCHEMA.checksumSha256,
      schema032ChecksumSha256: DATABASE_SCHEMA.schema032ChecksumSha256,
      candidateCommit: CANDIDATE,
      queryVersion: "unified-canary-selection-query-v1"
    });
    expect(manifest.source.querySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(fingerprintCanonicalArtifact(manifest)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("blocks before execution when fewer than eight addresses are eligible", () => {
    expect(() => selectionManifest(
      selectionRows().filter((candidate) =>
        candidate.subjectAddress !== ADDRESSES[7] &&
        candidate.subjectAddress !== ADDRESSES[8]
      )
    )).toThrow("unified_canary_requires_exactly_eight_wallets");
  });

  it("accepts only canonical, content-addressed diagnostic hypotheses", () => {
    const verified = verifyUnifiedCanaryDiagnosticHypothesis(
      DIAGNOSTIC_HYPOTHESIS
    );
    expect(verified.sha256).toBe(
      fingerprintCanonicalArtifact(DIAGNOSTIC_HYPOTHESIS)
    );
    expect(() => verifyUnifiedCanaryDiagnosticHypothesis({
      ...DIAGNOSTIC_HYPOTHESIS,
      changedInputs: []
    })).toThrow("unified_canary_hypothesis_invalid");
    expect(() => verifyUnifiedCanaryDiagnosticHypothesis({
      ...DIAGNOSTIC_HYPOTHESIS,
      changedInputs: [...DIAGNOSTIC_HYPOTHESIS.changedInputs].reverse()
    })).toThrow("unified_canary_hypothesis_invalid");
    expect(() => verifyUnifiedCanaryDiagnosticHypothesis({
      ...DIAGNOSTIC_HYPOTHESIS,
      nonce: "unbound"
    })).toThrow("unified_canary_hypothesis_invalid");
  });

  it("prepares eight fresh isolated parents and persists them in one batch", async () => {
    const manifest = selectionManifest();
    const createBatch = vi.fn(async (input) => ({
      selectionManifestSha256:
        fingerprintCanonicalArtifact(input.selectionManifest),
      batchIdentitySha256:
        fingerprintCanonicalArtifact(input.batchIdentity),
      runs: input.runs.map((item: { candidateRun: { id: string } }) => ({
        id: item.candidateRun.id,
        createdAt: "2026-07-23T12:01:00.000Z"
      }))
    }));
    let id = 0;
    const diagnosticHypothesis =
      verifyUnifiedCanaryDiagnosticHypothesis(DIAGNOSTIC_HYPOTHESIS);
    const prepareInput = {
      selectionManifest: manifest,
      snapshotSource: {
        latestConfirmedBlock: async () => ({
          number: "100",
          hash: "a".repeat(64),
          timestamp: CUTOFF
        }),
        snapshotBalances: async () => ({
          usdtRaw: null,
          trxSun: null,
          source: "fixture",
          consistency: "unavailable" as const
        })
      },
      versions: {
        labelDatasetSha256: "b".repeat(64),
        scoringPolicyVersion: "scoring-signal-matrix-v4",
        attributionPolicyVersion: "selected-attribution-policy-v1",
        runtimeCommit: CANDIDATE,
        schemaVersion: 33
      },
      providerConfiguration: PROVIDER_CONFIGURATION,
      diagnosticHypothesis,
      repository: { createBatch },
      createId: () => `canary-id-${++id}`,
      now: () => new Date("2026-07-23T12:01:00.000Z")
    };
    const result = await prepareUnifiedCanaryBatch(prepareInput);

    expect(createBatch).toHaveBeenCalledTimes(1);
    const input = createBatch.mock.calls[0]![0];
    expect(input.runs).toHaveLength(8);
    expect(input.runs.every((item: {
      request: { runPurpose: string; sideEffectPolicy: string };
      reuseAllowed: boolean;
      initialTasks: unknown[];
    }) =>
      item.request.runPurpose === "release_canary" &&
      item.request.sideEffectPolicy === "isolated" &&
      item.reuseAllowed === false &&
      item.initialTasks.length === 6
    )).toBe(true);
    expect(new Set(input.runs.map((item: {
      candidateRun: { analysisKeySha256: string };
    }) => item.candidateRun.analysisKeySha256)).size).toBe(8);
    expect(result.runs).toHaveLength(8);
    expect(result.batchIdentity).toMatchObject({
      candidateCommit: CANDIDATE,
      providerSchemaVersion: "tronscan-transfer-page-v1",
      providerConfiguration: PROVIDER_CONFIGURATION,
      diagnosticHypothesis
    });
    await expect(prepareUnifiedCanaryBatch({
      ...prepareInput,
      diagnosticHypothesis: {
        sha256: "0".repeat(64),
        artifact: DIAGNOSTIC_HYPOTHESIS
      }
    })).rejects.toThrow("unified_canary_hypothesis_hash_mismatch");
    expect(result.analysisReuse).toBe("forbid");
    expect(result.sideEffectPolicy).toBe("isolated");
  });

  it("rejects authoritative namespaces at the shared writer-policy gate", () => {
    expect(() => assertUnifiedWriteAllowed({
      runPurpose: "release_canary",
      sideEffectPolicy: "isolated",
      namespace: "authoritative_derived"
    })).toThrow("unified_canary_authoritative_write_forbidden");
    expect(() => assertUnifiedWriteAllowed({
      runPurpose: "release_canary",
      sideEffectPolicy: "isolated",
      namespace: "delivery_intent"
    })).toThrow("unified_canary_delivery_intent_forbidden");
    expect(() => assertUnifiedWriteAllowed({
      runPurpose: "release_canary",
      sideEffectPolicy: "isolated",
      namespace: "run_scoped_artifact"
    })).not.toThrow();
  });

  it("cancels at run.createdAt + 35m and records a concrete blocker once", async () => {
    const createdAt = "2026-07-23T12:00:00.000Z";
    let now = new Date("2026-07-23T12:34:59.000Z");
    const state = ADDRESSES.slice(0, 8).map((address, index) =>
      watchdogRun(`run-${index}`, address, createdAt)
    );
    const persistBlocker = vi.fn(async (_input: {
      runId: string;
      sha256: string;
      artifact: UnifiedCanaryExecutionBlockedV1;
    }) => ({ state: "blocked" as const, artifact: _input.artifact }));
    const result = await runUnifiedCanaryHarness({
      runs: state.map((run) => ({
        id: run.id,
        subjectAddress: run.subjectAddress,
        locale: "ru"
      })),
      candidateCommit: CANDIDATE,
      selectionManifestSha256: "c".repeat(64),
      batchIdentitySha256: "d".repeat(64),
      now: () => now,
      inspect: async () => state,
      advance: async () => {
        now = new Date("2026-07-23T12:35:00.000Z");
      },
      persistBlocker,
      isolationAudit,
      loadCompletedPresentation: async () => {
        throw new Error("completed_presentation_must_not_load");
      }
    });

    expect(persistBlocker).toHaveBeenCalledTimes(8);
    expect(result.results.every((item) =>
      item.outcome === "canary_execution_blocked" &&
      item.score === null &&
      item.decision === null &&
      item.html === null &&
      item.blocker?.phase === "direct_history"
    )).toBe(true);
    expect(result.deliveryIntentCount).toBe(0);
    expect(result.authoritativeDerivedWriteCount).toBe(0);
    expect(result.isolationReceipt).toEqual(isolationAudit());
  });

  it("records the active waiting phase and provider error in a blocker", async () => {
    const createdAt = "2026-07-23T12:00:00.000Z";
    const state = ADDRESSES.slice(0, 8).map((address, index) =>
      watchdogRun(`run-${index}`, address, createdAt)
    );
    state[0] = {
      ...state[0]!,
      tasks: [{
        ...state[0]!.tasks[0]!,
        id: "deep-queued",
        kind: "deep",
        status: "QUEUED"
      }, {
        ...state[0]!.tasks[0]!,
        id: "direct-waiting",
        kind: "direct_history",
        status: "WAITING_RETRY",
        providerState: "waiting",
        lastError: "tronscan_429"
      }]
    };
    const persistBlocker = vi.fn(async (input: {
      runId: string;
      sha256: string;
      artifact: UnifiedCanaryExecutionBlockedV1;
    }) => ({ state: "blocked" as const, artifact: input.artifact }));
    await runUnifiedCanaryHarness({
      runs: state.map((run) => ({
        id: run.id,
        subjectAddress: run.subjectAddress,
        locale: "ru"
      })),
      candidateCommit: CANDIDATE,
      selectionManifestSha256: "c".repeat(64),
      batchIdentitySha256: "d".repeat(64),
      now: () => new Date("2026-07-23T12:35:00.000Z"),
      inspect: async () => state,
      advance: async () => undefined,
      persistBlocker,
      isolationAudit,
      loadCompletedPresentation: async () => {
        throw new Error("completed_presentation_must_not_load");
      }
    });

    const first = persistBlocker.mock.calls.find(
      ([input]) => input.runId === "run-0"
    )?.[0].artifact;
    expect(first).toMatchObject({
      phase: "direct_history",
      providerState: "waiting"
    });
    expect(first?.logs).toContain(
      "direct_history:WAITING_RETRY:waiting:tronscan_429"
    );
  });

  it("publishes score and exact HTML only for COMPLETED canaries", async () => {
    const createdAt = "2026-07-23T12:00:00.000Z";
    const runs = ADDRESSES.slice(0, 8).map((address, index) => ({
      ...watchdogRun(`run-${index}`, address, createdAt),
      status: index === 0 ? "COMPLETED" as const : "FAILED_TECHNICAL" as const,
      finalScore: index === 0 ? 22 : null,
      finalDecision: index === 0 ? "ACCEPTABLE" as const : null,
      completedAt: "2026-07-23T12:03:00.000Z"
    }));
    const result = await runUnifiedCanaryHarness({
      runs: runs.map((run) => ({
        id: run.id,
        subjectAddress: run.subjectAddress,
        locale: "ru"
      })),
      candidateCommit: CANDIDATE,
      selectionManifestSha256: "d".repeat(64),
      batchIdentitySha256: "e".repeat(64),
      now: () => new Date("2026-07-23T12:04:00.000Z"),
      inspect: async () => runs,
      advance: async () => undefined,
      persistBlocker: async (input) => ({
        state: "blocked",
        artifact: input.artifact
      }),
      isolationAudit,
      loadCompletedPresentation: async ({ runId }) => ({
        html: `<b>${runId}</b>`,
        htmlHash: fingerprintCanonicalArtifact(`<b>${runId}</b>`),
        evidenceAggregates: [{ kind: "services", count: 2 }],
        scoreReasons: ["clean_or_operational"]
      })
    });

    expect(result.results[0]).toMatchObject({
      outcome: "COMPLETED",
      score: 22,
      decision: "ACCEPTABLE",
      html: "<b>run-0</b>",
      scoreReasons: ["clean_or_operational"]
    });
    expect(result.results.slice(1).every((item) =>
      item.outcome === "FAILED_TECHNICAL" &&
      item.score === null &&
      item.html === null
    )).toBe(true);
  });
});

function watchdogRun(
  id: string,
  subjectAddress: string,
  createdAt: string
): UnifiedWatchdogRunV1 {
  return {
    id,
    subjectAddress,
    status: "RUNNING",
    statusReason: null,
    runPurpose: "release_canary",
    sideEffectPolicy: "isolated",
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    canaryDeadlineAt: "2026-07-23T12:35:00.000Z",
    finalScore: null,
    finalDecision: null,
    hashes: {
      snapshot: "a".repeat(64),
      analysisManifest: "b".repeat(64),
      evidence: null,
      closure: null,
      scoring: null,
      report: null
    },
    versions: {
      scoringPolicy: "scoring-signal-matrix-v4",
      attributionPolicy: "selected-attribution-policy-v1",
      traversalPolicy: "snapshot-closure-v1",
      runtimeCommit: "candidate",
      databaseSchema: 33
    },
    traversal: { closed: null, visitedCount: null, frontierCount: null },
    generation: {
      analysis: "unified",
      deliveryAuthority: "shadow",
      fenceId: null,
      activatedAt: null
    },
    tasks: [{
      id: `${id}:direct_history`,
      kind: "direct_history",
      status: "QUEUED",
      priorityLane: "background",
      readyAt: createdAt,
      leaseExpiresAt: null,
      heartbeatAt: null,
      cancellationRequestedAt: null,
      lastError: null,
      providerState: "ready",
      checkpoint: {},
      attempts: [],
      attemptDurations: [],
      durationsMs: { queue: 60_000, provider: 0, compute: 0 }
    }],
    deliveries: []
  };
}
