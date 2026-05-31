import type {
  MoneyOriginPath,
  ProofLevel,
  RiskLayerScore,
  SourceExposureKind,
  SourcePolicyEvidence,
  WhereIsMoneyAgeSignals,
  WhereIsMoneyRiskBand,
  WhereIsMoneyWalletRole
} from "../types";

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

function rawPathShare(path: MoneyOriginPath): number {
  const balanceShare = finiteShare(path.balanceShare);
  return balanceShare > 0 ? balanceShare : finiteShare(path.effectiveExposureShare);
}

function pathKind(path: MoneyOriginPath): SourceExposureKind | null {
  if (path.sourceExposureKind) return path.sourceExposureKind;

  if (path.rootSourceType === "allowlist_cex") return "allowlisted_cex";
  if (path.rootSourceType === "risky_label") return "risky_label";

  const text = [
    path.exposureSourceKey,
    path.exposureSourceLabel,
    ...path.reasons
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

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

export function baseShareScore(kind: SourceExposureKind, share: number): number {
  const s = finiteShare(share);

  if (kind === "htx_huobi") {
    if (s >= 0.8) return 85;
    if (s >= 0.5) return 78;
    if (s >= 0.3) return 68;
    if (s >= 0.2) return 54;
    if (s >= 0.1) return 45;
    if (s >= 0.05) return 30;
    return s > 0 ? 18 : 0;
  }

  if (kind === "whitebit") {
    if (s >= 0.5) return 60;
    if (s >= 0.3) return 52;
    if (s >= 0.1) return 38;
    return s > 0 ? 24 : 0;
  }

  if (kind === "bridge_router_dex" || kind === "cross_chain_boundary") {
    if (s >= 0.5) return 70;
    if (s >= 0.2) return 62;
    return s > 0 ? 55 : 0;
  }

  if (kind === "unknown_contract") {
    if (s >= 0.5) return 55;
    if (s >= 0.2) return 45;
    return s > 0 ? 35 : 0;
  }

  if (kind === "unknown_cex") return s > 0 ? (s >= 0.5 ? 50 : 40) : 0;
  if (kind === "allowlisted_cex") return 5;
  if (kind === "risky_label") return 90;

  return 0;
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
  const coverage = Number.isFinite(coverageCompleteness) ? coverageCompleteness : 0;
  const confidence = Number.isFinite(provenanceConfidence) ? provenanceConfidence : 0;

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

function capSourceScore(input: {
  kind: SourceExposureKind;
  score: number;
  aggregateShare: number;
  bestContinuity: number;
  hasDirectFastRiskyPath: boolean;
  pathCount: number;
}): number {
  if (input.bestContinuity < 0.4 && input.aggregateShare < 0.5 && !input.hasDirectFastRiskyPath && input.pathCount < 2) {
    return Math.min(input.score, 55);
  }

  if (input.kind === "htx_huobi") {
    if (input.aggregateShare >= 0.5) return Math.max(input.score, 78);
    if (input.aggregateShare < 0.2) return Math.min(input.score, 75);
    return Math.min(input.score, 82);
  }

  if (input.kind === "whitebit") return Math.min(input.score, 59);
  if (input.kind === "unknown_contract") return Math.min(input.score, 55);
  if (input.kind === "unknown_cex") return Math.min(input.score, 50);

  return input.score;
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
    const kind = pathKind(path);
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
      const explicitEffectiveShare = finiteShare(path.effectiveExposureShare);

      return {
        path,
        share,
        hops,
        elapsedMs,
        avgTimePerHopMs: avgTimePerHop(hops, elapsedMs),
        continuity,
        linkStrength,
        pathContext: pathContextScore({ hops, elapsedMs, continuity }),
        effectiveShare: explicitEffectiveShare > 0 ? explicitEffectiveShare : share * linkStrength
      };
    });

    const aggregateShare = Math.min(1, enriched.reduce((sum, item) => sum + item.share, 0));
    const effectiveShare = Math.min(1, enriched.reduce((sum, item) => sum + item.effectiveShare, 0));
    const curveShare = kind === "htx_huobi" && aggregateShare >= 0.5
      ? aggregateShare
      : Math.max(aggregateShare * 0.75, effectiveShare);
    const base = baseShareScore(kind, curveShare);
    const best = [...enriched].sort((left, right) => right.pathContext - left.pathContext)[0] ?? null;
    const rawScore = base +
      (best?.pathContext ?? 0) +
      repeatedExposureAdjustment(paths.length) +
      dataQualityAdjustment(input.coverageCompleteness, input.provenanceConfidence) +
      ageAdjustment(input.ageSignals) +
      walletRoleAdjustment(input.walletRole, input.operationalLiquidityScore, input.cleanCexCoverage);

    const bestElapsed = best?.elapsedMs ?? null;
    const hasDirectFastRiskyPath = Boolean(
      best &&
      best.hops <= 1 &&
      bestElapsed !== null &&
      bestElapsed <= 60 * 60 * 1000 &&
      input.walletRole === "risky_source_wallet"
    );
    const bestContinuity = Math.max(...enriched.map((item) => item.continuity), 0);
    const adjustedScore = clamp(capSourceScore({
      kind,
      score: rawScore,
      aggregateShare,
      bestContinuity,
      hasDirectFastRiskyPath,
      pathCount: paths.length
    }));
    const proofLevel: ProofLevel = adjustedScore >= 60 ? "exchange_policy_decline" : "exchange_policy_context";
    const canBeDampened = kind !== "htx_huobi" || aggregateShare < 0.5;
    const reasons = [
      `${kind} exposure is ${Math.round(aggregateShare * 100)}% raw / ${Math.round(effectiveShare * 100)}% effective; this is source-policy risk, not scam/drain proof.`
    ];
    const warnings = adjustedScore < 60
      ? ["Source-policy exposure is below decline threshold after path context and dampening."]
      : [];
    const evidenceIds = [...new Set(paths.flatMap((path) => path.txHashes))];
    const capApplied = adjustedScore < Math.round(rawScore) ? adjustedScore : undefined;
    const floorApplied = adjustedScore > Math.round(rawScore) ? adjustedScore : undefined;

    sourcePolicyEvidence.push({
      kind,
      aggregateShare,
      effectiveShare,
      pathCount: paths.length,
      score: adjustedScore,
      riskBand: riskBandFromScore(adjustedScore),
      proofLevel,
      canBeDampened,
      reasons,
      warnings,
      evidenceIds,
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
      evidenceIds
    });
  }

  return {
    sourcePolicyEvidence,
    sourcePolicyScore: aggregateLayerScores(sourcePolicyEvidence.map((item) => item.score)),
    riskLayers,
    warnings: sourcePolicyEvidence.flatMap((item) => item.warnings)
  };
}
