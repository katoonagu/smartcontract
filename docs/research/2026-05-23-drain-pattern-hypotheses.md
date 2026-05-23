# Drain Pattern Hypotheses for TRON USDT Approval Guard

Date: 2026-05-23

## Summary

`transferFrom` is not a scam signal by itself. Bridges, routers, DEXes, staking and payment contracts can legitimately use approvals and spender-initiated transfer mechanics. A useful drain detector must be a composite detector: approval risk, spender identity, caller behavior, receiver behavior, timing, and victim fan-out.

For the three local approval fixtures, the distinction is clear:

| Case | Owner | Spender | Provider identity | Approval | After-approval behavior | Suggested result |
|---|---|---|---|---|---|---|
| 320k victim | `TDwx...4s8d` | `TMou...e2Lj` | unnamed EOA, `accountType=0`, not contract | unlimited USDT, signed ~52h before block | spender called USDT `transferFrom` twice, total `321,952.45032 USDT`, to one receiver `TPhaah...7Ep4`, first drain ~63.46h after approval | `CRITICAL` |
| Bridgers | `TLhV...AgXe` | `TPwez...Et5s` | `Bridgers`, `Bridgers:Cross-chain Bridge`, contract, provider `risk=false` | unlimited USDT | no spender-signed USDT `transferFrom` in sampled outgoing after approval; owner-initiated contract calls to Bridgers | `LOW` / service review |
| tokenApprove | `TLhV...AgXe` | `TNKG...pxQ5` | `tokenApprove`, contract, no service tag, provider `risk=false`, not verified in contract search | unlimited USDT | no spender-signed USDT `transferFrom` in sampled outgoing after approval | `MEDIUM` / dashboard review |

## Live TronScan Contract Comparison

The useful distinction is not only `contract` vs `EOA`. TronScan metadata, method maps, service tags and activity shape create a much better false-positive guard.

### Bridgers `TPwez...Et5s`

Observed provider/API evidence:

- `name=Bridgers`.
- `tag1/publicTag=Bridgers:Cross-chain Bridge`.
- `blueTag=Bridgers`, `blueTagUrl=bridgers.xyz`.
- `accountType=2`, `isContract=true`.
- `verify_status=2`, source verified.
- `activeDay=671`.
- Method map contains service-like methods:
  - `swapEth(string,string,uint256)`;
  - `swap(address,string,string,uint256,uint256)`;
  - `withdraw(address,address,uint256)`;
  - `withdrawETH(address,uint256)`.
- TronScan calling overview shows high service-like activity:
  - `recentCallTimes=224,309`;
  - top caller present;
  - public UI shows method distribution dominated by `Withdraw`, `Swap`, `WithdrawETH`, `SwapEth`.
- TRC20 and internal-transaction queries show large active service volume.

Interpretation:

- This is a service-tagged, verified, active bridge/swap contract.
- Approval to Bridgers should be LOW unless exact malicious evidence overrides it.
- If a later `transferFrom` is observed through this contract, that observation should be stored, but it must not auto-escalate to CRITICAL. Bridge/router contracts can legitimately pull approved USDT and route it to a vault, pool, or settlement address.

### tokenApprove `TNKG...pxQ5`

Observed provider/API evidence:

- `name=tokenApprove`.
- `accountType=2`, `isContract=true`.
- No service tag.
- `verify_status=0`.
- Empty or unavailable method map.
- Very low activity in sampled account/contract data.
- No TRC20 transfers for `relatedAddress` in the sampled query.
- No service-shaped calling overview like Bridgers.

Interpretation:

- This is not the same class as Bridgers.
- It is a named smart contract but not a verified/tagged service contract.
- Approval should stay MEDIUM / dashboard review unless later behavior confirms drain or exact labels mark it risky.

### BUYTRX `SwapTRX` `TRnru...PJ8`

Observed public-report evidence:

- PhishDestroy identifies `TRnruCYe2k3kSMYCGwM51rzDD591w7UPJ8` as a BUYTRX approval drainer contract.
- The report says victims were shown a fake USDT-to-TRX swap but signed official USDT `approve(MAX_UINT256)`.
- TronScan metadata observed through API:
  - `name=SwapTRX`;
  - no service tag;
  - `accountType=2`, contract;
  - `verify_status=0`;
  - method map includes `pullFunds(address,address,uint256)`;
  - low/sparse contract call stats compared with real service contracts.

Important policy correction:

- A service-like `name` such as `SwapTRX`, `tokenApprove`, `Exchange`, `Claim`, or `Bonus` is not a trusted service tag.
- Service dampening must be based on provider tag/internal label/evidence, not on name keywords alone.
- Without a public-report/internal risky label this should not be LOW. With the public report imported as an internal `risky_contract`/`phishing` label, it should be CRITICAL.

### Victim spender `TMou...e2Lj`

Observed case evidence:

- `accountType=0`, not a contract.
- No service tag/name.
- Unlimited USDT approval from watched wallet.
- Approval transaction had delayed signed timestamp and extended expiration context.
- Later the spender address itself called USDT `transferFrom` twice:
  - from watched wallet `TDwx...4s8d`;
  - to separate receiver `TPhaah...7Ep4`;
  - total `321,952.45032 USDT`;
  - first observed spender pull about `63.46h` after approval.

Interpretation:

- This is the clean approval-drain positive fixture.
- The spender may have little/no balance and still be the attacker-controlled caller. Do not score by spender balance.

## Phase 9.1 Detector Rule Refinement

The base observation to search for is:

```text
caller == approval.spender
method == transferFrom
token == official TRON USDT
Transfer event from == watched wallet
Transfer event to != approval.spender
amount >= configured threshold
```

This is a strong observation, but not a standalone conviction rule.

Why it can false-positive:

- A DEX/router can call `transferFrom(user, pair, amount)`, so `to != spender` is normal.
- A bridge can call `transferFrom(user, vault, amount)`, so `to != spender` is normal.
- A payment processor or settlement contract can pull approved USDT to a merchant/settlement wallet.
- Staking/lending wrappers can route funds through proxy/vault addresses.

Therefore the detector must score the base observation with identity and behavior context:

| Context | Effect |
|---|---|
| Spender is unknown EOA | Strong escalation |
| Spender is unverified/untagged contract | Medium/high escalation depending amount and receiver |
| Spender is service-tagged verified contract | Dampener; observation only unless other evidence exists |
| Receiver is untagged EOA / collector candidate | Escalation |
| Receiver is known pool/vault/bridge/market | Dampener |
| Approval was unlimited/stale/delayed-signed | Escalation |
| Amount is near-full wallet balance | Strong escalation |
| Same tx/window returns swap/bridge/receipt asset to wallet | Dampener |
| No counterflow and funds consolidate onward | Escalation |

Initial alert policy:

- `CRITICAL`: unknown EOA spender + transferFrom from watched wallet to separate untagged receiver + large amount, especially with stale/unlimited approval or near-full-balance pull.
- `HIGH`: unverified/untagged contract spender + transferFrom to separate receiver + large amount + no service/counterflow evidence.
- `MEDIUM`: named contract without service tag or incomplete metadata; store in Safety/Risk intel first.
- `LOW`: service-tagged verified contracts such as Bridgers, unless exact malicious label or confirmed drain cluster overrides.

## Public Case Evidence

Sources reviewed:

- Chainalysis, approval phishing growth and on-chain pattern: https://www.chainalysis.com/blog/approval-phishing-cryptocurrency-scams-2023/
- Scam Sniffer, Inferno Drainer: https://drops.scamsniffer.io/5-9-million-stolen-by-scam-as-a-service-provider-called-inferno-drainer/
- Scam Sniffer, Pink Drainer: https://drops.scamsniffer.io/pink-drainer-steals-3m-from-multiple-hack-events-including-openai-cto-orbiter-finance/
- Revoke.cash approval exploit examples: https://revoke.cash/exploits
- PhishDestroy, TRON BuyTRX drainer teardown: https://phishdestroy.io/buytrx-drainer-exposed

Public cases support these general patterns:

- Victim signs an approval or malicious permission.
- Approved spender or malicious call path moves funds later.
- Destination wallet is often separate from the spender.
- Large campaigns involve many victims and collection/consolidation wallets.
- Some attacks use fake sites and impersonated brands.
- Some attacks involve legitimate protocols or compromised/vulnerable contracts, so `contract` or `known project` is not enough to mark safe.

## Hypothesis Review

### 1. Spender is unknown EOA or unknown/unverified contract

Status: strong signal, but different strength by type.

- Unknown EOA for USDT approval is a strong risk signal. Normal bridges/routers/DEX flows usually approve a contract, not a plain wallet.
- Unknown/unverified contract is weaker than EOA. It can be a new legitimate service, proxy, or untagged contract.
- Provider service tags can reduce risk, but should not erase evidence entirely.

Local evidence:

- Victim spender `TMou...e2Lj`: EOA, no name, no tag, later called `transferFrom`. Strong positive.
- Bridgers spender: named/tagged contract. Strong false-positive guard.
- tokenApprove spender: named contract without service tag. Medium uncertainty.

Recommended scoring:

- EOA + unlimited USDT approval: high base risk.
- EOA + delayed signed tx or later spender-initiated transferFrom: critical.
- Named service contract with service tag and provider risk=false: low.
- Named contract without service tag: medium.
- Unknown/unverified contract: high only when combined with large/unlimited approval or behavior.

### 2. Many different owners gave approval to the same spender

Status: useful only with identity and behavior context.

This is a campaign/fan-out signal, but it has major false positives. Bridgers, routers, DEXes and staking contracts are expected to have many approving owners.

Recommended usage:

- Count only owners that also show suspicious downstream behavior: spender-initiated drains, same collector, near-total balance sweeps, or no service identity.
- Do not increase risk for service-tagged contracts only because many owners approved them.

### 3. Spender quickly takes all or almost all USDT balance

Status: strong when measurable, but requires balance context.

This is much better than `transferFrom exists`. The real signal is sweep-like behavior: spender pulls a high share of available balance shortly after approval, especially without a normal service tag.

Current gap:

- The bot does not store pre-drain balance snapshots.
- It can estimate via live TronScan queries, but this needs an ingestion table for reliable scoring.

Recommended usage:

- Soft signal: transferFrom amount is very large relative to recent wallet activity.
- Strong signal later: transferFrom amount is >= 80-95% of USDT balance immediately before drain.

### 4. Receiver looks like collector wallet, not bridge/router/DEX pool

Status: strong, but needs receiver classification.

In the victim fixture, both spender-initiated transferFrom calls go to `TPhaah...7Ep4`, a separate receiver. This matches the approval phishing pattern described by Chainalysis: approved spender initiates movement to a separate destination.

Current gap:

- The bot does not classify receivers yet.
- It does not store outgoing transfer graph or downstream hops.

Recommended usage:

- Receiver is same known service contract or pool: reduce suspicion.
- Receiver is unnamed EOA collecting from many owners: increase suspicion.
- Receiver later sends to exchange/bridge/new wallets: graph-forensics layer, not MVP.

### 5. Funds are split or move onward to CEX/bridge/new wallets

Status: useful for investigation, not first-line MVP scoring.

This requires graph traversal and external/entity labels. It is valuable after an incident or for compliance review, but it is too large for the current Approval Guard MVP.

Recommended usage:

- Store as planned case-forensics signal.
- Do not block Phase 8.x on this.

### 6. Spender has many same-shaped transferFrom calls from different victims

Status: strong with service exclusion.

This is close to campaign detection. But it must exclude service-tagged contracts. Bridgers or routers can also have many repeated calls from many users.

Recommended usage:

- Only count as suspicious if spender has no service tag/name or has provider risk/risky label.
- Require same receiver cluster or sweep-like amounts.
- Use as `approval_spender_victim_fanout`, not as standalone `CRITICAL`.

### 7. No normal service tag/name

Status: useful negative evidence.

No tag/name should not prove scam, but it prevents auto-dampening. A named service tag such as `Bridgers:Cross-chain Bridge` is useful as a false-positive reducer.

Recommended usage:

- Service tag: dampen to low if provider risk=false and behavior is not drain-like.
- Named contract without service tag: medium.
- No name/tag: keep high when approval is large/unlimited.

### 8. Raw tx was signed ahead of time / delayed broadcast

Status: strong contextual signal, especially with EOA approval.

Victim fixture:

- raw signed timestamp: `2026-05-04T15:06:28.559Z`
- on-chain block time: `2026-05-06T19:06:15Z`
- delay: about 52 hours
- expiration: `2026-05-06T21:07:27Z`

Bridgers and tokenApprove fixtures:

- signed and block times are close.
- expiration window is about 10 hours, not multi-day.

Recommended usage:

- Delayed signed approval is not enough alone, but it is strong when combined with unknown EOA or later drain.
- Store signed time, expiration and ref block metadata in evidence.

### 9. Spender/receiver already exists in risky labels

Status: strongest deterministic signal.

Manual labels remain important, but they should not be the only way to scale. Provider metadata, service tags, and behavior should reduce manual burden.

Recommended usage:

- `scam`, `phishing`, `stolen_funds`, `risky_contract`: critical.
- `trusted`, `false_positive`, `bridge`, `exchange`: dampen, but do not hide in Safety.

## Current Bot Capability

Can compute today:

- Current USDT approvals.
- Unlimited/finite amount.
- Spender type: EOA, contract, unknown.
- TronScan metadata: name, tag, is contract, account type, verification/risk when contract search returns it.
- Raw transaction signing metadata from full node: signed timestamp, expiration, ref block bytes/hash.
- Approval risk score/reasons.

Can query live but does not store yet:

- Outgoing USDT transfers after approval.
- Contract caller/signer from tx info.
- Whether call selector is USDT `transferFrom` (`23b872dd`) or direct transfer (`a9059cbb`).
- Approval-to-transfer delay.
- Receiver address for spender-initiated transferFrom.

Cannot compute reliably from DB today:

- Historical outgoing transferFrom patterns.
- Many-victim fan-out by spender.
- Collector wallet clusters.
- Balance share swept.
- Downstream CEX/bridge/new-wallet routing.

## Recommended Next Phase

Phase 8.4 should be called `Approval Drain Observation`, not `Drain Detector` yet.

Scope:

- Add a read-only observation layer that can query recent outgoing USDT transfers after an approval.
- Decode method selector from transaction info:
  - `095ea7b3`: approve
  - `23b872dd`: transferFrom
  - `a9059cbb`: transfer
- Detect whether `contractData.owner_address` equals approval spender.
- Store observations in a new table, but use them as evidence first.

Initial scoring:

- Unknown EOA + unlimited + delayed signed tx: `CRITICAL`.
- Unknown EOA + spender-initiated transferFrom from owner to separate receiver: `CRITICAL`.
- Service-tagged contract + normal owner-initiated service calls: stay `LOW`.
- Named contract without service tag + no transferFrom by spender: `MEDIUM`.
- Any service-tagged contract with spender-initiated transferFrom: do not auto-critical; flag `service_transferFrom_observed` as review evidence only.

Non-goals:

- Do not classify all `transferFrom` as scam.
- Do not build full graph tracing yet.
- Do not auto-label Bridgers/router/DEX fan-out as malicious.
- Do not use Revoke.cash as a TRON revoke action.
