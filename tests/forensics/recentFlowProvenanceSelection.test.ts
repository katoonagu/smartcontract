import { describe, expect, it, vi } from "vitest";
import type { ForensicRouteEdge, RecentFlowPrincipalTransferV1 } from "../../src/types";
import { buildForensicCoverageV2 } from "../../src/forensics/forensicCoverageV2";
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

  it("uses the latest principal inbound slice when no outgoing anchor exists", async () => {
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

    expect(result.selectionMethod).toBe("recent_five_principal");
    expect(result.anchorTransfer).toBeNull();
    expect(result.transfers.map((item) => item.txHash)).toEqual(["large-new", "large-old", "small"]);
    expect(result.transfers.every((item) => item.selectedReason === "recent_large_inbound")).toBe(true);
  });

  it("keeps dust-only inbound transfers visible in the latest principal slice", async () => {
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

    expect(result.selectionMethod).toBe("recent_five_principal");
    expect(result.transfers.map((item) => item.txHash)).toEqual(["dust-a", "dust-b"]);
    expect(result.anchorTransfer).toBeNull();
    expect(result.coverageRatio).toBe(1);
    expect(result.partial).toBe(false);
    expect(result.dataScopeNote).toContain("five-transfer principal slice");
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
    const resolveEconomicContext = vi.fn(resolveSyntheticEconomicContext);
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: SYNTHETIC_TKG_SUBJECT,
      currentBalanceRaw: "23791",
      edges: syntheticTkgEdges,
      resolveEconomicContext
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
    expect(resolveEconomicContext.mock.calls.map(([item]) => item.txHash)).not.toContain("tk-archived-principal");
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

  it("[REQ-30][AC-10] preserves a large outgoing anchor beyond the latest-five candidate bound", async () => {
    const newerSmallEdges = Array.from({ length: 10 }, (_, index) => edge({
      txHash: `newer-small-${index}`,
      from: `TNewer${index}`,
      to: subject,
      amount: "1000000",
      iso: `2026-05-05T09:${String(59 - index).padStart(2, "0")}:00.000Z`
    }));
    const largeAnchor = edge({
      txHash: "large-anchor-at-eleven",
      from: subject,
      to: counterparty,
      amount: "2000000000",
      iso: "2026-05-05T09:40:00.000Z"
    });
    const funding = edge({
      txHash: "funding-before-large-anchor",
      from: "TLargeFunder",
      to: subject,
      amount: "2000000000",
      iso: "2026-05-05T09:30:00.000Z"
    });
    const resolveEconomicContext = vi.fn(async (item: ForensicRouteEdge) => item);

    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [...newerSmallEdges, largeAnchor, funding],
      resolveEconomicContext
    });

    expect(result.selectionMethod).toBe("recent_outgoing");
    expect(result.anchorTransfer?.txHash).toBe("large-anchor-at-eleven");
    expect(result.transfers.map((item) => item.txHash)).toContain("funding-before-large-anchor");
    expect(resolveEconomicContext).toHaveBeenCalledTimes(2);
    expect(resolveEconomicContext.mock.calls.map(([item]) => item.txHash)).toContain("large-anchor-at-eleven");
  });

  it("[REQ-02][REQ-30][AC-11] keeps exact enriched fees out of the large-outgoing funding selection", async () => {
    const exactFee = {
      ...edge({
        txHash: "large-path-exact-fee",
        from: "TGasFreeFeePayer",
        to: subject,
        amount: "1500000",
        iso: "2026-05-05T08:50:00.000Z"
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    };
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({ txHash: "large-path-anchor", from: subject, to: counterparty, amount: "2000000000", iso: "2026-05-05T09:00:00.000Z" }),
        exactFee,
        edge({ txHash: "large-path-funding", from: "TFunder", to: subject, amount: "2000000000", iso: "2026-05-05T08:00:00.000Z" })
      ],
      resolveEconomicContext: async (item) => item
    });

    expect(result.transfers.map((item) => item.txHash)).toEqual(["large-path-funding"]);
    expect(result.coverageRatio).toBe(1);
    expect(result.coverageExclusions).toContainEqual({
      reason: "exact_gasfree_service_fee",
      direction: "incoming",
      txCount: 1,
      amountRaw: "1500000",
      evidenceIds: ["large-path-exact-fee"]
    });
  });

  it.each([0, -1, Number.NaN, 1.5])(
    "[REQ-30][AC-10] normalizes invalid maxCandidates=%s to the safe default",
    async (maxCandidates) => {
      const resolveEconomicContext = vi.fn(resolveSyntheticEconomicContext);
      const result = await selectRecentFlowProvenanceTransfers({
        subjectAddress: SYNTHETIC_TKG_SUBJECT,
        currentBalanceRaw: "23791",
        edges: syntheticTkgEdges,
        maxCandidates,
        resolveEconomicContext
      });

      expect(result.recentFlowPrincipalTransfers).toHaveLength(5);
      expect(resolveEconomicContext).toHaveBeenCalledTimes(6);
    }
  );

  it.each([
    { maxCandidates: -1, expectedTransfers: 10, expectedAvailable: 10, expectedResolverCalls: 11 },
    { maxCandidates: 12, expectedTransfers: 12, expectedAvailable: 12, expectedResolverCalls: 13 }
  ])(
    "[REQ-30][AC-10] applies normalized maxCandidates=$maxCandidates to large-outgoing funding candidates",
    async ({ maxCandidates, expectedTransfers, expectedAvailable, expectedResolverCalls }) => {
      const largeAnchor = edge({
        txHash: "normalized-large-anchor",
        from: subject,
        to: counterparty,
        amount: "12000000000",
        iso: "2026-05-05T10:00:00.000Z"
      });
      const funding = Array.from({ length: 12 }, (_, index) => edge({
        txHash: `normalized-funding-${index}`,
        from: `TFunder${index}`,
        to: subject,
        amount: "1000000000",
        iso: `2026-05-05T09:${String(59 - index).padStart(2, "0")}:00.000Z`
      }));
      const resolveEconomicContext = vi.fn(async (item: ForensicRouteEdge) => item);

      const result = await selectRecentFlowProvenanceTransfers({
        subjectAddress: subject,
        currentBalanceRaw: "0",
        edges: [largeAnchor, ...funding],
        maxCandidates,
        resolveEconomicContext
      });

      expect(result.transfers).toHaveLength(expectedTransfers);
      expect(result.availableInboundTxCount).toBe(expectedAvailable);
      expect(resolveEconomicContext).toHaveBeenCalledTimes(expectedResolverCalls);
    }
  );

  it("[REQ-02][REQ-30][AC-11] does not exclude an older exact fee outside the inspected slice", async () => {
    const freshPrincipal = Array.from({ length: 5 }, (_, index) => edge({
      txHash: `fresh-principal-${index}`,
      from: `TFresh${index}`,
      to: subject,
      amount: "1000000",
      iso: `2026-05-05T09:${String(59 - index).padStart(2, "0")}:00.000Z`
    }));
    const olderExactFee = {
      ...edge({
        txHash: "older-uninspected-exact-fee",
        from: subject,
        to: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird",
        amount: "1500000",
        iso: "2026-05-05T09:30:00.000Z"
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    };
    const resolveEconomicContext = vi.fn(async (item: ForensicRouteEdge) => item);

    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [...freshPrincipal, olderExactFee],
      resolveEconomicContext
    });

    expect(result.recentFlowPrincipalTransfers).toHaveLength(5);
    expect(result.coverageExclusions).not.toContainEqual(expect.objectContaining({
      reason: "exact_gasfree_service_fee"
    }));
    expect(resolveEconomicContext).toHaveBeenCalledTimes(5);
    expect(resolveEconomicContext.mock.calls.map(([item]) => item.txHash)).not.toContain("older-uninspected-exact-fee");
  });

  it("[REQ-30][AC-10] scans past ten dust inbounds to significant large-anchor funding", async () => {
    const dust = Array.from({ length: 10 }, (_, index) => edge({
      txHash: `large-scan-dust-${index}`,
      from: `TDustFunder${index}`,
      to: subject,
      amount: "1000000",
      iso: `2026-05-05T09:${String(59 - index).padStart(2, "0")}:00.000Z`
    }));
    const strongFunding = edge({
      txHash: "large-scan-strong-funding",
      from: "TStrongFunder",
      to: subject,
      amount: "2000000000",
      iso: "2026-05-05T09:40:00.000Z"
    });
    const uncheckedOlderTail = edge({
      txHash: "large-scan-unchecked-tail",
      from: "TOlderTail",
      to: subject,
      amount: "2000000000",
      iso: "2026-05-05T09:30:00.000Z"
    });
    const resolveEconomicContext = vi.fn(async (item: ForensicRouteEdge) => item);

    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({ txHash: "large-scan-anchor", from: subject, to: counterparty, amount: "2000000000", iso: "2026-05-05T10:00:00.000Z" }),
        ...dust,
        strongFunding,
        uncheckedOlderTail
      ],
      maxCandidates: 10,
      resolveEconomicContext
    });

    expect(result.transfers.map((item) => item.txHash)).toEqual(["large-scan-strong-funding"]);
    expect(result.availableInboundTxCount).toBe(1);
    expect(resolveEconomicContext).toHaveBeenCalledTimes(2);
    expect(resolveEconomicContext.mock.calls.map(([item]) => item.txHash)).not.toContain("large-scan-unchecked-tail");
    const exclusionEvidenceIds = result.coverageExclusions?.flatMap((item) => item.evidenceIds) ?? [];
    expect(exclusionEvidenceIds).toEqual([]);
    expect(exclusionEvidenceIds).not.toContain("large-scan-unchecked-tail");
    expect(() => buildForensicCoverageV2({
      scope: "recent_flow",
      availableInboundTxCount: result.availableInboundTxCount ?? null,
      selectedInboundTxCount: result.transfers.length,
      selectedAmountRaw: result.selectedAmountRaw,
      tracedAmountRaw: result.selectedAmountRaw,
      exclusions: result.coverageExclusions ?? [],
      limitations: []
    })).not.toThrow();
  });

  it("[REQ-30][AC-10] caps a larger inbound at the outgoing amount", async () => {
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({ txHash: "out-100", from: subject, to: counterparty, amount: "100000000", iso: "2026-05-05T09:00:00.000Z" }),
        edge({ txHash: "in-200", from: "TFunder", to: subject, amount: "200000000", iso: "2026-05-05T08:00:00.000Z" })
      ]
    });

    expect(result.selectedAmountRaw).toBe("100000000");
    expect(result.selectedVolumeRaw).toBe("100000000");
    expect(result.coverageRatio).toBe(1);
    expect(result.transfers[0]?.amountUsage?.usedAmountRaw).toBe("100000000");
  });

  it("[REQ-01][REQ-02] keeps an unmatched TLnt-like fee-sized transfer as principal", async () => {
    const unmatchedTlnt = {
      ...syntheticGasFreeFeeEdge,
      id: "unmatched-tlnt-like",
      txHash: "unmatched-tlnt-like",
      toAddress: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird"
    };
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: SYNTHETIC_TKG_SUBJECT,
      currentBalanceRaw: "0",
      edges: [unmatchedTlnt],
      resolveEconomicContext: async (item) => item
    });

    expect(result.recentFlowPrincipalTransfers?.map((item) => item.txHash)).toEqual(["unmatched-tlnt-like"]);
    expect(result.coverageExclusions).not.toContainEqual(expect.objectContaining({
      reason: "exact_gasfree_service_fee"
    }));
  });

  it("[REQ-02][REQ-30][AC-11] reconciles incoming and outgoing exact fees separately in recent-five coverage", async () => {
    const principal = Array.from({ length: 5 }, (_, index) => edge({
      txHash: `mixed-fee-principal-${index}`,
      from: `TMixedFunder${index}`,
      to: subject,
      amount: "100000000",
      iso: `2026-05-05T09:${String(59 - index * 2).padStart(2, "0")}:00.000Z`
    }));
    const incomingFee = {
      ...edge({
        txHash: "mixed-fee-incoming",
        from: "TGasFreeFeePayer",
        to: subject,
        amount: "1000000",
        iso: "2026-05-05T09:58:00.000Z"
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    };
    const outgoingFee = {
      ...edge({
        txHash: "mixed-fee-outgoing",
        from: subject,
        to: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird",
        amount: "1500000",
        iso: "2026-05-05T09:56:00.000Z"
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    };
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [principal[0], incomingFee, principal[1], outgoingFee, ...principal.slice(2)],
      resolveEconomicContext: async (item) => item
    });

    expect(result.recentFlowPrincipalTransfers).toHaveLength(5);
    expect(result.transfers).toHaveLength(5);
    expect(result.availableInboundTxCount).toBe(6);
    expect(result.coverageExclusions).toEqual(expect.arrayContaining([
      {
        reason: "exact_gasfree_service_fee",
        direction: "incoming",
        txCount: 1,
        amountRaw: "1000000",
        evidenceIds: ["mixed-fee-incoming"]
      },
      {
        reason: "exact_gasfree_service_fee",
        direction: "outgoing",
        txCount: 1,
        amountRaw: "1500000",
        evidenceIds: ["mixed-fee-outgoing"]
      }
    ]));
    expect(() => buildForensicCoverageV2({
      scope: "recent_flow",
      availableInboundTxCount: result.availableInboundTxCount ?? null,
      selectedInboundTxCount: result.transfers.length,
      selectedAmountRaw: result.selectedAmountRaw,
      tracedAmountRaw: result.selectedAmountRaw,
      exclusions: result.coverageExclusions ?? [],
      limitations: []
    })).not.toThrow();
  });

  it("[REQ-02][REQ-30][AC-11] reconciles mixed fee directions on the large-anchor path", async () => {
    const incomingFee = {
      ...edge({
        txHash: "large-mixed-fee-incoming",
        from: "TGasFreeFeePayer",
        to: subject,
        amount: "2000000",
        iso: "2026-05-05T09:59:00.000Z"
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    };
    const outgoingFee = {
      ...edge({
        txHash: "large-mixed-fee-outgoing",
        from: subject,
        to: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird",
        amount: "1500000000",
        iso: "2026-05-05T10:01:00.000Z"
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    };
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({ txHash: "large-mixed-anchor", from: subject, to: counterparty, amount: "2000000000", iso: "2026-05-05T10:00:00.000Z" }),
        incomingFee,
        outgoingFee,
        edge({ txHash: "large-mixed-funding", from: "TFunder", to: subject, amount: "2000000000", iso: "2026-05-05T09:00:00.000Z" })
      ],
      resolveEconomicContext: async (item) => item
    });

    expect(result.transfers.map((item) => item.txHash)).toEqual(["large-mixed-funding"]);
    expect(result.availableInboundTxCount).toBe(2);
    expect(result.coverageExclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: "incoming",
        txCount: 1,
        amountRaw: "2000000",
        evidenceIds: ["large-mixed-fee-incoming"]
      }),
      expect.objectContaining({
        direction: "outgoing",
        txCount: 1,
        amountRaw: "1500000000",
        evidenceIds: ["large-mixed-fee-outgoing"]
      })
    ]));
    expect(() => buildForensicCoverageV2({
      scope: "recent_flow",
      availableInboundTxCount: result.availableInboundTxCount ?? null,
      selectedInboundTxCount: result.transfers.length,
      selectedAmountRaw: result.selectedAmountRaw,
      tracedAmountRaw: result.selectedAmountRaw,
      exclusions: result.coverageExclusions ?? [],
      limitations: []
    })).not.toThrow();
  });

  it("[REQ-02][REQ-30][AC-11] scans past an exact incoming fee to bounded tail funding", async () => {
    const anchor = edge({
      txHash: "bounded-large-anchor",
      from: subject,
      to: counterparty,
      amount: "2000000000",
      iso: "2026-05-05T10:00:00.000Z"
    });
    const inspectedNoise = Array.from({ length: 9 }, (_, index) => edge({
      txHash: `bounded-noise-${index}`,
      from: `TNoise${index}`,
      to: subject,
      amount: "1000000",
      iso: `2026-05-05T09:${String(59 - index).padStart(2, "0")}:00.000Z`
    }));
    const tailIncomingFee = {
      ...edge({
        txHash: "tail-incoming-fee-row-11",
        from: "TTailFeePayer",
        to: subject,
        amount: "1500000",
        iso: "2026-05-05T09:49:00.000Z"
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    };
    const tailFunding = edge({
      txHash: "tail-funding-row-12",
      from: "TTailFunder",
      to: subject,
      amount: "2000000000",
      iso: "2026-05-05T09:00:00.000Z"
    });
    const resolveEconomicContext = vi.fn(async (item: ForensicRouteEdge) => item);

    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [anchor, ...inspectedNoise, tailIncomingFee, tailFunding],
      resolveEconomicContext
    });

    expect(resolveEconomicContext).toHaveBeenCalledTimes(2);
    expect(result.transfers.map((item) => item.txHash)).toEqual(["tail-funding-row-12"]);
    expect(result.availableInboundTxCount).toBe(2);
    const exclusionEvidenceIds = result.coverageExclusions?.flatMap((item) => item.evidenceIds) ?? [];
    expect(exclusionEvidenceIds).toContain("tail-incoming-fee-row-11");
    expect(exclusionEvidenceIds).toEqual(["tail-incoming-fee-row-11"]);
    expect(exclusionEvidenceIds).not.toContain("tail-funding-row-12");
    expect(result.coverageExclusions
      ?.filter((item) => item.direction === "incoming")
      .reduce((sum, item) => sum + item.txCount, 0)).toBe(1);
    expect(() => buildForensicCoverageV2({
      scope: "recent_flow",
      availableInboundTxCount: result.availableInboundTxCount ?? null,
      selectedInboundTxCount: result.transfers.length,
      selectedAmountRaw: result.selectedAmountRaw,
      tracedAmountRaw: result.selectedAmountRaw,
      exclusions: result.coverageExclusions ?? [],
      limitations: []
    })).not.toThrow();
  });

  it("[REQ-02][REQ-30][AC-11] rejects an exact GasFree self-edge deterministically", async () => {
    const selfFee = {
      ...edge({
        txHash: "gasfree-self-fee",
        from: subject,
        to: subject,
        amount: "1500000",
        iso: "2026-05-05T09:00:00.000Z"
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    };

    await expect(selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [selfFee],
      resolveEconomicContext: async (item) => item
    })).rejects.toThrow("exact GasFree fee edge must have exactly one subject endpoint");
  });

  it("[REQ-30][AC-10] deduplicates inspected large-anchor edges by stable event id", async () => {
    const funding = edge({
      txHash: "duplicate-inspected-funding",
      from: "TDuplicateFunder",
      to: subject,
      amount: "2000000000",
      iso: "2026-05-05T09:00:00.000Z"
    });
    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({ txHash: "duplicate-inspected-anchor", from: subject, to: counterparty, amount: "2000000000", iso: "2026-05-05T10:00:00.000Z" }),
        funding,
        { ...funding }
      ],
      maxCandidates: 3,
      resolveEconomicContext: async (item) => item
    });

    expect(result.transfers.map((item) => item.evidenceId)).toEqual(["duplicate-inspected-funding"]);
    expect(result.availableInboundTxCount).toBe(1);
  });

  it("[REQ-30][AC-10] hard-caps provider resolution for thousands of dust candidates", async () => {
    const dust = Array.from({ length: 5_000 }, (_, index) => edge({
      txHash: `stress-dust-${index}`,
      from: `TStress${index}`,
      to: subject,
      amount: "1000000",
      iso: new Date(Date.UTC(2026, 4, 5, 9, 59) - index * 1_000).toISOString()
    }));
    const resolveEconomicContext = vi.fn(async (item: ForensicRouteEdge) => item);

    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({ txHash: "stress-anchor", from: subject, to: counterparty, amount: "10000000000", iso: "2026-05-05T10:00:00.000Z" }),
        ...dust
      ],
      maxCandidates: 10,
      resolveEconomicContext
    });

    expect(resolveEconomicContext).toHaveBeenCalledTimes(11);
    expect(result.transfers).toHaveLength(10);
    expect(result.availableInboundTxCount).toBe(10);
    expect(result.partial).toBe(true);
    expect(result.notes.join(" ")).toContain("maxCandidates=10");
  });

  it("[REQ-02][REQ-30][AC-11] lets exact fees consume the bounded inspected scope", async () => {
    const fee = (index: number) => ({
      ...edge({
        txHash: `bounded-displacement-fee-${index}`,
        from: `TFeePayer${index}`,
        to: subject,
        amount: "1500000",
        iso: `2026-05-05T09:5${9 - index}:00.000Z`
      }),
      economicProtocol: "tron_gasfree" as const,
      economicRole: "service_fee" as const
    });
    const strongFunding = edge({
      txHash: "bounded-displacement-strong",
      from: "TStrongFunding",
      to: subject,
      amount: "2000000000",
      iso: "2026-05-05T09:50:00.000Z"
    });
    const resolveEconomicContext = vi.fn(async (item: ForensicRouteEdge) => item);

    const result = await selectRecentFlowProvenanceTransfers({
      subjectAddress: subject,
      currentBalanceRaw: "0",
      edges: [
        edge({ txHash: "bounded-displacement-anchor", from: subject, to: counterparty, amount: "2000000000", iso: "2026-05-05T10:00:00.000Z" }),
        fee(0),
        fee(1),
        strongFunding
      ],
      maxCandidates: 2,
      resolveEconomicContext
    });

    expect(result.transfers).toEqual([]);
    expect(result.availableInboundTxCount).toBe(2);
    expect(result.coverageExclusions).toContainEqual(expect.objectContaining({
      direction: "incoming",
      txCount: 2,
      evidenceIds: ["bounded-displacement-fee-0", "bounded-displacement-fee-1"]
    }));
    expect(resolveEconomicContext.mock.calls.map(([item]) => item.txHash)).not.toContain("bounded-displacement-strong");
    expect(result.partial).toBe(true);
    expect(() => buildForensicCoverageV2({
      scope: "recent_flow",
      availableInboundTxCount: result.availableInboundTxCount ?? null,
      selectedInboundTxCount: result.transfers.length,
      selectedAmountRaw: result.selectedAmountRaw,
      tracedAmountRaw: result.selectedAmountRaw,
      exclusions: result.coverageExclusions ?? [],
      limitations: []
    })).not.toThrow();
  });
});
