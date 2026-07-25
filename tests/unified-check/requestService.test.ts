import { describe, expect, it } from "vitest";
import {
  buildFrozenLabelDataset,
  type FrozenLabelDatasetV1
} from "../../src/unifiedCheck/frozenLabels";
import type { SnapshotSource } from "../../src/unifiedCheck/snapshot";
import {
  intakeUnifiedCheck,
  unifiedFairnessOwnerId,
  type AnalysisRunRecord,
  type CheckRequestRecord,
  type UnifiedInitialTask,
  type UnifiedRequestStore
} from "../../src/unifiedCheck/requestService";

const ADDRESS = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const versions = {
  labelDatasetSha256: "c".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "selected-attribution-policy-v1",
  runtimeCommit: "candidate-commit",
  schemaVersion: 34
} as const;

class MemoryStore implements UnifiedRequestStore {
  readonly requests = new Map<string, CheckRequestRecord>();
  readonly runs = new Map<string, AnalysisRunRecord>();
  readonly initialTasksByRun =
    new Map<string, readonly UnifiedInitialTask[]>();
  readonly labelDatasets = new Map<string, unknown>();

  async createOrGetAcceptedRequest(input: CheckRequestRecord): Promise<CheckRequestRecord> {
    const existing = [...this.requests.values()]
      .find((item) => item.requestCorrelationId === input.requestCorrelationId);
    if (existing) return existing;
    this.requests.set(input.id, input);
    return input;
  }

  async attachedRun(request: CheckRequestRecord): Promise<AnalysisRunRecord | null> {
    return request.runId ? this.runs.get(request.runId) ?? null : null;
  }

  async attach(input: {
    requestId: string;
    candidateRun: AnalysisRunRecord;
    reuseAllowed: boolean;
    labelDataset?: {
      readonly sha256: string;
      readonly dataset: FrozenLabelDatasetV1;
    };
    initialTasks?: readonly UnifiedInitialTask[];
  }): Promise<{ request: CheckRequestRecord; run: AnalysisRunRecord; reused: boolean }> {
    const request = this.requests.get(input.requestId)!;
    if (input.labelDataset) {
      this.labelDatasets.set(
        input.labelDataset.sha256,
        input.labelDataset.dataset
      );
    }
    const reused = input.reuseAllowed
      ? [...this.runs.values()].find((item) => item.analysisKeySha256 === input.candidateRun.analysisKeySha256)
      : undefined;
    const run = reused ?? input.candidateRun;
    this.runs.set(run.id, run);
    if (!reused && input.initialTasks) {
      this.initialTasksByRun.set(run.id, input.initialTasks);
    }
    const attached = { ...request, status: "ATTACHED" as const, runId: run.id };
    this.requests.set(request.id, attached);
    return { request: attached, run, reused: Boolean(reused) };
  }

  async providerWait(requestId: string, readyAt: string): Promise<CheckRequestRecord> {
    const request = this.requests.get(requestId)!;
    const waiting = {
      ...request,
      readyAt,
      attemptCount: request.attemptCount + 1
    };
    this.requests.set(requestId, waiting);
    return waiting;
  }

  async fail(requestId: string, reason: string): Promise<CheckRequestRecord> {
    const request = this.requests.get(requestId)!;
    const failed = { ...request, status: "FAILED_TECHNICAL" as const, statusReason: reason };
    this.requests.set(requestId, failed);
    return failed;
  }
}

function source(
  blockNumber = "84713573",
  blockHash = HASH_A,
  beforeSnapshot?: () => void
): SnapshotSource {
  return {
    latestConfirmedBlock: async () => ({
      number: blockNumber,
      hash: blockHash,
      timestamp: "2026-07-23T12:53:54.000Z"
    }),
    snapshotBalances: async () => {
      beforeSnapshot?.();
      return {
        usdtRaw: "0",
        trxSun: "1000000",
        source: "fake-confirmed-node",
        consistency: "exact"
      };
    }
  };
}

function input(
  store: MemoryStore,
  provider: SnapshotSource,
  requestCorrelationId: string,
  requestId: string,
  runId: string,
  purpose: "user_check" | "release_canary" = "user_check"
) {
  return {
    store,
    snapshotSource: provider,
    request: {
      id: requestId,
      requestCorrelationId,
      subjectAddress: ADDRESS,
      chatId: "1",
      messageThreadId: "",
      locale: "ru" as const,
      runPurpose: purpose,
      sideEffectPolicy: purpose === "release_canary"
        ? "isolated" as const
        : "authoritative" as const
    },
    candidateRunId: runId,
    initialTasks: (["fast", "where", "deep"] as const).map((kind) => ({
      id: `${runId}:${kind}`,
      kind,
      priorityLane: "interactive" as const,
      logicalKey: "main"
    })),
    versions,
    now: () => new Date("2026-07-23T13:00:00.000Z")
  };
}

describe("Unified Check request intake", () => {
  it("freezes rollout policy on run creation while later runs use new authority", async () => {
    const store = new MemoryStore();
    const firstInput = {
      ...input(
        store,
        source("84713573"),
        "rollout-action-1",
        "rollout-request-1",
        "rollout-run-1"
      ),
      rolloutPolicy: {
      stage: "bounded_user_check",
      boundedUserCheckBasisPoints: 10_000,
        providerCapacityCeiling: 4
      } as const
    };
    const first = await intakeUnifiedCheck(firstInput);
    expect(first.kind).toBe("attached");
    if (first.kind !== "attached") return;
    expect(first.run.rolloutPolicy).toMatchObject({
      stage: "bounded_user_check",
      admissionPolicy: "rolling",
      providerCapacityCeiling: 4,
    });

    const duplicateInput = {
      ...input(
        store,
        source("84713573"),
        "rollout-action-1",
        "rollout-request-duplicate",
        "rollout-run-duplicate"
      ),
      rolloutPolicy: {
        stage: "global_barrier",
        boundedUserCheckBasisPoints: 0,
        providerCapacityCeiling: 1
      } as const
    };
    const duplicate = await intakeUnifiedCheck(duplicateInput);
    expect(duplicate.kind).toBe("attached");
    if (duplicate.kind !== "attached") return;
    expect(duplicate.run.rolloutPolicy).toEqual(first.run.rolloutPolicy);

    const nextInput = {
      ...input(
        store,
        source("84713574", HASH_B),
        "rollout-action-2",
        "rollout-request-2",
        "rollout-run-2"
      ),
      rolloutPolicy: {
        stage: "global_barrier",
        boundedUserCheckBasisPoints: 0,
        providerCapacityCeiling: 1
      } as const
    };
    const next = await intakeUnifiedCheck(nextInput);
    expect(next.kind).toBe("attached");
    if (next.kind !== "attached") return;
    expect(next.run.rolloutPolicy).toMatchObject({
      stage: "global_barrier",
      admissionPolicy: "barrier",
      providerCapacityCeiling: 1,
    });
  });

  it("uses stable opaque Telegram owners and run IDs for non-user work", () => {
    const first = unifiedFairnessOwnerId({
      runPurpose: "user_check",
      chatId: "123456",
      runId: "run-1"
    });
    expect(first).toBe(unifiedFairnessOwnerId({
      runPurpose: "user_check",
      chatId: "123456",
      runId: "run-2"
    }));
    expect(first).not.toBe("123456");
    expect(first).not.toBe(unifiedFairnessOwnerId({
      runPurpose: "user_check",
      chatId: "654321",
      runId: "run-3"
    }));
    expect(unifiedFairnessOwnerId({
      runPurpose: "synthetic_test",
      chatId: "123456",
      runId: "run-4"
    })).toBe("run-4");
  });

  it("persists ACCEPTED before snapshot and deduplicates one logical UI action", async () => {
    const store = new MemoryStore();
    const provider = source("84713573", HASH_A, () => {
      expect([...store.requests.values()][0]?.status).toBe("ACCEPTED");
    });
    const first = await intakeUnifiedCheck(input(store, provider, "action-1", "request-1", "run-1"));
    const duplicate = await intakeUnifiedCheck(input(store, provider, "action-1", "request-2", "run-2"));

    expect(first.kind).toBe("attached");
    expect(duplicate.kind).toBe("attached");
    if (first.kind !== "attached" || duplicate.kind !== "attached") return;
    expect(duplicate.request.id).toBe(first.request.id);
    expect(duplicate.run.id).toBe(first.run.id);
    expect(store.requests).toHaveLength(1);
    expect(store.runs).toHaveLength(1);
    expect(store.initialTasksByRun.get(first.run.id)?.map((task) => task.kind))
      .toEqual(["fast", "where", "deep"]);
    expect(first.run.analysisManifest).toMatchObject({
      databaseSchemaVersion: 34,
      labelDatasetSha256: versions.labelDatasetSha256,
      labelCatalogVersion: "unified-label-catalog-v1",
      boundaryPredicateVersion: "unified-boundary-predicates-v1"
    });
  });

  it("creates two requests but reuses an exact shared analysis snapshot", async () => {
    const store = new MemoryStore();
    const first = await intakeUnifiedCheck(input(store, source(), "action-1", "request-1", "run-1"));
    const secondInput = input(store, source(), "action-2", "request-2", "run-2");
    secondInput.request.chatId = "different-chat";
    const second = await intakeUnifiedCheck(secondInput);
    expect(first.kind).toBe("attached");
    expect(second.kind).toBe("attached");
    if (first.kind !== "attached" || second.kind !== "attached") return;
    expect(second.request.id).not.toBe(first.request.id);
    expect(second.run.id).toBe(first.run.id);
    expect(second.run.fairnessOwnerId).toBe(first.run.fairnessOwnerId);
    expect(second.run.fairnessOwnerId).not.toBe(unifiedFairnessOwnerId({
      runPurpose: "user_check",
      chatId: secondInput.request.chatId,
      runId: "run-2"
    }));
    expect(second.reused).toBe(true);
  });

  it("keeps one owner across new runs for a chat and separates different chats", async () => {
    const store = new MemoryStore();
    const first = await intakeUnifiedCheck(
      input(store, source("84713573", HASH_A), "action-1", "request-1", "run-1")
    );
    const second = await intakeUnifiedCheck(
      input(store, source("84713574", HASH_B), "action-2", "request-2", "run-2")
    );
    const thirdInput = input(
      store,
      source("84713575", "d".repeat(64)),
      "action-3",
      "request-3",
      "run-3"
    );
    thirdInput.request.chatId = "different-chat";
    const third = await intakeUnifiedCheck(thirdInput);
    expect(first.kind).toBe("attached");
    expect(second.kind).toBe("attached");
    expect(third.kind).toBe("attached");
    if (first.kind !== "attached" || second.kind !== "attached" || third.kind !== "attached") return;
    expect(second.run.fairnessOwnerId).toBe(first.run.fairnessOwnerId);
    expect(third.run.fairnessOwnerId).not.toBe(first.run.fairnessOwnerId);
  });

  it("freezes and binds a snapshot-specific label dataset before attach", async () => {
    const store = new MemoryStore();
    const request = input(
      store,
      source(),
      "labels-1",
      "request-labels",
      "run-labels"
    );
    Object.assign(request, {
      freezeLabelDataset: async (freezeInput: {
        snapshotHash: string;
        frozenAt: string;
      }) => {
        expect(freezeInput).toMatchObject({
          snapshotHash: expect.any(String),
          frozenAt: "2026-07-23T12:53:54.000Z"
        });
        return buildFrozenLabelDataset({
          frozenAt: freezeInput.frozenAt,
          snapshotHash: freezeInput.snapshotHash,
          labels: [],
          legacyRows: []
        });
      }
    });
    const result = await intakeUnifiedCheck(request);
    expect(result.kind).toBe("attached");
    if (result.kind !== "attached") return;
    expect(result.run.analysisManifest.labelDatasetSha256)
      .not.toBe(versions.labelDatasetSha256);
    expect(store.labelDatasets.has(
      result.run.analysisManifest.labelDatasetSha256
    )).toBe(true);
  });

  it("pins block/hash and leaves the old manifest immutable when a newer block arrives", async () => {
    const store = new MemoryStore();
    const first = await intakeUnifiedCheck(input(store, source(), "action-1", "request-1", "run-1"));
    const firstManifest = first.kind === "attached" ? structuredClone(first.run.analysisManifest) : null;
    const second = await intakeUnifiedCheck(
      input(store, source("84713574", HASH_B), "action-2", "request-2", "run-2")
    );
    expect(first.kind).toBe("attached");
    expect(second.kind).toBe("attached");
    if (first.kind !== "attached" || second.kind !== "attached") return;
    expect(second.run.id).not.toBe(first.run.id);
    expect(second.run.analysisKeySha256).not.toBe(first.run.analysisKeySha256);
    expect(first.run.analysisManifest).toEqual(firstManifest);
  });

  it("forces release canaries into isolated non-reusable runs", async () => {
    const store = new MemoryStore();
    const first = await intakeUnifiedCheck(
      input(store, source(), "canary-1", "request-1", "run-1", "release_canary")
    );
    const second = await intakeUnifiedCheck(
      input(store, source(), "canary-2", "request-2", "run-2", "release_canary")
    );
    expect(first.kind).toBe("attached");
    expect(second.kind).toBe("attached");
    if (first.kind !== "attached" || second.kind !== "attached") return;
    expect(first.run.sideEffectPolicy).toBe("isolated");
    expect(first.run.fairnessOwnerId).toBe("run-1");
    expect(second.run.sideEffectPolicy).toBe("isolated");
    expect(second.run.id).not.toBe(first.run.id);
    expect(second.reused).toBe(false);
  });

  it("rejects correlation reuse with different immutable request identity", async () => {
    const store = new MemoryStore();
    await intakeUnifiedCheck(input(store, source(), "action-1", "request-1", "run-1"));
    const conflict = input(store, source(), "action-1", "request-2", "run-2");
    conflict.request.chatId = "different-chat";
    await expect(intakeUnifiedCheck(conflict))
      .rejects.toThrow("unified_request_correlation_conflict");
    expect(store.requests).toHaveLength(1);
  });

  it("does not call the provider before an accepted request ready_at", async () => {
    const store = new MemoryStore();
    const original = input(store, source(), "action-1", "request-1", "run-1");
    await store.createOrGetAcceptedRequest({
      ...original.request,
      status: "ACCEPTED",
      statusReason: null,
      runId: null,
      readyAt: "2026-07-23T13:05:00.000Z",
      attemptCount: 1,
      acceptedAt: "2026-07-23T13:00:00.000Z"
    });
    let providerCalled = false;
    original.snapshotSource = source("84713573", HASH_A, () => {
      providerCalled = true;
    });
    const result = await intakeUnifiedCheck(original);
    expect(result.kind).toBe("waiting_for_provider");
    expect(providerCalled).toBe(false);
  });
});
