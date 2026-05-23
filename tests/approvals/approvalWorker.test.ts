import { describe, expect, it } from "vitest";
import { runSingleApprovalPollingCycle } from "../../src/approvals/approvalWorker";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { CustomerAlertRecipient, ObservedApprovalEvent, WalletApprovalPollState } from "../../src/storage/repositories";
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

function createDeps(overrides: Partial<Parameters<typeof runSingleApprovalPollingCycle>[0]> = {}) {
  const claimed = new Set<string>();
  const currentApprovals: unknown[] = [];
  const sentOwnerMessages: string[] = [];
  const sentCustomerMessages: Array<{ telegramUserId: string; message: string }> = [];
  const sentServiceAdminMessages: string[] = [];
  const sentMarks: string[] = [];
  const skippedMarks: string[] = [];
  const failures: string[] = [];
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
    sendUserAlert: async (_telegramUserId, message) => {
      sentOwnerMessages.push(message);
    },
    sendCustomerAdminAlert: async (telegramUserId, message) => {
      sentCustomerMessages.push({ telegramUserId, message });
    },
    sendAdminAlert: async (message) => {
      sentServiceAdminMessages.push(message);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides
  };

  return {
    deps,
    currentApprovals,
    sentOwnerMessages,
    sentCustomerMessages,
    sentServiceAdminMessages,
    sentMarks,
    skippedMarks,
    failures,
    pollSuccesses,
    pollFailures,
    evidence
  };
}

describe("runSingleApprovalPollingCycle", () => {
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
    expect(ctx.sentOwnerMessages).toHaveLength(1);
    expect(ctx.sentOwnerMessages[0]).toContain("Approval Guard");
    expect(ctx.sentOwnerMessages[0]).toContain("Risk score: 80/100 (HIGH)");
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
    expect(ctx.pollSuccesses.at(-1)).toMatchObject({
      watchedWalletId: watchedWallet.id,
      lastSeenTxHash: approvalTxHash,
      lastSeenApprovalTs: new Date("2026-05-06T19:06:15.000Z")
    });
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
    expect(ctx.sentOwnerMessages).toEqual([]);
    expect(ctx.skippedMarks).toEqual([approvalTxHash]);
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
    expect(ctx.sentOwnerMessages[0]).toContain("Risk score: 95/100 (CRITICAL)");
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

  it("stores MEDIUM finite approvals but skips immediate owner alerts", async () => {
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
    expect(ctx.sentOwnerMessages).toEqual([]);
    expect(ctx.sentServiceAdminMessages).toEqual([]);
    expect(ctx.skippedMarks).toEqual([approvalTxHash]);
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
    expect(ctx.sentOwnerMessages[0]).toContain("Allowance: finite 111,111 USDT");
    expect(ctx.sentServiceAdminMessages).toHaveLength(1);
    expect(ctx.sentMarks).toEqual([approvalTxHash]);
  });
});
