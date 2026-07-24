# Unified Wallet Check P1 Evidence Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce dense traversal only where frozen, versioned evidence proves a service or economic attribution boundary.

**Architecture:** Build a supported, provenance-bearing label catalog before a run, freeze it into the analysis manifest, and evaluate pure versioned boundary predicates against event-time evidence. Missing labels, elapsed time, graph size and coverage never terminate traversal. New closure semantics are accepted through neutral Golden cases and adjudication; exact expected scores are locked only afterwards.

**Tech Stack:** TypeScript, canonical JSON/SHA-256 artifacts, existing Golden Pilot V2 offline package and production comparator, Vitest, PostgreSQL.

**Prerequisite:** P0 plan completed with frozen semantic equivalence.

**Design:** `docs/superpowers/specs/2026-07-24-unified-wallet-check-traversal-performance-design.md`

---

## File map

- Create `src/unifiedCheck/labelCatalog.ts`: supported catalog V1, provenance
  validation and frozen dataset builder.
- Create `src/unifiedCheck/boundaryPredicates.ts`: pure versioned terminal
  decisions and canonical boundary evidence.
- Modify `src/unifiedCheck/contracts.ts`: bind catalog and predicate versions.
- Modify `src/unifiedCheck/requestService.ts` and
  `src/unifiedCheck/productionRuntime.ts`: freeze labels before traversal.
- Modify `src/unifiedCheck/productionTraversal.ts`: consume only frozen labels
  and terminal evidence.
- Modify `src/forensics/serviceClassifier.ts` and
  `src/forensics/serviceRouteRegistry.ts`: export exact supported catalog
  entries; keyword-only matches remain hints.
- Add neutral boundary cases to `docs/audit/2026-07-system-audit/golden-v2`
  source/control areas without importing production code.
- Modify production comparator tests only after adjudication artifacts exist.
- Update knowledge pages 04, 06, 07, 09 and 10.

### Task 1: Define the exact supported label catalog contract

**Files:**
- Create: `src/unifiedCheck/labelCatalog.ts`
- Create: `tests/unified-check/labelCatalog.test.ts`
- Modify: `src/forensics/serviceClassifier.ts`
- Modify: `src/forensics/serviceRouteRegistry.ts`

- [ ] **Step 1: Write RED tests for catalog membership and evidence strength**

```typescript
it.each([
  ["Binance", "cex"],
  ["Bybit", "cex"],
  ["OKX", "cex"],
  ["WhiteBIT", "cex"],
  ["Coinbase", "cex"],
  ["Kraken", "cex"],
  ["KuCoin", "cex"],
  ["Bitget", "cex"],
  ["MEXC", "cex"],
  ["Bitstamp", "cex"],
  ["Crypto.com", "cex"],
  ["HTX/Huobi", "cex"],
  ["SunSwap/SUN", "dex"],
  ["Allbridge", "bridge"],
  ["Bridgers", "bridge"],
  ["USDD PSM/GemJoin", "protocol"],
  ["GasFree Endpoint", "service"],
  ["TronLink GasFree provider", "service"]
])("includes %s as supported %s identity", (identity, category) => {
  expect(SUPPORTED_LABEL_CATALOG_V1.entries)
    .toContainEqual(expect.objectContaining({ identity, category }));
});

it("keeps an unbound keyword match as a non-terminal hint", () => {
  const result = buildFrozenLabelRecord({
    address: UNKNOWN,
    classifierHint: { identity: "Bybit", category: "cex" },
    exactRegistryBinding: null,
    verifiedProviderBinding: null
  });
  expect(result.strength).toBe("hint");
  expect(result.terminalEligible).toBe(false);
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/labelCatalog.test.ts
```

- [ ] **Step 3: Implement catalog V1**

```typescript
export type SupportedLabelCatalogEntryV1 = {
  readonly id: string;
  readonly identity: string;
  readonly category:
    | "cex" | "dex" | "bridge" | "protocol" | "service" | "restriction";
  readonly addressBindings: readonly string[];
  readonly acceptedAuthorities: readonly string[];
  readonly temporalPolicy: "event_time" | "current_identity";
  readonly terminalPolicy:
    | "custodial_boundary"
    | "route_dependent"
    | "economic_role_required"
    | "restriction_policy";
};

export const SUPPORTED_LABEL_CATALOG_V1 = Object.freeze({
  version: "unified-label-catalog-v1" as const,
  entries: Object.freeze([
    ["cex:binance", "Binance", "cex"],
    ["cex:bybit", "Bybit", "cex"],
    ["cex:okx", "OKX", "cex"],
    ["cex:whitebit", "WhiteBIT", "cex"],
    ["cex:coinbase", "Coinbase", "cex"],
    ["cex:kraken", "Kraken", "cex"],
    ["cex:kucoin", "KuCoin", "cex"],
    ["cex:bitget", "Bitget", "cex"],
    ["cex:mexc", "MEXC", "cex"],
    ["cex:bitstamp", "Bitstamp", "cex"],
    ["cex:crypto-com", "Crypto.com", "cex"],
    ["cex:htx-huobi", "HTX/Huobi", "cex"],
    ["dex:sunswap", "SunSwap/SUN", "dex"],
    ["bridge:allbridge", "Allbridge", "bridge"],
    ["bridge:bridgers", "Bridgers", "bridge"],
    ["protocol:usdd-psm", "USDD PSM/GemJoin", "protocol"],
    ["service:gasfree-controller", "GasFree Endpoint", "service"],
    ["service:tronlink-gasfree", "TronLink GasFree provider", "service"]
  ].map(([id, identity, category]) => Object.freeze({
    id,
    identity,
    category,
    addressBindings: Object.freeze([]),
    acceptedAuthorities: Object.freeze([
      "internal_service_registry",
      "tronscan_verified_metadata"
    ]),
    temporalPolicy: id === "cex:htx-huobi"
      ? "event_time"
      : "current_identity",
    terminalPolicy: category === "cex"
      ? "custodial_boundary"
      : category === "dex" || category === "bridge"
        ? "route_dependent"
        : "economic_role_required"
  } satisfies SupportedLabelCatalogEntryV1)))
});
```

Populate exact known addresses from existing registries:

```text
USDD PSM reserve: TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ
GasFree Controller: TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U
TronLink GasFree provider: TLntW9Z59LYY5KEi9cmwk3PKjQga828ird
Bridgers spender: TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s
```

CEX and route entries without hard-coded addresses require verified provider
metadata plus source payload hash. Do not convert the current keyword table
into address evidence.

- [ ] **Step 4: Verify GREEN and legacy classifier behavior**

```powershell
npm test -- tests/unified-check/labelCatalog.test.ts tests/forensics/serviceClassifier.test.ts tests/forensics/serviceRouteRegistry.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/labelCatalog.ts src/forensics/serviceClassifier.ts src/forensics/serviceRouteRegistry.ts tests/unified-check/labelCatalog.test.ts
git commit -m "feat(unified-check): define supported frozen label catalog"
```

### Task 2: Freeze a provenance-bearing label dataset before traversal

**Files:**
- Modify: `src/unifiedCheck/contracts.ts`
- Modify: `src/unifiedCheck/requestService.ts`
- Modify: `src/unifiedCheck/productionRuntime.ts`
- Create: `tests/unified-check/frozenLabels.test.ts`
- Modify: `tests/unified-check/requestService.postgres.test.ts`

- [ ] **Step 1: Write RED contract tests**

Assert the analysis manifest binds:

```typescript
expect(manifest).toMatchObject({
  labelDatasetSha256: SHA,
  labelCatalogVersion: "unified-label-catalog-v1",
  boundaryPredicateVersion: "unified-boundary-predicates-v1"
});
```

Test that changing authority, validity interval, address binding or catalog
version changes dataset hash. A run must continue reading the original frozen
dataset after live metadata changes.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/frozenLabels.test.ts tests/unified-check/requestService.postgres.test.ts
```

- [ ] **Step 3: Add the frozen artifact**

```typescript
export type FrozenLabelDatasetV1 = {
  readonly version: "unified-frozen-label-dataset-v1";
  readonly catalogVersion: "unified-label-catalog-v1";
  readonly frozenAt: string;
  readonly snapshotHash: string;
  readonly labels: readonly {
    readonly address: string;
    readonly catalogEntryId: string | null;
    readonly identity: string;
    readonly category: string;
    readonly strength: "exact_registry" | "verified_provider" | "hint";
    readonly authority: string;
    readonly validFrom: string | null;
    readonly validTo: string | null;
    readonly sourcePayloadSha256: string;
    readonly terminalEligible: boolean;
  }[];
};
```

Sort records by normalized address and evidence identity before hashing. Persist
`frozen_label_dataset` before `analysis_manifest`. Bind its hash and catalog
versions into the manifest. A provider failure while enriching labels uses
existing waiting/technical states; it does not silently fall back to an empty
dataset.

- [ ] **Step 4: Verify GREEN and restart determinism**

```powershell
npm test -- tests/unified-check/frozenLabels.test.ts tests/unified-check/requestService.postgres.test.ts tests/unified-check/productionRuntime.postgres.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/contracts.ts src/unifiedCheck/requestService.ts src/unifiedCheck/productionRuntime.ts tests/unified-check/frozenLabels.test.ts tests/unified-check/requestService.postgres.test.ts
git commit -m "feat(unified-check): freeze label provenance per run"
```

### Task 3: Implement pure versioned boundary predicates

**Files:**
- Create: `src/unifiedCheck/boundaryPredicates.ts`
- Create: `tests/unified-check/boundaryPredicates.test.ts`

- [ ] **Step 1: Write RED positive and negative tests**

Positive cases:

```text
exact custodial CEX address at event time → identified_service_boundary
proved Allbridge pooled endpoint → shared_liquidity_boundary
USDD PSM exact reserve with economic role → contract_economic_boundary
restriction valid at transfer → policy_or_restriction_boundary
```

Negative cases:

```text
unknown high-volume wallet → continue
collector with 500 senders → continue
keyword-only "Bybit" hint → continue
label valid only after transfer → continue with later-label context
SunSwap route with exact continuation → continue
generic contract metadata → continue
elapsed time/depth/frontier/coverage inputs → not accepted by API
```

Example:

```typescript
expect(evaluateBoundaryV1({
  state: STATE,
  labels: [VERIFIED_BYBIT],
  route: { continuationProven: false },
  eventTimestamp: STATE.anchorTimestamp
})).toMatchObject({
  reason: "identified_service_boundary",
  predicateVersion: "unified-boundary-predicates-v1"
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/boundaryPredicates.test.ts
```

- [ ] **Step 3: Implement explicit predicates**

```typescript
export type BoundaryDecisionV1 =
  | {
      readonly terminal: true;
      readonly reason: TraversalTerminalReason;
      readonly predicateVersion: "unified-boundary-predicates-v1";
      readonly evidence: BoundaryEvidenceV1;
    }
  | {
      readonly terminal: false;
      readonly contextEvidence: readonly BoundaryContextEvidenceV1[];
    };

export function evaluateBoundaryV1(
  input: BoundaryPredicateInputV1
): BoundaryDecisionV1 {
  const labels = input.labels.filter((label) =>
    labelIsValidAt(label, input.eventTimestamp)
  );
  const exact = labels.filter((label) =>
    label.terminalEligible &&
    (label.strength === "exact_registry" ||
      label.strength === "verified_provider")
  );
  // Explicit category/route/economic-role switches only.
}
```

The input type must not include elapsed time, coverage, depth, queue pressure or
frontier size. `unidentified_structural_boundary` returns terminal only from an
explicit structural proof artifact; keep it disabled for ordinary live states
until its Golden case is adjudicated.

- [ ] **Step 4: Verify GREEN**

```powershell
npm test -- tests/unified-check/boundaryPredicates.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/boundaryPredicates.ts tests/unified-check/boundaryPredicates.test.ts
git commit -m "feat(unified-check): add evidence-only traversal boundaries"
```

### Task 4: Integrate boundary artifacts into traversal closure

**Files:**
- Modify: `src/unifiedCheck/productionTraversal.ts`
- Modify: `src/unifiedCheck/traversal.ts`
- Modify: `tests/unified-check/productionTraversal.test.ts`
- Modify: `tests/unified-check/traversal.test.ts`

- [ ] **Step 1: Write RED integration tests**

Assert:

- terminal state stores predicate version, frozen dataset hash, source payload
  hashes and event-time decision;
- amount remains conserved;
- direct/indirect role and direction remain unchanged;
- non-terminal context labels remain in evidence but not terminal list;
- completion still requires empty frontier and zero unclassified/dropped
  states.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- tests/unified-check/productionTraversal.test.ts tests/unified-check/traversal.test.ts
```

- [ ] **Step 3: Replace category-set shortcut with predicate evaluation**

Remove `IDENTIFIED_SERVICE_LABELS` and `RESTRICTION_LABELS` from
`productionTraversal.ts`. Load label records from the exact frozen dataset
hash, call `evaluateBoundaryV1()`, persist
`traversal_boundary_evidence_v1`, and use its canonical hash in the terminal
record.

Do not call legacy live `classifyServiceAddress()` during traversal.

- [ ] **Step 4: Verify GREEN and closure properties**

```powershell
npm test -- tests/unified-check/productionTraversal.test.ts tests/unified-check/traversal.test.ts tests/unified-check/canonicalArtifacts.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/unifiedCheck/productionTraversal.ts src/unifiedCheck/traversal.ts tests/unified-check/productionTraversal.test.ts tests/unified-check/traversal.test.ts
git commit -m "feat(unified-check): close traversal at proven boundaries"
```

### Task 5: Add neutral P1 Golden boundary cases

**Files:**
- Modify: `docs/audit/2026-07-system-audit/golden-v2/case-catalog.json`
- Create: `docs/audit/2026-07-system-audit/golden-v2/artifacts/source/p1-boundary-*.json`
- Modify: `tests/golden-v2/contracts.test.ts`
- Modify: `tests/golden-v2/validator.test.ts`

- [ ] **Step 1: Add cases without expected exact scores**

Required cases:

```text
p1-cex-exact-at-event
p1-cex-later-label
p1-shared-liquidity-proven
p1-collector-not-liquidity
p1-usdd-psm-economic-boundary
p1-generic-contract-continues
p1-dex-route-continues
p1-unknown-dense-continues
p1-structural-proof-boundary
```

Each neutral bundle contains facts, labels, validity intervals, route/economic
proof and provenance only. It must contain no system score or system narrative.

- [ ] **Step 2: Write RED validator tests**

Reject a case if it includes `score`, `expectedScore`, `decisionNarrative` or
missing source hashes. Require expected terminal/non-terminal property and
amount conservation.

- [ ] **Step 3: Implement offline validators and generate hashes**

The Golden package imports no production module. Reuse its existing canonical
JSON implementation. Generate neutral bundle hash, provenance manifest hash and
validator receipt for every new case.

- [ ] **Step 4: Run Golden targeted validation**

```powershell
npm test -- tests/golden-v2/contracts.test.ts tests/golden-v2/validator.test.ts
npm run golden:v2:verify
```

Expected: neutral package validates; no comparator expected score is changed.

- [ ] **Step 5: Commit neutral P1 inputs**

```powershell
git add docs/audit/2026-07-system-audit/golden-v2 tests/golden-v2
git commit -m "test(golden-v2): add neutral traversal boundary cases"
```

### Task 6: Conduct P1 blind review and adjudication before exact scores

**Files:**
- Create: `docs/audit/2026-07-system-audit/golden-v2/reviews/p1-boundary-*/reviewer-a.json`
- Create: `docs/audit/2026-07-system-audit/golden-v2/reviews/p1-boundary-*/reviewer-b.json`
- Create: `docs/audit/2026-07-system-audit/golden-v2/adjudication/p1-boundary-*.json`
- Modify: locked Golden artifacts through the existing coordinator only
- Modify: `tests/unified-check/comparator.test.ts`

- [ ] **Step 1: Produce two independent reviews**

Reviewers receive neutral bundles, not production results. They decide:

- terminal reason or continue;
- evidence role/direction/time;
- score properties and relations;
- whether the boundary supplies any scoring evidence.

They do not copy a production score.

- [ ] **Step 2: Adjudicate disagreements**

The adjudication must resolve predicate semantics first. Only after that may it
set an exact expected score. A context-only boundary normally preserves the
case score; hard evidence remains governed by matrix v4.

- [ ] **Step 3: Generate a new locked Golden package**

Use the existing Golden coordinator. Never edit a locked JSON artifact by
hand. Record the new manifest SHA and scoring/attribution/predicate versions.

- [ ] **Step 4: Update and run production comparator**

```powershell
npm run golden:v2:verify
npm run unified:golden:compare
npm test -- tests/unified-check/comparator.test.ts tests/unified-check/goldenBindings.test.ts
```

Expected: exact scores exist only in adjudicated locked artifacts and production
matches them.

- [ ] **Step 5: Commit adjudicated artifacts**

```powershell
git add docs/audit/2026-07-system-audit/golden-v2 src/unifiedCheck/goldenComparatorV1.generated.ts tests/unified-check
git commit -m "test(golden-v2): lock adjudicated traversal boundaries"
```

### Task 7: Measure graph reduction and update product truth

**Files:**
- Create: `docs/audit/2026-07-system-audit/unified-performance/p1-summary.json`
- Modify: `docs/knowledge/04-data-sources-tronscan-indexing.md`
- Modify: `docs/knowledge/06-deepcheck.md`
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Run P1 targeted tests**

```powershell
npm run typecheck
npm test -- tests/unified-check/labelCatalog.test.ts tests/unified-check/frozenLabels.test.ts tests/unified-check/boundaryPredicates.test.ts tests/unified-check/productionTraversal.test.ts tests/unified-check/comparator.test.ts
```

- [ ] **Step 2: Run the same frozen performance cases**

Compare P1 against P0 using identical semantic benchmark identity. Record work
saved by each boundary reason separately. Do not claim a speedup from a
non-adjudicated boundary.

- [ ] **Step 3: Verify Telegram and score ownership**

```powershell
npm test -- tests/bot/unifiedTelegramProductionPaths.acceptance.test.ts tests/telegram/unifiedForensicRenderer.acceptance.test.ts tests/unified-check/verticalSlice.acceptance.test.ts
```

Assert one final message, exact adjudicated score, no partial output and no
coverage/time publication condition.

- [ ] **Step 4: Update knowledge docs**

Document supported catalog V1, frozen provenance, event-time semantics,
boundary predicates and the new locked Golden manifest SHA.

- [ ] **Step 5: Commit P1 milestone**

```powershell
git add src tests docs/knowledge docs/audit/2026-07-system-audit/unified-performance/p1-summary.json
git commit -m "feat(unified-check): complete adjudicated evidence boundaries"
```

## P1 stop conditions

Stop P1, leaving completed P0 intact, if:

- neutral evidence cannot distinguish collector from shared liquidity;
- a route boundary loses event-time or direction semantics;
- a proposed label has no exact/verified address provenance;
- reviewers have not adjudicated a new predicate or exact score;
- production output is used to seed reviewer expectations.

Do not weaken P0 equivalence, introduce graph-size heuristics or publish a score
before `COMPLETED`.
