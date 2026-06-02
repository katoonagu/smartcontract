import { describe, expect, it } from "vitest";
import { evaluateCrossChainStage2Trigger } from "../../src/forensics/crossChainStage2Triggers";
import type {
  BalanceFormingSelection,
  BalanceFormingTransfer,
  MoneyOriginDrainEpisode,
  MoneyOriginPath,
  SourcePolicyEvidence,
  WhereIsMoneyAssessment
} from "../../src/types";

const LOW_RAW = "9000000000";
const MEDIUM_RAW = "50000000000";
const SPLIT_A_RAW = "60000000000";
const SPLIT_B_RAW = "45000000000";
const LARGE_RAW = "100000000000";

const checkedWallet = "TCheckedWallet11111111111111111111111";
const sender = "TSender111111111111111111111111111111";
const source = "TSource111111111111111111111111111111";

function transfer(overrides: Partial<BalanceFormingTransfer> = {}): BalanceFormingTransfer {
  return {
    txHash: "tx-large",
    fromAddress: sender,
    toAddress: checkedWallet,
    amountRaw: LARGE_RAW,
    timestamp: "2026-05-20T10:00:00.000Z",
    coverageShare: 1,
    selectedReason: "covers_requested_amount",
    ...overrides
  };
}

function selection(overrides: Partial<BalanceFormingSelection> = {}): BalanceFormingSelection {
  const transfers = overrides.transfers ?? [transfer()];

  return {
    currentBalanceRaw: LARGE_RAW,
    requestedAmountRaw: LARGE_RAW,
    targetAmountRaw: LARGE_RAW,
    selectedAmountRaw: LARGE_RAW,
    coverageRatio: 1,
    selectedVolumeRaw: LARGE_RAW,
    currentBalanceCoverageRatio: 1,
    partial: false,
    provenanceScope: "requested_amount",
    selectionMethod: "requested_amount",
    notes: [],
    ...overrides,
    transfers
  };
}

function originPath(overrides: Partial<MoneyOriginPath> = {}): MoneyOriginPath {
  const balanceTransferTxHash = overrides.balanceTransferTxHash ?? "tx-large";
  const pathSender = overrides.steps?.at(-1)?.fromAddress ?? sender;
  const pathRecipient = overrides.steps?.at(-1)?.toAddress ?? checkedWallet;
  const amountRaw = overrides.steps?.at(-1)?.amountRaw ?? LARGE_RAW;
  const timestamp = overrides.steps?.at(-1)?.timestamp ?? "2026-05-20T10:00:00.000Z";

  return {
    balanceTransferTxHash,
    rootSourceAddress: source,
    rootSourceType: "decline_boundary",
    balanceShare: 1,
    exposureSourceKey: "layerzero",
    exposureSourceLabel: "LayerZero bridge",
    sourceExposureKind: "cross_chain_boundary",
    pathAddresses: [source, pathSender, pathRecipient],
    txHashes: [`${balanceTransferTxHash}-hop`, balanceTransferTxHash],
    steps: [
      {
        txHash: `${balanceTransferTxHash}-hop`,
        fromAddress: source,
        toAddress: pathSender,
        amountRaw,
        timestamp: "2026-05-20T09:55:00.000Z"
      },
      {
        txHash: balanceTransferTxHash,
        fromAddress: pathSender,
        toAddress: pathRecipient,
        amountRaw,
        timestamp
      }
    ],
    amountPreservationRatio: 1,
    timeSpanMs: 5 * 60 * 1000,
    stoppedReason: "decline_boundary_reached",
    verdict: "DECLINE",
    riskScoreContribution: 78,
    reasons: ["Balance-forming path reaches a LayerZero bridge boundary."],
    ...overrides
  };
}

function sourcePolicy(kind: SourcePolicyEvidence["kind"]): SourcePolicyEvidence {
  return {
    kind,
    aggregateShare: 1,
    effectiveShare: 1,
    pathCount: 1,
    score: 90,
    riskBand: "HIGH",
    proofLevel: "exchange_policy_decline",
    canBeDampened: false,
    reasons: [`Direct ${kind} clue already present.`],
    warnings: [],
    evidenceIds: [`evidence:${kind}`]
  };
}

function assessment(overrides: Partial<WhereIsMoneyAssessment> = {}): WhereIsMoneyAssessment {
  return {
    decision: "REVIEW",
    riskScore: 50,
    riskBand: "MEDIUM",
    provenanceConfidence: 0.8,
    coverageCompleteness: 0.8,
    walletRole: "unknown_wallet",
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: [],
    warnings: [],
    ...overrides
  };
}

function drainEpisode(overrides: Partial<MoneyOriginDrainEpisode> = {}): MoneyOriginDrainEpisode {
  return {
    anchorTxHash: "tx-drain-anchor",
    fundingTxHash: "tx-drain-funding",
    fundingAmountRaw: "300000000000",
    fundingTimestamp: "2026-05-20T09:00:00.000Z",
    startTimestamp: "2026-05-20T10:00:00.000Z",
    endTimestamp: "2026-05-20T12:00:00.000Z",
    episodeOutgoingRaw: "300000000000",
    episodeSelectedRaw: "0",
    episodeCoverageRatio: 0,
    outgoingTxHashes: ["tx-drain-bridge-a", "tx-drain-bridge-a", "tx-drain-spend-b"],
    bridgeOutgoingRaw: LARGE_RAW,
    bridgeOutgoingShare: 0.1,
    ...overrides
  };
}

describe("cross-chain stage 2 trigger evaluator", () => {
  it("triggers from drain episode bridge exposure above amount threshold without visible boundary paths", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [],
        selectedAmountRaw: "0",
        selectedVolumeRaw: "0",
        targetAmountRaw: "300000000000"
      }),
      originPaths: [],
      assessment: assessment(),
      drainEpisode: drainEpisode()
    });

    expect(result).toEqual({
      triggered: true,
      reason: "drain_episode_bridge_exposure",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-drain-bridge-a", "tx-drain-spend-b"],
      selectedAmountRaw: LARGE_RAW,
      targetAmountRaw: "300000000000"
    });
  });

  it("triggers from drain episode bridge share even when bridge amount is below amount threshold", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [],
        selectedAmountRaw: "0",
        selectedVolumeRaw: "0",
        targetAmountRaw: "300000000000"
      }),
      originPaths: [],
      assessment: assessment(),
      drainEpisode: drainEpisode({
        bridgeOutgoingRaw: LOW_RAW,
        bridgeOutgoingShare: 0.25
      })
    });

    expect(result).toMatchObject({
      triggered: true,
      reason: "drain_episode_bridge_exposure",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-drain-bridge-a", "tx-drain-spend-b"],
      selectedAmountRaw: LOW_RAW,
      targetAmountRaw: "300000000000"
    });
  });

  it("falls through to visible boundary logic when drain episode bridge exposure is below thresholds", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection(),
      originPaths: [originPath()],
      assessment: assessment(),
      drainEpisode: drainEpisode({
        bridgeOutgoingRaw: LOW_RAW,
        bridgeOutgoingShare: 0.1
      })
    });

    expect(result).toMatchObject({
      triggered: true,
      reason: "large_single_boundary",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-large"]
    });
  });

  it("keeps manual deep mode precedence over drain episode bridge exposure", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [transfer({ txHash: "tx-manual-drain", amountRaw: LOW_RAW })],
        selectedAmountRaw: LOW_RAW,
        selectedVolumeRaw: LOW_RAW,
        targetAmountRaw: LOW_RAW,
        requestedAmountRaw: LOW_RAW
      }),
      originPaths: [],
      assessment: assessment(),
      manualDeepMode: true,
      drainEpisode: drainEpisode()
    });

    expect(result).toEqual({
      triggered: true,
      reason: "manual_deep_mode",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-manual-drain"],
      selectedAmountRaw: LOW_RAW,
      targetAmountRaw: LOW_RAW
    });
  });

  it("triggers large single requested-amount bridge boundary", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection(),
      originPaths: [originPath()],
      assessment: assessment()
    });

    expect(result).toEqual({
      triggered: true,
      reason: "large_single_boundary",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-large"],
      selectedAmountRaw: LARGE_RAW,
      targetAmountRaw: LARGE_RAW
    });
  });

  it("triggers transaction-seeded large bridge boundary", () => {
    const seedTransfer = transfer({
      txHash: "tx-seed",
      amountRaw: LARGE_RAW,
      selectedReason: "covers_requested_amount"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [seedTransfer],
        provenanceScope: "transaction_seed",
        selectionMethod: "transaction_seed",
        requestedAmountRaw: LARGE_RAW,
        selectedAmountRaw: LARGE_RAW,
        targetAmountRaw: LARGE_RAW
      }),
      originPaths: [originPath({ balanceTransferTxHash: "tx-seed" })],
      assessment: assessment()
    });

    expect(result).toMatchObject({
      triggered: true,
      reason: "large_single_boundary",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-seed"],
      selectedAmountRaw: LARGE_RAW,
      targetAmountRaw: LARGE_RAW
    });
  });

  it("skips transaction-seeded medium concrete amount even when selection metadata is large", () => {
    const seedTransfer = transfer({
      txHash: "tx-seed-medium",
      amountRaw: MEDIUM_RAW,
      selectedReason: "covers_requested_amount"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [seedTransfer],
        provenanceScope: "transaction_seed",
        selectionMethod: "transaction_seed",
        requestedAmountRaw: null,
        selectedAmountRaw: LARGE_RAW,
        targetAmountRaw: LARGE_RAW
      }),
      originPaths: [originPath({ balanceTransferTxHash: "tx-seed-medium" })],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("direct high-risk");
    expect(result.balanceTransferTxHashes).toEqual(["tx-seed-medium"]);
  });

  it("skips transaction-seeded medium concrete amount even when requested metadata is large", () => {
    const seedTransfer = transfer({
      txHash: "tx-seed-medium-requested",
      amountRaw: MEDIUM_RAW,
      selectedReason: "covers_requested_amount"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [seedTransfer],
        provenanceScope: "transaction_seed",
        selectionMethod: "transaction_seed",
        requestedAmountRaw: LARGE_RAW,
        selectedAmountRaw: LARGE_RAW,
        targetAmountRaw: LARGE_RAW
      }),
      originPaths: [originPath({ balanceTransferTxHash: "tx-seed-medium-requested" })],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("direct high-risk");
    expect(result.balanceTransferTxHashes).toEqual(["tx-seed-medium-requested"]);
  });

  it("skips transaction-seeded low concrete amount with direct high-risk clue despite large metadata", () => {
    const seedTransfer = transfer({
      txHash: "tx-seed-low-high-risk",
      amountRaw: LOW_RAW,
      selectedReason: "covers_requested_amount"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [seedTransfer],
        provenanceScope: "transaction_seed",
        selectionMethod: "transaction_seed",
        requestedAmountRaw: LARGE_RAW,
        selectedAmountRaw: LARGE_RAW,
        targetAmountRaw: LARGE_RAW
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-seed-low-high-risk",
          sourceExposureKind: "mixer",
          exposureSourceKey: "tornado",
          exposureSourceLabel: "Tornado Cash"
        })
      ],
      assessment: assessment({
        sourcePolicyEvidence: [sourcePolicy("mixer")]
      })
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("low amount");
    expect(result.balanceTransferTxHashes).toEqual(["tx-seed-low-high-risk"]);
  });

  it("triggers transaction-seeded medium concrete amount with direct high-risk clue", () => {
    const seedTransfer = transfer({
      txHash: "tx-seed-medium-high-risk",
      amountRaw: MEDIUM_RAW,
      selectedReason: "covers_requested_amount"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [seedTransfer],
        provenanceScope: "transaction_seed",
        selectionMethod: "transaction_seed",
        requestedAmountRaw: null,
        selectedAmountRaw: LARGE_RAW,
        targetAmountRaw: LARGE_RAW
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-seed-medium-high-risk",
          sourceExposureKind: "mixer",
          exposureSourceKey: "tornado",
          exposureSourceLabel: "Tornado Cash"
        })
      ],
      assessment: assessment({
        sourcePolicyEvidence: [sourcePolicy("mixer")]
      })
    });

    expect(result).toMatchObject({
      triggered: true,
      reason: "medium_direct_high_risk",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-seed-medium-high-risk"]
    });
  });

  it("skips transaction-seeded low boundary candidate despite separate medium selected transfer", () => {
    const lowBoundaryTransfer = transfer({
      txHash: "tx-seed-low-boundary",
      amountRaw: LOW_RAW,
      selectedReason: "covers_requested_amount"
    });
    const mediumNonBoundaryTransfer = transfer({
      txHash: "tx-seed-medium-non-boundary",
      amountRaw: MEDIUM_RAW,
      selectedReason: "covers_requested_amount"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [lowBoundaryTransfer, mediumNonBoundaryTransfer],
        provenanceScope: "transaction_seed",
        selectionMethod: "transaction_seed",
        requestedAmountRaw: LARGE_RAW,
        selectedAmountRaw: LARGE_RAW,
        targetAmountRaw: LARGE_RAW
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-seed-low-boundary",
          sourceExposureKind: "mixer",
          exposureSourceKey: "tornado",
          exposureSourceLabel: "Tornado Cash"
        }),
        originPath({
          balanceTransferTxHash: "tx-seed-medium-non-boundary",
          rootSourceType: "unknown",
          exposureSourceKey: null,
          exposureSourceLabel: null,
          sourceExposureKind: null,
          stoppedReason: "no_previous_transfer",
          verdict: "REVIEW",
          reasons: []
        })
      ],
      assessment: assessment({
        sourcePolicyEvidence: [sourcePolicy("mixer")]
      })
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("low amount");
    expect(result.balanceTransferTxHashes).toEqual(["tx-seed-low-boundary"]);
  });

  it("skips transaction-seeded invalid concrete amount despite large requested metadata", () => {
    const seedTransfer = transfer({
      txHash: "tx-seed-invalid",
      amountRaw: "",
      selectedReason: "covers_requested_amount"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [seedTransfer],
        provenanceScope: "transaction_seed",
        selectionMethod: "transaction_seed",
        requestedAmountRaw: LARGE_RAW,
        selectedAmountRaw: LARGE_RAW,
        targetAmountRaw: LARGE_RAW
      }),
      originPaths: [originPath({ balanceTransferTxHash: "tx-seed-invalid" })],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("low amount");
    expect(result.balanceTransferTxHashes).toEqual(["tx-seed-invalid"]);
  });

  it("skips recent-flow small anchor", () => {
    const recentTransfer = transfer({
      txHash: "tx-recent-small-anchor",
      amountRaw: LARGE_RAW,
      selectedReason: "funds_recent_outgoing"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [recentTransfer],
        provenanceScope: "recent_flow",
        selectionMethod: "recent_outgoing",
        anchorTransfer: {
          txHash: "tx-anchor-small",
          direction: "outgoing",
          fromAddress: checkedWallet,
          toAddress: "TRecipient1111111111111111111111111111",
          amountRaw: LOW_RAW,
          timestamp: "2026-05-20T10:05:00.000Z",
          reason: "latest_meaningful_outgoing"
        }
      }),
      originPaths: [originPath({ balanceTransferTxHash: "tx-recent-small-anchor" })],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("recent-flow anchor");
    expect(result.balanceTransferTxHashes).toEqual(["tx-recent-small-anchor"]);
  });

  it("triggers recent-flow large anchor", () => {
    const recentTransfer = transfer({
      txHash: "tx-recent-large-anchor",
      amountRaw: LARGE_RAW,
      selectedReason: "funds_recent_outgoing"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [recentTransfer],
        provenanceScope: "recent_flow",
        selectionMethod: "recent_outgoing",
        anchorTransfer: {
          txHash: "tx-anchor-large",
          direction: "outgoing",
          fromAddress: checkedWallet,
          toAddress: "TRecipient1111111111111111111111111111",
          amountRaw: LARGE_RAW,
          timestamp: "2026-05-20T10:05:00.000Z",
          reason: "latest_meaningful_outgoing"
        }
      }),
      originPaths: [originPath({ balanceTransferTxHash: "tx-recent-large-anchor" })],
      assessment: assessment()
    });

    expect(result).toMatchObject({
      triggered: true,
      reason: "large_single_boundary",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-recent-large-anchor"]
    });
  });

  it("groups split flow only when boundary actor and time window match", () => {
    const first = transfer({
      txHash: "tx-split-a",
      fromAddress: "TSplitSenderA111111111111111111111111",
      amountRaw: SPLIT_A_RAW,
      timestamp: "2026-05-20T10:00:00.000Z"
    });
    const second = transfer({
      txHash: "tx-split-b",
      fromAddress: "TSplitSenderB111111111111111111111111",
      amountRaw: SPLIT_B_RAW,
      timestamp: "2026-05-20T12:00:00.000Z"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [first, second],
        selectedAmountRaw: "105000000000",
        selectedVolumeRaw: "105000000000",
        targetAmountRaw: "105000000000"
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-split-a",
          exposureSourceKey: "stargate",
          exposureSourceLabel: "Stargate bridge",
          amountPreservationRatio: 0.8
        }),
        originPath({
          balanceTransferTxHash: "tx-split-b",
          exposureSourceKey: "stargate",
          exposureSourceLabel: "Stargate OFT bridge",
          amountPreservationRatio: 0.75
        })
      ],
      assessment: assessment()
    });

    expect(result).toMatchObject({
      triggered: true,
      reason: "large_split_boundary",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-split-a", "tx-split-b"]
    });
  });

  it("does not group unrelated boundary paths as exact split flow", () => {
    const first = transfer({
      txHash: "tx-layerzero",
      fromAddress: "TLayerZeroSender111111111111111111111",
      amountRaw: SPLIT_A_RAW,
      timestamp: "2026-05-20T10:00:00.000Z"
    });
    const second = transfer({
      txHash: "tx-wormhole",
      fromAddress: "TWormholeSender111111111111111111111",
      amountRaw: SPLIT_B_RAW,
      timestamp: "2026-05-20T12:00:00.000Z"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [first, second],
        selectedAmountRaw: "105000000000",
        selectedVolumeRaw: "105000000000",
        targetAmountRaw: "105000000000"
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-layerzero",
          exposureSourceKey: "layerzero",
          exposureSourceLabel: "LayerZero bridge",
          amountPreservationRatio: 0.8
        }),
        originPath({
          balanceTransferTxHash: "tx-wormhole",
          exposureSourceKey: "wormhole",
          exposureSourceLabel: "Wormhole bridge",
          amountPreservationRatio: 0.75
        })
      ],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("split");
    expect(result.balanceTransferTxHashes).toEqual(["tx-layerzero", "tx-wormhole"]);
  });

  it("does not group unrelated LayerZero adapters by protocol family alone", () => {
    const first = transfer({
      txHash: "tx-layerzero-a",
      fromAddress: "TLayerZeroAdapterA1111111111111111111",
      amountRaw: SPLIT_A_RAW,
      timestamp: "2026-05-20T10:00:00.000Z"
    });
    const second = transfer({
      txHash: "tx-layerzero-b",
      fromAddress: "TLayerZeroAdapterB1111111111111111111",
      amountRaw: SPLIT_B_RAW,
      timestamp: "2026-05-20T11:00:00.000Z"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [first, second],
        selectedAmountRaw: "105000000000",
        selectedVolumeRaw: "105000000000",
        targetAmountRaw: "105000000000"
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-layerzero-a",
          rootSourceAddress: "TRootA1111111111111111111111111111",
          exposureSourceKey: "layerzero",
          exposureSourceLabel: "LayerZero OFT adapter",
          amountPreservationRatio: 0.8
        }),
        originPath({
          balanceTransferTxHash: "tx-layerzero-b",
          rootSourceAddress: "TRootB1111111111111111111111111111",
          exposureSourceKey: "layerzero",
          exposureSourceLabel: "LayerZero OFT adapter",
          amountPreservationRatio: 0.75
        })
      ],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("split");
  });

  it("does not split-group boundary paths with empty checked-wallet addresses", () => {
    const first = transfer({
      txHash: "tx-empty-to-a",
      fromAddress: "TSplitSenderA111111111111111111111111",
      toAddress: "",
      amountRaw: SPLIT_A_RAW,
      timestamp: "2026-05-20T10:00:00.000Z"
    });
    const second = transfer({
      txHash: "tx-empty-to-b",
      fromAddress: "TSplitSenderB111111111111111111111111",
      toAddress: "",
      amountRaw: SPLIT_B_RAW,
      timestamp: "2026-05-20T11:00:00.000Z"
    });

    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [first, second],
        selectedAmountRaw: "105000000000",
        selectedVolumeRaw: "105000000000",
        targetAmountRaw: "105000000000"
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-empty-to-a",
          exposureSourceKey: "stargate",
          exposureSourceLabel: "Stargate bridge",
          amountPreservationRatio: 0.8
        }),
        originPath({
          balanceTransferTxHash: "tx-empty-to-b",
          exposureSourceKey: "stargate",
          exposureSourceLabel: "Stargate bridge",
          amountPreservationRatio: 0.75
        })
      ],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("split");
  });

  it("triggers medium amount with direct mixer clue", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [transfer({ txHash: "tx-medium-mixer", amountRaw: MEDIUM_RAW })],
        selectedAmountRaw: MEDIUM_RAW,
        selectedVolumeRaw: MEDIUM_RAW,
        targetAmountRaw: MEDIUM_RAW,
        requestedAmountRaw: MEDIUM_RAW
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-medium-mixer",
          sourceExposureKind: "mixer",
          exposureSourceKey: "tornado",
          exposureSourceLabel: "Tornado Cash"
        })
      ],
      assessment: assessment({
        sourcePolicyEvidence: [sourcePolicy("mixer")]
      })
    });

    expect(result).toMatchObject({
      triggered: true,
      reason: "medium_direct_high_risk",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-medium-mixer"]
    });
  });

  it("skips medium bridge-only amount", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [transfer({ txHash: "tx-medium-bridge", amountRaw: MEDIUM_RAW })],
        selectedAmountRaw: MEDIUM_RAW,
        selectedVolumeRaw: MEDIUM_RAW,
        targetAmountRaw: MEDIUM_RAW,
        requestedAmountRaw: MEDIUM_RAW
      }),
      originPaths: [originPath({ balanceTransferTxHash: "tx-medium-bridge" })],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("direct high-risk");
    expect(result.balanceTransferTxHashes).toEqual(["tx-medium-bridge"]);
  });

  it("skips low amount but returns deep-check available reason", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [transfer({ txHash: "tx-low", amountRaw: LOW_RAW })],
        selectedAmountRaw: LOW_RAW,
        selectedVolumeRaw: LOW_RAW,
        targetAmountRaw: LOW_RAW,
        requestedAmountRaw: LOW_RAW
      }),
      originPaths: [originPath({ balanceTransferTxHash: "tx-low" })],
      assessment: assessment()
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.deepCheckAvailable).toBe(true);
    expect(result.skippedReason).toContain("low amount");
    expect(result.balanceTransferTxHashes).toEqual(["tx-low"]);
  });

  it("manual deep mode triggers regardless of amount while staying budgeted", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [
          transfer({ txHash: "tx-manual-a", amountRaw: LOW_RAW }),
          transfer({ txHash: "tx-manual-b", amountRaw: LOW_RAW })
        ],
        selectedAmountRaw: LOW_RAW,
        selectedVolumeRaw: "18000000000",
        targetAmountRaw: LOW_RAW,
        requestedAmountRaw: LOW_RAW
      }),
      originPaths: [
        originPath({ balanceTransferTxHash: "tx-manual-b", sourceExposureKind: null }),
        originPath({ balanceTransferTxHash: "tx-manual-a", sourceExposureKind: null }),
        originPath({ balanceTransferTxHash: "tx-manual-b", sourceExposureKind: null })
      ],
      assessment: assessment(),
      manualDeepMode: true
    });

    expect(result).toEqual({
      triggered: true,
      reason: "manual_deep_mode",
      skippedReason: null,
      deepCheckAvailable: true,
      balanceTransferTxHashes: ["tx-manual-b", "tx-manual-a"],
      selectedAmountRaw: LOW_RAW,
      targetAmountRaw: LOW_RAW
    });
  });

  it("does not treat negative diagnostic reason text as visible boundary", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [transfer({ txHash: "tx-no-boundary-negative-text" })]
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-no-boundary-negative-text",
          rootSourceAddress: null,
          rootSourceType: "unknown",
          exposureSourceKey: null,
          exposureSourceLabel: null,
          sourceExposureKind: null,
          stoppedReason: "no_previous_transfer",
          verdict: "REVIEW",
          riskScoreContribution: 20,
          reasons: ["No bridge/router boundary detected in Stage 1."]
        })
      ],
      assessment: assessment()
    });

    expect(result).toMatchObject({
      triggered: false,
      reason: null,
      deepCheckAvailable: false,
      balanceTransferTxHashes: []
    });
    expect(result.skippedReason).toContain("No selected cross-chain boundary");
  });

  it("still treats positive structured LayerZero label as visible boundary", () => {
    const result = evaluateCrossChainStage2Trigger({
      selection: selection({
        transfers: [transfer({ txHash: "tx-positive-layerzero-label" })]
      }),
      originPaths: [
        originPath({
          balanceTransferTxHash: "tx-positive-layerzero-label",
          sourceExposureKind: null,
          exposureSourceKey: null,
          exposureSourceLabel: "LayerZero bridge"
        })
      ],
      assessment: assessment()
    });

    expect(result).toMatchObject({
      triggered: true,
      reason: "large_single_boundary",
      balanceTransferTxHashes: ["tx-positive-layerzero-label"]
    });
  });
});
