import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  TRONSCAN_CEX_TAG_MATCHER_VERSION,
  decideTronScanProviderServiceAssertion,
  matchTronScanCexTagV1,
  type ProviderServiceMetadataV1
} from "../../src/unifiedCheck/providerServiceBindings";

const ADDRESS = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const FROZEN_AT = "2026-07-26T12:00:00.000Z";

function metadata(
  overrides: Partial<ProviderServiceMetadataV1> = {}
): ProviderServiceMetadataV1 {
  return {
    address: ADDRESS,
    source: "tronscan",
    name: null,
    tag: "Binance-Hot 8",
    verified: null,
    rawJson: { address: ADDRESS, tag: "Binance-Hot 8" },
    fetchedAt: new Date("2026-07-26T11:00:00.000Z"),
    expiresAt: new Date("2026-07-26T13:00:00.000Z"),
    ...overrides
  };
}

function decide(value = metadata(), frozenAt: unknown = FROZEN_AT) {
  return decideTronScanProviderServiceAssertion({ metadata: value, frozenAt });
}

const ACCEPTED_TAGS = [
  ["Binance", "cex:binance"],
  ["Binance-Hot 8", "cex:binance"],
  ["Bybit", "cex:bybit"],
  ["OKX", "cex:okx"],
  ["OKX Hot Wallet 3", "cex:okx"],
  ["Okex 1", "cex:okx"],
  ["WhiteBIT", "cex:whitebit"],
  ["Coinbase", "cex:coinbase"],
  ["Kraken", "cex:kraken"],
  ["Kraken: Hot Wallet", "cex:kraken"],
  ["KuCoin", "cex:kucoin"],
  ["Kucoin 2", "cex:kucoin"],
  ["Bitget", "cex:bitget"],
  ["Bitget 1", "cex:bitget"],
  ["MEXC", "cex:mexc"],
  ["MEXC 1", "cex:mexc"],
  ["MXC 2", "cex:mexc"],
  ["Bitstamp", "cex:bitstamp"],
  ["Crypto.com", "cex:crypto-com"],
  ["HTX 4", "cex:htx-huobi"],
  ["Huobi 1", "cex:htx-huobi"]
] as const;

describe("TronScan provider service bindings", () => {
  it.each(ACCEPTED_TAGS)("accepts exact tag %s as %s", (tag, catalogEntryId) => {
    expect(matchTronScanCexTagV1(tag)).toBe(catalogEntryId);
    expect(decide(metadata({ tag, rawJson: { address: ADDRESS, tag } }))).toMatchObject({
      accepted: true,
      address: ADDRESS,
      catalogEntryId,
      authority: "tronscan_verified_metadata",
      validity: {
        validFrom: "2026-07-26T11:00:00.000Z",
        validTo: null,
        basis: "provider_observed_from"
      }
    });
  });

  it("does not treat name or verified status as authority", () => {
    expect(decide(metadata({
      name: "Binance",
      tag: null,
      verified: true,
      rawJson: { address: ADDRESS, tag: null }
    }))).toEqual({ accepted: false, reason: "tag_missing" });
    expect(decide(metadata({
      tag: null,
      verified: true,
      rawJson: { address: ADDRESS, tag: null }
    }))).toEqual({ accepted: false, reason: "tag_missing" });
    expect(decide(metadata({ verified: false }))).toMatchObject({ accepted: true });
  });

  it.each([
    [metadata({ tag: "Fake Binance", rawJson: { address: ADDRESS, tag: "Fake Binance" } }), FROZEN_AT, "tag_unsupported"],
    [metadata({ tag: "exchange", rawJson: { address: ADDRESS, tag: "exchange" } }), FROZEN_AT, "tag_unsupported"],
    [metadata({ tag: "binance", rawJson: { address: ADDRESS, tag: "binance" } }), FROZEN_AT, "tag_unsupported"],
    [metadata({ rawJson: { address: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd", tag: "Binance-Hot 8" } }), FROZEN_AT, "raw_address_mismatch"],
    [metadata({ rawJson: { address: ADDRESS, tag: "Bybit" } }), FROZEN_AT, "raw_tag_mismatch"],
    [metadata({ address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7Nz1", rawJson: { address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7Nz1", tag: "Binance-Hot 8" } }), FROZEN_AT, "address_invalid"],
    [metadata({ source: "manual" }), FROZEN_AT, "source_unsupported"],
    [metadata({ fetchedAt: new Date("2026-07-26T12:00:00.001Z") }), FROZEN_AT, "observed_after_snapshot"],
    [metadata({ expiresAt: new Date(FROZEN_AT) }), FROZEN_AT, "stale_at_snapshot"],
    [metadata({ fetchedAt: new Date("invalid") }), FROZEN_AT, "fetched_at_invalid"],
    [metadata({ expiresAt: new Date("invalid") }), FROZEN_AT, "expires_at_invalid"],
    [metadata({ rawJson: null }), FROZEN_AT, "raw_payload_invalid"],
    [metadata(), "2026-07-26 12:00:00", "frozen_at_invalid"]
  ] as const)("rejects malformed provider input with %s", (value, frozenAt, reason) => {
    expect(decide(value, frozenAt)).toEqual({ accepted: false, reason });
  });

  it("exposes a public assertion without raw payload", () => {
    const result = decide();
    expect(result).toMatchObject({
      accepted: true,
      version: "tronscan-address-tag-observation-v1",
      chain: "tron",
      source: {
        provider: "tronscan",
        matchedField: "tag",
        matchedValue: "Binance-Hot 8",
        matcherVersion: TRONSCAN_CEX_TAG_MATCHER_VERSION,
        fetchedAt: "2026-07-26T11:00:00.000Z",
        expiresAt: "2026-07-26T13:00:00.000Z"
      }
    });
    expect(result).not.toHaveProperty("rawJson");
    expect(result.accepted && result.source).not.toHaveProperty("rawJson");
  });

  it("rejects a cyclic source payload without throwing", () => {
    const rawJson: Record<string, unknown> = {
      address: ADDRESS,
      tag: "Binance-Hot 8"
    };
    rawJson.self = rawJson;
    const evaluate = () => decide(metadata({ rawJson }));

    expect(evaluate).not.toThrow();
    expect(evaluate()).toEqual({
      accepted: false,
      reason: "source_payload_invalid"
    });
  });

  it("binds every source-envelope field into the canonical hash", () => {
    const baseline = decide();
    expect(baseline).toMatchObject({ accepted: true });
    if (!baseline.accepted) throw new Error("expected accepted baseline");

    const hashes = [
      decide(metadata({ rawJson: { address: ADDRESS, tag: "Binance-Hot 8", addressTagLogo: "changed" } })),
      decide(metadata({ tag: "Bybit", rawJson: { address: ADDRESS, tag: "Bybit" } })),
      decide(metadata({ fetchedAt: new Date("2026-07-26T11:00:00.001Z") })),
      decide(metadata({ expiresAt: new Date("2026-07-26T13:00:00.001Z") }))
    ].map((result) => {
      if (!result.accepted) throw new Error("expected accepted hash variant");
      return result.source.sourcePayloadSha256;
    });
    expect(new Set(hashes).has(baseline.source.sourcePayloadSha256)).toBe(false);

    expect(fingerprintCanonicalArtifact({
      version: "tronscan-address-tag-observation-source-v1",
      chain: "tron",
      address: ADDRESS,
      catalogEntryId: "cex:binance",
      authority: "tronscan_verified_metadata",
      provider: "tronscan",
      matchedField: "tag",
      matchedValue: "Binance-Hot 8",
      matcherVersion: "unified-tronscan-cex-tag-map-v2",
      fetchedAt: "2026-07-26T11:00:00.000Z",
      expiresAt: "2026-07-26T13:00:00.000Z",
      rawJson: { address: ADDRESS, tag: "Binance-Hot 8" }
    })).not.toBe(baseline.source.sourcePayloadSha256);
  });
});
