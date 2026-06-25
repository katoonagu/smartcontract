# Documentation Truth Audit

## Purpose

This document checks whether the plain-language walkthrough accurately describes the current project.

Each claim gets one status:

- `confirmed` - supported by current code, tests, or saved job output.
- `partial` - directionally true, but wording must be narrower.
- `outdated` - docs describe behavior that changed.
- `future` - useful product direction, but not current behavior.
- `needs evidence` - likely true, but not yet tied to a code/test/job reference.

## Audit Rules

- Do not invent numbers.
- Prefer code and tests over memory.
- If a value is configurable, document where it comes from.
- If a rule is heuristic, say that it is a heuristic.
- If a mode only stores data for admin and does not show it in Telegram, say that.
- If a graph cannot prove source of funds, say that.

## Claim Matrix

| ID | Topic | Claim | Current docs | Evidence | Status | Numbers / rules | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C-001 | Check modes | FastCheck, DeepCheck, and Where is money are separate modes with different goals. | `06-check-modes...` | `src/bot/createBot.ts`, `src/forensics/deepForensicJob.ts`, tests | needs evidence | none yet | Verify and update wording. |
| C-010 | Check modes | FastCheck is a bounded direct-neighborhood profile, not a full source-of-funds proof. | `06`, `14` | `src/bot/createBot.ts`, `src/admin/forensicsGraph.ts` | confirmed | direct counterparties and fastCheckTops | Keep wording. |
| C-011 | Check modes | DeepCheck can consume FastCheck hints, but FastCheck is not the single source of truth for DeepCheck. | `06` | `src/bot/createBot.ts`, `src/check/deepForensicCheck.ts` | confirmed | hints prioritize addresses | Clarify wording. |
| C-012 | Check modes | Where is money is the mode that tries to explain selected amount/source path. | `06`, `10` | `src/check/whereIsMoneyCheck.ts`, `src/forensics/deepForensicJob.ts` | confirmed | selected anchor / recent flow / drain episode | Keep wording. |
| C-050 | Graph | Graph nodes and edges can show observed transfers, inferred context, bundles, service boundaries, peer links, amounts, timestamps, and gaps when those fields are saved in the job result. | `13` | `src/admin/forensicsGraph.ts`, `src/admin/adminConsole.ts`, `tests/admin/forensicsGraph.test.ts`, `tests/admin/adminConsole.test.ts` | confirmed | DeepCheck is profile/context; Where is money and incoming deposit are closer to source/path traces. | Keep safer wording that graph shows evidence/context but does not prove every visible neighbor is source of funds. |
| C-051 | Admin / Telegram | Telegram formats short operational answers; admin keeps graph and raw investigation evidence. | `08`, `14` | `src/bot/createBot.ts`, `src/alerts/formatters.ts`, `src/admin/adminConsole.ts`, `tests/bot/createBot.test.ts`, `tests/alerts/formatters.test.ts`, `tests/admin/adminConsole.test.ts` | confirmed | Telegram does not show the full forensic graph or every raw signal. | Keep admin/Telegram split explicit. |
| C-100 | Product narrative | Product is read-only monitoring for watched wallets, not custody or transaction control. | `15`, `17` | `src/bot/createBot.ts`, `src/alerts/formatters.ts`, `tests/bot/createBot.test.ts`, `tests/alerts/formatters.test.ts` | confirmed | No private keys, no signing, no fund movement. | Keep read-only wording prominent. |
| C-101 | Product narrative | Telegram alert layer can warn users about watched-wallet events and risk signals. | `15`, `17` | `src/bot/createBot.ts`, `src/alerts/formatters.ts`, `tests/bot/createBot.test.ts`, `tests/alerts/formatters.test.ts` | confirmed | Telegram is a short operational surface, not the full evidence layer. | Keep alert claims tied to monitored/manual checks. |
| C-102 | Product narrative | Admin evidence layer stores jobs, evidence, graph review context, and history for analyst review. | `15`, `17` | `src/admin/adminConsole.ts`, `src/admin/forensicsGraph.ts`, `tests/admin/adminConsole.test.ts`, `tests/admin/forensicsGraph.test.ts` | confirmed | Admin can only show saved job data. | Keep evidence claims, but preserve gaps/partial wording. |
| C-103 | Product narrative | Graph visualization supports review of saved nodes, edges, routes, boundaries, and gaps. | `15`, `17` | `src/admin/forensicsGraph.ts`, `tests/admin/forensicsGraph.test.ts` | confirmed | Graph projection is evidence/context, not proof of every source path. | Keep graph claims scoped to saved forensic output. |
| C-104 | Product narrative | Risk scoring exists with explainable reasons, bands, floors, thresholds, and limitations. | `15`, `17` | `src/risk/unifiedWalletRisk.ts`, `src/risk/riskPolicyEngine.ts`, `tests/risk/unifiedWalletRisk.test.ts`, `tests/risk/riskPolicyEngine.test.ts` | confirmed | Heuristic risk decision, not absolute AML truth. | Keep score claims tied to reasons and coverage. |
| C-105 | Product narrative | Approval guard can detect and warn about risky approvals, but does not revoke approvals itself. | `15`, `17` | `src/risk/riskPolicyEngine.ts`, `tests/risk/riskPolicyEngine.test.ts`, `src/alerts/formatters.ts`, `tests/alerts/formatters.test.ts` | partial | Exact approval-drain evidence is high risk; user still controls revoke/signing. | Say "warns/checks approvals", not "protects funds automatically". |
| C-106 | Product narrative | Commercial AML integrations and enterprise API/webhooks are product direction, not current shipped behavior. | `17` | Current docs classify AML/API under future direction. | future | AML providers can be future data sources. | Do not sell AML/API layer as already complete. |
| C-107 | Product narrative | Wider multi-chain coverage is a future direction; current narrative should stay focused on TRON/TRC20 USDT. | `17` | Current docs use TRON/TRC20 USDT as current focus and list EVM/BSC/full multi-chain as expansion. | future | Current wedge is TRON USDT. | Keep multi-chain claims future unless implementation evidence is added. |
| C-108 | Product promises | Product does not recover funds or cancel confirmed transactions. | `15`, `17` | `src/bot/messages.ts`, `tests/bot/createBot.test.ts`, limitation docs and narrative unsafe-phrases section | confirmed | Read-only system; no custody/signing. | Keep as explicit non-promise. |
| C-109 | Product promises | Product does not guarantee real-world identity or Telegram attribution for arbitrary addresses. | `15`, `17` | Limitation docs and narrative unsafe-phrases section; code evidence still needed for the address-to-Telegram attribution boundary. | needs evidence | Public blockchain data does not prove person/intent by itself. | Verify attribution boundary in code/tests and keep identity attribution out of product promises. |

## Confirmed Numbers

| Area | Number / rule | Evidence | Notes |
| --- | --- | --- | --- |
| Unified wallet risk bands | `0-29 LOW`, `30-59 MEDIUM`, `60-84 HIGH`, `85-100 CRITICAL` | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Confirmed by `levelFromScore` and tests around limited coverage, transit floors, and no-hard-evidence cap. |
| Unified wallet user decision threshold | `finalScore >= 60` becomes `DECLINE`; below 60 is `ACCEPTABLE`, except hard evidence floor `>= 85` also forces `DECLINE` | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Confirmed by `decisionFromScore` and `finalDecisionFromScoreAndEvidence`. |
| Layer weights | FastCheck `10%`, DeepCheck `60%`, Where is money `30%` when available | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Missing layers are excluded and weights are normalized over available layers. |
| Final score model | `max(context after allowed dampener, strongest applicable floor)`, capped at `84` when no hard evidence exists | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Floors are minimums, not additive bonuses; confirmed by final score assembly and the "caps combined non-hard weighted context below CRITICAL" test. |
| Hard evidence floors | USDT blacklist `95`; exact approval-drain at least `90`; exact/high-risk provenance at least `85` | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Risk-policy engine also floors exact approval-drain decisions to `95`. |
| Policy floor | Source-policy decline evidence creates a floor from `70` up to `84` | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Confirmed by `wherePolicyFloor` and fixture tests with policy floor `70` and `78`. |
| Asset continuation floor | Verified/known asset continuation with score `>= 65` creates a floor capped at `84` | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Unknown token quality is excluded. |
| Pattern floor | Historical transit or drain-episode pattern must score `>= 60`; route-linked approval pattern must score `>= 60` and is capped at `80` | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Historical/drain floors are capped at `84`; without hard evidence they cannot make CRITICAL. |
| Coverage floor | Limited coverage creates a `30` floor/context minimum | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Confirmed by limited coverage tests; partial coverage alone is not this floor. |
| Provider budget visibility | DeepCheck report records `providerBudget` fields and job result JSON persists them | `src/check/deepForensicCheck.ts`, `src/forensics/deepForensicJob.ts`, `tests/check/deepForensicCheck.test.ts`, `tests/forensics/deepForensicJob.test.ts` | Fields include provider, transfer, contract, approval call budgets and elapsed time budget when configured. |
| Missing checks visibility | Missing checks are stored on forensic reports and route text renders them as `Missing / partial checks` | `src/check/deepForensicCheck.ts`, `src/forensics/deepForensicJob.ts`, `src/forensics/routeReport.ts`, `tests/forensics/coverageDebugReport.test.ts` | Missing checks identify intended checks that did not complete; they are not clean evidence. |
| Partial job interpretation | `partial` means usable result data can exist while coverage or an intended check is incomplete | `src/types.ts`, `src/forensics/routeSearch.ts`, `src/forensics/deepForensicJob.ts`, `tests/check/whereIsMoneyCheck.test.ts` | Partial is neither clean nor bad by itself; read missing checks, coverage, and stopped path. |
| Partial route result | Route search returns `partial` when it has candidate paths but no exact path | `src/forensics/routeSearch.ts` | `failed` is reserved for no usable paths in that route-search path. |
| Dampener cap | Raw dampener is capped at `40`; applied dampener is capped at `25` and cannot push below the strongest floor | `src/risk/unifiedWalletRisk.ts`, `tests/risk/unifiedWalletRisk.test.ts` | Strong transit anchors limit behavior dampening to `5` before raw dampener calculation. |
| Risk policy exact taint | Exact taint returns `DECLINE`/`DECLINE` with score at least `90` | `src/risk/riskPolicyEngine.ts`, `tests/risk/riskPolicyEngine.test.ts` | Score is bounded to `100`. |
| Risk policy exact approval-drain | Exact approval-drain returns `DECLINE`/`DECLINE` with score at least `95` | `src/risk/riskPolicyEngine.ts`, `tests/risk/riskPolicyEngine.test.ts` | Confirmed by hard-decline and conflicting clean-source tests. |
| Risk policy HTX/Huobi | HTX/Huobi source score `>= 60` returns internal/user `DECLINE`; below `60` returns internal `REVIEW` and user `ACCEPTABLE` | `src/risk/riskPolicyEngine.ts`, `tests/risk/riskPolicyEngine.test.ts` | This is source-policy context/risk, not scam proof. |
| Risk policy WhiteBIT | WhiteBIT source returns user `DECLINE` with score at least `35` | `src/risk/riskPolicyEngine.ts`, `tests/risk/riskPolicyEngine.test.ts` | This is documented as source-policy context, not scam proof. |
| Risk policy fallback | If no specific signal wins, contextual scores are capped at `85`, dampened, then floored at `45`; internal `REVIEW`, user `DECLINE` | `src/risk/riskPolicyEngine.ts`, `tests/risk/riskPolicyEngine.test.ts` | Confirmed by fallback NaN test and code path. |
| Source bundle unresolved share threshold | Budget-exhausted material unresolved boundary is reported only when aggregated affected share is `>= 10%` | `src/forensics/sourceBundleExposure.ts`, `tests/forensics/sourceBundleExposure.test.ts` | Applies to risky-label, HTX/Huobi, bridge/router/DEX, and unknown-contract boundaries. Unknown-only fallback also uses `>= 10%`. |
| Source bundle unresolved floors | risky-label `70`, HTX/Huobi `60`, bridge/router/DEX `55`, unknown-contract `45`, clean CEX/unknown `35` | `src/forensics/sourceBundleExposure.ts`, `tests/forensics/sourceBundleExposure.test.ts` | Tests confirm bridge floor `55` and unknown floor `35`; other values are direct code constants. |
| Source bundle unresolved boundary floor | Budget-exhausted unresolved source boundaries attach a `scoreFloor` through `unresolvedBoundaryFloor` | `src/forensics/sourceBundleExposure.ts`, `tests/forensics/sourceBundleExposure.test.ts` | This is a conservative coverage-limited floor, not hard proof of bad funds. |
| Source bundle missing selected coverage | Missing selected source share is assigned to `unknown` | `src/forensics/sourceBundleExposure.ts`, `tests/forensics/sourceBundleExposure.test.ts` | Confirmed by selected-source and incoming-deposit wording tests. |
| Unknown interpretation | Missing selected coverage and exhausted unknown source coverage are assigned to `unknown` | `src/forensics/sourceBundleExposure.ts`, `src/forensics/incomingDepositExposureProfile.ts`, `tests/forensics/sourceBundleExposure.test.ts`, `tests/forensics/incomingDepositExposureProfile.test.ts` | Unknown is unresolved coverage/source context; it must not be described as LOW or clean by default. |

## Partial Or Future Claims

| Claim | Why not fully confirmed | Safer wording |
| --- | --- | --- |
| `n/a` interpretation | Current evidence is walkthrough wording, not code/UI behavior. Exact product rendering still needs code/UI evidence. | `n/a` should mean not applicable or unavailable, not clean or dirty by itself. |

## Open Questions

| Question | Why it matters | Owner decision needed |
| --- | --- | --- |
