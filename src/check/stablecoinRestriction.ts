import { createHash } from "node:crypto";
import { CURRENT_RISK_POLICY_VERSION, DEFAULT_CHAIN } from "../risk/evaluation";
import type { RiskSignal } from "../risk/riskEngine";
import type { RawEvidenceInput, RiskSignalObservationInput, StablecoinRestrictionProfile } from "../types";

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function rawEvidenceForStablecoinRestriction(profile: StablecoinRestrictionProfile): RawEvidenceInput {
  return {
    id: stableId([
      "raw",
      DEFAULT_CHAIN,
      profile.subjectAddress,
      "stablecoin_restriction",
      profile.tokenContract,
      profile.checkedAt
    ]),
    source: "stablecoin_contract",
    sourceType: "provider_response",
    chain: DEFAULT_CHAIN,
    address: profile.subjectAddress,
    txHash: null,
    observedTransactionHash: null,
    evidenceJson: {
      stablecoinRestrictionProfile: profile
    }
  };
}

export function signalForStablecoinRestriction(input: {
  profile: StablecoinRestrictionProfile;
  rawEvidenceId: string;
}): RiskSignal | null {
  if (!input.profile.isBlacklisted) return null;
  return {
    code: "stablecoin_usdt_blacklisted",
    message: "Official TRON USDT contract blacklist state is active for this address.",
    scoreImpact: 90,
    source: "stablecoin_contract",
    confidence: "high",
    severity: "critical",
    evidenceRef: input.rawEvidenceId
  };
}

export function observationForStablecoinRestriction(input: {
  profile: StablecoinRestrictionProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput | null {
  if (!input.profile.isBlacklisted) return null;
  return {
    id: stableId([
      "observation",
      DEFAULT_CHAIN,
      input.profile.subjectAddress,
      "stablecoin_usdt_blacklisted",
      input.profile.checkedAt,
      CURRENT_RISK_POLICY_VERSION
    ]),
    subjectChain: DEFAULT_CHAIN,
    subjectAddress: input.profile.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: null,
    signalGroup: "provider",
    code: "stablecoin_usdt_blacklisted",
    message: "Official TRON USDT contract blacklist state is active for this address.",
    scoreImpact: 90,
    confidence: "high",
    severity: "critical",
    source: "stablecoin_contract",
    policyVersion: CURRENT_RISK_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}

