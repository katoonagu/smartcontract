import { describe, expect, it } from "vitest";
import { traversalStateId } from "../../src/unifiedCheck/traversal";
import {
  appendTraversalDelta,
  initialTraversalCheckpointV2,
  replayTraversalDeltas,
  upgradeTraversalCheckpointV1
} from "../../src/unifiedCheck/traversalDelta";
import type { TraversalStateV1 } from "../../src/unifiedCheck/traversal";

const BINDINGS = {
  analysisManifestHash: "1".repeat(64),
  snapshotHash: "2".repeat(64)
} as const;

function state(
  address: string,
  episode: string,
  amountRaw = "100"
): TraversalStateV1 {
  return {
    address,
    direction: "backward",
    anchorTimestamp: "2026-07-24T00:00:00.000Z",
    fundingEpisodeId: episode,
    allocatedAmountRaw: amountRaw,
    sourceEventIds: [`source:${episode}`]
  };
}

const STATE_A = state("TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV", "episode:a");
const STATE_B = state("TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr", "episode:b");

describe("Unified traversal delta chain", () => {
  it("replays deltas to the same coordinator state", () => {
    const initial = initialTraversalCheckpointV2(BINDINGS);
    const one = appendTraversalDelta(initial, {
      addedFrontier: [STATE_A],
      removedFrontierStateIds: [],
      addedVisited: [],
      addedTerminals: [],
      addedSupersededStateIds: [],
      addedExpandedStateIds: [],
      addedEligibleEventIds: [],
      addedExpandedStateKeys: [],
      counterDeltas: { expanded: 0, terminal: 0, superseded: 0 },
      operational: {
        frontierCount: 1,
        frontierPeak: 1,
        uniqueAddresses: 1,
        fundingEpisodes: 1
      }
    });
    const two = appendTraversalDelta(one.checkpoint, {
      addedFrontier: [STATE_B],
      removedFrontierStateIds: [traversalStateId(STATE_A)],
      addedVisited: [STATE_A],
      addedTerminals: [],
      addedSupersededStateIds: [],
      addedExpandedStateIds: [traversalStateId(STATE_A)],
      addedEligibleEventIds: ["event:b", "event:a"],
      addedExpandedStateKeys: ["expansion:a"],
      counterDeltas: { expanded: 1, terminal: 0, superseded: 0 },
      operational: {
        frontierCount: 1,
        frontierPeak: 2,
        uniqueAddresses: 2,
        fundingEpisodes: 2
      }
    });

    const replayed = replayTraversalDeltas([one.artifact, two.artifact]);

    expect(replayed.frontier).toEqual([STATE_B]);
    expect(replayed.visited).toEqual([STATE_A]);
    expect(replayed.counters).toEqual({
      expanded: 1,
      terminal: 0,
      superseded: 0
    });
    expect(replayed.expandedStateIds).toEqual([traversalStateId(STATE_A)]);
    expect(replayed.eligibleEventIds).toEqual(["event:a", "event:b"]);
    expect(replayed.expandedStateKeys).toEqual(["expansion:a"]);
    expect(two.checkpoint.deltaHeadSha256).toBe(two.sha256);
    expect(two.checkpoint.operational).toEqual({
      frontierCount: 1,
      frontierPeak: 2,
      uniqueAddresses: 2,
      fundingEpisodes: 2
    });
  });

  it("keeps checkpoint JSON bounded as the delta chain grows", () => {
    let checkpoint = initialTraversalCheckpointV2(BINDINGS);
    for (let index = 0; index < 1_000; index += 1) {
      checkpoint = appendTraversalDelta(checkpoint, {
        addedFrontier: [state(STATE_A.address, `episode:${index}`)],
        removedFrontierStateIds: [],
        addedVisited: [],
        addedTerminals: [],
        addedSupersededStateIds: [],
        addedExpandedStateIds: [],
        addedEligibleEventIds: [],
        addedExpandedStateKeys: [],
        counterDeltas: { expanded: 1, terminal: 0, superseded: 0 },
        diagnostic: {
          at: "2026-07-24T00:00:00.000Z",
          code: `delta:${index}`
        }
      }).checkpoint;
    }

    expect(Buffer.byteLength(JSON.stringify(checkpoint))).toBeLessThan(4_096);
    expect(checkpoint.recentDiagnostics).toHaveLength(8);
    expect(checkpoint.counters.expanded).toBe(1_000);
  });

  it("rejects a broken previous-delta link", () => {
    const initial = initialTraversalCheckpointV2(BINDINGS);
    const one = appendTraversalDelta(initial, {
      addedFrontier: [STATE_A],
      removedFrontierStateIds: [],
      addedVisited: [],
      addedTerminals: [],
      addedSupersededStateIds: [],
      addedExpandedStateIds: [],
      addedEligibleEventIds: [],
      addedExpandedStateKeys: [],
      counterDeltas: { expanded: 0, terminal: 0, superseded: 0 }
    });
    const broken = {
      ...one.artifact,
      previousDeltaHash: "f".repeat(64)
    };

    expect(() => replayTraversalDeltas([broken]))
      .toThrow("unified_traversal_delta_chain_invalid");
  });

  it("upgrades V1 once and leaves a V2 checkpoint unchanged", () => {
    const upgraded = upgradeTraversalCheckpointV1({
      checkpoint: {
        version: "unified-production-traversal-checkpoint-v1",
        frontier: [STATE_A],
        visitedStates: [STATE_B],
        expandedStateIds: [traversalStateId(STATE_B)],
        terminals: [],
        supersededStateIds: [],
        active: null,
        eligibleEventIds: [],
        expandedStateKeys: [],
        selectedBackwardRaw: "100",
        selectedForwardRaw: "0"
      },
      ...BINDINGS
    });

    expect(upgraded.upgraded).toBe(true);
    expect(upgraded.compactionArtifact).not.toBeNull();
    expect(upgraded.upgradeArtifact).not.toBeNull();
    expect(upgraded.checkpoint.version)
      .toBe("unified-production-traversal-checkpoint-v2");

    const repeated = upgradeTraversalCheckpointV1({
      checkpoint: upgraded.checkpoint,
      ...BINDINGS
    });
    expect(repeated).toEqual({
      upgraded: false,
      checkpoint: upgraded.checkpoint,
      compactionArtifact: null,
      upgradeArtifact: null
    });
  });

  it("restores an in-flight V1 state to the frontier during rollout", () => {
    const upgraded = upgradeTraversalCheckpointV1({
      checkpoint: {
        version: "unified-production-traversal-checkpoint-v1",
        frontier: [],
        visitedStates: [],
        expandedStateIds: [],
        terminals: [],
        supersededStateIds: [],
        active: {
          state: STATE_A,
          history: { cursor: "50" },
          pageArtifactHashes: ["3".repeat(64)]
        },
        eligibleEventIds: [],
        expandedStateKeys: [],
        selectedBackwardRaw: "100",
        selectedForwardRaw: "0"
      },
      ...BINDINGS
    });

    expect(upgraded.compactionArtifact?.frontier).toEqual([STATE_A]);
  });
});
