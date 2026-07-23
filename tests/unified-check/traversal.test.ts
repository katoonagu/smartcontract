import { describe, expect, it } from "vitest";
import {
  buildTraversalClosureCertificate,
  buildTraversalCoverage,
  expandTraversalChunk,
  mergeTraversalStates,
  traversalStateId,
  type TraversalEventV1,
  type TraversalStateV1
} from "../../src/unifiedCheck/traversal";

const state = (
  direction: "backward" | "forward",
  episode = "episode-1"
): TraversalStateV1 => ({
  address: "subject",
  direction,
  anchorTimestamp: "2026-07-23T12:00:00.000Z",
  fundingEpisodeId: episode,
  allocatedAmountRaw: "100",
  sourceEventIds: []
});
const events: TraversalEventV1[] = [
  {
    id: "before-in",
    fromAddress: "source",
    toAddress: "subject",
    amountRaw: "100",
    timestamp: "2026-07-23T11:00:00.000Z"
  },
  {
    id: "after-out",
    fromAddress: "subject",
    toAddress: "destination",
    amountRaw: "100",
    timestamp: "2026-07-23T13:00:00.000Z"
  },
  {
    id: "wrong-time-in",
    fromAddress: "future",
    toAddress: "subject",
    amountRaw: "100",
    timestamp: "2026-07-23T13:00:00.000Z"
  }
];

describe("Unified finite traversal", () => {
  it("uses separate backward and forward amount/temporal predicates", () => {
    const backward = expandTraversalChunk({
      frontier: [state("backward")],
      events,
      expandedStateIds: new Set(),
      maxStatesThisChunk: 1,
      terminalReason: () => null,
      accountCreationExhausted: () => false
    });
    expect(backward.nextFrontier.map((item) => item.address)).toEqual(["source"]);
    const forward = expandTraversalChunk({
      frontier: [state("forward")],
      events,
      expandedStateIds: new Set(),
      maxStatesThisChunk: 1,
      terminalReason: () => null,
      accountCreationExhausted: () => false
    });
    expect(forward.nextFrontier.map((item) => item.address)).toEqual(["destination"]);
  });

  it("merges allocations but keeps funding episodes distinct", () => {
    const merged = mergeTraversalStates([
      { ...state("backward"), allocatedAmountRaw: "40", sourceEventIds: ["a"] },
      { ...state("backward"), allocatedAmountRaw: "60", sourceEventIds: ["b"] },
      state("backward", "episode-2")
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.fundingEpisodeId === "episode-1"))
      .toMatchObject({ allocatedAmountRaw: "100", sourceEventIds: ["a", "b"] });
    expect(traversalStateId(merged[0]!)).not.toBe(traversalStateId(merged[1]!));
  });

  it("expands a repeated state once and requires evidence for service terminality", () => {
    const initial = state("backward");
    const repeated = expandTraversalChunk({
      frontier: [initial],
      events,
      expandedStateIds: new Set([traversalStateId(initial)]),
      maxStatesThisChunk: 1,
      terminalReason: () => null,
      accountCreationExhausted: () => false
    });
    expect(repeated.processedStateIds).toEqual([]);
    expect(repeated.supersededStateIds).toEqual([traversalStateId(initial)]);

    expect(() => expandTraversalChunk({
      frontier: [initial],
      events,
      expandedStateIds: new Set(),
      maxStatesThisChunk: 1,
      terminalReason: () => ({
        reason: "identified_service_boundary",
        evidenceHash: "not-a-hash"
      }),
      accountCreationExhausted: () => false
    })).toThrow("unified_traversal_terminal_evidence_invalid");
  });

  it("counts unique ledger events instead of repeated candidate work", () => {
    const expanded = expandTraversalChunk({
      frontier: [
        state("backward", "episode-1"),
        state("backward", "episode-2")
      ],
      events: [events[0]!],
      expandedStateIds: new Set(),
      maxStatesThisChunk: 2,
      terminalReason: () => null,
      accountCreationExhausted: () => false
    });
    expect(expanded.processedStateIds).toHaveLength(2);
    expect(expanded.eligibleEventIds).toEqual(["before-in"]);
    expect(expanded.eligibleEventCount).toBe(1);
  });

  it("proves frontier-empty closure, structural bound and amount reconciliation", () => {
    const coverage = buildTraversalCoverage({
      selectedAmountRaw: "100",
      tracedAmountRaw: "80",
      identifiedAmountRaw: "60",
      unknownBoundaryRaw: "20"
    });
    const certificate = buildTraversalClosureCertificate({
      analysisManifestHash: "a".repeat(64),
      evidenceBundleHash: "b".repeat(64),
      snapshotHash: "c".repeat(64),
      visitedStates: [state("backward")],
      frontier: [],
      terminalStateIds: ["terminal"],
      supersededStateIds: [],
      unclassifiedCount: 0,
      droppedCount: 0,
      eligibleEventIds: Array.from(
        { length: 10 },
        (_, index) => `event-${index}`
      ),
      directionCount: 2,
      fundingEpisodeCount: 1,
      expandedStateCount: 20,
      allocatedInputRaw: "100",
      terminalRaw: "20",
      continuedRaw: "70",
      residualRaw: "10",
      backwardCoverage: coverage,
      forwardCoverage: coverage
    });
    expect(certificate.closed).toBe(true);
    expect(certificate.structuralStateBound).toBe(20);
    expect(certificate.eligibleEventCount).toBe(10);
    expect(certificate.eligibleEventIndexHash)
      .toMatch(/^[0-9a-f]{64}$/u);
    expect(certificate.backwardCoverage.traceCoverage).toBe(80);

    expect(() => buildTraversalClosureCertificate({
      ...certificate,
      analysisManifestHash: "a".repeat(64),
      evidenceBundleHash: "b".repeat(64),
      snapshotHash: "c".repeat(64),
      visitedStates: [],
      frontier: [state("forward")],
      terminalStateIds: [],
      supersededStateIds: [],
      unclassifiedCount: 0,
      droppedCount: 0,
      eligibleEventIds: ["event-1"],
      directionCount: 1,
      fundingEpisodeCount: 1,
      expandedStateCount: 1,
      allocatedInputRaw: "1",
      terminalRaw: "1",
      continuedRaw: "0",
      residualRaw: "0",
      backwardCoverage: coverage,
      forwardCoverage: coverage
    })).toThrow("unified_traversal_not_closed");
  });
});
