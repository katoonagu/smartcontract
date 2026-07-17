import { describe, expect, it, vi } from "vitest";
import { runSingleApprovalContextFinalizerCycle, runSingleApprovalPollingCycle } from "../../src/approvals/approvalWorker";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { CustomerAlertRecipient, PendingApprovalContextRow, WalletApprovalPollState } from "../../src/storage/repositories";
import { TronscanClient } from "../../src/tron/tronClient";
import type {
  AddressLabel,
  ApprovalAllowanceStateV2,
  RawEvidenceInput,
  RiskSignalObservationInput,
  WatchedWallet
} from "../../src/types";

const ownerAddress = "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ";
const spenderAddress = "TXka46PPwttNPWfFDPtt3GUodbPThyufaV";
const bridgersAddress = "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s";
const approvalTxHash = "aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";

const watchedWallet: WatchedWallet = {
  id: "wallet-1",
  telegramUserId: "123",
  telegramUsername: "client_user",
  address: ownerAddress,
  createdAt: new Date("2026-05-20T00:00:00.000Z"),
  alertMode: "realtime",
  digestIntervalMinutes: 10
};

function currentApproval(overrides: Partial<ReturnType<typeof currentApprovalBase>> = {}) {
  return { ...currentApprovalBase(), ...overrides };
}

function currentApprovalBase() {
  return {
    ownerAddress,
    spenderAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    operateTime: new Date("2026-05-09T10:34:00.000Z"),
    spenderIsContract: false as boolean | null,
    tokenSymbol: "USDT",
    tokenDecimals: 6
  };
}

function approvalChange(overrides: Partial<ReturnType<typeof approvalChangeBase>> = {}) {
  return { ...approvalChangeBase(), ...overrides };
}

function approvalChangeBase() {
  return {
    txHash: approvalTxHash,
    ownerAddress,
    spenderAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    timestamp: new Date("2026-05-06T19:06:15.000Z"),
    confirmed: true,
    contractRet: "SUCCESS"
  };
}

function contractMetadata(address = spenderAddress, tag: string | null = null) {
  return {
    address,
    name: tag ? tag.split(":")[0] : "tokenApprove",
    tag,
    isContract: true,
    verified: tag !== null,
    accountType: 2,
    source: "tronscan" as const,
    rawJson: {},
    fetchedAt: new Date("2026-05-23T00:00:00.000Z"),
    expiresAt: new Date("2026-05-24T00:00:00.000Z")
  };
}

function suspiciousContractProfile() {
  return {
    contractAddress: spenderAddress,
    providerTags: [],
    publicTags: [],
    isVerified: false,
    verifyStatus: 0,
    sourceStatus: null,
    contractCreatedAt: null,
    contractAgeDays: null,
    txCount: "2",
    recentCallCount: null,
    totalCallCount: null,
    totalCallerCount: null,
    rawPayload: {},
    fetchedAt: new Date("2026-05-23T00:00:00.000Z"),
    expiresAt: new Date("2026-05-24T00:00:00.000Z"),
    address: spenderAddress,
    source: "tronscan" as const,
    name: "tokenApprove",
    serviceTag: null,
    publicTag: null,
    publicTagDesc: null,
    tagUrl: null,
    verified: false,
    providerRisk: false,
    trxCount: "2",
    uniqueCallerCount: null,
    topMethods: [],
    topCallers: [],
    methodMap: {},
    hasTransferFromSelector: true,
    hasOwnerOnlyPattern: true,
    lowMetadata: true,
    activityLevel: "low" as const,
    rawJson: {}
  };
}

function verify20ContractProfile() {
  return {
    ...suspiciousContractProfile(),
    methodMap: {
      "5082dd12": "Verify20(address,address,address,uint256)",
      "fc61dd23": "Verify10(address,uint256)",
      "ea4418d9": "withdrawAllTrxTo(address)",
      "f2fde38b": "transferOwnership(address)"
    }
  };
}

function pendingContextRow(overrides: Partial<PendingApprovalContextRow> = {}): PendingApprovalContextRow {
  return {
    approvalTxHash,
    watchedWalletId: watchedWallet.id,
    ownerAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    spenderAddress,
    spenderType: "contract",
    amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    approvalAt: new Date("2026-05-05T13:42:21.000Z"),
    ownerAlertStatus: "sent",
    ownerAlertAttempts: 0,
    ownerAlertLastError: null,
    ownerAlertUpdatedAt: new Date("2026-05-05T13:42:22.000Z"),
    riskLevel: "HIGH",
    riskScore: 70,
    riskReasons: [{ code: "approval_context_pending", message: "Waiting up to 10 min for related swap/bridge route context", scoreImpact: 10 }],
    createdAt: new Date("2026-05-05T13:42:22.000Z"),
    contextStatus: "finalizing",
    contextDeadlineAt: new Date("2026-05-05T13:52:21.000Z"),
    contextResult: "unknown",
    initialRiskLevel: "HIGH",
    initialRiskScore: 70,
    initialRiskReasons: [{ code: "approval_context_pending", message: "Waiting up to 10 min for related swap/bridge route context", scoreImpact: 10 }],
    finalRiskLevel: null,
    finalRiskScore: null,
    finalRiskReasons: [],
    finalContextAlertSentAt: null,
    contextLastError: null,
    contextUpdatedAt: new Date("2026-05-05T13:52:22.000Z"),
    wallet: watchedWallet,
    ...overrides
  };
}

function directAllowanceDeps() {
  return {
    getUsdtAllowance: async () => currentApproval().amountRaw,
    saveWalletApprovalAllowanceStateV2: async () => {}
  };
}

function createDeps(overrides: Partial<Parameters<typeof runSingleApprovalPollingCycle>[0]> = {}) {
  const claimed = new Set<string>();
  const currentApprovals: unknown[] = [];
  const sentOwnerMessages: string[] = [];
  const sentOwnerOptions: Array<{ reply_markup?: unknown; parse_mode?: "HTML" } | undefined> = [];
  const sentCustomerMessages: Array<{ telegramUserId: string; message: string }> = [];
  const sentCustomerOptions: Array<{ reply_markup?: unknown; parse_mode?: "HTML" } | undefined> = [];
  const sentServiceAdminMessages: string[] = [];
  const sentServiceAdminOptions: Array<{ parse_mode?: "HTML" } | undefined> = [];
  const sentMarks: string[] = [];
  const skippedMarks: string[] = [];
  const failures: string[] = [];
  const drainObservations: unknown[] = [];
  const pollSuccesses: WalletApprovalPollState[] = [];
  const pollFailures: Array<{ watchedWalletId: string; error: string }> = [];
  const evidence: Array<{ rawEvidence: RawEvidenceInput[]; observations: RiskSignalObservationInput[] }> = [];
  const deps: Parameters<typeof runSingleApprovalPollingCycle>[0] = {
    wallets: [watchedWallet],
    tronClient: {
      async listTrc20Approvals() {
        return { approvals: [currentApproval()], total: 1 };
      },
      async listTrc20ApprovalChanges() {
        return [approvalChange()];
      }
    },
    getUsdtAllowance: async () => currentApproval().amountRaw,
    saveWalletApprovalAllowanceStateV2: async () => {},
    pageLimit: 20,
    maxPagesPerWallet: 1,
    now: () => new Date("2026-05-23T00:00:00.000Z"),
    getApprovalPollState: async () => null,
    recordApprovalPollSuccess: async (input) => {
      pollSuccesses.push({
        watchedWalletId: input.watchedWalletId,
        lastSeenApprovalTs: input.lastSeenApprovalTs,
        lastSeenTxHash: input.lastSeenTxHash,
        lastSuccessfulPollAt: input.lastSuccessfulPollAt,
        lastError: null,
        updatedAt: input.lastSuccessfulPollAt
      });
    },
    recordApprovalPollFailure: async (input) => {
      pollFailures.push(input);
    },
    upsertWalletApproval: async (approval) => {
      currentApprovals.push(approval);
    },
    claimObservedApprovalEvent: async (event): Promise<boolean> => {
      if (claimed.has(event.approvalTxHash)) return false;
      claimed.add(event.approvalTxHash);
      return true;
    },
    recordApprovalRisk: async () => true,
    claimObservedApprovalDrainEvent: async (observation) => {
      drainObservations.push(observation);
      return true;
    },
    markApprovalOwnerAlertSent: async ({ approvalTxHash }) => {
      sentMarks.push(approvalTxHash);
      return true;
    },
    markApprovalOwnerAlertSkipped: async ({ approvalTxHash }) => {
      skippedMarks.push(approvalTxHash);
      return true;
    },
    markApprovalOwnerAlertFailed: async ({ error }) => {
      failures.push(error);
      return true;
    },
    getLabelsForAddress: async () => [],
    getAddressMetadata: async () => null,
    upsertAddressMetadata: async () => {},
    recordRiskEvaluation: async (evaluation) => {
      evidence.push(evaluation);
    },
    listCustomerAlertRecipients: async () => [],
    sendUserAlert: async (_telegramUserId, message, options) => {
      sentOwnerMessages.push(message);
      sentOwnerOptions.push(options);
    },
    sendCustomerAdminAlert: async (telegramUserId, message, options) => {
      sentCustomerMessages.push({ telegramUserId, message });
      sentCustomerOptions.push(options);
    },
    sendAdminAlert: async (message, options) => {
      sentServiceAdminMessages.push(message);
      sentServiceAdminOptions.push(options);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides
  };

  return {
    deps,
    currentApprovals,
    sentOwnerMessages,
    sentOwnerOptions,
    sentCustomerMessages,
    sentCustomerOptions,
    sentServiceAdminMessages,
    sentServiceAdminOptions,
    sentMarks,
    skippedMarks,
    failures,
    drainObservations,
    pollSuccesses,
    pollFailures,
    evidence
  };
}

describe("runSingleApprovalPollingCycle", () => {
  it.each([
    { label: "exact causal session on a short clean page", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "short-clean", expectedScore: 10, expectedLevel: "LOW" },
    { label: "exact registry session without provider metadata", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "short-clean", metadataAvailable: false, expectedScore: 10, expectedLevel: "LOW" },
    { label: "registry without exact session or provider metadata", decodedAmountRaw: "91103008", receipt: true, strictPageMode: "short-clean", metadataAvailable: false, expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "short page with larger authoritative total", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "short-total-larger", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "short page ending at authoritative total", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "short-total-equal", expectedScore: 10, expectedLevel: "LOW" },
    { label: "short page with contradictory total", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "short-total-contradictory", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "short page with invalid total", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "short-total-invalid", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "amount mismatch", decodedAmountRaw: "91103008", receipt: true, expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "missing explicit receipt", decodedAmountRaw: "91103009", receipt: undefined, expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "false explicit receipt", decodedAmountRaw: "91103009", receipt: false, expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "intervening revoke", decodedAmountRaw: "91103009", receipt: true, interveningAmountRaw: "0", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "intervening reapproval", decodedAmountRaw: "91103009", receipt: true, interveningAmountRaw: "1000000", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "same-timestamp different approval", decodedAmountRaw: "91103009", receipt: true, interveningAmountRaw: "1000000", interveningOffsetMs: 0, expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "incomplete approval-change page", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "short-clean", lookupLimit: 1, expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "full raw page with one malformed row", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "full-malformed", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "full clean page without total", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "full-no-total", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "total-proven clean final page", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "full-total", expectedScore: 10, expectedLevel: "LOW" },
    { label: "strict page with missing metadata", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "missing-metadata", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "missing strict page API", decodedAmountRaw: "91103009", receipt: true, strictPageMode: "unavailable", expectedScore: 45, expectedLevel: "MEDIUM" }
  ] as const)("uses authoritative Bridgers session only for $label", async ({ decodedAmountRaw, receipt, interveningAmountRaw, interveningOffsetMs, strictPageMode, metadataAvailable, lookupLimit, expectedScore, expectedLevel }) => {
    const actionTxHash = "c16e27c144732bee70de72c88f5e3e501ac2bd5bbcdad66f6edac5b66cd31743";
    const approvalAt = new Date("2026-05-06T19:06:15.000Z");
    const approval = currentApproval({ spenderAddress: bridgersAddress, spenderIsContract: true });
    const change = approvalChange({ spenderAddress: bridgersAddress, timestamp: approvalAt });
    const intervening = interveningAmountRaw === undefined ? null : approvalChange({
      txHash: "bb4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2",
      spenderAddress: bridgersAddress,
      amountRaw: interveningAmountRaw,
      isUnlimited: false,
      timestamp: new Date(approvalAt.getTime() + (interveningOffsetMs ?? 30_000))
    });
    const approvalChanges = intervening ? [intervening, change] : [change];
    const strictApprovalPage = (limit: number) => {
      if (strictPageMode === "missing-metadata") {
        return { changes: approvalChanges, rawCount: undefined as unknown as number, malformedCount: 0, total: null };
      }
      if (["short-total-larger", "short-total-equal", "short-total-contradictory", "short-total-invalid"].includes(strictPageMode ?? "")) {
        return {
          changes: approvalChanges,
          rawCount: approvalChanges.length,
          malformedCount: 0,
          total: strictPageMode === "short-total-larger"
            ? 50
            : strictPageMode === "short-total-contradictory"
              ? 0
              : strictPageMode === "short-total-invalid"
                ? -1
                : approvalChanges.length
        };
      }
      if (strictPageMode !== "full-malformed" && strictPageMode !== "full-no-total" && strictPageMode !== "full-total") {
        return { changes: approvalChanges, rawCount: approvalChanges.length, malformedCount: 0, total: null };
      }
      const parsedCount = strictPageMode === "full-malformed" ? limit - 1 : limit;
      const older = Array.from({ length: Math.max(0, parsedCount - approvalChanges.length) }, (_, index) => approvalChange({
        txHash: (index + 1).toString(16).padStart(64, "0"),
        spenderAddress: bridgersAddress,
        timestamp: new Date(approvalAt.getTime() - (index + 1) * 1_000)
      }));
      return {
        changes: [...approvalChanges, ...older],
        rawCount: limit,
        malformedCount: strictPageMode === "full-malformed" ? 1 : 0,
        total: strictPageMode === "full-total" ? limit : null
      };
    };
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [approval], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return approvalChanges;
        },
        ...(strictPageMode === "unavailable" ? {} : {
          async listTrc20ApprovalChangePageStrict(input: { limit?: number }) {
            return strictApprovalPage(input.limit ?? 20);
          }
        }),
        async listRelatedTrc20Transfers() {
          return [{
            transaction_id: actionTxHash,
            from_address: ownerAddress,
            to_address: bridgersAddress,
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            quant: "91103009",
            confirmed: true,
            contractRet: "SUCCESS",
            finalResult: "SUCCESS",
            status: 0,
            tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
            block_ts: approvalAt.getTime() + 66_000
          }];
        },
        async getTransaction() {
          return {
            ownerAddress,
            contractRet: "SUCCESS",
            finalResult: "SUCCESS",
            ...(receipt === undefined ? {} : { receipt: { success: receipt } }),
            trigger_info: { methodName: "swap", parameter: { amount: decodedAmountRaw } },
            contractData: { owner_address: ownerAddress, amount: decodedAmountRaw }
          };
        }
      },
      getUsdtAllowance: async () => approval.amountRaw,
      approvalChangeLookupLimit: lookupLimit,
      targetApprovalTxHash: intervening ? approvalTxHash : undefined,
      getAddressMetadata: async (address) => metadataAvailable !== false && address === bridgersAddress
        ? contractMetadata(bridgersAddress, "Bridgers:Cross-chain Bridge")
        : null
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals.at(-1)).toMatchObject({
      spenderAddress: bridgersAddress,
      riskLevel: expectedLevel,
      riskScore: expectedScore
    });
    expect(ctx.evidence.at(-1)?.rawEvidence[0]?.evidenceJson.approvalSafetyAssessmentV2).toMatchObject({
      level: expectedLevel,
      score: expectedScore,
      action: "REVOKE_IF_UNUSED",
      amlScoreImpact: 0,
      serviceSession: expectedScore === 10 ? expect.objectContaining({ actionTxHash, amountContinuity: "exact" }) : null
    });
    expect(ctx.sentOwnerMessages.at(-1)).toMatch(/Проверяемый кошел[её]к — кошел[её]к, который выдал доступ к USDT/);
    expect(ctx.sentOwnerMessages.at(-1)).toContain("Контракт, получивший доступ к USDT");
    expect(ctx.sentOwnerMessages.at(-1)).toMatch(/Разрешение на управление USDT сейчас: активное, безлимитное/);
    expect(ctx.sentOwnerMessages.at(-1)).not.toMatch(/Истекает|Дедлайн контекста|expiration/i);
    expect(JSON.stringify(ctx.sentOwnerOptions.at(-1)?.reply_markup)).not.toMatch(/callback_data|revoke|отозв/i);
    if (metadataAvailable === false) {
      const sessionEvidence = ctx.evidence.at(-1)?.rawEvidence.find((item) => item.source === "approval_session_context");
      expect(sessionEvidence?.evidenceJson).toMatchObject({
        classification: expectedScore === 10 ? "known_swap_route" : "no_route_found",
        linkedRouteTxHash: expectedScore === 10 ? actionTxHash : null,
        routeServiceTags: expectedScore === 10 ? ["bridgers"] : []
      });
    }
  });

  it("[REQ-18][AC-24][TASK7-WORKER-PRESENTATION] keeps a failed direct allowance check unconfirmed", async () => {
    const approval = currentApproval({ spenderAddress: bridgersAddress, spenderIsContract: true });
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [approval], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange({ spenderAddress: bridgersAddress })];
        }
      },
      getUsdtAllowance: async () => {
        throw new Error("provider unavailable");
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toMatch(/подтвердить не удалось|нельзя считать его активным или отозванным/i);
    expect(ctx.sentOwnerMessages[0]).not.toMatch(/сейчас: активное|сейчас: 0 USDT|разрешение больше не активно/i);
    expect(JSON.stringify(ctx.sentOwnerOptions[0]?.reply_markup)).not.toMatch(/callback_data|revoke|отозв/i);
  });

  it("[REQ-20][AC-21][TASK7-VERIFY20-NO-DEBIT] presents exact Verify20 without claiming a debit", async () => {
    const presentations: unknown[] = [];
    const ctx = createDeps({
      getAddressMetadata: async () => contractMetadata(),
      getContractIntelligenceProfile: async () => verify20ContractProfile(),
      onApprovalPresentation: async (presentation) => {
        presentations.push(presentation);
      },
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async listRelatedTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {};
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({ riskLevel: "HIGH", riskScore: 70 });
    expect(ctx.sentOwnerMessages[0]).toContain("🔴 <b>90/100 — критический риск для кошелька</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("точный Verify20-шаблон массовых списаний");
    expect(ctx.sentOwnerMessages[0]).toContain("Фактическое списание через этот контракт: не найдено");
    expect(ctx.sentOwnerMessages[0]).not.toMatch(/деньги уже украдены|кража подтверждена/i);
    expect(ctx.sentOwnerMessages[0]).not.toMatch(/баланс.*USDT|BTTOLD|кампан/i);
    expect(presentations).toEqual([
      expect.objectContaining({
        assessment: expect.objectContaining({ exactVerify20: true, exactDebit: false, score: 90 }),
        exactDebitProfile: null,
        evaluatedAt: new Date("2026-05-23T00:00:00.000Z")
      })
    ]);
  });

  it("[REQ-20][AC-20][TASK7-VERIFY20-BALANCE] shows a subject-bound official-USDT balance without changing stored risk", async () => {
    const balanceRequests: Array<{ watchedWalletId: string; ownerAddress: string; signal: AbortSignal }> = [];
    const presentations: Array<Parameters<NonNullable<Parameters<typeof runSingleApprovalPollingCycle>[0]["onApprovalPresentation"]>>[0]> = [];
    const ctx = createDeps({
      getAddressMetadata: async () => contractMetadata(),
      getContractIntelligenceProfile: async () => ({
        ...verify20ContractProfile(),
        totalCallCount: "999",
        totalCallerCount: "241",
        uniqueCallerCount: "241",
        topMethods: [{
          methodId: "5082dd12",
          signature: "Verify20(address,address,address,uint256)",
          count: 309,
          ratio: 0.31
        }]
      }),
      getApprovalPresentationBalance: async (request) => {
        balanceRequests.push(request);
        return {
          subjectAddress: request.ownerAddress,
          tokenContract: TRON_USDT_CONTRACT_ADDRESS,
          balanceRaw: "4084665000",
          checkedAt: new Date("2026-05-23T00:00:00.000Z"),
          source: "official_usdt_balanceOf"
        };
      },
      onApprovalPresentation: async (presentation) => {
        presentations.push(presentation);
      },
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async listRelatedTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {};
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(balanceRequests).toEqual([
      expect.objectContaining({ watchedWalletId: watchedWallet.id, ownerAddress, signal: expect.any(AbortSignal) })
    ]);
    expect(ctx.currentApprovals[0]).toMatchObject({ riskLevel: "HIGH", riskScore: 70 });
    expect(ctx.sentOwnerMessages[0]).toContain("Контракту доступен текущий баланс: 4 084,665 USDT");
    expect(ctx.sentOwnerMessages[0]).toContain("Контекст кампании: 309 Verify20-вызовов.");
    expect(ctx.sentOwnerMessages[0]).not.toContain("241 кошельков-источников");
    expect(ctx.sentOwnerMessages[0]).not.toContain("BTTOLD");
    expect(presentations[0]?.campaignContext).toMatchObject({
      ownerAddress,
      spenderAddress,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      approvalTxHash,
      verify20CallCount: 309,
      sourceWalletCount: null,
      bttoldEvidenceId: null
    });
    expect(JSON.stringify(ctx.evidence)).not.toContain("4084665000");
    expect(JSON.stringify(ctx.evidence)).not.toContain("official_usdt_balanceOf");
    expect(JSON.stringify(ctx.evidence)).not.toContain("campaignContext");
  });

  it("[REQ-20][AC-20][TASK7-VERIFY20-BALANCE-TIMEOUT] aborts one slow balance read without retrying or blocking the alert", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const ctx = createDeps({
        getAddressMetadata: async () => contractMetadata(),
        getContractIntelligenceProfile: async () => verify20ContractProfile(),
        getApprovalPresentationBalance: ({ signal }) => new Promise((_resolve, reject) => {
          calls += 1;
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        }),
        tronClient: {
          async listTrc20Approvals() {
            return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
          },
          async listTrc20ApprovalChanges() {
            return [approvalChange()];
          },
          async listRelatedTrc20Transfers() {
            return [];
          },
          async getTransaction() {
            return {};
          }
        }
      });

      const cycle = runSingleApprovalPollingCycle(ctx.deps);
      await vi.advanceTimersByTimeAsync(2_500);
      await cycle;

      expect(calls).toBe(1);
      expect(ctx.sentOwnerMessages).toHaveLength(1);
      expect(ctx.sentOwnerMessages[0]).not.toContain("доступен текущий баланс");
    } finally {
      vi.useRealTimers();
    }
  });

  it("[REQ-20][AC-20][TASK7-VERIFY20-BALANCE-BINDING] omits foreign or unavailable balance evidence", async () => {
    const providers: Array<NonNullable<Parameters<typeof runSingleApprovalPollingCycle>[0]["getApprovalPresentationBalance"]>> = [
      async () => ({
        subjectAddress: "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD",
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        balanceRaw: "4084665000",
        checkedAt: new Date("2026-05-23T00:00:00.000Z"),
        source: "official_usdt_balanceOf" as const
      }),
      async () => ({
        subjectAddress: ownerAddress,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        balanceRaw: "4084665000",
        checkedAt: new Date("2026-05-22T23:58:59.999Z"),
        source: "official_usdt_balanceOf" as const
      }),
      async () => ({
        subjectAddress: ownerAddress,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        balanceRaw: "not-a-uint",
        checkedAt: new Date("2026-05-23T00:00:00.000Z"),
        source: "official_usdt_balanceOf" as const
      }),
      async () => {
        throw new Error("balance provider unavailable");
      }
    ];

    for (const getApprovalPresentationBalance of providers) {
      const ctx = createDeps({
        getAddressMetadata: async () => contractMetadata(),
        getContractIntelligenceProfile: async () => verify20ContractProfile(),
        getApprovalPresentationBalance,
        tronClient: {
          async listTrc20Approvals() {
            return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
          },
          async listTrc20ApprovalChanges() {
            return [approvalChange()];
          },
          async listRelatedTrc20Transfers() {
            return [];
          },
          async getTransaction() {
            return {};
          }
        }
      });

      await runSingleApprovalPollingCycle(ctx.deps);

      expect(ctx.sentOwnerMessages[0]).not.toMatch(/доступен текущий баланс/i);
      expect(ctx.sentOwnerMessages[0]).toContain("Фактическое списание через этот контракт: не найдено");
    }
  });

  it("[REQ-20][AC-21][TASK7-VERIFY20-CAMPAIGN-BINDING] omits call counts from a foreign contract profile", async () => {
    const foreignContract = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
    const ctx = createDeps({
      getAddressMetadata: async () => contractMetadata(),
      getContractIntelligenceProfile: async () => ({
        ...verify20ContractProfile(),
        contractAddress: foreignContract,
        address: foreignContract,
        topMethods: [{
          methodId: "5082dd12",
          signature: "Verify20(address,address,address,uint256)",
          count: 309,
          ratio: 1
        }]
      }),
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async listRelatedTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {};
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.sentOwnerMessages[0]).not.toMatch(/Контекст кампании|BTTOLD/);
  });

  it("[REQ-20][AC-21][TASK7-VERIFY20-CAMPAIGN-SELECTOR] rejects a Verify20 label on the wrong selector", async () => {
    const ctx = createDeps({
      getAddressMetadata: async () => contractMetadata(),
      getContractIntelligenceProfile: async () => ({
        ...verify20ContractProfile(),
        topMethods: [{
          methodId: "deadbeef",
          signature: "Verify20(address,address,address,uint256)",
          count: 309,
          ratio: 1
        }]
      }),
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async listRelatedTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {};
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.sentOwnerMessages[0]).toContain("точный Verify20-шаблон");
    expect(ctx.sentOwnerMessages[0]).not.toMatch(/Контекст кампании|BTTOLD/);
  });

  it("[REQ-20][AC-20][TASK7-VERIFY20-BALANCE-SCOPE] does not request a balance for a non-Verify20 approval", async () => {
    const getApprovalPresentationBalance = vi.fn();
    const ctx = createDeps({ getApprovalPresentationBalance });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(getApprovalPresentationBalance).not.toHaveBeenCalled();
  });

  it("[REQ-20][AC-21][TASK7-VERIFY20-EXACT-DEBIT] presents a subject-bound exact debit without changing stored risk", async () => {
    const receiverAddress = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
    const drainTxHash = "b".repeat(64);
    let relatedCalls = 0;
    const ctx = createDeps({
      getAddressMetadata: async (address) => address === spenderAddress
        ? contractMetadata()
        : { ...contractMetadata(address), name: null, tag: null, isContract: false, verified: null, accountType: 0 },
      getContractIntelligenceProfile: async () => verify20ContractProfile(),
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async listRelatedTrc20Transfers() {
          relatedCalls += 1;
          if (relatedCalls === 1) return [];
          return [{
            transaction_id: drainTxHash,
            from_address: ownerAddress,
            to_address: receiverAddress,
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            quant: "13302000000",
            confirmed: true,
            contractRet: "SUCCESS",
            finalResult: "SUCCESS",
            status: 0,
            tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
            block_ts: Date.parse("2026-05-09T10:13:12.000Z")
          }];
        },
        async getTransaction() {
          return {
            ownerAddress: spenderAddress,
            trigger_info: { methodName: "transferFrom", methodId: "23b872dd" },
            contractData: { owner_address: spenderAddress }
          };
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({ riskLevel: "HIGH", riskScore: 70 });
    expect(ctx.drainObservations[0]).toMatchObject({ transferTxHash: drainTxHash, receiverAddress, amountRaw: "13302000000" });
    expect(ctx.sentOwnerMessages[0]).toContain("🔴 <b>95/100 — критический риск для кошелька</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("Фактическое списание через этот контракт: подтверждено, 13 302 USDT");
    expect(ctx.sentOwnerMessages[0]).toContain("точная Verify20-цепочка и списание USDT");
    expect(ctx.sentOwnerMessages[0]).not.toMatch(/деньги уже украдены|кража подтверждена/i);
  });

  it("skips stale watched wallets that were removed after the cycle loaded", async () => {
    const warnings: string[] = [];
    let approvalCalls = 0;
    const ctx = createDeps({
      isWatchedWalletActive: async () => false,
      tronClient: {
        async listTrc20Approvals() {
          approvalCalls += 1;
          return { approvals: [currentApproval()], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        }
      },
      logger: {
        info: () => {},
        warn: (message) => {
          warnings.push(message);
        },
        error: () => {}
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(approvalCalls).toBe(0);
    expect(ctx.pollSuccesses).toEqual([]);
    expect(ctx.pollFailures).toEqual([]);
    expect(warnings).toContain("approval_poll_skipped_stale_wallet");
  });

  it("stores approval state, evidence, sends one HIGH alert, and advances approval cursor", async () => {
    const ctx = createDeps();

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({
      watchedWalletId: watchedWallet.id,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      spenderAddress,
      isUnlimited: true,
      riskLevel: "HIGH",
      riskScore: 80
    });
    expect(ctx.evidence[0].observations.map((observation) => observation.signalGroup)).toEqual(["approval", "approval"]);
    expect(ctx.evidence[0].rawEvidence[0]?.evidenceJson.approvalMonitoringState).toBe("approval_only");
    expect(ctx.evidence[0].observations[0]?.message).toContain("approval monitoring state: approval_only");
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("Проверка доступа к USDT");
    expect(ctx.sentOwnerMessages[0]).toContain("Разрешение на управление USDT сейчас: активное, безлимитное");
    expect(ctx.sentOwnerMessages[0]).toContain("Текущий риск для кошелька не рассчитан");
    expect(ctx.sentOwnerMessages[0]).not.toContain("завершился ошибкой");
    expect(ctx.sentOwnerOptions[0]?.parse_mode).toBe("HTML");
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
    expect(ctx.pollSuccesses.at(-1)).toMatchObject({
      watchedWalletId: watchedWallet.id,
      lastSeenTxHash: approvalTxHash,
      lastSeenApprovalTs: new Date("2026-05-06T19:06:15.000Z")
    });
  });

  it("stores shadow approval-drain observations when spender called USDT transferFrom", async () => {
    const receiverAddress = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
    const drainTxHash = "a944c454b019c6fdbb686f29609b08fbc378f1dee20ecd772a8417b1f7f6452b";
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval()], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async listRelatedTrc20Transfers() {
          return [
            {
              transaction_id: drainTxHash,
              from_address: ownerAddress,
              to_address: receiverAddress,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              quant: "320652450320",
              confirmed: true,
              contractRet: "SUCCESS",
              finalResult: "SUCCESS",
              status: 0,
              tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
              trigger_info: { methodName: "transferFrom" },
              block_ts: Date.parse("2026-05-09T10:13:12.000Z")
            }
          ];
        },
        async getTransaction() {
          return {
            ownerAddress: spenderAddress,
            trigger_info: { methodName: "transferFrom", methodId: "23b872dd" },
            contractData: { owner_address: spenderAddress }
          };
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.drainObservations[0]).toMatchObject({
      watchedWalletId: watchedWallet.id,
      approvalTxHash,
      transferTxHash: drainTxHash,
      ownerAddress,
      spenderAddress,
      receiverAddress,
      method: "transferFrom",
      report: {
        level: "CRITICAL",
        score: 95
      }
    });
    expect(ctx.evidence.at(-1)?.observations.map((observation) => observation.code)).toContain("approval_transferfrom_observed");
    expect(ctx.evidence.at(-1)?.rawEvidence[0]?.evidenceJson.approvalMonitoringState).toBe("transfer_from_observed");
    expect(ctx.evidence.at(-1)?.observations[0]?.message).toContain("approval monitoring state: transfer_from_observed");
    expect(ctx.sentOwnerMessages).toHaveLength(1);
  });

  it("keeps Bridgers-like transferFrom observations in shadow mode without auto-critical alerting", async () => {
    const receiverAddress = "TBridgeVault1111111111111111111111111";
    const drainTxHash = "service-transferfrom-tx";
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: null })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async getAddressMetadata(address: string) {
          if (address === spenderAddress) {
            return {
              address,
              name: "Bridgers",
              tag: "Bridgers:Cross-chain Bridge",
              isContract: true,
              verified: true,
              accountType: 2,
              source: "tronscan" as const,
              rawJson: {
                contractSearch: {
                  name: "Bridgers",
                  tag: "Bridgers:Cross-chain Bridge",
                  risk: false,
                  verifyStatus: true,
                  dateCreated: 1721486160000
                }
              }
            };
          }
          return {
            address,
            name: null,
            tag: null,
            isContract: false,
            verified: null,
            accountType: 0,
            source: "tronscan" as const,
            rawJson: {}
          };
        },
        async listRelatedTrc20Transfers() {
          return [
            {
              transaction_id: drainTxHash,
              from_address: ownerAddress,
              to_address: receiverAddress,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              quant: "320652450320",
              confirmed: true,
              contractRet: "SUCCESS",
              finalResult: "SUCCESS",
              status: 0,
              tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
              trigger_info: { methodName: "transferFrom" },
              block_ts: Date.parse("2026-05-09T10:13:12.000Z")
            }
          ];
        },
        async getTransaction() {
          return {
            ownerAddress: spenderAddress,
            trigger_info: { methodName: "transferFrom", methodId: "23b872dd" },
            contractData: { owner_address: spenderAddress }
          };
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({ riskLevel: "MEDIUM", riskScore: 35 });
    expect(ctx.drainObservations[0]).toMatchObject({
      transferTxHash: drainTxHash,
      report: {
        level: "MEDIUM",
        score: 50
      }
    });
    expect(ctx.evidence.at(-1)?.observations.map((observation) => observation.code)).toContain("approval_drain_service_spender");
    expect(ctx.evidence.at(-1)?.rawEvidence[0]?.evidenceJson.approvalMonitoringState).toBe("service_route_guarded");
    expect(ctx.evidence.at(-1)?.observations[0]?.message).toContain("approval monitoring state: service_route_guarded");
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("🟡 <b>35/100 — средний риск для кошелька</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("Фактическое списание через этот контракт: не найдено");
    expect(ctx.sentServiceAdminMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
    expect(ctx.skippedMarks).toEqual([]);
  });

  it("does not dampen scammy service-like names without provider service tags", async () => {
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: null })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async getAddressMetadata() {
          return {
            address: spenderAddress,
            name: "SwapTRX",
            tag: null,
            isContract: true,
            verified: false,
            accountType: 2,
            source: "tronscan" as const,
            rawJson: {
              contractSearch: {
                name: "SwapTRX",
                tag: null,
                risk: false,
                verifyStatus: false,
                dateCreated: 1765614543000
              }
            }
          };
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({
      spenderType: "contract",
      riskLevel: "MEDIUM",
      riskScore: 35
    });
    expect(ctx.currentApprovals[0]).not.toMatchObject({
      riskLevel: "LOW",
      riskScore: 10
    });
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("🟡 <b>35/100 — средний риск для кошелька</b>");
    expect(ctx.sentServiceAdminMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
    expect(ctx.skippedMarks).toEqual([]);
  });

  it("keeps TronScan service metadata at MEDIUM without an exact service session", async () => {
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: null })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async getAddressMetadata() {
          return {
            address: spenderAddress,
            name: "Bridgers",
            tag: "Bridgers:Cross-chain Bridge",
            isContract: true,
            verified: true,
            accountType: 2,
            source: "tronscan" as const,
            rawJson: {
              name: "Bridgers",
              tag: "Bridgers:Cross-chain Bridge",
              accountType: 2,
              contractSearch: {
                name: "Bridgers",
                tag: "Bridgers:Cross-chain Bridge",
                risk: false,
                verifyStatus: true,
                dateCreated: 1721486160000
              }
            }
          };
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({
      spenderType: "contract",
      riskLevel: "MEDIUM",
      riskScore: 35
    });
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("🟡 <b>35/100 — средний риск для кошелька</b>");
    expect(ctx.sentServiceAdminMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
    expect(ctx.skippedMarks).toEqual([]);
  });

  it("sends LOW approval alerts to configured customer admins", async () => {
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: null })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async getAddressMetadata() {
          return {
            address: spenderAddress,
            name: "Bridgers",
            tag: "Bridgers:Cross-chain Bridge",
            isContract: true,
            verified: true,
            accountType: 2,
            source: "tronscan" as const,
            rawJson: {
              contractSearch: {
                name: "Bridgers",
                tag: "Bridgers:Cross-chain Bridge",
                risk: false,
                verifyStatus: true
              }
            }
          };
        }
      },
      listCustomerAlertRecipients: async (): Promise<CustomerAlertRecipient[]> => [
        {
          ownerTelegramUserId: watchedWallet.telegramUserId,
          recipientTelegramUserId: "777",
          alertMode: "suspicious_only",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentCustomerOptions[0]?.parse_mode).toBe("HTML");
    expect(ctx.sentCustomerMessages).toEqual([
      expect.objectContaining({
        telegramUserId: "777",
        message: expect.stringContaining("35/100 — средний риск для кошелька")
      })
    ]);
  });

  it("does not dampen tokenApprove-like approvals from an inexact nearby route", async () => {
    const routeTxHash = "route-tx";
    const routeReceiver = "TUrnbc11111111111111111111111111111";
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: null })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange({ timestamp: new Date("2026-05-05T13:42:21.000Z") })];
        },
        async getAddressMetadata(address: string) {
          if (address === spenderAddress) {
            return {
              address,
              name: "tokenApprove",
              tag: null,
              isContract: true,
              verified: true,
              accountType: 2,
              source: "tronscan" as const,
              rawJson: { contractSearch: { name: "tokenApprove", risk: false, verifyStatus: false } }
            };
          }
          return {
            address,
            name: "UniV3Adapter",
            tag: "SunSwap Router",
            isContract: true,
            verified: true,
            accountType: 2,
            source: "tronscan" as const,
            rawJson: {}
          };
        },
        async getContractIntelligenceProfile() {
          return {
            contractAddress: spenderAddress,
            providerTags: [],
            publicTags: [],
            isVerified: false,
            verifyStatus: 0,
            sourceStatus: null,
            contractCreatedAt: null,
            contractAgeDays: null,
            txCount: "2",
            recentCallCount: null,
            totalCallCount: null,
            totalCallerCount: null,
            rawPayload: {},
            fetchedAt: new Date(),
            expiresAt: new Date(),
            address: spenderAddress,
            source: "tronscan" as const,
            name: "tokenApprove",
            serviceTag: null,
            publicTag: null,
            publicTagDesc: null,
            tagUrl: null,
            verified: false,
            providerRisk: false,
            trxCount: "2",
            uniqueCallerCount: null,
            topMethods: [],
            topCallers: [],
            methodMap: {},
            hasTransferFromSelector: true,
            hasOwnerOnlyPattern: true,
            lowMetadata: true,
            activityLevel: "low" as const,
            rawJson: {}
          };
        },
        async listRelatedTrc20Transfers() {
          return [
            {
              transaction_id: routeTxHash,
              from_address: ownerAddress,
              to_address: routeReceiver,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              quant: "100000000",
              confirmed: true,
              contractRet: "SUCCESS",
              finalResult: "SUCCESS",
              status: 0,
              tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
              block_ts: Date.parse("2026-05-05T13:42:27.000Z")
            }
          ];
        },
        async getTransaction(txHash: string) {
          if (txHash === routeTxHash) {
            return {
              ownerAddress,
              trigger_info: { methodName: "swap", methodId: "swap" },
              contractData: { owner_address: ownerAddress }
            };
          }
          return { ownerAddress: spenderAddress, trigger_info: { methodName: "transferFrom", methodId: "23b872dd" } };
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({
      spenderType: "contract",
      riskLevel: "HIGH",
      riskScore: 70
    });
    expect(ctx.evidence.flatMap((entry) => entry.observations.map((observation) => observation.code))).toContain(
      "approval_temporally_linked_to_known_swap"
    );
    expect(ctx.sentOwnerMessages[0]).toContain("🟡 <b>35/100 — средний риск для кошелька</b>");
  });

  it("sends initial pending context alert for a fresh unknown helper contract without resolving session immediately", async () => {
    let relatedTransferCalls = 0;
    const pendingContexts: unknown[] = [];
    const ctx = createDeps({
      now: () => new Date("2026-05-05T13:43:00.000Z"),
      markApprovalContextPending: async (input) => {
        pendingContexts.push(input);
        return true;
      },
      getAddressMetadata: async () => contractMetadata(),
      getContractIntelligenceProfile: async () => suspiciousContractProfile(),
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange({ timestamp: new Date("2026-05-05T13:42:21.000Z") })];
        },
        async listRelatedTrc20Transfers() {
          relatedTransferCalls += 1;
          return [];
        },
        async getTransaction() {
          return {};
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(relatedTransferCalls).toBe(0);
    expect(pendingContexts[0]).toMatchObject({
      approvalTxHash,
      watchedWalletId: watchedWallet.id,
      initialReport: {
        level: "HIGH",
        score: 70
      }
    });
    expect(ctx.currentApprovals[0]).toMatchObject({
      spenderType: "contract",
      riskLevel: "HIGH",
      riskScore: 70
    });
    expect(ctx.sentOwnerMessages[0]).toContain("Проверка доступа к USDT");
    expect(ctx.sentOwnerMessages[0]).toContain("🟡 <b>35/100 — средний риск для кошелька</b>");
    expect(ctx.sentOwnerMessages[0]).not.toMatch(/Истекает|Дедлайн контекста|expiration/i);
  });

  it("does not pend direct service-tagged approvals", async () => {
    const pendingContexts: unknown[] = [];
    const ctx = createDeps({
      now: () => new Date("2026-05-05T13:43:00.000Z"),
      markApprovalContextPending: async (input) => {
        pendingContexts.push(input);
        return true;
      },
      getAddressMetadata: async () => contractMetadata(spenderAddress, "Bridgers:Cross-chain Bridge"),
      getContractIntelligenceProfile: async () => ({
        ...suspiciousContractProfile(),
        providerTags: [{ kind: "blueTag", label: "Bridgers:Cross-chain Bridge", url: "https://bridgers.xyz" }],
        serviceTag: "Bridgers:Cross-chain Bridge",
        activityLevel: "high" as const
      }),
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval({ spenderIsContract: true })], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange({ timestamp: new Date("2026-05-05T13:42:21.000Z") })];
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(pendingContexts).toEqual([]);
    expect(ctx.sentOwnerMessages[0]).toContain("Проверка доступа к USDT");
    expect(ctx.sentOwnerMessages[0]).not.toContain("ждём контекст операции");
  });

  it("escalates delayed signed unlimited EOA approvals to CRITICAL", async () => {
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval()], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async getTransactionSigningMetadata() {
          return {
            txHash: approvalTxHash,
            signedAt: new Date("2026-05-04T15:06:28.559Z"),
            expirationAt: new Date("2026-05-06T21:07:27.000Z"),
            refBlockBytes: "85bd",
            refBlockHash: "37b6a33ffa9ea697"
          };
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({
      spenderType: "eoa",
      riskLevel: "CRITICAL",
      riskScore: 90
    });
    expect(ctx.sentOwnerMessages[0]).toContain("Текущий риск для кошелька не рассчитан");
    expect(ctx.sentOwnerMessages[0]).toContain("Разрешение на управление USDT сейчас: активное, безлимитное");
    expect(ctx.sentOwnerMessages[0]).not.toMatch(/Истекает|expiration|signed long before/i);
  });

  it("does not duplicate alerts when the approval event is already claimed", async () => {
    const ctx = createDeps({
      claimObservedApprovalEvent: async () => false
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.sentOwnerMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([]);
  });

  it("does not fetch session context for already claimed approvals during normal polling", async () => {
    let relatedTransferCalls = 0;
    const ctx = createDeps({
      claimObservedApprovalEvent: async () => false,
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [currentApproval()], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [approvalChange()];
        },
        async listRelatedTrc20Transfers() {
          relatedTransferCalls += 1;
          return [];
        },
        async getTransaction() {
          return {};
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(relatedTransferCalls).toBe(0);
    expect(ctx.sentOwnerMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([]);
  });

  it("marks a claimed approval failed when post-claim enrichment throws", async () => {
    const ctx = createDeps({
      getLabelsForAddress: async () => {
        throw new Error("label store unavailable");
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.failures).toEqual(["label store unavailable"]);
    expect(ctx.sentOwnerMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([]);
    expect(ctx.pollFailures[0]?.error).toContain("label store unavailable");
  });

  it("respects paused mode for owner and customer alerts while keeping service admin alert", async () => {
    const pausedWallet = { ...watchedWallet, alertMode: "paused" as const };
    const ctx = createDeps({
      wallets: [pausedWallet],
      listCustomerAlertRecipients: async (): Promise<CustomerAlertRecipient[]> => [
        {
          ownerTelegramUserId: pausedWallet.telegramUserId,
          recipientTelegramUserId: "777",
          alertMode: "all",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.sentOwnerMessages).toEqual([]);
    expect(ctx.sentCustomerMessages).toEqual([]);
    expect(ctx.skippedMarks).toEqual([approvalTxHash]);
    expect(ctx.sentServiceAdminMessages).toHaveLength(1);
    expect(ctx.sentServiceAdminOptions[0]?.parse_mode).toBe("HTML");
  });

  it("does not advance approval cursor on TronScan failure", async () => {
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          throw new Error("TronScan down");
        },
        async listTrc20ApprovalChanges() {
          return [];
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.pollSuccesses).toEqual([]);
    expect(ctx.pollFailures).toEqual([{ watchedWalletId: watchedWallet.id, error: "TronScan down" }]);
  });

  it("keeps service-admin alert failures non-blocking", async () => {
    const ctx = createDeps({
      sendAdminAlert: async () => {
        throw new Error("admin blocked bot");
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
  });

  it("sends MEDIUM finite approval alerts to owner without service-admin alert", async () => {
    const finiteApproval = currentApproval({ amountRaw: "10000000000", isUnlimited: false });
    const finiteChange = approvalChange({ amountRaw: "10000000000", isUnlimited: false });
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [finiteApproval], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [finiteChange];
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({
      isUnlimited: false,
      riskLevel: "MEDIUM",
      riskScore: 40
    });
    expect(ctx.evidence[0].observations.map((observation) => observation.code)).toEqual([
      "approval_large_finite_usdt",
      "approval_spender_unknown_eoa"
    ]);
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("Текущий риск для кошелька не рассчитан");
    expect(ctx.sentOwnerMessages[0]).toContain("Разрешение на управление USDT сейчас: активное, безлимитное");
    expect(ctx.sentServiceAdminMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
    expect(ctx.skippedMarks).toEqual([]);
  });

  it("sends HIGH finite approval alerts with decoded allowance amount", async () => {
    const finiteApproval = currentApproval({ amountRaw: "111111000000", isUnlimited: false });
    const finiteChange = approvalChange({ amountRaw: "111111000000", isUnlimited: false });
    const ctx = createDeps({
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [finiteApproval], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [finiteChange];
        }
      }
    });

    await runSingleApprovalPollingCycle(ctx.deps);

    expect(ctx.currentApprovals[0]).toMatchObject({
      isUnlimited: false,
      riskLevel: "HIGH",
      riskScore: 80
    });
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("Текущий риск для кошелька не рассчитан");
    expect(ctx.sentOwnerMessages[0]).toContain("Разрешение на управление USDT сейчас: активное, безлимитное");
    expect(ctx.sentServiceAdminMessages).toHaveLength(1);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
  });

  it("finalizes inexact linked-route context without lowering the approval score", async () => {
    const routeTxHash = "route-tx";
    const routeReceiver = "TUrnbc11111111111111111111111111111";
    let claimCalls = 0;
    const resolved: unknown[] = [];
    const finalAlerts: unknown[] = [];
    const sentOwnerMessages: string[] = [];

    await runSingleApprovalContextFinalizerCycle({
      ...directAllowanceDeps(),
      pageLimit: 20,
      maxPagesPerWallet: 1,
      now: () => new Date("2026-05-05T13:53:00.000Z"),
      claimDueApprovalContexts: async () => {
        claimCalls += 1;
        return claimCalls === 1 ? [pendingContextRow()] : [];
      },
      markApprovalContextResolved: async (input) => {
        resolved.push(input);
        return true;
      },
      markApprovalContextExpired: async () => true,
      markApprovalContextFinalAlertSent: async (input) => {
        finalAlerts.push(input);
        return true;
      },
      releaseApprovalContextAfterFailure: async () => true,
      upsertWalletApproval: async () => {},
      recordApprovalRisk: async () => true,
      getLabelsForAddress: async () => [],
      getAddressMetadata: async (address) => address === spenderAddress ? contractMetadata() : contractMetadata(address, "SunSwap Router"),
      getContractIntelligenceProfile: async () => suspiciousContractProfile(),
      recordRiskEvaluation: async () => {},
      listCustomerAlertRecipients: async () => [],
      sendUserAlert: async (_telegramUserId, message) => {
        sentOwnerMessages.push(message);
      },
      sendAdminAlert: async () => {},
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [], total: 0 };
        },
        async listTrc20ApprovalChanges() {
          return [];
        },
        async listRelatedTrc20Transfers() {
          return [
            {
              transaction_id: routeTxHash,
              from_address: ownerAddress,
              to_address: routeReceiver,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              quant: "100000000",
              confirmed: true,
              contractRet: "SUCCESS",
              finalResult: "SUCCESS",
              status: 0,
              tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
              block_ts: Date.parse("2026-05-05T13:42:27.000Z")
            }
          ];
        },
        async getTransaction() {
          return { ownerAddress, trigger_info: { methodName: "swap", methodId: "swap" }, contractData: { owner_address: ownerAddress } };
        }
      }
    });

    expect(resolved[0]).toMatchObject({
      result: "linked_swap_route",
      finalReport: {
        level: "HIGH",
        score: 70
      }
    });
    expect(sentOwnerMessages).toHaveLength(1);
    expect(sentOwnerMessages[0]).toContain("Проверка доступа к USDT");
    expect(sentOwnerMessages[0]).toContain("🟡 <b>35/100 — средний риск для кошелька</b>");
    expect(sentOwnerMessages[0]).toContain("Фактическое списание через этот контракт: не найдено");
    expect(sentOwnerMessages[0]).not.toMatch(/Дедлайн контекста|Истекает/);
    expect(resolved[0]).toMatchObject({
      finalReport: {
        reasons: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining("approval monitoring state: route_linked") })
        ])
      }
    });
    expect(finalAlerts).toHaveLength(1);
  });

  it.each([
    { label: "complete exact approval window without provider metadata", historyMode: "exact", metadataAvailable: false, expectedScore: 10, expectedLevel: "LOW" },
    { label: "inexact registry activity without provider metadata", historyMode: "exact", metadataAvailable: false, decodedAmountRaw: "91103008", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "incomplete approval window", historyMode: "incomplete", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "malformed approval window", historyMode: "malformed", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "approval window missing the original", historyMode: "missing-original", expectedScore: 45, expectedLevel: "MEDIUM" },
    { label: "intervening reapproval", historyMode: "intervening", expectedScore: 45, expectedLevel: "MEDIUM" }
  ] as const)("uses strict approval history when finalizing $label", async ({ historyMode, metadataAvailable, decodedAmountRaw, expectedScore, expectedLevel }) => {
    const approvalAt = new Date("2026-05-05T13:42:21.000Z");
    const actionTxHash = "c16e27c144732bee70de72c88f5e3e501ac2bd5bbcdad66f6edac5b66cd31743";
    const row = pendingContextRow({
      spenderAddress: bridgersAddress,
      approvalAt,
      contextDeadlineAt: new Date(approvalAt.getTime() + 10 * 60_000)
    });
    const original = approvalChange({ spenderAddress: bridgersAddress, timestamp: approvalAt });
    const intervening = approvalChange({
      txHash: "bb4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2",
      spenderAddress: bridgersAddress,
      amountRaw: "1000000",
      isUnlimited: false,
      timestamp: new Date(approvalAt.getTime() + 30_000)
    });
    const older = Array.from({ length: 49 }, (_, index) => approvalChange({
      txHash: (index + 1).toString(16).padStart(64, "0"),
      spenderAddress: bridgersAddress,
      timestamp: new Date(approvalAt.getTime() - (index + 1) * 1_000)
    }));
    const strictPage = historyMode === "incomplete"
      ? { changes: [original, ...older], rawCount: 50, malformedCount: 0, total: null }
      : historyMode === "malformed"
        ? { changes: [original], rawCount: 2, malformedCount: 1, total: null }
        : historyMode === "missing-original"
          ? { changes: [older[0]!], rawCount: 1, malformedCount: 0, total: null }
          : historyMode === "intervening"
            ? { changes: [intervening, original], rawCount: 2, malformedCount: 0, total: null }
            : { changes: [original], rawCount: 1, malformedCount: 0, total: null };
    const normalizedTransactionClient = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn: vi.fn(async () => new Response(JSON.stringify({
        ownerAddress,
        receipt: { result: "SUCCESS" },
        contractRet: "FAILED",
        trigger_info: { methodName: "swap", parameter: { amount: decodedAmountRaw ?? "91103009" } },
        contractData: { owner_address: ownerAddress, amount: decodedAmountRaw ?? "91103009" }
      }), { status: 200, headers: { "content-type": "application/json" } }))
    });
    const finalReports: Array<{ score: number; level: string }> = [];
    let claimCalls = 0;

    await runSingleApprovalContextFinalizerCycle({
      ...directAllowanceDeps(),
      pageLimit: 20,
      maxPagesPerWallet: 1,
      now: () => new Date(approvalAt.getTime() + 11 * 60_000),
      claimDueApprovalContexts: async () => claimCalls++ === 0 ? [row] : [],
      markApprovalContextResolved: async (input) => {
        finalReports.push(input.finalReport);
        return true;
      },
      markApprovalContextExpired: async (input) => {
        finalReports.push(input.finalReport);
        return true;
      },
      markApprovalContextFinalAlertSent: async () => true,
      releaseApprovalContextAfterFailure: async () => true,
      upsertWalletApproval: async () => {},
      recordApprovalRisk: async () => true,
      getLabelsForAddress: async () => [],
      getAddressMetadata: async (address) => metadataAvailable !== false && address === bridgersAddress
        ? contractMetadata(bridgersAddress, "Bridgers:Cross-chain Bridge")
        : null,
      getContractIntelligenceProfile: async () => null,
      recordRiskEvaluation: async () => {},
      listCustomerAlertRecipients: async () => [],
      sendUserAlert: async () => {},
      sendAdminAlert: async () => {},
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [], total: 0 };
        },
        async listTrc20ApprovalChanges() {
          return strictPage.changes;
        },
        async listTrc20ApprovalChangePageStrict() {
          return strictPage;
        },
        async listRelatedTrc20Transfers() {
          return [{
            transaction_id: actionTxHash,
            from_address: ownerAddress,
            to_address: bridgersAddress,
            contract_address: TRON_USDT_CONTRACT_ADDRESS,
            quant: "91103009",
            confirmed: true,
            contractRet: "SUCCESS",
            finalResult: "SUCCESS",
            status: 0,
            tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
            block_ts: approvalAt.getTime() + 66_000
          }];
        },
        getTransaction: (txHash) => normalizedTransactionClient.getTransaction(txHash)
      }
    });

    expect(finalReports[0]).toMatchObject({ score: expectedScore, level: expectedLevel });
  });

  it("finalizes pending context as expired when no route is found", async () => {
    const expired: unknown[] = [];
    const sentOwnerMessages: string[] = [];

    await runSingleApprovalContextFinalizerCycle({
      ...directAllowanceDeps(),
      pageLimit: 20,
      maxPagesPerWallet: 1,
      now: () => new Date("2026-05-05T13:53:00.000Z"),
      claimDueApprovalContexts: async () => [pendingContextRow()],
      markApprovalContextResolved: async () => true,
      markApprovalContextExpired: async (input) => {
        expired.push(input);
        return true;
      },
      markApprovalContextFinalAlertSent: async () => true,
      releaseApprovalContextAfterFailure: async () => true,
      upsertWalletApproval: async () => {},
      recordApprovalRisk: async () => true,
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => contractMetadata(),
      getContractIntelligenceProfile: async () => suspiciousContractProfile(),
      recordRiskEvaluation: async () => {},
      listCustomerAlertRecipients: async () => [],
      sendUserAlert: async (_telegramUserId, message) => {
        sentOwnerMessages.push(message);
      },
      sendAdminAlert: async () => {},
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [], total: 0 };
        },
        async listTrc20ApprovalChanges() {
          return [];
        },
        async listRelatedTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {};
        }
      }
    });

    expect(expired[0]).toMatchObject({
      finalReport: {
        level: "HIGH"
      }
    });
    expect(sentOwnerMessages[0]).toContain("Проверка доступа к USDT");
    expect(sentOwnerMessages[0]).toContain("🟡 <b>35/100 — средний риск для кошелька</b>");
    expect(sentOwnerMessages[0]).toContain("Точную связанную операцию через этот контракт подтвердить не удалось");
  });

  it("releases pending context after TronScan failure without sending final alert", async () => {
    const releases: unknown[] = [];
    const sentOwnerMessages: string[] = [];

    await runSingleApprovalContextFinalizerCycle({
      ...directAllowanceDeps(),
      pageLimit: 20,
      maxPagesPerWallet: 1,
      now: () => new Date("2026-05-05T13:53:00.000Z"),
      claimDueApprovalContexts: async () => [pendingContextRow()],
      markApprovalContextResolved: async () => true,
      markApprovalContextExpired: async () => true,
      markApprovalContextFinalAlertSent: async () => true,
      releaseApprovalContextAfterFailure: async (input) => {
        releases.push(input);
        return true;
      },
      upsertWalletApproval: async () => {},
      recordApprovalRisk: async () => true,
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => contractMetadata(),
      getContractIntelligenceProfile: async () => suspiciousContractProfile(),
      recordRiskEvaluation: async () => {},
      listCustomerAlertRecipients: async () => [],
      sendUserAlert: async (_telegramUserId, message) => {
        sentOwnerMessages.push(message);
      },
      sendAdminAlert: async () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [], total: 0 };
        },
        async listTrc20ApprovalChanges() {
          return [];
        },
        async listRelatedTrc20Transfers() {
          throw new Error("TronScan timeout");
        },
        async getTransaction() {
          return {};
        }
      }
    });

    expect(releases[0]).toMatchObject({
      approvalTxHash,
      watchedWalletId: watchedWallet.id,
      error: "TronScan timeout"
    });
    expect(sentOwnerMessages).toEqual([]);
  });

  it("stores collector-drain pending context as CRITICAL", async () => {
    const receiverAddress = "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD";
    const resolved: unknown[] = [];
    const sentOwnerMessages: string[] = [];

    await runSingleApprovalContextFinalizerCycle({
      ...directAllowanceDeps(),
      pageLimit: 20,
      maxPagesPerWallet: 1,
      now: () => new Date("2026-05-05T13:53:00.000Z"),
      claimDueApprovalContexts: async () => [pendingContextRow()],
      markApprovalContextResolved: async (input) => {
        resolved.push(input);
        return true;
      },
      markApprovalContextExpired: async () => true,
      markApprovalContextFinalAlertSent: async () => true,
      releaseApprovalContextAfterFailure: async () => true,
      upsertWalletApproval: async () => {},
      recordApprovalRisk: async () => true,
      getLabelsForAddress: async () => [],
      getAddressMetadata: async (address) => address === spenderAddress ? contractMetadata() : { ...contractMetadata(address), isContract: false, tag: null },
      getContractIntelligenceProfile: async () => suspiciousContractProfile(),
      recordRiskEvaluation: async () => {},
      listCustomerAlertRecipients: async () => [],
      sendUserAlert: async (_telegramUserId, message) => {
        sentOwnerMessages.push(message);
      },
      sendAdminAlert: async () => {},
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [], total: 0 };
        },
        async listTrc20ApprovalChanges() {
          return [];
        },
        async listRelatedTrc20Transfers() {
          return [
            {
              transaction_id: "collector-tx",
              from_address: ownerAddress,
              to_address: receiverAddress,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              quant: "320000000000",
              confirmed: true,
              contractRet: "SUCCESS",
              finalResult: "SUCCESS",
              status: 0,
              tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenDecimal: 6, tokenType: "trc20" },
              block_ts: Date.parse("2026-05-05T13:43:00.000Z")
            }
          ];
        },
        async getTransaction() {
          return {
            ownerAddress: spenderAddress,
            trigger_info: { methodName: "transferFrom", methodId: "23b872dd" },
            contractData: { owner_address: spenderAddress }
          };
        }
      }
    });

    expect(resolved[0]).toMatchObject({
      result: "collector_drain",
      finalReport: {
        level: "CRITICAL",
        score: 95,
        reasons: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining("approval monitoring state: transfer_from_observed") })
        ])
      }
    });
    expect(resolved[0]).not.toMatchObject({
      finalReport: {
        reasons: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining("approval monitoring state: approval_only") })
        ])
      }
    });
    expect(sentOwnerMessages[0]).toContain("🔴 <b>95/100 — критический риск для кошелька</b>");
    expect(sentOwnerMessages[0]).toContain("Фактическое списание через этот контракт: подтверждено, 320 000 USDT");
    expect(sentOwnerMessages[0]).toContain("подтверждённое списание USDT через контракт");
    expect(sentOwnerMessages[0]).not.toMatch(/approval|spender|allowance|transferFrom/i);
  });

  it("[REQ-19][RUNTIME-REFRESH] persists provider failure as UNKNOWN/null before releasing the target", async () => {
    const { runSingleApprovalAllowanceRefreshCycle } = await import("../../src/approvals/allowanceRefreshWorker");
    const events: string[] = [];
    const saved: ApprovalAllowanceStateV2[] = [];

    await runSingleApprovalAllowanceRefreshCycle({
      db: {},
      now: () => new Date("2026-07-15T12:00:00.000Z"),
      getUsdtAllowance: async () => {
        events.push("provider");
        throw new Error("provider disconnected");
      },
      saveWalletApprovalAllowanceStateV2: async ({ allowance }) => {
        events.push("save");
        saved.push(allowance);
      },
      repository: {
        listDueApprovalAllowanceRefreshTargets: async () => [{
          watchedWalletId: watchedWallet.id,
          ownerAddress,
          tokenContract: TRON_USDT_CONTRACT_ADDRESS,
          spenderAddress
        }],
        tryAcquireApprovalAllowanceRefreshLock: async () => ({
          release: async () => { events.push("unlock"); }
        })
      }
    });

    expect(events).toEqual(["provider", "save", "unlock"]);
    expect(saved[0]).toMatchObject({
      state: "failed",
      confirmedAllowanceRaw: null,
      isUnlimited: null,
      failureCode: "provider_unavailable",
      observedApprovalTxHash: null
    });
  });

  it("[REQ-19][RUNTIME-REFRESH] releases a causal-save rejection and continues with the next target", async () => {
    const { runSingleApprovalAllowanceRefreshCycle } = await import("../../src/approvals/allowanceRefreshWorker");
    const targets = [
      { watchedWalletId: "wallet-1", ownerAddress, tokenContract: TRON_USDT_CONTRACT_ADDRESS, spenderAddress },
      { watchedWalletId: "wallet-2", ownerAddress, tokenContract: TRON_USDT_CONTRACT_ADDRESS, spenderAddress: bridgersAddress }
    ];
    const events: string[] = [];
    const savedWallets: string[] = [];

    await expect(runSingleApprovalAllowanceRefreshCycle({
      db: {},
      now: () => new Date("2026-07-15T12:00:00.000Z"),
      getUsdtAllowance: async ({ spenderAddress: currentSpender }) => {
        events.push(`provider:${currentSpender}`);
        return currentSpender === spenderAddress ? "1" : "2";
      },
      saveWalletApprovalAllowanceStateV2: async ({ watchedWalletId }) => {
        events.push(`save:${watchedWalletId}`);
        if (watchedWalletId === "wallet-1") throw new Error("allowance_state_stale_write");
        savedWallets.push(watchedWalletId);
      },
      repository: {
        listDueApprovalAllowanceRefreshTargets: async () => targets,
        tryAcquireApprovalAllowanceRefreshLock: async (_db, target) => ({
          release: async () => { events.push(`unlock:${target.watchedWalletId}`); }
        })
      }
    })).resolves.toBeUndefined();

    expect(events).toEqual([
      `provider:${spenderAddress}`,
      "save:wallet-1",
      "unlock:wallet-1",
      `provider:${bridgersAddress}`,
      "save:wallet-2",
      "unlock:wallet-2"
    ]);
    expect(savedWallets).toEqual(["wallet-2"]);
  });

  it("[REQ-19][RUNTIME-REFRESH] timestamps each sequential target at attempt and successful completion", async () => {
    vi.useFakeTimers();
    try {
      const { runSingleApprovalAllowanceRefreshCycle } = await import("../../src/approvals/allowanceRefreshWorker");
      const cycleAt = new Date("2026-07-15T12:00:00.000Z");
      let currentMs = cycleAt.getTime();
      const firstAttemptAt = new Date(currentMs + 1_000);
      const firstCompletedAt = new Date(currentMs + 6_000);
      const secondAttemptAt = new Date(currentMs + 8_000);
      const targets = [
        { watchedWalletId: "wallet-1", ownerAddress, tokenContract: TRON_USDT_CONTRACT_ADDRESS, spenderAddress },
        { watchedWalletId: "wallet-2", ownerAddress, tokenContract: TRON_USDT_CONTRACT_ADDRESS, spenderAddress: bridgersAddress }
      ];
      const lockAttempts: Date[] = [];
      const saved = new Map<string, ApprovalAllowanceStateV2>();
      const events: string[] = [];

      const cycle = runSingleApprovalAllowanceRefreshCycle({
        db: {},
        now: () => new Date(currentMs),
        getUsdtAllowance: async ({ spenderAddress: currentSpender, signal }) => {
          events.push(`provider:${currentSpender}`);
          if (currentSpender === spenderAddress) {
            currentMs += 5_000;
            return "1";
          }
          return await new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              currentMs += 15_000;
              reject(signal.reason);
            }, { once: true });
          });
        },
        saveWalletApprovalAllowanceStateV2: async ({ watchedWalletId, allowance }) => {
          events.push(`save:${watchedWalletId}`);
          saved.set(watchedWalletId, allowance);
        },
        repository: {
          listDueApprovalAllowanceRefreshTargets: async (_db, input) => {
            expect(input.now).toEqual(cycleAt);
            currentMs += 1_000;
            return targets;
          },
          tryAcquireApprovalAllowanceRefreshLock: async (_db, target) => {
            events.push(`lock:${target.watchedWalletId}`);
            lockAttempts.push(target.now);
            return {
              release: async () => {
                events.push(`unlock:${target.watchedWalletId}`);
                if (target.watchedWalletId === "wallet-1") currentMs += 2_000;
              }
            };
          }
        }
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(events.at(-1)).toBe(`provider:${bridgersAddress}`);
      await vi.advanceTimersByTimeAsync(15_000);
      await cycle;

      expect(events).toEqual([
        "lock:wallet-1",
        `provider:${spenderAddress}`,
        "save:wallet-1",
        "unlock:wallet-1",
        "lock:wallet-2",
        `provider:${bridgersAddress}`,
        "save:wallet-2",
        "unlock:wallet-2"
      ]);
      expect(lockAttempts).toEqual([firstAttemptAt, secondAttemptAt]);
      expect(saved.get("wallet-1")).toMatchObject({
        state: "confirmed_active",
        confirmedAt: firstCompletedAt.toISOString(),
        lastAttemptAt: firstCompletedAt.toISOString(),
        freshUntil: new Date(firstCompletedAt.getTime() + 15 * 60_000).toISOString()
      });
      expect(saved.get("wallet-2")).toMatchObject({
        state: "failed",
        lastAttemptAt: secondAttemptAt.toISOString(),
        failureCode: "provider_timeout"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("[REQ-19][RUNTIME-REFRESH] releases the lock but propagates an unexpected save failure", async () => {
    const { runSingleApprovalAllowanceRefreshCycle } = await import("../../src/approvals/allowanceRefreshWorker");
    const events: string[] = [];

    await expect(runSingleApprovalAllowanceRefreshCycle({
      db: {},
      now: () => new Date("2026-07-15T12:00:00.000Z"),
      getUsdtAllowance: async () => "1",
      saveWalletApprovalAllowanceStateV2: async () => {
        events.push("save");
        throw new TypeError("invalid worker configuration");
      },
      repository: {
        listDueApprovalAllowanceRefreshTargets: async () => [{
          watchedWalletId: watchedWallet.id,
          ownerAddress,
          tokenContract: TRON_USDT_CONTRACT_ADDRESS,
          spenderAddress
        }],
        tryAcquireApprovalAllowanceRefreshLock: async () => ({
          release: async () => { events.push("unlock"); }
        })
      }
    })).rejects.toThrow("invalid worker configuration");

    expect(events).toEqual(["save", "unlock"]);
  });
});
