import { describe, expect, it } from "vitest";
import type { ApprovalAllowanceStateV2 } from "../../src/types";
import {
  activeAllowance,
  APPROVAL_TX,
  BRIDGERS,
  OWNER,
  SUBJECT,
  SWAP_TX,
  VERIFY20
} from "../fixtures/forensics/remediationScoringCases";

const VERIFY20_SELECTOR = "5082dd12";
const MAX_UINT256_RAW = activeAllowance().confirmedAllowanceRaw!;
const BRIDGERS_OWNER = OWNER;
const BRIDGERS_SPENDER = BRIDGERS;
const BRIDGERS_APPROVAL_TX_HASH = APPROVAL_TX;
const BRIDGERS_ACTION_TX_HASH = SWAP_TX;
const BRIDGERS_MOVED_AMOUNT_RAW = "91103009";
const APPROVAL_TIMESTAMP_MS = Date.parse("2026-07-12T12:00:00.000Z");

function currentAllowance(confirmedAllowanceRaw: string): ApprovalAllowanceStateV2 {
  const isZero = confirmedAllowanceRaw === "0";
  return {
    ...activeAllowance(confirmedAllowanceRaw),
    state: isZero ? "confirmed_zero" : "confirmed_active",
    confirmedAllowanceRaw,
    isUnlimited: confirmedAllowanceRaw === MAX_UINT256_RAW
  };
}

function safetyInput(overrides: Record<string, unknown> = {}) {
  return {
    subjectAddress: VERIFY20,
    allowance: currentAllowance(MAX_UINT256_RAW),
    balanceAtRiskRaw: null,
    exactVerify20: true,
    exactDebit: false,
    debitFoundFromSubject: false,
    campaignEvidenceIds: ["campaign:verify20"],
    serviceSession: null,
    authoritativeServiceId: null,
    providerRisk: false,
    contractContext: {
      selectors: [],
      providerName: null,
      freeText: null
    },
    transactionExpirationAt: null,
    ...overrides
  };
}

function bridgersSessionInput(overrides: Record<string, unknown> = {}) {
  return {
    ownerAddress: BRIDGERS_OWNER,
    callerAddress: BRIDGERS_OWNER,
    spenderAddress: BRIDGERS_SPENDER,
    approvalTxHash: BRIDGERS_APPROVAL_TX_HASH,
    actionTxHash: BRIDGERS_ACTION_TX_HASH,
    actionKind: "swap",
    approvalTimestampMs: APPROVAL_TIMESTAMP_MS,
    actionTimestampMs: APPROVAL_TIMESTAMP_MS + 66_000,
    successful: true,
    approvedAmountRaw: MAX_UINT256_RAW,
    decodedActionAmountRaw: BRIDGERS_MOVED_AMOUNT_RAW,
    movedUsdtAmountRaw: BRIDGERS_MOVED_AMOUNT_RAW,
    transactionSequenceUnbroken: true,
    knownService: null,
    providerTags: [],
    ...overrides
  };
}

function serviceSafetyInput(serviceSession: unknown, authoritativeServiceId: string | null) {
  return safetyInput({
    subjectAddress: BRIDGERS_SPENDER,
    allowance: activeAllowance(undefined, BRIDGERS_SPENDER),
    exactVerify20: false,
    exactDebit: false,
    debitFoundFromSubject: false,
    campaignEvidenceIds: [],
    serviceSession,
    authoritativeServiceId,
    providerRisk: false,
    contractContext: {
      selectors: [],
      providerName: null,
      freeText: null
    }
  });
}

describe("ApprovalSafetyAssessmentV2 acceptance contract", () => {
  it("[AC-19] scores confirmed unlimited Verify20 approval at CRITICAL 90", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const result = evaluateApprovalSafetyV2(safetyInput() as any);

    expect(result).toMatchObject({
      level: "CRITICAL",
      score: 90,
      action: "REVOKE_NOW",
      amlScoreImpact: 0,
      exactVerify20: true,
      exactDebit: false,
      debitFoundFromSubject: false
    });
    expect(result.allowance).toMatchObject({
      confirmedAllowanceRaw: MAX_UINT256_RAW,
      isUnlimited: true
    });
  });

  it("[REQ-20][VERIFY20-TIERS] applies all current-allowance tiers at exact USDT boundaries", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const cases = [
      [MAX_UINT256_RAW, 90, "CRITICAL", "REVOKE_NOW"],
      ["100000001", 75, "HIGH", "REVOKE_NOW"],
      ["100000000", 75, "HIGH", "REVOKE_NOW"],
      ["99999999", 45, "MEDIUM", "REVOKE_IF_UNUSED"],
      ["1", 45, "MEDIUM", "REVOKE_IF_UNUSED"],
      ["0", 0, "LOW", "NONE"]
    ] as const;

    for (const [raw, score, level, action] of cases) {
      const result = evaluateApprovalSafetyV2(safetyInput({ allowance: currentAllowance(raw) }) as any);
      expect(result, `raw allowance ${raw}`).toMatchObject({
        score,
        level,
        action,
        amlScoreImpact: 0
      });
    }
  });

  it("[AC-22] caps one selector or provider name at review context", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const contexts = [
      { selectors: [VERIFY20_SELECTOR], providerName: null, freeText: null },
      { selectors: [], providerName: "Verify20", freeText: null }
    ];

    for (const contractContext of contexts) {
      const result = evaluateApprovalSafetyV2(safetyInput({
        exactVerify20: false,
        campaignEvidenceIds: [],
        contractContext
      }) as any);

      expect(result.score).not.toBeNull();
      expect(result.score).toBeLessThanOrEqual(35);
      expect(result).toMatchObject({
        level: "MEDIUM",
        action: "REVOKE_IF_UNUSED",
        exactVerify20: false,
        amlScoreImpact: 0
      });
    }
  });

  it("[AC-23] removes active threat after confirmed zero allowance", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const result = evaluateApprovalSafetyV2(safetyInput({ allowance: currentAllowance("0") }) as any);

    expect(result).toMatchObject({
      level: "LOW",
      score: 0,
      action: "NONE",
      amlScoreImpact: 0
    });
    expect(result.allowance.observedApprovalTxHash).toBe(APPROVAL_TX);
  });

  it("[AC-28] removes transaction expiration from approval risk", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const contextOnly = {
      exactVerify20: false,
      campaignEvidenceIds: [],
      contractContext: {
        selectors: [VERIFY20_SELECTOR],
        providerName: null,
        freeText: null
      }
    };
    const withoutExpiration = evaluateApprovalSafetyV2(safetyInput(contextOnly) as any);
    const withExpiration = evaluateApprovalSafetyV2(safetyInput({
      ...contextOnly,
      transactionExpirationAt: "2026-07-14T12:00:00.000Z"
    }) as any);

    expect(withExpiration.score).toBe(withoutExpiration.score);
    expect(JSON.stringify(withExpiration)).not.toContain("approval_extended_expiration");
  });

  it("[AC-25] recognizes exact Bridgers 66-second 91.103009 session as LOW 10", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const { resolveKnownServiceSessionV1 } = await import("../../src/approvals/sessionContext");
    const { findKnownServiceBySpender } = await import("../../src/approvals/knownServiceRegistry");
    const service = findKnownServiceBySpender(BRIDGERS_SPENDER);
    expect(service).toMatchObject({
      id: "bridgers",
      spenderAddress: BRIDGERS_SPENDER,
      actionKinds: expect.arrayContaining(["swap"])
    });

    const session = resolveKnownServiceSessionV1(bridgersSessionInput({ knownService: service }) as any);
    expect(session).toMatchObject({
      walletAddress: BRIDGERS_OWNER,
      spenderAddress: BRIDGERS_SPENDER,
      approvalTxHash: BRIDGERS_APPROVAL_TX_HASH,
      actionTxHash: BRIDGERS_ACTION_TX_HASH,
      actionKind: "swap",
      walletInitiated: true,
      successful: true,
      delayMs: 66_000,
      approvedAmountRaw: MAX_UINT256_RAW,
      movedAmountRaw: BRIDGERS_MOVED_AMOUNT_RAW,
      amountContinuity: "exact",
      authoritativeServiceId: "bridgers"
    });
    expect(resolveKnownServiceSessionV1(bridgersSessionInput({
      knownService: service,
      actionTimestampMs: APPROVAL_TIMESTAMP_MS + 600_000
    }) as any)).toMatchObject({ delayMs: 600_000, amountContinuity: "exact" });

    const result = evaluateApprovalSafetyV2(serviceSafetyInput(session, service!.id) as any);
    expect(result).toMatchObject({
      level: "LOW",
      score: 10,
      action: "REVOKE_IF_UNUSED",
      amlScoreImpact: 0,
      serviceSession: session
    });
  });

  it("[AC-26] refuses service-session dampener for tag-only evidence", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const { resolveKnownServiceSessionV1 } = await import("../../src/approvals/sessionContext");
    const { findKnownServiceBySpender } = await import("../../src/approvals/knownServiceRegistry");
    const tagOnlySpender = SUBJECT;
    const knownService = findKnownServiceBySpender(tagOnlySpender);
    expect(knownService).toBeNull();

    const session = resolveKnownServiceSessionV1(bridgersSessionInput({
      spenderAddress: tagOnlySpender,
      knownService,
      providerTags: ["Bridgers:Cross-chain Bridge"]
    }) as any);
    expect(session).toBeNull();

    const result = evaluateApprovalSafetyV2(safetyInput({
      ...serviceSafetyInput(null, null),
      subjectAddress: tagOnlySpender,
      contractContext: {
        selectors: [],
        providerName: "Bridgers:Cross-chain Bridge",
        freeText: null
      }
    }) as any);
    expect(result).not.toMatchObject({ level: "LOW", score: 10 });
  });

  it.each([
    ["different_caller_or_spender", {
      callerAddress: SUBJECT,
      spenderAddress: VERIFY20
    }],
    ["failed_action", { successful: false }],
    ["outside_600000ms_window", { actionTimestampMs: APPROVAL_TIMESTAMP_MS + 600_001 }],
    ["amount_mismatch", { decodedActionAmountRaw: "91103008" }],
    ["broken_transaction_sequence", { transactionSequenceUnbroken: false }],
    ["unsupported_action", { actionKind: "claim" }]
  ] as const)("[REQ-21][SERVICE-SESSION] rejects every inexact known-service session: %s", async (_caseName, overrides) => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const { resolveKnownServiceSessionV1 } = await import("../../src/approvals/sessionContext");
    const { findKnownServiceBySpender } = await import("../../src/approvals/knownServiceRegistry");
    const service = findKnownServiceBySpender(BRIDGERS_SPENDER);
    expect(service).not.toBeNull();

    const session = resolveKnownServiceSessionV1(bridgersSessionInput({ knownService: service, ...overrides }) as any);
    expect(session).toBeNull();

    const result = evaluateApprovalSafetyV2(serviceSafetyInput(session, service!.id) as any);
    expect(result).not.toMatchObject({ level: "LOW", score: 10 });
  });

  it("[AC-31] keeps exact Bridgers approval session LOW instead of decline", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const { resolveKnownServiceSessionV1 } = await import("../../src/approvals/sessionContext");
    const { findKnownServiceBySpender } = await import("../../src/approvals/knownServiceRegistry");
    const service = findKnownServiceBySpender(BRIDGERS_SPENDER);
    const session = resolveKnownServiceSessionV1(bridgersSessionInput({ knownService: service }) as any);
    const result = evaluateApprovalSafetyV2(serviceSafetyInput(session, service!.id) as any);

    expect(result).toMatchObject({
      level: "LOW",
      score: 10,
      action: "REVOKE_IF_UNUSED",
      amlScoreImpact: 0
    });
    expect(JSON.stringify(result)).not.toContain("DECLINE");
  });

  it("[AC-32] keeps known-service unlimited approval without session at REVIEW 45", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const { findKnownServiceBySpender } = await import("../../src/approvals/knownServiceRegistry");
    const service = findKnownServiceBySpender(BRIDGERS_SPENDER);
    expect(service).not.toBeNull();

    const result = evaluateApprovalSafetyV2(serviceSafetyInput(null, service!.id) as any);
    expect(result).toMatchObject({
      level: "MEDIUM",
      score: 45,
      action: "REVOKE_IF_UNUSED",
      amlScoreImpact: 0,
      serviceSession: null
    });
  });

  it("[AC-33] prevents service dampening of provider risk Verify20 or debit proof", async () => {
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const { resolveKnownServiceSessionV1 } = await import("../../src/approvals/sessionContext");
    const { findKnownServiceBySpender } = await import("../../src/approvals/knownServiceRegistry");
    const service = findKnownServiceBySpender(BRIDGERS_SPENDER);
    const session = resolveKnownServiceSessionV1(bridgersSessionInput({ knownService: service }) as any);
    expect(session).not.toBeNull();

    const cases = [
      ["debit proof", { exactDebit: true, debitFoundFromSubject: true }, 95],
      ["provider risk", { providerRisk: true }, 90],
      ["Verify20", { exactVerify20: true, campaignEvidenceIds: ["campaign:verify20"] }, 90]
    ] as const;

    for (const [caseName, overrides, expectedScore] of cases) {
      const baseline = evaluateApprovalSafetyV2({
        ...serviceSafetyInput(null, null),
        ...overrides
      } as any);
      const withBenignServiceContext = evaluateApprovalSafetyV2({
        ...serviceSafetyInput(session, service!.id),
        ...overrides
      } as any);

      expect(baseline, caseName).toMatchObject({
        level: "CRITICAL",
        score: expectedScore,
        action: "REVOKE_NOW",
        amlScoreImpact: 0
      });
      expect(withBenignServiceContext, caseName).toMatchObject({
        level: "CRITICAL",
        score: expectedScore,
        action: "REVOKE_NOW",
        amlScoreImpact: 0
      });
      expect(withBenignServiceContext.score, caseName).toBe(baseline.score);
    }
  });
});
