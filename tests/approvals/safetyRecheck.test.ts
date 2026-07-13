import { describe, expect, it } from "vitest";
import { runSingleApprovalContextFinalizerCycle, runSingleApprovalPollingCycle } from "../../src/approvals/approvalWorker";
import { runSafetyRecheck } from "../../src/approvals/safetyRecheck";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { Db } from "../../src/storage/db";
import type { AddressMetadata, ContractIntelligenceProfile } from "../../src/storage/repositories";
import type { ListTrc20ApprovalChangesInput } from "../../src/tron/tronClient";

const walletAddress = "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ";
const spenderAddress = "TXka46PPwttNPWfFDPtt3GUodbPThyufaV";
const approvalTxHash = "aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";
const drainTxHash = "cc4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";

function createFakeDb(address = walletAddress): { db: Db; queries: Array<{ sql: string; params?: unknown[] }> } {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const db = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (sql.includes("from watched_wallets") && sql.includes("where w.address")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "wallet-1",
              telegram_user_id: "123",
              username: "owner",
              address,
              created_at: new Date("2026-05-01T00:00:00.000Z"),
              alert_mode: "realtime",
              digest_interval_minutes: 10
            }
          ]
        };
      }
      if (sql.includes("from address_labels")) return { rowCount: 0, rows: [] };
      if (sql.includes("from address_metadata")) return { rowCount: 0, rows: [] };
      if (sql.includes("from contract_intelligence_profiles")) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into observed_approval_events")) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into observed_approval_drain_events")) return { rowCount: 1, rows: [] };
      if (sql.includes("update observed_approval_events") && sql.includes("risk_level")) return { rowCount: 1, rows: [] };
      if (sql.includes("as owner_matches") && sql.includes("as write_applied")) {
        return { rowCount: 1, rows: [{ owner_matches: true, write_applied: true }] };
      }
      return { rowCount: 1, rows: [] };
    },
    async connect() {
      return {
        query: async (sql: string, params?: unknown[]) => {
          queries.push({ sql, params });
          return { rowCount: 1, rows: [] };
        },
        release: () => undefined
      };
    }
  } as unknown as Db;
  return { db, queries };
}

function metadata(): AddressMetadata {
  return {
    address: spenderAddress,
    source: "tronscan",
    name: null,
    tag: null,
    isContract: false,
    verified: null,
    accountType: 0,
    rawJson: {},
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000)
  };
}

function profile(): ContractIntelligenceProfile {
  return {
    contractAddress: spenderAddress,
    providerTags: [],
    publicTags: [],
    isVerified: null,
    verifyStatus: null,
    sourceStatus: null,
    contractAgeDays: null,
    txCount: null,
    recentCallCount: null,
    totalCallerCount: null,
    rawPayload: {},
    address: spenderAddress,
    source: "tronscan",
    name: null,
    serviceTag: null,
    publicTag: null,
    publicTagDesc: null,
    tagUrl: null,
    verified: null,
    providerRisk: false,
    contractCreatedAt: null,
    trxCount: null,
    totalCallCount: null,
    uniqueCallerCount: null,
    topMethods: [],
    topCallers: [],
    methodMap: {},
    hasTransferFromSelector: false,
    hasOwnerOnlyPattern: false,
    lowMetadata: false,
    activityLevel: "unknown",
    rawJson: {},
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000)
  };
}

const allowanceOwnerAddress = "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ";
const allowanceSpenderAddress = "TXka46PPwttNPWfFDPtt3GUodbPThyufaV";
const historicalAllowanceRaw = (2n ** 256n - 1n).toString();
const allowanceNow = new Date("2026-07-13T12:00:00.000Z");

function allowanceApproval() {
  return {
    ownerAddress: allowanceOwnerAddress,
    spenderAddress: allowanceSpenderAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: historicalAllowanceRaw,
    isUnlimited: true,
    operateTime: new Date("2026-07-13T11:59:00.000Z"),
    spenderIsContract: false,
    tokenSymbol: "USDT",
    tokenDecimals: 6
  };
}

function allowanceChange() {
  return {
    txHash: approvalTxHash,
    ownerAddress: allowanceOwnerAddress,
    spenderAddress: allowanceSpenderAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: historicalAllowanceRaw,
    isUnlimited: true,
    timestamp: new Date("2026-07-13T11:59:00.000Z"),
    confirmed: true,
    contractRet: "SUCCESS"
  };
}

function allowancePollingDeps(input: {
  claimed: boolean;
  getUsdtAllowance: (request: { ownerAddress: string; spenderAddress: string }) => Promise<string>;
  now?: () => Date;
  upserts?: unknown[];
  savedAllowances?: unknown[];
  order?: string[];
}) {
  return {
    wallets: [{
      id: "allowance-wallet",
      telegramUserId: "123",
      telegramUsername: "owner",
      address: allowanceOwnerAddress,
      createdAt: new Date("2026-07-13T00:00:00.000Z"),
      alertMode: "realtime",
      digestIntervalMinutes: 10
    }],
    tronClient: {
      async listTrc20Approvals() {
        return { approvals: [allowanceApproval()], total: 1 };
      },
      async listTrc20ApprovalChanges() {
        return [allowanceChange()];
      },
      getUsdtAllowance: input.getUsdtAllowance
    },
    getUsdtAllowance: input.getUsdtAllowance,
    saveWalletApprovalAllowanceStateV2: async (saved: unknown) => {
      input.savedAllowances?.push(saved);
    },
    pageLimit: 20,
    maxPagesPerWallet: 1,
    now: input.now ?? (() => allowanceNow),
    getApprovalPollState: async () => null,
    recordApprovalPollSuccess: async () => undefined,
    recordApprovalPollFailure: async () => undefined,
    upsertWalletApproval: async (approval: unknown) => {
      input.upserts?.push(approval);
    },
    claimObservedApprovalEvent: async () => {
      input.order?.push("claim");
      return input.claimed;
    },
    recordApprovalRisk: async () => true,
    markApprovalOwnerAlertSent: async () => true,
    markApprovalOwnerAlertSkipped: async () => true,
    markApprovalOwnerAlertFailed: async () => true,
    getLabelsForAddress: async () => [],
    getAddressMetadata: async () => null,
    upsertAddressMetadata: async () => undefined,
    recordRiskEvaluation: async () => undefined,
    listCustomerAlertRecipients: async () => [],
    sendUserAlert: async () => undefined,
    sendCustomerAdminAlert: async () => undefined,
    sendAdminAlert: async () => undefined,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
  } as any;
}

function pendingAllowanceContext() {
  return {
    approvalTxHash,
    watchedWalletId: "allowance-wallet",
    ownerAddress: allowanceOwnerAddress,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    spenderAddress: allowanceSpenderAddress,
    spenderType: "eoa",
    amountRaw: historicalAllowanceRaw,
    isUnlimited: true,
    approvalAt: new Date("2026-07-13T11:49:00.000Z"),
    ownerAlertStatus: "sent",
    ownerAlertAttempts: 0,
    ownerAlertLastError: null,
    ownerAlertUpdatedAt: new Date("2026-07-13T11:49:01.000Z"),
    riskLevel: "HIGH",
    riskScore: 70,
    riskReasons: [],
    createdAt: new Date("2026-07-13T11:49:01.000Z"),
    contextStatus: "finalizing",
    contextDeadlineAt: new Date("2026-07-13T11:59:00.000Z"),
    contextResult: "unknown",
    initialRiskLevel: "HIGH",
    initialRiskScore: 70,
    initialRiskReasons: [],
    finalRiskLevel: null,
    finalRiskScore: null,
    finalRiskReasons: [],
    finalContextAlertSentAt: null,
    contextLastError: null,
    contextUpdatedAt: allowanceNow,
    wallet: {
      id: "allowance-wallet",
      telegramUserId: "123",
      telegramUsername: "owner",
      address: allowanceOwnerAddress,
      createdAt: new Date("2026-07-13T00:00:00.000Z"),
      alertMode: "realtime",
      digestIntervalMinutes: 10
    }
  };
}

function safetyInput(allowance: unknown) {
  return {
    subjectAddress: allowanceSpenderAddress,
    allowance,
    balanceAtRiskRaw: null,
    exactVerify20: true,
    exactDebit: false,
    debitFoundFromSubject: false,
    campaignEvidenceIds: ["campaign:verify20"],
    serviceSession: null,
    authoritativeServiceId: null,
    providerRisk: false,
    contractContext: { selectors: [], providerName: null, freeText: null },
    transactionExpirationAt: null
  };
}

describe("runSafetyRecheck", () => {
  it("rechecks already claimed approvals without owner alerts and records late drain observations", async () => {
    const { db, queries } = createFakeDb();
    let allowanceCalls = 0;

    const summary = await runSafetyRecheck({
      db,
      pageLimit: 20,
      maxPagesPerWallet: 1,
      walletAddress,
      tronClient: {
        async listTrc20Approvals() {
          return {
            approvals: [
              {
                ownerAddress: walletAddress,
                spenderAddress,
                tokenContract: TRON_USDT_CONTRACT_ADDRESS,
                amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
                isUnlimited: true,
                operateTime: new Date("2026-05-06T19:06:15.000Z"),
                spenderIsContract: false,
                tokenSymbol: "USDT",
                tokenDecimals: 6
              }
            ],
            total: 1
          };
        },
        async listTrc20ApprovalChanges() {
          return [
            {
              txHash: approvalTxHash,
              ownerAddress: walletAddress,
              spenderAddress,
              tokenContract: TRON_USDT_CONTRACT_ADDRESS,
              amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
              isUnlimited: true,
              timestamp: new Date("2026-05-06T19:06:15.000Z"),
              confirmed: true,
              contractRet: "SUCCESS"
            }
          ];
        },
        async listRelatedTrc20Transfers() {
          return [
            {
              transaction_id: drainTxHash,
              from_address: walletAddress,
              to_address: "TReceiver1111111111111111111111111111",
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              quant: "320000000000",
              confirmed: true,
              contractRet: "SUCCESS",
              finalResult: "SUCCESS",
              status: 0,
              tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
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
        },
        async getAddressMetadata() {
          return metadata();
        },
        async getContractIntelligenceProfile() {
          return profile();
        },
        async getUsdtAllowance() {
          allowanceCalls += 1;
          return historicalAllowanceRaw;
        }
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });

    expect(summary).toMatchObject({
      walletFound: true,
      approvalsProcessed: 1,
      approvalEventsClaimed: 0,
      riskRowsUpdated: 1,
      drainObservationsClaimed: 1
    });
    expect(queries.some((query) => query.sql.includes("insert into observed_approval_drain_events"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("owner_alert_status = 'skipped'"))).toBe(true);
    expect(allowanceCalls).toBe(1);
  });

  it("looks beyond the newest approval change when rechecking by approval tx hash", async () => {
    const { db } = createFakeDb();
    const newerTxHash = "bb4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";
    const approvalChangeRequests: ListTrc20ApprovalChangesInput[] = [];
    let allowanceCalls = 0;

    const summary = await runSafetyRecheck({
      db,
      pageLimit: 20,
      maxPagesPerWallet: 1,
      walletAddress,
      target: { kind: "approval_tx", txHash: approvalTxHash },
      tronClient: {
        async listTrc20Approvals() {
          return {
            approvals: [
              {
                ownerAddress: walletAddress,
                spenderAddress,
                tokenContract: TRON_USDT_CONTRACT_ADDRESS,
                amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
                isUnlimited: true,
                operateTime: new Date("2026-05-06T19:06:15.000Z"),
                spenderIsContract: false,
                tokenSymbol: "USDT",
                tokenDecimals: 6
              }
            ],
            total: 1
          };
        },
        async listTrc20ApprovalChanges(input) {
          approvalChangeRequests.push(input);
          return [
            {
              txHash: newerTxHash,
              ownerAddress: walletAddress,
              spenderAddress,
              tokenContract: TRON_USDT_CONTRACT_ADDRESS,
              amountRaw: "1000000",
              isUnlimited: false,
              timestamp: new Date("2026-05-07T19:06:15.000Z"),
              confirmed: true,
              contractRet: "SUCCESS"
            },
            {
              txHash: approvalTxHash,
              ownerAddress: walletAddress,
              spenderAddress,
              tokenContract: TRON_USDT_CONTRACT_ADDRESS,
              amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
              isUnlimited: true,
              timestamp: new Date("2026-05-06T19:06:15.000Z"),
              confirmed: true,
              contractRet: "SUCCESS"
            }
          ];
        },
        async getAddressMetadata() {
          return metadata();
        },
        async getContractIntelligenceProfile() {
          return profile();
        },
        async getUsdtAllowance() {
          allowanceCalls += 1;
          return historicalAllowanceRaw;
        }
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });

    expect(approvalChangeRequests[0]?.limit).toBe(50);
    expect(summary).toMatchObject({
      walletFound: true,
      approvalsProcessed: 1,
      riskRowsUpdated: 1
    });
    expect(allowanceCalls).toBe(1);
  });

  it("persists route-linked session context evidence during safety recheck", async () => {
    const { db, queries } = createFakeDb();
    const routeTxHash = "dd4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";
    const routeReceiver = "TUrnbc11111111111111111111111111111";
    let allowanceCalls = 0;

    const summary = await runSafetyRecheck({
      db,
      pageLimit: 20,
      maxPagesPerWallet: 1,
      walletAddress,
      tronClient: {
        async listTrc20Approvals() {
          return {
            approvals: [
              {
                ownerAddress: walletAddress,
                spenderAddress,
                tokenContract: TRON_USDT_CONTRACT_ADDRESS,
                amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
                isUnlimited: true,
                operateTime: new Date("2026-05-05T13:42:21.000Z"),
                spenderIsContract: true,
                tokenSymbol: "USDT",
                tokenDecimals: 6
              }
            ],
            total: 1
          };
        },
        async listTrc20ApprovalChanges() {
          return [
            {
              txHash: approvalTxHash,
              ownerAddress: walletAddress,
              spenderAddress,
              tokenContract: TRON_USDT_CONTRACT_ADDRESS,
              amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
              isUnlimited: true,
              timestamp: new Date("2026-05-05T13:42:21.000Z"),
              confirmed: true,
              contractRet: "SUCCESS"
            }
          ];
        },
        async listRelatedTrc20Transfers() {
          return [
            {
              transaction_id: routeTxHash,
              from_address: walletAddress,
              to_address: routeReceiver,
              contract_address: TRON_USDT_CONTRACT_ADDRESS,
              quant: "100000000",
              confirmed: true,
              contractRet: "SUCCESS",
              finalResult: "SUCCESS",
              status: 0,
              tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
              block_ts: Date.parse("2026-05-05T13:42:27.000Z")
            }
          ];
        },
        async getTransaction() {
          return {
            ownerAddress: walletAddress,
            trigger_info: { methodName: "swap", methodId: "swap" },
            contractData: { owner_address: walletAddress }
          };
        },
        async getAddressMetadata(address) {
          if (address === routeReceiver) {
            return {
              address,
              source: "tronscan",
              name: "UniV3Adapter",
              tag: "SunSwap Router",
              isContract: true,
              verified: true,
              accountType: 2,
              rawJson: {}
            };
          }
          return metadata();
        },
        async getContractIntelligenceProfile() {
          return profile();
        },
        async getUsdtAllowance() {
          allowanceCalls += 1;
          return historicalAllowanceRaw;
        }
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });

    expect(summary).toMatchObject({
      walletFound: true,
      approvalsProcessed: 1,
      riskRowsUpdated: 1
    });
    expect(queries.some((query) => JSON.stringify(query.params ?? []).includes("approval_temporally_linked_to_known_swap"))).toBe(true);
    expect(allowanceCalls).toBe(1);
  });
});

describe("allowance refresh lifecycle", () => {
  it("[REQ-19][ALLOWANCE-REFRESH] refreshes only for a new event finalization or explicit safety recheck", async () => {
    await import("../../src/approvals/allowanceRefresh");

    const newEventCalls: Array<{ ownerAddress: string; spenderAddress: string }> = [];
    const newEventOrder: string[] = [];
    await runSingleApprovalPollingCycle(allowancePollingDeps({
      claimed: true,
      order: newEventOrder,
      getUsdtAllowance: async (request) => {
        newEventOrder.push("allowance");
        newEventCalls.push(request);
        return "0";
      }
    }));
    expect(newEventCalls).toEqual([{ ownerAddress: allowanceOwnerAddress, spenderAddress: allowanceSpenderAddress }]);
    expect(newEventOrder.indexOf("allowance")).toBeGreaterThan(newEventOrder.indexOf("claim"));

    const contextCalls: Array<{ ownerAddress: string; spenderAddress: string }> = [];
    const contextOrder: string[] = [];
    await runSingleApprovalContextFinalizerCycle({
      pageLimit: 20,
      maxPagesPerWallet: 1,
      now: () => allowanceNow,
      claimDueApprovalContexts: async () => [pendingAllowanceContext()],
      markApprovalContextResolved: async () => true,
      markApprovalContextExpired: async () => {
        contextOrder.push("finalized");
        return true;
      },
      markApprovalContextFinalAlertSent: async () => true,
      releaseApprovalContextAfterFailure: async () => true,
      upsertWalletApproval: async () => undefined,
      recordApprovalRisk: async () => true,
      getLabelsForAddress: async () => [],
      getAddressMetadata: async () => null,
      getContractIntelligenceProfile: async () => null,
      recordRiskEvaluation: async () => undefined,
      listCustomerAlertRecipients: async () => [],
      sendUserAlert: async () => undefined,
      sendAdminAlert: async () => undefined,
      getUsdtAllowance: async (request: { ownerAddress: string; spenderAddress: string }) => {
        contextOrder.push("allowance");
        contextCalls.push(request);
        return "0";
      },
      saveWalletApprovalAllowanceStateV2: async () => undefined,
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
        },
        async getUsdtAllowance(request: { ownerAddress: string; spenderAddress: string }) {
          contextOrder.push("allowance");
          contextCalls.push(request);
          return "0";
        }
      }
    } as any);
    expect(contextCalls).toEqual([{ ownerAddress: allowanceOwnerAddress, spenderAddress: allowanceSpenderAddress }]);
    expect(contextOrder).toEqual(["allowance", "finalized"]);

    const explicitCalls: Array<{ ownerAddress: string; spenderAddress: string }> = [];
    const { db } = createFakeDb(allowanceOwnerAddress);
    await runSafetyRecheck({
      db,
      pageLimit: 20,
      maxPagesPerWallet: 1,
      walletAddress: allowanceOwnerAddress,
      now: () => new Date(),
      tronClient: {
        async listTrc20Approvals() {
          return { approvals: [allowanceApproval()], total: 1 };
        },
        async listTrc20ApprovalChanges() {
          return [allowanceChange()];
        },
        async listRelatedTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {};
        },
        async getAddressMetadata() {
          return { ...metadata(), address: allowanceSpenderAddress };
        },
        async getContractIntelligenceProfile() {
          return { ...profile(), address: allowanceSpenderAddress, contractAddress: allowanceSpenderAddress };
        },
        async getUsdtAllowance(request: { ownerAddress: string; spenderAddress: string }) {
          explicitCalls.push(request);
          return "0";
        }
      } as any,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });
    expect(explicitCalls).toEqual([{ ownerAddress: allowanceOwnerAddress, spenderAddress: allowanceSpenderAddress }]);

    const ordinaryCalls: Array<{ ownerAddress: string; spenderAddress: string }> = [];
    let ordinaryNow = new Date("2026-07-13T12:00:00.000Z");
    const ordinaryDeps = allowancePollingDeps({
      claimed: false,
      now: () => ordinaryNow,
      getUsdtAllowance: async (request) => {
        ordinaryCalls.push(request);
        return "0";
      }
    });
    await runSingleApprovalPollingCycle(ordinaryDeps);
    ordinaryNow = new Date(ordinaryNow.getTime() + 60_000);
    await runSingleApprovalPollingCycle(ordinaryDeps);
    expect(ordinaryCalls).toEqual([]);
  });

  it("[REQ-19][ALLOWANCE-REFRESH] maps timeout malformed revert and provider failure to UNKNOWN", async () => {
    const { refreshApprovalAllowance } = await import("../../src/approvals/allowanceRefresh");
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const failures = [
      {
        failureCode: "provider_timeout",
        getUsdtAllowance: async () => {
          throw Object.assign(new Error("full-node request timed out"), { code: "ETIMEDOUT" });
        }
      },
      {
        failureCode: "malformed_response",
        getUsdtAllowance: async () => "0xnot-a-canonical-uint256"
      },
      {
        failureCode: "contract_call_reverted",
        getUsdtAllowance: async () => {
          throw {
            name: "ContractCallError",
            code: "CONTRACT_REVERTED",
            response: { result: { result: false, message: "REVERT opcode" } }
          };
        }
      },
      {
        failureCode: "provider_unavailable",
        getUsdtAllowance: async () => {
          throw Object.assign(new Error("full node unavailable"), { code: "ECONNREFUSED", status: 503 });
        }
      }
    ] as const;

    for (const { failureCode, getUsdtAllowance } of failures) {
      const allowance = await refreshApprovalAllowance({
        client: { getUsdtAllowance },
        ownerAddress: allowanceOwnerAddress,
        spenderAddress: allowanceSpenderAddress,
        observedApprovalTxHash: approvalTxHash,
        now: allowanceNow
      } as any);
      const safety = evaluateApprovalSafetyV2(safetyInput(allowance) as any);
      expect(allowance, failureCode).toMatchObject({
        state: "failed",
        confirmedAllowanceRaw: null,
        isUnlimited: null,
        failureCode
      });
      expect(safety, failureCode).toMatchObject({
        level: "UNKNOWN",
        score: null,
        action: "CONFIRM_ALLOWANCE",
        allowance: {
          state: "failed",
          confirmedAllowanceRaw: null,
          isUnlimited: null,
          failureCode
        }
      });
    }
  });

  it("[REQ-19][ALLOWANCE-REFRESH] never presents historical event allowance as current after refresh failure", async () => {
    await import("../../src/approvals/allowanceRefresh");
    const { evaluateApprovalSafetyV2 } = await import("../../src/approvals/approvalSafetyAssessment");
    const upserts: any[] = [];
    const savedAllowances: any[] = [];

    await runSingleApprovalPollingCycle(allowancePollingDeps({
      claimed: true,
      upserts,
      savedAllowances,
      getUsdtAllowance: async () => {
        throw new Error("provider_timeout");
      }
    }));

    const current = savedAllowances[0]?.allowance ?? savedAllowances[0];
    const safety = evaluateApprovalSafetyV2(safetyInput(current) as any);
    expect(upserts.at(-1)).toMatchObject({ amountRaw: historicalAllowanceRaw, status: "unknown" });
    expect(upserts.at(-1)?.currentAllowanceRaw ?? null).toBeNull();
    expect(current).toMatchObject({
      observedApprovalTxHash: approvalTxHash,
      state: "failed",
      confirmedAllowanceRaw: null,
      isUnlimited: null,
      failureCode: "provider_timeout"
    });
    expect(current.confirmedAllowanceRaw).not.toBe(historicalAllowanceRaw);
    expect(safety).toMatchObject({
      level: "UNKNOWN",
      score: null,
      action: "CONFIRM_ALLOWANCE",
      allowance: { confirmedAllowanceRaw: null, isUnlimited: null }
    });
  });
});
