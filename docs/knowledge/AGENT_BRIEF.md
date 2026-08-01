---
status: current
last_verified: 2026-07-28
owner_area: docs
code_refs:
  - src/index.ts
  - src/check/deepForensicCheck.ts
  - src/forensics/deepForensicJob.ts
  - src/forensics/incomingDepositJob.ts
  - src/forensics/moneyOriginTrace.ts
  - src/risk/unifiedWalletRisk.ts
supersedes:
  - CONTEXT.md
  - docs/project-walkthrough/README.md
  - docs/superpowers/specs/2026-07-03-project-knowledge-workflow-design.md
---

# Agent Brief

This is the first file to read before non-trivial work in this repository.

## Product

The project is a TRON USDT monitoring and forensic bot. It checks wallets and
incoming deposits, explains risk with evidence, and shows the result in
Telegram and the Admin forensic console.

The product must separate facts from interpretation:

- facts: transactions, addresses, amounts, timestamps, labels, contract data;
- interpretation: risk, source of funds, boundary, policy decision, score.

## Main Check Modes

We do not merge all checks into one mode.

- `fast check`: quick first look at obvious wallet risk.
- `deep check`: wider forensic profile of the wallet and its important
  counterparties.
- `where is money`: explains where the wallet's balance-forming funds came
  from.
- `incoming deposit`: explains one concrete incoming deposit.
- unified `/check`: runs the relevant address checks and composes wallet risk.

The modes can share infrastructure, especially TronScan indexing, but they
answer different questions.

## Current Product Direction

The current priority is data completeness for provenance:

- `Where is money` must explain the origin of the relevant funds.
- `Incoming deposit` must explain the concrete deposit sender path.
- `History not fully fetched` is not an acceptable final paid result when the
  gap is caused by our own small page budget.
- A service boundary is a legitimate stop. A local budget stop is not.
- We use TronScan and a pool of TronScan API keys. No manual CSV workflow.
- Long checks may take a long time if that is needed to get a complete answer.

## What To Read

- For the current execution order and gate status:
  `docs/knowledge/14-current-roadmap.md`.
- For check roles: `docs/knowledge/02-check-modes.md`.
- For job states and async indexing: `docs/knowledge/03-job-lifecycle.md`.
- For TronScan and coverage: `docs/knowledge/04-data-sources-tronscan-indexing.md`.
- For `Where is money` and `Incoming deposit`: `docs/knowledge/05-where-is-money-and-incoming.md`.
- For DeepCheck: `docs/knowledge/06-deepcheck.md`.
- For scoring: `docs/knowledge/07-risk-scoring-matrix.md`.
- For Admin and Telegram UX: `docs/knowledge/08-admin-and-bot-ux.md`.
- For current decisions: `docs/knowledge/09-current-decisions.md`.
- For known problems: `docs/knowledge/10-open-problems.md`.
- For terms: `docs/knowledge/11-glossary.md`.
- For local commands: `docs/knowledge/12-runbooks.md`.

## Rules For Agents

Before changing behavior, read the relevant knowledge page and verify the
current code. Knowledge docs define product intent. Code proves current
implementation.

If docs and code disagree, report the disagreement instead of silently trusting
either one.

After changing product behavior, scoring, job lifecycle, coverage, forensic
interpretation, Admin UX, or bot UX, update the relevant knowledge page in the
same work.
