---
status: draft
audit_type: knowledge_deep_audit
scope: manual finding / candidate implementation spec
created: 2026-07-05
confidence: runtime-observed
implementation_candidate: confirmed
---

# DeepCheck Contract-Driven Drainer Campaign Finding

## What This Note Is

Это manual finding по результату разбора кошелька:

```text
TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE
DeepCheck job: 9ed02842-0d07-49b4-81ef-54d559da4aab
Where job: 70eca6f4-5495-48ae-a4a5-ce791d064619
```

Мы проверяли расхождение между тем, что видит Admin/ручной анализ, и тем, что
сохранил `DeepCheck` в `contractDrivenReceiverProfile` /
`contractDrivenTransferProfiles`.

Главный вывод:

```text
DeepCheck знает о полном subject index и видит 116 входящих tx, но его
contract-driven блок отражает только часть wrapper-driven входов и одновременно
смешивает их с обычными USDT transfer вызовами.
```

Это не отменяет результат `Where is Money` по этому кошельку. `Where` здесь
сработал хорошо и нашел exact approval-drain evidence. Проблема в другом:
`DeepCheck` должен лучше показывать drainer-campaign pattern и не терять
широкую кампанию за компактным/загрязненным contract-driven summary.

## Why This Matters

Для аналитика этот кейс выглядит как drainer campaign:

- много входящих `Verify20`;
- один повторяющийся spender/operator cluster;
- средства приходят в один collector wallet;
- часть victim wallets после drain почти не продолжает USDT-активность;
- contract method выглядит как misleading wrapper, а не обычный пользовательский
  `transfer`;
- `Where is Money` нашел exact approve + transferFrom provenance.

Если `DeepCheck` показывает только `29 contract-driven incoming tx`, а ручная
проверка по всем входящим tx показывает `101 Verify20`, аналитик видит
несогласованную картину.

Продуктово это опасно по двум причинам:

1. `DeepCheck` может недопоказать масштаб drainer campaign.
2. `DeepCheck` может переоценить ordinary USDT transfers как contract-driven
   activity, если method text выглядит как `transfer(address _to,uint256 _value)`.

Нужна более строгая граница:

```text
plain USDT transfer != drainer-like wrapper call
Verify20 wrapper cluster != exact approval-drain proof until approval/proof is checked
```

## Confirmed Direction

User decision:

```text
This is a confirmed next implementation candidate after the audit/spec pass.
```

The goal is not to make DeepCheck more aggressive by default. The goal is to
make DeepCheck show the real picture:

- do not hide a broad `Verify20` wrapper campaign behind a partial sample;
- do not count ordinary USDT transfers as drainer-like contract activity;
- do not promote contextual wrapper activity into exact hard evidence unless
  approval/provenance proof exists;
- do not show a partial enriched subset as if it were the full wallet picture;
- expose enough counters for Admin and reports to make the coverage boundary
  obvious.

The product principle:

```text
If DeepCheck enriched 29 of 116 incoming tx, the report must say 29/116
enriched, not imply that 29 is the total campaign size.
```

And if DeepCheck enriches all 116 incoming tx, it should be able to say:

```text
116 incoming tx
101 Verify20 wrapper incoming tx
15 plain USDT transfer incoming tx
5 exact current-balance approval-drain proofs from Where / exact provenance
```

## Runtime Case Summary

### Local Indexed Facts

Для `TPdr...` локальный all-time index:

```text
coverage_mode: all_time
status: complete
status_reason: complete_provider_windowed
fetched_transfer_count: 251
unique_counterparty_count: 176
newest_transfer_at: 2026-07-04T12:33:18Z
oldest_transfer_at: 2026-04-23T12:03:06Z
covered_until_timestamp: 2018-06-25T00:00:00Z
provider_cap_hit: true
budget_exhausted: false
fetched_page_count: 6
```

Raw local table rows before dedupe:

```text
total rows touching subject: 595
incoming rows: 275
outgoing rows: 320
```

Deduced subject transfer edges after dedupe:

```text
all dedup edges: 251
incoming dedup edges / tx: 116
outgoing dedup edges / tx: 135
incoming amount: 440,672.34 USDT
outgoing amount: 423,506.916013 USDT
```

Important interpretation:

```text
595 local rows, 251 dedup transfer edges, and 116 incoming tx are different
counters. Admin and reports must label these counters clearly.
```

### Manual Transaction-Info Classification

Manual read-only `transaction-info` classification for all 116 incoming tx:

| Category | Count | Amount |
| --- | ---: | ---: |
| `verify20_wrapper` | 101 | 325,130 USDT |
| `plain_usdt_transfer` | 15 | 115,542.34 USDT |

Wrapper groups:

| Contract | Operator | Method | Count | Amount |
| --- | --- | --- | ---: | ---: |
| `TURRtRavZxXeoQF6tWbeNQ5gfzWEH7sEHh` | `TQvjkKKHukfpa4tNsENAESZwrDExLbgPTL` | `Verify20(address token,address from,address to,uint256 amount)` | 96 | 269,791 USDT |
| `TH7tDnffCyX4TsnxhRdzoHVBi4FQkMYSkU` | `TNdp9bugoKgkuLELonQ792FiFYoC59F7bc` | `Verify20(address token,address from,address to,uint256 amount)` | 5 | 55,339 USDT |

Plain transfer group:

```text
TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
method: transfer(address _to,uint256 _value)
source: TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1
count: 15
amount: 115,542.34 USDT
```

This means the user's observation was correct:

```text
There were more than 29 contract/wrapper-driven incoming tx in the real
transaction-info view. The saved DeepCheck contract-driven block did not show
the whole Verify20 footprint.
```

### Saved DeepCheck Result

Saved DeepCheck job:

```text
job kind: address_deep_check
job id: 9ed02842-0d07-49b4-81ef-54d559da4aab
status: completed
runProfile: production_full
```

Deep coverage:

```text
subjectTransfersFetched: 251
subjectUniqueDirectWallets: 176
directWalletsHardEvidenceChecked: 176
transferEdges: 1008
inboundSendersExpanded: 15
secondLayerRelationshipPaths: 61
secondLayerRelationshipGroups: 5
```

Saved `contractDrivenReceiverProfile`:

```text
totalIncomingTxCount: 116
totalIncomingAmountRaw: 440,672.34 USDT
contractDrivenIncomingTxCount: 29
contractDrivenIncomingAmountRaw: 305,915.34 USDT
uniqueSourceCount: 15
dominantMethod: transfer transfer(address _to,uint256 _value)
exactApprovalDrainCount: 0
```

Saved `contractDrivenTransferProfiles` split:

| Group | Count | Amount | Interpretation |
| --- | ---: | ---: | --- |
| Plain USDT `transfer(...)` from `TNAra...` through USDT contract `TR7NH...` | 15 | 115,542.34 USDT | Should not be drainer-like contract-driven evidence |
| `Verify20` through `TURRt...` / operator `TQvjk...` | 11 | 136,455 USDT | Drainer-like wrapper context |
| `Verify20` through `TH7t...` / operator `TNdp...` | 3 | 53,918 USDT | Drainer-like wrapper context |

So the saved DeepCheck `29` is really:

```text
14 Verify20 wrapper profiles + 15 plain USDT transfer profiles
```

Manual transaction-info classification says the full incoming set is:

```text
101 Verify20 wrapper tx + 15 plain USDT transfer tx
```

The gap is:

```text
DeepCheck saved only 14 of 101 Verify20 wrapper incoming tx in
contractDrivenTransferProfiles.
```

## Why DeepCheck Saved 29 Instead Of 101

The current DeepCheck flow has two separate layers:

1. It can load the subject all-time index and know the full direct boundary.
2. It does not automatically have `transaction-info` method/contract/operator
   classification for every one of those subject incoming transfers.

The local all-time transfer table stores the USDT transfer event. For this
subject, all local incoming transfer rows have:

```text
method=transfer
event_type=Transfer
caller_address=null
```

That table is enough to know:

```text
from -> TPdr
amount
timestamp
tx_hash
```

It is not enough to know:

```text
the tx was a call to Verify20 on TURRt...
the operator was TQvjk...
the called contract was not the USDT contract
```

That extra information comes from `getTransaction(tx_hash)` enrichment.

DeepCheck expands the top incoming senders, dedupes edges, and prefers edges
with stronger contract-driven method signal. That gave enriched method data for
some high-volume senders, not for every incoming tx in the subject all-time
index.

Result:

```text
DeepCheck knew there were 116 incoming tx, but it only had enriched
contract/method context for a subset of those tx.
```

## Why Plain Transfer Became Contract-Driven

`contractDrivenEvidence` currently treats an incoming edge as contract-driven
when the edge method is not recognized as a plain transfer.

The problem is that a plain USDT transaction-info method can appear as:

```text
transfer(address _to,uint256 _value)
```

In the saved profile it appeared as:

```text
transfer transfer(address _to,uint256 _value)
```

That should still be treated as a plain USDT transfer, especially when:

```text
called contract = TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
```

But DeepCheck saved those 15 plain transfers as contract-driven transfer
profiles. This polluted the contract-driven summary and made the dominant
method:

```text
transfer transfer(address _to,uint256 _value)
```

That is analytically misleading for a drainer campaign.

## Why Where Found 5 Exact Profiles

Saved `Where is Money` result:

```text
job kind: where_is_money_check
job id: 70eca6f4-5495-48ae-a4a5-ce791d064619
decision: DECLINE
riskScore: 95
proofLevel: exact_approval_drain_provenance
approvalDrainProvenanceProfiles: 5
```

The five exact profiles:

| Victim | Amount | Drain tx | Approval time | Drain time |
| --- | ---: | --- | --- | --- |
| `TY7rkNbqfYuiY1gt4Y5sxwpLQ7J38QQarC` | 2,000 USDT | `8351c18e7c47...` | 2026-07-02T10:13:45Z | 2026-07-02T10:15:39Z |
| `TEWWYZbRykEm3one5iBLDYxNqizgKpvakn` | 789 USDT | `5e09663f2d66...` | 2026-06-28T16:49:48Z | 2026-06-28T17:03:36Z |
| `TRu9hgLqUQTrd5NqLGMBKNcwogB1dwxxhs` | 669 USDT | `9670af11b080...` | 2026-06-29T15:39:30Z | 2026-06-29T15:41:39Z |
| `TKgYpYNY4gwZr2cm8PkdpTk9eUhFWGn276` | 305 USDT | `2ef1186e1ebf...` | 2026-06-04T09:23:24Z | 2026-07-04T10:30:54Z |
| `TQS4zSEogufoAvvJG8g5pHZJ1ZTk2MDKLr` | 94 USDT | `49b4729553a0...` | 2026-07-01T14:09:57Z | 2026-07-01T14:13:00Z |

All five share:

```text
spender: TURRtRavZxXeoQF6tWbeNQ5gfzWEH7sEHh
operator: TQvjkKKHukfpa4tNsENAESZwrDExLbgPTL
contract/method: VerifyAccount / Verify20
first receiver: TPdr...
amount preservation: 1
evidenceStrength: exact_approval_and_transfer_from
```

Additional victim post-drain check from local index:

```text
4 of 5 victims had no later USDT activity after the drain.
1 of 5 had only a small later incoming of 2.6 USDT and no later outgoing.
```

This is strong supporting context, though the hard proof comes from exact
approval + transferFrom + path evidence.

## How The Five Differ From The Other Verify20 Transfers

The five exact profiles are not the only `Verify20` incoming transfers.

They are the five that `Where is Money` selected for its product question:

```text
Where did the current balance-forming funds come from?
```

For this Where job:

```text
checkedScope: current_balance
selectedInboundTxCount: 5
selectedAmountRaw: 3,857 USDT
current balance covered: yes
approval/contract enrichment: 30/30 candidate tx-info fetched
```

The other `Verify20` transfers are broader historical incoming activity. Many
are much larger and may also be drainer-like, but they were not needed to
explain the selected current-balance coverage in that Where run.

So the distinction is:

```text
Five exact profiles = selected current-balance provenance with approval proof.
Other Verify20 transfers = broader historical drainer-campaign context, not
selected as current-balance proof in this Where report.
```

This distinction is correct for `Where is Money`, but `DeepCheck` should expose
the broader campaign more clearly because DeepCheck's product question is the
wallet profile, not only current balance provenance.

## Target Product Behavior

DeepCheck should answer this product question:

```text
What does this wallet look like as a whole, including broad drainer-campaign
behavior?
```

For contract-driven incoming activity, DeepCheck should produce three separate
layers:

1. Plain transfer layer.
2. Wrapper/campaign context layer.
3. Exact approval-drain proof layer.

These layers must not be merged.

### Layer 1: Plain USDT Transfer

Meaning:

```text
The transaction is a call to the canonical USDT contract and the method is a
normal transfer.
```

Example:

```text
contract: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
method: transfer(address _to,uint256 _value)
```

Expected treatment:

- count it as ordinary incoming USDT activity;
- keep it in normal wallet flow metrics;
- do not count it as drainer-like contract-driven evidence;
- do not let it become the dominant method for a drainer-campaign summary.

### Layer 2: Wrapper / Campaign Context

Meaning:

```text
The transaction invokes a non-USDT contract or wrapper method, and the
transaction-info token transfer rows show USDT moving into the checked wallet.
```

Examples:

```text
Verify20(address token,address from,address to,uint256 amount)
transferFrom wrapper
permit/permitTransfer wrapper
other non-plain method with explicit source and receiver fields
```

Expected treatment:

- count as contract/wrapper-driven incoming context;
- group by called contract, operator, method, receiver, and source/victim
  population;
- show the campaign footprint even if exact approval proof has not been checked
  or found for every tx;
- label it as contextual until proof exists.

### Layer 3: Exact Approval-Drain Proof

Meaning:

```text
The system proved deterministic approval + spender + transferFrom/wrapper
movement + path to checked wallet.
```

Expected proof requirements:

- tx-info confirms a USDT movement from victim/source to receiver;
- spender or wrapper contract is resolved;
- prior approval exists for the same owner/spender/token before drain;
- approval amount covers the drain amount;
- route/path reaches the checked wallet with amount preservation;
- false-positive service guards do not block the interpretation.

Expected treatment:

- can become hard evidence;
- can drive `DECLINE`/high score;
- should be listed separately from contextual campaign signals;
- multiple exact profiles should be preserved, not collapsed into one top item.

## Proposed DeepCheck Pipeline

The future implementation should use a staged pipeline. The exact code design
can change, but the product behavior should stay close to this shape.

### 1. Build The Subject Incoming Set

Start from the subject all-time index when it is complete and small enough:

```text
subject incoming tx set
subject outgoing tx set
dedup transfer edges
raw row count
```

The report must keep these counters separate:

```text
raw local rows
dedup subject transfer edges
incoming tx
outgoing tx
```

For TPdr this was:

```text
595 raw local rows
251 dedup subject transfer edges
116 incoming tx
135 outgoing tx
```

### 2. Enrich Subject Incoming Tx

DeepCheck should enrich subject incoming tx with `transaction-info` when it is
building a contract/wrapper campaign profile.

Recommended bounded policy:

- if incoming tx count is modest, enrich all subject incoming tx;
- if incoming tx count is large, enrich in stages;
- always include Where-selected current-balance/recent-flow candidates when
  available;
- include top amount candidates;
- include recent candidates;
- include repeated sender/receiver candidates;
- include any tx already suspected from method/edge type/cache;
- expose the denominator.

The denominator is mandatory.

Good:

```text
txInfoEnrichedIncomingTx: 116 / 116
campaignClassificationStatus: complete
```

Acceptable partial:

```text
txInfoEnrichedIncomingTx: 200 / 2,400
campaignClassificationStatus: partial
campaignCountsAreLowerBounds: true
```

Bad:

```text
contractDrivenIncomingTxCount: 29
```

when the reader cannot tell that only a subset had useful tx-info enrichment.

### 3. Classify Each Enriched Incoming Tx

Each enriched incoming tx should get a narrow classification:

```text
plain_usdt_transfer
wrapper_driven_incoming
verify20_wrapper
transfer_from_wrapper
permit_wrapper
other_contract_method
unknown_unenriched
tx_info_unavailable
```

Classification should use both transaction-info and the local transfer edge:

- called contract;
- method selector / method name;
- operator / owner address;
- token transfer rows;
- from/to/amount movement;
- canonical USDT contract address;
- whether source and receiver are explicit in the method/transfer rows.

Important rule:

```text
Canonical USDT contract + normal transfer method = plain_usdt_transfer.
```

This stays true even if transaction-info contains a method signature string.

### 4. Build Campaign Clusters

Wrapper-driven tx should be grouped into campaign clusters:

```text
contractAddress
operatorAddress
method
receiverAddress
uniqueSourceCount
txCount
amountRaw
firstSeenAt
lastSeenAt
knownServiceIdentity
exactProofCount
contextOnlyCount
```

For TPdr, the important clusters are:

```text
TURRt... / TQvjk... / Verify20
96 tx
269,791 USDT

TH7t... / TNdp... / Verify20
5 tx
55,339 USDT
```

This cluster view is what the analyst expected to see in Admin.

### 5. Run Exact Approval-Drain Analysis Over Suspicious Candidates

DeepCheck should not only ask "what is the largest transfer?" It should ask:

```text
which transfers are most suspicious and most useful for exact proof?
```

Candidate ranking should include:

- wrapper-driven classification;
- `Verify20` / `transferFrom` / permit-like method;
- same spender/operator cluster;
- repeated receiver;
- direct first receiver is the checked wallet;
- source wallet looks victim-like;
- source has low/no post-drain outgoing activity;
- current-balance or recent-flow relevance;
- amount;
- recency;
- absence of known service boundary.

The ranking should not let large plain transfers crowd out smaller suspicious
wrapper drains.

### 6. Preserve Multiple Exact Profiles

DeepCheck should preserve every exact approval-drain profile that passes the
proof rules inside budget.

Expected behavior:

```text
approvalDrainProvenanceProfiles: [profile1, profile2, profile3, ...]
```

not:

```text
approvalDrainProvenanceProfiles: [topProfileOnly]
```

If only a subset was checked, the report must say so:

```text
approvalDrainCandidatesChecked: 30 / 101 wrapper tx
exactProfilesFound: 5
```

## Proposed Report Shape

The final object names can be decided during implementation, but reports should
carry these concepts.

### Contract Campaign Summary

Suggested payload concept:

```text
contractCampaignSummary:
  incomingTxTotal
  txInfoEnrichedIncomingTx
  txInfoEnrichmentStatus
  plainUsdtTransferTxCount
  wrapperDrivenIncomingTxCount
  verify20WrapperTxCount
  transferFromWrapperTxCount
  unknownUnenrichedTxCount
  wrapperDrivenAmountRaw
  exactApprovalDrainProfileCount
  campaignClusters[]
  countsAreLowerBounds
```

For TPdr, the target summary should look like:

```text
incomingTxTotal: 116
txInfoEnrichedIncomingTx: 116
txInfoEnrichmentStatus: complete
plainUsdtTransferTxCount: 15
wrapperDrivenIncomingTxCount: 101
verify20WrapperTxCount: 101
wrapperDrivenAmountRaw: 325,130 USDT
exactApprovalDrainProfileCount: 5
campaignClusters:
  - TURRt... / TQvjk... / Verify20: 96 tx, 269,791 USDT
  - TH7t... / TNdp... / Verify20: 5 tx, 55,339 USDT
```

### Exact Proof Summary

Suggested payload concept:

```text
approvalDrainProofSummary:
  candidatesConsidered
  candidatesChecked
  exactProfilesFound
  reviewFindings
  skippedByServiceGuard
  approvalNotFound
  txInfoUnavailable
  proofCoverageStatus
```

This prevents a false reading:

```text
0 exact profiles means no drain
```

when the true state is:

```text
0 exact profiles because the right candidates were not checked or were crowded
out by amount ranking.
```

## Scoring Policy For This Improvement

The scoring policy should remain conservative.

### Contextual Campaign

`Verify20` campaign context can increase review pressure and support a pattern
floor, but by itself it should not be equivalent to exact approval-drain proof.

Suggested behavior:

```text
large repeated wrapper campaign -> HIGH / REVIEW context
exact approval-drain proof -> hard evidence / DECLINE candidate
```

### Exact Proof

Exact approval-drain profiles can drive hard evidence floors and strong
decisions.

They should not be dampened by ordinary missing context if the exact proof is
complete.

### Plain Transfer

Plain USDT transfers should stay in normal flow/volume analysis. They should
not contribute to a drainer-like contract-driven score.

## Admin UX Requirements

Admin should show counters with denominators.

Good summary:

```text
Incoming tx: 116
Tx-info enriched: 116/116
Wrapper-driven incoming: 101
Plain USDT transfer: 15
Exact approval-drain proofs: 5
Campaign clusters: 2
```

If partial:

```text
Incoming tx: 2,400
Tx-info enriched: 200/2,400
Wrapper-driven incoming: 74+ lower bound
Plain USDT transfer: 126 in enriched subset
Campaign classification: partial
```

Admin should avoid a single ambiguous field like:

```text
contract-driven incoming: 29
```

unless it clearly says whether `29` is:

- total enriched profiles;
- lower bound;
- exact wrapper count;
- includes plain transfer calls;
- excludes un-enriched incoming tx.

### Admin Role-Mark Visibility Gap

Manual follow-up on the TPdr DeepCheck jobs showed a second Admin-facing
problem.

Current Admin graph code already has a role-mark mechanism:

```text
nodeIntelligence.role = drainer -> drainer icon / skull role mark
nodeIntelligence.role = victim -> victim role mark
```

It also has projection logic that can mark:

- the receiver/collector wallet as `drainer`;
- the wrapper/spender contract as `Drainer contract`;
- Verify20-debited source wallets as `victim`.

But the saved TPdr DeepCheck jobs did not give Admin enough clean campaign
evidence to apply those marks reliably. The latest checked saved job
`693f30e9-4a7f-4fab-8590-e8f1a456675d` still had:

```text
contractDrivenReceiverProfile.dominantMethod = transfer transfer(address _to,uint256 _value)
contractDrivenIncomingTxCount = 29
contractDrivenTransferProfiles = 29
Verify20 profiles = 14
plain transfer profiles = 15
contractDrivenCampaignSummary = null
approvalDrainProvenanceProfiles = 0
```

So the visual symptom in Admin is understandable:

```text
Victim/source nodes may be marked in some narrow cases, but the checked
receiver wallet and wrapper contract can fail to appear as drainer/skull-marked
for the real TPdr campaign because DeepCheck underreports and pollutes the
campaign payload.
```

This is not only a cosmetic issue. The analyst expects the graph to answer:

```text
Which node is the collector/drainer receiver?
Which smart contract is the drainer/wrapper contract?
Which source wallets look like victims?
```

The future implementation should make this explicit:

- if `contractDrivenCampaignSummary` classifies a strong/dominant Verify20
  campaign, Admin graph must set `nodeIntelligence.role = drainer` on the
  receiver wallet;
- the wrapper/spender contract nodes in those campaign clusters must also get
  `nodeIntelligence.role = drainer` with label `Drainer contract`;
- Verify20 source wallets should get `nodeIntelligence.role = victim` when the
  receiver campaign is drainer-like and the source differs from the receiver;
- the UI role-mark renderer should then show the existing drainer/victim icon
  assets without adding a new icon system;
- partial/lower-bound campaign context should show role marks as behavior
  markers, while exact approval-drain proof can upgrade evidence strength to
  hard.

## Non-Goals

This future implementation should not:

- merge DeepCheck and Where;
- make DeepCheck responsible for current-balance source proof;
- treat every `Verify20` call as exact drain proof;
- remove ordinary transfer activity from DeepCheck;
- hide partial enrichment behind total-looking counters;
- change scoring thresholds before product review.

Where remains the mode for:

```text
where did the relevant funds come from?
```

DeepCheck remains the mode for:

```text
what does the wallet look like as a whole?
```

## Was This Due To The Latest Where Improvement?

Mostly yes, but the wording should be precise.

The improvement is not simply "the index found five". The local index gives the
transfer set and coverage. Exact drainer proof requires more:

1. Balance-forming selection found the relevant current-balance incoming tx.
2. Approval/contract enrichment fetched transaction-info for candidate tx.
3. Approval lookup found valid prior approvals for the same spender.
4. The trace proved the drained USDT reached the checked wallet directly.
5. Contract/LLM context recognized the repeated `Verify20` drainer-like
   wrapper cluster.

The all-time/current index helped because it made the subject transfer set and
coverage trustworthy. The latest Where enrichment/provenance logic helped
because it turned selected candidate transfers into multiple exact
approval-drain profiles instead of only one or only contextual suspicion.

## What To Improve

### 1. Separate Plain Transfer From Drainer-Like Wrapper Calls

DeepCheck should not count a normal USDT transfer as drainer-like
contract-driven evidence just because transaction-info contains a method
signature.

Suggested rule:

```text
If called contract is the canonical USDT contract and method is transfer /
a9059cbb / transfer(address,uint256), classify as plain_usdt_transfer, not
contract_driven_drainer_context.
```

This would remove the 15 `TNAra...` plain transfer profiles from the
drainer-like contract-driven count.

### 2. Add Subject Incoming Tx-Info Enrichment For Suspicious Campaign Detection

DeepCheck should be able to enrich subject incoming tx, not only top expanded
sender edges, when it is trying to build contract-driven receiver/campaign
profiles.

This can be bounded:

- enrich all subject incoming tx when count is small enough;
- otherwise enrich by suspicious selector first;
- prioritize non-plain methods, repeated unknown contracts, same operator,
  same receiver, high unique source count, and recent current-balance candidates.

For this case, enriching all 116 incoming tx was enough to reveal:

```text
101 Verify20 wrapper tx
96 through TURRt... / TQvjk...
5 through TH7t... / TNdp...
```

### 3. Make DeepCheck Multi-Profile For Exact Approval Drain

Current code path in DeepCheck calls the single-profile helper and stores:

```text
approvalDrainProvenanceProfiles: approvalDrainProfile ? [approvalDrainProfile] : []
```

Where uses the multi-profile analysis path and can return several profiles.

DeepCheck should use multi-profile analysis where budget allows, especially
when a campaign pattern is already visible.

### 4. Choose Approval-Drain Candidates By Suspicion, Not Only Amount

If candidates are selected mostly by amount, small current-balance drains can
lose to large historical flows.

This case demonstrates why amount-only ranking is not enough:

- the five exact Where drains are `2,000`, `789`, `669`, `305`, `94` USDT;
- historical Verify20 transfers include much larger amounts like `21,167`,
  `15,000`, `13,105`, `12,000` USDT;
- the smaller current-balance drains were more relevant to the active Where
  answer.

Candidate ranking should boost:

- `Verify20`;
- wrapper contract;
- same spender/operator cluster;
- repeated receiver;
- prior approval found or likely;
- source wallet left near empty / no post-drain outgoing;
- tx selected by Where current-balance or recent-flow logic.

### 5. Add A Drainer Campaign Summary Block

Admin and report payloads should separate:

```text
plain transfer count
wrapper-driven count
Verify20 count
exact approval-drain count
contextual campaign count
contract/operator clusters
victim post-drain behavior
selected-current-balance exact proof
broader historical context
```

For TPdr, a good summary would be:

```text
Incoming tx: 116
Verify20 wrapper incoming tx: 101
Plain USDT transfer incoming tx: 15
Main wrapper cluster: TURRt... / TQvjk..., 96 tx, 269,791 USDT
Second wrapper cluster: TH7t... / TNdp..., 5 tx, 55,339 USDT
Where exact current-balance approval-drain proofs: 5, 3,857 USDT
Deep saved exact approval-drain proofs: 0
Deep saved contract-driven profiles: 29, but 15 are plain transfer false positives
```

## Risks / Failure Modes

### Overclaiming Context As Exact Proof

`Verify20` plus same operator is strong context, but exact approval-drain proof
still requires deterministic approval/spender/transferFrom/path evidence.

DeepCheck should show:

```text
Verify20 campaign context
```

separately from:

```text
exact approval-drain provenance
```

### Polluting Drainer Counts With Plain USDT Transfers

Plain USDT `transfer` calls are contract calls at the blockchain level, but they
are not drainer-like wrapper behavior.

The report must not mix:

```text
USDT contract transfer
```

with:

```text
third-party wrapper calling transferFrom after approval
```

### Missing Smaller Suspicious Flows

A top-amount strategy can miss smaller but more meaningful drainer events.

For Where, small transfers can be important because they form current balance.
For DeepCheck, small repeated transfers can be important because they reveal
campaign structure.

### Confusing Admin Counters

The same wallet can legitimately have:

```text
595 raw local rows
251 dedup subject transfer edges
116 incoming tx
101 Verify20 wrapper tx
29 saved Deep contract-driven profiles
14 saved Deep Verify20 profiles
5 Where exact current-balance approval-drain profiles
```

If Admin labels these loosely, the analyst will see contradictions.

## Proposed Status

Priority: high.

Reason:

This is a real analytical gap in DeepCheck/reporting. `Where is Money` can
already make the right decision for this case, but DeepCheck should be the mode
that exposes the broader wallet/campaign profile. Right now it underreports the
Verify20 footprint and overcounts plain transfer as contract-driven.

Suggested next implementation candidate:

```text
DeepCheck drainer-campaign visibility and contract-driven classification
```

## Candidate Acceptance Criteria

A future implementation should pass cases where:

1. Plain USDT `transfer(address,uint256)` through the canonical USDT contract
   is not counted as drainer-like contract-driven evidence.
2. `Verify20` wrapper calls through non-USDT contracts are counted as wrapper
   campaign context.
3. DeepCheck can enrich enough subject incoming tx to report the full wrapper
   footprint when the incoming tx count is modest.
4. DeepCheck can return multiple exact approval-drain profiles, not only one top
   profile.
5. Candidate ranking includes suspicious method/operator/cluster signals, not
   only amount.
6. Admin shows raw rows, dedup transfer edges, incoming tx, wrapper tx,
   contract-driven profiles and exact profiles as different counters.
7. Reports separate `contextual drainer campaign` from `exact approval-drain
   proof`.
8. A TPdr-like case reports roughly `101 Verify20 wrapper incoming tx` while
   also saying only `5` were selected as exact current-balance Where proof.
9. Admin graph marks the checked receiver wallet and wrapper contract with the
   existing drainer/skull role marker when a dominant Verify20 receiver
   campaign is classified.
10. Admin graph marks Verify20-debited source wallets as victims when the
    receiver campaign is drainer-like and the source wallet differs from the
    receiver.

## Open Product Decision

DeepCheck's product question is broader than Where's:

```text
What does this wallet look like?
```

Recommended direction:

```text
DeepCheck should report broad drainer-campaign context even when Where only
needs a smaller current-balance exact proof subset.
```

This does not mean every `Verify20` event becomes exact hard evidence. It means
the campaign footprint should be visible and correctly categorized.

## Evidence Appendix

Knowledge docs read:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/07-risk-scoring-matrix.md`
- `docs/knowledge/10-open-problems.md`

Runtime data inspected:

- `forensic_check_jobs`
- `tron_address_usdt_index_states`
- `tron_usdt_transfers`
- live/read-only `getTransaction(tx_hash)` for 116 incoming tx

Code behavior inspected:

- `src/check/deepForensicCheck.ts`
- `src/check/whereIsMoneyCheck.ts`
- `src/forensics/contractDrivenEvidence.ts`
- `src/forensics/approvalDrainProvenance.ts`

Important code distinction:

```text
DeepCheck currently calls buildApprovalDrainProvenanceProfile(...)
Where calls buildApprovalDrainProvenanceAnalysis(...)
```

The former returns one top profile or null. The latter can collect multiple
profiles and review findings.
