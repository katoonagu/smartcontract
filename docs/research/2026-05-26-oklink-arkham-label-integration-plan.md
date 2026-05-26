# Phase 10A.13 Plan: OKLink / Arkham Provider Entity Labels

Date: 2026-05-26

Status: research-backed integration plan for the Hermes branch, not implemented yet.

Branch context: `codex/hermes-telegram-test-20260526`.

## 1. Executive Summary

Нужно подключать OKLink и Arkham как отдельный provider-label слой. Это не замена exact on-chain evidence и не замена manual assertions. Главная польза:

- находить entity labels, которых нет в TronScan;
- видеть, что адрес или path дошел до конкретной организации, например Rapira;
- отделять "contactable exchange lead" от "risk/taint";
- улучшить boundary handling для HTX/Huobi/Bybit/OKX/Binance/bridges/routers;
- обогащать 4-hop/7-hop search без массового live traversal.

Ключевое правило: provider label сам по себе не делает адрес `CRITICAL`. Для Rapira-like кейсов это прежде всего operational/contact lead:

> Provider-labeled exchange boundary reached: Rapira. This is an investigative lead and service boundary, not proof of wrongdoing.

Если адрес помечен вручную сервис-админом как `darknet_exchange`, тогда manual assertion сильнее provider labels и может давать exact internal high-confidence seed risk.

## 2. Source Check

### Arkham

Arkham публично документирует API как entity-first / confidence-scored intelligence layer. В документации описаны addresses, entities, labels, tags, authentication, rate limits, pagination, intelligence endpoints и batch lookup. Arkham отдельно подчеркивает, что attribution является вероятностной, а labels живут и меняются со временем.

Практический вывод: Arkham labels надо хранить как provider context with confidence, source URL/raw response and freshness. Их нельзя смешивать с exact on-chain proof.

Relevant docs:

- https://intel.arkm.com/api/docs
- https://intel.arkm.com/llms.txt
- https://intel.arkm.com/api/

Useful endpoints from Arkham docs/index:

- `GET /intelligence/address/{address}`;
- `GET /intelligence/address/{address}/all`;
- `POST /intelligence/address/batch`;
- `POST /intelligence/address/batch/all`;
- `GET /intelligence/address_tags/updates`;
- `GET /intelligence/addresses/updates`;
- `GET /counterparties/address/{address}`;
- `GET /transfers`.

Important limits:

- use intelligence endpoints for labels/entities;
- treat transfer/counterparty endpoints as heavier and not part of fast `/check`;
- prefer batch lookup for selected counterparties;
- cache results aggressively.

### OKLink / OKLink Onchain AML

OKLink public explorer docs are not enough for labels: they mostly expose explorer/developer tooling such as contract verification. OKLink Onchain AML is a separate product. Public product material says the AML platform supports 100+ blockchains, a label library, KYT/KYA style screening, and labels for exchanges, smart contracts, hackers, crypto whales and other entities.

Unofficial SDK evidence suggests OKLink Onchain AML exposes KYA/KYT-style methods such as:

- `kya.addressRiskLevel`;
- `kya.addressRiskScreening`;
- `kya.entityTag`;
- `kya.entityBlackTag`;
- `kya.tagAll`;
- `kyt.transfersInfo`;
- `kyt.transfersExposures`.

Because this SDK is not official documentation, implementation must verify exact endpoint names and response schemas against the actual OKLink account/API contract before production use.

Relevant docs/sources:

- https://www.oklink.com/docs/en/
- https://www.oklink.com/docs/trust_en/
- https://www.prnewswire.com/apac/news-releases/okg-tech-launches-oklink-onchain-aml-platform-for-virtual-asset-compliance-and-risk-detection-301922981.html
- https://github.com/airicyu/oklink-api

## 3. Current Project Fit

The repo is already partially prepared:

- `migrations/016_offline_tron_usdt_index.sql` defines `address_labels_cache`;
- `AddressLabelCacheEntry` already has `provider: tronscan | oklink | arkham | manual`;
- repository methods already exist:
  - `upsertAddressLabelCache(...)`;
  - `listAddressLabelCacheForAddress(...)`;
- manual high-confidence assertions already exist in `address_label_assertions`;
- risk engine already separates exact labels/provenance from provider/context signals;
- deep check already has extended provenance, service boundary and operational flow concepts.

So Phase 10A.13 should not add another parallel label system. It should:

1. add provider clients;
2. normalize provider labels into `address_labels_cache`;
3. read provider cache in deep check and offline beam search;
4. report entity proximity and contactability clearly;
5. only promote to internal label after manual confirmation or explicit high-confidence internal policy.

## 4. Evidence And Label Strength Model

### A. Exact on-chain evidence

Examples:

- USDT blacklist state from official token contract;
- official TRON USDT transfer / transferFrom;
- approval before transferFrom drain;
- local indexed transaction path.

Use for proof-grade evidence.

### B. Manual internal assertions

Examples:

- `darknet_exchange`;
- `darknet_exchange_proximity`;
- `approval_drain_proximity`;
- service-admin confirmed labels.

Manual assertions can drive HIGH/CRITICAL depending on policy.

### C. Provider entity labels

Examples:

- Arkham says address belongs to Rapira;
- OKLink says address is HTX/Huobi/Bybit/OKX/Binance hot wallet;
- provider says address is bridge/router/pool.

Default treatment:

- service/entity boundary;
- investigative lead;
- contactability signal;
- not exact taint proof.

### D. Provider risk labels

Examples:

- scam;
- hack;
- phishing;
- sanctioned;
- black tag / risk tag.

Default treatment for MVP:

- provider risk context with score cap;
- requires raw provider evidence and source name;
- optional `needs_review` observation;
- manual confirmation can promote to internal label.

Do not auto-create `darknet_exchange` from provider labels unless service policy explicitly allows it.

## 5. Rapira Example Handling

Example address from user:

`TCJmckc4Amq5qgD9qgWKbLpKUmwQvrfx6E`

Expected provider result:

- entity: `Rapira`;
- category: `exchange` / `cex` / `vasp`;
- confidence: provider-reported, ideally high;
- source: OKLink and/or Arkham;
- treatment: contactable exchange boundary.

Report wording should be:

```text
Provider entity lead: Rapira.
Funds reached a provider-labeled exchange boundary. Public-chain continuity after this point should not be assumed.
This is useful for follow-up with the entity, not proof that the checked wallet is Rapira.
```

If a checked subject is within 1-4 hops from Rapira:

```text
Provider-labeled entity proximity: path reaches Rapira within 3 hops.
This is an investigative lead. It does not imply wrongdoing by the subject.
```

If the entity is HTX/Huobi:

```text
Provider-labeled CEX boundary: HTX/Huobi.
Public-chain continuity stops at this boundary. Cooperation may be limited.
```

## 6. Data Model Recommendation

### Phase 10A.13A: no migration MVP

Use existing `address_labels_cache`:

```text
chain = tron
address = TCJ...
provider = arkham | oklink
label = Rapira
category = cex
confidence = high | medium | low
source_url = provider URL if allowed
raw_json = full provider response, normalized fields, fetch metadata
first_seen_at
last_seen_at
```

Store provider-specific fields inside `raw_json`:

```json
{
  "entityId": "rapira",
  "entityName": "Rapira",
  "entityType": "exchange",
  "tags": ["exchange", "service"],
  "service": true,
  "providerConfidence": "high",
  "fetchedAt": "2026-05-26T00:00:00.000Z",
  "policyVersion": "2026-05-26-provider-labels-v1"
}
```

### Phase 10A.13B: migration after API shape is stable

Add columns or a new `provider_entity_directory` table:

```text
provider_entities
- chain
- provider
- entity_id
- entity_name
- entity_type
- category
- contactability: contactable | limited | nonresponsive | unknown
- cooperation_notes
- jurisdiction
- source_url
- raw_json
- first_seen_at
- last_seen_at
```

Add optional columns to `address_labels_cache`:

```text
entity_id
entity_name
entity_type
service boolean
provider_confidence text
expires_at timestamptz
```

Contactability should be local/internal policy, not blindly copied from providers.

Suggested initial contactability directory:

```text
Rapira: contactable
HTX/Huobi: nonresponsive_or_limited
Bybit: limited
OKX/Binance/Kraken/Coinbase: unknown_or_policy_dependent
```

## 7. Provider Client Architecture

Add provider client interfaces:

```ts
type ProviderAddressLabel = {
  chain: "tron";
  address: string;
  provider: "oklink" | "arkham";
  label: string;
  category: "cex" | "hot_wallet" | "bridge" | "router" | "dex" | "pool" | "scam" | "darknet_exchange" | "unknown";
  entityId: string | null;
  entityName: string | null;
  entityType: string | null;
  confidence: "low" | "medium" | "high";
  service: boolean | null;
  sourceUrl: string | null;
  rawJson: Record<string, unknown>;
};

type AddressLabelProviderClient = {
  provider: "oklink" | "arkham";
  lookupAddressLabels(address: string): Promise<ProviderAddressLabel[]>;
  lookupAddressLabelsBatch?(addresses: string[]): Promise<ProviderAddressLabel[]>;
};
```

Add concrete clients:

- `src/providers/arkhamClient.ts`;
- `src/providers/oklinkClient.ts`;
- `src/providers/providerLabelNormalizer.ts`;
- `src/providers/providerLabelCache.ts`.

Config/env:

```text
ARKHAM_API_KEY=
ARKHAM_BASE_URL=https://api.arkm.com
OKLINK_API_KEY=
OKLINK_BASE_URL=https://www.oklink.com
PROVIDER_LABEL_CACHE_TTL_MS=604800000
PROVIDER_LABEL_MAX_LOOKUPS_PER_CHECK=20
PROVIDER_LABEL_ENABLE_LIVE_LOOKUP=false
```

Default should be cache-first. Live lookup can be enabled for admin/deep jobs, not for fast `/check`.

## 8. Scheduler And Cache Rules

Use global scheduler pattern:

- priority `provider_label_fast_cache_miss`;
- priority `provider_label_deep`;
- no provider secrets in logs;
- failed/401/429 responses are not cached;
- successful responses cached with TTL;
- batch selected addresses when possible.

Lookup priorities:

1. checked subject;
2. direct inbound/outbound top counterparties;
3. exact path candidates from local beam search;
4. service/boundary endpoints;
5. only then second-order low-volume endpoints.

Bot defaults:

```text
max provider label lookups per fast check: 0 live, cache only
max provider label lookups per deep job: 20
max Arkham batch size: provider-dependent, start 20
max OKLink batch size: provider-dependent, start 10 or single-address until verified
TTL: 7 days for entity labels, 24 hours for risk/black tags
```

## 9. Deep Check Integration

Extend `DeepAddressForensicReport` with:

```ts
type ProviderEntityLeadProfile = {
  subjectAddress: string;
  provider: "oklink" | "arkham";
  entityName: string;
  entityId: string | null;
  category: string;
  confidence: "low" | "medium" | "high";
  direction: "self" | "inbound" | "outbound";
  hopDepth: number;
  pathAddresses: string[];
  pathTxHashes: string[];
  amountRaw: string;
  amountPreservationRatio: number | null;
  firstTransferAt: string | null;
  lastTransferAt: string | null;
  contactability: "contactable" | "limited" | "nonresponsive" | "unknown";
  evidenceStrength: "provider_label" | "provider_labeled_path" | "manual_confirmed";
  features: RouteScoreFeature[];
};
```

Add observation codes:

```text
provider_entity_label_self
provider_entity_label_direct_counterparty
provider_entity_label_path_candidate
provider_risk_label_context
provider_cex_boundary_contactable
provider_cex_boundary_nonresponsive
```

Risk policy:

- `provider_entity_label_*`: context only unless paired with exact/manual risk label;
- `provider_risk_label_context`: cap 20-35 until manual review;
- direct path to provider-labeled Rapira: actionability/contact lead, not risk;
- direct path to provider-labeled sanctioned/scam entity: provider risk context, capped unless manually confirmed;
- manual `darknet_exchange` or `approval_drain_proximity` remains stronger.

## 10. Offline Index / Beam Search Integration

Provider labels should enrich local indexed search:

- while running 4-hop/7-hop beam search, join `address_labels_cache` on each candidate address;
- if candidate reaches provider-labeled service, stop proof at boundary;
- if candidate reaches provider-labeled exchange with contactability `contactable`, surface as `entity lead`;
- if candidate reaches HTX/Huobi/Bybit, surface as `CEX boundary` and stopped reason;
- do not continue proof through CEX deposit/withdrawal unless there is exact same-chain path evidence after the boundary.

Suggested path scoring addition:

```text
+ provider_entity_match_score when entity is known and amount is meaningful
+ contactable_entity_score for Rapira-like leads
+ provider_risk_tag_score only with cap and manual-review wording
- service_boundary_stop_penalty for HTX/Huobi/Bybit/bridge/router/pool
```

## 11. Telegram Report UX

Add a compact provider labels block in deep reports:

```text
Provider labels

• Rapira boundary found within 2 hops (Arkham, high confidence).
• Amount: 125,000 USDT; path: A -> B -> Rapira.
• This is a contactable exchange lead, not proof of wrongdoing.
```

For HTX/Huobi:

```text
Provider labels

• HTX/Huobi boundary found within 1 hop.
• Public-chain continuity after this point should not be assumed.
• Cooperation/contact response may be limited.
```

For provider risk tags:

```text
Provider risk context

• OKLink/Arkham reports a risk tag for this address.
• Provider label requires manual review before internal promotion.
```

Forbidden:

- no `fraud proven`;
- no `this wallet is Rapira` unless the subject itself has provider/manual entity label;
- no legal attribution for path candidates.

## 12. Admin Workflow

Add commands later:

```text
/provider_labels <address>
/refresh_provider_labels <address>
/promote_provider_label <address> <provider> <label> <internal_label>
```

Promotion rules:

- provider label can create `needs_review` automatically;
- provider label can create `darknet_exchange` only through service-admin manual assertion;
- provider entity `Rapira` creates `provider_entity_lead`, not risk label;
- provider `HTX/Huobi` creates service boundary context, not risk label.

## 13. Test Plan

Unit tests:

- Arkham normalizer maps entity `Rapira` to provider entity label category `cex`;
- OKLink normalizer maps `entityTag` / `tagAll` response into cache entries;
- provider label cache upsert/list round trip;
- provider failed/429/401 response is not cached;
- provider risk label does not create CRITICAL without manual assertion;
- manual assertion overrides provider label;
- provider CEX label stops path proof at boundary.

Deep check tests:

- checked address self-labeled by provider as Rapira shows provider entity lead;
- subject -> hop -> Rapira within 2 hops appears as contactable exchange lead;
- subject -> HTX/Huobi shows nonresponsive CEX boundary wording;
- provider-labeled scam/hack tag appears as provider context with cap;
- repeated `/check` reads cache without live provider call;
- output never says `fraud proven`.

Golden fixtures:

- `TCJmckc4Amq5qgD9qgWKbLpKUmwQvrfx6E`: expected Rapira label if provider API returns it;
- HTX/Huobi labeled wallet fixture;
- clean retail wallet with no provider labels;
- manual `darknet_exchange` seed where manual assertion wins over provider entity label.

## 14. Rollout Plan

### 10A.13A: cache-only provider label reader

- use existing `address_labels_cache`;
- create normalizer types;
- add report section for cached labels;
- manually seed Rapira fixture for testing;
- no live API calls in bot yet.

### 10A.13B: Arkham live lookup in deep jobs

- add `ArkhamClient`;
- cache-first, live only in deep jobs;
- use batch lookup for selected candidates;
- store raw provider response;
- show provider entity leads.

### 10A.13C: OKLink Onchain AML live lookup

- verify API contract/endpoints with OKLink account;
- add `OKLinkClient`;
- map KYA/KYT/entity tags;
- keep response schema versioned in tests.

### 10A.13D: contactability directory

- add `provider_entities` or local config;
- mark Rapira as contactable;
- mark HTX/Huobi as limited/nonresponsive;
- report actionability separately from risk.

### 10A.13E: 4-hop/7-hop integration

- join labels into local beam search;
- rank contactable exchange/entity boundaries higher for investigator attention;
- do not propagate taint through provider-only service labels.

## 15. Final Recommendation

Do this in two layers:

1. First, implement cache-only provider labels and report UX. Use existing `address_labels_cache`, seed Rapira as a fixture, and prove the wording/scoring is safe.
2. Then add Arkham live lookup first, because its public API docs clearly expose address intelligence and batch/update concepts. Add OKLink after verifying the exact Onchain AML API endpoints under our account.

The most important product change is not "more risk score". It is "better investigative leads": if funds reach Rapira, report a contactable entity boundary; if funds reach HTX/Huobi, report a difficult CEX boundary; if manual darknet seed is involved, keep that as exact internal high-risk provenance.

