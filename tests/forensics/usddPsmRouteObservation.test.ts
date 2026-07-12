import { describe, expect, it } from "vitest";
import { buildUsddPsmRouteObservation } from "../../src/forensics/usddPsmRouteObservation";
import {
  discontinuousInput,
  exactInboundEightyThreePercentInput,
  exactOutboundTwoPercentInput,
  labelOnlyInput
} from "../fixtures/forensics/remediationDataCases";

const wrongReserveInput = {
  ...exactOutboundTwoPercentInput,
  reserveAddress: "TEdvoHEatmDKvTh3o9vBRB9Vdtbhn4QFhy",
  providerLabel: "USDD: PSM GemJoin (USDT)",
  evidenceIds: ["psm:wrong-reserve"]
};

describe("USDD PSM route data foundation", () => {
  it("[REQ-28][AC-03][DATA] preserves exact 2 percent outbound PSM inputs without scoring", () => {
    const result = buildUsddPsmRouteObservation(exactOutboundTwoPercentInput);
    expect(result).toMatchObject({
      serviceId: "usdd_psm_gemjoin",
      direction: "outbound_to_psm",
      amountRaw: "20000000",
      selectedAmountRaw: "1000000000",
      hopCount: 1,
      serviceIdentityExact: true,
      amountContinuityExact: true,
      scoringEligible: true
    });
    expect(result).not.toHaveProperty("appliedModifier");
  });

  it("[REQ-28][AC-04][DATA] preserves exact 83 percent inbound PSM inputs", () => {
    expect(buildUsddPsmRouteObservation(exactInboundEightyThreePercentInput)).toMatchObject({
      serviceId: "usdd_psm_gemjoin",
      direction: "inbound_from_psm",
      amountRaw: "830000000",
      selectedAmountRaw: "1000000000",
      scoringEligible: true
    });
  });

  it("[REQ-28][AC-05][DATA] preserves deep-history mode without applying a modifier", () => {
    const result = buildUsddPsmRouteObservation({ ...exactInboundEightyThreePercentInput, mode: "deep_history" });
    expect(result).toMatchObject({ mode: "deep_history", scoringEligible: true });
    expect(result).not.toHaveProperty("appliedModifier");
  });

  it("[REQ-28][AC-06][DATA] keeps label-only, wrong-reserve and discontinuous PSM observations ineligible", () => {
    expect(buildUsddPsmRouteObservation(labelOnlyInput)).toMatchObject({
      scoringEligible: false,
      ineligibilityReason: "label_only"
    });
    expect(buildUsddPsmRouteObservation(wrongReserveInput)).toMatchObject({
      scoringEligible: false,
      ineligibilityReason: "label_only"
    });
    expect(buildUsddPsmRouteObservation(discontinuousInput)).toMatchObject({
      scoringEligible: false,
      ineligibilityReason: "amount_discontinuous"
    });
  });
});
