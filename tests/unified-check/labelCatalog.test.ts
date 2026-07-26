import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LABEL_CATALOG_V1,
  buildFrozenLabelRecord,
  resolveFrozenLabelAtEventV1
} from "../../src/unifiedCheck/labelCatalog";

const UNKNOWN = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const PROVIDER = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";

function verifiedProvider() {
  return buildFrozenLabelRecord({
    address: PROVIDER,
    classifierHint: null,
    exactRegistryBinding: null,
    verifiedProviderBinding: {
      catalogEntryId: "cex:bybit",
      authority: "tronscan_verified_metadata",
      sourcePayloadSha256: "b".repeat(64),
      validFrom: "2026-07-26T11:00:00.000Z",
      validTo: "2026-07-26T13:00:00.000Z"
    }
  });
}

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

  it("accepts only the authority assigned to each exact strength", () => {
    expect(() => buildFrozenLabelRecord({
      address: PROVIDER,
      classifierHint: null,
      exactRegistryBinding: null,
      verifiedProviderBinding: {
        catalogEntryId: "cex:bybit",
        authority: "internal_service_registry",
        sourcePayloadSha256: "b".repeat(64)
      }
    })).toThrow("unified_label_authority_unsupported");

    expect(() => buildFrozenLabelRecord({
      address: "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U",
      classifierHint: null,
      exactRegistryBinding: {
        catalogEntryId: "service:gasfree-controller",
        authority: "tronscan_verified_metadata",
        sourcePayloadSha256: "b".repeat(64)
      },
      verifiedProviderBinding: null
    })).toThrow("unified_label_authority_unsupported");
  });

  it.each([
    "2026-07-26T11:00:00.000Z",
    "2026-07-26T13:00:00.000Z"
  ])("resolves an authoritative record at inclusive endpoint %s", (eventTimestamp) => {
    expect(resolveFrozenLabelAtEventV1({
      label: verifiedProvider(),
      eventTimestamp
    })).toMatchObject({
      kind: "eligible",
      entry: { id: "cex:bybit" }
    });
  });

  it("keeps a pre-validity authoritative record as context", () => {
    expect(resolveFrozenLabelAtEventV1({
      label: verifiedProvider(),
      eventTimestamp: "2026-07-26T10:59:59.999Z"
    })).toEqual({ kind: "label_not_valid_at_event" });
  });

  it("keeps a classifier hint non-terminal", () => {
    const hint = buildFrozenLabelRecord({
      address: PROVIDER,
      classifierHint: { identity: "Bybit", category: "cex" },
      exactRegistryBinding: null,
      verifiedProviderBinding: null
    });
    expect(resolveFrozenLabelAtEventV1({
      label: hint,
      eventTimestamp: "2026-07-26T12:00:00.000Z"
    })).toEqual({ kind: "hint_not_terminal" });
  });

  it.each([
    ["malformed", {
      validFrom: "2026-07-26T11:00:00Z",
      validTo: null
    }],
    ["reversed", {
      validFrom: "2026-07-26T13:00:00.000Z",
      validTo: "2026-07-26T11:00:00.000Z"
    }]
  ] as const)("rejects %s persisted hint validity", (_name, validity) => {
    const hint = buildFrozenLabelRecord({
      address: PROVIDER,
      classifierHint: { identity: "Bybit", category: "cex" },
      exactRegistryBinding: null,
      verifiedProviderBinding: null
    });
    expect(() => resolveFrozenLabelAtEventV1({
      label: { ...hint, ...validity },
      eventTimestamp: "2026-07-26T12:00:00.000Z"
    })).toThrow("unified_label_validity_invalid");
  });

  it("rejects persisted identity or category drift from the catalog", () => {
    expect(() => resolveFrozenLabelAtEventV1({
      label: { ...verifiedProvider(), identity: "Not Bybit" },
      eventTimestamp: "2026-07-26T12:00:00.000Z"
    })).toThrow("unified_frozen_label_catalog_binding_invalid");
    expect(() => resolveFrozenLabelAtEventV1({
      label: { ...verifiedProvider(), category: "service" },
      eventTimestamp: "2026-07-26T12:00:00.000Z"
    })).toThrow("unified_frozen_label_catalog_binding_invalid");
  });

  it("rejects a forged persisted exact-registry address binding", () => {
    const exact = buildFrozenLabelRecord({
      address: "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U",
      classifierHint: null,
      exactRegistryBinding: {
        catalogEntryId: "service:gasfree-controller",
        authority: "internal_service_registry",
        sourcePayloadSha256: "a".repeat(64)
      },
      verifiedProviderBinding: null
    });
    expect(() => resolveFrozenLabelAtEventV1({
      label: { ...exact, address: UNKNOWN },
      eventTimestamp: "2026-07-26T12:00:00.000Z"
    })).toThrow("unified_frozen_label_catalog_binding_invalid");
  });
});
