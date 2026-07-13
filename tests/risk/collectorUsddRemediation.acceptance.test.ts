import { describe, expect, it } from "vitest";
import { SUBJECT, psmObservation } from "../fixtures/forensics/remediationScoringCases";

const matrixContext = {
  decisionScope: "wallet_unified",
  subjectAddress: SUBJECT,
  subjectTxHash: null,
  requiredCoverage: "wallet_provenance"
} as const;

const matrixCandidate = (overrides: Record<string, unknown> = {}) => ({
  row: "counterparty_context",
  actionUnit: "wallet",
  score: 30,
  evidenceIds: ["evidence:independent"],
  evidenceEpisodeIds: ["episode:B"],
  atomicSignals: ["deep_counterparty_risk_context"],
  modifiers: [],
  caps: [],
  dampeners: [],
  caveats: [],
  subject: {
    decisionScope: matrixContext.decisionScope,
    address: matrixContext.subjectAddress,
    txHash: matrixContext.subjectTxHash
  },
  authority: { kind: "context" },
  ...overrides
}) as any;

const collectorCandidate = (overrides: Record<string, unknown> = {}) => matrixCandidate({
  row: "behavior_only_prior",
  score: 35,
  evidenceIds: ["evidence:collector"],
  evidenceEpisodeIds: ["episode:A"],
  atomicSignals: ["collector_transit_behavior"],
  caps: ["collector_only_cap_35"],
  ...overrides
});

const expectCollectorOnly = (result: any) => {
  expect(result).toMatchObject({
    policyScore: 35,
    matrixDecision: "REVIEW",
    winningRow: "behavior_only_prior",
    winningCandidate: {
      score: 35,
      authority: { kind: "context" },
      decisionEligibility: "review_only"
    }
  });
  expect(result.winningCandidate.atomicSignals).not.toContain("collector_plus_independent_signal");
  expect(result.winningCandidate.authority).not.toMatchObject({ decisionEligibility: "can_decline" });
};

const cleanWhereReport = () => ({
  subjectAddress: SUBJECT,
  currentUsdtBalanceRaw: "0",
  fastWalletRisk: null,
  balanceFormingTransfers: [],
  originPaths: [],
  senderInteractionProfiles: [],
  approvalDrainProvenanceProfiles: [],
  assessment: {
    decision: "ACCEPTABLE",
    riskScore: 0,
    riskBand: "LOW",
    provenanceConfidence: 100,
    coverageCompleteness: 100,
    walletRole: "unknown_wallet",
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    sourcePolicyEvidence: [],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: [],
    warnings: []
  },
  decision: "ACCEPTABLE",
  userDecision: "ACCEPTABLE",
  internalDecision: "ACCEPTABLE",
  proofLevel: "clean_source_proven",
  riskScore: 0,
  decisionReasons: [],
  coverage: {
    selectedInboundTxCount: 0,
    selectedInboundVolumeRaw: "0",
    currentBalanceCoverageRatio: 1,
    coverageRatio: 1,
    checkedScope: "current_balance",
    maxDepth: 20,
    fetchedAddressCount: 10,
    partial: false,
    notes: []
  }
}) as any;

const collectorDeepReport = () => ({
  subjectAddress: SUBJECT,
  operationalFlowProfiles: [{
    subjectAddress: SUBJECT,
    windowStart: "2026-06-13T00:00:00.000Z",
    windowEnd: "2026-07-13T00:00:00.000Z",
    incomingVolumeRaw: "7541408440000",
    outgoingVolumeRaw: "7541406950000",
    incomingTxCount: 12,
    outgoingTxCount: 27,
    inflowToOutflowRatio: 0.999,
    topIncomingCounterparties: [],
    topOutgoingCounterparties: [],
    categoryBreakdown: [],
    terminalLiquidityIncomingRatio: 0,
    terminalLiquidityOutgoingRatio: 0,
    htxHuobiIncomingRatio: 0,
    htxHuobiOutgoingRatio: 0,
    bridgeDexRouterOutgoingRatio: 0.25,
    unknownContractOutgoingRatio: 0,
    historicalTransitScore: 81,
    historicalTransitBreakdown: {
      eligible: true,
      flowUsdt: 7541408,
      volumeScore: 20,
      passThrough: 0.999,
      passThroughScore: 20,
      serviceShare: 0.25,
      serviceShareScore: 6,
      score: 81
    },
    operationalScore: 65,
    features: []
  }],
  serviceExposureProfiles: [],
  addressBehaviorProfiles: [],
  inboundProvenanceProfiles: [],
  counterpartyRiskProfiles: [],
  approvalDrainProvenanceProfiles: [],
  boundaryExposureProfiles: [],
  walletRoleProfiles: [],
  extendedProvenanceProfiles: [],
  directCounterpartyInteractionProfiles: [],
  assetContinuationProfiles: [],
  stablecoinRestrictionProfiles: [],
  coverage: { transferEdges: 100 }
}) as any;

describe("collector remediation acceptance contract", () => {
  it("[AC-01] caps collector-only evidence at REVIEW 35", async () => {
    const [{ scoreMatrixCandidates }, { buildWalletMatrixCandidates }] = await Promise.all([
      import("../../src/risk/scoringSignalMatrix"),
      import("../../src/risk/scoringSignalMatrixInputs")
    ]);
    const candidates = buildWalletMatrixCandidates({
      address: SUBJECT,
      fastReport: null,
      deepReport: collectorDeepReport(),
      whereReport: cleanWhereReport()
    });
    const collector = candidates.find((candidate) =>
      candidate.atomicSignals.includes("collector_transit_behavior") ||
      candidate.atomicSignals.includes("historical_transit_pattern")
    );

    expect(collector).toBeDefined();
    expectCollectorOnly(scoreMatrixCandidates(candidates, matrixContext));
    expect(collector).toMatchObject({
      row: "behavior_only_prior",
      score: 35,
      atomicSignals: ["collector_transit_behavior"],
      caps: expect.arrayContaining(["collector_only_cap_35"]),
      authority: { kind: "context" }
    });
  });

  it("[AC-02] allows collector 55 only with an independent eligible AML signal", async () => {
    const { scoreMatrixCandidates } = await import("../../src/risk/scoringSignalMatrix");
    const result = scoreMatrixCandidates([
      collectorCandidate(),
      matrixCandidate()
    ], matrixContext);

    expect(result).toMatchObject({
      policyScore: 55,
      matrixDecision: "REVIEW",
      winningCandidate: {
        row: "behavior_only_prior",
        score: 55,
        atomicSignals: ["collector_plus_independent_signal"],
        authority: {
          kind: "pattern",
          decisionEligibility: "review_only",
          coverageDependency: "wallet_provenance"
        },
        decisionEligibility: "review_only"
      }
    });
    expect(new Set(result.winningCandidate.evidenceIds)).toEqual(new Set([
      "evidence:collector",
      "evidence:independent"
    ]));
    expect(new Set(result.winningCandidate.evidenceEpisodeIds)).toEqual(new Set([
      "episode:A",
      "episode:B"
    ]));
  });

  it("[AC-02] does not treat the same evidence episode as an independent signal", async () => {
    const { scoreMatrixCandidates } = await import("../../src/risk/scoringSignalMatrix");
    expectCollectorOnly(scoreMatrixCandidates([
      collectorCandidate(),
      matrixCandidate({ evidenceEpisodeIds: ["episode:A"] })
    ], matrixContext));
  });

  it("[REQ-16][COLLECTOR] rejects partially overlapping episode sets", async () => {
    const { scoreMatrixCandidates } = await import("../../src/risk/scoringSignalMatrix");
    expectCollectorOnly(scoreMatrixCandidates([
      collectorCandidate({ evidenceEpisodeIds: ["episode:A", "episode:B"] }),
      matrixCandidate({ evidenceEpisodeIds: ["episode:B", "episode:C"] })
    ], matrixContext));
  });

  it("[REQ-16][COLLECTOR] rejects empty episode identifiers", async () => {
    const { scoreMatrixCandidates } = await import("../../src/risk/scoringSignalMatrix");
    const cases = [
      [[], ["episode:B"]],
      [[""], ["episode:B"]],
      [[" "], ["episode:B"]],
      [["episode:A"], []],
      [["episode:A"], [""]],
      [["episode:A"], [" "]],
      [undefined, ["episode:B"]],
      [["episode:A"], undefined]
    ] as Array<[string[] | undefined, string[] | undefined]>;

    for (const [collectorEpisodes, independentEpisodes] of cases) {
      expectCollectorOnly(scoreMatrixCandidates([
        collectorCandidate({ evidenceEpisodeIds: collectorEpisodes as any }),
        matrixCandidate({ evidenceEpisodeIds: independentEpisodes as any })
      ], matrixContext));
    }
  });

  it("[REQ-16][COLLECTOR] excludes coverage and clean evidence from composition", async () => {
    const { scoreMatrixCandidates } = await import("../../src/risk/scoringSignalMatrix");
    const ineligibleSignals = [
      matrixCandidate({
        row: "coverage_uncertainty",
        score: 0,
        evidenceIds: ["coverage:partial"],
        evidenceEpisodeIds: ["episode:coverage"],
        atomicSignals: ["required_coverage_incomplete"],
        authority: { kind: "coverage", coverageDependency: "wallet_provenance" }
      }),
      matrixCandidate({
        row: "coverage_uncertainty",
        score: 90,
        evidenceIds: ["limitation:provider"],
        evidenceEpisodeIds: ["episode:limitation"],
        atomicSignals: ["provider_limitation"],
        authority: { kind: "limitation", coverageDependency: "wallet_provenance" }
      }),
      matrixCandidate({
        row: "clean_or_operational",
        score: 29,
        evidenceIds: ["evidence:clean"],
        evidenceEpisodeIds: ["episode:clean"],
        atomicSignals: ["clean_source_proven"],
        authority: { kind: "clean", coverageDependency: "wallet_provenance" }
      })
    ];

    for (const ineligibleSignal of ineligibleSignals) {
      expectCollectorOnly(scoreMatrixCandidates([
        collectorCandidate(),
        ineligibleSignal
      ], matrixContext));
    }
  });

  it("[REQ-16][COLLECTOR] refuses a repeated collector as the independent signal", async () => {
    const { scoreMatrixCandidates } = await import("../../src/risk/scoringSignalMatrix");
    expectCollectorOnly(scoreMatrixCandidates([
      collectorCandidate(),
      collectorCandidate({
        evidenceIds: ["evidence:collector-duplicate"],
        evidenceEpisodeIds: ["episode:B"]
      })
    ], matrixContext));
  });
});

describe("USDD PSM remediation acceptance contract", () => {
  it("[AC-03] scores 2 percent outbound USDD PSM with direction adjustment", async () => {
    const [{ buildUsddPsmExposure, usddPsmMatrixCandidate }, { scoreMatrixCandidates }] = await Promise.all([
      import("../../src/risk/usddPsmExposure"),
      import("../../src/risk/scoringSignalMatrix")
    ]);
    const exposure = buildUsddPsmExposure(psmObservation({
      direction: "outbound_to_psm",
      amountRaw: "2000000",
      selectedAmountRaw: "100000000"
    }));

    expect(exposure).toMatchObject({
      baseModifier: 3,
      modeAdjustedModifier: 3,
      appliedModifier: 2,
      roundingPolicy: "half_up_non_negative"
    });
    if (!exposure) throw new Error("expected exact USDD PSM exposure");
    const candidate = usddPsmMatrixCandidate({ exposure, context: matrixContext });
    expect(candidate).toMatchObject({ score: 22, authority: { kind: "context" } });
    expect(scoreMatrixCandidates([candidate], matrixContext)).toMatchObject({
      policyScore: 22,
      matrixDecision: "ACCEPTABLE"
    });
  });

  it("[AC-04] scores 83 percent direct inbound USDD PSM at top tier", async () => {
    const [{ buildUsddPsmExposure, usddPsmMatrixCandidate }, { scoreMatrixCandidates }] = await Promise.all([
      import("../../src/risk/usddPsmExposure"),
      import("../../src/risk/scoringSignalMatrix")
    ]);
    const exposure = buildUsddPsmExposure(psmObservation());

    expect(exposure).toMatchObject({
      baseModifier: 25,
      modeAdjustedModifier: 25,
      appliedModifier: 25
    });
    if (!exposure) throw new Error("expected exact USDD PSM exposure");
    const candidate = usddPsmMatrixCandidate({ exposure, context: matrixContext });
    expect(candidate).toMatchObject({ score: 45, authority: { kind: "context" } });
    expect(scoreMatrixCandidates([candidate], matrixContext)).toMatchObject({
      policyScore: 45,
      matrixDecision: "REVIEW",
      winningCandidate: { evidenceClass: "context", decisionEligibility: "review_only" }
    });
  });

  it("[AC-05] halves historical Deep USDD PSM and caps modifier at 12", async () => {
    const [{ buildUsddPsmExposure, usddPsmMatrixCandidate }, { scoreMatrixCandidates }] = await Promise.all([
      import("../../src/risk/usddPsmExposure"),
      import("../../src/risk/scoringSignalMatrix")
    ]);
    const exposure = buildUsddPsmExposure(psmObservation({ mode: "deep_history" }));

    expect(exposure).toMatchObject({
      baseModifier: 25,
      modeAdjustedModifier: 12,
      appliedModifier: 12
    });
    if (!exposure) throw new Error("expected exact historical USDD PSM exposure");
    const candidate = usddPsmMatrixCandidate({ exposure, context: matrixContext });
    expect(candidate).toMatchObject({ score: 32, authority: { kind: "context" } });
    expect(scoreMatrixCandidates([candidate], matrixContext)).toMatchObject({
      policyScore: 32,
      matrixDecision: "REVIEW"
    });
  });

  it("[AC-06] keeps label-only or discontinuous USDD PSM unscored", async () => {
    const { buildUsddPsmExposure, usddPsmMatrixCandidate } = await import("../../src/risk/usddPsmExposure");
    const cases = [
      ["label-only", psmObservation({
        serviceAddress: null,
        serviceIdentityExact: false,
        scoringEligible: false,
        ineligibilityReason: "label_only"
      })],
      ["wrong reserve", psmObservation({ serviceAddress: SUBJECT })],
      ["discontinuous", psmObservation({
        amountContinuityExact: false,
        scoringEligible: false,
        ineligibilityReason: "amount_discontinuous"
      })],
      ["unsupported hop", psmObservation({
        hopCount: null,
        scoringEligible: false,
        ineligibilityReason: "unsupported_hop"
      })]
    ] as const;

    for (const [name, observation] of cases) {
      const exposure = buildUsddPsmExposure(observation);
      const candidate = exposure ? usddPsmMatrixCandidate({ exposure, context: matrixContext }) : null;
      expect(exposure, name).toBeNull();
      expect(candidate, name).toBeNull();
    }
  });

  it("[REQ-29][USDD-PSM] derives the standalone context base from named caps", async () => {
    const {
      USDD_PSM_CONTEXT_BASE_SCORE,
      USDD_PSM_MAX_MODIFIER,
      USDD_PSM_STANDALONE_CAP
    } = await import("../../src/risk/usddPsmExposure");

    expect(USDD_PSM_STANDALONE_CAP).toBe(45);
    expect(USDD_PSM_MAX_MODIFIER).toBe(25);
    expect(USDD_PSM_CONTEXT_BASE_SCORE).toBe(20);
    expect(USDD_PSM_CONTEXT_BASE_SCORE).toBe(
      USDD_PSM_STANDALONE_CAP - USDD_PSM_MAX_MODIFIER
    );
  });

  it.each([
    { label: "4.999999%", amountRaw: "4999999", expectedBase: 3 },
    { label: "5%", amountRaw: "5000000", expectedBase: 7 },
    { label: "20%", amountRaw: "20000000", expectedBase: 12 },
    { label: "50%", amountRaw: "50000000", expectedBase: 18 },
    { label: "80%", amountRaw: "80000000", expectedBase: 25 },
    { label: "100%", amountRaw: "100000000", expectedBase: 25 }
  ])("[REQ-29][USDD-PSM] selects the exact BigInt tier at $label", async ({ amountRaw, expectedBase }) => {
    const { buildUsddPsmExposure } = await import("../../src/risk/usddPsmExposure");
    const exposure = buildUsddPsmExposure(psmObservation({
      amountRaw,
      selectedAmountRaw: "100000000"
    }));

    expect(exposure).not.toBeNull();
    expect(exposure?.baseModifier).toBe(expectedBase);
  });
});
