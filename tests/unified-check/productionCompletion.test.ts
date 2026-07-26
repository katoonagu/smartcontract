import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  canonicalTronUsdtEventKey
} from "../../src/forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../../src/types";
import {
  runUnifiedDeepBranch,
  runUnifiedFastBranch,
  runUnifiedWhereBranch
} from "../../src/unifiedCheck/branchAdapters";
import type {
  AnalysisManifestV1,
  ChildAttemptArtifactV1
} from "../../src/unifiedCheck/contracts";
import {
  buildProductionFrozenLabelDataset,
  type FrozenLabelDatasetV1
} from "../../src/unifiedCheck/frozenLabels";
import {
  buildUnifiedProductionCompletionCandidate
} from "../../src/unifiedCheck/productionCompletion";
import {
  buildUnifiedProductionEvidence
} from "../../src/unifiedCheck/productionEvidence";
import type {
  UnifiedTraversalArtifactV1
} from "../../src/unifiedCheck/productionTraversal";
import {
  decideTronScanProviderServiceAssertion
} from "../../src/unifiedCheck/providerServiceBindings";
import {
  buildUnifiedBranchInput
} from "../../src/unifiedCheck/requestService";
import {
  buildTraversalCoverage,
  traversalStateId,
  type TraversalStateV1
} from "../../src/unifiedCheck/traversal";

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

function manifestV2(
  dataset: { readonly sha256: string }
): AnalysisManifestV1 {
  const versions = {
    labelDatasetSha256: dataset.sha256,
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    traversalPolicyVersion: "snapshot-closure-v2",
    runtimeCommit: "candidate",
    schemaVersion: 33
  } as const;
  return {
    ...manifest,
    labelDatasetSha256: dataset.sha256,
    labelCatalogVersion: "unified-label-catalog-v1",
    boundaryPredicateVersion: "unified-boundary-predicates-v1",
    traversalPolicyVersion: "snapshot-closure-v2",
    branchArtifactHashes: Object.fromEntries(
      (["fast", "where", "deep"] as const).map((branchId) => [
        branchId,
        fingerprintCanonicalArtifact(buildUnifiedBranchInput(
          branchId,
          manifest.snapshotHash,
          versions
        ))
      ])
    ) as Record<"fast" | "where" | "deep", string>
  };
}

function providerDataset(input: {
  readonly entries: readonly {
    readonly address: string;
    readonly tag: "Bybit" | "Binance";
    readonly fetchedAt: string;
  }[];
  readonly legacyRows?: FrozenLabelDatasetV1["legacyRows"];
}) {
  const providerAssertions = input.entries.map((entry) => {
    const rawJson = { address: entry.address, tag: entry.tag };
    const assertion = decideTronScanProviderServiceAssertion({
      metadata: {
        address: entry.address,
        source: "tronscan",
        name: null,
        tag: entry.tag,
        verified: false,
        rawJson,
        fetchedAt: new Date(entry.fetchedAt),
        expiresAt: new Date("2026-07-23T14:00:00.000Z")
      },
      frozenAt: manifest.confirmedBlockTimestamp
    });
    if (!assertion.accepted) {
      throw new Error(`provider fixture rejected: ${assertion.reason}`);
    }
    return assertion;
  });
  return buildProductionFrozenLabelDataset({
    frozenAt: manifest.confirmedBlockTimestamp,
    snapshotHash: manifest.snapshotHash,
    legacyRows: input.legacyRows ?? [],
    providerAssertions
  });
}

function traversalFor(input: {
  readonly currentManifest: AnalysisManifestV1;
  readonly terminalAddress: string;
  readonly labels: readonly string[];
  readonly sourceEventIds: readonly string[];
}): UnifiedTraversalArtifactV1 {
  const state = {
    ...traversalState,
    address: input.terminalAddress,
    sourceEventIds: input.sourceEventIds
  };
  return {
    ...traversal,
    runId: input.currentManifest.runId,
    analysisManifestHash: fingerprintCanonicalArtifact(input.currentManifest),
    snapshotHash: input.currentManifest.snapshotHash,
    visitedStates: [state],
    terminalStates: [{
      ...traversal.terminalStates[0]!,
      stateId: traversalStateId(state),
      address: input.terminalAddress,
      labels: input.labels,
      sourceEventIds: input.sourceEventIds
    }]
  };
}

function bidirectionalTraversalFor(input: {
  readonly currentManifest: AnalysisManifestV1;
  readonly address: string;
  readonly incomingEventId: string;
  readonly outgoingEventId: string;
}): UnifiedTraversalArtifactV1 {
  const backward = {
    ...traversalState,
    address: input.address,
    sourceEventIds: [input.incomingEventId]
  };
  const forward = {
    ...traversalState,
    address: input.address,
    direction: "forward" as const,
    fundingEpisodeId: "episode-2",
    sourceEventIds: [input.outgoingEventId]
  };
  return {
    ...traversal,
    runId: input.currentManifest.runId,
    analysisManifestHash: fingerprintCanonicalArtifact(input.currentManifest),
    snapshotHash: input.currentManifest.snapshotHash,
    visitedStates: [backward, forward],
    terminalStates: [
      {
        ...traversal.terminalStates[0]!,
        stateId: traversalStateId(backward),
        address: input.address,
        direction: "backward",
        fundingEpisodeId: backward.fundingEpisodeId,
        labels: ["cex:bybit"],
        sourceEventIds: backward.sourceEventIds
      },
      {
        ...traversal.terminalStates[0]!,
        stateId: traversalStateId(forward),
        address: input.address,
        direction: "forward",
        fundingEpisodeId: forward.fundingEpisodeId,
        labels: ["cex:bybit"],
        sourceEventIds: forward.sourceEventIds
      }
    ],
    directionCount: 2,
    fundingEpisodeCount: 2,
    allocatedInputRaw: (BigInt(event.amountRaw) * 2n).toString(),
    terminalRaw: (BigInt(event.amountRaw) * 2n).toString(),
    backwardCoverage,
    forwardCoverage: backwardCoverage
  };
}

async function candidateFor(input: {
  readonly currentManifest: AnalysisManifestV1;
  readonly directEvents: readonly IndexedTronUsdtTransfer[];
  readonly currentTraversal: UnifiedTraversalArtifactV1;
  readonly labelDataset: unknown;
  readonly knownCounterparties?: ReadonlyMap<string, readonly string[]>;
}) {
  const knownCounterparties = input.knownCounterparties ?? new Map();
  const evidence = buildUnifiedProductionEvidence({
    subjectAddress: SUBJECT,
    snapshotBlock: input.currentManifest.confirmedBlockNumber,
    events: input.directEvents,
    knownCounterparties,
    hardEvidence: {},
    traversal: input.currentTraversal
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
          runId: input.currentManifest.runId,
          manifest: input.currentManifest,
          directHistoryArtifactSha256: "3".repeat(64),
          directEvents: input.directEvents,
          labelsDatasetSha256: input.currentManifest.labelDatasetSha256,
          deliveryAuthority: false
        },
        analyze: async () => evidence[branchId]
      });
      const outputHash = fingerprintCanonicalArtifact(output);
      const attempt: ChildAttemptArtifactV1 = {
        version: "child-attempt-artifact-v1",
        schemaVersion: 1,
        runId: input.currentManifest.runId,
        branchId,
        attemptId: `attempt-${branchId}`,
        previousAttemptHash: null,
        inputHash: input.currentManifest.branchArtifactHashes[branchId],
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
  return buildUnifiedProductionCompletionCandidate({
    manifest: input.currentManifest,
    directEvents: input.directEvents,
    knownCounterparties,
    branches,
    traversal: input.currentTraversal,
    labelDataset: input.labelDataset
  });
}

function serviceRows(candidate: Awaited<ReturnType<typeof candidateFor>>) {
  const section = candidate.dossier.sections.find((item) =>
    item.kind === "services_boundaries"
  );
  if (!section || section.kind !== "services_boundaries") {
    throw new Error("services section missing");
  }
  return section.rows;
}

function terminalFactId(
  candidate: Awaited<ReturnType<typeof candidateFor>>,
  subjectRole: "recipient" | "sender"
): string {
  const entry = [...candidate.artifactKinds].find(([, kind]) =>
    kind === "canonical_facts"
  );
  if (!entry) throw new Error("canonical facts missing");
  const artifact = candidate.artifacts.get(entry[0]) as {
    readonly facts: readonly {
      readonly id: string;
      readonly factType: string;
      readonly subjectRole: string;
    }[];
  };
  const fact = artifact.facts.find((item) =>
    item.factType === "identified_service_boundary" &&
    item.subjectRole === subjectRole
  );
  if (!fact) throw new Error(`terminal fact missing: ${subjectRole}`);
  return fact.id;
}

describe("Unified production completion", () => {
  it("preserves V1 indirect service identity behavior", async () => {
    const candidate = await candidateFor({
      currentManifest: manifest,
      directEvents: [event],
      currentTraversal: traversal,
      labelDataset: null
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
    expect(serviceRows(candidate)).toMatchObject([{
      service: "Bybit",
      address: UPSTREAM_CEX,
      direction: "incoming",
      directness: "indirect",
      amount: {
        amountRaw: event.amountRaw,
        denominatorRaw: event.amountRaw
      }
    }]);
    for (const [hash, artifact] of candidate.artifacts) {
      expect(fingerprintCanonicalArtifact(artifact)).toBe(hash);
    }
  });

  it("resolves a V2 terminal CEX from its frozen event-time record", async () => {
    const frozen = providerDataset({
      entries: [{
        address: UPSTREAM_CEX,
        tag: "Bybit",
        fetchedAt: "2026-07-23T11:00:00.000Z"
      }]
    });
    const currentManifest = manifestV2(frozen);
    const candidate = await candidateFor({
      currentManifest,
      directEvents: [event],
      currentTraversal: traversalFor({
        currentManifest,
        terminalAddress: UPSTREAM_CEX,
        labels: ["cex:bybit"],
        sourceEventIds: traversalState.sourceEventIds
      }),
      labelDataset: frozen.dataset
    });

    expect(candidate.dossier).toMatchObject({ score: 0, decision: "ACCEPTABLE" });
    expect(serviceRows(candidate)).toMatchObject([{
      service: "Bybit",
      address: UPSTREAM_CEX,
      direction: "incoming",
      directness: "indirect"
    }]);
  });

  it("rejects a V2 terminal whose provider identity starts after the event", async () => {
    const frozen = providerDataset({
      entries: [{
        address: UPSTREAM_CEX,
        tag: "Bybit",
        fetchedAt: "2026-07-23T12:00:00.001Z"
      }]
    });
    const currentManifest = manifestV2(frozen);

    await expect(candidateFor({
      currentManifest,
      directEvents: [event],
      currentTraversal: traversalFor({
        currentManifest,
        terminalAddress: UPSTREAM_CEX,
        labels: ["cex:bybit"],
        sourceEventIds: traversalState.sourceEventIds
      }),
      labelDataset: frozen.dataset
    })).rejects.toThrow("unified_production_v2_service_boundary_unbound");
  });

  it("aggregates a direct V2 provider service exactly once", async () => {
    const frozen = providerDataset({
      entries: [{
        address: UPSTREAM_CEX,
        tag: "Bybit",
        fetchedAt: "2026-07-23T11:00:00.000Z"
      }]
    });
    const currentManifest = manifestV2(frozen);
    const directEvent = { ...event, fromAddress: UPSTREAM_CEX };
    const directEventId = canonicalTronUsdtEventKey(directEvent);
    const candidate = await candidateFor({
      currentManifest,
      directEvents: [directEvent],
      currentTraversal: traversalFor({
        currentManifest,
        terminalAddress: UPSTREAM_CEX,
        labels: ["cex:bybit"],
        sourceEventIds: [directEventId]
      }),
      labelDataset: frozen.dataset
    });

    expect(candidate.dossier).toMatchObject({ score: 0, decision: "ACCEPTABLE" });
    expect(serviceRows(candidate)).toHaveLength(1);
    expect(serviceRows(candidate)[0]).toMatchObject({
      service: "Bybit",
      address: UPSTREAM_CEX,
      direction: "incoming",
      directness: "direct",
      amount: {
        amountRaw: directEvent.amountRaw,
        denominatorRaw: directEvent.amountRaw
      },
      transferCount: 1
    });
    expect(serviceRows(candidate)[0]!.factIds).toContain(
      terminalFactId(candidate, "recipient")
    );
  });

  it("keeps inbound and outbound V2 terminal provenance separate", async () => {
    const frozen = providerDataset({
      entries: [{
        address: UPSTREAM_CEX,
        tag: "Bybit",
        fetchedAt: "2026-07-23T11:00:00.000Z"
      }]
    });
    const currentManifest = manifestV2(frozen);
    const incoming = { ...event, fromAddress: UPSTREAM_CEX };
    const outgoing = {
      ...event,
      txHash: "4".repeat(64),
      fromAddress: SUBJECT,
      toAddress: UPSTREAM_CEX
    };
    const candidate = await candidateFor({
      currentManifest,
      directEvents: [incoming, outgoing],
      currentTraversal: bidirectionalTraversalFor({
        currentManifest,
        address: UPSTREAM_CEX,
        incomingEventId: canonicalTronUsdtEventKey(incoming),
        outgoingEventId: canonicalTronUsdtEventKey(outgoing)
      }),
      labelDataset: frozen.dataset
    });
    const rows = serviceRows(candidate);
    const incomingRow = rows.find((row) => row.direction === "incoming");
    const outgoingRow = rows.find((row) => row.direction === "outgoing");
    const recipientFactId = terminalFactId(candidate, "recipient");
    const senderFactId = terminalFactId(candidate, "sender");

    expect(rows).toHaveLength(2);
    expect(incomingRow).toMatchObject({
      directness: "direct",
      transferCount: 1,
      amount: {
        amountRaw: event.amountRaw,
        denominatorRaw: event.amountRaw
      }
    });
    expect(outgoingRow).toMatchObject({
      directness: "direct",
      transferCount: 1,
      amount: {
        amountRaw: event.amountRaw,
        denominatorRaw: event.amountRaw
      }
    });
    expect(incomingRow!.factIds).toContain(recipientFactId);
    expect(incomingRow!.factIds).not.toContain(senderFactId);
    expect(outgoingRow!.factIds).toContain(senderFactId);
    expect(outgoingRow!.factIds).not.toContain(recipientFactId);
  });

  it.each([
    ["later_provider", providerDataset({
      entries: [
        {
          address: UPSTREAM_CEX,
          tag: "Bybit",
          fetchedAt: "2026-07-23T12:00:00.001Z"
        },
        {
          address: SOURCE,
          tag: "Binance",
          fetchedAt: "2026-07-23T11:00:00.000Z"
        }
      ]
    })],
    ["hint", providerDataset({
      entries: [{
        address: SOURCE,
        tag: "Binance",
        fetchedAt: "2026-07-23T11:00:00.000Z"
      }],
      legacyRows: [{
        address: UPSTREAM_CEX,
        label: "Bybit",
        category: "cex",
        provider: "legacy-risk-context",
        observedAt: "2026-07-23T11:00:00.000Z"
      }]
    })]
  ])("does not authorize a direct V2 service from %s context", async (
    _name,
    frozen
  ) => {
    const currentManifest = manifestV2(frozen);
    const directEvent = { ...event, fromAddress: UPSTREAM_CEX };
    const candidate = await candidateFor({
      currentManifest,
      directEvents: [directEvent],
      currentTraversal: traversalFor({
        currentManifest,
        terminalAddress: SOURCE,
        labels: ["cex:binance"],
        sourceEventIds: [canonicalTronUsdtEventKey(directEvent), "upstream-hop"]
      }),
      labelDataset: frozen.dataset,
      knownCounterparties: new Map([[UPSTREAM_CEX, ["Bybit", "cex"]]])
    });

    expect(candidate.dossier).toMatchObject({ score: 0, decision: "ACCEPTABLE" });
    expect(serviceRows(candidate).some((row) => row.service === "Bybit"))
      .toBe(false);
  });

  it("rejects a persisted V2 terminal backed only by a hint", async () => {
    const frozen = providerDataset({
      entries: [],
      legacyRows: [{
        address: UPSTREAM_CEX,
        label: "Bybit",
        category: "cex",
        provider: "legacy-risk-context",
        observedAt: "2026-07-23T11:00:00.000Z"
      }]
    });
    const currentManifest = manifestV2(frozen);

    await expect(candidateFor({
      currentManifest,
      directEvents: [event],
      currentTraversal: traversalFor({
        currentManifest,
        terminalAddress: UPSTREAM_CEX,
        labels: ["cex:bybit"],
        sourceEventIds: traversalState.sourceEventIds
      }),
      labelDataset: frozen.dataset
    })).rejects.toThrow("unified_production_v2_service_boundary_unbound");
  });

  it("rejects V2 dataset content outside the manifest hash", async () => {
    const frozen = providerDataset({
      entries: [{
        address: UPSTREAM_CEX,
        tag: "Bybit",
        fetchedAt: "2026-07-23T11:00:00.000Z"
      }]
    });
    const currentManifest = manifestV2(frozen);
    const tampered = {
      ...frozen.dataset,
      frozenAt: "2026-07-23T12:59:59.999Z"
    };

    await expect(candidateFor({
      currentManifest,
      directEvents: [event],
      currentTraversal: traversalFor({
        currentManifest,
        terminalAddress: UPSTREAM_CEX,
        labels: ["cex:bybit"],
        sourceEventIds: traversalState.sourceEventIds
      }),
      labelDataset: tampered
    })).rejects.toThrow("unified_frozen_label_dataset_hash_mismatch");
  });
});
