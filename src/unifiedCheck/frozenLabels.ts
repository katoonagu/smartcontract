import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import type { FrozenLabelRecordV1 } from "./labelCatalog";
import {
  buildFrozenLabelRecord,
  SUPPORTED_LABEL_CATALOG_V1
} from "./labelCatalog";

export type { FrozenLabelRecordV1 } from "./labelCatalog";

const HASH = /^[0-9a-f]{64}$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
export const MAX_FROZEN_LABEL_DATASET_ENTRIES = 10_000;
export const MAX_FROZEN_LABEL_DATASET_BYTES = 8_388_608;

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

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function persistedRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("unified_frozen_label_dataset_invalid");
  }
  return value as Record<string, unknown>;
}

function assertFrozenDatasetBounds(value: unknown): void {
  const row = persistedRecord(value);
  if (
    Array.isArray(row.labels) &&
    Array.isArray(row.legacyRows) &&
    row.labels.length + row.legacyRows.length >
      MAX_FROZEN_LABEL_DATASET_ENTRIES
  ) {
    throw new TypeError("unified_frozen_label_dataset_entries_exceeded");
  }
  if (
    Buffer.byteLength(canonicalizeArtifactJson(value), "utf8") >
      MAX_FROZEN_LABEL_DATASET_BYTES
  ) {
    throw new TypeError("unified_frozen_label_dataset_bytes_exceeded");
  }
}

function persistedLabel(value: unknown): FrozenLabelRecordV1 {
  const row = persistedRecord(value);
  if (!exactKeys(row, [
    "address",
    "catalogEntryId",
    "identity",
    "category",
    "strength",
    "authority",
    "validFrom",
    "validTo",
    "sourcePayloadSha256",
    "terminalEligible"
  ])) throw new TypeError("unified_frozen_label_dataset_invalid");
  const stringFields = [
    "address",
    "catalogEntryId",
    "identity",
    "category",
    "strength",
    "authority",
    "sourcePayloadSha256"
  ] as const;
  if (
    stringFields.some((field) => typeof row[field] !== "string") ||
    !(
      row.validFrom === null || typeof row.validFrom === "string"
    ) ||
    !(row.validTo === null || typeof row.validTo === "string") ||
    typeof row.terminalEligible !== "boolean"
  ) throw new TypeError("unified_frozen_label_dataset_invalid");

  try {
    const common = {
      address: row.address as string,
      classifierHint: null,
      exactRegistryBinding: null,
      verifiedProviderBinding: null
    };
    const binding = {
      catalogEntryId: row.catalogEntryId as string,
      authority: row.authority as string,
      sourcePayloadSha256: row.sourcePayloadSha256 as string,
      validFrom: row.validFrom as string | null,
      validTo: row.validTo as string | null
    };
    const rebuilt = row.strength === "exact_registry"
      ? buildFrozenLabelRecord({ ...common, exactRegistryBinding: binding })
      : row.strength === "verified_provider"
      ? buildFrozenLabelRecord({ ...common, verifiedProviderBinding: binding })
      : row.strength === "hint"
      ? buildFrozenLabelRecord({
          ...common,
          classifierHint: {
            identity: row.identity as string,
            category: row.category as FrozenLabelRecordV1["category"],
            sourcePayloadSha256: row.sourcePayloadSha256 as string
          }
        })
      : null;
    if (
      rebuilt === null ||
      canonicalizeArtifactJson(rebuilt) !== canonicalizeArtifactJson(row)
    ) throw new TypeError("unified_frozen_label_dataset_invalid");
    return rebuilt;
  } catch {
    throw new TypeError("unified_frozen_label_dataset_invalid");
  }
}

function persistedLegacyRow(value: unknown): LegacyFrozenLabelRowV1 {
  const row = persistedRecord(value);
  if (!exactKeys(row, [
    "address", "label", "category", "provider", "observedAt"
  ])) throw new TypeError("unified_frozen_label_dataset_invalid");
  if (Object.values(row).some((field) => typeof field !== "string")) {
    throw new TypeError("unified_frozen_label_dataset_invalid");
  }
  try {
    return validateLegacyRow({
      address: row.address as string,
      label: row.label as string,
      category: row.category as string,
      provider: row.provider as string,
      observedAt: row.observedAt as string
    });
  } catch {
    throw new TypeError("unified_frozen_label_dataset_invalid");
  }
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
  assertFrozenDatasetBounds(dataset);
  return {
    dataset,
    sha256: fingerprintCanonicalArtifact(dataset)
  };
}

export function buildProductionFrozenLabelDataset(input: {
  readonly frozenAt: string;
  readonly snapshotHash: string;
  readonly legacyRows: readonly LegacyFrozenLabelRowV1[];
}) {
  const exactLabels = SUPPORTED_LABEL_CATALOG_V1.entries.flatMap((entry) =>
    entry.addressBindings.map((address) => buildFrozenLabelRecord({
      address,
      classifierHint: null,
      exactRegistryBinding: {
        catalogEntryId: entry.id,
        authority: "internal_service_registry",
        sourcePayloadSha256: fingerprintCanonicalArtifact({
          version: SUPPORTED_LABEL_CATALOG_V1.version,
          entry
        })
      },
      verifiedProviderBinding: null
    }))
  );
  const hintLabels = input.legacyRows.flatMap((row) => {
    const normalized = [row.label, row.category]
      .map((value) => value.trim().toLowerCase());
    const entry = SUPPORTED_LABEL_CATALOG_V1.entries.find((candidate) =>
      normalized.includes(candidate.identity.toLowerCase())
    );
    return entry === undefined
      ? []
      : [buildFrozenLabelRecord({
          address: row.address,
          classifierHint: {
            identity: entry.identity,
            category: entry.category,
            sourcePayloadSha256: fingerprintCanonicalArtifact({
              version: "unified-label-source-row-v1",
              ...row
            })
          },
          exactRegistryBinding: null,
          verifiedProviderBinding: null
        })];
  });
  return buildFrozenLabelDataset({
    frozenAt: input.frozenAt,
    snapshotHash: input.snapshotHash,
    labels: [...exactLabels, ...hintLabels],
    legacyRows: input.legacyRows
  });
}

export function validateFrozenLabelDatasetV1(input: {
  readonly dataset: unknown;
  readonly expectedSha256: string;
  readonly snapshotHash: string;
  readonly catalogVersion: "unified-label-catalog-v1";
  readonly boundaryPredicateVersion: "unified-boundary-predicates-v1";
}): FrozenLabelDatasetV1 {
  const row = persistedRecord(input.dataset);
  assertFrozenDatasetBounds(row);
  if (!exactKeys(row, [
    "version",
    "schemaVersion",
    "catalogVersion",
    "boundaryPredicateVersion",
    "frozenAt",
    "snapshotHash",
    "labels",
    "legacyRows"
  ]) || !Array.isArray(row.labels) || !Array.isArray(row.legacyRows)) {
    throw new TypeError("unified_frozen_label_dataset_invalid");
  }
  if (
    row.version !== "unified-frozen-label-dataset-v1" ||
    row.schemaVersion !== 1 ||
    row.snapshotHash !== input.snapshotHash ||
    row.catalogVersion !== input.catalogVersion ||
    row.boundaryPredicateVersion !== input.boundaryPredicateVersion
  ) {
    throw new Error("unified_frozen_label_dataset_binding_mismatch");
  }
  if (typeof row.frozenAt !== "string" || typeof row.snapshotHash !== "string") {
    throw new TypeError("unified_frozen_label_dataset_invalid");
  }
  let rebuilt: ReturnType<typeof buildFrozenLabelDataset>;
  try {
    rebuilt = buildFrozenLabelDataset({
      frozenAt: row.frozenAt,
      snapshotHash: row.snapshotHash,
      labels: row.labels.map(persistedLabel),
      legacyRows: row.legacyRows.map(persistedLegacyRow)
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "unified_frozen_label_dataset_invalid"
    ) throw error;
    throw new TypeError("unified_frozen_label_dataset_invalid");
  }
  if (
    canonicalizeArtifactJson(rebuilt.dataset) !==
      canonicalizeArtifactJson(input.dataset)
  ) throw new TypeError("unified_frozen_label_dataset_invalid");
  if (
    !HASH.test(input.expectedSha256) ||
    rebuilt.sha256 !== input.expectedSha256
  ) throw new Error("unified_frozen_label_dataset_hash_mismatch");
  return rebuilt.dataset;
}

export function createFrozenLabelDatasetLoader(input: {
  readonly loadBySha256: (sha256: string) => Promise<unknown>;
  readonly maxCachedDatasets?: number;
}) {
  const maxCachedDatasets = input.maxCachedDatasets ?? 16;
  if (
    !Number.isSafeInteger(maxCachedDatasets) ||
    maxCachedDatasets < 1 ||
    maxCachedDatasets > 64
  ) {
    throw new TypeError("unified_frozen_label_cache_size_invalid");
  }
  const cache = new Map<string, FrozenLabelDatasetV1>();
  return async (binding: {
    readonly labelDatasetSha256: string;
    readonly snapshotHash: string;
    readonly labelCatalogVersion: "unified-label-catalog-v1";
    readonly boundaryPredicateVersion: "unified-boundary-predicates-v1";
  }): Promise<FrozenLabelDatasetV1> => {
    const cached = cache.get(binding.labelDatasetSha256);
    if (cached !== undefined) {
      if (
        cached.snapshotHash !== binding.snapshotHash ||
        cached.catalogVersion !== binding.labelCatalogVersion ||
        cached.boundaryPredicateVersion !== binding.boundaryPredicateVersion
      ) {
        throw new Error("unified_frozen_label_dataset_binding_mismatch");
      }
      cache.delete(binding.labelDatasetSha256);
      cache.set(binding.labelDatasetSha256, cached);
      return cached;
    }
    const validated = validateFrozenLabelDatasetV1({
      dataset: await input.loadBySha256(binding.labelDatasetSha256),
      expectedSha256: binding.labelDatasetSha256,
      snapshotHash: binding.snapshotHash,
      catalogVersion: binding.labelCatalogVersion,
      boundaryPredicateVersion: binding.boundaryPredicateVersion
    });
    if (cache.size >= maxCachedDatasets) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(binding.labelDatasetSha256, validated);
    return validated;
  };
}
