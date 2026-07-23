import { describe, expect, it } from "vitest";
import { TELEGRAM_MESSAGE_LIMIT } from "../../src/alerts/telegramHtml";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  buildPresentationManifest,
  ensurePresentationForRequest,
  renderRequiredUnifiedPresentations,
  renderUnifiedWalletPresentation
} from "../../src/unifiedCheck/presentation";
import type {
  UnifiedWalletDossierV1,
  UnifiedWalletReportSection
} from "../../src/unifiedCheck/report";

const address = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const serviceAddress = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";
const factIds = ["fact-behavior", "fact-driver", "fact-service"];

function report(): UnifiedWalletDossierV1 {
  const currentBalanceAttribution = {
    kind: "balance_formation" as const,
    scope: "current_balance_attribution" as const,
    denominatorRaw: "50000000",
    rows: [{
      key: "Bybit",
      amount: {
        scope: "current_balance_attribution",
        amountRaw: "50000000",
        denominatorRaw: "50000000",
        sharePpm: 1_000_000
      },
      transferCount: 2,
      factIds: ["fact-service"]
    }]
  };
  const sections: UnifiedWalletReportSection[] = [
    {
      kind: "score_action",
      score: 45,
      decision: "REVIEW",
      action: "review"
    },
    {
      kind: "score_drivers",
      rows: [{
        code: "collector_transit",
        factIds: ["fact-driver"],
        collapsedFactCount: 1
      }]
    },
    currentBalanceAttribution,
    {
      kind: "outgoing_movement",
      scope: "all_direct_outgoing_to_snapshot",
      denominatorRaw: "30000000",
      rows: []
    },
    {
      kind: "services_boundaries",
      rows: [
        {
          service: "Bybit",
          address: serviceAddress,
          direction: "incoming",
          directness: "direct",
          amount: {
            scope: "incoming_service_links",
            amountRaw: "20000000",
            denominatorRaw: "50000000",
            sharePpm: 400_000
          },
          transferCount: 2,
          factIds: ["fact-service"]
        },
        {
          service: "Bybit",
          address: serviceAddress,
          direction: "incoming",
          directness: "direct",
          amount: {
            scope: "incoming_service_links",
            amountRaw: "10000000",
            denominatorRaw: "50000000",
            sharePpm: 200_000
          },
          transferCount: 1,
          factIds: ["fact-service"]
        }
      ],
      reconciliation: {
        incoming: {
          attributedAmountRaw: "30000000",
          denominatorRaw: "50000000"
        },
        outgoing: {
          attributedAmountRaw: "0",
          denominatorRaw: "0"
        }
      }
    },
    { kind: "contracts_approvals", rows: [] },
    {
      kind: "behavior_connections",
      rows: [{
        code: "collector_pattern",
        role: "collector",
        factIds: ["fact-behavior"],
        collapsedFactCount: 3
      }]
    },
    {
      kind: "wallet_profile",
      profile: {
        createdAt: "2024-03-14T00:00:00.000Z",
        firstUsdtActivityAt: "2024-03-16T00:00:00.000Z",
        lastUsdtActivityAt: "2026-07-21T00:00:00.000Z",
        incomingUsdtTransferCount: 436,
        outgoingUsdtTransferCount: 194,
        snapshotUsdtBalanceRaw: "50000000",
        snapshotTrxBalanceSun: "117300000",
        liveBalanceObservation: null
      },
      asOfBlock: "84713573",
      observedAt: "2026-07-23T12:53:54.000Z",
      consistency: "snapshot_exact"
    },
    {
      kind: "coverage",
      scoringAuthority: false,
      dimensions: [{
        direction: "backward",
        selectionPpm: 1_000_000,
        tracePpm: 800_000,
        identifiedPpm: 600_000,
        unknownBoundaryPpm: 200_000,
        untracedPpm: 200_000
      }]
    },
    { kind: "conclusion", code: "manual_review" },
    {
      kind: "snapshot",
      blockNumber: "84713573",
      blockHash: "a".repeat(64),
      timestamp: "2026-07-23T12:53:54.000Z"
    }
  ];
  const factInventory = {
    version: "report-fact-inventory-v1" as const,
    canonicalFactIds: factIds,
    sections: sections.map((section) => ({
      sectionId: section.kind,
      factIds: section.kind === "score_drivers"
        ? ["fact-driver"]
        : section.kind === "balance_formation" ||
          section.kind === "services_boundaries"
          ? ["fact-service"]
          : section.kind === "behavior_connections"
            ? ["fact-behavior"]
            : [],
      collapsedFactCount: section.kind === "behavior_connections" ? 3 : 0
    }))
  };
  return {
    version: "unified-wallet-report-v1",
    schemaVersion: 1,
    dossierVersion: "unified-wallet-dossier-v1",
    analysisManifestHash: "1".repeat(64),
    evidenceBundleHash: "2".repeat(64),
    traversalClosureHash: "3".repeat(64),
    scoringBundleHash: "4".repeat(64),
    subjectAddress: address,
    score: 45,
    decision: "REVIEW",
    factInventoryHash: fingerprintCanonicalArtifact(factInventory),
    selectedAttributionPolicy: "proportional",
    sections,
    currentBalanceAttribution,
    latestPrincipalInboundEventsScope:
      "latest_five_principal_inbound_events",
    latestPrincipalInboundEvents: [],
    negativeFacts: [],
    factInventory
  };
}

describe("Unified Telegram presentation", () => {
  it("renders one deterministic locale payload and proves all normative sections", () => {
    const dossier = report();
    const ruManifest = buildPresentationManifest(dossier, "ru");
    const first = renderUnifiedWalletPresentation({
      report: dossier,
      manifest: ruManifest
    });
    const second = renderUnifiedWalletPresentation({
      report: dossier,
      manifest: ruManifest
    });
    const en = renderUnifiedWalletPresentation({
      report: dossier,
      manifest: buildPresentationManifest(dossier, "en")
    });

    expect(second).toEqual(first);
    expect(first.artifact.html.length).toBeLessThanOrEqual(
      TELEGRAM_MESSAGE_LIMIT
    );
    expect(first.artifact.html).not.toContain("truncated");
    expect(first.receipt.omittedCanonicalFactIds).toEqual([]);
    expect(first.receipt.presentationHash).toBe(first.presentationHash);
    expect(first.receipt.sections.map((section) => section.sectionId))
      .toEqual(dossier.sections.map((section) => section.kind));
    expect(en.manifest.reportHash).toBe(first.manifest.reportHash);
    expect(en.presentationHash).not.toBe(first.presentationHash);
  });

  it("aggregates repeated service rows and renders each address URL once", () => {
    const result = renderUnifiedWalletPresentation({
      report: report(),
      manifest: buildPresentationManifest(report(), "ru")
    });
    const url = `https://tronscan.org/#/address/${serviceAddress}`;
    expect(result.artifact.html.split(url)).toHaveLength(2);
    expect(result.artifact.html).toContain("30 USDT");
    expect(result.artifact.html).toContain("60%");
    expect(result.artifact.html).toContain("3");
  });

  it("compacts large non-critical examples without losing category totals", () => {
    const dossier = report();
    const behavior = dossier.sections.find((section) =>
      section.kind === "behavior_connections"
    );
    if (behavior?.kind !== "behavior_connections") throw new Error("fixture");
    const large = {
      ...dossier,
      sections: dossier.sections.map((section) =>
        section.kind === "behavior_connections"
          ? {
              ...section,
              rows: Array.from({ length: 180 }, (_, index) => ({
                code: `context_${index}_${"x".repeat(80)}`,
                role: "context",
                factIds: ["fact-behavior"],
                collapsedFactCount: 1
              }))
            }
          : section
      )
    } as UnifiedWalletDossierV1;
    const result = renderUnifiedWalletPresentation({
      report: large,
      manifest: buildPresentationManifest(large, "en")
    });
    expect(result.artifact.html.length).toBeLessThanOrEqual(
      TELEGRAM_MESSAGE_LIMIT
    );
    expect(result.artifact.html).toContain("180 facts");
    expect(result.receipt.omittedCanonicalFactIds).toEqual([]);
  });

  it("fails closed instead of slicing an impossible essential presentation", () => {
    const dossier = report();
    const impossible = {
      ...dossier,
      sections: dossier.sections.map((section) =>
        section.kind === "score_drivers"
          ? {
              ...section,
              rows: Array.from({ length: 500 }, (_, index) => ({
                code: `hard_driver_${index}_${"x".repeat(100)}`,
                factIds: ["fact-driver"],
                collapsedFactCount: 1
              }))
            }
          : section
      )
    } as UnifiedWalletDossierV1;
    expect(() => renderUnifiedWalletPresentation({
      report: impossible,
      manifest: buildPresentationManifest(impossible, "ru")
    })).toThrow("presentation_contract_failed");
  });

  it("fails closed when the report inventory leaves a canonical fact unbound", () => {
    const dossier = report();
    const invalid = {
      ...dossier,
      factInventory: {
        ...dossier.factInventory,
        sections: dossier.factInventory.sections.map((entry) => ({
          ...entry,
          factIds: []
        }))
      }
    } as UnifiedWalletDossierV1;
    const rebound = {
      ...invalid,
      factInventoryHash: fingerprintCanonicalArtifact(invalid.factInventory)
    };
    expect(() => buildPresentationManifest(rebound, "ru"))
      .toThrow("presentation_contract_failed");
  });

  it("prebuilds required locales and reuses only the exact immutable locale artifact", () => {
    const dossier = report();
    const required = renderRequiredUnifiedPresentations({
      report: dossier,
      locales: ["ru", "en", "ru"]
    });
    expect(required.map((item) => item.manifest.locale)).toEqual(["en", "ru"]);
    expect(new Set(required.map((item) => item.manifest.reportHash)).size)
      .toBe(1);

    const reused = ensurePresentationForRequest({
      report: dossier,
      locale: "ru",
      existing: required
    });
    expect(reused.reused).toBe(true);
    expect(reused.presentation).toEqual(
      required.find((item) => item.manifest.locale === "ru")
    );

    const enOnly = required.filter((item) => item.manifest.locale === "en");
    const created = ensurePresentationForRequest({
      report: dossier,
      locale: "ru",
      existing: enOnly
    });
    expect(created.reused).toBe(false);
    expect(created.presentation.manifest.reportHash)
      .toBe(required[0]!.manifest.reportHash);
  });
});
