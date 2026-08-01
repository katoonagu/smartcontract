import { TronWeb } from "tronweb";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";

const HASH = /^[0-9a-f]{64}$/u;

export type AddressHistoryManifestIdentityV1 = {
  readonly chain: "tron";
  readonly snapshotHash: string;
  readonly tokenContract: string;
  readonly address: string;
  readonly providerRequestVersion: string;
};

export type AddressHistoryManifestV1 = {
  readonly version: "unified-address-history-manifest-v1";
  readonly schemaVersion: 1;
  readonly key: string;
  readonly chain: "tron";
  readonly snapshotHash: string;
  readonly tokenContract: string;
  readonly address: string;
  readonly providerRequestVersion: string;
  readonly pageArtifactHashes: readonly string[];
  readonly eventInventorySha256: string;
  readonly rawRowCount: number;
  readonly canonicalEventCount: number;
  readonly duplicateCount: number;
  readonly exhaustion: {
    readonly kind: "provider_exhausted" | "account_creation_reached";
    readonly evidenceSha256: string;
  };
};

function canonicalTronAddress(value: string, code: string): string {
  if (!TronWeb.isAddress(value)) throw new TypeError(code);
  try {
    return TronWeb.address.fromHex(TronWeb.address.toHex(value));
  } catch {
    throw new TypeError(code);
  }
}

function hash(value: string, code: string): string {
  if (!HASH.test(value)) throw new TypeError(code);
  return value;
}

function nonNegativeInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(code);
  return value;
}

export function addressHistoryManifestKey(
  input: AddressHistoryManifestIdentityV1
): string {
  if (input.chain !== "tron") {
    throw new TypeError("unified_address_history_chain_invalid");
  }
  if (input.providerRequestVersion.trim().length === 0) {
    throw new TypeError("unified_address_history_provider_version_invalid");
  }
  return fingerprintCanonicalArtifact({
    version: "unified-address-history-key-v1",
    chain: input.chain,
    snapshotHash: hash(
      input.snapshotHash,
      "unified_address_history_snapshot_invalid"
    ),
    tokenContract: canonicalTronAddress(
      input.tokenContract,
      "unified_address_history_token_invalid"
    ),
    address: canonicalTronAddress(
      input.address,
      "unified_address_history_address_invalid"
    ),
    providerRequestVersion: input.providerRequestVersion
  });
}

export function buildAddressHistoryManifest(input: {
  readonly chain: "tron";
  readonly snapshotHash: string;
  readonly tokenContract: string;
  readonly address: string;
  readonly providerRequestVersion: string;
  readonly pageArtifactHashes: readonly string[];
  readonly canonicalEventIds: readonly string[];
  readonly rawRowCount: number;
  readonly duplicateCount: number;
  readonly exhaustion: {
    readonly kind: "provider_exhausted" | "account_creation_reached";
    readonly evidenceSha256: string;
  } | null;
}): AddressHistoryManifestV1 {
  if (input.exhaustion === null) {
    throw new Error("unified_address_history_exhaustion_missing");
  }
  const address = canonicalTronAddress(
    input.address,
    "unified_address_history_address_invalid"
  );
  const tokenContract = canonicalTronAddress(
    input.tokenContract,
    "unified_address_history_token_invalid"
  );
  const pageArtifactHashes = input.pageArtifactHashes.map((value) =>
    hash(value, "unified_address_history_page_hash_invalid")
  );
  if (new Set(pageArtifactHashes).size !== pageArtifactHashes.length) {
    throw new Error("unified_address_history_page_duplicate");
  }
  const canonicalEventIds = [...new Set(input.canonicalEventIds)].sort();
  if (canonicalEventIds.some((eventId) => eventId.trim().length === 0)) {
    throw new TypeError("unified_address_history_event_id_invalid");
  }
  const rawRowCount = nonNegativeInteger(
    input.rawRowCount,
    "unified_address_history_count_invalid"
  );
  const duplicateCount = nonNegativeInteger(
    input.duplicateCount,
    "unified_address_history_count_invalid"
  );
  if (rawRowCount < canonicalEventIds.length + duplicateCount) {
    throw new Error("unified_address_history_count_invalid");
  }
  if (
    input.exhaustion.kind !== "provider_exhausted" &&
    input.exhaustion.kind !== "account_creation_reached"
  ) {
    throw new TypeError("unified_address_history_exhaustion_invalid");
  }
  const identity = {
    chain: input.chain,
    snapshotHash: hash(
      input.snapshotHash,
      "unified_address_history_snapshot_invalid"
    ),
    tokenContract,
    address,
    providerRequestVersion: input.providerRequestVersion
  } as const;
  return {
    version: "unified-address-history-manifest-v1",
    schemaVersion: 1,
    key: addressHistoryManifestKey(identity),
    ...identity,
    pageArtifactHashes,
    eventInventorySha256: fingerprintCanonicalArtifact(canonicalEventIds),
    rawRowCount,
    canonicalEventCount: canonicalEventIds.length,
    duplicateCount,
    exhaustion: {
      kind: input.exhaustion.kind,
      evidenceSha256: hash(
        input.exhaustion.evidenceSha256,
        "unified_address_history_exhaustion_evidence_invalid"
      )
    }
  };
}
