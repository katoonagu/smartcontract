# Bot Runtime Hardening Design

## Summary

This spec combines two related reliability fixes into one implementation track:

1. **TronScan rate-limit resilience**: the bot has a multi-key scheduler, but live logs still show repeated `429` from TronScan because total process traffic can burst above the likely per-IP/per-endpoint quota.
2. **Smart contract address checks**: manual `/check <address>` treats a smart contract address like a regular EOA wallet and can return `LOW 0/100`, even when the address is an unverified approval spender contract.

These are separate tasks, but they should be shipped together because both affect user trust in Telegram checks:

- rate-limit problems make results delayed or incomplete;
- contract misclassification makes results misleading.

## Problem A: TronScan 429 Despite Multi-Key

Observed after bot restart:

```text
tronscan_scheduler_configured apiKeyConfigured=true apiKeyCount=2
tronscan_rate_limit_cooldown request_name=transfer path=/api/token_trc20/transfers
trongrid_transfer_history_fallback error="Tronscan transfer request failed: 429"
```

This means comma-separated keys are parsed and the pool exists. The issue is that the scheduler currently paces mostly per API-key slot. With two keys and `TRONSCAN_REQUEST_MIN_INTERVAL_MS=220`, total process throughput can approach about `9 rps`. If TronScan applies an IP-level or endpoint-level limit around `5 rps`, the second key does not fully solve it.

Log sampling also showed request bursts of `7-8` requests per second across:

- `/api/token_trc20/transfers`;
- `/api/account/approve/list`;
- `/api/account/approve/change`;
- `/wallet/gettransactionbyid`.

Startup makes this worse because several loops begin together:

- wallet polling;
- where-is-money worker;
- incoming-deposit worker;
- deep forensic worker;
- approval polling.

Important implementation detail: delaying only the first manual `pollOnce()` / `whereForensicOnce()` calls is not enough. Existing `setInterval` timers would still start from process boot. With `FORENSIC_WHERE_POLL_INTERVAL_MS=2000`, where/incoming workers could fire before a `FORENSIC_WHERE_START_DELAY_MS=3000` startup delay. The implementation must delay creation of the repeating interval itself, or guard interval execution until the configured start time has passed.

### Rate-Limit Goals

- Keep multi-key support.
- Add global process-level pacing.
- Add endpoint-bucket pacing.
- Apply `429` cooldown to the selected key slot, global limiter, and endpoint bucket.
- Stagger startup workers.
- Log safe diagnostics: `api_key_index` and `endpoint_bucket`, never the raw key.
- Keep the `tronscan_rate_limit_cooldown` warning event for observability, but make scheduler state the only source of cooldown behavior.
- Preserve TronGrid fallback, but stop relying on fallback as normal control flow.

### Proposed Rate-Limit Env

```text
TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS=280
TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS=350
TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS=300
TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS=300
TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS=300
TRONGRID_REQUEST_MIN_INTERVAL_MS=250

POLL_START_DELAY_MS=0
FORENSIC_WHERE_START_DELAY_MS=3000
FORENSIC_INCOMING_START_DELAY_MS=6000
FORENSIC_DEEP_START_DELAY_MS=12000
```

Keep:

```text
TRONSCAN_REQUEST_MIN_INTERVAL_MS=220
TRONSCAN_RATE_LIMIT_COOLDOWN_MS=30000
```

Meaning:

- `TRONSCAN_REQUEST_MIN_INTERVAL_MS`: per-key slot pacing.
- `TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS`: all TronScan traffic from this process.
- endpoint interval vars: hot endpoint pacing.
- startup delays: avoid restart bursts.

### Scheduler Model

Add endpoint buckets:

```ts
export type TronscanEndpointBucket =
  | "transfer"
  | "approval"
  | "contract"
  | "fullnode"
  | "trongrid"
  | "default";
```

For each request, readiness is:

```text
max(
  keySlot.nextRequestAtMs,
  keySlot.cooldownUntilMs,
  global.nextRequestAtMs,
  global.cooldownUntilMs,
  endpoint.nextRequestAtMs,
  endpoint.cooldownUntilMs
)
```

On success:

```text
keySlot.nextRequestAtMs = now + perKeyInterval
global.nextRequestAtMs = now + globalInterval
endpoint.nextRequestAtMs = now + endpointInterval
```

On `429`:

```text
keySlot.cooldownUntilMs = now + cooldown
global.cooldownUntilMs = now + cooldown
endpoint.cooldownUntilMs = now + cooldown
```

### Client Bucket Mapping

```text
transfer, transaction_history -> transfer
approval_list, approval_change -> approval
contract_list, contract_detail, contract_top_call, contract_search, contract_events -> contract
transaction, raw_transaction, stablecoin_contract_state, stablecoin_blacklist_event -> fullnode
trongrid_transfer_history -> trongrid
other -> default
```

`TronscanScheduler` should become the single authoritative limiter. Legacy `TronscanClient` fields such as `requestQueue`, `nextRequestAtMs`, and `rateLimitCooldownUntilMs` should be removed after scheduler wiring is complete.

## Problem B: Smart Contract Address Treated as Wallet

For `TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5`, TronScan metadata says:

```text
isContract: true
name: tokenApprove
verified: false
accountType: 2
txCount: 2
topMethods: []
hasTransferFromSelector: false
activityLevel: low
serviceTag: none
```

But manual `/check TNKG...` can run the normal wallet fast check and return:

```text
Risk: 0/100 LOW
Reasons: none
```

This is wrong UX. A smart contract is not a wallet, and if it is used as an active unlimited USDT approval spender, the user needs an approval-safety answer.

### Smart Contract Check Goals

- `/check <address>` must fetch metadata before normal wallet reporting.
- If `metadata.isContract === true`, route to `Smart contract check`.
- Do not queue wallet-profile where-is-money or address-deep jobs for standalone contract checks.
- Enrich the contract report with:
  - metadata;
  - contract intelligence profile;
  - deterministic service classification;
  - watched-wallet approvals where this contract is spender;
  - optional LLM verdict.
- LLM gets a concrete standalone contract case file, not a vague "is scam?" prompt.
- LLM cannot claim exact drain without deterministic facts.

### Smart Contract User Report

English:

```text
Smart contract check

Decision: DECLINE (approval safety)
Contract risk: 45/100 (MEDIUM)

Contract: TNKG...
Name: tokenApprove
Verified source: no
Service label: none
Activity: low

Meaning
• This is a smart contract, not a regular wallet.
• Exact theft is not proven by this standalone check.
• The contract has no verified source or has weak public metadata.
• Your watched wallets have an active unlimited USDT approval to this contract.

Seen in your approvals
• TLhVzk... gave unlimited USDT approval to this contract.
```

Russian:

```text
Проверка смарт-контракта

Решение: DECLINE (безопасность approval)
Риск контракта: 45/100 (MEDIUM)

Контракт: TNKG...
Название: tokenApprove
Исходный код: нет
Метка сервиса: нет
Активность: низкая

Что это значит
• Это смарт-контракт, не обычный кошелёк.
• Точная кража в этой отдельной проверке не доказана.
• У контракта нет проверенного исходного кода или мало публичных данных.
• В ваших кошельках есть активный unlimited USDT approval на этот контракт.

Где найден
• TLhVzk... дал unlimited USDT approval этому контракту.
```

### Smart Contract Scoring

Known verified service contract:

```text
ACCEPTABLE, 5-20
```

Unknown contract, no approval relation, no hard evidence:

```text
ACCEPTABLE, 25-35
```

Unknown/unverified contract used as active unlimited USDT approval spender:

```text
DECLINE for approval safety, 40-55
```

Suspicious standalone contract with stronger signals:

```text
DECLINE, 65-80
```

Exact deterministic approval-drain:

```text
DECLINE, 95-100
```

Standalone LLM text alone must not create exact-drain proof.

### Standalone Contract LLM Case File

LLM receives:

```json
{
  "policyVersion": "2026-06-01-standalone-contract-check-v1",
  "subjectAddress": "TNKG...",
  "contractAddress": "TNKG...",
  "metadata": {
    "name": "tokenApprove",
    "isContract": true,
    "verified": false,
    "tag": null
  },
  "contractProfile": {
    "sourceStatus": "missing",
    "txCount": "2",
    "activityLevel": "low",
    "topMethods": [],
    "methodMap": {},
    "hasTransferFromSelector": false
  },
  "serviceClassification": null,
  "relatedApprovals": [
    {
      "ownerAddress": "TLhVzk...",
      "token": "USDT",
      "status": "active",
      "isUnlimited": true,
      "riskScore": 45
    }
  ],
  "knownLimitations": [
    "standalone contract check has no money path",
    "no exact transferFrom drain proof was collected in this mode"
  ],
  "policyQuestion": "Classify this standalone smart contract for approval safety. Do not claim exact drain unless provided facts prove approve -> transferFrom -> funds movement."
}
```

## Combined Acceptance Criteria

### Rate Limit

1. Config parses new global, endpoint, and startup-delay env vars.
2. Scheduler diagnostics include global and endpoint cooldowns.
3. Request logs include `api_key_index` and `endpoint_bucket`, never raw API keys.
4. Multi-key distribution still works.
5. Global limiter prevents two keys from producing process-level bursts.
6. Endpoint limiter slows repeated transfer/approval bursts.
7. `429` cooldown affects key slot, global limiter, and endpoint bucket.
8. Startup workers are staggered.
9. Startup worker intervals do not fire before their configured start delays.
10. Live idle monitoring no longer repeatedly falls back to TronGrid because of TronScan `429`.

### Smart Contract Check

1. `/check TNKG...` does not show normal wallet `LOW 0/100` if metadata says `isContract: true`.
2. Contract inputs show `Smart contract check` / `Проверка смарт-контракта`.
3. Contract checks do not queue wallet-profile where-is-money and deep jobs.
4. Known service contracts can be `ACCEPTABLE`.
5. Unknown unverified active unlimited approval spenders are `DECLINE for approval safety`, not "exact scam proven".
6. Reports separate contract risk, approval safety, exact drain proof, and LLM verdict.
7. LLM gets concrete facts and cannot turn missing source alone into exact drain proof.
8. Normal EOA `/check` behavior stays unchanged.
