import { describe, expect, it } from "vitest";
import { buildApprovalSessionContext } from "../../src/approvals/sessionContext";
import type { ApprovalGuardEvent } from "../../src/approvals/approvalRisk";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";

const wallet = "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe";
const spender = "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5";
const routeTx = "route-tx";

function approval(overrides: Partial<ApprovalGuardEvent> = {}): ApprovalGuardEvent {
  return {
    txHash: "approval-tx",
    ownerAddress: wallet,
    spenderAddress: spender,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    timestamp: new Date("2026-05-05T13:42:21.000Z"),
    spenderType: "contract",
    signedAt: new Date("2026-05-05T13:42:19.000Z"),
    expirationAt: new Date("2026-05-05T13:52:19.000Z"),
    refBlockBytes: "abcd",
    refBlockHash: "1234",
    ...overrides
  };
}

describe("buildApprovalSessionContext", () => {
  it("classifies unverified helper approvals as service-linked when a nearby swap route is present", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval(),
      relatedTransfers: [
        {
          transaction_id: routeTx,
          from_address: wallet,
          to_address: "TUrnbc11111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "100000000",
          confirmed: true,
          contractRet: "SUCCESS",
          finalResult: "SUCCESS",
          status: 0,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
          block_ts: Date.parse("2026-05-05T13:42:27.000Z")
        }
      ],
      transactionDetails: new Map([
        [
          routeTx,
          {
            ownerAddress: wallet,
            trigger_info: { methodName: "swap", methodId: "swap" },
            contractData: { owner_address: wallet },
            contractRet: "SUCCESS"
          }
        ]
      ]),
      addressMetadata: new Map([
        [
          "TUrnbc11111111111111111111111111111",
          {
            address: "TUrnbc11111111111111111111111111111",
            source: "tronscan",
            name: "UniV3Adapter",
            tag: "SunSwap Router",
            isContract: true,
            verified: true,
            accountType: 2,
            rawJson: {},
            fetchedAt: new Date(),
            expiresAt: new Date()
          }
        ]
      ]),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("service_linked_helper");
    expect(context.scoreImpact).toBe(-35);
    expect(context.linkedRouteTxHash).toBe(routeTx);
    expect(context.reasons.map((reason) => reason.code)).toContain("approval_temporally_linked_to_known_swap");
    expect(context.rawEvidence[0].evidenceJson).toMatchObject({
      approvalTxHash: "approval-tx",
      signedToBlockDelayMs: 2000,
      refBlockBytes: "abcd",
      refBlockHash: "1234"
    });
  });

  it("classifies missing route evidence as no_route_found without dampening", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval(),
      relatedTransfers: [],
      transactionDetails: new Map(),
      addressMetadata: new Map(),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("no_route_found");
    expect(context.scoreImpact).toBe(0);
    expect(context.reasons.map((reason) => reason.code)).toEqual(["approval_session_no_route_found"]);
  });

  it("classifies direct transfer to a known route spender as known swap route", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval({ spenderAddress: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s" }),
      relatedTransfers: [
        {
          transaction_id: routeTx,
          from_address: wallet,
          to_address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "100000000",
          confirmed: true,
          contractRet: "SUCCESS",
          finalResult: "SUCCESS",
          status: 0,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
          block_ts: Date.parse("2026-05-05T13:42:27.000Z")
        }
      ],
      transactionDetails: new Map([[routeTx, { ownerAddress: wallet, trigger_info: { methodName: "Swap" } }]]),
      addressMetadata: new Map([
        [
          "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
          {
            address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
            source: "tronscan",
            name: "Bridgers",
            tag: "Bridgers:Cross-chain Bridge",
            isContract: true,
            verified: true,
            accountType: 2,
            rawJson: {},
            fetchedAt: new Date(),
            expiresAt: new Date()
          }
        ]
      ]),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("known_swap_route");
    expect(context.scoreImpact).toBe(-20);
    expect(context.linkedRouteTxHash).toBe(routeTx);
  });

  it("classifies transfer to unknown non-service receiver as possible collector drain", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval(),
      relatedTransfers: [
        {
          transaction_id: "collector-tx",
          from_address: wallet,
          to_address: "TCollector111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "50000000000",
          confirmed: true,
          contractRet: "SUCCESS",
          finalResult: "SUCCESS",
          status: 0,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
          block_ts: Date.parse("2026-05-05T13:42:27.000Z")
        }
      ],
      transactionDetails: new Map([["collector-tx", { ownerAddress: spender, trigger_info: { methodName: "transferFrom" } }]]),
      addressMetadata: new Map(),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("possible_collector_drain");
    expect(context.scoreImpact).toBe(35);
    expect(context.reasons.map((reason) => reason.code)).toContain("approval_session_possible_collector_drain");
  });

  it("does not classify a nearby normal user transfer as collector drain", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval(),
      relatedTransfers: [
        {
          transaction_id: "normal-transfer-tx",
          from_address: wallet,
          to_address: "TReceiver1111111111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "50000000000",
          confirmed: true,
          contractRet: "SUCCESS",
          finalResult: "SUCCESS",
          status: 0,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
          block_ts: Date.parse("2026-05-05T13:42:27.000Z")
        }
      ],
      transactionDetails: new Map([["normal-transfer-tx", { ownerAddress: wallet, trigger_info: { methodName: "transfer" } }]]),
      addressMetadata: new Map(),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("no_route_found");
    expect(context.scoreImpact).toBe(0);
  });

  it("does not dampen from route-like method names without service metadata", () => {
    const context = buildApprovalSessionContext({
      watchedWalletId: "wallet-1",
      approval: approval(),
      relatedTransfers: [
        {
          transaction_id: "method-only-route-tx",
          from_address: wallet,
          to_address: "TUnknownRouter11111111111111111111111",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          quant: "100000000",
          confirmed: true,
          contractRet: "SUCCESS",
          finalResult: "SUCCESS",
          status: 0,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenType: "trc20", tokenAbbr: "USDT", tokenDecimal: 6 },
          block_ts: Date.parse("2026-05-05T13:42:27.000Z")
        }
      ],
      transactionDetails: new Map([["method-only-route-tx", { ownerAddress: wallet, trigger_info: { methodName: "swap" } }]]),
      addressMetadata: new Map(),
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(context.classification).toBe("no_route_found");
    expect(context.reasons.map((reason) => reason.code)).not.toContain("approval_temporally_linked_to_known_swap");
  });
});
