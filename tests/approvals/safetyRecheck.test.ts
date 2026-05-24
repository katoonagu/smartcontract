import { describe, expect, it } from "vitest";
import { runSafetyRecheck } from "../../src/approvals/safetyRecheck";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { Db } from "../../src/storage/db";
import type { AddressMetadata, ContractIntelligenceProfile } from "../../src/storage/repositories";
import type { ListTrc20ApprovalChangesInput } from "../../src/tron/tronClient";

const walletAddress = "TOwner1111111111111111111111111111111";
const spenderAddress = "TSpender11111111111111111111111111111";
const approvalTxHash = "aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";
const drainTxHash = "cc4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";

function createFakeDb(): { db: Db; queries: Array<{ sql: string; params?: unknown[] }> } {
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
              address: walletAddress,
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

describe("runSafetyRecheck", () => {
  it("rechecks already claimed approvals without owner alerts and records late drain observations", async () => {
    const { db, queries } = createFakeDb();

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
  });

  it("looks beyond the newest approval change when rechecking by approval tx hash", async () => {
    const { db } = createFakeDb();
    const newerTxHash = "bb4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";
    const approvalChangeRequests: ListTrc20ApprovalChangesInput[] = [];

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
  });

  it("persists route-linked session context evidence during safety recheck", async () => {
    const { db, queries } = createFakeDb();
    const routeTxHash = "dd4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2";
    const routeReceiver = "TUrnbc11111111111111111111111111111";

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
        }
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });

    expect(summary).toMatchObject({
      walletFound: true,
      approvalsProcessed: 1,
      riskRowsUpdated: 1
    });
    expect(queries.some((query) => JSON.stringify(query.params).includes("approval_temporally_linked_to_known_swap"))).toBe(true);
  });
});
