import { describe, expect, it } from "vitest";
import { formatAddressExposureReport, formatForensicRouteReport } from "../../src/forensics/routeReport";
import type { AddressExposureReport, RouteSearchReport } from "../../src/types";

describe("forensic route report formatter", () => {
  it("prints case id, ranked path evidence, reasons, and dry-run status", () => {
    const report: RouteSearchReport = {
      case: {
        id: "case-1",
        sourceAddress: "TSource111111111111111111111111111111",
        targetAddress: "TTarget111111111111111111111111111111",
        amountUsdt: "320000",
        windowStart: new Date("2026-05-01T00:00:00.000Z"),
        windowEnd: new Date("2026-05-31T00:00:00.000Z"),
        status: "completed"
      },
      paths: [
        {
          id: "path-1",
          caseId: "case-1",
          rank: 1,
          score: 82,
          confidence: "medium",
          pathAddresses: ["TSource111111111111111111111111111111", "TTarget111111111111111111111111111111"],
          features: [{ code: "amount_preservation", label: "96% amount preserved", scoreImpact: 22 }],
          reasons: [{ code: "amount_preservation", message: "96% amount preserved; candidate path requires manual review", scoreImpact: 22 }],
          rawEvidenceId: "evidence-1",
          edges: [
            {
              id: "edge-1",
              fromAddress: "TSource111111111111111111111111111111",
              toAddress: "TTarget111111111111111111111111111111",
              txHash: "tx-1",
              amountRaw: "320000000000",
              timestamp: new Date("2026-05-05T10:00:00.000Z"),
              method: "transfer",
              edgeType: "normal_transfer"
            }
          ]
        }
      ],
      rawEvidence: [],
      observations: [],
      missingChecks: [],
      serviceExposureProfiles: [
        {
          subjectAddress: "TSource111111111111111111111111111111",
          totalOutgoingRaw: "400000000000",
          totalOutgoingCount: 2,
          directServiceVolumeRatio: 0.75,
          directServiceTxRatio: 0.5,
          indirectServiceVolumeRatio: 0.25,
          indirectServiceTxRatio: 0.5,
          mergedServiceVolumeRatio: 0,
          mergedServiceGroupCount: 0,
          combinedServiceVolumeRatio: 1,
          combinedServiceTxRatio: 1,
          dominantCategory: "bridge",
          categoryBreakdown: [
            { category: "bridge", volumeRaw: "300000000000", txCount: 1, volumeRatio: 0.75 },
            { category: "bridge_pool", volumeRaw: "100000000000", txCount: 1, volumeRatio: 0.25 }
          ],
          topServiceCounterparties: [
            {
              address: "TBridge111111111111111111111111111111",
              category: "bridge",
              identity: "Allbridge Bridge",
              volumeRaw: "300000000000",
              txCount: 1
            }
          ],
          topMergedServiceFlows: [],
          fastestServiceExitMs: 30 * 60 * 1000,
          bestAmountPreservationRatio: 0.95,
          exposureScore: 75,
          features: [
            {
              code: "service_exposure_high_volume",
              label: "Large share of outgoing USDT volume exits to service infrastructure",
              scoreImpact: 30,
              value: 1
            }
          ]
        }
      ]
    };

    const text = formatForensicRouteReport(report, { dryRun: true });

    expect(text).toContain("Forensic Route Search");
    expect(text).toContain("Case: case-1");
    expect(text).toContain("DRY RUN");
    expect(text).toContain("Path #1");
    expect(text).toContain("Score: 82/100");
    expect(text).toContain("tx-1");
    expect(text).toContain("96% amount preserved");
    expect(text).toContain("Service Exposure");
    expect(text).toContain("Dominant category: bridge");
    expect(text).toContain("Allbridge Bridge");
    expect(text.toLowerCase()).not.toContain("fraud proven");
  });

  it("prints address-only exposure reports with merged service flow details", () => {
    const report: AddressExposureReport = {
      subjectAddress: "TSource111111111111111111111111111111",
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      rawEvidence: [],
      observations: [],
      missingChecks: [],
      serviceExposureProfiles: [
        {
          subjectAddress: "TSource111111111111111111111111111111",
          totalOutgoingRaw: "311851000000",
          totalOutgoingCount: 4,
          directServiceVolumeRatio: 0,
          directServiceTxRatio: 0,
          indirectServiceVolumeRatio: 0,
          indirectServiceTxRatio: 0,
          mergedServiceVolumeRatio: 1,
          mergedServiceGroupCount: 1,
          combinedServiceVolumeRatio: 1,
          combinedServiceTxRatio: 1,
          dominantCategory: "bridge_pool",
          categoryBreakdown: [
            { category: "bridge_pool", volumeRaw: "311851000000", txCount: 4, volumeRatio: 1 }
          ],
          topServiceCounterparties: [
            {
              address: "TAllbridge11111111111111111111111111",
              category: "bridge_pool",
              identity: "Allbridge LP",
              volumeRaw: "311851000000",
              txCount: 4
            }
          ],
          topMergedServiceFlows: [
            {
              intermediateAddress: "THop1111111111111111111111111111111",
              serviceAddress: "TAllbridge11111111111111111111111111",
              category: "bridge_pool",
              identity: "Allbridge LP",
              incomingRaw: "311851000000",
              outgoingServiceRaw: "311752000000",
              sourceTxCount: 4,
              serviceTxCount: 1,
              amountPreservationRatio: 0.9996,
              firstSourceTransferAt: "2026-05-09T21:06:51.000Z",
              lastServiceTransferAt: "2026-05-09T23:14:06.000Z"
            }
          ],
          fastestServiceExitMs: 795_000,
          bestAmountPreservationRatio: 0.9996,
          exposureScore: 95,
          features: [
            {
              code: "service_exposure_merged_high_volume",
              label: "Large merged outgoing USDT volume appears to exit to service infrastructure",
              scoreImpact: 30,
              value: 1
            }
          ]
        }
      ]
    };

    const text = formatAddressExposureReport(report, { dryRun: true });

    expect(text).toContain("Address Service Exposure");
    expect(text).toContain("DRY RUN");
    expect(text).toContain("Merged service volume: 100%");
    expect(text).toContain("THop1111111111111111111111111111111 -> TAllbridge11111111111111111111111111");
    expect(text).toContain("Allbridge LP");
    expect(text).toContain("merged service exposure candidate requires manual review");
    expect(text.toLowerCase()).not.toContain("fraud proven");
  });
});
