import { createHash } from "node:crypto";
import type {
  UnifiedRunPurpose,
  UnifiedSideEffectPolicy
} from "./contracts";

export type UnifiedRollingRolloutStage =
  | "global_barrier"
  | "isolated_rolling"
  | "bounded_user_check"
  | "rolling_default";

export type UnifiedRunRolloutPolicy = {
  readonly stage: UnifiedRollingRolloutStage;
  readonly bucket: number;
  readonly admissionPolicy: "barrier" | "rolling";
  readonly providerCapacityCeiling: number;
};

export function unifiedRunRolloutBucket(runId: string): number {
  if (runId.length === 0) {
    throw new TypeError("unified_rolling_run_id_invalid");
  }
  const prefix = createHash("sha256")
    .update(runId, "utf8")
    .digest()
    .readUInt32BE(0);
  return prefix % 10_000;
}

export function selectUnifiedRunRolloutPolicy(input: {
  readonly stage: UnifiedRollingRolloutStage;
  readonly boundedUserCheckBasisPoints: number;
  readonly runId: string;
  readonly runPurpose: UnifiedRunPurpose;
  readonly sideEffectPolicy: UnifiedSideEffectPolicy;
  readonly providerCapacityCeiling: number;
}): UnifiedRunRolloutPolicy {
  if (
    !Number.isSafeInteger(input.boundedUserCheckBasisPoints) ||
    input.boundedUserCheckBasisPoints < 0 ||
    input.boundedUserCheckBasisPoints > 10_000
  ) {
    throw new TypeError("unified_rolling_basis_points_invalid");
  }
  if (
    !Number.isSafeInteger(input.providerCapacityCeiling) ||
    input.providerCapacityCeiling < 1 ||
    input.providerCapacityCeiling > 100
  ) {
    throw new TypeError("unified_rolling_capacity_ceiling_invalid");
  }
  const bucket = unifiedRunRolloutBucket(input.runId);
  const safeStage = input.stage;
  const isolatedCanary =
    input.sideEffectPolicy === "isolated" &&
    (
      input.runPurpose === "release_canary" ||
      input.runPurpose === "synthetic_test"
    );
  const admissionPolicy =
    safeStage === "global_barrier"
      ? "barrier"
      : safeStage === "isolated_rolling"
        ? isolatedCanary ? "rolling" : "barrier"
        : safeStage === "bounded_user_check"
          ? isolatedCanary ||
              (
                input.runPurpose === "user_check" &&
                bucket < input.boundedUserCheckBasisPoints
              )
            ? "rolling"
            : "barrier"
          : safeStage === "rolling_default"
            ? "rolling"
            : (() => {
                throw new TypeError("unified_rolling_rollout_stage_invalid");
              })();
  return {
    stage: safeStage,
    bucket,
    admissionPolicy,
    providerCapacityCeiling: input.providerCapacityCeiling
  };
}

export function selectUnifiedRunAdmissionPolicy(input: {
  readonly stage: UnifiedRollingRolloutStage;
  readonly boundedUserCheckBasisPoints: number;
  readonly runId: string;
  readonly runPurpose: UnifiedRunPurpose;
  readonly sideEffectPolicy: UnifiedSideEffectPolicy;
  readonly createdUnderSchemaVersion: number;
}): "barrier" | "rolling" {
  if (input.createdUnderSchemaVersion < 35) return "barrier";
  return selectUnifiedRunRolloutPolicy({
    ...input,
    providerCapacityCeiling: 1
  }).admissionPolicy;
}
