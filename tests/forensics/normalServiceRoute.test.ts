import { describe, expect, it } from "vitest";
import { detectNormalServiceRoute } from "../../src/forensics/normalServiceRoute";

describe("normal service route detector", () => {
  it("guards known router approval with economic output", () => {
    expect(detectNormalServiceRoute({
      serviceCategory: "router",
      serviceIdentity: "SunSwap Router",
      verifiedContract: true,
      serviceTags: ["router", "swap"],
      pairedAssetOutputObserved: true,
      economicOutputToVictimObserved: true,
      swapOrBridgeMethodObserved: true,
      receiverIsPoolOrBridge: true,
      directUnknownCollectorReceiver: false
    })).toEqual({
      guarded: true,
      reason: "known service route with economic output"
    });
  });

  it("does not guard unknown contract with direct unknown collector receiver", () => {
    expect(detectNormalServiceRoute({
      serviceCategory: "unknown_contract",
      serviceIdentity: null,
      verifiedContract: false,
      serviceTags: [],
      pairedAssetOutputObserved: false,
      economicOutputToVictimObserved: false,
      swapOrBridgeMethodObserved: false,
      receiverIsPoolOrBridge: false,
      directUnknownCollectorReceiver: true
    })).toEqual({
      guarded: false,
      reason: "normal service route not proven"
    });
  });
});
