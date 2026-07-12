import { describe, expect, it } from "vitest";
import {
  buildUsddPsmRouteObservation,
  collectUsddPsmRouteObservations
} from "../../src/forensics/usddPsmRouteObservation";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import type { ForensicRouteEdge, MoneyOriginPath } from "../../src/types";
import {
  discontinuousInput,
  exactInboundEightyThreePercentInput,
  exactOutboundTwoPercentInput,
  labelOnlyInput
} from "../fixtures/forensics/remediationDataCases";

const wrongReserveInput = {
  ...exactOutboundTwoPercentInput,
  reserveAddress: "TEdvoHEatmDKvTh3o9vBRB9Vdtbhn4QFhy",
  providerLabel: "USDD: PSM GemJoin (USDT)",
  evidenceIds: ["psm:wrong-reserve"]
};

const psmReserve = "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ";

function routePath(input: {
  steps: MoneyOriginPath["steps"];
  evidenceId?: string;
  amountPreservationRatio?: number;
}): MoneyOriginPath {
  return {
    balanceTransferTxHash: input.steps.at(-1)?.txHash ?? "missing",
    ...(input.evidenceId ? { balanceTransferEvidenceId: input.evidenceId } : {}),
    rootSourceAddress: input.steps[0]?.fromAddress ?? null,
    rootSourceType: "unknown",
    pathAddresses: [],
    txHashes: input.steps.map((step) => step.txHash),
    steps: input.steps,
    amountPreservationRatio: input.amountPreservationRatio ?? 1,
    timeSpanMs: 1,
    stoppedReason: "service_boundary",
    verdict: "REVIEW",
    riskScoreContribution: 0,
    reasons: []
  };
}

describe("USDD PSM route data foundation", () => {
  it("[REQ-28][AC-03][DATA] preserves exact 2 percent outbound PSM inputs without scoring", () => {
    const result = buildUsddPsmRouteObservation(exactOutboundTwoPercentInput);
    expect(result).toMatchObject({
      serviceId: "usdd_psm_gemjoin",
      direction: "outbound_to_psm",
      amountRaw: "20000000",
      selectedAmountRaw: "1000000000",
      hopCount: 1,
      serviceIdentityExact: true,
      amountContinuityExact: true,
      scoringEligible: true
    });
    expect(result).not.toHaveProperty("appliedModifier");
  });

  it("[REQ-28][AC-04][DATA] preserves exact 83 percent inbound PSM inputs", () => {
    expect(buildUsddPsmRouteObservation(exactInboundEightyThreePercentInput)).toMatchObject({
      serviceId: "usdd_psm_gemjoin",
      direction: "inbound_from_psm",
      amountRaw: "830000000",
      selectedAmountRaw: "1000000000",
      scoringEligible: true
    });
  });

  it("[REQ-28][AC-05][DATA] preserves deep-history mode without applying a modifier", () => {
    const result = buildUsddPsmRouteObservation({ ...exactInboundEightyThreePercentInput, mode: "deep_history" });
    expect(result).toMatchObject({ mode: "deep_history", scoringEligible: true });
    expect(result).not.toHaveProperty("appliedModifier");
  });

  it("[REQ-28][AC-06][DATA] keeps label-only, wrong-reserve and discontinuous PSM observations ineligible", () => {
    expect(buildUsddPsmRouteObservation(labelOnlyInput)).toMatchObject({
      scoringEligible: false,
      ineligibilityReason: "label_only"
    });
    expect(buildUsddPsmRouteObservation(wrongReserveInput)).toMatchObject({
      scoringEligible: false,
      ineligibilityReason: "label_only"
    });
    expect(buildUsddPsmRouteObservation(discontinuousInput)).toMatchObject({
      scoringEligible: false,
      ineligibilityReason: "amount_discontinuous"
    });
    expect(buildUsddPsmRouteObservation({
      ...exactOutboundTwoPercentInput,
      evidenceIds: ["   "]
    })).toMatchObject({
      evidenceIds: [],
      scoringEligible: false,
      ineligibilityReason: "invalid_amount"
    });
    expect(buildUsddPsmRouteObservation({
      ...exactOutboundTwoPercentInput,
      evidenceIds: [" evidence:one ", "evidence:one", "evidence:two"]
    }).evidenceIds).toEqual(["evidence:one", "evidence:two"]);
  });

  it("[REQ-28][AC-03][AC-04][DATA] collects exact route direction, hop and evidence deterministically", () => {
    const observations = collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "1000000000",
      paths: [routePath({
        evidenceId: "event:psm-inbound:0",
        steps: [{
          txHash: "psm-inbound",
          fromAddress: psmReserve,
          toAddress: "TSubject11111111111111111111111111",
          amountRaw: "830000000",
          timestamp: "2026-07-12T10:00:00.000Z"
        }]
      })]
    });

    expect(observations).toEqual([expect.objectContaining({
      direction: "inbound_from_psm",
      hopCount: 1,
      amountRaw: "830000000",
      selectedAmountRaw: "1000000000",
      scoringEligible: true,
      evidenceIds: ["event:psm-inbound:0", "psm-inbound"]
    })]);
  });

  it("[REQ-28][AC-03][DATA] identifies an exact outbound route to the reserve", () => {
    expect(collectUsddPsmRouteObservations({
      mode: "recent_flow",
      selectedAmountRaw: "1000000000",
      paths: [routePath({
        evidenceId: "event:psm-outbound:0",
        steps: [{
          txHash: "psm-outbound",
          fromAddress: "TSubject11111111111111111111111111",
          toAddress: psmReserve,
          amountRaw: "20000000",
          timestamp: "2026-07-12T10:00:00.000Z"
        }]
      })]
    })).toEqual([expect.objectContaining({
      mode: "recent_flow",
      direction: "outbound_to_psm",
      hopCount: 1,
      amountRaw: "20000000",
      scoringEligible: true,
      evidenceIds: ["event:psm-outbound:0", "psm-outbound"]
    })]);
  });

  it("[REQ-28][AC-06][DATA] does not invent an exact PSM observation from a provider label", () => {
    expect(collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "1000000000",
      paths: [{
        ...routePath({
          steps: [{
            txHash: "label-only",
            fromAddress: "TNotTheReserve111111111111111111111",
            toAddress: "TSubject11111111111111111111111111",
            amountRaw: "1000000000",
            timestamp: "2026-07-12T10:00:00.000Z"
          }]
        }),
        exposureSourceLabel: "USDD: PSM GemJoin (USDT)"
      }]
    })).toEqual([]);
  });

  it("[REQ-28][AC-06][DATA] fails closed for disconnected duplicate evidence in either path order", () => {
    const connected = routePath({
      evidenceId: "event:duplicate:0",
      steps: [{
        txHash: "psm-duplicate-hop",
        fromAddress: psmReserve,
        toAddress: "TMiddle111111111111111111111111111",
        amountRaw: "20000000",
        timestamp: "2026-07-12T09:00:00.000Z"
      }, {
        txHash: "duplicate-seed",
        fromAddress: "TMiddle111111111111111111111111111",
        toAddress: "TSubject11111111111111111111111111",
        amountRaw: "20000000",
        timestamp: "2026-07-12T10:00:00.000Z"
      }]
    });
    const disconnected = routePath({
      evidenceId: "event:duplicate:0",
      steps: [{
        ...connected.steps[0]
      }, {
        ...connected.steps[1],
        fromAddress: "TDisconnected11111111111111111111111"
      }]
    });
    const collect = (paths: MoneyOriginPath[]) => collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "1000000000",
      paths
    });

    expect(collect([connected, disconnected])).toEqual(collect([disconnected, connected]));
    expect(collect([connected, disconnected])).toEqual([expect.objectContaining({
      direction: "inbound_from_psm",
      hopCount: 2,
      amountContinuityExact: false,
      scoringEligible: false,
      ineligibilityReason: "amount_discontinuous"
    })]);
  });

  it("[REQ-28][AC-06][DATA] fails closed for conflicting route identity in either path order", () => {
    const inbound = routePath({
      evidenceId: "event:identity-conflict:0",
      steps: [{
        txHash: "identity-conflict",
        fromAddress: psmReserve,
        toAddress: "TSubject11111111111111111111111111",
        amountRaw: "20000000",
        timestamp: "2026-07-12T10:00:00.000Z"
      }]
    });
    const outbound = routePath({
      evidenceId: "event:identity-conflict:0",
      steps: [{
        ...inbound.steps[0],
        fromAddress: "TSubject11111111111111111111111111",
        toAddress: psmReserve
      }]
    });
    const collect = (paths: MoneyOriginPath[]) => collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "1000000000",
      paths
    });

    expect(collect([inbound, outbound])).toEqual(collect([outbound, inbound]));
    expect(collect([inbound, outbound])).toEqual([expect.objectContaining({
      direction: "unknown",
      scoringEligible: false,
      ineligibilityReason: "amount_discontinuous"
    })]);
  });

  it("[REQ-28][AC-06][DATA] emits one fail-closed fact when one selected path enters and leaves the reserve", () => {
    const pooledRoundTrip = routePath({
      evidenceId: "event:pooled-round-trip:0",
      steps: [{
        txHash: "pooled-in",
        fromAddress: "TSource1111111111111111111111111111",
        toAddress: psmReserve,
        amountRaw: "100000000",
        timestamp: "2026-07-12T09:00:00.000Z"
      }, {
        txHash: "pooled-out",
        fromAddress: psmReserve,
        toAddress: "TSubject11111111111111111111111111",
        amountRaw: "100000000",
        timestamp: "2026-07-12T10:00:00.000Z"
      }]
    });
    const independent = routePath({
      evidenceId: "event:independent:0",
      steps: [{
        txHash: "independent-psm",
        fromAddress: psmReserve,
        toAddress: "TOtherSubject1111111111111111111111",
        amountRaw: "50000000",
        timestamp: "2026-07-12T10:00:00.000Z"
      }]
    });
    const collect = (paths: MoneyOriginPath[]) => collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "1000000000",
      paths
    });

    expect(collect([pooledRoundTrip])).toEqual([expect.objectContaining({
      direction: "unknown",
      scoringEligible: false,
      ineligibilityReason: "amount_discontinuous",
      evidenceIds: ["event:pooled-round-trip:0", "pooled-in", "pooled-out"]
    })]);
    expect(collect([pooledRoundTrip, independent])).toEqual(collect([independent, pooledRoundTrip]));
  });

  it("[REQ-28][AC-03][DATA] caps a direct reserve numerator to the selected event usage", () => {
    const capped = routePath({
      evidenceId: "event:capped-direct:0",
      steps: [{
        txHash: "capped-direct",
        fromAddress: psmReserve,
        toAddress: "TSubject11111111111111111111111111",
        amountRaw: "1000000000",
        timestamp: "2026-07-12T10:00:00.000Z"
      }]
    });
    capped.amountUsage = {
      anchorAmountRaw: "100000000",
      originalAmountRaw: "1000000000",
      usedAmountRaw: "100000000",
      coverageShare: 1,
      role: "anchor"
    };

    expect(collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "100000000",
      paths: [capped]
    })).toEqual([expect.objectContaining({
      amountRaw: "100000000",
      selectedAmountRaw: "100000000",
      amountContinuityExact: true,
      scoringEligible: true
    })]);
  });

  it("[REQ-28][AC-04][DATA] propagates exact selected usage through a continuous two-hop route", () => {
    const exactTwoHop = routePath({
      evidenceId: "event:exact-two-hop:0",
      steps: [{
        txHash: "exact-two-hop-psm",
        fromAddress: psmReserve,
        toAddress: "TMiddle111111111111111111111111111",
        amountRaw: "1000000000",
        timestamp: "2026-07-12T09:00:00.000Z"
      }, {
        txHash: "exact-two-hop-selected",
        fromAddress: "TMiddle111111111111111111111111111",
        toAddress: "TSubject11111111111111111111111111",
        amountRaw: "1000000000",
        timestamp: "2026-07-12T10:00:00.000Z"
      }]
    });
    expect(collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "1000000000",
      paths: [exactTwoHop]
    })).toEqual([expect.objectContaining({
      hopCount: 2,
      amountRaw: "1000000000",
      amountContinuityExact: true,
      scoringEligible: true
    })]);
    exactTwoHop.amountUsage = {
      anchorAmountRaw: "100000000",
      originalAmountRaw: "1000000000",
      usedAmountRaw: "100000000",
      coverageShare: 1,
      role: "anchor"
    };

    expect(collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "100000000",
      paths: [exactTwoHop]
    })).toEqual([expect.objectContaining({
      direction: "inbound_from_psm",
      hopCount: 2,
      amountRaw: "100000000",
      selectedAmountRaw: "100000000",
      amountContinuityExact: true,
      scoringEligible: true,
      ineligibilityReason: null
    })]);
  });

  it("[REQ-28][AC-06][DATA] keeps an ambiguous two-hop allocation fail-closed", () => {
    const ambiguousTwoHop = routePath({
      evidenceId: "event:ambiguous-two-hop:0",
      steps: [{
        txHash: "ambiguous-two-hop-psm",
        fromAddress: psmReserve,
        toAddress: "TMiddle111111111111111111111111111",
        amountRaw: "1000000000",
        timestamp: "2026-07-12T09:00:00.000Z"
      }, {
        txHash: "ambiguous-two-hop-selected",
        fromAddress: "TMiddle111111111111111111111111111",
        toAddress: "TSubject11111111111111111111111111",
        amountRaw: "900000000",
        timestamp: "2026-07-12T10:00:00.000Z"
      }]
    });

    expect(collectUsddPsmRouteObservations({
      mode: "where",
      selectedAmountRaw: "1000000000",
      paths: [ambiguousTwoHop]
    })).toEqual([expect.objectContaining({
      hopCount: 2,
      amountContinuityExact: false,
      scoringEligible: false,
      ineligibilityReason: "amount_discontinuous"
    })]);
  });

  it("[REQ-28][AC-03][AC-04][DATA] persists exact PSM observations on a new Where report without changing score", async () => {
    const subjectAddress = "TSubject11111111111111111111111111";
    const cleanSender = "TCleanSender111111111111111111111111";
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000",
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === psmReserve
        ? {
            category: "protocol",
            identity: "USDD PSM/GemJoin",
            confidence: "high",
            evidence: ["exact_registry"],
            isBoundary: true
          }
        : {
            category: "cex",
            identity: "Known CEX",
            confidence: "high",
            evidence: ["test_registry"],
            isBoundary: true
          }
    }, {
      mode: "where_is_money",
      subjectAddress,
      requestedAmountRaw: "1000000000",
      seedTransfers: [{
        txHash: "psm-seed",
        evidenceId: "psm-seed:0",
        fromAddress: psmReserve,
        toAddress: subjectAddress,
        amountRaw: "830000000",
        timestamp: "2026-07-12T10:00:00.000Z",
        coverageShare: 0.83,
        selectedReason: "covers_current_balance"
      }, {
        txHash: "clean-seed",
        evidenceId: "clean-seed:0",
        fromAddress: cleanSender,
        toAddress: subjectAddress,
        amountRaw: "170000000",
        timestamp: "2026-07-12T09:00:00.000Z",
        coverageShare: 0.17,
        selectedReason: "covers_current_balance"
      }],
      windowStart: new Date("2026-07-11T00:00:00.000Z"),
      windowEnd: new Date("2026-07-12T12:00:00.000Z")
    });

    expect(report.usddPsmRouteObservations).toEqual([expect.objectContaining({
      mode: "where",
      direction: "inbound_from_psm",
      amountRaw: "830000000",
      selectedAmountRaw: "1000000000",
      scoringEligible: true,
      evidenceIds: ["psm-seed:0", "psm-seed"]
    })]);
    expect(report.assessment.riskLayers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: expect.stringContaining("usdd") })
    ]));
  });

  it("[REQ-28][AC-03][DATA] persists recent_flow mode for legacy recent-outgoing low-balance selection", async () => {
    const subjectAddress = "TSubject11111111111111111111111111";
    const cleanSender = "TCleanSender111111111111111111111111";
    const destination = "TDestination111111111111111111111111";
    const edge = (
      id: string,
      fromAddress: string,
      toAddress: string,
      amountRaw: string,
      timestamp: string
    ): ForensicRouteEdge => ({
      id,
      txHash: id,
      fromAddress,
      toAddress,
      amountRaw,
      timestamp: new Date(timestamp),
      method: "transfer",
      edgeType: "normal_transfer"
    });
    const sourceEdges = [
      edge("recent-outgoing", subjectAddress, destination, "1000000000", "2026-07-12T10:00:00.000Z"),
      edge("recent-psm-funding", psmReserve, subjectAddress, "830000000", "2026-07-12T09:59:00.000Z"),
      edge("recent-clean-funding", cleanSender, subjectAddress, "170000000", "2026-07-12T09:58:00.000Z")
    ];
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "23791",
      fetchEdgesForAddress: async (address) => address === subjectAddress ? sourceEdges : [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address) => address === psmReserve
        ? {
            category: "protocol",
            identity: "USDD PSM/GemJoin",
            confidence: "high",
            evidence: ["exact_registry"],
            isBoundary: true
          }
        : address === cleanSender
          ? {
              category: "cex",
              identity: "Known CEX",
              confidence: "high",
              evidence: ["test_registry"],
              isBoundary: true
            }
          : {
              category: "none",
              identity: null,
              confidence: "low",
              evidence: [],
              isBoundary: false
            }
    }, {
      mode: "wallet_profile",
      subjectAddress,
      windowStart: new Date("2026-07-11T00:00:00.000Z"),
      windowEnd: new Date("2026-07-12T12:00:00.000Z")
    });

    expect(report.coverage.selectionMethod).toBe("recent_outgoing");
    expect(report.usddPsmRouteObservations).toEqual([expect.objectContaining({
      mode: "recent_flow",
      direction: "inbound_from_psm",
      amountRaw: "830000000",
      selectedAmountRaw: "1000000000",
      scoringEligible: true
    })]);
  });
});
