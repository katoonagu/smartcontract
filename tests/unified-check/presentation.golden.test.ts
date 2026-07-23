import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  buildPresentationManifest,
  renderUnifiedWalletPresentation
} from "../../src/unifiedCheck/presentation";
import type {
  UnifiedWalletDossierV1,
  UnifiedWalletReportSection
} from "../../src/unifiedCheck/report";

const goldenRoot = join(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "audit",
  "2026-07-system-audit",
  "golden-v2",
  "locked",
  "cases"
);

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function minimalReport(input: {
  caseId: string;
  subjectAddress: string;
  score: number;
  decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  factIds: string[];
  blockNumber: string;
  blockHash: string;
  timestamp: string;
}): UnifiedWalletDossierV1 {
  const canonicalFactIds = input.factIds.length === 0
    ? [`neutral:${input.caseId}`]
    : [...new Set(input.factIds)].sort();
  const currentBalanceAttribution = {
    kind: "balance_formation" as const,
    scope: "current_balance_attribution" as const,
    denominatorRaw: "0",
    rows: []
  };
  const sections: UnifiedWalletReportSection[] = [
    {
      kind: "score_action",
      score: input.score,
      decision: input.decision,
      action: input.decision === "ACCEPTABLE"
        ? "proceed"
        : input.decision === "REVIEW"
          ? "review"
          : "decline"
    },
    {
      kind: "score_drivers",
      rows: [{
        code: input.caseId,
        factIds: canonicalFactIds,
        collapsedFactCount: canonicalFactIds.length
      }]
    },
    currentBalanceAttribution,
    {
      kind: "outgoing_movement",
      scope: "all_direct_outgoing_to_snapshot",
      denominatorRaw: "0",
      rows: []
    },
    {
      kind: "services_boundaries",
      rows: [],
      reconciliation: {
        incoming: { attributedAmountRaw: "0", denominatorRaw: "0" },
        outgoing: { attributedAmountRaw: "0", denominatorRaw: "0" }
      }
    },
    { kind: "contracts_approvals", rows: [] },
    { kind: "behavior_connections", rows: [] },
    {
      kind: "wallet_profile",
      profile: {
        createdAt: null,
        firstUsdtActivityAt: null,
        lastUsdtActivityAt: null,
        incomingUsdtTransferCount: 0,
        outgoingUsdtTransferCount: 0,
        snapshotUsdtBalanceRaw: "0",
        snapshotTrxBalanceSun: "0",
        liveBalanceObservation: null
      },
      asOfBlock: input.blockNumber,
      observedAt: input.timestamp,
      consistency: "snapshot_exact"
    },
    { kind: "coverage", scoringAuthority: false, dimensions: [] },
    {
      kind: "conclusion",
      code: input.decision === "ACCEPTABLE"
        ? "low_risk"
        : input.decision === "REVIEW"
          ? "manual_review"
          : "decline"
    },
    {
      kind: "snapshot",
      blockNumber: input.blockNumber,
      blockHash: input.blockHash,
      timestamp: input.timestamp
    }
  ];
  const factInventory = {
    version: "report-fact-inventory-v1" as const,
    canonicalFactIds,
    sections: sections.map((section) => ({
      sectionId: section.kind,
      factIds: section.kind === "score_drivers"
        ? canonicalFactIds
        : [],
      collapsedFactCount: section.kind === "score_drivers"
        ? canonicalFactIds.length
        : 0
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
    subjectAddress: input.subjectAddress,
    score: input.score,
    decision: input.decision,
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

describe("Unified Telegram locked Golden HTML", () => {
  it("matches every adjudicated locale fixture byte for byte", async () => {
    for (const caseId of (await readdir(goldenRoot)).sort()) {
      const adjudication = await json(
        join(goldenRoot, caseId, "adjudication.json")
      );
      const neutral = await json(
        join(goldenRoot, caseId, "neutral-bundle.json")
      );
      const snapshot = neutral.snapshot as Record<string, string>;
      const report = minimalReport({
        caseId,
        subjectAddress: neutral.subjectAddress as string,
        score: adjudication.exactScore as number,
        decision: adjudication.expectedDecision as
          "ACCEPTABLE" | "REVIEW" | "DECLINE",
        factIds: (adjudication.resolvedFacts as
          Array<{ canonicalFactId: string }>).map((fact) =>
          fact.canonicalFactId
        ),
        blockNumber: snapshot.confirmedBlockNumber!,
        blockHash: snapshot.confirmedBlockHash!,
        timestamp: snapshot.timestamp!
      });
      for (const expected of adjudication.telegramExpectation as Array<{
        locale: "ru" | "en";
        exactHtml: string;
      }>) {
        const result = renderUnifiedWalletPresentation({
          report,
          manifest: buildPresentationManifest(report, expected.locale)
        });
        expect(result.artifact.html, `${caseId}:${expected.locale}`)
          .toBe(expected.exactHtml);
      }
    }
  });
});
