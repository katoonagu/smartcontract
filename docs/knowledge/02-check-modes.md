---
status: current
last_verified: 2026-07-03
owner_area: forensics
code_refs:
  - src/index.ts
  - src/check/deepForensicCheck.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/incomingDepositJob.ts
  - src/risk/unifiedWalletRisk.ts
supersedes:
  - docs/project-walkthrough/06-check-modes-fast-deep-where-is-money.md
---

# Check Modes

## Rule

Do not collapse all checks into one mode. The checks are separate because they
answer different questions.

They may share the same TronScan key pool, local transfer index, labels, and
job infrastructure.

## Fast Check

Question:

```text
Are there obvious risk signals for this wallet right now?
```

Fast check is a first look. It should be quick. It does not prove the full
origin of funds.

It looks at direct context, obvious labels, metadata, known service exposure,
and immediate risk signals.

## Deep Check

Question:

```text
What is the wider forensic profile of this wallet?
```

DeepCheck studies the wallet and important counterparties. It may inspect direct
neighbors, selected second-layer relationships, services, contracts, drainers,
exchanges, and hard evidence.

DeepCheck is not the same as `Where is money`. It builds context and evidence,
not necessarily exact source-of-funds proof for a chosen amount.

## Where Is Money

Question:

```text
Where did the relevant funds on this wallet come from?
```

This mode explains balance-forming or selected recent-flow funds. It follows
money paths backwards until it reaches source evidence, a legitimate service
boundary, or the configured depth limit.

If the path stops because we did not fetch enough history, the system should
continue indexing instead of treating that as a final paid result.

## Incoming Deposit

Question:

```text
Can we trust this concrete incoming deposit?
```

This mode starts from one deposit transaction. It looks at the sender and the
sender's funding path before the deposit.

The result must explain the concrete deposit, not the whole biography of the
receiver wallet.

## Unified `/check`

Unified `/check` composes the address-level result from fast check, deep check,
and `Where is money`.

It should not publish a final wallet risk score as fully valid if the main
money-origin path required for that score is not covered.
