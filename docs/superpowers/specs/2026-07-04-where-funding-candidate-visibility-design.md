# Where Funding Candidate Visibility Design

Date: 2026-07-04

## Problem

`Where is money` and `DeepCheck` must not use the same graph expansion rule.

DeepCheck can show a broader saved relationship graph because its job is to
surface surrounding wallet relationships and boundaries. `Where is money`
answers a narrower product question:

```text
Where could the money for this concrete step have come from?
```

If Admin renders every neighbor transfer around every Where hop, the graph
turns into a relationship cloud. That hides the selected money route and makes
weak context look like provenance.

The Where graph needs richer visibility than a single route line, but only for
transfers that explain a concrete hop by amount, time, and coverage.

## Decision

Admin should show a route-focused Where graph with funding candidates attached
to concrete route hops.

The graph must not render all wallet relationships. A funding candidate appears
only when it helps explain the source of funds for a specific hop transfer:

```text
candidate funding transfer -> hop wallet -> next hop / subject
```

Approved candidate visibility limits:

- show up to 20 best `exact` funding candidate edges across the whole Where job;
- use a soft cap of 5 `exact` candidates per hop;
- allow an important hop to exceed the soft per-hop cap when it explains the
  main checked amount;
- group over-limit candidates instead of dropping them silently.

## Scope

In scope:

- Admin graph projection for ordinary `where_is_money_check`;
- candidate selection and visibility policy for already-computed Where
  `source_provenance` / funding-first facts;
- visual distinction between selected route, exact funding, probable funding,
  unresolved caveats, pre-existing-balance caveats, and service boundaries;
- graph summary counters for shown and hidden candidates.

Out of scope:

- DeepCheck relationship expansion;
- showing arbitrary wallet neighbors in Where;
- changing risk scoring;
- treating `probable` funding as hard proof;
- raising targeted indexing budgets;
- changing Where/Incoming lifecycle behavior.

## Candidate Gates

A transfer can become a Where funding candidate only if it passes the candidate
gates for a concrete target hop.

### Direction Gate

Only incoming transfers into the hop wallet can fund that hop.

For target hop:

```text
H -> R at time T amount A
```

a candidate must be:

```text
F -> H before T
```

Outgoing transfers, peer links, same-address context, and unrelated wallet
relationships are not candidates.

### Time Gate

The candidate transfer must happen before the target hop transfer.

Recent candidates are ranked higher. Old candidates can still be represented,
but if the covered history cannot prove they remained available, they should
be modeled as `pre_existing_balance_possible` or `probable`, not as exact
funding proof.

### Amount Gate

The candidate must explain a meaningful part of the target hop amount.

Dust and low-share inputs should be grouped as low-signal tail data unless
they are needed to explain a material amount.

### Spend Guard

If funds from the candidate were visibly spent elsewhere before the target hop,
the candidate must be downgraded or excluded.

The graph should not imply that money funded the target hop when covered
outgoing history shows that the money was already consumed.

### Coverage Gate

Candidate proof class depends on coverage:

- `exact`: covered funding window, amount math passes, and spend guard passes;
- `probable`: amount and time support the candidate, but the window is capped
  or incomplete;
- `pre_existing_balance_possible`: reached history does not prove a usable
  candidate, but earlier balance could exist;
- `unresolved`: source provenance could not be proven;
- `service_boundary`: provenance reaches a service, exchange, bridge, router,
  known service wallet, or contract boundary.

Only `exact` candidates should be drawn as proven funding edges.

### Boundary Gate

Service, CEX, DEX, bridge, router, contract, and high-degree boundary addresses
must not expand like ordinary wallets.

Admin should show them as boundary nodes or boundary stops, with metadata
explaining why the route stops there.

## Ranking

Exact candidates should be ranked before applying the 20-edge global cap.

Recommended ranking order:

1. larger amount coverage of the target hop;
2. closer time proximity to the target hop;
3. stronger coverage and spend-guard confidence;
4. stronger labels or hard evidence;
5. lower ambiguity.

Probable candidates should have their own weaker ranking and stricter display
limit. They are context, not the selected money route.

## Admin Graph Behavior

The default Where view should remain route-focused.

Admin canvas should show:

- the selected route spine as the main money-flow path;
- exact funding candidates as real incoming funding edges into the relevant
  hop, up to the global cap of 20;
- probable candidates as weaker contextual edges or grouped candidate nodes;
- unresolved and pre-existing-balance outcomes as caveat/stop nodes;
- service/CEX/DEX/bridge/router/contract outcomes as boundary nodes;
- grouped tails for over-limit or low-signal candidates.

The graph must distinguish:

- selected route edge;
- exact funding candidate edge;
- probable funding context;
- unresolved source caveat;
- pre-existing balance caveat;
- service boundary;
- grouped candidate tail.

The legend should not make probable, unresolved, or grouped candidates look like
proven money flow.

## Summary Counters

Admin summary should expose candidate visibility clearly:

```text
Exact funding candidates shown: 20 / 43
Probable candidates shown: 3 / 18
Grouped low-signal candidates: 21
Unresolved source caveats: 4
Service boundaries: 2
Max proven route depth: N
```

The exact labels can follow local Admin terminology, but the meaning must stay
clear: shown counts are not total wallet relationships, they are candidates
that passed the Where funding gates.

## Full Evidence Mode

Manual `Full evidence` may show more graph API payload than the default
Investigative view, but it should still preserve semantic roles.

Even in Full evidence, Where should not imply that every neighbor edge is a
money source. Edges that are only context should remain visually contextual and
should not be promoted to selected route or exact funding status.

## Acceptance Criteria

- A Where job with one route hop and 3 exact funding candidates renders all 3
  exact candidate edges attached to that hop.
- A Where job with 30 exact candidates renders the top 20 exact candidates and
  a grouped over-limit tail for the remaining 10.
- A hop with more than 5 exact candidates normally groups after the soft cap,
  unless that hop explains the main checked amount and consumes more of the
  global cap.
- Probable candidates are visible as context but not drawn as hard proof.
- Unresolved and pre-existing-balance outcomes are caveats/stops, not money
  source edges.
- Service/CEX/DEX/bridge/router/contract addresses render as boundaries and do
  not expand as ordinary wallets.
- Admin legend explains selected route, exact funding, probable context,
  caveat, boundary, and grouped tail roles.
- No scoring behavior changes.

## Transfer Note

This spec captures the side-conversation decision for transfer back into the
main development thread.

Core rule:

```text
Where shows links that explain a concrete money step, not all neighboring links
for an address.
```
