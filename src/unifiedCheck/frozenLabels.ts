import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import type { FrozenLabelRecordV1 } from "./labelCatalog";

export type { FrozenLabelRecordV1 } from "./labelCatalog";

const HASH = /^[0-9a-f]{64}$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

export type LegacyFrozenLabelRowV1 = {
  readonly address: string;
  readonly label: string;
  readonly category: string;
  readonly provider: string;
  readonly observedAt: string;
};

export type FrozenLabelDatasetV1 = {
  readonly version: "unified-frozen-label-dataset-v1";
  readonly schemaVersion: 1;
  readonly catalogVersion: "unified-label-catalog-v1";
  readonly boundaryPredicateVersion: "unified-boundary-predicates-v1";
  readonly frozenAt: string;
  readonly snapshotHash: string;
  readonly labels: readonly FrozenLabelRecordV1[];
  /**
   * Compatibility-only input for the pre-adjudication traversal predicate.
   * P1 predicates consume `labels`; legacy traversal reads only this field.
   */
  readonly legacyRows: readonly LegacyFrozenLabelRowV1[];
};

function timestamp(value: string, code: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(code);
  }
  return value;
}

function text(value: string, code: string): string {
  if (value.trim().length === 0 || value.length > 512) {
    throw new TypeError(code);
  }
  return value;
}

function validateLabel(label: FrozenLabelRecordV1): FrozenLabelRecordV1 {
  if (
    !TRON_ADDRESS.test(label.address) ||
    !HASH.test(label.sourcePayloadSha256)
  ) {
    throw new TypeError("unified_frozen_label_invalid");
  }
  timestamp(label.validFrom ?? "1970-01-01T00:00:00.000Z", "unified_frozen_label_validity_invalid");
  if (label.validTo !== null) {
    timestamp(label.validTo, "unified_frozen_label_validity_invalid");
  }
  if (
    label.validFrom !== null &&
    label.validTo !== null &&
    Date.parse(label.validFrom) > Date.parse(label.validTo)
  ) {
    throw new TypeError("unified_frozen_label_validity_invalid");
  }
  text(label.catalogEntryId, "unified_frozen_label_catalog_entry_invalid");
  text(label.identity, "unified_frozen_label_identity_invalid");
  text(label.authority, "unified_frozen_label_authority_invalid");
  return Object.freeze({ ...label });
}

function validateLegacyRow(
  row: LegacyFrozenLabelRowV1
): LegacyFrozenLabelRowV1 {
  if (!TRON_ADDRESS.test(row.address)) {
    throw new TypeError("unified_frozen_legacy_label_address_invalid");
  }
  return Object.freeze({
    address: row.address,
    label: text(row.label, "unified_frozen_legacy_label_invalid"),
    category: text(row.category, "unified_frozen_legacy_category_invalid"),
    provider: text(row.provider, "unified_frozen_legacy_provider_invalid"),
    observedAt: timestamp(
      row.observedAt,
      "unified_frozen_legacy_observed_at_invalid"
    )
  });
}

function canonicalUnique<T>(values: readonly T[]): T[] {
  const byJson = new Map<string, T>();
  for (const value of values) {
    byJson.set(canonicalizeArtifactJson(value), value);
  }
  return [...byJson.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

export function buildFrozenLabelDataset(input: {
  readonly frozenAt: string;
  readonly snapshotHash: string;
  readonly labels: readonly FrozenLabelRecordV1[];
  readonly legacyRows: readonly LegacyFrozenLabelRowV1[];
}): { readonly dataset: FrozenLabelDatasetV1; readonly sha256: string } {
  if (!HASH.test(input.snapshotHash)) {
    throw new TypeError("unified_frozen_label_snapshot_invalid");
  }
  const dataset: FrozenLabelDatasetV1 = Object.freeze({
    version: "unified-frozen-label-dataset-v1",
    schemaVersion: 1,
    catalogVersion: "unified-label-catalog-v1",
    boundaryPredicateVersion: "unified-boundary-predicates-v1",
    frozenAt: timestamp(
      input.frozenAt,
      "unified_frozen_label_clock_invalid"
    ),
    snapshotHash: input.snapshotHash,
    labels: Object.freeze(canonicalUnique(input.labels.map(validateLabel))),
    legacyRows: Object.freeze(
      canonicalUnique(input.legacyRows.map(validateLegacyRow))
    )
  });
  return {
    dataset,
    sha256: fingerprintCanonicalArtifact(dataset)
  };
}
