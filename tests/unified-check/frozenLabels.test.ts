import { describe, expect, it } from "vitest";
import {
  buildFrozenLabelDataset,
  type FrozenLabelRecordV1
} from "../../src/unifiedCheck/frozenLabels";

const SNAPSHOT = "a".repeat(64);
const SOURCE = "b".repeat(64);
const ADDRESS = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";

const label: FrozenLabelRecordV1 = {
  address: ADDRESS,
  catalogEntryId: "service:gasfree-controller",
  identity: "GasFree Endpoint",
  category: "service",
  strength: "exact_registry",
  authority: "internal_service_registry",
  validFrom: "2025-01-01T00:00:00.000Z",
  validTo: null,
  sourcePayloadSha256: SOURCE,
  terminalEligible: true
};

describe("Unified frozen label dataset", () => {
  it("sorts evidence deterministically and binds snapshot and policy versions", () => {
    const first = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [
        { ...label, identity: "Secondary", sourcePayloadSha256: "c".repeat(64) },
        label
      ],
      legacyRows: []
    });
    const reordered = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [...first.dataset.labels].reverse(),
      legacyRows: []
    });
    expect(reordered.sha256).toBe(first.sha256);
    expect(first.dataset).toMatchObject({
      version: "unified-frozen-label-dataset-v1",
      catalogVersion: "unified-label-catalog-v1",
      boundaryPredicateVersion: "unified-boundary-predicates-v1",
      snapshotHash: SNAPSHOT
    });
  });

  it.each([
    ["authority", "tronscan_verified_metadata"],
    ["validFrom", "2025-02-01T00:00:00.000Z"],
    ["validTo", "2026-01-01T00:00:00.000Z"],
    ["sourcePayloadSha256", "d".repeat(64)]
  ] as const)("changes hash when %s changes", (field, value) => {
    const baseline = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [label],
      legacyRows: []
    });
    const changed = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [{ ...label, [field]: value }],
      legacyRows: []
    });
    expect(changed.sha256).not.toBe(baseline.sha256);
  });

  it("retains raw compatibility labels without making them terminal evidence", () => {
    const result = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [label],
      legacyRows: [{
        address: ADDRESS,
        label: "service",
        category: "service",
        provider: "legacy",
        observedAt: "2025-01-01T00:00:00.000Z"
      }]
    });
    expect(result.dataset.legacyRows).toHaveLength(1);
    expect(result.dataset.labels).toHaveLength(1);
  });
});
