export type KnownApprovalServiceV1 = {
  id: string;
  spenderAddress: string;
  actionKinds: readonly ("swap" | "bridge" | "router")[];
};

const KNOWN_APPROVAL_SERVICES: readonly KnownApprovalServiceV1[] = Object.freeze([
  Object.freeze({
    id: "bridgers",
    spenderAddress: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
    actionKinds: Object.freeze(["swap", "bridge", "router"] as const)
  })
]);

export function findKnownServiceBySpender(spenderAddress: string): KnownApprovalServiceV1 | null {
  return KNOWN_APPROVAL_SERVICES.find((service) => service.spenderAddress === spenderAddress) ?? null;
}
