import type { UsddPsmExposureV1, UsddPsmRouteObservationV1 } from "../types";
import type { MatrixCandidate, MatrixCandidateContext } from "./scoringSignalMatrix";

export const USDD_PSM_STANDALONE_CAP = 45;
export const USDD_PSM_MAX_MODIFIER = 25;
export const USDD_PSM_CONTEXT_BASE_SCORE =
  USDD_PSM_STANDALONE_CAP - USDD_PSM_MAX_MODIFIER;

const SHARE_DISPLAY_SCALE = 1_000_000n;
const USDD_PSM_USDT_RESERVE_ADDRESS = "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ";

function canonicalRawAmount(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}

function modifierForShare(amountRaw: bigint, selectedAmountRaw: bigint): UsddPsmExposureV1["baseModifier"] {
  const percentNumerator = amountRaw * 100n;
  if (percentNumerator < selectedAmountRaw * 5n) return 3;
  if (percentNumerator < selectedAmountRaw * 20n) return 7;
  if (percentNumerator < selectedAmountRaw * 50n) return 12;
  if (percentNumerator < selectedAmountRaw * 80n) return 18;
  return 25;
}

function halfUpDivideByTwo(value: number): number {
  return Math.floor((value + 1) / 2);
}

export function buildUsddPsmExposure(
  observation: UsddPsmRouteObservationV1
): UsddPsmExposureV1 | null {
  if (
    observation.version !== "usdd-psm-route-observation-v1" ||
    observation.serviceId !== "usdd_psm_gemjoin" ||
    (observation.mode !== "where" &&
      observation.mode !== "incoming" &&
      observation.mode !== "recent_flow" &&
      observation.mode !== "deep_history") ||
    observation.scoringEligible !== true ||
    observation.ineligibilityReason !== null ||
    observation.serviceAddress !== USDD_PSM_USDT_RESERVE_ADDRESS ||
    observation.serviceIdentityExact !== true ||
    observation.amountContinuityExact !== true ||
    (observation.hopCount !== 1 && observation.hopCount !== 2) ||
    (observation.direction !== "inbound_from_psm" && observation.direction !== "outbound_to_psm") ||
    !canonicalRawAmount(observation.amountRaw) ||
    !canonicalRawAmount(observation.selectedAmountRaw) ||
    !Array.isArray(observation.evidenceIds) ||
    observation.evidenceIds.length === 0 ||
    observation.evidenceIds.some((id) => typeof id !== "string" || id.trim().length === 0)
  ) return null;

  const amountRaw = BigInt(observation.amountRaw);
  const selectedAmountRaw = BigInt(observation.selectedAmountRaw);
  if (amountRaw <= 0n || selectedAmountRaw <= 0n || amountRaw > selectedAmountRaw) return null;

  const baseModifier = modifierForShare(amountRaw, selectedAmountRaw);
  const modeAdjustedModifier = observation.mode === "deep_history"
    ? Math.min(12, halfUpDivideByTwo(baseModifier))
    : baseModifier;
  const appliedModifier = observation.direction === "outbound_to_psm"
    ? halfUpDivideByTwo(modeAdjustedModifier)
    : modeAdjustedModifier;

  return {
    mode: observation.mode,
    direction: observation.direction,
    amountRaw: observation.amountRaw,
    selectedAmountRaw: observation.selectedAmountRaw,
    share: Number(amountRaw * SHARE_DISPLAY_SCALE / selectedAmountRaw) / Number(SHARE_DISPLAY_SCALE),
    hopCount: observation.hopCount,
    serviceIdentityExact: true,
    amountContinuityExact: true,
    baseModifier,
    modeAdjustedModifier,
    appliedModifier,
    roundingPolicy: "half_up_non_negative",
    evidenceIds: [...observation.evidenceIds]
  };
}

export function usddPsmMatrixCandidate(input: {
  exposure: UsddPsmExposureV1;
  context: MatrixCandidateContext;
}): MatrixCandidate {
  const score = Math.min(
    USDD_PSM_STANDALONE_CAP,
    USDD_PSM_CONTEXT_BASE_SCORE + input.exposure.appliedModifier
  );
  return {
    row: "source_policy",
    actionUnit: "source_path",
    score,
    evidenceIds: [...input.exposure.evidenceIds],
    evidenceEpisodeIds: [...input.exposure.evidenceIds],
    atomicSignals: ["exact_usdd_psm_exposure"],
    modifiers: [
      `usdd_psm_${input.exposure.mode}`,
      `direction_${input.exposure.direction}`,
      `modifier_${input.exposure.appliedModifier}`
    ],
    caps: score === USDD_PSM_STANDALONE_CAP ? ["usdd_psm_standalone_cap_45"] : [],
    dampeners: [],
    caveats: [],
    subject: {
      decisionScope: input.context.decisionScope,
      address: input.context.subjectAddress,
      txHash: input.context.subjectTxHash
    },
    authority: { kind: "context" }
  };
}
