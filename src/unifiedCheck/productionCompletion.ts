import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import {
  canonicalTronUsdtEventKey
} from "../forensics/tronAddressAllTimeIndex";
import { buildScoreAnchorV3 } from "../risk/scoreAnchorV3";
import {
  scoreSignalMatrixV4,
  type ScoringFactV4
} from "../risk/scoringSignalMatrixV4";
import type { IndexedTronUsdtTransfer } from "../types";
import type { WalletAmountAggregate, WalletMetrics } from "../wallet/metrics";
import {
  canonicalFactId,
  canonicalizeEvidenceFacts,
  type CanonicalFactInput
} from "./canonicalFacts";
import type {
  AnalysisManifestV1,
  ChildAttemptArtifactV1,
  EvidenceBundleV1,
  ScoringBundleV1,
  TraversalClosureCertificateV1
} from "./contracts";
import type { UnifiedBranchArtifactV1 } from "./branchAdapters";
import {
  validateFrozenLabelDatasetV1,
  type FrozenLabelDatasetV1,
  type FrozenLabelRecordV1
} from "./frozenLabels";
import { resolveFrozenLabelAtEventV1 } from "./labelCatalog";
import {
  buildTraversalClosureCertificate,
  traversalStateId
} from "./traversal";
import type {
  UnifiedTraversalArtifactV1
} from "./productionTraversal";
import {
  buildUnifiedWalletReport,
  type UnifiedWalletDossierV1
} from "./report";
import { buildUnifiedBranchInput } from "./requestService";

type BranchId = "fast" | "where" | "deep";

export type CompletedProductionBranch = {
  readonly branchId: BranchId;
  readonly output: UnifiedBranchArtifactV1;
  readonly outputHash: string;
  readonly attempt: ChildAttemptArtifactV1;
  readonly attemptHash: string;
};

export type UnifiedProductionCompletionCandidate = {
  readonly dossier: UnifiedWalletDossierV1;
  readonly reportHash: string;
  readonly artifacts: ReadonlyMap<string, unknown>;
  readonly artifactKinds: ReadonlyMap<string, string>;
  readonly hashes: {
    readonly evidence: string;
    readonly closure: string;
    readonly scoring: string;
    readonly report: string;
  };
};

function isSubject(address: string, subject: string): boolean {
  return address.toLowerCase() === subject.toLowerCase();
}

function aggregate(
  events: readonly IndexedTronUsdtTransfer[],
  keyOf: (event: IndexedTronUsdtTransfer) => string,
  factIdOf: (event: IndexedTronUsdtTransfer) => string
): WalletAmountAggregate[] {
  const byKey = new Map<string, {
    amount: bigint;
    count: number;
    factIds: Set<string>;
  }>();
  for (const event of events) {
    const key = keyOf(event);
    const prior = byKey.get(key) ?? {
      amount: 0n,
      count: 0,
      factIds: new Set<string>()
    };
    prior.amount += BigInt(event.amountRaw);
    prior.count += 1;
    prior.factIds.add(factIdOf(event));
    byKey.set(key, prior);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      amountRaw: value.amount.toString(),
      transferCount: value.count,
      factIds: [...value.factIds].sort()
    }));
}

function proportionalRows(
  rows: readonly WalletAmountAggregate[],
  balanceRaw: bigint
): WalletAmountAggregate[] {
  const total = rows.reduce(
    (sum, row) => sum + BigInt(row.amountRaw),
    0n
  );
  const target = balanceRaw < total ? balanceRaw : total;
  if (target === 0n || total === 0n) return [];
  const allocated = rows.map((row) => ({
    ...row,
    amountRaw: (BigInt(row.amountRaw) * target / total).toString()
  }));
  let remainder = target - allocated.reduce(
    (sum, row) => sum + BigInt(row.amountRaw),
    0n
  );
  for (const row of allocated) {
    if (remainder === 0n) break;
    row.amountRaw = (BigInt(row.amountRaw) + 1n).toString();
    remainder -= 1n;
  }
  return allocated.filter((row) => row.amountRaw !== "0");
}

function eventKey(event: IndexedTronUsdtTransfer): string {
  return `${event.txHash}:${event.eventIndex}`;
}

const LEGACY_SERVICE_CATEGORIES = new Set([
  "cex", "exchange", "trusted", "whitebit", "bridge"
]);
const LEGACY_SERVICE_NOISE = new Set([
  ...LEGACY_SERVICE_CATEGORIES,
  "hot_wallet", "router", "dex", "pool", "unknown"
]);

function legacyServiceIdentity(labels: readonly string[]): string | null {
  const category = labels.find((label) =>
    LEGACY_SERVICE_CATEGORIES.has(label)
  );
  if (category === undefined) return null;
  return labels.find((label) => !LEGACY_SERVICE_NOISE.has(label)) ?? category;
}

function indexFrozenLabelsByAddress(
  dataset: FrozenLabelDatasetV1
): ReadonlyMap<string, readonly FrozenLabelRecordV1[]> {
  const mutable = new Map<string, FrozenLabelRecordV1[]>();
  for (const label of dataset.labels) {
    const labels = mutable.get(label.address) ?? [];
    labels.push(label);
    mutable.set(label.address, labels);
  }
  return new Map([...mutable].map(([address, labels]) => [
    address,
    Object.freeze([...labels])
  ]));
}

function resolveV2CustodialService(input: {
  readonly labelsByAddress:
    ReadonlyMap<string, readonly FrozenLabelRecordV1[]>;
  readonly address: string;
  readonly eventTimestamp: string;
  readonly allowedCatalogEntryIds?: ReadonlySet<string>;
}): { readonly catalogEntryId: string; readonly service: string } | null {
  const matches = new Map<string, string>();
  for (const label of input.labelsByAddress.get(input.address) ?? []) {
    if (
      (
        input.allowedCatalogEntryIds !== undefined &&
        !input.allowedCatalogEntryIds.has(label.catalogEntryId)
      )
    ) continue;
    const resolution = resolveFrozenLabelAtEventV1({
      label,
      eventTimestamp: input.eventTimestamp
    });
    if (
      resolution.kind !== "eligible" ||
      resolution.entry.category !== "cex" ||
      resolution.entry.terminalPolicy !== "custodial_boundary"
    ) continue;
    matches.set(resolution.entry.id, resolution.entry.identity);
  }
  if (matches.size > 1) {
    throw new Error("unified_production_v2_service_boundary_ambiguous");
  }
  const match = matches.entries().next().value as
    [string, string] | undefined;
  return match === undefined
    ? null
    : { catalogEntryId: match[0], service: match[1] };
}

function v2DirectServiceLinks(input: {
  readonly subject: string;
  readonly events: readonly IndexedTronUsdtTransfer[];
  readonly labelsByAddress:
    ReadonlyMap<string, readonly FrozenLabelRecordV1[]>;
  readonly incomingDenominatorRaw: bigint;
  readonly outgoingDenominatorRaw: bigint;
  readonly factIdOf: (event: IndexedTronUsdtTransfer) => string;
}): WalletMetrics["serviceLinks"] {
  const groups = new Map<string, {
    service: string;
    address: string;
    direction: "incoming" | "outgoing";
    catalogEntryId: string;
    amountRaw: bigint;
    transferCount: number;
    factIds: Set<string>;
  }>();
  for (const event of input.events) {
    const directions: Array<{
      direction: "incoming" | "outgoing";
      address: string;
    }> = [];
    if (isSubject(event.toAddress, input.subject)) {
      directions.push({ direction: "incoming", address: event.fromAddress });
    }
    if (isSubject(event.fromAddress, input.subject)) {
      directions.push({ direction: "outgoing", address: event.toAddress });
    }
    for (const item of directions) {
      const identity = resolveV2CustodialService({
        labelsByAddress: input.labelsByAddress,
        address: item.address,
        eventTimestamp: event.blockTimestamp.toISOString()
      });
      if (identity === null) continue;
      const key = JSON.stringify([
        item.direction,
        item.address,
        identity.catalogEntryId
      ]);
      const group = groups.get(key) ?? {
        service: identity.service,
        address: item.address,
        direction: item.direction,
        catalogEntryId: identity.catalogEntryId,
        amountRaw: 0n,
        transferCount: 0,
        factIds: new Set<string>()
      };
      group.amountRaw += BigInt(event.amountRaw);
      group.transferCount += 1;
      group.factIds.add(input.factIdOf(event));
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => ({
      service: group.service,
      address: group.address,
      direction: group.direction,
      directness: "direct",
      amountRaw: group.amountRaw.toString(),
      denominatorRaw: (group.direction === "incoming"
        ? input.incomingDenominatorRaw
        : input.outgoingDenominatorRaw).toString(),
      transferCount: group.transferCount,
      factIds: [...group.factIds].sort()
    }));
}

function terminalDirectness(
  sourceEventIds: readonly string[],
  directEventIds: ReadonlySet<string>
): "direct" | "indirect" {
  return sourceEventIds.length > 0 &&
    sourceEventIds.every((id) => directEventIds.has(id))
    ? "direct"
    : "indirect";
}

function v2DirectServiceLinkMergeKey(input: {
  readonly service: string;
  readonly address: string;
  readonly direction: "incoming" | "outgoing";
}): string {
  return JSON.stringify([input.service, input.address, input.direction]);
}

function metrics(input: {
  manifest: AnalysisManifestV1;
  events: readonly IndexedTronUsdtTransfer[];
  facts: readonly CanonicalFactInput[];
  matrixFacts: readonly ScoringFactV4[];
  finalFactIds: readonly string[];
  preferredFactId: string;
  matrixRow: string;
  score: number;
  knownCounterparties: ReadonlyMap<string, readonly string[]>;
  frozenLabelDataset: FrozenLabelDatasetV1 | null;
  traversal: UnifiedTraversalArtifactV1;
}): WalletMetrics {
  const subject = input.manifest.subjectAddress;
  const incoming = input.events.filter((event) =>
    isSubject(event.toAddress, subject)
  );
  const outgoing = input.events.filter((event) =>
    isSubject(event.fromAddress, subject)
  );
  const incomingRaw = incoming.reduce(
    (sum, event) => sum + BigInt(event.amountRaw),
    0n
  );
  const outgoingRaw = outgoing.reduce(
    (sum, event) => sum + BigInt(event.amountRaw),
    0n
  );
  const reconstructedBalance = incomingRaw > outgoingRaw
    ? incomingRaw - outgoingRaw
    : 0n;
  const directFactId = new Map<string, string>();
  for (const fact of input.facts) {
    if (fact.profile === "event" && fact.factType === "direct_usdt_transfer") {
      directFactId.set(
        `${fact.txHash}:${fact.eventIndex}`,
        canonicalFactId(fact)
      );
    }
  }
  const factIdOf = (event: IndexedTronUsdtTransfer) =>
    directFactId.get(eventKey(event)) ?? input.preferredFactId;
  const incomingRows = aggregate(
    incoming,
    (event) => event.fromAddress,
    factIdOf
  );
  const outgoingRows = aggregate(
    outgoing,
    (event) => event.toAddress,
    factIdOf
  );
  const frozenLabelsByAddress = input.frozenLabelDataset === null
    ? null
    : indexFrozenLabelsByAddress(input.frozenLabelDataset);
  const serviceFactIdsByCounterparty = new Map<string, string[]>();
  const traversalFactIds = new Map<string, string[]>();
  for (const fact of input.facts) {
    if (
      fact.profile === "state" &&
      fact.counterpartyOrObject !== null
    ) {
      const key = input.frozenLabelDataset === null
        ? JSON.stringify([
            fact.factType,
            fact.counterpartyOrObject,
            fact.directness,
            fact.effectiveAt
          ])
        : JSON.stringify([
            fact.factType,
            fact.counterpartyOrObject,
            fact.directness,
            fact.effectiveAt,
            fact.subjectRole
          ]);
      const ids = traversalFactIds.get(key) ?? [];
      ids.push(canonicalFactId(fact));
      traversalFactIds.set(key, [...new Set(ids)].sort());
    }
    if (
      fact.factType !== "service_link" ||
      fact.profile !== "state" ||
      fact.counterpartyOrObject === null
    ) continue;
    const ids = serviceFactIdsByCounterparty.get(
      fact.counterpartyOrObject
    ) ?? [];
    ids.push(canonicalFactId(fact));
    serviceFactIdsByCounterparty.set(
      fact.counterpartyOrObject,
      [...new Set(ids)].sort()
    );
  }
  const serviceLinks: WalletMetrics["serviceLinks"] = [];
  let v2DirectServiceLinksByKey: Map<
    string,
    WalletMetrics["serviceLinks"][number]
  > | null = null;
  if (input.frozenLabelDataset === null) {
    for (const [direction, rows, denominator] of [
      ["incoming", incomingRows, incomingRaw],
      ["outgoing", outgoingRows, outgoingRaw]
    ] as const) {
      for (const row of rows) {
        const service = legacyServiceIdentity(
          input.knownCounterparties.get(row.key) ?? []
        );
        if (service === null) continue;
        serviceLinks.push({
          service,
          address: row.key,
          direction,
          directness: "direct",
          amountRaw: row.amountRaw,
          denominatorRaw: denominator.toString(),
          transferCount: row.transferCount,
          factIds: [...new Set([
            ...row.factIds,
            ...(serviceFactIdsByCounterparty.get(row.key) ?? [])
          ])].sort()
        });
      }
    }
  } else {
    const directServiceLinks = v2DirectServiceLinks({
      subject,
      events: input.events,
      labelsByAddress: frozenLabelsByAddress!,
      incomingDenominatorRaw: incomingRaw,
      outgoingDenominatorRaw: outgoingRaw,
      factIdOf
    });
    serviceLinks.push(...directServiceLinks);
    v2DirectServiceLinksByKey = new Map();
    for (const link of directServiceLinks) {
      const key = v2DirectServiceLinkMergeKey(link);
      if (!v2DirectServiceLinksByKey.has(key)) {
        v2DirectServiceLinksByKey.set(key, link);
      }
    }
  }
  const directEventIds = input.frozenLabelDataset === null
    ? new Set<string>()
    : new Set(input.events.map((event) => canonicalTronUsdtEventKey(event)));
  for (const terminal of input.traversal.terminalStates) {
    if (terminal.reason !== "identified_service_boundary") continue;
    const directness = input.frozenLabelDataset === null
      ? "indirect"
      : terminalDirectness(terminal.sourceEventIds, directEventIds);
    const v2Identity = input.frozenLabelDataset === null
      ? null
      : resolveV2CustodialService({
          labelsByAddress: frozenLabelsByAddress!,
          address: terminal.address,
          eventTimestamp: terminal.anchorTimestamp,
          allowedCatalogEntryIds: new Set(terminal.labels)
        });
    if (input.frozenLabelDataset !== null && v2Identity === null) {
      throw new Error("unified_production_v2_service_boundary_unbound");
    }
    const factKey = input.frozenLabelDataset === null
      ? JSON.stringify([
          terminal.reason,
          terminal.address,
          directness,
          terminal.anchorTimestamp
        ])
      : JSON.stringify([
          terminal.reason,
          terminal.address,
          directness,
          terminal.anchorTimestamp,
          terminal.direction === "backward" ? "recipient" : "sender"
        ]);
    const factIds = traversalFactIds.get(factKey) ?? [];
    if (factIds.length === 0) continue;
    const identity = input.frozenLabelDataset === null
      ? legacyServiceIdentity(terminal.labels)
      : v2Identity;
    if (identity === null) {
      continue;
    }
    const service = typeof identity === "string"
      ? identity
      : identity.service;
    const direction = terminal.direction === "backward"
      ? "incoming"
      : "outgoing";
    const denominatorRaw = terminal.direction === "backward"
      ? input.traversal.backwardCoverage.selectedAmountRaw
      : input.traversal.forwardCoverage.selectedAmountRaw;
    const existing = input.frozenLabelDataset !== null &&
      directness === "direct"
      ? v2DirectServiceLinksByKey?.get(v2DirectServiceLinkMergeKey({
          service,
          address: terminal.address,
          direction
        }))
      : undefined;
    if (existing !== undefined) {
      existing.factIds = [...new Set([...existing.factIds, ...factIds])].sort();
      continue;
    }
    serviceLinks.push({
      service,
      address: terminal.address,
      direction,
      directness,
      amountRaw: terminal.amountRaw,
      denominatorRaw,
      transferCount: new Set(terminal.sourceEventIds).size,
      factIds
    });
  }
  const times = input.events
    .map((event) => event.blockTimestamp.toISOString())
    .sort();
  const dangerousFacts = input.matrixFacts.filter((fact) =>
    fact.factType === "dangerous_unlimited_approval"
  );
  const behaviorFacts = input.matrixFacts.filter((fact) =>
    fact.factType !== "direct_usdt_transfer" &&
    fact.factType !== "service_link" &&
    fact.factType !== "dangerous_unlimited_approval"
  );
  const negativeFacts: WalletMetrics["negativeFacts"] = [];
  if (!input.facts.some((fact) =>
    fact.factType === "blacklisted_at_transfer"
  )) {
    negativeFacts.push({
      code: "no_confirmed_direct_blacklist_relation",
      scope: "direct_usdt_history",
      scopeStatus: "COMPLETED",
      factIds: [input.preferredFactId]
    });
  }
  return {
    version: "unified-wallet-metrics-v1",
    asOfBlock: input.manifest.confirmedBlockNumber,
    observedAt: input.manifest.confirmedBlockTimestamp,
    consistency: "snapshot_reconstructed",
    profile: {
      createdAt: times[0] ?? null,
      firstUsdtActivityAt: times[0] ?? null,
      lastUsdtActivityAt: times.at(-1) ?? null,
      incomingUsdtTransferCount: incoming.length,
      outgoingUsdtTransferCount: outgoing.length,
      snapshotUsdtBalanceRaw: reconstructedBalance.toString(),
      // TRX state is not derivable from TRC20 history. Keep it out of the live
      // observation; the presentation marks the profile reconstructed.
      snapshotTrxBalanceSun: "0",
      liveBalanceObservation: null
    },
    scoreDrivers: [{
      code: input.matrixRow,
      factIds: [input.preferredFactId],
      collapsedFactCount: 1
    }],
    currentBalanceAttribution: {
      scope: "current_balance_attribution",
      denominatorRaw: reconstructedBalance.toString(),
      rows: proportionalRows(incomingRows, reconstructedBalance)
    },
    outgoingMovement: {
      scope: "all_direct_outgoing_to_snapshot",
      denominatorRaw: outgoingRaw.toString(),
      rows: outgoingRows
    },
    serviceLinks,
    contractsAndApprovals: dangerousFacts.map((fact) => ({
      code: fact.factType,
      counterparty: null,
      amountRaw: null,
      factIds: [fact.id]
    })),
    behaviorAndConnections: behaviorFacts.map((fact) => ({
      code: fact.factType,
      role: fact.subjectRole,
      factIds: [fact.id],
      collapsedFactCount: 1
    })),
    coverage: [
      {
        direction: "backward",
        selectionPpm: Math.round(
          input.traversal.backwardCoverage.selectionCoverage * 10_000
        ),
        tracePpm: Math.round(
          input.traversal.backwardCoverage.traceCoverage * 10_000
        ),
        identifiedPpm: Math.round(
          input.traversal.backwardCoverage.identifiedCoverage * 10_000
        ),
        unknownBoundaryPpm: Math.round(
          input.traversal.backwardCoverage.unknownBoundaryShare * 10_000
        ),
        untracedPpm: Math.round(
          input.traversal.backwardCoverage.untracedShare * 10_000
        )
      },
      {
        direction: "forward",
        selectionPpm: Math.round(
          input.traversal.forwardCoverage.selectionCoverage * 10_000
        ),
        tracePpm: Math.round(
          input.traversal.forwardCoverage.traceCoverage * 10_000
        ),
        identifiedPpm: Math.round(
          input.traversal.forwardCoverage.identifiedCoverage * 10_000
        ),
        unknownBoundaryPpm: Math.round(
          input.traversal.forwardCoverage.unknownBoundaryShare * 10_000
        ),
        untracedPpm: Math.round(
          input.traversal.forwardCoverage.untracedShare * 10_000
        )
      }
    ],
    principalInboundEvents: incoming.map((event) => ({
      eventId: eventKey(event),
      txHash: event.txHash,
      timestamp: event.blockTimestamp.toISOString(),
      fromAddress: event.fromAddress,
      amountRaw: event.amountRaw,
      factIds: [factIdOf(event)]
    })),
    negativeFacts
  };
}

export function buildUnifiedProductionCompletionCandidate(input: {
  readonly manifest: AnalysisManifestV1;
  readonly directEvents: readonly IndexedTronUsdtTransfer[];
  readonly knownCounterparties: ReadonlyMap<string, readonly string[]>;
  readonly branches: readonly CompletedProductionBranch[];
  readonly traversal: UnifiedTraversalArtifactV1;
  readonly labelDataset: unknown;
}): UnifiedProductionCompletionCandidate {
  let frozenLabelDataset: FrozenLabelDatasetV1 | null = null;
  if (input.manifest.traversalPolicyVersion === "snapshot-closure-v2") {
    if (
      input.manifest.labelCatalogVersion === undefined ||
      input.manifest.boundaryPredicateVersion === undefined
    ) {
      throw new Error("unified_v2_boundary_versions_missing");
    }
    frozenLabelDataset = validateFrozenLabelDatasetV1({
      dataset: input.labelDataset,
      expectedSha256: input.manifest.labelDatasetSha256,
      snapshotHash: input.manifest.snapshotHash,
      catalogVersion: input.manifest.labelCatalogVersion,
      boundaryPredicateVersion: input.manifest.boundaryPredicateVersion
    });
  }
  const manifestHash = fingerprintCanonicalArtifact(input.manifest);
  const byBranch = new Map(input.branches.map((branch) => [
    branch.branchId,
    branch
  ]));
  if (
    byBranch.size !== 3 ||
    !(["fast", "where", "deep"] as const).every((branchId) => {
      const branch = byBranch.get(branchId);
      return branch !== undefined &&
        branch.output.branchId === branchId &&
        branch.output.runId === input.manifest.runId &&
        branch.outputHash === fingerprintCanonicalArtifact(branch.output) &&
        branch.attempt.branchId === branchId &&
        branch.attempt.outputHash === branch.outputHash &&
        branch.attemptHash === fingerprintCanonicalArtifact(branch.attempt);
    })
  ) {
    throw new Error("unified_production_branch_set_invalid");
  }
  const rawFacts = input.branches.flatMap((branch) =>
    branch.output.analysis.facts as readonly CanonicalFactInput[]
  );
  const canonical = canonicalizeEvidenceFacts({ facts: rawFacts });
  const matrix = scoreSignalMatrixV4({
    subjectAddress: input.manifest.subjectAddress,
    facts: canonical.inventory.facts,
    neutralCandidate: input.directEvents.length === 0
      ? "no_usdt_activity"
      : undefined
  });
  const artifacts = new Map<string, unknown>();
  const artifactKinds = new Map<string, string>();
  const add = (kind: string, artifact: unknown) => {
    const sha256 = fingerprintCanonicalArtifact(artifact);
    artifacts.set(sha256, artifact);
    artifactKinds.set(sha256, kind);
    return sha256;
  };
  for (const branchId of ["fast", "deep", "where"] as const) {
    const branchInput = buildUnifiedBranchInput(
      branchId,
      input.manifest.snapshotHash,
      {
        labelDatasetSha256: input.manifest.labelDatasetSha256,
        scoringPolicyVersion: input.manifest.scoringPolicyVersion,
        attributionPolicyVersion: input.manifest.attributionPolicyVersion,
        traversalPolicyVersion: input.manifest.traversalPolicyVersion,
        runtimeCommit: input.manifest.runtimeCommit,
        schemaVersion: input.manifest.databaseSchemaVersion
      }
    );
    const hash = add(`${branchId}_branch_input`, branchInput);
    if (hash !== input.manifest.branchArtifactHashes[branchId]) {
      throw new Error(`unified_production_branch_input_mismatch:${branchId}`);
    }
  }
  const canonicalFacts = {
    version: "canonical-fact-inventory-v1" as const,
    facts: matrix.facts
  };
  const canonicalFactsHash = add("canonical_facts", canonicalFacts);
  const acceptedChildAttemptHashes = Object.fromEntries(
    (["fast", "deep", "where"] as const).map((branchId) => [
      branchId,
      byBranch.get(branchId)!.attemptHash
    ])
  ) as Record<BranchId, string>;
  const branchOutputHashes = Object.fromEntries(
    (["fast", "deep", "where"] as const).map((branchId) => [
      branchId,
      byBranch.get(branchId)!.outputHash
    ])
  ) as Record<BranchId, string>;
  const evidence: EvidenceBundleV1 = {
    version: "evidence-bundle-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    canonicalFactsHash,
    canonicalFactIds: matrix.canonicalFactIds,
    acceptedChildAttemptHashes,
    branchOutputHashes
  };
  const evidenceHash = add("evidence_bundle", evidence);
  if (
    input.traversal.runId !== input.manifest.runId ||
    input.traversal.analysisManifestHash !== manifestHash ||
    input.traversal.snapshotHash !== input.manifest.snapshotHash ||
    input.traversal.closed !== true ||
    input.traversal.frontier.length !== 0 ||
    input.traversal.eligibleEventCount !==
      new Set(input.traversal.eligibleEventIds).size
  ) {
    throw new Error("unified_production_traversal_invalid");
  }
  const visited = {
    version: "traversal-visited-state-v1" as const,
    states: [...new Set(input.traversal.visitedStates.map(
      traversalStateId
    ))].sort()
  };
  const frontier = {
    version: "traversal-frontier-v1" as const,
    states: [] as readonly never[]
  };
  const visitedHash = add("traversal_visited", visited);
  const frontierHash = add("traversal_frontier", frontier);
  const terminalStateIds = input.traversal.terminalStates.map(
    (item) => item.stateId
  );
  const terminalStatesHash = add(
    "traversal_terminal_states",
    [...new Set(terminalStateIds)].sort()
  );
  const supersededStatesHash = add(
    "traversal_superseded_states",
    [...new Set(input.traversal.supersededStateIds)].sort()
  );
  const closure: TraversalClosureCertificateV1 &
    ReturnType<typeof buildTraversalClosureCertificate> =
    buildTraversalClosureCertificate({
    analysisManifestHash: manifestHash,
    evidenceBundleHash: evidenceHash,
    snapshotHash: input.manifest.snapshotHash,
    visitedStates: input.traversal.visitedStates,
    frontier: [],
    terminalStateIds,
    supersededStateIds: input.traversal.supersededStateIds,
    unclassifiedCount: 0,
    droppedCount: 0,
    eligibleEventIds: input.traversal.eligibleEventIds,
    directionCount: input.traversal.directionCount,
    fundingEpisodeCount: input.traversal.fundingEpisodeCount,
    expandedStateCount: input.traversal.expandedStateCount,
    allocatedInputRaw: input.traversal.allocatedInputRaw,
    terminalRaw: input.traversal.terminalRaw,
    continuedRaw: "0",
    residualRaw: input.traversal.residualRaw,
    backwardCoverage: input.traversal.backwardCoverage,
    forwardCoverage: input.traversal.forwardCoverage
  });
  if (
    closure.visitedStateHash !== visitedHash ||
    closure.frontierHash !== frontierHash ||
    closure.terminalStateHash !== terminalStatesHash ||
    closure.supersededStateHash !== supersededStatesHash
  ) {
    throw new Error("unified_production_traversal_hash_mismatch");
  }
  const closureHash = add("traversal_closure", closure);
  const scoreAnchor = buildScoreAnchorV3({
    subjectAddress: input.manifest.subjectAddress,
    matrix
  });
  const scoreAnchorHash = add("score_anchor", scoreAnchor);
  const scoring: ScoringBundleV1 = {
    version: "scoring-bundle-v1",
    schemaVersion: 1,
    evidenceBundleHash: evidenceHash,
    traversalClosureHash: closureHash,
    policyVersion: "scoring-signal-matrix-v4",
    scoreAnchorHash,
    score: matrix.score,
    decision: matrix.decision
  };
  const scoringHash = add("scoring_bundle", scoring);
  const walletMetrics = metrics({
    manifest: input.manifest,
    events: input.directEvents,
    facts: rawFacts,
    matrixFacts: matrix.facts,
    finalFactIds: matrix.canonicalFactIds,
    preferredFactId: matrix.preferredFactId,
    matrixRow: matrix.matrixRow,
    score: matrix.score,
    knownCounterparties: input.knownCounterparties,
    frozenLabelDataset,
    traversal: input.traversal
  });
  add("wallet_metrics", walletMetrics);
  const dossier = buildUnifiedWalletReport({
    manifest: input.manifest,
    evidence,
    closure,
    scoring,
    walletMetrics,
    selectedAttributionPolicy: "proportional"
  });
  const factInventoryHash = add(
    "report_fact_inventory",
    dossier.factInventory
  );
  if (factInventoryHash !== dossier.factInventoryHash) {
    throw new Error("unified_production_fact_inventory_mismatch");
  }
  const reportHash = add("unified_wallet_report", dossier);
  return {
    dossier,
    reportHash,
    artifacts,
    artifactKinds,
    hashes: {
      evidence: evidenceHash,
      closure: closureHash,
      scoring: scoringHash,
      report: reportHash
    }
  };
}
