import { describe, expect, it, vi } from "vitest";
import {
  buildProviderRequestIdentity,
  loadOrFetchProviderPage,
  type ProviderPageRecord,
  type ProviderPageStore,
  type ProviderRequestIdentityInput
} from "../../src/unifiedCheck/providerRequest";

const base: ProviderRequestIdentityInput = {
  chain: "tron",
  providerFamily: "tronscan",
  endpoint: "/api/token_trc20/transfers",
  apiSchemaVersion: "tronscan-v1",
  address: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
  tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  blockStart: "0",
  blockEnd: "84713573",
  direction: "incoming",
  order: "asc",
  pageSize: 50,
  cursor: null,
  snapshotBlockNumber: "84713573",
  snapshotBlockHash: "a".repeat(64),
  confirmationPolicy: "solidified"
};

class MemoryPages implements ProviderPageStore {
  readonly rows = new Map<string, ProviderPageRecord>();

  async get(identitySha256: string): Promise<ProviderPageRecord | null> {
    return this.rows.get(identitySha256) ?? null;
  }

  async put(record: ProviderPageRecord): Promise<ProviderPageRecord> {
    const existing = this.rows.get(record.requestIdentitySha256);
    if (existing) return existing;
    this.rows.set(record.requestIdentitySha256, record);
    return record;
  }
}

function response(identity = base, cursor = identity.cursor) {
  return {
    payload: { data: [{ transaction_id: "tx-1" }] },
    snapshotBlockNumber: identity.snapshotBlockNumber,
    snapshotBlockHash: identity.snapshotBlockHash,
    cursor,
    providerFamily: identity.providerFamily,
    endpoint: identity.endpoint,
    apiSchemaVersion: identity.apiSchemaVersion,
    fetchedAt: "2026-07-23T13:00:00.000Z",
    provenance: { provider: identity.providerFamily, requestId: "provider-request-1" }
  };
}

describe("Unified provider request identity", () => {
  it("uses every semantic field and ignores credential selection", () => {
    const first = buildProviderRequestIdentity({ ...base, apiKey: "key-a", apiKeyIndex: 0 });
    const credentialChanged = buildProviderRequestIdentity({ ...base, apiKey: "key-b", apiKeyIndex: 3 });
    expect(credentialChanged.sha256).toBe(first.sha256);

    for (const [field, value] of [
      ["providerFamily", "trongrid"],
      ["endpoint", "/v1/accounts/transfers"],
      ["apiSchemaVersion", "v2"],
      ["address", "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP"],
      ["tokenContract", "T9yD14Nj9j7xAB4dbGeiX9h8unkKLxmGkn"],
      ["blockStart", "1"],
      ["blockEnd", "84713572"],
      ["direction", "outgoing"],
      ["order", "desc"],
      ["pageSize", 100],
      ["cursor", "next"],
      ["snapshotBlockNumber", "84713574"],
      ["snapshotBlockHash", "b".repeat(64)],
      ["confirmationPolicy", "confirmed-20"]
    ] as const) {
      expect(buildProviderRequestIdentity({ ...base, [field]: value } as ProviderRequestIdentityInput).sha256)
        .not.toBe(first.sha256);
    }
  });

  it("coalesces concurrent exact fetches and reuses the immutable stored page", async () => {
    const store = new MemoryPages();
    const fetchPage = vi.fn(async () => response());
    const [first, second] = await Promise.all([
      loadOrFetchProviderPage({ identity: base, store, fetchPage }),
      loadOrFetchProviderPage({ identity: base, store, fetchPage })
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    const afterRestart = await loadOrFetchProviderPage({
      identity: base,
      store,
      fetchPage: vi.fn(async () => response())
    });
    expect(afterRestart).toEqual(first);
    expect(store.rows).toHaveLength(1);
  });

  it("rejects provenance mismatches without caching and keeps overlapping pages distinct", async () => {
    const store = new MemoryPages();
    await expect(loadOrFetchProviderPage({
      identity: base,
      store,
      fetchPage: async () => response(base, "wrong-cursor")
    })).rejects.toThrow("unified_provider_page_identity_mismatch");
    expect(store.rows).toHaveLength(0);

    const pageA = await loadOrFetchProviderPage({
      identity: base,
      store,
      fetchPage: async () => response()
    });
    const nextIdentity = { ...base, cursor: "next" };
    const pageB = await loadOrFetchProviderPage({
      identity: nextIdentity,
      store,
      fetchPage: async () => response(nextIdentity)
    });
    expect(pageB.requestIdentitySha256).not.toBe(pageA.requestIdentitySha256);
    expect(store.rows).toHaveLength(2);
  });
});
