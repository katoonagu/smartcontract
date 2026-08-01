import { describe, expect, it } from "vitest";
import {
  selectUnifiedRunAdmissionPolicy,
  selectUnifiedRunRolloutPolicy
} from "../../src/unifiedCheck/rolloutPolicy";

describe("ordinary adaptive rolling configuration", () => {
  it("enables isolated rolling directly from validated configuration", () => {
    expect(selectUnifiedRunRolloutPolicy({
      stage: "isolated_rolling",
      boundedUserCheckBasisPoints: 0,
      runId: "isolated-run",
      runPurpose: "release_canary",
      sideEffectPolicy: "isolated",
      providerCapacityCeiling: 4
    })).toMatchObject({
      stage: "isolated_rolling",
      admissionPolicy: "rolling",
      providerCapacityCeiling: 4
    });
  });

  it("keeps barrier as a configuration fallback without a receipt", () => {
    expect(selectUnifiedRunRolloutPolicy({
      stage: "global_barrier",
      boundedUserCheckBasisPoints: 0,
      runId: "barrier-run",
      runPurpose: "user_check",
      sideEffectPolicy: "authoritative",
      providerCapacityCeiling: 4
    })).toMatchObject({
      stage: "global_barrier",
      admissionPolicy: "barrier",
      providerCapacityCeiling: 4
    });
  });

  it("keeps pre-policy runs on barrier and selects current stages deterministically", () => {
    expect(selectUnifiedRunAdmissionPolicy({
      stage: "rolling_default",
      boundedUserCheckBasisPoints: 0,
      runId: "legacy-run",
      runPurpose: "synthetic_test",
      sideEffectPolicy: "isolated",
      createdUnderSchemaVersion: 34
    })).toBe("barrier");
    expect(selectUnifiedRunAdmissionPolicy({
      stage: "rolling_default",
      boundedUserCheckBasisPoints: 0,
      runId: "current-run",
      runPurpose: "synthetic_test",
      sideEffectPolicy: "isolated",
      createdUnderSchemaVersion: 36
    })).toBe("rolling");
  });
});
