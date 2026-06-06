import type {
  IncomingFreshBundleExposure,
  IncomingWalletExposureProfile,
  SourceBundleExposureBudget,
  SourceBundleExposureFinding,
  SourceBundleExposureProfile,
  SourceBundleExposureScope,
  SourceBundleExposureSourceKind,
  SourceBundleUnresolvedBoundary,
  SourceBundleUnresolvedBoundaryInput,
  SubjectExposureEvent,
  SubjectExposureProfile
} from "../types";

type ShareAccumulator = Record<SourceBundleExposureSourceKind, number>;

export type BuildSourceBundleExposureInput = {
  scope: SourceBundleExposureScope;
  targetAmountRaw: string | null;
  findings: SourceBundleExposureFinding[];
  budget: SourceBundleExposureBudget;
  unresolvedBoundary?: SourceBundleUnresolvedBoundaryInput | null;
};

export type BuildSubjectExposureProfileInput = {
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  transferEventsScanned: number;
  events: SubjectExposureEvent[];
};

const SHARE_SCALE = 1_000_000n;

function emptyShares(): ShareAccumulator {
  return {
    htx_huobi: 0,
    clean_cex: 0,
    bridge_router_dex: 0,
    unknown_contract: 0,
    risky_label: 0,
    unknown: 0
  };
}

function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < 1e-9) return 0;
  if (Math.abs(1 - value) < 1e-9) return 1;
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function parseRawAmount(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return 0n;
  return BigInt(normalized);
}

function rawShare(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator <= 0n) return 0;
  return clampShare(Number((numerator * SHARE_SCALE) / denominator) / Number(SHARE_SCALE));
}

function formatPercent(value: number): string {
  return `${Math.round(clampShare(value) * 100)}%`;
}

function dominantSource(shares: ShareAccumulator): SourceBundleExposureSourceKind | null {
  let dominant: SourceBundleExposureSourceKind | null = null;
  let dominantShare = 0;

  for (const kind of Object.keys(shares) as SourceBundleExposureSourceKind[]) {
    const current = clampShare(shares[kind]);
    if (current > dominantShare) {
      dominant = kind;
      dominantShare = current;
    }
  }

  return dominant;
}

function unresolvedBoundaryFloor(kind: SourceBundleExposureSourceKind): number {
  switch (kind) {
    case "risky_label":
      return 70;
    case "htx_huobi":
      return 60;
    case "bridge_router_dex":
      return 55;
    case "unknown_contract":
      return 45;
    case "clean_cex":
    case "unknown":
      return 35;
  }
}

function withUnresolvedBoundaryFloor(
  unresolvedBoundary: SourceBundleUnresolvedBoundaryInput | null | undefined
): SourceBundleUnresolvedBoundary | null {
  if (!unresolvedBoundary) return null;
  return {
    ...unresolvedBoundary,
    affectedShare: clampShare(unresolvedBoundary.affectedShare),
    scoreFloor: unresolvedBoundaryFloor(unresolvedBoundary.kind)
  };
}

function normalizeSelectedShares(shares: ShareAccumulator): {
  shares: ShareAccumulator;
  missingShare: number;
  scale: number;
} {
  const observedShare = Object.values(shares).reduce((sum, current) => sum + current, 0);
  if (observedShare > 1) {
    const scale = 1 / observedShare;
    return {
      scale,
      missingShare: 0,
      shares: {
        htx_huobi: clampShare(shares.htx_huobi * scale),
        clean_cex: clampShare(shares.clean_cex * scale),
        bridge_router_dex: clampShare(shares.bridge_router_dex * scale),
        unknown_contract: clampShare(shares.unknown_contract * scale),
        risky_label: clampShare(shares.risky_label * scale),
        unknown: clampShare(shares.unknown * scale)
      }
    };
  }

  const missingShare = clampShare(1 - observedShare);
  return {
    scale: 1,
    missingShare,
    shares: {
      htx_huobi: clampShare(shares.htx_huobi),
      clean_cex: clampShare(shares.clean_cex),
      bridge_router_dex: clampShare(shares.bridge_router_dex),
      unknown_contract: clampShare(shares.unknown_contract),
      risky_label: clampShare(shares.risky_label),
      unknown: clampShare(shares.unknown + missingShare)
    }
  };
}

function exposureReasons(input: {
  scope: SourceBundleExposureScope;
  shares: ShareAccumulator;
  missingShare: number;
}): string[] {
  const noun = input.scope === "incoming_deposit" ? "checked-deposit source share" : "selected source share";
  const reasons: string[] = [];

  if (input.shares.htx_huobi > 0) {
    reasons.push(`HTX/Huobi accounts for ${formatPercent(input.shares.htx_huobi)} of ${noun}.`);
  }
  if (input.shares.clean_cex > 0) {
    reasons.push(`Clean CEX accounts for ${formatPercent(input.shares.clean_cex)} of ${noun}.`);
  }
  if (input.shares.bridge_router_dex > 0) {
    reasons.push(`Bridge/router/DEX accounts for ${formatPercent(input.shares.bridge_router_dex)} of ${noun}.`);
  }
  if (input.shares.unknown_contract > 0) {
    reasons.push(`Unknown contract accounts for ${formatPercent(input.shares.unknown_contract)} of ${noun}.`);
  }
  if (input.shares.risky_label > 0) {
    reasons.push(`Risky label accounts for ${formatPercent(input.shares.risky_label)} of ${noun}.`);
  }
  if (input.missingShare > 0) {
    reasons.push(`Uncovered ${noun} is assigned to unknown.`);
  }

  return reasons;
}

export function buildSourceBundleExposure(input: BuildSourceBundleExposureInput): SourceBundleExposureProfile {
  const shares = emptyShares();
  const evidenceTxHashes: string[] = [];
  let coveredAmount = 0n;

  for (const finding of input.findings) {
    const findingShare = clampShare(finding.share);
    if (findingShare <= 0) continue;

    shares[finding.sourceClass] += findingShare;
    coveredAmount += parseRawAmount(finding.amountRaw);

    for (const txHash of finding.evidenceTxHashes) {
      if (!evidenceTxHashes.includes(txHash)) evidenceTxHashes.push(txHash);
    }
  }

  const normalized = normalizeSelectedShares(shares);
  const finalShares = normalized.shares;
  const targetAmount = input.targetAmountRaw ? parseRawAmount(input.targetAmountRaw) : 0n;
  const unresolvedBoundary = withUnresolvedBoundaryFloor(input.unresolvedBoundary);
  const warnings: string[] = [];

  if (input.budget.exhausted || unresolvedBoundary) {
    warnings.push("Source bundle coverage-limited: graph budget stopped before every material boundary was resolved.");
  }

  return {
    scope: input.scope,
    targetAmountRaw: input.targetAmountRaw,
    coveredAmountRaw: coveredAmount.toString(),
    coverageRatio: input.targetAmountRaw ? rawShare(coveredAmount, targetAmount) : clampShare(1 - normalized.missingShare),
    htxHuobiShare: finalShares.htx_huobi,
    cleanCexShare: finalShares.clean_cex,
    bridgeRouterDexShare: finalShares.bridge_router_dex,
    unknownContractShare: finalShares.unknown_contract,
    riskyLabelShare: finalShares.risky_label,
    unknownShare: finalShares.unknown,
    dominantSource: dominantSource(finalShares),
    evidenceTxHashes,
    reasons: exposureReasons({
      scope: input.scope,
      shares: finalShares,
      missingShare: normalized.missingShare
    }),
    warnings,
    budget: input.budget,
    unresolvedBoundary
  };
}

export function buildSubjectExposureProfile(input: BuildSubjectExposureProfileInput): SubjectExposureProfile {
  let incomingVolume = 0n;
  let outgoingVolume = 0n;
  let htxIncoming = 0n;
  let cleanIncoming = 0n;
  let bridgeVolume = 0n;
  let unknownContractVolume = 0n;
  let unknownVolume = 0n;

  for (const event of input.events) {
    const amount = parseRawAmount(event.amountRaw);
    if (event.direction === "incoming") incomingVolume += amount;
    if (event.direction === "outgoing") outgoingVolume += amount;
    if (event.direction === "incoming" && event.sourceClass === "htx_huobi") htxIncoming += amount;
    if (event.direction === "incoming" && event.sourceClass === "clean_cex") cleanIncoming += amount;
    if (event.sourceClass === "bridge_router_dex") bridgeVolume += amount;
    if (event.sourceClass === "unknown_contract") unknownContractVolume += amount;
    if (event.sourceClass === "unknown") unknownVolume += amount;
  }

  const totalVolume = incomingVolume + outgoingVolume;
  const htxHuobiIncomingShare = rawShare(htxIncoming, incomingVolume);
  const cleanCexIncomingShare = rawShare(cleanIncoming, incomingVolume);
  const bridgeRouterDexVolumeShare = rawShare(bridgeVolume, totalVolume);
  const unknownContractVolumeShare = rawShare(unknownContractVolume, totalVolume);
  const unknownSourceShare = rawShare(unknownVolume, totalVolume);
  const inOutVelocityScore = clampScore(incomingVolume > 0n && outgoingVolume > 0n ? 8 : 0, 8);
  const scoreContribution = clampScore(
    htxHuobiIncomingShare * 20 +
      bridgeRouterDexVolumeShare * 8 +
      unknownContractVolumeShare * 6 +
      unknownSourceShare * 5 +
      inOutVelocityScore,
    20
  );
  const reasons: string[] = [];

  if (htxHuobiIncomingShare > 0) {
    reasons.push(`Historical HTX/Huobi sender inflow accounts for ${formatPercent(htxHuobiIncomingShare)} of incoming volume.`);
  }
  if (bridgeRouterDexVolumeShare > 0) {
    reasons.push(`Historical bridge/router/DEX activity accounts for ${formatPercent(bridgeRouterDexVolumeShare)} of sender volume.`);
  }
  if (unknownContractVolumeShare > 0) {
    reasons.push(`Historical unknown-contract activity accounts for ${formatPercent(unknownContractVolumeShare)} of sender volume.`);
  }
  if (unknownSourceShare > 0) {
    reasons.push(`Historical unknown-source activity accounts for ${formatPercent(unknownSourceShare)} of sender volume.`);
  }
  if (inOutVelocityScore > 0) {
    reasons.push("Sender shows in/out historical flow context.");
  }

  return {
    subjectAddress: input.subjectAddress,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    transferEventsScanned: input.transferEventsScanned,
    incomingVolumeRaw: incomingVolume.toString(),
    outgoingVolumeRaw: outgoingVolume.toString(),
    htxHuobiIncomingShare,
    cleanCexIncomingShare,
    bridgeRouterDexVolumeShare,
    unknownContractVolumeShare,
    unknownSourceShare,
    inOutVelocityScore,
    scoreContribution,
    reasons,
    warnings: []
  };
}

export function incomingFreshBundleExposureFromSourceProfile(
  profile: SourceBundleExposureProfile
): IncomingFreshBundleExposure {
  return {
    targetAmountRaw: profile.targetAmountRaw ?? "0",
    htxHuobiShare: profile.htxHuobiShare,
    cleanCexShare: profile.cleanCexShare,
    bridgeRouterDexShare: profile.bridgeRouterDexShare,
    unknownContractShare: profile.unknownContractShare,
    riskyLabelShare: profile.riskyLabelShare,
    unknownShare: profile.unknownShare,
    dominantFreshSource: profile.dominantSource,
    reasons: profile.reasons
  };
}

export function incomingWalletExposureProfileFromSubjectProfile(
  profile: SubjectExposureProfile
): IncomingWalletExposureProfile {
  return {
    windowStart: profile.windowStart,
    windowEnd: profile.windowEnd,
    transferEventsScanned: profile.transferEventsScanned,
    incomingVolumeRaw: profile.incomingVolumeRaw,
    outgoingVolumeRaw: profile.outgoingVolumeRaw,
    htxHuobiIncomingShare: profile.htxHuobiIncomingShare,
    cleanCexIncomingShare: profile.cleanCexIncomingShare,
    bridgeRouterDexVolumeShare: profile.bridgeRouterDexVolumeShare,
    unknownContractVolumeShare: profile.unknownContractVolumeShare,
    unknownSourceShare: profile.unknownSourceShare,
    inOutVelocityScore: profile.inOutVelocityScore,
    scoreContribution: profile.scoreContribution,
    reasons: profile.reasons,
    warnings: profile.warnings
  };
}
