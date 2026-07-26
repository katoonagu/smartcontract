import { TronWeb } from "tronweb";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { SUPPORTED_LABEL_CATALOG_V1 } from "./labelCatalog";

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

export const TRONSCAN_CEX_TAG_MATCHER_VERSION =
  "unified-tronscan-cex-tag-map-v1" as const;

export type ProviderServiceMetadataV1 = {
  readonly address: unknown;
  readonly source: unknown;
  readonly name: unknown;
  readonly tag: unknown;
  readonly verified: unknown;
  readonly rawJson: unknown;
  readonly fetchedAt: unknown;
  readonly expiresAt: unknown;
};

export type ProviderServiceAssertionRejectionV1 =
  | "frozen_at_invalid"
  | "address_invalid"
  | "source_unsupported"
  | "tag_missing"
  | "raw_payload_invalid"
  | "raw_address_mismatch"
  | "raw_tag_mismatch"
  | "fetched_at_invalid"
  | "expires_at_invalid"
  | "observed_after_snapshot"
  | "stale_at_snapshot"
  | "tag_unsupported"
  | "catalog_policy_mismatch"
  | "source_payload_invalid";

export type AcceptedProviderServiceAssertionV1 = {
  readonly accepted: true;
  readonly version: "tronscan-address-tag-observation-v1";
  readonly chain: "tron";
  readonly address: string;
  readonly catalogEntryId: string;
  readonly authority: "tronscan_verified_metadata";
  readonly source: {
    readonly provider: "tronscan";
    readonly matchedField: "tag";
    readonly matchedValue: string;
    readonly matcherVersion: typeof TRONSCAN_CEX_TAG_MATCHER_VERSION;
    readonly fetchedAt: string;
    readonly expiresAt: string;
    readonly sourcePayloadSha256: string;
  };
  readonly validity: {
    readonly validFrom: string;
    readonly validTo: null;
    readonly basis: "provider_observed_from";
  };
};

export type ProviderServiceAssertionDecisionV1 =
  | AcceptedProviderServiceAssertionV1
  | {
    readonly accepted: false;
    readonly reason: ProviderServiceAssertionRejectionV1;
  };

const TAG_MATCHERS = Object.freeze([
  Object.freeze(["cex:binance", Object.freeze([/^Binance$/u, /^Binance-Hot [1-9][0-9]*$/u])]),
  Object.freeze(["cex:bybit", Object.freeze([/^Bybit$/u])]),
  Object.freeze(["cex:okx", Object.freeze([/^OKX$/u, /^OKX Hot Wallet [1-9][0-9]*$/u, /^Okex [1-9][0-9]*$/u])]),
  Object.freeze(["cex:whitebit", Object.freeze([/^WhiteBIT$/u])]),
  Object.freeze(["cex:coinbase", Object.freeze([/^Coinbase$/u])]),
  Object.freeze(["cex:kraken", Object.freeze([/^Kraken$/u, /^Kraken: Hot Wallet$/u])]),
  Object.freeze(["cex:kucoin", Object.freeze([/^KuCoin$/u, /^Kucoin [1-9][0-9]*$/u])]),
  Object.freeze(["cex:bitget", Object.freeze([/^Bitget$/u, /^Bitget [1-9][0-9]*$/u])]),
  Object.freeze(["cex:mexc", Object.freeze([/^MEXC$/u, /^MEXC [1-9][0-9]*$/u, /^MXC [1-9][0-9]*$/u])]),
  Object.freeze(["cex:bitstamp", Object.freeze([/^Bitstamp$/u])]),
  Object.freeze(["cex:crypto-com", Object.freeze([/^Crypto\.com$/u])]),
  Object.freeze(["cex:htx-huobi", Object.freeze([/^HTX [1-9][0-9]*$/u, /^Huobi [1-9][0-9]*$/u])])
] as const satisfies readonly (readonly [string, readonly RegExp[]])[]);

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactIsoMilliseconds(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validTronAddress(value: unknown): value is string {
  if (typeof value !== "string" || !TRON_ADDRESS.test(value)) return false;
  try {
    return TronWeb.isAddress(value);
  } catch {
    return false;
  }
}

function rejected(
  reason: ProviderServiceAssertionRejectionV1
): ProviderServiceAssertionDecisionV1 {
  return { accepted: false, reason };
}

export function matchTronScanCexTagV1(tag: string): string | null {
  for (const [catalogEntryId, matchers] of TAG_MATCHERS) {
    if (matchers.some((matcher) => matcher.test(tag))) return catalogEntryId;
  }
  return null;
}

export function decideTronScanProviderServiceAssertion(input: {
  readonly metadata: ProviderServiceMetadataV1;
  readonly frozenAt: unknown;
}): ProviderServiceAssertionDecisionV1 {
  if (!exactIsoMilliseconds(input.frozenAt)) return rejected("frozen_at_invalid");
  const metadata = input.metadata;
  if (!plainObject(metadata) || !validTronAddress(metadata.address)) {
    return rejected("address_invalid");
  }
  if (metadata.source !== "tronscan") return rejected("source_unsupported");
  if (typeof metadata.tag !== "string" || metadata.tag.length === 0) {
    return rejected("tag_missing");
  }
  if (!plainObject(metadata.rawJson)) return rejected("raw_payload_invalid");
  if (metadata.rawJson.address !== metadata.address) {
    return rejected("raw_address_mismatch");
  }
  if (metadata.rawJson.tag !== metadata.tag) return rejected("raw_tag_mismatch");
  if (!validDate(metadata.fetchedAt)) return rejected("fetched_at_invalid");
  if (!validDate(metadata.expiresAt)) return rejected("expires_at_invalid");

  const frozenAt = Date.parse(input.frozenAt);
  if (metadata.fetchedAt.getTime() > frozenAt) {
    return rejected("observed_after_snapshot");
  }
  if (frozenAt >= metadata.expiresAt.getTime()) return rejected("stale_at_snapshot");

  const catalogEntryId = matchTronScanCexTagV1(metadata.tag);
  if (!catalogEntryId) return rejected("tag_unsupported");
  const catalogEntry = SUPPORTED_LABEL_CATALOG_V1.entries.find(
    (entry) => entry.id === catalogEntryId
  );
  if (
    !catalogEntry ||
    catalogEntry.category !== "cex" ||
    catalogEntry.terminalPolicy !== "custodial_boundary"
  ) {
    return rejected("catalog_policy_mismatch");
  }

  const fetchedAt = metadata.fetchedAt.toISOString();
  const expiresAt = metadata.expiresAt.toISOString();
  let sourcePayloadSha256: string;
  try {
    sourcePayloadSha256 = fingerprintCanonicalArtifact({
      version: "tronscan-address-tag-observation-source-v1",
      chain: "tron",
      address: metadata.address,
      catalogEntryId: catalogEntry.id,
      authority: "tronscan_verified_metadata",
      provider: "tronscan",
      matchedField: "tag",
      matchedValue: metadata.tag,
      matcherVersion: TRONSCAN_CEX_TAG_MATCHER_VERSION,
      fetchedAt,
      expiresAt,
      rawJson: metadata.rawJson
    });
  } catch {
    return rejected("source_payload_invalid");
  }

  return {
    accepted: true,
    version: "tronscan-address-tag-observation-v1",
    chain: "tron",
    address: metadata.address,
    catalogEntryId: catalogEntry.id,
    authority: "tronscan_verified_metadata",
    source: {
      provider: "tronscan",
      matchedField: "tag",
      matchedValue: metadata.tag,
      matcherVersion: TRONSCAN_CEX_TAG_MATCHER_VERSION,
      fetchedAt,
      expiresAt,
      sourcePayloadSha256
    },
    validity: {
      validFrom: fetchedAt,
      validTo: null,
      basis: "provider_observed_from"
    }
  };
}
