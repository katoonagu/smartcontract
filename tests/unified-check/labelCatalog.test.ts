import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LABEL_CATALOG_V1,
  buildFrozenLabelRecord
} from "../../src/unifiedCheck/labelCatalog";

const UNKNOWN = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";

describe("Unified supported label catalog V1", () => {
  it.each([
    ["Binance", "cex"],
    ["Bybit", "cex"],
    ["OKX", "cex"],
    ["WhiteBIT", "cex"],
    ["Coinbase", "cex"],
    ["Kraken", "cex"],
    ["KuCoin", "cex"],
    ["Bitget", "cex"],
    ["MEXC", "cex"],
    ["Bitstamp", "cex"],
    ["Crypto.com", "cex"],
    ["HTX/Huobi", "cex"],
    ["SunSwap/SUN", "dex"],
    ["Allbridge", "bridge"],
    ["Bridgers", "bridge"],
    ["USDD PSM/GemJoin", "protocol"],
    ["GasFree Endpoint", "service"],
    ["TronLink GasFree provider", "service"]
  ] as const)("includes %s as supported %s identity", (identity, category) => {
    expect(SUPPORTED_LABEL_CATALOG_V1.entries)
      .toContainEqual(expect.objectContaining({ identity, category }));
  });

  it.each([
    ["protocol:usdd-psm", "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ"],
    ["service:gasfree-controller", "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U"],
    ["service:tronlink-gasfree", "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird"],
    ["bridge:bridgers", "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s"]
  ])("binds exact registry address for %s", (id, address) => {
    expect(
      SUPPORTED_LABEL_CATALOG_V1.entries.find((entry) => entry.id === id)
    ).toMatchObject({ addressBindings: [address] });
  });

  it("keeps an unbound keyword match as a non-terminal hint", () => {
    const result = buildFrozenLabelRecord({
      address: UNKNOWN,
      classifierHint: { identity: "Bybit", category: "cex" },
      exactRegistryBinding: null,
      verifiedProviderBinding: null
    });
    expect(result).toMatchObject({
      catalogEntryId: "cex:bybit",
      strength: "hint",
      authority: "classifier_hint",
      terminalEligible: false
    });
  });

  it("accepts exact registry evidence only for the catalog-bound address", () => {
    expect(buildFrozenLabelRecord({
      address: "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U",
      classifierHint: null,
      exactRegistryBinding: {
        catalogEntryId: "service:gasfree-controller",
        authority: "internal_service_registry",
        sourcePayloadSha256: "a".repeat(64)
      },
      verifiedProviderBinding: null
    })).toMatchObject({
      identity: "GasFree Endpoint",
      strength: "exact_registry",
      terminalEligible: true
    });

    expect(() => buildFrozenLabelRecord({
      address: UNKNOWN,
      classifierHint: null,
      exactRegistryBinding: {
        catalogEntryId: "service:gasfree-controller",
        authority: "internal_service_registry",
        sourcePayloadSha256: "a".repeat(64)
      },
      verifiedProviderBinding: null
    })).toThrow("unified_label_exact_address_mismatch");
  });
});
