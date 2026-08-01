# Unified Authoritative Service Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new `snapshot-closure-v2` runs stop before address-history planning at exact, fresh, event-time-valid TronScan CEX tags while leaving V1, existing runs, matrix-v4, and delivery semantics unchanged.

**Architecture:** Decode mutable `address_metadata` rows at one explicit trust boundary, freeze accepted observations into the existing immutable label dataset, and resolve both traversal and completion through one catalog-and-time resolver. A policy-aware freezer performs the additional DB read only for new V2 snapshots and emits count-only diagnostics. The first independent commit repairs the known Windows replay-file CRLF baseline so every later red/green result is meaningful.

**Tech Stack:** TypeScript, Node.js, Vitest, PostgreSQL (`pg`), TronWeb, existing canonical artifact hashing, and the existing Unified Check runtime.

---

## Scope and verified baseline

This plan implements only Phase A from
`docs/superpowers/specs/2026-07-26-unified-service-boundary-and-latency-design.md`.
It does not implement Where concurrency, selective `transaction-info`, the
behavioral shadow profile, `snapshot-closure-v3`, historical backdating, or a
new scoring matrix.

Existing `address_label_assertions` — including API-derived Verify20/drainer,
approval, blacklist, and sanctions evidence — remain independent risk/context
facts. This plan neither suppresses those checks nor promotes their labels to
service-boundary authority.

The branch starts at `f335c227` in
`.worktrees/service-boundary-latency`.

Verified on Windows before implementation:

- `npm run typecheck`: PASS.
- `npm test`: 4,437 passed, 144 skipped, 9 failed.
- All nine failures are the same pre-existing CRLF file-boundary defect around
  `unified_provider_replay_noncanonical`.

No migration is required. `address_metadata` already has provider payload and
freshness columns, while `unified_label_datasets` already stores the immutable
run-bound dataset.

## File map

### Create

- `src/unifiedCheck/providerServiceBindings.ts` — exact TronScan tag decoder
  and versioned rejection reasons.
- `tests/unified-check/providerServiceBindings.test.ts` — trust-boundary,
  matcher, time, hash, and rejection tests.
- `src/unifiedCheck/productionLabelFreeze.ts` — policy gate, per-freeze DB read,
  accepted-record composition, and count-only diagnostics.
- `tests/unified-check/productionLabelFreeze.test.ts` — V1 identity, V2
  freshness, immutability, and diagnostics tests.

### Modify

- `src/unifiedCheck/providerReplay.ts`
- `scripts/runUnifiedAdaptiveBenchmark.ts`
- `tests/unified-check/providerReplay.test.ts`
- `tests/unified-check/rollingOracleEquivalence.postgres.test.ts`
- `tests/scripts/runUnifiedAdaptiveBenchmark.test.ts`
- `src/storage/repositories.ts`
- `tests/storage/repositories.test.ts`
- `src/unifiedCheck/labelCatalog.ts`
- `tests/unified-check/labelCatalog.test.ts`
- `src/unifiedCheck/boundaryPredicates.ts`
- `tests/unified-check/boundaryPredicates.test.ts`
- `src/unifiedCheck/frozenLabels.ts`
- `tests/unified-check/frozenLabels.test.ts`
- `tests/unified-check/productionBoundary.test.ts`
- `src/index.ts`
- `scripts/runUnifiedWalletCanary.ts`
- `tests/unified-check/requestService.test.ts`
- `tests/unified-check/productionTraversalCoordinator.test.ts`
- `src/unifiedCheck/productionCompletion.ts`
- `src/unifiedCheck/productionFinalizer.ts`
- `tests/unified-check/productionCompletion.test.ts`
- `tests/unified-check/plannerReplay.property.test.ts`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/09-current-decisions.md`

## Task 1: Restore a clean canonical replay baseline on Windows

**Files:**

- Modify: `src/unifiedCheck/providerReplay.ts`
- Modify: `scripts/runUnifiedAdaptiveBenchmark.ts`
- Modify: `tests/unified-check/providerReplay.test.ts`
- Modify: `tests/unified-check/rollingOracleEquivalence.postgres.test.ts`
- Modify: `tests/scripts/runUnifiedAdaptiveBenchmark.test.ts`

- [ ] **Step 1: Write the failing LF/CRLF file-boundary test**

Add `canonicalJsonFilePayload` to the import from
`src/unifiedCheck/providerReplay.ts`, then add:

```ts
it.each([
  ["{}", "{}"],
  ["{}\n", "{}"],
  ["{}\r\n", "{}"],
  ["{}\n\n", "{}\n"]
] as const)("removes one file line ending from %j", (bytes, expected) => {
  expect(canonicalJsonFilePayload(bytes)).toBe(expected);
});
```

In the existing fixture test, replace the one-character newline removal with:

```ts
const raw = canonicalJsonFilePayload(fileBytes);
expect(
  fileBytes === `${raw}\n` || fileBytes === `${raw}\r\n`
).toBe(true);
expect(canonicalizeArtifactJson(JSON.parse(raw))).toBe(raw);
```

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/providerReplay.test.ts
```

Expected: FAIL because `canonicalJsonFilePayload` is not exported.

- [ ] **Step 3: Add the one-terminator file helper**

Add immediately before `parseUnifiedProviderReplayV1`:

```ts
export function canonicalJsonFilePayload(fileBytes: string): string {
  if (fileBytes.endsWith("\r\n")) return fileBytes.slice(0, -2);
  if (fileBytes.endsWith("\n")) return fileBytes.slice(0, -1);
  return fileBytes;
}
```

Do not call this helper inside `parseUnifiedProviderReplayV1`. The parser stays
strict; only a text file's single platform terminator is removed.

- [ ] **Step 4: Route all checked-in replay fixture reads through the helper**

Import the helper beside `parseUnifiedProviderReplayV1` in the benchmark
script and both fixture-reading test files. Replace every fixture-only
`endsWith("\n") ? slice(0, -1)` and `.trimEnd()` with
`canonicalJsonFilePayload(bytes)`. In `loadReplayFixture` use:

```ts
const file = await readFile(path, "utf8");
const canonicalJson = canonicalJsonFilePayload(file);
return {
  canonicalJson,
  envelope: parseUnifiedProviderReplayV1(canonicalJson)
};
```

- [ ] **Step 5: Verify focused and full baseline**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/unified-check/providerReplay.test.ts tests/unified-check/rollingOracleEquivalence.postgres.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
npm run typecheck
npm test
```

Expected: zero failed tests. PostgreSQL tests may use only their existing
explicit skip gate. Stop before Task 2 when any unrelated failure remains.

- [ ] **Step 6: Commit the prerequisite**

```bash
git add src/unifiedCheck/providerReplay.ts scripts/runUnifiedAdaptiveBenchmark.ts tests/unified-check/providerReplay.test.ts tests/unified-check/rollingOracleEquivalence.postgres.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts
git commit -m "fix(unified): normalize replay file line endings"
```

## Task 2: Decode exact TronScan provider service observations

**Files:**

- Create: `src/unifiedCheck/providerServiceBindings.ts`
- Create: `tests/unified-check/providerServiceBindings.test.ts`

- [ ] **Step 1: Write exact-match and rejection-reason tests**

Use a `ProviderServiceMetadataV1` fixture with `Date` values for `fetchedAt`
and `expiresAt`, exact `rawJson.address`, and exact `rawJson.tag`. Add one
table-driven accepted test containing every initial catalog family:

```ts
import { expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from
  "../../src/forensics/canonicalJson";
import {
  decideTronScanProviderServiceAssertion,
  type ProviderServiceMetadataV1
} from "../../src/unifiedCheck/providerServiceBindings";

const ADDRESS = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const FROZEN_AT = "2026-07-26T12:00:00.000Z";

function metadata(
  change: Partial<ProviderServiceMetadataV1> = {}
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
    ...change
  };
}

it.each([
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
] as const)("accepts exact TronScan tag %s", (tag, catalogEntryId) => {
  const decision = decideTronScanProviderServiceAssertion({
    metadata: metadata({ tag, rawJson: { address: ADDRESS, tag } }),
    frozenAt: FROZEN_AT
  });
  expect(decision).toMatchObject({
    accepted: true,
    assertion: {
      address: ADDRESS,
      catalogEntryId,
      authority: "tronscan_verified_metadata",
      validity: {
        validFrom: "2026-07-26T11:00:00.000Z",
        validTo: null,
        basis: "provider_observed_from"
      }
    }
  });
});
```

Add this exact rejection table:

```ts
it.each([
  ["name only", metadata({
    name: "Binance",
    tag: null,
    verified: true,
    rawJson: { address: ADDRESS, tag: null }
  }), "tag_missing"],
  ["verified without tag", metadata({
    tag: null,
    verified: true,
    rawJson: { address: ADDRESS, tag: null }
  }), "tag_missing"],
  ["substring", metadata({
    tag: "Fake Binance",
    rawJson: { address: ADDRESS, tag: "Fake Binance" }
  }), "tag_unsupported"],
  ["generic", metadata({
    tag: "exchange",
    rawJson: { address: ADDRESS, tag: "exchange" }
  }), "tag_unsupported"],
  ["wrong case", metadata({
    tag: "binance",
    rawJson: { address: ADDRESS, tag: "binance" }
  }), "tag_unsupported"],
  ["raw address mismatch", metadata({
    rawJson: {
      address: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      tag: "Binance-Hot 8"
    }
  }), "raw_address_mismatch"],
  ["raw tag mismatch", metadata({
    rawJson: { address: ADDRESS, tag: "Bybit" }
  }), "raw_tag_mismatch"],
  ["invalid checksum", metadata({
    address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7Nz1",
    rawJson: {
      address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7Nz1",
      tag: "Binance-Hot 8"
    }
  }), "address_invalid"],
  ["wrong source", metadata({ source: "manual" }), "source_unsupported"],
  ["post snapshot", metadata({
    fetchedAt: new Date("2026-07-26T12:00:00.001Z")
  }), "observed_after_snapshot"],
  ["stale", metadata({
    expiresAt: new Date(FROZEN_AT)
  }), "stale_at_snapshot"],
  ["invalid fetched date", metadata({
    fetchedAt: new Date(Number.NaN)
  }), "fetched_at_invalid"],
  ["invalid expiry date", metadata({
    expiresAt: new Date(Number.NaN)
  }), "expires_at_invalid"],
  ["non-object payload", metadata({ rawJson: null }), "raw_payload_invalid"]
] as const)("rejects %s", (_name, row, reason) => {
  expect(decideTronScanProviderServiceAssertion({
    metadata: row,
    frozenAt: FROZEN_AT
  })).toEqual({ accepted: false, reason });
});

it("rejects a non-ISO freeze timestamp", () => {
  expect(decideTronScanProviderServiceAssertion({
    metadata: metadata(),
    frozenAt: "2026-07-26 12:00:00"
  })).toEqual({ accepted: false, reason: "frozen_at_invalid" });
});

it("does not treat contract verification as service authority", () => {
  const decision = decideTronScanProviderServiceAssertion({
    metadata: metadata({ verified: false }),
    frozenAt: FROZEN_AT
  });
  expect(decision.accepted).toBe(true);
  if (!decision.accepted) throw new Error("accepted fixture expected");
  expect(decision.assertion).not.toHaveProperty("rawJson");
});
```

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/providerServiceBindings.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add the versioned contract and full-value matcher**

Create the module with these exported contracts:

```ts
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
  | { readonly accepted: true;
      readonly assertion: AcceptedProviderServiceAssertionV1 }
  | { readonly accepted: false;
      readonly reason: ProviderServiceAssertionRejectionV1 };
```

Implement `matchTronScanCexTagV1(tag)` with this pinned, case-sensitive,
whole-value matcher table:

```ts
const TAG_MATCHERS = Object.freeze([
  ["cex:binance", [/^Binance$/u, /^Binance-Hot [1-9][0-9]*$/u]],
  ["cex:bybit", [/^Bybit$/u]],
  ["cex:okx", [
    /^OKX$/u,
    /^OKX Hot Wallet [1-9][0-9]*$/u,
    /^Okex [1-9][0-9]*$/u
  ]],
  ["cex:whitebit", [/^WhiteBIT$/u]],
  ["cex:coinbase", [/^Coinbase$/u]],
  ["cex:kraken", [/^Kraken$/u, /^Kraken: Hot Wallet$/u]],
  ["cex:kucoin", [/^KuCoin$/u, /^Kucoin [1-9][0-9]*$/u]],
  ["cex:bitget", [/^Bitget$/u, /^Bitget [1-9][0-9]*$/u]],
  ["cex:mexc", [
    /^MEXC$/u,
    /^MEXC [1-9][0-9]*$/u,
    /^MXC [1-9][0-9]*$/u
  ]],
  ["cex:bitstamp", [/^Bitstamp$/u]],
  ["cex:crypto-com", [/^Crypto\.com$/u]],
  ["cex:htx-huobi", [
    /^HTX [1-9][0-9]*$/u,
    /^Huobi [1-9][0-9]*$/u
  ]]
] as const);
```

Use these imports and helpers; they are the complete matcher boundary rather
than a substring fallback:

```ts
import { TronWeb } from "tronweb";
import { fingerprintCanonicalArtifact } from
  "../forensics/canonicalJson";
import { SUPPORTED_LABEL_CATALOG_V1 } from "./labelCatalog";

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

function rejection(
  reason: ProviderServiceAssertionRejectionV1
): ProviderServiceAssertionDecisionV1 {
  return { accepted: false, reason };
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactIsoMilliseconds(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : null;
}

export function matchTronScanCexTagV1(tag: string): string | null {
  for (const [catalogEntryId, matchers] of TAG_MATCHERS) {
    if (matchers.some((matcher) => matcher.test(tag))) {
      return catalogEntryId;
    }
  }
  return null;
}
```

Implement `decideTronScanProviderServiceAssertion` in the exact rejection
order listed in Step 1. Address acceptance requires both the canonical Base58
shape and `TronWeb.isAddress(address)`. Freshness is inclusive/exclusive:

```ts
fetchedAt.getTime() <= Date.parse(frozenAt) &&
Date.parse(frozenAt) < expiresAt.getTime()
```

Treat the fields as `unknown` at runtime even though the repository normally
returns `AddressMetadata`: require strings for address/source/tag, require a
plain object for `rawJson`, and require valid `Date` instances before calling
`getTime()` or `toISOString()`. This keeps a malformed DB row in the documented
rejection path rather than throwing before the diagnostic is recorded.

After the tag match, require that the catalog entry exists, has
`category === "cex"`, and has
`terminalPolicy === "custodial_boundary"`.

Add this complete decoder below the helpers:

```ts
export function decideTronScanProviderServiceAssertion(input: {
  readonly metadata: ProviderServiceMetadataV1;
  readonly frozenAt: string;
}): ProviderServiceAssertionDecisionV1 {
  const frozenAtMs = exactIsoMilliseconds(input.frozenAt);
  if (frozenAtMs === null) return rejection("frozen_at_invalid");

  const { metadata } = input;
  if (
    typeof metadata.address !== "string" ||
    !TRON_ADDRESS.test(metadata.address) ||
    !TronWeb.isAddress(metadata.address)
  ) return rejection("address_invalid");
  if (metadata.source !== "tronscan") {
    return rejection("source_unsupported");
  }
  if (typeof metadata.tag !== "string" || metadata.tag.length === 0) {
    return rejection("tag_missing");
  }

  const rawJson = plainObject(metadata.rawJson);
  if (rawJson === null) return rejection("raw_payload_invalid");
  if (rawJson.address !== metadata.address) {
    return rejection("raw_address_mismatch");
  }
  if (rawJson.tag !== metadata.tag) return rejection("raw_tag_mismatch");
  if (
    !(metadata.fetchedAt instanceof Date) ||
    !Number.isFinite(metadata.fetchedAt.getTime())
  ) return rejection("fetched_at_invalid");
  if (
    !(metadata.expiresAt instanceof Date) ||
    !Number.isFinite(metadata.expiresAt.getTime())
  ) return rejection("expires_at_invalid");
  if (metadata.fetchedAt.getTime() > frozenAtMs) {
    return rejection("observed_after_snapshot");
  }
  if (frozenAtMs >= metadata.expiresAt.getTime()) {
    return rejection("stale_at_snapshot");
  }

  const catalogEntryId = matchTronScanCexTagV1(metadata.tag);
  if (catalogEntryId === null) return rejection("tag_unsupported");
  const entry = SUPPORTED_LABEL_CATALOG_V1.entries.find(
    (candidate) => candidate.id === catalogEntryId
  );
  if (
    entry?.category !== "cex" ||
    entry.terminalPolicy !== "custodial_boundary"
  ) return rejection("catalog_policy_mismatch");

  const fetchedAt = metadata.fetchedAt.toISOString();
  const expiresAt = metadata.expiresAt.toISOString();
  const sourceEnvelope = {
    version: "tronscan-address-tag-observation-source-v1" as const,
    chain: "tron" as const,
    address: metadata.address,
    catalogEntryId: entry.id,
    authority: "tronscan_verified_metadata" as const,
    provider: "tronscan" as const,
    matchedField: "tag" as const,
    matchedValue: metadata.tag,
    matcherVersion: TRONSCAN_CEX_TAG_MATCHER_VERSION,
    fetchedAt,
    expiresAt,
    rawJson
  };
  let sourcePayloadSha256: string;
  try {
    sourcePayloadSha256 = fingerprintCanonicalArtifact(sourceEnvelope);
  } catch {
    return rejection("source_payload_invalid");
  }
  return {
    accepted: true,
    assertion: {
      version: "tronscan-address-tag-observation-v1",
      chain: "tron",
      address: metadata.address,
      catalogEntryId: entry.id,
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
    }
  };
}
```

- [ ] **Step 4: Bind raw provider evidence into the hash without exposing it**

The decoder above computes the hash from this exact source envelope:

```ts
const sourceEnvelope = {
  version: "tronscan-address-tag-observation-source-v1" as const,
  chain: "tron" as const,
  address,
  catalogEntryId,
  authority: "tronscan_verified_metadata" as const,
  provider: "tronscan" as const,
  matchedField: "tag" as const,
  matchedValue: tag,
  matcherVersion: TRONSCAN_CEX_TAG_MATCHER_VERSION,
  fetchedAt,
  expiresAt,
  rawJson: metadata.rawJson
};
```

Catch canonicalization failure and return
`{ accepted: false, reason: "source_payload_invalid" }`. On success, return an
assertion whose `source` contains the hash but does not contain `rawJson`.
Set `validFrom` to `fetchedAt` and `validTo` to `null`; do not use `expiresAt`
as an ownership end.

Add this hash/public-shape test:

```ts
it("binds payload, observation times, tag, and matcher version", () => {
  const baseline = decideTronScanProviderServiceAssertion({
    metadata: metadata(),
    frozenAt: FROZEN_AT
  });
  expect(baseline.accepted).toBe(true);
  if (!baseline.accepted) throw new Error("accepted fixture expected");
  expect(baseline.assertion.source).not.toHaveProperty("rawJson");
  expect(baseline.assertion.source.matcherVersion)
    .toBe("unified-tronscan-cex-tag-map-v1");

  const changes = [
    metadata({
      rawJson: {
        address: ADDRESS,
        tag: "Binance-Hot 8",
        addressTagLogo: "changed"
      }
    }),
    metadata({
      tag: "Bybit",
      rawJson: { address: ADDRESS, tag: "Bybit" }
    }),
    metadata({ fetchedAt: new Date("2026-07-26T11:00:00.001Z") }),
    metadata({ expiresAt: new Date("2026-07-26T13:00:00.001Z") })
  ];
  for (const changed of changes) {
    const decision = decideTronScanProviderServiceAssertion({
      metadata: changed,
      frozenAt: FROZEN_AT
    });
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) throw new Error("accepted fixture expected");
    expect(decision.assertion.source.sourcePayloadSha256)
      .not.toBe(baseline.assertion.source.sourcePayloadSha256);
  }

  const matcherChangedEnvelope = {
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
  };
  expect(fingerprintCanonicalArtifact(matcherChangedEnvelope))
    .not.toBe(baseline.assertion.source.sourcePayloadSha256);
});
```

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/providerServiceBindings.test.ts tests/unified-check/labelCatalog.test.ts
npm run typecheck
git add src/unifiedCheck/providerServiceBindings.ts tests/unified-check/providerServiceBindings.test.ts
git commit -m "feat(unified): decode authoritative tronscan service tags"
```

## Task 3: Centralize catalog/time resolution and freeze accepted records

**Files:**

- Modify: `src/unifiedCheck/labelCatalog.ts`
- Modify: `tests/unified-check/labelCatalog.test.ts`
- Modify: `src/unifiedCheck/boundaryPredicates.ts`
- Modify: `tests/unified-check/boundaryPredicates.test.ts`
- Modify: `src/unifiedCheck/frozenLabels.ts`
- Modify: `tests/unified-check/frozenLabels.test.ts`
- Modify: `tests/unified-check/productionBoundary.test.ts`

- [ ] **Step 1: Write authority and shared-resolver RED tests**

In `labelCatalog.test.ts`, add tests proving:

- `verified_provider` accepts only `tronscan_verified_metadata`;
- `exact_registry` accepts only `internal_service_registry`;
- an accepted record resolves only when
  `validFrom <= eventTimestamp <= validTo`;
- a pre-`validFrom` event returns `label_not_valid_at_event`;
- a hint returns `hint_not_terminal`;
- catalog identity/category mismatch is an invariant error.

Use these exported result types:

```ts
export type FrozenLabelResolutionV1 =
  | {
      readonly kind: "eligible";
      readonly entry: SupportedLabelCatalogEntryV1;
    }
  | { readonly kind: "label_not_valid_at_event" }
  | { readonly kind: "hint_not_terminal" };
```

In `boundaryPredicates.test.ts`, retain the existing inclusive interval cases
and assert the predicate now produces the same context results through the
shared resolver.

Append these concrete catalog tests:

```ts
const PROVIDER_ADDRESS = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const providerLabel = buildFrozenLabelRecord({
  address: PROVIDER_ADDRESS,
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

it("resolves an authoritative label on its inclusive interval", () => {
  expect(resolveFrozenLabelAtEventV1({
    label: providerLabel,
    eventTimestamp: "2026-07-26T11:00:00.000Z"
  })).toMatchObject({
    kind: "eligible",
    entry: { id: "cex:bybit", identity: "Bybit" }
  });
  expect(resolveFrozenLabelAtEventV1({
    label: providerLabel,
    eventTimestamp: "2026-07-26T13:00:00.000Z"
  }).kind).toBe("eligible");
  expect(resolveFrozenLabelAtEventV1({
    label: providerLabel,
    eventTimestamp: "2026-07-26T10:59:59.999Z"
  })).toEqual({ kind: "label_not_valid_at_event" });
});

it("keeps classifier evidence nonterminal", () => {
  const hint = buildFrozenLabelRecord({
    address: PROVIDER_ADDRESS,
    classifierHint: { identity: "Bybit", category: "cex" },
    exactRegistryBinding: null,
    verifiedProviderBinding: null
  });
  expect(resolveFrozenLabelAtEventV1({
    label: hint,
    eventTimestamp: "2026-07-26T12:00:00.000Z"
  })).toEqual({ kind: "hint_not_terminal" });
});

it("rejects crossed authority kinds and contradictory catalog identity", () => {
  expect(() => buildFrozenLabelRecord({
    address: PROVIDER_ADDRESS,
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
  expect(() => resolveFrozenLabelAtEventV1({
    label: { ...providerLabel, identity: "Not Bybit" },
    eventTimestamp: "2026-07-26T12:00:00.000Z"
  })).toThrow("unified_frozen_label_catalog_binding_invalid");
});
```

- [ ] **Step 2: Prove RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/labelCatalog.test.ts tests/unified-check/boundaryPredicates.test.ts
```

Expected: FAIL for the missing resolver and missing strength-specific authority
check.

- [ ] **Step 3: Enforce strength-specific authority and export one resolver**

In `recordFromBinding`, add this check before returning the record:

```ts
const requiredAuthority = strength === "exact_registry"
  ? "internal_service_registry"
  : "tronscan_verified_metadata";
if (binding.authority !== requiredAuthority) {
  throw new TypeError("unified_label_authority_unsupported");
}
```

Export `resolveFrozenLabelAtEventV1` from `labelCatalog.ts`. It must:

1. parse `eventTimestamp`, `validFrom`, and `validTo` as exact ISO strings;
2. resolve `catalogEntryId` in `SUPPORTED_LABEL_CATALOG_V1`;
3. throw `unified_frozen_label_catalog_binding_invalid` when persisted
   identity/category or strength/authority/terminalEligible contradicts the
   catalog contract;
4. return `hint_not_terminal` for a valid hint;
5. return `label_not_valid_at_event` outside the inclusive interval;
6. otherwise return `{ kind: "eligible", entry }`.

Use this complete implementation:

```ts
function exactTimestamp(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(code);
  }
  return parsed;
}

export function resolveFrozenLabelAtEventV1(input: {
  readonly label: FrozenLabelRecordV1;
  readonly eventTimestamp: string;
}): FrozenLabelResolutionV1 {
  const eventAt = exactTimestamp(
    input.eventTimestamp,
    "unified_boundary_timestamp_invalid"
  );
  const entry = SUPPORTED_LABEL_CATALOG_V1.entries.find(
    (candidate) => candidate.id === input.label.catalogEntryId
  );
  if (
    entry === undefined ||
    entry.identity !== input.label.identity ||
    entry.category !== input.label.category
  ) {
    throw new Error("unified_frozen_label_catalog_binding_invalid");
  }

  if (input.label.strength === "hint") {
    if (
      input.label.authority !== "classifier_hint" ||
      input.label.terminalEligible
    ) {
      throw new Error("unified_frozen_label_catalog_binding_invalid");
    }
    return { kind: "hint_not_terminal" };
  }
  if (
    input.label.strength !== "exact_registry" &&
    input.label.strength !== "verified_provider"
  ) throw new Error("unified_frozen_label_catalog_binding_invalid");
  const expectedAuthority = input.label.strength === "exact_registry"
    ? "internal_service_registry"
    : "tronscan_verified_metadata";
  if (
    input.label.authority !== expectedAuthority ||
    !entry.acceptedAuthorities.includes(input.label.authority) ||
    !input.label.terminalEligible
  ) {
    throw new Error("unified_frozen_label_catalog_binding_invalid");
  }

  const validFrom = input.label.validFrom === null
    ? null
    : exactTimestamp(
        input.label.validFrom,
        "unified_label_validity_invalid"
      );
  const validTo = input.label.validTo === null
    ? null
    : exactTimestamp(input.label.validTo, "unified_label_validity_invalid");
  if (validFrom !== null && validTo !== null && validFrom > validTo) {
    throw new TypeError("unified_label_validity_invalid");
  }
  if (
    (validFrom !== null && eventAt < validFrom) ||
    (validTo !== null && validTo < eventAt)
  ) return { kind: "label_not_valid_at_event" };
  return { kind: "eligible", entry };
}
```

In `boundaryPredicates.ts`, remove its private catalog/time implementations and
use the shared resolver in the existing label loop. Keep terminal-policy order
and all evidence bytes unchanged for valid existing inputs.

Replace the loop body after the address check with:

```ts
const resolution = resolveFrozenLabelAtEventV1({
  label,
  eventTimestamp: input.eventTimestamp
});
if (resolution.kind === "label_not_valid_at_event") {
  context.push({
    kind: "label_not_valid_at_event",
    catalogEntryId: label.catalogEntryId,
    evidenceSha256: label.sourcePayloadSha256
  });
  continue;
}
if (resolution.kind === "hint_not_terminal") {
  context.push({
    kind: "hint_not_terminal",
    catalogEntryId: label.catalogEntryId,
    evidenceSha256: label.sourcePayloadSha256
  });
  continue;
}
eligible.push({ label, entry: resolution.entry });
```

- [ ] **Step 4: Write provider-composition and V1 characterization tests**

In `frozenLabels.test.ts`, add the imports for the decoder and production
builder, then add this complete test:

```ts
import {
  decideTronScanProviderServiceAssertion,
  type AcceptedProviderServiceAssertionV1
} from "../../src/unifiedCheck/providerServiceBindings";

function acceptedProvider(
  address: string,
  tag: "Bybit" | "Binance"
): AcceptedProviderServiceAssertionV1 {
  const decision = decideTronScanProviderServiceAssertion({
    metadata: {
      address,
      source: "tronscan",
      name: null,
      tag,
      verified: null,
      rawJson: { address, tag },
      fetchedAt: new Date("2026-07-24T00:00:00.000Z"),
      expiresAt: new Date("2026-07-27T00:00:00.000Z")
    },
    frozenAt: "2026-07-26T00:00:00.000Z"
  });
  if (!decision.accepted) {
    throw new Error(`accepted provider fixture expected:${decision.reason}`);
  }
  return decision.assertion;
}

it("freezes provider assertions canonically without changing V1", () => {
  const assertions = [
    acceptedProvider(
      "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
      "Bybit"
    ),
    acceptedProvider(
      "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      "Binance"
    )
  ];
  const first = buildProductionFrozenLabelDataset({
    frozenAt: "2026-07-26T00:00:00.000Z",
    snapshotHash: SNAPSHOT,
    legacyRows: [],
    providerAssertions: assertions
  });
  const reordered = buildProductionFrozenLabelDataset({
    frozenAt: "2026-07-26T00:00:00.000Z",
    snapshotHash: SNAPSHOT,
    legacyRows: [],
    providerAssertions: [...assertions].reverse()
  });
  expect(reordered.sha256).toBe(first.sha256);
  expect(first.dataset.labels).toContainEqual(expect.objectContaining({
    address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
    catalogEntryId: "cex:bybit",
    strength: "verified_provider",
    authority: "tronscan_verified_metadata",
    validFrom: "2026-07-24T00:00:00.000Z",
    validTo: null,
    terminalEligible: true
  }));
  expect(first.dataset.legacyRows).toEqual([]);

  expect(buildProductionFrozenLabelDataset({
    frozenAt: "2026-07-24T00:00:00.000Z",
    snapshotHash: "a".repeat(64),
    legacyRows: []
  }).sha256).toBe(
    "0328a9b8517294df15030bb9dbb25601063570ff03133c2e26f73aff58220e36"
  );
});
```

- [ ] **Step 5: Extend only the production dataset composer**

Replace the production composer with this complete body, adding a type-only
import for `AcceptedProviderServiceAssertionV1`:

```ts
export function buildProductionFrozenLabelDataset(input: {
  readonly frozenAt: string;
  readonly snapshotHash: string;
  readonly legacyRows: readonly LegacyFrozenLabelRowV1[];
  readonly providerAssertions?:
    readonly AcceptedProviderServiceAssertionV1[];
}) {
  const exactLabels = SUPPORTED_LABEL_CATALOG_V1.entries.flatMap((entry) =>
    entry.addressBindings.map((address) => buildFrozenLabelRecord({
      address,
      classifierHint: null,
      exactRegistryBinding: {
        catalogEntryId: entry.id,
        authority: "internal_service_registry",
        sourcePayloadSha256: fingerprintCanonicalArtifact({
          version: SUPPORTED_LABEL_CATALOG_V1.version,
          entry
        })
      },
      verifiedProviderBinding: null
    }))
  );
  const providerLabels = (input.providerAssertions ?? []).map((assertion) =>
    buildFrozenLabelRecord({
      address: assertion.address,
      classifierHint: null,
      exactRegistryBinding: null,
      verifiedProviderBinding: {
        catalogEntryId: assertion.catalogEntryId,
        authority: assertion.authority,
        sourcePayloadSha256: assertion.source.sourcePayloadSha256,
        validFrom: assertion.validity.validFrom,
        validTo: assertion.validity.validTo
      }
    })
  );
  const hintLabels = input.legacyRows.flatMap((row) => {
    const normalized = [row.label, row.category]
      .map((value) => value.trim().toLowerCase());
    const entry = SUPPORTED_LABEL_CATALOG_V1.entries.find((candidate) =>
      normalized.includes(candidate.identity.toLowerCase())
    );
    return entry === undefined
      ? []
      : [buildFrozenLabelRecord({
          address: row.address,
          classifierHint: {
            identity: entry.identity,
            category: entry.category,
            sourcePayloadSha256: fingerprintCanonicalArtifact({
              version: "unified-label-source-row-v1",
              ...row
            })
          },
          exactRegistryBinding: null,
          verifiedProviderBinding: null
        })];
  });
  return buildFrozenLabelDataset({
    frozenAt: input.frozenAt,
    snapshotHash: input.snapshotHash,
    labels: [...exactLabels, ...providerLabels, ...hintLabels],
    legacyRows: input.legacyRows
  });
}
```

Do not copy provider data into `legacyRows` and do not change the
frozen-dataset schema.

- [ ] **Step 6: Prove the production V2 predicate uses the provider interval**

In `productionBoundary.test.ts`, extend the frozen-label import with
`buildProductionFrozenLabelDataset`, import the decoder, and add:

```ts
function providerDecision(fetchedAt: string) {
  const observation = decideTronScanProviderServiceAssertion({
    metadata: {
      address: COUNTERPARTY,
      source: "tronscan",
      name: null,
      tag: "Bybit",
      verified: false,
      rawJson: { address: COUNTERPARTY, tag: "Bybit" },
      fetchedAt: new Date(fetchedAt),
      expiresAt: new Date("2026-07-24T00:00:00.000Z")
    },
    frozenAt: "2026-07-23T13:00:00.000Z"
  });
  if (!observation.accepted) {
    throw new Error(`accepted provider fixture expected:${observation.reason}`);
  }
  const frozen = buildProductionFrozenLabelDataset({
    frozenAt: "2026-07-23T13:00:00.000Z",
    snapshotHash: SNAPSHOT,
    legacyRows: [],
    providerAssertions: [observation.assertion]
  });
  return evaluateProductionBoundaryV2({
    state,
    eventTimestamp: AT,
    labels: frozen.dataset.labels,
    snapshotHash: SNAPSHOT,
    labelDatasetSha256: frozen.sha256
  });
}

it("applies a production provider record only from its observation time", () => {
  expect(providerDecision("2026-07-23T11:59:59.999Z")).toMatchObject({
    terminal: true,
    evidence: {
      labelCatalogEntryId: "cex:bybit",
      labelAuthority: "tronscan_verified_metadata",
      eventTimestamp: AT
    }
  });
  expect(providerDecision("2026-07-23T12:00:00.001Z"))
    .toEqual({ terminal: false });
});
```

Keep the existing legacy-risk-row and classifier-hint nonterminal tests.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/providerServiceBindings.test.ts tests/unified-check/labelCatalog.test.ts tests/unified-check/boundaryPredicates.test.ts tests/unified-check/frozenLabels.test.ts tests/unified-check/productionBoundary.test.ts tests/unified-check/productionTraversalCoordinator.test.ts
npm run typecheck
git add src/unifiedCheck/labelCatalog.ts tests/unified-check/labelCatalog.test.ts src/unifiedCheck/boundaryPredicates.ts tests/unified-check/boundaryPredicates.test.ts src/unifiedCheck/frozenLabels.ts tests/unified-check/frozenLabels.test.ts tests/unified-check/productionBoundary.test.ts
git commit -m "feat(unified): freeze verified provider service records"
```

## Task 4: Read fresh provider metadata for each new V2 freeze

**Files:**

- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/repositories.test.ts`
- Create: `src/unifiedCheck/productionLabelFreeze.ts`
- Create: `tests/unified-check/productionLabelFreeze.test.ts`
- Modify: `src/index.ts`
- Modify: `scripts/runUnifiedWalletCanary.ts`
- Modify: `tests/unified-check/requestService.test.ts`

- [ ] **Step 1: Write the repository RED test**

Add `listFreshTaggedAddressMetadataAt` to the repository test imports. Use the
existing mock DB and append this complete test:

```ts
it("lists only provider-tag candidates fresh at the freeze instant", async () => {
  const frozenAt = new Date("2026-07-26T12:00:00.000Z");
  const fetchedAt = new Date("2026-07-26T11:00:00.000Z");
  const expiresAt = new Date("2026-07-26T13:00:00.000Z");
  const { db, queries } = createMockDb(1, [{
    address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
    source: "tronscan",
    name: null,
    tag: "Bybit",
    is_contract: false,
    verified: null,
    account_type: 0,
    raw_json: {
      address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
      tag: "Bybit"
    },
    fetched_at: fetchedAt,
    expires_at: expiresAt
  }]);

  expect(await listFreshTaggedAddressMetadataAt(db, frozenAt)).toEqual([{
    address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
    source: "tronscan",
    name: null,
    tag: "Bybit",
    isContract: false,
    verified: null,
    accountType: 0,
    rawJson: {
      address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
      tag: "Bybit"
    },
    fetchedAt,
    expiresAt
  }]);
  expect(queries[0]?.sql).toContain("source = 'tronscan'");
  expect(queries[0]?.sql).toContain("tag is not null");
  expect(queries[0]?.sql).toContain("btrim(tag) <> ''");
  expect(queries[0]?.sql).toContain("fetched_at <= $1");
  expect(queries[0]?.sql).toContain("expires_at > $1");
  expect(queries[0]?.params).toEqual([frozenAt]);
});
```

- [ ] **Step 2: Prove repository RED, then implement the minimal query**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/storage/repositories.test.ts
```

Add beside `getAddressMetadata`:

```ts
// ponytail: This scans all fresh non-empty provider tags. If candidate volume
// materially approaches the metadata table size, add a separately reviewed
// indexed exact-tag lookup without changing the decoder contract.
export async function listFreshTaggedAddressMetadataAt(
  db: Db,
  frozenAt: Date
): Promise<AddressMetadata[]> {
  const result = await db.query(
    `select address, source, name, tag, is_contract, verified,
            account_type, raw_json, fetched_at, expires_at
       from address_metadata
      where source = 'tronscan'
        and tag is not null
        and btrim(tag) <> ''
        and fetched_at <= $1
        and expires_at > $1
      order by address`,
    [frozenAt]
  );
  return result.rows.map(mapAddressMetadataRow);
}
```

Run the focused repository test again and expect PASS.

- [ ] **Step 3: Write policy-gate, immutability, and diagnostic RED tests**

Create `productionLabelFreeze.test.ts` with the normal Vitest imports and this
complete fixture/test body:

```ts
import { describe, expect, it, vi } from "vitest";
import { createProductionLabelDatasetFreezer } from
  "../../src/unifiedCheck/productionLabelFreeze";
import type { ProviderServiceMetadataV1 } from
  "../../src/unifiedCheck/providerServiceBindings";

const BYBIT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const REJECTED = "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd";
const FROZEN_AT = "2026-07-26T12:00:00.000Z";

function tagged(
  address: string,
  tag: string | null
): ProviderServiceMetadataV1 {
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

describe("production label freeze", () => {
  it("keeps V1 byte-identical without loading provider metadata", async () => {
    const loadFreshProviderMetadata = vi.fn(async () => [tagged(BYBIT, "Bybit")]);
    const freeze = createProductionLabelDatasetFreezer({
      traversalPolicyVersion: "snapshot-closure-v1",
      legacyRows: [],
      loadFreshProviderMetadata
    });
    const result = await freeze({
      frozenAt: "2026-07-24T00:00:00.000Z",
      snapshotHash: "a".repeat(64)
    });
    expect(loadFreshProviderMetadata).not.toHaveBeenCalled();
    expect(result.sha256).toBe(
      "0328a9b8517294df15030bb9dbb25601063570ff03133c2e26f73aff58220e36"
    );
  });

  it("reads every V2 freeze afresh and emits address-free diagnostics", async () => {
    let rows: readonly ProviderServiceMetadataV1[] = [
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
    const binding = {
      frozenAt: FROZEN_AT,
      snapshotHash: "b".repeat(64)
    };
    const first = await freeze(binding);
    const firstDataset = structuredClone(first.dataset);
    expect(first.dataset.labels).toContainEqual(expect.objectContaining({
      address: BYBIT,
      catalogEntryId: "cex:bybit"
    }));
    expect(first.dataset.labels.some((label) => label.address === REJECTED))
      .toBe(false);
    expect(observe).toHaveBeenLastCalledWith({
      version: "unified-provider-service-freeze-diagnostic-v1",
      traversalPolicyVersion: "snapshot-closure-v2",
      matcherVersion: "unified-tronscan-cex-tag-map-v1",
      candidates: 2,
      accepted: 1,
      rejectedByReason: { tag_missing: 1 }
    });
    const serialized = JSON.stringify(observe.mock.calls[0]?.[0]);
    expect(serialized).not.toContain(BYBIT);
    expect(serialized).not.toContain(REJECTED);
    expect(serialized).not.toContain("raw:");

    rows = [tagged(BYBIT, "Binance")];
    const second = await freeze(binding);
    expect(loadFreshProviderMetadata).toHaveBeenCalledTimes(2);
    expect(first.dataset).toEqual(firstDataset);
    expect(second.sha256).not.toBe(first.sha256);
    expect(second.dataset.labels).toContainEqual(expect.objectContaining({
      address: BYBIT,
      catalogEntryId: "cex:binance"
    }));
  });
});
```

In `requestService.test.ts`, extend the Vitest import with `vi` and add this
explicit existing-run no-reread test:

```ts
it("does not freeze labels again for an already attached request", async () => {
  const store = new MemoryStore();
  const firstInput = input(
    store,
    source(),
    "same-action",
    "same-request",
    "run-first"
  );
  await intakeUnifiedCheck(firstInput);
  const freezeLabelDataset = vi.fn();
  const repeatedInput = input(
    store,
    source(),
    "same-action",
    "same-request",
    "run-ignored"
  );
  Object.assign(repeatedInput, { freezeLabelDataset });
  const repeated = await intakeUnifiedCheck(repeatedInput);
  expect(repeated.kind).toBe("attached");
  expect(freezeLabelDataset).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Prove freezer RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/productionLabelFreeze.test.ts
```

Expected: FAIL because the policy-aware freezer does not exist.

- [ ] **Step 5: Implement the shared policy-aware freezer**

Create `productionLabelFreeze.ts` with this complete implementation:

```ts
import type { UnifiedTraversalPolicyVersion } from "./contracts";
import {
  buildProductionFrozenLabelDataset,
  type FrozenLabelDatasetV1,
  type LegacyFrozenLabelRowV1
} from "./frozenLabels";
import {
  decideTronScanProviderServiceAssertion,
  TRONSCAN_CEX_TAG_MATCHER_VERSION,
  type AcceptedProviderServiceAssertionV1,
  type ProviderServiceAssertionRejectionV1,
  type ProviderServiceMetadataV1
} from "./providerServiceBindings";

export type ProviderServiceFreezeDiagnosticV1 = {
  readonly version: "unified-provider-service-freeze-diagnostic-v1";
  readonly traversalPolicyVersion: UnifiedTraversalPolicyVersion;
  readonly matcherVersion: typeof TRONSCAN_CEX_TAG_MATCHER_VERSION;
  readonly candidates: number;
  readonly accepted: number;
  readonly rejectedByReason: Readonly<Partial<Record<
    ProviderServiceAssertionRejectionV1,
    number
  >>>;
};

export function createProductionLabelDatasetFreezer(input: {
  readonly traversalPolicyVersion: UnifiedTraversalPolicyVersion;
  readonly legacyRows: readonly LegacyFrozenLabelRowV1[];
  readonly loadFreshProviderMetadata: (
    frozenAt: Date
  ) => Promise<readonly ProviderServiceMetadataV1[]>;
  readonly observe?: (diagnostic: ProviderServiceFreezeDiagnosticV1) => void;
}): (freeze: {
  readonly snapshotHash: string;
  readonly frozenAt: string;
}) => Promise<{
  readonly dataset: FrozenLabelDatasetV1;
  readonly sha256: string;
}> {
  return async (freeze) => {
    if (input.traversalPolicyVersion === "snapshot-closure-v1") {
      return buildProductionFrozenLabelDataset({
        ...freeze,
        legacyRows: input.legacyRows
      });
    }

    const frozenAt = new Date(freeze.frozenAt);
    if (
      !Number.isFinite(frozenAt.getTime()) ||
      frozenAt.toISOString() !== freeze.frozenAt
    ) throw new TypeError("unified_provider_service_freeze_time_invalid");

    const metadata = await input.loadFreshProviderMetadata(frozenAt);
    const accepted: AcceptedProviderServiceAssertionV1[] = [];
    const rejectedByReason: Partial<Record<
      ProviderServiceAssertionRejectionV1,
      number
    >> = {};
    for (const row of metadata) {
      const decision = decideTronScanProviderServiceAssertion({
        metadata: row,
        frozenAt: freeze.frozenAt
      });
      if (decision.accepted) {
        accepted.push(decision.assertion);
        continue;
      }
      rejectedByReason[decision.reason] =
        (rejectedByReason[decision.reason] ?? 0) + 1;
    }
    input.observe?.(Object.freeze({
      version: "unified-provider-service-freeze-diagnostic-v1",
      traversalPolicyVersion: input.traversalPolicyVersion,
      matcherVersion: TRONSCAN_CEX_TAG_MATCHER_VERSION,
      candidates: metadata.length,
      accepted: accepted.length,
      rejectedByReason: Object.freeze({ ...rejectedByReason })
    }));
    return buildProductionFrozenLabelDataset({
      ...freeze,
      legacyRows: input.legacyRows,
      providerAssertions: accepted
    });
  };
}
```

Do not add a DB-error catch around the loader; the existing intake/canary
technical-failure path remains authoritative. Malformed individual rows are
decoder rejections, not run failures.

- [ ] **Step 6: Wire production user intake once, without changing request APIs**

After `unifiedLabelRows` is built in `src/index.ts`, create:

```ts
const freezeProductionLabelDataset = createProductionLabelDatasetFreezer({
  traversalPolicyVersion: config.unifiedTraversalPolicyVersion,
  legacyRows: unifiedLabelRows,
  loadFreshProviderMetadata: (frozenAt) =>
    listFreshTaggedAddressMetadataAt(db, frozenAt),
  observe: (diagnostic) => logger.info(
    "unified_provider_service_freeze",
    diagnostic
  )
});
```

Replace the inline `buildProductionFrozenLabelDataset` callback in the user
intake call with:

```ts
freezeLabelDataset: freezeProductionLabelDataset,
```

Add imports for `listFreshTaggedAddressMetadataAt` and
`createProductionLabelDatasetFreezer`; remove the now-unused direct production
builder import from `src/index.ts`.

Attached and existing runs return before freeze in `intakeUnifiedCheck`, so
they never reread live metadata. The V1 policy still calls the old builder
through the early gate and never executes the metadata query.

- [ ] **Step 7: Wire isolated V2 canaries through the same freezer**

After `labelRows` is loaded in `runUnifiedWalletCanary.ts`, create this freezer
with the selected `traversalPolicyVersion`:

```ts
const freezeCanaryLabelDataset = createProductionLabelDatasetFreezer({
  traversalPolicyVersion,
  legacyRows: labelRows,
  loadFreshProviderMetadata: (frozenAt) =>
    listFreshTaggedAddressMetadataAt(db, frozenAt),
  observe: (diagnostic) => process.stderr.write(`${JSON.stringify({
    event: "unified_provider_service_freeze",
    ...diagnostic
  })}\n`)
});
```

Replace the current conditional callback with:

```ts
freezeLabelDataset: traversalPolicyVersion === "snapshot-closure-v2"
  ? freezeCanaryLabelDataset
  : undefined,
```

Add imports for `listFreshTaggedAddressMetadataAt` and
`createProductionLabelDatasetFreezer`, and remove the now-unused direct
production-builder import. Do not change the default policy, batch identity,
or delivery isolation.

- [ ] **Step 8: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/storage/repositories.test.ts tests/unified-check/productionLabelFreeze.test.ts tests/unified-check/requestService.test.ts tests/unified-check/requestService.postgres.test.ts tests/unified-check/canary.test.ts tests/unified-check/canary.postgres.test.ts
npm run typecheck
git add src/storage/repositories.ts tests/storage/repositories.test.ts src/unifiedCheck/productionLabelFreeze.ts tests/unified-check/productionLabelFreeze.test.ts src/index.ts scripts/runUnifiedWalletCanary.ts tests/unified-check/requestService.test.ts
git commit -m "feat(unified): read provider tags per v2 freeze"
```

## Task 5: Prove boundary-before-history and restart behavior end to end

**Files:**

- Modify: `tests/unified-check/productionTraversalCoordinator.test.ts`

- [ ] **Step 1: Replace synthetic authority in one coordinator case**

Import `decideTronScanProviderServiceAssertion` and extend the frozen-label
import with `buildProductionFrozenLabelDataset`. Add this helper:

```ts
function providerDataset(fetchedAt: string) {
  const decision = decideTronScanProviderServiceAssertion({
    metadata: {
      address: CEX,
      source: "tronscan",
      name: null,
      tag: "Bybit",
      verified: false,
      rawJson: { address: CEX, tag: "Bybit" },
      fetchedAt: new Date(fetchedAt),
      expiresAt: new Date("2026-07-24T00:00:00.000Z")
    },
    frozenAt: manifest.confirmedBlockTimestamp
  });
  if (!decision.accepted) {
    throw new Error(`accepted provider fixture expected:${decision.reason}`);
  }
  return buildProductionFrozenLabelDataset({
    frozenAt: manifest.confirmedBlockTimestamp,
    snapshotHash: manifest.snapshotHash,
    legacyRows: [],
    providerAssertions: [decision.assertion]
  });
}
```

Inside `coordinatorHarness`, add the spy immediately before handler creation:

```ts
const createTaskId = vi.fn(() => `v2-history-${++taskId}`);
```

Replace the current handler option:

```ts
createTaskId: () => `v2-history-${++taskId}`,
```

with:

```ts
createTaskId,
```

Add `createTaskId,` beside `artifacts,` in the existing returned harness
object. These are the only harness implementation changes.

- [ ] **Step 2: Add the accepted provider boundary case**

Add this provider-built all-terminal test:

```ts
it("commits a provider CEX boundary before history discovery", async () => {
  const dataset = providerDataset("2026-07-23T11:00:00.000Z");
  const scenario = coordinatorHarness({
    manifest: v2Manifest(dataset),
    directEvents: [event({
      hash: "c".repeat(64),
      from: CEX,
      to: SUBJECT,
      amountRaw: "10",
      timestamp: "2026-07-23T12:00:00.000Z"
    })],
    dataset
  });
  const first = await scenario.run();
  expect(first.kind).toBe("checkpoint");
  if (first.kind !== "checkpoint") throw new Error("checkpoint expected");
  expect(first.orderedCommit).toBeUndefined();
  const boundaryEvidence = [...scenario.artifacts.values()].filter(
    (artifact) => (artifact as { version?: string }).version ===
      "unified-traversal-boundary-evidence-v2"
  );
  expect(boundaryEvidence).toMatchObject([{
    version: "unified-traversal-boundary-evidence-v2",
    labelCatalogEntryId: "cex:bybit",
    labelAuthority: "tronscan_verified_metadata"
  }]);
  const second = await scenario.run(first.checkpoint);
  expect(second.kind).toBe("completed");
  expect(scenario.createTaskId).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Add post-event and V1 control cases**

Add these controls:

```ts
it("continues history when the provider observation is later than the event", async () => {
  const dataset = providerDataset("2026-07-23T12:00:00.001Z");
  const scenario = coordinatorHarness({
    manifest: v2Manifest(dataset),
    directEvents: [event({
      hash: "d".repeat(64),
      from: CEX,
      to: SUBJECT,
      amountRaw: "10",
      timestamp: "2026-07-23T12:00:00.000Z"
    })],
    dataset
  });
  const result = await scenario.run();
  expect(result.kind).toBe("checkpoint");
  if (result.kind !== "checkpoint") throw new Error("checkpoint expected");
  expect(result.orderedCommit?.discoveredTasks).toHaveLength(1);
  expect(scenario.createTaskId).toHaveBeenCalledTimes(1);
  expect([...scenario.artifacts.values()].some((artifact) =>
    (artifact as { version?: string }).version ===
      "unified-traversal-boundary-evidence-v2"
  )).toBe(false);
});

it("does not expose provider metadata to the V1 traversal path", async () => {
  const dataset = buildProductionFrozenLabelDataset({
    frozenAt: manifest.confirmedBlockTimestamp,
    snapshotHash: manifest.snapshotHash,
    legacyRows: []
  });
  const scenario = coordinatorHarness({
    manifest,
    directEvents: [event({
      hash: "e".repeat(64),
      from: CEX,
      to: SUBJECT,
      amountRaw: "10",
      timestamp: "2026-07-23T12:00:00.000Z"
    })],
    dataset
  });
  const result = await scenario.run();
  expect(result.kind).toBe("checkpoint");
  if (result.kind !== "checkpoint") throw new Error("checkpoint expected");
  expect(result.orderedCommit?.discoveredTasks).toHaveLength(1);
  expect(scenario.loadFrozenLabelDataset).not.toHaveBeenCalled();
  expect(scenario.createTaskId).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run coordinator and existing restart contracts**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/plannerRestart.postgres.test.ts
npm run typecheck
```

Expected: PASS. The existing Postgres restart case must still prove that a V2
terminal checkpoint is resumed without reopening `address_history`; it may use
only its existing explicit DB skip gate.

- [ ] **Step 5: Commit the integration proof**

```bash
git add tests/unified-check/productionTraversalCoordinator.test.ts
git commit -m "test(unified): prove provider cex boundary before history"
```

## Task 6: Resolve V2 service identities only from the frozen dataset

**Files:**

- Modify: `src/unifiedCheck/productionCompletion.ts`
- Modify: `src/unifiedCheck/productionFinalizer.ts`
- Modify: `tests/unified-check/productionCompletion.test.ts`
- Modify: `tests/unified-check/plannerReplay.property.test.ts`

- [ ] **Step 1: Refactor the completion fixture and write RED cases**

Import `buildUnifiedBranchInput`, the provider decoder, the production
frozen-label builder, and `FrozenLabelDatasetV1`. Add these complete helpers to
`productionCompletion.test.ts`:

```ts
function manifestV2(
  dataset: ReturnType<typeof buildProductionFrozenLabelDataset>
): AnalysisManifestV1 {
  const versions = {
    labelDatasetSha256: dataset.sha256,
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    traversalPolicyVersion: "snapshot-closure-v2" as const,
    runtimeCommit: "candidate",
    schemaVersion: 33
  };
  return {
    ...manifest,
    labelDatasetSha256: dataset.sha256,
    labelCatalogVersion: "unified-label-catalog-v1",
    boundaryPredicateVersion: "unified-boundary-predicates-v1",
    traversalPolicyVersion: "snapshot-closure-v2",
    branchArtifactHashes: Object.fromEntries(
      (["fast", "where", "deep"] as const).map((branchId) => [
        branchId,
        fingerprintCanonicalArtifact(buildUnifiedBranchInput(
          branchId,
          manifest.snapshotHash,
          versions
        ))
      ])
    ) as Record<"fast" | "where" | "deep", string>
  };
}

function providerDataset(input: {
  readonly entries: readonly {
    readonly address: string;
    readonly tag: "Bybit" | "Binance";
    readonly fetchedAt: string;
  }[];
  readonly legacyRows?: FrozenLabelDatasetV1["legacyRows"];
}) {
  const assertions = input.entries.map((entry) => {
    const decision = decideTronScanProviderServiceAssertion({
      metadata: {
        address: entry.address,
        source: "tronscan",
        name: null,
        tag: entry.tag,
        verified: false,
        rawJson: { address: entry.address, tag: entry.tag },
        fetchedAt: new Date(entry.fetchedAt),
        expiresAt: new Date("2026-07-23T14:00:00.000Z")
      },
      frozenAt: manifest.confirmedBlockTimestamp
    });
    if (!decision.accepted) {
      throw new Error(`accepted provider fixture expected:${decision.reason}`);
    }
    return decision.assertion;
  });
  return buildProductionFrozenLabelDataset({
    frozenAt: manifest.confirmedBlockTimestamp,
    snapshotHash: manifest.snapshotHash,
    legacyRows: input.legacyRows ?? [],
    providerAssertions: assertions
  });
}

function traversalFor(input: {
  readonly currentManifest: AnalysisManifestV1;
  readonly terminalAddress: string;
  readonly labels: readonly string[];
  readonly sourceEventIds: readonly string[];
}): UnifiedTraversalArtifactV1 {
  const currentState: TraversalStateV1 = {
    ...traversalState,
    address: input.terminalAddress,
    sourceEventIds: input.sourceEventIds
  };
  return {
    ...traversal,
    analysisManifestHash: fingerprintCanonicalArtifact(input.currentManifest),
    visitedStates: [currentState],
    terminalStates: [{
      ...traversal.terminalStates[0]!,
      stateId: traversalStateId(currentState),
      address: input.terminalAddress,
      labels: input.labels,
      sourceEventIds: input.sourceEventIds
    }]
  };
}

async function candidateFor(input: {
  readonly currentManifest: AnalysisManifestV1;
  readonly directEvents: readonly IndexedTronUsdtTransfer[];
  readonly currentTraversal: UnifiedTraversalArtifactV1;
  readonly labelDataset: unknown;
  readonly knownCounterparties?:
    ReadonlyMap<string, readonly string[]>;
}) {
  const knownCounterparties = input.knownCounterparties ?? new Map();
  const evidence = buildUnifiedProductionEvidence({
    subjectAddress: SUBJECT,
    snapshotBlock: input.currentManifest.confirmedBlockNumber,
    events: input.directEvents,
    knownCounterparties,
    hardEvidence: {},
    traversal: input.currentTraversal
  });
  const runners = {
    fast: runUnifiedFastBranch,
    where: runUnifiedWhereBranch,
    deep: runUnifiedDeepBranch
  };
  const branches = await Promise.all(
    (["fast", "where", "deep"] as const).map(async (branchId, index) => {
      const output = await runners[branchId]({
        context: {
          runId: input.currentManifest.runId,
          manifest: input.currentManifest,
          directHistoryArtifactSha256: "3".repeat(64),
          directEvents: input.directEvents,
          labelsDatasetSha256: input.currentManifest.labelDatasetSha256,
          deliveryAuthority: false
        },
        analyze: async () => evidence[branchId]
      });
      const outputHash = fingerprintCanonicalArtifact(output);
      const attempt: ChildAttemptArtifactV1 = {
        version: "child-attempt-artifact-v1",
        schemaVersion: 1,
        runId: input.currentManifest.runId,
        branchId,
        attemptId: `attempt-${branchId}`,
        previousAttemptHash: null,
        inputHash: input.currentManifest.branchArtifactHashes[branchId]!,
        outputHash,
        status: "COMPLETED",
        createdAt: `2026-07-23T13:01:0${index}.000Z`
      };
      return {
        branchId,
        output,
        outputHash,
        attempt,
        attemptHash: fingerprintCanonicalArtifact(attempt)
      };
    })
  );
  return buildUnifiedProductionCompletionCandidate({
    manifest: input.currentManifest,
    directEvents: input.directEvents,
    knownCounterparties,
    branches,
    traversal: input.currentTraversal,
    labelDataset: input.labelDataset
  });
}
```

Keep the existing V1 test, route its branch setup through `candidateFor`, and
pass `labelDataset: null`. Then add the V2 cases below.

1. V1 `["Bybit", "cex"]` still renders an indirect Bybit row.
2. V2 `cex:bybit` plus a matching event-time-valid frozen record renders Bybit.
3. A V2 terminal before `validFrom` rejects with
   `unified_production_v2_service_boundary_unbound`.
4. A direct V2 transfer inside the interval renders one direct Bybit row.
5. A direct transfer before `validFrom` renders no Bybit row.
6. A hint record never creates a direct or terminal service row.
7. Every accepted fixture remains `score: 0`, `decision: "ACCEPTABLE"` under
   `scoring-signal-matrix-v4`.

Use this terminal mapping/fail-closed test:

```ts
it("resolves a V2 terminal only through an event-valid frozen record", async () => {
  const dataset = providerDataset({ entries: [{
    address: UPSTREAM_CEX,
    tag: "Bybit",
    fetchedAt: "2026-07-23T11:00:00.000Z"
  }] });
  const currentManifest = manifestV2(dataset);
  const currentTraversal = traversalFor({
    currentManifest,
    terminalAddress: UPSTREAM_CEX,
    labels: ["cex:bybit"],
    sourceEventIds: [canonicalTronUsdtEventKey(event), "upstream-hop"]
  });
  const candidate = await candidateFor({
    currentManifest,
    directEvents: [event],
    currentTraversal,
    labelDataset: dataset.dataset
  });
  expect(candidate.dossier).toMatchObject({
    score: 0,
    decision: "ACCEPTABLE"
  });
  expect(candidate.dossier.sections.find((section) =>
    section.kind === "services_boundaries"
  )).toMatchObject({
    kind: "services_boundaries",
    rows: [{
      service: "Bybit",
      address: UPSTREAM_CEX,
      direction: "incoming",
      directness: "indirect"
    }]
  });

  const laterDataset = providerDataset({ entries: [{
    address: UPSTREAM_CEX,
    tag: "Bybit",
    fetchedAt: "2026-07-23T12:00:00.001Z"
  }] });
  const laterManifest = manifestV2(laterDataset);
  await expect(candidateFor({
    currentManifest: laterManifest,
    directEvents: [event],
    currentTraversal: traversalFor({
      currentManifest: laterManifest,
      terminalAddress: UPSTREAM_CEX,
      labels: ["cex:bybit"],
      sourceEventIds: [canonicalTronUsdtEventKey(event), "upstream-hop"]
    }),
    labelDataset: laterDataset.dataset
  })).rejects.toThrow("unified_production_v2_service_boundary_unbound");
});
```

Use this direct-link/deduplication test:

```ts
it("aggregates an event-valid direct V2 service exactly once", async () => {
  const directEvent = { ...event, fromAddress: UPSTREAM_CEX };
  const dataset = providerDataset({ entries: [{
    address: UPSTREAM_CEX,
    tag: "Bybit",
    fetchedAt: "2026-07-23T11:00:00.000Z"
  }] });
  const currentManifest = manifestV2(dataset);
  const candidate = await candidateFor({
    currentManifest,
    directEvents: [directEvent],
    currentTraversal: traversalFor({
      currentManifest,
      terminalAddress: UPSTREAM_CEX,
      labels: ["cex:bybit"],
      sourceEventIds: [canonicalTronUsdtEventKey(directEvent)]
    }),
    labelDataset: dataset.dataset
  });
  expect(candidate.dossier).toMatchObject({ score: 0, decision: "ACCEPTABLE" });
  expect(candidate.dossier.sections.find((section) =>
    section.kind === "services_boundaries"
  )).toMatchObject({
    kind: "services_boundaries",
    rows: [{
      service: "Bybit",
      address: UPSTREAM_CEX,
      direction: "incoming",
      directness: "direct",
      amount: {
        amountRaw: directEvent.amountRaw,
        denominatorRaw: directEvent.amountRaw
      },
      transferCount: 1
    }]
  });
});
```

Use this pre-valid/hint direct control; the valid Binance terminal keeps the
traversal artifact internally balanced while Bybit is tested only as a direct
relation:

```ts
it.each(["later_provider", "hint"] as const)(
  "does not promote a %s direct Bybit relation",
  async (kind) => {
    const directEvent = { ...event, fromAddress: UPSTREAM_CEX };
    const dataset = providerDataset({
      entries: [
        {
          address: SOURCE,
          tag: "Binance",
          fetchedAt: "2026-07-23T11:00:00.000Z"
        },
        ...(kind === "later_provider" ? [{
          address: UPSTREAM_CEX,
          tag: "Bybit" as const,
          fetchedAt: "2026-07-23T12:00:00.001Z"
        }] : [])
      ],
      legacyRows: kind === "hint" ? [{
        address: UPSTREAM_CEX,
        label: "Bybit",
        category: "cex",
        provider: "legacy-risk-context",
        observedAt: "2026-07-23T11:00:00.000Z"
      }] : []
    });
    const currentManifest = manifestV2(dataset);
    const candidate = await candidateFor({
      currentManifest,
      directEvents: [directEvent],
      currentTraversal: traversalFor({
        currentManifest,
        terminalAddress: SOURCE,
        labels: ["cex:binance"],
        sourceEventIds: [
          canonicalTronUsdtEventKey(directEvent),
          "upstream-hop"
        ]
      }),
      labelDataset: dataset.dataset
    });
    const services = candidate.dossier.sections.find((section) =>
      section.kind === "services_boundaries"
    );
    expect(services?.rows.some((row) =>
      "service" in row && row.service === "Bybit"
    )).toBe(false);
    expect(candidate.dossier).toMatchObject({
      score: 0,
      decision: "ACCEPTABLE"
    });
  }
);

it("fails closed when a persisted V2 terminal has only a hint", async () => {
  const dataset = providerDataset({
    entries: [],
    legacyRows: [{
      address: UPSTREAM_CEX,
      label: "Bybit",
      category: "cex",
      provider: "legacy-risk-context",
      observedAt: "2026-07-23T11:00:00.000Z"
    }]
  });
  const currentManifest = manifestV2(dataset);
  await expect(candidateFor({
    currentManifest,
    directEvents: [event],
    currentTraversal: traversalFor({
      currentManifest,
      terminalAddress: UPSTREAM_CEX,
      labels: ["cex:bybit"],
      sourceEventIds: [canonicalTronUsdtEventKey(event), "upstream-hop"]
    }),
    labelDataset: dataset.dataset
  })).rejects.toThrow("unified_production_v2_service_boundary_unbound");
});
```

- [ ] **Step 2: Prove completion RED**

```bash
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/productionCompletion.test.ts
```

Expected: the V2 cases fail because completion neither receives nor validates
the frozen dataset and legacy string parsing does not resolve `cex:bybit`.

- [ ] **Step 3: Pass and validate the manifest-bound dataset**

Add a mandatory raw input to `buildUnifiedProductionCompletionCandidate`:

```ts
readonly labelDataset: unknown;
```

At the beginning of completion, leave V1 unparsed and validate V2:

```ts
let frozenLabelDataset: FrozenLabelDatasetV1 | null = null;
if (input.manifest.traversalPolicyVersion === "snapshot-closure-v2") {
  const catalogVersion = input.manifest.labelCatalogVersion;
  const predicateVersion = input.manifest.boundaryPredicateVersion;
  if (catalogVersion === undefined || predicateVersion === undefined) {
    throw new Error("unified_v2_boundary_versions_missing");
  }
  frozenLabelDataset = validateFrozenLabelDatasetV1({
    dataset: input.labelDataset,
    expectedSha256: input.manifest.labelDatasetSha256,
    snapshotHash: input.manifest.snapshotHash,
    catalogVersion,
    boundaryPredicateVersion: predicateVersion
  });
}
```

Pass `frozenLabelDataset` into `metrics`. In `productionFinalizer.ts`, pass the
already loaded immutable row:

```ts
function metrics(input: {
  manifest: AnalysisManifestV1;
  events: readonly IndexedTronUsdtTransfer[];
  facts: readonly CanonicalFactInput[];
  matrixFacts: readonly ScoringFactV4[];
  finalFactIds: readonly string[];
  preferredFactId: string;
  matrixRow: string;
  score: number;
  knownCounterparties: ReadonlyMap<string, readonly string[]>;
  traversal: UnifiedTraversalArtifactV1;
  frozenLabelDataset: FrozenLabelDatasetV1 | null;
}): WalletMetrics
```

Add this property to the existing `metrics` call:

```ts
frozenLabelDataset,
```

In `productionFinalizer.ts`, pass the already loaded immutable row:

```ts
const candidate = buildUnifiedProductionCompletionCandidate({
  manifest,
  directEvents,
  knownCounterparties: knownCounterparties(branches),
  branches,
  traversal,
  labelDataset: labelDataset.dataset_json
});
```

Do not query `address_metadata` during finalization or restart.

Update the direct V1 completion call with:

```ts
labelDataset: null,
```

Update `plannerReplay.property.test.ts` with:

```ts
labelDataset: replayManifest.traversalPolicyVersion === "snapshot-closure-v2"
  ? EMPTY_FROZEN_LABEL_DATASET.dataset
  : null,
```

- [ ] **Step 4: Resolve V2 custodial identity through the shared resolver**

Add imports for `validateFrozenLabelDatasetV1`, `FrozenLabelDatasetV1`, and
`resolveFrozenLabelAtEventV1`. Add these complete helpers above `metrics`:

```ts
const LEGACY_SERVICE_CATEGORIES = new Set([
  "cex", "exchange", "trusted", "whitebit", "bridge"
]);
const LEGACY_SERVICE_NOISE = new Set([
  ...LEGACY_SERVICE_CATEGORIES,
  "hot_wallet", "router", "dex", "pool", "unknown"
]);

function legacyServiceIdentity(labels: readonly string[]): string | null {
  const category = labels.find((label) =>
    LEGACY_SERVICE_CATEGORIES.has(label)
  );
  if (category === undefined) return null;
  return labels.find((label) => !LEGACY_SERVICE_NOISE.has(label)) ?? category;
}

type ResolvedCustodialServiceV2 = {
  readonly catalogEntryId: string;
  readonly service: string;
};

function resolveV2CustodialService(input: {
  readonly dataset: FrozenLabelDatasetV1;
  readonly address: string;
  readonly eventTimestamp: string;
  readonly allowedCatalogEntryIds?: ReadonlySet<string>;
}): ResolvedCustodialServiceV2 | null {
  const matches = new Map<string, ResolvedCustodialServiceV2>();
  for (const label of input.dataset.labels) {
    if (
      label.address !== input.address ||
      (
        input.allowedCatalogEntryIds !== undefined &&
        !input.allowedCatalogEntryIds.has(label.catalogEntryId)
      )
    ) continue;
    const resolution = resolveFrozenLabelAtEventV1({
      label,
      eventTimestamp: input.eventTimestamp
    });
    if (
      resolution.kind !== "eligible" ||
      resolution.entry.category !== "cex" ||
      resolution.entry.terminalPolicy !== "custodial_boundary"
    ) continue;
    matches.set(resolution.entry.id, {
      catalogEntryId: resolution.entry.id,
      service: resolution.entry.identity
    });
  }
  if (matches.size > 1) {
    throw new Error("unified_production_v2_service_boundary_ambiguous");
  }
  return matches.values().next().value ?? null;
}
```

Use `legacyServiceIdentity` only in the V1 branches. V2 must not use the flat
`knownCounterparties` map as service authority.

- [ ] **Step 5: Aggregate direct V2 links event by event**

Add this helper:

```ts
function v2DirectServiceLinks(input: {
  readonly subject: string;
  readonly events: readonly IndexedTronUsdtTransfer[];
  readonly dataset: FrozenLabelDatasetV1;
  readonly incomingDenominatorRaw: bigint;
  readonly outgoingDenominatorRaw: bigint;
  readonly factIdOf: (event: IndexedTronUsdtTransfer) => string;
}): WalletMetrics["serviceLinks"] {
  const groups = new Map<string, {
    service: string;
    address: string;
    direction: "incoming" | "outgoing";
    amountRaw: bigint;
    transferCount: number;
    factIds: Set<string>;
  }>();
  for (const event of input.events) {
    const directions = [
      {
        direction: "incoming" as const,
        applies: isSubject(event.toAddress, input.subject),
        address: event.fromAddress
      },
      {
        direction: "outgoing" as const,
        applies: isSubject(event.fromAddress, input.subject),
        address: event.toAddress
      }
    ];
    for (const direction of directions) {
      if (!direction.applies) continue;
      const resolved = resolveV2CustodialService({
        dataset: input.dataset,
        address: direction.address,
        eventTimestamp: event.blockTimestamp.toISOString()
      });
      if (resolved === null) continue;
      const key = JSON.stringify([
        direction.direction,
        direction.address,
        resolved.catalogEntryId
      ]);
      const group = groups.get(key) ?? {
        service: resolved.service,
        address: direction.address,
        direction: direction.direction,
        amountRaw: 0n,
        transferCount: 0,
        factIds: new Set<string>()
      };
      group.amountRaw += BigInt(event.amountRaw);
      group.transferCount += 1;
      group.factIds.add(input.factIdOf(event));
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => ({
      service: group.service,
      address: group.address,
      direction: group.direction,
      directness: "direct" as const,
      amountRaw: group.amountRaw.toString(),
      denominatorRaw: (
        group.direction === "incoming"
          ? input.incomingDenominatorRaw
          : input.outgoingDenominatorRaw
      ).toString(),
      transferCount: group.transferCount,
      factIds: [...group.factIds].sort()
    }));
}
```

Replace the current direct-service loop with this policy split:

```ts
if (input.frozenLabelDataset === null) {
  for (const [direction, rows, denominator] of [
    ["incoming", incomingRows, incomingRaw],
    ["outgoing", outgoingRows, outgoingRaw]
  ] as const) {
    for (const row of rows) {
      const service = legacyServiceIdentity(
        input.knownCounterparties.get(row.key) ?? []
      );
      if (service === null) continue;
      serviceLinks.push({
        service,
        address: row.key,
        direction,
        directness: "direct",
        amountRaw: row.amountRaw,
        denominatorRaw: denominator.toString(),
        transferCount: row.transferCount,
        factIds: [...new Set([
          ...row.factIds,
          ...(serviceFactIdsByCounterparty.get(row.key) ?? [])
        ])].sort()
      });
    }
  }
} else {
  serviceLinks.push(...v2DirectServiceLinks({
    subject,
    events: input.events,
    dataset: input.frozenLabelDataset,
    incomingDenominatorRaw: incomingRaw,
    outgoingDenominatorRaw: outgoingRaw,
    factIdOf
  }));
}
```

Never add V2 frozen labels into `knownCounterparties`.

- [ ] **Step 6: Resolve terminals fail closed and preserve directness**

Add beside `eventKey`:

```ts
function terminalDirectness(
  sourceEventIds: readonly string[],
  directEventIds: ReadonlySet<string>
): "direct" | "indirect" {
  return sourceEventIds.length > 0 &&
      sourceEventIds.every((id) => directEventIds.has(id))
    ? "direct"
    : "indirect";
}
```

Create `directEventIds` from `input.events`. For V2 terminals, use the
calculated directness both in the traversal fact key and the service row, then
call the resolver with the terminal address, `terminal.anchorTimestamp`, and
`new Set(terminal.labels)`. A missing match must throw:

```ts
throw new Error("unified_production_v2_service_boundary_unbound");
```

When a direct V2 terminal matches an already aggregated direct service row,
merge only its traversal `factIds`; do not add its amount or transfer count a
second time. Indirect terminals remain separate rows. V1 retains its existing
hard-coded indirect terminal presentation path and therefore its output bytes.

Replace the current terminal loop with:

```ts
const directEventIds = new Set(input.events.map(eventKey));
for (const terminal of input.traversal.terminalStates) {
  if (terminal.reason !== "identified_service_boundary") continue;
  const direction = terminal.direction === "backward"
    ? "incoming"
    : "outgoing";
  const denominatorRaw = terminal.direction === "backward"
    ? input.traversal.backwardCoverage.selectedAmountRaw
    : input.traversal.forwardCoverage.selectedAmountRaw;

  let service: string | null;
  let directness: "direct" | "indirect";
  if (input.frozenLabelDataset === null) {
    service = legacyServiceIdentity(terminal.labels);
    directness = "indirect";
  } else {
    const resolved = resolveV2CustodialService({
      dataset: input.frozenLabelDataset,
      address: terminal.address,
      eventTimestamp: terminal.anchorTimestamp,
      allowedCatalogEntryIds: new Set(terminal.labels)
    });
    if (resolved === null) {
      throw new Error("unified_production_v2_service_boundary_unbound");
    }
    service = resolved.service;
    directness = terminalDirectness(
      terminal.sourceEventIds,
      directEventIds
    );
  }
  if (service === null) continue;
  const serviceIdentity = service;
  const factKey = JSON.stringify([
    terminal.reason,
    terminal.address,
    directness,
    terminal.anchorTimestamp
  ]);
  const factIds = traversalFactIds.get(factKey) ?? [];
  if (factIds.length === 0) continue;

  const existingDirect = input.frozenLabelDataset !== null &&
      directness === "direct"
    ? serviceLinks.find((link) =>
        link.service === serviceIdentity &&
        link.address === terminal.address &&
        link.direction === direction &&
        link.directness === "direct"
      )
    : undefined;
  if (existingDirect !== undefined) {
    existingDirect.factIds = [...new Set([
      ...existingDirect.factIds,
      ...factIds
    ])].sort();
    continue;
  }
  serviceLinks.push({
    service: serviceIdentity,
    address: terminal.address,
    direction,
    directness,
    amountRaw: terminal.amountRaw,
    denominatorRaw,
    transferCount: new Set(terminal.sourceEventIds).size,
    factIds
  });
}
```

- [ ] **Step 7: Add manifest binding coverage**

Append this completion test. Because the completion input is mandatory, the
existing finalizer call cannot compile until it passes its already-loaded DB
row; this unit case proves that mutable/tampered content is then rejected:

```ts
it("rejects a V2 label dataset outside the manifest hash binding", async () => {
  const dataset = providerDataset({ entries: [{
    address: UPSTREAM_CEX,
    tag: "Bybit",
    fetchedAt: "2026-07-23T11:00:00.000Z"
  }] });
  const currentManifest = manifestV2(dataset);
  await expect(candidateFor({
    currentManifest,
    directEvents: [event],
    currentTraversal: traversalFor({
      currentManifest,
      terminalAddress: UPSTREAM_CEX,
      labels: ["cex:bybit"],
      sourceEventIds: [canonicalTronUsdtEventKey(event), "upstream-hop"]
    }),
    labelDataset: {
      ...dataset.dataset,
      frozenAt: "2026-07-23T12:59:59.999Z"
    }
  })).rejects.toThrow("unified_frozen_label_dataset_hash_mismatch");
});
```

- [ ] **Step 8: Verify and commit**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/unified-check/labelCatalog.test.ts tests/unified-check/boundaryPredicates.test.ts tests/unified-check/productionCompletion.test.ts tests/unified-check/productionFinalizer.postgres.test.ts tests/unified-check/plannerReplay.property.test.ts tests/unified-check/productionEvidence.test.ts tests/unified-check/report.test.ts tests/risk/scoringSignalMatrixV4.test.ts
npm run typecheck
git add src/unifiedCheck/productionCompletion.ts src/unifiedCheck/productionFinalizer.ts tests/unified-check/productionCompletion.test.ts tests/unified-check/plannerReplay.property.test.ts
git commit -m "fix(unified): resolve v2 service links from frozen labels"
```

## Task 7: Update product truth and run Phase A acceptance

**Files:**

- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/09-current-decisions.md`

- [ ] **Step 1: Document source, temporal, and diagnostic semantics**

Add to the frozen-label section of
`docs/knowledge/04-data-sources-tronscan-indexing.md`:

```markdown
For each new `snapshot-closure-v2` run, freeze reads fresh `address_metadata`
rows directly at the confirmed snapshot time. Only a canonical TRON address
whose TronScan `tag` exactly matches both `raw_json.address`/`raw_json.tag` and
the versioned full-value CEX matcher can become a `verified_provider` record.
`name`, `verified`, flat labels, classifier output, generic exchange text, and
substring matches never grant authority. Provider validity begins at
`fetched_at`; `expires_at` controls cache freshness at freeze and is not a
historical ownership end. A current tag is never backdated to an earlier route
event. Existing runs use their persisted dataset, and V1 does not query or
freeze these provider records. Count-only freeze diagnostics expose candidates,
accepted rows, and rejection reasons without addresses or raw payloads.
```

- [ ] **Step 2: Record the current policy and unchanged surfaces**

Add beside the current V2 boundary decision in
`docs/knowledge/09-current-decisions.md`:

```markdown
- New V2 freezes may derive `tronscan-address-tag-observation-v1` records from
  fresh `address_metadata` through `unified-tronscan-cex-tag-map-v1`. The
  source hash binds raw provider payload, exact tag, catalog identity,
  fetch/expiry times, and matcher version. `validFrom = fetchedAt` and
  `validTo = null`; current tags are never applied to earlier events.
- Completion resolves V2 service identity only from the run-bound frozen
  dataset at the direct-transfer or terminal anchor timestamp. Direct V2 links
  are aggregated event by event; V1 retains its legacy string fallback.
  Service identity remains contextual presentation data and does not change
  `scoring-signal-matrix-v4`, coverage, or delivery authority.
```

- [ ] **Step 3: Run targeted Phase A acceptance**

```bash
npx vitest run --configLoader bundle --no-file-parallelism --testTimeout=300000 --hookTimeout=300000 tests/unified-check/providerReplay.test.ts tests/unified-check/providerServiceBindings.test.ts tests/unified-check/labelCatalog.test.ts tests/unified-check/boundaryPredicates.test.ts tests/unified-check/frozenLabels.test.ts tests/unified-check/productionLabelFreeze.test.ts tests/unified-check/productionBoundary.test.ts tests/unified-check/productionTraversalCoordinator.test.ts tests/unified-check/requestService.test.ts tests/unified-check/requestService.postgres.test.ts tests/unified-check/canary.test.ts tests/unified-check/canary.postgres.test.ts tests/unified-check/productionCompletion.test.ts tests/unified-check/productionFinalizer.postgres.test.ts tests/unified-check/plannerReplay.property.test.ts tests/unified-check/productionEvidence.test.ts tests/unified-check/report.test.ts tests/storage/repositories.test.ts tests/scripts/runUnifiedAdaptiveBenchmark.test.ts tests/risk/scoringSignalMatrixV4.test.ts
npm run typecheck
```

Expected: PASS. PostgreSQL tests may use only their existing explicit skip
gate; record skipped DB proofs in the handoff rather than calling them passed.

- [ ] **Step 4: Run the full regression and forbidden-diff audit**

```bash
npm test
git diff --check
git diff --stat f335c227...HEAD
git diff f335c227...HEAD -- src/risk src/unifiedCheck/contracts.ts migrations
```

Expected:

- zero failed tests;
- no whitespace errors;
- no file under `src/risk` changed;
- `src/unifiedCheck/contracts.ts` unchanged;
- no migration changed;
- no default traversal policy or delivery setting changed.

- [ ] **Step 5: Commit product truth**

```bash
git add docs/knowledge/04-data-sources-tronscan-indexing.md docs/knowledge/09-current-decisions.md
git commit -m "docs: record authoritative v2 provider boundaries"
```

## Final acceptance checklist

- [ ] Exact full-value TronScan tags produce `verified_provider` CEX records.
- [ ] `name`, `verified`, flat/cache labels, substrings, stale rows, malformed
      raw payloads, and post-snapshot observations remain nonterminal.
- [ ] `validFrom` is exactly `fetchedAt`; current tags never backdate history.
- [ ] New V1 runs neither query `address_metadata` nor change dataset SHA.
- [ ] Existing runs never reread mutable metadata.
- [ ] Verify20/drainer, approval, blacklist, and sanctions facts remain
      independent and are neither skipped nor promoted to service authority.
- [ ] V2 commits an accepted CEX boundary before planning address history.
- [ ] Restart reuses the persisted terminal and frozen dataset.
- [ ] Completion validates the manifest-bound dataset, resolves `cex:bybit`,
      and keeps event-time-valid direct and indirect facts distinct.
- [ ] Service identity adds zero AML points and does not alter matrix-v4.
- [ ] Diagnostics contain counts/reasons but no wallet address or raw payload.
- [ ] Isolated canary remains delivery-disabled.
- [ ] Full test suite and typecheck pass from the clean worktree.
