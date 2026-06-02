import type {
  BalanceFormingSelection,
  BalanceFormingTransfer,
  CrossChainStage2TriggerReason,
  MoneyOriginDrainEpisode,
  MoneyOriginPath,
  ServiceExposureProfile,
  SourceExposureKind,
  WhereIsMoneyAssessment
} from "../types";
import {
  DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW,
  DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD
} from "./provenanceTracingConfig";

export type CrossChainStage2TriggerEvaluation = {
  triggered: boolean;
  reason: CrossChainStage2TriggerReason | null;
  skippedReason: string | null;
  deepCheckAvailable: boolean;
  balanceTransferTxHashes: string[];
  selectedAmountRaw: string;
  targetAmountRaw: string;
};

export type CrossChainDeepBridgeExposure = {
  source: "address_deep_check";
  bridgeExposureRaw: string;
  bridgeExposureShare: number;
  totalOutgoingRaw: string;
  balanceTransferTxHashes?: string[];
};

const MEDIUM_THRESHOLD_RAW = 10_000_000_000n;
const LARGE_THRESHOLD_RAW = 100_000_000_000n;
const SPLIT_TIME_WINDOW_MS = 6 * 60 * 60 * 1000;
const MIN_SPLIT_AMOUNT_PRESERVATION = 0.65;

const BOUNDARY_EXPOSURE_KINDS = new Set<SourceExposureKind>([
  "bridge_router_dex",
  "cross_chain_boundary",
  "unknown_contract",
  "no_name_token_liquidity",
  "mixer",
  "sanctioned_service"
]);

const DIRECT_HIGH_RISK_EXPOSURE_KINDS = new Set<SourceExposureKind>([
  "mixer",
  "sanctioned_service",
  "no_name_token_liquidity"
]);

const BOUNDARY_KEYWORD_PATTERN =
  /\b(layerzero|stargate|oft|wormhole|axelar|cctp|bridge|router|dex|swap|uniswap|tornado|mixer|sanctioned?|no[-_\s]?name)\b/i;

type BoundaryCandidate = {
  path: MoneyOriginPath;
  transfer: BalanceFormingTransfer;
  amountRaw: bigint;
  timestampMs: number;
  toAddressKey: string;
  fromAddressKey: string;
  rootSourceAddressKey: string;
  boundaryFamilyKey: string | null;
};

function parseAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function parseStrictAmount(value: string | null | undefined): bigint | null {
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

function normalizeAddress(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ratioFromRaw(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  const scale = 1_000_000_000n;
  return clampRatio(Number((numerator * scale) / denominator) / Number(scale));
}

function uniquePathTxHashes(paths: MoneyOriginPath[]): string[] {
  return uniqueInOrder(paths.map((path) => path.balanceTransferTxHash));
}

function baseEvaluation(input: BalanceFormingSelection): CrossChainStage2TriggerEvaluation {
  return {
    triggered: false,
    reason: null,
    skippedReason: null,
    deepCheckAvailable: false,
    balanceTransferTxHashes: [],
    selectedAmountRaw: input.selectedAmountRaw,
    targetAmountRaw: input.targetAmountRaw
  };
}

function triggeredEvaluation(
  selection: BalanceFormingSelection,
  reason: CrossChainStage2TriggerReason,
  balanceTransferTxHashes: string[]
): CrossChainStage2TriggerEvaluation {
  return {
    ...baseEvaluation(selection),
    triggered: true,
    reason,
    deepCheckAvailable: true,
    balanceTransferTxHashes
  };
}

function skippedEvaluation(
  selection: BalanceFormingSelection,
  skippedReason: string,
  input: { deepCheckAvailable: boolean; balanceTransferTxHashes?: string[] }
): CrossChainStage2TriggerEvaluation {
  return {
    ...baseEvaluation(selection),
    skippedReason,
    deepCheckAvailable: input.deepCheckAvailable,
    balanceTransferTxHashes: input.balanceTransferTxHashes ?? []
  };
}

function pathText(path: MoneyOriginPath): string {
  const scoreText = path.scoreBreakdown
    ?.flatMap((layer) => [
      layer.kind,
      layer.sourceExposureKind
    ])
    .filter((value): value is string => typeof value === "string") ?? [];

  return [
    path.sourceExposureKind,
    path.exposureSourceKey,
    path.exposureSourceLabel,
    ...scoreText
  ].join(" ");
}

function isBoundaryPath(path: MoneyOriginPath): boolean {
  if (path.sourceExposureKind && BOUNDARY_EXPOSURE_KINDS.has(path.sourceExposureKind)) {
    return true;
  }

  if (path.scoreBreakdown?.some((layer) =>
    layer.sourceExposureKind && BOUNDARY_EXPOSURE_KINDS.has(layer.sourceExposureKind)
  )) {
    return true;
  }

  return BOUNDARY_KEYWORD_PATTERN.test(pathText(path));
}

function hasDirectHighRiskEvidence(assessment: WhereIsMoneyAssessment): boolean {
  if (assessment.hardBadEvidence.some((evidence) =>
    evidence.kind === "approval_drain" || evidence.kind === "sanctioned_service"
  )) {
    return true;
  }

  if (assessment.sourcePolicyEvidence.some((evidence) =>
    DIRECT_HIGH_RISK_EXPOSURE_KINDS.has(evidence.kind)
  )) {
    return true;
  }

  return assessment.riskLayers.some((layer) => {
    if (layer.sourceExposureKind && DIRECT_HIGH_RISK_EXPOSURE_KINDS.has(layer.sourceExposureKind)) {
      return true;
    }

    const kind = normalizeText(layer.kind).replaceAll("-", "_");
    return kind.includes("mixer") ||
      kind.includes("tornado") ||
      kind.includes("sanctioned") ||
      kind.includes("no_name_token_liquidity");
  });
}

function selectedTransferMap(selection: BalanceFormingSelection): Map<string, BalanceFormingTransfer> {
  return new Map(selection.transfers.map((transfer) => [transfer.txHash, transfer]));
}

function boundaryCandidates(
  selection: BalanceFormingSelection,
  originPaths: MoneyOriginPath[]
): BoundaryCandidate[] {
  const transfersByTxHash = selectedTransferMap(selection);

  return originPaths
    .filter((path) => transfersByTxHash.has(path.balanceTransferTxHash) && isBoundaryPath(path))
    .map((path) => {
      const transfer = transfersByTxHash.get(path.balanceTransferTxHash);
      if (!transfer) return null;

      return {
        path,
        transfer,
        amountRaw: parseAmount(transfer.amountRaw),
        timestampMs: Date.parse(transfer.timestamp),
        toAddressKey: normalizeAddress(transfer.toAddress),
        fromAddressKey: normalizeAddress(transfer.fromAddress),
        rootSourceAddressKey: normalizeAddress(path.rootSourceAddress),
        boundaryFamilyKey: boundaryFamilyKey(path)
      };
    })
    .filter((candidate): candidate is BoundaryCandidate => candidate !== null);
}

function gateAmount(selection: BalanceFormingSelection): bigint {
  if (selection.provenanceScope === "recent_flow") {
    return parseAmount(selection.anchorTransfer?.amountRaw);
  }

  return parseAmount(selection.selectedAmountRaw);
}

function transactionSeedGateAmount(candidates: BoundaryCandidate[]): bigint {
  return candidates.reduce(
    (max, candidate) => candidate.amountRaw > max ? candidate.amountRaw : max,
    0n
  );
}

function isRecentFlow(selection: BalanceFormingSelection): boolean {
  return selection.provenanceScope === "recent_flow" ||
    selection.selectionMethod === "recent_outgoing" ||
    selection.selectionMethod === "recent_large_inbound";
}

function isTransactionSeed(selection: BalanceFormingSelection): boolean {
  return selection.provenanceScope === "transaction_seed" ||
    selection.selectionMethod === "transaction_seed";
}

function specificFamilyFromText(text: string): string | null {
  const normalized = normalizeText(text).replaceAll("_", " ").replaceAll("-", " ");

  if (normalized.includes("stargate")) return "stargate";
  if (normalized.includes("layerzero") || /\boft\b/.test(normalized)) return "layerzero";
  if (normalized.includes("wormhole")) return "wormhole";
  if (normalized.includes("axelar")) return "axelar";
  if (normalized.includes("cctp")) return "cctp";
  if (normalized.includes("uniswap")) return "uniswap";
  if (normalized.includes("tornado")) return "tornado";

  return null;
}

function nonGenericSourceKey(value: string | null | undefined): string | null {
  const normalized = normalizeText(value).replaceAll(" ", "_").replaceAll("-", "_");
  if (!normalized) return null;

  if (
    normalized === "bridge" ||
    normalized === "router" ||
    normalized === "dex" ||
    normalized === "swap" ||
    normalized === "bridge_router_dex" ||
    normalized === "cross_chain_boundary" ||
    normalized === "unknown_contract"
  ) {
    return null;
  }

  return normalized;
}

function boundaryFamilyKey(path: MoneyOriginPath): string | null {
  const explicitProtocol =
    specificFamilyFromText(path.exposureSourceKey ?? "") ??
    specificFamilyFromText(path.exposureSourceLabel ?? "") ??
    specificFamilyFromText(path.reasons.join(" "));
  if (explicitProtocol) return `protocol:${explicitProtocol}`;

  const sourceKey = nonGenericSourceKey(path.exposureSourceKey);
  if (sourceKey) return `source:${sourceKey}`;

  const labelKey = nonGenericSourceKey(path.exposureSourceLabel);
  if (labelKey) return `label:${labelKey}`;

  const rootSourceAddress = normalizeAddress(path.rootSourceAddress);
  return rootSourceAddress ? `address:${rootSourceAddress}` : null;
}

function groupCandidatesByKey(
  candidates: BoundaryCandidate[],
  keyForCandidate: (candidate: BoundaryCandidate) => string | null
): BoundaryCandidate[][] {
  const groups = new Map<string, BoundaryCandidate[]>();

  for (const candidate of candidates) {
    const key = keyForCandidate(candidate);
    if (!key) continue;

    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function timestampWindowMatches(candidates: BoundaryCandidate[]): boolean {
  const timestamps = candidates
    .map((candidate) => candidate.timestampMs)
    .filter((timestamp) => Number.isFinite(timestamp));

  if (timestamps.length !== candidates.length) return false;

  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  return maxTimestamp - minTimestamp <= SPLIT_TIME_WINDOW_MS;
}

function totalCandidateAmount(candidates: BoundaryCandidate[]): bigint {
  return candidates.reduce((sum, candidate) => sum + candidate.amountRaw, 0n);
}

function validSplitGroup(candidates: BoundaryCandidate[]): BoundaryCandidate[] | null {
  const preservedCandidates = candidates.filter((candidate) =>
    candidate.path.amountPreservationRatio >= MIN_SPLIT_AMOUNT_PRESERVATION
  );

  if (preservedCandidates.length < 2) return null;
  if (!timestampWindowMatches(preservedCandidates)) return null;
  if (totalCandidateAmount(preservedCandidates) < LARGE_THRESHOLD_RAW) return null;

  return preservedCandidates;
}

function findLargeSplitGroup(candidates: BoundaryCandidate[]): BoundaryCandidate[] | null {
  const groups = [
    ...groupCandidatesByKey(
      candidates,
      (candidate) => candidate.toAddressKey && candidate.fromAddressKey
        ? `${candidate.toAddressKey}|from:${candidate.fromAddressKey}`
        : null
    ),
    ...groupCandidatesByKey(
      candidates,
      (candidate) => candidate.toAddressKey && candidate.rootSourceAddressKey && candidate.boundaryFamilyKey
        ? `${candidate.toAddressKey}|root:${candidate.rootSourceAddressKey}|family:${candidate.boundaryFamilyKey}`
        : null
    )
  ];

  for (const group of groups) {
    const validGroup = validSplitGroup(group);
    if (validGroup) return validGroup;
  }

  return null;
}

function candidateTxHashes(candidates: BoundaryCandidate[]): string[] {
  return uniquePathTxHashes(candidates.map((candidate) => candidate.path));
}

function isBridgeServiceCategory(category: ServiceExposureProfile["categoryBreakdown"][number]["category"]): boolean {
  return category === "bridge" || category === "bridge_pool";
}

function deepBridgeExposureForProfile(profile: ServiceExposureProfile): CrossChainDeepBridgeExposure | null {
  const bridgeCategories = profile.categoryBreakdown
    .filter((category) => isBridgeServiceCategory(category.category))
    .map((category) => parseStrictAmount(category.volumeRaw))
    .filter((amount): amount is bigint => amount !== null && amount > 0n);
  if (bridgeCategories.length === 0) return null;

  const bridgeExposureRaw = bridgeCategories.reduce(
    (sum, amount) => sum + amount,
    0n
  );
  const totalOutgoingRaw = parseStrictAmount(profile.totalOutgoingRaw);
  const bridgeExposureShare = totalOutgoingRaw !== null && totalOutgoingRaw > 0n
    ? ratioFromRaw(bridgeExposureRaw, totalOutgoingRaw)
    : 0;

  return {
    source: "address_deep_check",
    bridgeExposureRaw: bridgeExposureRaw.toString(),
    bridgeExposureShare,
    totalOutgoingRaw: totalOutgoingRaw !== null && totalOutgoingRaw > 0n
      ? totalOutgoingRaw.toString()
      : "0"
  };
}

export function deepBridgeExposureFromServiceProfiles(
  profiles: ServiceExposureProfile[]
): CrossChainDeepBridgeExposure | null {
  const candidates = profiles
    .map((profile) => ({
      profile,
      exposure: deepBridgeExposureForProfile(profile)
    }))
    .filter((candidate): candidate is { profile: ServiceExposureProfile; exposure: CrossChainDeepBridgeExposure } =>
      candidate.exposure !== null
    );

  candidates.sort((left, right) => {
    const leftRaw = parseAmount(left.exposure.bridgeExposureRaw);
    const rightRaw = parseAmount(right.exposure.bridgeExposureRaw);
    if (leftRaw !== rightRaw) return rightRaw > leftRaw ? 1 : -1;

    if (left.exposure.bridgeExposureShare !== right.exposure.bridgeExposureShare) {
      return right.exposure.bridgeExposureShare - left.exposure.bridgeExposureShare;
    }

    return normalizeAddress(left.profile.subjectAddress).localeCompare(normalizeAddress(right.profile.subjectAddress));
  });

  return candidates[0]?.exposure ?? null;
}

export function evaluateCrossChainStage2Trigger(input: {
  selection: BalanceFormingSelection;
  originPaths: MoneyOriginPath[];
  assessment: WhereIsMoneyAssessment;
  manualDeepMode?: boolean;
  drainEpisode?: MoneyOriginDrainEpisode | null;
  deepBridgeExposure?: CrossChainDeepBridgeExposure | null;
}): CrossChainStage2TriggerEvaluation {
  const { selection, originPaths, assessment } = input;

  if (input.manualDeepMode === true) {
    const pathTxHashes = uniquePathTxHashes(originPaths);
    return triggeredEvaluation(
      selection,
      "manual_deep_mode",
      pathTxHashes.length > 0
        ? pathTxHashes
        : uniqueInOrder(selection.transfers.map((transfer) => transfer.txHash))
    );
  }

  const drainEpisode = input.drainEpisode ?? null;
  if (drainEpisode) {
    const bridgeOutgoingRaw = parseAmount(drainEpisode.bridgeOutgoingRaw);
    const bridgeAmountThresholdRaw = parseAmount(DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW);

    if (
      bridgeOutgoingRaw >= bridgeAmountThresholdRaw ||
      drainEpisode.bridgeOutgoingShare >= DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD
    ) {
      return {
        ...baseEvaluation(selection),
        triggered: true,
        reason: "drain_episode_bridge_exposure",
        skippedReason: null,
        deepCheckAvailable: true,
        balanceTransferTxHashes: uniqueInOrder(drainEpisode.outgoingTxHashes),
        selectedAmountRaw: drainEpisode.bridgeOutgoingRaw,
        targetAmountRaw: drainEpisode.episodeOutgoingRaw
      };
    }
  }

  const deepBridgeExposure = input.deepBridgeExposure ?? null;
  if (deepBridgeExposure) {
    const bridgeExposureRaw = parseStrictAmount(deepBridgeExposure.bridgeExposureRaw);
    const bridgeAmountThresholdRaw = parseAmount(DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW);
    const bridgeExposureShare = clampRatio(deepBridgeExposure.bridgeExposureShare);

    if (
      bridgeExposureRaw !== null &&
      bridgeExposureRaw > 0n &&
      (
        bridgeExposureRaw >= bridgeAmountThresholdRaw ||
        bridgeExposureShare >= DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD
      )
    ) {
      return {
        ...baseEvaluation(selection),
        triggered: true,
        reason: "deep_service_exposure_bridge",
        skippedReason: null,
        deepCheckAvailable: true,
        balanceTransferTxHashes: uniqueInOrder(deepBridgeExposure.balanceTransferTxHashes ?? []),
        selectedAmountRaw: deepBridgeExposure.bridgeExposureRaw,
        targetAmountRaw: deepBridgeExposure.totalOutgoingRaw
      };
    }
  }

  const candidates = boundaryCandidates(selection, originPaths);
  const boundaryTxHashes = candidateTxHashes(candidates);

  if (candidates.length === 0) {
    if (deepBridgeExposure) {
      return skippedEvaluation(selection, "No selected cross-chain boundary is visible; deep bridge exposure was below threshold.", {
        deepCheckAvailable: false
      });
    }

    return skippedEvaluation(selection, "No selected cross-chain boundary is visible.", {
      deepCheckAvailable: false
    });
  }

  const amountForGate = isTransactionSeed(selection)
    ? transactionSeedGateAmount(candidates)
    : gateAmount(selection);
  const directHighRisk = hasDirectHighRiskEvidence(assessment);

  if (isRecentFlow(selection)) {
    if (amountForGate >= LARGE_THRESHOLD_RAW) {
      return triggeredEvaluation(selection, "large_single_boundary", boundaryTxHashes);
    }

    if (amountForGate >= MEDIUM_THRESHOLD_RAW) {
      if (directHighRisk) {
        return triggeredEvaluation(selection, "medium_direct_high_risk", boundaryTxHashes);
      }

      return skippedEvaluation(
        selection,
        "Medium recent-flow anchor skipped because no direct high-risk cheap evidence is present.",
        { deepCheckAvailable: true, balanceTransferTxHashes: boundaryTxHashes }
      );
    }

    return skippedEvaluation(
      selection,
      "Small recent-flow anchor below Stage 2 automatic threshold; manual deep check is available for visible boundary.",
      { deepCheckAvailable: true, balanceTransferTxHashes: boundaryTxHashes }
    );
  }

  const largeSingleCandidates = candidates.filter((candidate) => candidate.amountRaw >= LARGE_THRESHOLD_RAW);

  if (largeSingleCandidates.length > 0) {
    return triggeredEvaluation(
      selection,
      "large_single_boundary",
      candidateTxHashes(largeSingleCandidates)
    );
  }

  if (!isTransactionSeed(selection) && amountForGate >= LARGE_THRESHOLD_RAW) {
    const splitGroup = findLargeSplitGroup(candidates);
    if (splitGroup) {
      return triggeredEvaluation(selection, "large_split_boundary", candidateTxHashes(splitGroup));
    }

    return skippedEvaluation(
      selection,
      "Large boundary paths skipped because selected transfers do not form a preserved split flow.",
      { deepCheckAvailable: true, balanceTransferTxHashes: boundaryTxHashes }
    );
  }

  if (amountForGate >= MEDIUM_THRESHOLD_RAW) {
    if (directHighRisk) {
      return triggeredEvaluation(selection, "medium_direct_high_risk", boundaryTxHashes);
    }

    return skippedEvaluation(
      selection,
      "Medium boundary amount skipped because no direct high-risk cheap evidence is present.",
      { deepCheckAvailable: true, balanceTransferTxHashes: boundaryTxHashes }
    );
  }

  return skippedEvaluation(
    selection,
    "Visible cross-chain boundary skipped for low amount; manual deep check is available.",
    { deepCheckAvailable: true, balanceTransferTxHashes: boundaryTxHashes }
  );
}
