import type {
  ApprovalAllowanceStateV2,
  ApprovalSafetyAssessmentV2,
  KnownServiceSessionV1,
  RiskReport
} from "../types";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { UINT256_MAX_RAW } from "./allowanceState";
import { findKnownServiceBySpender } from "./knownServiceRegistry";

const ONE_HUNDRED_USDT_RAW = 100_000_000n;

export type ApprovalSafetyAssessmentInputV2 = {
  subjectAddress: string;
  allowance: ApprovalAllowanceStateV2;
  balanceAtRiskRaw: string | null;
  exactVerify20: boolean;
  exactDebit: boolean;
  debitFoundFromSubject: boolean;
  campaignEvidenceIds: string[];
  serviceSession: KnownServiceSessionV1 | null;
  authoritativeServiceId: string | null;
  providerRisk: boolean;
  contractContext: {
    selectors: string[];
    providerName: string | null;
    freeText: string | null;
  };
  transactionExpirationAt: string | null;
};

type Outcome = Pick<ApprovalSafetyAssessmentV2, "level" | "score" | "action">;

function validServiceSession(input: ApprovalSafetyAssessmentInputV2): KnownServiceSessionV1 | null {
  const session = input.serviceSession;
  const registryService = findKnownServiceBySpender(input.subjectAddress);
  if (!session || !registryService || registryService.id !== input.authoritativeServiceId) return null;
  if (session.walletAddress !== input.allowance.ownerAddress || session.spenderAddress !== input.subjectAddress) return null;
  if (session.approvalTxHash !== input.allowance.observedApprovalTxHash) return null;
  if (session.authoritativeServiceId !== registryService.id || !registryService.actionKinds.includes(session.actionKind)) return null;
  if (session.walletInitiated !== true || session.successful !== true || session.amountContinuity !== "exact") return null;
  if (!Number.isSafeInteger(session.delayMs) || session.delayMs < 0 || session.delayMs > 600_000) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(session.movedAmountRaw) || !session.actionTxHash) return null;
  return session;
}

function assessment(input: ApprovalSafetyAssessmentInputV2, outcome: Outcome): ApprovalSafetyAssessmentV2 {
  return Object.freeze({
    version: "approval-safety-v2",
    subjectAddress: input.subjectAddress,
    ...outcome,
    amlScoreImpact: 0,
    allowance: input.allowance,
    balanceAtRiskRaw: input.balanceAtRiskRaw,
    exactVerify20: input.exactVerify20,
    exactDebit: input.exactDebit,
    debitFoundFromSubject: input.debitFoundFromSubject,
    campaignEvidenceIds: [...input.campaignEvidenceIds],
    serviceSession: input.serviceSession
  });
}

export function evaluateApprovalSafetyV2(input: ApprovalSafetyAssessmentInputV2): ApprovalSafetyAssessmentV2 {
  const session = validServiceSession(input);
  const boundInput = session === input.serviceSession ? input : { ...input, serviceSession: session };
  if (input.subjectAddress !== input.allowance.spenderAddress || input.allowance.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) {
    return assessment(boundInput, { level: "UNKNOWN", score: null, action: "CONFIRM_ALLOWANCE" });
  }
  if (input.exactDebit && input.debitFoundFromSubject) {
    return assessment(boundInput, { level: "CRITICAL", score: 95, action: "REVOKE_NOW" });
  }
  if (input.allowance.state === "failed" || input.allowance.state === "stale") {
    return assessment(boundInput, { level: "UNKNOWN", score: null, action: "CONFIRM_ALLOWANCE" });
  }
  const rawText = input.allowance.confirmedAllowanceRaw;
  if (rawText === null || !/^(0|[1-9][0-9]*)$/.test(rawText)) {
    return assessment(boundInput, { level: "UNKNOWN", score: null, action: "CONFIRM_ALLOWANCE" });
  }
  const raw = BigInt(rawText);
  if (raw > BigInt(UINT256_MAX_RAW)) {
    return assessment(boundInput, { level: "UNKNOWN", score: null, action: "CONFIRM_ALLOWANCE" });
  }
  if (input.allowance.state === "confirmed_zero" && raw !== 0n || input.allowance.state === "confirmed_active" && raw === 0n) {
    return assessment(boundInput, { level: "UNKNOWN", score: null, action: "CONFIRM_ALLOWANCE" });
  }
  if (input.allowance.isUnlimited !== (rawText === UINT256_MAX_RAW)) {
    return assessment(boundInput, { level: "UNKNOWN", score: null, action: "CONFIRM_ALLOWANCE" });
  }
  if (input.allowance.state === "confirmed_zero" || raw === 0n) {
    return assessment(boundInput, { level: "LOW", score: 0, action: "NONE" });
  }
  if (input.providerRisk) {
    return assessment(boundInput, { level: "CRITICAL", score: 90, action: "REVOKE_NOW" });
  }
  if (input.exactVerify20) {
    if (rawText === UINT256_MAX_RAW) {
      return assessment(boundInput, { level: "CRITICAL", score: 90, action: "REVOKE_NOW" });
    }
    if (raw >= ONE_HUNDRED_USDT_RAW) {
      return assessment(boundInput, { level: "HIGH", score: 75, action: "REVOKE_NOW" });
    }
    return assessment(boundInput, { level: "MEDIUM", score: 45, action: "REVOKE_IF_UNUSED" });
  }
  if (session) {
    return assessment(boundInput, { level: "LOW", score: 10, action: "REVOKE_IF_UNUSED" });
  }
  if (input.authoritativeServiceId) {
    return assessment(boundInput, { level: "MEDIUM", score: 45, action: "REVOKE_IF_UNUSED" });
  }
  if (input.contractContext.selectors.length > 0 || input.contractContext.providerName || input.contractContext.freeText) {
    return assessment(boundInput, { level: "MEDIUM", score: 35, action: "REVOKE_IF_UNUSED" });
  }
  return assessment(boundInput, { level: "MEDIUM", score: 35, action: "REVOKE_IF_UNUSED" });
}

export function approvalSafetyAssessmentToRiskReport(assessment: ApprovalSafetyAssessmentV2): RiskReport {
  const score = assessment.score ?? 0;
  return {
    subjectAddress: assessment.subjectAddress,
    level: assessment.level === "UNKNOWN" ? "LOW" : assessment.level,
    score,
    reasons: [{
      code: `approval_safety_${assessment.action.toLowerCase()}`,
      message: assessment.level === "UNKNOWN"
        ? "Current USDT allowance could not be confirmed"
        : "Current USDT approval wallet-safety assessment",
      scoreImpact: score,
      source: "approval_wallet_safety",
      confidence: assessment.level === "UNKNOWN" ? "low" : "high",
      severity: assessment.level === "CRITICAL" ? "critical" : assessment.level === "HIGH" ? "high" : "info"
    }]
  };
}
