# Range API Schema Check For Cross-Chain Discovery

Date checked: 2026-06-01

## Sources Consulted

Official Range docs and specs:

- https://docs.range.org/llms.txt
- https://docs.range.org/data-api/api-reference-introduction.md
- https://docs.range.org/data-api/authentication.md
- https://docs.range.org/api-reference/token-transfers/get-token-transfers.md
- https://docs.range.org/api-reference/token-transfers/get-token-transfer-by-id.md
- https://docs.range.org/api-reference/connections-information/get-transfers-between-two-addresses.md
- https://docs.range.org/api-reference/blockchain-transactions/get-transaction-by-network-and-hash.md
- https://docs.range.org/api-reference/network-information/get-payments-for-a-transaction.md
- https://docs.range.org/risk-api/risk/get-address-risk-score.md
- https://docs.range.org/risk-api/risk-v2/get-address-risk.md
- https://docs.range.org/risk-api/product-info/rate-limits.md
- https://docs.range.org/api-reference/data-api.json
- https://docs.range.org/api-reference/risk-api.json

Live no-key probes, only to observe unauthenticated behavior:

- `GET https://api.range.org/v2/transfers?tx_hash=0xabc&size=1`
- `GET https://api.range.org/v1/risk/address?address=0x0000000000000000000000000000000000000000&network=eth`

## Base URL

```text
https://api.range.org
```

Both the Data API and Risk API OpenAPI specs list this server URL.

## Authentication

```text
Authorization: Bearer <api-key>
```

The OpenAPI security scheme is HTTP bearer auth with bearer format `API Key`. The docs also show normal JSON `GET` requests with this header. The adapter should also send `Accept: application/json`.

## Transfer Endpoints

Range does not document separate tx-level and address-level token-transfer paths. The current documented token-transfer search endpoint is:

```text
GET /v2/transfers
```

Use the same path with different filters:

| Adapter query | Endpoint path | Main filter |
|---|---:|---|
| tx-level transfer lookup | `/v2/transfers` | `tx_hash=<hash>` or `tx_hashes=<hashes>` |
| address-level transfer lookup | `/v2/transfers` | `address=<address>` |

`GET /v2/transfers/{id}` exists, but it requires a Range transfer ID and is not a tx-hash or address discovery endpoint.

`GET /v2/connections/transfers` exists for known address-pair lookups. It is not a substitute for initial tx/address discovery because it requires both address/network pairs.

## Transfer Query Parameters

OpenAPI marks every `GET /v2/transfers` query parameter as optional. For this adapter, keep `txHash` required in `findTransfersByTx` and `address` required in `findTransfersByAddress` to avoid unbounded Range scans.

Tx lookup:

| Parameter | Official status | Adapter use |
|---|---:|---|
| `tx_hash` | optional | Required for single-tx lookup. |
| `tx_hashes` | optional | Optional batch variant; comma-separated in docs. |
| `network` | optional | Optional chain narrowing. |
| `source_networks` | optional | Optional source-chain filter. |
| `destination_networks` | optional | Optional destination-chain filter. |
| `start_time` | optional | Map from `timeWindow.start` if present. |
| `end_time` | optional | Map from `timeWindow.end` if present. |
| `scope` | optional | Prefer `INTERCHAIN` for cross-chain discovery when supported. |
| `status` | optional | Optional filter: `SUCCEEDED`, `PENDING`, `ERROR_ON_DESTINATION`, `TIMEOUT`. |
| `bridges` | optional | Optional protocol/bridge filter. |
| `token_symbols` | optional | Optional asset-symbol filter. |
| `min_usd`, `max_usd` | optional | USD filters only; not raw-amount filters. |
| `cursor`, `size`, `sort`, `explorer`, `search_string` | optional | Pagination/search controls. `size` is documented as 1-100, default 25. |

Address lookup:

| Parameter | Official status | Adapter use |
|---|---:|---|
| `address` | optional | Required by adapter for single-address lookup. |
| `addresses` | optional | Optional multi-address/pair-style filter; docs describe sender/receiver involvement. |
| `address_list_hash` | optional | Optional server-side stored address list filter from `POST /v2/addresses/list`. |
| `network` | optional | Optional chain narrowing. |
| `source_networks` | optional | Optional source-chain filter. |
| `destination_networks` | optional | Optional destination-chain filter. |
| `start_time` | optional | Map from `timeWindow.start` if present. |
| `end_time` | optional | Map from `timeWindow.end` if present. |
| `scope` | optional | Prefer `INTERCHAIN` for cross-chain discovery when supported. |
| `status` | optional | Optional status filter. |
| `bridges` | optional | Optional protocol/bridge filter. |
| `token_symbols` | optional | Map from `assetSymbol` if present. |
| `min_usd`, `max_usd` | optional | USD filters only. |
| `cursor`, `size`, `sort`, `explorer`, `search_string` | optional | Pagination/search controls. |

Important: there is no documented `min_amount_raw`, `asset_symbol`, `chain`, `tx`, or `hash` query parameter for `GET /v2/transfers`. Do not send those names in the Range adapter unless a live authenticated fixture proves they are accepted.

## Address Risk Endpoint

Address risk is available in official docs, but there are two documented shapes:

| Endpoint | Docs page | Shape |
|---|---|---|
| `GET /v1/risk/address` | Address Risk Score | Numeric `riskScore`, `riskLevel`, `numHops`, malicious evidence, reasoning. |
| `GET /v2/risk/address` | Score a Single Address | `tier`, `exposure`, `behaviour`, `scored_at`; richer assessment but no top-level numeric `riskScore`. |

Use `/v1/risk/address` for the current `ProviderRiskSnapshot` type because it has a numeric `riskScore`. Keep `/v2/risk/address` as a future richer-evidence option; do not silently convert `tier` to a numeric risk score.

Risk v1 docs table says `address` and `network` are required, while the OpenAPI block marks them optional. The adapter should always send both. Risk v2 OpenAPI marks both required.

## Rate Limits

Documented Data API rate-limit headers:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

The Data API authentication page lists Free, Pro, and Enterprise tiers. The Data API getting-started page lists Free and Enterprise only. Treat limits as plan-dependent and do not bake numeric limits into scoring or tests.

Risk API rate-limit docs are less complete: the Risk API plans page has `[To Do]` placeholders for Trial rate limits and response headers. The Address Risk Score page recommends using `Retry-After` for 429 backoff. Adapter error handling should preserve status, parse the three `X-RateLimit-*` headers if present, and also parse `Retry-After` if present.

## Response Shapes

### Transfer Success

`GET /v2/transfers` returns:

```json
{
  "items": [
    {
      "id": "9359/AX/2352",
      "time": "2024-05-08T13:05:57.779Z",
      "status": "SUCCEEDED",
      "type": "cctp",
      "sender": {
        "address": "AuZr...",
        "network": "solana",
        "token": {
          "amount": 27.18,
          "symbol": "USDC",
          "usd": 27.24
        }
      },
      "receiver": {
        "address": "noble14...",
        "network": "noble-1",
        "token": {
          "amount": 27.18,
          "symbol": "USDC",
          "usd": 27.24
        }
      },
      "sender_tx_hash": "76b992...",
      "receiver_tx_hash": "e607db..."
    }
  ],
  "meta": {
    "next_cursor": null,
    "previous_cursor": null,
    "first_page_cursor": "eyJpZCI6...",
    "last_page_cursor": null,
    "total_count": 100,
    "page_number": 1
  }
}
```

Schema concern: `TransferDto` examples show `sender.address`, `sender.network`, and `sender.token`, but the referenced `AccountDto` schema does not require those top-level fields. Treat them as documented examples, not guaranteed required fields.

Amount concern: the documented transfer shape does not expose raw integer amount or decimals. It only shows decimal token amount in examples. Do not derive `amountRaw` from decimal `token.amount` unless a live authenticated fixture or a separate token-decimals endpoint makes that conversion deterministic.

### Address Risk Success

`GET /v1/risk/address` returns:

```json
{
  "riskScore": 10,
  "riskLevel": "CRITICAL RISK (Directly malicious)",
  "numHops": 0,
  "maliciousAddressesFound": [
    {
      "address": "AuZr...",
      "distance": 0,
      "name_tag": "Layering, Swapping",
      "entity": null,
      "category": "hack_funds"
    }
  ],
  "reasoning": "Address is directly flagged for malicious activity."
}
```

`GET /v2/risk/address` returns a different assessment shape:

```json
{
  "screen_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "address": "0x742d...",
  "network": "ethereum",
  "tier": "high",
  "exposure": {
    "triggered": [],
    "score_contribution": 72
  },
  "behaviour": {
    "detected": [],
    "score_contribution": 15
  },
  "scored_at": "2026-05-04T14:30:00Z"
}
```

### Documented 401

The auth docs document this error body:

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Invalid or missing API key"
}
```

Observed live no-key probes for `/v2/transfers` and `/v1/risk/address` returned HTTP 401 with an empty body. Tests should accept empty or JSON error bodies.

### Documented 429

The auth docs document this error body:

```json
{
  "statusCode": 429,
  "message": "Too Many Requests",
  "error": "Rate limit exceeded. Please try again later."
}
```

The risk docs additionally mention `Retry-After` for 429 backoff, but the Risk API rate-limit page leaves exact response-header documentation as `[To Do]`.

## Normalized Mapping

Transfer mapping, only for rows with the documented fields present:

| Range field | `CrossChainTransfer` field | Notes |
|---|---|---|
| `id` | `id` | Prefer `range:<id>` for provider uniqueness. |
| `type` | `protocol` | Examples: `cctp`, `ibc`. |
| `sender.network` | `source.chainId` | Store provider network string. Map to internal `chain` only through a local network map. |
| `sender.address` | `source.address` | Required for useful normalization, but not required by `AccountDto`. |
| `receiver.network` | `destination.chainId` | Store provider network string. |
| `receiver.address` | `destination.address` | Required for useful normalization, but not required by `AccountDto`. |
| `sender_tx_hash` | `sourceTxHash` | Use `null` if absent. |
| `receiver_tx_hash` | `destinationTxHash` | Use `null` if absent. |
| `sender.token.symbol` or `receiver.token.symbol` | `assetSymbol` | Documented in examples only. |
| raw amount | `amountRaw` | TBD. No documented raw integer transfer amount in `TransferDto`. |
| token decimals | `decimals` | TBD. No documented transfer decimals in `TransferDto`. |
| `time` | `timestamp` | ISO timestamp string. |
| `status`, `type`, sender/receiver labels/tags if present | `labels` | Keep simple strings only. |
| response/query context | `payloadRef` | See below. |

Provider payload refs:

```ts
{
  id: "range:/v2/transfers:tx_hash:<txHash>",
  provider: "range",
  endpoint: "/v2/transfers",
  fetchedAt: "<ISO timestamp>"
}
```

For address transfer lookup, use `range:/v2/transfers:address:<network-or-all>:<address>`.

For risk lookup:

```ts
{
  id: "range:/v1/risk/address:<network>:<address>",
  provider: "range",
  endpoint: "/v1/risk/address",
  fetchedAt: "<ISO timestamp>"
}
```

Risk v1 mapping to `ProviderRiskSnapshot`:

| Range field | `ProviderRiskSnapshot` field | Notes |
|---|---|---|
| request `address`, `network` | `address` | Convert network to `CrossChainAddress` with the same map used for transfers. |
| `riskScore` | `riskScore` | Use only when numeric. |
| `riskLevel`, `reasoning`, malicious evidence labels/categories | `labels` | Keep explanatory labels; do not turn them into hard proof by themselves. |
| risk response payload context | `payloadRef` | Use `/v1/risk/address` payload ref. |

## Endpoint Path Constants

Use these exact path constants for the adapter:

```ts
export const RANGE_ENDPOINT_PATHS = {
  transfersByTx: "/v2/transfers",
  transfersByAddress: "/v2/transfers",
  addressRisk: "/v1/risk/address"
} as const;
```

Rationale:

- `transfersByTx` and `transfersByAddress` share `/v2/transfers` because official docs expose filters, not separate endpoint paths.
- `addressRisk` uses `/v1/risk/address` because the current provider type expects a numeric `riskScore`.
- If the product later wants the richer Risk v2 evidence model, add a separate constant or adapter path for `/v2/risk/address` and update the normalized type explicitly.

## Implementation Concerns

The docs are accessible, but transfer normalization is not production-complete from docs alone:

1. `GET /v2/transfers` does not document raw integer transfer amounts or token decimals, while `CrossChainTransfer.amountRaw` and `decimals` require them.
2. `TransferDto` examples show `sender.address`, `sender.network`, and token fields, but the referenced `AccountDto` schema does not require them.
3. Data API and Risk API network identifiers are not fully consistent across docs. Data API examples use values such as `ethereum`/`arbitrum` in one page and `eth` in another; Risk v1 docs list `eth` and `arb1`.
4. Endpoint specs only list a 200 response for `/v2/transfers`; 401 and 429 shapes come from auth/general docs, and live no-key probes returned empty 401 bodies.

Conservative recommendation: implement URL construction and error handling behind injected `fetch` and injected endpoint paths first. Keep normalization fixture-driven until one authenticated, sanitized Range response for `/v2/transfers?tx_hash=...` and one for `/v2/transfers?address=...&scope=INTERCHAIN` confirms the actual address, token amount, raw amount, and decimals fields.
