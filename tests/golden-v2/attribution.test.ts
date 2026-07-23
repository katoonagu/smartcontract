import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  compareAttributionPolicies,
  type AttributionInput,
  type AttributionResult
} from "../../tools/golden-pilot-v2/attribution";
import { dense500PageAttributionInput } from "../fixtures/golden-v2/dense500PageFixture";

const input: AttributionInput = {
  inbound: [
    {
      eventId: "old",
      amountRaw: "600000000",
      timestamp: "2026-01-01T00:00:00.000Z"
    },
    {
      eventId: "mid",
      amountRaw: "300000000",
      timestamp: "2026-01-02T00:00:00.000Z"
    },
    {
      eventId: "new",
      amountRaw: "100000000",
      timestamp: "2026-01-03T00:00:00.000Z"
    }
  ],
  selectedAmountRaw: "500000000"
};

function allocationMap(result: AttributionResult): Record<string, string> {
  return Object.fromEntries(
    result.allocations.map((allocation) => [
      allocation.eventId,
      allocation.allocatedRaw
    ])
  );
}

function expectConservation(
  result: AttributionResult,
  source: AttributionInput
): void {
  const sourceAmounts = new Map(
    source.inbound.map((event) => [event.eventId, BigInt(event.amountRaw)])
  );
  const allocated = result.allocations.reduce(
    (sum, allocation) => sum + BigInt(allocation.allocatedRaw),
    0n
  );
  expect(allocated.toString()).toBe(result.allocatedAmountRaw);
  expect(
    allocated + BigInt(result.residualAmountRaw)
  ).toBe(BigInt(source.selectedAmountRaw));
  for (const allocation of result.allocations) {
    expect(BigInt(allocation.allocatedRaw)).toBeGreaterThanOrEqual(0n);
    expect(BigInt(allocation.allocatedRaw)).toBeLessThanOrEqual(
      sourceAmounts.get(allocation.eventId)!
    );
  }
}

describe("Golden V2 attribution comparison", () => {
  it("compares FIFO, LIFO and proportional allocation exactly", () => {
    const result = compareAttributionPolicies(input);

    expect(allocationMap(result.fifo)).toEqual({ old: "500000000" });
    expect(allocationMap(result.lifo)).toEqual({
      new: "100000000",
      mid: "300000000",
      old: "100000000"
    });
    expect(allocationMap(result.proportional)).toEqual({
      mid: "150000000",
      new: "50000000",
      old: "300000000"
    });
    for (const policy of Object.values(result)) {
      expectConservation(policy, input);
    }
  });

  it("is invariant to input order and does not mutate the ledger", () => {
    const original = structuredClone(input);
    const reordered = {
      ...input,
      inbound: [...input.inbound].reverse()
    };

    expect(compareAttributionPolicies(reordered)).toEqual(
      compareAttributionPolicies(input)
    );
    expect(input).toEqual(original);
  });

  it("rejects duplicate event IDs", () => {
    expect(() =>
      compareAttributionPolicies({
        ...input,
        inbound: [...input.inbound, { ...input.inbound[0]! }]
      })
    ).toThrow("golden_duplicate_attribution_event_id:old");
  });

  it("conserves all policies for a generated 500-page dense ledger", () => {
    const dense = dense500PageAttributionInput();
    const originalFirst = { ...dense.inbound[0]! };
    const startedAt = performance.now();
    const result = compareAttributionPolicies(dense);
    const diagnosticDurationMs = performance.now() - startedAt;

    expect(dense.inbound).toHaveLength(100_000);
    for (const policy of Object.values(result)) {
      expectConservation(policy, dense);
    }
    expect(dense.inbound[0]).toEqual(originalFirst);
    expect(diagnosticDurationMs).toBeGreaterThanOrEqual(0);
  });
});
