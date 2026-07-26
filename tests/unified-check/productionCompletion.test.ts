import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  canonicalTronUsdtEventKey
} from "../../src/forensics/tronAddressAllTimeIndex";
import {
  runUnifiedDeepBranch,
  runUnifiedFastBranch,
  runUnifiedWhereBranch
} from "../../src/unifiedCheck/branchAdapters";
import {
  buildUnifiedProductionCompletionCandidate
} from "../../src/unifiedCheck/productionCompletion";
import {
  buildUnifiedProductionEvidence
} from "../../src/unifiedCheck/productionEvidence";
import type {
  AnalysisManifestV1,
  ChildAttemptArtifactV1
} from "../../src/unifiedCheck/contracts";
import type { IndexedTronUsdtTransfer } from "../../src/types";
import {
  buildTraversalCoverage,
  traversalStateId,
  type TraversalStateV1
} from "../../src/unifiedCheck/traversal";
import type {
  UnifiedTraversalArtifactV1
} from "../../src/unifiedCheck/productionTraversal";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const SOURCE = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const UPSTREAM_CEX = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const manifest = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "run-1",
  requestHash: "a".repeat(64),
  snapshotHash: "b".repeat(64),
  chain: "tron",
  subjectAddress: SUBJECT,
  confirmedBlockNumber: "100",
  confirmedBlockHash: "c".repeat(64),
  confirmedBlockTimestamp: "2026-07-23T13:00:00.000Z",
  labelDatasetSha256: "d".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "selected-attribution-policy-v1",
  traversalPolicyVersion: "snapshot-closure-v1",
  runtimeCommit: "candidate",
  databaseSchemaVersion: 33,
  paginationCutoffBlockNumber: "100",
  paginationCutoffBlockHash: "c".repeat(64),
  branchArtifactHashes: {
    fast: "eb52657ea33755d8c8f26cc9854dba7ad17f4fe132b9bfae414b2b75c352148b",
    where: "2cd9821d5c2b4e5b7a65ee076b1183c82c8cd51f992b76c97ac3871969ce1e91",
    deep: "3799de4cae231bac7cde8260ca83a7b46eaf6645040de5eb04ee687ced9f97a6"
  }
} as AnalysisManifestV1;
const event: IndexedTronUsdtTransfer = {
  txHash: "2".repeat(64),
  blockNumber: 90,
  blockTimestamp: new Date("2026-07-23T12:00:00.000Z"),
  eventIndex: 0,
  fromAddress: SOURCE,
  toAddress: SUBJECT,
  amountRaw: "10000000",
  method: "transfer",
  callerAddress: null,
  contractRet: "SUCCESS",
  confirmed: true
};
const traversalState: TraversalStateV1 = {
  address: UPSTREAM_CEX,
  direction: "backward",
  anchorTimestamp: event.blockTimestamp.toISOString(),
  fundingEpisodeId: "episode-1",
  allocatedAmountRaw: event.amountRaw,
  sourceEventIds: [canonicalTronUsdtEventKey(event), "upstream-hop"]
};
const zeroCoverage = buildTraversalCoverage({
  selectedAmountRaw: "0",
  tracedAmountRaw: "0",
  identifiedAmountRaw: "0",
  unknownBoundaryRaw: "0"
});
const backwardCoverage = buildTraversalCoverage({
  selectedAmountRaw: event.amountRaw,
  tracedAmountRaw: event.amountRaw,
  identifiedAmountRaw: event.amountRaw,
  unknownBoundaryRaw: "0"
});
const traversal: UnifiedTraversalArtifactV1 = {
  version: "unified-traversal-artifact-v1",
  schemaVersion: 1,
  runId: manifest.runId,
  analysisManifestHash: fingerprintCanonicalArtifact(manifest),
  snapshotHash: manifest.snapshotHash,
  visitedStates: [traversalState],
  frontier: [],
  terminalStates: [{
    stateId: traversalStateId(traversalState),
    address: UPSTREAM_CEX,
    direction: "backward",
    fundingEpisodeId: "episode-1",
    anchorTimestamp: traversalState.anchorTimestamp,
    amountRaw: event.amountRaw,
    reason: "identified_service_boundary",
    evidenceHash: "9".repeat(64),
    labels: ["Bybit", "cex"],
    sourceEventIds: traversalState.sourceEventIds
  }],
  supersededStateIds: [],
  eligibleEventIds: [],
  eligibleEventCount: 0,
  directionCount: 1,
  fundingEpisodeCount: 1,
  expandedStateCount: 0,
  allocatedInputRaw: event.amountRaw,
  terminalRaw: event.amountRaw,
  residualRaw: "0",
  backwardCoverage,
  forwardCoverage: zeroCoverage,
  closed: true
};

describe("Unified production completion", () => {
  it("builds one coverage-independent hash chain and dossier from all branches", async () => {
    const evidence = buildUnifiedProductionEvidence({
      subjectAddress: SUBJECT,
      snapshotBlock: "100",
      events: [event],
      knownCounterparties: new Map(),
      hardEvidence: {},
      traversal
    });
    const runners = {
      fast: runUnifiedFastBranch,
      where: runUnifiedWhereBranch,
      deep: runUnifiedDeepBranch
    };
    const branches = await Promise.all(
      (["fast", "where", "deep"] as const).map(async (branchId, index) => {
        const output = await runners[branchId]({
          context: {
            runId: "run-1",
            manifest,
            directHistoryArtifactSha256: "3".repeat(64),
            directEvents: [event],
            labelsDatasetSha256: manifest.labelDatasetSha256,
            deliveryAuthority: false
          },
          analyze: async () => evidence[branchId]
        });
        const outputHash = fingerprintCanonicalArtifact(output);
        const attempt: ChildAttemptArtifactV1 = {
          version: "child-attempt-artifact-v1",
          schemaVersion: 1,
          runId: "run-1",
          branchId,
          attemptId: `attempt-${branchId}`,
          previousAttemptHash: null,
          inputHash: manifest.branchArtifactHashes[branchId],
          outputHash,
          status: "COMPLETED",
          createdAt: `2026-07-23T13:01:0${index}.000Z`
        };
        return {
          branchId,
          output,
          outputHash,
          attempt,
          attemptHash: fingerprintCanonicalArtifact(attempt)
        };
      })
    );
    const candidate = buildUnifiedProductionCompletionCandidate({
      manifest,
      directEvents: [event],
      knownCounterparties: new Map(),
      branches,
      traversal
    });

    expect(candidate.dossier).toMatchObject({
      subjectAddress: SUBJECT,
      score: 0,
      decision: "ACCEPTABLE",
      selectedAttributionPolicy: "proportional",
      latestPrincipalInboundEventsScope:
        "latest_five_principal_inbound_events"
    });
    expect(candidate.dossier.latestPrincipalInboundEvents).toHaveLength(1);
    expect(candidate.dossier.currentBalanceAttribution.denominatorRaw)
      .toBe("10000000");
    const services = candidate.dossier.sections.find((section) =>
      section.kind === "services_boundaries"
    );
    expect(services).toMatchObject({
      kind: "services_boundaries",
      rows: [{
        service: "Bybit",
        address: UPSTREAM_CEX,
        direction: "incoming",
        directness: "indirect",
        amount: {
          amountRaw: event.amountRaw,
          denominatorRaw: event.amountRaw
        }
      }]
    });
    for (const [hash, artifact] of candidate.artifacts) {
      expect(fingerprintCanonicalArtifact(artifact)).toBe(hash);
    }
  });
});
