import type {
  CrossChainTerminalBoundary,
  EvidenceClass,
  ProofLevel,
  RiskLayerScore,
  SourceExposureKind,
  SourcePolicyEvidence
} from "../types";
import { riskBandFromScore } from "./provenanceScoring";

type BoundaryScoringConfig = {
  evidenceClass: EvidenceClass;
  sourceExposureKind?: SourceExposureKind;
  baseScore: number;
  minPositiveScore?: number;
  enforceFloorWithoutShare?: boolean;
  usesSelectedShare: boolean;
  proofLevel: ProofLevel;
  canBeDampened: boolean;
  reasons: string[];
  warnings: string[];
};

const BOUNDARY_CONFIG: Record<CrossChainTerminalBoundary, BoundaryScoringConfig> = {
  no_name_token_liquidity: {
    evidenceClass: "source_policy",
    sourceExposureKind: "no_name_token_liquidity",
    baseScore: 88,
    minPositiveScore: 75,
    usesSelectedShare: true,
    proofLevel: "exchange_policy_decline",
    canBeDampened: false,
    reasons: ["Cross-chain trace terminates at no-name token liquidity."],
    warnings: [
      "No-name token liquidity is high source-policy risk, not direct scam/theft proof by itself."
    ]
  },
  tornado_or_mixer: {
    evidenceClass: "source_policy",
    sourceExposureKind: "mixer",
    baseScore: 90,
    minPositiveScore: 85,
    usesSelectedShare: true,
    proofLevel: "exchange_policy_decline",
    canBeDampened: false,
    reasons: ["Cross-chain trace terminates at a mixer-like service."],
    warnings: [
      "Mixer evidence is source-policy unless exact sanctioned evidence exists."
    ]
  },
  sanctioned_service: {
    evidenceClass: "hard_proof",
    sourceExposureKind: "sanctioned_service",
    baseScore: 98,
    minPositiveScore: 95,
    enforceFloorWithoutShare: true,
    usesSelectedShare: true,
    proofLevel: "exact_scam_or_taint_proof",
    canBeDampened: false,
    reasons: ["Cross-chain trace terminates at a sanctioned service."],
    warnings: []
  },
  bridge_boundary: {
    evidenceClass: "source_policy",
    sourceExposureKind: "cross_chain_boundary",
    baseScore: 65,
    usesSelectedShare: true,
    proofLevel: "exchange_policy_decline",
    canBeDampened: true,
    reasons: ["Cross-chain trace terminates at a bridge boundary."],
    warnings: ["Bridge boundary evidence is source-policy context, not direct theft proof."]
  },
  dex_router_boundary: {
    evidenceClass: "source_policy",
    sourceExposureKind: "bridge_router_dex",
    baseScore: 65,
    usesSelectedShare: true,
    proofLevel: "exchange_policy_decline",
    canBeDampened: true,
    reasons: ["Cross-chain trace terminates at a DEX or router boundary."],
    warnings: ["DEX/router boundary evidence is source-policy context, not direct theft proof."]
  },
  unknown_contract: {
    evidenceClass: "source_policy",
    sourceExposureKind: "unknown_contract",
    baseScore: 55,
    usesSelectedShare: true,
    proofLevel: "exchange_policy_context",
    canBeDampened: true,
    reasons: ["Cross-chain trace terminates at an unknown contract."],
    warnings: ["Unknown contract evidence is contextual until stronger provenance is found."]
  },
  data_exhausted: {
    evidenceClass: "data_quality",
    baseScore: 45,
    usesSelectedShare: false,
    proofLevel: "insufficient_coverage",
    canBeDampened: true,
    reasons: ["Cross-chain trace stopped because provider or search coverage was exhausted."],
    warnings: ["Cross-chain coverage is incomplete; do not treat this as source-policy proof."]
  },
  none: {
    evidenceClass: "data_quality",
    baseScore: 0,
    usesSelectedShare: false,
    proofLevel: "insufficient_coverage",
    canBeDampened: true,
    reasons: ["No cross-chain terminal boundary was detected."],
    warnings: []
  }
};

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function shareAdjustedScore(baseScore: number, selectedShare: number): number {
  if (baseScore === 0) return 0;

  const share = clampShare(selectedShare);
  if (share >= 0.5) return baseScore;
  if (share >= 0.2) return baseScore - 4;
  if (share > 0) return baseScore - 10;
  return 0;
}

export function crossChainEvidenceId(provider: string, chain: string, sourceId: string, kind: string): string {
  return ["cross_chain", provider, chain, sourceId, kind].join(":");
}

export function payloadRefId(provider: string, endpoint: string, key: string): string {
  return [provider, endpoint, key].join(":");
}

export function scoreCrossChainTerminalBoundary(input: {
  terminalBoundary: CrossChainTerminalBoundary;
  evidenceIds: string[];
  selectedShare: number;
}): RiskLayerScore {
  const config = BOUNDARY_CONFIG[input.terminalBoundary];
  const selectedShare = clampShare(input.selectedShare);
  const preliminaryScore = config.usesSelectedShare
    ? shareAdjustedScore(config.baseScore, selectedShare)
    : config.baseScore;
  const floorScore = config.minPositiveScore;
  const shouldApplyFloor = floorScore !== undefined &&
    (selectedShare > 0 || config.enforceFloorWithoutShare === true);
  const rawScore = shouldApplyFloor
    ? Math.max(floorScore, preliminaryScore)
    : preliminaryScore;
  const adjustedScore = clamp(rawScore);

  return {
    evidenceClass: config.evidenceClass,
    kind: `cross_chain_${input.terminalBoundary}`,
    sourceExposureKind: config.sourceExposureKind,
    score: adjustedScore,
    rawScore,
    adjustedScore,
    proofLevel: config.proofLevel,
    canBeDampened: config.canBeDampened,
    reasons: [...config.reasons],
    warnings: [...config.warnings],
    evidenceIds: [...input.evidenceIds]
  };
}

export function sourcePolicyEvidenceFromCrossChainLayer(
  layer: RiskLayerScore,
  input: { aggregateShare: number; effectiveShare: number; pathCount: number }
): SourcePolicyEvidence | null {
  if (layer.evidenceClass !== "source_policy" || !layer.sourceExposureKind) {
    return null;
  }

  const score = clamp(layer.score);

  return {
    kind: layer.sourceExposureKind,
    aggregateShare: clampShare(input.aggregateShare),
    effectiveShare: clampShare(input.effectiveShare),
    pathCount: Math.max(0, Math.floor(Number.isFinite(input.pathCount) ? input.pathCount : 0)),
    score,
    riskBand: riskBandFromScore(score),
    proofLevel: layer.proofLevel,
    canBeDampened: layer.canBeDampened,
    reasons: [...layer.reasons],
    warnings: [...layer.warnings],
    evidenceIds: [...layer.evidenceIds]
  };
}
