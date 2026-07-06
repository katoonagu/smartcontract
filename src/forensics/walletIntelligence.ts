import { createHash } from "node:crypto";
import type {
  ForensicCheckJob,
  WalletIntelligenceEdgeInput,
  WalletIntelligenceJobStatus,
  WalletIntelligenceRunInput,
  WalletIntelligenceSightingInput,
  WalletIntelligenceSupportedJobKind
} from "../storage/repositories";

export const WALLET_INTELLIGENCE_INDEX_VERSION = 1;

export type WalletIntelligenceExtraction = {
  run: WalletIntelligenceRunInput;
  sightings: WalletIntelligenceSightingInput[];
  edges: WalletIntelligenceEdgeInput[];
  touchedAddresses: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateField(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(stableJson(parts)).digest("hex");
}

function isSupportedKind(kind: string): kind is WalletIntelligenceSupportedJobKind {
  return kind === "address_deep_check" || kind === "where_is_money_check" || kind === "incoming_deposit_check";
}

function isSupportedStatus(status: string): status is WalletIntelligenceJobStatus {
  return status === "completed" || status === "partial";
}

export function supportedWalletIntelligenceJob(job: ForensicCheckJob): boolean {
  return isSupportedKind(job.kind) && isSupportedStatus(job.status);
}

function relevantProgressPayload(job: ForensicCheckJob): Record<string, unknown> {
  return {
    depositTxHash: job.progressJson.depositTxHash ?? null,
    watchedWallet: job.progressJson.watchedWallet ?? null,
    sender: job.progressJson.sender ?? null,
    amountRaw: job.progressJson.amountRaw ?? null,
    timestamp: job.progressJson.timestamp ?? null
  };
}

export function sourcePayloadHash(job: ForensicCheckJob): string {
  return createHash("sha256").update(stableJson({
    indexVersion: WALLET_INTELLIGENCE_INDEX_VERSION,
    resultJson: job.resultJson,
    progressJson: relevantProgressPayload(job)
  })).digest("hex");
}

function addUnique<T extends { id: string }>(items: T[], item: T): void {
  if (!items.some((existing) => existing.id === item.id)) items.push(item);
}

function addSighting(
  sightings: WalletIntelligenceSightingInput[],
  input: Omit<WalletIntelligenceSightingInput, "id">
): void {
  addUnique(sightings, {
    id: stableId(["wallet_intelligence_sighting", input.jobId, input.address, input.sourceKind, input.role, input.pathId, input.depth, input.txHash]),
    ...input
  });
}

function addEdge(
  edges: WalletIntelligenceEdgeInput[],
  input: Omit<WalletIntelligenceEdgeInput, "id">
): void {
  addUnique(edges, {
    id: stableId(["wallet_intelligence_edge", input.jobId, input.fromAddress, input.toAddress, input.txHash, input.pathId, input.depth, input.sourceKind]),
    ...input
  });
}

export function extractWalletIntelligenceFromJob(job: ForensicCheckJob): WalletIntelligenceExtraction {
  if (!isSupportedKind(job.kind) || !isSupportedStatus(job.status)) {
    throw new Error(`Unsupported wallet intelligence job: ${job.kind}/${job.status}`);
  }
  const supportedJob = job as ForensicCheckJob & {
    kind: WalletIntelligenceSupportedJobKind;
    status: WalletIntelligenceJobStatus;
  };
  const sightings: WalletIntelligenceSightingInput[] = [];
  const edges: WalletIntelligenceEdgeInput[] = [];
  const run: WalletIntelligenceRunInput = {
    jobId: supportedJob.id,
    jobKind: supportedJob.kind,
    jobStatus: supportedJob.status,
    subjectAddress: supportedJob.subjectAddress,
    requestedBy: supportedJob.requestedBy,
    chatId: supportedJob.chatId,
    messageId: supportedJob.messageId,
    completedAt: supportedJob.completedAt,
    telegramUserId: null,
    telegramUsername: null,
    telegramLocale: null,
    sourcePayloadHash: sourcePayloadHash(supportedJob),
    indexVersion: WALLET_INTELLIGENCE_INDEX_VERSION,
    indexStatus: "indexed",
    indexError: null
  };

  if (supportedJob.kind === "address_deep_check") extractDeepCheck(supportedJob, sightings, edges);
  if (supportedJob.kind === "where_is_money_check") extractWhere(supportedJob, sightings, edges);
  if (supportedJob.kind === "incoming_deposit_check") extractIncoming(supportedJob, sightings, edges);

  return {
    run,
    sightings,
    edges,
    touchedAddresses: [...new Set([
      ...sightings.map((item) => item.address),
      ...edges.flatMap((edge) => [edge.fromAddress, edge.toAddress])
    ])]
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function addressArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.length > 0) return [item];
    if (isRecord(item)) {
      const address = stringField(item, "address");
      return address ? [address] : [];
    }
    return [];
  });
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function pathId(record: Record<string, unknown>, fallback: string): string {
  return stringField(record, "id") ?? stringField(record, "pathId") ?? fallback;
}

function roleForPathAddress(job: ForensicCheckJob, address: string, fallback: WalletIntelligenceSightingInput["role"]): WalletIntelligenceSightingInput["role"] {
  return address === job.subjectAddress ? "subject" : fallback;
}

function addAddressSighting(input: {
  job: ForensicCheckJob & { kind: WalletIntelligenceSupportedJobKind };
  sightings: WalletIntelligenceSightingInput[];
  address: string | null;
  sourceKind: WalletIntelligenceSightingInput["sourceKind"];
  role: WalletIntelligenceSightingInput["role"];
  depth: number | null;
  pathId: string | null;
  txHash: string | null;
  amountRaw: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  metadataJson?: Record<string, unknown>;
}): void {
  if (!input.address) return;
  addSighting(input.sightings, {
    address: input.address,
    jobId: input.job.id,
    jobKind: input.job.kind,
    subjectAddress: input.job.subjectAddress,
    requestedBy: input.job.requestedBy,
    sourceKind: input.sourceKind,
    role: input.role,
    depth: input.depth,
    pathId: input.pathId,
    txHash: input.txHash,
    amountRaw: input.amountRaw,
    firstSeenAt: input.firstSeenAt,
    lastSeenAt: input.lastSeenAt,
    metadataJson: input.metadataJson ?? {}
  });
}

function addTransferEdge(input: {
  job: ForensicCheckJob & { kind: WalletIntelligenceSupportedJobKind };
  edges: WalletIntelligenceEdgeInput[];
  transfer: Record<string, unknown>;
  sourceKind: WalletIntelligenceEdgeInput["sourceKind"];
  depth: number | null;
  pathId: string | null;
  edgeRole?: WalletIntelligenceEdgeInput["edgeRole"];
  metadataJson?: Record<string, unknown>;
}): void {
  const fromAddress = stringField(input.transfer, "fromAddress");
  const toAddress = stringField(input.transfer, "toAddress");
  if (!fromAddress || !toAddress) return;
  addEdge(input.edges, {
    fromAddress,
    toAddress,
    jobId: input.job.id,
    jobKind: input.job.kind,
    sourceKind: input.sourceKind,
    depth: input.depth,
    pathId: input.pathId,
    txHash: stringField(input.transfer, "txHash"),
    amountRaw: stringField(input.transfer, "amountRaw"),
    timestamp: dateField(input.transfer.timestamp),
    edgeRole: input.edgeRole ?? "transfer",
    metadataJson: {
      method: stringField(input.transfer, "method"),
      edgeType: stringField(input.transfer, "edgeType"),
      ...input.metadataJson
    }
  });
}

function extractDeepCheck(
  job: ForensicCheckJob & { kind: WalletIntelligenceSupportedJobKind },
  sightings: WalletIntelligenceSightingInput[],
  edges: WalletIntelligenceEdgeInput[]
): void {
  for (const profile of recordArray(job.resultJson.directCounterpartyInteractionProfiles)) {
    const address = stringField(profile, "counterpartyAddress");
    const txHashes = stringArray(profile.txHashes);
    addAddressSighting({
      job,
      sightings,
      address,
      sourceKind: "deep_direct_counterparty",
      role: "direct_counterparty",
      depth: 1,
      pathId: null,
      txHash: txHashes[0] ?? null,
      amountRaw: stringField(profile, "volumeRaw"),
      firstSeenAt: dateField(profile.firstSeen),
      lastSeenAt: dateField(profile.lastSeen),
      metadataJson: {
        direction: stringField(profile, "direction"),
        txCount: numberField(profile, "txCount"),
        serviceCategory: stringField(profile, "serviceCategory"),
        identity: stringField(profile, "identity")
      }
    });
    for (const transfer of recordArray(profile.transfers)) {
      addTransferEdge({
        job,
        edges,
        transfer,
        sourceKind: "deep_direct_counterparty",
        depth: 1,
        pathId: null,
        metadataJson: { direction: stringField(profile, "direction") }
      });
    }
  }

  const secondLayer = recordField(job.resultJson, "secondLayerRelationshipProfiles");
  if (!secondLayer) return;

  recordArray(secondLayer.paths).forEach((path, pathIndex) => {
    const id = pathId(path, `deep-second-layer-${pathIndex}`);
    addAddressSighting({
      job,
      sightings,
      address: stringField(path, "directWalletAddress"),
      sourceKind: "deep_second_layer",
      role: "direct_counterparty",
      depth: 1,
      pathId: id,
      txHash: stringArray(path.txHashes)[0] ?? null,
      amountRaw: stringField(path, "amountRaw"),
      firstSeenAt: dateField(path.firstSeen),
      lastSeenAt: dateField(path.lastSeen),
      metadataJson: { selectionReason: stringField(path, "selectionReason") }
    });
    addAddressSighting({
      job,
      sightings,
      address: stringField(path, "secondHopAddress"),
      sourceKind: "deep_second_layer",
      role: "second_hop",
      depth: 2,
      pathId: id,
      txHash: stringArray(path.txHashes)[0] ?? null,
      amountRaw: stringField(path, "amountRaw"),
      firstSeenAt: dateField(path.firstSeen),
      lastSeenAt: dateField(path.lastSeen),
      metadataJson: { directWalletAddress: stringField(path, "directWalletAddress") }
    });
    for (const transfer of recordArray(path.evidence)) {
      addTransferEdge({
        job,
        edges,
        transfer,
        sourceKind: "deep_second_layer",
        depth: 2,
        pathId: id
      });
    }
  });

  recordArray(secondLayer.groups).forEach((group, groupIndex) => {
    const id = pathId(group, `deep-second-layer-group-${groupIndex}`);
    for (const address of addressArray(group.members)) {
      addAddressSighting({
        job,
        sightings,
        address,
        sourceKind: "deep_second_layer",
        role: "second_hop",
        depth: 2,
        pathId: id,
        txHash: null,
        amountRaw: stringField(group, "amountRaw"),
        firstSeenAt: dateField(group.firstSeen),
        lastSeenAt: dateField(group.lastSeen),
        metadataJson: {
          groupKind: stringField(group, "kind"),
          directWalletAddress: stringField(group, "directWalletAddress"),
          memberCount: numberField(group, "memberCount"),
          txCount: numberField(group, "txCount")
        }
      });
    }
  });
}

function extractWhere(
  job: ForensicCheckJob & { kind: WalletIntelligenceSupportedJobKind },
  sightings: WalletIntelligenceSightingInput[],
  edges: WalletIntelligenceEdgeInput[]
): void {
  extractOriginPaths({
    job,
    sightings,
    edges,
    sourceKind: "where_origin_path",
    fallbackRole: "source",
    pathPrefix: "where-origin-path"
  });

  recordArray(job.resultJson.originPaths).forEach((path, pathIndex) => {
    const id = pathId(path, `where-origin-path-${pathIndex}`);
    const pathAddresses = addressArray(path.pathAddresses);
    recordArray(path.sourceProvenance).forEach((sourceProvenance) => {
      addSourceProvenanceSighting(job, sightings, sourceProvenance, "targetFromAddress", id, pathAddresses);
      addSourceProvenanceSighting(job, sightings, sourceProvenance, "targetToAddress", id, pathAddresses);
    });
  });
}

function extractIncoming(
  job: ForensicCheckJob & { kind: WalletIntelligenceSupportedJobKind },
  sightings: WalletIntelligenceSightingInput[],
  edges: WalletIntelligenceEdgeInput[]
): void {
  extractIncomingProgressDeposit(job, sightings, edges);

  extractOriginPaths({
    job,
    sightings,
    edges,
    sourceKind: "incoming_origin_path",
    fallbackRole: "funder",
    pathPrefix: "incoming-origin-path"
  });

  recordArray(job.resultJson.originPaths).forEach((path, pathIndex) => {
    const id = pathId(path, `incoming-origin-path-${pathIndex}`);
    recordArray(path.fundingBundles).forEach((bundle) => {
      for (const address of addressArray(bundle.fundingAddresses)) {
        addAddressSighting({
          job,
          sightings,
          address,
          sourceKind: "incoming_funding_bundle",
          role: "funder",
          depth: null,
          pathId: id,
          txHash: stringField(bundle, "targetTxHash"),
          amountRaw: stringField(bundle, "targetAmountRaw"),
          firstSeenAt: null,
          lastSeenAt: null,
          metadataJson: { targetTxHash: stringField(bundle, "targetTxHash") }
        });
      }
      for (const funder of recordArray(bundle.fundingFunders)) {
        addAddressSighting({
          job,
          sightings,
          address: stringField(funder, "address"),
          sourceKind: "incoming_funding_bundle",
          role: "funder",
          depth: null,
          pathId: id,
          txHash: stringArray(funder.txHashes)[0] ?? stringField(bundle, "targetTxHash"),
          amountRaw: stringField(funder, "amountRaw"),
          firstSeenAt: null,
          lastSeenAt: null,
          metadataJson: {
            targetTxHash: stringField(bundle, "targetTxHash"),
            txHashes: stringArray(funder.txHashes)
          }
        });
      }
    });
  });
}

function extractIncomingProgressDeposit(
  job: ForensicCheckJob & { kind: WalletIntelligenceSupportedJobKind },
  sightings: WalletIntelligenceSightingInput[],
  edges: WalletIntelligenceEdgeInput[]
): void {
  const depositTxHash = stringField(job.progressJson, "depositTxHash");
  const watchedWallet = stringField(job.progressJson, "watchedWallet");
  const sender = stringField(job.progressJson, "sender");
  if (!depositTxHash || !watchedWallet || !sender) return;

  const amountRaw = stringField(job.progressJson, "amountRaw");
  const timestamp = dateField(job.progressJson.timestamp);
  const pathId = "incoming-progress-deposit";
  addAddressSighting({
    job,
    sightings,
    address: sender,
    sourceKind: "incoming_origin_path",
    role: "source",
    depth: 0,
    pathId,
    txHash: depositTxHash,
    amountRaw,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    metadataJson: {}
  });
  addAddressSighting({
    job,
    sightings,
    address: watchedWallet,
    sourceKind: "incoming_origin_path",
    role: watchedWallet === job.subjectAddress ? "subject" : "unknown",
    depth: 1,
    pathId,
    txHash: depositTxHash,
    amountRaw,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    metadataJson: {}
  });
  addTransferEdge({
    job,
    edges,
    transfer: {
      txHash: depositTxHash,
      fromAddress: sender,
      toAddress: watchedWallet,
      amountRaw,
      timestamp: job.progressJson.timestamp
    },
    sourceKind: "incoming_origin_path",
    depth: 0,
    pathId
  });
}

function extractOriginPaths(input: {
  job: ForensicCheckJob & { kind: WalletIntelligenceSupportedJobKind };
  sightings: WalletIntelligenceSightingInput[];
  edges: WalletIntelligenceEdgeInput[];
  sourceKind: "where_origin_path" | "incoming_origin_path";
  fallbackRole: WalletIntelligenceSightingInput["role"];
  pathPrefix: string;
}): void {
  recordArray(input.job.resultJson.originPaths).forEach((path, pathIndex) => {
    const id = pathId(path, `${input.pathPrefix}-${pathIndex}`);
    const txHashes = stringArray(path.txHashes);
    addressArray(path.pathAddresses).forEach((address, depth) => {
      addAddressSighting({
        job: input.job,
        sightings: input.sightings,
        address,
        sourceKind: input.sourceKind,
        role: roleForPathAddress(input.job, address, input.fallbackRole),
        depth,
        pathId: id,
        txHash: txHashes[depth] ?? txHashes[0] ?? null,
        amountRaw: stringField(path, "amountRaw"),
        firstSeenAt: dateField(path.firstSeen),
        lastSeenAt: dateField(path.lastSeen),
        metadataJson: {}
      });
    });
    recordArray(path.steps).forEach((step, stepIndex) => {
      addTransferEdge({
        job: input.job,
        edges: input.edges,
        transfer: step,
        sourceKind: input.sourceKind,
        depth: stepIndex,
        pathId: id
      });
    });
  });
}

function addSourceProvenanceSighting(
  job: ForensicCheckJob & { kind: WalletIntelligenceSupportedJobKind },
  sightings: WalletIntelligenceSightingInput[],
  sourceProvenance: Record<string, unknown>,
  addressField: "targetFromAddress" | "targetToAddress",
  pathId: string,
  pathAddresses: string[]
): void {
  const address = stringField(sourceProvenance, addressField);
  const depth = address ? pathAddresses.indexOf(address) : -1;
  addAddressSighting({
    job,
    sightings,
    address,
    sourceKind: "where_source_provenance",
    role: address && address === job.subjectAddress ? "subject" : "source",
    depth: depth >= 0 ? depth : null,
    pathId,
    txHash: stringField(sourceProvenance, "targetTxHash"),
    amountRaw: stringField(sourceProvenance, "targetAmountRaw"),
    firstSeenAt: dateField(sourceProvenance.targetTimestamp),
    lastSeenAt: dateField(sourceProvenance.targetTimestamp),
    metadataJson: {
      proofClass: stringField(sourceProvenance, "proofClass"),
      amountContinuity: stringField(sourceProvenance, "amountContinuity"),
      stopReason: stringField(sourceProvenance, "stopReason"),
      coverageRatio: numberField(sourceProvenance, "coverageRatio"),
      reasons: stringArray(sourceProvenance.reasons)
    }
  });
}
