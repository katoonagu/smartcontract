import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import { buildUnifiedWalletReport } from "../../src/unifiedCheck/report";
import type {
  AnalysisManifestV1,
  EvidenceBundleV1,
  ScoringBundleV1,
  TraversalClosureCertificateV1
} from "../../src/unifiedCheck/contracts";
import type { WalletMetrics } from "../../src/wallet/metrics";

const subjectAddress = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const manifest: AnalysisManifestV1 = {
  version: "analysis-manifest-v1",
  schemaVersion: 1,
  runId: "run-report",
  requestHash: "1".repeat(64),
  snapshotHash: "2".repeat(64),
  chain: "tron",
  subjectAddress,
  confirmedBlockNumber: "84713573",
  confirmedBlockHash: "3".repeat(64),
  confirmedBlockTimestamp: "2026-07-23T12:53:54.000Z",
  labelDatasetSha256: "4".repeat(64),
  scoringPolicyVersion: "scoring-signal-matrix-v4",
  attributionPolicyVersion: "selected-attribution-policy-v1",
  traversalPolicyVersion: "snapshot-closure-v1",
  runtimeCommit: "candidate",
  databaseSchemaVersion: 33,
  paginationCutoffBlockNumber: "84713573",
  paginationCutoffBlockHash: "3".repeat(64),
  branchArtifactHashes: {
    fast: "5".repeat(64),
    where: "6".repeat(64),
    deep: "7".repeat(64)
  }
};
const manifestHash = fingerprintCanonicalArtifact(manifest);
const canonicalFactIds = [
  "fact-approval",
  "fact-behavior",
  "fact-direct-service",
  "fact-driver",
  "fact-indirect-service",
  "fact-negative"
].sort();
const evidence: EvidenceBundleV1 = {
  version: "evidence-bundle-v1",
  schemaVersion: 1,
  analysisManifestHash: manifestHash,
  canonicalFactsHash: "8".repeat(64),
  canonicalFactIds,
  acceptedChildAttemptHashes: {
    fast: "9".repeat(64),
    where: "a".repeat(64),
    deep: "b".repeat(64)
  },
  branchOutputHashes: {
    fast: "c".repeat(64),
    where: "d".repeat(64),
    deep: "e".repeat(64)
  }
};
const evidenceHash = fingerprintCanonicalArtifact(evidence);
const closure: TraversalClosureCertificateV1 = {
  version: "traversal-closure-certificate-v1",
  schemaVersion: 1,
  analysisManifestHash: manifestHash,
  snapshotHash: manifest.snapshotHash,
  visitedStateHash: "f".repeat(64),
  frontierHash: "0".repeat(64),
  closed: true
};
const closureHash = fingerprintCanonicalArtifact(closure);
const scoring: ScoringBundleV1 = {
  version: "scoring-bundle-v1",
  schemaVersion: 1,
  evidenceBundleHash: evidenceHash,
  traversalClosureHash: closureHash,
  policyVersion: "scoring-signal-matrix-v4",
  scoreAnchorHash: "1".repeat(64),
  score: 45,
  decision: "REVIEW"
};

function metrics(balanceRaw = "50000000"): WalletMetrics {
  return {
    version: "unified-wallet-metrics-v1",
    asOfBlock: "84713573",
    observedAt: "2026-07-23T12:53:54.000Z",
    consistency: "snapshot_exact",
    profile: {
      createdAt: "2024-03-14T00:00:00.000Z",
      firstUsdtActivityAt: "2024-03-16T00:00:00.000Z",
      lastUsdtActivityAt: "2026-07-21T00:00:00.000Z",
      incomingUsdtTransferCount: 436,
      outgoingUsdtTransferCount: 194,
      snapshotUsdtBalanceRaw: balanceRaw,
      snapshotTrxBalanceSun: "117300000",
      liveBalanceObservation: null
    },
    scoreDrivers: [{
      code: "collector_pattern",
      factIds: ["fact-driver"],
      collapsedFactCount: 1
    }],
    currentBalanceAttribution: {
      scope: "current_balance_attribution",
      denominatorRaw: balanceRaw,
      rows: balanceRaw === "0" ? [] : [{
        key: "Bybit",
        amountRaw: balanceRaw,
        transferCount: 17,
        factIds: ["fact-direct-service"]
      }]
    },
    outgoingMovement: {
      scope: "all_direct_outgoing_to_snapshot",
      denominatorRaw: "30000000",
      rows: [{
        key: "Bitget",
        amountRaw: "30000000",
        transferCount: 6,
        factIds: ["fact-direct-service"]
      }]
    },
    serviceLinks: [
      {
        service: "Bybit",
        address: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
        direction: "incoming",
        directness: "direct",
        amountRaw: "20000000",
        denominatorRaw: "50000000",
        transferCount: 4,
        factIds: ["fact-direct-service"]
      },
      {
        service: "Bybit",
        address: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
        direction: "incoming",
        directness: "indirect",
        amountRaw: "10000000",
        denominatorRaw: "50000000",
        transferCount: 2,
        factIds: ["fact-indirect-service"]
      },
      {
        service: "Bitget",
        address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
        direction: "outgoing",
        directness: "direct",
        amountRaw: "30000000",
        denominatorRaw: "30000000",
        transferCount: 6,
        factIds: ["fact-direct-service"]
      }
    ],
    contractsAndApprovals: [{
      code: "dangerous_approval",
      counterparty: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
      amountRaw: null,
      factIds: ["fact-approval"]
    }],
    behaviorAndConnections: [{
      code: "collector_pattern",
      role: "collector",
      factIds: ["fact-behavior"],
      collapsedFactCount: 3
    }],
    coverage: [
      {
        direction: "backward",
        selectionPpm: 1_000_000,
        tracePpm: 800_000,
        identifiedPpm: 600_000,
        unknownBoundaryPpm: 200_000,
        untracedPpm: 200_000
      },
      {
        direction: "forward",
        selectionPpm: 1_000_000,
        tracePpm: 1_000_000,
        identifiedPpm: 1_000_000,
        unknownBoundaryPpm: 0,
        untracedPpm: 0
      }
    ],
    principalInboundEvents: Array.from({ length: 7 }, (_, index) => ({
      eventId: `deposit-${index}`,
      txHash: `${index}`.repeat(64),
      timestamp: `2026-07-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
      fromAddress: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
      amountRaw: String((index + 1) * 1_000_000),
      factIds: ["fact-direct-service"]
    })),
    negativeFacts: [
      {
        code: "no_blacklist_relation",
        scope: "direct_history",
        scopeStatus: "COMPLETED",
        factIds: ["fact-negative"]
      },
      {
        code: "no_dangerous_approval",
        scope: "approval_history",
        scopeStatus: "INCOMPLETE",
        factIds: ["fact-negative"]
      }
    ]
  };
}

function build(walletMetrics = metrics()) {
  return buildUnifiedWalletReport({
    manifest,
    evidence,
    closure,
    scoring,
    walletMetrics,
    selectedAttributionPolicy: "proportional"
  });
}

describe("Unified wallet dossier", () => {
  it("emits the approved semantic section order and immutable hash bindings", () => {
    const report = build();
    expect(report.sections.map((section) => section.kind)).toEqual([
      "score_action",
      "score_drivers",
      "balance_formation",
      "outgoing_movement",
      "services_boundaries",
      "contracts_approvals",
      "behavior_connections",
      "wallet_profile",
      "coverage",
      "conclusion",
      "snapshot"
    ]);
    expect(report).toMatchObject({
      subjectAddress,
      score: 45,
      decision: "REVIEW",
      analysisManifestHash: manifestHash,
      evidenceBundleHash: evidenceHash,
      traversalClosureHash: closureHash,
      selectedAttributionPolicy: "proportional"
    });
  });

  it("keeps direct/indirect and incoming/outgoing service scopes separate", () => {
    const services = build().sections.find((section) =>
      section.kind === "services_boundaries"
    );
    expect(services?.kind).toBe("services_boundaries");
    if (services?.kind !== "services_boundaries") return;
    expect(services.rows.map((row) => [
      row.direction,
      row.directness,
      row.amount.amountRaw,
      row.amount.denominatorRaw,
      row.amount.sharePpm
    ])).toEqual([
      ["incoming", "direct", "20000000", "50000000", 400_000],
      ["incoming", "indirect", "10000000", "50000000", 200_000],
      ["outgoing", "direct", "30000000", "30000000", 1_000_000]
    ]);
    expect(services.reconciliation).toEqual({
      incoming: {
        attributedAmountRaw: "30000000",
        denominatorRaw: "50000000"
      },
      outgoing: {
        attributedAmountRaw: "30000000",
        denominatorRaw: "30000000"
      }
    });
  });

  it("keeps current balance attribution distinct from the newest five episodes at every balance", () => {
    for (const balance of ["0", "50000000", "5000000000"]) {
      const report = build(metrics(balance));
      expect(report.currentBalanceAttribution.scope)
        .toBe("current_balance_attribution");
      expect(report.latestPrincipalInboundEvents).toHaveLength(5);
      expect(report.latestPrincipalInboundEvents.map((event) => event.eventId))
        .toEqual(["deposit-6", "deposit-5", "deposit-4", "deposit-3", "deposit-2"]);
      expect(report.latestPrincipalInboundEventsScope)
        .toBe("latest_five_principal_inbound_events");
    }
  });

  it("publishes negative facts only for a completed matching scope", () => {
    const report = build();
    expect(report.negativeFacts.map((item) => item.code))
      .toEqual(["no_blacklist_relation"]);
  });

  it("rejects broken hash chains, bad percentages and unreconciled service totals", () => {
    expect(() => buildUnifiedWalletReport({
      manifest,
      evidence: { ...evidence, analysisManifestHash: "0".repeat(64) },
      closure,
      scoring,
      walletMetrics: metrics(),
      selectedAttributionPolicy: "proportional"
    })).toThrow("unified_report_hash_chain_mismatch");
    const bad = metrics();
    bad.serviceLinks[0] = {
      ...bad.serviceLinks[0]!,
      amountRaw: "60000000"
    };
    expect(() => build(bad)).toThrow("unified_report_service_total_exceeds_scope");
  });
});
