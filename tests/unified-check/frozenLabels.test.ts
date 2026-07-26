import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  buildFrozenLabelDataset,
  createFrozenLabelDatasetLoader,
  MAX_FROZEN_LABEL_DATASET_BYTES,
  MAX_FROZEN_LABEL_DATASET_ENTRIES,
  validateFrozenLabelDatasetV1,
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

  it("validates an exact persisted artifact against its hash and bindings", () => {
    const built = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [label],
      legacyRows: []
    });

    expect(validateFrozenLabelDatasetV1({
      dataset: built.dataset,
      expectedSha256: built.sha256,
      snapshotHash: SNAPSHOT,
      catalogVersion: "unified-label-catalog-v1",
      boundaryPredicateVersion: "unified-boundary-predicates-v1"
    })).toEqual(built.dataset);
    expect(() => validateFrozenLabelDatasetV1({
      dataset: built.dataset,
      expectedSha256: "f".repeat(64),
      snapshotHash: SNAPSHOT,
      catalogVersion: "unified-label-catalog-v1",
      boundaryPredicateVersion: "unified-boundary-predicates-v1"
    })).toThrow("unified_frozen_label_dataset_hash_mismatch");
  });

  it.each([
    ["snapshot", { snapshotHash: "f".repeat(64) }],
    ["catalog", { catalogVersion: "wrong-catalog" }],
    ["predicate", { boundaryPredicateVersion: "wrong-predicate" }]
  ])("rejects a persisted artifact with the wrong %s binding", (_name, change) => {
    const built = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [label],
      legacyRows: []
    });
    expect(() => validateFrozenLabelDatasetV1({
      dataset: { ...built.dataset, ...change },
      expectedSha256: fingerprintCanonicalArtifact({
        ...built.dataset,
        ...change
      }),
      snapshotHash: SNAPSHOT,
      catalogVersion: "unified-label-catalog-v1",
      boundaryPredicateVersion: "unified-boundary-predicates-v1"
    })).toThrow("unified_frozen_label_dataset_binding_mismatch");
  });

  it("rejects a malformed persisted label instead of trusting a cast", () => {
    const malformed = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [label],
      legacyRows: []
    }).dataset;
    const dataset = {
      ...malformed,
      labels: [{ ...label, terminalEligible: "yes" }]
    };
    expect(() => validateFrozenLabelDatasetV1({
      dataset,
      expectedSha256: fingerprintCanonicalArtifact(dataset),
      snapshotHash: SNAPSHOT,
      catalogVersion: "unified-label-catalog-v1",
      boundaryPredicateVersion: "unified-boundary-predicates-v1"
    })).toThrow("unified_frozen_label_dataset_invalid");
  });

  it("rejects persisted datasets over the entry and byte ceilings", () => {
    const built = buildFrozenLabelDataset({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: SNAPSHOT,
      labels: [label],
      legacyRows: []
    });
    expect(() => validateFrozenLabelDatasetV1({
      dataset: {
        ...built.dataset,
        labels: Array(MAX_FROZEN_LABEL_DATASET_ENTRIES + 1).fill(label)
      },
      expectedSha256: built.sha256,
      snapshotHash: SNAPSHOT,
      catalogVersion: "unified-label-catalog-v1",
      boundaryPredicateVersion: "unified-boundary-predicates-v1"
    })).toThrow("unified_frozen_label_dataset_entries_exceeded");
    expect(() => validateFrozenLabelDatasetV1({
      dataset: {
        ...built.dataset,
        padding: "x".repeat(MAX_FROZEN_LABEL_DATASET_BYTES)
      },
      expectedSha256: built.sha256,
      snapshotHash: SNAPSHOT,
      catalogVersion: "unified-label-catalog-v1",
      boundaryPredicateVersion: "unified-boundary-predicates-v1"
    })).toThrow("unified_frozen_label_dataset_bytes_exceeded");
  });

  it("validates once per hash while binding and bounding the loader cache", async () => {
    const snapshots = [SNAPSHOT, "c".repeat(64), "d".repeat(64)];
    const datasets = snapshots.map((snapshotHash, index) =>
      buildFrozenLabelDataset({
        frozenAt: `2026-07-24T00:00:0${index}.000Z`,
        snapshotHash,
        labels: [label],
        legacyRows: []
      })
    );
    const byHash = new Map(datasets.map((item) => [item.sha256, item.dataset]));
    let loads = 0;
    const load = createFrozenLabelDatasetLoader({
      maxCachedDatasets: 2,
      loadBySha256: async (sha256) => {
        loads += 1;
        return byHash.get(sha256);
      }
    });
    const binding = (index: number) => ({
      labelDatasetSha256: datasets[index]!.sha256,
      snapshotHash: snapshots[index]!,
      labelCatalogVersion: "unified-label-catalog-v1" as const,
      boundaryPredicateVersion: "unified-boundary-predicates-v1" as const
    });

    await load(binding(0));
    await load(binding(0));
    expect(loads).toBe(1);
    await expect(load({
      ...binding(0),
      snapshotHash: "e".repeat(64)
    })).rejects.toThrow("unified_frozen_label_dataset_binding_mismatch");
    expect(loads).toBe(1);
    await load(binding(1));
    await load(binding(2));
    await load(binding(0));
    expect(loads).toBe(4);
  });
});
