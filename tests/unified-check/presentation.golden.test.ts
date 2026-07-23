import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  buildPresentationManifest,
  renderUnifiedWalletPresentation
} from "../../src/unifiedCheck/presentation";
import { buildUnifiedWalletReport } from "../../src/unifiedCheck/report";
import type {
  AnalysisManifestV1,
  EvidenceBundleV1,
  ScoringBundleV1,
  TraversalClosureCertificateV1
} from "../../src/unifiedCheck/contracts";
import type { WalletMetrics } from "../../src/wallet/metrics";

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
  driverCode: string;
  subjectAddress: string;
  score: number;
  decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  factIds: string[];
  blockNumber: string;
  blockHash: string;
  timestamp: string;
}) {
  const canonicalFactIds = input.factIds.length === 0
    ? [`neutral:${input.driverCode}`]
    : [...new Set(input.factIds)].sort();
  const manifest: AnalysisManifestV1 = {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId: `golden-${input.driverCode}`,
    requestHash: "1".repeat(64),
    snapshotHash: "2".repeat(64),
    chain: "tron",
    subjectAddress: input.subjectAddress,
    confirmedBlockNumber: input.blockNumber,
    confirmedBlockHash: input.blockHash,
    confirmedBlockTimestamp: input.timestamp,
    labelDatasetSha256: "3".repeat(64),
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    traversalPolicyVersion: "snapshot-closure-v1",
    runtimeCommit: "golden-replay",
    databaseSchemaVersion: 33,
    paginationCutoffBlockNumber: input.blockNumber,
    paginationCutoffBlockHash: input.blockHash,
    branchArtifactHashes: {
      fast: "4".repeat(64),
      deep: "5".repeat(64),
      where: "6".repeat(64)
    }
  };
  const manifestHash = fingerprintCanonicalArtifact(manifest);
  const evidence: EvidenceBundleV1 = {
    version: "evidence-bundle-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    canonicalFactsHash: "7".repeat(64),
    canonicalFactIds,
    acceptedChildAttemptHashes: {
      fast: "8".repeat(64),
      deep: "9".repeat(64),
      where: "a".repeat(64)
    },
    branchOutputHashes: { fast: null, deep: null, where: null }
  };
  const closure: TraversalClosureCertificateV1 = {
    version: "traversal-closure-certificate-v1",
    schemaVersion: 1,
    analysisManifestHash: manifestHash,
    snapshotHash: manifest.snapshotHash,
    visitedStateHash: "b".repeat(64),
    frontierHash: "c".repeat(64),
    closed: true
  };
  const scoring: ScoringBundleV1 = {
    version: "scoring-bundle-v1",
    schemaVersion: 1,
    evidenceBundleHash: fingerprintCanonicalArtifact(evidence),
    traversalClosureHash: fingerprintCanonicalArtifact(closure),
    policyVersion: "scoring-signal-matrix-v4",
    scoreAnchorHash: "d".repeat(64),
    score: input.score,
    decision: input.decision,
  };
  const walletMetrics: WalletMetrics = {
    version: "unified-wallet-metrics-v1",
    asOfBlock: input.blockNumber,
    observedAt: input.timestamp,
    consistency: "snapshot_exact",
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
    scoreDrivers: [{
      code: input.driverCode,
      factIds: canonicalFactIds,
      collapsedFactCount: canonicalFactIds.length
    }],
    currentBalanceAttribution: {
      scope: "current_balance_attribution",
      denominatorRaw: "0",
      rows: []
    },
    outgoingMovement: {
      scope: "all_direct_outgoing_to_snapshot",
      denominatorRaw: "0",
      rows: []
    },
    serviceLinks: [],
    contractsAndApprovals: [],
    behaviorAndConnections: [],
    coverage: [],
    principalInboundEvents: [],
    negativeFacts: []
  };
  return buildUnifiedWalletReport({
    manifest,
    evidence,
    closure,
    scoring,
    walletMetrics,
    selectedAttributionPolicy: "proportional"
  });
}

function semanticDriver(
  facts: Array<{
    canonicalFactId: string;
    lane: string;
    role: string;
    timing: string;
  }>
): string {
  const roles = new Set(facts.map((fact) => fact.role));
  const ids = facts.map((fact) => fact.canonicalFactId).join("\n");
  const has = (role: string) => roles.has(role);
  if (has("victim")) return "victim_confirmed_debit";
  if (has("approval_owner")) return "dangerous_approval_no_debit";
  if (has("recipient") && facts.some((fact) => fact.lane === "hard")) {
    return has("cex_subject")
      ? "direct_blacklist_with_safe_volume"
      : "direct_blacklist_at_event";
  }
  if (has("fan_in_fan_out_subject")) return "correlated_dense_transit";
  if (has("collector_sender")) return "collector_transit";
  if (has("high_volume_transit_wallet")) return "high_volume_transit";
  if (has("high_volume_sender")) {
    return facts.some((fact) => fact.timing === "later")
      ? "high_volume_transit_later_labels"
      : "high_volume_transit";
  }
  if (has("route_sender")) return "route_transit";
  if (has("selected_amount_sender")) return "selected_amount_transit";
  if (has("fan_out_sender")) return "fan_out";
  if (has("transit_sender")) return "rapid_forwarding";
  if (has("operational_wallet")) return "operational_wallet";
  if (has("history_subject")) return "history_depth_neutral";
  if (has("delivery_subject")) return "delivery_ambiguity_technical";
  if (has("branch_subject")) return "duplicate_evidence_neutral";
  if (has("dust_recipient")) return "dust_spam_neutral";
  if (has("coverage_subject")) return "provider_key_exhaustion";
  if (has("new_wallet_subject")) return "no_usdt_activity";
  if (has("cex_subject") || ids.includes(":Bybit:")) {
    return "clean_confirmed_context";
  }
  if (has("self_sender_recipient")) return "reorder_invariant";
  if (has("attempt_subject")) return "restart_invariant";
  if (ids.length === 0) return "empty_wallet";
  return "unknown_without_risk_pattern";
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
      const resolvedFacts = adjudication.resolvedFacts as Array<{
        canonicalFactId: string;
        lane: string;
        role: string;
        timing: string;
      }>;
      const report = minimalReport({
        driverCode: semanticDriver(resolvedFacts),
        subjectAddress: neutral.subjectAddress as string,
        score: adjudication.exactScore as number,
        decision: adjudication.expectedDecision as
          "ACCEPTABLE" | "REVIEW" | "DECLINE",
        factIds: resolvedFacts.map((fact) =>
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
