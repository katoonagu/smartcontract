import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { task0BBoundedProbeTimeoutMs } from "../../scripts/captureTask0BPreflight";
import {
  deriveVerifiedProductionChecksV2,
  inspectRuntimeDiagnosticLogsV2,
  runtimeStartupReadyDeadlineV2,
  assertRuntimeStartupCyclesReadyV2,
  waitForRuntimeCycleSnapshotV2,
  productionObservationHardDeadlineV2,
  runWithinProductionObservationBoundV2,
  queryProductionRuntimeInvariantsV2,
  verifyProductionDatabaseSnapshotBindingV2,
  validateProductionRuntimeNavigationProbeV1,
  validateProductionRuntimeProofV1,
  type ProductionLiveProofSnapshotV2
} from "../../src/release/productionOperationAdaptersV2";

const candidateSha = "a".repeat(40);
const previousSha = "b".repeat(40);
const cycleNames = ["poll", "where_forensic", "incoming_deposit", "deep_forensic", "address_index",
  "wait_reconciliation", "forensic_delivery", "allowance_refresh"] as const;

async function runtimeProof(sequence: number) {
  const { buildRuntimeVersion, formatRuntimeVersion } = await import("../../src/runtime/runtimeVersion");
  const runtime = buildRuntimeVersion({
    gitCommitSha: candidateSha,
    runtimeInstanceLabel: `candidate-${candidateSha.slice(0, 8)}`,
    migration: { verified: true, version: 32, filename: "032_telegram_runtime_forensics_data_contracts.sql",
      checksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
      shortChecksum: "41217f64c33c" }
  });
  return { version: "runtime-proof-v1", runtimeVersion: runtime,
    runtimeVersionSha256: createHash("sha256").update(JSON.stringify(runtime)).digest("hex"),
    formattedRuSha256: createHash("sha256").update(formatRuntimeVersion(runtime, "ru")).digest("hex"),
    formattedEnSha256: createHash("sha256").update(formatRuntimeVersion(runtime, "en")).digest("hex"),
    cycleHighWatermarks: Object.fromEntries(cycleNames.map((cycle) => [cycle,
      sequence === 0 ? null : { sequence, completedAt: "2026-07-19T00:00:02.000Z" }])) };
}

function snapshot(overrides: Partial<ProductionLiveProofSnapshotV2> = {}): ProductionLiveProofSnapshotV2 {
  return {
    schemaState: "schema_032_verified",
    schemaChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
    runtimeSha: candidateSha,
    adminStatus: 200,
    runtimeProcessCount: 1,
    workerScheduleCount: 1,
    botStartedCount: 1,
    fatalLogCount: 0,
    secretDetected: false,
    deliveryInvariantViolationCount: 0,
    terminalLegacyUnchanged: true,
    reconciliationStrandedCount: 0,
    navigationStatus: 200,
    allowanceMirrorMismatchCount: 0,
    queueGrowthCount: 0,
    honestLimitViolationCount: 0,
    sentFingerprintDuplicateCount: 0,
    runtimeCycleHighWatermarksVerified: true,
    ...overrides
  };
}

describe("production live proof", () => {
  it("rechecks production identity and schema 032 on the same read-only snapshot queryable", async () => {
    const calls: string[] = [];
    const db = {
      async query(text: string): Promise<{ rows: any[] }> {
        calls.push(text);
        if (text.includes("current_database")) return { rows: [{
          database_name: "tron_watch", server_port: 55999, server_version_num: "170005", database_oid: "16384"
        }] };
        if (text.includes("pg_control_system")) return { rows: [{ system_identifier: "7531667044074094209" }] };
        if (text === "schema_probe") return { rows: [] };
        throw new Error(`unexpected query:${text}`);
      }
    };
    await expect(verifyProductionDatabaseSnapshotBindingV2(db, {
      databaseName: "tron_watch",
      connectedServerPort: 55999,
      serverVersionNum: "170005",
      databaseOid: "16384",
      systemIdentifier: "7531667044074094209"
    }, async (queryable) => {
      expect(queryable).toBe(db);
      await queryable.query("schema_probe");
      return {
        verified: true as const,
        version: 32 as const,
        filename: "032_telegram_runtime_forensics_data_contracts.sql" as const,
        checksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
        shortChecksum: "41217f64c33c"
      };
    })).resolves.toMatchObject({ verified: true, version: 32 });
    expect(calls.map((text) => text === "schema_probe" ? "schema" : text.includes("current_database") ? "identity"
      : text.includes("pg_control_system") ? "cluster" : "other")).toEqual(["identity", "cluster", "schema"]);
    await expect(verifyProductionDatabaseSnapshotBindingV2(db, {
      databaseName: "tron_watch",
      connectedServerPort: 55999,
      serverVersionNum: "170005",
      databaseOid: "16384",
      systemIdentifier: "7531667044074094209"
    }, async () => ({
      verified: true,
      version: 32,
      filename: "032_telegram_runtime_forensics_data_contracts.sql",
      checksumSha256: "f".repeat(64),
      shortChecksum: "f".repeat(12)
    }))).rejects.toThrow(/schema/i);
  });

  it("queries every production runtime invariant from one read-only snapshot", async () => {
    const query = async (text: string): Promise<{ rows: Record<string, unknown>[] }> => {
      if (text.includes("mirror_valid")) return { rows: [{ count: 0 }] };
      if (text.includes("delivery_invalid")) return { rows: [{ count: 0 }] };
      if (text.includes("reconciliation_stranded")) return { rows: [{ count: 0 }] };
      if (text.includes("queue_population")) return { rows: [{ count: 7 }] };
      if (text.includes("honest_limit_invalid")) return { rows: [{ count: 0 }] };
      if (text.includes("sent_fingerprint_duplicate")) return { rows: [{ count: 0 }] };
      throw new Error(`unexpected query:${text}`);
    };
    await expect(queryProductionRuntimeInvariantsV2({ query })).resolves.toEqual({
      allowanceMirrorMismatchCount: 0,
      deliveryInvariantViolationCount: 0,
      reconciliationStrandedCount: 0,
      queuePopulationCount: 7,
      honestLimitViolationCount: 0,
      sentFingerprintDuplicateCount: 0
    });
  });

  it("derives worker and fatal-log proof from exact manager-owned JSONL", () => {
    const cycles = ["poll", "where_forensic", "incoming_deposit", "deep_forensic", "address_index",
      "wait_reconciliation", "forensic_delivery", "allowance_refresh"];
    const stdout = [
      JSON.stringify({ level: "info", event: "startup_work_schedule_started", timestamp: "2026-07-19T00:00:00.000Z",
        schedule: ["poll", "where_forensic", "incoming_deposit", "deep_forensic", "address_index", "address_poisoning"]
          .map((label) => ({ label, delayMs: 0 })) }),
      JSON.stringify({ level: "info", event: "bot_started", timestamp: "2026-07-19T00:00:01.000Z" }),
      ...cycles.map((cycle, index) => JSON.stringify({ level: "info", event: "runtime_cycle_completed",
        timestamp: `2026-07-19T00:00:${String(index + 2).padStart(2, "0")}.000Z`, runtimeSha: candidateSha,
        cycle, sequence: 1, startedAt: `2026-07-19T00:00:${String(index + 2).padStart(2, "0")}.000Z`,
        finishedAt: `2026-07-19T00:00:${String(index + 2).padStart(2, "0")}.000Z`, durationMs: 0,
        sourceQueryCompleted: true, examinedCount: 0, completedCount: 0 }))
    ].join("\n") + "\n";
    expect(inspectRuntimeDiagnosticLogsV2(stdout, "", candidateSha)).toEqual({
      workerScheduleCount: 1,
      botStartedCount: 1,
      fatalLogCount: 0,
      secretDetected: false,
      cycleHighWatermarks: Object.fromEntries(cycles.map((cycle) => [cycle, 1])),
      startupMaximumDelayMs: 0,
      botStartedAt: "2026-07-19T00:00:01.000Z"
    });
    expect(() => inspectRuntimeDiagnosticLogsV2(stdout,
      JSON.stringify({ level: "error", event: "runtime_failed", timestamp: "2026-07-19T00:00:02.000Z" }) + "\n"))
      .toThrow(/fatal|error/i);
    expect(() => inspectRuntimeDiagnosticLogsV2(`${stdout}BOT_TOKEN=123456789:${"x".repeat(35)}\n`, ""))
      .toThrow(/secret/i);
  });

  it("derives a bounded startup window from the validated 12s schedule and fails closed on a missing cycle", () => {
    const deadline = runtimeStartupReadyDeadlineV2("2026-07-19T00:00:01.000Z", 12_000,
      "2026-07-19T00:01:00.000Z");
    expect(deadline).toBe("2026-07-19T00:00:28.000Z");
    const watermarks = Object.fromEntries(["poll", "where_forensic", "incoming_deposit", "deep_forensic",
      "address_index", "wait_reconciliation", "forensic_delivery", "allowance_refresh"]
      .map((cycle) => [cycle, cycle === "deep_forensic" ? 0 : 1])) as any;
    expect(assertRuntimeStartupCyclesReadyV2(watermarks, "2026-07-19T00:00:27.999Z", deadline)).toBe(false);
    expect(() => assertRuntimeStartupCyclesReadyV2(watermarks, deadline, deadline)).toThrow(/timeout/i);
  });

  it("retries a delayed G14 typed proof only inside the startup schedule bound", async () => {
    let now = Date.parse("2026-07-19T00:00:01.000Z");
    let reads = 0;
    const snapshot = await waitForRuntimeCycleSnapshotV2({
      candidateSha,
      baseline: null,
      readyDeadlineAt: "2026-07-19T00:00:28.000Z",
      nowMs: () => now,
      sleep: async (ms) => { now += ms; },
      readProof: async () => runtimeProof(++reads < 3 ? 0 : 1)
    });
    expect(reads).toBe(3);
    expect(snapshot).toEqual(Object.fromEntries(cycleNames.map((cycle) => [cycle, 1])));
  });

  it("allows the G15 proof to advance after fifteen minutes but fails closed at its operation deadline", async () => {
    const started = Date.parse("2026-07-19T00:00:00.000Z");
    let now = started;
    const baseline = Object.fromEntries(cycleNames.map((cycle) => [cycle, 1])) as any;
    const snapshot = await waitForRuntimeCycleSnapshotV2({
      candidateSha,
      baseline,
      readyDeadlineAt: "2026-07-19T00:20:00.000Z",
      nowMs: () => now,
      sleep: async () => { now += 5 * 60_000; },
      readProof: async () => runtimeProof(now - started >= 15 * 60_000 ? 2 : 1)
    });
    expect(now - started).toBe(15 * 60_000);
    expect(snapshot).toEqual(Object.fromEntries(cycleNames.map((cycle) => [cycle, 2])));

    now = started;
    await expect(waitForRuntimeCycleSnapshotV2({
      candidateSha,
      baseline,
      readyDeadlineAt: "2026-07-19T00:10:00.000Z",
      nowMs: () => now,
      sleep: async () => { now += 5 * 60_000; },
      readProof: async () => runtimeProof(1)
    })).rejects.toThrow(/advance.*timeout/i);
  });

  it("uses the earlier operation or claim bound and never observes at equality", async () => {
    expect(productionObservationHardDeadlineV2(
      "2026-07-19T00:20:00.000Z", "2026-07-19T00:25:00.000Z"
    )).toBe("2026-07-19T00:20:00.000Z");
    expect(productionObservationHardDeadlineV2(
      "2026-07-19T00:25:00.000Z", "2026-07-19T00:20:00.000Z"
    )).toBe("2026-07-19T00:20:00.000Z");
    for (const readyDeadlineAt of [
      productionObservationHardDeadlineV2(
        "2026-07-19T00:20:00.000Z", "2026-07-19T00:25:00.000Z"),
      productionObservationHardDeadlineV2(
        "2026-07-19T00:25:00.000Z", "2026-07-19T00:20:00.000Z")
    ]) {
      let readsAtEquality = 0;
      await expect(waitForRuntimeCycleSnapshotV2({
        candidateSha,
        baseline: Object.fromEntries(cycleNames.map((cycle) => [cycle, 1])) as any,
        readyDeadlineAt,
        nowMs: () => Date.parse(readyDeadlineAt),
        sleep: async () => undefined,
        readProof: async () => { readsAtEquality += 1; return runtimeProof(1); }
      })).rejects.toThrow(/advance.*timeout/i);
      expect(readsAtEquality).toBe(0);
    }
  });

  it("caps every production observation timeout to the remaining strict authority/deadline budget", async () => {
    let now = Date.parse("2026-07-19T00:00:00.000Z");
    const configuredTimeouts: number[] = [];
    await expect(runWithinProductionObservationBoundV2({
      hardDeadlineAt: "2026-07-19T00:00:00.250Z",
      configuredTimeoutMs: 10_000,
      nowMs: () => now,
      async run(timeoutMs) {
        configuredTimeouts.push(timeoutMs);
        now += 249;
        return "ok";
      }
    })).resolves.toBe("ok");
    expect(configuredTimeouts).toEqual([250]);
    expect(task0BBoundedProbeTimeoutMs({
      hardDeadlineAt: "2026-07-19T00:00:00.250Z",
      configuredTimeoutMs: 10_000,
      nowMs: () => Date.parse("2026-07-19T00:00:00.001Z")
    })).toBe(249);
    expect(() => task0BBoundedProbeTimeoutMs({
      hardDeadlineAt: "2026-07-19T00:00:00.250Z",
      configuredTimeoutMs: 10_000,
      nowMs: () => Date.parse("2026-07-19T00:00:00.250Z")
    })).toThrow(/probe.*bound/i);
  });

  it("does not start HTTP or PostgreSQL observation at equality and rejects cross-bound completion", async () => {
    const deadline = "2026-07-19T00:00:00.250Z";
    let now = Date.parse(deadline);
    let calls = 0;
    await expect(runWithinProductionObservationBoundV2({
      hardDeadlineAt: deadline,
      configuredTimeoutMs: 15_000,
      nowMs: () => now,
      async run() { calls += 1; return "unreachable"; }
    })).rejects.toThrow(/observation.*bound/i);
    expect(calls).toBe(0);

    now -= 1;
    await expect(runWithinProductionObservationBoundV2({
      hardDeadlineAt: deadline,
      configuredTimeoutMs: 15_000,
      nowMs: () => now,
      async run() { calls += 1; now += 1; return "late"; }
    })).rejects.toThrow(/observation.*bound/i);
    expect(calls).toBe(1);
  });

  it("validates exact runtime and navigation response schemas and hash bindings", async () => {
    const runtime = (await import("../../src/runtime/runtimeVersion")).buildRuntimeVersion({
      gitCommitSha: candidateSha,
      runtimeInstanceLabel: `candidate-${candidateSha.slice(0, 8)}`,
      migration: { verified: true, version: 32, filename: "032_telegram_runtime_forensics_data_contracts.sql",
        checksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
        shortChecksum: "41217f64c33c" }
    });
    const { formatRuntimeVersion } = await import("../../src/runtime/runtimeVersion");
    const watermarks = Object.fromEntries(["poll", "where_forensic", "incoming_deposit", "deep_forensic",
      "address_index", "wait_reconciliation", "forensic_delivery", "allowance_refresh"]
      .map((cycle) => [cycle, { sequence: 1, completedAt: "2026-07-19T00:00:02.000Z" }]));
    const proof = { version: "runtime-proof-v1", runtimeVersion: runtime,
      runtimeVersionSha256: createHash("sha256").update(JSON.stringify(runtime)).digest("hex"),
      formattedRuSha256: createHash("sha256").update(formatRuntimeVersion(runtime, "ru")).digest("hex"),
      formattedEnSha256: createHash("sha256").update(formatRuntimeVersion(runtime, "en")).digest("hex"),
      cycleHighWatermarks: watermarks };
    expect(validateProductionRuntimeProofV1(proof, candidateSha).runtimeVersion.gitCommitSha).toBe(candidateSha);
    expect(() => validateProductionRuntimeProofV1({ ...proof, formattedRuSha256: "0".repeat(64) }, candidateSha))
      .toThrow(/hash/i);
    const navigation = { version: "runtime-navigation-probe-v1", runtimeSha: candidateSha,
      cacheOnly: { reads: 2, providerCalls: 0, sources: ["cache", "stale"] },
      explicitRefresh: { attempts: 1, providerCalls: 1, completed: true },
      telegramTransport: "absent", completedAt: "2026-07-19T00:15:00.000Z" };
    expect(validateProductionRuntimeNavigationProbeV1(navigation, candidateSha).runtimeSha).toBe(candidateSha);
    expect(() => validateProductionRuntimeNavigationProbeV1({ ...navigation,
      explicitRefresh: { ...navigation.explicitRefresh, providerCalls: 0 } }, candidateSha)).toThrow(/navigation/i);
  });

  it("derives rollout checks only from a fresh candidate runtime proof", () => {
    expect(deriveVerifiedProductionChecksV2("rollout", snapshot(), { candidateSha, previousSha })).toEqual([
      "schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"
    ]);
    expect(() => deriveVerifiedProductionChecksV2("rollout",
      snapshot({ runtimeSha: previousSha }), { candidateSha, previousSha })).toThrow(/runtime.*sha|version/i);
  });

  it("requires every canary probe and rejects stale schema or one unproved invariant", () => {
    expect(deriveVerifiedProductionChecksV2("canary", snapshot(), { candidateSha, previousSha })).toEqual([
      "schema", "version", "admin", "singleton", "reconciliation", "delivery", "navigation",
      "allowance", "legacy", "secrets", "queues", "honest_limits"
    ]);
    for (const invalid of [
      { schemaState: "legacy_031" as const },
      { schemaChecksumSha256: "f".repeat(64) },
      { deliveryInvariantViolationCount: 1 },
      { terminalLegacyUnchanged: false },
      { allowanceMirrorMismatchCount: 1 },
      { queueGrowthCount: 1 },
      { honestLimitViolationCount: 1 },
      { secretDetected: true }
    ]) {
      expect(() => deriveVerifiedProductionChecksV2("canary", snapshot(invalid),
        { candidateSha, previousSha })).toThrow();
    }
  });

  it("derives rollback checks only for the exact previous runtime and unchanged safety state", () => {
    expect(deriveVerifiedProductionChecksV2("rollback", snapshot({ runtimeSha: previousSha }),
      { candidateSha, previousSha })).toEqual([
      "schema032_retained", "previous_version", "admin", "singleton", "allowance", "legacy", "sent",
      "no_duplicate_send"
    ]);
    expect(() => deriveVerifiedProductionChecksV2("rollback", snapshot(),
      { candidateSha, previousSha })).toThrow(/runtime.*sha|version/i);
    expect(() => deriveVerifiedProductionChecksV2("rollback",
      snapshot({ runtimeSha: previousSha, sentFingerprintDuplicateCount: 1 }),
      { candidateSha, previousSha })).toThrow(/duplicate/i);
  });
});
