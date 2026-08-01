import type { ServiceCategory } from "../types";

export type NormalServiceRouteEvidence = {
  serviceCategory: ServiceCategory | null;
  serviceIdentity: string | null;
  verifiedContract: boolean;
  serviceTags: string[];
  pairedAssetOutputObserved: boolean;
  economicOutputToVictimObserved: boolean;
  swapOrBridgeMethodObserved: boolean;
  receiverIsPoolOrBridge: boolean;
  directUnknownCollectorReceiver: boolean;
};

export type NormalServiceRouteDetection = {
  guarded: boolean;
  reason: "known service route with economic output" | "normal service route not proven";
};

const knownNormalServiceCategories = new Set<ServiceCategory>([
  "router",
  "dex",
  "bridge",
  "bridge_pool",
  "swap_adapter"
]);

export function detectNormalServiceRoute(input: NormalServiceRouteEvidence): NormalServiceRouteDetection {
  const knownService = input.serviceCategory !== null && knownNormalServiceCategories.has(input.serviceCategory);
  const economicOutputObserved = input.pairedAssetOutputObserved || input.economicOutputToVictimObserved;
  const serviceBehaviorObserved = input.swapOrBridgeMethodObserved || input.receiverIsPoolOrBridge;

  if (
    knownService &&
    input.verifiedContract &&
    economicOutputObserved &&
    serviceBehaviorObserved &&
    !input.directUnknownCollectorReceiver
  ) {
    return {
      guarded: true,
      reason: "known service route with economic output"
    };
  }

  return {
    guarded: false,
    reason: "normal service route not proven"
  };
}
