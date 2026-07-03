---
status: approved-design
date: 2026-07-03
owner_area: deepcheck
code_refs:
  - src/check/deepForensicCheck.ts
  - src/forensics/deepForensicJob.ts
  - src/admin/forensicsGraph.ts
  - src/admin/adminConsole.ts
  - src/storage/repositories.ts
---

# DeepCheck Relationship Expansion v1 Design

## Context

DeepCheck is a wallet relationship and exposure graph, not a `Where is money`
origin trace. It should show the subject wallet's neighborhood, risk exposure,
service boundaries, contracts, labeled/risky proximity, and the factual depth
that was checked.

Admin can already render saved DeepCheck paths from `extendedProvenanceProfiles`,
but the backend only saves opportunistic second or third hops. For most direct
wallets there is no second layer and no explicit reason why expansion stopped.
Current counters such as `secondLayerQueued` and `secondLayerComplete` can stay
at `0` even when `secondLayerActiveBudget` is configured.

The accepted v1 direction is an indexed-first relationship expansion:
DeepCheck reads already indexed direct-wallet histories, queues missing histories,
and never silently omits a direct wallet.

## Goals

- For every direct wallet `A` around `subject`, save a visible answer:
  `expanded`, `grouped`, `stopped_service_boundary`, `stopped_high_degree`,
  `no_meaningful_second_hop`, `not_indexed`, or `queued`.
- Save factual second-hop relationship paths `subject -> A -> B` when local
  indexed history for `A` is available.
- Group large low-signal second-hop tails while keeping groups expandable in
  Admin when member data is stored.
- Queue missing direct-wallet histories with `queuedReason=deep_second_layer`
  and `requestedByJobId=<deep job id>`.
- Add an idempotent completion pass that refreshes the same completed DeepCheck
  job after queued direct-wallet indexes complete.
- Keep scoring unchanged.
- Keep `Where is money` and Incoming behavior unchanged, except for reusing safe
  indexed-read and service-boundary helpers.

## Non-Goals

- Do not copy `Where is money` path selection or scoring.
- Do not block the initial DeepCheck job until every queued direct wallet is
  indexed.
- Do not treat second-layer budget counters as proof of completed work.
- Do not expand service, exchange, DEX, bridge, contract, or high-degree wallets
  indefinitely.

## Prerequisite

The direct boundary used by DeepCheck must be the full factual direct boundary
available from the local index, bounded only by the materialization safety limit.
If the implementation is based on a branch where all-time direct reads are still
capped by `fetchedTransferCount`, that cap must be fixed before relying on the
new second-layer logic. Otherwise v1 would expand an already truncated first
layer.

## Backend Builder

Add a deterministic helper, tentatively:

```ts
buildSecondLayerRelationshipProfiles(input): SecondLayerRelationshipProfile
```

Inputs:

- `subjectAddress`;
- `directBoundaryAddresses`;
- direct interaction profiles and classifications;
- indexed transfer reader;
- index state reader or supplied index state map;
- queue callback for missing eligible direct wallets;
- limits.

Output facts only:

- paths;
- grouped tails;
- stopped direct wallets;
- per-direct-wallet statuses;
- counters;
- generation metadata.

The helper must not produce risk observations, modify scores, or call any
`Where is money` decision logic.

## Initial DeepCheck Pass

After DeepCheck builds the direct boundary:

1. Iterate all direct wallets `A` in deterministic order.
2. Classify `A`.
3. If `A` is service/CEX/DEX/bridge/contract, store
   `stopped_service_boundary`.
4. If `A` is high-degree, store `stopped_high_degree`.
5. If `A` is ordinary and indexed history is complete enough, read `A <-> B`.
6. Select top meaningful second-hop neighbors `B`.
7. Save paths `subject -> A -> B` for selected neighbors.
8. Group large low-signal tails.
9. If no meaningful `B` exists, store `no_meaningful_second_hop`.
10. If `A` is not indexed, queue history with
    `queuedReason=deep_second_layer` and `requestedByJobId=job.id`, then store
    `queued` or `not_indexed`.

The initial job completes without waiting for queued `A` indexes.

## Completion Pass

Add an idempotent refresh helper, tentatively:

```ts
refreshDeepCheckSecondLayerFromIndex(jobId): Promise<RefreshResult>
```

Behavior:

- works only for completed `address_deep_check` jobs;
- reads the existing `result_json`;
- finds `queued` and `not_indexed` direct wallets;
- checks their index states;
- for direct wallets that are now complete, rebuilds only the second-layer block;
- leaves unrelated DeepCheck result sections unchanged;
- patches `result_json` and progress counters without changing job status,
  `completed_at`, raw evidence ids, or lifecycle state.

This requires a narrow repository function such as:

```ts
updateCompletedDeepCheckResultPatch(input)
```

It must be scoped to completed `address_deep_check` jobs and must not reuse
`completeForensicCheckJob`, because `completeForensicCheckJob` rewrites lifecycle
fields.

Background completion is the preferred path. An Admin "Refresh second layer"
button can call the same refresh helper as a manual fallback.

## Data Model

Add a top-level `result_json.secondLayerRelationshipProfiles` block.

Recommended shape:

```ts
{
  version: 1,
  source: "deepcheck_relationship_expansion_v1",
  generatedAt: string,
  subjectAddress: string,
  directWalletStatuses: DirectWalletSecondLayerStatus[],
  paths: SecondLayerRelationshipPath[],
  groups: SecondLayerRelationshipGroup[],
  counters: SecondLayerRelationshipCounters,
  limits: SecondLayerRelationshipLimits
}
```

Direct wallet status fields:

- stable id;
- address;
- status;
- reason or `limitationCode`;
- classification snapshot;
- index state summary;
- queued flag;
- direct profile references.

Path fields:

- stable id;
- `pathAddresses: [subject, A, B]`;
- edge metadata;
- direction;
- tx hashes;
- amount raw;
- tx count;
- timestamp range;
- source `deepcheck_relationship_second_hop`;
- selection reason.

Group fields:

- stable id;
- anchor direct wallet `A`;
- group kind:
  `low_signal_neighbors`, `service_endpoints`, `small_transfers`,
  `high_degree_suppressed`;
- member count;
- aggregate amount and tx count;
- optional stored members for Admin expansion.

Counters:

- direct wallets total;
- direct wallets considered;
- eligible;
- expanded;
- grouped;
- stopped;
- no meaningful second hop;
- not indexed;
- queued;
- complete;
- max saved depth.

Stable ids must be derived from job id, subject, anchor wallet, group kind,
neighbor wallet, and relevant tx identity so refreshes do not duplicate paths.

## Selection And Limits

Required limits:

- `maxDirectWalletsConsidered`;
- `maxExpandedDirectWallets`;
- `maxSecondHopNeighborsPerDirectWallet`;
- `maxTotalSecondHopEdges`;
- `highDegreeSuppressionThreshold`.

Second-hop neighbor ranking:

1. risky, labeled, drainer, risky contract, or gray exposure;
2. larger amount;
3. repeated tx count;
4. recent activity;
5. non-service ordinary wallets;
6. address as final tie-break.

Service second-hop neighbors can be shown as boundary context but are not
expanded further in v1.

## Admin

Admin graph projection should render the new block in addition to the existing
saved `extendedProvenanceProfiles`.

Required UI behavior:

- show `subject -> A -> B` as `deepcheck_relationship_second_hop`;
- show non-subject wallet-to-wallet edges clearly;
- make second-hop edge styling more visible than the current faint dotted
  cross-wallet lines;
- show every direct wallet status in node metadata and the right rail;
- render groups as group nodes;
- allow group expansion when stored members exist;
- legend separates direct subject edge, second-hop edge, grouped tail,
  stopped/boundary, queued, and not indexed;
- summary shows queued and complete counters separately;
- never claim second layer is complete while queued or not-indexed counts are
  non-zero.

## Tests

Backend helper tests:

- ordinary direct wallet `A` with indexed `A -> B` saves `subject -> A -> B`;
- service direct wallet creates `stopped_service_boundary`;
- high-degree wallet creates `stopped_high_degree`;
- direct wallet without index creates `queued` or `not_indexed`;
- indexed ordinary wallet with no useful neighbors creates
  `no_meaningful_second_hop`;
- many low-signal neighbors create an expandable group;
- counters and stable ids are deterministic.

Job runner tests:

- initial DeepCheck queues missing eligible direct wallets with
  `queuedReason=deep_second_layer` and `requestedByJobId`;
- result JSON contains one status per direct wallet;
- scoring output does not change.

Completion tests:

- refresh only accepts completed `address_deep_check` jobs;
- refresh is idempotent;
- completed queued wallets are expanded from fresh index data;
- repository patch updates result/progress without changing `completed_at`.

Admin tests:

- `subject -> A -> B` renders as a second-hop edge;
- group node renders and expands members;
- queued, not-indexed, stopped, grouped, and expanded statuses appear in
  metadata/right rail;
- legend and summary distinguish direct, second-hop, grouped, stopped, queued,
  and not indexed.

Regression tests:

- no `Where is money` behavior changes;
- no Incoming behavior changes;
- no risk scoring changes.

## Rollout

Implement behind explicit DeepCheck options and conservative limits. Keep
existing `extendedProvenanceProfiles` rendering for historical jobs. New jobs use
`secondLayerRelationshipProfiles`; older jobs remain visible through the current
saved-path projection.
