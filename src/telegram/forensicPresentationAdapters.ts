import type {
  ApprovalAllowanceStateV2,
  ApprovalDrainProvenanceProfile,
  ApprovalSafetyAssessmentV2,
  ContractDecisionEvidenceV1,
  ContractDecisionV2,
  ForensicCoverageV2,
  NarrativeFactV2,
  ScoreAnchorV2,
  ScoringEvidenceV2
} from "../types";
import type { ForensicCheckJob } from "../storage/repositories";
import { UINT256_MAX_RAW, validateApprovalAllowanceStateV2 } from "../approvals/allowanceState";
import { findKnownServiceBySpender } from "../approvals/knownServiceRegistry";
import { validateForensicCoverageV2 } from "../forensics/forensicCoverageV2";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { validateScoreAnchorV2 } from "../risk/scoreAnchorV2";
import {
  resolveTelegramFactTextKey,
  telegramAddressRef,
  validateTelegramAddressRef,
  type ApprovalAudienceContextV1,
  type ApprovalPresentationV1,
  type TelegramAssessmentPresentationV1,
  type TelegramForensicResultKindV1,
  type TelegramForensicResultV1,
  type TelegramRoutePresentationV1
} from "./forensicPresentation";

const OFFICIAL_USDT = TRON_USDT_CONTRACT_ADDRESS;

type SourceRoute = {
  routeId: string;
  direction: "inbound" | "outbound";
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  asset: "USDT" | "USDD" | "TRX" | "BTTOLD" | "other";
  share: number | null;
  transferCount: number | null;
  evidenceIds: string[];
};

type TelegramForensicSource = {
  kind: TelegramForensicResultKindV1;
  locale: "ru" | "en";
  evaluatedAt: string;
  checkedWalletAddress: string;
  resultState: TelegramForensicResultV1["resultState"];
  scoreAnchorV2: ScoreAnchorV2 | null;
  narrativeFactsV2: NarrativeFactV2[];
  scoringEvidenceV2: ScoringEvidenceV2[];
  amlPresentation: {
    level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    actionTextKey: string | null;
  } | null;
  routes: SourceRoute[];
  coverageV2: ForensicCoverageV2 | null;
  legacyCoverage: { selectedCount: number | null; warningTextKey: string } | null;
  approvalInput: {
    assessment: ApprovalSafetyAssessmentV2;
    audienceContext: ApprovalAudienceContextV1;
    exactDebitProfile: ApprovalDrainProvenanceProfile | null;
  } | null;
  contractDecision: ContractDecisionV2 | null;
  contractEvidenceV1?: ContractDecisionEvidenceV1[];
  technicalLimitTextKey: string | null;
};

function indicator(level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"): "🟢" | "🟡" | "🟠" | "🔴";
function indicator(level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN"): "🟢" | "🟡" | "🟠" | "🔴" | "⚪";
function indicator(level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN") {
  return level === "LOW" ? "🟢" as const
    : level === "MEDIUM" ? "🟡" as const
      : level === "HIGH" ? "🟠" as const
        : level === "CRITICAL" ? "🔴" as const
          : "⚪" as const;
}

function validRaw(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= BigInt(UINT256_MAX_RAW);
}

function validEvidenceIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length;
}

function validOptionalEvidenceIds(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length;
}

type FactRequirements = {
  amount?: true;
  share?: true;
  txCount?: true;
  addresses?: number;
};

const FACT_REQUIREMENTS: Readonly<Record<string, FactRequirements>> = {
  outgoing_blacklisted_counterparty_later_frozen: { amount: true, share: true, txCount: true, addresses: 2 },
  bridge_shared_liquidity_inbound: { share: true, addresses: 2 },
  where_preliminary_bridge_shared_liquidity: { amount: true, share: true, addresses: 2 },
  collector_context_only: { amount: true, share: true, txCount: true },
  collector_disjoint_independent_signal: {},
  contract_exact_debit_confirmed: {},
  htx_historical_policy_context: { amount: true, share: true, txCount: true, addresses: 2 },
  low_balance_latest_five_principal: { amount: true, txCount: true },
  approval_drain_roles_distinct: { amount: true, txCount: true, addresses: 3 },
  principal_transfer_context: { amount: true, txCount: true },
  true_no_principal_activity: {},
  usdd_psm_inbound_shared_liquidity: { amount: true, share: true, txCount: true, addresses: 2 },
  usdd_psm_outbound_shared_liquidity: { amount: true, share: true, txCount: true, addresses: 2 },
  gasfree_account_structural: {},
  official_usdt_registry_contract: {},
  fast_behavior_context: {}
};

function factRequirements(textKey: string): FactRequirements | null {
  if (textKey.startsWith("score.")) return {};
  return Object.hasOwn(FACT_REQUIREMENTS, textKey) ? FACT_REQUIREMENTS[textKey]! : null;
}

function canonicalFact(
  fact: NarrativeFactV2,
  subjectAddress: string,
  allowedModes: readonly ScoreAnchorV2["mode"][]
): NarrativeFactV2 | null {
  if (fact.subjectAddress !== subjectAddress || !allowedModes.includes(fact.mode) ||
    !resolveTelegramFactTextKey(fact.factTextKey)) return null;
  if (!fact.id || !validEvidenceIds(fact.evidenceIds)) return null;
  if (fact.amountRaw !== null && !validRaw(fact.amountRaw)) return null;
  if (fact.share !== null && (!Number.isFinite(fact.share) || fact.share < 0 || fact.share > 1)) return null;
  if (fact.txCount !== null && (!Number.isSafeInteger(fact.txCount) || fact.txCount <= 0)) return null;
  const requirements = factRequirements(fact.factTextKey);
  if (!requirements) return null;
  if (requirements.amount && fact.amountRaw === null) return null;
  if (requirements.share && fact.share === null) return null;
  if (requirements.txCount && fact.txCount === null) return null;
  if (requirements.addresses !== undefined && fact.addresses.length !== requirements.addresses) return null;
  try {
    return {
      ...fact,
      addresses: fact.addresses.map((ref) => validateTelegramAddressRef(ref))
    };
  } catch {
    return null;
  }
}

function canonicalRoutes(
  routes: SourceRoute[],
  checkedWalletAddress: string,
  boundEvidenceIds: ReadonlySet<string>,
  allowLocalRouteEvidence: boolean
): TelegramRoutePresentationV1[] {
  const seen = new Set<string>();
  const seenEvidence = new Set<string>();
  const result: TelegramRoutePresentationV1[] = [];
  for (const route of routes) {
    if (!route.routeId || seen.has(route.routeId) || !validRaw(route.amountRaw) || !validEvidenceIds(route.evidenceIds)) continue;
    const localRouteEvidence = allowLocalRouteEvidence && route.routeId.startsWith("route-")
      ? `route:${route.routeId.slice("route-".length)}`
      : null;
    const resolvedEvidence = route.evidenceIds.every((id) => boundEvidenceIds.has(id) || id === localRouteEvidence);
    if (!resolvedEvidence) continue;
    if (!["USDT", "USDD", "TRX", "BTTOLD", "other"].includes(route.asset)) continue;
    if (route.direction !== "inbound" && route.direction !== "outbound") continue;
    if (BigInt(route.amountRaw) <= 0n || route.evidenceIds.some((id) => seenEvidence.has(id))) continue;
    if (route.share !== null && (!Number.isFinite(route.share) || route.share < 0 || route.share > 1)) continue;
    if (route.transferCount !== null && (!Number.isSafeInteger(route.transferCount) || route.transferCount <= 0)) continue;
    const from = telegramAddressRef(route.fromAddress);
    const to = telegramAddressRef(route.toAddress);
    if (from.url === null || to.url === null) continue;
    if (route.direction === "inbound" && route.toAddress !== checkedWalletAddress) continue;
    if (route.direction === "outbound" && route.fromAddress !== checkedWalletAddress) continue;
    seen.add(route.routeId);
    route.evidenceIds.forEach((id) => seenEvidence.add(id));
    result.push({
      routeId: route.routeId,
      direction: route.direction,
      from,
      to,
      amountRaw: route.amountRaw,
      asset: route.asset,
      share: route.share,
      transferCount: route.transferCount,
      evidenceIds: [...route.evidenceIds]
    });
  }
  return result;
}

function coverage(value: ForensicCoverageV2 | null): ForensicCoverageV2 | null {
  if (!value) return null;
  try {
    return validateForensicCoverageV2(value);
  } catch {
    return null;
  }
}

function exactDebit(
  assessment: ApprovalSafetyAssessmentV2,
  profile: ApprovalDrainProvenanceProfile | null
): { state: ApprovalPresentationV1["debitState"]; amountRaw: string | null } {
  if (!assessment.exactDebit && !assessment.debitFoundFromSubject) {
    return { state: assessment.allowance.state === "failed" || assessment.allowance.state === "stale" ? "unknown" : "not_found", amountRaw: null };
  }
  if (!assessment.exactDebit || !assessment.debitFoundFromSubject) return { state: "unknown", amountRaw: null };
  if (
    profile &&
    profile.evidenceStrength === "exact_approval_and_transfer_from" &&
    profile.subjectAddress === assessment.subjectAddress &&
    profile.victimAddress === assessment.subjectAddress &&
    profile.spenderAddress === assessment.allowance.spenderAddress &&
    profile.approvalTxHash === assessment.allowance.observedApprovalTxHash &&
    Boolean(profile.drainTxHash) && profile.pathTxHashes.includes(profile.drainTxHash) &&
    telegramAddressRef(profile.firstReceiverAddress).url !== null &&
    validRaw(profile.amountRaw) && BigInt(profile.amountRaw) > 0n
  ) return { state: "confirmed", amountRaw: profile.amountRaw };
  return { state: "unknown", amountRaw: null };
}

function validApprovalOutcome(
  value: ApprovalSafetyAssessmentV2,
  debitState: ApprovalPresentationV1["debitState"],
  session: ApprovalSafetyAssessmentV2["serviceSession"]
): boolean {
  const allowance = value.allowance;
  if (debitState === "confirmed") {
    return value.score === 95 && value.level === "CRITICAL" && value.action === "REVOKE_NOW";
  }
  if (allowance.state === "failed" || allowance.state === "stale") {
    return value.score === null && value.level === "UNKNOWN" && value.action === "CONFIRM_ALLOWANCE";
  }
  if (allowance.state === "confirmed_zero") {
    return value.score === 0 && value.level === "LOW" && value.action === "NONE";
  }
  if (value.exactVerify20) {
    const rawText = allowance.confirmedAllowanceRaw;
    if (rawText === null) return false;
    const raw = BigInt(rawText);
    if (allowance.isUnlimited) return value.score === 90 && value.level === "CRITICAL" && value.action === "REVOKE_NOW";
    if (raw >= 100_000_000n) return value.score === 75 && value.level === "HIGH" && value.action === "REVOKE_NOW";
    return value.score === 45 && value.level === "MEDIUM" && value.action === "REVOKE_IF_UNUSED";
  }
  if (session) return value.score === 10 && value.level === "LOW" && value.action === "REVOKE_IF_UNUSED";
  if (findKnownServiceBySpender(allowance.spenderAddress)) {
    return value.score === 45 && value.level === "MEDIUM" && value.action === "REVOKE_IF_UNUSED";
  }
  return false;
}

function validDate(value: string | null): number | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function canonicalAllowance(
  allowance: ApprovalAllowanceStateV2,
  evaluatedAt: string
): ApprovalAllowanceStateV2 | null {
  const timestamp = validDate(evaluatedAt);
  if (timestamp === null || new Date(timestamp).toISOString() !== evaluatedAt) return null;
  try {
    return validateApprovalAllowanceStateV2(allowance, new Date(timestamp));
  } catch {
    return null;
  }
}

function validServiceSession(
  assessment: ApprovalSafetyAssessmentV2
): ApprovalSafetyAssessmentV2["serviceSession"] {
  const session = assessment.serviceSession;
  const allowance = assessment.allowance;
  const registry = findKnownServiceBySpender(allowance.spenderAddress);
  if (!session || !registry || registry.id !== session.authoritativeServiceId) return null;
  if (session.walletAddress !== allowance.ownerAddress || session.spenderAddress !== allowance.spenderAddress) return null;
  if (!allowance.observedApprovalTxHash || session.approvalTxHash !== allowance.observedApprovalTxHash) return null;
  if (!registry.actionKinds.includes(session.actionKind)) return null;
  if (!session.walletInitiated || !session.successful || session.amountContinuity !== "exact") return null;
  if (!session.actionTxHash || !Number.isSafeInteger(session.delayMs) || session.delayMs < 0 || session.delayMs > 600_000) return null;
  if (!validRaw(session.movedAmountRaw) || BigInt(session.movedAmountRaw) <= 0n) return null;
  if (session.approvedAmountRaw !== null &&
    (!validRaw(session.approvedAmountRaw) || BigInt(session.approvedAmountRaw) <= 0n)) return null;
  return session;
}

function approvalPresentation(
  checkedWalletAddress: string,
  input: TelegramForensicSource["approvalInput"],
  evaluatedAt: string
): { approval: ApprovalPresentationV1; assessment: TelegramAssessmentPresentationV1; bindingFailed: boolean } | null {
  if (!input) return null;
  const value = input.assessment;
  const allowance = canonicalAllowance(value.allowance, evaluatedAt);
  if (!allowance) return null;
  const normalizedValue: ApprovalSafetyAssessmentV2 = { ...value, allowance };
  const owner = telegramAddressRef(value.subjectAddress);
  const spender = telegramAddressRef(allowance.spenderAddress);
  const token = telegramAddressRef(allowance.tokenContract);
  if (
    value.version !== "approval-safety-v2" || value.amlScoreImpact !== 0 ||
    !["watched_wallet", "external_address_check"].includes(input.audienceContext) ||
    value.subjectAddress !== checkedWalletAddress || allowance.ownerAddress !== checkedWalletAddress ||
    allowance.tokenContract !== OFFICIAL_USDT || allowance.source !== "official_usdt_allowance" ||
    owner.url === null || spender.url === null || token.url === null ||
    !validOptionalEvidenceIds(value.campaignEvidenceIds)
  ) return null;
  const debit = exactDebit(normalizedValue, input.exactDebitProfile);
  const bindingFailed = (value.exactDebit || value.debitFoundFromSubject) && debit.state !== "confirmed";
  const session = validServiceSession(normalizedValue);
  const sessionBindingFailed = value.serviceSession !== null && session === null;
  const outcomeBindingFailed = !bindingFailed && !sessionBindingFailed && !validApprovalOutcome(normalizedValue, debit.state, session);
  const presentationBindingFailed = bindingFailed || sessionBindingFailed || outcomeBindingFailed;
  return {
    approval: {
      owner,
      spender,
      tokenContract: token,
      audienceContext: input.audienceContext,
      allowanceState: allowance.state,
      confirmedAllowanceRaw: allowance.confirmedAllowanceRaw,
      isUnlimited: allowance.isUnlimited,
      balanceAtRiskRaw: validRaw(value.balanceAtRiskRaw) && BigInt(value.balanceAtRiskRaw) > 0n ? value.balanceAtRiskRaw : null,
      debitState: debit.state,
      debitAmountRaw: debit.amountRaw,
      exactVerify20: value.exactVerify20,
      campaignEvidenceIds: [...value.campaignEvidenceIds],
      serviceSession: session
    },
    assessment: {
      kind: "wallet_safety",
      score: presentationBindingFailed ? null : value.score,
      level: presentationBindingFailed ? "UNKNOWN" : value.level,
      action: presentationBindingFailed ? "CONFIRM_ALLOWANCE" : value.action,
      indicator: indicator(presentationBindingFailed ? "UNKNOWN" : value.level),
      amlScoreImpact: 0
    },
    bindingFailed: presentationBindingFailed
  };
}

function levelFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  return score >= 85 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
}

function validContractOutcome(value: ContractDecisionV2["deterministic"]): boolean {
  if (value.level !== levelFromScore(value.score)) return false;
  if (value.authority === "exact_debit") return value.score === 95 && value.decision === "DECLINE";
  if (value.authority === "provider_risk" || value.authority === "verify20_fingerprint") {
    return value.score === 90 && value.decision === "DECLINE";
  }
  if (value.authority === "gasfree_account" || value.authority === "known_service_session") {
    return value.score === 10 && value.decision === "ACCEPTABLE";
  }
  if (value.authority === "context") return value.score === 35 && value.decision === "REVIEW";
  return value.authority === "official_registry" && (
    (value.score === 0 && value.decision === "ACCEPTABLE") ||
    (value.score === 10 && value.decision === "ACCEPTABLE") ||
    (value.score === 45 && value.decision === "REVIEW")
  );
}

type ContractFactSemantic = {
  factKind: string;
  factTextKey: string;
  evidenceKind: ContractDecisionEvidenceV1["kind"];
};

function expectedContractSemantics(value: ContractDecisionV2["deterministic"]): readonly ContractFactSemantic[] {
  if (value.authority === "exact_debit") {
    return [
      { factKind: "contract_exact_debit", factTextKey: "contract_exact_debit_confirmed", evidenceKind: "exact_debit" },
      { factKind: "approval_drain_roles", factTextKey: "approval_drain_roles_distinct", evidenceKind: "exact_debit" }
    ];
  }
  if (value.authority === "verify20_fingerprint") {
    return [{
      factKind: "exact_verify20_contract_pattern",
      factTextKey: "score.contract_suspicion.exact_verify20_contract_pattern",
      evidenceKind: "verify20_fingerprint"
    }];
  }
  if (value.authority === "provider_risk") {
    return [{ factKind: "provider_risk", factTextKey: "fast_behavior_context", evidenceKind: "provider_risk" }];
  }
  if (value.authority === "official_registry") {
    return [
      { factKind: "official_usdt", factTextKey: "official_usdt_registry_contract", evidenceKind: "official_registry" },
      { factKind: "registered_service_context", factTextKey: "fast_behavior_context", evidenceKind: "official_registry" }
    ];
  }
  if (value.authority === "gasfree_account") {
    return [{ factKind: "gasfree_account", factTextKey: "gasfree_account_structural", evidenceKind: "gasfree_role" }];
  }
  if (value.authority === "known_service_session") {
    return [{ factKind: "known_service_session", factTextKey: "fast_behavior_context", evidenceKind: "service_action" }];
  }
  return [{ factKind: "contract_metadata_context", factTextKey: "fast_behavior_context", evidenceKind: "metadata_context" }];
}

function sameEvidenceIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function validLegacyContractCompatibility(
  value: ContractDecisionV2["deterministic"],
  fact: NarrativeFactV2,
  expected: ContractFactSemantic
): boolean {
  if (!sameEvidenceIds(value.evidenceIds, fact.evidenceIds)) return false;
  if (value.authority === "gasfree_account") {
    return expected.factKind === "gasfree_account" && expected.factTextKey === "gasfree_account_structural";
  }
  return value.authority === "official_registry" && value.score === 0 && value.decision === "ACCEPTABLE" &&
    expected.factKind === "official_usdt" && expected.factTextKey === "official_usdt_registry_contract";
}

function validContractSemanticBinding(
  value: ContractDecisionV2["deterministic"],
  fact: NarrativeFactV2,
  evidence: readonly ContractDecisionEvidenceV1[]
): boolean {
  const expected = expectedContractSemantics(value).find((semantic) =>
    semantic.factKind === fact.kind && semantic.factTextKey === fact.factTextKey
  );
  if (!expected) return false;
  if (evidence.length === 0) {
    return validLegacyContractCompatibility(value, fact, expected);
  }
  const counts = new Map<string, number>();
  for (const row of evidence) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  const resolve = (ids: readonly string[]): ContractDecisionEvidenceV1[] | null => {
    const rows = ids.map((id) => evidence.find((row) => row.id === id));
    return rows.some((row, index) => !row || counts.get(ids[index]!) !== 1)
      ? null
      : rows as ContractDecisionEvidenceV1[];
  };
  if (!fact.evidenceIds.every((id) => value.evidenceIds.includes(id))) return false;
  const resolved = resolve(value.evidenceIds);
  const factRows = resolve(fact.evidenceIds);
  if (!resolved || !factRows) return false;
  if (resolved.some((row) => row.subjectAddress !== fact.subjectAddress)) return false;
  if (resolved.some((row) => row.spenderAddress !== null && row.spenderAddress !== fact.subjectAddress)) return false;
  if (resolved.some((row) => row.tokenContract !== null && row.tokenContract !== OFFICIAL_USDT)) return false;
  return factRows.some((row) => row.kind === expected.evidenceKind);
}

function contractAssessment(
  decision: ContractDecisionV2 | null,
  fact: NarrativeFactV2,
  evidence: readonly ContractDecisionEvidenceV1[]
): Extract<TelegramAssessmentPresentationV1, { kind: "contract_risk" }> | null {
  if (!decision || decision.finalSource !== "deterministic" || decision.llm !== null) return null;
  const value = decision.deterministic;
  if (!Number.isInteger(value.score) || value.score < 0 || value.score > 100 ||
    !validEvidenceIds(value.evidenceIds) || !validContractOutcome(value) ||
    !validContractSemanticBinding(value, fact, evidence)) return null;
  return {
    kind: "contract_risk",
    score: value.score,
    level: value.level,
    decision: value.decision,
    indicator: indicator(value.level),
    actionTextKey: value.decision === "DECLINE" ? "do_not_operate" : value.decision === "REVIEW" ? "manual_review" : "none",
    evidenceIds: [...value.evidenceIds]
  };
}

function titleKey(kind: TelegramForensicResultKindV1): string {
  return kind === "where_preliminary" ? "where_preliminary"
    : kind === "contract_safety" ? "contract_check"
      : kind === "approval_safety" ? "approval_check"
        : kind === "incoming_deposit" ? "incoming_deposit"
          : "wallet_check";
}

function allowedAnchorModes(kind: TelegramForensicResultKindV1): readonly ScoreAnchorV2["mode"][] {
  if (kind === "where_preliminary") return ["where"];
  if (kind === "wallet_final") return ["where", "unified"];
  if (kind === "deep_context") return ["deep", "unified"];
  if (kind === "incoming_deposit") return ["incoming"];
  return [];
}

function validAmlAction(source: TelegramForensicSource, anchor: ScoreAnchorV2): boolean {
  const action = source.amlPresentation?.actionTextKey ?? null;
  if (source.kind === "where_preliminary") return source.resultState === "preliminary" && action === null;
  if (source.resultState !== "final") return false;
  if (anchor.decision === "DECLINE") return action === "do_not_operate";
  if (anchor.decision === "REVIEW") return action === "manual_review";
  return action === null || action === "none";
}

export function adaptTelegramForensicResult(
  source: TelegramForensicSource
): TelegramForensicResultV1 {
  const checkedWallet = telegramAddressRef(source.checkedWalletAddress);
  const validSubject = checkedWallet.url !== null;
  const coverageValue = coverage(source.coverageV2);
  const approvalBranch = source.kind === "approval_safety";
  const contractBranch = source.kind === "contract_safety";
  const approval = source.kind === "approval_safety" && validSubject
    ? approvalPresentation(source.checkedWalletAddress, source.approvalInput, source.evaluatedAt)
    : null;
  let contract: Extract<TelegramAssessmentPresentationV1, { kind: "contract_risk" }> | null = null;

  let assessment: TelegramAssessmentPresentationV1 | null = approvalBranch ? approval?.assessment ?? null : null;
  let primaryFact: NarrativeFactV2 | null = null;
  let secondaryFacts: NarrativeFactV2[] = [];
  let resultState = source.resultState;
  let anchorValidated = false;

  if (!approvalBranch && !contractBranch && source.scoreAnchorV2 && source.amlPresentation && validSubject) {
    try {
      const allowedModes = allowedAnchorModes(source.kind);
      if (!allowedModes.includes(source.scoreAnchorV2.mode)) throw new Error("telegram_anchor_mode_mismatch");
      const anchor = validateScoreAnchorV2({
        anchor: source.scoreAnchorV2,
        checkedSubjectAddress: source.checkedWalletAddress,
        checkedMode: source.scoreAnchorV2.mode,
        evidence: source.scoringEvidenceV2,
        facts: source.narrativeFactsV2
      });
      primaryFact = canonicalFact(
        source.narrativeFactsV2.find((fact) => fact.id === anchor.preferredFactId)!,
        source.checkedWalletAddress,
        [anchor.mode]
      );
      if (!primaryFact) throw new Error("telegram_preferred_fact_invalid");
      const primaryEvidence = new Set(primaryFact.evidenceIds);
      secondaryFacts = source.narrativeFactsV2
        .filter((fact) => fact.id !== primaryFact!.id && !fact.isScoreDriver)
        .map((fact) => canonicalFact(fact, source.checkedWalletAddress, allowedModes))
        .filter((fact): fact is NarrativeFactV2 => Boolean(fact))
        .filter((fact) => !fact.evidenceIds.some((id) => primaryEvidence.has(id)));
      if (!validAmlAction(source, anchor)) throw new Error("telegram_action_mismatch");
      if (source.amlPresentation.level !== levelFromScore(anchor.score)) throw new Error("telegram_level_mismatch");
      anchorValidated = true;
      if (anchor.coverageDependency === "required" && coverageValue === null) {
        resultState = "no_final";
        assessment = null;
      } else {
      assessment = {
        kind: "aml_risk",
        score: anchor.score,
        level: source.amlPresentation.level,
        decision: anchor.decision,
        indicator: indicator(source.amlPresentation.level),
        actionTextKey: source.kind === "where_preliminary" ? null : source.amlPresentation.actionTextKey,
        anchorId: `${anchor.policyVersion}:${anchor.mode}:${anchor.preferredFactId}`,
        preferredFactId: anchor.preferredFactId
      };
      }
    } catch {
      resultState = "no_final";
      assessment = null;
    }
  } else if (!approvalBranch && !contractBranch) {
    const allowedModes = allowedAnchorModes(source.kind);
    secondaryFacts = source.narrativeFactsV2
      .map((fact) => canonicalFact(fact, source.checkedWalletAddress, allowedModes))
      .filter((fact): fact is NarrativeFactV2 => Boolean(fact));
  }

  if (approvalBranch) {
    const expectedState = approval?.assessment.score === null ? "no_final" : "final";
    resultState = !approval || approval.bindingFailed || source.resultState !== expectedState ? "no_final" : source.resultState;
    if (resultState === "no_final" && approval?.assessment.score !== null) assessment = null;
    primaryFact = null;
    secondaryFacts = [];
  }
  if (contractBranch && validSubject && source.resultState === "final" && source.narrativeFactsV2.length > 0) {
    primaryFact = canonicalFact(source.narrativeFactsV2[0]!, source.checkedWalletAddress, ["contract"]);
    contract = primaryFact
      ? contractAssessment(source.contractDecision, primaryFact, source.contractEvidenceV1 ?? [])
      : null;
    if (!primaryFact || !contract || !primaryFact.evidenceIds.every((id) => contract!.evidenceIds.includes(id))) {
      assessment = null;
      resultState = "no_final";
    } else {
      assessment = contract;
    }
  } else if (contractBranch) {
    assessment = null;
    resultState = "no_final";
  }
  if (!validSubject) {
    resultState = "no_final";
    assessment = null;
    primaryFact = null;
    secondaryFacts = [];
  }
  if (!approvalBranch && !contractBranch && assessment === null && resultState !== "technical_limit") {
    resultState = "no_final";
  }

  const routeModes = allowedAnchorModes(source.kind);
  const routeEvidenceIds = new Set<string>();
  if (!approvalBranch && !contractBranch) {
    for (const fact of source.narrativeFactsV2) {
      const bound = canonicalFact(fact, source.checkedWalletAddress, routeModes);
      if (bound) bound.evidenceIds.forEach((id) => routeEvidenceIds.add(id));
    }
    for (const evidence of source.scoringEvidenceV2) {
      if (evidence.subjectAddress !== source.checkedWalletAddress) continue;
      const anchorBound = source.scoreAnchorV2?.evidenceIds.includes(evidence.id) === true;
      const factBound = routeEvidenceIds.has(evidence.id) || evidence.sourceEvidenceIds.some((id) => routeEvidenceIds.has(id));
      if (!anchorBound && !factBound) continue;
      routeEvidenceIds.add(evidence.id);
      evidence.sourceEvidenceIds.forEach((id) => routeEvidenceIds.add(id));
    }
  }

  return {
    version: "telegram-forensic-result-v1",
    kind: source.kind,
    locale: source.locale,
    titleTextKey: titleKey(source.kind),
    checkedWallet,
    resultState,
    assessment,
    primaryFact,
    secondaryFacts,
    routes: approvalBranch || contractBranch
      ? []
      : canonicalRoutes(source.routes, source.checkedWalletAddress, routeEvidenceIds, anchorValidated),
    coverage: approvalBranch || contractBranch ? null : coverageValue,
    legacyCoverage: approvalBranch || contractBranch ? null : source.legacyCoverage,
    approval: approval?.approval ?? null,
    contractDecision: contract ? source.contractDecision : null,
    technicalLimitTextKey: source.technicalLimitTextKey
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function adaptForensicJobForTelegram(
  job: ForensicCheckJob,
  options: { locale: "ru" | "en"; resultKind: TelegramForensicResultKindV1 }
): TelegramForensicResultV1 {
  const result = object(job.resultJson) ?? {};
  const report = object(result.whereIsMoneyReport) ?? result;
  const assessment = object(report.assessment);
  const riskBand = assessment?.riskBand;
  const level = riskBand === "LOW" ? "LOW"
    : riskBand === "HIGH" ? "HIGH"
      : riskBand === "CRITICAL" ? "CRITICAL"
        : "MEDIUM";
  const anchor = (report.scoreAnchorV2 as ScoreAnchorV2 | null | undefined) ?? null;
  const actionTextKey = anchor?.decision === "DECLINE" ? "do_not_operate"
    : anchor?.decision === "REVIEW" ? "manual_review"
      : null;
  return adaptTelegramForensicResult({
    kind: options.resultKind,
    locale: options.locale,
    evaluatedAt: (job.completedAt ?? job.updatedAt).toISOString(),
    checkedWalletAddress: job.subjectAddress,
    resultState: job.status === "completed" ? "final" : "technical_limit",
    scoreAnchorV2: anchor,
    narrativeFactsV2: Array.isArray(report.narrativeFactsV2) ? report.narrativeFactsV2 as NarrativeFactV2[] : [],
    scoringEvidenceV2: Array.isArray(report.scoringEvidenceV2) ? report.scoringEvidenceV2 as ScoringEvidenceV2[] : [],
    amlPresentation: anchor ? { level, actionTextKey } : null,
    routes: [],
    coverageV2: (report.coverageV2 as ForensicCoverageV2 | null | undefined) ?? null,
    legacyCoverage: null,
    approvalInput: null,
    contractDecision: null,
    technicalLimitTextKey: job.status === "completed" ? null : "provider_history_unavailable"
  });
}
