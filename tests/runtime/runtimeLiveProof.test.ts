import { describe, expect, it } from "vitest";
import { buildRuntimeVersion } from "../../src/runtime/runtimeVersion";
import {
  createRuntimeCycleRecorder,
  runAckBeforeDeferredWork,
  runRuntimeNavigationProbeV1
} from "../../src/runtime/runtimeLiveProof";

const SHA = "a".repeat(40);
const CHECKSUM = "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d";

function runtimeVersion() {
  return buildRuntimeVersion({
    gitCommitSha: SHA,
    runtimeInstanceLabel: `candidate-${SHA.slice(0, 8)}`,
    migration: {
      verified: true,
      version: 32,
      filename: "032_telegram_runtime_forensics_data_contracts.sql",
      checksumSha256: CHECKSUM,
      shortChecksum: CHECKSUM.slice(0, 12)
    }
  });
}

describe("runtime live proof", () => {
  it("emits a typed completion only after an actual cycle succeeds", async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const times = [
      new Date("2026-07-19T10:00:00.000Z"),
      new Date("2026-07-19T10:00:00.125Z"),
      new Date("2026-07-19T10:00:01.000Z"),
      new Date("2026-07-19T10:00:01.010Z")
    ];
    const recorder = createRuntimeCycleRecorder({
      runtimeVersion: runtimeVersion(),
      now: () => times.shift()!,
      logger: { info: (event, fields) => events.push({ event, fields }) }
    });

    const first = recorder.start("forensic_delivery");
    first.complete({ sourceQueryCompleted: true, examinedCount: 10, completedCount: 0 });
    const failed = recorder.start("allowance_refresh");
    failed.fail();

    expect(events).toEqual([{
      event: "runtime_cycle_completed",
      fields: {
        runtimeSha: SHA,
        cycle: "forensic_delivery",
        sequence: 1,
        startedAt: "2026-07-19T10:00:00.000Z",
        finishedAt: "2026-07-19T10:00:00.125Z",
        durationMs: 125,
        sourceQueryCompleted: true,
        examinedCount: 10,
        completedCount: 0
      }
    }]);
    expect(recorder.proof().cycleHighWatermarks.forensic_delivery).toEqual({
      sequence: 1,
      completedAt: "2026-07-19T10:00:00.125Z"
    });
    expect(recorder.proof().cycleHighWatermarks.allowance_refresh).toBeNull();
  });

  it("rejects impossible completion counts without advancing the high watermark", () => {
    const recorder = createRuntimeCycleRecorder({
      runtimeVersion: runtimeVersion(),
      logger: { info: () => undefined }
    });
    expect(() => recorder.start("poll").complete({
      sourceQueryCompleted: true,
      examinedCount: 0,
      completedCount: 1
    })).toThrow("runtime_cycle_completed_count_exceeds_examined");
    expect(recorder.proof().cycleHighWatermarks.poll).toBeNull();
  });

  it("keeps cache reads provider-free and requires one real explicit refresh", async () => {
    let providerCalls = 0;
    const proof = await runRuntimeNavigationProbeV1({
      runtimeVersion: runtimeVersion(),
      providerCallCount: () => providerCalls,
      readCachedDashboard: async () => "stale",
      refreshDashboard: async () => {
        providerCalls += 1;
        return "fresh";
      },
      now: () => new Date("2026-07-19T10:15:00.000Z")
    });

    expect(proof).toMatchObject({
      version: "runtime-navigation-probe-v1",
      runtimeSha: SHA,
      cacheOnly: { reads: 2, providerCalls: 0, sources: ["stale", "stale"] },
      explicitRefresh: { attempts: 1, providerCalls: 1, completed: true },
      callback: { ackCompleted: true, ackBeforeWork: true, returnedWhileWorkPending: true },
      telegramTransport: "absent"
    });
  });

  it("fails closed when cache is absent or explicit refresh does not call the provider", async () => {
    await expect(runRuntimeNavigationProbeV1({
      runtimeVersion: runtimeVersion(),
      providerCallCount: () => 0,
      readCachedDashboard: async () => null,
      refreshDashboard: async () => "fresh"
    })).rejects.toThrow("runtime_probe_cached_wallet_unavailable");

    await expect(runRuntimeNavigationProbeV1({
      runtimeVersion: runtimeVersion(),
      providerCallCount: () => 0,
      readCachedDashboard: async () => "cache",
      refreshDashboard: async () => "fresh"
    })).rejects.toThrow("runtime_probe_explicit_refresh_unverified");
  });

  it("returns the acknowledged callback prelude while its deferred work is pending", async () => {
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const prelude = await runAckBeforeDeferredWork(
      async () => { events.push("ack"); },
      () => {
        events.push("work");
        return deferred;
      }
    );

    expect(events).toEqual(["ack", "work"]);
    expect(prelude.workSettled()).toBe(false);
    release();
    await prelude.work;
    expect(prelude.workSettled()).toBe(true);
  });
});
