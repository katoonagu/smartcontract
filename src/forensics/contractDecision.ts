import type { ContractIntelligenceProfile } from "../approvals/contractIntelligence";
import { findKnownServiceBySpender } from "../approvals/knownServiceRegistry";
import { detectVerify20Fingerprint } from "./verify20Fingerprint";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { AddressMetadata } from "../storage/repositories";
import type {
  ApprovalSafetyAssessmentV2,
  ContractDecisionEvidenceV1,
  ContractDecisionV2,
  ServiceClassification
} from "../types";
import { authoritativeRegisteredService } from "./serviceClassifier";

const GASFREE_ACCOUNT_METHOD = "permitTransfer(address,address,address,uint256,uint256,uint256,uint256,uint256,bytes)";

type AssessmentWithAuthority = ApprovalSafetyAssessmentV2 & {
  authoritativeServiceId?: string | null;
  providerRisk?: boolean;
};

export type ContractDecisionInputV2 = {
  subjectAddress: string;
  metadata: AddressMetadata;
  serviceClassification: ServiceClassification | null;
  contractProfile: ContractIntelligenceProfile | null;
  approvalSafetyAssessments: AssessmentWithAuthority[];
  evidence: ContractDecisionEvidenceV1[];
};

export type BuildContractDecisionEvidenceInputV1 = Omit<ContractDecisionInputV2, "evidence">;

function evidenceRow(
  id: string,
  kind: ContractDecisionEvidenceV1["kind"],
  subjectAddress: string,
  spenderAddress: string | null = null,
  tokenContract: string | null = null
): ContractDecisionEvidenceV1 {
  return { id, kind, subjectAddress, spenderAddress, tokenContract };
}

function hasStructuralGasFreeAccount(input: BuildContractDecisionEvidenceInputV1): boolean {
  if (input.serviceClassification?.isBoundary !== false) return false;
  if (!input.serviceClassification.evidence.includes("role:gasfree_account")) return false;
  const signatures = Object.values(input.contractProfile?.methodMap ?? {});
  return signatures.includes(GASFREE_ACCOUNT_METHOD);
}

export function buildContractDecisionEvidenceV1(
  input: BuildContractDecisionEvidenceInputV1
): ContractDecisionEvidenceV1[] {
  const rows: ContractDecisionEvidenceV1[] = input.metadata.address === input.subjectAddress
    ? [evidenceRow("metadata:subject", "metadata_context", input.subjectAddress)]
    : [];
  const pushUnique = (row: ContractDecisionEvidenceV1): void => {
    if (!rows.some((existing) => existing.id === row.id)) rows.push(row);
  };
  const registered = input.subjectAddress === TRON_USDT_CONTRACT_ADDRESS
    ? { evidence: "registry:official-tron-usdt" }
    : authoritativeRegisteredService(input.subjectAddress);
  if (registered) pushUnique(evidenceRow(registered.evidence, "official_registry", input.subjectAddress));
  const knownApprovalService = findKnownServiceBySpender(input.subjectAddress);
  const knownServiceEvidence = knownApprovalService ? `registry:${knownApprovalService.id}` : null;
  if (knownServiceEvidence) {
    pushUnique(evidenceRow(knownServiceEvidence, "official_registry", input.subjectAddress));
  }

  const exactRole = input.serviceClassification?.evidence.find((id) => id === "role:gasfree_endpoint");
  if (exactRole && registered) pushUnique(evidenceRow(exactRole, "gasfree_role", input.subjectAddress));
  if (hasStructuralGasFreeAccount(input)) {
    pushUnique(evidenceRow("role:gasfree_account", "gasfree_role", input.subjectAddress));
  }
  if (input.contractProfile?.providerRisk === true) {
    pushUnique(evidenceRow("risk:provider", "provider_risk", input.subjectAddress));
  }
  const fingerprint = detectVerify20Fingerprint({
    methodMap: input.contractProfile?.methodMap,
    topMethods: input.contractProfile?.topMethods,
    serviceLabel: input.serviceClassification?.isBoundary === true
      ? input.serviceClassification.identity
      : null
  });
  if (fingerprint.matched) {
    pushUnique(evidenceRow("proof:verify20_fingerprint", "verify20_fingerprint", input.subjectAddress));
  }

  return rows;
}

function uniqueEvidenceById(rows: ContractDecisionEvidenceV1[]): Map<string, ContractDecisionEvidenceV1> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  return new Map(rows.filter((row) => counts.get(row.id) === 1).map((row) => [row.id, row]));
}

function allUnique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function assessmentEvidenceIds(assessment: AssessmentWithAuthority): string[] | null {
  const campaign = assessment.campaignEvidenceIds;
  if (!allUnique(campaign)) return null;
  const ids = [
    ...campaign,
    assessment.allowance.observedApprovalTxHash,
    assessment.serviceSession?.approvalTxHash,
    assessment.serviceSession?.actionTxHash
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

function eligibleAssessment(
  assessment: AssessmentWithAuthority,
  input: ContractDecisionInputV2,
  evidenceById: Map<string, ContractDecisionEvidenceV1>
): { assessment: AssessmentWithAuthority; evidenceIds: string[]; rows: ContractDecisionEvidenceV1[] } | null {
  const allowance = assessment.allowance;
  if (allowance.spenderAddress !== input.subjectAddress || allowance.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) return null;
  if (allowance.ownerAddress !== assessment.subjectAddress) return null;
  const evidenceIds = assessmentEvidenceIds(assessment);
  if (!evidenceIds || evidenceIds.length === 0) return null;
  const rows = evidenceIds.map((id) => evidenceById.get(id));
  if (rows.some((row) => !row)) return null;
  const resolved = rows as ContractDecisionEvidenceV1[];
  if (resolved.some((row) => row.subjectAddress !== input.subjectAddress)) return null;
  if (resolved.some((row) => row.spenderAddress !== null && row.spenderAddress !== input.subjectAddress)) return null;
  if (resolved.some((row) => row.tokenContract !== null && row.tokenContract !== TRON_USDT_CONTRACT_ADDRESS)) return null;
  if (assessment.exactDebit && !resolved.some((row) => row.kind === "exact_debit")) return null;
  if (assessment.exactVerify20 && !resolved.some((row) => row.kind === "verify20_fingerprint")) return null;
  if (assessment.providerRisk && !resolved.some((row) => row.kind === "provider_risk")) return null;
  if ((allowance.state === "confirmed_active" || allowance.state === "confirmed_zero") &&
    !resolved.some((row) => row.kind === "allowance_read")) return null;

  const session = assessment.serviceSession;
  if (session) {
    const approval = evidenceById.get(session.approvalTxHash);
    const action = evidenceById.get(session.actionTxHash);
    if (session.spenderAddress !== input.subjectAddress || session.walletAddress !== allowance.ownerAddress) return null;
    if (!session.walletInitiated || !session.successful) return null;
    if (!resolved.some((row) => row.kind === "allowance_read")) return null;
    if (!evidenceIds.includes(session.approvalTxHash) || !evidenceIds.includes(session.actionTxHash)) return null;
    if (approval?.kind !== "approval_event" || action?.kind !== "service_action") return null;
  }
  return { assessment, evidenceIds, rows: resolved };
}

function result(
  score: number,
  level: ContractDecisionV2["deterministic"]["level"],
  decision: ContractDecisionV2["deterministic"]["decision"],
  authority: ContractDecisionV2["deterministic"]["authority"],
  evidenceIds: string[]
): ContractDecisionV2 {
  return {
    deterministic: { score, level, decision, authority, evidenceIds: [...new Set(evidenceIds)] },
    finalSource: "deterministic",
    llm: null
  };
}

function uniqueSubjectEvidence(
  evidenceById: Map<string, ContractDecisionEvidenceV1>,
  subjectAddress: string,
  kind: ContractDecisionEvidenceV1["kind"]
): ContractDecisionEvidenceV1[] {
  return [...evidenceById.values()].filter((row) => row.subjectAddress === subjectAddress && row.kind === kind);
}

export function resolveContractDecisionV2(input: ContractDecisionInputV2): ContractDecisionV2 | null {
  if (input.metadata.address !== input.subjectAddress) return null;
  const profileAddress = input.contractProfile?.contractAddress ?? input.contractProfile?.address ?? null;
  if (profileAddress !== null && profileAddress !== input.subjectAddress) return null;
  const evidenceById = uniqueEvidenceById(input.evidence);
  const eligible = input.approvalSafetyAssessments
    .map((assessment) => eligibleAssessment(assessment, input, evidenceById))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const debit = eligible.find(({ assessment }) => assessment.exactDebit && assessment.debitFoundFromSubject);
  if (debit) return result(95, "CRITICAL", "DECLINE", "exact_debit", debit.evidenceIds);

  const directProviderRisk = input.contractProfile?.providerRisk === true
    ? uniqueSubjectEvidence(evidenceById, input.subjectAddress, "provider_risk")
    : [];
  const assessedProviderRisk = eligible.find(({ assessment }) => assessment.providerRisk === true);
  if (assessedProviderRisk) return result(90, "CRITICAL", "DECLINE", "provider_risk", assessedProviderRisk.evidenceIds);
  if (directProviderRisk.length === 1) {
    return result(90, "CRITICAL", "DECLINE", "provider_risk", [directProviderRisk[0].id]);
  }

  const verify20 = eligible.find(({ assessment }) => assessment.exactVerify20);
  if (verify20) return result(90, "CRITICAL", "DECLINE", "verify20_fingerprint", verify20.evidenceIds);
  const directFingerprint = detectVerify20Fingerprint({
    methodMap: input.contractProfile?.methodMap,
    topMethods: input.contractProfile?.topMethods,
    serviceLabel: input.serviceClassification?.isBoundary === true
      ? input.serviceClassification.identity
      : null
  });
  const directVerifyEvidence = directFingerprint.matched
    ? uniqueSubjectEvidence(evidenceById, input.subjectAddress, "verify20_fingerprint")
    : [];
  if (directVerifyEvidence.length === 1) {
    return result(90, "CRITICAL", "DECLINE", "verify20_fingerprint", [directVerifyEvidence[0].id]);
  }

  const registry = uniqueSubjectEvidence(evidenceById, input.subjectAddress, "official_registry");
  if (input.subjectAddress === TRON_USDT_CONTRACT_ADDRESS && registry.some((row) => row.id === "registry:official-tron-usdt")) {
    return result(0, "LOW", "ACCEPTABLE", "official_registry", ["registry:official-tron-usdt"]);
  }

  const gasFree = uniqueSubjectEvidence(evidenceById, input.subjectAddress, "gasfree_role")
    .find((row) => row.id === "role:gasfree_account");
  if (gasFree && hasStructuralGasFreeAccount(input)) {
    return result(10, "LOW", "ACCEPTABLE", "gasfree_account", [gasFree.id]);
  }

  const serviceSession = eligible.find(({ assessment }) => {
    const session = assessment.serviceSession;
    const known = session && findKnownServiceBySpender(input.subjectAddress);
    return Boolean(session && known && known.id === session.authoritativeServiceId &&
      assessment.authoritativeServiceId === known.id && known.actionKinds.includes(session.actionKind));
  });
  if (serviceSession) {
    return result(10, "LOW", "ACCEPTABLE", "known_service_session", serviceSession.evidenceIds);
  }

  if (registry.length === 1) {
    const withAllowance = eligible.find(({ rows }) => rows.some((row) => row.kind === "allowance_read"));
    const ids = withAllowance ? [registry[0].id, ...withAllowance.evidenceIds] : [registry[0].id];
    const score = withAllowance ? 45 : 10;
    return result(score, score === 45 ? "MEDIUM" : "LOW", score === 45 ? "REVIEW" : "ACCEPTABLE", "official_registry", ids);
  }

  const metadata = uniqueSubjectEvidence(evidenceById, input.subjectAddress, "metadata_context")
    .filter((row) => row.spenderAddress === null && row.tokenContract === null);
  if (metadata.length !== 1) return null;
  return result(35, "MEDIUM", "REVIEW", "context", [metadata[0].id]);
}
