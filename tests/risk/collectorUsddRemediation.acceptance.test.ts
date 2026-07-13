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

  it("[REQ-16][COLLECTOR] selects one permutation-invariant canonical composite", async () => {
    const [{ scoreMatrixCandidates }, { resolveFinalDisposition }, { materializeFreshScoreBindingV2 }] = await Promise.all([
      import("../../src/risk/scoringSignalMatrix"),
      import("../../src/risk/finalDisposition"),
      import("../../src/risk/scoreAnchorV2")
    ]);
    const primaryCollector = collectorCandidate({
      evidenceIds: ["evidence:collector-z", "evidence:collector-a"],
      evidenceEpisodeIds: ["episode:A2", "episode:A1"]
    });
    const secondaryCollector = collectorCandidate({
      evidenceIds: ["evidence:collector-secondary"],
      evidenceEpisodeIds: ["episode:D"]
    });
    const primaryIndependent = matrixCandidate({
      evidenceIds: ["evidence:independent-z", "evidence:independent-a"],
      evidenceEpisodeIds: ["episode:B"]
    });
    const secondaryIndependent = matrixCandidate({
      evidenceIds: ["evidence:independent-secondary"],
      evidenceEpisodeIds: ["episode:C"]
    });
    const permutations = [
      [primaryCollector, secondaryCollector, primaryIndependent, secondaryIndependent],
      [secondaryIndependent, primaryIndependent, secondaryCollector, primaryCollector],
      [primaryIndependent, primaryCollector, secondaryIndependent, secondaryCollector],
      [secondaryCollector, secondaryIndependent, primaryCollector, primaryIndependent]
    ];
    const results = permutations.map((candidates) => scoreMatrixCandidates(candidates, matrixContext));
    const anchors = results.map((matrix) => materializeFreshScoreBindingV2({
      mode: "unified",
      subjectAddress: SUBJECT,
      disposition: resolveFinalDisposition({
        subject: {
          decisionScope: matrixContext.decisionScope,
          address: SUBJECT,
          txHash: null
        },
        matrixScore: matrix,
        coverage: { required: "valid", overall: "complete", invalidModes: [], caveats: [] },
        observedContextScore: 55
      }),
      matrix
    }).anchor);
    const expectedEvidenceIds = [
      "evidence:collector-a",
      "evidence:collector-z",
      "evidence:independent-a",
      "evidence:independent-z"
    ];
    const expectedEpisodeIds = ["episode:A1", "episode:A2", "episode:B"];

    for (const result of results) {
      expect(result.winningCandidate).toEqual(results[0].winningCandidate);
      expect(result.winningCandidate).toMatchObject({
        score: 55,
        atomicSignals: ["collector_plus_independent_signal"],
        evidenceIds: expectedEvidenceIds,
        evidenceEpisodeIds: expectedEpisodeIds
      });
      expect(result.riskVector.behavior_only_prior?.filter((candidate) =>
        candidate.atomicSignals.includes("collector_plus_independent_signal")
      )).toHaveLength(1);
    }
    for (const anchor of anchors) {
      expect(anchor).toEqual(anchors[0]);
      expect(anchor).toMatchObject({
        score: 55,
        decision: "REVIEW",
        matrixRow: "behavior_only_prior",
        evidenceClass: "pattern",
        coverageDependency: "required"
      });
    }
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

  it.each([
    { label: "numeric amountRaw", patch: { amountRaw: 2_000_000 } },
    { label: "numeric selectedAmountRaw", patch: { selectedAmountRaw: 100_000_000 } },
    {
      label: "precision-lost amountRaw number",
      patch: { amountRaw: 9_007_199_254_740_993, selectedAmountRaw: "10000000000000000" }
    },
    { label: "amountRaw object coercion", patch: { amountRaw: { toString: () => "83000000" } } },
    { label: "unknown mode", patch: { mode: "historical_unknown" } },
    { label: "wrong observation version", patch: { version: "usdd-psm-route-observation-v0" } },
    { label: "wrong service identity discriminator", patch: { serviceId: "provider_label_only" } }
  ])("[REQ-28][USDD-PSM-RUNTIME] rejects $label", async ({ patch }) => {
    const { buildUsddPsmExposure } = await import("../../src/risk/usddPsmExposure");
    expect(buildUsddPsmExposure(psmObservation(patch as never))).toBeNull();
  });

  it.each([
    {
      label: "22 outbound Where",
      observation: psmObservation({
        direction: "outbound_to_psm",
        amountRaw: "2000000",
        selectedAmountRaw: "100000000"
      }),
      mode: "where" as const,
      score: 22,
      decision: "ACCEPTABLE" as const
    },
    {
      label: "45 inbound Where",
      observation: psmObservation(),
      mode: "where" as const,
      score: 45,
      decision: "REVIEW" as const
    },
    {
      label: "32 inbound Deep",
      observation: psmObservation({ mode: "deep_history" }),
      mode: "deep" as const,
      score: 32,
      decision: "REVIEW" as const
    },
    {
      label: "26 outbound Deep",
      observation: psmObservation({ mode: "deep_history", direction: "outbound_to_psm" }),
      mode: "deep" as const,
      score: 26,
      decision: "ACCEPTABLE" as const
    }
  ])("[REQ-28][REQ-29][USDD-PSM-ANCHOR] binds $label through disposition and fresh assembly", async ({
    observation,
    mode,
    score,
    decision
  }) => {
    const [
      { buildUsddPsmExposure, usddPsmMatrixCandidate },
      { scoreMatrixCandidates },
      { resolveFinalDisposition },
      { assembleFreshScoreResultV2, materializeFreshScoreBindingV2, validateScoreAnchorV2 }
    ] = await Promise.all([
      import("../../src/risk/usddPsmExposure"),
      import("../../src/risk/scoringSignalMatrix"),
      import("../../src/risk/finalDisposition"),
      import("../../src/risk/scoreAnchorV2")
    ]);
    const exposure = buildUsddPsmExposure(observation);
    if (!exposure) throw new Error("expected exact USDD PSM exposure");
    const candidate = usddPsmMatrixCandidate({ exposure, context: matrixContext });
    const matrix = scoreMatrixCandidates([candidate], matrixContext);
    const disposition = resolveFinalDisposition({
      subject: {
        decisionScope: matrixContext.decisionScope,
        address: SUBJECT,
        txHash: null
      },
      matrixScore: matrix,
      coverage: { required: "valid", overall: "complete", invalidModes: [], caveats: [] },
      observedContextScore: score
    });

    expect(matrix).toMatchObject({
      policyScore: score,
      matrixDecision: decision,
      winningRow: "source_policy",
      winningCandidate: {
        score,
        evidenceClass: "context",
        proofLevel: "context",
        decisionEligibility: "review_only",
        coverageDependency: "none",
        atomicSignals: ["exact_usdd_psm_exposure"],
        evidenceIds: observation.evidenceIds,
        authority: { kind: "context" }
      }
    });
    expect(disposition).toMatchObject({
      decision,
      finalScore: score,
      scoreValid: true,
      decisionBasis: "matrix",
      decisiveCandidate: { atomicSignals: ["exact_usdd_psm_exposure"] }
    });

    const binding = materializeFreshScoreBindingV2({
      mode,
      subjectAddress: SUBJECT,
      disposition,
      matrix
    });
    expect(binding).toMatchObject({
      diagnostic: null,
      anchor: {
        score,
        decision,
        matrixRow: "source_policy",
        evidenceClass: "context",
        proofLevel: "context",
        authority: "behavior",
        coverageDependency: "required"
      },
      evidence: [{
        matrixRow: "source_policy",
        evidenceClass: "context",
        authority: "behavior",
        sourceEvidenceIds: [...observation.evidenceIds].sort()
      }],
      facts: [{ kind: "exact_usdd_psm_exposure", isScoreDriver: true }]
    });
    const assembled = assembleFreshScoreResultV2({
      mode,
      subjectAddress: SUBJECT,
      disposition,
      matrix,
      evidence: binding.evidence,
      facts: binding.facts,
      activeAnchors: binding.anchor ? [binding.anchor] : []
    });
    expect(assembled).toMatchObject({
      decision,
      finalScore: score,
      scoreValid: true,
      scoreAnchorDiagnostic: null,
      scoreAnchorV2: {
        score,
        decision,
        matrixRow: "source_policy",
        coverageDependency: "required"
      }
    });
    expect(assembled.decision).not.toBe("DECLINE");
    const boundAnchor = binding.anchor;
    if (!boundAnchor) throw new Error("expected canonical USDD PSM anchor");
    expect(() => validateScoreAnchorV2({
      anchor: { ...boundAnchor, coverageDependency: "none" },
      checkedSubjectAddress: SUBJECT,
      checkedMode: mode,
      evidence: binding.evidence,
      facts: binding.facts
    })).toThrow("score_anchor_fact_binding_failed");
  });

  it.each([
    { label: "below score registry", score: 19, atomicSignal: "exact_usdd_psm_exposure", forcedDecision: null },
    { label: "above score registry", score: 46, atomicSignal: "exact_usdd_psm_exposure", forcedDecision: null },
    { label: "ACCEPTABLE score forced to REVIEW", score: 22, atomicSignal: "exact_usdd_psm_exposure", forcedDecision: "REVIEW" as const },
    { label: "REVIEW score forced to ACCEPTABLE", score: 32, atomicSignal: "exact_usdd_psm_exposure", forcedDecision: "ACCEPTABLE" as const },
    { label: "unregistered source-policy context", score: 32, atomicSignal: "other_source_policy_context", forcedDecision: null }
  ])("[REQ-29][USDD-PSM-ANCHOR] rejects $label", async ({ score, atomicSignal, forcedDecision }) => {
    const [
      { buildUsddPsmExposure, usddPsmMatrixCandidate },
      { scoreMatrixCandidates },
      { resolveFinalDisposition },
      { materializeFreshScoreBindingV2 }
    ] = await Promise.all([
      import("../../src/risk/usddPsmExposure"),
      import("../../src/risk/scoringSignalMatrix"),
      import("../../src/risk/finalDisposition"),
      import("../../src/risk/scoreAnchorV2")
    ]);
    const exposure = buildUsddPsmExposure(psmObservation({ mode: "deep_history" }));
    if (!exposure) throw new Error("expected exact USDD PSM exposure");
    const candidate = {
      ...usddPsmMatrixCandidate({ exposure, context: matrixContext }),
      score,
      atomicSignals: [atomicSignal]
    };
    const matrix = scoreMatrixCandidates([candidate], matrixContext);
    const resolvedDisposition = resolveFinalDisposition({
      subject: { decisionScope: matrixContext.decisionScope, address: SUBJECT, txHash: null },
      matrixScore: matrix,
      coverage: { required: "valid", overall: "complete", invalidModes: [], caveats: [] },
      observedContextScore: score
    });
    const disposition = forcedDecision === null
      ? resolvedDisposition
      : { ...resolvedDisposition, decision: forcedDecision };
    expect(materializeFreshScoreBindingV2({
      mode: "deep",
      subjectAddress: SUBJECT,
      disposition,
      matrix
    })).toMatchObject({
      anchor: null,
      diagnostic: "score_anchor_fact_binding_failed",
      evidence: [],
      facts: []
    });
  });
});
