import { describe, expect, it } from "vitest";
import { providerHistoryPage } from "../../src/unifiedCheck/providerHistoryCompletion";

const cachedProjection = {
  cursor: "50",
  provider: "tronscan",
  transfers: [],
  nextOffset: 100,
  completionReason: "more",
  metadataConsistent: true
} as const;

describe("providerHistoryPage", () => {
  it("maps only ordinary range exhaustion to account creation", () => {
    expect(providerHistoryPage({
      ...cachedProjection,
      completionReason: "range_exhausted"
    })).toMatchObject({
      kind: "page",
      cursor: "50",
      nextCursor: null,
      reachedAccountCreation: true,
      provider: "tronscan"
    });
  });

  it("continues from the provider offset when more history is available", () => {
    expect(providerHistoryPage(cachedProjection)).toMatchObject({
      kind: "page",
      cursor: "50",
      nextCursor: "100",
      reachedAccountCreation: false,
      provider: "tronscan"
    });
  });

  it("rejects a completed provider-capped window with a stable error", () => {
    expect(() => providerHistoryPage({
      ...cachedProjection,
      cursor: "9950",
      nextOffset: 10_000,
      completionReason: "provider_range_capped"
    })).toThrow("unified_direct_history_provider_range_capped");
  });

  it("fails closed for an old cached payload without a completion reason", () => {
    const { completionReason: _completionReason, ...oldCachedProjection } = cachedProjection;

    expect(() => providerHistoryPage(oldCachedProjection))
      .toThrow("unified_direct_history_cached_page_invalid");
  });

  it.each([
    ["unknown completion reason", { completionReason: "future_reason" }],
    ["non-integer offset", { nextOffset: 1.5 }],
    ["unknown provider", { provider: "unknown" }],
    ["non-array transfers", { transfers: {} }],
    ["inconsistent metadata", { metadataConsistent: false }]
  ])("fails closed for an invalid %s", (_case, override) => {
    expect(() => providerHistoryPage({
      ...cachedProjection,
      ...override
    })).toThrow("unified_direct_history_cached_page_invalid");
  });
});
