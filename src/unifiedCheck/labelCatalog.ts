import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";

const HASH = /^[0-9a-f]{64}$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

export type SupportedLabelCategoryV1 =
  | "cex"
  | "dex"
  | "bridge"
  | "protocol"
  | "service"
  | "restriction";

export type SupportedLabelCatalogEntryV1 = {
  readonly id: string;
  readonly identity: string;
  readonly category: SupportedLabelCategoryV1;
  readonly addressBindings: readonly string[];
  readonly acceptedAuthorities: readonly string[];
  readonly temporalPolicy: "event_time" | "current_identity";
  readonly terminalPolicy:
    | "custodial_boundary"
    | "route_dependent"
    | "economic_role_required"
    | "restriction_policy";
};

const EXACT_ADDRESSES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "bridge:bridgers": Object.freeze([
      "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s"
    ]),
    "protocol:usdd-psm": Object.freeze([
      "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ"
    ]),
    "service:gasfree-controller": Object.freeze([
      "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U"
    ]),
    "service:tronlink-gasfree": Object.freeze([
      "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird"
    ])
  });

const DEFINITIONS = [
  ["cex:binance", "Binance", "cex"],
  ["cex:bybit", "Bybit", "cex"],
  ["cex:okx", "OKX", "cex"],
  ["cex:whitebit", "WhiteBIT", "cex"],
  ["cex:coinbase", "Coinbase", "cex"],
  ["cex:kraken", "Kraken", "cex"],
  ["cex:kucoin", "KuCoin", "cex"],
  ["cex:bitget", "Bitget", "cex"],
  ["cex:mexc", "MEXC", "cex"],
  ["cex:bitstamp", "Bitstamp", "cex"],
  ["cex:crypto-com", "Crypto.com", "cex"],
  ["cex:htx-huobi", "HTX/Huobi", "cex"],
  ["dex:sunswap", "SunSwap/SUN", "dex"],
  ["bridge:allbridge", "Allbridge", "bridge"],
  ["bridge:bridgers", "Bridgers", "bridge"],
  ["protocol:usdd-psm", "USDD PSM/GemJoin", "protocol"],
  ["service:gasfree-controller", "GasFree Endpoint", "service"],
  [
    "service:tronlink-gasfree",
    "TronLink GasFree provider",
    "service"
  ]
] as const satisfies readonly (
  readonly [string, string, SupportedLabelCategoryV1]
)[];

function terminalPolicy(
  category: SupportedLabelCategoryV1
): SupportedLabelCatalogEntryV1["terminalPolicy"] {
  if (category === "cex") return "custodial_boundary";
  if (category === "dex" || category === "bridge") return "route_dependent";
  if (category === "restriction") return "restriction_policy";
  return "economic_role_required";
}

export const SUPPORTED_LABEL_CATALOG_V1 = Object.freeze({
  version: "unified-label-catalog-v1" as const,
  entries: Object.freeze(DEFINITIONS.map(([id, identity, category]) =>
    Object.freeze({
      id,
      identity,
      category,
      addressBindings: EXACT_ADDRESSES[id] ?? Object.freeze([]),
      acceptedAuthorities: Object.freeze([
        "internal_service_registry",
        "tronscan_verified_metadata"
      ]),
      temporalPolicy: id === "cex:htx-huobi"
        ? "event_time"
        : "current_identity",
      terminalPolicy: terminalPolicy(category)
    } satisfies SupportedLabelCatalogEntryV1)
  ))
});

export type FrozenLabelRecordV1 = {
  readonly address: string;
  readonly catalogEntryId: string;
  readonly identity: string;
  readonly category: SupportedLabelCategoryV1;
  readonly strength: "exact_registry" | "verified_provider" | "hint";
  readonly authority: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly sourcePayloadSha256: string;
  readonly terminalEligible: boolean;
};

type EvidenceBinding = {
  readonly catalogEntryId: string;
  readonly authority: string;
  readonly sourcePayloadSha256: string;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
};

function entryById(id: string): SupportedLabelCatalogEntryV1 {
  const entry = SUPPORTED_LABEL_CATALOG_V1.entries.find(
    (candidate) => candidate.id === id
  );
  if (!entry) throw new TypeError("unified_label_catalog_entry_unknown");
  return entry;
}

function timestamp(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("unified_label_validity_invalid");
  }
  return value;
}

function recordFromBinding(
  address: string,
  binding: EvidenceBinding,
  strength: "exact_registry" | "verified_provider"
): FrozenLabelRecordV1 {
  const entry = entryById(binding.catalogEntryId);
  if (!entry.acceptedAuthorities.includes(binding.authority)) {
    throw new TypeError("unified_label_authority_unsupported");
  }
  if (!HASH.test(binding.sourcePayloadSha256)) {
    throw new TypeError("unified_label_source_hash_invalid");
  }
  if (
    strength === "exact_registry" &&
    !entry.addressBindings.includes(address)
  ) {
    throw new TypeError("unified_label_exact_address_mismatch");
  }
  const validFrom = timestamp(binding.validFrom);
  const validTo = timestamp(binding.validTo);
  if (
    validFrom !== null &&
    validTo !== null &&
    Date.parse(validFrom) > Date.parse(validTo)
  ) {
    throw new TypeError("unified_label_validity_invalid");
  }
  return {
    address,
    catalogEntryId: entry.id,
    identity: entry.identity,
    category: entry.category,
    strength,
    authority: binding.authority,
    validFrom,
    validTo,
    sourcePayloadSha256: binding.sourcePayloadSha256,
    terminalEligible: true
  };
}

export function buildFrozenLabelRecord(input: {
  readonly address: string;
  readonly classifierHint: {
    readonly identity: string;
    readonly category: SupportedLabelCategoryV1;
    readonly sourcePayloadSha256?: string;
  } | null;
  readonly exactRegistryBinding: EvidenceBinding | null;
  readonly verifiedProviderBinding: EvidenceBinding | null;
}): FrozenLabelRecordV1 {
  const address = input.address.trim();
  if (!TRON_ADDRESS.test(address)) {
    throw new TypeError("unified_label_address_invalid");
  }
  if (input.exactRegistryBinding) {
    return recordFromBinding(
      address,
      input.exactRegistryBinding,
      "exact_registry"
    );
  }
  if (input.verifiedProviderBinding) {
    return recordFromBinding(
      address,
      input.verifiedProviderBinding,
      "verified_provider"
    );
  }
  if (!input.classifierHint) {
    throw new TypeError("unified_label_evidence_missing");
  }
  const entry = SUPPORTED_LABEL_CATALOG_V1.entries.find((candidate) =>
    candidate.identity === input.classifierHint?.identity &&
    candidate.category === input.classifierHint.category
  );
  if (!entry) throw new TypeError("unified_label_hint_unsupported");
  if (
    input.classifierHint.sourcePayloadSha256 !== undefined &&
    !HASH.test(input.classifierHint.sourcePayloadSha256)
  ) {
    throw new TypeError("unified_label_source_hash_invalid");
  }
  return {
    address,
    catalogEntryId: entry.id,
    identity: entry.identity,
    category: entry.category,
    strength: "hint",
    authority: "classifier_hint",
    validFrom: null,
    validTo: null,
    sourcePayloadSha256:
      input.classifierHint.sourcePayloadSha256 ??
      fingerprintCanonicalArtifact({
        version: "unified-label-hint-v1",
        address,
        identity: entry.identity,
        category: entry.category
      }),
    terminalEligible: false
  };
}
