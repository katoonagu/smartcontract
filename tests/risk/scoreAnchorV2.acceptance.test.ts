import { TronWeb } from "tronweb";
import { describe, expect, it } from "vitest";
import { buildWalletMatrixCandidates } from "../../src/risk/scoringSignalMatrixInputs";
import {
  BRIDGERS,
  NOW,
  OWNER,
  SUBJECT,
  USDD_PSM,
  VERIFY20
} from "../fixtures/forensics/remediationScoringCases";

const MODE = "unified";

const matrixExactAuthority = {
  kind: "exact_hard",
  proofSource: "stablecoin_restriction"
};

const validEvidence = () => ([{
  id: "score-evidence:restriction",
  subjectAddress: SUBJECT,
  matrixRow: "hard_proof",
  evidenceClass: "exact_hard",
  authority: "on_chain",
  sourceEvidenceIds: ["restriction:subject"]
}]);

const validFacts = () => ([{
  id: "fact:restriction",
  subjectAddress: SUBJECT,
  mode: MODE,
  kind: "stablecoin_restriction",
  role: null,
  section: "score_reason",
  evidenceIds: ["score-evidence:restriction"],
  isScoreDriver: true,
  direction: null,
  amountRaw: null,
  share: null,
  txCount: null,
  addresses: [],
  txHashes: [],
  factTextKey: "score.hard_proof.subject_restricted",
  meaningTextKey: null
}]);

const validAnchor = (overrides: Record<string, unknown> = {}) => ({
  version: "score-anchor-v2",
  score: 95,
  decision: "DECLINE",
  policyVersion: "scoring-signal-matrix-v3",
  subjectAddress: SUBJECT,
  mode: MODE,
  matrixRow: "hard_proof",
  evidenceClass: "exact_hard",
  proofLevel: "exact",
  authority: "on_chain",
  evidenceIds: ["score-evidence:restriction"],
  primaryEvidenceIds: ["score-evidence:restriction"],
  preferredFactId: "fact:restriction",
  coverageDependency: "none",
  ...overrides
});

const matrixCandidate = (overrides: Record<string, unknown> = {}) => ({
  row: "hard_proof",
  actionUnit: "wallet",
  score: 95,
  evidenceIds: ["restriction:subject"],
  evidenceEpisodeIds: ["restriction:subject"],
  atomicSignals: ["subject_restricted"],
  modifiers: ["hard_anchor"],
  caps: [],
  dampeners: [],
  caveats: [],
  subject: { decisionScope: MODE, address: SUBJECT, txHash: null },
  authority: matrixExactAuthority,
  evidenceClass: "exact_hard",
  proofLevel: "exact",
  decisionEligibility: "can_decline",
  coverageDependency: "none",
  ...overrides
});

const validMatrix = (candidate = matrixCandidate(), overrides: Record<string, unknown> = {}) => ({
  policyVersion: "scoring-signal-matrix-v3",
  policyScore: candidate.score,
  matrixDecision: "DECLINE",
  winningRow: candidate.row,
  winningCandidate: candidate,
  actionUnit: candidate.actionUnit,
  riskVector: { [candidate.row]: [candidate] },
  uncertaintyState: {
    coverage: "sufficient",
    continuity: "strong",
    provider: "complete",
    staleData: false,
    caveats: []
  },
  queuePriorityScore: null,
  calibratedRiskProbability: null,
  ...overrides
});

const validDisposition = (overrides: Record<string, unknown> = {}) => ({
  decision: "DECLINE",
  finalScore: 95,
  observedContextScore: 20,
  scoreValid: true,
  decisionBasis: "exact_hard_proof",
  coverage: { required: "valid", unrelated: "partial" },
  hardProofEvidenceIds: ["restriction:subject"],
  decisiveCandidate: matrixCandidate(),
  ...overrides
});

const expectValidationFailure = (run: () => unknown) => {
  expect(run).toThrow("score_anchor_fact_binding_failed");
};

const invalidAssemblyCases = [
  {
    category: "score",
    anchors: [validAnchor({ score: 35.5 })],
    evidence: validEvidence(),
    facts: validFacts()
  },
  {
    category: "policy",
    anchors: [validAnchor({ matrixRow: "not_registered" })],
    evidence: validEvidence(),
    facts: validFacts()
  },
  {
    category: "subject-or-mode",
    anchors: [validAnchor({ subjectAddress: OWNER, mode: "incoming" })],
    evidence: validEvidence(),
    facts: validFacts()
  },
  {
    category: "evidence",
    anchors: [validAnchor({ evidenceIds: ["score-evidence:missing"] })],
    evidence: validEvidence(),
    facts: validFacts()
  },
  {
    category: "preferred-fact",
    anchors: [validAnchor({ preferredFactId: "fact:missing" })],
    evidence: validEvidence(),
    facts: validFacts()
  },
  {
    category: "authority",
    anchors: [validAnchor({
      matrixRow: "behavior_only_prior",
      evidenceClass: "context",
      proofLevel: "context",
      authority: "behavior",
      coverageDependency: "required",
      decision: "DECLINE"
    })],
    evidence: validEvidence(),
    facts: validFacts()
  },
  {
    category: "coverage",
    anchors: [validAnchor({ coverageDependency: "required" })],
    evidence: validEvidence(),
    facts: validFacts()
  },
  {
    category: "cardinality",
    anchors: [validAnchor(), validAnchor()],
    evidence: validEvidence(),
    facts: validFacts()
  }
] as const;

describe("ScoreAnchorV2 acceptance contract", () => {
  it("[FIXTURE] uses checksum-valid canonical Plan 2 TRON addresses", () => {
    for (const address of [SUBJECT, OWNER, VERIFY20, BRIDGERS, USDD_PSM]) {
      expect(TronWeb.isAddress(address), address).toBe(true);
    }
  });

  it("[REQ-04][REQ-15] keeps exact proof decline with unrelated partial coverage and a valid anchor", async () => {
    const {
      assembleFreshScoreResultV2,
      buildScoreAnchorV2,
      validateScoreAnchorV2
    } = await import("../../src/risk/scoreAnchorV2");
    const result = buildScoreAnchorV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition(),
      matrix: validMatrix(),
      facts: validFacts()
    } as any);

    expect(result.diagnostic).toBeNull();
    expect(result.anchor).toMatchObject({
      score: 95,
      decision: "DECLINE",
      subjectAddress: SUBJECT,
      mode: MODE,
      matrixRow: "hard_proof",
      evidenceClass: "exact_hard",
      proofLevel: "exact",
      authority: "on_chain",
      coverageDependency: "none",
      primaryEvidenceIds: ["score-evidence:restriction"],
      preferredFactId: "fact:restriction"
    });
    expect(validateScoreAnchorV2({
      anchor: result.anchor,
      checkedSubjectAddress: SUBJECT,
      checkedMode: MODE,
      evidence: validEvidence(),
      facts: validFacts()
    } as any)).toEqual(result.anchor);

    const published = assembleFreshScoreResultV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition({
        coverage: { required: "valid", overall: "partial", caveats: ["unrelated where limitation"] }
      }),
      matrix: validMatrix(),
      evidence: validEvidence(),
      facts: validFacts(),
      activeAnchors: [result.anchor]
    } as any);
    expect(published).toMatchObject({
      decision: "DECLINE",
      finalScore: 95,
      scoreValid: true,
      decisionBasis: "exact_hard_proof",
      coverage: { required: "valid", overall: "partial", caveats: ["unrelated where limitation"] },
      scoreAnchorV2: result.anchor,
      scoreAnchorDiagnostic: null
    });
  });

  it("[REQ-04][REQ-15][REQ-38] publishes no score when required coverage is invalid and no exact proof applies", async () => {
    const { assembleFreshScoreResultV2, buildScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const context = matrixCandidate({
      row: "behavior_only_prior",
      score: 59,
      evidenceIds: ["context:behavior"],
      evidenceEpisodeIds: ["context:behavior"],
      authority: { kind: "context" },
      evidenceClass: "context",
      proofLevel: "context",
      decisionEligibility: "review_only"
    });
    const result = buildScoreAnchorV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition({
        decision: "NO_FINAL_DECISION",
        finalScore: null,
        scoreValid: false,
        decisionBasis: "technical_stop",
        coverage: { required: "invalid", unrelated: "partial" },
        hardProofEvidenceIds: [],
        decisiveCandidate: null
      }),
      matrix: validMatrix(context, {
        policyScore: null,
        matrixDecision: "INSUFFICIENT_EVIDENCE",
        uncertaintyState: {
          coverage: "insufficient",
          continuity: "unknown",
          provider: "partial",
          staleData: false,
          caveats: ["required coverage invalid"]
        }
      }),
      facts: [{ id: "fact:context", evidenceIds: ["context:behavior"], proofStrength: "context" }]
    } as any);

    expect(result).toEqual({ anchor: null, diagnostic: null });
    expect(result).not.toHaveProperty("fallbackAnchor");

    const published = assembleFreshScoreResultV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition({
        decision: "REVIEW",
        finalScore: 59,
        scoreValid: true,
        decisionBasis: "matrix",
        coverage: { required: "invalid", overall: "partial", caveats: ["required coverage invalid"] },
        hardProofEvidenceIds: [],
        decisiveCandidate: context
      }),
      matrix: validMatrix(context),
      evidence: [],
      facts: [{
        id: "heuristic:fallback",
        subjectAddress: SUBJECT,
        mode: MODE,
        section: "score_reason",
        evidenceIds: ["context:behavior"],
        isScoreDriver: true
      }],
      activeAnchors: []
    } as any);
    expect(published).toMatchObject({
      decision: "NO_FINAL_DECISION",
      finalScore: null,
      scoreValid: false,
      decisionBasis: "technical_stop",
      scoreAnchorV2: null,
      scoreAnchorDiagnostic: "score_anchor_fact_binding_failed"
    });
    expect(published.coverage).toMatchObject({ required: "invalid", overall: "partial" });
    expect(published.narrativeFactsV2).toEqual([]);
    expect(published).not.toHaveProperty("fallbackAnchor");
    expect(published).not.toHaveProperty("fallbackFact");
  });

  it.each(invalidAssemblyCases)(
    "[REQ-15][ANCHOR-ASSEMBLER] fails closed for invalid $category binding",
    async ({ anchors, evidence, facts }) => {
      const { assembleFreshScoreResultV2 } = await import("../../src/risk/scoreAnchorV2");
      const published = assembleFreshScoreResultV2({
        mode: MODE,
        subjectAddress: SUBJECT,
        disposition: validDisposition(),
        matrix: validMatrix(),
        evidence,
        facts,
        activeAnchors: anchors
      } as any);

      expect(published).toMatchObject({
        decision: "NO_FINAL_DECISION",
        finalScore: null,
        scoreValid: false,
        decisionBasis: "technical_stop",
        scoreAnchorV2: null,
        scoreAnchorDiagnostic: "score_anchor_fact_binding_failed",
        narrativeFactsV2: []
      });
      expect(published).not.toHaveProperty("fallbackAnchor");
      expect(published).not.toHaveProperty("fallbackFact");
      expect(JSON.stringify(published)).not.toContain("heuristic");
    }
  );

  it("[REQ-15][ANCHOR-MIRROR] fails closed when the published score does not exactly match its anchor", async () => {
    const { assembleFreshScoreResultV2 } = await import("../../src/risk/scoreAnchorV2");
    const published = assembleFreshScoreResultV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition({ finalScore: 95 }),
      matrix: validMatrix(),
      evidence: validEvidence(),
      facts: validFacts(),
      activeAnchors: [validAnchor({ score: 94 })]
    } as any);

    expect(published).toMatchObject({
      decision: "NO_FINAL_DECISION",
      finalScore: null,
      scoreValid: false,
      decisionBasis: "technical_stop",
      scoreAnchorV2: null,
      scoreAnchorDiagnostic: "score_anchor_fact_binding_failed",
      narrativeFactsV2: []
    });
  });

  it("[REQ-15][ANCHOR-ZERO] retains numeric zero only with exactly one exactly mirrored score-zero anchor", async () => {
    const { assembleFreshScoreResultV2 } = await import("../../src/risk/scoreAnchorV2");
    const disposition = validDisposition({ finalScore: 0 });
    const anchor = validAnchor({ score: 0 });
    const assemble = (activeAnchors: unknown[]) => assembleFreshScoreResultV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition,
      matrix: validMatrix(matrixCandidate({ score: 0 }), { policyScore: 0 }),
      evidence: validEvidence(),
      facts: validFacts(),
      activeAnchors
    } as any);

    const published = assemble([anchor]);
    expect(published).toMatchObject({
      decision: disposition.decision,
      finalScore: 0,
      scoreValid: true,
      scoreAnchorV2: anchor,
      scoreAnchorDiagnostic: null
    });
    expect(published.finalScore).toBe(published.scoreAnchorV2!.score);
    expect(published.decision).toBe(published.scoreAnchorV2!.decision);
    expect(published.scoreAnchorV2!.subjectAddress).toBe(SUBJECT);
    expect(published.scoreAnchorV2!.mode).toBe(MODE);

    for (const activeAnchors of [[], [anchor, anchor]]) {
      expect(assemble(activeAnchors)).toMatchObject({
        decision: "NO_FINAL_DECISION",
        finalScore: null,
        scoreValid: false,
        decisionBasis: "technical_stop",
        scoreAnchorV2: null,
        scoreAnchorDiagnostic: "score_anchor_fact_binding_failed",
        narrativeFactsV2: []
      });
    }
  });

  it("[REQ-15][ANCHOR-SCORE] rejects non-integer non-finite or out-of-range anchor scores", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    for (const score of [-1, 101, 35.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expectValidationFailure(() => validateScoreAnchorV2({
        anchor: validAnchor({ score }),
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        evidence: validEvidence(),
        facts: validFacts()
      } as any));
    }
    for (const score of [0, 100]) {
      expect(validateScoreAnchorV2({
        anchor: validAnchor({ score }),
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        evidence: validEvidence(),
        facts: validFacts()
      } as any)).toEqual(validAnchor({ score }));
    }
  });

  it("[REQ-15][ANCHOR-POLICY] requires an exact registered policy row", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const cases = [
      { matrixRow: "not_registered" },
      { policyVersion: "scoring-signal-matrix-v2" },
      { decision: "REVIEW" },
      { evidenceClass: "context" },
      { proofLevel: "strong" },
      { authority: "registry" },
      { coverageDependency: "required" }
    ];
    for (const patch of cases) {
      expectValidationFailure(() => validateScoreAnchorV2({
        anchor: validAnchor(patch),
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        evidence: validEvidence(),
        facts: validFacts()
      } as any));
    }
  });

  it("[REQ-05][REQ-15][ANCHOR-SUBJECT] requires a valid TRON subject and exact address-mode binding", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const cases = [
      { anchor: validAnchor({ subjectAddress: "not-a-tron-address" }), checkedSubjectAddress: SUBJECT, checkedMode: MODE },
      { anchor: validAnchor({ subjectAddress: OWNER }), checkedSubjectAddress: SUBJECT, checkedMode: MODE },
      { anchor: validAnchor({ mode: "incoming" }), checkedSubjectAddress: SUBJECT, checkedMode: MODE },
      { anchor: validAnchor(), checkedSubjectAddress: OWNER, checkedMode: MODE },
      { anchor: validAnchor(), checkedSubjectAddress: SUBJECT, checkedMode: "incoming" },
      {
        anchor: validAnchor(),
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        facts: validFacts().map((fact) => ({ ...fact, mode: "incoming" }))
      }
    ];
    for (const testCase of cases) {
      expectValidationFailure(() => validateScoreAnchorV2({
        ...testCase,
        evidence: validEvidence(),
        facts: testCase.facts ?? validFacts()
      } as any));
    }
  });

  it("[REQ-15][ANCHOR-EVIDENCE] requires unique resolvable subject-bound evidence", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const cases = [
      { anchor: validAnchor({ evidenceIds: [], primaryEvidenceIds: [] }), evidence: validEvidence() },
      { anchor: validAnchor({ evidenceIds: ["score-evidence:missing"] }), evidence: validEvidence() },
      {
        anchor: validAnchor({
          evidenceIds: ["score-evidence:restriction", "score-evidence:restriction"],
          primaryEvidenceIds: ["score-evidence:restriction", "score-evidence:restriction"]
        }),
        evidence: validEvidence()
      },
      {
        anchor: validAnchor({ primaryEvidenceIds: ["score-evidence:missing"] }),
        evidence: validEvidence()
      },
      { anchor: validAnchor(), evidence: [...validEvidence(), ...validEvidence()] },
      { anchor: validAnchor(), evidence: validEvidence().map((item) => ({ ...item, subjectAddress: OWNER })) },
      {
        anchor: validAnchor(),
        evidence: validEvidence().map((item) => ({
          ...item,
          matrixRow: "behavior_only_prior",
          evidenceClass: "context",
          authority: "behavior"
        }))
      }
    ];
    for (const testCase of cases) {
      expectValidationFailure(() => validateScoreAnchorV2({
        ...testCase,
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        facts: validFacts()
      } as any));
    }
  });

  it("[REQ-15][ANCHOR-PREFERRED] requires exactly one resolvable preferredFactId", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const cases = [
      { anchor: validAnchor({ preferredFactId: "" }), facts: validFacts() },
      { anchor: validAnchor({ preferredFactId: "fact:missing" }), facts: validFacts() },
      { anchor: validAnchor(), facts: [] },
      { anchor: validAnchor(), facts: [...validFacts(), ...validFacts()] },
      { anchor: validAnchor(), facts: validFacts().map((fact) => ({ ...fact, subjectAddress: OWNER })) },
      { anchor: validAnchor(), facts: validFacts().map((fact) => ({ ...fact, mode: "incoming" })) },
      { anchor: validAnchor(), facts: validFacts().map((fact) => ({ ...fact, section: "coverage" })) },
      { anchor: validAnchor(), facts: validFacts().map((fact) => ({ ...fact, isScoreDriver: false })) },
      { anchor: validAnchor(), facts: validFacts().map((fact) => ({ ...fact, evidenceIds: ["other:evidence"] })) }
    ];
    for (const testCase of cases) {
      expectValidationFailure(() => validateScoreAnchorV2({
        ...testCase,
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        evidence: validEvidence()
      } as any));
    }
  });

  it("[REQ-04][REQ-15][ANCHOR-COVERAGE] enforces the registered coverageDependency", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const cases = ["required", "invented_coverage"];
    for (const coverageDependency of cases) {
      expectValidationFailure(() => validateScoreAnchorV2({
        anchor: validAnchor({ coverageDependency }),
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        evidence: validEvidence(),
        facts: validFacts()
      } as any));
    }
    expect(validateScoreAnchorV2({
      anchor: validAnchor({ coverageDependency: "none" }),
      checkedSubjectAddress: SUBJECT,
      checkedMode: MODE,
      evidence: validEvidence(),
      facts: validFacts()
    } as any)).toEqual(validAnchor({ coverageDependency: "none" }));

    const behaviorEvidence = validEvidence().map((item) => ({
      ...item,
      id: "score-evidence:behavior",
      matrixRow: "behavior_only_prior",
      evidenceClass: "context",
      authority: "behavior"
    }));
    const behaviorFacts = validFacts().map((fact) => ({
      ...fact,
      id: "fact:behavior",
      kind: "collector_transit_behavior",
      evidenceIds: ["score-evidence:behavior"]
    }));
    const behaviorAnchor = validAnchor({
      score: 35,
      decision: "REVIEW",
      matrixRow: "behavior_only_prior",
      evidenceClass: "context",
      proofLevel: "context",
      authority: "behavior",
      evidenceIds: ["score-evidence:behavior"],
      primaryEvidenceIds: ["score-evidence:behavior"],
      preferredFactId: "fact:behavior",
      coverageDependency: "required"
    });
    expect(validateScoreAnchorV2({
      anchor: behaviorAnchor,
      checkedSubjectAddress: SUBJECT,
      checkedMode: MODE,
      evidence: behaviorEvidence,
      facts: behaviorFacts
    } as any)).toEqual(behaviorAnchor);
    expectValidationFailure(() => validateScoreAnchorV2({
      anchor: { ...behaviorAnchor, coverageDependency: "none" },
      checkedSubjectAddress: SUBJECT,
      checkedMode: MODE,
      evidence: behaviorEvidence,
      facts: behaviorFacts
    } as any));
  });

  it.each([
    {
      label: "wallet provenance",
      mode: "unified",
      decisionScope: "wallet_unified",
      actionUnit: "wallet",
      subjectTxHash: null,
      requiredCoverage: "wallet_provenance"
    },
    {
      label: "deposit provenance",
      mode: "incoming",
      decisionScope: "incoming_unified",
      actionUnit: "incoming_deposit",
      subjectTxHash: "tx:collector-incoming",
      requiredCoverage: "deposit_provenance"
    }
  ] as const)("[AC-02][REQ-15][ANCHOR-COLLECTOR] publishes composed 55 REVIEW with required coverage for $label", async ({
    mode,
    decisionScope,
    actionUnit,
    subjectTxHash,
    requiredCoverage
  }) => {
    const [{ scoreMatrixCandidates }, { resolveFinalDisposition }, {
      assembleFreshScoreResultV2,
      materializeFreshScoreBindingV2
    }] = await Promise.all([
      import("../../src/risk/scoringSignalMatrix"),
      import("../../src/risk/finalDisposition"),
      import("../../src/risk/scoreAnchorV2")
    ]);
    const subject = { decisionScope, address: SUBJECT, txHash: subjectTxHash };
    const matrix = scoreMatrixCandidates([
      matrixCandidate({
        row: "behavior_only_prior",
        actionUnit,
        score: 35,
        evidenceIds: ["evidence:collector"],
        evidenceEpisodeIds: ["episode:collector"],
        atomicSignals: ["collector_transit_behavior"],
        modifiers: [],
        caps: ["collector_only_cap_35"],
        subject,
        authority: { kind: "context" }
      }),
      matrixCandidate({
        row: "counterparty_context",
        actionUnit,
        score: 30,
        evidenceIds: ["evidence:independent"],
        evidenceEpisodeIds: ["episode:independent"],
        atomicSignals: ["deep_counterparty_risk_context"],
        modifiers: [],
        caps: [],
        subject,
        authority: { kind: "context" }
      })
    ] as any, {
      decisionScope,
      subjectAddress: SUBJECT,
      subjectTxHash,
      requiredCoverage
    });
    expect(matrix.winningCandidate).toMatchObject({
      row: "behavior_only_prior",
      score: 55,
      evidenceClass: "pattern",
      proofLevel: "corroborated_pattern",
      decisionEligibility: "review_only",
      coverageDependency: requiredCoverage,
      atomicSignals: ["collector_plus_independent_signal"],
      authority: {
        kind: "pattern",
        decisionEligibility: "review_only",
        coverageDependency: requiredCoverage
      }
    });

    const disposition = resolveFinalDisposition({
      subject,
      matrixScore: matrix,
      coverage: { required: "valid", overall: "complete", invalidModes: [], caveats: [] },
      observedContextScore: 55
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
        policyVersion: "scoring-signal-matrix-v3",
        score: 55,
        decision: "REVIEW",
        matrixRow: "behavior_only_prior",
        evidenceClass: "pattern",
        proofLevel: "strong",
        authority: "deterministic_pattern",
        coverageDependency: "required"
      }
    });
    expect(assembleFreshScoreResultV2({
      mode,
      subjectAddress: SUBJECT,
      disposition,
      matrix,
      evidence: binding.evidence,
      facts: binding.facts,
      activeAnchors: binding.anchor ? [binding.anchor] : []
    })).toMatchObject({
      decision: "REVIEW",
      finalScore: 55,
      scoreValid: true,
      scoreAnchorDiagnostic: null,
      scoreAnchorV2: { coverageDependency: "required" }
    });
  });

  it("[REQ-04][REQ-15][ANCHOR-AUTHORITY] forbids DECLINE for context coverage or limitation rows", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const cases = [
      { matrixRow: "behavior_only_prior", evidenceClass: "context", proofLevel: "context", authority: "behavior", coverageDependency: "required" },
      { matrixRow: "coverage_uncertainty", evidenceClass: "coverage", proofLevel: "context", authority: "behavior", coverageDependency: "required" },
      { matrixRow: "coverage_uncertainty", evidenceClass: "limitation", proofLevel: "context", authority: "behavior", coverageDependency: "required" }
    ];
    for (const patch of cases) {
      const evidence = validEvidence().map((item) => ({ ...item, ...patch }));
      expectValidationFailure(() => validateScoreAnchorV2({
        anchor: validAnchor({ ...patch, decision: "DECLINE" }),
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        evidence,
        facts: validFacts()
      } as any));
    }
  });

  it("[REQ-15][ANCHOR-CARDINALITY] requires exactly one active anchor for every published score", async () => {
    const { validateScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    expect(validateScoreAnchorV2({
      anchor: validAnchor({ score: 0 }),
      checkedSubjectAddress: SUBJECT,
      checkedMode: MODE,
      evidence: validEvidence(),
      facts: validFacts()
    } as any)).toEqual(validAnchor({ score: 0 }));
    for (const anchor of [[], [validAnchor(), validAnchor()]]) {
      expectValidationFailure(() => validateScoreAnchorV2({
        anchor,
        checkedSubjectAddress: SUBJECT,
        checkedMode: MODE,
        evidence: validEvidence(),
        facts: validFacts()
      } as any));
    }
  });

  it("[REQ-04][REQ-15][ANCHOR-LEGACY] never synthesizes an anchor for a legacy result", async () => {
    const { buildScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const matrix = validMatrix();
    delete (matrix as any).policyVersion;
    const result = buildScoreAnchorV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition(),
      matrix,
      facts: validFacts()
    } as any);

    expect(result.anchor).toBeNull();
    expect(result).not.toHaveProperty("fallbackAnchor");
  });

  it("[REQ-04][REQ-15][ANCHOR-VERSION] synthesizes an anchor only from canonical v3 and keeps explicit v2 legacy", async () => {
    const { buildScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const current = buildScoreAnchorV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition(),
      matrix: validMatrix(matrixCandidate(), { policyVersion: "scoring-signal-matrix-v3" }),
      facts: validFacts()
    } as any);
    expect(current).toMatchObject({
      diagnostic: null,
      anchor: { policyVersion: "scoring-signal-matrix-v3" }
    });

    const previousRuntime = buildScoreAnchorV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition(),
      matrix: validMatrix(matrixCandidate(), { policyVersion: "scoring-signal-matrix-v2" }),
      facts: validFacts()
    } as any);
    expect(previousRuntime).toEqual({ anchor: null, diagnostic: null });

    for (const policyVersion of ["scoring-signal-matrix-v1", "future-policy", 7, true]) {
      const result = buildScoreAnchorV2({
        mode: MODE,
        subjectAddress: SUBJECT,
        disposition: validDisposition(),
        matrix: validMatrix(matrixCandidate(), { policyVersion }),
        facts: validFacts()
      } as any);
      expect(result).toEqual({ anchor: null, diagnostic: "score_anchor_fact_binding_failed" });
    }
  });

  it("[REQ-15][ANCHOR-COLLISION] fails closed instead of collapsing distinct candidates into one evidence envelope", async () => {
    const { materializeFreshScoreBindingV2 } = await import("../../src/risk/scoreAnchorV2");
    const winner = matrixCandidate();
    const collidingContributor = {
      ...winner,
      atomicSignals: ["different_atomic_signal_for_same_evidence"]
    };
    const matrix = validMatrix(winner, {
      riskVector: { hard_proof: [winner, collidingContributor] }
    });

    expect(materializeFreshScoreBindingV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition({ decisiveCandidate: winner }),
      matrix
    } as any)).toEqual({
      anchor: null,
      diagnostic: "score_anchor_fact_binding_failed",
      evidence: [],
      facts: []
    });
  });

  it("[REQ-15][ANCHOR-ATOMIC-SIGNAL] fails closed when the decisive candidate has no first atomic signal", async () => {
    const { materializeFreshScoreBindingV2 } = await import("../../src/risk/scoreAnchorV2");
    const candidate = matrixCandidate({ atomicSignals: [] });

    expect(materializeFreshScoreBindingV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition({ decisiveCandidate: candidate }),
      matrix: validMatrix(candidate)
    } as any)).toEqual({
      anchor: null,
      diagnostic: "score_anchor_fact_binding_failed",
      evidence: [],
      facts: []
    });
  });

  it("[REQ-05][REQ-15][ANCHOR-INCOMING-CONTEXT] binds the registered unknown-contract incoming context row", async () => {
    const {
      assembleFreshScoreResultV2,
      materializeFreshScoreBindingV2,
      validateScoreAnchorV2
    } = await import("../../src/risk/scoreAnchorV2");
    const candidate = matrixCandidate({
      row: "incoming_deposit_source_policy",
      actionUnit: "incoming_deposit",
      score: 45,
      evidenceIds: ["incoming:unknown-contract:context"],
      evidenceEpisodeIds: ["incoming:unknown-contract:episode"],
      atomicSignals: ["incoming_fresh_unknown_contract_source"],
      modifiers: ["share_87"],
      caps: ["unknown_contract_cap_59"],
      subject: { decisionScope: "incoming_unified", address: SUBJECT, txHash: "tx-incoming-context" },
      authority: { kind: "context" },
      evidenceClass: "context",
      proofLevel: "context",
      decisionEligibility: "review_only",
      coverageDependency: "none"
    });
    const disposition = validDisposition({
      decision: "REVIEW",
      finalScore: 45,
      observedContextScore: 45,
      decisionBasis: "matrix",
      hardProofEvidenceIds: [],
      decisiveCandidate: candidate
    });
    const matrix = validMatrix(candidate, {
      policyScore: 45,
      matrixDecision: "REVIEW",
      actionUnit: "incoming_deposit"
    });
    const binding = materializeFreshScoreBindingV2({
      mode: "incoming",
      subjectAddress: SUBJECT,
      disposition,
      matrix
    } as any);

    expect(binding).toMatchObject({
      diagnostic: null,
      anchor: {
        subjectAddress: SUBJECT,
        mode: "incoming",
        score: 45,
        decision: "REVIEW",
        matrixRow: "incoming_deposit_source_policy",
        evidenceClass: "context",
        proofLevel: "context",
        authority: "behavior",
        coverageDependency: "required"
      }
    });
    expectValidationFailure(() => validateScoreAnchorV2({
      anchor: { ...binding.anchor, coverageDependency: "none" },
      checkedSubjectAddress: SUBJECT,
      checkedMode: "incoming",
      evidence: binding.evidence,
      facts: binding.facts
    } as any));
    expect(assembleFreshScoreResultV2({
      mode: "incoming",
      subjectAddress: SUBJECT,
      disposition,
      matrix,
      evidence: binding.evidence,
      facts: binding.facts,
      activeAnchors: [binding.anchor]
    } as any)).toMatchObject({
      finalScore: 45,
      decision: "REVIEW",
      scoreValid: true,
      scoreAnchorDiagnostic: null
    });
  });

  it("[REQ-15][ANCHOR-PUBLICATION] clears Unified and Incoming numeric fields when canonical binding fails", async () => {
    const {
      assembleFreshScoreResultV2,
      canonicalScorePublicationV2
    } = await import("../../src/risk/scoreAnchorV2");
    const invalid = assembleFreshScoreResultV2({
      mode: MODE,
      subjectAddress: SUBJECT,
      disposition: validDisposition(),
      matrix: validMatrix(),
      evidence: [],
      facts: [],
      activeAnchors: []
    } as any);

    for (const consumer of ["unified", "incoming"]) {
      expect(canonicalScorePublicationV2(invalid), consumer).toMatchObject({
        finalScore: null,
        finalDecision: "NO_FINAL_DECISION",
        scoreValid: false,
        decisionBasis: "technical_stop",
        scoreAnchorV2: null,
        scoreAnchorDiagnostic: "score_anchor_fact_binding_failed"
      });
    }
  });

  it("[REQ-05][REQ-15][ANCHOR-INVALID-SUBJECT] fails closed in fresh Unified and Incoming assembly", async () => {
    const { calculateUnifiedWalletRisk } = await import("../../src/risk/unifiedWalletRisk");
    const { calculateUnifiedIncomingDepositRisk } = await import("../../src/risk/unifiedIncomingDepositRisk");
    const invalidSubject = "not-a-tron-address";
    const sourcePolicyEvidence = {
      kind: "htx_huobi",
      aggregateShare: 0.5,
      effectiveShare: 0.5,
      pathCount: 1,
      score: 45,
      riskBand: "MEDIUM",
      proofLevel: "exchange_policy_context",
      canBeDampened: false,
      reasons: ["typed context"],
      warnings: [],
      evidenceIds: ["where:invalid-subject-policy"]
    };
    const whereReport = {
      subjectAddress: invalidSubject,
      scoreValid: true,
      scoreBlockedReason: null,
      technicalStatus: "completed",
      currentUsdtBalanceRaw: "1000000",
      fastWalletRisk: null,
      balanceFormingTransfers: [],
      originPaths: [],
      senderInteractionProfiles: [],
      approvalDrainProvenanceProfiles: [],
      assessment: {
        scoreValid: true,
        riskScore: 45,
        hardBadEvidence: [],
        sourcePolicyEvidence: [sourcePolicyEvidence],
        contractSuspicionEvidence: [],
        unknownOriginEvidence: [],
        riskLayers: [],
        warnings: []
      },
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      proofLevel: "exchange_policy_context",
      riskScore: 45,
      decisionReasons: ["typed context"],
      coverage: { partial: false, notes: [] }
    } as any;

    const unified = calculateUnifiedWalletRisk({
      address: invalidSubject,
      fastReport: null,
      deepReport: null,
      whereReport
    });
    const incoming = calculateUnifiedIncomingDepositRisk({
      senderAddress: invalidSubject,
      receiverAddress: SUBJECT,
      txHash: "f".repeat(64),
      amountRaw: "1000000",
      timestamp: NOW,
      fastSenderRisk: null,
      senderStablecoinState: null,
      whereReport
    });

    for (const result of [unified, incoming]) {
      expect(result).toMatchObject({
        finalScore: null,
        finalDecision: "NO_FINAL_DECISION",
        scoreValid: false,
        decisionBasis: "technical_stop",
        scoreAnchorV2: null,
        scoreAnchorDiagnostic: "score_anchor_fact_binding_failed"
      });
    }
  });

  it("[REQ-15][INCOMING-BINDING] keeps the complete canonical binding in the saved Incoming summary", async () => {
    const { incomingUnifiedRiskSummary } = await import("../../src/risk/unifiedIncomingDepositRisk");
    const canonical = {
      scoreAnchorV2: validAnchor(),
      narrativeFactsV2: validFacts(),
      scoringEvidenceV2: validEvidence(),
      scoreAnchorDiagnostic: null
    };
    const summary = incomingUnifiedRiskSummary({
      finalScore: 95,
      finalLevel: "CRITICAL",
      finalDecision: "DECLINE",
      observedContextScore: 20,
      scoreValid: true,
      decisionBasis: "exact_hard_proof",
      coverage: { required: "valid", overall: "complete", invalidModes: [], caveats: [] },
      matrixScore: validMatrix(),
      hardEvidenceFloor: 95,
      policyFloor: 0,
      assetContinuationFloor: 0,
      patternFloor: 0,
      dampener: 0,
      scoreBreakdown: { activeAnchor: null },
      ...canonical
    } as any);

    expect(summary).toMatchObject(canonical);
  });

  it("[REQ-04][REQ-15][WHERE-BINDING] creates a subject-bound Where anchor and fails closed without dominant evidence", async () => {
    const { bindFreshWhereScoreResultV2 } = await import("../../src/check/whereIsMoneyCheck");
    const dominantRiskLayer = {
      evidenceClass: "source_policy",
      kind: "aggregate_source_policy",
      score: 45,
      rawScore: 45,
      adjustedScore: 45,
      proofLevel: "exchange_policy_context",
      canBeDampened: false,
      reasons: [],
      warnings: [],
      evidenceIds: ["where:source-policy"]
    };
    const fresh = {
      subjectAddress: SUBJECT,
      scoreValid: true,
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 45,
      assessment: {
        scoreValid: true,
        riskScore: 45,
        dominantRiskLayer
      },
      coverage: { partial: false, notes: [] }
    } as any;

    const bound = bindFreshWhereScoreResultV2(fresh);
    expect(bound).toMatchObject({
      scoreValid: true,
      userDecision: "REVIEW",
      scoreAnchorV2: {
        policyVersion: "scoring-signal-matrix-v3",
        subjectAddress: SUBJECT,
        mode: "where",
        score: 45,
        decision: "REVIEW",
        matrixRow: "source_policy"
      },
      scoreAnchorDiagnostic: null
    });

    expect(bindFreshWhereScoreResultV2({
      ...fresh,
      userDecision: "ACCEPTABLE",
      internalDecision: "ACCEPTABLE"
    })).toMatchObject({
      scoreValid: true,
      userDecision: "REVIEW",
      scoreAnchorV2: { decision: "REVIEW", matrixRow: "source_policy" },
      scoreAnchorDiagnostic: null
    });

    expect(bindFreshWhereScoreResultV2({
      ...fresh,
      assessment: { ...fresh.assessment, dominantRiskLayer: null }
    })).toMatchObject({
      scoreValid: false,
      userDecision: "NO_FINAL_DECISION",
      scoreAnchorV2: null,
      scoreAnchorDiagnostic: "score_anchor_fact_binding_failed"
    });

    expect(bindFreshWhereScoreResultV2({
      ...fresh,
      riskScore: 70,
      assessment: { ...fresh.assessment, riskScore: 70 }
    })).toMatchObject({
      scoreValid: false,
      userDecision: "NO_FINAL_DECISION",
      scoreAnchorV2: null,
      scoreAnchorDiagnostic: "score_anchor_fact_binding_failed"
    });

    expect(bindFreshWhereScoreResultV2({
      ...fresh,
      subjectAddress: "not-a-tron-address"
    })).toMatchObject({
      scoreValid: false,
      userDecision: "NO_FINAL_DECISION",
      scoreAnchorV2: null,
      scoreAnchorDiagnostic: "score_anchor_fact_binding_failed"
    });
  });

  it("[REQ-05] keeps contract safety separate from ordinary transfer scoring", async () => {
    const { buildScoreAnchorV2 } = await import("../../src/risk/scoreAnchorV2");
    const baseInput = {
      address: SUBJECT,
      fastReport: {
        subjectAddress: SUBJECT,
        level: "MEDIUM",
        score: 30,
        reasons: [{ code: "fast_context", message: "typed fast context", scoreImpact: 30 }]
      },
      deepReport: {
        subjectAddress: SUBJECT,
        stablecoinRestrictionProfiles: [{
          subjectAddress: SUBJECT,
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          tokenSymbol: "USDT",
          tokenStandard: "TRC20",
          decimals: 6,
          isBlacklisted: true,
          balanceRaw: "1",
          checkedAt: "2026-07-13T10:00:00.000Z",
          evidenceStrength: "exact_contract_state",
          methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
        }],
        coverage: { transferEdges: 10 }
      },
      whereReport: {
        subjectAddress: SUBJECT,
        assessment: {
          hardBadEvidence: [],
          sourcePolicyEvidence: [{
            kind: "htx_huobi",
            aggregateShare: 0.5,
            effectiveShare: 0.5,
            pathCount: 1,
            score: 45,
            riskBand: "MEDIUM",
            proofLevel: "source_policy_review",
            canBeDampened: false,
            reasons: ["typed where context"],
            warnings: [],
            evidenceIds: ["where:policy"]
          }],
          riskLayers: []
        },
        coverage: { partial: false }
      }
    } as any;
    const withoutContract = buildWalletMatrixCandidates(baseInput);
    const withContract = buildWalletMatrixCandidates({
      ...baseInput,
      smartContractReport: {
        subjectAddress: SUBJECT,
        serviceLabel: null,
        limitations: [],
        verify20Fingerprint: {
          matched: true,
          blockedByTrustedService: false,
          missingSelectors: [],
          mismatchedSelectors: []
        }
      }
    } as any);

    expect(withoutContract.map((candidate) => candidate.row)).toEqual(expect.arrayContaining([
      "behavior_only_prior",
      "subject_restriction",
      "source_policy"
    ]));
    for (const candidate of withoutContract) {
      expect(withContract).toContainEqual(candidate);
    }
    expect(withContract).toEqual(expect.arrayContaining([
      expect.objectContaining({
        row: "contract_suspicion",
        atomicSignals: ["exact_verify20_contract_pattern"]
      })
    ]));

    const contractCandidate = matrixCandidate({
      row: "contract_suspicion",
      actionUnit: "wallet",
      score: 85,
      atomicSignals: ["exact_verify20_contract_pattern"],
      modifiers: ["direct_contract_subject_anchor"],
      authority: { kind: "pattern", decisionEligibility: "can_decline", coverageDependency: "none" },
      evidenceClass: "pattern",
      proofLevel: "corroborated_pattern"
    });
    const result = buildScoreAnchorV2({
      mode: "contract",
      subjectAddress: SUBJECT,
      disposition: validDisposition({
        finalScore: 85,
        decisionBasis: "independent_policy",
        decisiveCandidate: contractCandidate
      }),
      matrix: validMatrix(contractCandidate),
      facts: validFacts().map((fact) => ({
        ...fact,
        id: "fact:contract",
        mode: "contract",
        kind: "verify20_fingerprint",
        factTextKey: "score.contract_suspicion.exact_verify20_contract_pattern"
      }))
    } as any);

    expect(result.anchor).toMatchObject({
      score: 85,
      mode: "contract",
      matrixRow: "contract_suspicion"
    });
    expect(result.anchor).not.toMatchObject({ mode: "unified" });
  });

  it("[REQ-17] preserves a material relationship with a currently blacklisted counterparty", async () => {
    const counterparty = "TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK";
    const principalTxHash = "1".repeat(64);
    const gasFreeFeeTxHash = "2".repeat(64);
    const dustTxHash = "3".repeat(64);
    const blacklistEventTxHash = "4".repeat(64);
    const whereReport = {
      subjectAddress: SUBJECT,
      assessment: { hardBadEvidence: [], sourcePolicyEvidence: [], riskLayers: [] },
      coverage: { partial: false }
    } as any;
    for (const temporalRelation of ["became_active_after", "active_at_transfer", "unknown"] as const) {
      const effectiveAt = temporalRelation === "active_at_transfer"
        ? "2026-07-13T07:00:00.000Z"
        : temporalRelation === "became_active_after"
          ? "2026-07-13T09:00:00.000Z"
          : null;
      const fact = {
        counterpartyAddress: counterparty,
        direction: "outbound",
        evidenceKind: "usdt_blacklist",
        evidenceAuthority: "official_contract",
        statusAtCheck: "active",
        temporalRelation,
        effectiveAt,
        effectiveTxHash: temporalRelation === "unknown" ? null : blacklistEventTxHash,
        checkedAt: NOW.toISOString(),
        principalAmountRaw: "10000000000",
        principalTxCount: 1,
        directionalPrincipalShare: temporalRelation === "unknown" ? null : 1,
        shareSemantics: temporalRelation === "unknown" ? "unavailable" : "exact",
        ...(temporalRelation === "unknown" ? {} : { directionalPrincipalTotalRaw: "10000000000" }),
        transferTxHashes: [principalTxHash],
        beforeEffectiveAmountRaw: temporalRelation === "became_active_after" ? "10000000000" : "0",
        beforeEffectiveTxCount: temporalRelation === "became_active_after" ? 1 : 0,
        activeAmountRaw: temporalRelation === "active_at_transfer" ? "10000000000" : "0",
        activeTxCount: temporalRelation === "active_at_transfer" ? 1 : 0,
        unknownTimingAmountRaw: temporalRelation === "unknown" ? "10000000000" : "0",
        unknownTimingTxCount: temporalRelation === "unknown" ? 1 : 0,
        directTransferCoverage: temporalRelation === "unknown" ? "partial" : "complete",
        timelineCoverage: temporalRelation === "unknown" ? "partial" : "complete",
        timelineEvents: temporalRelation === "unknown" ? [] : [{
          eventKind: "added",
          occurredAt: effectiveAt!,
          txHash: blacklistEventTxHash,
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          blockNumber: 1,
          logIndex: 0,
          verification: "verified_contract_log"
        }]
      };
      const transfers = [{
          txHash: principalTxHash,
          fromAddress: SUBJECT,
          toAddress: counterparty,
          amountRaw: "10000000000",
          timestamp: "2026-07-13T08:00:00.000Z",
          method: "transfer",
          edgeType: "normal_transfer",
          economicRole: "principal"
        }];
      const candidates = buildWalletMatrixCandidates({
        address: SUBJECT,
        fastReport: null,
        whereReport,
        deepReport: {
          subjectAddress: SUBJECT,
          firstHopBlacklistFacts: [fact],
          directCounterpartyInteractionProfiles: [{
            subjectAddress: SUBJECT,
            direction: "outbound",
            counterpartyAddress: counterparty,
            volumeRaw: "10000000000",
            volumeRatio: 1,
            txCount: 1,
            firstSeen: "2026-07-13T08:00:00.000Z",
            lastSeen: "2026-07-13T08:00:00.000Z",
            txHashes: [principalTxHash],
            transfers,
            serviceCategory: null,
            identity: null,
            snapshot: {
              address: counterparty,
              riskScore: 95,
              riskLevel: "CRITICAL",
              source: "stablecoin_blacklist",
              evidenceClass: "exact_labeled_counterparty",
              reasons: [],
              partialNotes: []
            },
            interactionWeight: 0.95,
            scoreContribution: 90,
            evidenceClass: "exact_labeled_counterparty",
            skippedReason: null
          }],
          coverage: { transferEdges: 20 }
        }
      } as any);
      const policy = candidates.find((candidate) => candidate.row === "direct_counterparty_policy");
      if (temporalRelation === "active_at_transfer") {
        expect(policy).toMatchObject({
          score: 90,
          row: "direct_counterparty_policy",
          authority: { kind: "policy", decisionEligibility: "can_decline", coverageDependency: "none" },
          modifiers: expect.arrayContaining(["blacklist_timing_active_at_transfer"])
        });
        expect(policy?.evidenceIds).toContain(principalTxHash);
        expect(policy?.evidenceIds).not.toContain(gasFreeFeeTxHash);
        expect(policy?.evidenceIds).not.toContain(dustTxHash);
      } else {
        expect(policy, temporalRelation).toBeUndefined();
      }
    }
  });
});
