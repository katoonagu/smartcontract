import { describe, expect, it, vi } from "vitest";
import { createProductionLabelDatasetFreezer } from
  "../../src/unifiedCheck/productionLabelFreeze";
import type { ProviderServiceMetadataV1 } from
  "../../src/unifiedCheck/providerServiceBindings";

const BYBIT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const REJECTED = "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd";
const FROZEN_AT = "2026-07-26T12:00:00.000Z";

function tagged(address: string, tag: unknown): ProviderServiceMetadataV1 {
  return {
    address,
    source: "tronscan",
    name: null,
    tag,
    verified: null,
    rawJson: { address, tag, marker: `raw:${address}` },
    fetchedAt: new Date("2026-07-26T11:00:00.000Z"),
    expiresAt: new Date("2026-07-26T13:00:00.000Z")
  };
}

describe("production label dataset freezer", () => {
  it("keeps V1 byte-identical without loading provider metadata", async () => {
    const loadFreshProviderMetadata = vi.fn(async () => [tagged(BYBIT, "Bybit")]);
    const freeze = createProductionLabelDatasetFreezer({
      traversalPolicyVersion: "snapshot-closure-v1",
      legacyRows: [],
      loadFreshProviderMetadata
    });

    const frozen = await freeze({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: "a".repeat(64)
    });

    expect(loadFreshProviderMetadata).not.toHaveBeenCalled();
    expect(frozen.sha256).toBe(
      "0328a9b8517294df15030bb9dbb25601063570ff03133c2e26f73aff58220e36"
    );
  });

  it("loads every V2 freeze afresh and emits address-free diagnostics", async () => {
    let rows: ProviderServiceMetadataV1[] = [
      tagged(BYBIT, "Bybit"),
      tagged(REJECTED, null)
    ];
    const loadFreshProviderMetadata = vi.fn(async () => rows);
    const observe = vi.fn();
    const freeze = createProductionLabelDatasetFreezer({
      traversalPolicyVersion: "snapshot-closure-v2",
      legacyRows: [],
      loadFreshProviderMetadata,
      observe
    });

    const first = await freeze({
      frozenAt: FROZEN_AT,
      snapshotHash: "b".repeat(64)
    });

    expect(first.dataset.labels).toContainEqual(expect.objectContaining({
      address: BYBIT,
      catalogEntryId: "cex:bybit"
    }));
    expect(first.dataset.labels).not.toContainEqual(expect.objectContaining({
      address: REJECTED
    }));
    expect(observe).toHaveBeenLastCalledWith({
      version: "unified-provider-service-freeze-diagnostic-v1",
      traversalPolicyVersion: "snapshot-closure-v2",
      matcherVersion: "unified-tronscan-cex-tag-map-v1",
      candidates: 2,
      accepted: 1,
      rejectedByReason: { tag_missing: 1 }
    });
    const serializedDiagnostic = JSON.stringify(observe.mock.lastCall?.[0]);
    expect(serializedDiagnostic).not.toContain(BYBIT);
    expect(serializedDiagnostic).not.toContain(REJECTED);
    expect(serializedDiagnostic).not.toContain("raw:");

    const preservedFirstDataset = structuredClone(first.dataset);
    rows = [tagged(BYBIT, "Binance")];
    const second = await freeze({
      frozenAt: FROZEN_AT,
      snapshotHash: "b".repeat(64)
    });

    expect(loadFreshProviderMetadata).toHaveBeenCalledTimes(2);
    expect(first.dataset).toEqual(preservedFirstDataset);
    expect(second.sha256).not.toBe(first.sha256);
    expect(second.dataset.labels).toContainEqual(expect.objectContaining({
      address: BYBIT,
      catalogEntryId: "cex:binance"
    }));
  });
});
