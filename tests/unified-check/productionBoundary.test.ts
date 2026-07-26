import { describe, expect, it } from "vitest";
import { buildFrozenLabelDataset } from "../../src/unifiedCheck/frozenLabels";
import { buildFrozenLabelRecord } from "../../src/unifiedCheck/labelCatalog";
import { evaluateProductionBoundaryV2 } from "../../src/unifiedCheck/productionBoundary";
import { buildUnifiedTraversalBoundaryCommitV2 } from "../../src/unifiedCheck/productionTraversal";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";

const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const COUNTERPARTY = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const SNAPSHOT = "a".repeat(64);
const SOURCE = "b".repeat(64);
const AT = "2026-07-23T12:00:00.000Z";

const state = {
  address: COUNTERPARTY,
  direction: "backward" as const,
  anchorTimestamp: AT,
  fundingEpisodeId: `funding:${SUBJECT}`,
  allocatedAmountRaw: "1000000",
  sourceEventIds: ["tx:0"]
};

function verified(
  catalogEntryId: string,
  validFrom: string | null = "2025-01-01T00:00:00.000Z"
) {
  return buildFrozenLabelRecord({
    address: COUNTERPARTY,
    classifierHint: null,
    exactRegistryBinding: null,
    verifiedProviderBinding: {
      catalogEntryId,
      authority: "tronscan_verified_metadata",
      sourcePayloadSha256: SOURCE,
      validFrom,
      validTo: null
    }
  });
}

function decide(labels: readonly ReturnType<typeof verified>[]) {
  const frozen = buildFrozenLabelDataset({
    frozenAt: AT,
    snapshotHash: SNAPSHOT,
    labels,
    legacyRows: []
  });
  return evaluateProductionBoundaryV2({
    state,
    eventTimestamp: AT,
    labels: frozen.dataset.labels,
    snapshotHash: SNAPSHOT,
    labelDatasetSha256: frozen.sha256
  });
}

describe("Unified production boundary v2", () => {
  it("terminates only a verified custodial record valid at event time", () => {
    const decision = decide([verified("cex:bybit")]);
    expect(decision).toMatchObject({
      terminal: true,
      reason: "identified_service_boundary",
      evidence: {
        version: "unified-traversal-boundary-evidence-v2",
        schemaVersion: 2,
        traversalPolicyVersion: "snapshot-closure-v2",
        predicateVersion: "unified-boundary-predicates-v1",
        state: {
          address: COUNTERPARTY,
          anchorTimestamp: AT
        },
        eventTimestamp: AT,
        snapshotHash: SNAPSHOT,
        labelCatalogEntryId: "cex:bybit",
        labelTerminalPolicy: "custodial_boundary",
        labelAuthority: "tronscan_verified_metadata",
        labelSourcePayloadSha256: SOURCE
      }
    });
    if (!decision.terminal) return;
    const commit = buildUnifiedTraversalBoundaryCommitV2({
      state,
      decision,
      evidenceHash: fingerprintCanonicalArtifact(decision.evidence)
    });
    expect(commit.evidence).toBe(decision.evidence);
    expect(commit.terminal).toMatchObject({
      stateId: decision.evidence.state.stateId,
      address: COUNTERPARTY,
      anchorTimestamp: AT,
      reason: "identified_service_boundary",
      labels: ["cex:bybit"]
    });
  });

  it.each([
    ["hint", buildFrozenLabelRecord({
      address: COUNTERPARTY,
      classifierHint: { identity: "Bybit", category: "cex" },
      exactRegistryBinding: null,
      verifiedProviderBinding: null
    })],
    ["verified bridge", verified("bridge:allbridge")],
    ["later-valid HTX", verified("cex:htx-huobi", "2026-07-24T00:00:00.000Z")]
  ])("continues for %s", (_name, record) => {
    expect(decide([record])).toMatchObject({ terminal: false });
  });

  it("continues for unknown or empty labels", () => {
    expect(decide([])).toMatchObject({ terminal: false });
  });

  it("never authorizes v2 from compatibility-only legacy risk rows", () => {
    const frozen = buildFrozenLabelDataset({
      frozenAt: AT,
      snapshotHash: SNAPSHOT,
      labels: [],
      legacyRows: [{
        address: COUNTERPARTY,
        label: "Bybit",
        category: "cex",
        provider: "legacy-risk-context",
        observedAt: AT
      }]
    });
    expect(evaluateProductionBoundaryV2({
      state,
      eventTimestamp: AT,
      labels: frozen.dataset.labels,
      snapshotHash: SNAPSHOT,
      labelDatasetSha256: frozen.sha256
    })).toMatchObject({ terminal: false });
  });
});
