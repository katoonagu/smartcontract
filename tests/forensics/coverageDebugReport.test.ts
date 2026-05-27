import { describe, expect, it } from "vitest";
import {
  buildCoverageDebugReportFromJob,
  buildCoverageDebugSnapshot,
  formatCoverageDebugSummary,
  formatCoverageDebugTable
} from "../../src/forensics/coverageDebugReport";
import type {
  AddressBehaviorProfile,
  AddressLabel,
  CounterpartyRiskProfile,
  ForensicRouteEdge,
  ServiceClassification
} from "../../src/types";

const subject = "TSubject111111111111111111111111111111";
const risky = "TRisky1111111111111111111111111111111";
const service = "TService11111111111111111111111111111";
const behaviorOnly = "TBehaviorOnly111111111111111111111111";
const normal = "TNormal111111111111111111111111111111";

function edge(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at: string;
}): ForensicRouteEdge {
  return {
    id: input.id,
    txHash: input.id,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.at),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function label(address: string): AddressLabel {
  return {
    address,
    label: "darknet_exchange_proximity",
    source: "system",
    createdByTelegramId: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z")
  };
}

function classification(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`name:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

function behaviorProfile(): AddressBehaviorProfile {
  return {
    subjectAddress: subject,
    incomingVolumeRaw: "0",
    outgoingVolumeRaw: "700000000000",
    incomingTxCount: 0,
    outgoingTxCount: 3,
    uniqueIncomingCounterparties: 0,
    uniqueOutgoingCounterparties: 3,
    largestIncomingRaw: null,
    largestOutgoingRaw: "300000000000",
    topOutgoingCounterpartyAddress: behaviorOnly,
    topOutgoingCounterpartyRaw: "300000000000",
    topOutgoingCounterpartyTxCount: 1,
    topOutgoingCounterpartyRatio: 0.4286,
    inflowToOutflowRatio: null,
    drainToServiceRatio: 0,
    timeToFirstOutgoingMs: null,
    timeToFirstServiceExitMs: null,
    depositThenDrainScore: 0,
    transitScore: 25,
    dampenerScore: 0,
    features: [
      {
        code: "address_behavior_collector_like_wallet",
        label: "collector-like wallet",
        scoreImpact: 25
      }
    ]
  };
}

function counterpartyProfile(): CounterpartyRiskProfile {
  return {
    subjectAddress: subject,
    direction: "outbound",
    counterpartyAddress: risky,
    label: "darknet_exchange_proximity",
    serviceCategory: null,
    identity: null,
    amountRaw: "200000000000",
    txCount: 1,
    volumeRatio: 0.2857,
    firstTransferAt: "2026-05-20T10:00:00.000Z",
    lastTransferAt: "2026-05-20T10:00:00.000Z",
    txHashes: ["tx-risky"],
    score: 80,
    features: []
  };
}

describe("coverage debug report", () => {
  it("summarizes all direct counterparties with deterministic evidence and skipped reasons", () => {
    const labelsByAddress = new Map<string, AddressLabel[]>([[risky, [label(risky)]]]);
    const classifications = new Map<string, ServiceClassification | null>([
      [service, classification("router", "MetaRouter")],
      [risky, classification("none", null)],
      [behaviorOnly, classification("none", null)],
      [normal, classification("none", null)]
    ]);

    const report = buildCoverageDebugSnapshot({
      subjectAddress: subject,
      status: "completed",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      sourceTransferPages: 2,
      inboundSendersExpanded: 1,
      sourceWindowEdgeCount: 4,
      sourceRecentFallbackEdgeCount: 0,
      sourceRecentFallbackRequestedLimit: 60,
      sourceEdges: [
        edge({ id: "tx-risky", from: subject, to: risky, amountRaw: "200000000000", at: "2026-05-20T10:00:00.000Z" }),
        edge({ id: "tx-service", from: subject, to: service, amountRaw: "100000000000", at: "2026-05-20T10:05:00.000Z" }),
        edge({ id: "tx-behavior", from: subject, to: behaviorOnly, amountRaw: "300000000000", at: "2026-05-20T10:10:00.000Z" }),
        edge({ id: "tx-normal", from: normal, to: subject, amountRaw: "400000000000", at: "2026-05-20T09:50:00.000Z" })
      ],
      provenanceEdges: [],
      expandedAddresses: [normal],
      labelsByAddress,
      classifications,
      counterpartyRiskProfiles: [counterpartyProfile()],
      serviceExposureProfiles: [],
      addressBehaviorProfiles: [behaviorProfile()],
      inboundProvenanceProfiles: [],
      boundaryExposureProfiles: [],
      operationalFlowProfiles: [],
      walletRoleProfiles: [],
      extendedProvenanceProfiles: [],
      missingChecks: []
    });

    expect(report.summary).toMatchObject({
      directCounterpartyCount: 4,
      analyzedCounterpartyCount: 4,
      expandedCounterpartyCount: 1,
      skippedCounterpartyCount: 3,
      thirtyDayTransferCount: 4,
      historicalFallbackRequestedLimit: 60,
      legacyPartial: false
    });
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        counterparty: risky,
        direction: "outbound",
        label: "darknet_exchange_proximity",
        cachedRisk: "high",
        scoreContribution: 80,
        evidenceClass: "exact_labeled_counterparty",
        skippedReason: null
      }),
      expect.objectContaining({
        counterparty: service,
        serviceCategory: "router",
        identity: "MetaRouter",
        scoreContribution: 0,
        evidenceClass: "service_boundary_context",
        skippedReason: "service_boundary_stop"
      }),
      expect.objectContaining({
        counterparty: behaviorOnly,
        scoreContribution: 0,
        evidenceClass: "behavior_only_context",
        skippedReason: "behavior_only_context"
      }),
      expect.objectContaining({
        counterparty: normal,
        direction: "inbound",
        expanded: true,
        skippedReason: "no_label"
      })
    ]));
  });

  it("renders a compact terminal summary and table", () => {
    const report = buildCoverageDebugReportFromJob({
      id: "job-1",
      subjectAddress: subject,
      status: "partial",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      progressJson: {},
      resultJson: {
        subjectAddress: subject,
        coverageDebug: {
          jobId: null,
          subjectAddress: subject,
          status: "completed",
          windowStart: "2026-05-01T00:00:00.000Z",
          windowEnd: "2026-05-24T00:00:00.000Z",
          summary: {
            sourceTransferPages: 1,
            transferEdges: 2,
            inboundSendersExpanded: 1,
            extendedIndexedEdges: 0,
            extendedFetchedAddresses: 0,
            apiKeyConfigured: true,
            thirtyDayTransferCount: 2,
            historicalFallbackTransferCount: 0,
            historicalFallbackRequestedLimit: 60,
            directCounterpartyCount: 1,
            analyzedCounterpartyCount: 1,
            expandedCounterpartyCount: 0,
            metadataEnrichedCounterpartyCount: 0,
            skippedCounterpartyCount: 1,
            legacyPartial: false
          },
          rows: [
            {
              direction: "outbound",
              counterparty: service,
              volumeRaw: "100000000000",
              volumeRatio: 1,
              txCount: 1,
              firstSeen: "2026-05-20T10:00:00.000Z",
              lastSeen: "2026-05-20T10:00:00.000Z",
              seen: true,
              analyzed: true,
              expanded: false,
              metadataEnriched: true,
              label: null,
              cachedRisk: "none",
              serviceCategory: "router",
              identity: "MetaRouter",
              scoreContribution: 0,
              evidenceClass: "service_boundary_context",
              skippedReason: "service_boundary_stop"
            }
          ],
          missingChecks: ["Expansion stopped at service boundary"],
          notes: []
        }
      },
      lastError: null
    });

    expect(formatCoverageDebugSummary(report)).toContain("Job: job-1 (partial)");
    expect(formatCoverageDebugSummary(report)).toContain("Direct counterparties: 1");
    expect(formatCoverageDebugTable(report)).toContain("direction");
    expect(formatCoverageDebugTable(report)).toContain("MetaRouter");
    expect(formatCoverageDebugTable(report)).toContain("service_boundary_stop");
  });

  it("gracefully summarizes legacy jobs without coverageDebug", () => {
    const report = buildCoverageDebugReportFromJob({
      id: "job-legacy",
      subjectAddress: subject,
      status: "completed",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      progressJson: { sourceTransferPages: 1 },
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 29, inboundSendersExpanded: 1 },
        missingChecks: [
          `30d window had 16 USDT transfers for ${subject}; added latest 44/60 historical USDT transfers for sparse-wallet context.`
        ]
      },
      lastError: null
    });

    expect(report.summary).toMatchObject({
      legacyPartial: true,
      thirtyDayTransferCount: 16,
      historicalFallbackTransferCount: 44,
      historicalFallbackRequestedLimit: 60,
      transferEdges: 29,
      inboundSendersExpanded: 1
    });
    expect(report.rows).toEqual([]);
    expect(report.notes[0]).toContain("Legacy job has no coverageDebug");
  });
});
