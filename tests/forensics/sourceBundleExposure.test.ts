import { describe, expect, it } from "vitest";
import {
  buildSourceBundleExposure,
  buildSubjectExposureProfile,
  incomingFreshBundleExposureFromSourceProfile,
  incomingWalletExposureProfileFromSubjectProfile,
  unresolvedBoundaryFromFindings
} from "../../src/forensics/sourceBundleExposure";
import type {
  SourceBundleExposureBudget,
  SourceBundleExposureFinding,
  SubjectExposureEvent
} from "../../src/types";

const budget: SourceBundleExposureBudget = {
  maxDepth: 8,
  fetchedAddressCount: 3,
  maxAddressFetches: 50,
  liveTransferReadCount: 12,
  skippedAddressCount: 0,
  exhausted: false,
  exhaustedPhase: null
};

function finding(overrides: Partial<SourceBundleExposureFinding>): SourceBundleExposureFinding {
  return {
    sourceClass: "unknown",
    share: 0,
    amountRaw: "0",
    proofKind: "selected_amount",
    stoppedReason: "selected_source",
    evidenceTxHashes: [],
    ...overrides
  };
}

function event(overrides: Partial<SubjectExposureEvent>): SubjectExposureEvent {
  return {
    direction: "incoming",
    amountRaw: "0",
    counterparty: "TCounterparty",
    sourceClass: "unknown",
    txHash: "tx",
    timestamp: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

describe("buildSourceBundleExposure", () => {
  it("normalizes selected source shares and preserves evidence hashes", () => {
    const profile = buildSourceBundleExposure({
      scope: "incoming_deposit",
      targetAmountRaw: "100000000000",
      budget,
      findings: [
        finding({
          sourceClass: "htx_huobi",
          share: 0.7,
          amountRaw: "70000000000",
          evidenceTxHashes: ["tx-htx-1", "tx-htx-2"]
        }),
        finding({
          sourceClass: "clean_cex",
          share: 0.2,
          amountRaw: "20000000000",
          evidenceTxHashes: ["tx-clean"]
        }),
        finding({
          sourceClass: "unknown_contract",
          share: 0.1,
          amountRaw: "10000000000",
          evidenceTxHashes: ["tx-contract"]
        })
      ]
    });

    expect(profile.coverageRatio).toBe(1);
    expect(profile.htxHuobiShare).toBeCloseTo(0.7);
    expect(profile.cleanCexShare).toBeCloseTo(0.2);
    expect(profile.unknownContractShare).toBeCloseTo(0.1);
    expect(profile.unknownShare).toBe(0);
    expect(profile.dominantSource).toBe("htx_huobi");
    expect(profile.evidenceTxHashes).toEqual(["tx-htx-1", "tx-htx-2", "tx-clean", "tx-contract"]);
  });

  it("assigns missing selected coverage to unknown", () => {
    const profile = buildSourceBundleExposure({
      scope: "where_requested_amount",
      targetAmountRaw: "100000000000",
      budget,
      findings: [
        finding({
          sourceClass: "htx_huobi",
          share: 0.4,
          amountRaw: "40000000000",
          evidenceTxHashes: ["tx-htx"]
        })
      ]
    });

    expect(profile.htxHuobiShare).toBeCloseTo(0.4);
    expect(profile.unknownShare).toBeCloseTo(0.6);
    expect(profile.reasons.join(" ")).toContain("Uncovered selected source share is assigned to unknown");
  });

  it("uses checked-deposit wording for incoming deposit uncovered coverage", () => {
    const profile = buildSourceBundleExposure({
      scope: "incoming_deposit",
      targetAmountRaw: "100000000000",
      budget,
      findings: [
        finding({
          sourceClass: "htx_huobi",
          share: 0.4,
          amountRaw: "40000000000",
          evidenceTxHashes: ["tx-htx"]
        })
      ]
    });

    const reasons = profile.reasons.join(" ");

    expect(profile.htxHuobiShare).toBeCloseTo(0.4);
    expect(profile.unknownShare).toBeCloseTo(0.6);
    expect(reasons).toContain("Uncovered checked-deposit source share is assigned to unknown");
    expect(reasons).not.toContain("Uncovered selected source share");
  });

  it("adds a bridge boundary score floor and coverage-limited warning", () => {
    const profile = buildSourceBundleExposure({
      scope: "where_current_balance",
      targetAmountRaw: "100000000000",
      budget: {
        ...budget,
        exhausted: true,
        exhaustedPhase: "trace"
      },
      unresolvedBoundary: {
        kind: "bridge_router_dex",
        affectedShare: 0.35,
        reason: "Bridge boundary reached before expansion completed.",
        evidenceTxHashes: ["tx-bridge"]
      },
      findings: [
        finding({
          sourceClass: "bridge_router_dex",
          share: 0.35,
          amountRaw: "35000000000",
          proofKind: "coverage_limited_boundary",
          evidenceTxHashes: ["tx-bridge"]
        })
      ]
    });

    expect(profile.unresolvedBoundary?.scoreFloor).toBe(55);
    expect(profile.unresolvedBoundary?.affectedShare).toBeCloseTo(0.35);
    expect(profile.warnings.join(" ")).toContain("coverage-limited");
  });

  it("maps to IncomingFreshBundleExposure preserving target and shares", () => {
    const shared = buildSourceBundleExposure({
      scope: "incoming_deposit",
      targetAmountRaw: "100000000000",
      budget,
      findings: [
        finding({
          sourceClass: "htx_huobi",
          share: 0.49,
          amountRaw: "49000000000",
          evidenceTxHashes: ["tx-htx"]
        }),
        finding({
          sourceClass: "clean_cex",
          share: 0.51,
          amountRaw: "51000000000",
          evidenceTxHashes: ["tx-clean"]
        })
      ]
    });

    const incoming = incomingFreshBundleExposureFromSourceProfile(shared);

    expect(incoming.targetAmountRaw).toBe("100000000000");
    expect(incoming.htxHuobiShare).toBeCloseTo(0.49);
    expect(incoming.cleanCexShare).toBeCloseTo(0.51);
    expect(incoming.dominantFreshSource).toBe("clean_cex");
  });
});

describe("unresolvedBoundaryFromFindings", () => {
  it("aggregates bridge/router/dex findings before applying the unresolved boundary threshold", () => {
    const boundary = unresolvedBoundaryFromFindings({
      budget: {
        ...budget,
        exhausted: true,
        exhaustedPhase: "trace"
      },
      findings: [
        finding({
          sourceClass: "bridge_router_dex",
          share: 0.06,
          amountRaw: "6000000000",
          evidenceTxHashes: ["tx-bridge-a"]
        }),
        finding({
          sourceClass: "bridge_router_dex",
          share: 0.06,
          amountRaw: "6000000000",
          evidenceTxHashes: ["tx-bridge-b"]
        })
      ]
    });

    expect(boundary).toEqual({
      kind: "bridge_router_dex",
      affectedShare: 0.12,
      reason: "Source bundle coverage-limited: unresolved bridge/router/DEX boundary remains after the graph budget stopped.",
      evidenceTxHashes: ["tx-bridge-a", "tx-bridge-b"]
    });
  });

  it("returns a bridge/router/dex boundary floor and coverage-limited warning when the trace budget is exhausted", () => {
    const boundary = unresolvedBoundaryFromFindings({
      budget: {
        ...budget,
        exhausted: true,
        exhaustedPhase: "trace"
      },
      findings: [
        finding({
          sourceClass: "bridge_router_dex",
          share: 0.55,
          amountRaw: "55000000000",
          evidenceTxHashes: ["tx-bridge"]
        })
      ]
    });
    const profile = buildSourceBundleExposure({
      scope: "where_requested_amount",
      targetAmountRaw: "100000000000",
      budget: {
        ...budget,
        exhausted: true,
        exhaustedPhase: "trace"
      },
      findings: [
        finding({
          sourceClass: "bridge_router_dex",
          share: 0.55,
          amountRaw: "55000000000",
          evidenceTxHashes: ["tx-bridge"]
        })
      ],
      unresolvedBoundary: boundary
    });

    expect(profile.unresolvedBoundary).toEqual(expect.objectContaining({
      kind: "bridge_router_dex",
      affectedShare: 0.55,
      scoreFloor: 55,
      evidenceTxHashes: ["tx-bridge"]
    }));
    expect(profile.unresolvedBoundary?.reason).toContain("coverage-limited");
    expect(profile.warnings.join(" ")).toContain("coverage-limited");
  });

  it("returns null for exhausted clean-only findings", () => {
    const boundary = unresolvedBoundaryFromFindings({
      budget: {
        ...budget,
        exhausted: true,
        exhaustedPhase: "trace"
      },
      findings: [
        finding({
          sourceClass: "clean_cex",
          share: 1,
          amountRaw: "100000000000",
          evidenceTxHashes: ["tx-clean"]
        })
      ]
    });

    expect(boundary).toBeNull();
  });

  it("returns an unknown boundary floor for exhausted unknown share", () => {
    const boundary = unresolvedBoundaryFromFindings({
      budget: {
        ...budget,
        exhausted: true,
        exhaustedPhase: "trace"
      },
      findings: [
        finding({
          sourceClass: "unknown",
          share: 0.07,
          amountRaw: "7000000000",
          evidenceTxHashes: ["tx-unknown-a"]
        }),
        finding({
          sourceClass: "unknown",
          share: 0.06,
          amountRaw: "6000000000",
          evidenceTxHashes: ["tx-unknown-b"]
        })
      ]
    });
    const profile = buildSourceBundleExposure({
      scope: "where_requested_amount",
      targetAmountRaw: "100000000000",
      budget: {
        ...budget,
        exhausted: true,
        exhaustedPhase: "trace"
      },
      findings: [
        finding({
          sourceClass: "unknown",
          share: 0.13,
          amountRaw: "13000000000",
          evidenceTxHashes: ["tx-unknown-a", "tx-unknown-b"]
        })
      ],
      unresolvedBoundary: boundary
    });

    expect(profile.unresolvedBoundary).toEqual(expect.objectContaining({
      kind: "unknown",
      affectedShare: 0.13,
      scoreFloor: 35,
      evidenceTxHashes: ["tx-unknown-a", "tx-unknown-b"]
    }));
    expect(profile.unresolvedBoundary?.reason).toContain("coverage-limited unknown boundary");
  });
});

describe("buildSubjectExposureProfile", () => {
  it("maps historical subject exposure to incoming wallet shape", () => {
    const subject = buildSubjectExposureProfile({
      subjectAddress: "TSender",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-04T12:00:00.000Z",
      transferEventsScanned: 5,
      events: [
        event({
          direction: "incoming",
          amountRaw: "28000000000",
          sourceClass: "htx_huobi",
          txHash: "tx-htx"
        }),
        event({
          direction: "outgoing",
          amountRaw: "30000000000",
          sourceClass: "bridge_router_dex",
          txHash: "tx-bridge"
        }),
        event({
          direction: "incoming",
          amountRaw: "42000000000",
          sourceClass: "unknown",
          txHash: "tx-unknown"
        })
      ]
    });

    const incoming = incomingWalletExposureProfileFromSubjectProfile(subject);

    expect(subject.scoreContribution).toBeLessThanOrEqual(20);
    expect(incoming.transferEventsScanned).toBe(5);
    expect(incoming.htxHuobiIncomingShare).toBeCloseTo(0.4);
    expect(incoming.bridgeRouterDexVolumeShare).toBeCloseTo(0.3);
    expect(incoming.scoreContribution).toBe(subject.scoreContribution);
  });
});
