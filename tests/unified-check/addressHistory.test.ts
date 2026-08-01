import { describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import {
  addressHistoryManifestKey,
  buildAddressHistoryManifest
} from "../../src/unifiedCheck/addressHistory";

const ADDRESS = "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV";
const ADDRESS_HEX = TronWeb.address.toHex(ADDRESS);
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SNAPSHOT = "1".repeat(64);
const PAGE_A = "2".repeat(64);
const PAGE_B = "3".repeat(64);
const EXHAUSTION = "4".repeat(64);

describe("Unified address history manifest", () => {
  it("uses one key for equivalent address encodings and all funding episodes", () => {
    const first = addressHistoryManifestKey({
      chain: "tron",
      snapshotHash: SNAPSHOT,
      tokenContract: USDT,
      address: ADDRESS,
      providerRequestVersion: "tronscan-related-trc20-v1"
    });
    const second = addressHistoryManifestKey({
      chain: "tron",
      snapshotHash: SNAPSHOT,
      tokenContract: USDT,
      address: ADDRESS_HEX,
      providerRequestVersion: "tronscan-related-trc20-v1"
    });

    expect(first).toBe(second);
  });

  it("builds an ordered snapshot-bound manifest independent of episode data", () => {
    const manifest = buildAddressHistoryManifest({
      chain: "tron",
      snapshotHash: SNAPSHOT,
      tokenContract: USDT,
      address: ADDRESS,
      providerRequestVersion: "tronscan-related-trc20-v1",
      pageArtifactHashes: [PAGE_A, PAGE_B],
      canonicalEventIds: ["event:b", "event:a", "event:a"],
      rawRowCount: 4,
      duplicateCount: 1,
      exhaustion: {
        kind: "provider_exhausted",
        evidenceSha256: EXHAUSTION
      }
    });

    expect(manifest).toMatchObject({
      version: "unified-address-history-manifest-v1",
      schemaVersion: 1,
      address: ADDRESS,
      snapshotHash: SNAPSHOT,
      tokenContract: USDT,
      pageArtifactHashes: [PAGE_A, PAGE_B],
      rawRowCount: 4,
      canonicalEventCount: 2,
      duplicateCount: 1,
      exhaustion: {
        kind: "provider_exhausted",
        evidenceSha256: EXHAUSTION
      }
    });
    expect(manifest.eventInventorySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.key).toBe(addressHistoryManifestKey(manifest));
  });

  it("rejects a manifest without validated exhaustion evidence", () => {
    expect(() => buildAddressHistoryManifest({
      chain: "tron",
      snapshotHash: SNAPSHOT,
      tokenContract: USDT,
      address: ADDRESS,
      providerRequestVersion: "tronscan-related-trc20-v1",
      pageArtifactHashes: [PAGE_A],
      canonicalEventIds: [],
      rawRowCount: 0,
      duplicateCount: 0,
      exhaustion: null
    })).toThrow("unified_address_history_exhaustion_missing");
  });

  it("rejects duplicate page artifacts and impossible counters", () => {
    expect(() => buildAddressHistoryManifest({
      chain: "tron",
      snapshotHash: SNAPSHOT,
      tokenContract: USDT,
      address: ADDRESS,
      providerRequestVersion: "tronscan-related-trc20-v1",
      pageArtifactHashes: [PAGE_A, PAGE_A],
      canonicalEventIds: ["event:a"],
      rawRowCount: 1,
      duplicateCount: 0,
      exhaustion: {
        kind: "account_creation_reached",
        evidenceSha256: EXHAUSTION
      }
    })).toThrow("unified_address_history_page_duplicate");

    expect(() => buildAddressHistoryManifest({
      chain: "tron",
      snapshotHash: SNAPSHOT,
      tokenContract: USDT,
      address: ADDRESS,
      providerRequestVersion: "tronscan-related-trc20-v1",
      pageArtifactHashes: [PAGE_A],
      canonicalEventIds: ["event:a", "event:b"],
      rawRowCount: 1,
      duplicateCount: 0,
      exhaustion: {
        kind: "account_creation_reached",
        evidenceSha256: EXHAUSTION
      }
    })).toThrow("unified_address_history_count_invalid");
  });
});
