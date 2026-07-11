import { afterEach, describe, expect, it } from "vitest";
import { adminConsoleHtml } from "../../src/admin/adminConsole";
import * as adminServerModule from "../../src/admin/adminServer";
import { startAdminServer, type AdminServerDeps } from "../../src/admin/adminServer";
import type { ForensicCheckJob, TheftReport } from "../../src/storage/repositories";
import { SHADOW_SCORING_POLICY_VERSION } from "../../src/risk/shadowScoring";
import { evaluateSmartContractAddress } from "../../src/check/smartContractCheck";

const servers: Array<{ close(): Promise<void> }> = [];
const subjectAddress = "TSubject111111111111111111111111111111";

function exactVerify20Report() {
  const now = new Date("2026-07-11T00:00:00.000Z");
  return evaluateSmartContractAddress({
    subjectAddress,
    metadata: {
      address: subjectAddress,
      source: "tronscan",
      name: null,
      tag: null,
      isContract: true,
      verified: false,
      accountType: null,
      rawJson: {},
      fetchedAt: now,
      expiresAt: now
    },
    contractProfile: {
      contractAddress: subjectAddress,
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
      methodMap: {
        "5082dd12": "Verify20(address,address,address,uint256)",
        "fc61dd23": "Verify10(address,uint256)",
        "ea4418d9": "withdrawAllTrxTo(address)",
        "f2fde38b": "transferOwnership(address)"
      },
      activityLevel: "low",
      providerRisk: false,
      rawPayload: {},
      fetchedAt: now,
      expiresAt: now
    },
    relatedApprovals: []
  });
}

function job(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "where_is_money_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-01T01:00:00.000Z"),
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: null,
    progressJson: {},
    resultJson: {
      subjectAddress: "TSubject111111111111111111111111111111",
      decision: "ACCEPTABLE",
      riskScore: 20,
      coverage: {},
      assessment: {},
      originPaths: []
    },
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T01:00:00.000Z"),
    startedAt: new Date("2026-06-01T00:00:01.000Z"),
    completedAt: new Date("2026-06-01T01:00:00.000Z"),
    ...overrides
  };
}

function theftReport(overrides: Partial<TheftReport> = {}): TheftReport {
  return {
    id: "report-1",
    telegramUserId: "42",
    txHash: "a".repeat(64),
    victimAddress: "TSender111111111111111111111111111111",
    reportedScamAddress: "TReceiver11111111111111111111111111111",
    amountRaw: "123456789",
    amountUsdt: "123.456789",
    comment: "Пользователь сообщил о фишинге",
    status: "documents_requested",
    depositAddress: "T999999999999999999999999999999999",
    depositAmountUsdt: "1000",
    adminStatus: "awaiting_documents",
    adminNote: "Проверить документы",
    adminUpdatedAt: new Date("2026-07-08T10:00:00.000Z"),
    createdAt: new Date("2026-07-08T09:00:00.000Z"),
    updatedAt: new Date("2026-07-08T10:00:00.000Z"),
    ...overrides
  };
}

it("strictly extracts persisted Verify20 contract reports for Admin reconstruction", () => {
  const extractor = (adminServerModule as unknown as Record<string, unknown>).extractSmartContractCheckReportFromAdminJob as
    ((job: ForensicCheckJob, subjectAddress: string) => unknown) | undefined;
  expect(extractor).toBeTypeOf("function");
  const persisted = JSON.parse(JSON.stringify(exactVerify20Report()));
  expect(extractor!(job({
    progressJson: { contractSafetyAnalysis: { status: "completed", report: persisted } }
  }), subjectAddress)).toMatchObject({ verify20Fingerprint: { matched: true }, riskScore: 85 });

  persisted.contractProfile.methodMap = {};
  expect(extractor!(job({
    progressJson: { contractSafetyAnalysis: { status: "completed", report: persisted } }
  }), subjectAddress)).toBeNull();
  expect(extractor!(job({ progressJson: {} }), subjectAddress)).toBeNull();

  const forgedExactDrain = JSON.parse(JSON.stringify(exactVerify20Report()));
  forgedExactDrain.exactDrainProven = true;
  forgedExactDrain.riskScore = 95;
  expect(extractor!(job({
    progressJson: { contractSafetyAnalysis: { status: "completed", report: forgedExactDrain } }
  }), subjectAddress)).toBeNull();
});

function adminFirstHopEvidenceForTest() {
  const address = "TAdminFirstHop1111111111111111111111";
  const timelineEvent = {
    eventKind: "added",
    occurredAt: "2026-05-10T00:00:00.000Z",
    txHash: "b".repeat(64),
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    blockNumber: 100,
    logIndex: 2,
    verification: "verified_contract_log"
  };
  return {
    firstHopBlacklistFacts: [{
      counterpartyAddress: address,
      direction: "outbound",
      evidenceKind: "usdt_blacklist",
      evidenceAuthority: "official_contract",
      statusAtCheck: "active",
      temporalRelation: "became_active_after",
      effectiveAt: timelineEvent.occurredAt,
      effectiveTxHash: timelineEvent.txHash,
      checkedAt: "2026-06-01T01:00:00.000Z",
      principalAmountRaw: "12000000000",
      principalTxCount: 1,
      directionalPrincipalShare: null,
      shareSemantics: "unavailable",
      transferTxHashes: ["a".repeat(64)],
      beforeEffectiveAmountRaw: "12000000000",
      beforeEffectiveTxCount: 1,
      activeAmountRaw: "0",
      activeTxCount: 0,
      unknownTimingAmountRaw: "0",
      unknownTimingTxCount: 0,
      directTransferCoverage: "partial",
      timelineCoverage: "complete",
      timelineEvents: [timelineEvent]
    }],
    firstHopLabelFacts: [{
      counterpartyAddress: address,
      direction: "outbound",
      labelCode: "phishing",
      evidenceAuthority: "exact_internal",
      recordedAt: "2026-05-01T00:00:00.000Z",
      effectiveAt: null,
      principalAmountRaw: "12000000000",
      principalTxCount: 1,
      directionalPrincipalShare: null,
      shareSemantics: "unavailable",
      transferTxHashes: ["a".repeat(64)],
      linkedToSelectedProvenance: false
    }],
    firstHopBlacklistCoverage: {
      requiredForDecision: true,
      scope: "checked_window",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-06-01T01:00:00.000Z",
      directPrincipalTransferCoverage: "partial",
      materialCounterpartyCount: 1,
      checkedMaterialCounterpartyCount: 1,
      failedMaterialCounterpartyCount: 0,
      uncheckedMaterialCounterpartyCount: 0,
      blacklistCheckCoverage: "history_partial",
      incompleteReason: "Direct principal transfer history is partial.",
      confirmedAdverseFactCount: 1,
      completeTimelineFactCount: 1,
      partialTimelineFactCount: 0
    },
    directHardEvidenceSnapshots: [{
      address,
      labels: [{
        address,
        label: "phishing",
        source: "service_admin",
        createdByTelegramId: "1",
        createdAt: "2026-05-01T00:00:00.000Z"
      }],
      classification: null,
      usdtRestriction: {
        subjectAddress: address,
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: true,
        balanceRaw: "0",
        checkedAt: "2026-06-01T01:00:00.000Z",
        evidenceStrength: "exact_contract_state",
        blacklistTimeline: { events: [timelineEvent], pagination: "complete", failureReason: null },
        methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
      },
      evidenceStatus: "live_checked",
      hasHardEvidence: true,
      reasons: ["label:phishing", "usdt_blacklist"]
    }]
  };
}

function whereReportForAdminTest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const coverage = {
    selectedInboundTxCount: 1,
    selectedInboundVolumeRaw: "1000000000",
    currentBalanceCoverageRatio: 1,
    coverageRatio: 1,
    maxDepth: 7,
    fetchedAddressCount: 3,
    partial: false,
    checkedScope: "requested_amount",
    notes: [],
    ...(typeof overrides.coverage === "object" && overrides.coverage !== null ? overrides.coverage as Record<string, unknown> : {})
  };
  const assessment = {
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    decision: "REVIEW",
    riskScore: 78,
    riskBand: "HIGH",
    provenanceConfidence: 80,
    coverageCompleteness: 100,
    walletRole: "operational_liquidity_wallet",
    operationalLiquidityScore: 0,
    ageSignals: null,
    hardBadEvidence: [],
    sourcePolicyEvidence: [{
      kind: "htx_huobi",
      aggregateShare: 0.7,
      effectiveShare: 0.7,
      pathCount: 1,
      score: 78,
      riskBand: "HIGH",
      proofLevel: "exchange_policy_decline",
      canBeDampened: false,
      reasons: ["Material HTX/Huobi selected-amount source exposure was found."],
      warnings: [],
      evidenceIds: ["tx-htx"]
    }],
    contractSuspicionEvidence: [],
    unknownOriginEvidence: [],
    riskLayers: [],
    dominantRiskLayer: null,
    reasons: ["Material HTX/Huobi selected-amount source exposure was found."],
    warnings: [],
    ...(typeof overrides.assessment === "object" && overrides.assessment !== null ? overrides.assessment as Record<string, unknown> : {})
  };
  return {
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    subjectAddress: "TSubject111111111111111111111111111111",
    currentUsdtBalanceRaw: "1000000000",
    fastWalletRisk: null,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    decision: "REVIEW",
    userDecision: "REVIEW",
    internalDecision: "REVIEW",
    proofLevel: "exchange_policy_decline",
    riskScore: 78,
    decisionReasons: ["Material HTX/Huobi selected-amount source exposure was found."],
    sourceBundleExposure: {
      scope: "where_requested_amount",
      targetAmountRaw: "1000000000",
      coveredAmountRaw: "1000000000",
      coverageRatio: 1,
      htxHuobiShare: 0.7,
      cleanCexShare: 0,
      bridgeRouterDexShare: 0,
      unknownContractShare: 0,
      riskyLabelShare: 0,
      unknownShare: 0,
      dominantSource: "htx_huobi",
      evidenceTxHashes: ["tx-htx"],
      reasons: [],
      warnings: [],
      budget: {
        maxDepth: 7,
        fetchedAddressCount: 3,
        maxAddressFetches: 12,
        liveTransferReadCount: 3,
        skippedAddressCount: 0,
        exhausted: false,
        exhaustedPhase: null
      },
      unresolvedBoundary: null
    },
    ...overrides,
    coverage,
    assessment
  };
}

function deepJobForAdminSummaryTest(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return job({
    id: "job-deep-related",
    kind: "address_deep_check",
    resultJson: {
      subjectAddress: "TSubject111111111111111111111111111111",
      serviceExposureProfiles: [],
      addressBehaviorProfiles: [],
      inboundProvenanceProfiles: [{
        subjectAddress: "TSubject111111111111111111111111111111",
        incomingVolumeRaw: "1000000000",
        matchedInboundVolumeRaw: "700000000",
        score: 70,
        paths: [{
          depth: 1,
          sourceAddress: "TWhitebitSource1111111111111111111111",
          viaAddresses: [],
          label: "whitebit",
          amountRaw: "700000000",
          amountPreservationRatio: 0.98,
          firstTransferAt: "2026-06-01T00:10:00.000Z",
          lastTransferAt: "2026-06-01T00:20:00.000Z",
          txHashes: ["tx-whitebit"],
          evidenceStrength: "exact_labeled_path"
        }],
        boundaryNotes: [],
        features: []
      }],
      counterpartyRiskProfiles: [],
      approvalDrainProvenanceProfiles: [],
      directCounterpartyInteractionProfiles: [],
      assetContinuationProfiles: [],
      stablecoinRestrictionProfiles: [],
      boundaryExposureProfiles: [{
        subjectAddress: "TSubject111111111111111111111111111111",
        contextScore: 12,
        flows: [{ txHash: "tx-service-boundary" }],
        coverage: { stoppedReasons: ["service_boundary"] }
      }],
      operationalFlowProfiles: [],
      walletRoleProfiles: [{
        primaryRole: "treasury_like",
        roles: [{ role: "treasury_like", score: 55 }],
        reasons: []
      }],
      extendedProvenanceProfiles: [],
      missingChecks: [],
      coverage: { transferEdges: 25 },
      coverageDebug: { missingChecks: [] }
    },
    ...overrides
  });
}

function deps(): AdminServerDeps {
  const fixture = job();
  return {
    config: {
      host: "127.0.0.1",
      port: 0,
      token: "secret-token"
    },
    listJobs: async () => [fixture],
    getJob: async (id: string) => id === fixture.id ? fixture : null,
    createStrictProvenanceBenchmarkJob: async () => fixture
  };
}

async function start(dependencies: AdminServerDeps = deps()) {
  const server = await startAdminServer(dependencies);
  servers.push(server);
  return server;
}

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("startAdminServer", () => {
  it("extracts validated persisted first-hop evidence for Admin without dropping timeline fields", () => {
    const extractor = (adminServerModule as unknown as Record<string, unknown>).extractDeepForensicReportFromAdminJob;
    expect(extractor).toBeTypeOf("function");
    if (typeof extractor !== "function") return;
    const evidence = adminFirstHopEvidenceForTest();
    const report = extractor(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        ...evidence
      }
    }), "TSubject111111111111111111111111111111") as Record<string, unknown> | null;

    expect(report?.firstHopBlacklistFacts).toEqual(evidence.firstHopBlacklistFacts);
    expect(report?.firstHopLabelFacts).toEqual(evidence.firstHopLabelFacts);
    expect(report?.firstHopBlacklistCoverage).toEqual(evidence.firstHopBlacklistCoverage);
    expect(report?.directHardEvidenceSnapshots).toEqual(evidence.directHardEvidenceSnapshots.map((snapshot) => ({
      ...snapshot,
      labels: snapshot.labels.map((label) => ({ ...label, createdAt: new Date(label.createdAt) }))
    })));
  });

  it("fails closed atomically when persisted first-hop counters contradict the envelope", () => {
    const extractor = (adminServerModule as unknown as Record<string, unknown>).extractDeepForensicReportFromAdminJob;
    expect(extractor).toBeTypeOf("function");
    if (typeof extractor !== "function") return;
    const evidence = adminFirstHopEvidenceForTest();
    const report = extractor(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        ...evidence,
        firstHopBlacklistCoverage: {
          ...evidence.firstHopBlacklistCoverage,
          confirmedAdverseFactCount: 0
        }
      }
    }), "TSubject111111111111111111111111111111") as Record<string, unknown> | null;

    expect(report).toMatchObject({
      firstHopBlacklistFacts: [],
      firstHopLabelFacts: [],
      directHardEvidenceSnapshots: [],
      firstHopBlacklistCoverage: {
        requiredForDecision: true,
        directPrincipalTransferCoverage: "partial",
        blacklistCheckCoverage: "provider_failed",
        incompleteReason: "persisted_first_hop_evidence_invalid"
      }
    });
  });

  it("keeps first-hop evidence absent when Admin extracts a legacy Deep payload", () => {
    const extractor = (adminServerModule as unknown as Record<string, unknown>).extractDeepForensicReportFromAdminJob;
    expect(extractor).toBeTypeOf("function");
    if (typeof extractor !== "function") return;
    const report = extractor(job({
      kind: "address_deep_check",
      resultJson: { subjectAddress: "TSubject111111111111111111111111111111" }
    }), "TSubject111111111111111111111111111111") as Record<string, unknown> | null;

    expect(report).not.toBeNull();
    expect(report).not.toHaveProperty("firstHopBlacklistFacts");
    expect(report).not.toHaveProperty("firstHopLabelFacts");
    expect(report).not.toHaveProperty("firstHopBlacklistCoverage");
    expect(report).not.toHaveProperty("directHardEvidenceSnapshots");
  });

  it("redirects root to the forensics console", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin/forensics");
  });

  it("redirects admin root to the forensics console", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin/forensics");
  });

  it("serves admin console shell without exposing job data", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/forensics`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Admin Forensics Console");
    expect(html).toContain("data-admin-console");
    expect(html).toContain("data-graph-first-shell");
    expect(html).toContain("Case brief");
    expect(html).toContain("Jobs");
    expect(html).toContain("Activity timeline");
    expect(html).toContain("Transfers");
    expect(html).toContain("function renderCaseBrief");
    expect(html).toContain("function renderActivityTimeline");
    expect(html).toContain("/admin/api/forensic-jobs");
    expect(html).toContain("Find address, tx, or job id");
    expect(html).toContain("function scheduleLoadJobs");
    expect(html).toContain("function applyInitialUrlFilters");
    expect(html).toContain("Пересечения");
    expect(html).toContain("data-wallet-intelligence-workspace");
    expect(html).toContain("/admin/api/wallet-intelligence/addresses");
    expect(html).toContain("function loadWalletIntelligenceAddresses");
    expect(html).toContain("function renderWalletIntelligenceTable");
    expect(html).toContain("function renderWalletIntelligenceDrawer");
    expect(html).toContain("Проверяемые кошельки");
    expect(html).toContain("Сумма");
    expect(html).toContain("Контекст аналитика, не скоринговое доказательство.");
    expect(html).toContain("pendingOpenJobId");
    expect(html).toContain('el("subject").addEventListener("input"');
    expect(html).toContain('event.key !== "Enter"');
    expect(html).toContain('<option value="cancelled">cancelled</option>');
    expect(html).toContain('<option value="address_fast_check">Fast check</option>');
    expect(html).toContain("Clear selection");
    expect(html).toContain("function nodeIntelligenceBlock");
    expect(html).toContain("Node role");
    expect(html).toContain("Behavior marker");
    expect(html).toContain("This is a behavior marker, not final risk proof by itself.");
    expect(html).toContain("All transfers");
    expect(html).toContain("Selected evidence");
    expect(html).toContain("Boundary stops");
    expect(html).toContain("data-transfer-tabs");
    expect(html).toContain("Tx labels:");
    expect(html).toContain("Anchor coverage");
    expect(html).toContain("Drain episode");
    expect(html).toContain("Used for checked amount");
    expect(html).toContain("Original transfer amount");
    expect(html).toContain("Target coverage amount");
    expect(html).toContain("Used share of target");
    expect(html).toContain("Used share of transfer");
    expect(html).toContain("Only this portion of the larger transfer was counted toward the checked amount");
    expect(html).toContain("Behavioral/service exposure context");
    expect(html).toContain("Money-origin provenance step");
    expect(html).toContain("This is not money-origin proof");
    expect(html).toContain("Top incoming");
    expect(html).toContain("Top outgoing");
    expect(html).toContain("Top services");
    expect(html).toContain("fastCheckTopMetrics");
    expect(html).toContain("Canvas edge labels show original transfer amounts; allocation is explained in transfer rows and transfer details.");
    expect(html).not.toContain("Allocated amount");
    expect(html).not.toContain("Original tx amount");
    expect(html).not.toContain("Coverage amount");
    expect(html).not.toContain("edge labels and edge details");
    expect(html).toContain("tx gap");
    expect(html).toContain("Risk score");
    expect(html).toContain("https://tronscan.org/#/address/");
    expect(html).toContain("https://tronscan.org/#/transaction/");
    expect(html).toContain("Projection mode");
    expect(html).toContain("Projection gaps");
    expect(html).toContain("Funding bundle");
    expect(html).toContain("Top funders");
    expect(html).toContain("function nodeDisplayKind");
    expect(html).toContain("function nodeDisplayLabel");
    expect(html).toContain("function traceStopDetailBlock");
    expect(html).toContain("Path uncertainty penalty");
    expect(html).toContain("This is not wallet risk");
    expect(html).toContain("Stop amount");
    expect(html).toContain("Required history cutoff");
    expect(html).toContain("Oldest fetched transfer");
    expect(html).toContain("Reached required time");
    expect(html).toContain("Bridge / service");
    expect(html).toContain("Smart contract");
    expect(html).toContain("function edgeTime");
    expect(html).toContain("function edgeCanvasTimeLabel");
    expect(html).toContain('if (value === null || value === undefined || value === "") return "";');
    expect(html).toContain('if (gap) return "gap " + gap;');
    expect(html).toContain("Path timing");
    expect(html).toContain("Slowest hop");
    expect(html).toContain('typeof value === "number" && Number.isFinite(value) && value >= 0');
    expect(html).toContain("function edgePathId");
    expect(html).toContain("function edgeShouldShowAmount");
    expect(html).toContain("function boundaryStopContribution");
    const transferEdgesStart = html.indexOf("const transferEdges = () =>");
    const transferEdgesEnd = html.indexOf("const tronscanAddressUrl", transferEdgesStart);
    const transferEdgesHelper = html.slice(transferEdgesStart, transferEdgesEnd);
    expect(transferEdgesHelper).toContain('edge?.type !== "stop"');
    expect(transferEdgesHelper).toContain('edgeDisplayRole(edge) !== "stop"');
    const nodeColorStart = html.indexOf("function nodeColor(node)");
    const nodeColorEnd = html.indexOf("function nodeRadius(node)", nodeColorStart);
    const nodeColorHelper = html.slice(nodeColorStart, nodeColorEnd);
    const stopColorIndex = nodeColorHelper.indexOf('kind === "trace_stop"');
    const highRiskColorIndex = nodeColorHelper.indexOf('node.riskLevel === "HIGH"');
    expect(nodeColorHelper).toContain('node.kind === "stop"');
    expect(stopColorIndex).toBeGreaterThan(-1);
    expect(stopColorIndex).toBeLessThan(highRiskColorIndex);
    const stopBadgeReasonStart = html.indexOf("function stopBadgeReason(node)");
    const stopBadgeReasonEnd = html.indexOf("function stopBadgeLabel(reason)", stopBadgeReasonStart);
    const stopBadgeReasonHelper = html.slice(stopBadgeReasonStart, stopBadgeReasonEnd);
    expect(stopBadgeReasonHelper).toContain("node.metadata?.reason");
    expect(stopBadgeReasonHelper.indexOf("node.metadata?.reason")).toBeLessThan(stopBadgeReasonHelper.indexOf("node.metadata?.lastStopReason"));
    expect(html).toContain("Uncertainty +");
    expect(html).toContain("History checked");
    expect(html).toContain("Last real hop");
    expect(html).toContain("svg { width: 100%; height: 100%; display: block; cursor: grab; }");
    expect(html).toContain("radial-gradient");
    expect(html).not.toContain("floating-inspector");
    expect(html).not.toContain("TSubject111111111111111111111111111111");
  });

  it("serves wallet intelligence console shell", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/wallet-intelligence`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("data-wallet-intelligence-workspace");
    expect(html).toContain("Пересечения адресов");
  });

  it("serves the theft reports workspace shell", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/theft-reports`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Заявки о краже");
    expect(html).toContain("data-theft-reports-workspace");
    expect(html).toContain('id="theftReportsSearch"');
    expect(html).toContain('id="theftReportDetail"');
    expect(html).toContain("data-workbench-shell");
    expect(html).toContain("function theftReportsActive()");
    expect(html).toContain("else if (theftReportsActive()) loadTheftReports();");
    expect(html).not.toContain("Рабочее место заявок будет подключено");
    expect(html).not.toContain("theft-reports-placeholder");
  });

  it("keeps node role marks inline in the graph renderer", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("Role marks on");
    expect(html).toContain("node-role");
    expect(html).toContain("nodeRoleMarkSvg");
    expect(html).toContain("/admin/assets/node-role/drainer.png");
    expect(html).not.toContain("/admin/assets/node-intelligence");
  });

  it("serves node role icon assets", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/assets/node-role/drainer.png`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("rejects forensic job list requests without bearer token", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin authorization required."
    });
  });

  it("lists wallet intelligence summaries for authorized admins", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async (input) => {
        receivedInput = input;
        return [{
          address: "TSeen1111111111111111111111111111111",
          uniqueSubjectCount: 2,
          uniqueRequesterCount: 2,
          jobCount: 3,
          completedJobCount: 2,
          partialJobCount: 1,
          occurrenceCount: 4,
          distinctTxCount: 2,
          distinctAmountRaw: "3000000",
          minDepth: 1,
          maxDepth: 2,
          firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          lastSeenAt: new Date("2026-07-06T10:00:00.000Z"),
          modes: ["address_deep_check"],
          tags: ["repeated_cross_run_address"],
          serviceCategories: ["cex"],
          labelHints: ["Binance"]
        }];
      },
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/addresses?limit=20&offset=5&mode=address_deep_check&tag=repeated_cross_run_address&minUniqueSubjects=2&minUniqueRequesters=2&requester=client_user&subjectAddress=TSubject111111111111111111111111111111&startDate=2026-07-01T00%3A00%3A00.000Z&endDate=2026-07-08T00%3A00%3A00.000Z&minDepth=1&maxDepth=2&minDistinctAmountRaw=1000000&maxDistinctAmountRaw=5000000&serviceCategory=cex&jobStatus=completed`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      addresses: [{
        address: "TSeen1111111111111111111111111111111",
        uniqueSubjectCount: 2,
        uniqueRequesterCount: 2,
        distinctAmountRaw: "3000000"
      }]
    });
    expect(receivedInput).toMatchObject({
      limit: 20,
      offset: 5,
      mode: "address_deep_check",
      tag: "repeated_cross_run_address",
      minUniqueSubjects: 2,
      minUniqueRequesters: 2,
      requesterQuery: "client_user",
      subjectAddress: "TSubject111111111111111111111111111111",
      minDepth: 1,
      maxDepth: 2,
      minDistinctAmountRaw: "1000000",
      maxDistinctAmountRaw: "5000000",
      serviceCategory: "cex",
      jobStatus: "completed"
    });
    expect((receivedInput as { startDate?: Date }).startDate?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect((receivedInput as { endDate?: Date }).endDate?.toISOString()).toBe("2026-07-08T00:00:00.000Z");
  });

  it("returns wallet intelligence summaries for requested graph addresses", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async (input) => {
        receivedInput = input;
        return [{
          address: "T111111111111111111111111111111111",
          uniqueSubjectCount: 2,
          uniqueRequesterCount: 1,
          jobCount: 3,
          completedJobCount: 3,
          partialJobCount: 0,
          occurrenceCount: 4,
          distinctTxCount: 2,
          distinctAmountRaw: "3000000",
          minDepth: 1,
          maxDepth: 2,
          firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          lastSeenAt: new Date("2026-07-06T10:00:00.000Z"),
          modes: ["address_deep_check"],
          tags: ["repeated_cross_run_address"],
          serviceCategories: [],
          labelHints: []
        }];
      },
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/address-summaries?addresses=T111111111111111111111111111111111,T222222222222222222222222222222222`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      addresses: [{
        address: "T111111111111111111111111111111111",
        jobCount: 3,
        uniqueSubjectCount: 2
      }]
    });
    expect(receivedInput).toMatchObject({
      addresses: [
        "T111111111111111111111111111111111",
        "T222222222222222222222222222222222"
      ],
      limit: 2,
      offset: 0
    });
  });

  it("rejects invalid wallet intelligence graph summary addresses", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/address-summaries?addresses=not-a-tron-address`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid wallet intelligence address."
    });
  });

  it("returns 501 when wallet intelligence graph summaries are not configured", async () => {
    const server = await start();

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/address-summaries?addresses=T111111111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(501);
  });

  it("returns wallet intelligence address detail", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async (address) => ({
        summary: {
          address,
          uniqueSubjectCount: 1,
          uniqueRequesterCount: 1,
          jobCount: 1,
          completedJobCount: 1,
          partialJobCount: 0,
          occurrenceCount: 1,
          distinctTxCount: 1,
          distinctAmountRaw: "1000000",
          minDepth: 1,
          maxDepth: 1,
          firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          lastSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          modes: ["address_deep_check"],
          tags: ["repeated_cross_run_address"],
          serviceCategories: [],
          labelHints: []
        },
        requesters: [{ requestedBy: "42", telegramUserId: "42", username: "client_user", locale: "ru", chatId: "42", messageId: "77", jobCount: 1 }],
        jobs: [{ jobId: "job-1", jobKind: "address_deep_check", jobStatus: "completed", subjectAddress: "TSubject111111111111111111111111111111", completedAt: new Date("2026-07-06T10:00:00.000Z") }],
        sightings: [{
          id: "sighting-1",
          address,
          jobId: "job-1",
          jobKind: "address_deep_check",
          subjectAddress: "TSubject111111111111111111111111111111",
          requestedBy: "42",
          sourceKind: "deep_direct_counterparty",
          role: "direct_counterparty",
          depth: 1,
          pathId: "p",
          txHash: "tx-1",
          amountRaw: "1000000",
          firstSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          lastSeenAt: new Date("2026-07-06T09:00:00.000Z"),
          metadataJson: {}
        }],
        edges: []
      })
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/addresses/TSeen1111111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      detail: {
        summary: { address: "TSeen1111111111111111111111111111111" },
        requesters: [{ username: "client_user" }],
        sightings: [{ sourceKind: "deep_direct_counterparty", depth: 1, txHash: "tx-1" }]
      }
    });
  });

  it("rejects wallet intelligence requests without bearer token", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(`${server.url}/admin/api/wallet-intelligence/addresses`);

    expect(response.status).toBe(401);
  });

  it("returns 404 for missing wallet intelligence address detail", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/addresses/TMissing1111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(404);
  });

  it("rejects invalid wallet intelligence filters", async () => {
    const server = await start({
      ...deps(),
      listWalletIntelligenceAddressSummaries: async () => [],
      getWalletIntelligenceAddressDetail: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/wallet-intelligence/addresses?mode=address_fast_check`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(400);
  });

  it("returns 501 when wallet intelligence list dependency is not configured", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/wallet-intelligence/addresses`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(501);
  });

  it("lists theft reports for authorized admins", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listTheftReports: async (input) => {
        receivedInput = input;
        return [theftReport()];
      },
      getTheftReport: async () => null,
      updateTheftReportAdminState: async () => null
    });

    const response = await fetch(
      `${server.url}/admin/api/theft-reports?limit=20&offset=5&adminStatus=awaiting_documents&botStatus=documents_requested&query=TReceiver`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reports: [{
        id: "report-1",
        telegramUserId: "42",
        adminStatus: "awaiting_documents",
        status: "documents_requested"
      }]
    });
    expect(receivedInput).toMatchObject({
      limit: 20,
      offset: 5,
      adminStatus: "awaiting_documents",
      botStatus: "documents_requested",
      query: "TReceiver"
    });
  });

  it("accepts q as a theft report text filter alias", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listTheftReports: async (input) => {
        receivedInput = input;
        return [];
      },
      getTheftReport: async () => null,
      updateTheftReportAdminState: async () => null
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports?q=TReceiver`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(receivedInput).toMatchObject({ query: "TReceiver" });
  });

  it("rejects theft report list requests without bearer token", async () => {
    let called = false;
    const server = await start({
      ...deps(),
      listTheftReports: async () => {
        called = true;
        return [];
      }
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports`);

    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });

  it("returns theft report detail for authorized admins", async () => {
    const server = await start({
      ...deps(),
      listTheftReports: async () => [],
      getTheftReport: async (id) => id === "report-1" ? theftReport() : null,
      updateTheftReportAdminState: async () => null
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports/report-1`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      report: {
        id: "report-1",
        victimAddress: "TSender111111111111111111111111111111",
        reportedScamAddress: "TReceiver11111111111111111111111111111"
      }
    });
  });

  it("updates theft report admin state for authorized admins", async () => {
    let receivedInput: unknown = null;
    const server = await start({
      ...deps(),
      listTheftReports: async () => [],
      getTheftReport: async () => null,
      updateTheftReportAdminState: async (input) => {
        receivedInput = input;
        return theftReport({ adminStatus: input.adminStatus, adminNote: input.adminNote });
      }
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports/report-1/admin-state`, {
      method: "PATCH",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ adminStatus: "in_progress", adminNote: "Взято в работу" })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      report: {
        id: "report-1",
        adminStatus: "in_progress",
        adminNote: "Взято в работу"
      }
    });
    expect(receivedInput).toEqual({
      id: "report-1",
      adminStatus: "in_progress",
      adminNote: "Взято в работу"
    });
  });

  it("rejects invalid theft report admin status updates before calling dependency", async () => {
    let called = false;
    const server = await start({
      ...deps(),
      listTheftReports: async () => [],
      getTheftReport: async () => null,
      updateTheftReportAdminState: async () => {
        called = true;
        return null;
      }
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports/report-1/admin-state`, {
      method: "PATCH",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ adminStatus: "paid", adminNote: "bad status" })
    });

    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  it("rejects missing or non-string theft report admin notes before calling dependency", async () => {
    let callCount = 0;
    const server = await start({
      ...deps(),
      listTheftReports: async () => [],
      getTheftReport: async () => null,
      updateTheftReportAdminState: async () => {
        callCount += 1;
        return null;
      }
    });

    for (const body of [
      { adminStatus: "in_progress" },
      { adminStatus: "in_progress", adminNote: 123 }
    ]) {
      const response = await fetch(`${server.url}/admin/api/theft-reports/report-1/admin-state`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer secret-token",
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });

      expect(response.status).toBe(400);
    }
    expect(callCount).toBe(0);
  });

  it("rejects invalid theft report admin status filters", async () => {
    const server = await start({
      ...deps(),
      listTheftReports: async () => [],
      getTheftReport: async () => null,
      updateTheftReportAdminState: async () => null
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports?adminStatus=paid`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
  });

  it("rejects invalid theft report bot status filters before calling dependency", async () => {
    let called = false;
    const server = await start({
      ...deps(),
      listTheftReports: async () => {
        called = true;
        return [];
      },
      getTheftReport: async () => null,
      updateTheftReportAdminState: async () => null
    });

    const response = await fetch(`${server.url}/admin/api/theft-reports?botStatus=paid`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 501 when theft reports dependencies are not configured", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/theft-reports`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(501);
  });

  it("lists forensic jobs for authorized admins", async () => {
    let receivedInput: unknown = null;
    const fixture = job();
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        receivedInput = input;
        return [fixture];
      }
    });

    const response = await fetch(
      `${server.url}/admin/api/forensic-jobs?limit=10&offset=5&status=completed&kind=where_is_money_check&subjectAddress=TSubject111111111111111111111111111111`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobs: [{
        id: "job-1",
        kind: "where_is_money_check",
        subjectAddress: "TSubject111111111111111111111111111111",
        status: "completed",
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-06-01T01:00:00.000Z",
        priority: 100,
        lastError: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T01:00:00.000Z",
        startedAt: "2026-06-01T00:00:01.000Z",
        completedAt: "2026-06-01T01:00:00.000Z",
        decision: "ACCEPTABLE",
        riskScore: 20,
        riskLevel: "LOW"
      }]
    });
    expect(receivedInput).toEqual({
      limit: 10,
      offset: 5,
      status: "completed",
      kind: "where_is_money_check",
      subjectAddress: "TSubject111111111111111111111111111111"
    });
  });

  it("summarizes fast-check risk fields for Jobs queue cards", async () => {
    const fixture = job({
      kind: "address_fast_check",
      status: "partial",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        fastRiskReport: {
          score: 80,
          level: "HIGH"
        }
      },
      progressJson: {
        fastRiskSnapshot: {
          score: 75,
          level: "HIGH"
        }
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [fixture]
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?limit=1`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{
        kind: "address_fast_check",
        status: "partial",
        riskScore: 80,
        riskLevel: "HIGH"
      }]
    });
  });

  it("summarizes mode-specific risk before fast-check fallback for Jobs queue cards", async () => {
    const fast = job({
      id: "job-fast",
      kind: "address_fast_check",
      status: "partial",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        fastRiskReport: {
          score: 60,
          level: "HIGH"
        }
      },
      progressJson: {
        fastRiskSnapshot: {
          score: 60,
          level: "HIGH"
        }
      }
    });
    const deep = job({
      id: "job-deep",
      kind: "address_deep_check",
      status: "completed",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        operationalFlowProfiles: [{
          operationalScore: 55
        }]
      },
      progressJson: {
        fastRiskSnapshot: {
          score: 60,
          level: "HIGH"
        }
      }
    });
    const where = job({
      id: "job-where",
      kind: "where_is_money_check",
      status: "completed",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: {
          decision: "DECLINE",
          riskScore: 78,
          technicalStatus: "completed"
        }
      },
      progressJson: {
        fastRiskSnapshot: {
          score: 60,
          level: "HIGH"
        }
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [fast, deep, where]
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?limit=3`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { jobs: Array<{ id: string; riskScore?: number; riskLevel?: string; decision?: string }> };
    const summaries = new Map(body.jobs.map((item) => [item.id, item]));
    expect(summaries.get("job-fast")).toMatchObject({ riskScore: 60, riskLevel: "HIGH" });
    expect(summaries.get("job-deep")).toMatchObject({ riskScore: 55, riskLevel: "MEDIUM" });
    expect(summaries.get("job-where")).toMatchObject({ riskScore: 78, riskLevel: "HIGH", decision: "DECLINE" });
  });

  it("creates strict provenance benchmark jobs for authorized admins", async () => {
    let receivedInput: unknown = null;
    const created = job({
      id: "strict-job-1",
      kind: "where_is_money_check",
      subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d",
      status: "queued",
      progressJson: { strictProvenanceBenchmark: true }
    });
    const server = await start({
      ...deps(),
      createStrictProvenanceBenchmarkJob: async (input) => {
        receivedInput = input;
        return created;
      }
    });

    const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d"
      })
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      job: {
        id: "strict-job-1",
        kind: "where_is_money_check",
        status: "queued",
        subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d"
      }
    });
    expect(receivedInput).toMatchObject({
      subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d"
    });
  });

  it("rejects strict benchmark creation without auth", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectAddress: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d" })
    });

    expect(response.status).toBe(401);
  });

  it("rejects invalid strict benchmark addresses", async () => {
    const server = await start({
      ...deps(),
      createStrictProvenanceBenchmarkJob: async () => {
        throw new Error("should not create invalid jobs");
      }
    });

    const response = await fetch(`${server.url}/admin/api/strict-provenance-benchmark`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ subjectAddress: "bad" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid TRON subject address."
    });
  });

  it("passes broad forensic job search queries to the job repository", async () => {
    let receivedInput: unknown = null;
    const fixture = job({
      kind: "incoming_deposit_check",
      progressJson: {
        depositTxHash: "b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c",
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        sender: "TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3"
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        receivedInput = input;
        return [fixture];
      }
    });

    const response = await fetch(
      `${server.url}/admin/api/forensic-jobs?query=b4603c390&kind=incoming_deposit_check`,
      { headers: { authorization: "Bearer secret-token" } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{
        id: "job-1",
        kind: "incoming_deposit_check",
        depositTxHash: "b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c",
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        sender: "TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3"
      }]
    });
    expect(receivedInput).toMatchObject({
      kind: "incoming_deposit_check",
      query: "b4603c390"
    });
  });

  it("returns scoring audit report for authorized admins", async () => {
    let receivedInput: unknown = null;
    const fixture = job({
      resultJson: {
        decision: "ACCEPTABLE",
        riskScore: 20,
        coverage: {
          partial: true,
          fetchedAddressCount: 1,
          notes: ["service boundary reached"]
        }
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        receivedInput = input;
        return [fixture];
      }
    });

    const response = await fetch(`${server.url}/admin/api/scoring-audit?limit=10`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      report: {
        totalJobs: 1,
        rows: [{
          jobId: "job-1",
          kind: "where_is_money_check"
        }],
        shadowComparisons: [{
          candidatePolicyVersion: SHADOW_SCORING_POLICY_VERSION
        }]
      }
    });
    expect(receivedInput).toMatchObject({ limit: 10 });
  });

  it("rejects scoring audit requests without bearer token", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/scoring-audit`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin authorization required."
    });
  });

  it("returns 400 for invalid scoring audit filters", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/scoring-audit?limit=abc`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job limit."
    });
  });

  it("does not include raw forensic payloads in job list responses", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { jobs: Array<Record<string, unknown>> };
    expect(body.jobs[0]).not.toHaveProperty("chatId");
    expect(body.jobs[0]).not.toHaveProperty("messageId");
    expect(body.jobs[0]).not.toHaveProperty("requestedBy");
    expect(body.jobs[0]).not.toHaveProperty("progressJson");
    expect(body.jobs[0]).not.toHaveProperty("resultJson");
    expect(body.jobs[0]).not.toHaveProperty("rawEvidenceIds");
    expect(body.jobs[0]).not.toHaveProperty("observationIds");
  });

  it("returns 400 for invalid forensic job status filter", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?status=bad`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job status filter."
    });
  });

  it("returns 400 for invalid forensic job kind filter", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?kind=bad`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job kind filter."
    });
  });

  it("accepts address_fast_check forensic job kind filters", async () => {
    let receivedInput: unknown = null;
    const fixture = job({ kind: "address_fast_check" });
    const server = await start({
      ...deps(),
      listJobs: async (input) => {
        receivedInput = input;
        return [fixture];
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?kind=address_fast_check`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{ kind: "address_fast_check" }]
    });
    expect(receivedInput).toMatchObject({
      kind: "address_fast_check"
    });
  });

  it("returns 400 for non-numeric forensic job limit", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?limit=abc`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job limit."
    });
  });

  it("returns 400 for negative forensic job limit", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?limit=-1`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job limit."
    });
  });

  it("returns 400 for fractional forensic job offset", async () => {
    const server = await start({
      ...deps(),
      listJobs: async () => {
        throw new Error("listJobs should not be called for invalid input");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs?offset=1.5`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job offset."
    });
  });

  it("returns projected graph for a completed job", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        job: { id: "job-1", status: "completed" },
        subject: { address: "TSubject111111111111111111111111111111" },
        summary: { decision: "ACCEPTABLE", riskScore: 20 }
      }
    });
  });

  it("keeps exact hard decline and partial limitations in the canonical Admin graph", async () => {
    const whereReport = whereReportForAdminTest({
      scoreValid: false,
      scoreBlockedReason: "provider_cap_unresolved",
      technicalStatus: "provider_cap_unresolved",
      proofLevel: "exact_scam_or_taint_proof",
      coverage: { partial: true, notes: ["provider cap"] },
      assessment: {
        scoreValid: false,
        scoreBlockedReason: "provider_cap_unresolved",
        technicalStatus: "provider_cap_unresolved",
        hardBadEvidence: [{
          kind: "scam_or_blacklist",
          score: 95,
          message: "Exact subject blacklist evidence.",
          evidenceIds: ["hard:subject:blacklist"]
        }]
      }
    });
    const fixture = job({
      id: "job-hard-partial",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: whereReport,
        score_valid: false
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [fixture],
      getJob: async (id) => id === fixture.id ? fixture : null
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${fixture.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });
    const graph = (await response.json()).graph;

    expect(graph.summary).toMatchObject({ decision: "DECLINE", riskScore: 95, riskLevel: "CRITICAL" });
    expect(graph.summary.humanSummary.limitations.join(" ")).toMatch(/provider cap|partial|покрыт/i);
  });

  it("preserves null canonical score and observed context for a new technical-stop graph", async () => {
    const whereReport = whereReportForAdminTest({
      scoreValid: false,
      scoreBlockedReason: "provider_cap_unresolved",
      technicalStatus: "provider_cap_unresolved",
      proofLevel: "insufficient_coverage",
      decision: "REVIEW",
      userDecision: "NO_FINAL_DECISION",
      internalDecision: "REVIEW",
      riskScore: 45,
      coverage: { partial: true, notes: ["provider cap"] },
      assessment: {
        scoreValid: false,
        scoreBlockedReason: "provider_cap_unresolved",
        technicalStatus: "provider_cap_unresolved",
        decision: "REVIEW",
        riskScore: 45,
        riskBand: "MEDIUM",
        hardBadEvidence: [],
        sourcePolicyEvidence: [],
        riskLayers: []
      }
    });
    const fixture = job({
      id: "job-technical-stop",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: whereReport,
        score_valid: false
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [fixture],
      getJob: async (id) => id === fixture.id ? fixture : null
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${fixture.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });
    const graph = (await response.json()).graph;
    const subjectNode = graph.nodes.find((node: { kind: string }) => node.kind === "subject");

    expect(graph.summary).toMatchObject({
      decision: "NO_FINAL_DECISION",
      riskScore: null,
      riskLevel: null,
      riskClarity: { finalRiskScore: null, decisionStatus: "insufficient_coverage" }
    });
    expect(subjectNode).toMatchObject({
      riskLevel: null,
      metadata: {
        finalDecision: "NO_FINAL_DECISION",
        finalScore: null,
        observedContextScore: expect.any(Number)
      }
    });
  });

  it("keeps a legacy Admin result byte-for-byte unchanged while reading its stored semantics", async () => {
    const whereReport = whereReportForAdminTest();
    delete whereReport.scoreValid;
    delete (whereReport.assessment as Record<string, unknown>).scoreValid;
    const fixture = job({
      id: "job-legacy-read",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: whereReport
      }
    });
    const before = JSON.stringify(fixture.resultJson);
    const server = await start({
      ...deps(),
      listJobs: async () => [fixture],
      getJob: async (id) => id === fixture.id ? fixture : null
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${fixture.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });
    const graph = (await response.json()).graph;

    expect(graph.summary).toMatchObject({ decision: "REVIEW", riskScore: 78 });
    expect(graph.summary.humanSummary.limitations.join(" ")).toMatch(/legacy|fresh check/i);
    expect(JSON.stringify(fixture.resultJson)).toBe(before);
  });

  it("does not overlay a related legacy Where conclusion on a Fast graph", async () => {
    const fastJob = job({
      id: "job-fast-with-legacy-related",
      kind: "address_fast_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        fastRiskReport: {
          decision: "DECLINE",
          score: 80,
          level: "HIGH",
          confidence: "high",
          reasons: [{ code: "fast-risk", message: "Stored Fast decline.", scoreImpact: 80 }]
        },
        fastCounterpartyTopsProfile: {
          subjectAddress: "TSubject111111111111111111111111111111",
          topIncomingCounterparties: [],
          topOutgoingCounterparties: [],
          topServiceCounterparties: []
        }
      }
    });
    const legacyReport = whereReportForAdminTest({
      decision: "REVIEW",
      userDecision: "REVIEW",
      internalDecision: "REVIEW",
      riskScore: 45,
      assessment: { decision: "REVIEW", riskScore: 45, riskBand: "MEDIUM" }
    });
    delete legacyReport.scoreValid;
    delete (legacyReport.assessment as Record<string, unknown>).scoreValid;
    const legacyWhereJob = job({
      id: "job-related-legacy-where",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: legacyReport
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [legacyWhereJob],
      getJob: async (id) => id === fastJob.id ? fastJob : null
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${fastJob.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });
    const graph = (await response.json()).graph;

    expect(graph.summary).toMatchObject({ decision: "DECLINE", riskScore: 80, humanSummary: null });
    expect(JSON.stringify(graph)).not.toContain("Legacy result");
  });

  it("skips a first legacy related Where and selects a newer explicit sibling", async () => {
    const fastJob = job({
      id: "job-fast-with-new-related",
      kind: "address_fast_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        fastRiskReport: {
          decision: "DECLINE",
          score: 80,
          level: "HIGH",
          confidence: "high",
          reasons: [{ code: "fast-risk", message: "Stored Fast decline.", scoreImpact: 80 }]
        },
        fastCounterpartyTopsProfile: {
          subjectAddress: "TSubject111111111111111111111111111111",
          topIncomingCounterparties: [],
          topOutgoingCounterparties: [],
          topServiceCounterparties: []
        }
      }
    });
    const legacyReport = whereReportForAdminTest();
    delete legacyReport.scoreValid;
    delete (legacyReport.assessment as Record<string, unknown>).scoreValid;
    const legacyWhereJob = job({
      id: "job-related-legacy-first",
      updatedAt: new Date("2026-06-01T00:30:00.000Z"),
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: legacyReport
      }
    });
    const explicitWhereReport = whereReportForAdminTest({
      decision: "DECLINE",
      userDecision: "DECLINE",
      internalDecision: "DECLINE",
      proofLevel: "exact_scam_or_taint_proof",
      riskScore: 95,
      assessment: {
        decision: "DECLINE",
        riskScore: 95,
        riskBand: "CRITICAL",
        hardBadEvidence: [{
          kind: "scam_or_blacklist",
          score: 95,
          message: "Exact subject blacklist evidence.",
          evidenceIds: ["hard:subject:blacklist"]
        }]
      }
    });
    const explicitWhereJob = job({
      id: "job-related-explicit-newer",
      updatedAt: new Date("2026-06-01T00:45:00.000Z"),
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: explicitWhereReport
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [legacyWhereJob, explicitWhereJob],
      getJob: async (id) => id === fastJob.id ? fastJob : null
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${fastJob.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });
    const graph = (await response.json()).graph;

    expect(graph.summary).toMatchObject({ decision: "DECLINE", riskScore: 95 });
    expect(graph.summary.humanSummary.conclusion).toMatch(/сильный риск/i);
    expect(JSON.stringify(graph.summary.humanSummary)).not.toContain("Legacy result");
  });

  it("uses a validated persisted Verify20 report in Admin unified-risk reconstruction", async () => {
    const whereJob = job({
      id: "job-verify20-admin",
      progressJson: {
        contractSafetyAnalysis: {
          status: "completed",
          report: JSON.parse(JSON.stringify(exactVerify20Report()))
        }
      },
      resultJson: {
        subjectAddress,
        whereIsMoneyReport: whereReportForAdminTest({ riskScore: 20 })
      }
    });
    const server = await start({
      ...deps(),
      listJobs: async () => [],
      getJob: async (id) => id === whereJob.id ? whereJob : null
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${whereJob.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });
    const graph = (await response.json()).graph;
    expect(graph.summary).toMatchObject({ decision: "DECLINE", riskScore: 85, riskLevel: "CRITICAL" });
    expect(graph.nodes.find((node: { kind: string }) => node.kind === "subject")?.metadata).toMatchObject({
      finalDecision: "DECLINE",
      finalScore: 85
    });
  });

  it("returns a Russian human summary for graph reports with matching Where and Deep evidence", async () => {
    const whereReport = whereReportForAdminTest();
    const whereJob = job({
      id: "job-where-summary",
      chatId: "42",
      requestedBy: "42",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: whereReport
      }
    });
    const deepJob = deepJobForAdminSummaryTest({
      chatId: "42",
      requestedBy: "42",
      windowStart: whereJob.windowStart,
      windowEnd: whereJob.windowEnd
    });
    const unrelatedDeepJob = deepJobForAdminSummaryTest({
      id: "job-deep-unrelated",
      requestedBy: "other-user",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 25 },
        coverageDebug: { missingChecks: [] }
      }
    });
    const receivedInputs: unknown[] = [];
    const server = await start({
      ...deps(),
      getJob: async (id: string) => id === whereJob.id ? whereJob : null,
      listJobs: async (input) => {
        receivedInputs.push(input);
        return [whereJob, unrelatedDeepJob, deepJob];
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${whereJob.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(receivedInputs).toContainEqual({
      subjectAddress: "TSubject111111111111111111111111111111",
      limit: 20
    });
    expect(body.graph.summary.humanSummary).toMatchObject({
      conclusion: "Адрес нельзя принимать автоматически: найден сильный риск.",
      primaryReasons: expect.arrayContaining([
        "В выбранной сумме найден источник HTX/Huobi: 70%.",
        "Цепочка дошла до биржи или сервиса. Дальше публичная on-chain трассировка ограничена.",
        "DeepCheck нашёл source-policy связь с whitebit. Это не доказывает кражу, но требует проверки источника средств."
      ]),
      recommendations: expect.arrayContaining([
        "Не принимать депозит автоматически.",
        "Запросить подтверждение происхождения средств."
      ])
    });
    expect(body.graph.summary.humanSummary.modeSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Where Is Money",
        facts: expect.arrayContaining(["В выбранной сумме найден источник HTX/Huobi: 70%."])
      }),
      expect.objectContaining({
        title: "DeepCheck",
        facts: expect.arrayContaining(["DeepCheck нашёл source-policy связь с whitebit. Это не доказывает кражу, но требует проверки источника средств."])
      })
    ]));
    expect(JSON.stringify(body.graph.summary.humanSummary)).not.toContain("job-deep-unrelated");
    expect(JSON.stringify(body.graph.summary.humanSummary)).not.toContain("DECLINE");
  });

  it("keeps graph API OK and human summary null when saved mode reports are malformed", async () => {
    const malformedWhereJob = job({
      id: "job-malformed-summary",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 20,
        decision: "ACCEPTABLE",
        coverage: {},
        assessment: {},
        originPaths: [],
        whereIsMoneyReport: {
          subjectAddress: "TSubject111111111111111111111111111111",
          riskScore: "not-a-number"
        }
      }
    });
    const server = await start({
      ...deps(),
      getJob: async (id: string) => id === malformedWhereJob.id ? malformedWhereJob : null,
      listJobs: async () => {
        throw new Error("related jobs should not be loaded for malformed saved reports");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${malformedWhereJob.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        summary: {
          humanSummary: null
        }
      }
    });
  });

  it("does not mix related human summary jobs across null and non-null requester scope", async () => {
    const whereJob = job({
      id: "job-where-legacy-scope",
      chatId: null,
      requestedBy: null,
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: whereReportForAdminTest()
      }
    });
    const otherRequesterDeepJob = deepJobForAdminSummaryTest({
      chatId: "42",
      requestedBy: "42",
      windowStart: whereJob.windowStart,
      windowEnd: whereJob.windowEnd
    });
    const server = await start({
      ...deps(),
      getJob: async (id: string) => id === whereJob.id ? whereJob : null,
      listJobs: async () => [whereJob, otherRequesterDeepJob]
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${whereJob.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body.graph.summary.humanSummary)).not.toContain("whitebit");
    expect(body.graph.summary.humanSummary.modeSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "DeepCheck",
        facts: []
      })
    ]));
  });

  it("ignores malformed Deep provenance paths when composing human summary facts", async () => {
    const whereJob = job({
      id: "job-where-malformed-deep",
      chatId: "42",
      requestedBy: "42",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: whereReportForAdminTest()
      }
    });
    const malformedDeepJob = deepJobForAdminSummaryTest({
      chatId: "42",
      requestedBy: "42",
      windowStart: whereJob.windowStart,
      windowEnd: whereJob.windowEnd,
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [{
          subjectAddress: "TSubject111111111111111111111111111111",
          score: 70,
          paths: [{ label: "whitebit" }]
        }],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [],
        directCounterpartyInteractionProfiles: [],
        assetContinuationProfiles: [],
        stablecoinRestrictionProfiles: [],
        boundaryExposureProfiles: [],
        operationalFlowProfiles: [],
        walletRoleProfiles: [],
        extendedProvenanceProfiles: [],
        missingChecks: [],
        coverage: {},
        coverageDebug: {}
      }
    });
    const server = await start({
      ...deps(),
      getJob: async (id: string) => id === whereJob.id ? whereJob : null,
      listJobs: async () => [whereJob, malformedDeepJob]
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${whereJob.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body.graph.summary.humanSummary)).not.toContain("whitebit");
    expect(body.graph.summary.humanSummary.modeSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "DeepCheck",
        facts: []
      })
    ]));
  });

  it("ignores malformed Deep hard-evidence profiles when composing human summary facts", async () => {
    const whereJob = job({
      id: "job-where-malformed-deep-hard",
      chatId: "42",
      requestedBy: "42",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: whereReportForAdminTest()
      }
    });
    const malformedDeepJob = deepJobForAdminSummaryTest({
      chatId: "42",
      requestedBy: "42",
      windowStart: whereJob.windowStart,
      windowEnd: whereJob.windowEnd,
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        approvalDrainProvenanceProfiles: [{
          evidenceStrength: "exact_approval_and_transfer_from",
          score: 95
        }],
        directCounterpartyInteractionProfiles: [],
        assetContinuationProfiles: [{
          evidenceClass: "asset_continuation",
          tokenQuality: "verified",
          score: 84,
          reasons: ["Malformed asset continuation should be ignored."]
        }],
        stablecoinRestrictionProfiles: [{
          isBlacklisted: true
        }],
        boundaryExposureProfiles: [],
        operationalFlowProfiles: [],
        walletRoleProfiles: [],
        extendedProvenanceProfiles: [],
        missingChecks: [],
        coverage: {},
        coverageDebug: {}
      }
    });
    const server = await start({
      ...deps(),
      getJob: async (id: string) => id === whereJob.id ? whereJob : null,
      listJobs: async () => [whereJob, malformedDeepJob]
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/${whereJob.id}/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const text = JSON.stringify(body.graph.summary.humanSummary);
    expect(body.graph.summary.humanSummary).not.toBeNull();
    expect(text).not.toContain("Найдена точная drainer-цепочка");
    expect(text).not.toContain("Адрес находится в активном TRC20 USDT blacklist");
    expect(text).not.toContain("Найдена cross-chain или asset-continuation связь");
    expect(text).not.toContain("Malformed asset continuation should be ignored");
  });

  it("requires admin auth before refreshing DeepCheck second layer", async () => {
    let called = false;
    const server = await start({
      ...deps(),
      refreshDeepCheckSecondLayer: async () => {
        called = true;
        return { status: "refreshed", expanded: 1, queued: 0, notIndexed: 0 };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/refresh-second-layer`, {
      method: "POST"
    });

    expect(response.status).toBe(401);
    expect(called).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      error: "Admin authorization required."
    });
  });

  it("refreshes a completed DeepCheck second layer through the configured dependency", async () => {
    let receivedJobId = "";
    const server = await start({
      ...deps(),
      refreshDeepCheckSecondLayer: async (jobId: string) => {
        receivedJobId = jobId;
        return { status: "refreshed", expanded: 2, queued: 1, notIndexed: 0 };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/refresh-second-layer`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(receivedJobId).toBe("job-1");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { status: "refreshed", expanded: 2, queued: 1, notIndexed: 0 }
    });
  });

  it("returns a clear error when DeepCheck second-layer refresh is not configured", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/refresh-second-layer`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      error: "DeepCheck second-layer refresh is not configured."
    });
  });

  it("returns 400 for malformed DeepCheck second-layer refresh job ids", async () => {
    let called = false;
    const server = await start({
      ...deps(),
      refreshDeepCheckSecondLayer: async () => {
        called = true;
        return { status: "refreshed", expanded: 1, queued: 0, notIndexed: 0 };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/%zz/refresh-second-layer`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    expect(called).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job id."
    });
  });

  it("returns handler failures from DeepCheck second-layer refresh", async () => {
    const server = await start({
      ...deps(),
      refreshDeepCheckSecondLayer: async () => {
        throw new Error("refresh failed");
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/refresh-second-layer`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "refresh failed"
    });
  });

  it("returns targeted indexing progress graph for a waiting Where job", async () => {
    const waitingAddress = "TWaitingHop111111111111111111111111111";
    const fixture = job({
      status: "queued",
      progressJson: {
        jobPhase: "waiting_for_targeted_index",
        targetedIndex: {
          phase: "waiting_for_targeted_index",
          scoreValid: false,
          waitingFor: {
            address: waitingAddress,
            targetTimestamp: "2026-07-01T12:59:30.000Z",
            queuedReason: "where_is_money_hop",
            requiredFor: "where_hop"
          },
          lastIndexStatus: "running",
          pagesFetched: 400,
          transfersFetched: 8051,
          budgetPages: 800,
          attemptCount: 11,
          maxAttempts: 12,
          retryCount: 11,
          providerCapHit: true,
          budgetExhausted: true,
          requestCount: 400,
          rateLimitedCount: 0,
          forbiddenCount: 0,
          serverErrorCount: 0
        },
        targetedHistory: {
          totalTargetedStates: 3,
          queuedCount: 2,
          runningCount: 1,
          completeCount: 0,
          partialCount: 0,
          failedCount: 0
        }
      },
      resultJson: {}
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        job: { id: "job-1", status: "queued" },
        summary: {
          decision: "UNKNOWN",
          riskScore: null,
          layerSummary: {
            targetedIndex: {
              phase: "waiting_for_targeted_index",
              waitingForAddress: waitingAddress,
              pagesFetched: 400,
              transfersFetched: 8051
            },
            targetedHistory: {
              totalTargetedStates: 3,
              queuedCount: 2,
              runningCount: 1
            }
          }
        },
        limitations: [expect.objectContaining({
          code: "waiting_for_targeted_index",
          severity: "info"
        })]
      }
    });
  });

  it("hydrates waiting Where graph with targeted history progress from admin read model", async () => {
    let requestedJobId: string | null = null;
    const waitingAddress = "TWaitingHop111111111111111111111111111";
    const fixture = job({
      status: "queued",
      progressJson: {
        jobPhase: "waiting_for_targeted_index",
        targetedIndex: {
          phase: "waiting_for_targeted_index",
          waitingFor: {
            address: waitingAddress,
            targetTimestamp: "2026-07-01T12:59:30.000Z"
          },
          pagesFetched: 400,
          transfersFetched: 8051
        }
      },
      resultJson: {}
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture,
      getTargetedHistoryProgressForJob: async (jobId) => {
        requestedJobId = jobId;
        return {
          totalTargetedStates: 3,
          queuedCount: 2,
          runningCount: 1,
          completeCount: 0,
          partialCount: 0,
          failedCount: 0,
          fetchedPageCount: 1200,
          fetchedTransferCount: 24240
        };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(requestedJobId).toBe("job-1");
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        summary: {
          layerSummary: {
            targetedHistory: {
              totalTargetedStates: 3,
              queuedCount: 2,
              runningCount: 1,
              fetchedPageCount: 1200,
              fetchedTransferCount: 24240
            }
          }
        }
      }
    });
  });

  it("hydrates candidate-window progress for a waiting Where graph", async () => {
    let requestedJobId: string | null = null;
    const fixture = job({
      status: "queued",
      progressJson: {
        jobPhase: "checking_candidate_windows",
        targetedIndex: {
          phase: "checking_candidate_windows",
          candidateWindows: { total: 2, queued: 1, running: 1, complete: 0, terminal: 0, pending: 2 },
          broadFallback: "not_queued"
        }
      },
      resultJson: {}
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture,
      getTargetedHistoryProgressForJob: async (jobId) => {
        requestedJobId = jobId;
        return {
          totalTargetedStates: 2,
          queuedCount: 1,
          runningCount: 1,
          completeCount: 0,
          partialCount: 0,
          failedCount: 0,
          candidateWindows: {
            total: 2,
            queued: 1,
            running: 1,
            complete: 0,
            terminal: 0,
            pending: 2
          },
          states: [{
            address: "THop111111111111111111111111111111",
            status: "running",
            waitStatus: "waiting",
            requestKind: "candidate_window",
            windowStartTimestamp: "2026-07-04T11:55:00.000Z",
            windowEndTimestamp: "2026-07-04T12:00:00.000Z",
            targetTimestamp: "2026-07-04T12:00:00.000Z",
            candidateTxHash: "candidate-tx-1"
          }]
        };
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    expect(requestedJobId).toBe("job-1");
    await expect(response.json()).resolves.toMatchObject({
      graph: {
        summary: {
          layerSummary: {
            targetedIndex: {
              phase: "checking_candidate_windows",
              candidateWindows: {
                total: 2,
                queued: 1,
                running: 1,
                complete: 0,
                terminal: 0,
                pending: 2
              },
              broadFallback: "not_queued"
            },
            targetedHistory: {
              candidateWindows: {
                total: 2,
                queued: 1,
                running: 1
              },
              states: [expect.objectContaining({
                requestKind: "candidate_window",
                candidateTxHash: "candidate-tx-1"
              })]
            }
          },
          topReasons: [expect.stringContaining("candidate windows")]
        },
        limitations: [expect.objectContaining({
          code: "checking_candidate_windows",
          severity: "info"
        })]
      }
    });
  });

  it("enriches neighbor nodes with saved wallet risk without duplicating subject risk", async () => {
    const subject = "TSubject111111111111111111111111111111";
    const neighbor = "TNeighborRisk11111111111111111111111";
    const fixture = job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        decision: "REVIEW",
        riskScore: 45,
        coverage: {},
        assessment: {},
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: neighbor,
          direction: "inbound",
          txCount: 1,
          volumeRaw: "10000000",
          txHashes: ["tx-neighbor"]
        }]
      }
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture,
      findLatestSavedWalletRiskByAddresses: async (addresses: string[]) => {
        expect(addresses).toContain(neighbor);
        return new Map([[
          neighbor,
          {
            address: neighbor,
            jobId: "saved-risk-job",
            kind: "where_is_money_check",
            risk: 95,
            decision: "DECLINE",
            role: "drainer",
            evidence: "exact approval-drain",
            createdAt: "2026-06-28T00:00:00.000Z"
          }
        ], [
          subject,
          {
            address: subject,
            jobId: "subject-risk-job",
            kind: "address_deep_check",
            risk: 95,
            decision: "DECLINE",
            role: "collector",
            evidence: "subject duplicate",
            createdAt: "2026-06-28T00:00:00.000Z"
          }
        ]]);
      }
    } as AdminServerDeps);

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { graph: { nodes: Array<{ address: string | null; kind: string; metadata?: Record<string, unknown> }> } };
    const neighborNode = body.graph.nodes.find((node) => node.address === neighbor);
    const subjectNode = body.graph.nodes.find((node) => node.kind === "subject");
    expect(neighborNode?.metadata?.savedWalletRisk).toMatchObject({
      risk: 95,
      role: "drainer",
      evidence: expect.stringContaining("approval-drain"),
      kind: "where_is_money_check"
    });
    expect(subjectNode?.metadata?.savedWalletRisk).toBeUndefined();
  });

  it("enriches old deep-check counterparty tx hashes with indexed transfer rows", async () => {
    const fixture = job({
      kind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        decision: "REVIEW",
        riskScore: 40,
        coverage: {},
        assessment: {},
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: "TCounterparty1111111111111111111111111",
          direction: "outbound",
          txCount: 2,
          volumeRaw: "12000000",
          txHashes: ["tx-a", "tx-b"]
        }]
      }
    });
    const server = await start({
      ...deps(),
      getJob: async () => fixture,
      listIndexedUsdtTransfersByHashes: async (txHashes) => {
        expect(txHashes).toEqual(["tx-a", "tx-b"]);
        return [{
          txHash: "tx-a",
          blockNumber: 1,
          blockTimestamp: new Date("2026-06-25T09:49:03.000Z"),
          eventIndex: 0,
          fromAddress: "TSubject111111111111111111111111111111",
          toAddress: "TCounterparty1111111111111111111111111",
          amountRaw: "5000000",
          method: "transfer",
          callerAddress: null,
          contractRet: "SUCCESS",
          confirmed: true
        }, {
          txHash: "tx-b",
          blockNumber: 2,
          blockTimestamp: new Date("2026-06-25T09:50:03.000Z"),
          eventIndex: 0,
          fromAddress: "TSubject111111111111111111111111111111",
          toAddress: "TCounterparty1111111111111111111111111",
          amountRaw: "7000000",
          method: "transfer",
          callerAddress: null,
          contractRet: "SUCCESS",
          confirmed: true
        }];
      }
    });

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/job-1/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { graph: { edges: Array<Record<string, unknown>> } };
    expect(body.graph.edges).toEqual([expect.objectContaining({
      id: "edge:direct_counterparty:0",
      amountRaw: "12000000",
      txHash: null,
      metadata: expect.objectContaining({
        evidenceType: "grouped_transfers",
        aggregateTransferCount: 2,
        underlyingTransfers: [
          expect.objectContaining({
            txHash: "tx-a",
            amountRaw: "5000000",
            timestamp: "2026-06-25T09:49:03.000Z"
          }),
          expect.objectContaining({
            txHash: "tx-b",
            amountRaw: "7000000",
            timestamp: "2026-06-25T09:50:03.000Z"
          })
        ]
      })
    })]);
  });

  it("returns 404 for unknown job", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/missing/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forensic job not found."
    });
  });

  it("returns 400 for malformed forensic job id encoding", async () => {
    const server = await start();

    const response = await fetch(`${server.url}/admin/api/forensic-jobs/%zz/graph`, {
      headers: { authorization: "Bearer secret-token" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid forensic job id."
    });
  });
});
