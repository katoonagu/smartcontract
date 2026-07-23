# TRON USDT Golden Pilot V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline, production-independent Golden Pilot V2 that turns frozen neutral TRON USDT evidence into two blind reviews, adjudicated decisions and scores, locked deterministic artifacts, and a production-comparator contract.

**Architecture:** A standalone package under `tools/golden-pilot-v2/` owns strict schemas, canonical JSON, hashing, neutralization, attribution comparison, review locking, adjudication, and final manifest locking. It may read only explicit files and never imports `src/`, opens the production database, calls TronScan, runs a production analyzer, or receives a system score/narrative. Plan B consumes only the locked comparator contract and Golden artifacts after adjudication.

**Tech Stack:** TypeScript 5.7, Node.js 22 built-ins, TronWeb 6 address validation, Vitest 4, SHA-256, JSON/Markdown artifacts. No new dependency, SQL migration, network access, or production runtime change.

---

## Source of Truth and Dependency Boundary

Implement against:

- `docs/superpowers/specs/2026-07-23-unified-wallet-check-golden-pilot-v2-design.md`;
- reviewed design commit `73e65aa6`;
- current baseline code commit recorded by the design: `0024deb4da72efb843b156596ddda065750586ab`.

Plan A is one independently testable subsystem:

```text
explicit frozen source files
→ neutral export + no-leak receipt
→ reviewer A workspace + reviewer B workspace
→ immutable review locks
→ unblind + adjudication
→ selected attribution policy
→ exact decisions/scores/properties/dossier expectations
→ locked Golden manifest + comparator contract
```

The production-importing comparator, Unified worker, scoring v4 implementation,
Telegram renderer, live canary, and rollout belong to
`2026-07-23-unified-wallet-check.md`.

Plan B infrastructure may start after Task 3 locks schemas. Plan B scoring,
selected attribution, comparator expectations, and exact Telegram fixtures must
wait for Task 8.

## File Responsibility Map

### New offline package

| File | Responsibility |
|---|---|
| `tools/golden-pilot-v2/contracts.ts` | Strict public artifact types and parsers |
| `tools/golden-pilot-v2/canonicalJson.ts` | Independent canonical JSON and SHA-256 |
| `tools/golden-pilot-v2/artifactStore.ts` | Safe paths, atomic write-once publication, verification |
| `tools/golden-pilot-v2/neutralExport.ts` | Allowlist projection, forbidden-field scan, provenance and inventory receipts |
| `tools/golden-pilot-v2/attribution.ts` | FIFO, LIFO and proportional attribution over frozen transfers |
| `tools/golden-pilot-v2/reviewWorkspace.ts` | Blind workspace creation and immutable review lock |
| `tools/golden-pilot-v2/adjudication.ts` | Unblind, disagreements, adjudication and policy selection |
| `tools/golden-pilot-v2/lockedManifest.ts` | Final hash graph, Golden lock and comparator format |
| `tools/golden-pilot-v2/cli.ts` | Dependency-injected offline command dispatcher |
| `scripts/tronUsdtGoldenPilotV2.ts` | Thin process entrypoint |

### New tests and fixtures

| File | Responsibility |
|---|---|
| `tests/golden-v2/isolation.test.ts` | Prove no production/network/DB import path |
| `tests/golden-v2/contracts.test.ts` | Strict schemas and case grouping |
| `tests/golden-v2/canonicalJson.test.ts` | Canonical bytes, hashes and write-once behavior |
| `tests/golden-v2/neutralExport.test.ts` | No score/narrative leakage and provenance receipts |
| `tests/golden-v2/attribution.test.ts` | FIFO/LIFO/proportional conservation |
| `tests/golden-v2/reviewWorkspace.test.ts` | Blind equality and immutable review locks |
| `tests/golden-v2/adjudication.test.ts` | Two-review gate, disagreements and exact-score timing |
| `tests/golden-v2/lockedManifest.test.ts` | Hash graph and comparator contract |
| `tests/golden-v2/cli.acceptance.test.ts` | Complete synthetic offline workflow |
| `tests/fixtures/golden-v2/builders.ts` | Test-only valid artifact builders |
| `tests/fixtures/golden-v2/synthetic-cases.json` | Empty/new/legitimate/unknown/blacklist/approval/victim/operational/dust cases |
| `tests/fixtures/golden-v2/dense500PageFixture.ts` | Deterministic generated performance/property input without a huge tracked JSON |

### New tracked Golden control files

| File | Responsibility |
|---|---|
| `docs/audit/2026-07-system-audit/golden-v2/protocol.json` | Review/adjudication protocol |
| `docs/audit/2026-07-system-audit/golden-v2/case-catalog.json` | Blind, regression and synthetic case groups |
| `docs/audit/2026-07-system-audit/golden-v2/comparator-contract.json` | Production comparator input/output schema version |
| `docs/audit/2026-07-system-audit/golden-v2/README.md` | Operator sequence and artifact locations |

### Existing files modified

| File | Change |
|---|---|
| `package.json` | Add `golden:v2` and focused verification scripts |
| `docs/knowledge/12-runbooks.md` | Add offline Golden V2 commands after implementation |

No file under `src/` is modified by Plan A.

## Milestone A0: Contracts and Isolation

### Task 1: Create the independent canonical artifact foundation

**Files:**

- Create: `tools/golden-pilot-v2/canonicalJson.ts`
- Create: `tools/golden-pilot-v2/artifactStore.ts`
- Create: `tests/golden-v2/canonicalJson.test.ts`

- [ ] **Step 1: Write the failing canonicalization and write-once tests**

Create `tests/golden-v2/canonicalJson.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalSha256
} from "../../tools/golden-pilot-v2/canonicalJson";
import {
  publishArtifactOnce,
  verifyPublishedArtifact
} from "../../tools/golden-pilot-v2/artifactStore";

describe("Golden V2 canonical artifacts", () => {
  it("sorts objects, preserves ordered arrays and hashes decimal strings", () => {
    const left = { z: ["b", "a"], a: { raw: "1000000", value: 1 } };
    const right = { a: { value: 1, raw: "1000000" }, z: ["b", "a"] };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalSha256(left)).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => canonicalJson({ value: undefined })).toThrow(
      "golden_undefined_value"
    );
  });

  it("publishes once and detects later byte changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "golden-v2-"));
    const first = await publishArtifactOnce(root, "case/a.json", { version: "v1", n: 1 });
    await expect(publishArtifactOnce(root, "case/a.json", { version: "v1", n: 2 }))
      .rejects.toThrow("golden_artifact_already_exists");
    expect(await verifyPublishedArtifact(root, first)).toEqual(first);
    expect(JSON.parse(await readFile(join(root, "case/a.json"), "utf8"))).toEqual({
      n: 1,
      version: "v1"
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- tests/golden-v2/canonicalJson.test.ts
```

Expected: FAIL because both package modules are absent.

- [ ] **Step 3: Implement independent canonical JSON and SHA-256**

Create `tools/golden-pilot-v2/canonicalJson.ts` with these exports and rules:

```ts
import { createHash } from "node:crypto";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function normalize(value: unknown, seen: Set<object>): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("golden_non_finite_number");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("golden_non_json_value");
  if (seen.has(value)) throw new TypeError("golden_cyclic_value");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
    const record = value as Record<string, unknown>;
    const result: Record<string, Json> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) throw new TypeError("golden_undefined_value");
      result[key] = normalize(record[key], seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()));
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
```

Create `tools/golden-pilot-v2/artifactStore.ts` with path validation,
same-directory temporary write, exclusive publication, directory `fsync` where
supported, and verification against `{ relativePath, sha256, byteLength }`.
Allow only normalized relative POSIX paths below the explicit root; reject
absolute paths, `..`, symlinks, and existing destinations.

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```powershell
npm test -- tests/golden-v2/canonicalJson.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tools/golden-pilot-v2/canonicalJson.ts tools/golden-pilot-v2/artifactStore.ts tests/golden-v2/canonicalJson.test.ts
git commit -m "feat(golden-v2): add independent artifact primitives"
```

### Task 2: Lock strict schemas and prove package isolation

**Files:**

- Create: `tools/golden-pilot-v2/contracts.ts`
- Create: `tests/golden-v2/contracts.test.ts`
- Create: `tests/golden-v2/isolation.test.ts`
- Create: `tests/fixtures/golden-v2/synthetic-cases.json`
- Create: `docs/audit/2026-07-system-audit/golden-v2/protocol.json`
- Create: `docs/audit/2026-07-system-audit/golden-v2/case-catalog.json`

- [ ] **Step 1: Write failing strict-schema and import-boundary tests**

The schema test must assert these exact groups:

```ts
expect(catalog.groups.map((group) => group.kind)).toEqual([
  "blind_review",
  "regression",
  "synthetic_property_performance"
]);
expect(catalog.groups.find((group) => group.kind === "regression")?.caseIds)
  .toEqual(["regression-tbl7", "regression-tqr"]);
expect(protocol.attributionCandidates).toEqual(["fifo", "lifo", "proportional"]);
expect(protocol.exactScoresAllowedBeforeAdjudication).toBe(false);
```

The isolation test recursively parses static/dynamic import specifiers beneath
`tools/golden-pilot-v2/` and fails for:

```ts
const forbidden = [
  /(^|\/)src\//u,
  /\bpg\b/u,
  /dotenv/u,
  /tronClient/u,
  /repositories/u,
  /scoringSignalMatrix/u,
  /forensicResultRenderer/u
];
```

It also fails if package code imports `node:http`, `node:https`, `node:net` or
contains a runtime access to `fetch(` or `DATABASE_URL`. Evidence-key names
used by the no-leak validator are allowed; Task 3 proves they cannot survive in
a neutral bundle.

- [ ] **Step 2: Run both tests and verify RED**

```powershell
npm test -- tests/golden-v2/contracts.test.ts tests/golden-v2/isolation.test.ts
```

Expected: FAIL because contracts and tracked control files are absent.

- [ ] **Step 3: Implement exact public contract types**

`tools/golden-pilot-v2/contracts.ts` must export strict parsers for:

```ts
export type GoldenCaseGroup =
  | "blind_review"
  | "regression"
  | "synthetic_property_performance";

export type AttributionPolicy = "fifo" | "lifo" | "proportional";
export type GoldenDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";

export type GoldenCaseDescriptor = {
  caseId: string;
  group: GoldenCaseGroup;
  subjectAddress: string;
  sourceArtifact: string;
  requiredProperties: string[];
};

export type GoldenProtocolV2 = {
  version: "golden-pilot-protocol-v2";
  reviewersRequired: 2;
  attributionCandidates: ["fifo", "lifo", "proportional"];
  exactScoresAllowedBeforeAdjudication: false;
  allowedDecisions: ["ACCEPTABLE", "REVIEW", "DECLINE"];
  canonicalFactKeyVersion: "canonical-fact-key-v1";
  comparatorContractVersion: "unified-wallet-comparator-v1";
};
```

Parsers must reject unknown keys, duplicate IDs, invalid TRON addresses,
non-decimal raw amounts, non-ISO UTC timestamps, non-lowercase transaction
hashes, unknown properties, and any `expectedScore`/`decision` in a neutral
case descriptor.

- [ ] **Step 4: Add protocol and case catalog**

The catalog contains:

- five blind cases with scopes `wallet`, `selected_amount`,
  `incoming_deposit`, `route`, and `history`;
- `regression-tbl7` for
  `TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy`;
- `regression-tqr` for
  `TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP`;
- synthetic properties covering empty wallet, new/no-USDT, one legitimate
  transfer, 100% unknown/no pattern, 1% direct blacklist, 99% Bybit plus hard
  evidence, dangerous approval/no debit, victim debit, operational wallet,
  dust/spam, dense fan-in/fan-out, 500 pages, duplicates, reorder, restart,
  key exhaustion, and ambiguous delivery.

The tracked catalog contains only identifiers, source artifact paths, subjects,
and required properties. It contains no expected decision, score, narrative,
or production result.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/golden-v2/contracts.test.ts tests/golden-v2/isolation.test.ts
git add tools/golden-pilot-v2/contracts.ts tests/golden-v2/contracts.test.ts tests/golden-v2/isolation.test.ts docs/audit/2026-07-system-audit/golden-v2
git commit -m "feat(golden-v2): lock schemas and isolation boundary"
```

Expected: PASS and a clean import-boundary scan.

## Milestone A1: Neutral Evidence and Attribution

### Task 3: Build neutral evidence export with provenance and no-leak proof

**Files:**

- Create: `tools/golden-pilot-v2/neutralExport.ts`
- Create: `tests/golden-v2/neutralExport.test.ts`
- Create: `tests/fixtures/golden-v2/builders.ts`

- [ ] **Step 1: Write failing neutralization tests**

The test must start from a source containing forbidden nested fields and prove
fail-closed behavior:

```ts
const source = validFrozenSource({
  caseId: "regression-tbl7",
  extra: { nested: { riskScore: 31 } }
});
expect(() => buildNeutralExport(source)).toThrow(
  "golden_forbidden_field:riskScore"
);
```

The valid path must assert:

```ts
expect(result.bundle.version).toBe("neutral-evidence-bundle-v2");
expect(result.manifest.sourceSnapshot.blockHash).toMatch(/^[0-9a-f]{64}$/u);
expect(result.receipt.forbiddenFieldMatches).toEqual([]);
expect(result.receipt.systemNarrativePresent).toBe(false);
expect(result.receipt.systemScorePresent).toBe(false);
expect(result.receipt.fieldInventorySha256).toMatch(/^[0-9a-f]{64}$/u);
expect(result.manifest.contentSha256).toBe(canonicalSha256(result.bundle));
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm test -- tests/golden-v2/neutralExport.test.ts
```

Expected: FAIL because `neutralExport.ts` is absent.

- [ ] **Step 3: Implement the allowlist projection**

The neutral bundle allowlist is:

```ts
export type NeutralEvidenceBundleV2 = {
  version: "neutral-evidence-bundle-v2";
  caseId: string;
  subjectAddress: string;
  snapshot: {
    chain: "tron";
    confirmedBlockNumber: string;
    confirmedBlockHash: string;
    timestamp: string;
    labelDatasetSha256: string;
  };
  events: Array<{
    txHash: string;
    eventIndex: string;
    tokenContract: string;
    from: string;
    to: string;
    amountRaw: string;
    timestamp: string;
    blockNumber: string;
    factType: string;
  }>;
  stateFacts: Array<{
    factType: string;
    subject: string;
    object: string | null;
    role: string;
    effectiveAt: string;
    evidenceRefs: string[];
  }>;
  labels: Array<{
    address: string;
    label: string;
    category: string;
    authority: string;
    validFrom: string | null;
    validTo: string | null;
    evidenceRefs: string[];
  }>;
  approvals: Array<{
    owner: string;
    spender: string;
    tokenContract: string;
    amountRaw: string;
    txHash: string;
    eventIndex: string;
    timestamp: string;
  }>;
};
```

Before projection, recursively reject normalized keys in this exact set:

```ts
const FORBIDDEN_NEUTRAL_KEYS = new Set([
  "score", "riskscore", "finalscore", "decision", "finaldecision",
  "risklevel", "riskband", "matrixrow", "narrative", "recommendation",
  "systemoutput", "telegramhtml", "scoreanchor"
]);
```

Also reject string values containing a production-policy marker
`scoring-signal-matrix-v`, `score-anchor-v`, `NO_FINAL_DECISION`, or a complete
Telegram result heading. Ordinary evidence text is not rejected merely because
it contains the English word “risk”.

Emit:

- canonical content hash;
- source snapshot;
- exporter version and runtime version;
- schema and label-dataset hashes;
- raw evidence inventory by kind/count/hash;
- sorted field inventory and its hash;
- validator receipt proving no forbidden field or production output.

- [ ] **Step 4: Add metamorphic neutral-export tests**

Add tests proving:

- object-key reorder does not change hashes;
- event reorder is canonicalized by
  `blockNumber + txHash + eventIndex + factType`;
- duplicate event identity fails rather than silently disappears;
- snapshot or label hash change changes the manifest hash;
- a source event after snapshot cutoff fails;
- a path outside the explicit artifact root fails.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/golden-v2/neutralExport.test.ts tests/golden-v2/canonicalJson.test.ts
git add tools/golden-pilot-v2/neutralExport.ts tests/golden-v2/neutralExport.test.ts tests/fixtures/golden-v2/builders.ts
git commit -m "feat(golden-v2): add neutral evidence export"
```

### Task 4: Compare FIFO, LIFO and proportional attribution

**Files:**

- Create: `tools/golden-pilot-v2/attribution.ts`
- Create: `tests/golden-v2/attribution.test.ts`
- Create: `tests/fixtures/golden-v2/dense500PageFixture.ts`

- [ ] **Step 1: Write failing conservation tests**

Use the same frozen inbound ledger for all policies:

```ts
const inbound = [
  { eventId: "old", amountRaw: "600000000", timestamp: "2026-01-01T00:00:00.000Z" },
  { eventId: "mid", amountRaw: "300000000", timestamp: "2026-01-02T00:00:00.000Z" },
  { eventId: "new", amountRaw: "100000000", timestamp: "2026-01-03T00:00:00.000Z" }
];
const selectedRaw = "500000000";
```

Assert:

- FIFO allocates `old=500000000`;
- LIFO allocates `new=100000000`, `mid=300000000`, `old=100000000`;
- proportional uses integer largest-remainder allocation and sums exactly to
  `500000000`;
- every allocation is non-negative and no source exceeds its amount;
- input reorder does not change any result.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/golden-v2/attribution.test.ts
```

Expected: FAIL because `attribution.ts` is absent.

- [ ] **Step 3: Implement all three pure policies**

Export:

```ts
export type AttributionInput = {
  selectedAmountRaw: string;
  inbound: Array<{
    eventId: string;
    amountRaw: string;
    timestamp: string;
  }>;
};

export type AttributionResult = {
  policy: "fifo" | "lifo" | "proportional";
  selectedAmountRaw: string;
  allocatedAmountRaw: string;
  residualAmountRaw: string;
  allocations: Array<{ eventId: string; allocatedRaw: string }>;
};

export function compareAttributionPolicies(input: AttributionInput): {
  fifo: AttributionResult;
  lifo: AttributionResult;
  proportional: AttributionResult;
};
```

Use only `BigInt`. Proportional allocation sorts remainders descending and
breaks ties by canonical `eventId`, so it is byte-stable.

- [ ] **Step 4: Add dense and property cases**

`dense500PageFixture.ts` exports a deterministic generator for
500 pages × 200 events without storing 100,000 rows in Git. Assert execution
completes, all three policies conserve the selected amount, duplicate event IDs
fail, and no input array is mutated. Do not add a wall-clock release gate here;
record duration as diagnostic only.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/golden-v2/attribution.test.ts
git add tools/golden-pilot-v2/attribution.ts tests/golden-v2/attribution.test.ts tests/fixtures/golden-v2/dense500PageFixture.ts
git commit -m "feat(golden-v2): compare attribution policies"
```

## Milestone A2: Blind Review and Adjudication

### Task 5: Create identical blind workspaces and immutable review locks

**Files:**

- Create: `tools/golden-pilot-v2/reviewWorkspace.ts`
- Create: `tests/golden-v2/reviewWorkspace.test.ts`

- [ ] **Step 1: Write failing two-review tests**

Prove:

```ts
expect(workspaceA.neutralBundleSha256).toBe(workspaceB.neutralBundleSha256);
expect(workspaceA).not.toHaveProperty("systemScore");
expect(workspaceA).not.toHaveProperty("expectedDecision");
expect(lockA.reviewerId).toBe("reviewer-a");
await expect(lockReview(workspaceAPath)).rejects.toThrow(
  "golden_review_already_locked"
);
```

The review schema requires:

- decision and reason;
- canonical evidence references;
- subject/counterparty roles;
- direct/indirect semantics;
- label temporal semantics;
- hard/context/neutral classification;
- dossier aggregates;
- expected score properties, but no exact score;
- results of all three attribution policies;
- reviewer identity and review timestamp.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/golden-v2/reviewWorkspace.test.ts
```

- [ ] **Step 3: Implement prepare and lock**

`prepareReviewWorkspace` writes:

```text
reviewer-a/
├── neutral-bundle.json
├── provenance-manifest.json
├── validator-receipt.json
├── review.json
└── instructions.md
```

`review.json` starts with `status: "draft"` and contains no exact score field.
`lockReview` validates all evidence references, changes the status to
`submitted`, writes an immutable review artifact, and returns its canonical
hash. It must not reveal the other review.

- [ ] **Step 4: Test tamper and unblind guards**

Add rejection for:

- changed neutral bundle after workspace creation;
- missing evidence reference;
- reviewer A and B using different neutral hashes;
- a submitted review containing an exact score;
- unblind before two distinct submitted review hashes exist.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/golden-v2/reviewWorkspace.test.ts
git add tools/golden-pilot-v2/reviewWorkspace.ts tests/golden-v2/reviewWorkspace.test.ts
git commit -m "feat(golden-v2): add blind review locks"
```

### Task 6: Adjudicate disagreements and select attribution without leakage

**Files:**

- Create: `tools/golden-pilot-v2/adjudication.ts`
- Create: `tests/golden-v2/adjudication.test.ts`

- [ ] **Step 1: Write failing adjudication-gate tests**

Required assertions:

```ts
expect(() => openAdjudication([reviewA])).toThrow(
  "golden_two_reviews_required"
);
expect(openAdjudication([reviewA, reviewB]).disagreements)
  .toContainEqual(expect.objectContaining({ field: "decision" }));
expect(() => finalizeAdjudication(draftWithoutResolvedFields)).toThrow(
  "golden_adjudication_unresolved"
);
expect(final.selectedAttributionPolicy)
  .toMatch(/^(fifo|lifo|proportional)$/u);
expect(final.exactScore).toBeGreaterThanOrEqual(0);
expect(final.exactScore).toBeLessThanOrEqual(100);
```

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/golden-v2/adjudication.test.ts
```

- [ ] **Step 3: Implement explicit disagreement records**

`openAdjudication` compares:

- decision;
- fact classification;
- roles;
- direct/indirect and temporal semantics;
- terminal boundaries;
- attribution result preference;
- dossier aggregates;
- score floors/monotonicity properties.

It emits one record per field with both immutable review hashes. It never
silently selects reviewer A or B.

- [ ] **Step 4: Implement finalization rules**

`finalizeAdjudication` requires:

```ts
export type FinalAdjudicationV2 = {
  version: "golden-adjudication-v2";
  caseId: string;
  neutralBundleSha256: string;
  reviewerHashes: [string, string];
  resolvedFacts: Array<{
    canonicalFactId: string;
    lane: "hard" | "pattern" | "context" | "neutral";
    role: string;
    directness: "direct" | "indirect" | "not_applicable";
    timing: "at_event" | "later" | "not_applicable";
  }>;
  selectedAttributionPolicy: "fifo" | "lifo" | "proportional";
  expectedDecision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  exactScore: number;
  scoreProperties: string[];
  dossierAggregates: Record<string, string>;
  telegramExpectation: {
    locale: "ru" | "en";
    exactHtml: string;
  }[];
  adjudicatorId: string;
  adjudicatedAt: string;
};
```

Exact score becomes legal only in this final artifact. One canonical fact may
belong to only one scoring lane.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/golden-v2/adjudication.test.ts
git add tools/golden-pilot-v2/adjudication.ts tests/golden-v2/adjudication.test.ts
git commit -m "feat(golden-v2): add explicit adjudication"
```

## Milestone A3: Locked Golden Pack

### Task 7: Lock the comparator contract and final hash graph

**Files:**

- Create: `tools/golden-pilot-v2/lockedManifest.ts`
- Create: `tests/golden-v2/lockedManifest.test.ts`
- Create: `docs/audit/2026-07-system-audit/golden-v2/comparator-contract.json`

- [ ] **Step 1: Write failing manifest and comparator tests**

The comparator contract is data-only:

```ts
export type ComparatorInputV1 = {
  version: "unified-wallet-comparator-input-v1";
  caseId: string;
  analysisManifestSha256: string;
  evidenceBundleSha256: string;
  reportSha256: string;
  scoringPolicyVersion: "scoring-signal-matrix-v4";
  score: number;
  decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  anchor: {
    version: "score-anchor-v3";
    policyVersion: "scoring-signal-matrix-v4";
    subjectAddress: string;
    mode: "unified";
    score: number;
    decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
    matrixRow: string;
    evidenceClass: string;
    proofLevel: string;
    authority: string;
    canonicalFactIds: string[];
    primaryFactIds: string[];
    preferredFactId: string;
    lockedGoldenManifestSha256: string;
  };
  dossierAggregates: Record<string, string>;
  presentations: Array<{
    locale: "ru" | "en";
    html: string;
    presentationSha256: string;
  }>;
};

export type ComparatorOutputV1 = {
  version: "unified-wallet-comparator-output-v1";
  caseId: string;
  passed: boolean;
  violations: Array<{
    property: string;
    expected: unknown;
    actual: unknown;
  }>;
};
```

Tests must prove that the Golden package validates this format but does not
import or call production.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/golden-v2/lockedManifest.test.ts
```

- [ ] **Step 3: Implement the locked manifest**

The final manifest contains:

```ts
export type LockedGoldenManifestV2 = {
  version: "locked-golden-manifest-v2";
  protocolSha256: string;
  caseCatalogSha256: string;
  comparatorContractSha256: string;
  cases: Array<{
    caseId: string;
    neutralBundleSha256: string;
    provenanceManifestSha256: string;
    validatorReceiptSha256: string;
    reviewerHashes: [string, string];
    adjudicationSha256: string;
  }>;
  selectedAttributionPolicy: "fifo" | "lifo" | "proportional";
  scoringPolicyVersion: "scoring-signal-matrix-v4";
  lockedAt: string;
  lockedBy: string;
};
```

`lockGoldenManifest` verifies every referenced file before exclusive
publication. A changed/missing artifact, duplicate case, mixed neutral hash,
pre-adjudication exact score, or inconsistent selected policy fails closed.

- [ ] **Step 4: Add deterministic replay tests**

Assert:

- input reorder does not change final manifest hash;
- duplicate evidence does not change adjudicated fact inventory after strict
  canonical dedup;
- changing coverage alone does not change expected score;
- changing locale changes presentation hash, not report/score;
- retry/restart over the same immutable inputs reproduces every hash.

- [ ] **Step 5: Run and commit**

```powershell
npm test -- tests/golden-v2/lockedManifest.test.ts tests/golden-v2/adjudication.test.ts
git add tools/golden-pilot-v2/lockedManifest.ts tests/golden-v2/lockedManifest.test.ts docs/audit/2026-07-system-audit/golden-v2/comparator-contract.json
git commit -m "feat(golden-v2): lock comparator and manifest contracts"
```

### Task 8: Add the strict offline CLI and execute the blind pilot

**Files:**

- Create: `tools/golden-pilot-v2/cli.ts`
- Create: `scripts/tronUsdtGoldenPilotV2.ts`
- Create: `tests/golden-v2/cli.acceptance.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing CLI acceptance test**

Test these commands in a temporary directory:

```text
neutralize
prepare-review
lock-review
compare-attribution
open-adjudication
finalize-adjudication
lock-golden
verify
```

Every command takes explicit `--input` and `--output` paths. No command reads
environment configuration. Unknown flags, repeated flags, a destination below
the source, an existing output, and a path escape fail.

- [ ] **Step 2: Run and verify RED**

```powershell
npm test -- tests/golden-v2/cli.acceptance.test.ts
```

- [ ] **Step 3: Implement dispatcher and entrypoint**

`scripts/tronUsdtGoldenPilotV2.ts` contains only:

```ts
import { runGoldenPilotCli } from "../tools/golden-pilot-v2/cli";

const exitCode = await runGoldenPilotCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr
});
process.exitCode = exitCode;
```

Add:

```json
{
  "golden:v2": "node --import tsx scripts/tronUsdtGoldenPilotV2.ts",
  "golden:v2:verify": "node --import tsx scripts/tronUsdtGoldenPilotV2.ts verify"
}
```

to `package.json`.

- [ ] **Step 4: Run synthetic end-to-end acceptance**

```powershell
npm test -- tests/golden-v2
npm run typecheck
```

Expected: all Golden V2 tests pass without database/network configuration.

- [ ] **Step 5: Execute the real frozen-bundle workflow**

Use one explicit artifact root:

```powershell
$goldenRoot = 'artifacts/golden-v2-2026-07'
npm run golden:v2 -- neutralize --input "$goldenRoot/source" --output "$goldenRoot/neutral"
npm run golden:v2 -- prepare-review --input "$goldenRoot/neutral" --output "$goldenRoot/reviewer-a" --reviewer reviewer-a
npm run golden:v2 -- prepare-review --input "$goldenRoot/neutral" --output "$goldenRoot/reviewer-b" --reviewer reviewer-b
```

The `source` directory must contain the five coordinator-frozen blind inputs,
TBL7/TQr frozen inputs, and synthetic case inputs named by
`case-catalog.json`. The command validates completeness and refuses a partial
case set.

Reviewer A and Reviewer B complete their workspaces independently. Then run:

```powershell
npm run golden:v2 -- lock-review --input "$goldenRoot/reviewer-a" --output "$goldenRoot/locked-reviewer-a"
npm run golden:v2 -- lock-review --input "$goldenRoot/reviewer-b" --output "$goldenRoot/locked-reviewer-b"
npm run golden:v2 -- open-adjudication --input "$goldenRoot" --output "$goldenRoot/adjudication-draft"
```

After the adjudicator resolves every emitted disagreement and records the exact
scores/Telegram expectations:

```powershell
npm run golden:v2 -- finalize-adjudication --input "$goldenRoot/adjudication-draft" --output "$goldenRoot/adjudicated"
npm run golden:v2 -- lock-golden --input "$goldenRoot" --output docs/audit/2026-07-system-audit/golden-v2/locked
npm run golden:v2 -- verify --input docs/audit/2026-07-system-audit/golden-v2/locked
```

Expected: `verify` prints the locked manifest SHA-256, selected attribution
policy, case count, and `golden-v2 verified`; it prints no production score.

- [ ] **Step 6: Commit code, not mutable reviewer workspaces**

Commit package code, tests, protocol, catalog, comparator contract, and the
sanitized final pack under
`docs/audit/2026-07-system-audit/golden-v2/locked/`. Keep source files and draft
reviewer/adjudication workspaces under `artifacts/golden-v2-2026-07/` untracked.
Never commit source files containing secrets.

```powershell
git add package.json tools/golden-pilot-v2 scripts/tronUsdtGoldenPilotV2.ts tests/golden-v2 tests/fixtures/golden-v2 docs/audit/2026-07-system-audit/golden-v2
git commit -m "feat(golden-v2): complete offline pilot workflow"
```

## Milestone A4: Documentation and Plan-A Gate

### Task 9: Document operation and freeze Plan A receipts

**Files:**

- Create: `docs/audit/2026-07-system-audit/golden-v2/README.md`
- Modify: `docs/knowledge/12-runbooks.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/10-open-problems.md`

- [ ] **Step 1: Document exact commands and boundaries**

The README and runbook must state:

- Golden package is offline and imports no production code;
- source/neutral/reviewer/adjudication/locked directories;
- two distinct reviewers are mandatory;
- exact scores are illegal before adjudication;
- TBL7/TQr use frozen bundles only;
- live checks are Plan B canaries, never Golden expected;
- comparator implementation belongs to Plan B;
- how to verify a lock hash without modifying artifacts.

- [ ] **Step 2: Update current knowledge truthfully**

In `09-current-decisions.md`, mark only completed Plan A contracts/artifacts as
implemented. Do not mark Unified Check as implemented.

In `10-open-problems.md`, close only the Golden items actually evidenced by the
locked manifest. Leave production comparator, Unified state machine, scoring
v4, delivery, rollout, and canary open.

- [ ] **Step 3: Run the Plan A gate once**

```powershell
npm test -- tests/golden-v2
npm run typecheck
npm run golden:v2 -- verify --input docs/audit/2026-07-system-audit/golden-v2/locked
```

Expected:

- Golden tests PASS;
- typecheck PASS;
- locked manifest verification PASS;
- no network/database variable is required.

- [ ] **Step 4: Record the gate receipt**

Write a canonical receipt below the locked root containing:

- candidate commit SHA;
- protocol/catalog/comparator/locked-manifest hashes;
- Node/npm versions;
- exact test commands and exit codes;
- selected attribution policy;
- timestamp.

The receipt is write-once and references the already locked artifacts; it does
not reopen them.

- [ ] **Step 5: Commit**

```powershell
git add docs/audit/2026-07-system-audit/golden-v2/README.md docs/knowledge/09-current-decisions.md docs/knowledge/10-open-problems.md docs/knowledge/12-runbooks.md
git commit -m "docs(golden-v2): publish pilot runbook and gate"
```

## Plan A Acceptance Checklist

- [ ] Package import scan proves no production, DB, provider, scoring, or renderer import.
- [ ] Neutral export has content hash, provenance, snapshot, label hash, inventory, field-inventory hash, and no-leak receipt.
- [ ] Reviewer A and B receive byte-identical neutral bundles.
- [ ] Both reviews are immutable before unblind.
- [ ] FIFO, LIFO and proportional conserve amounts and are compared blindly.
- [ ] Exact scores exist only in final adjudication artifacts.
- [ ] TBL7 and TQr use frozen evidence and are classified as regression cases.
- [ ] Dense/500-page/duplicate/reorder/restart cases are synthetic property/performance cases.
- [ ] Locked manifest binds every neutral bundle, review, adjudication and comparator contract.
- [ ] Production comparator is not present in this package.
- [ ] One Plan A gate receipt is bound to the exact candidate and locked hashes.

## Handoff to Plan B

Plan B may consume only:

- `locked-golden-manifest-v2`;
- `unified-wallet-comparator-v1`;
- selected attribution policy;
- scoring policy v4 adjudication records;
- exact decisions/scores/properties/dossier aggregates;
- locale-specific Telegram expectations.

If any consumed Golden hash changes, only dependent Plan B comparator/scoring/
presentation gates are invalidated. Plan A is not rerun without a changed
source, protocol, artifact, or diagnostic hypothesis.

## Design Coverage Map

| Design contract | Implemented by |
|---|---|
| Offline/no-production-import boundary | Tasks 1–2 |
| Neutral export, provenance, inventory and no-leak proof | Task 3 |
| FIFO/LIFO/proportional comparison before selection | Task 4 |
| Two blind immutable reviews | Task 5 |
| Unblind, disagreement resolution and post-review exact scores | Task 6 |
| Locked hash chain and comparator format | Task 7 |
| Real blind/regression/synthetic case workflow | Task 8 |
| Golden gate receipts and operational documentation | Task 9 |
| TBL7/TQr frozen-only and live-canary separation | Tasks 2, 8 and Plan B Task 20 |
| Duplicate/reorder/coverage/restart/locale properties | Tasks 3, 4 and 7 |
