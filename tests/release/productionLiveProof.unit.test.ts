import { describe, expect, it } from "vitest";
import {
  deriveVerifiedProductionChecksV2,
  inspectRuntimeDiagnosticLogsV2,
  queryProductionRuntimeInvariantsV2,
  type ProductionLiveProofSnapshotV2
} from "../../src/release/productionOperationAdaptersV2";

const candidateSha = "a".repeat(40);
const previousSha = "b".repeat(40);

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
    ...overrides
  };
}

describe("production live proof", () => {
  it("queries every production runtime invariant from one read-only snapshot", async () => {
    const query = async (text: string): Promise<{ rows: unknown[] }> => {
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
    const stdout = [
      JSON.stringify({ level: "info", event: "startup_work_schedule_started", timestamp: "2026-07-19T00:00:00.000Z",
        schedule: ["poll", "where_forensic", "incoming_deposit", "deep_forensic", "address_index", "address_poisoning"]
          .map((label) => ({ label, delayMs: 0 })) }),
      JSON.stringify({ level: "info", event: "bot_started", timestamp: "2026-07-19T00:00:01.000Z" })
    ].join("\n") + "\n";
    expect(inspectRuntimeDiagnosticLogsV2(stdout, "")).toEqual({
      workerScheduleCount: 1,
      botStartedCount: 1,
      fatalLogCount: 0,
      secretDetected: false
    });
    expect(() => inspectRuntimeDiagnosticLogsV2(stdout,
      JSON.stringify({ level: "error", event: "runtime_failed", timestamp: "2026-07-19T00:00:02.000Z" }) + "\n"))
      .toThrow(/fatal|error/i);
    expect(() => inspectRuntimeDiagnosticLogsV2(`${stdout}BOT_TOKEN=123456789:${"x".repeat(35)}\n`, ""))
      .toThrow(/secret/i);
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
