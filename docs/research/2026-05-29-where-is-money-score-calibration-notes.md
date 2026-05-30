# Where-is-money score calibration notes, 2026-05-29

Purpose: record live wallet decisions and the reasoning behind them so we can later tune risk score, proof level, and user-facing explanations.

## Current interpretation rule

For these checks the system did not find direct scam proof, direct blacklist proof, exact approval-drain provenance, or a hard exchange boundary such as HTX/WhiteBIT.

The historical decisions below were policy declines caused by insufficient clean provenance:

- User-facing decision: `DECLINE`.
- Proof level: `insufficient_coverage`.
- Current score: `65/100 HIGH`.
- Meaning: "clean source is not proven", not "this wallet is proven scam".

This distinction matters. We should not call these cases stolen/scam/drainer without exact deterministic evidence.

## Adopted calibration direction

The current default-deny mapping is too aggressive for normal operational/liquidity wallets. A weak balance-origin proof should reduce provenance confidence, but it should not automatically create a high risk score.

New target output shape:

- `Decision`: `ACCEPTABLE` or `DECLINE`.
- `Risk`: numeric score plus tier, for example `32/100 LOW-MEDIUM`.
- `Provenance confidence`: how well the current USDT balance is explained, for example `58/100`.
- `Coverage`: how much of the intended graph/enrichment was actually fetched, for example `72%`.
- `Wallet role`: likely behavioral class, for example `operational liquidity wallet`.
- `Hard bad evidence`: `none`, or exact evidence such as approval-drain, HTX/high-risk exchange boundary, scam/blacklist, bridge/router/DEX/unknown-contract boundary.

Chosen policy for normal working wallets:

- If the wallet looks like an ordinary operational/liquidity wallet, no hard bad evidence is found, fast risk is low, and clean CEX origin is not fully proven, classify it as `ACCEPTABLE`.
- Score it as `LOW-MEDIUM`, closer to `LOW`, typically `25-40`.
- Keep provenance confidence separate and visible. Example: `Risk: 32/100 LOW-MEDIUM`, `Provenance confidence: 58/100`, `Coverage: 72%`.
- The explanation should say: `Clean CEX origin not fully proven; wallet looks like operational/liquidity wallet.`

This moves `weak_amount_or_time_continuity` from a risk reason to a provenance-quality reason. It can still lower confidence, but it should not by itself produce `DECLINE 65 HIGH`.

## Expanded graph idea

Increasing the interaction chain can help, but only if it is paired with better scoring. More hops alone can make normal working wallets look worse because large operational wallets naturally have many counterparties and amount changes.

Preferred expansion:

- Keep `maxDepth` high enough for balance-forming paths, for example 7.
- Increase useful breadth around the strongest balance-forming senders first, not uniformly for every address.
- Prioritize addresses by balance contribution, time proximity, and amount continuity.
- For the first 2-3 strongest senders, fetch broader interaction summaries: top inbound funders, top outbound receivers, volume in/out, retention, repeat counterparties, service labels, contract boundaries.
- For secondary senders, fetch lighter summaries unless they contain a hard-risk trigger.
- Continue the graph until one of these happens:
  - clean allowlisted CEX/source boundary;
  - hard-risk service boundary;
  - exact approval-drain/scam evidence;
  - operational-liquidity pattern is strong and no hard-risk trigger appears;
  - coverage budget is exhausted.

The goal is not to punish long chains. The goal is to decide whether the chain is normal liquidity movement or suspicious provenance.

## Case 1: TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM

Run mode:

- `where-is-money`, 30 days, depth 7, beam 8, max-addresses 30, max-edges 60.
- Full run completed.

Result:

- Balance: `225,240.325624 USDT`.
- Balance-forming transfers: 2.
- Decision: `DECLINE`.
- Proof level: `insufficient_coverage`.
- Score: `65/100 HIGH`.
- Fast wallet risk: `0/100 LOW`.
- AI contract verdicts: none.

Main balance-forming transfers:

- `100,000 USDT`: `TMFpCL...Noou -> TEYPUt...UZBM`.
- `500,000 USDT`: `TWVNcQ...Da7F -> TEYPUt...UZBM`.

Why declined:

- Both origin paths stopped at `weak_amount_or_time_continuity`.
- The `100,000 USDT` path had 100% preservation, but it came through an active intermediary, not from a clean known source.
- The `500,000 USDT` path was longer: multiple hops and changing amounts (`350k -> 499.9k -> 399.985k -> 500k -> checked wallet`), with about 70% preservation.
- Sender profiles looked like transit/collector behavior:
  - `TMFpCL...Noou`: about `512k` in / `507k` out, many transactions.
  - `TWVNcQ...Da7F`: about `1.399M` in / `1.382M` out, many transactions.

Human reading:

This looks operational/transit-like. I would not treat it as proven criminal, but for an exchanger it is not a clean balance. Decline is reasonable until a clean origin is shown.

Calibration note:

Under the new calibration this should likely become `ACCEPTABLE / LOW-MEDIUM`, closer to LOW, if no hard-risk boundary or approval-drain evidence appears after expanded sender checks. The weak continuity should reduce provenance confidence, not force `HIGH`.

## Case 2: TVzGYWyg89wUmwhvbcwfonHVLDYYQAiZMF

Run mode:

- `where-is-money`, 30 days, depth 7, beam 8, max-addresses 30, max-edges 60.
- Full run completed.

Result:

- Balance: `233,394.838307 USDT`.
- Balance-forming transfers: 5.
- Decision: `DECLINE`.
- Proof level: `insufficient_coverage`.
- Score: `65/100 HIGH`.
- Fast wallet risk: `0/100 LOW`.
- AI contract verdicts: none.

Main balance-forming transfers:

- `99,075 USDT`: `TCVCuj...A1ay -> TVzGYW...iZMF`, upstream `TGZkfS...Xogk -> TCVCuj...A1ay` for `139,000 USDT`, preservation about 71%.
- `4,795 USDT`: `TNUyZa...aYy -> TVzGYW...iZMF`, upstream `TN5ag6...PW2 -> TNUyZa...aYy` for `4,990 USDT`, preservation about 96%.
- `56,143 USDT`: direct from `TFaog5...Ktrk`.
- `2,020 USDT`: direct from `TPb1Ew...sjf`.
- `157,113 USDT`: `TRXGXY...x4b -> TVzGYW...iZMF`, upstream chain includes `TN5ag6...PW2 -> TAsN7b...TM6 -> TRXGXY...x4b`, preservation about 95%.

Why declined:

- All five origin paths stayed internal `REVIEW` due to either `weak_amount_or_time_continuity` or lack of enough previous clean source proof.
- Large senders are very active transit wallets:
  - `TCVCuj...A1ay`: about `2.233M` in / `2.138M` out, large outgoing transfers to many counterparties.
  - `TFaog5...Ktrk`: about `2.501M` in / `3.181M` out, no strong funding candidate for the checked transfer in the current trace.
  - `TRXGXY...x4b`: about `2.027M` in / `2.199M` out.
- There is no clean CEX boundary such as Binance/Bybit/OKX that explains the checked balance.
- There is no direct HTX/WhiteBIT/scam/approval-drain proof in this run.

Human reading:

This is similar to TEY but broader: the balance is assembled from multiple active counterparties, many with high turnover. The system is correct to avoid a scam claim, but for exchanger UX this should remain decline by policy.

Calibration note:

Under the new calibration this can be `ACCEPTABLE / LOW-MEDIUM` if the active counterparties look like ordinary liquidity/transit wallets and no hard-risk boundary is found. The score may be higher than TEY because there are more balance-forming senders, but it should still stay close to LOW without hard bad evidence.

Possible target range:

- `30-42`: operational/liquidity pattern, no hard bad evidence, medium provenance confidence.
- `45-55`: operational pattern is unclear or coverage is materially partial.
- `65+`: reserve for hard-risk evidence, not weak continuity alone.

## Case 3: TTs9xCEZ43niXvfKTu7LcF7Kcud3Bbw7FD

Run mode:

- Full run, 30 days, depth 7, beam 8, max-addresses 30, max-edges 60: timed out after 15 minutes during heavy `transaction-info` enrichment.
- Bounded run completed with depth 4, beam 4, max-addresses 10, max-edges 25, LLM disabled.
- Treat this result as partial but useful.

Result:

- Balance: `1,099,276.439577 USDT`.
- Balance-forming transfers: 28.
- Decision: `DECLINE`.
- Proof level: `insufficient_coverage`.
- Score: `65/100 HIGH`.
- Fast wallet risk: `0/100 LOW`.
- AI contract verdicts: none in bounded run.

Main observed structure:

- The balance is assembled from many transfers, not one clean deposit.
- Major contributors include:
  - `TQkcv24...gDj` sending `288,550`, `97,602`, `48,497`, `272,767 USDT` and also funding `TFnSD...dT5`.
  - `TFnSD...dT5` sending many chunks such as `20,316`, `15,343`, `14,460`, `27,261`, `18,150`, `16,133`, `17,279`, `12,464 USDT`.
  - `TEHWJV...NzU` sending `88,641 USDT`.
  - `TF3bWz...vaV` sending `95,970 USDT`.
  - `TQPSSZ...4K8` sending `97,850 USDT`.
- There are also many tiny dust-like balance-forming inputs around `1-10 USDT`.

Why declined:

- Many paths stopped at `weak_amount_or_time_continuity`.
- Many paths stopped at `no_previous_transfer`.
- Several major senders are high-volume operational wallets:
  - `TQkcv24...gDj`: about `2.093M` in / `2.075M` out; top incoming from `TUgwp...kfh`, outgoing split across many counterparties.
  - `TFnSD...dT5`: about `1.433M` in / `1.496M` out; top incoming mostly from `TQkcv24...gDj`, outgoing includes many chunks to checked wallet.
  - `TEHWJV...NzU`: about `10.655M` in / `15.493M` out; very large operational movement.
  - `TF3bWz...vaV`: about `1.160M` in / `1.967M` out.
  - `TQPSSZ...4K8`: about `1.286M` in / `1.263M` out.
- No clean source was proven for the assembled balance.

Human reading:

This is the strongest decline of the three from an operational-pattern perspective. The balance is large, split across many inflows, with multiple high-throughput wallets and many unresolved paths. It still is not exact scam proof, but for an exchanger it is not a safe clean-source case.

Calibration note:

This is the case where coverage and runtime matter most. With only a bounded run, the system should not turn partial analysis into hard `DECLINE` unless hard bad evidence appears. The correct output should expose lower confidence/coverage separately.

Potential future scoring idea:

- `35-45`: large operational/liquidity wallet, no hard bad evidence, but many unresolved balance-forming paths.
- `45-60`: coverage is poor, operational role is unclear, or suspicious structure appears without hard proof.
- `65+`: hard-risk evidence or strong suspicious contract/service boundary.
- `85+`: exact taint, exact approval-drain provenance, blacklist, direct scam labels.

## Cross-case calibration questions

1. Should `insufficient_coverage` always be `65`, or should it scale by operational complexity?
2. Should multiple high-turnover senders raise score even without exact taint?
3. Should many small dust-like balance-forming inputs be ignored for score, or treated as weak supporting context?
4. Should a bounded/partial run show a separate confidence/coverage penalty distinct from risk score?
5. Should `weak_amount_or_time_continuity` and `no_previous_transfer` have different score impacts?
6. Should we add a separate user-facing category: "DECLINE: source not proven" vs "DECLINE: high-risk source found"?

## Current recommendation

Replace the current user-facing default-deny behavior for ordinary working wallets.

Do not call them scam/drainer cases unless exact evidence appears.

Target behavior:

- If a wallet looks like ordinary operational/liquidity flow and there is no hard bad evidence, return `ACCEPTABLE` with `LOW-MEDIUM` risk closer to LOW.
- Show provenance confidence and coverage separately.
- Increase graph breadth around the strongest balance-forming senders before raising risk.
- Use `DECLINE` for exact/hard evidence, not for weak continuity alone.

Example desired user-facing shape:

```text
Decision: ACCEPTABLE
Risk: 32/100 LOW-MEDIUM
Provenance confidence: 58/100
Coverage: 72%
Wallet role: operational liquidity wallet
Hard bad evidence: none
```
