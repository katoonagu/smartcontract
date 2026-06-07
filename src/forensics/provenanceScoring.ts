import type {
  MoneyOriginPath,
  ProofLevel,
  RiskLayerScore,
  SourceExposureKind,
  SourcePolicyScope,
  SourcePolicyEvidence,
  SourcePolicyShareDetail,
  WhereIsMoneyAgeSignals,
  WhereIsMoneyRiskBand,
  WhereIsMoneyWalletRole
} from "../types";
import { selectedMoneyOriginPathShare } from "./moneyOriginAttribution";

const MIN_LINK_STRENGTH = 0.25;
const MAX_LINK_STRENGTH = 1.25;

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function finiteShare(value: number | null | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.min(1, value ?? 0) : 0;
}

function ratioInput(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return clampRatio(value / 100);
  return clampRatio(value);
}

const SOURCE_EXPOSURE_KINDS: readonly SourceExposureKind[] = [
  "htx_huobi",
  "whitebit",
  "bridge_router_dex",
  "cross_chain_boundary",
  "no_name_token_liquidity",
  "mixer",
  "sanctioned_service",
  "unknown_contract",
  "unknown_cex",
  "allowlisted_cex",
  "risky_label"
];

const NON_DAMPENABLE_SOURCE_EXPOSURE_KINDS: readonly SourceExposureKind[] = [
  "no_name_token_liquidity",
  "mixer",
  "sanctioned_service"
];

export function isSourceExposureKind(value: string | null | undefined): value is SourceExposureKind {
  return SOURCE_EXPOSURE_KINDS.includes(value as SourceExposureKind);
}

function isNonDampenableSourceExposureKind(kind: SourceExposureKind): boolean {
  return NON_DAMPENABLE_SOURCE_EXPOSURE_KINDS.includes(kind);
}

function rawPathShare(path: MoneyOriginPath): number {
  const selectedShare = selectedMoneyOriginPathShare(path);
  return selectedShare > 0 ? selectedShare : finiteShare(path.effectiveExposureShare);
}

function attributedPathShare(path: MoneyOriginPath, rawShare: number, amountContinuity: number, linkStrength: number): number {
  const explicitEffectiveShare = finiteShare(path.effectiveExposureShare);
  if (explicitEffectiveShare > 0) return explicitEffectiveShare;
  return finiteShare(rawShare * amountContinuity * linkStrength);
}

export function sourceExposureKindFromPath(path: MoneyOriginPath): SourceExposureKind | null {
  if (path.sourceExposureKind) return path.sourceExposureKind;
  if (isSourceExposureKind(path.exposureSourceKey)) return path.exposureSourceKey;

  if (path.rootSourceType === "allowlist_cex") return "allowlisted_cex";
  if (path.rootSourceType === "risky_label") return "risky_label";

  const rawText = [
    path.exposureSourceKey,
    path.exposureSourceLabel,
    ...path.reasons
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const text = rawText.replace(/[_:-]+/g, " ");

  if (text.includes("sanctioned") || text.includes("ofac")) return "sanctioned_service";
  if (text.includes("mixer") || text.includes("tornado")) return "mixer";
  if (/\bno name\b/.test(text) && text.includes("liquidity")) return "no_name_token_liquidity";
  if (text.includes("htx") || text.includes("huobi")) return "htx_huobi";
  if (text.includes("whitebit")) return "whitebit";
  if (/\b(bridge|router|dex|swap)\b/.test(text)) return "bridge_router_dex";
  if (text.includes("cross-chain") || text.includes("cross chain") || text.includes("layerzero") || text.includes("oft")) {
    return "cross_chain_boundary";
  }
  if (text.includes("unknown contract") || text.includes("contract boundary")) return "unknown_contract";
  if (text.includes("unknown cex") || text.includes("unknown exchange")) return "unknown_cex";

  return null;
}

export function riskBandFromScore(score: number): WhereIsMoneyRiskBand {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 45) return "MEDIUM";
  if (score >= 20) return "LOW-MEDIUM";
  return "LOW";
}

function sourceSeverity(kind: SourceExposureKind): number {
  if (kind === "htx_huobi") {
    return 80;
  }

  if (kind === "whitebit") {
    return 60;
  }

  if (kind === "bridge_router_dex" || kind === "cross_chain_boundary") {
    return 65;
  }

  if (kind === "no_name_token_liquidity") {
    return 88;
  }

  if (kind === "mixer") {
    return 92;
  }

  if (kind === "sanctioned_service") {
    return 98;
  }

  if (kind === "unknown_contract") {
    return 50;
  }

  if (kind === "unknown_cex") return 45;
  if (kind === "allowlisted_cex") return 5;
  if (kind === "risky_label") return 90;

  return 0;
}

function shareBandCap(kind: SourceExposureKind, share: number): number {
  const s = finiteShare(share);
  if (s <= 0) return 0;

  if (kind === "bridge_router_dex" || kind === "cross_chain_boundary") {
    if (s < 0.01) return 10;
    if (s < 0.05) return 20;
    if (s < 0.1) return 30;
    if (s < 0.2) return 45;
    if (s < 0.5) return 59;
    if (s < 0.8) return 70;
    return 78;
  }

  if (kind === "unknown_contract") {
    if (s < 0.05) return 15;
    if (s < 0.1) return 25;
    if (s < 0.2) return 35;
    if (s < 0.5) return 45;
    return 55;
  }

  if (kind === "unknown_cex") {
    if (s < 0.2) return 35;
    if (s < 0.5) return 45;
    return 50;
  }

  if (kind === "whitebit") {
    if (s < 0.05) return 30;
    if (s < 0.1) return 38;
    if (s < 0.3) return 50;
    if (s < 0.5) return 55;
    return 60;
  }

  if (kind === "htx_huobi") {
    if (s < 0.05) return 30;
    if (s < 0.1) return 45;
    if (s < 0.2) return 55;
    if (s < 0.3) return 68;
    if (s < 0.5) return 75;
    if (s < 0.8) return 82;
    return 85;
  }

  if (kind === "no_name_token_liquidity") return 88;
  if (kind === "mixer") return 95;
  if (kind === "sanctioned_service") return 100;

  return sourceSeverity(kind);
}

function shareFloorForKind(kind: SourceExposureKind, share: number, amountContinuity: number): number {
  const s = finiteShare(share);
  if (s <= 0) return 0;

  if (kind === "sanctioned_service") return 95;
  if (kind === "mixer") return 78;
  if (kind === "no_name_token_liquidity") return 70;

  if (
    (kind === "bridge_router_dex" || kind === "cross_chain_boundary") &&
    s >= 0.5 &&
    amountContinuity >= 0.7
  ) {
    return 60;
  }

  if (kind === "whitebit" && s >= 0.5) return 60;
  if (kind === "htx_huobi" && s >= 0.8) return 85;
  if (kind === "htx_huobi" && s >= 0.5) return 78;

  return 0;
}

export function baseShareScore(kind: SourceExposureKind, share: number): number {
  const s = finiteShare(share);
  if (s <= 0) return 0;

  const valueWeightedRaw = sourceSeverity(kind) * s;
  const shareFloor = shareFloorForKind(kind, s, 1);
  const shareCap = shareBandCap(kind, s);
  return clamp(Math.max(shareFloor, Math.min(shareCap, valueWeightedRaw)));
}

function pathHops(path: MoneyOriginPath): number {
  if (path.steps.length > 0) return Math.max(0, path.steps.length - 1);
  if (path.pathAddresses.length > 1) return Math.max(0, path.pathAddresses.length - 2);
  return 0;
}

function parsedTimestampMs(timestamp: string): number | null {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
}

function pathElapsedMs(path: MoneyOriginPath): number | null {
  if (path.timeSpanMs !== null && Number.isFinite(path.timeSpanMs) && path.timeSpanMs >= 0) {
    return path.timeSpanMs;
  }

  const timestamps = path.steps
    .map((step) => parsedTimestampMs(step.timestamp))
    .filter((value): value is number => value !== null);

  if (timestamps.length < 2) return null;
  return Math.max(...timestamps) - Math.min(...timestamps);
}

function parseAmountRaw(amountRaw: string): bigint | null {
  return /^\d+$/.test(amountRaw) ? BigInt(amountRaw) : null;
}

function amountPreservation(path: MoneyOriginPath): number {
  if (Number.isFinite(path.amountPreservationRatio) && path.amountPreservationRatio >= 0) {
    return clampRatio(path.amountPreservationRatio);
  }

  const amounts = path.steps
    .map((step) => parseAmountRaw(step.amountRaw))
    .filter((amount): amount is bigint => amount !== null && amount > 0n);

  if (amounts.length < 2) return 1;

  const first = amounts[0] ?? 0n;
  const last = amounts[amounts.length - 1] ?? 0n;
  if (first <= 0n) return 1;

  return clampRatio(Number((last * 10_000n) / first) / 10_000);
}

export function hopAdjustment(hops: number, avgTimePerHopMs: number | null, continuity: number): number {
  let adjustment = 0;

  if (hops <= 0) adjustment = 14;
  else if (hops === 1) adjustment = 12;
  else if (hops === 2) adjustment = 8;
  else if (hops <= 5) adjustment = 2;
  else if (hops <= 12) adjustment = -6;
  else adjustment = -12;

  if (adjustment < 0 && avgTimePerHopMs !== null && continuity >= 0.8 && avgTimePerHopMs <= 60 * 60 * 1000) {
    return Math.round(adjustment * 0.25);
  }

  if (adjustment < 0 && avgTimePerHopMs !== null && continuity >= 0.7 && avgTimePerHopMs <= 24 * 60 * 60 * 1000) {
    return Math.round(adjustment * 0.5);
  }

  if (adjustment < 0 && avgTimePerHopMs !== null && avgTimePerHopMs > 7 * 24 * 60 * 60 * 1000) {
    return adjustment - 4;
  }

  return adjustment;
}

export function timeAdjustment(elapsedMs: number | null): number {
  if (elapsedMs === null || !Number.isFinite(elapsedMs)) return 0;

  const minutes = elapsedMs / 60_000;
  if (minutes <= 10) return 12;
  if (minutes <= 60) return 10;
  if (minutes <= 6 * 60) return 7;
  if (minutes <= 24 * 60) return 4;
  if (minutes <= 7 * 24 * 60) return 0;
  if (minutes <= 30 * 24 * 60) return -5;
  return -12;
}

export function amountContinuityAdjustment(ratio: number): number {
  if (!Number.isFinite(ratio)) return -12;
  if (ratio >= 0.95) return 8;
  if (ratio >= 0.9) return 6;
  if (ratio >= 0.7) return 3;
  if (ratio >= 0.4) return -6;
  return -12;
}

function walletRoleAdjustment(
  role: WhereIsMoneyWalletRole,
  operationalLiquidityScore: number,
  cleanCexCoverage: number
): number {
  if (role === "risky_source_wallet") return 8;

  if (role === "operational_liquidity_wallet") {
    if (cleanCexCoverage >= 0.9) return -15;
    if (cleanCexCoverage >= 0.7) return -12;
    if (operationalLiquidityScore >= 80) return -12;
    if (operationalLiquidityScore >= 60) return -10;
    return -8;
  }

  if (role === "clean_cex_funded_wallet") {
    if (cleanCexCoverage >= 0.75) return -15;
    if (cleanCexCoverage >= 0.4) return -12;
    return -10;
  }

  return 0;
}

function sourceWalletRoleAdjustment(
  kind: SourceExposureKind,
  role: WhereIsMoneyWalletRole,
  operationalLiquidityScore: number,
  cleanCexCoverage: number
): number {
  const adjustment = walletRoleAdjustment(role, operationalLiquidityScore, cleanCexCoverage);
  if (adjustment < 0 && isNonDampenableSourceExposureKind(kind)) return 0;
  return adjustment;
}

function hopFactor(hops: number): number {
  if (hops <= 0) return 1.15;
  if (hops === 1) return 1.1;
  if (hops === 2) return 1;
  if (hops <= 5) return 0.85;
  if (hops <= 12) return 0.65;
  return 0.45;
}

function timeFactor(totalTimeMs: number | null): number {
  if (totalTimeMs === null) return 0.9;

  const hours = totalTimeMs / (60 * 60 * 1000);
  if (hours <= 1) return 1.15;
  if (hours <= 24) return 1.05;
  if (hours <= 24 * 7) return 0.9;
  if (hours <= 24 * 30) return 0.75;
  return 0.55;
}

function amountFactor(ratio: number): number {
  if (ratio >= 0.95) return 1.1;
  if (ratio >= 0.9) return 1.05;
  if (ratio >= 0.7) return 1;
  if (ratio >= 0.4) return 0.7;
  return 0.45;
}

function clampLinkStrength(linkStrength: number): number {
  if (!Number.isFinite(linkStrength)) return MIN_LINK_STRENGTH;
  return Math.max(MIN_LINK_STRENGTH, Math.min(MAX_LINK_STRENGTH, linkStrength));
}

export function scorePathLinkStrength(path: MoneyOriginPath): number {
  if (path.linkStrength !== null && path.linkStrength !== undefined && Number.isFinite(path.linkStrength)) {
    return clampLinkStrength(path.linkStrength);
  }

  const hops = pathHops(path);
  const elapsedMs = pathElapsedMs(path);
  const continuity = amountPreservation(path);

  return clampLinkStrength(hopFactor(hops) * timeFactor(elapsedMs) * amountFactor(continuity));
}

function repeatedExposureAdjustment(pathCount: number): number {
  if (pathCount >= 4) return 8;
  if (pathCount >= 2) return 5;
  return 0;
}

function dataQualityAdjustment(coverageCompleteness: number, provenanceConfidence: number): number {
  const coverage = ratioInput(coverageCompleteness);
  const confidence = ratioInput(provenanceConfidence);

  if (coverage >= 0.9 && confidence >= 0.75) return 0;
  if (coverage >= 0.7 && confidence >= 0.6) return 3;
  if (coverage >= 0.5 && confidence >= 0.45) return 6;
  if (coverage >= 0.3) return 10;
  return 15;
}

function ageAdjustment(ageSignals: WhereIsMoneyAgeSignals | null): number {
  if (!ageSignals) return 0;
  const ageDays = ageSignals.subjectAgeDays;
  if (ageDays !== null && ageDays <= 1) return 2;
  if (ageSignals.repeatedRelationshipCount > 0 || (ageSignals.longestRelationshipAgeDays ?? 0) >= 30) return -2;
  return 0;
}

function avgTimePerHop(hops: number, elapsedMs: number | null): number | null {
  if (elapsedMs === null) return null;
  return hops > 0 ? elapsedMs / hops : elapsedMs;
}

function pathContextScore(input: {
  hops: number;
  elapsedMs: number | null;
  continuity: number;
}): number {
  return hopAdjustment(input.hops, avgTimePerHop(input.hops, input.elapsedMs), input.continuity) +
    timeAdjustment(input.elapsedMs) +
    amountContinuityAdjustment(input.continuity);
}

function multiplyRawByShare(amountRaw: string, share: number): string | null {
  const amount = parseAmountRaw(amountRaw);
  if (amount === null) return null;

  const scale = 1_000_000_000_000n;
  const scaledShare = BigInt(Math.round(clampRatio(share) * Number(scale)));
  return ((amount * scaledShare + scale / 2n) / scale).toString();
}

function exactAffectedAmountRaw(paths: MoneyOriginPath[], targetAmountRaw: string | null | undefined): string | null {
  const target = targetAmountRaw ? parseAmountRaw(targetAmountRaw) : null;
  let sum = 0n;
  let sawExactUsage = false;
  for (const path of paths) {
    const usedRaw = path.amountUsage?.usedAmountRaw;
    const usedAmount = usedRaw ? parseAmountRaw(usedRaw) : null;
    if (usedAmount === null) continue;
    sawExactUsage = true;
    const branchShare = finiteShare(path.balanceShare) || 1;
    const branchAmountRaw = multiplyRawByShare(usedRaw ?? "0", branchShare);
    const branchAmount = branchAmountRaw ? parseAmountRaw(branchAmountRaw) : null;
    sum += branchAmount ?? usedAmount;
  }

  if (!sawExactUsage) return null;
  if (target !== null && target > 0n && sum > target) return target.toString();
  return sum.toString();
}

function dedupeKeyForPath(kind: SourceExposureKind, path: MoneyOriginPath): string {
  const root = path.rootSourceAddress ?? path.exposureSourceKey ?? path.exposureSourceLabel ?? "unknown-root";
  const txSet = [...new Set(path.txHashes)].sort().join(",");
  const txKey = txSet.length > 0 ? txSet : path.balanceTransferTxHash;
  return `${kind}|${root}|${txKey}`;
}

function sourcePolicyShareDetail(input: {
  scope: SourcePolicyScope | undefined;
  targetAmountRaw: string | null | undefined;
  kind: SourceExposureKind;
  rawShare: number;
  effectiveShare: number;
  valueWeightedRaw: number;
  pathContextAdjustment: number;
  repeatedExposureAdjustment: number;
  dataQualityAdjustment: number;
  walletRoleAdjustment: number;
  shareFloor: number;
  shareCap: number;
  finalContribution: number;
  affectedAmountRaw?: string | null;
}): SourcePolicyShareDetail | undefined {
  if (!input.scope || !input.targetAmountRaw) return undefined;

  const affectedAmountRaw = input.affectedAmountRaw ?? multiplyRawByShare(input.targetAmountRaw, input.rawShare);
  if (affectedAmountRaw === null) return undefined;

  return {
    scope: input.scope,
    targetAmountRaw: input.targetAmountRaw,
    affectedAmountRaw,
    rawShare: input.rawShare,
    effectiveShare: input.effectiveShare,
    sourceSeverity: sourceSeverity(input.kind),
    valueWeightedRaw: input.valueWeightedRaw,
    pathContextAdjustment: input.pathContextAdjustment,
    repeatedExposureAdjustment: input.repeatedExposureAdjustment,
    dataQualityAdjustment: input.dataQualityAdjustment,
    walletRoleAdjustment: input.walletRoleAdjustment,
    shareFloor: input.shareFloor,
    shareCap: input.shareCap,
    finalContribution: input.finalContribution
  };
}

export function aggregateLayerScores(scores: number[]): number {
  const sorted = scores
    .filter((score) => Number.isFinite(score) && score > 0)
    .sort((a, b) => b - a);

  const first = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const third = sorted[2] ?? 0;

  return clamp(first + Math.min(10, second * 0.15) + Math.min(5, third * 0.05));
}

export type ScoreSourceExposuresInput = {
  originPaths: MoneyOriginPath[];
  walletRole: WhereIsMoneyWalletRole;
  operationalLiquidityScore: number;
  cleanCexCoverage: number;
  coverageCompleteness: number;
  provenanceConfidence: number;
  ageSignals: WhereIsMoneyAgeSignals | null;
  scope?: SourcePolicyScope;
  targetAmountRaw?: string | null;
};

export type ScoreSourceExposuresResult = {
  sourcePolicyEvidence: SourcePolicyEvidence[];
  sourcePolicyScore: number;
  riskLayers: RiskLayerScore[];
  warnings: string[];
};

export function scoreSourceExposures(input: ScoreSourceExposuresInput): ScoreSourceExposuresResult {
  const grouped = new Map<SourceExposureKind, MoneyOriginPath[]>();

  for (const path of input.originPaths) {
    const kind = sourceExposureKindFromPath(path);
    if (!kind || kind === "allowlisted_cex" || kind === "risky_label") continue;
    grouped.set(kind, [...(grouped.get(kind) ?? []), path]);
  }

  const sourcePolicyEvidence: SourcePolicyEvidence[] = [];
  const riskLayers: RiskLayerScore[] = [];

  for (const [kind, paths] of grouped) {
    const enriched = paths.map((path) => {
      const hops = pathHops(path);
      const elapsedMs = pathElapsedMs(path);
      const continuity = amountPreservation(path);
      const linkStrength = scorePathLinkStrength(path);
      const share = rawPathShare(path);

      return {
        path,
        share,
        hops,
        elapsedMs,
        avgTimePerHopMs: avgTimePerHop(hops, elapsedMs),
        continuity,
        linkStrength,
        pathContext: pathContextScore({ hops, elapsedMs, continuity }),
        effectiveShare: attributedPathShare(path, share, continuity, linkStrength)
      };
    });

    const dedupedBySource = new Map<string, (typeof enriched)[number]>();
    for (const item of enriched) {
      const key = dedupeKeyForPath(kind, item.path);
      const existing = dedupedBySource.get(key);
      if (
        !existing ||
        item.share > existing.share ||
        (item.share === existing.share && item.effectiveShare > existing.effectiveShare)
      ) {
        dedupedBySource.set(key, item);
      }
    }

    const deduped = [...dedupedBySource.values()];
    const aggregateShare = Math.min(1, deduped.reduce((sum, item) => sum + item.share, 0));
    const effectiveShare = Math.min(1, deduped.reduce((sum, item) => sum + item.effectiveShare, 0));
    const attributableShare = Math.min(aggregateShare, effectiveShare);
    const curveShare = effectiveShare;
    const best = [...deduped].sort((left, right) => right.pathContext - left.pathContext)[0] ?? null;
    const valueWeightedRaw = sourceSeverity(kind) * curveShare;
    const pathContextAdjustment = best?.pathContext ?? 0;
    const exposureRepetitionAdjustment = repeatedExposureAdjustment(deduped.length);
    const exposureDataQualityAdjustment = dataQualityAdjustment(input.coverageCompleteness, input.provenanceConfidence);
    const exposureAgeAdjustment = ageAdjustment(input.ageSignals);
    const exposureWalletRoleAdjustment = sourceWalletRoleAdjustment(
      kind,
      input.walletRole,
      input.operationalLiquidityScore,
      input.cleanCexCoverage
    );
    const rawScore = valueWeightedRaw +
      pathContextAdjustment +
      exposureRepetitionAdjustment +
      exposureDataQualityAdjustment +
      exposureAgeAdjustment +
      exposureWalletRoleAdjustment;

    const bestContinuity = Math.max(...deduped.map((item) => item.continuity), 0);
    const shareFloor = shareFloorForKind(kind, attributableShare, bestContinuity);
    const shareCap = shareBandCap(kind, attributableShare);
    const adjustedScore = clamp(Math.max(shareFloor, Math.min(shareCap, rawScore)));
    const proofLevel: ProofLevel = adjustedScore >= 60 ? "exchange_policy_decline" : "exchange_policy_context";
    const canBeDampened = !isNonDampenableSourceExposureKind(kind) && (kind !== "htx_huobi" || attributableShare < 0.5);
    const reasons = [
      `${kind} exposure is ${Math.round(aggregateShare * 100)}% raw / ${Math.round(effectiveShare * 100)}% effective; this is source-policy risk, not scam/drain proof.`
    ];
    const warnings = adjustedScore < 60
      ? ["Source-policy exposure is below decline threshold after path context and dampening."]
      : [];
    const evidenceIds = [...new Set(paths.flatMap((path) => path.txHashes))];
    const capApplied = adjustedScore < Math.round(rawScore) ? adjustedScore : undefined;
    const floorApplied = adjustedScore > Math.round(rawScore) ? adjustedScore : undefined;
    const shareDetail = sourcePolicyShareDetail({
      scope: input.scope,
      targetAmountRaw: input.targetAmountRaw,
      kind,
      rawShare: aggregateShare,
      effectiveShare,
      valueWeightedRaw,
      pathContextAdjustment,
      repeatedExposureAdjustment: exposureRepetitionAdjustment,
      dataQualityAdjustment: exposureDataQualityAdjustment,
      walletRoleAdjustment: exposureWalletRoleAdjustment,
      shareFloor,
      shareCap,
      finalContribution: adjustedScore,
      affectedAmountRaw: exactAffectedAmountRaw(deduped.map((item) => item.path), input.targetAmountRaw)
    });

    sourcePolicyEvidence.push({
      kind,
      aggregateShare,
      effectiveShare,
      pathCount: deduped.length,
      score: adjustedScore,
      riskBand: riskBandFromScore(adjustedScore),
      proofLevel,
      canBeDampened,
      reasons,
      warnings,
      evidenceIds,
      shareDetail,
      topPath: best
        ? {
            hops: best.hops,
            elapsedMs: best.elapsedMs,
            avgTimePerHopMs: best.avgTimePerHopMs,
            amountContinuity: best.continuity,
            linkStrength: best.linkStrength
          }
        : undefined
    });

    riskLayers.push({
      evidenceClass: "source_policy",
      kind,
      sourceExposureKind: kind,
      score: adjustedScore,
      rawScore,
      adjustedScore,
      proofLevel,
      canBeDampened,
      capApplied,
      floorApplied,
      reasons,
      warnings,
      evidenceIds,
      shareDetail
    });
  }

  return {
    sourcePolicyEvidence,
    sourcePolicyScore: aggregateLayerScores(sourcePolicyEvidence.map((item) => item.score)),
    riskLayers,
    warnings: sourcePolicyEvidence.flatMap((item) => item.warnings)
  };
}
