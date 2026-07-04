---
status: current
last_verified: 2026-07-03
owner_area: docs
code_refs:
  - src/types.ts
  - src/forensics/moneyOriginTrace.ts
  - src/risk/unifiedWalletRisk.ts
supersedes:
  - docs/project-walkthrough/09-glossary-plain-language.md
---

# Glossary

## hop

One step in a money path. If A sends to B and B sends to C, then B is a hop
between A and C.

## path

A chain of transfers used to explain where money came from or where it went.

## source

The earlier address, service, or boundary that appears to have supplied the
funds.

## boundary

A point where the public-chain path can honestly stop because the next source
is inside a service, exchange, bridge, router, or contract.

## service boundary

A boundary caused by a known service-like address or contract. This is not the
same as missing data.

## coverage

How much required evidence was actually fetched and checked.

## missing checks

Checks the system wanted to run but could not complete. Missing checks are not
risk by themselves.

## score_valid

Whether the score can be used as a final forensic result.

## technical stop

A non-risk stop where the system cannot publish a valid score because required
data was not covered or a provider/runtime limit blocked completion.

## provider cap

A provider-side range or result cap that prevents one wide request from
returning all rows. The correct response is usually narrower time windows.

## partial_budget_exhausted

Our local budget ran out. This is not proof that TronScan cannot provide the
data.

## hard evidence

Deterministic bad evidence such as exact bad provenance, active blacklist,
sanctioned/high-risk source, or exact approval-drain proof.

## policy floor

A scoring rule that sets a minimum score when a strong policy signal exists.
