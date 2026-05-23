# Phase 9.1: Approval Drain Observation

## Summary

Add a research-backed, read-only observation layer for confirmed TRON USDT approval drains. This phase does not build full graph forensics and does not call every `transferFrom` malicious. It defines the evidence needed to distinguish the 320k victim-style EOA drainer from normal bridge/router/service flows such as Bridgers.

The key correction from the 320k case: do not inspect the spender balance as proof. The spender can be a low-balance caller that invokes USDT `transferFrom` and sends funds to a separate collector.

## Base Observation

Detect candidate approval-drain movement only when all of these are true:

```text
caller == approval.spender
method == transferFrom
token == official TRON USDT
Transfer event from == watched wallet
Transfer event to != approval.spender
amount >= configured threshold
```

This is evidence, not a verdict. DEXes, bridges, routers, payment processors and vaults can legitimately match the same mechanics.

## Fixture Comparison

| Fixture | Spender identity | Approval | Post-approval behavior | Target result |
|---|---|---|---|---|
| 320k victim | EOA, no service tag/name | unlimited USDT, delayed signed tx context | spender called USDT `transferFrom` twice from watched wallet to separate receiver, total `321,952.45032 USDT` | `CRITICAL` |
| Bridgers | verified service contract, `Bridgers:Cross-chain Bridge`, method map has swap/withdraw methods, high service activity | unlimited USDT | bridge/router-like service behavior; `transferFrom`-like movement must be treated as service evidence unless other risk exists | `LOW` / service review |
| tokenApprove | named contract, no service tag, unverified/no method map in sampled metadata, sparse activity | unlimited USDT | no confirmed spender drain in sampled data | `MEDIUM` dashboard review |

## Evidence Fields

For each candidate observation, store:

- watched wallet;
- approval tx hash and approval timestamp;
- spender address and spender metadata snapshot;
- transfer tx hash;
- caller/owner address from transaction trigger info;
- function selector / decoded method;
- token contract;
- transfer event `from`, `to`, and raw amount;
- decoded USDT amount;
- time from approval to transfer;
- receiver metadata snapshot;
- whether spender is EOA, verified contract, service-tagged contract, or unknown/unverified contract;
- whether receiver is EOA, known service/pool/vault, or unknown;
- optional same-tx/window counterflow evidence.

## Scoring Policy

- `CRITICAL`: unknown EOA spender + candidate `transferFrom` + separate untagged receiver + large amount, especially with unlimited/stale/delayed-signed approval.
- `HIGH`: unverified/untagged contract spender + candidate `transferFrom` + large amount + no service/counterflow evidence.
- `MEDIUM`: named contract without service tag or incomplete metadata; show in Safety/Risk intel unless behavior strengthens.
- `LOW`: verified service-tagged bridge/router/lending/payment processor with expected methods/receiver context.

Never escalate solely because:

- `transferFrom` exists;
- `to != spender`;
- many owners approved one spender;
- spender has high volume;
- bridge/router/service tag exists.

## False-Positive Guards

- Service tag/name from TronScan or internal labels.
- Verified contract source and decoded method map.
- Service-shaped method distribution: swap, withdraw, deposit, bridge, add/remove liquidity.
- Receiver is expected pool/vault/bridge/market contract.
- Watched wallet initiated a service call in the same transaction/window.
- Counter-asset, receipt token, bridge mint, LP token or settlement return is observed.

## Data Sources To Validate

- TronScan Account/Contract API:
  - account type / contract status;
  - `name`, `tag1`, `publicTag`, `blueTag`, `feedbackRisk`, `verify_status`;
  - method map;
  - top callers / calling overview.
- TronScan transactions and TRC20 transfers:
  - recent transactions;
  - trigger info;
  - token transfer event data.
- Fullnode:
  - raw transaction timestamp;
  - expiration;
  - ref block fields;
  - transaction info logs.
- Dune:
  - official USDT `Approval` and `Transfer` event tables;
  - batch research for spender fan-out and approval-to-transfer timing.

## Implementation Roadmap

1. Research fixtures:
   - keep the three current fixtures;
   - add 5-10 service-tagged bridge/router approvals;
   - add 5-10 unknown EOA unlimited approvals;
   - add 5-10 named/unverified contract approvals.
2. Add observation table design:
   - candidate transferFrom observations;
   - spender/receiver metadata snapshots;
   - evidence IDs linked to approval events.
3. Add detector in shadow mode:
   - compute observations;
   - write evidence;
   - do not change live alerts except for already-CRITICAL EOA cases.
4. Add Safety/Risk intel display:
   - show candidate drain observations with exact tx links;
   - show why service false-positive guards dampened risk.
5. Promote scoring:
   - only after fixture regression tests prove Bridgers-like services remain LOW.

## Acceptance Criteria

- The victim fixture is detected as EOA approval drain candidate.
- Bridgers-like service approval is not auto-marked CRITICAL.
- tokenApprove-like approval remains MEDIUM unless behavior confirms drain.
- Each non-LOW reason has stored evidence and exact tx links.
- No signing, revoke, wallet control, private key, or seed handling is added.
