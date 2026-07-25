import { describe, expect, it } from "vitest";
import {
  allocateProviderSlots,
  calculateRepairMinimum,
  type ProviderRunDemand,
  type ProviderSlotAllocation
} from "../../src/unifiedCheck/fairProviderAllocator";

function readyRun(
  runId: string,
  ownerId: string,
  eligibleReadyWork: number,
  overrides: Partial<ProviderRunDemand> = {}
): ProviderRunDemand {
  return {
    runId,
    ownerId,
    lane: "interactive",
    eligibleReadyWork,
    ownerLastServedAtMs: 0,
    lastServedAtMs: 0,
    mergeBufferFull: false,
    providerAvailable: true,
    resourceGuarded: false,
    canonicalHeadEligible: false,
    ...overrides
  };
}

function noRepair() {
  return {
    repairShare: 0.1,
    repairMaxSlots: 4,
    repairMaxWaitChunks: 4,
    chunksSinceLastRepair: 0
  };
}

function slotCounts(allocations: readonly ProviderSlotAllocation[]): Record<string, number> {
  return Object.fromEntries(allocations
    .filter((allocation) => allocation.slots > 0)
    .map((allocation) => [allocation.runId, allocation.slots]));
}

describe("Unified fair provider allocator", () => {
  it("lets one ready run consume all safe capacity", () => {
    expect(slotCounts(allocateProviderSlots({
      capacity: 16,
      runs: [readyRun("a", "owner-a", 16)],
      repair: noRepair()
    }))).toEqual({ a: 16 });
  });

  it("splits surplus in repeated owner rounds", () => {
    expect(slotCounts(allocateProviderSlots({
      capacity: 16,
      runs: [
        readyRun("a", "owner-a", 16),
        readyRun("b", "owner-b", 16),
        readyRun("c", "owner-c", 16)
      ],
      repair: noRepair()
    }))).toEqual({ a: 6, b: 5, c: 5 });
  });

  it("is work-conserving when two runs can use only one slot", () => {
    expect(slotCounts(allocateProviderSlots({
      capacity: 16,
      runs: [
        readyRun("a", "owner-a", 1),
        readyRun("b", "owner-b", 1),
        readyRun("c", "owner-c", 16)
      ],
      repair: noRepair()
    }))).toEqual({ a: 1, b: 1, c: 14 });
  });

  it("gives a surplus slot to the least-recently-served run", () => {
    const runs = Array.from({ length: 15 }, (_, index) =>
      readyRun(`run-${String(index).padStart(2, "0")}`, `owner-${String(index).padStart(2, "0")}`, 2, {
        ownerLastServedAtMs: index === 7 ? 0 : 100 + index,
        lastServedAtMs: index === 7 ? 0 : 100 + index
      }));

    const counts = slotCounts(allocateProviderSlots({
      capacity: 16,
      runs,
      repair: noRepair()
    }));

    expect(Object.values(counts).reduce((sum, slots) => sum + slots, 0)).toBe(16);
    expect(counts["run-07"]).toBe(2);
  });

  it("shares capacity between owners before sharing within one owner's runs", () => {
    expect(slotCounts(allocateProviderSlots({
      capacity: 12,
      runs: [
        readyRun("a-1", "owner-a", 12),
        readyRun("a-2", "owner-a", 12),
        readyRun("b-1", "owner-b", 12)
      ],
      repair: noRepair()
    }))).toEqual({ "a-1": 3, "a-2": 3, "b-1": 6 });
  });

  it("does not reserve capacity for blocked runs and reports the actual blocker", () => {
    const allocations = allocateProviderSlots({
      capacity: 4,
      runs: [
        readyRun("none", "owner-a", 0),
        readyRun("buffer", "owner-b", 4, { mergeBufferFull: true }),
        readyRun("provider", "owner-c", 4, { providerAvailable: false }),
        readyRun("guard", "owner-d", 4, { resourceGuarded: true }),
        readyRun("ready", "owner-e", 4)
      ],
      repair: noRepair()
    });

    expect(slotCounts(allocations)).toEqual({ ready: 4 });
    expect(Object.fromEntries(allocations.map((allocation) => [allocation.runId, allocation.reason]))).toEqual({
      none: "no_ready_work",
      buffer: "merge_buffer_full",
      provider: "provider_unavailable",
      guard: "resource_guard",
      ready: "allocated"
    });
  });

  it("prefers an ordinarily eligible canonical head without bypassing owner fairness", () => {
    const allocations = allocateProviderSlots({
      capacity: 2,
      runs: [
        readyRun("head", "owner-a", 5, { canonicalHeadEligible: true, lastServedAtMs: 0 }),
        readyRun("not-head", "owner-a", 5, { lastServedAtMs: 10 }),
        readyRun("other-owner", "owner-b", 5)
      ],
      repair: noRepair()
    });

    expect(slotCounts(allocations)).toEqual({ head: 1, "other-owner": 1 });
    expect(allocations.find((allocation) => allocation.runId === "head")?.canonicalHeadPreferred).toBe(true);
    expect(allocations.find((allocation) => allocation.runId === "not-head")?.canonicalHeadPreferred).toBe(false);
  });

  it("does not let canonical-head preference reorder runs inside an owner's fair share", () => {
    const allocations = allocateProviderSlots({
      capacity: 1,
      runs: [
        readyRun("ordinary-old", "owner-a", 1, {
          lastServedAtMs: 0
        }),
        readyRun("head-new", "owner-a", 1, {
          lastServedAtMs: 100,
          canonicalHeadEligible: true
        })
      ],
      repair: noRepair()
    });

    expect(slotCounts(allocations)).toEqual({ "ordinary-old": 1 });
    expect(allocations.find((allocation) => allocation.runId === "head-new")?.canonicalHeadPreferred).toBe(false);
  });

  it("does not prefer an ineligible canonical head or preassign a provider group", () => {
    const allocations = allocateProviderSlots({
      capacity: 1,
      runs: [
        readyRun("head", "owner-a", 3, {
          canonicalHeadEligible: false,
          providerAvailable: false
        }),
        readyRun("ready", "owner-b", 3)
      ],
      repair: noRepair()
    });

    expect(slotCounts(allocations)).toEqual({ ready: 1 });
    expect(allocations.find((allocation) => allocation.runId === "head")?.canonicalHeadPreferred).toBe(false);
    expect(Object.keys(allocations[0] ?? {})).not.toContain("providerGroupId");
  });

  it("rotates runs by least-recently-served with deterministic owner and run ties", () => {
    const allocations = allocateProviderSlots({
      capacity: 2,
      runs: [
        readyRun("run-b", "owner-a", 1, { lastServedAtMs: 5 }),
        readyRun("run-a", "owner-a", 1, { lastServedAtMs: 5 }),
        readyRun("run-c", "owner-b", 1, { lastServedAtMs: 0 })
      ],
      repair: noRepair()
    });

    expect(slotCounts(allocations)).toEqual({ "run-a": 1, "run-c": 1 });
  });

  it("uses the explicit owner service clock across capacity-one chunks", () => {
    const first = allocateProviderSlots({
      capacity: 1,
      runs: [
        readyRun("run-a", "owner-a", 1, { ownerLastServedAtMs: 0 }),
        readyRun("run-b", "owner-b", 1, { ownerLastServedAtMs: 10 })
      ],
      repair: noRepair()
    });
    expect(slotCounts(first)).toEqual({ "run-a": 1 });

    const second = allocateProviderSlots({
      capacity: 1,
      runs: [
        readyRun("run-a", "owner-a", 1, { ownerLastServedAtMs: 20 }),
        readyRun("run-b", "owner-b", 1, { ownerLastServedAtMs: 10 })
      ],
      repair: noRepair()
    });
    expect(slotCounts(second)).toEqual({ "run-b": 1 });
  });

  it("scans a stable run order when a run exhausts inside an owner round", () => {
    expect(slotCounts(allocateProviderSlots({
      capacity: 2,
      runs: [
        readyRun("a", "owner-a", 1),
        readyRun("b", "owner-a", 1),
        readyRun("c", "owner-a", 1)
      ],
      repair: noRepair()
    }))).toEqual({ a: 1, b: 1 });
  });

  it("calculates a bounded repair minimum and lends it when repair has no work", () => {
    expect(calculateRepairMinimum({
      effectiveCapacity: 16,
      readyRepairWork: 20,
      repairShare: 0.2,
      repairMaxSlots: 3
    })).toBe(3);

    expect(slotCounts(allocateProviderSlots({
      capacity: 4,
      runs: [readyRun("interactive", "owner-a", 4)],
      repair: noRepair()
    }))).toEqual({ interactive: 4 });
  });

  it("reclaims repair capacity at an allocation boundary and keeps lane fairness", () => {
    expect(slotCounts(allocateProviderSlots({
      capacity: 6,
      runs: [
        readyRun("interactive", "owner-i", 6),
        readyRun("repair-a", "owner-r", 6, { lane: "repair" }),
        readyRun("repair-b", "owner-r", 6, { lane: "repair" })
      ],
      repair: {
        repairShare: 0.34,
        repairMaxSlots: 3,
        repairMaxWaitChunks: 4,
        chunksSinceLastRepair: 0
      }
    }))).toEqual({ interactive: 3, "repair-a": 2, "repair-b": 1 });
  });

  it("gives repair bounded progress at capacity one without permanently taking the slot", () => {
    const runs = [
      readyRun("interactive", "owner-i", 1),
      readyRun("repair", "owner-r", 1, { lane: "repair" })
    ];

    expect(slotCounts(allocateProviderSlots({
      capacity: 1,
      runs,
      repair: { ...noRepair(), repairMaxWaitChunks: 3, chunksSinceLastRepair: 2 }
    }))).toEqual({ interactive: 1 });

    expect(slotCounts(allocateProviderSlots({
      capacity: 1,
      runs,
      repair: { ...noRepair(), repairMaxWaitChunks: 3, chunksSinceLastRepair: 3 }
    }))).toEqual({ repair: 1 });
  });

  it("uses background only after interactive and required repair cannot fill capacity", () => {
    expect(slotCounts(allocateProviderSlots({
      capacity: 5,
      runs: [
        readyRun("interactive", "owner-i", 1),
        readyRun("repair", "owner-r", 1, { lane: "repair" }),
        readyRun("background", "owner-b", 5, { lane: "background" })
      ],
      repair: { ...noRepair(), repairShare: 0.2 }
    }))).toEqual({ interactive: 1, repair: 1, background: 3 });
  });
});
