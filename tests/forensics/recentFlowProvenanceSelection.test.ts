import { describe, expect, it } from "vitest";
import type { ForensicRouteEdge, RecentFlowPrincipalTransferV1 } from "../../src/types";
import { selectRecentFlowProvenanceTransfers } from "../../src/forensics/recentFlowProvenanceSelection";
import {
  contractPrincipalInput,
  resolveSyntheticEconomicContext,
  syntheticGasFreeFeeEdge,
  syntheticTkgEdges,
  SYNTHETIC_TKG_SUBJECT
} from "../fixtures/forensics/remediationDataCases";

const subject = "TSubject";
const counterparty = "TCounterparty";

function edge(input: {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  iso: string;
}): ForensicRouteEdge {
  return {
    id: input.txHash,
    txHash: input.txHash,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amount,
    timestamp: new Date(input.iso),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

describe("selectRecentFlowProvenanceTransfers", () => {
  it("anchors on the latest meaningful outgoing and selects prior funding inbounds", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "147000",
      edges: [
        edge({
          txHash: "in-1",
          from: "TFunderA",
          to: subject,
          amount: "50000000000",
          iso: "2026-05-05T08:00:00.000Z"
        }),
        edge({
          txHash: "in-2",
          from: "TFunderB",
          to: subject,
          amount: "40000000000",
          iso: "2026-05-05T08:10:00.000Z"
        }),
        edge({
          txHash: "out-1",
          from: subject,
          to: counterparty,
          amount: "89473150000",
          iso: "2026-05-05T08:49:27.000Z"
        })
      ]
    });

    expect(result.provenanceScope).toBe("recent_flow");
    expect(result.selectionMethod).toBe("recent_outgoing");
    expect(result.anchorTransfer?.txHash).toBe("out-1");
    expect(result.targetAmountRaw).toBe("89473150000");
    expect(result.coverageRatio).toBeGreaterThan(0.99);
    expect(result.transfers.map((item) => item.txHash)).toEqual(["in-2", "in-1"]);
    expect(result.transfers.every((item) => item.selectedReason === "funds_recent_outgoing")).toBe(true);
  });

  it("accounts for earlier outgoing spend before selecting funding candidates", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({
          txHash: "in-old",
          from: "TFunderA",
          to: subject,
          amount: "50000000000",
          iso: "2026-05-05T08:00:00.000Z"
        }),
        edge({
          txHash: "spend-before-anchor",
          from: subject,
          to: "TOther",
          amount: "10000000000",
          iso: "2026-05-05T08:20:00.000Z"
        }),
        edge({
          txHash: "in-new",
          from: "TFunderB",
          to: subject,
          amount: "40000000000",
          iso: "2026-05-05T08:30:00.000Z"
        }),
        edge({
          txHash: "out-anchor",
          from: subject,
          to: counterparty,
          amount: "70000000000",
          iso: "2026-05-05T08:49:27.000Z"
        })
      ]
    });

    expect(result.anchorTransfer?.txHash).toBe("out-anchor");
    expect(result.transfers.map((item) => item.txHash)).toEqual(["in-new", "in-old"]);
    expect(result.coverageRatio).toBeGreaterThan(0.99);
  });

  it("stores original and used amounts separately for a large funding transfer", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "1492633",
      edges: [
        edge({
          txHash: "funding-1",
          from: "TFunder",
          to: subject,
          amount: "1885262475832",
          iso: "2026-05-05T13:31:30.000Z"
        }),
        edge({
          txHash: "anchor-out",
          from: subject,
          to: "TBridge",
          amount: "135300000000",
          iso: "2026-05-05T15:00:30.000Z"
        })
      ]
    });

    expect(result.targetAmountRaw).toBe("135300000000");
    expect(result.selectedAmountRaw).toBe("135300000000");
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]).toMatchObject({
      amountRaw: "1885262475832",
      amountUsage: {
        anchorAmountRaw: "135300000000",
        originalAmountRaw: "1885262475832",
        usedAmountRaw: "135300000000",
        coverageShare: 1,
        role: "funding_candidate"
      }
    });
  });

  it("does not count same-timestamp outgoing transfers as prior spend for the anchor", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({
          txHash: "in-before",
          from: "TFunderA",
          to: subject,
          amount: "100000000000",
          iso: "2026-05-05T08:00:00.000Z"
        }),
        edge({
          txHash: "out-anchor",
          from: subject,
          to: counterparty,
          amount: "90000000000",
          iso: "2026-05-05T08:49:27.000Z"
        }),
        edge({
          txHash: "aaa-same-time-out",
          from: subject,
          to: "TOther",
          amount: "50000000000",
          iso: "2026-05-05T08:49:27.000Z"
        })
      ]
    });

    expect(result.anchorTransfer?.txHash).toBe("out-anchor");
    expect(result.transfers.map((item) => item.txHash)).toEqual(["in-before"]);
    expect(result.coverageRatio).toBeGreaterThan(0.99);
  });

  it("falls back to recent significant inbound transfers when no outgoing anchor exists", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "120000",
      edges: [
        edge({
          txHash: "small",
          from: "TA",
          to: subject,
          amount: "100000000",
          iso: "2026-05-03T00:00:00.000Z"
        }),
        edge({
          txHash: "large-old",
          from: "TB",
          to: subject,
          amount: "2000000000",
          iso: "2026-05-04T00:00:00.000Z"
        }),
        edge({
          txHash: "large-new",
          from: "TC",
          to: subject,
          amount: "3000000000",
          iso: "2026-05-05T00:00:00.000Z"
        })
      ]
    });

    expect(result.selectionMethod).toBe("recent_large_inbound");
    expect(result.anchorTransfer?.txHash).toBe("large-new");
    expect(result.transfers.map((item) => item.txHash)).toEqual(["large-new", "large-old"]);
    expect(result.transfers.every((item) => item.selectedReason === "recent_large_inbound")).toBe(true);
  });

  it("does not fall back to dust-only inbound transfers as complete recent-flow provenance", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "120000",
      edges: [
        edge({
          txHash: "dust-a",
          from: "TA",
          to: subject,
          amount: "1000000",
          iso: "2026-05-05T00:00:00.000Z"
        }),
        edge({
          txHash: "dust-b",
          from: "TB",
          to: subject,
          amount: "2000000",
          iso: "2026-05-04T00:00:00.000Z"
        })
      ]
    });

    expect(result.selectionMethod).toBe("recent_large_inbound");
    expect(result.transfers).toEqual([]);
    expect(result.anchorTransfer).toBeNull();
    expect(result.coverageRatio).toBe(0);
    expect(result.partial).toBe(true);
    expect(result.dataScopeNote).toContain("no meaningful recent USDT flow");
  });

  it("[REQ-30][AC-10] selects the synthetic TKg latest-five principal slice including the 305 pair", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: SYNTHETIC_TKG_SUBJECT,
      currentBalanceRaw: "23791",
      edges: syntheticTkgEdges,
      resolveEconomicContext: resolveSyntheticEconomicContext
    });

    const principalTransfers = result.recentFlowPrincipalTransfers ?? [];
    expect(result.selectionMethod).toBe("recent_five_principal");
    expect(result.recentFlowPrincipalTransfers).toBeDefined();
    expect(principalTransfers).toHaveLength(5);
    expect(principalTransfers.map((item: RecentFlowPrincipalTransferV1) => item.txHash)).toEqual([
      "tk-in-305",
      "tk-out-305",
      "contract-principal",
      "gasfree-account-principal",
      "tk-older-principal"
    ]);
  });

  it("[REQ-02][REQ-30][AC-11] excludes exact GasFree fee before taking five principal rows", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: SYNTHETIC_TKG_SUBJECT,
      currentBalanceRaw: "23791",
      edges: syntheticTkgEdges,
      resolveEconomicContext: resolveSyntheticEconomicContext
    });

    const principalTransfers = result.recentFlowPrincipalTransfers ?? [];
    expect(result.recentFlowPrincipalTransfers).toBeDefined();
    expect(principalTransfers.map((item: RecentFlowPrincipalTransferV1) => item.txHash)).toEqual([
      "tk-in-305",
      "tk-out-305",
      "contract-principal",
      "gasfree-account-principal",
      "tk-older-principal"
    ]);
    expect(result.coverageExclusions).toContainEqual(expect.objectContaining({
      reason: "exact_gasfree_service_fee",
      txCount: 1,
      amountRaw: "1500000"
    }));
  });

  it("[REQ-34][AC-12] reports no principal activity only after exact exclusions", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: SYNTHETIC_TKG_SUBJECT,
      currentBalanceRaw: "0",
      edges: [syntheticGasFreeFeeEdge],
      resolveEconomicContext: resolveSyntheticEconomicContext
    });

    expect(result.recentFlowPrincipalTransfers).toBeDefined();
    expect(result.recentFlowPrincipalTransfers ?? []).toEqual([]);
    expect(result.principalActivity).toBe("none");
    expect(result.coverageExclusions).toContainEqual(expect.objectContaining({
      reason: "exact_gasfree_service_fee",
      txCount: 1,
      amountRaw: "1500000"
    }));
  });

  it("[REQ-01][DATA] keeps contract and GasFree-account principal transfers in the slice", async () => {
    const result = await selectRecentFlowProvenanceTransfers(contractPrincipalInput);
    const principalTransfers = result.recentFlowPrincipalTransfers ?? [];
    expect(result.recentFlowPrincipalTransfers).toBeDefined();
    expect(principalTransfers.map((item: RecentFlowPrincipalTransferV1) => item.txHash)).toEqual(expect.arrayContaining([
      "contract-principal",
      "gasfree-account-principal"
    ]));
  });
});
