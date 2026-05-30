import { describe, expect, it } from "vitest";
import { runSingleApprovalContextFinalizerCycle, runSingleApprovalPollingCycle } from "../../src/approvals/approvalWorker";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { CustomerAlertRecipient, PendingApprovalContextRow, WalletApprovalPollState } from "../../src/storage/repositories";
import type { AddressLabel, RawEvidenceInput, RiskSignalObservationInput, WatchedWallet } from "../../src/types";

const ownerAddress = "TOwner1111111111111111111111111111111";
const spenderAddress = "TSpender11111111111111111111111111111";
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
    expect(ctx.sentOwnerMessages[0]).toContain("Approval Guard");
    expect(ctx.sentOwnerMessages[0]).toContain("<b>High risk</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("<code>80/100</code>");
    expect(ctx.sentOwnerOptions[0]?.parse_mode).toBe("HTML");
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
    expect(ctx.pollSuccesses.at(-1)).toMatchObject({
      watchedWalletId: watchedWallet.id,
      lastSeenTxHash: approvalTxHash,
      lastSeenApprovalTs: new Date("2026-05-06T19:06:15.000Z")
    });
  });

  it("stores shadow approval-drain observations when spender called USDT transferFrom", async () => {
    const receiverAddress = "TReceiver1111111111111111111111111111";
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

    expect(ctx.currentApprovals[0]).toMatchObject({ riskLevel: "LOW", riskScore: 15 });
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
    expect(ctx.sentOwnerMessages[0]).toContain("<b>Low risk</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("<code>15/100</code>");
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
      riskScore: 15
    });
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("<b>Medium risk</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("<code>35/100</code>");
    expect(ctx.sentServiceAdminMessages).toEqual([]);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
    expect(ctx.skippedMarks).toEqual([]);
  });

  it("uses TronScan service metadata to dampen service contracts to LOW", async () => {
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
      riskLevel: "LOW",
      riskScore: 15
    });
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("<b>Low risk</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("<code>15/100</code>");
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
        message: expect.stringContaining("<code>15/100</code>")
      })
    ]);
  });

  it("dampens tokenApprove-like approvals when nearby transfer is linked to service route", async () => {
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
      riskLevel: "MEDIUM",
      riskScore: 35
    });
    expect(ctx.evidence.flatMap((entry) => entry.observations.map((observation) => observation.code))).toContain(
      "approval_temporally_linked_to_known_swap"
    );
    expect(ctx.sentOwnerMessages[0]).toContain("<b>Medium risk</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("<code>35/100</code>");
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
    expect(ctx.sentOwnerMessages[0]).toContain("pending context");
    expect(ctx.sentOwnerMessages[0]).toContain("Waiting up to 10 min");
    expect(ctx.sentOwnerMessages[0]).toContain("This is not proof of theft yet");
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
    expect(ctx.sentOwnerMessages[0]).toContain("Approval Guard");
    expect(ctx.sentOwnerMessages[0]).not.toContain("pending context");
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
      riskScore: 95
    });
    expect(ctx.sentOwnerMessages[0]).toContain("<b>Critical risk</b>");
    expect(ctx.sentOwnerMessages[0]).toContain("<code>95/100</code>");
    expect(ctx.sentOwnerMessages[0]).toContain("Approval transaction was signed long before it appeared on-chain");
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
    expect(ctx.sentOwnerMessages[0]).toContain("<code>40/100</code>");
    expect(ctx.sentOwnerMessages[0]).toContain("<b>Allowance</b>: <code>finite 10,000 USDT</code>");
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
    expect(ctx.sentOwnerMessages[0]).toContain("<b>Allowance</b>: <code>finite 111,111 USDT</code>");
    expect(ctx.sentServiceAdminMessages).toHaveLength(1);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
  });

  it("finalizes pending context as MEDIUM when a linked swap route is found and sends one follow-up", async () => {
    const routeTxHash = "route-tx";
    const routeReceiver = "TUrnbc11111111111111111111111111111";
    let claimCalls = 0;
    const resolved: unknown[] = [];
    const finalAlerts: unknown[] = [];
    const sentOwnerMessages: string[] = [];

    await runSingleApprovalContextFinalizerCycle({
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
        level: "MEDIUM",
        score: 35
      }
    });
    expect(sentOwnerMessages).toHaveLength(1);
    expect(sentOwnerMessages[0]).toContain("Approval Guard result");
    expect(sentOwnerMessages[0]).toContain("Initial status was");
    expect(sentOwnerMessages[0]).toContain("linked to SunSwap Router");
    expect(resolved[0]).toMatchObject({
      finalReport: {
        reasons: expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining("approval monitoring state: route_linked") })
        ])
      }
    });
    expect(finalAlerts).toHaveLength(1);
  });

  it("finalizes pending context as expired when no route is found", async () => {
    const expired: unknown[] = [];
    const sentOwnerMessages: string[] = [];

    await runSingleApprovalContextFinalizerCycle({
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
    expect(sentOwnerMessages[0]).toContain("no related swap/bridge route found within 10 min");
  });

  it("releases pending context after TronScan failure without sending final alert", async () => {
    const releases: unknown[] = [];
    const sentOwnerMessages: string[] = [];

    await runSingleApprovalContextFinalizerCycle({
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
    const receiverAddress = "TReceiver1111111111111111111111111111";
    const resolved: unknown[] = [];
    const sentOwnerMessages: string[] = [];

    await runSingleApprovalContextFinalizerCycle({
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
    expect(sentOwnerMessages[0]).toContain("possible collector drain");
    expect(sentOwnerMessages[0]).toContain("approval monitoring state: transfer_from_observed");
  });
});
