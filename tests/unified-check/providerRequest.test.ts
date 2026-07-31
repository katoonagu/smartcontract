import { describe, expect, it, vi } from "vitest";
import {
  buildProviderRequestIdentity,
  buildProviderRequestIdentityV2,
  loadOrFetchProviderPage,
  type ProviderPageRecord,
  type ProviderPageStore,
  type ProviderRequestIdentityInput,
  type ProviderRequestIdentityV2Input
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

const { cursor: ignoredV1Cursor, ...baseWithoutCursor } = base;
void ignoredV1Cursor;
const baseV2: ProviderRequestIdentityV2Input = {
  ...baseWithoutCursor,
  windowKind: "recent",
  timestampStartInclusiveMs: "1785427200000",
  timestampEndInclusiveMs: "1785430800000",
  pageOffset: 0
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
  it("keeps provider-request-identity-v1 bytes frozen", () => {
    const result = buildProviderRequestIdentity(base);

    expect(result.canonicalJson).toBe(
      '{"address":"TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy","apiSchemaVersion":"tronscan-v1","blockEnd":"84713573","blockStart":"0","chain":"tron","confirmationPolicy":"solidified","cursor":null,"direction":"incoming","endpoint":"/api/token_trc20/transfers","order":"asc","pageSize":50,"providerFamily":"tronscan","snapshotBlockHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","snapshotBlockNumber":"84713573","tokenContract":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","version":"provider-request-identity-v1"}'
    );
    expect(result.sha256).toBe(
      "b1ec66d56e087cc0c03a136c9ac75e809a969fb6b81155ad5b3648835fdaff9c"
    );
    expect(result.identity).not.toHaveProperty("windowKind");
    expect(result.identity).not.toHaveProperty("timestampStartInclusiveMs");
    expect(result.identity).not.toHaveProperty("timestampEndInclusiveMs");
    expect(result.identity).not.toHaveProperty("pageOffset");
  });

  it("keeps provider-request-identity-v2 collisions request-semantic", () => {
    const first = buildProviderRequestIdentityV2({
      ...baseV2,
      apiKey: "key-a",
      apiKeyIndex: 0
    });
    const credentialsChanged = buildProviderRequestIdentityV2({
      ...baseV2,
      apiKey: "key-b",
      apiKeyIndex: 3
    });
    expect(credentialsChanged.sha256).toBe(first.sha256);

    const firstProbe = { ...baseV2, routeAnchorEventId: "route-anchor-a" };
    const secondProbe = { ...baseV2, routeAnchorEventId: "route-anchor-b" };
    const firstProbeIdentity = buildProviderRequestIdentityV2(firstProbe);
    expect(buildProviderRequestIdentityV2(secondProbe).sha256).toBe(
      firstProbeIdentity.sha256
    );
    expect(firstProbeIdentity.identity).not.toHaveProperty("routeAnchorEventId");

    for (const [field, value] of [
      ["windowKind", "historical"],
      ["timestampEndInclusiveMs", "1785430800001"],
      ["pageOffset", 50]
    ] as const) {
      expect(
        buildProviderRequestIdentityV2({ ...baseV2, [field]: value }).sha256
      ).not.toBe(first.sha256);
    }

    expect(Object.keys(first.identity)).toEqual([
      "version",
      "chain",
      "providerFamily",
      "endpoint",
      "apiSchemaVersion",
      "address",
      "tokenContract",
      "blockStart",
      "blockEnd",
      "direction",
      "order",
      "pageSize",
      "snapshotBlockNumber",
      "snapshotBlockHash",
      "confirmationPolicy",
      "windowKind",
      "timestampStartInclusiveMs",
      "timestampEndInclusiveMs",
      "pageOffset"
    ]);
  });

  it("validates provider-request-identity-v2 bounds and inherited fields", () => {
    for (const [field, value] of [
      ["timestampStartInclusiveMs", "01"],
      ["timestampStartInclusiveMs", "-1"],
      ["timestampEndInclusiveMs", "1.5"]
    ] as const) {
      expect(() =>
        buildProviderRequestIdentityV2({ ...baseV2, [field]: value })
      ).toThrow(TypeError);
    }
    expect(() =>
      buildProviderRequestIdentityV2({
        ...baseV2,
        timestampStartInclusiveMs: "1785430800001"
      })
    ).toThrow(TypeError);

    for (const pageOffset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildProviderRequestIdentityV2({ ...baseV2, pageOffset })).toThrow(
        TypeError
      );
    }
    expect(() =>
      buildProviderRequestIdentityV2({
        ...baseV2,
        windowKind: "unknown" as ProviderRequestIdentityV2Input["windowKind"]
      })
    ).toThrow(TypeError);

    for (const invalidInput of [
      { ...baseV2, chain: "ethereum" },
      { ...baseV2, address: "not-an-address" },
      { ...baseV2, tokenContract: "not-an-address" },
      { ...baseV2, blockStart: "01" },
      { ...baseV2, blockEnd: "84713574" },
      { ...baseV2, snapshotBlockNumber: "not-a-block" },
      { ...baseV2, snapshotBlockHash: "z".repeat(64) },
      { ...baseV2, pageSize: 0 },
      { ...baseV2, providerFamily: " " },
      { ...baseV2, endpoint: "" },
      { ...baseV2, apiSchemaVersion: "" },
      { ...baseV2, confirmationPolicy: "" }
    ]) {
      expect(() =>
        buildProviderRequestIdentityV2(invalidInput as ProviderRequestIdentityV2Input)
      ).toThrow(TypeError);
    }
  });

  it("rejects invalid provider-request-identity-v2 runtime shapes", () => {
    for (const [field, value, code] of [
      ["blockStart", 0, "unified_invalid_provider_block_range"],
      ["blockEnd", 84713573, "unified_invalid_provider_block_range"],
      ["snapshotBlockNumber", 84713573, "unified_invalid_provider_snapshot"],
      [
        "timestampStartInclusiveMs",
        1785427200000,
        "unified_invalid_provider_timestamp_range"
      ],
      [
        "timestampEndInclusiveMs",
        1785430800000,
        "unified_invalid_provider_timestamp_range"
      ]
    ] as const) {
      expect(() =>
        buildProviderRequestIdentityV2({
          ...baseV2,
          [field]: value
        } as unknown as ProviderRequestIdentityV2Input)
      ).toThrowError(new TypeError(code));
    }

    expect(() =>
      buildProviderRequestIdentityV2({
        ...baseV2,
        direction: "sideways"
      } as unknown as ProviderRequestIdentityV2Input)
    ).toThrowError(new TypeError("unified_invalid_provider_direction"));
    expect(() =>
      buildProviderRequestIdentityV2({
        ...baseV2,
        order: "random"
      } as unknown as ProviderRequestIdentityV2Input)
    ).toThrowError(new TypeError("unified_invalid_provider_order"));
  });

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
    const sources: string[] = [];
    const [first, second] = await Promise.all([
      loadOrFetchProviderPage({
        identity: base,
        store,
        fetchPage,
        onDiagnostic: ({ source }) => sources.push(source)
      }),
      loadOrFetchProviderPage({
        identity: base,
        store,
        fetchPage,
        onDiagnostic: ({ source }) => sources.push(source)
      })
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(sources.sort()).toEqual(["inflight", "network"]);

    const afterRestart = await loadOrFetchProviderPage({
      identity: base,
      store,
      fetchPage: vi.fn(async () => response()),
      onDiagnostic: ({ source }) => sources.push(source)
    });
    expect(afterRestart).toEqual(first);
    expect(sources.at(-1)).toBe("cache");
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
