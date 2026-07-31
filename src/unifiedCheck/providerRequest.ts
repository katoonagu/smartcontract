import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import type { UnifiedQueryable } from "./repository";

const HASH = /^[0-9a-f]{64}$/u;
const RAW = /^(0|[1-9][0-9]*)$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

export type ProviderRequestIdentityInput = {
  readonly chain: "tron";
  readonly providerFamily: string;
  readonly endpoint: string;
  readonly apiSchemaVersion: string;
  readonly address: string;
  readonly tokenContract: string;
  readonly blockStart: string;
  readonly blockEnd: string;
  readonly direction: "incoming" | "outgoing" | "both";
  readonly order: "asc" | "desc";
  readonly pageSize: number;
  readonly cursor: string | null;
  readonly snapshotBlockNumber: string;
  readonly snapshotBlockHash: string;
  readonly confirmationPolicy: string;
  readonly apiKey?: string;
  readonly apiKeyIndex?: number;
};

export type ProviderRequestIdentity = {
  readonly version: "provider-request-identity-v1";
  readonly chain: "tron";
  readonly providerFamily: string;
  readonly endpoint: string;
  readonly apiSchemaVersion: string;
  readonly address: string;
  readonly tokenContract: string;
  readonly blockStart: string;
  readonly blockEnd: string;
  readonly direction: "incoming" | "outgoing" | "both";
  readonly order: "asc" | "desc";
  readonly pageSize: number;
  readonly cursor: string | null;
  readonly snapshotBlockNumber: string;
  readonly snapshotBlockHash: string;
  readonly confirmationPolicy: string;
};

export type ProviderRequestWindowKindV2 = "recent" | "historical";

export type ProviderRequestIdentityV2Input = Omit<
  ProviderRequestIdentityInput,
  "cursor"
> & {
  readonly windowKind: ProviderRequestWindowKindV2;
  readonly timestampStartInclusiveMs: string;
  readonly timestampEndInclusiveMs: string;
  readonly pageOffset: number;
};

export type ProviderRequestIdentityV2 = Omit<
  ProviderRequestIdentity,
  "version" | "cursor"
> & {
  readonly version: "provider-request-identity-v2";
  readonly windowKind: ProviderRequestWindowKindV2;
  readonly timestampStartInclusiveMs: string;
  readonly timestampEndInclusiveMs: string;
  readonly pageOffset: number;
};

export type ProviderPageRecord = {
  readonly requestIdentitySha256: string;
  readonly snapshotBlockHash: string;
  readonly payloadSha256: string;
  readonly payload: unknown;
  readonly fetchedAt: string;
  readonly provenance: Readonly<Record<string, unknown>>;
};

export type ProviderPageStore = {
  get(identitySha256: string): Promise<ProviderPageRecord | null>;
  put(record: ProviderPageRecord): Promise<ProviderPageRecord>;
};

export type ProviderFetchResult = {
  readonly payload: unknown;
  readonly snapshotBlockNumber: string;
  readonly snapshotBlockHash: string;
  readonly cursor: string | null;
  readonly providerFamily: string;
  readonly endpoint: string;
  readonly apiSchemaVersion: string;
  readonly fetchedAt: string;
  readonly provenance: Readonly<Record<string, unknown>>;
};

export type ProviderFetchResultV2 = Omit<ProviderFetchResult, "cursor"> & {
  readonly pageOffset: number;
};

export type ProviderPageDiagnostic = {
  readonly source: "network" | "cache" | "inflight";
};

function emitDiagnostic(
  listener: ((diagnostic: ProviderPageDiagnostic) => void) | undefined,
  diagnostic: ProviderPageDiagnostic
): void {
  try {
    listener?.(diagnostic);
  } catch {
    // ponytail: diagnostics are best-effort and must never change analysis.
  }
}

function text(value: string, code: string): string {
  if (!value.trim() || value.length > 512) throw new TypeError(code);
  return value;
}

function timestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("unified_invalid_provider_timestamp");
  }
  return value;
}

function raw(value: string, code: string): string {
  if (!RAW.test(value)) throw new TypeError(code);
  return value;
}

function rawV2(value: unknown, code: string): string {
  if (typeof value !== "string") throw new TypeError(code);
  return raw(value, code);
}

function offset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("unified_invalid_provider_page_offset");
  }
  return value;
}

export function buildProviderRequestIdentity(
  input: ProviderRequestIdentityInput
): { identity: ProviderRequestIdentity; canonicalJson: string; sha256: string } {
  if (input.chain !== "tron") throw new TypeError("unified_invalid_provider_chain");
  if (!TRON_ADDRESS.test(input.address) || !TRON_ADDRESS.test(input.tokenContract)) {
    throw new TypeError("unified_invalid_provider_address");
  }
  const blockStart = raw(input.blockStart, "unified_invalid_provider_block_range");
  const blockEnd = raw(input.blockEnd, "unified_invalid_provider_block_range");
  const snapshotBlockNumber = raw(
    input.snapshotBlockNumber,
    "unified_invalid_provider_snapshot"
  );
  if (BigInt(blockStart) > BigInt(blockEnd) || BigInt(blockEnd) > BigInt(snapshotBlockNumber)) {
    throw new TypeError("unified_invalid_provider_block_range");
  }
  if (!HASH.test(input.snapshotBlockHash)) {
    throw new TypeError("unified_invalid_provider_snapshot");
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 10_000) {
    throw new TypeError("unified_invalid_provider_page_size");
  }
  if (input.cursor !== null && (input.cursor.length === 0 || input.cursor.length > 2_048)) {
    throw new TypeError("unified_invalid_provider_cursor");
  }
  const identity: ProviderRequestIdentity = {
    version: "provider-request-identity-v1",
    chain: "tron",
    providerFamily: text(input.providerFamily, "unified_invalid_provider_family"),
    endpoint: text(input.endpoint, "unified_invalid_provider_endpoint"),
    apiSchemaVersion: text(input.apiSchemaVersion, "unified_invalid_provider_schema"),
    address: input.address,
    tokenContract: input.tokenContract,
    blockStart,
    blockEnd,
    direction: input.direction,
    order: input.order,
    pageSize: input.pageSize,
    cursor: input.cursor,
    snapshotBlockNumber,
    snapshotBlockHash: input.snapshotBlockHash,
    confirmationPolicy: text(
      input.confirmationPolicy,
      "unified_invalid_confirmation_policy"
    )
  };
  const canonical = canonicalizeArtifactJson(identity);
  return {
    identity,
    canonicalJson: canonical,
    sha256: fingerprintCanonicalArtifact(identity)
  };
}

export function buildProviderRequestIdentityV2(
  input: ProviderRequestIdentityV2Input
): { identity: ProviderRequestIdentityV2; canonicalJson: string; sha256: string } {
  if (input.chain !== "tron") throw new TypeError("unified_invalid_provider_chain");
  if (!TRON_ADDRESS.test(input.address) || !TRON_ADDRESS.test(input.tokenContract)) {
    throw new TypeError("unified_invalid_provider_address");
  }
  const blockStart = rawV2(input.blockStart, "unified_invalid_provider_block_range");
  const blockEnd = rawV2(input.blockEnd, "unified_invalid_provider_block_range");
  const snapshotBlockNumber = rawV2(
    input.snapshotBlockNumber,
    "unified_invalid_provider_snapshot"
  );
  if (BigInt(blockStart) > BigInt(blockEnd) || BigInt(blockEnd) > BigInt(snapshotBlockNumber)) {
    throw new TypeError("unified_invalid_provider_block_range");
  }
  if (!HASH.test(input.snapshotBlockHash)) {
    throw new TypeError("unified_invalid_provider_snapshot");
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 10_000) {
    throw new TypeError("unified_invalid_provider_page_size");
  }
  if (
    input.direction !== "incoming" &&
    input.direction !== "outgoing" &&
    input.direction !== "both"
  ) {
    throw new TypeError("unified_invalid_provider_direction");
  }
  if (input.order !== "asc" && input.order !== "desc") {
    throw new TypeError("unified_invalid_provider_order");
  }
  if (input.windowKind !== "recent" && input.windowKind !== "historical") {
    throw new TypeError("unified_invalid_provider_window_kind");
  }
  const timestampStartInclusiveMs = rawV2(
    input.timestampStartInclusiveMs,
    "unified_invalid_provider_timestamp_range"
  );
  const timestampEndInclusiveMs = rawV2(
    input.timestampEndInclusiveMs,
    "unified_invalid_provider_timestamp_range"
  );
  if (BigInt(timestampStartInclusiveMs) > BigInt(timestampEndInclusiveMs)) {
    throw new TypeError("unified_invalid_provider_timestamp_range");
  }
  const identity: ProviderRequestIdentityV2 = {
    version: "provider-request-identity-v2",
    chain: "tron",
    providerFamily: text(input.providerFamily, "unified_invalid_provider_family"),
    endpoint: text(input.endpoint, "unified_invalid_provider_endpoint"),
    apiSchemaVersion: text(input.apiSchemaVersion, "unified_invalid_provider_schema"),
    address: input.address,
    tokenContract: input.tokenContract,
    blockStart,
    blockEnd,
    direction: input.direction,
    order: input.order,
    pageSize: input.pageSize,
    snapshotBlockNumber,
    snapshotBlockHash: input.snapshotBlockHash,
    confirmationPolicy: text(
      input.confirmationPolicy,
      "unified_invalid_confirmation_policy"
    ),
    windowKind: input.windowKind,
    timestampStartInclusiveMs,
    timestampEndInclusiveMs,
    pageOffset: offset(input.pageOffset)
  };
  const canonical = canonicalizeArtifactJson(identity);
  return {
    identity,
    canonicalJson: canonical,
    sha256: fingerprintCanonicalArtifact(identity)
  };
}

type BuiltProviderRequestIdentity<TIdentity> = {
  readonly identity: TIdentity;
  readonly canonicalJson: string;
  readonly sha256: string;
};

function validateStored(
  expected: { identity: { snapshotBlockHash: string }; sha256: string },
  record: ProviderPageRecord
): ProviderPageRecord {
  if (
    record.requestIdentitySha256 !== expected.sha256 ||
    record.snapshotBlockHash !== expected.identity.snapshotBlockHash ||
    record.payloadSha256 !== fingerprintCanonicalArtifact(record.payload) ||
    !record.provenance ||
    typeof record.provenance !== "object" ||
    Array.isArray(record.provenance)
  ) {
    throw new Error("unified_provider_page_cache_mismatch");
  }
  timestamp(record.fetchedAt);
  return record;
}

function validateStoredV2(
  expected: BuiltProviderRequestIdentity<ProviderRequestIdentityV2>,
  record: ProviderPageRecord
): ProviderPageRecord {
  validateStored(expected, record);
  const persistedIdentity = record.provenance.requestIdentity;
  let rebuilt: BuiltProviderRequestIdentity<ProviderRequestIdentityV2>;
  try {
    rebuilt = buildProviderRequestIdentityV2(
      persistedIdentity as ProviderRequestIdentityV2Input
    );
    if (
      canonicalizeArtifactJson(persistedIdentity) !== rebuilt.canonicalJson ||
      rebuilt.canonicalJson !== expected.canonicalJson ||
      rebuilt.sha256 !== expected.sha256 ||
      record.provenance.requestIdentityCanonicalJson !== expected.canonicalJson ||
      record.provenance.requestIdentitySha256 !== expected.sha256 ||
      record.provenance.pageOffset !== expected.identity.pageOffset
    ) {
      throw new Error("unified_provider_page_cache_mismatch");
    }
  } catch {
    throw new Error("unified_provider_page_cache_mismatch");
  }
  return record;
}

function validateFetched(
  expected: { identity: ProviderRequestIdentity; sha256: string },
  fetched: ProviderFetchResult
): ProviderPageRecord {
  const identity = expected.identity;
  if (
    fetched.snapshotBlockNumber !== identity.snapshotBlockNumber ||
    fetched.snapshotBlockHash !== identity.snapshotBlockHash ||
    fetched.cursor !== identity.cursor ||
    fetched.providerFamily !== identity.providerFamily ||
    fetched.endpoint !== identity.endpoint ||
    fetched.apiSchemaVersion !== identity.apiSchemaVersion
  ) {
    throw new Error("unified_provider_page_identity_mismatch");
  }
  if (
    !fetched.provenance ||
    typeof fetched.provenance !== "object" ||
    Array.isArray(fetched.provenance)
  ) {
    throw new Error("unified_provider_page_provenance_missing");
  }
  const provenance = {
    ...fetched.provenance,
    requestIdentitySha256: expected.sha256,
    providerFamily: identity.providerFamily,
    endpoint: identity.endpoint,
    apiSchemaVersion: identity.apiSchemaVersion,
    snapshotBlockNumber: identity.snapshotBlockNumber,
    snapshotBlockHash: identity.snapshotBlockHash,
    cursor: identity.cursor
  };
  canonicalizeArtifactJson(provenance);
  return {
    requestIdentitySha256: expected.sha256,
    snapshotBlockHash: identity.snapshotBlockHash,
    payloadSha256: fingerprintCanonicalArtifact(fetched.payload),
    payload: fetched.payload,
    fetchedAt: timestamp(fetched.fetchedAt),
    provenance
  };
}

function validateFetchedV2(
  expected: BuiltProviderRequestIdentity<ProviderRequestIdentityV2>,
  fetched: ProviderFetchResultV2
): ProviderPageRecord {
  const identity = expected.identity;
  if (
    fetched.snapshotBlockNumber !== identity.snapshotBlockNumber ||
    fetched.snapshotBlockHash !== identity.snapshotBlockHash ||
    fetched.pageOffset !== identity.pageOffset ||
    fetched.providerFamily !== identity.providerFamily ||
    fetched.endpoint !== identity.endpoint ||
    fetched.apiSchemaVersion !== identity.apiSchemaVersion
  ) {
    throw new Error("unified_provider_page_identity_mismatch");
  }
  if (
    !fetched.provenance ||
    typeof fetched.provenance !== "object" ||
    Array.isArray(fetched.provenance)
  ) {
    throw new Error("unified_provider_page_provenance_missing");
  }
  const {
    routeAnchorEventId: ignoredRouteAnchorEventId,
    classifierStatus: ignoredClassifierStatus,
    samplingDecision: ignoredSamplingDecision,
    behaviorClass: ignoredBehaviorClass,
    ...providerProvenance
  } = fetched.provenance;
  void ignoredRouteAnchorEventId;
  void ignoredClassifierStatus;
  void ignoredSamplingDecision;
  void ignoredBehaviorClass;
  const provenance = {
    ...providerProvenance,
    requestIdentity: identity,
    requestIdentityCanonicalJson: expected.canonicalJson,
    requestIdentitySha256: expected.sha256,
    pageOffset: identity.pageOffset
  };
  canonicalizeArtifactJson(provenance);
  return {
    requestIdentitySha256: expected.sha256,
    snapshotBlockHash: identity.snapshotBlockHash,
    payloadSha256: fingerprintCanonicalArtifact(fetched.payload),
    payload: fetched.payload,
    fetchedAt: timestamp(fetched.fetchedAt),
    provenance
  };
}

const inFlightByStore = new WeakMap<
  ProviderPageStore,
  Map<string, Promise<ProviderPageRecord>>
>();

async function loadOrFetchProviderPageByIdentity<TIdentity, TFetched>(
  expected: BuiltProviderRequestIdentity<TIdentity>,
  input: {
    readonly store: ProviderPageStore;
    readonly fetchPage: () => Promise<TFetched>;
    readonly onDiagnostic?: (diagnostic: ProviderPageDiagnostic) => void;
  },
  validateStoredResult: (
    expected: BuiltProviderRequestIdentity<TIdentity>,
    record: ProviderPageRecord
  ) => ProviderPageRecord,
  validateFetchedResult: (
    expected: BuiltProviderRequestIdentity<TIdentity>,
    fetched: TFetched
  ) => ProviderPageRecord
): Promise<ProviderPageRecord> {
  const stored = await input.store.get(expected.sha256);
  if (stored) {
    emitDiagnostic(input.onDiagnostic, { source: "cache" });
    return validateStoredResult(expected, stored);
  }

  let inFlight = inFlightByStore.get(input.store);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByStore.set(input.store, inFlight);
  }
  const existing = inFlight.get(expected.sha256);
  if (existing) {
    emitDiagnostic(input.onDiagnostic, { source: "inflight" });
    return existing;
  }
  emitDiagnostic(input.onDiagnostic, { source: "network" });
  const pending = (async () => {
    const fetched = validateFetchedResult(expected, await input.fetchPage());
    return validateStoredResult(expected, await input.store.put(fetched));
  })().finally(() => {
    inFlight?.delete(expected.sha256);
  });
  inFlight.set(expected.sha256, pending);
  return pending;
}

export async function loadOrFetchProviderPage(input: {
  identity: ProviderRequestIdentityInput;
  store: ProviderPageStore;
  fetchPage: () => Promise<ProviderFetchResult>;
  onDiagnostic?: (diagnostic: ProviderPageDiagnostic) => void;
}): Promise<ProviderPageRecord> {
  return loadOrFetchProviderPageByIdentity(
    buildProviderRequestIdentity(input.identity),
    input,
    validateStored,
    validateFetched
  );
}

export async function loadOrFetchProviderPageV2(input: {
  identity: ProviderRequestIdentityV2Input;
  store: ProviderPageStore;
  fetchPage: () => Promise<ProviderFetchResultV2>;
  onDiagnostic?: (diagnostic: ProviderPageDiagnostic) => void;
}): Promise<ProviderPageRecord> {
  return loadOrFetchProviderPageByIdentity(
    buildProviderRequestIdentityV2(input.identity),
    input,
    validateStoredV2,
    validateFetchedV2
  );
}

function databaseRecord(row: Record<string, unknown>): ProviderPageRecord {
  return {
    requestIdentitySha256: String(row.request_identity_sha256),
    snapshotBlockHash: String(row.snapshot_block_hash),
    payloadSha256: String(row.payload_sha256),
    payload: row.payload_json,
    fetchedAt: new Date(String(row.fetched_at)).toISOString(),
    provenance: row.provenance_json as Record<string, unknown>
  };
}

export function createPostgresProviderPageStore(
  db: UnifiedQueryable
): ProviderPageStore {
  return {
    async get(identitySha256) {
      const row = (
        await db.query(
          "select * from unified_provider_pages where request_identity_sha256 = $1",
          [identitySha256]
        )
      ).rows[0];
      return row ? databaseRecord(row) : null;
    },
    async put(record) {
      const inserted = await db.query(
        `insert into unified_provider_pages (
          request_identity_sha256, snapshot_block_hash, payload_sha256,
          payload_json, fetched_at, provenance_json
        ) values ($1,$2,$3,$4::jsonb,$5,$6::jsonb)
        on conflict (request_identity_sha256) do nothing
        returning *`,
        [
          record.requestIdentitySha256,
          record.snapshotBlockHash,
          record.payloadSha256,
          JSON.stringify(record.payload),
          record.fetchedAt,
          JSON.stringify(record.provenance)
        ]
      );
      const row = inserted.rows[0] ?? (
        await db.query(
          "select * from unified_provider_pages where request_identity_sha256 = $1",
          [record.requestIdentitySha256]
        )
      ).rows[0];
      if (!row) throw new Error("unified_provider_page_store_failed");
      return databaseRecord(row);
    }
  };
}
