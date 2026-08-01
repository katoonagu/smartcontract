import { describe, expect, it, vi } from "vitest";
import * as shadowRuntimeModule from "../../src/unifiedCheck/serviceRoleShadowRuntime.js";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import {
  buildServiceRoleShadowPrecommitReceiptV1,
  buildServiceRoleShadowInputFenceV1,
  buildServiceRoleShadowInputSetV1,
  createServiceRoleShadowRuntimeV1,
  parseServiceRoleShadowInputFenceV1,
  parseServiceRoleShadowInputSetV1,
  parseServiceRoleShadowPrecommitReceiptV1,
  type ServiceRoleShadowInputFenceV1
} from "../../src/unifiedCheck/serviceRoleShadowRuntime.js";
import {
  deriveServiceRoleShadowAcceptedHistoryBindingV1,
  serviceRoleShadowCompoundBindingKeyV1,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowEventRoleMapV2
} from "../../src/unifiedCheck/serviceRoleShadow.js";
import { traversalStateId, type TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";
import type { ServiceRoleEventEvidenceBundleV1 } from "../../src/unifiedCheck/serviceRoleMapMaterialization.js";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository.js";

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const SNAPSHOT_HASH = "a".repeat(64);
const RUNTIME_COMMIT = "task-4-test-runtime";
const SUBJECT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";

function postgresError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function statementTimeoutError(): Error & { code: string } {
  return postgresError("57014", "canceling statement due to statement timeout");
}

type ArtifactRow = {
  sha256: string;
  created_by_run_id: string;
  kind: string;
  schema_version: string;
  artifact_json: unknown;
};

function artifactRow(
  runId: string,
  kind: string,
  schemaVersion: string,
  artifact: unknown,
  sha256 = fingerprintCanonicalArtifact(artifact)
): ArtifactRow {
  return {
    sha256,
    created_by_run_id: runId,
    kind,
    schema_version: schemaVersion,
    artifact_json: artifact
  };
}

function analysisManifest(runId: string, snapshotHash: string) {
  return {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId,
    requestHash: fingerprintCanonicalArtifact(["request", runId]),
    snapshotHash,
    chain: "tron",
    subjectAddress: SUBJECT,
    confirmedBlockNumber: "100",
    confirmedBlockHash: fingerprintCanonicalArtifact(["block", runId]),
    confirmedBlockTimestamp: "2026-07-30T00:00:00.000Z",
    labelDatasetSha256: fingerprintCanonicalArtifact(["labels", runId]),
    scoringPolicyVersion: "test-score-v1",
    attributionPolicyVersion: "test-attribution-v1",
    traversalPolicyVersion: "snapshot-closure-v1",
    runtimeCommit: "source-runtime",
    databaseSchemaVersion: 37,
    paginationCutoffBlockNumber: "100",
    paginationCutoffBlockHash: fingerprintCanonicalArtifact(["block", runId]),
    branchArtifactHashes: {
      fast: fingerprintCanonicalArtifact(["fast", runId]),
      deep: fingerprintCanonicalArtifact(["deep", runId]),
      where: fingerprintCanonicalArtifact(["where", runId])
    }
  };
}

function roleArtifacts(runId = RUN_ID, seed = "one") {
  const recent = Array.from({ length: 100 }, (_, index) =>
    `event-${index.toString().padStart(3, "0")}`);
  const historical = Array.from({ length: 100 }, (_, index) =>
    `event-${(index + 100).toString().padStart(3, "0")}`);
  const ids = [...recent, ...historical];
  const bundle: ServiceRoleEventEvidenceBundleV1 = {
    schemaVersion: "service-role-event-evidence-bundle-v1",
    policyVersion: "existing-hash-bound-economic-role-v1",
    runId,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: "d".repeat(64),
    entries: ids.map((canonicalEventId, index) => ({
      canonicalEventId,
      transactionInfoEvidenceId: `${seed}-evidence-${index}`,
      transactionInfoPayloadSha256: fingerprintCanonicalArtifact([seed, "payload", index]),
      transactionInfoFinalityWitnessSha256: fingerprintCanonicalArtifact([seed, "finality", index]),
      poisoningDispositionSha256: fingerprintCanonicalArtifact([seed, "poisoning", index]),
      providerRiskDispositionSha256: fingerprintCanonicalArtifact([seed, "risk", index]),
      role: "ordinary" as const
    }))
  };
  const bundleSha256 = fingerprintCanonicalArtifact(bundle);
  const sourceMap: ServiceRoleShadowEventRoleMapV1 = {
    schemaVersion: "service-role-shadow-event-role-map-v1",
    runId,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: "d".repeat(64),
    entries: ids.map((canonicalEventId) => ({
      canonicalEventId,
      role: "ordinary" as const,
      authority: "existing_hash_bound_economic_role_v1" as const,
      evidenceSha256: bundleSha256
    }))
  };
  const sourceMapSha256 = fingerprintCanonicalArtifact(sourceMap);
  const sampledCanonicalEventIds = { recent, historical };
  const wrapper: ServiceRoleShadowEventRoleMapV2 = {
    schemaVersion: "service-role-shadow-event-role-map-v2",
    policyVersion: "service-role-shadow-100-plus-100-v1",
    runId,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: "d".repeat(64),
    sourceEventRoleMapV1Sha256: sourceMapSha256,
    evidenceBundleSha256: bundleSha256,
    binding: {
      profiledAddress: "TG2B2Jb7PXbyKzhJ61yGpyFxqbGBL2cZUH",
      direction: "backward",
      anchorBinding: {
        canonicalEventId: recent[0]!,
        blockNumber: 100,
        timestamp: "2026-07-01T00:00:00.000Z",
        eventIndex: 0,
        orderAuthority: "unique_block"
      },
      sampledCanonicalEventIds,
      sampledEventIdsSha256: fingerprintCanonicalArtifact(sampledCanonicalEventIds)
    },
    exactCoverage: { recent: 100, historical: 100, total: 200 },
    productionEffect: false
  };
  return {
    bundle,
    bundleSha256,
    sourceMap,
    sourceMapSha256,
    wrapper,
    wrapperSha256: fingerprintCanonicalArtifact(wrapper),
    compoundBindingKey: serviceRoleShadowCompoundBindingKeyV1(wrapper)
  };
}

function acceptedHistoryGroup() {
  const address = "TG2B2Jb7PXbyKzhJ61yGpyFxqbGBL2cZUH";
  const anchorMs = Date.parse("2026-07-01T00:00:00.000Z");
  const makeEvent = (index: number, timestampMs: number): IndexedTronUsdtTransfer => ({
    txHash: (index + 1).toString(16).padStart(64, "0"),
    blockNumber: 10_000 - index,
    blockTimestamp: new Date(timestampMs),
    eventIndex: 0,
    fromAddress: address,
    toAddress: SUBJECT,
    amountRaw: String(1_000_000 + index),
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  });
  const recent = Array.from({ length: 100 }, (_, index) =>
    makeEvent(index, anchorMs - index * 60_000));
  const historical = Array.from({ length: 100 }, (_, index) =>
    makeEvent(index + 100, anchorMs - 8 * 24 * 60 * 60_000 - index * 60_000));
  const alternateAnchor = {
    ...makeEvent(200, anchorMs),
    blockNumber: 9_800
  };
  const events = [...recent, alternateAnchor, ...historical];
  const anchorId = canonicalTronUsdtEventKey(recent[0]!);
  const states: TraversalStateV1[] = Array.from({ length: 7 }, (_, index) => ({
    address,
    direction: "backward",
    anchorTimestamp: "2026-07-01T00:00:00.000Z",
    fundingEpisodeId: `episode-${index}`,
    allocatedAmountRaw: String(index + 1),
    sourceEventIds: [anchorId]
  }));
  const binding = deriveServiceRoleShadowAcceptedHistoryBindingV1({
    state: states[0]!,
    acceptedHistoryEvents: events
  });
  const alternateStates: TraversalStateV1[] = Array.from(
    { length: 3 },
    (_, index) => ({
      ...states[index]!,
      fundingEpisodeId: `alternate-episode-${index}`,
      sourceEventIds: [canonicalTronUsdtEventKey(alternateAnchor)]
    })
  );
  const alternateBinding = deriveServiceRoleShadowAcceptedHistoryBindingV1({
    state: alternateStates[0]!,
    acceptedHistoryEvents: events
  });
  const ids = [
    ...binding.sampledCanonicalEventIds.recent,
    ...binding.sampledCanonicalEventIds.historical
  ];
  const bundle: ServiceRoleEventEvidenceBundleV1 = {
    schemaVersion: "service-role-event-evidence-bundle-v1",
    policyVersion: "existing-hash-bound-economic-role-v1",
    runId: RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: "d".repeat(64),
    entries: ids.map((canonicalEventId, index) => ({
      canonicalEventId,
      transactionInfoEvidenceId: `accepted-evidence-${index}`,
      transactionInfoPayloadSha256: fingerprintCanonicalArtifact(["payload", index]),
      transactionInfoFinalityWitnessSha256: fingerprintCanonicalArtifact(["finality", index]),
      poisoningDispositionSha256: fingerprintCanonicalArtifact(["poisoning", index]),
      providerRiskDispositionSha256: fingerprintCanonicalArtifact(["risk", index]),
      role: "ordinary"
    }))
  };
  const bundleSha256 = fingerprintCanonicalArtifact(bundle);
  const sourceMap: ServiceRoleShadowEventRoleMapV1 = {
    schemaVersion: "service-role-shadow-event-role-map-v1",
    runId: RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: "d".repeat(64),
    entries: ids.map((canonicalEventId) => ({
      canonicalEventId,
      role: "ordinary",
      authority: "existing_hash_bound_economic_role_v1",
      evidenceSha256: bundleSha256
    }))
  };
  const sourceMapSha256 = fingerprintCanonicalArtifact(sourceMap);
  const wrapper: ServiceRoleShadowEventRoleMapV2 = {
    schemaVersion: "service-role-shadow-event-role-map-v2",
    policyVersion: "service-role-shadow-100-plus-100-v1",
    runId: RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: "d".repeat(64),
    sourceEventRoleMapV1Sha256: sourceMapSha256,
    evidenceBundleSha256: bundleSha256,
    binding,
    exactCoverage: { recent: 100, historical: 100, total: 200 },
    productionEffect: false
  };
  const alternateWrapper: ServiceRoleShadowEventRoleMapV2 = {
    ...wrapper,
    binding: alternateBinding
  };
  return {
    events,
    states,
    alternateStates,
    bundle,
    bundleSha256,
    sourceMap,
    sourceMapSha256,
    wrapper,
    wrapperSha256: fingerprintCanonicalArtifact(wrapper),
    compoundBindingKey: serviceRoleShadowCompoundBindingKeyV1(wrapper),
    alternateWrapper,
    alternateWrapperSha256: fingerprintCanonicalArtifact(alternateWrapper),
    alternateCompoundBindingKey:
      serviceRoleShadowCompoundBindingKeyV1(alternateWrapper)
  };
}

class MemoryDatabase implements UnifiedTransactionalQueryable {
  readonly calls: Array<{ transaction: number; sql: string; values: readonly unknown[] }> = [];
  readonly transactions: Array<"commit" | "rollback"> = [];
  wrapperScans = 0;
  failReadyFenceInsertOnce = false;
  failInputSetInsertOnce = false;
  failArtifactKindOnce: string | null = null;
  delayArtifactInsertOnce: {
    readonly kind: string;
    readonly onStarted: () => void;
    readonly release: Promise<void>;
  } | null = null;
  unavailableFenceTimeoutsRemaining = 0;
  inputSetInsertErrorOnce: Error | null = null;
  artifactLoadErrorOnce: Error | null = null;
  winnerFenceOnUnavailableTimeout: ArtifactRow | null = null;
  fatalWrapperScanOnce = false;
  private transactionNumber = 0;
  private artifacts = new Map<string, ArtifactRow>();
  private readonly manifests = new Map<string, { subject: string; sha256: string; artifact: unknown }>();

  constructor(runIds: readonly string[] = [RUN_ID]) {
    for (const runId of runIds) {
      const manifest = analysisManifest(runId, SNAPSHOT_HASH);
      const sha256 = fingerprintCanonicalArtifact(manifest);
      this.manifests.set(runId, { subject: SUBJECT, sha256, artifact: manifest });
      this.put(artifactRow(runId, "analysis_manifest", "1", manifest, sha256));
    }
  }

  put(row: ArtifactRow): void {
    this.artifacts.set(row.sha256, structuredClone(row));
  }

  rows(): ArtifactRow[] {
    return [...this.artifacts.values()].map((row) => structuredClone(row));
  }

  async query(): Promise<{ rows: Array<Record<string, unknown>> }> {
    throw new Error("query_outside_transaction");
  }

  async transaction<T>(work: (client: UnifiedQueryable) => Promise<T>): Promise<T> {
    const transaction = ++this.transactionNumber;
    const staged = new Map(
      [...this.artifacts.entries()].map(([key, row]) => [key, structuredClone(row)])
    );
    const query = async (sql: string, values: readonly unknown[] = []) => {
      this.calls.push({ transaction, sql, values });
      const normalized = sql.replaceAll(/\s+/gu, " ").trim().toLowerCase();
      if (normalized.startsWith("set local ") || normalized.includes("pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      if (normalized.includes("from unified_check_runs") && normalized.includes("analysis_manifest")) {
        const runId = String(values[0]);
        const manifest = this.manifests.get(runId);
        return { rows: manifest ? [{
          id: runId,
          subject_address: manifest.subject,
          analysis_manifest_sha256: manifest.sha256,
          artifact_sha256: manifest.sha256,
          artifact_kind: "analysis_manifest",
          artifact_schema_version: "1",
          artifact_json: manifest.artifact
        }] : [] };
      }
      if (normalized.includes("kind = 'service_role_shadow_input_fence'")) {
        const runId = String(values[0]);
        return { rows: [...staged.values()].filter((row) =>
          row.created_by_run_id === runId &&
          row.kind === "service_role_shadow_input_fence" &&
          row.schema_version === "1"
        ).sort((left, right) => left.sha256.localeCompare(right.sha256)) };
      }
      if (normalized.includes("kind = 'service_role_event_role_map'") &&
        normalized.includes("schema_version = '2'") &&
        !normalized.includes("sha256 = any")) {
        this.wrapperScans += 1;
        if (this.fatalWrapperScanOnce) {
          this.fatalWrapperScanOnce = false;
          throw new Error("fatal_wrapper_scan");
        }
        const runId = String(values[0]);
        return { rows: [...staged.values()].filter((row) =>
          row.created_by_run_id === runId &&
          row.kind === "service_role_event_role_map" &&
          row.schema_version === "2"
        ).sort((left, right) => left.sha256.localeCompare(right.sha256)) };
      }
      if (normalized.includes("sha256 = any")) {
        if (this.artifactLoadErrorOnce) {
          const error = this.artifactLoadErrorOnce;
          this.artifactLoadErrorOnce = null;
          throw error;
        }
        const hashes = values[0] as readonly string[];
        const runId = String(values[1]);
        return { rows: hashes.map((hash) => staged.get(hash)).filter((row): row is ArtifactRow =>
          row !== undefined && row.created_by_run_id === runId) };
      }
      if (normalized.startsWith("insert into unified_check_artifacts")) {
        const [sha256, runId, kind, schemaVersion, json] = values.map(String);
        if (this.delayArtifactInsertOnce?.kind === kind) {
          const delayed = this.delayArtifactInsertOnce;
          this.delayArtifactInsertOnce = null;
          delayed.onStarted();
          await delayed.release;
        }
        if (this.failArtifactKindOnce === kind) {
          this.failArtifactKindOnce = null;
          throw new Error(`failed_${kind}`);
        }
        if (this.inputSetInsertErrorOnce && kind === "service_role_shadow_input_set") {
          const error = this.inputSetInsertErrorOnce;
          this.inputSetInsertErrorOnce = null;
          throw error;
        }
        if (this.failInputSetInsertOnce && kind === "service_role_shadow_input_set") {
          this.failInputSetInsertOnce = false;
          throw statementTimeoutError();
        }
        if (kind === "service_role_shadow_input_fence") {
          const artifact = JSON.parse(json) as ServiceRoleShadowInputFenceV1;
          if (this.failReadyFenceInsertOnce && artifact.outcome.kind === "ready") {
            this.failReadyFenceInsertOnce = false;
            throw statementTimeoutError();
          }
          if (this.unavailableFenceTimeoutsRemaining > 0 && artifact.outcome.kind === "unavailable") {
            this.unavailableFenceTimeoutsRemaining -= 1;
            if (this.winnerFenceOnUnavailableTimeout) {
              this.artifacts.set(
                this.winnerFenceOnUnavailableTimeout.sha256,
                structuredClone(this.winnerFenceOnUnavailableTimeout)
              );
            }
            throw statementTimeoutError();
          }
        }
        if (staged.has(sha256)) return { rows: [] };
        const row = artifactRow(runId, kind, schemaVersion, JSON.parse(json), sha256);
        staged.set(sha256, row);
        return { rows: [row] };
      }
      if (normalized.includes("from unified_check_artifacts where sha256 = $1")) {
        const row = staged.get(String(values[0]));
        return { rows: row ? [row] : [] };
      }
      throw new Error(`unexpected_query:${normalized}`);
    };
    try {
      const result = await work({ query });
      this.artifacts = staged;
      this.transactions.push("commit");
      return result;
    } catch (error) {
      this.transactions.push("rollback");
      throw error;
    }
  }
}

function seedRoleArtifacts(db: MemoryDatabase, artifacts = roleArtifacts()): void {
  db.put(artifactRow(RUN_ID, "service_role_event_evidence_bundle", "1", artifacts.bundle));
  db.put(artifactRow(RUN_ID, "service_role_event_role_map", "1", artifacts.sourceMap));
  db.put(artifactRow(RUN_ID, "service_role_event_role_map", "2", artifacts.wrapper));
}

describe("service role shadow runtime contracts", () => {
  it("owns canonical exact input-set and fence bytes without trusting supplied hashes", () => {
    const inputSet = buildServiceRoleShadowInputSetV1({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      roleMapV2Sha256s: ["c".repeat(64), "b".repeat(64)]
    });
    expect(inputSet.artifact.roleMapV2Sha256s).toEqual([
      "b".repeat(64),
      "c".repeat(64)
    ]);
    expect(inputSet.sha256).toBe(fingerprintCanonicalArtifact(inputSet.artifact));
    expect(parseServiceRoleShadowInputSetV1({
      artifact: inputSet.artifact,
      expectedSha256: inputSet.sha256
    })).toEqual(inputSet.artifact);

    const fence = buildServiceRoleShadowInputFenceV1({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      runtimeCommit: RUNTIME_COMMIT,
      outcome: {
        kind: "ready",
        inputSetSha256: inputSet.sha256,
        roleMapV2Sha256s: inputSet.artifact.roleMapV2Sha256s
      }
    });
    expect(fence.sha256).toBe(fingerprintCanonicalArtifact(fence.artifact));
    expect(parseServiceRoleShadowInputFenceV1({
      artifact: fence.artifact,
      expectedSha256: fence.sha256
    })).toEqual(fence.artifact);
    expect(() => parseServiceRoleShadowInputFenceV1({
      artifact: fence.artifact,
      expectedSha256: "f".repeat(64)
    })).toThrow("service_role_shadow_input_fence_v1_invalid");
  });

  it("rejects unknown keys, sparse arrays, duplicates, and non-owning prototypes", () => {
    const inputSet = buildServiceRoleShadowInputSetV1({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      roleMapV2Sha256s: []
    });
    for (const artifact of [
      { ...inputSet.artifact, unexpected: true },
      Object.assign(Object.create({ inherited: true }), inputSet.artifact),
      { ...inputSet.artifact, roleMapV2Sha256s: ["b".repeat(64), "b".repeat(64)] },
      { ...inputSet.artifact, roleMapV2Sha256s: Object.assign([], { 1: "b".repeat(64), length: 2 }) }
    ]) {
      expect(() => parseServiceRoleShadowInputSetV1({
        artifact,
        expectedSha256: inputSet.sha256
      })).toThrow("service_role_shadow_input_set_v1_invalid");
    }
  });

  it("rejects a nested outcome accessor without invoking caller code", () => {
    let accesses = 0;
    const outcome = {
      inputSetSha256: "b".repeat(64),
      roleMapV2Sha256s: []
    } as Record<string, unknown>;
    Object.defineProperty(outcome, "kind", {
      enumerable: true,
      get() {
        accesses += 1;
        return "ready";
      }
    });
    const artifact = {
      schemaVersion: "service-role-shadow-input-fence-v1",
      policyVersion: "service-role-shadow-100-plus-100-v1",
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      runtimeCommit: RUNTIME_COMMIT,
      outcome,
      productionEffect: false
    };
    expect(() => parseServiceRoleShadowInputFenceV1({
      artifact,
      expectedSha256: "f".repeat(64)
    })).toThrow("service_role_shadow_input_fence_v1_invalid");
    expect(accesses).toBe(0);
  });

  it("requires unavailable observed hashes to be sorted unique lowercase SHA-256 values", () => {
    const valid = buildServiceRoleShadowInputFenceV1({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      runtimeCommit: RUNTIME_COMMIT,
      outcome: {
        kind: "unavailable",
        reason: "malformed",
        observedRoleMapV2Sha256s: ["b".repeat(64), "c".repeat(64)]
      }
    });
    for (const observedRoleMapV2Sha256s of [
      ["not-a-hash"],
      ["B".repeat(64)],
      ["b".repeat(64), "b".repeat(64)],
      ["c".repeat(64), "b".repeat(64)]
    ]) {
      const artifact = {
        ...valid.artifact,
        outcome: { ...valid.artifact.outcome, observedRoleMapV2Sha256s }
      };
      expect(() => parseServiceRoleShadowInputFenceV1({
        artifact,
        expectedSha256: fingerprintCanonicalArtifact(artifact)
      })).toThrow("service_role_shadow_input_fence_v1_invalid");
    }

    let accesses = 0;
    const accessorHashes: string[] = [];
    Object.defineProperty(accessorHashes, "0", {
      enumerable: true,
      get() {
        accesses += 1;
        return "b".repeat(64);
      }
    });
    Object.defineProperty(accessorHashes, "length", { value: 1 });
    expect(() => parseServiceRoleShadowInputFenceV1({
      artifact: {
        ...valid.artifact,
        outcome: { ...valid.artifact.outcome, observedRoleMapV2Sha256s: accessorHashes }
      },
      expectedSha256: "f".repeat(64)
    })).toThrow("service_role_shadow_input_fence_v1_invalid");
    expect(accesses).toBe(0);
  });

  it("rejects a huge sparse hash array before attempting a length-sized allocation", () => {
    const inputSet = buildServiceRoleShadowInputSetV1({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      roleMapV2Sha256s: []
    });
    const sparseHashes: string[] = [];
    sparseHashes.length = 1_000_000_000;
    let attemptedLengthSizedAllocation = false;
    const originalFrom = Array.from;
    const arrayFrom = vi.spyOn(Array, "from").mockImplementation(((value: unknown) => {
      if (
        value !== null &&
        typeof value === "object" &&
        "length" in value &&
        (value as { length: unknown }).length === sparseHashes.length
      ) {
        attemptedLengthSizedAllocation = true;
        throw new Error("length_sized_allocation_attempted");
      }
      return originalFrom(value as ArrayLike<unknown>);
    }) as typeof Array.from);
    try {
      expect(() => parseServiceRoleShadowInputSetV1({
        artifact: { ...inputSet.artifact, roleMapV2Sha256s: sparseHashes },
        expectedSha256: "f".repeat(64)
      })).toThrow("service_role_shadow_input_set_v1_invalid");
      expect(attemptedLengthSizedAllocation).toBe(false);
    } finally {
      arrayFrom.mockRestore();
    }
  });
});

describe("service role shadow runtime fence", () => {
  it("scans V2 exactly once, freezes an empty ready set, and caches the same promise", async () => {
    const db = new MemoryDatabase();
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    const first = runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    const second = runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ artifact: {
      outcome: { kind: "ready", roleMapV2Sha256s: [] }
    } });
    const envelope = await first;
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.artifact)).toBe(true);
    expect(Object.isFrozen(envelope.artifact.outcome)).toBe(true);
    expect(() => {
      (envelope as { sha256: string }).sha256 = "f".repeat(64);
    }).toThrow();
    expect(await runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH }))
      .toBe(envelope);
    expect(db.wrapperScans).toBe(1);
    await runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(db.wrapperScans).toBe(1);
    const missing = await runtime.lookupMap({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      compoundBindingKey: "e".repeat(64)
    });
    expect(missing).toEqual({ kind: "missing" });
    expect(Object.isFrozen(missing)).toBe(true);
  });

  it("reuses a strict fence after restart without rescanning or accepting a new wrapper", async () => {
    const db = new MemoryDatabase();
    const firstRuntime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    const first = await firstRuntime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    const later = roleArtifacts(RUN_ID, "later");
    seedRoleArtifacts(db, later);
    const restarted = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    const reused = await restarted.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(reused).toEqual(first);
    expect(db.wrapperScans).toBe(1);
    await expect(restarted.lookupMap({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      compoundBindingKey: later.compoundBindingKey
    })).resolves.toEqual({ kind: "missing" });
  });

  it("strictly validates the V2 wrapper, run-owned V1 map, bundle, and closure", async () => {
    const db = new MemoryDatabase();
    const valid = roleArtifacts();
    seedRoleArtifacts(db, valid);
    const sourceRow = db.rows().find((row) => row.sha256 === valid.sourceMapSha256)!;
    db.put({
      ...sourceRow,
      artifact_json: { ...(sourceRow.artifact_json as object), unexpected: true }
    });
    const fence = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(fence.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "malformed",
      observedRoleMapV2Sha256s: [valid.wrapperSha256]
    });
    expect(db.transactions).toEqual(["rollback", "commit"]);
    expect(db.calls.filter((call) =>
      call.sql.includes("insert into unified_check_artifacts") &&
      call.values[2] === "service_role_shadow_input_fence"
    ).map((call) => call.transaction)).toEqual([2]);
  });

  it("publishes and reuses malformed when a wrapper row has a non-hash key", async () => {
    const db = new MemoryDatabase();
    const valid = roleArtifacts();
    seedRoleArtifacts(db, valid);
    db.put(artifactRow(
      RUN_ID,
      "service_role_event_role_map",
      "2",
      { schemaVersion: "service-role-shadow-event-role-map-v2", malformed: true },
      "corrupt-wrapper-key"
    ));
    const first = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(first.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "malformed",
      observedRoleMapV2Sha256s: [valid.wrapperSha256]
    });
    expect(db.transactions).toEqual(["rollback", "commit"]);
    expect(db.rows().some((row) =>
      row.created_by_run_id === RUN_ID &&
      row.kind === "service_role_shadow_input_set"
    )).toBe(false);

    const restarted = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(restarted).toEqual(first);
    expect(db.wrapperScans).toBe(1);
  });

  it("returns compound missing, found, and conflict only from the frozen validated set", async () => {
    const db = new MemoryDatabase();
    const first = roleArtifacts(RUN_ID, "first");
    seedRoleArtifacts(db, first);
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    await runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    await expect(runtime.lookupMap({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      compoundBindingKey: "f".repeat(64)
    })).resolves.toEqual({ kind: "missing" });
    await expect(runtime.lookupMap({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      compoundBindingKey: first.compoundBindingKey
    })).resolves.toEqual({
      kind: "found",
      wrapperSha256: first.wrapperSha256,
      wrapper: first.wrapper,
      sourceMapSha256: first.sourceMapSha256,
      sourceMap: first.sourceMap
    });

    const conflictDb = new MemoryDatabase();
    const second = roleArtifacts(RUN_ID, "second");
    seedRoleArtifacts(conflictDb, first);
    seedRoleArtifacts(conflictDb, second);
    const conflictRuntime = createServiceRoleShadowRuntimeV1({
      db: conflictDb,
      runtimeCommit: RUNTIME_COMMIT
    });
    await conflictRuntime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    await expect(conflictRuntime.lookupMap({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      compoundBindingKey: first.compoundBindingKey
    })).resolves.toEqual({
      kind: "conflict",
      wrapperSha256s: [first.wrapperSha256, second.wrapperSha256].sort()
    });
  });

  it("orders conflict hashes by code unit without locale collation", async () => {
    const db = new MemoryDatabase();
    const first = roleArtifacts(RUN_ID, "locale-first");
    const second = roleArtifacts(RUN_ID, "locale-second");
    seedRoleArtifacts(db, first);
    seedRoleArtifacts(db, second);
    const localeCompare = vi.spyOn(String.prototype, "localeCompare")
      .mockImplementation(function (this: string, that: string) {
        return String(this) < that ? 1 : String(this) > that ? -1 : 0;
      });
    try {
      const runtime = createServiceRoleShadowRuntimeV1({
        db,
        runtimeCommit: RUNTIME_COMMIT
      });
      await runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
      await expect(runtime.lookupMap({
        runId: RUN_ID,
        snapshotHash: SNAPSHOT_HASH,
        compoundBindingKey: first.compoundBindingKey
      })).resolves.toEqual({
        kind: "conflict",
        wrapperSha256s: [first.wrapperSha256, second.wrapperSha256].sort()
      });
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("uses the exact 1000ms local deadlines and rolls normal writes back before timeout publication", async () => {
    const db = new MemoryDatabase();
    seedRoleArtifacts(db);
    db.failReadyFenceInsertOnce = true;
    const fence = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(fence.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "preload_timeout",
      observedRoleMapV2Sha256s: null
    });
    expect(db.transactions).toEqual(["rollback", "commit"]);
    expect(db.calls.filter((call) => call.transaction === 1).slice(0, 2).map((call) => call.sql)).toEqual([
      "SET LOCAL lock_timeout = '1000ms'",
      "SET LOCAL statement_timeout = '1000ms'"
    ]);
    expect(db.rows().some((row) => row.kind === "service_role_shadow_input_set")).toBe(false);
    expect(db.rows().filter((row) => row.kind === "service_role_shadow_input_fence")).toHaveLength(1);
  });

  it("publishes preload_timeout when the input-set insert itself reaches the statement deadline", async () => {
    const db = new MemoryDatabase();
    seedRoleArtifacts(db);
    db.failInputSetInsertOnce = true;
    const fence = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(fence.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "preload_timeout",
      observedRoleMapV2Sha256s: null
    });
    expect(db.transactions).toEqual(["rollback", "commit"]);
    expect(db.rows().some((row) => row.kind === "service_role_shadow_input_set")).toBe(false);
  });

  it("retries one timed-out publication transaction and caches the durable fallback fence", async () => {
    const db = new MemoryDatabase();
    seedRoleArtifacts(db);
    db.failReadyFenceInsertOnce = true;
    db.unavailableFenceTimeoutsRemaining = 1;
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    const first = runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    const second = runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ artifact: { outcome: {
      kind: "unavailable",
      reason: "preload_timeout"
    } } });
    expect(db.transactions).toEqual(["rollback", "rollback", "commit"]);
    expect(db.rows().filter((row) =>
      row.created_by_run_id === RUN_ID &&
      row.kind === "service_role_shadow_input_fence"
    )).toHaveLength(1);
    await expect(createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH })).resolves.toEqual(
      await first
    );
  });

  it("rechecks and adopts a durable winner after the first publication attempt times out", async () => {
    const db = new MemoryDatabase();
    seedRoleArtifacts(db);
    db.failReadyFenceInsertOnce = true;
    db.unavailableFenceTimeoutsRemaining = 1;
    const winner = buildServiceRoleShadowInputFenceV1({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      runtimeCommit: RUNTIME_COMMIT,
      outcome: {
        kind: "unavailable",
        reason: "preload_timeout",
        observedRoleMapV2Sha256s: null
      }
    });
    db.winnerFenceOnUnavailableTimeout = artifactRow(
      RUN_ID,
      "service_role_shadow_input_fence",
      "1",
      winner.artifact,
      winner.sha256
    );
    const fence = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(fence).toEqual({ sha256: winner.sha256, artifact: winner.artifact });
    expect(db.transactions).toEqual(["rollback", "rollback", "commit"]);
    expect(db.rows().filter((row) => row.kind === "service_role_shadow_input_fence"))
      .toHaveLength(1);
  });

  it("evicts an exhausted publication promise so a later call can converge", async () => {
    const db = new MemoryDatabase();
    const roles = roleArtifacts();
    db.put(artifactRow(RUN_ID, "service_role_event_role_map", "2", {
      ...roles.wrapper,
      unexpected: true
    }, roles.wrapperSha256));
    db.unavailableFenceTimeoutsRemaining = 2;
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    const exhausted = runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    await expect(exhausted).rejects.toThrow("statement timeout");
    expect(db.transactions).toEqual(["rollback", "rollback", "rollback"]);

    const retry = runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(retry).not.toBe(exhausted);
    await expect(retry).resolves.toMatchObject({ artifact: { outcome: {
      kind: "unavailable",
      reason: "malformed",
      observedRoleMapV2Sha256s: [roles.wrapperSha256]
    } } });
    expect(db.transactions).toEqual([
      "rollback", "rollback", "rollback", "rollback", "commit"
    ]);
  });

  it("does not classify explicit cancellation or a non-timeout lock error by code alone", async () => {
    for (const error of [
      postgresError("57014", "canceling statement due to user request"),
      postgresError("55P03", "could not obtain lock on row in relation unified_check_runs")
    ]) {
      const db = new MemoryDatabase();
      db.inputSetInsertErrorOnce = error;
      await expect(createServiceRoleShadowRuntimeV1({
        db,
        runtimeCommit: RUNTIME_COMMIT
      }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH }))
        .rejects.toThrow(error.message);
      expect(db.transactions).toEqual(["rollback"]);
      expect(db.rows().some((row) =>
        row.created_by_run_id === RUN_ID &&
        row.kind === "service_role_shadow_input_fence"
      )).toBe(false);
    }
  });

  it("propagates explicit cancellation while revalidating an existing fence", async () => {
    const db = new MemoryDatabase();
    await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    db.artifactLoadErrorOnce = postgresError(
      "57014",
      "canceling statement due to user request"
    );
    await expect(createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH }))
      .rejects.toThrow("canceling statement due to user request");
    expect(db.transactions).toEqual(["commit", "rollback"]);
    expect(db.rows().filter((row) =>
      row.created_by_run_id === RUN_ID &&
      row.kind === "service_role_shadow_input_fence"
    )).toHaveLength(1);
  });

  it("classifies 55P03 only when its message identifies lock_timeout", async () => {
    const db = new MemoryDatabase();
    db.inputSetInsertErrorOnce = postgresError(
      "55P03",
      "canceling statement due to lock timeout"
    );
    const fence = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(fence.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "preload_timeout",
      observedRoleMapV2Sha256s: null
    });
    expect(db.transactions).toEqual(["rollback", "commit"]);
  });

  it("routes foreign-owned exact-hash input-set and ready-fence conflicts through rollback-first publication", async () => {
    for (const foreignKind of ["input_set", "ready_fence"] as const) {
      const db = new MemoryDatabase();
      const inputSet = buildServiceRoleShadowInputSetV1({
        runId: RUN_ID,
        snapshotHash: SNAPSHOT_HASH,
        roleMapV2Sha256s: []
      });
      if (foreignKind === "input_set") {
        db.put(artifactRow(
          "foreign-run",
          "service_role_shadow_input_set",
          "1",
          inputSet.artifact,
          inputSet.sha256
        ));
      } else {
        const ready = buildServiceRoleShadowInputFenceV1({
          runId: RUN_ID,
          snapshotHash: SNAPSHOT_HASH,
          runtimeCommit: RUNTIME_COMMIT,
          outcome: {
            kind: "ready",
            inputSetSha256: inputSet.sha256,
            roleMapV2Sha256s: []
          }
        });
        db.put(artifactRow(
          "foreign-run",
          "service_role_shadow_input_fence",
          "1",
          ready.artifact,
          ready.sha256
        ));
      }
      const fence = await createServiceRoleShadowRuntimeV1({
        db,
        runtimeCommit: RUNTIME_COMMIT
      }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
      expect(fence.artifact.outcome).toEqual({
        kind: "unavailable",
        reason: "conflict",
        observedRoleMapV2Sha256s: []
      });
      expect(db.transactions).toEqual(["rollback", "commit"]);
      expect(db.rows().some((row) =>
        row.created_by_run_id === RUN_ID &&
        row.kind === "service_role_shadow_input_set"
      )).toBe(false);
      expect(db.rows().filter((row) =>
        row.created_by_run_id === RUN_ID &&
        row.kind === "service_role_shadow_input_fence"
      )).toHaveLength(1);
    }
  });

  it("publishes deterministic malformed, conflict, and preload-timeout fences", async () => {
    const malformed = async () => {
      const db = new MemoryDatabase();
      const roles = roleArtifacts();
      db.put(artifactRow(RUN_ID, "service_role_event_role_map", "2", {
        ...roles.wrapper,
        unexpected: true
      }, roles.wrapperSha256));
      return createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT })
        .loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    };
    expect((await malformed()).sha256).toBe((await malformed()).sha256);

    const conflictDb = new MemoryDatabase();
    const observed = ["4".repeat(64), "3".repeat(64)].sort();
    const one = buildServiceRoleShadowInputFenceV1({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      runtimeCommit: "older-runtime",
      outcome: {
        kind: "unavailable",
        reason: "malformed",
        observedRoleMapV2Sha256s: observed
      }
    });
    const two = buildServiceRoleShadowInputFenceV1({
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      runtimeCommit: "other-runtime",
      outcome: {
        kind: "unavailable",
        reason: "conflict",
        observedRoleMapV2Sha256s: observed
      }
    });
    conflictDb.put(artifactRow(RUN_ID, "service_role_shadow_input_fence", "1", one.artifact));
    conflictDb.put(artifactRow(RUN_ID, "service_role_shadow_input_fence", "1", two.artifact));
    const conflict = await createServiceRoleShadowRuntimeV1({
      db: conflictDb,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(conflict.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "conflict",
      observedRoleMapV2Sha256s: observed
    });

    const timeout = async () => {
      const db = new MemoryDatabase();
      seedRoleArtifacts(db);
      db.failReadyFenceInsertOnce = true;
      return createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT })
        .loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    };
    expect((await timeout()).sha256).toBe((await timeout()).sha256);
  });

  it("collapses a pre-existing invalid fence to one restart-stable conflict outcome", async () => {
    const db = new MemoryDatabase();
    const invalid = { schemaVersion: "not-a-service-role-fence" };
    db.put(artifactRow(
      RUN_ID,
      "service_role_shadow_input_fence",
      "1",
      invalid
    ));
    const first = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(first.artifact.outcome).toEqual({
      kind: "unavailable",
      reason: "conflict",
      observedRoleMapV2Sha256s: []
    });
    expect(db.transactions).toEqual(["rollback", "commit"]);
    expect(db.calls.filter((call) =>
      call.sql.includes("insert into unified_check_artifacts") &&
      call.values[2] === "service_role_shadow_input_fence"
    ).map((call) => call.transaction)).toEqual([2]);
    const restarted = await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(restarted).toEqual(first);
    expect(db.wrapperScans).toBe(0);
  });

  it("freezes unavailable input and rejects later same-run snapshot changes", async () => {
    const db = new MemoryDatabase();
    const invalid = roleArtifacts();
    db.put(artifactRow(RUN_ID, "service_role_event_role_map", "2", {
      ...invalid.wrapper,
      productionEffect: true
    }));
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    const unavailable = await runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    seedRoleArtifacts(db, invalid);
    expect(await runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH })).toEqual(unavailable);
    await expect(runtime.loadInputFence({
      runId: RUN_ID,
      snapshotHash: "9".repeat(64)
    })).rejects.toThrow("service_role_shadow_runtime_snapshot_mismatch");
    expect(db.wrapperScans).toBe(1);
  });

  it("caches and handles the final rejected fence promise without a second scan", async () => {
    const db = new MemoryDatabase();
    db.fatalWrapperScanOnce = true;
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    const first = runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    const second = runtime.loadInputFence({ runId: RUN_ID, snapshotHash: SNAPSHOT_HASH });
    expect(second).toBe(first);
    await expect(first).rejects.toThrow("fatal_wrapper_scan");
    await expect(second).rejects.toThrow("fatal_wrapper_scan");
    expect(db.wrapperScans).toBe(1);
  });
});

describe("service role shadow accepted-history observer", () => {
  it("persists seven qualifying profiles and one sorted compound precommit", async () => {
    const db = new MemoryDatabase();
    const accepted = acceptedHistoryGroup();
    seedRoleArtifacts(db, accepted);
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });
    const controller = new AbortController();

    const observation = {
      taskId: "task-traversal",
      attempt: 2,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: ["e".repeat(64)],
      events: accepted.events,
      states: [...accepted.states].reverse(),
      candidateCheckpoint: { deltaHeadSha256: "f".repeat(64) } as never,
      candidateDeltaSha256: "f".repeat(64),
      signal: controller.signal
    };
    await runtime.observeAcceptedAddressHistoryGroup(observation);
    await runtime.observeAcceptedAddressHistoryGroup({
      ...observation,
      attempt: 3
    });

    const profiles = db.rows().filter((row) =>
      row.kind === "service_role_shadow_profile");
    const precommits = db.rows().filter((row) =>
      row.kind === "service_role_shadow_precommit_receipt");
    expect(profiles).toHaveLength(7);
    expect(precommits).toHaveLength(1);
    expect(precommits[0]!.artifact_json).toMatchObject({
      schemaVersion: "service-role-shadow-precommit-receipt-v1",
      compoundBindingKey: accepted.compoundBindingKey,
      commitStatus: "unconfirmed",
      productionEffect: false
    });
    const entries = (precommits[0]!.artifact_json as {
      profiles: Array<{ traversalStateId: string }>;
    }).profiles;
    expect(entries.map((entry) => entry.traversalStateId)).toEqual(
      accepted.states.map(traversalStateId).sort()
    );
    const precommit = precommits[0]!;
    const parsed = parseServiceRoleShadowPrecommitReceiptV1({
      artifact: precommit.artifact_json,
      expectedSha256: precommit.sha256
    });
    expect(() => parseServiceRoleShadowPrecommitReceiptV1({
      artifact: { ...parsed, extra: true },
      expectedSha256: precommit.sha256
    })).toThrow("service_role_shadow_precommit_receipt_v1_invalid");
    const reordered = {
      ...parsed,
      profiles: [...parsed.profiles].reverse()
    };
    expect(() => parseServiceRoleShadowPrecommitReceiptV1({
      artifact: reordered,
      expectedSha256: fingerprintCanonicalArtifact(reordered)
    })).toThrow("service_role_shadow_precommit_receipt_v1_invalid");
    expect(() => parseServiceRoleShadowPrecommitReceiptV1({
      artifact: parsed,
      expectedSha256: "0".repeat(64)
    })).toThrow("service_role_shadow_precommit_receipt_v1_invalid");
    const {
      schemaVersion: _schemaVersion,
      policyVersion: _policyVersion,
      commitStatus: _commitStatus,
      productionEffect: _productionEffect,
      ...builderInput
    } = parsed;
    const localeCompare = vi.spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => {
        throw new Error("locale ordering used");
      });
    try {
      expect(buildServiceRoleShadowPrecommitReceiptV1(builderInput).sha256)
        .toBe(precommit.sha256);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("subgroups exact bindings into two receipts without changing per-state cardinality", async () => {
    const db = new MemoryDatabase();
    const accepted = acceptedHistoryGroup();
    seedRoleArtifacts(db, accepted);
    db.put(artifactRow(
      RUN_ID,
      "service_role_event_role_map",
      "2",
      accepted.alternateWrapper
    ));
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });

    await runtime.observeAcceptedAddressHistoryGroup({
      taskId: "task-traversal",
      attempt: 1,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: ["e".repeat(64)],
      events: accepted.events,
      states: [...accepted.states.slice(0, 4), ...accepted.alternateStates],
      candidateCheckpoint: { deltaHeadSha256: "f".repeat(64) } as never,
      candidateDeltaSha256: "f".repeat(64),
      signal: new AbortController().signal
    });

    expect(db.rows().filter((row) =>
      row.kind === "service_role_shadow_profile")).toHaveLength(7);
    const precommits = db.rows().filter((row) =>
      row.kind === "service_role_shadow_precommit_receipt");
    expect(precommits).toHaveLength(2);
    expect(precommits.map((row) =>
      (row.artifact_json as { compoundBindingKey: string }).compoundBindingKey
    ).sort()).toEqual([
      accepted.compoundBindingKey,
      accepted.alternateCompoundBindingKey
    ].sort());
  });

  it("writes no per-skip artifact for missing maps or a pre-aborted group", async () => {
    const accepted = acceptedHistoryGroup();
    const missingDb = new MemoryDatabase();
    const missing = createServiceRoleShadowRuntimeV1({
      db: missingDb,
      runtimeCommit: RUNTIME_COMMIT
    });
    const base = {
      taskId: "task-traversal",
      attempt: 1,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: ["e".repeat(64)],
      events: accepted.events,
      states: accepted.states,
      candidateCheckpoint: { deltaHeadSha256: "f".repeat(64) } as never,
      candidateDeltaSha256: "f".repeat(64)
    };
    await missing.observeAcceptedAddressHistoryGroup({
      ...base,
      signal: new AbortController().signal
    });
    expect(missingDb.rows().filter((row) =>
      row.kind === "service_role_shadow_profile" ||
      row.kind === "service_role_shadow_precommit_receipt")).toEqual([]);

    const abortedDb = new MemoryDatabase();
    seedRoleArtifacts(abortedDb, accepted);
    const controller = new AbortController();
    controller.abort();
    await createServiceRoleShadowRuntimeV1({
      db: abortedDb,
      runtimeCommit: RUNTIME_COMMIT
    }).observeAcceptedAddressHistoryGroup({ ...base, signal: controller.signal });
    expect(abortedDb.rows().filter((row) =>
      row.kind.startsWith("service_role_shadow_"))).toEqual([]);
  });

  it("writes no per-skip artifact for map conflict, checked subject, or binding failure", async () => {
    const accepted = acceptedHistoryGroup();
    const base = {
      taskId: "task-traversal",
      attempt: 1,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: ["e".repeat(64)],
      events: accepted.events,
      states: accepted.states,
      candidateCheckpoint: { deltaHeadSha256: "f".repeat(64) } as never,
      candidateDeltaSha256: "f".repeat(64),
      signal: new AbortController().signal
    };
    const noObservations = (db: MemoryDatabase) => db.rows().filter((row) =>
      row.kind === "service_role_shadow_profile" ||
      row.kind === "service_role_shadow_precommit_receipt");

    const conflictDb = new MemoryDatabase();
    seedRoleArtifacts(conflictDb, accepted);
    const conflictBundle: ServiceRoleEventEvidenceBundleV1 = {
      ...accepted.bundle,
      entries: accepted.bundle.entries.map((entry, index) => index === 0
        ? {
            ...entry,
            transactionInfoEvidenceId: "conflicting-evidence",
            transactionInfoPayloadSha256:
              fingerprintCanonicalArtifact(["conflicting-payload"])
          }
        : entry)
    };
    const conflictBundleSha256 = fingerprintCanonicalArtifact(conflictBundle);
    const conflictMap: ServiceRoleShadowEventRoleMapV1 = {
      ...accepted.sourceMap,
      entries: accepted.sourceMap.entries.map((entry) => ({
        ...entry,
        evidenceSha256: conflictBundleSha256
      }))
    };
    const conflictMapSha256 = fingerprintCanonicalArtifact(conflictMap);
    const conflictWrapper: ServiceRoleShadowEventRoleMapV2 = {
      ...accepted.wrapper,
      sourceEventRoleMapV1Sha256: conflictMapSha256,
      evidenceBundleSha256: conflictBundleSha256
    };
    conflictDb.put(artifactRow(
      RUN_ID,
      "service_role_event_evidence_bundle",
      "1",
      conflictBundle
    ));
    conflictDb.put(artifactRow(
      RUN_ID,
      "service_role_event_role_map",
      "1",
      conflictMap
    ));
    conflictDb.put(artifactRow(
      RUN_ID,
      "service_role_event_role_map",
      "2",
      conflictWrapper
    ));
    await createServiceRoleShadowRuntimeV1({
      db: conflictDb,
      runtimeCommit: RUNTIME_COMMIT
    }).observeAcceptedAddressHistoryGroup(base);
    expect(noObservations(conflictDb)).toEqual([]);

    const subjectDb = new MemoryDatabase();
    seedRoleArtifacts(subjectDb, accepted);
    await createServiceRoleShadowRuntimeV1({
      db: subjectDb,
      runtimeCommit: RUNTIME_COMMIT
    }).observeAcceptedAddressHistoryGroup({
      ...base,
      subjectAddress: accepted.wrapper.binding.profiledAddress
    });
    expect(noObservations(subjectDb)).toEqual([]);

    const invalidBindingDb = new MemoryDatabase();
    seedRoleArtifacts(invalidBindingDb, accepted);
    await createServiceRoleShadowRuntimeV1({
      db: invalidBindingDb,
      runtimeCommit: RUNTIME_COMMIT
    }).observeAcceptedAddressHistoryGroup({
      ...base,
      states: accepted.states.map((state) => ({
        ...state,
        anchorTimestamp: "2026-07-02T00:00:00.000Z"
      }))
    });
    expect(noObservations(invalidBindingDb)).toEqual([]);
  });

  it("does not persist a found-map diagnostic profile when source pages are invalid", async () => {
    const db = new MemoryDatabase();
    const accepted = acceptedHistoryGroup();
    seedRoleArtifacts(db, accepted);

    await createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).observeAcceptedAddressHistoryGroup({
      taskId: "task-traversal",
      attempt: 1,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: [],
      events: accepted.events,
      states: accepted.states,
      candidateCheckpoint: { deltaHeadSha256: "f".repeat(64) } as never,
      candidateDeltaSha256: "f".repeat(64),
      signal: new AbortController().signal
    });

    expect(db.rows().filter((row) =>
      row.kind === "service_role_shadow_profile" ||
      row.kind === "service_role_shadow_precommit_receipt")).toEqual([]);
  });

  it("rolls back partial profile persistence and never publishes a precommit", async () => {
    const db = new MemoryDatabase();
    const accepted = acceptedHistoryGroup();
    seedRoleArtifacts(db, accepted);
    db.failArtifactKindOnce = "service_role_shadow_profile";
    const runtime = createServiceRoleShadowRuntimeV1({ db, runtimeCommit: RUNTIME_COMMIT });

    await expect(runtime.observeAcceptedAddressHistoryGroup({
      taskId: "task-traversal",
      attempt: 1,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: ["e".repeat(64)],
      events: accepted.events,
      states: accepted.states,
      candidateCheckpoint: { deltaHeadSha256: "f".repeat(64) } as never,
      candidateDeltaSha256: "f".repeat(64),
      signal: new AbortController().signal
    })).rejects.toThrow("failed_service_role_shadow_profile");
    expect(db.rows().filter((row) =>
      row.kind === "service_role_shadow_profile" ||
      row.kind === "service_role_shadow_precommit_receipt")).toEqual([]);

    const precommitDb = new MemoryDatabase();
    seedRoleArtifacts(precommitDb, accepted);
    precommitDb.failArtifactKindOnce = "service_role_shadow_precommit_receipt";
    await expect(createServiceRoleShadowRuntimeV1({
      db: precommitDb,
      runtimeCommit: RUNTIME_COMMIT
    }).observeAcceptedAddressHistoryGroup({
      taskId: "task-traversal",
      attempt: 1,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: ["e".repeat(64)],
      events: accepted.events,
      states: accepted.states,
      candidateCheckpoint: { deltaHeadSha256: "f".repeat(64) } as never,
      candidateDeltaSha256: "f".repeat(64),
      signal: new AbortController().signal
    })).rejects.toThrow("failed_service_role_shadow_precommit_receipt");
    expect(precommitDb.rows().filter((row) =>
      row.kind === "service_role_shadow_profile" ||
      row.kind === "service_role_shadow_precommit_receipt")).toEqual([]);
  });

  it("rolls back when abort is observed as the final precommit insert settles", async () => {
    const db = new MemoryDatabase();
    const accepted = acceptedHistoryGroup();
    seedRoleArtifacts(db, accepted);
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let releaseInsert!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    db.delayArtifactInsertOnce = {
      kind: "service_role_shadow_precommit_receipt",
      onStarted: markStarted,
      release
    };
    const controller = new AbortController();
    const observation = createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    }).observeAcceptedAddressHistoryGroup({
      taskId: "task-traversal",
      attempt: 1,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: ["e".repeat(64)],
      events: accepted.events,
      states: accepted.states,
      candidateCheckpoint: { deltaHeadSha256: "f".repeat(64) } as never,
      candidateDeltaSha256: "f".repeat(64),
      signal: controller.signal
    });

    await started;
    controller.abort();
    releaseInsert();
    await expect(observation).rejects.toThrow(
      "service_role_shadow_observer_aborted"
    );
    expect(db.transactions.at(-1)).toBe("rollback");
    expect(db.rows().filter((row) =>
      row.kind === "service_role_shadow_profile" ||
      row.kind === "service_role_shadow_precommit_receipt")).toEqual([]);
  });
});

describe("service role shadow checkpoint reconciliation", () => {
  function delta(previousDeltaHash: string | null, seed: string) {
    return {
      version: "unified-traversal-delta-v1",
      previousDeltaHash,
      addedFrontier: [],
      removedFrontierStateIds: [],
      addedVisited: [],
      addedTerminals: [],
      addedSupersededStateIds: [],
      addedExpandedStateIds: [],
      addedEligibleEventIds: [seed],
      addedExpandedStateKeys: [],
      counterDeltas: { expanded: 0, terminal: 0, superseded: 0 }
    };
  }

  async function preparedReconciliation(
    candidatePrevious: "valid" | "numeric" | "missing" = "valid"
  ) {
    const db = new MemoryDatabase();
    const accepted = acceptedHistoryGroup();
    seedRoleArtifacts(db, accepted);
    const runtime = createServiceRoleShadowRuntimeV1({
      db,
      runtimeCommit: RUNTIME_COMMIT
    });
    const validCandidate = delta(null, "candidate");
    const candidate = candidatePrevious === "numeric"
      ? { ...validCandidate, previousDeltaHash: 7 }
      : candidatePrevious === "missing"
        ? Object.fromEntries(Object.entries(validCandidate).filter(([key]) =>
            key !== "previousDeltaHash"
          ))
        : validCandidate;
    const candidateSha256 = fingerprintCanonicalArtifact(candidate);
    const committed = delta(candidateSha256, "committed");
    const committedSha256 = fingerprintCanonicalArtifact(committed);
    await runtime.observeAcceptedAddressHistoryGroup({
      taskId: "task-traversal",
      attempt: 2,
      runId: RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      manifestKey: "accepted-history-key",
      manifestSha256: "d".repeat(64),
      acceptedPageArtifactHashes: ["e".repeat(64)],
      events: accepted.events,
      states: accepted.states,
      candidateCheckpoint: { deltaHeadSha256: candidateSha256 } as never,
      candidateDeltaSha256: candidateSha256,
      signal: new AbortController().signal
    });
    db.put(artifactRow(
      RUN_ID,
      "traversal_delta",
      "1",
      candidate,
      candidateSha256
    ));
    db.put(artifactRow(
      RUN_ID,
      "traversal_delta",
      "1",
      committed,
      committedSha256
    ));
    const checkpoint = {
      version: "unified-production-traversal-checkpoint-v2",
      deltaHeadSha256: committedSha256
    };
    const task = {
      id: "task-traversal",
      runId: RUN_ID,
      kind: "traversal",
      attempt: 2,
      checkpoint: {},
      cancellationRequestedAt: null
    };
    return {
      db,
      runtime,
      candidateSha256,
      committedSha256,
      checkpoint,
      task
    };
  }

  it("reconciles one group from a multi-entry atomic prefix and owns strict receipt bytes", async () => {
    const prepared = await preparedReconciliation();
    const reconcile = (prepared.runtime as unknown as {
      reconcileCheckpoint(input: unknown): Promise<void>;
    }).reconcileCheckpoint;
    const committedEntries = [{
      canonicalSequence: 4,
      taskId: "history-unrelated",
      acceptedAttemptId: "attempt-unrelated",
      artifactSha256: "c".repeat(64)
    }, {
      canonicalSequence: 5,
      taskId: "history-matched",
      acceptedAttemptId: "attempt-matched",
      artifactSha256: "d".repeat(64)
    }];
    const lifecycle = {
      task: prepared.task,
      result: { kind: "checkpoint", checkpoint: prepared.checkpoint },
      checkpointCommit: {
        checkpointed: true,
        providerWorkAvailable: false,
        committedTaskStatus: "QUEUED",
        committedCheckpoint: prepared.checkpoint,
        orderedCommit: {
          applied: true,
          runId: RUN_ID,
          committedEntries
        }
      },
      signal: new AbortController().signal
    };

    await reconcile.call(prepared.runtime, lifecycle);
    await reconcile.call(prepared.runtime, lifecycle);

    const receipts = prepared.db.rows().filter((row) =>
      row.kind === "service_role_shadow_runtime_receipt");
    expect(receipts).toHaveLength(1);
    const parse = (shadowRuntimeModule as unknown as {
      parseServiceRoleShadowRuntimeReceiptV1(input: {
        artifact: unknown;
        expectedSha256: string;
      }): unknown;
    }).parseServiceRoleShadowRuntimeReceiptV1;
    const parsed = parse({
      artifact: receipts[0]!.artifact_json,
      expectedSha256: receipts[0]!.sha256
    }) as {
      committedEntries: unknown[];
      profiles: unknown[];
      candidateDeltaSha256: string;
      committedDeltaHeadSha256: string;
      commitStatus: string;
      productionEffect: boolean;
    };
    expect(parsed).toMatchObject({
      candidateDeltaSha256: prepared.candidateSha256,
      committedDeltaHeadSha256: prepared.committedSha256,
      commitStatus: "reconciled",
      productionEffect: false
    });
    expect(parsed.committedEntries).toEqual(committedEntries);
    expect(parsed.profiles).toHaveLength(7);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.committedEntries)).toBe(true);
    expect(() => {
      (parsed.committedEntries[0] as { taskId: string }).taskId = "mutated";
    }).toThrow();
    expect(() => parse({
      artifact: { ...(parsed as object), extra: true },
      expectedSha256: receipts[0]!.sha256
    })).toThrow("service_role_shadow_runtime_receipt_v1_invalid");
    expect(() => parse({
      artifact: parsed,
      expectedSha256: "0".repeat(64)
    })).toThrow("service_role_shadow_runtime_receipt_v1_invalid");
    for (const artifact of [{
      ...parsed,
      committedEntries: [...parsed.committedEntries].reverse()
    }, {
      ...parsed,
      profiles: [...parsed.profiles].reverse()
    }]) {
      expect(() => parse({
        artifact,
        expectedSha256: fingerprintCanonicalArtifact(artifact)
      })).toThrow("service_role_shadow_runtime_receipt_v1_invalid");
    }
    const build = (shadowRuntimeModule as unknown as {
      buildServiceRoleShadowRuntimeReceiptV1(input: unknown): {
        sha256: string;
      };
    }).buildServiceRoleShadowRuntimeReceiptV1;
    const {
      schemaVersion: _schemaVersion,
      policyVersion: _policyVersion,
      commitStatus: _commitStatus,
      productionEffect: _productionEffect,
      ...builderInput
    } = parsed as typeof parsed & {
      schemaVersion: string;
      policyVersion: string;
      commitStatus: string;
      productionEffect: boolean;
    };
    expect(build({
      ...builderInput,
      committedEntries: [...parsed.committedEntries].reverse(),
      profiles: [...parsed.profiles].reverse()
    }).sha256).toBe(receipts[0]!.sha256);
  });

  it("leaves zero-match, duplicate-match, and unreachable-delta groups unreconciled", async () => {
    const prepared = await preparedReconciliation();
    const reconcile = (prepared.runtime as unknown as {
      reconcileCheckpoint(input: unknown): Promise<void>;
    }).reconcileCheckpoint.bind(prepared.runtime);
    const lifecycle = (
      committedEntries: readonly unknown[],
      committedCheckpoint: unknown = prepared.checkpoint
    ) => ({
      task: prepared.task,
      result: { kind: "checkpoint", checkpoint: committedCheckpoint },
      checkpointCommit: {
        checkpointed: true,
        providerWorkAvailable: false,
        committedTaskStatus: "QUEUED",
        committedCheckpoint,
        orderedCommit: { applied: true, runId: RUN_ID, committedEntries }
      },
      signal: new AbortController().signal
    });
    const entry = (canonicalSequence: number, artifactSha256: string) => ({
      canonicalSequence,
      taskId: `history-${canonicalSequence}`,
      acceptedAttemptId: `attempt-${canonicalSequence}`,
      artifactSha256
    });

    await reconcile(lifecycle([entry(1, "c".repeat(64))]));
    await reconcile({
      ...lifecycle([entry(1, "d".repeat(64))]),
      task: { ...prepared.task, attempt: 3 }
    });
    await reconcile({
      ...lifecycle([entry(1, "d".repeat(64))]),
      checkpointCommit: {
        ...lifecycle([entry(1, "d".repeat(64))]).checkpointCommit,
        committedTaskStatus: "CANCELLED",
        orderedCommit: {
          applied: false,
          runId: RUN_ID,
          committedEntries: []
        }
      }
    });
    await reconcile(lifecycle([
      entry(1, "d".repeat(64)),
      entry(2, "d".repeat(64))
    ]));
    const unreachable = delta(null, "unreachable");
    const unreachableSha256 = fingerprintCanonicalArtifact(unreachable);
    prepared.db.put(artifactRow(
      RUN_ID,
      "traversal_delta",
      "1",
      unreachable,
      unreachableSha256
    ));
    await reconcile(lifecycle(
      [entry(1, "d".repeat(64))],
      { ...prepared.checkpoint, deltaHeadSha256: unreachableSha256 }
    ));

    expect(prepared.db.rows().filter((row) =>
      row.kind === "service_role_shadow_runtime_receipt")).toEqual([]);
  });

  it.each(["numeric", "missing"] as const)(
    "rejects a candidate delta with %s previousDeltaHash before declaring it reachable",
    async (candidatePrevious) => {
      const prepared = await preparedReconciliation(candidatePrevious);
      await prepared.runtime.reconcileCheckpoint({
        task: prepared.task,
        result: { kind: "checkpoint", checkpoint: prepared.checkpoint },
        checkpointCommit: {
          checkpointed: true,
          providerWorkAvailable: false,
          committedTaskStatus: "QUEUED",
          committedCheckpoint: prepared.checkpoint,
          orderedCommit: {
            applied: true,
            runId: RUN_ID,
            committedEntries: [{
              canonicalSequence: 1,
              taskId: "history-matched",
              acceptedAttemptId: "attempt-matched",
              artifactSha256: "d".repeat(64)
            }]
          }
        },
        signal: new AbortController().signal
      });

      expect(prepared.db.rows().filter((row) =>
        row.kind === "service_role_shadow_runtime_receipt")).toEqual([]);
    }
  );
});
