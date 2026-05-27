# Where Is Money Hybrid Corridor Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `Where is money?` from a narrow balance-origin trace into a hybrid corridor research mode that combines balance-forming provenance, fast checks, deep interaction exposure, provider tags, and exact approval-drain evidence.

**Architecture:** Keep the existing balance-forming selector and origin tracer, then add a corridor layer around the checked wallet, selected senders, upstream funding actors, and dense counterparties. The corridor layer parses provider tags from live TronScan transfer rows, computes tagged service exposure, reuses the existing approval-drain provenance detector, and feeds a single policy composer that returns `ACCEPTABLE`, `REVIEW`, or `DECLINE`.

**Tech Stack:** TypeScript, Node.js, Vitest, existing `TronscanClient`, `normalizeTransfer`, `buildApprovalDrainProvenanceProfile`, `runWhereIsMoneyCheck`, and offline CLI `scripts/forensicWhereIsMoney.ts`.

---

## File Structure

Create:

- `src/forensics/moneyOriginCorridorExposure.ts`
  - Builds corridor actor exposure profiles from related USDT transfer edges.
  - Parses provider tag evidence already carried on edges.
  - Computes direct HTX/Huobi/WhiteBIT, allowlisted CEX, and bridge/router/DEX exposure.
  - Produces behavior hints such as `single_use_transit`, `dense_exchange_like`, and `fast_forwarding`.

- `src/forensics/moneyOriginCorridorPolicy.ts`
  - Converts origin paths, corridor exposure, approval-drain profiles, and fast wallet risk into one `ExchangeDecision`.
  - Owns the hybrid corridor rule: direct HTX/Huobi/WhiteBIT in corridor is `DECLINE / HIGH`.
  - Owns the approval-drain rule: exact approval-drain provenance in corridor is `DECLINE / CRITICAL`.

- `tests/forensics/moneyOriginCorridorExposure.test.ts`
- `tests/forensics/moneyOriginCorridorPolicy.test.ts`

Modify:

- `src/types.ts`
  - Add optional provider tag fields on `ForensicRouteEdge`.
  - Add corridor exposure and approval-drain report types to `WhereIsMoneyReport`.

- `src/parser/transactionParser.ts`
  - Add typed TronScan provider tag fields to `RawTronscanTrc20Transfer`.

- `src/forensics/routeSearch.ts`
  - Preserve provider tags in `normalizeTransfer`.

- `src/forensics/localTronUsdtIndex.ts`
  - Set provider tag fields to `null` when converting indexed transfers.

- `src/check/whereIsMoneyCheck.ts`
  - Add deps for approval-drain lookups.
  - Build the corridor actor set and edge set.
  - Run corridor exposure and approval-drain scans.
  - Compose the final decision through `moneyOriginCorridorPolicy.ts`.

- `scripts/forensicWhereIsMoney.ts`
  - Use live transfer fallback when local indexed data is empty or sparse.
  - Pass approval-drain deps to `runWhereIsMoneyCheck`.
  - Print corridor exposures and approval-drain evidence.

Test:

- Existing where-is-money tests.
- Existing approval-drain provenance tests.
- Full `npm test`.
- CLI smoke on `TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf`.

---

### Task 1: Preserve TronScan Provider Tags On Transfer Edges

**Files:**
- Modify: `src/parser/transactionParser.ts`
- Modify: `src/types.ts`
- Modify: `src/forensics/routeSearch.ts`
- Modify: `src/forensics/localTronUsdtIndex.ts`
- Test: `tests/forensics/routeSearchProviderTags.test.ts`

- [ ] **Step 1: Write the failing provider-tag test**

Create `tests/forensics/routeSearchProviderTags.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeTransfer } from "../../src/forensics/routeSearch";
import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../../src/parser/transactionParser";

function transfer(overrides: Partial<RawTronscanTrc20Transfer> = {}): RawTronscanTrc20Transfer {
  return {
    transaction_id: "tx-whitebit",
    from_address: "TWhiteBIT11111111111111111111111111",
    to_address: "TSubject111111111111111111111111111111",
    quant: "15000000",
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    confirmed: true,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    tokenInfo: {
      tokenId: TRON_USDT_CONTRACT_ADDRESS,
      tokenAbbr: "USDT",
      tokenDecimal: 6,
      tokenType: "trc20"
    },
    from_address_tag: {
      from_address_tag: "WhiteBIT",
      from_address_tag_logo: ""
    },
    to_address_tag: {
      to_address_tag_logo: ""
    },
    block_ts: Date.parse("2026-05-16T10:41:00.000Z"),
    ...overrides
  };
}

describe("normalizeTransfer provider tags", () => {
  it("preserves from and to address tags from TronScan transfer rows", () => {
    const edge = normalizeTransfer(transfer({
      to_address_tag: {
        to_address_tag: "HTX",
        to_address_tag_logo: ""
      }
    }));

    expect(edge).toMatchObject({
      txHash: "tx-whitebit",
      fromAddressTag: "WhiteBIT",
      toAddressTag: "HTX"
    });
  });

  it("normalizes missing provider tags to null", () => {
    const edge = normalizeTransfer(transfer({
      from_address_tag: undefined,
      to_address_tag: undefined
    }));

    expect(edge).toMatchObject({
      fromAddressTag: null,
      toAddressTag: null
    });
  });
});
```

- [ ] **Step 2: Run the provider-tag test RED**

Run:

```bash
npm test -- tests/forensics/routeSearchProviderTags.test.ts
```

Expected: FAIL because `ForensicRouteEdge` does not include `fromAddressTag` and `toAddressTag`.

- [ ] **Step 3: Add transfer tag types**

Modify `src/parser/transactionParser.ts` inside `RawTronscanTrc20Transfer`:

```ts
  from_address_tag?: {
    from_address_tag?: string;
    from_address_tag_logo?: string;
  };
  to_address_tag?: {
    to_address_tag?: string;
    to_address_tag_logo?: string;
  };
```

Modify `src/types.ts` inside `ForensicRouteEdge`:

```ts
  fromAddressTag?: string | null;
  toAddressTag?: string | null;
```

- [ ] **Step 4: Preserve tags in `normalizeTransfer`**

Modify `src/forensics/routeSearch.ts` near `stringField`:

```ts
function providerTagLabel(value: unknown, key: "from_address_tag" | "to_address_tag"): string | null {
  if (!isObjectRecord(value)) return null;
  return stringField(value[key]);
}
```

Modify the return object in `normalizeTransfer`:

```ts
    fromAddressTag: providerTagLabel(transfer.from_address_tag, "from_address_tag"),
    toAddressTag: providerTagLabel(transfer.to_address_tag, "to_address_tag")
```

Modify `src/forensics/localTronUsdtIndex.ts` in `indexedTransferToRouteEdge`:

```ts
    fromAddressTag: null,
    toAddressTag: null
```

- [ ] **Step 5: Run provider-tag tests GREEN**

Run:

```bash
npm test -- tests/forensics/routeSearchProviderTags.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit provider tags**

```bash
git add src/parser/transactionParser.ts src/types.ts src/forensics/routeSearch.ts src/forensics/localTronUsdtIndex.ts tests/forensics/routeSearchProviderTags.test.ts
git commit -m "feat: preserve tronscan provider tags on usdt edges"
```

---

### Task 2: Build Corridor Actor Exposure Profiles

**Files:**
- Create: `src/forensics/moneyOriginCorridorExposure.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/moneyOriginCorridorExposure.test.ts`

- [ ] **Step 1: Write failing corridor exposure tests**

Create `tests/forensics/moneyOriginCorridorExposure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMoneyOriginCorridorExposure } from "../../src/forensics/moneyOriginCorridorExposure";
import type { ForensicRouteEdge, MoneyOriginCorridorActor } from "../../src/types";

const checked = "TChecked11111111111111111111111111111";
const sender = "TSender11111111111111111111111111111";
const upstream = "TUpstream111111111111111111111111111";
const whitebit = "TWhiteBIT11111111111111111111111111";
const binance = "TBinance111111111111111111111111111";
const bybit = "TBybit11111111111111111111111111111";

function edge(input: {
  id: string;
  from: string;
  to: string;
  amountRaw: string;
  at: string;
  fromTag?: string | null;
  toTag?: string | null;
}): ForensicRouteEdge {
  return {
    id: input.id,
    txHash: input.id,
    fromAddress: input.from,
    toAddress: input.to,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.at),
    method: "transfer",
    edgeType: "normal_transfer",
    fromAddressTag: input.fromTag ?? null,
    toAddressTag: input.toTag ?? null
  };
}

function actor(address: string, role: MoneyOriginCorridorActor["role"], distance: number): MoneyOriginCorridorActor {
  return { address, role, distanceFromBalancePath: distance };
}

describe("buildMoneyOriginCorridorExposure", () => {
  it("classifies direct WhiteBIT exposure as corridor decline exposure", () => {
    const exposures = buildMoneyOriginCorridorExposure({
      actors: [actor(sender, "balance_sender", 0), actor(upstream, "funding_actor", 1)],
      edgesByAddress: new Map([
        [sender, [
          edge({ id: "tx-whitebit", from: whitebit, to: sender, amountRaw: "15000000", at: "2026-05-01T00:00:00.000Z", fromTag: "WhiteBIT" }),
          edge({ id: "tx-subject", from: sender, to: checked, amountRaw: "1123000000", at: "2026-05-16T10:41:00.000Z" })
        ]],
        [upstream, []]
      ])
    });

    expect(exposures[0]).toMatchObject({
      address: sender,
      role: "balance_sender",
      serviceExposure: {
        whitebitVolumeRaw: "15000000",
        htxHuobiVolumeRaw: "0",
        allowlistedCexVolumeRaw: "0",
        bridgeDexRouterVolumeRaw: "0"
      }
    });
    expect(exposures[0].taggedInteractions).toEqual([
      expect.objectContaining({
        txHash: "tx-whitebit",
        direction: "incoming",
        counterpartyAddress: whitebit,
        counterpartyTag: "WhiteBIT",
        serviceFamily: "whitebit"
      })
    ]);
  });

  it("marks dense exchange-like actors without declining on allowlisted CEX only", () => {
    const exposures = buildMoneyOriginCorridorExposure({
      actors: [actor(upstream, "funding_actor", 1)],
      edgesByAddress: new Map([[upstream, [
        edge({ id: "tx-bybit", from: bybit, to: upstream, amountRaw: "22700000000", at: "2026-05-14T12:00:00.000Z", fromTag: "Bybit" }),
        edge({ id: "tx-binance", from: binance, to: upstream, amountRaw: "4499700000", at: "2026-05-15T12:00:00.000Z", fromTag: "Binance-Hot 7" }),
        edge({ id: "tx-out-1", from: upstream, to: "TOut111111111111111111111111111111", amountRaw: "4739000000", at: "2026-05-16T12:00:00.000Z" }),
        edge({ id: "tx-out-2", from: upstream, to: "TOut222222222222222222222222222222", amountRaw: "500000000", at: "2026-05-16T13:00:00.000Z" })
      ]]])
    });

    expect(exposures[0].serviceExposure).toMatchObject({
      allowlistedCexVolumeRaw: "27199700000",
      whitebitVolumeRaw: "0"
    });
    expect(exposures[0].behaviorHints).toContain("dense_exchange_like");
  });
});
```

- [ ] **Step 2: Run corridor exposure tests RED**

Run:

```bash
npm test -- tests/forensics/moneyOriginCorridorExposure.test.ts
```

Expected: FAIL because `moneyOriginCorridorExposure.ts` and corridor types do not exist.

- [ ] **Step 3: Add corridor exposure types**

Add to `src/types.ts` near the existing money-origin types:

```ts
export type MoneyOriginCorridorActorRole =
  | "checked_wallet"
  | "balance_sender"
  | "funding_actor"
  | "dense_counterparty";

export type MoneyOriginCorridorActor = {
  address: string;
  role: MoneyOriginCorridorActorRole;
  distanceFromBalancePath: number;
};

export type MoneyOriginServiceFamily =
  | "allowlisted_cex"
  | "htx_huobi"
  | "whitebit"
  | "bridge_router_dex"
  | "unknown_service";

export type MoneyOriginTaggedInteraction = {
  txHash: string;
  direction: "incoming" | "outgoing";
  counterpartyAddress: string;
  counterpartyTag: string;
  serviceFamily: MoneyOriginServiceFamily;
  amountRaw: string;
  timestamp: string;
  distanceFromBalancePath: number;
};

export type MoneyOriginServiceExposure = {
  htxHuobiVolumeRaw: string;
  whitebitVolumeRaw: string;
  allowlistedCexVolumeRaw: string;
  bridgeDexRouterVolumeRaw: string;
};

export type MoneyOriginBehaviorHint =
  | "single_use_transit"
  | "dense_exchange_like"
  | "fan_in_fan_out"
  | "fast_forwarding"
  | "old_unrelated_activity";

export type MoneyOriginCorridorExposure = {
  address: string;
  role: MoneyOriginCorridorActorRole;
  distanceFromBalancePath: number;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  incomingTxCount: number;
  outgoingTxCount: number;
  topIncomingCounterparties: MoneyOriginCounterpartySummary[];
  topOutgoingCounterparties: MoneyOriginCounterpartySummary[];
  taggedInteractions: MoneyOriginTaggedInteraction[];
  serviceExposure: MoneyOriginServiceExposure;
  approvalDrainProvenance: ApprovalDrainProvenanceProfile | null;
  behaviorHints: MoneyOriginBehaviorHint[];
};
```

- [ ] **Step 4: Implement corridor exposure builder**

Create `src/forensics/moneyOriginCorridorExposure.ts`:

```ts
import type {
  ForensicRouteEdge,
  MoneyOriginBehaviorHint,
  MoneyOriginCorridorActor,
  MoneyOriginCorridorExposure,
  MoneyOriginCounterpartySummary,
  MoneyOriginServiceFamily,
  MoneyOriginServiceExposure,
  MoneyOriginTaggedInteraction
} from "../types";

type BuildMoneyOriginCorridorExposureInput = {
  actors: MoneyOriginCorridorActor[];
  edgesByAddress: Map<string, ForensicRouteEdge[]>;
};

const ALLOWLIST_CEX = ["binance", "bybit", "okx", "coinbase", "kraken", "kucoin", "gate", "bitget", "mexc", "bitstamp", "crypto.com", "cryptocom"];

function parseAmount(value: string): bigint {
  return /^\\d+$/.test(value) ? BigInt(value) : 0n;
}

function sumRaw(edges: ForensicRouteEdge[]): string {
  return edges.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n).toString();
}

function normalizeTag(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\\s:_-]+/g, " ").trim();
}

function serviceFamilyFromTag(tag: string | null | undefined): MoneyOriginServiceFamily | null {
  const text = normalizeTag(tag);
  if (!text) return null;
  if (text.includes("whitebit")) return "whitebit";
  if (text.includes("htx") || text.includes("huobi")) return "htx_huobi";
  if (text.includes("bridge") || text.includes("router") || text.includes("dex") || text.includes("swap")) return "bridge_router_dex";
  if (ALLOWLIST_CEX.some((identity) => text.includes(identity))) return "allowlisted_cex";
  return "unknown_service";
}

function compareBigintDesc(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function buildCounterpartySummaries(input: {
  actor: MoneyOriginCorridorActor;
  edges: ForensicRouteEdge[];
  direction: "incoming" | "outgoing";
}): MoneyOriginCounterpartySummary[] {
  const byAddress = new Map<string, {
    address: string;
    volumeRaw: bigint;
    txCount: number;
    firstSeen: Date;
    lastSeen: Date;
    txHashes: string[];
  }>();

  for (const edge of input.edges) {
    const matches = input.direction === "incoming"
      ? edge.toAddress === input.actor.address
      : edge.fromAddress === input.actor.address;
    if (!matches) continue;

    const counterparty = input.direction === "incoming" ? edge.fromAddress : edge.toAddress;
    const current = byAddress.get(counterparty) ?? {
      address: counterparty,
      volumeRaw: 0n,
      txCount: 0,
      firstSeen: edge.timestamp,
      lastSeen: edge.timestamp,
      txHashes: []
    };
    current.volumeRaw += parseAmount(edge.amountRaw);
    current.txCount += 1;
    if (edge.timestamp < current.firstSeen) current.firstSeen = edge.timestamp;
    if (edge.timestamp > current.lastSeen) current.lastSeen = edge.timestamp;
    if (!current.txHashes.includes(edge.txHash) && current.txHashes.length < 5) current.txHashes.push(edge.txHash);
    byAddress.set(counterparty, current);
  }

  return [...byAddress.values()]
    .sort((left, right) =>
      compareBigintDesc(left.volumeRaw, right.volumeRaw) ||
      right.lastSeen.getTime() - left.lastSeen.getTime() ||
      left.address.localeCompare(right.address)
    )
    .slice(0, 8)
    .map((item) => ({
      address: item.address,
      direction: input.direction,
      volumeRaw: item.volumeRaw.toString(),
      txCount: item.txCount,
      firstSeen: item.firstSeen.toISOString(),
      lastSeen: item.lastSeen.toISOString(),
      txHashes: item.txHashes
    }));
}

function taggedInteractions(actor: MoneyOriginCorridorActor, edges: ForensicRouteEdge[]): MoneyOriginTaggedInteraction[] {
  return edges.flatMap((edge): MoneyOriginTaggedInteraction[] => {
    const interactions: MoneyOriginTaggedInteraction[] = [];
    if (edge.toAddress === actor.address) {
      const family = serviceFamilyFromTag(edge.fromAddressTag);
      if (family) {
        interactions.push({
          txHash: edge.txHash,
          direction: "incoming",
          counterpartyAddress: edge.fromAddress,
          counterpartyTag: edge.fromAddressTag ?? "unknown",
          serviceFamily: family,
          amountRaw: edge.amountRaw,
          timestamp: edge.timestamp.toISOString(),
          distanceFromBalancePath: actor.distanceFromBalancePath
        });
      }
    }
    if (edge.fromAddress === actor.address) {
      const family = serviceFamilyFromTag(edge.toAddressTag);
      if (family) {
        interactions.push({
          txHash: edge.txHash,
          direction: "outgoing",
          counterpartyAddress: edge.toAddress,
          counterpartyTag: edge.toAddressTag ?? "unknown",
          serviceFamily: family,
          amountRaw: edge.amountRaw,
          timestamp: edge.timestamp.toISOString(),
          distanceFromBalancePath: actor.distanceFromBalancePath
        });
      }
    }
    return interactions;
  });
}

function exposureTotals(interactions: MoneyOriginTaggedInteraction[]): MoneyOriginServiceExposure {
  const total = (family: MoneyOriginServiceFamily) =>
    interactions
      .filter((interaction) => interaction.serviceFamily === family)
      .reduce((sum, interaction) => sum + parseAmount(interaction.amountRaw), 0n)
      .toString();

  return {
    htxHuobiVolumeRaw: total("htx_huobi"),
    whitebitVolumeRaw: total("whitebit"),
    allowlistedCexVolumeRaw: total("allowlisted_cex"),
    bridgeDexRouterVolumeRaw: total("bridge_router_dex")
  };
}

function behaviorHints(input: {
  incomingTxCount: number;
  outgoingTxCount: number;
  tagged: MoneyOriginTaggedInteraction[];
}): MoneyOriginBehaviorHint[] {
  const hints: MoneyOriginBehaviorHint[] = [];
  if (input.incomingTxCount === 1 && input.outgoingTxCount === 1) hints.push("single_use_transit");
  if (input.incomingTxCount >= 10 || input.outgoingTxCount >= 10) hints.push("dense_exchange_like");
  if (input.incomingTxCount >= 3 && input.outgoingTxCount >= 3) hints.push("fan_in_fan_out");
  if (input.tagged.filter((tag) => tag.serviceFamily === "allowlisted_cex").length >= 2) hints.push("dense_exchange_like");
  return [...new Set(hints)];
}

export function buildMoneyOriginCorridorExposure(input: BuildMoneyOriginCorridorExposureInput): MoneyOriginCorridorExposure[] {
  return input.actors.map((actor) => {
    const edges = input.edgesByAddress.get(actor.address) ?? [];
    const incoming = edges.filter((edge) => edge.toAddress === actor.address);
    const outgoing = edges.filter((edge) => edge.fromAddress === actor.address);
    const tagged = taggedInteractions(actor, edges);

    return {
      address: actor.address,
      role: actor.role,
      distanceFromBalancePath: actor.distanceFromBalancePath,
      incomingVolumeRaw: sumRaw(incoming),
      outgoingVolumeRaw: sumRaw(outgoing),
      incomingTxCount: incoming.length,
      outgoingTxCount: outgoing.length,
      topIncomingCounterparties: buildCounterpartySummaries({ actor, edges, direction: "incoming" }),
      topOutgoingCounterparties: buildCounterpartySummaries({ actor, edges, direction: "outgoing" }),
      taggedInteractions: tagged,
      serviceExposure: exposureTotals(tagged),
      approvalDrainProvenance: null,
      behaviorHints: behaviorHints({
        incomingTxCount: incoming.length,
        outgoingTxCount: outgoing.length,
        tagged
      })
    };
  });
}
```

- [ ] **Step 5: Run corridor exposure tests GREEN**

Run:

```bash
npm test -- tests/forensics/moneyOriginCorridorExposure.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit corridor exposure**

```bash
git add src/types.ts src/forensics/moneyOriginCorridorExposure.ts tests/forensics/moneyOriginCorridorExposure.test.ts
git commit -m "feat: add where-is-money corridor exposure profiles"
```

---

### Task 3: Add Hybrid Corridor Decision Policy

**Files:**
- Create: `src/forensics/moneyOriginCorridorPolicy.ts`
- Test: `tests/forensics/moneyOriginCorridorPolicy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `tests/forensics/moneyOriginCorridorPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { combineWhereIsMoneyCorridorDecision } from "../../src/forensics/moneyOriginCorridorPolicy";
import type { ApprovalDrainProvenanceProfile, MoneyOriginCorridorExposure, MoneyOriginPath } from "../../src/types";

function path(verdict: MoneyOriginPath["verdict"] = "ACCEPTABLE"): MoneyOriginPath {
  return {
    balanceTransferTxHash: "tx-balance",
    rootSourceAddress: "TBinance111111111111111111111111111",
    rootSourceType: verdict === "ACCEPTABLE" ? "allowlist_cex" : "incomplete",
    pathAddresses: ["TBinance111111111111111111111111111", "TSender11111111111111111111111111111", "TChecked11111111111111111111111111111"],
    txHashes: ["tx-fund", "tx-balance"],
    steps: [
      { txHash: "tx-fund", fromAddress: "TBinance111111111111111111111111111", toAddress: "TSender11111111111111111111111111111", amountRaw: "1000000000", timestamp: "2026-05-01T00:00:00.000Z" },
      { txHash: "tx-balance", fromAddress: "TSender11111111111111111111111111111", toAddress: "TChecked11111111111111111111111111111", amountRaw: "1000000000", timestamp: "2026-05-01T00:05:00.000Z" }
    ],
    amountPreservationRatio: 1,
    timeSpanMs: 300000,
    stoppedReason: verdict === "ACCEPTABLE" ? "allowlist_cex_reached" : "data_budget_exhausted",
    verdict,
    riskScoreContribution: verdict === "ACCEPTABLE" ? 5 : 45,
    reasons: [`${verdict} path`]
  };
}

function exposure(overrides: Partial<MoneyOriginCorridorExposure>): MoneyOriginCorridorExposure {
  return {
    address: "TSender11111111111111111111111111111",
    role: "balance_sender",
    distanceFromBalancePath: 0,
    incomingVolumeRaw: "0",
    outgoingVolumeRaw: "0",
    incomingTxCount: 0,
    outgoingTxCount: 0,
    topIncomingCounterparties: [],
    topOutgoingCounterparties: [],
    taggedInteractions: [],
    serviceExposure: {
      htxHuobiVolumeRaw: "0",
      whitebitVolumeRaw: "0",
      allowlistedCexVolumeRaw: "0",
      bridgeDexRouterVolumeRaw: "0"
    },
    approvalDrainProvenance: null,
    behaviorHints: [],
    ...overrides
  };
}

function approvalProfile(score: number): ApprovalDrainProvenanceProfile {
  return {
    victimAddress: "TVictim111111111111111111111111111111",
    approvalTxHash: "tx-approval",
    drainTxHash: "tx-drain",
    spenderAddress: "TSpender11111111111111111111111111111",
    firstReceiverAddress: "TReceiver1111111111111111111111111111",
    subjectAddress: "TSender11111111111111111111111111111",
    hopDepth: score >= 90 ? 0 : 1,
    amountRaw: "1000000000",
    amountPreservationRatio: 1,
    approvalAt: "2026-05-01T00:00:00.000Z",
    drainAt: "2026-05-01T00:01:00.000Z",
    pathTxHashes: ["tx-drain", "tx-hop"],
    pathAddresses: ["TVictim111111111111111111111111111111", "TReceiver1111111111111111111111111111", "TSender11111111111111111111111111111"],
    score,
    evidenceStrength: score >= 90 ? "exact_approval_and_transfer_from" : "route_linked",
    subjectTokenState: null,
    victimTokenState: null,
    features: []
  };
}

describe("combineWhereIsMoneyCorridorDecision", () => {
  it("keeps acceptable paths acceptable when corridor exposure is clean", () => {
    const result = combineWhereIsMoneyCorridorDecision({
      originPaths: [path("ACCEPTABLE")],
      corridorExposures: [exposure({})],
      fastWalletRisk: null
    });

    expect(result).toMatchObject({
      decision: "ACCEPTABLE",
      riskScore: 5
    });
  });

  it("declines direct WhiteBIT exposure on a balance-forming sender even when amount is small", () => {
    const result = combineWhereIsMoneyCorridorDecision({
      originPaths: [path("ACCEPTABLE")],
      corridorExposures: [exposure({
        serviceExposure: {
          htxHuobiVolumeRaw: "0",
          whitebitVolumeRaw: "15000000",
          allowlistedCexVolumeRaw: "0",
          bridgeDexRouterVolumeRaw: "0"
        },
        taggedInteractions: [{
          txHash: "tx-whitebit",
          direction: "incoming",
          counterpartyAddress: "TWhiteBIT11111111111111111111111111",
          counterpartyTag: "WhiteBIT",
          serviceFamily: "whitebit",
          amountRaw: "15000000",
          timestamp: "2026-05-01T00:00:00.000Z",
          distanceFromBalancePath: 0
        }]
      })],
      fastWalletRisk: null
    });

    expect(result.decision).toBe("DECLINE");
    expect(result.riskScore).toBeGreaterThanOrEqual(75);
    expect(result.decisionReasons.join(" ")).toContain("WhiteBIT");
  });

  it("uses approval-drain provenance as critical exact evidence", () => {
    const result = combineWhereIsMoneyCorridorDecision({
      originPaths: [path("ACCEPTABLE")],
      corridorExposures: [exposure({ approvalDrainProvenance: approvalProfile(90) })],
      fastWalletRisk: null
    });

    expect(result).toMatchObject({
      decision: "DECLINE",
      riskScore: 90
    });
    expect(result.decisionReasons.join(" ")).toContain("approval-drain");
  });
});
```

- [ ] **Step 2: Run policy tests RED**

Run:

```bash
npm test -- tests/forensics/moneyOriginCorridorPolicy.test.ts
```

Expected: FAIL because `moneyOriginCorridorPolicy.ts` does not exist.

- [ ] **Step 3: Implement corridor decision policy**

Create `src/forensics/moneyOriginCorridorPolicy.ts`:

```ts
import type {
  ExchangeDecision,
  MoneyOriginCorridorExposure,
  MoneyOriginPath,
  RiskReport
} from "../types";
import { combineMoneyOriginDecision } from "./moneyOriginPolicy";

export type WhereIsMoneyCorridorDecision = {
  decision: ExchangeDecision;
  riskScore: number;
  decisionReasons: string[];
};

export type CombineWhereIsMoneyCorridorDecisionInput = {
  originPaths: MoneyOriginPath[];
  corridorExposures: MoneyOriginCorridorExposure[];
  fastWalletRisk: RiskReport | null;
};

function parseAmount(value: string): bigint {
  return /^\\d+$/.test(value) ? BigInt(value) : 0n;
}

function decisionRank(decision: ExchangeDecision): number {
  if (decision === "DECLINE") return 3;
  if (decision === "REVIEW") return 2;
  return 1;
}

function maxDecision(left: ExchangeDecision, right: ExchangeDecision): ExchangeDecision {
  return decisionRank(right) > decisionRank(left) ? right : left;
}

function corridorExposureSignals(exposure: MoneyOriginCorridorExposure): Array<{ decision: ExchangeDecision; score: number; reason: string }> {
  const signals: Array<{ decision: ExchangeDecision; score: number; reason: string }> = [];
  const approval = exposure.approvalDrainProvenance;
  if (approval) {
    signals.push({
      decision: "DECLINE",
      score: approval.score,
      reason: `Exact approval-drain provenance found for ${exposure.address}: victim ${approval.victimAddress}, spender ${approval.spenderAddress}, approval ${approval.approvalTxHash}, drain ${approval.drainTxHash}.`
    });
  }

  if (parseAmount(exposure.serviceExposure.whitebitVolumeRaw) > 0n) {
    signals.push({
      decision: "DECLINE",
      score: exposure.role === "balance_sender" ? 78 : 72,
      reason: `Balance-forming corridor actor ${exposure.address} has direct WhiteBIT exposure.`
    });
  }
  if (parseAmount(exposure.serviceExposure.htxHuobiVolumeRaw) > 0n) {
    signals.push({
      decision: "DECLINE",
      score: exposure.role === "balance_sender" ? 78 : 72,
      reason: `Balance-forming corridor actor ${exposure.address} has direct HTX/Huobi exposure.`
    });
  }
  if (parseAmount(exposure.serviceExposure.bridgeDexRouterVolumeRaw) > 0n) {
    signals.push({
      decision: "DECLINE",
      score: exposure.role === "balance_sender" ? 75 : 68,
      reason: `Balance-forming corridor actor ${exposure.address} has bridge/router/DEX exposure.`
    });
  }

  return signals;
}

export function combineWhereIsMoneyCorridorDecision(input: CombineWhereIsMoneyCorridorDecisionInput): WhereIsMoneyCorridorDecision {
  const base = combineMoneyOriginDecision(input.originPaths);
  const signals = input.corridorExposures.flatMap(corridorExposureSignals);
  const fastScore = input.fastWalletRisk && input.fastWalletRisk.score >= 85 ? input.fastWalletRisk.score : 0;
  const fastSignal = fastScore > 0 && input.fastWalletRisk
    ? [{
        decision: "DECLINE" as const,
        score: fastScore,
        reason: `Fast wallet check is ${input.fastWalletRisk.level} ${input.fastWalletRisk.score}/100 from exact or critical evidence.`
      }]
    : [];
  const allSignals = [...signals, ...fastSignal];
  const decision = allSignals.reduce((current, signal) => maxDecision(current, signal.decision), base.decision);
  const riskScore = Math.max(base.riskScore, ...allSignals.map((signal) => signal.score), fastScore);
  const signalReasons = allSignals
    .sort((left, right) => right.score - left.score)
    .map((signal) => signal.reason);

  return {
    decision,
    riskScore,
    decisionReasons: [...signalReasons, ...base.decisionReasons].slice(0, 8)
  };
}
```

- [ ] **Step 4: Run policy tests GREEN**

Run:

```bash
npm test -- tests/forensics/moneyOriginCorridorPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit corridor policy**

```bash
git add src/forensics/moneyOriginCorridorPolicy.ts tests/forensics/moneyOriginCorridorPolicy.test.ts
git commit -m "feat: add where-is-money corridor decision policy"
```

---

### Task 4: Wire Corridor Exposure And Approval-Drain Into The Orchestrator

**Files:**
- Modify: `src/types.ts`
- Modify: `src/check/whereIsMoneyCheck.ts`
- Test: `tests/check/whereIsMoneyCheck.test.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Add to `tests/check/whereIsMoneyCheck.test.ts`:

```ts
it("declines a balance-forming corridor with direct WhiteBIT exposure", async () => {
  const whitebit = "TWhiteBIT11111111111111111111111111";
  const sender = "TSender11111111111111111111111111111";
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "1000000000",
    fetchEdgesForAddress: async (address) => {
      if (address === subject) {
        return [edge("tx-balance", sender, subject, "1000000000", "2026-05-22T10:15:00.000Z")];
      }
      if (address === sender) {
        return [
          { ...edge("tx-whitebit", whitebit, sender, "15000000", "2026-05-01T00:00:00.000Z"), fromAddressTag: "WhiteBIT", toAddressTag: null },
          edge("tx-balance", sender, subject, "1000000000", "2026-05-22T10:15:00.000Z")
        ];
      }
      return [];
    },
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => service("none", null),
    getFastWalletRisk: async () => lowFastRisk
  }, {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z")
  });

  expect(report.decision).toBe("DECLINE");
  expect(report.riskScore).toBeGreaterThanOrEqual(75);
  expect(report.corridorExposures).toEqual(expect.arrayContaining([
    expect.objectContaining({
      address: sender,
      serviceExposure: expect.objectContaining({ whitebitVolumeRaw: "15000000" })
    })
  ]));
});

it("declines exact approval-drain provenance in the balance-forming corridor", async () => {
  const victim = "TVictim111111111111111111111111111111";
  const spender = "TSpender11111111111111111111111111111";
  const firstReceiver = "TReceiver1111111111111111111111111111";
  const sender = "TSender11111111111111111111111111111";
  const report = await runWhereIsMoneyCheck({
    getTrc20Balance: async () => "1000000000",
    fetchEdgesForAddress: async (address) => {
      if (address === subject) {
        return [edge("tx-balance", sender, subject, "1000000000", "2026-05-22T10:15:00.000Z")];
      }
      if (address === sender) {
        return [
          { ...edge("tx-drain", victim, firstReceiver, "1000000000", "2026-05-22T10:00:00.000Z"), edgeType: "transfer_from" as const, method: "transferFrom" },
          edge("tx-hop", firstReceiver, sender, "1000000000", "2026-05-22T10:05:00.000Z"),
          edge("tx-balance", sender, subject, "1000000000", "2026-05-22T10:15:00.000Z")
        ];
      }
      return [];
    },
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => service("none", null),
    getFastWalletRisk: async () => lowFastRisk,
    getTransaction: async () => ({ ownerAddress: spender }),
    listTrc20ApprovalChanges: async () => [{
      txHash: "tx-approval",
      ownerAddress: victim,
      spenderAddress: spender,
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      amountRaw: "1000000000",
      isUnlimited: false,
      timestamp: new Date("2026-05-22T09:55:00.000Z"),
      confirmed: true,
      contractRet: "SUCCESS"
    }],
    getUsdtRestrictionStatus: async (address) => ({
      subjectAddress: address,
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      tokenSymbol: "USDT",
      tokenStandard: "TRC20",
      decimals: 6,
      isBlacklisted: false,
      balanceRaw: "0",
      checkedAt: "2026-05-22T10:20:00.000Z",
      evidenceStrength: "exact_contract_state",
      blacklistEventTxHash: null,
      blacklistEventTimestamp: null,
      blacklistEventBlock: null,
      methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
    })
  }, {
    sourceAddress: subject,
    windowStart: new Date("2026-05-01T00:00:00.000Z"),
    windowEnd: new Date("2026-05-24T00:00:00.000Z")
  });

  expect(report.decision).toBe("DECLINE");
  expect(report.riskScore).toBeGreaterThanOrEqual(80);
  expect(report.corridorExposures.some((exposure) => exposure.approvalDrainProvenance?.drainTxHash === "tx-drain")).toBe(true);
});
```

- [ ] **Step 2: Run orchestrator tests RED**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: FAIL because `WhereIsMoneyReport` has no `corridorExposures` and `WhereIsMoneyDeps` has no approval-drain deps.

- [ ] **Step 3: Extend report and deps types**

Modify `src/types.ts` in `WhereIsMoneyReport`:

```ts
  corridorExposures: MoneyOriginCorridorExposure[];
```

Modify `src/check/whereIsMoneyCheck.ts` imports:

```ts
import { buildApprovalDrainProvenanceProfile } from "../forensics/approvalDrainProvenance";
import { buildMoneyOriginCorridorExposure } from "../forensics/moneyOriginCorridorExposure";
import { combineWhereIsMoneyCorridorDecision } from "../forensics/moneyOriginCorridorPolicy";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
```

Modify `WhereIsMoneyDeps`:

```ts
  getTransaction?(txHash: string): Promise<unknown>;
  listTrc20ApprovalChanges?(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  getUsdtRestrictionStatus?(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
```

- [ ] **Step 4: Add corridor helpers in orchestrator**

Add helper functions in `src/check/whereIsMoneyCheck.ts`:

```ts
function dedupeAddresses(addresses: string[]): string[] {
  return [...new Set(addresses.filter((address) => address.length > 0))];
}

function corridorActors(input: {
  sourceAddress: string;
  originPaths: MoneyOriginPath[];
}): MoneyOriginCorridorActor[] {
  const actors: MoneyOriginCorridorActor[] = [{
    address: input.sourceAddress,
    role: "checked_wallet",
    distanceFromBalancePath: 0
  }];

  for (const path of input.originPaths) {
    const reversed = [...path.pathAddresses].reverse();
    for (let index = 0; index < reversed.length; index += 1) {
      const address = reversed[index];
      if (address === input.sourceAddress) continue;
      actors.push({
        address,
        role: index === 1 ? "balance_sender" : "funding_actor",
        distanceFromBalancePath: index - 1
      });
    }
  }

  const byAddress = new Map<string, MoneyOriginCorridorActor>();
  for (const actor of actors) {
    const current = byAddress.get(actor.address);
    if (!current || actor.distanceFromBalancePath < current.distanceFromBalancePath) {
      byAddress.set(actor.address, actor);
    }
  }
  return [...byAddress.values()].slice(0, 25);
}

function dedupeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
}
```

- [ ] **Step 5: Wire exposure and approval-drain scans**

In `runWhereIsMoneyCheck`, after `originPaths` are computed:

```ts
  const actors = corridorActors({
    sourceAddress: input.sourceAddress,
    originPaths
  });
  const actorEdges = new Map<string, ForensicRouteEdge[]>();
  for (const actor of actors) {
    actorEdges.set(actor.address, await fetchCachedEdgesForAddress(actor.address));
  }

  let corridorExposures = buildMoneyOriginCorridorExposure({
    actors,
    edgesByAddress: actorEdges
  });

  if (deps.getTransaction && deps.listTrc20ApprovalChanges) {
    corridorExposures = await Promise.all(corridorExposures.map(async (exposure) => {
      const edgeSet = dedupeEdges([
        ...originPaths.flatMap((path) => path.steps.map((step) => ({
          id: step.txHash,
          txHash: step.txHash,
          fromAddress: step.fromAddress,
          toAddress: step.toAddress,
          amountRaw: step.amountRaw,
          timestamp: new Date(step.timestamp),
          method: "transfer",
          edgeType: "normal_transfer" as const,
          fromAddressTag: null,
          toAddressTag: null
        }))),
        ...(actorEdges.get(exposure.address) ?? [])
      ]);
      const approvalDrainProvenance = await buildApprovalDrainProvenanceProfile({
        subjectAddress: exposure.address,
        edges: edgeSet,
        deps: {
          getTransaction: deps.getTransaction as NonNullable<WhereIsMoneyDeps["getTransaction"]>,
          listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges as NonNullable<WhereIsMoneyDeps["listTrc20ApprovalChanges"]>,
          getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus
        }
      });
      return { ...exposure, approvalDrainProvenance };
    }));
  }

  const combined = combineWhereIsMoneyCorridorDecision({
    originPaths,
    corridorExposures,
    fastWalletRisk
  });
```

Use `combined.decision`, `combined.riskScore`, and `combined.decisionReasons` in the returned report.

- [ ] **Step 6: Include corridor exposure in fallback reports**

Modify `fallbackReviewReport` return object:

```ts
    corridorExposures: [],
```

- [ ] **Step 7: Run orchestrator tests GREEN**

Run:

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit orchestrator wiring**

```bash
git add src/types.ts src/check/whereIsMoneyCheck.ts tests/check/whereIsMoneyCheck.test.ts
git commit -m "feat: wire where-is-money corridor checks"
```

---

### Task 5: Update Offline CLI Output And Live Fallback

**Files:**
- Modify: `scripts/forensicWhereIsMoney.ts`
- Test: `tests/forensics/whereIsMoneyCliArgs.test.ts` only if CLI args change

- [ ] **Step 1: Add live fallback for sparse local index**

In `scripts/forensicWhereIsMoney.ts`, import:

```ts
import { normalizeTransfer } from "../src/forensics/routeSearch";
```

Add:

```ts
function dedupeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
}
```

Modify `fetchEdgesForAddress` so indexed data is used first, then live transfer rows are added when indexed data is empty or sparse:

```ts
  const indexedEdges = transfers.map(indexedTransferToRouteEdge);
  const liveEdges = indexedEdges.length < 3
    ? (await tronClient.listRelatedTrc20Transfers(address, {
        start: 0,
        limit: Math.max(args.maxEdgesPerAddress, 100),
        minTimestamp: args.windowStart.getTime(),
        endTimestamp: args.windowEnd.getTime()
      }).catch(() => []))
        .map(normalizeTransfer)
        .filter((edge): edge is ForensicRouteEdge => edge !== null)
    : [];
  const recentFallbackEdges = indexedEdges.length + liveEdges.length < 3
    ? (await tronClient.listRelatedTrc20Transfers(address, {
        start: 0,
        limit: Math.max(args.maxEdgesPerAddress, 100)
      }).catch(() => []))
        .map(normalizeTransfer)
        .filter((edge): edge is ForensicRouteEdge => edge !== null)
    : [];
  const edges = dedupeEdges([...indexedEdges, ...liveEdges, ...recentFallbackEdges]);
```

- [ ] **Step 2: Pass approval-drain deps to the orchestrator**

In the `runWhereIsMoneyCheck` deps object:

```ts
    getTransaction: (txHash) => tronClient.getTransaction(txHash),
    listTrc20ApprovalChanges: (input) => tronClient.listTrc20ApprovalChanges(input),
    getUsdtRestrictionStatus: (address, options) => tronClient.getUsdtRestrictionStatus(address, options),
```

- [ ] **Step 3: Print corridor exposures**

After `Origin paths`, print:

```ts
  console.log("");
  console.log("Corridor exposures:");
  if (report.corridorExposures.length === 0) {
    console.log("- none");
  }
  for (const exposure of report.corridorExposures) {
    console.log(`- ${exposure.role} ${exposure.address}`);
    console.log(`  incoming: ${formatRawUsdt(exposure.incomingVolumeRaw)} across ${exposure.incomingTxCount} txs`);
    console.log(`  outgoing: ${formatRawUsdt(exposure.outgoingVolumeRaw)} across ${exposure.outgoingTxCount} txs`);
    for (const interaction of exposure.taggedInteractions.slice(0, 8)) {
      console.log(`  tag: ${interaction.counterpartyTag} ${interaction.direction} ${formatRawUsdt(interaction.amountRaw)} | ${interaction.txHash}`);
    }
    if (exposure.approvalDrainProvenance) {
      const profile = exposure.approvalDrainProvenance;
      console.log(`  approval-drain: ${profile.score}/100 | victim ${profile.victimAddress} | spender ${profile.spenderAddress}`);
      console.log(`  approval tx: ${profile.approvalTxHash}`);
      console.log(`  drain tx: ${profile.drainTxHash}`);
      console.log(`  path: ${profile.pathAddresses.join(" -> ")}`);
      console.log(`  amount: ${formatRawUsdt(profile.amountRaw)} | preservation ${formatPercent(profile.amountPreservationRatio)}`);
    }
  }
```

- [ ] **Step 4: Run CLI smoke**

Run:

```bash
npm run forensic:where-is-money -- -- --source TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf --days 30 --depth 7 --beam 8 --max-addresses 60 --max-edges 40
```

Expected:

- `Balance-forming transfers: 3 txs, covering 100%`.
- `Corridor exposures` section is present.
- WhiteBIT/Bybit/Binance tags appear when TronScan returns them.
- If no approval drain is found, the CLI says nothing under approval-drain for each actor or prints no approval-drain line.

- [ ] **Step 5: Commit CLI**

```bash
git add scripts/forensicWhereIsMoney.ts
git commit -m "feat: expand where-is-money forensic cli"
```

---

### Task 6: Full Verification

**Files:**
- No code files unless fixes are needed.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/forensics/routeSearchProviderTags.test.ts tests/forensics/moneyOriginCorridorExposure.test.ts tests/forensics/moneyOriginCorridorPolicy.test.ts tests/forensics/approvalDrainProvenance.test.ts tests/check/whereIsMoneyCheck.test.ts tests/forensics/moneyOriginTrace.test.ts tests/forensics/moneyOriginPolicy.test.ts
```

Expected: all listed test files pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: full Vitest suite exits 0.

- [ ] **Step 4: Run CLI smoke on the sample wallet**

Run:

```bash
npm run forensic:where-is-money -- -- --source TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf --days 30 --depth 7 --beam 8 --max-addresses 60 --max-edges 40
```

Expected output includes:

```text
Decision:
Risk:
Balance-forming transfers:
Origin paths:
Corridor exposures:
Coverage:
```

Expected policy behavior for current live data:

- If TronScan returns WhiteBIT exposure on `TE729...` or `TUkbr...`, final decision is `DECLINE` and risk score is at least `70/100`.
- If approval-drain provenance is found in any corridor actor, final decision is `DECLINE` and risk score is at least `80/100`, or `90/100` for direct first receiver evidence.
- If provider tags are unavailable during the smoke run, final decision may be `REVIEW`, and coverage notes must make provider data limitations visible.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intended files are modified or untracked. Existing unrelated files such as `.codegraph/`, `fast-check-deep-research.md`, or unrelated research docs must not be staged.

---

## Self-Review Checklist

Spec coverage:

- Balance-forming trace remains the entry point: Task 4.
- Provider tags from TronScan transfer rows are preserved: Task 1.
- Corridor actor exposure is computed: Task 2.
- WhiteBIT/HTX/Huobi in corridor becomes `DECLINE / HIGH`: Task 3 and Task 4.
- Approval-drain provenance becomes `DECLINE / CRITICAL` or high: Task 3 and Task 4.
- CLI prints corridor and approval-drain evidence: Task 5.
- Full verification covers targeted tests, typecheck, full suite, and CLI smoke: Task 6.

Implementation notes:

- Do not remove the existing `buildApprovalDrainProvenanceProfile`; reuse it.
- Do not claim exact UTXO provenance.
- Do not infer approval-drain from transfer shape alone. The detector must require `transferFrom`, spender caller, and prior approval.
- Do not stage unrelated working-tree files.
