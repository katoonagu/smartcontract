import type { MoneyOriginPath, UsddPsmRouteObservationV1 } from "../types";

export const USDD_PSM_USDT_RESERVE_ADDRESSES = new Set([
  "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ"
]);

export type BuildUsddPsmRouteObservationInput = {
  mode: UsddPsmRouteObservationV1["mode"];
  subjectAddress?: string;
  reserveAddress: string | null;
  providerLabel?: string | null;
  serviceId?: "usdd_psm_gemjoin";
  direction: UsddPsmRouteObservationV1["direction"] | string;
  amountRaw: string;
  selectedAmountRaw: string;
  hopCount: number | null;
  serviceIdentityExact: boolean;
  amountContinuityExact: boolean;
  evidenceIds: string[];
};

type CollectUsddPsmRouteObservationsInput = {
  mode: UsddPsmRouteObservationV1["mode"];
  selectedAmountRaw: string;
  paths: MoneyOriginPath[];
};

function isCanonicalPositiveRaw(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

function normalizedEvidenceIds(evidenceIds: string[]): string[] {
  return [...new Set(evidenceIds.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function buildUsddPsmRouteObservation(
  input: BuildUsddPsmRouteObservationInput
): UsddPsmRouteObservationV1 {
  const serviceIdentityExact = input.serviceIdentityExact === true &&
    input.reserveAddress !== null &&
    USDD_PSM_USDT_RESERVE_ADDRESSES.has(input.reserveAddress);
  const direction = input.direction === "inbound_from_psm" || input.direction === "outbound_to_psm"
    ? input.direction
    : "unknown";
  const hopCount = input.hopCount === 1 || input.hopCount === 2 ? input.hopCount : null;
  const evidenceIds = normalizedEvidenceIds(input.evidenceIds);
  const canonicalInputValid = isCanonicalPositiveRaw(input.amountRaw) &&
    isCanonicalPositiveRaw(input.selectedAmountRaw) &&
    evidenceIds.length > 0;
  const amountWithinSelected = canonicalInputValid && BigInt(input.amountRaw) <= BigInt(input.selectedAmountRaw);
  const ineligibilityReason: UsddPsmRouteObservationV1["ineligibilityReason"] = !serviceIdentityExact
    ? "label_only"
    : !canonicalInputValid
      ? "invalid_amount"
      : !input.amountContinuityExact
        ? "amount_discontinuous"
        : direction === "unknown" || hopCount === null
          ? "unsupported_hop"
          : !amountWithinSelected
            ? "invalid_amount"
            : null;

  return {
    version: "usdd-psm-route-observation-v1",
    mode: input.mode,
    serviceId: "usdd_psm_gemjoin",
    serviceAddress: serviceIdentityExact ? input.reserveAddress : null,
    direction,
    amountRaw: input.amountRaw,
    selectedAmountRaw: input.selectedAmountRaw,
    hopCount,
    serviceIdentityExact,
    amountContinuityExact: input.amountContinuityExact === true,
    scoringEligible: ineligibilityReason === null,
    ineligibilityReason,
    evidenceIds
  };
}

function exactSegmentContinuity(path: MoneyOriginPath, stepIndex: number, amountRaw: string): boolean {
  if (path.amountPreservationRatio !== 1 || !isCanonicalPositiveRaw(amountRaw)) return false;
  const segment = path.steps.slice(stepIndex);
  if (!segment.every((step) => step.amountRaw === amountRaw)) return false;
  return segment.slice(1).every((step, index) => segment[index]?.toAddress === step.fromAddress);
}

function selectedRouteNumerator(input: {
  path: MoneyOriginPath;
  stepIndex: number;
  selectedAmountRaw: string;
}): { amountRaw: string; allocationExact: boolean } {
  const step = input.path.steps[input.stepIndex];
  if (!step) return { amountRaw: "0", allocationExact: false };
  const segment = input.path.steps.slice(input.stepIndex);
  const selectedStep = input.path.steps.at(-1);
  const selectedEventBound = (segment.length === 1 || segment.length === 2) &&
    selectedStep?.txHash === input.path.balanceTransferTxHash;
  if (!selectedEventBound) return { amountRaw: step.amountRaw, allocationExact: false };
  const usage = input.path.amountUsage;
  if (!usage) {
    const noCapNeeded = isCanonicalPositiveRaw(step.amountRaw) &&
      isCanonicalPositiveRaw(input.selectedAmountRaw) &&
      BigInt(step.amountRaw) <= BigInt(input.selectedAmountRaw);
    return { amountRaw: step.amountRaw, allocationExact: noCapNeeded };
  }
  if (
    usage.originalAmountRaw !== selectedStep.amountRaw ||
    !isCanonicalPositiveRaw(usage.usedAmountRaw) ||
    !isCanonicalPositiveRaw(usage.originalAmountRaw) ||
    BigInt(usage.usedAmountRaw) > BigInt(usage.originalAmountRaw) ||
    !isCanonicalPositiveRaw(input.selectedAmountRaw)
  ) {
    return { amountRaw: "0", allocationExact: false };
  }
  const usedRaw = BigInt(usage.usedAmountRaw);
  const selectedRaw = BigInt(input.selectedAmountRaw);
  return {
    amountRaw: (usedRaw < selectedRaw ? usedRaw : selectedRaw).toString(),
    allocationExact: true
  };
}

function observationKey(observation: UsddPsmRouteObservationV1): string {
  return [
    observation.direction,
    observation.serviceAddress ?? "",
    observation.amountRaw,
    observation.selectedAmountRaw,
    observation.hopCount ?? "",
    ...observation.evidenceIds
  ].join("|");
}

function mergeRouteObservations(
  left: UsddPsmRouteObservationV1,
  right: UsddPsmRouteObservationV1
): UsddPsmRouteObservationV1 {
  const sameService = left.serviceAddress !== null && left.serviceAddress === right.serviceAddress;
  const sameDirection = left.direction === right.direction;
  const sameAmount = left.amountRaw === right.amountRaw;
  const sameSelectedAmount = left.selectedAmountRaw === right.selectedAmountRaw;
  const sameHop = left.hopCount !== null && left.hopCount === right.hopCount;
  return buildUsddPsmRouteObservation({
    mode: left.mode,
    reserveAddress: sameService ? left.serviceAddress : null,
    direction: sameDirection ? left.direction : "unknown",
    amountRaw: sameAmount ? left.amountRaw : "0",
    selectedAmountRaw: sameSelectedAmount ? left.selectedAmountRaw : "0",
    hopCount: sameHop ? left.hopCount : null,
    serviceIdentityExact: sameService && left.serviceIdentityExact && right.serviceIdentityExact,
    amountContinuityExact: sameService &&
      sameDirection &&
      sameAmount &&
      sameSelectedAmount &&
      sameHop &&
      left.amountContinuityExact &&
      right.amountContinuityExact,
    evidenceIds: normalizedEvidenceIds([...left.evidenceIds, ...right.evidenceIds]).sort()
  });
}

export function collectUsddPsmRouteObservations(
  input: CollectUsddPsmRouteObservationsInput
): UsddPsmRouteObservationV1[] {
  const observations = new Map<string, UsddPsmRouteObservationV1>();
  for (const path of input.paths) {
    path.steps.forEach((step, stepIndex) => {
      const reserveAddress = USDD_PSM_USDT_RESERVE_ADDRESSES.has(step.fromAddress)
        ? step.fromAddress
        : USDD_PSM_USDT_RESERVE_ADDRESSES.has(step.toAddress)
          ? step.toAddress
          : null;
      if (!reserveAddress) return;
      const direction = step.fromAddress === reserveAddress ? "inbound_from_psm" : "outbound_to_psm";
      const selectedEventEvidenceId = normalizedEvidenceIds([
        path.balanceTransferEvidenceId ?? "",
        path.balanceTransferTxHash
      ])[0] ?? "";
      const evidenceIds = selectedEventEvidenceId.length === 0
        ? []
        : normalizedEvidenceIds([
            selectedEventEvidenceId,
            ...path.steps.slice(stepIndex).map((pathStep) => pathStep.txHash)
          ]);
      const numerator = selectedRouteNumerator({ path, stepIndex, selectedAmountRaw: input.selectedAmountRaw });
      const segmentEvidenceComplete = selectedEventEvidenceId.length > 0 &&
        path.steps.slice(stepIndex).every((pathStep) => pathStep.txHash.trim().length > 0);
      const observation = buildUsddPsmRouteObservation({
        mode: input.mode,
        reserveAddress,
        direction,
        amountRaw: numerator.amountRaw,
        selectedAmountRaw: input.selectedAmountRaw,
        hopCount: path.steps.length - stepIndex,
        serviceIdentityExact: true,
        amountContinuityExact: segmentEvidenceComplete &&
          numerator.allocationExact &&
          exactSegmentContinuity(path, stepIndex, step.amountRaw),
        evidenceIds
      });
      const routeIdentity = JSON.stringify([
        selectedEventEvidenceId,
        reserveAddress
      ]);
      const existing = observations.get(routeIdentity);
      observations.set(routeIdentity, existing ? mergeRouteObservations(existing, observation) : observation);
    });
  }
  return [...observations.values()].sort((left, right) => observationKey(left).localeCompare(observationKey(right)));
}
