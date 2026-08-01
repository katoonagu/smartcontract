import { describe, expect, it, vi } from "vitest";
import {
  addressMetadataTtlMs,
  createCachedAddressMetadataResolver,
  metadataToAddressMetadata
} from "../../src/metadata/addressMetadataCache";
import type { AddressMetadata } from "../../src/storage/repositories";
import type { TronscanAddressMetadata } from "../../src/tron/tronClient";

const now = new Date("2026-05-24T00:00:00.000Z");

function providerMetadata(overrides: Partial<TronscanAddressMetadata> = {}): TronscanAddressMetadata {
  return {
    address: "TAddress111111111111111111111111111111",
    source: "tronscan",
    name: null,
    tag: null,
    isContract: false,
    verified: null,
    accountType: 0,
    rawJson: {},
    ...overrides
  };
}

function cachedMetadata(overrides: Partial<AddressMetadata> = {}): AddressMetadata {
  return {
    ...metadataToAddressMetadata(providerMetadata(), now),
    ...overrides
  };
}

describe("address metadata cache resolver", () => {
  it("uses long TTLs for tagged services, shorter TTLs for contracts, and short negative TTLs for plain EOAs", () => {
    expect(addressMetadataTtlMs(providerMetadata({ tag: "WhiteBIT" }))).toBe(30 * 24 * 60 * 60 * 1000);
    expect(addressMetadataTtlMs(providerMetadata({ name: "Binance-Hot" }))).toBe(30 * 24 * 60 * 60 * 1000);
    expect(addressMetadataTtlMs(providerMetadata({ isContract: true }))).toBe(7 * 24 * 60 * 60 * 1000);
    expect(addressMetadataTtlMs(providerMetadata({ isContract: false, name: null, tag: null }))).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("returns fresh metadata without live fetching", async () => {
    const fresh = cachedMetadata();
    const fetchLive = vi.fn(async () => providerMetadata({ tag: "WhiteBIT" }));
    const resolve = createCachedAddressMetadataResolver({
      getFresh: async () => fresh,
      getStale: async () => null,
      fetchLive,
      upsert: vi.fn(async () => undefined)
    });

    await expect(resolve(fresh.address, now)).resolves.toBe(fresh);
    expect(fetchLive).not.toHaveBeenCalled();
  });

  it("returns stale metadata immediately and refreshes best-effort in the background", async () => {
    const stale = cachedMetadata({ expiresAt: new Date("2026-05-20T00:00:00.000Z") });
    const fetchLive = vi.fn(async () => providerMetadata({ tag: "WhiteBIT" }));
    const upsert = vi.fn(async () => undefined);
    const resolve = createCachedAddressMetadataResolver({
      getFresh: async () => null,
      getStale: async () => stale,
      fetchLive,
      upsert
    });

    await expect(resolve(stale.address, now)).resolves.toBe(stale);

    expect(fetchLive).toHaveBeenCalledWith(stale.address);
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  });

  it("fetches live metadata synchronously when no cache entry exists", async () => {
    const fetchLive = vi.fn(async () => providerMetadata({ isContract: true }));
    const upsert = vi.fn(async () => undefined);
    const resolve = createCachedAddressMetadataResolver({
      getFresh: async () => null,
      getStale: async () => null,
      fetchLive,
      upsert
    });

    const result = await resolve("TAddress111111111111111111111111111111", now);

    expect(result).toMatchObject({ isContract: true });
    expect(result?.expiresAt.toISOString()).toBe("2026-05-31T00:00:00.000Z");
    expect(upsert).toHaveBeenCalledWith(result);
  });

  it("returns stale metadata even when background refresh fails", async () => {
    const stale = cachedMetadata({ tag: "WhiteBIT", expiresAt: new Date("2026-05-20T00:00:00.000Z") });
    const logger = { warn: vi.fn() };
    const resolve = createCachedAddressMetadataResolver({
      getFresh: async () => null,
      getStale: async () => stale,
      fetchLive: vi.fn(async () => {
        throw new Error("429");
      }),
      upsert: vi.fn(async () => undefined),
      logger
    });

    await expect(resolve(stale.address, now)).resolves.toBe(stale);
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(
      "address_metadata_live_fetch_failed",
      expect.objectContaining({ address: stale.address, error: "429" })
    ));
  });
});
