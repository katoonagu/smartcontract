import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateUnifiedBenchmarkPeakConcurrency,
  isNonterminalCheckpointedBenchmarkRun,
  createUnifiedBenchmarkReleaseOwner,
  parseUnifiedAdaptiveLiveCapacityStateV1,
  recoverUnifiedBenchmarkCapacityStateControl,
  runUnifiedBenchmarkControlScope,
  runUnifiedAdaptiveBenchmarkCli,
  UNIFIED_ADAPTIVE_LIVE_SCENARIOS,
  UnifiedAdaptiveBenchmarkRestartRequiredError
} from "../../scripts/runUnifiedAdaptiveBenchmark";
import {
  parseUnifiedAdaptiveBenchmarkEvidenceV1,
  sealUnifiedAdaptiveBenchmarkEvidenceV1,
  sealUnifiedProviderGroupAuditV1
} from "../../src/unifiedCheck/adaptiveBenchmarkEvidence";
import {
  parseUnifiedProviderReplayV1,
  sealUnifiedRollingOracleReceiptV1
} from "../../src/unifiedCheck/providerReplay";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";
import {
  buildUnifiedPerformanceBenchmarkManifest
} from "../../src/unifiedCheck/performanceMetrics";
import {
  loadAdaptiveBenchmarkIndexForFinalizer
} from "../../scripts/finalizeUnifiedReleaseGates";

afterEach(() => {
  vi.unstubAllGlobals();
});

function oracleFacts(tag = "postgres-lifecycle-fact-1") {
  return {
    canonicalFacts: {
      version: "canonical-fact-inventory-v1" as const,
      facts: [{
        version: "canonical-fact-v1",
        id: fingerprintCanonicalArtifact({ tag }),
        profile: "state",
        factType: tag,
        subject: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
        subjectRole: "subject",
        lane: "neutral",
        strength: "exact",
        sourceBranches: ["fast"],
        directness: "direct",
        timing: "current",
        payload: null
      }]
    },
    finalFrontier: [],
    closureCertificate: {
      version: "traversal-closure-certificate-v1" as const,
      schemaVersion: 1 as const,
      analysisManifestHash: "1".repeat(64),
      snapshotHash: "2".repeat(64),
      visitedStateHash: "3".repeat(64),
      frontierHash: "4".repeat(64),
      closed: true as const
    },
    score: 0,
    decision: "ACCEPTABLE" as const,
    evidenceBundleSha256: "5".repeat(64),
    traversalClosureSha256: "6".repeat(64),
    scoringBundleSha256: "7".repeat(64),
    reportSha256: "8".repeat(64),
    eligibleDeliveryIntentCount: 1,
    externalTelegramSends: 0,
    providerResponseArtifactSha256s: ["9".repeat(64)],
    committedSequenceCount: 1,
    duplicateCommitCount: 0,
    duplicateSequenceCount: 0
  };
}

function replayOracleRuntime(
  factTag = "postgres-lifecycle-fact-1",
  generatedAt = "2026-07-24T12:00:00.000Z"
) {
  return {
    resolveReplayOracleReceipt: vi.fn(async (input: {
      readonly replaySha256: string;
      readonly seed: number;
    }) => {
      const facts = oracleFacts(factTag);
      return sealUnifiedRollingOracleReceiptV1({
        generatedAt,
        producerVersion: "unified-postgres-lifecycle-oracle-v1",
        schemaVersion: 34,
        replaySha256: input.replaySha256,
        seed: input.seed,
        barrierFacts: facts,
        rollingFacts: [1, 4, 8, 16, 32, 100].map((capacity) => ({
          capacity,
          seed: input.seed + capacity,
          facts
        }))
      }).envelope;
    })
  };
}

describe("runUnifiedAdaptiveBenchmark CLI", () => {
  it("counts zero-duration live attempts at the same timestamp", () => {
    expect(calculateUnifiedBenchmarkPeakConcurrency([{
      startedAt: "2026-07-25T09:00:00.000Z",
      completedAt: "2026-07-25T09:00:00.000Z"
    }])).toBe(1);
    expect(calculateUnifiedBenchmarkPeakConcurrency([
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:00.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:00.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:00.000Z"
      }
    ])).toBe(3);
  });

  it("uses half-open boundaries while counting zero-duration attempts within overlaps", () => {
    expect(calculateUnifiedBenchmarkPeakConcurrency([
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:10.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:05.000Z",
        completedAt: "2026-07-25T09:00:15.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:07.000Z",
        completedAt: "2026-07-25T09:00:07.000Z"
      }
    ])).toBe(3);
    expect(calculateUnifiedBenchmarkPeakConcurrency([
      {
        startedAt: "2026-07-25T09:00:00.000Z",
        completedAt: "2026-07-25T09:00:10.000Z"
      },
      {
        startedAt: "2026-07-25T09:00:10.000Z",
        completedAt: "2026-07-25T09:00:20.000Z"
      }
    ])).toBe(1);
  });

  it("exposes a machine-readable restart-required phase for process-boundary resume", () => {
    const error = new UnifiedAdaptiveBenchmarkRestartRequiredError({
      output: "benchmark.json",
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z"
    });

    expect(error.exitCode).toBe(75);
    expect(error.phase).toEqual({
      version: "unified-adaptive-benchmark-phase-v1",
      status: "restart_required",
      output: "benchmark.json",
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z",
      resumeRequired: true
    });
  });

  it("keeps canary callbacks release-noop and lets the outer owner release exactly once", async () => {
    const release = vi.fn(async () => undefined);
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(release);

    await owner.callbackRelease();
    await owner.callbackRelease();
    expect(release).not.toHaveBeenCalled();
    await owner.releaseOnce();
    await owner.releaseOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("strictly binds a kill-boundary capacity state to its control lease identity", () => {
    const leaseIdentity = {
      version: "unified-adaptive-control-lease-identity-v1",
      controlSha256: "a".repeat(64),
      leaseOwner: "lease-owner",
      createdByRunId: "primary-run"
    };
    const withoutHash = {
      version: "unified-adaptive-live-capacity-state-v1",
      candidateCommit: "b".repeat(40),
      executionIdentitySha256: "c".repeat(64),
      capacity: 1,
      primaryBatchIdentitySha256: "d".repeat(64),
      primaryControlSha256: leaseIdentity.controlSha256,
      primaryControlLeaseOwner: leaseIdentity.leaseOwner,
      primaryControlCreatedByRunId: leaseIdentity.createdByRunId,
      primaryControlLeaseIdentitySha256:
        fingerprintCanonicalArtifact(leaseIdentity),
      primaryRunIds: ["primary-run"],
      lateBatchIdentitySha256: "e".repeat(64),
      lateControlSha256: leaseIdentity.controlSha256,
      lateRunId: "late-run"
    };
    const state = {
      ...withoutHash,
      stateSha256: fingerprintCanonicalArtifact(withoutHash)
    };
    expect(parseUnifiedAdaptiveLiveCapacityStateV1(
      canonicalizeArtifactJson(state),
      {
        candidateCommit: withoutHash.candidateCommit,
        executionIdentitySha256:
          withoutHash.executionIdentitySha256,
        capacity: 1
      }
    )).toEqual(state);

    const { primaryControlLeaseOwner: _missing, ...missingLease } =
      state;
    expect(() => parseUnifiedAdaptiveLiveCapacityStateV1(
      canonicalizeArtifactJson(missingLease),
      {
        candidateCommit: withoutHash.candidateCommit,
        executionIdentitySha256:
          withoutHash.executionIdentitySha256,
        capacity: 1
      }
    )).toThrow("unified_benchmark_existing_artifact_mismatch");
    expect(() => parseUnifiedAdaptiveLiveCapacityStateV1(
      canonicalizeArtifactJson({
        ...state,
        primaryControlLeaseOwner: "forged-owner"
      }),
      {
        candidateCommit: withoutHash.candidateCommit,
        executionIdentitySha256:
          withoutHash.executionIdentitySha256,
        capacity: 1
      }
    )).toThrow("unified_benchmark_existing_artifact_mismatch");
  });

  it.each(["success", "error"])(
    "recovers and releases a kill-boundary capacity lease exactly once on %s",
    async (outcome) => {
      const leaseIdentity = {
        version: "unified-adaptive-control-lease-identity-v1",
        controlSha256: "a".repeat(64),
        leaseOwner: "lease-owner",
        createdByRunId: "primary-run"
      };
      const withoutHash = {
        version: "unified-adaptive-live-capacity-state-v1" as const,
        candidateCommit: "b".repeat(40),
        executionIdentitySha256: "c".repeat(64),
        capacity: 1,
        primaryBatchIdentitySha256: "d".repeat(64),
        primaryControlSha256: leaseIdentity.controlSha256,
        primaryControlLeaseOwner: leaseIdentity.leaseOwner,
        primaryControlCreatedByRunId: leaseIdentity.createdByRunId,
        primaryControlLeaseIdentitySha256:
          fingerprintCanonicalArtifact(leaseIdentity),
        primaryRunIds: ["primary-run"],
        lateBatchIdentitySha256: "e".repeat(64),
        lateControlSha256: leaseIdentity.controlSha256,
        lateRunId: "late-run"
      };
      const state = {
        ...withoutHash,
        stateSha256: fingerprintCanonicalArtifact(withoutHash)
      };
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ sha256: leaseIdentity.controlSha256 }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            sha256: leaseIdentity.controlSha256,
            released: false
          }]
        })
        .mockResolvedValueOnce({ rows: [] });
      const db = {
        query,
        transaction: async <T>(
          work: (tx: { query: typeof query }) => Promise<T>
        ) => work({ query })
      };
      const owner = createUnifiedBenchmarkReleaseOwner();
      const renewal = {
        set: vi.fn(),
        stop: vi.fn(async () => undefined)
      };
      await recoverUnifiedBenchmarkCapacityStateControl({
        db,
        state,
        now: new Date("2026-07-25T09:00:00.000Z"),
        releaseOwner: owner,
        renewalLoop: renewal
      });
      const scoped = runUnifiedBenchmarkControlScope({
        releaseOwner: owner,
        renewalLoop: renewal,
        restartIdentity: () => null,
        work: async () => {
          if (outcome === "error") throw new Error("canary_failed");
          return "completed";
        }
      });
      if (outcome === "error") {
        await expect(scoped).rejects.toThrow("canary_failed");
      } else {
        await expect(scoped).resolves.toBe("completed");
      }
      expect(renewal.stop).toHaveBeenCalledOnce();
      expect(query.mock.calls.filter((call) =>
        String(call[0]).includes(
          "'adaptive_benchmark_control_release','1'"
        )
      )).toHaveLength(1);
    }
  );

  it.each(["primary", "late"])(
    "releases the shared control once when the %s canary fails",
    async (phase) => {
      const release = vi.fn(async () => undefined);
      const stop = vi.fn(async () => undefined);
      const owner = createUnifiedBenchmarkReleaseOwner();
      owner.set(release);

      await expect(runUnifiedBenchmarkControlScope({
        releaseOwner: owner,
        renewalLoop: { stop },
        restartIdentity: () => null,
        work: async () => {
          throw new Error(`${phase}_canary_failed`);
        }
      })).rejects.toThrow(`${phase}_canary_failed`);

      expect(stop).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledOnce();
    }
  );

  it("releases on a generic restart-like error", async () => {
    const release = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(release);

    await expect(runUnifiedBenchmarkControlScope({
      releaseOwner: owner,
      renewalLoop: { stop },
      restartIdentity: () => ({
        output: "benchmark.json",
        benchmarkControlSha256: "a".repeat(64),
        executionIdentitySha256: "c".repeat(64),
        stateIdentitySha256: "d".repeat(64),
        scenarioId: "live:c1:restart_recovery",
        runIds: ["restart-run"],
        handoffArtifactSha256: "b".repeat(64),
        resumeDeadline: "2026-07-25T09:10:00.000Z"
      }),
      work: async () => {
        throw new Error("restart_required");
      }
    })).rejects.toThrow("restart_required");

    expect(stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves only a scope-authenticated exact restart handoff identity", async () => {
    const identity = {
      output: "benchmark.json",
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z"
    };
    const runPublicError = async (error: Error) => {
      const release = vi.fn(async () => undefined);
      const stop = vi.fn(async () => undefined);
      const owner = createUnifiedBenchmarkReleaseOwner();
      owner.set(release);
      await expect(runUnifiedBenchmarkControlScope({
        releaseOwner: owner,
        renewalLoop: { stop },
        restartIdentity: () => identity,
        work: async () => {
          throw error;
        }
      })).rejects.toBe(error);
      return { release, stop };
    };
    const publiclyConstructed =
      new UnifiedAdaptiveBenchmarkRestartRequiredError(identity);
    const publicResult = await runPublicError(publiclyConstructed);
    expect(publicResult.stop).toHaveBeenCalledOnce();
    expect(publicResult.release).toHaveBeenCalledOnce();

    const forgedIdentity =
      new UnifiedAdaptiveBenchmarkRestartRequiredError({
        ...identity,
        executionIdentitySha256: "e".repeat(64)
      });
    const forged = await runPublicError(forgedIdentity);
    expect(forged.stop).toHaveBeenCalledOnce();
    expect(forged.release).toHaveBeenCalledOnce();

    const release = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(release);
    await expect(runUnifiedBenchmarkControlScope({
      releaseOwner: owner,
      renewalLoop: { stop },
      restartIdentity: () => identity,
      work: async ({ restartRequired }) => {
        restartRequired(identity);
      }
    })).rejects.toMatchObject({
      exitCode: 75,
      phase: identity
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it("releases instead of preserving when restart renewal cleanup fails", async () => {
    const identity = {
      output: "benchmark.json",
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z"
    };
    const release = vi.fn(async () => undefined);
    const stopError = new Error("renewal_stop_failed");
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(release);
    const failure = runUnifiedBenchmarkControlScope({
      releaseOwner: owner,
      renewalLoop: {
        stop: vi.fn(async () => {
          throw stopError;
        })
      },
      restartIdentity: () => identity,
      work: async ({ restartRequired }) => {
        restartRequired(identity);
      }
    });
    await expect(failure).rejects.toBe(stopError);
    await expect(failure).rejects.not.toBeInstanceOf(
      UnifiedAdaptiveBenchmarkRestartRequiredError
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("surfaces both renewal-stop and fenced-release failures", async () => {
    const identity = {
      output: "benchmark.json",
      benchmarkControlSha256: "a".repeat(64),
      executionIdentitySha256: "c".repeat(64),
      stateIdentitySha256: "d".repeat(64),
      scenarioId: "live:c1:restart_recovery",
      runIds: ["restart-run"],
      handoffArtifactSha256: "b".repeat(64),
      resumeDeadline: "2026-07-25T09:10:00.000Z"
    };
    const owner = createUnifiedBenchmarkReleaseOwner();
    owner.set(async () => {
      throw new Error("release_failed");
    });
    await expect(runUnifiedBenchmarkControlScope({
      releaseOwner: owner,
      renewalLoop: {
        stop: async () => {
          throw new Error("renewal_stop_failed");
        }
      },
      restartIdentity: () => identity,
      work: async ({ restartRequired }) => {
        restartRequired(identity);
      }
    })).rejects.toMatchObject({
      name: "AggregateError",
      message: "unified_benchmark_control_cleanup_failed",
      errors: [
        expect.objectContaining({ message: "renewal_stop_failed" }),
        expect.objectContaining({ message: "release_failed" })
      ]
    });
  });

  it("opens lifecycle seams only after a bounded checkpoint and before terminal state", () => {
    const checkpointed = {
      status: "RUNNING",
      tasks: [{ attemptDurations: [{ outcome: "CHECKPOINTED" }] }]
    };
    expect(isNonterminalCheckpointedBenchmarkRun(checkpointed)).toBe(true);
    expect(isNonterminalCheckpointedBenchmarkRun({
      ...checkpointed,
      status: "COMPLETED"
    })).toBe(false);
    expect(isNonterminalCheckpointedBenchmarkRun({
      status: "RUNNING",
      tasks: [{ attemptDurations: [{ outcome: "COMPLETED" }] }]
    })).toBe(false);
  });

  it("consumes a canonical immutable PostgreSQL lifecycle receipt on the production replay path", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-receipt-"));
    const fixtureBytes = await readFile(
      "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json",
      "utf8"
    );
    const replay = parseUnifiedProviderReplayV1(
      fixtureBytes.endsWith("\n")
        ? fixtureBytes.slice(0, -1)
        : fixtureBytes
    );
    const facts = oracleFacts();
    const receipt = sealUnifiedRollingOracleReceiptV1({
      generatedAt: replay.frozenClockIso,
      producerVersion: "unified-postgres-lifecycle-oracle-v1",
      schemaVersion: 34,
      replaySha256: replay.expectedReplaySha256,
      seed: 24072026,
      barrierFacts: facts,
      rollingFacts: [1, 4, 8, 16, 32, 100].map((capacity) => ({
        capacity,
        seed: 24072026 + capacity,
        facts
      }))
    });
    const receiptPath = join(root, "rolling-oracle-receipt.json");
    await writeFile(receiptPath, `${receipt.canonicalJson}\n`, "utf8");

    const index = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--oracle-receipt", receiptPath,
      "--output", join(root, "replay-index.json")
    ]);

    expect(index.artifacts).toHaveLength(9);
  });

  it("runs the real offline replay matrix, writes each immutable scenario first, and resumes exact artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-replay-"));
    const output = join(root, "replay-index.json");
    const fetch = vi.fn(async () => {
      throw new Error("network must not be called");
    });
    vi.stubGlobal("fetch", fetch);
    const runtime = replayOracleRuntime();

    const first = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], runtime);
    expect(first.mode).toBe("replay");
    expect(first.artifacts.every((item) =>
      item.relativePath.startsWith("replay-index.scenarios/")
    )).toBe(true);
    expect(first.artifacts.map((item) => item.scenarioId)).toEqual([
      "replay:c1:one_dense_wallet",
      "replay:c1:three_dense_wallets",
      "replay:c1:fifteen_dense_wallets",
      "replay:c1:late_interactive",
      "replay:c1:slow_canonical_head",
      "replay:c1:provider_cooldown",
      "replay:c1:restart_recovery",
      "replay:c1:full_merge_buffer",
      "replay:c1:repair_arrival_capacity_one"
    ]);
    expect(fetch).not.toHaveBeenCalled();

    const scenarioDirectory = join(root, "replay-index.scenarios");
    const scenarioFiles = (await readdir(scenarioDirectory)).sort();
    expect(scenarioFiles).toHaveLength(first.artifacts.length);
    const before = new Map(await Promise.all(scenarioFiles.map(async (file) => [
      file,
      (await stat(join(scenarioDirectory, file))).mtimeMs
    ] as const)));
    for (const file of scenarioFiles) {
      const raw = await readFile(join(scenarioDirectory, file), "utf8");
      const evidence = parseUnifiedAdaptiveBenchmarkEvidenceV1(
        raw.endsWith("\n") ? raw.slice(0, -1) : raw
      );
      expect(evidence.oracle?.exactEquivalent).toBe(true);
      expect(evidence.delivery.externalTelegramSends).toBe(0);
    }

    const resumed = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], runtime);
    expect(resumed).toEqual(first);
    expect(runtime.resolveReplayOracleReceipt).toHaveBeenCalledTimes(2);
    for (const file of scenarioFiles) {
      expect((await stat(join(scenarioDirectory, file))).mtimeMs)
        .toBe(before.get(file));
    }
  });

  it("fails rather than adopting a mismatched existing scenario artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-mismatch-"));
    const output = join(root, "replay-index.json");
    const runtime = replayOracleRuntime();
    const first = await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], runtime);
    const artifactPath = join(
      root,
      first.artifacts[0]!.relativePath
    );
    const parsed = JSON.parse(await readFile(artifactPath, "utf8"));
    parsed.scenarioId = "tampered";
    await writeFile(artifactPath, JSON.stringify(parsed), "utf8");

    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], runtime)).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );
  });

  it("refuses to resume artifacts bound to a different oracle receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-oracle-"));
    const output = join(root, "replay-index.json");
    await runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], replayOracleRuntime(
      "same-oracle",
      "2026-07-24T12:00:00.000Z"
    ));

    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", output
    ], replayOracleRuntime(
      "same-oracle",
      "2026-07-24T12:00:01.000Z"
    ))).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );
  });

  it("rejects unsafe output and invokes only the audited isolated-canary live seam", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-live-"));
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", join(root, ".codex-live", "forbidden.json")
    ], replayOracleRuntime())).rejects.toThrow(
      "unified_benchmark_output_forbidden"
    );

    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", join(root, "missing-receipt.json")
    ])).rejects.toThrow("unified_benchmark_replay_oracle_receipt_required");

    const output = join(root, "live-index.json");
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "4",
      "--isolated",
      "--output", output
    ])).rejects.toThrow("unified_benchmark_live_group_audit_required");

    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: Array.from({ length: 4 }, (_, index) => ({
        opaqueGroupId: `provider-group-${index + 1}`,
        state: "healthy" as const,
        concurrencyLimit: 1,
        independenceEvidenceSha256: String(index + 1).repeat(64)
      }))
    });
    const auditPath = join(root, "provider-audit.json");
    await writeFile(auditPath, audit.canonicalJson, "utf8");
    const runIsolatedCanaryBenchmark = vi.fn(async () => {
      throw new Error("isolated_canary_runtime_invoked");
    });
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "4",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], { runIsolatedCanaryBenchmark })).rejects.toThrow(
      "isolated_canary_runtime_invoked"
    );
    expect(runIsolatedCanaryBenchmark).toHaveBeenCalledOnce();
  });

  it("rejects an output whose existing parent is a symlink or junction", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-link-"));
    const physical = join(root, "physical");
    const redirected = join(root, "redirected");
    await mkdir(physical);
    await symlink(
      physical,
      redirected,
      process.platform === "win32" ? "junction" : "dir"
    );

    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "replay",
      "--capacity", "1",
      "--seed", "24072026",
      "--output", join(redirected, "benchmark.json")
    ], replayOracleRuntime())).rejects.toThrow(
      "unified_benchmark_output_symlink_forbidden"
    );
  });

  it("resumes a hash-bound live index without rerunning the canary and rejects corrupted exported observations", async () => {
    const root = await mkdtemp(join(tmpdir(), "unified-adaptive-live-resume-"));
    const output = join(root, "live-index.json");
    const scenarioDirectory = join(root, "live-index.scenarios");
    await mkdir(scenarioDirectory);
    const audit = sealUnifiedProviderGroupAuditV1({
      auditedAt: "2026-07-24T12:00:00.000Z",
      groups: [{
        opaqueGroupId: "provider-group-1",
        state: "healthy",
        concurrencyLimit: 1,
        independenceEvidenceSha256: "1".repeat(64)
      }]
    });
    const auditPath = join(root, "provider-audit.json");
    await writeFile(auditPath, audit.canonicalJson, "utf8");
    const candidateCommit = "a".repeat(40);
    const executionIdentitySha256 = fingerprintCanonicalArtifact({
      version: "unified-adaptive-benchmark-execution-identity-v1",
      mode: "live",
      seed: 1,
      requestedCapacities: [1],
      candidateCommit,
      sourceIdentitySha256: audit.envelope.auditSha256
    });
    const artifacts = [];
    let firstObservationPath = "";
    for (
      const [index, kind] of UNIFIED_ADAPTIVE_LIVE_SCENARIOS.entries()
    ) {
      const scenarioId = `live:c1:${kind}`;
      const runId = `run-${index + 1}`;
      const controlSha256 = "b".repeat(64);
      const observation = {
        version: "unified-adaptive-benchmark-runtime-observation-v1",
        controlSha256,
        observedAt: "2026-07-24T12:00:30.000Z",
        runtime: {
          rssHeapScope: "process",
          availableMemoryScope: "container_or_host",
          instanceId: "runtime-live-resume",
          processStartedAt: "2026-07-24T12:00:00.000Z",
          processId: 123,
          rssBytes: 1,
          heapUsedBytes: 1,
          availableContainerBytes: 1,
          availableHostBytes: 1
        },
        provider: {
          requests: 1,
          completed: 1,
          errors: 0,
          rateLimited429: 0,
          requestsPerSecond: 1,
          dispatchedGroupIds: ["provider-group-1"]
        },
        reuse: {
          providerCacheHits: 0,
          networkFetches: 1,
          addressManifestReuses: 0,
          addressHistoryReplaysAvoided: 0
        },
        integrity: {
          duplicateCommits: 0,
          duplicateSequences: 0,
          deliveryIntents: 0
        },
        database: {
          scope: "benchmark_runtime_connection_pool",
          latencyMs: 1,
          checkpointLatencyMs: 1,
          poolWaitMs: 0
        },
        lifecycle: kind === "restart_recovery"
          ? {
              restartRunId: runId,
              checkpointObservationSha256: "d".repeat(64),
              restartCount: 1,
              recoveryMs: 1,
              reconciliationRecoveries: 1
            }
          : {
              restartRunId: null,
              checkpointObservationSha256: null,
              restartCount: 0,
              recoveryMs: 0,
              reconciliationRecoveries: 0
            },
        runs: [{
          runId,
          scenarioId: kind,
          planner: {
            durableBacklog: 0,
            admitted: 0,
            leased: 0,
            ready: 0,
            committed: 1
          },
          buffer: {
            readyCount: 0,
            readyBytes: 0,
            reservedBytes: 0
          },
          canonicalHeadAgeMs: 1,
          capacity: {
            eligibleDemand: 1,
            targetSlots: 1,
            actualSlots: 1
          },
          limitingReason: null
        }]
      };
      const observationSha256 =
        fingerprintCanonicalArtifact(observation);
      const phase = kind === "provider_cooldown"
        ? "audited_group_cooldown_observed"
        : kind === "slow_canonical_head"
          ? "canonical_head_delay_observed"
          : kind === "full_merge_buffer"
            ? "merge_buffer_full_observed"
            : kind === "late_interactive"
              ? "late_after_peer_checkpoint"
              : kind === "restart_recovery"
                ? "external_runtime_restart_attested"
                : "run_completed";
      const symptom = {
        version: "unified-adaptive-benchmark-scenario-symptom-v1",
        controlSha256,
        runId,
        scenarioId: kind,
        phase,
        observedAt: "2026-07-24T12:00:31.000Z",
        observationArtifactSha256: observationSha256,
        runtimeInstanceId: "runtime-live-resume",
        runtimeProcessStartedAt: "2026-07-24T12:00:00.000Z",
        runtimeProcessId: 123,
        ...(kind === "provider_cooldown" ? {
          providerCooldown: {
            groupId: "provider-group-1",
            startsAt: "2026-07-24T12:00:01.000Z",
            endsAt: "2026-07-24T12:00:02.000Z",
            fallbackDispatches: 1,
            resumedDispatches: 1,
            activeObserved: true,
            synthetic: true,
            provider429Observed: false
          }
        } : {}),
        ...(kind === "slow_canonical_head" ? {
          slowHeadAcceptance: {
            taskId: "slow-head-task",
            canonicalSequence: 0,
            attemptId: "slow-head-accepted-attempt",
            artifactSha256: "f".repeat(64),
            completedAt: "2026-07-24T12:00:30.000Z"
          }
        } : {}),
        ...(kind === "restart_recovery" ? {
          restartHandoff: {
            requestedAt: "2026-07-24T12:00:20.000Z",
            previousRuntimeInstanceId: "runtime-before-restart",
            previousRuntimeProcessStartedAt:
              "2026-07-24T11:59:00.000Z",
            previousRuntimeProcessId: 122,
            checkpointObservationSha256: "d".repeat(64),
            reconciliationArtifactSha256: "e".repeat(64)
          }
        } : {})
      };
      const symptomSha256 = fingerprintCanonicalArtifact(symptom);
      const observationPath = join(
        scenarioDirectory,
        `observation-${observationSha256}.json`
      );
      if (firstObservationPath === "") firstObservationPath = observationPath;
      await writeFile(
        observationPath,
        `${canonicalizeArtifactJson(observation)}\n`,
        "utf8"
      );
      await writeFile(
        join(scenarioDirectory, `symptom-${symptomSha256}.json`),
        `${canonicalizeArtifactJson(symptom)}\n`,
        "utf8"
      );
      const performanceManifest =
        buildUnifiedPerformanceBenchmarkManifest({
          version: "unified-performance-benchmark-input-v1",
          caseId: scenarioId,
          runId: scenarioId,
          frozenClockIso: "2026-07-24T12:00:00.000Z",
          snapshot: {
            blockNumber: "1",
            blockHash: "2".repeat(64),
            timestamp: "2026-07-24T12:00:00.000Z"
          },
          providerBundleSha256: "3".repeat(64),
          labelDatasetSha256: "4".repeat(64),
          providerConfigurationSha256: "5".repeat(64),
          scoringPolicyVersion: "scoring-signal-matrix-v4",
          attributionPolicyVersion: "selected-attribution-policy-v1",
          analysisPolicyVersion: "snapshot-closure-v1",
          presentationPolicyVersion: "unified-presentation-v1",
          locale: "ru",
          deterministicIdSeed: scenarioId,
          runtimeCommit: "a".repeat(40),
          checkpointVersion: "unified-production-traversal-checkpoint-v2",
          logicalChunkEvents: 1,
          providerSlots: 1,
          harnessVersion: "unified-adaptive-live-canary-v1"
        });
      const evidence = sealUnifiedAdaptiveBenchmarkEvidenceV1({
        scenarioId,
        scenarioKind: kind,
        completedAt: "2026-07-24T12:01:00.000Z",
        mode: "live",
        admissionPolicy: "rolling",
        sideEffectPolicy: "isolated",
        requestedCapacity: 1,
        actualAuditedIndependentGroupCapacity: 1,
        independentGroupAudit: audit.envelope,
        performanceManifest,
        timing: {
          wallTimeMs: 1,
          aggregateThroughputPerSecond: 1
        },
        capacity: {
          eligibleDemand: 1,
          targetSlots: 1,
          actualSlots: 1,
          utilization: 1
        },
        provider: {
          rollingRps: 1,
          requests: 1,
          errors: 0,
          rateLimited429: 0
        },
        limiting: {
          reason: null,
          canonicalHeadAgeMs: null
        },
        buffer: { readyBytes: 0, reservedBytes: 0 },
        database: {
          latencyMs: 1,
          checkpointLatencyMs: 1,
          poolWaitMs: 0
        },
        memory: {
          rssBytes: 1,
          heapUsedBytes: 1,
          availableContainerBytes: 1,
          availableHostBytes: 1
        },
        repair: { maxWaitMs: 0, maxWaitChunks: 0 },
        reuse: {
          providerCacheHits: 0,
          networkFetches: 1,
          addressManifestReuses: 0,
          addressHistoryReplaysAvoided: 0
        },
        restartRecovery: {
          restartCount: kind === "restart_recovery" ? 1 : 0,
          recoveryMs: kind === "restart_recovery" ? 1 : 0,
          reconciliationRecoveries: kind === "restart_recovery" ? 1 : 0,
          duplicateCommits: 0,
          duplicateSequences: 0
        },
        oracle: null,
        runtimeObservationArtifactSha256s: [observationSha256],
        scenarioSymptomArtifactSha256s: [symptomSha256],
        liveOutcomes: [{
          runId: `run-${index + 1}`,
          subjectAddress: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
          score: 0,
          decision: "ACCEPTABLE",
          evidenceBundleSha256: "6".repeat(64),
          traversalClosureSha256: "7".repeat(64),
          scoringBundleSha256: "8".repeat(64),
          reportSha256: "9".repeat(64),
          benchmarkControlSha256: "b".repeat(64),
          auditedGroupIds: ["provider-group-1"],
          dispatchedGroupIds: ["provider-group-1"]
        }],
        measurement: {
          timing: "observed",
          provider: "observed",
          database: "observed",
          memory: "observed",
          lifecycle: "observed",
          delivery: "observed"
        },
        delivery: {
          eligibleRequests: 1,
          deliveryIntents: 0,
          externalTelegramSends: 0
        }
      }).envelope;
      const relativePath =
        `${basename(scenarioDirectory)}/${String(index + 1).padStart(3, "0")}.json`;
      await writeFile(
        join(root, relativePath),
        `${canonicalizeArtifactJson(evidence)}\n`,
        "utf8"
      );
      artifacts.push({
        scenarioId,
        relativePath,
        evidenceSha256: evidence.evidenceSha256,
        candidateCommit,
        executionIdentitySha256:
          evidence.performanceManifest.executionIdentitySha256
      });
    }
    const withoutHash = {
      version: "unified-adaptive-benchmark-index-v1" as const,
      mode: "live" as const,
      seed: 1,
      requestedCapacities: [1],
      candidateCommit,
      executionIdentitySha256,
      generatedAt: "2026-07-24T12:01:00.000Z",
      artifacts
    };
    const index = {
      ...withoutHash,
      indexSha256: fingerprintCanonicalArtifact(withoutHash)
    };
    await writeFile(
      output,
      `${canonicalizeArtifactJson(index)}\n`,
      "utf8"
    );
    await expect(loadAdaptiveBenchmarkIndexForFinalizer(
      root,
      basename(output),
      {
        mode: "live",
        candidateSha: candidateCommit
      }
    )).resolves.toMatchObject({
      index: {
        mode: "live",
        candidateCommit,
        executionIdentitySha256
      },
      evidence: artifacts.map((artifact) => ({
        scenarioId: artifact.scenarioId,
        performanceManifest: {
          executionIdentitySha256:
            artifact.executionIdentitySha256
        }
      }))
    });
    const conflatedIdentityWithoutHash = {
      ...withoutHash,
      executionIdentitySha256:
        artifacts[0]!.executionIdentitySha256
    };
    await writeFile(
      output,
      `${canonicalizeArtifactJson({
        ...conflatedIdentityWithoutHash,
        indexSha256: fingerprintCanonicalArtifact(
          conflatedIdentityWithoutHash
        )
      })}\n`,
      "utf8"
    );
    await expect(loadAdaptiveBenchmarkIndexForFinalizer(
      root,
      basename(output),
      {
        mode: "live",
        candidateSha: candidateCommit
      }
    )).rejects.toThrow(
      "unified_adaptive_index_artifact_invalid"
    );
    await writeFile(
      output,
      `${canonicalizeArtifactJson(index)}\n`,
      "utf8"
    );
    const runIsolatedCanaryBenchmark = vi.fn(async () => {
      throw new Error("live canary must not rerun");
    });
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "1",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], {
      runtimeCommit: candidateCommit,
      runIsolatedCanaryBenchmark
    })).resolves.toEqual(index);
    expect(runIsolatedCanaryBenchmark).not.toHaveBeenCalled();

    const foreignCandidateWithoutHash = {
      ...withoutHash,
      candidateCommit: "f".repeat(40),
      artifacts: artifacts.map((artifact) => ({
        ...artifact,
        candidateCommit: "f".repeat(40)
      }))
    };
    await writeFile(
      output,
      `${canonicalizeArtifactJson({
        ...foreignCandidateWithoutHash,
        indexSha256:
          fingerprintCanonicalArtifact(foreignCandidateWithoutHash)
      })}\n`,
      "utf8"
    );
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "1",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], {
      runtimeCommit: candidateCommit,
      runIsolatedCanaryBenchmark
    })).rejects.toThrow("unified_benchmark_existing_artifact_mismatch");
    await writeFile(
      output,
      `${canonicalizeArtifactJson(index)}\n`,
      "utf8"
    );

    await writeFile(firstObservationPath, "{}\n", "utf8");
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "1",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], {
      runtimeCommit: candidateCommit,
      runIsolatedCanaryBenchmark
    })).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );

    await unlink(firstObservationPath);
    await expect(runUnifiedAdaptiveBenchmarkCli([
      "--mode", "live",
      "--capacity", "1",
      "--isolated",
      "--provider-audit", auditPath,
      "--output", output
    ], {
      runtimeCommit: candidateCommit,
      runIsolatedCanaryBenchmark
    })).rejects.toThrow(
      "unified_benchmark_existing_artifact_mismatch"
    );
  });

  it("registers the package benchmark command", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(packageJson.scripts["benchmark:unified-adaptive"])
      .toBe("tsx scripts/runUnifiedAdaptiveBenchmark.ts");
  });
});
