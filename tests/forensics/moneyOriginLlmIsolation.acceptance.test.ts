import { describe, expect, expectTypeOf, it } from "vitest";
import { buildMoneyOriginOperationalAssessment } from "../../src/forensics/moneyOriginOperationalAssessment";
import { getContractLlmVerdictCache } from "../../src/storage/repositories";
import type { Db } from "../../src/storage/db";
import type {
  ContractLlmVerdictSummary,
  MoneyOriginPath,
  MoneyOriginSenderInteractionProfile,
  RiskReport,
  WhereIsMoneyAssessment,
  WhereIsMoneyCoverage
} from "../../src/types";
import {
  OWNER,
  SUBJECT,
  USDD_PSM,
  VERIFY20
} from "../fixtures/forensics/remediationScoringCases";

const SENDER = OWNER;
const FUNDER = USDD_PSM;
const CONTRACT = VERIFY20;
const NOW = new Date("2026-07-13T10:00:00.000Z");
const LEGACY_CITATION = "legacy-llm-citation-must-stay-audit-only";
const LEGACY_PROSE = "LLM contract verdict is drainer_like with score 96/100 and 99% confidence.";

type AssessmentInput = Parameters<typeof buildMoneyOriginOperationalAssessment>[0];
type ActiveAssessmentInput = Omit<AssessmentInput, "contractLlmVerdicts">;

const LOW_FAST_RISK: RiskReport = {
  subjectAddress: SUBJECT,
  level: "LOW",
  score: 0,
  reasons: []
};

function coverage(): WhereIsMoneyCoverage {
  return {
    selectedInboundTxCount: 2,
    currentBalanceRaw: "225240325624",
    requestedAmountRaw: null,
    targetAmountRaw: "225240325624",
    selectedAmountRaw: "225240325624",
    coverageRatio: 1,
    selectedInboundVolumeRaw: "225240325624",
    currentBalanceCoverageRatio: 1,
    maxDepth: 7,
    fetchedAddressCount: 19,
    partial: true,
    notes: []
  };
}

function reviewPath(overrides: Partial<MoneyOriginPath> = {}): MoneyOriginPath {
  return {
    balanceTransferTxHash: "tx-review",
    rootSourceAddress: FUNDER,
    rootSourceType: "incomplete",
    balanceShare: 0.5,
    exposureSourceKey: null,
    exposureSourceLabel: null,
    pathAddresses: [FUNDER, SENDER, SUBJECT],
    txHashes: ["tx-funding", "tx-review"],
    steps: [{
      txHash: "tx-review",
      fromAddress: SENDER,
      toAddress: SUBJECT,
      amountRaw: "100000000000",
      timestamp: "2026-05-22T10:00:00.000Z"
    }],
    amountPreservationRatio: 1,
    timeSpanMs: 60 * 60 * 1000,
    stoppedReason: "weak_amount_or_time_continuity",
    verdict: "REVIEW",
    riskScoreContribution: 30,
    reasons: ["Previous incoming transfers exist, but clean CEX origin is not fully proven."],
    ...overrides
  };
}

function interactionProfile(
  balanceTransferTxHash: string,
  overrides: Partial<MoneyOriginSenderInteractionProfile> = {}
): MoneyOriginSenderInteractionProfile {
  return {
    balanceTransferTxHash,
    senderAddress: SENDER,
    incomingVolumeRaw: "512624000216",
    outgoingVolumeRaw: "507355503200",
    incomingTxCount: 4,
    outgoingTxCount: 5,
    topIncomingCounterparties: [],
    topOutgoingCounterparties: [],
    fundingCandidates: [],
    ...overrides
  };
}

function operationalInput(): ActiveAssessmentInput {
  return {
    checkedSubjectAddress: SUBJECT,
    fastWalletRisk: LOW_FAST_RISK,
    originPaths: [
      reviewPath({ balanceShare: 0.45 }),
      reviewPath({ balanceTransferTxHash: "tx-review-2", balanceShare: 0.55 })
    ],
    senderInteractionProfiles: [
      interactionProfile("tx-review"),
      interactionProfile("tx-review-2", {
        incomingVolumeRaw: "1399178000000",
        outgoingVolumeRaw: "1382660771000",
        incomingTxCount: 8,
        outgoingTxCount: 9
      })
    ],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    coverage: coverage()
  };
}

function unknownContractInput(): ActiveAssessmentInput {
  return {
    ...operationalInput(),
    originPaths: [reviewPath({
      rootSourceAddress: CONTRACT,
      pathAddresses: [CONTRACT, SENDER, SUBJECT],
      verdict: "DECLINE",
      rootSourceType: "decline_boundary",
      stoppedReason: "decline_boundary_reached",
      balanceShare: 1,
      riskScoreContribution: 65,
      reasons: ["Balance-forming path reaches unknown_contract boundary."]
    })],
    senderInteractionProfiles: []
  };
}

function legacyVerdict(overrides: Partial<ContractLlmVerdictSummary> = {}): ContractLlmVerdictSummary {
  return {
    source: "cache",
    cacheMatch: "address",
    reusedFromContractAddress: null,
    providerLabel: "legacy-provider",
    model: "legacy-model",
    contractAddress: CONTRACT,
    caseFileHash: "legacy-case-file",
    cacheId: "legacy-cache-id",
    verdict: "drainer_like",
    confidence: 0.99,
    contractRiskScore: 96,
    decisionRecommendation: "DECLINE",
    reasons: [LEGACY_PROSE],
    citedEvidenceIds: [LEGACY_CITATION],
    falsePositiveNotes: [],
    ...overrides
  };
}

function buildActiveAssessment(
  input: ActiveAssessmentInput,
  legacyVerdicts: ContractLlmVerdictSummary[] = []
): WhereIsMoneyAssessment {
  // This variable intentionally models an untyped legacy transport payload. The active input type must not own the field.
  const legacyTransportPayload = { ...input, contractLlmVerdicts: legacyVerdicts };
  return buildMoneyOriginOperationalAssessment(legacyTransportPayload);
}

function expectNoLegacyModelMaterial(
  assessment: WhereIsMoneyAssessment,
  proseAndCitations: string[]
): void {
  const forbiddenFields = [
    "contractLlmVerdicts",
    "contractVerdicts",
    "llmVerdict",
    "legacyLlmAudit",
    "providerLabel",
    "model",
    "contractRiskScore",
    "decisionRecommendation",
    "citedEvidenceIds",
    "falsePositiveNotes",
    "caseFileHash",
    "cacheId",
    "cacheMatch",
    "reusedFromContractAddress",
    "verdict",
    "confidence",
    "contractAddress"
  ];
  const keys = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      visit(nested);
    }
  };
  visit(assessment);
  for (const field of forbiddenFields) expect.soft(keys.has(field), field).toBe(false);

  const serialized = JSON.stringify(assessment);
  for (const marker of proseAndCitations) expect.soft(serialized, marker).not.toContain(marker);
}

describe("money-origin LLM isolation acceptance", () => {
  it("[REQ-25][TYPE] excludes contractLlmVerdicts from the active assessment input", () => {
    type ContractLlmVerdictsMustBeAbsent = "contractLlmVerdicts" extends keyof AssessmentInput ? never : true;
    expectTypeOf<ContractLlmVerdictsMustBeAbsent>().toEqualTypeOf<true>();
  });

  it("[REQ-23][REQ-25][LLM-ORIGIN] removes unavailable and invalid LLM from active assessment", () => {
    const input = operationalInput();
    const baseline = buildActiveAssessment(input);
    const payloads: Array<{ label: string; verdict: ContractLlmVerdictSummary }> = [
      {
        label: "unavailable",
        verdict: legacyVerdict({
          source: "unavailable",
          verdict: "unknown_insufficient_data",
          confidence: 0,
          contractRiskScore: 65,
          decisionRecommendation: "DECLINE",
          citedEvidenceIds: [],
          error: "contract analysis unavailable"
        })
      },
      {
        label: "timeout",
        verdict: legacyVerdict({
          source: "unavailable",
          verdict: "unknown_insufficient_data",
          confidence: 0,
          contractRiskScore: 65,
          decisionRecommendation: "DECLINE",
          citedEvidenceIds: [],
          error: "provider timeout"
        })
      },
      {
        label: "invalid out-of-range JSON",
        verdict: legacyVerdict({
          source: "llm",
          confidence: 1.25,
          contractRiskScore: 101
        })
      }
    ];

    expect(baseline.decision).not.toBe("DECLINE");
    for (const payload of payloads) {
      const assessment = buildActiveAssessment(input, [payload.verdict]);

      expect.soft(assessment, payload.label).toEqual(baseline);
      expect.soft(assessment.decision, payload.label).not.toBe("DECLINE");
      expectNoLegacyModelMaterial(assessment, [
        LEGACY_PROSE,
        LEGACY_CITATION,
        payload.verdict.error ?? "",
        payload.verdict.providerLabel,
        payload.verdict.model
      ].filter((value): value is string => Boolean(value)));
    }
  });

  it("[REQ-23][REQ-25][LLM-ORIGIN] removes risky and legitimate LLM from active assessment", () => {
    const input = unknownContractInput();
    const baseline = buildActiveAssessment(input);
    const legacyPayloads = [
      {
        label: "risky cached legacy verdict",
        verdict: legacyVerdict()
      },
      {
        label: "legitimate cached legacy verdict",
        verdict: legacyVerdict({
          verdict: "legitimate_service",
          confidence: 0.91,
          contractRiskScore: 12,
          decisionRecommendation: "ACCEPTABLE",
          reasons: ["Legacy model called this a legitimate service."],
          citedEvidenceIds: ["legacy-legitimate-citation"]
        })
      }
    ];

    for (const payload of legacyPayloads) {
      const assessment = buildActiveAssessment(input, [payload.verdict]);
      expect.soft(assessment, payload.label).toEqual(baseline);
      expectNoLegacyModelMaterial(assessment, [
        LEGACY_PROSE,
        LEGACY_CITATION,
        ...payload.verdict.reasons,
        ...payload.verdict.citedEvidenceIds,
        payload.verdict.providerLabel,
        payload.verdict.model
      ]);
    }
  });

  it("[REQ-25][LLM-ORIGIN-LEGACY] preserves stored LLM only through the separate audit repository", async () => {
    const storedVerdict = legacyVerdict();
    const storedResponse = {
      verdict: storedVerdict.verdict,
      contractRiskScore: storedVerdict.contractRiskScore,
      decisionRecommendation: storedVerdict.decisionRecommendation,
      reasons: storedVerdict.reasons,
      citedEvidenceIds: storedVerdict.citedEvidenceIds
    };
    const row = {
      id: "legacy-cache-id",
      contract_address: CONTRACT,
      profile_hash: "legacy-profile",
      contract_fingerprint_hash: "legacy-fingerprint",
      cache_scope: "address_flow",
      flow_context_hash: "legacy-flow",
      case_file_hash: "legacy-case-file",
      policy_version: "legacy-policy",
      provider_label: "legacy-provider",
      model: "legacy-model",
      verdict_json: structuredClone(storedVerdict),
      request_case_hash: "legacy-case-file",
      response_json: structuredClone(storedResponse),
      error: null,
      latency_ms: 25,
      created_at: NOW,
      expires_at: new Date(NOW.getTime() + 60_000),
      updated_at: NOW
    };
    const originalVerdictJson = structuredClone(row.verdict_json);
    const originalResponseJson = structuredClone(row.response_json);
    const queries: string[] = [];
    const db = {
      query: async (query: string) => {
        queries.push(query);
        return { rows: [row] };
      }
    } as unknown as Db;
    const audit = await getContractLlmVerdictCache(db, {
      contractAddress: CONTRACT,
      profileHash: "legacy-profile",
      cacheScope: "address_flow",
      flowContextHash: "legacy-flow",
      policyVersion: "legacy-policy",
      model: "legacy-model",
      now: NOW
    });

    expect(audit).not.toBeNull();
    if (!audit) throw new Error("legacy audit fixture was not returned");

    const input = unknownContractInput();
    const baseline = buildActiveAssessment(input);
    const assessment = buildActiveAssessment(input, [audit.verdict]);

    expect.soft(assessment).toEqual(baseline);
    expectNoLegacyModelMaterial(assessment, [
      audit.verdict.verdict,
      LEGACY_CITATION,
      LEGACY_PROSE,
      audit.verdict.providerLabel,
      audit.verdict.model,
      ...audit.verdict.reasons,
      ...audit.verdict.citedEvidenceIds
    ]);
    expect.soft(row.verdict_json).toEqual(originalVerdictJson);
    expect.soft(row.response_json).toEqual(originalResponseJson);
    expect.soft(audit.verdict).toEqual(originalVerdictJson);
    expect.soft(audit.responseJson).toEqual(originalResponseJson);
    expect.soft(queries).toHaveLength(1);
    expect.soft(queries.some((query) => /\b(insert|update|delete)\b/i.test(query))).toBe(false);
  });
});
