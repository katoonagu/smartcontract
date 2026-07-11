import type { ContractRiskContext } from "../approvals/contractIntelligence";

const REQUIRED_METHODS = [
  { selector: "5082dd12", signature: "Verify20(address,address,address,uint256)" },
  { selector: "fc61dd23", signature: "Verify10(address,uint256)" },
  { selector: "ea4418d9", signature: "withdrawAllTrxTo(address)" },
  { selector: "f2fde38b", signature: "transferOwnership(address)" }
] as const;

type RequiredSelector = typeof REQUIRED_METHODS[number]["selector"];

export type Verify20FingerprintInput = Pick<ContractRiskContext, "methodMap" | "topMethods"> & {
  /** Trusted service identity resolved by the caller; profile names and AI text are not trusted here. */
  serviceLabel?: string | null;
};

export type Verify20FingerprintResult = {
  matched: boolean;
  selectors: RequiredSelector[];
  blockedByTrustedService: boolean;
  missingSelectors: RequiredSelector[];
  mismatchedSelectors: RequiredSelector[];
};

function normalizeSelector(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const selector = /^0x/i.test(trimmed) ? trimmed.slice(2) : trimmed;
  return /^[0-9a-f]{8}$/i.test(selector) ? selector.toLowerCase() : null;
}

function addObservation(
  observations: Map<string, string[]>,
  selector: string,
  value: unknown
): void {
  if (typeof value !== "string" || !value.trim()) return;
  const current = observations.get(selector) ?? [];
  current.push(value.trim().toLowerCase());
  observations.set(selector, current);
}

function isFullSignature(observation: string): boolean {
  return observation.includes("(");
}

export function detectVerify20Fingerprint(input: Verify20FingerprintInput): Verify20FingerprintResult {
  const observations = new Map<string, string[]>();

  for (const [rawSelector, signature] of Object.entries(input.methodMap ?? {})) {
    const selector = normalizeSelector(rawSelector);
    if (!selector) continue;
    addObservation(observations, selector, signature);
  }

  for (const method of input.topMethods ?? []) {
    const selector = normalizeSelector(method.methodId);
    if (!selector) continue;
    addObservation(observations, selector, method.signature);
    addObservation(observations, selector, method.method);
  }

  const selectors = REQUIRED_METHODS
    .filter(({ selector, signature }) =>
      (observations.get(selector) ?? []).some((observation) => observation === signature.toLowerCase())
    )
    .map(({ selector }) => selector);
  const missingSelectors = REQUIRED_METHODS
    .filter(({ selector }) => !selectors.includes(selector))
    .map(({ selector }) => selector);
  const mismatchedSelectors = REQUIRED_METHODS
    .filter(({ selector, signature }) =>
      (observations.get(selector) ?? []).some((observation) =>
        isFullSignature(observation) && observation !== signature.toLowerCase()
      )
    )
    .map(({ selector }) => selector);
  const blockedByTrustedService = Boolean(input.serviceLabel?.trim());

  return {
    matched: missingSelectors.length === 0 && mismatchedSelectors.length === 0 && !blockedByTrustedService,
    selectors,
    blockedByTrustedService,
    missingSelectors,
    mismatchedSelectors
  };
}
