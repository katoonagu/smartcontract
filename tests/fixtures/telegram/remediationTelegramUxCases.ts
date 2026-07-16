import { buildForensicCoverageV2 } from "../../../src/forensics/forensicCoverageV2";
import type {
  AddressRefV1,
  ApprovalAllowanceStateV2,
  ApprovalDrainProvenanceProfile,
  ApprovalSafetyAssessmentV2,
  ContractDecisionV2,
  ForensicCoverageV2,
  KnownServiceSessionV1,
  NarrativeFactV2,
  ScoreAnchorV2,
  ScoringEvidenceV2,
  WhereIsMoneyReport
} from "../../../src/types";
import {
  whereAssessmentFixture,
  whereReportFixture
} from "../forensics/wherePreliminaryNarrativeCases";

export const TGYT = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
export const TWGC = "TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm";
export const BRIDGE_SOURCE = "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV";
export const VERIFY20 = "TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK";
export const BRIDGERS = "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s";
export const GASFREE_ACCOUNT = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
export const USDD_PSM = "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ";
export const OFFICIAL_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const THJ = "THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7";
export const TKG = "TKgYpYNY4gwZr2cm8PkdpTk9eUhFWGn276";
export const TNARA = "TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1";

const FIRST_RECEIVER = "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ";
const ROUTE_TWO = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const ROUTE_THREE = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";
const APPROVAL_TX = "a".repeat(64);
const DEBIT_TX = "b".repeat(64);
const SWAP_TX = "c".repeat(64);
const FIXED_NOW = "2026-07-16T12:00:00.000Z";
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export type TelegramFixtureResultKindV1 =
  | "where_preliminary"
  | "wallet_final"
  | "deep_context"
  | "incoming_deposit"
  | "contract_safety"
  | "approval_safety"
  | "technical_result";

export type ApprovalAudienceContextFixtureV1 = "watched_wallet" | "external_address_check";

export type TelegramRouteFixtureV1 = {
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

export type LegacyLlmPayloadFixtureV1 = {
  model: string;
  verdict: string;
  confidence: number;
  reason: string;
  reasons: string[];
  recommendation: string;
  citations: string[];
  selector: string;
  rawCode: string;
  heading: string;
};

export type RemediationTelegramUxSourceV1 = {
  version: "telegram-forensic-source-v1";
  kind: TelegramFixtureResultKindV1;
  locale: "ru" | "en";
  checkedWalletAddress: string;
  resultState: "final" | "preliminary" | "no_final" | "technical_limit";
  scoreAnchorV2: ScoreAnchorV2 | null;
  narrativeFactsV2: NarrativeFactV2[];
  scoringEvidenceV2: ScoringEvidenceV2[];
  amlPresentation: {
    level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    actionTextKey: string | null;
  } | null;
  routes: TelegramRouteFixtureV1[];
  coverageV2: ForensicCoverageV2 | null;
  legacyCoverage: { selectedCount: number | null; warningTextKey: string } | null;
  approvalInput: {
    assessment: ApprovalSafetyAssessmentV2;
    audienceContext: ApprovalAudienceContextFixtureV1;
    exactDebitProfile: ApprovalDrainProvenanceProfile | null;
    transactionExpirationAt: string | null;
    contextDeadlineAt: string | null;
  } | null;
  contractDecision: ContractDecisionV2 | null;
  technicalLimitTextKey: string | null;
  legacyLlmPayload: LegacyLlmPayloadFixtureV1 | null;
  runtimeMetadata: { branch: string; sha: string } | null;
  deliveryContext: { retryVisible: boolean } | null;
};

export type RemediationTelegramUxCase = {
  id: string;
  source: RemediationTelegramUxSourceV1;
};

type FactInput = {
  id: string;
  subjectAddress: string;
  mode: ScoreAnchorV2["mode"];
  kind: string;
  factTextKey: string;
  evidenceIds: string[];
  isScoreDriver?: boolean;
  role?: string | null;
  section?: NarrativeFactV2["section"];
  direction?: NarrativeFactV2["direction"];
  amountRaw?: string | null;
  share?: number | null;
  txCount?: number | null;
  addresses?: AddressRefV1[];
  txHashes?: string[];
  meaningTextKey?: string | null;
};

function address(addressValue: string): AddressRefV1 {
  return {
    address: addressValue,
    display: `${addressValue.slice(0, 4)}…${addressValue.slice(-4)}`,
    url: `https://tronscan.org/#/address/${addressValue}`
  };
}

function fact(input: FactInput): NarrativeFactV2 {
  return {
    id: input.id,
    subjectAddress: input.subjectAddress,
    mode: input.mode,
    kind: input.kind,
    role: input.role ?? null,
    section: input.section ?? "score_reason",
    evidenceIds: input.evidenceIds,
    isScoreDriver: input.isScoreDriver ?? false,
    direction: input.direction ?? null,
    amountRaw: input.amountRaw ?? null,
    share: input.share ?? null,
    txCount: input.txCount ?? null,
    addresses: input.addresses ?? [],
    txHashes: input.txHashes ?? [],
    factTextKey: input.factTextKey,
    meaningTextKey: input.meaningTextKey ?? null
  };
}

function anchor(input: {
  subjectAddress: string;
  mode: ScoreAnchorV2["mode"];
  score: number;
  decision: ScoreAnchorV2["decision"];
  matrixRow: string;
  evidenceClass: ScoreAnchorV2["evidenceClass"];
  proofLevel: ScoreAnchorV2["proofLevel"];
  authority: ScoreAnchorV2["authority"];
  coverageDependency: ScoreAnchorV2["coverageDependency"];
  evidenceIds: string[];
  preferredFactId: string;
}): ScoreAnchorV2 {
  return {
    version: "score-anchor-v2",
    policyVersion: "scoring-signal-matrix-v3",
    subjectAddress: input.subjectAddress,
    mode: input.mode,
    score: input.score,
    decision: input.decision,
    matrixRow: input.matrixRow,
    evidenceClass: input.evidenceClass,
    proofLevel: input.proofLevel,
    authority: input.authority,
    evidenceIds: input.evidenceIds,
    primaryEvidenceIds: input.evidenceIds,
    preferredFactId: input.preferredFactId,
    coverageDependency: input.coverageDependency
  };
}

function scoringEvidence(scoreAnchor: ScoreAnchorV2): ScoringEvidenceV2[] {
  return scoreAnchor.evidenceIds.map((evidenceId) => ({
    id: evidenceId,
    subjectAddress: scoreAnchor.subjectAddress,
    matrixRow: scoreAnchor.matrixRow,
    evidenceClass: scoreAnchor.evidenceClass,
    authority: scoreAnchor.authority,
    sourceEvidenceIds: [evidenceId]
  }));
}

function source(input: Pick<
  RemediationTelegramUxSourceV1,
  "kind" | "checkedWalletAddress" | "resultState"
> & Partial<Omit<
  RemediationTelegramUxSourceV1,
  "version" | "kind" | "locale" | "checkedWalletAddress" | "resultState"
>>): RemediationTelegramUxSourceV1 {
  return {
    version: "telegram-forensic-source-v1",
    locale: "ru",
    scoreAnchorV2: null,
    narrativeFactsV2: [],
    scoringEvidenceV2: [],
    amlPresentation: null,
    routes: [],
    coverageV2: null,
    legacyCoverage: null,
    approvalInput: null,
    contractDecision: null,
    technicalLimitTextKey: null,
    legacyLlmPayload: null,
    runtimeMetadata: { branch: "codex/remediation-unified-telegram-ux", sha: "d18067f6" },
    deliveryContext: null,
    ...input
  };
}

function route(input: Omit<TelegramRouteFixtureV1, "asset"> & { asset?: TelegramRouteFixtureV1["asset"] }): TelegramRouteFixtureV1 {
  return { asset: "USDT", ...input };
}

function allowance(input: {
  ownerAddress: string;
  spenderAddress: string;
  state: ApprovalAllowanceStateV2["state"];
  confirmedAllowanceRaw: string | null;
  isUnlimited: boolean | null;
  failureCode?: string | null;
}): ApprovalAllowanceStateV2 {
  const confirmed = input.state === "confirmed_active" || input.state === "confirmed_zero";
  return {
    version: "approval-allowance-v2",
    ownerAddress: input.ownerAddress,
    spenderAddress: input.spenderAddress,
    tokenContract: OFFICIAL_USDT,
    confirmedAllowanceRaw: input.confirmedAllowanceRaw,
    isUnlimited: input.isUnlimited,
    state: input.state,
    confirmedAt: confirmed ? FIXED_NOW : null,
    freshUntil: confirmed ? "2026-07-16T12:15:00.000Z" : null,
    lastAttemptAt: FIXED_NOW,
    failureCode: input.failureCode ?? null,
    source: "official_usdt_allowance",
    observedApprovalTxHash: APPROVAL_TX
  };
}

function serviceSession(ownerAddress: string): KnownServiceSessionV1 {
  return {
    walletAddress: ownerAddress,
    spenderAddress: BRIDGERS,
    approvalTxHash: APPROVAL_TX,
    actionTxHash: SWAP_TX,
    actionKind: "swap",
    walletInitiated: true,
    successful: true,
    delayMs: 66_000,
    approvedAmountRaw: MAX_UINT256,
    movedAmountRaw: "91103009",
    amountContinuity: "exact",
    authoritativeServiceId: "bridgers"
  };
}

function approvalAssessment(input: {
  subjectAddress: string;
  spenderAddress: string;
  allowanceState: ApprovalAllowanceStateV2["state"];
  confirmedAllowanceRaw: string | null;
  isUnlimited: boolean | null;
  level: ApprovalSafetyAssessmentV2["level"];
  score: number | null;
  action: ApprovalSafetyAssessmentV2["action"];
  balanceAtRiskRaw?: string | null;
  exactVerify20?: boolean;
  exactDebit?: boolean;
  campaignEvidenceIds?: string[];
  serviceSessionValue?: KnownServiceSessionV1 | null;
  failureCode?: string | null;
}): ApprovalSafetyAssessmentV2 {
  return {
    version: "approval-safety-v2",
    subjectAddress: input.subjectAddress,
    level: input.level,
    score: input.score,
    action: input.action,
    amlScoreImpact: 0,
    allowance: allowance({
      ownerAddress: input.subjectAddress,
      spenderAddress: input.spenderAddress,
      state: input.allowanceState,
      confirmedAllowanceRaw: input.confirmedAllowanceRaw,
      isUnlimited: input.isUnlimited,
      failureCode: input.failureCode
    }),
    balanceAtRiskRaw: input.balanceAtRiskRaw ?? null,
    exactVerify20: input.exactVerify20 ?? false,
    exactDebit: input.exactDebit ?? false,
    debitFoundFromSubject: input.exactDebit ?? false,
    campaignEvidenceIds: input.campaignEvidenceIds ?? [],
    serviceSession: input.serviceSessionValue ?? null
  };
}

function exactDebitProfile(subjectAddress: string, spenderAddress = VERIFY20): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: subjectAddress,
    approvalTxHash: APPROVAL_TX,
    drainTxHash: DEBIT_TX,
    spenderAddress,
    operatorAddress: null,
    spenderResolution: "wrapper_contract",
    falsePositiveGuards: [],
    supportingFingerprints: [],
    firstReceiverAddress: FIRST_RECEIVER,
    subjectAddress,
    hopDepth: 0,
    amountRaw: "13302000000",
    amountPreservationRatio: 1,
    approvalAt: "2026-07-16T11:58:00.000Z",
    drainAt: "2026-07-16T11:59:00.000Z",
    pathTxHashes: [DEBIT_TX],
    pathAddresses: [subjectAddress, spenderAddress, FIRST_RECEIVER],
    score: 95,
    evidenceStrength: "exact_approval_and_transfer_from",
    subjectTokenState: null,
    victimTokenState: null,
    features: []
  };
}

function approvalSource(input: {
  assessment: ApprovalSafetyAssessmentV2;
  audienceContext: ApprovalAudienceContextFixtureV1;
  exactDebitProfile?: ApprovalDrainProvenanceProfile | null;
}): RemediationTelegramUxSourceV1 {
  return source({
    kind: "approval_safety",
    checkedWalletAddress: input.assessment.subjectAddress,
    resultState: input.assessment.score === null ? "no_final" : "final",
    approvalInput: {
      assessment: input.assessment,
      audienceContext: input.audienceContext,
      exactDebitProfile: input.exactDebitProfile ?? null,
      transactionExpirationAt: "2036-07-16T12:00:00.000Z",
      contextDeadlineAt: "2036-07-16T12:05:00.000Z"
    }
  });
}

function deterministicContract(input: {
  score: number;
  level: ContractDecisionV2["deterministic"]["level"];
  decision: ContractDecisionV2["deterministic"]["decision"];
  authority: ContractDecisionV2["deterministic"]["authority"];
  evidenceIds: string[];
}): ContractDecisionV2 {
  return { deterministic: input, finalSource: "deterministic", llm: null };
}

export const COVERAGE_24_10_14 = buildForensicCoverageV2({
  scope: "current_balance",
  availableInboundTxCount: 24,
  selectedInboundTxCount: 10,
  selectedAmountRaw: "1176317000000",
  tracedAmountRaw: "976891047722",
  exclusions: [{
    reason: "exact_gasfree_service_fee",
    direction: "incoming",
    txCount: 14,
    amountRaw: "3000000",
    evidenceIds: ["coverage:gasfree-fees"]
  }],
  limitations: []
});

const WHERE_PRELIMINARY_COVERAGE = buildForensicCoverageV2({
  scope: "current_balance",
  availableInboundTxCount: null,
  selectedInboundTxCount: 10,
  selectedAmountRaw: "1176317000000",
  tracedAmountRaw: "976891047722",
  exclusions: [],
  limitations: []
});

const finalAnchor = anchor({
  subjectAddress: TGYT,
  mode: "unified",
  score: 90,
  decision: "DECLINE",
  matrixRow: "direct_counterparty_policy",
  evidenceClass: "policy",
  proofLevel: "strong",
  authority: "registry",
  coverageDependency: "none",
  evidenceIds: ["tgyt:blacklist:outgoing"],
  preferredFactId: "tgyt-blacklist"
});

const finalFacts = [
  fact({
    id: "legacy-fast-context",
    subjectAddress: TGYT,
    mode: "fast",
    kind: "rapid_transit",
    factTextKey: "fast_behavior_context",
    evidenceIds: ["fast:context"],
    isScoreDriver: true
  }),
  fact({
    id: "tgyt-blacklist",
    subjectAddress: TGYT,
    mode: "unified",
    kind: "outgoing_blacklisted_counterparty",
    factTextKey: "outgoing_blacklisted_counterparty_later_frozen",
    evidenceIds: ["tgyt:blacklist:outgoing"],
    isScoreDriver: true,
    direction: "outgoing",
    amountRaw: "1176317000000",
    share: 1,
    txCount: 2,
    addresses: [address(TGYT), address(TWGC)]
  }),
  fact({
    id: "tgyt-bridge-context",
    subjectAddress: TGYT,
    mode: "where",
    kind: "bridge_shared_liquidity",
    factTextKey: "bridge_shared_liquidity_inbound",
    evidenceIds: ["tgyt:bridge:83"],
    section: "money_origin",
    direction: "incoming",
    share: 0.83,
    addresses: [address(BRIDGE_SOURCE), address(TGYT)]
  })
];

const FINAL_AML_SOURCE = source({
  kind: "wallet_final",
  checkedWalletAddress: TGYT,
  resultState: "final",
  scoreAnchorV2: finalAnchor,
  narrativeFactsV2: finalFacts,
  scoringEvidenceV2: scoringEvidence(finalAnchor),
  amlPresentation: { level: "CRITICAL", actionTextKey: "do_not_operate" },
  routes: [route({
    routeId: "tgyt-to-twgc",
    direction: "outbound",
    fromAddress: TGYT,
    toAddress: TWGC,
    amountRaw: "1176317000000",
    share: 1,
    transferCount: 2,
    evidenceIds: ["tgyt:blacklist:outgoing"]
  })],
  coverageV2: COVERAGE_24_10_14
});

const whereAnchor = anchor({
  subjectAddress: TGYT,
  mode: "where",
  score: 78,
  decision: "REVIEW",
  matrixRow: "source_policy",
  evidenceClass: "policy",
  proofLevel: "strong",
  authority: "registry",
  coverageDependency: "required",
  evidenceIds: ["where:bridge:83"],
  preferredFactId: "where-bridge-primary"
});

const WHERE_PRELIMINARY_SOURCE = source({
  kind: "where_preliminary",
  checkedWalletAddress: TGYT,
  resultState: "preliminary",
  scoreAnchorV2: whereAnchor,
  narrativeFactsV2: [fact({
    id: "where-bridge-primary",
    subjectAddress: TGYT,
    mode: "where",
    kind: "bridge_shared_liquidity",
    factTextKey: "where_preliminary_bridge_shared_liquidity",
    evidenceIds: ["where:bridge:83"],
    isScoreDriver: true,
    direction: "incoming",
    amountRaw: "976891047722",
    share: 0.83,
    addresses: [address(BRIDGE_SOURCE), address(TGYT)]
  })],
  scoringEvidenceV2: scoringEvidence(whereAnchor),
  amlPresentation: { level: "HIGH", actionTextKey: null },
  routes: [route({
    routeId: "where-bridge-route",
    direction: "inbound",
    fromAddress: BRIDGE_SOURCE,
    toAddress: TGYT,
    amountRaw: "976891047722",
    share: 0.83,
    transferCount: null,
    evidenceIds: ["where:bridge:83"]
  })],
  coverageV2: WHERE_PRELIMINARY_COVERAGE
});

const verify20Active = approvalAssessment({
  subjectAddress: TGYT,
  spenderAddress: VERIFY20,
  allowanceState: "confirmed_active",
  confirmedAllowanceRaw: MAX_UINT256,
  isUnlimited: true,
  level: "CRITICAL",
  score: 90,
  action: "REVOKE_NOW",
  balanceAtRiskRaw: "4084665000",
  exactVerify20: true,
  campaignEvidenceIds: ["campaign:wallets:20", "campaign:calls:73", "campaign:bttold-sequence"]
});

const verify20Debit = approvalAssessment({
  subjectAddress: TGYT,
  spenderAddress: VERIFY20,
  allowanceState: "confirmed_active",
  confirmedAllowanceRaw: MAX_UINT256,
  isUnlimited: true,
  level: "CRITICAL",
  score: 95,
  action: "REVOKE_NOW",
  balanceAtRiskRaw: "4084665000",
  exactVerify20: true,
  exactDebit: true,
  campaignEvidenceIds: ["campaign:wallets:20", "campaign:calls:73", "campaign:bttold-sequence"]
});

const bridgersActive = approvalAssessment({
  subjectAddress: TGYT,
  spenderAddress: BRIDGERS,
  allowanceState: "confirmed_active",
  confirmedAllowanceRaw: MAX_UINT256,
  isUnlimited: true,
  level: "LOW",
  score: 10,
  action: "REVOKE_IF_UNUSED",
  serviceSessionValue: serviceSession(TGYT)
});

const bridgersZero = approvalAssessment({
  subjectAddress: TGYT,
  spenderAddress: BRIDGERS,
  allowanceState: "confirmed_zero",
  confirmedAllowanceRaw: "0",
  isUnlimited: false,
  level: "LOW",
  score: 0,
  action: "NONE",
  serviceSessionValue: serviceSession(TGYT)
});

const bridgersFailed = approvalAssessment({
  subjectAddress: TGYT,
  spenderAddress: BRIDGERS,
  allowanceState: "failed",
  confirmedAllowanceRaw: null,
  isUnlimited: null,
  level: "UNKNOWN",
  score: null,
  action: "CONFIRM_ALLOWANCE",
  failureCode: "provider_error",
  serviceSessionValue: serviceSession(TGYT)
});

const psmAnchor = anchor({
  subjectAddress: TGYT,
  mode: "where",
  score: 45,
  decision: "REVIEW",
  matrixRow: "source_policy",
  evidenceClass: "context",
  proofLevel: "context",
  authority: "behavior",
  coverageDependency: "required",
  evidenceIds: ["psm:inbound:83"],
  preferredFactId: "psm-inbound-primary"
});

const gasFreeDecision = deterministicContract({
  score: 10,
  level: "LOW",
  decision: "ACCEPTABLE",
  authority: "gasfree_account",
  evidenceIds: ["gasfree:account:structural"]
});

export const REMEDIATION_TELEGRAM_UX_CASES: readonly RemediationTelegramUxCase[] = [
  { id: "GOLDEN_FINAL_AML", source: FINAL_AML_SOURCE },
  { id: "GOLDEN_WHERE_PRELIMINARY", source: WHERE_PRELIMINARY_SOURCE },
  {
    id: "GOLDEN_NO_FINAL_TECHNICAL",
    source: source({
      kind: "technical_result",
      checkedWalletAddress: TGYT,
      resultState: "technical_limit",
      legacyCoverage: { selectedCount: 10, warningTextKey: "legacy_available_denominator_unsaved" },
      technicalLimitTextKey: "provider_history_unavailable"
    })
  },
  {
    id: "GOLDEN_TRUE_NO_ACTIVITY",
    source: source({
      kind: "wallet_final",
      checkedWalletAddress: GASFREE_ACCOUNT,
      resultState: "no_final",
      narrativeFactsV2: [fact({
        id: "true-no-principal-activity",
        subjectAddress: GASFREE_ACCOUNT,
        mode: "where",
        kind: "true_no_activity",
        factTextKey: "true_no_principal_activity",
        evidenceIds: ["coverage:no-principal"],
        section: "money_movement"
      })]
    })
  },
  { id: "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT", source: approvalSource({
    assessment: verify20Active,
    audienceContext: "external_address_check"
  }) },
  { id: "GOLDEN_VERIFY20_EXACT_DEBIT", source: approvalSource({
    assessment: verify20Debit,
    audienceContext: "watched_wallet",
    exactDebitProfile: exactDebitProfile(TGYT)
  }) },
  { id: "GOLDEN_BRIDGERS_ACTIVE", source: approvalSource({
    assessment: bridgersActive,
    audienceContext: "watched_wallet"
  }) },
  { id: "GOLDEN_BRIDGERS_ZERO", source: approvalSource({
    assessment: bridgersZero,
    audienceContext: "watched_wallet"
  }) },
  { id: "GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN", source: approvalSource({
    assessment: bridgersFailed,
    audienceContext: "external_address_check"
  }) },
  {
    id: "GOLDEN_USDD_PSM",
    source: source({
      kind: "wallet_final",
      checkedWalletAddress: TGYT,
      resultState: "final",
      scoreAnchorV2: psmAnchor,
      narrativeFactsV2: [fact({
        id: "psm-inbound-primary",
        subjectAddress: TGYT,
        mode: "where",
        kind: "exact_usdd_psm_exposure",
        factTextKey: "usdd_psm_inbound_shared_liquidity",
        evidenceIds: ["psm:inbound:83"],
        isScoreDriver: true,
        direction: "incoming",
        amountRaw: "976891047722",
        share: 0.83,
        txCount: 1,
        addresses: [address(USDD_PSM), address(TGYT)]
      })],
      scoringEvidenceV2: scoringEvidence(psmAnchor),
      amlPresentation: { level: "MEDIUM", actionTextKey: "manual_review" },
      routes: [route({
        routeId: "psm-inbound",
        direction: "inbound",
        fromAddress: USDD_PSM,
        toAddress: TGYT,
        amountRaw: "976891047722",
        share: 0.83,
        transferCount: 1,
        evidenceIds: ["psm:inbound:83"]
      })],
      coverageV2: WHERE_PRELIMINARY_COVERAGE
    })
  },
  {
    id: "GOLDEN_GASFREE_ACCOUNT",
    source: source({
      kind: "contract_safety",
      checkedWalletAddress: GASFREE_ACCOUNT,
      resultState: "final",
      narrativeFactsV2: [fact({
        id: "gasfree-account",
        subjectAddress: GASFREE_ACCOUNT,
        mode: "contract",
        kind: "gasfree_account",
        factTextKey: "gasfree_account_structural",
        evidenceIds: ["gasfree:account:structural"],
        isScoreDriver: true
      })],
      contractDecision: gasFreeDecision
    })
  },
  {
    id: "THJ_COLLECTOR_ONLY",
    source: (() => {
      const collectorAnchor = anchor({
        subjectAddress: THJ,
        mode: "deep",
        score: 35,
        decision: "REVIEW",
        matrixRow: "behavior_only_prior",
        evidenceClass: "context",
        proofLevel: "context",
        authority: "behavior",
        coverageDependency: "required",
        evidenceIds: ["thj:collector:episode"],
        preferredFactId: "thj-collector-only"
      });
      return source({
        kind: "deep_context",
        checkedWalletAddress: THJ,
        resultState: "final",
        scoreAnchorV2: collectorAnchor,
        narrativeFactsV2: [fact({
          id: "thj-collector-only",
          subjectAddress: THJ,
          mode: "deep",
          kind: "collector_context",
          factTextKey: "collector_context_only",
          evidenceIds: ["thj:collector:episode"],
          isScoreDriver: true,
          amountRaw: "282693000000",
          share: 0.67,
          txCount: 12
        })],
        scoringEvidenceV2: scoringEvidence(collectorAnchor),
        amlPresentation: { level: "MEDIUM", actionTextKey: "manual_review" }
      });
    })()
  },
  {
    id: "THJ_COLLECTOR_INDEPENDENT_SIGNAL",
    source: (() => {
      const collectorAnchor = anchor({
        subjectAddress: THJ,
        mode: "unified",
        score: 55,
        decision: "REVIEW",
        matrixRow: "behavior_only_prior",
        evidenceClass: "pattern",
        proofLevel: "strong",
        authority: "deterministic_pattern",
        coverageDependency: "required",
        evidenceIds: ["thj:independent:signal"],
        preferredFactId: "thj-independent-signal"
      });
      return source({
        kind: "deep_context",
        checkedWalletAddress: THJ,
        resultState: "final",
        scoreAnchorV2: collectorAnchor,
        narrativeFactsV2: [
          fact({
            id: "thj-collector-context",
            subjectAddress: THJ,
            mode: "deep",
            kind: "collector_context",
            factTextKey: "collector_context_only",
            evidenceIds: ["thj:collector:episode"],
            amountRaw: "282693000000",
            share: 0.67,
            txCount: 12
          }),
          fact({
            id: "thj-independent-signal",
            subjectAddress: THJ,
            mode: "unified",
            kind: "collector_plus_independent_signal",
            factTextKey: "collector_disjoint_independent_signal",
            evidenceIds: ["thj:independent:signal"],
            isScoreDriver: true
          })
        ],
        scoringEvidenceV2: scoringEvidence(collectorAnchor),
        amlPresentation: { level: "MEDIUM", actionTextKey: "manual_review" }
      });
    })()
  },
  {
    id: "TKG_LOW_BALANCE_LATEST_FIVE",
    source: (() => {
      const tkgAnchor = anchor({
        subjectAddress: TKG,
        mode: "where",
        score: 35,
        decision: "REVIEW",
        matrixRow: "counterparty_context",
        evidenceClass: "context",
        proofLevel: "context",
        authority: "behavior",
        coverageDependency: "required",
        evidenceIds: ["tkg:latest-five"],
        preferredFactId: "tkg-latest-five"
      });
      return source({
        kind: "wallet_final",
        checkedWalletAddress: TKG,
        resultState: "final",
        scoreAnchorV2: tkgAnchor,
        narrativeFactsV2: [fact({
          id: "tkg-latest-five",
          subjectAddress: TKG,
          mode: "where",
          kind: "recent_principal_flow",
          factTextKey: "low_balance_latest_five_principal",
          evidenceIds: ["tkg:latest-five"],
          isScoreDriver: true,
          amountRaw: "305000000",
          txCount: 5
        })],
        scoringEvidenceV2: scoringEvidence(tkgAnchor),
        amlPresentation: { level: "LOW", actionTextKey: "manual_review" },
        routes: [
          route({
            routeId: "tkg-305-in",
            direction: "inbound",
            fromAddress: ROUTE_TWO,
            toAddress: TKG,
            amountRaw: "305000000",
            share: null,
            transferCount: 1,
            evidenceIds: ["tkg:305:in"]
          }),
          route({
            routeId: "tkg-305-out",
            direction: "outbound",
            fromAddress: TKG,
            toAddress: ROUTE_THREE,
            amountRaw: "305000000",
            share: null,
            transferCount: 1,
            evidenceIds: ["tkg:305:out"]
          })
        ]
      });
    })()
  },
  { id: "COVERAGE_24_10_14", source: FINAL_AML_SOURCE },
  { id: "TNARA_VERIFY20_ACTIVE_NO_DEBIT", source: approvalSource({
    assessment: approvalAssessment({
      subjectAddress: TNARA,
      spenderAddress: VERIFY20,
      allowanceState: "confirmed_active",
      confirmedAllowanceRaw: MAX_UINT256,
      isUnlimited: true,
      level: "CRITICAL",
      score: 90,
      action: "REVOKE_NOW",
      balanceAtRiskRaw: "4084665000",
      exactVerify20: true,
      campaignEvidenceIds: ["tnara:campaign:wallets", "tnara:campaign:bttold"]
    }),
    audienceContext: "external_address_check"
  }) },
  { id: "TNARA_VERIFY20_EXACT_DEBIT", source: approvalSource({
    assessment: approvalAssessment({
      subjectAddress: TNARA,
      spenderAddress: VERIFY20,
      allowanceState: "confirmed_active",
      confirmedAllowanceRaw: MAX_UINT256,
      isUnlimited: true,
      level: "CRITICAL",
      score: 95,
      action: "REVOKE_NOW",
      balanceAtRiskRaw: "4084665000",
      exactVerify20: true,
      exactDebit: true
    }),
    audienceContext: "watched_wallet",
    exactDebitProfile: exactDebitProfile(TNARA)
  }) },
  { id: "VERIFY20_FINITE_ACTIVE", source: approvalSource({
    assessment: approvalAssessment({
      subjectAddress: TGYT,
      spenderAddress: VERIFY20,
      allowanceState: "confirmed_active",
      confirmedAllowanceRaw: "500000000",
      isUnlimited: false,
      level: "HIGH",
      score: 75,
      action: "REVOKE_NOW",
      balanceAtRiskRaw: "4084665000",
      exactVerify20: true
    }),
    audienceContext: "external_address_check"
  }) },
  { id: "VERIFY20_ACTIVE_WATCHED_NO_DEBIT", source: approvalSource({
    assessment: verify20Active,
    audienceContext: "watched_wallet"
  }) },
  { id: "BRIDGERS_FAILED", source: approvalSource({ assessment: bridgersFailed, audienceContext: "watched_wallet" }) },
  { id: "BRIDGERS_STALE", source: approvalSource({
    assessment: approvalAssessment({
      subjectAddress: TGYT,
      spenderAddress: BRIDGERS,
      allowanceState: "stale",
      confirmedAllowanceRaw: null,
      isUnlimited: null,
      level: "UNKNOWN",
      score: null,
      action: "CONFIRM_ALLOWANCE",
      failureCode: "stale_allowance",
      serviceSessionValue: serviceSession(TGYT)
    }),
    audienceContext: "external_address_check"
  }) },
  {
    id: "HTX_HISTORICAL_CONTEXT",
    source: (() => {
      const htxAnchor = anchor({
        subjectAddress: TGYT,
        mode: "where",
        score: 45,
        decision: "REVIEW",
        matrixRow: "source_policy",
        evidenceClass: "policy",
        proofLevel: "strong",
        authority: "registry",
        coverageDependency: "required",
        evidenceIds: ["htx:historical:inbound"],
        preferredFactId: "htx-historical-primary"
      });
      return source({
        kind: "wallet_final",
        checkedWalletAddress: TGYT,
        resultState: "final",
        scoreAnchorV2: htxAnchor,
        narrativeFactsV2: [fact({
          id: "htx-historical-primary",
          subjectAddress: TGYT,
          mode: "where",
          kind: "htx_historical",
          factTextKey: "htx_historical_policy_context",
          evidenceIds: ["htx:historical:inbound"],
          isScoreDriver: true,
          direction: "incoming",
          amountRaw: "25000000000",
          share: 0.25,
          txCount: 1,
          addresses: [address(ROUTE_TWO), address(TGYT)]
        })],
        scoringEvidenceV2: scoringEvidence(htxAnchor),
        amlPresentation: { level: "MEDIUM", actionTextKey: "manual_review" }
      });
    })()
  },
  {
    id: "OFFICIAL_USDT_CONTRACT",
    source: source({
      kind: "contract_safety",
      checkedWalletAddress: OFFICIAL_USDT,
      resultState: "final",
      narrativeFactsV2: [fact({
        id: "official-usdt-contract",
        subjectAddress: OFFICIAL_USDT,
        mode: "contract",
        kind: "official_usdt",
        factTextKey: "official_usdt_registry_contract",
        evidenceIds: ["registry:official-usdt"],
        isScoreDriver: true
      })],
      contractDecision: deterministicContract({
        score: 0,
        level: "LOW",
        decision: "ACCEPTABLE",
        authority: "official_registry",
        evidenceIds: ["registry:official-usdt"]
      })
    })
  },
  {
    id: "PSM_TWO_PERCENT_OUTBOUND",
    source: (() => {
      const outboundAnchor = anchor({
        subjectAddress: TGYT,
        mode: "where",
        score: 22,
        decision: "ACCEPTABLE",
        matrixRow: "source_policy",
        evidenceClass: "context",
        proofLevel: "context",
        authority: "behavior",
        coverageDependency: "required",
        evidenceIds: ["psm:outbound:2"],
        preferredFactId: "psm-outbound-primary"
      });
      return source({
        kind: "wallet_final",
        checkedWalletAddress: TGYT,
        resultState: "final",
        scoreAnchorV2: outboundAnchor,
        narrativeFactsV2: [fact({
          id: "psm-outbound-primary",
          subjectAddress: TGYT,
          mode: "where",
          kind: "exact_usdd_psm_exposure",
          factTextKey: "usdd_psm_outbound_shared_liquidity",
          evidenceIds: ["psm:outbound:2"],
          isScoreDriver: true,
          direction: "outgoing",
          amountRaw: "20000000",
          share: 0.02,
          txCount: 1,
          addresses: [address(TGYT), address(USDD_PSM)]
        })],
        scoringEvidenceV2: scoringEvidence(outboundAnchor),
        amlPresentation: { level: "LOW", actionTextKey: "manual_review" },
        routes: [route({
          routeId: "psm-outbound",
          direction: "outbound",
          fromAddress: TGYT,
          toAddress: USDD_PSM,
          amountRaw: "20000000",
          share: 0.02,
          transferCount: 1,
          evidenceIds: ["psm:outbound:2"]
        })]
      });
    })()
  },
  {
    id: "INCOMING_APPROVAL_ROUTE_ROLES",
    source: (() => {
      const incomingAnchor = anchor({
        subjectAddress: FIRST_RECEIVER,
        mode: "incoming",
        score: 95,
        decision: "DECLINE",
        matrixRow: "hard_proof",
        evidenceClass: "exact_hard",
        proofLevel: "exact",
        authority: "on_chain",
        coverageDependency: "none",
        evidenceIds: ["incoming:approval-route"],
        preferredFactId: "incoming-approval-roles"
      });
      return source({
        kind: "incoming_deposit",
        checkedWalletAddress: FIRST_RECEIVER,
        resultState: "final",
        scoreAnchorV2: incomingAnchor,
        narrativeFactsV2: [fact({
          id: "incoming-approval-roles",
          subjectAddress: FIRST_RECEIVER,
          mode: "incoming",
          kind: "approval_drain_roles",
          factTextKey: "approval_drain_roles_distinct",
          evidenceIds: ["incoming:approval-route"],
          isScoreDriver: true,
          direction: "incoming",
          amountRaw: "13302000000",
          txCount: 1,
          addresses: [address(TNARA), address(VERIFY20), address(FIRST_RECEIVER)]
        })],
        scoringEvidenceV2: scoringEvidence(incomingAnchor),
        amlPresentation: { level: "CRITICAL", actionTextKey: "do_not_operate" },
        routes: [route({
          routeId: "victim-to-receiver",
          direction: "inbound",
          fromAddress: TNARA,
          toAddress: FIRST_RECEIVER,
          amountRaw: "13302000000",
          share: 1,
          transferCount: 1,
          evidenceIds: ["incoming:approval-route"]
        })]
      });
    })()
  },
  {
    id: "DEDUPLICATED_PHYSICAL_TRANSFER",
    source: (() => {
      const dedupeAnchor = anchor({
        subjectAddress: TKG,
        mode: "unified",
        score: 35,
        decision: "REVIEW",
        matrixRow: "counterparty_context",
        evidenceClass: "context",
        proofLevel: "context",
        authority: "behavior",
        coverageDependency: "required",
        evidenceIds: ["physical-transfer-305"],
        preferredFactId: "dedupe-primary"
      });
      return source({
        kind: "wallet_final",
        checkedWalletAddress: TKG,
        resultState: "final",
        scoreAnchorV2: dedupeAnchor,
        narrativeFactsV2: [
          fact({
            id: "dedupe-primary",
            subjectAddress: TKG,
            mode: "unified",
            kind: "principal_transfer",
            factTextKey: "principal_transfer_context",
            evidenceIds: ["physical-transfer-305"],
            isScoreDriver: true,
            amountRaw: "305000000",
            txCount: 1
          }),
          fact({
            id: "dedupe-secondary",
            subjectAddress: TKG,
            mode: "deep",
            kind: "same_principal_transfer",
            factTextKey: "principal_transfer_context",
            evidenceIds: ["physical-transfer-305"],
            amountRaw: "305000000",
            txCount: 1
          })
        ],
        scoringEvidenceV2: scoringEvidence(dedupeAnchor),
        amlPresentation: { level: "MEDIUM", actionTextKey: "manual_review" },
        routes: [route({
          routeId: "physical-transfer-305",
          direction: "inbound",
          fromAddress: ROUTE_TWO,
          toAddress: TKG,
          amountRaw: "305000000",
          share: null,
          transferCount: 1,
          evidenceIds: ["physical-transfer-305"]
        })]
      });
    })()
  },
  {
    id: "THREE_ROUTES_AGGREGATED",
    source: source({
      ...FINAL_AML_SOURCE,
      routes: [
        route({ routeId: "route-1", direction: "inbound", fromAddress: BRIDGE_SOURCE, toAddress: TGYT, amountRaw: "500000000", share: 0.5, transferCount: 1, evidenceIds: ["route:1"] }),
        route({ routeId: "route-2", direction: "inbound", fromAddress: ROUTE_TWO, toAddress: TGYT, amountRaw: "300000000", share: 0.3, transferCount: 1, evidenceIds: ["route:2"] }),
        route({ routeId: "route-3", direction: "inbound", fromAddress: ROUTE_THREE, toAddress: TGYT, amountRaw: "200000000", share: 0.2, transferCount: 1, evidenceIds: ["route:3"] })
      ]
    })
  },
  {
    id: "INVALID_ADDRESS_AND_ANCHOR",
    source: source({
      kind: "wallet_final",
      checkedWalletAddress: "<invalid-wallet>",
      resultState: "final",
      scoreAnchorV2: finalAnchor,
      narrativeFactsV2: [fact({
        id: "invalid-address-fact",
        subjectAddress: "<invalid-wallet>",
        mode: "unified",
        kind: "unsupported",
        factTextKey: "unsupported_raw_provider_fact",
        evidenceIds: ["invalid:evidence"],
        isScoreDriver: true,
        addresses: [{ address: "<script>alert(1)</script>", display: "<script>alert(1)</script>", url: null }]
      })],
      scoringEvidenceV2: scoringEvidence(finalAnchor),
      amlPresentation: { level: "CRITICAL", actionTextKey: "do_not_operate" },
      legacyCoverage: { selectedCount: 10, warningTextKey: "legacy_available_denominator_unsaved" }
    })
  },
  {
    id: "FOREIGN_EXACT_DEBIT_PROFILE",
    source: approvalSource({
      assessment: verify20Debit,
      audienceContext: "watched_wallet",
      exactDebitProfile: exactDebitProfile(TNARA)
    })
  },
  {
    id: "LEGACY_LLM_ALL_FIELDS",
    source: source({
      ...FINAL_AML_SOURCE,
      legacyLlmPayload: {
        model: "legacy-model-sentinel",
        verdict: "LEGACY_LLM_VERDICT_SENTINEL",
        confidence: 0.987654,
        reason: "LEGACY_LLM_REASON_SENTINEL",
        reasons: ["LEGACY_LLM_REASONS_SENTINEL"],
        recommendation: "LEGACY_LLM_RECOMMENDATION_SENTINEL",
        citations: ["LEGACY_LLM_CITATION_SENTINEL"],
        selector: "0xLEGACY_SELECTOR_SENTINEL",
        rawCode: "LEGACY_RAW_CODE_SENTINEL",
        heading: "LEGACY_AI_HEADING_SENTINEL"
      }
    })
  },
  {
    id: "INCOMING_RETRY_INVALID_LEGACY_COVERAGE",
    source: source({
      kind: "incoming_deposit",
      checkedWalletAddress: TGYT,
      resultState: "technical_limit",
      technicalLimitTextKey: "provider_history_unavailable",
      legacyCoverage: { selectedCount: 1, warningTextKey: "legacy_available_denominator_unsaved" },
      deliveryContext: { retryVisible: true }
    })
  }
];

export function remediationTelegramUxCase(id: string): RemediationTelegramUxCase {
  const fixture = REMEDIATION_TELEGRAM_UX_CASES.find((item) => item.id === id);
  if (!fixture) throw new Error(`Unknown remediation Telegram fixture: ${id}`);
  return fixture;
}

export const PERSISTED_COVERAGE_WHERE_REPORT: WhereIsMoneyReport = whereReportFixture({
  subjectAddress: TGYT,
  riskScore: 90,
  assessment: whereAssessmentFixture({
    riskScore: 90,
    decision: "DECLINE",
    reasons: [],
    warnings: []
  }),
  decision: "DECLINE",
  userDecision: "DECLINE",
  internalDecision: "DECLINE",
  proofLevel: "exchange_policy_decline",
  decisionReasons: [],
  coverage: {
    selectedInboundTxCount: 10,
    selectedInboundVolumeRaw: "1176317000000",
    currentBalanceCoverageRatio: 0.8304,
    coverageRatio: 0.8304,
    selectedAmountRaw: "1176317000000",
    maxDepth: 2,
    fetchedAddressCount: 24,
    partial: true,
    notes: []
  },
  coverageV2: COVERAGE_24_10_14,
  scoreAnchorV2: finalAnchor,
  narrativeFactsV2: finalFacts,
  scoringEvidenceV2: scoringEvidence(finalAnchor),
  scoreAnchorDiagnostic: null
});
