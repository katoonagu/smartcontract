import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const SUBJECT = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const CONTRACT = "TXka46PPwttNPWfFDPtt3GUodbPThyufaV";
const NOW = new Date("2026-07-13T10:00:00.000Z");
const LEGACY_SCORE = 91;
const LEGACY_REASON = "LEGACY_MODEL_REASON_MUST_NOT_ESCAPE";
const LEGACY_WHERE_REASON = "LEGACY_WHERE_REASON_MUST_NOT_ESCAPE";
const LEGACY_INCOMING_REASON = "LEGACY_INCOMING_REASON_MUST_NOT_ESCAPE";
const DETERMINISTIC_MODEL_TOKEN_REASON = "Deterministic policy: DeepSeek and legitimate_service labels do not alter exact evidence.";
const LEGACY_CITATION = "legacy-citation-must-not-escape";

type AnyFunction = (...args: any[]) => any;

function requiredFunction(module: Record<string, unknown>, name: string): AnyFunction {
  expect(module[name], `${name} must be implemented`).toBeTypeOf("function");
  return module[name] as AnyFunction;
}

async function smartContractModule(): Promise<Record<string, unknown>> {
  return vi.importActual<Record<string, unknown>>("../../src/check/smartContractCheck");
}

async function contractDecisionModule(): Promise<Record<string, unknown>> {
  return vi.importActual<Record<string, unknown>>("../../src/forensics/contractDecision");
}

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: SUBJECT,
    source: "tronscan",
    name: null,
    tag: null,
    isContract: true,
    verified: false,
    accountType: null,
    rawJson: {},
    fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...overrides
  };
}

function contractProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractAddress: SUBJECT,
    providerTags: [],
    publicTags: [],
    isVerified: false,
    verifyStatus: null,
    sourceStatus: "missing",
    contractCreatedAt: null,
    contractAgeDays: null,
    txCount: "1",
    recentCallCount: null,
    totalCallCount: "1",
    totalCallerCount: "1",
    topMethods: [],
    topCallers: [],
    methodMap: {},
    providerRisk: false,
    rawPayload: {},
    fetchedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    address: SUBJECT,
    source: "tronscan",
    name: null,
    serviceTag: null,
    publicTag: null,
    publicTagDesc: null,
    tagUrl: null,
    verified: false,
    trxCount: "1",
    uniqueCallerCount: "1",
    hasTransferFromSelector: false,
    hasOwnerOnlyPattern: false,
    lowMetadata: true,
    activityLevel: "low",
    rawJson: {},
    ...overrides
  };
}

function unknownSmartInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: SUBJECT,
    metadata: metadata(),
    contractProfile: contractProfile(),
    serviceClassification: null,
    relatedApprovals: [],
    ...overrides
  };
}

function unknownDecisionInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subjectAddress: SUBJECT,
    metadata: metadata(),
    contractProfile: contractProfile(),
    serviceClassification: null,
    approvalSafetyAssessments: [],
    evidence: [{
      id: "metadata:subject",
      kind: "metadata_context",
      subjectAddress: SUBJECT,
      spenderAddress: null,
      tokenContract: null
    }],
    ...overrides
  };
}

function contractBearingTransfer() {
  return {
    id: "contract-bearing-transfer",
    txHash: "contract-bearing-transfer",
    fromAddress: CONTRACT,
    toAddress: SUBJECT,
    amountRaw: "1000000",
    timestamp: new Date("2026-07-13T09:55:00.000Z"),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function contractClassification() {
  return {
    category: "unknown_contract",
    identity: null,
    confidence: "high",
    evidence: ["metadata:is_contract"],
    isBoundary: false
  };
}

function stablecoinProfile(address: string, balanceRaw = "1000000") {
  return {
    subjectAddress: address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: false,
    balanceRaw,
    checkedAt: NOW.toISOString(),
    evidenceStrength: "exact_contract_state",
    methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
  };
}

function concreteJob(
  kind: "address_deep_check" | "incoming_deposit_check" | "where_is_money_check",
  subjectAddress: string,
  progressJson: Record<string, unknown>
) {
  return {
    id: `contract-llm-${kind}`,
    kind,
    subjectAddress,
    status: "running",
    windowStart: new Date("2026-07-12T10:00:00.000Z"),
    windowEnd: NOW,
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: "contract-llm-acceptance",
    progressJson,
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-07-13T09:50:00.000Z"),
    updatedAt: new Date("2026-07-13T09:50:00.000Z"),
    startedAt: new Date("2026-07-13T09:50:00.000Z"),
    completedAt: null
  };
}

function automaticRuntimeSpies() {
  const provider = vi.fn(async (_caseFiles: unknown[]) => { throw new Error("automatic provider must not run"); });
  const cache = vi.fn(async (_caseFiles: unknown[]) => { throw new Error("automatic cache must not be read"); });
  const analyzer = vi.fn(async (caseFiles: unknown[]) => {
    await Promise.all([provider(caseFiles), cache(caseFiles)]);
    return [];
  });
  return { provider, cache, analyzer };
}

function legacyVerdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "llm",
    cacheMatch: null,
    reusedFromContractAddress: null,
    providerLabel: "legacy-provider-do-not-render",
    model: "legacy-model-do-not-render",
    contractAddress: SUBJECT,
    caseFileHash: "legacy-case-file",
    cacheId: "legacy-cache-id",
    verdict: "drainer_like",
    confidence: 0.99,
    contractRiskScore: LEGACY_SCORE,
    decisionRecommendation: "DECLINE",
    reasons: [LEGACY_REASON],
    citedEvidenceIds: [LEGACY_CITATION],
    falsePositiveNotes: [],
    ...overrides
  };
}

function freshPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return legacyVerdict({
    source: "llm",
    cacheId: null,
    providerLabel: "fresh-provider-must-not-run",
    model: "fresh-model-must-not-run",
    ...overrides
  });
}

function expectFreshSmart(result: any): void {
  expect.soft(result.llmVerdict).toBeNull();
  expect.soft(result.contractDecisionV2).toMatchObject({
    finalSource: "deterministic",
    llm: null
  });
}

function expectUnknownDecision(result: any): void {
  expect.soft(result).toMatchObject({
    finalSource: "deterministic",
    llm: null,
    deterministic: {
      score: 35,
      level: "MEDIUM",
      decision: "REVIEW",
      authority: "context",
      evidenceIds: ["metadata:subject"]
    }
  });
}

function expectNoModelMaterial(value: unknown, forbidden: string[]): void {
  const serialized = JSON.stringify(value);
  for (const marker of forbidden) expect.soft(serialized).not.toContain(marker);
}

async function legacySmartReport(reason = LEGACY_REASON): Promise<Record<string, unknown>> {
  const module = await smartContractModule();
  const evaluate = requiredFunction(module, "evaluateSmartContractAddress");
  const baseline = evaluate({
    subjectAddress: SUBJECT,
    metadata: metadata(),
    contractProfile: contractProfile(),
    relatedApprovals: [],
    llmVerdict: null
  });
  return {
    ...baseline,
    decision: "DECLINE",
    riskScore: LEGACY_SCORE,
    riskLevel: "CRITICAL",
    reasons: [reason],
    contractDecisionV2: {
      finalSource: "llm",
      llm: legacyVerdict({ reasons: [reason] }),
      deterministic: {
        score: LEGACY_SCORE,
        level: "CRITICAL",
        decision: "DECLINE",
        authority: "context",
        evidenceIds: [LEGACY_CITATION]
      }
    },
    llmVerdict: legacyVerdict({ reasons: [reason] })
  };
}

function legacyWhereReport(): Record<string, unknown> {
  const suspicion = {
    kind: "contract_llm_suspicion",
    score: LEGACY_SCORE,
    rawScore: LEGACY_SCORE,
    adjustedScore: LEGACY_SCORE,
    evidenceClass: "contract_suspicion",
    proofLevel: "llm_assisted_suspicion",
    canBeDampened: true,
    reasons: [LEGACY_WHERE_REASON],
    warnings: [],
    evidenceIds: [LEGACY_CITATION]
  };
  return {
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    subjectAddress: SUBJECT,
    currentUsdtBalanceRaw: "0",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [legacyVerdict({ reasons: [LEGACY_WHERE_REASON] })],
    assessment: {
      scoreValid: true,
      scoreBlockedReason: null,
      technicalStatus: "completed",
      decision: "REVIEW",
      riskScore: LEGACY_SCORE,
      riskBand: "CRITICAL",
      provenanceConfidence: 100,
      coverageCompleteness: 100,
      walletRole: "unknown_wallet",
      operationalLiquidityScore: 0,
      ageSignals: null,
      hardBadEvidence: [],
      sourcePolicyEvidence: [],
      contractSuspicionEvidence: [suspicion],
      unknownOriginEvidence: [],
      riskLayers: [suspicion],
      dominantRiskLayer: suspicion,
      reasons: [LEGACY_WHERE_REASON],
      warnings: []
    },
    decision: "DECLINE",
    userDecision: "DECLINE",
    internalDecision: "DECLINE",
    proofLevel: "llm_assisted_suspicion",
    riskScore: LEGACY_SCORE,
    decisionReasons: [LEGACY_WHERE_REASON],
    coverage: {
      selectedInboundTxCount: 0,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 0,
      maxDepth: 7,
      fetchedAddressCount: 1,
      partial: false,
      notes: []
    }
  };
}

function whereJob(report: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "legacy-where-job",
    kind: "where_is_money_check",
    subjectAddress: SUBJECT,
    status: "completed",
    windowStart: new Date("2026-07-01T00:00:00.000Z"),
    windowEnd: NOW,
    progressJson: { locale: "en" },
    resultJson: { subjectAddress: SUBJECT, whereIsMoneyReport: report }
  };
}

function incomingReport(): Record<string, unknown> {
  return {
    decision: "DECLINE",
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    depositRiskScore: LEGACY_SCORE,
    observedContextScore: LEGACY_SCORE,
    riskBand: "CRITICAL",
    fastSenderRisk: null,
    originPaths: [],
    originCoverage: 1,
    fundingCoverage: {
      depositFundingCoverageRatio: 1,
      cleanSourceCoverageRatio: 0,
      exactContinuityCoverageRatio: 1
    },
    corridorSummary: null,
    provenanceConfidence: 100,
    dataQuality: "high",
    senderRole: "unknown_wallet",
    hardBadEvidence: [],
    contractVerdicts: [legacyVerdict({ reasons: [LEGACY_INCOMING_REASON] })],
    reasons: [DETERMINISTIC_MODEL_TOKEN_REASON],
    warnings: []
  };
}

async function readLegacyAuditRecord(): Promise<{
  audit: Record<string, any>;
  query: ReturnType<typeof vi.fn>;
  storedVerdict: Record<string, unknown>;
  storedResponse: Record<string, unknown>;
}> {
  const repositories = await vi.importActual<Record<string, unknown>>("../../src/storage/repositories");
  const readAudit = requiredFunction(repositories, "getContractLlmVerdictCache");
  const storedVerdict = legacyVerdict();
  const storedResponse = {
    verdict: storedVerdict.verdict,
    contractRiskScore: storedVerdict.contractRiskScore,
    decisionRecommendation: storedVerdict.decisionRecommendation,
    reasons: storedVerdict.reasons,
    citedEvidenceIds: storedVerdict.citedEvidenceIds
  };
  const query = vi.fn(async () => ({
    rows: [{
      id: "legacy-cache-id",
      contract_address: SUBJECT,
      profile_hash: "legacy-profile",
      contract_fingerprint_hash: "legacy-fingerprint",
      cache_scope: "address_flow",
      flow_context_hash: "legacy-flow",
      case_file_hash: "legacy-case-file",
      policy_version: "legacy-policy",
      provider_label: "legacy-provider-do-not-render",
      model: "legacy-model-do-not-render",
      verdict_json: structuredClone(storedVerdict),
      request_case_hash: "legacy-case-file",
      response_json: structuredClone(storedResponse),
      error: null,
      latency_ms: 25,
      created_at: NOW,
      expires_at: new Date(NOW.getTime() + 60_000),
      updated_at: NOW
    }]
  }));
  const audit = await readAudit({ query }, {
    contractAddress: SUBJECT,
    profileHash: "legacy-profile",
    cacheScope: "address_flow",
    flowContextHash: "legacy-flow",
    policyVersion: "legacy-policy",
    model: "legacy-model-do-not-render",
    now: NOW
  });
  expect(audit).not.toBeNull();
  return { audit, query, storedVerdict, storedResponse };
}

describe("automatic contract LLM isolation acceptance", () => {
  it("[AC-34][LLM-DISABLED] ignores every fresh LLM score payload", async () => {
    const module = await smartContractModule();
    const check = requiredFunction(module, "checkSmartContractAddress");
    const baseline = await check(unknownSmartInput());
    const scorePayloads = [
      { contractRiskScore: 35.5 },
      { contractRiskScore: Number.NaN },
      { contractRiskScore: Number.POSITIVE_INFINITY },
      { contractRiskScore: 35 },
      { contractRiskScore: -1 },
      { contractRiskScore: 101 },
      {}
    ];
    const analyzers: ReturnType<typeof vi.fn>[] = [];

    for (const payload of scorePayloads) {
      const analyzer = vi.fn(async () => [freshPayload(payload)]);
      analyzers.push(analyzer);
      const result = await check(unknownSmartInput({ analyzeContractLlmCaseFiles: analyzer }));
      expect.soft(result).toEqual(baseline);
      expectFreshSmart(result);
    }

    expect.soft(analyzers.reduce((sum, analyzer) => sum + analyzer.mock.calls.length, 0)).toBe(0);
    expectFreshSmart(baseline);
  });

  it("[AC-35][LLM-DISABLED] ignores every verdict and recommendation payload", async () => {
    const module = await smartContractModule();
    const check = requiredFunction(module, "checkSmartContractAddress");
    const baseline = await check(unknownSmartInput());
    const payloads = [
      freshPayload({ verdict: "legitimate_service", decisionRecommendation: "ACCEPTABLE", contractRiskScore: 0 }),
      freshPayload({ verdict: "drainer_like", decisionRecommendation: "DECLINE", contractRiskScore: 99 }),
      freshPayload({ verdict: "unknown_insufficient_data", decisionRecommendation: "DECLINE", contractRiskScore: 65 }),
      freshPayload({ verdict: "legitimate_service", decisionRecommendation: "DECLINE", contractRiskScore: 95 })
    ];
    const analyzers: ReturnType<typeof vi.fn>[] = [];

    for (const payload of payloads) {
      const analyzer = vi.fn(async () => [payload]);
      analyzers.push(analyzer);
      const result = await check(unknownSmartInput({ analyzeContractLlmCaseFiles: analyzer }));
      expect.soft(result).toEqual(baseline);
      expectFreshSmart(result);
      expectNoModelMaterial(result, [String(payload.verdict), String(payload.decisionRecommendation), LEGACY_REASON]);
    }

    expect.soft(analyzers.reduce((sum, analyzer) => sum + analyzer.mock.calls.length, 0)).toBe(0);
  });

  it("[AC-36][LLM-LEGACY] keeps cached citations as audit-only payload", async () => {
    const { audit, query, storedVerdict, storedResponse } = await readLegacyAuditRecord();

    expect(audit.verdict).toEqual(storedVerdict);
    expect(audit.responseJson).toEqual(storedResponse);
    expect(audit.verdict.citedEvidenceIds).toEqual([LEGACY_CITATION]);

    const module = await contractDecisionModule();
    const resolve = requiredFunction(module, "resolveContractDecisionV2");
    const result = resolve(unknownDecisionInput({ legacyLlmAudit: audit }));

    expectUnknownDecision(result);
    expectNoModelMaterial(result, [LEGACY_CITATION, LEGACY_REASON, "legacy-cache-id"]);
    expect.soft(JSON.stringify(result.deterministic.evidenceIds)).not.toContain(LEGACY_CITATION);
    expect.soft(query).toHaveBeenCalledTimes(1);
  });

  it("[AC-37][LLM-DISABLED] keeps risky or uncited legacy verdict out of fresh decisions", async () => {
    const module = await contractDecisionModule();
    const resolve = requiredFunction(module, "resolveContractDecisionV2");
    const baseline = resolve(unknownDecisionInput());
    const legacyVariants = [
      undefined,
      legacyVerdict(),
      legacyVerdict({ citedEvidenceIds: [] }),
      { verdict: 7, contractRiskScore: "not-a-score", citedEvidenceIds: LEGACY_CITATION }
    ];

    for (const legacyLlmAudit of legacyVariants) {
      const result = resolve(unknownDecisionInput({ legacyLlmAudit }));
      expect.soft(result).toEqual(baseline);
      expectUnknownDecision(result);
      expectNoModelMaterial(result, [LEGACY_CITATION, LEGACY_REASON, "legacy-cache-id"]);
    }
  });

  it("[AC-38][LLM-NOCALL] makes zero provider calls for timeout JSON and schema scenarios", async () => {
    const module = await smartContractModule();
    const check = requiredFunction(module, "checkSmartContractAddress");
    const baseline = await check(unknownSmartInput());
    const analyzers = [
      vi.fn(async () => { throw new Error("provider timeout"); }),
      vi.fn(async () => [{ json: "not-json" }]),
      vi.fn(async () => [{ verdict: "invalid-schema", contractRiskScore: "65" }])
    ];

    for (const analyzer of analyzers) {
      const result = await check(unknownSmartInput({ analyzeContractLlmCaseFiles: analyzer }));
      expect.soft(result).toEqual(baseline);
      expectFreshSmart(result);
    }

    expect.soft(analyzers.reduce((sum, analyzer) => sum + analyzer.mock.calls.length, 0)).toBe(0);
    expectFreshSmart(baseline);
  });

  it("[REQ-25][REQ-26][LLM-LEGACY] never reads legacy LLM into scoring decision or presentation input", async () => {
    const smart = await smartContractModule();
    const normalize = requiredFunction(smart, "normalizeSmartContractCheckReport");
    const projectedSmart = normalize(await legacySmartReport(), SUBJECT);

    expect.soft(projectedSmart).toBeNull();
    expectNoModelMaterial(projectedSmart, [String(LEGACY_SCORE), LEGACY_REASON, LEGACY_CITATION, "legacy-cache-id"]);

    const module = await contractDecisionModule();
    const resolve = requiredFunction(module, "resolveContractDecisionV2");
    const baseline = resolve(unknownDecisionInput());
    const result = resolve(unknownDecisionInput({
      legacyLlmAudit: legacyVerdict(),
      scoreLayers: [legacyVerdict()],
      narrativeFacts: [LEGACY_REASON],
      telegramProjection: legacyVerdict()
    }));

    expect.soft(result).toEqual(baseline);
    expectUnknownDecision(result);
    expectNoModelMaterial(result, [String(LEGACY_SCORE), LEGACY_REASON, LEGACY_CITATION, "legacy-cache-id"]);
  });

  it("[AC-39][REQ-25][LLM-LEGACY][TELEGRAM] fails closed for untyped legacy Alert payloads", async () => {
    const [smart, bot, alerts] = await Promise.all([
      smartContractModule(),
      vi.importActual<Record<string, unknown>>("../../src/bot/createBot"),
      vi.importActual<Record<string, unknown>>("../../src/alerts/formatters")
    ]);
    const normalizeSmart = requiredFunction(smart, "normalizeSmartContractCheckReport");
    const extractWhere = requiredFunction(bot, "extractWhereIsMoneyReportFromJob");
    const formatIncoming = requiredFunction(alerts, "formatIncomingDepositRiskAlert");
    const smartProjection = normalizeSmart(await legacySmartReport(), SUBJECT);
    const storedWhere = legacyWhereReport();
    const storedWhereBefore = structuredClone(storedWhere);
    const storedIncoming = incomingReport();
    const storedIncomingBefore = structuredClone(storedIncoming);
    const job = whereJob(storedWhere);
    const whereProjection = extractWhere(job, SUBJECT);

    expect.soft(smartProjection).toBeNull();
    expect.soft(whereProjection).toBeNull();

    const rendered = formatIncoming({
        jobId: "legacy-incoming-job",
        amount: "35",
        watchedWallet: SUBJECT,
        sender: SUBJECT,
        txHash: "legacy-incoming-tx",
        locale: "en",
        report: storedIncoming
      }).text;

    for (const forbidden of [
      LEGACY_REASON,
      LEGACY_WHERE_REASON,
      LEGACY_INCOMING_REASON,
      LEGACY_CITATION,
      "drainer_like"
    ]) {
      expect.soft(rendered).not.toContain(forbidden);
    }
    expect.soft(rendered).toContain(`https://tronscan.org/#/address/${SUBJECT}`);
    expect.soft(rendered).toContain("Final score was not calculated");
    expect.soft(rendered).not.toContain(`${LEGACY_SCORE}/100`);
    expect.soft(rendered).not.toContain("DECLINE");
    expect.soft(rendered).not.toContain(DETERMINISTIC_MODEL_TOKEN_REASON);
    expect.soft(rendered).not.toMatch(/AI contract verdict|AI-оценка контракта/i);
    expect.soft(storedWhere).toEqual(storedWhereBefore);
    expect.soft(storedIncoming).toEqual(storedIncomingBefore);
  });

  it("[AC-40][LLM-NOCALL] bypasses Flash and Pro for unknown and ambiguous contracts", async () => {
    const module = await smartContractModule();
    const check = requiredFunction(module, "checkSmartContractAddress");
    const { provider, cache, analyzer } = automaticRuntimeSpies();
    const cases = [
      unknownSmartInput(),
      unknownSmartInput({
        metadata: metadata({ name: "Maybe Router", tag: "Ambiguous contract metadata" }),
        contractProfile: contractProfile({ name: "Maybe Router", lowMetadata: true })
      })
    ];

    for (const input of cases) {
      const result = await check({ ...input, analyzeContractLlmCaseFiles: analyzer });
      expectFreshSmart(result);
      expect.soft(result.contractDecisionV2?.deterministic).toEqual({
        score: 35,
        level: "MEDIUM",
        decision: "REVIEW",
        authority: "context",
        evidenceIds: ["metadata:subject"]
      });
    }
    expect.soft(provider).not.toHaveBeenCalled();
    expect.soft(cache).not.toHaveBeenCalled();
    expect.soft(analyzer).not.toHaveBeenCalled();
  });

  it("[REQ-25][WHERE-NOOP-PROFILE] does not fetch an unused contract profile for a traced candidate", async () => {
    const where = await vi.importActual<Record<string, unknown>>("../../src/check/whereIsMoneyCheck");
    const runWhere = requiredFunction(where, "runWhereIsMoneyCheck");
    const edge = contractBearingTransfer();
    const profileLookup = vi.fn(async () => contractProfile({
      contractAddress: CONTRACT,
      address: CONTRACT
    }));

    const result = await runWhere({
      getTrc20Balance: async () => "1000000",
      fetchEdgesForAddress: async (address: string) => address === SUBJECT ? [edge] : [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async (address: string) =>
        address === CONTRACT ? contractClassification() : null,
      getContractIntelligenceProfile: profileLookup
    }, {
      sourceAddress: SUBJECT,
      windowStart: new Date("2026-07-12T10:00:00.000Z"),
      windowEnd: NOW,
      maxDepth: 2,
      maxAddressFetches: 5,
      recentFallbackMinTransferCount: 0,
      approvalEnrichmentMode: "off"
    });

    expect(profileLookup).not.toHaveBeenCalled();
    expect(result.balanceFormingTransfers).toEqual(expect.arrayContaining([
      expect.objectContaining({ txHash: edge.txHash, fromAddress: CONTRACT, toAddress: SUBJECT })
    ]));
    expect(result.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pathAddresses: expect.arrayContaining([CONTRACT]),
        txHashes: expect.arrayContaining([edge.txHash])
      })
    ]));
    expect(result.contractLlmVerdicts).toEqual([]);
  });

  it("[REQ-25][LLM-NOCALL][ORCHESTRATION] removes automatic analyzer from Smart Where Incoming Deep and bootstrap wiring", async () => {
    const [smart, where, incoming, deep, fixtures] = await Promise.all([
      smartContractModule(),
      vi.importActual<Record<string, unknown>>("../../src/check/whereIsMoneyCheck"),
      vi.importActual<Record<string, unknown>>("../../src/forensics/incomingDepositJob"),
      vi.importActual<Record<string, unknown>>("../../src/forensics/deepForensicJob"),
      vi.importActual<Record<string, unknown>>("../fixtures/forensics/remediationDataCases")
    ]);
    const checkSmart = requiredFunction(smart, "checkSmartContractAddress");
    const runWhere = requiredFunction(where, "runWhereIsMoneyCheck");
    const buildIncoming = requiredFunction(incoming, "buildIncomingDepositReport");
    const runIncomingCycle = requiredFunction(incoming, "runSingleIncomingDepositJobCycle");
    const runDeepCycle = requiredFunction(deep, "runSingleDeepForensicJobCycle");
    const { provider, cache, analyzer } = automaticRuntimeSpies();
    const edge = contractBearingTransfer();
    const profile = contractProfile({
      contractAddress: CONTRACT,
      address: CONTRACT,
      sourceStatus: "missing",
      lowMetadata: true
    });
    const whereClassificationLookup = vi.fn(async (address: string) =>
      address === CONTRACT ? contractClassification() : null
    );
    const whereProfileLookup = vi.fn(async (address: string) =>
      address === CONTRACT ? profile : null
    );
    const smartResult = await checkSmart(unknownSmartInput({
      analyzeContractLlmCaseFiles: analyzer
    }));
    const whereResult = await runWhere({
      getTrc20Balance: async () => "1000000",
      fetchEdgesForAddress: async (address: string) => address === SUBJECT ? [edge] : [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: whereClassificationLookup,
      getContractIntelligenceProfile: whereProfileLookup,
      analyzeContractLlmCaseFiles: analyzer
    }, {
      sourceAddress: SUBJECT,
      windowStart: new Date("2026-07-12T10:00:00.000Z"),
      windowEnd: NOW,
      maxDepth: 2,
      maxAddressFetches: 5,
      recentFallbackMinTransferCount: 0,
      approvalEnrichmentMode: "off"
    });
    const incomingFixture = fixtures.incomingCoverageFixture as {
      deps: Record<string, unknown>;
    };
    const incomingDepositTxHash = "incoming-contract-deposit";
    const incomingJob = {
      ...concreteJob("incoming_deposit_check", CONTRACT, {
        depositTxHash: incomingDepositTxHash,
        watchedWallet: SUBJECT,
        watchedWalletId: "incoming-wallet-id",
        sender: CONTRACT,
        amount: "1",
        amountRaw: "1000000",
        timestamp: edge.timestamp.toISOString(),
        telegramUserId: "incoming-user",
        alertMode: "digest",
        locale: "en"
      }),
      chatId: "incoming-user"
    };
    const incomingClassificationLookup = vi.fn(async (address: string) =>
      address === CONTRACT ? contractClassification() : null
    );
    const incomingProfileLookup = vi.fn(async (address: string) =>
      address === CONTRACT ? profile : null
    );
    const incomingRuntimeDeps = {
      ...incomingFixture.deps,
      getClassificationForAddress: incomingClassificationLookup,
      getContractIntelligenceProfile: incomingProfileLookup,
      getUsdtRestrictionStatus: async (address: string) => stablecoinProfile(address),
      analyzeContractLlmCaseFiles: analyzer
    };
    const incomingCompletion = vi.fn(async (_input: Record<string, unknown>) => true);
    const incomingCycleResult = await runIncomingCycle({
      claimNextForensicCheckJob: async () => incomingJob,
      completeForensicCheckJob: incomingCompletion,
      updateForensicCheckJobProgress: async () => true,
      markUserAlertSent: async () => true,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      hasUndismissedAddressPoisoningCandidateForIncoming: async () => false,
      sendUserAlert: async () => undefined,
      formatIncomingDepositRiskAlert: () => ({ text: "unused", parseMode: "HTML" }),
      buildReport: async (cycleInput: Record<string, unknown>) => buildIncoming({
        ...cycleInput,
        deps: incomingRuntimeDeps
      })
    });
    const incomingCompleted = incomingCompletion.mock.calls[0]?.[0] as {
      status: string;
      resultJson: Record<string, unknown>;
    } | undefined;

    const deepJob = concreteJob("address_deep_check", SUBJECT, {
      allTimeDeepCheckMode: "partial"
    });
    const {
      provider: deepProvider,
      cache: deepCache,
      analyzer: deepAnalyzer
    } = automaticRuntimeSpies();
    const deepProfileLookup = vi.fn(async (address: string) => address === CONTRACT ? profile : null);
    const deepCompletion = vi.fn(async (_input: Record<string, unknown>) => true);
    const deepCycleResult = await runDeepCycle({
      ...(fixtures.deepCoverageDeps as Record<string, unknown>),
      tronClient: {
        listRelatedTrc20Transfers: async (address: string) => address === SUBJECT
          ? [{
              transaction_id: edge.txHash,
              from_address: edge.fromAddress,
              to_address: edge.toAddress,
              quant: edge.amountRaw,
              block_ts: edge.timestamp.getTime(),
              confirmed: true,
              contractRet: "SUCCESS",
              contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
            }]
          : []
      },
      listIndexedUsdtTransfersForAddress: undefined,
      getAddressUsdtIndexState: undefined,
      getAddressMetadata: async (address: string) => address === CONTRACT
        ? metadata({ address: CONTRACT, isContract: true })
        : null,
      getContractIntelligenceProfile: deepProfileLookup,
      getUsdtRestrictionStatus: async (address: string) => stablecoinProfile(address),
      claimNextForensicCheckJob: async () => deepJob,
      completeForensicCheckJob: deepCompletion,
      updateForensicCheckJobProgress: async () => true,
      recordRiskEvaluation: async () => undefined,
      analyzeContractLlmCaseFiles: deepAnalyzer
    }, {
      recentFallbackMinTransferCount: 0,
      maxEdgesPerAddress: 5,
      recentFallbackTransferLimit: 5,
      maxExpandedIntermediates: 1,
      metadataFetchLimit: 5,
      contractProfileFetchLimit: 5,
      maxInboundSenders: 1,
      extendedSearchMaxDepth: 2,
      extendedSearchMaxAddressFetches: 5
    });
    const deepCompleted = deepCompletion.mock.calls[0]?.[0] as {
      status: string;
      resultJson: Record<string, unknown>;
    } | undefined;
    const forbidden = /createContractLlmVerdictAnalyzer|analyzeContractLlmCaseFiles|contractLlmVerdictAnalyzer/;
    const activeFiles = [
      "../../src/check/smartContractCheck.ts",
      "../../src/check/whereIsMoneyCheck.ts",
      "../../src/forensics/incomingDepositJob.ts",
      "../../src/forensics/deepForensicJob.ts",
      "../../src/index.ts"
    ];

    expectFreshSmart(smartResult);
    expect(whereClassificationLookup).toHaveBeenCalledWith(CONTRACT);
    expect(whereProfileLookup).not.toHaveBeenCalled();
    expect(whereResult.balanceFormingTransfers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: edge.txHash,
        fromAddress: CONTRACT,
        toAddress: SUBJECT
      })
    ]));
    expect(whereResult.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pathAddresses: expect.arrayContaining([CONTRACT]),
        txHashes: expect.arrayContaining([edge.txHash])
      })
    ]));
    expect.soft(whereResult.originPaths.length).toBeGreaterThan(0);
    expect.soft(whereResult.contractLlmVerdicts).toEqual([]);
    expect.soft(incomingCycleResult).toBe(true);
    expect.soft(incomingCompleted).toMatchObject({ status: "completed" });
    expect.soft(incomingCompleted?.resultJson.contractVerdicts).toEqual([]);
    expect(incomingClassificationLookup).toHaveBeenCalledWith(CONTRACT);
    expect(incomingProfileLookup).not.toHaveBeenCalled();
    expect(incomingCompleted?.resultJson.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pathAddresses: expect.arrayContaining([CONTRACT]),
        txHashes: expect.arrayContaining([incomingDepositTxHash]),
        steps: expect.arrayContaining([
          expect.objectContaining({
            txHash: incomingDepositTxHash,
            fromAddress: CONTRACT,
            toAddress: SUBJECT
          })
        ])
      })
    ]));
    expect.soft(deepCycleResult).toBe(true);
    expect.soft(deepCompleted).toMatchObject({ status: "completed" });
    expect.soft(deepCompleted?.resultJson).toMatchObject({
      subjectAddress: SUBJECT,
      runProfile: "production_full"
    });
    expect(deepCompleted?.resultJson).not.toHaveProperty("whereIsMoneyReport");
    expect(deepProfileLookup).toHaveBeenCalledWith(CONTRACT);
    expect.soft(deepProvider).not.toHaveBeenCalled();
    expect.soft(deepCache).not.toHaveBeenCalled();
    expect.soft(deepAnalyzer).not.toHaveBeenCalled();
    expect.soft(provider).not.toHaveBeenCalled();
    expect.soft(cache).not.toHaveBeenCalled();
    expect.soft(analyzer).not.toHaveBeenCalled();
    for (const file of activeFiles) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      expect.soft(source, file).not.toMatch(forbidden);
    }
  });
});
