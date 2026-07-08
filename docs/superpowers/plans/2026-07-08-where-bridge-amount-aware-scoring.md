# Where Bridge Amount-Aware Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep non-hard bridge/router/DEX and cross-chain boundary exposure visible as source-policy context while preventing small selected amounts from becoming high policy declines.

**Architecture:** Add one amount-aware cap helper in `src/forensics/provenanceScoring.ts` and reuse it from Where operational source-bundle extras. The helper applies only to `bridge_router_dex` and `cross_chain_boundary`; hard evidence, sanctions, mixers, no-name liquidity, exact approval-drain, and exact bad provenance keep existing floors. Tests cover both the direct `scoreSourceExposures` path and the Where operational assessment path that can otherwise reintroduce a bridge source-bundle decline.

**Tech Stack:** TypeScript, Vitest, existing Where/Unified scoring types.

---

## File Map

- Modify `src/forensics/provenanceScoring.ts`: amount-band helper, diagnostic formatting, `scoreSourceExposures` cap application and reason text.
- Modify `src/forensics/moneyOriginOperationalAssessment.ts`: apply the same amount-aware cap to selected source-bundle bridge/router/DEX extras.
- Modify `src/types.ts`: optional diagnostics on `SourcePolicyShareDetail`.
- Modify `tests/forensics/provenanceScoring.test.ts`: unit coverage for bridge/router/DEX amount caps and hard-evidence exclusions.
- Modify `tests/forensics/moneyOriginOperationalAssessment.test.ts`: TNQdf-like Where assessment remains REVIEW/context, not DECLINE.
- Modify `docs/knowledge/07-risk-scoring-matrix.md`: current scoring policy.
- Modify `docs/knowledge/09-current-decisions.md`: current decision note for amount-aware bridge/router/DEX cap.

---

### Task 1: ScoreSourceExposures Amount Cap

**Files:**
- Modify: `src/forensics/provenanceScoring.ts`
- Modify: `src/types.ts`
- Test: `tests/forensics/provenanceScoring.test.ts`

- [ ] **Step 1: Add failing tests for small and medium non-hard bridge/router/DEX**

Add tests near the existing bridge scoring tests in `tests/forensics/provenanceScoring.test.ts`:

```typescript
  it("keeps small full-share bridge/router/DEX selected amount below decline", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 1,
          amountPreservationRatio: 1,
          linkStrength: 1.25,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge",
          sourceExposureKind: "bridge_router_dex",
          amountUsage: {
            anchorAmountRaw: "2094300000",
            originalAmountRaw: "2094300000",
            usedAmountRaw: "2094300000",
            coverageShare: 1,
            role: "funding_candidate"
          }
        })
      ],
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 1,
      provenanceConfidence: 1,
      ageSignals: { ...noAgeSignals, subjectAgeDays: 1 },
      scope: "where_selected_amount",
      targetAmountRaw: "2094300000"
    });

    const bridge = result.sourcePolicyEvidence.find((item) => item.kind === "bridge_router_dex");
    expect(bridge?.score).toBeLessThan(60);
    expect(bridge?.score).toBeGreaterThanOrEqual(55);
    expect(bridge?.proofLevel).toBe("exchange_policy_context");
    expect(bridge?.reasons.join(" ")).toContain("source-policy review context");
    expect(bridge?.reasons.join(" ")).toContain("not scam/drain proof");
    expect(bridge?.shareDetail).toMatchObject({
      affectedAmountRaw: "2094300000",
      amountCap: 58,
      amountBand: "under_5k",
      amountCapApplied: true
    });
  });

  it("keeps 5k to 25k full-share bridge/router/DEX selected amount below decline", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 1,
          amountPreservationRatio: 1,
          linkStrength: 1.25,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge",
          sourceExposureKind: "bridge_router_dex",
          amountUsage: {
            anchorAmountRaw: "12000000000",
            originalAmountRaw: "12000000000",
            usedAmountRaw: "12000000000",
            coverageShare: 1,
            role: "funding_candidate"
          }
        })
      ],
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 1,
      provenanceConfidence: 1,
      ageSignals: { ...noAgeSignals, subjectAgeDays: 1 },
      scope: "where_selected_amount",
      targetAmountRaw: "12000000000"
    });

    const bridge = result.sourcePolicyEvidence.find((item) => item.kind === "bridge_router_dex");
    expect(bridge?.score).toBeLessThan(60);
    expect(bridge?.score).toBe(59);
    expect(bridge?.proofLevel).toBe("exchange_policy_context");
    expect(bridge?.shareDetail).toMatchObject({
      affectedAmountRaw: "12000000000",
      amountCap: 59,
      amountBand: "5k_to_25k",
      amountCapApplied: true
    });
  });
```

- [ ] **Step 2: Add failing tests for 25k-100k taper, cross-chain, and hard exclusions**

Add these tests in the same file:

```typescript
  it("tapers the 25k to 100k bridge/router/DEX cap instead of jumping to 68", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 1,
          amountPreservationRatio: 1,
          linkStrength: 1.25,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge",
          sourceExposureKind: "bridge_router_dex",
          amountUsage: {
            anchorAmountRaw: "26000000000",
            originalAmountRaw: "26000000000",
            usedAmountRaw: "26000000000",
            coverageShare: 1,
            role: "funding_candidate"
          }
        })
      ],
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 1,
      provenanceConfidence: 1,
      ageSignals: { ...noAgeSignals, subjectAgeDays: 1 },
      scope: "where_selected_amount",
      targetAmountRaw: "26000000000"
    });

    const bridge = result.sourcePolicyEvidence.find((item) => item.kind === "bridge_router_dex");
    expect(bridge?.score).toBeLessThan(68);
    expect(bridge?.score).toBeGreaterThanOrEqual(60);
    expect(bridge?.shareDetail).toMatchObject({
      amountBand: "25k_to_100k",
      amountCapApplied: true
    });
  });

  it("lets material aggregate bridge/router/DEX exposure reach 70 plus", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 1,
          amountPreservationRatio: 1,
          linkStrength: 1.25,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge",
          sourceExposureKind: "bridge_router_dex",
          amountUsage: {
            anchorAmountRaw: "120000000000",
            originalAmountRaw: "120000000000",
            usedAmountRaw: "120000000000",
            coverageShare: 1,
            role: "funding_candidate"
          }
        })
      ],
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 1,
      provenanceConfidence: 1,
      ageSignals: { ...noAgeSignals, subjectAgeDays: 1 },
      scope: "where_selected_amount",
      targetAmountRaw: "120000000000"
    });

    expect(result.sourcePolicyEvidence.find((item) => item.kind === "bridge_router_dex")?.score)
      .toBeGreaterThanOrEqual(70);
  });

  it("applies the same small-amount cap to cross-chain boundary context", () => {
    const result = scoreSourceExposures({
      originPaths: [
        path({
          balanceShare: 1,
          amountPreservationRatio: 1,
          linkStrength: 1.25,
          exposureSourceKey: "cross_chain_boundary",
          exposureSourceLabel: "Bridge boundary",
          sourceExposureKind: "cross_chain_boundary",
          amountUsage: {
            anchorAmountRaw: "3000000000",
            originalAmountRaw: "3000000000",
            usedAmountRaw: "3000000000",
            coverageShare: 1,
            role: "funding_candidate"
          }
        })
      ],
      walletRole: "risky_source_wallet",
      operationalLiquidityScore: 0,
      cleanCexCoverage: 0,
      coverageCompleteness: 1,
      provenanceConfidence: 1,
      ageSignals: { ...noAgeSignals, subjectAgeDays: 1 },
      scope: "where_selected_amount",
      targetAmountRaw: "3000000000"
    });

    const crossChain = result.sourcePolicyEvidence.find((item) => item.kind === "cross_chain_boundary");
    expect(crossChain?.score).toBeLessThan(60);
    expect(crossChain?.proofLevel).toBe("exchange_policy_context");
  });

  it("does not dampen mixer or sanctioned source-policy floors with the bridge amount cap", () => {
    for (const kind of ["mixer", "sanctioned_service"] as const) {
      const result = scoreSourceExposures({
        originPaths: [
          path({
            balanceShare: 1,
            amountPreservationRatio: 1,
            linkStrength: 1.25,
            exposureSourceKey: kind,
            exposureSourceLabel: kind,
            sourceExposureKind: kind,
            amountUsage: {
              anchorAmountRaw: "2094300000",
              originalAmountRaw: "2094300000",
              usedAmountRaw: "2094300000",
              coverageShare: 1,
              role: "funding_candidate"
            }
          })
        ],
        walletRole: "risky_source_wallet",
        operationalLiquidityScore: 0,
        cleanCexCoverage: 0,
        coverageCompleteness: 1,
        provenanceConfidence: 1,
        ageSignals: { ...noAgeSignals, subjectAgeDays: 1 },
        scope: "where_selected_amount",
        targetAmountRaw: "2094300000"
      });

      expect(result.sourcePolicyEvidence.find((item) => item.kind === kind)?.score)
        .toBeGreaterThanOrEqual(kind === "mixer" ? 78 : 95);
    }
  });
```

- [ ] **Step 3: Run the failing provenance tests**

Run:

```powershell
npm test -- tests/forensics/provenanceScoring.test.ts
```

Expected before implementation: the new small/medium/taper tests fail because bridge/router/DEX still scores at the old share-based cap/floor.

- [ ] **Step 4: Add amount-cap diagnostics to shared types**

Extend `SourcePolicyShareDetail` in `src/types.ts`:

```typescript
  amountCap?: number;
  amountBand?: "under_5k" | "5k_to_25k" | "25k_to_100k";
  amountCapApplied?: boolean;
```

- [ ] **Step 5: Implement the amount-aware helper and apply it in `scoreSourceExposures`**

In `src/forensics/provenanceScoring.ts`, add constants and helper functions near `shareBandCap`:

```typescript
const BRIDGE_AMOUNT_CAP_UNDER_5K_RAW = 5_000_000_000n;
const BRIDGE_AMOUNT_CAP_25K_RAW = 25_000_000_000n;
const BRIDGE_AMOUNT_CAP_100K_RAW = 100_000_000_000n;

export type SourcePolicyAmountCap = {
  cap: number;
  band: "under_5k" | "5k_to_25k" | "25k_to_100k";
  amountText: string;
};

function isAmountAwareBridgeKind(kind: SourceExposureKind): boolean {
  return kind === "bridge_router_dex" || kind === "cross_chain_boundary";
}

export function sourcePolicyAmountCap(kind: SourceExposureKind, affectedAmountRaw: string | null | undefined): SourcePolicyAmountCap | null {
  if (!isAmountAwareBridgeKind(kind) || !affectedAmountRaw) return null;
  const amount = parseAmountRaw(affectedAmountRaw);
  if (amount === null || amount <= 0n) return null;
  if (amount < BRIDGE_AMOUNT_CAP_UNDER_5K_RAW) return { cap: 58, band: "under_5k", amountText: formatUsdtRaw(affectedAmountRaw) };
  if (amount < BRIDGE_AMOUNT_CAP_25K_RAW) return { cap: 59, band: "5k_to_25k", amountText: formatUsdtRaw(affectedAmountRaw) };
  if (amount < BRIDGE_AMOUNT_CAP_100K_RAW) {
    const numerator = Number(amount - BRIDGE_AMOUNT_CAP_25K_RAW);
    const denominator = Number(BRIDGE_AMOUNT_CAP_100K_RAW - BRIDGE_AMOUNT_CAP_25K_RAW);
    const cap = Math.max(60, Math.min(68, 60 + Math.round((numerator / denominator) * 8)));
    return { cap, band: "25k_to_100k", amountText: formatUsdtRaw(affectedAmountRaw) };
  }
  return null;
}
```

Also add `formatUsdtRaw` near `parseAmountRaw`:

```typescript
function formatUsdtRaw(amountRaw: string): string {
  const amount = parseAmountRaw(amountRaw);
  if (amount === null) return `${amountRaw} raw USDT`;
  const whole = Number(amount / 1_000_000n);
  const fractional = Number((amount % 1_000_000n) / 10_000n);
  const value = whole + fractional / 100;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, "")}M USDT`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2).replace(/\.00$/, "")}K USDT`;
  return `${value.toFixed(value >= 100 ? 0 : 2).replace(/\.00$/, "")} USDT`;
}
```

In `scoreSourceExposures`, compute the affected amount before cap/floor:

```typescript
    const affectedAmountRaw = exactAffectedAmountRaw(deduped.map((item) => item.path), input.targetAmountRaw);
    const amountCap = sourcePolicyAmountCap(kind, affectedAmountRaw);
    const baseShareFloor = shareFloorForKind(kind, attributableShare, bestContinuity);
    const shareCap = amountCap ? Math.min(shareBandCap(kind, attributableShare), amountCap.cap) : shareBandCap(kind, attributableShare);
    const shareFloor = amountCap && amountCap.cap < 60 ? 0 : Math.min(baseShareFloor, shareCap);
    const adjustedScore = clamp(Math.max(shareFloor, Math.min(shareCap, rawScore)));
```

Update reason text:

```typescript
    const bridgeAmountReason = amountCap
      ? ` ${amountCap.amountText} came through bridge/router/DEX; this is source-policy review context, not scam/drain proof; amount-aware cap kept it below hard-evidence decline behavior.`
      : "";
    const reasons = [
      `${kind} exposure is ${Math.round(aggregateShare * 100)}% raw / ${Math.round(effectiveShare * 100)}% effective; this is source-policy risk, not scam/drain proof.${bridgeAmountReason}`
    ];
```

Pass diagnostics into `sourcePolicyShareDetail`:

```typescript
      amountCap: amountCap?.cap,
      amountBand: amountCap?.band,
      amountCapApplied: Boolean(amountCap && shareCap < shareBandCap(kind, attributableShare))
```

And return those optional fields only when `amountCapApplied` is true.

- [ ] **Step 6: Run provenance tests**

Run:

```powershell
npm test -- tests/forensics/provenanceScoring.test.ts
```

Expected: PASS.

---

### Task 2: Where Operational Assessment Source-Bundle Cap

**Files:**
- Modify: `src/forensics/moneyOriginOperationalAssessment.ts`
- Test: `tests/forensics/moneyOriginOperationalAssessment.test.ts`

- [ ] **Step 1: Add failing TNQdf-like assessment test**

Replace the existing “floors selected bridge/router/dex source bundle share at 60 and declines” expectation with amount-aware behavior and add a TNQdf-like path:

```typescript
  it("keeps small selected bridge/router/dex source bundle exposure as review context", () => {
    const assessment = buildMoneyOriginOperationalAssessment(assessmentInput({
      originPaths: [
        reviewPath({
          balanceTransferTxHash: "tx-subject-inbound",
          rootSourceAddress: "TBridge111111111111111111111111111111",
          rootSourceType: "decline_boundary",
          balanceShare: 1,
          exposureSourceKey: "bridge_router_dex",
          exposureSourceLabel: "Bridge",
          sourceExposureKind: "bridge_router_dex",
          pathAddresses: ["TBridge111111111111111111111111111111", sender, subject],
          txHashes: ["tx-bridge-hop", "tx-subject-inbound"],
          steps: [
            {
              txHash: "tx-bridge-hop",
              fromAddress: "TBridge111111111111111111111111111111",
              toAddress: sender,
              amountRaw: "2094300000",
              timestamp: "2026-07-08T04:50:15.000Z"
            },
            {
              txHash: "tx-subject-inbound",
              fromAddress: sender,
              toAddress: subject,
              amountRaw: "2094300000",
              timestamp: "2026-07-08T04:51:21.000Z"
            }
          ],
          amountUsage: {
            anchorAmountRaw: "2094300000",
            originalAmountRaw: "2094300000",
            usedAmountRaw: "2094300000",
            coverageShare: 1,
            role: "funding_candidate"
          },
          amountPreservationRatio: 1,
          timeSpanMs: 66 * 1000,
          stoppedReason: "service_boundary",
          verdict: "DECLINE",
          riskScoreContribution: 65,
          reasons: ["Bridge source-policy exposure."]
        })
      ],
      senderInteractionProfiles: [],
      coverage: coverage({
        targetAmountRaw: "2094300000",
        selectedAmountRaw: "2094300000",
        selectedInboundVolumeRaw: "2094300000",
        currentBalanceRaw: "2094300000"
      }),
      sourceBundleExposure: sourceBundleExposureProfile({
        targetAmountRaw: "2094300000",
        coveredAmountRaw: "2094300000",
        bridgeRouterDexShare: 1,
        cleanCexShare: 0,
        dominantSource: "bridge_router_dex"
      })
    }));

    const text = [
      ...assessment.reasons,
      ...assessment.sourcePolicyEvidence.flatMap((item) => item.reasons),
      ...assessment.riskLayers.flatMap((layer) => layer.reasons)
    ].join(" ");

    expect(assessment.riskScore).toBeGreaterThanOrEqual(55);
    expect(assessment.riskScore).toBeLessThan(60);
    expect(assessment.decision).toBe("REVIEW");
    expect(assessment.sourcePolicyEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "bridge_router_dex",
        score: 58,
        proofLevel: "exchange_policy_context",
        canBeDampened: true
      })
    ]));
    expect(text).toContain("2.09K USDT");
    expect(text).toContain("source-policy review context");
    expect(text).toContain("not scam/drain proof");
  });
```

- [ ] **Step 2: Run the failing assessment test**

Run:

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected before implementation: the source-bundle bridge extra still scores `60` and the assessment declines.

- [ ] **Step 3: Apply amount cap to source-bundle bridge/router/DEX extras**

In `src/forensics/moneyOriginOperationalAssessment.ts`, import the helper:

```typescript
  sourcePolicyAmountCap,
```

Add a small raw multiplication helper near `ratio`:

```typescript
function multiplyAmountByShare(amountRaw: string | null | undefined, share: number): string | null {
  const amount = parseAmount(amountRaw);
  if (amount <= 0n || !Number.isFinite(share) || share <= 0) return null;
  const scale = 1_000_000n;
  const scaledShare = BigInt(Math.round(Math.min(1, share) * Number(scale)));
  return ((amount * scaledShare + scale / 2n) / scale).toString();
}
```

Inside `sourceBundlePolicyExtra`, compute an adjusted score/proof before building evidence:

```typescript
  const affectedAmountRaw = multiplyAmountByShare(input.profile.coveredAmountRaw || input.profile.targetAmountRaw, input.share);
  const amountCap = sourcePolicyAmountCap(input.kind, affectedAmountRaw);
  const score = amountCap ? Math.min(input.score, amountCap.cap) : input.score;
  const proofLevel: ProofLevel = score >= 60 ? input.proofLevel : "exchange_policy_context";
  const canBeDampened = score < 60 ? true : input.canBeDampened;
```

Use `score`, `proofLevel`, and `canBeDampened` for both `evidence` and `layer`. Append amount-cap language to the selected bundle reason only when `amountCap` exists:

```typescript
  const reasons = [
    `Selected amount source bundle has ${sharePercent}% ${input.kind} exposure.` +
      (amountCap ? ` ${amountCap.amountText} came through bridge/router/DEX; this is source-policy review context, not scam/drain proof; amount-aware cap kept it below decline threshold.` : "")
  ];
```

- [ ] **Step 4: Run assessment tests**

Run:

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

Expected: PASS.

---

### Task 3: Knowledge Docs

**Files:**
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/09-current-decisions.md`

- [ ] **Step 1: Document bridge/router/DEX amount cap in risk matrix**

Add a concise bullet under the Where/source-policy scoring section:

```markdown
- Non-hard `bridge_router_dex` / `cross_chain_boundary` exposure is amount-aware. If no hard evidence, sanctions, mixer, or exact approval-drain provenance exists, affected selected amount `<5k USDT` caps at 58, `5k-25k USDT` caps at 59, and `25k-100k USDT` tapers up to 68. This is source-policy review context, not direct scam/drain proof. `>100k USDT` or repeated material aggregate exposure can reach 70+.
```

- [ ] **Step 2: Add current decision note**

Add a dated note to `docs/knowledge/09-current-decisions.md`:

```markdown
### 2026-07-08 - Amount-aware cap for non-hard bridge/router/DEX source-policy exposure

Small ordinary Where traces that end at a bridge/router/DEX or cross-chain boundary remain visible, but they no longer become high policy declines only because they cover 100% of a small selected amount. For non-hard `bridge_router_dex` / `cross_chain_boundary`, affected selected amount `<5k USDT` caps at 58, `5k-25k USDT` caps at 59, and `25k-100k USDT` tapers up to 68. Sanctions, mixers, no-name liquidity, exact approval-drain, and exact bad provenance keep existing hard floors.
```

- [ ] **Step 3: Review docs for implemented-language accuracy**

Run:

```powershell
rg -n "amount-aware|bridge_router_dex|cross_chain_boundary|hard floors" docs/knowledge/07-risk-scoring-matrix.md docs/knowledge/09-current-decisions.md
```

Expected: the docs say this is current implemented scoring behavior after Tasks 1 and 2 are complete.

---

### Task 4: Final Verification

**Files:**
- Verify: code/tests/docs touched in Tasks 1-3.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm test -- tests/forensics/provenanceScoring.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts tests/risk/unifiedWalletRisk.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run diff whitespace check**

Run:

```powershell
git diff --check
```

Expected: no conflict markers or whitespace errors.

- [ ] **Step 4: Review branch diff**

Run:

```powershell
git diff --stat HEAD
git diff -- src/forensics/provenanceScoring.ts src/forensics/moneyOriginOperationalAssessment.ts src/types.ts tests/forensics/provenanceScoring.test.ts tests/forensics/moneyOriginOperationalAssessment.test.ts docs/knowledge/07-risk-scoring-matrix.md docs/knowledge/09-current-decisions.md
```

Expected: only amount-aware bridge/router/DEX scoring, tests, and docs changed.
