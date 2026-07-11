import { describe, expect, it } from "vitest";
import { detectVerify20Fingerprint } from "../../src/forensics/verify20Fingerprint";
import { buildWherePreliminaryNarrative } from "../../src/bot/wherePreliminaryNarrative";
import type { BalanceFormingTransfer, WhereIsMoneyAgeSignal } from "../../src/types";
import {
  POISON_RAW_REASON,
  WHERE_SOURCE,
  WHERE_SUBJECT,
  approvalWhereReportFixture,
  bridgeWhereReportFixture,
  htxWhereReportFixture,
  sourceWhereReportFixture,
  whereAssessmentFixture,
  whereReportFixture,
  whereRiskLayerFixture
} from "../fixtures/forensics/wherePreliminaryNarrativeCases";

function text(result: ReturnType<typeof buildWherePreliminaryNarrative>): string {
  return [...result.sections.findings, result.sections.conclusion, result.sections.coverage]
    .filter(Boolean).join(" ");
}

const forbiddenPreliminaryActions = {
  ru: /нужно|проверь|проверить|ручн|пауза|отозва|операци/i,
  en: /\b(?:should|must|pause|revoke|proceed)\b|manual review|review\b[^.]{0,80}\bmanually/i
} as const;

function collidingFactReport(target: "approval" | "bridge" | "sanction" | "contract") {
  const sharedEvidenceId = "drain-tx";
  const approval = approvalWhereReportFixture("victim");
  const bridge = sourceWhereReportFixture({
    kind: "cross_chain_boundary", score: 78, share: 0.4, label: "UsdtOFT"
  });
  const sanction = sourceWhereReportFixture({
    kind: "sanctioned_service", score: 90, share: 0.3, label: "Sanctioned X"
  });
  for (const source of [bridge, sanction]) {
    const path = source.originPaths[0]!;
    path.balanceTransferTxHash = sharedEvidenceId;
    path.txHashes = [sharedEvidenceId];
    path.steps = path.steps.map((step) => ({ ...step, txHash: sharedEvidenceId }));
    source.assessment.sourcePolicyEvidence[0]!.evidenceIds = [sharedEvidenceId];
  }
  const drivers = {
    approval: whereRiskLayerFixture("approval_drain", 95, "hard_proof", [sharedEvidenceId]),
    bridge: whereRiskLayerFixture(
      "cross_chain_boundary", 78, "source_policy", [sharedEvidenceId], "cross_chain_boundary"
    ),
    sanction: whereRiskLayerFixture(
      "sanctioned_service", 90, "source_policy", [sharedEvidenceId], "sanctioned_service"
    ),
    contract: whereRiskLayerFixture("drainer_like", 72, "contract_suspicion", [sharedEvidenceId])
  } as const;
  const driver = drivers[target];
  const contract = whereRiskLayerFixture("drainer_like", 72, "contract_suspicion", [sharedEvidenceId]);
  return whereReportFixture({
    riskScore: driver.score,
    originPaths: [...bridge.originPaths, ...sanction.originPaths],
    approvalDrainProvenanceProfiles: approval.approvalDrainProvenanceProfiles,
    assessment: whereAssessmentFixture({
      riskScore: driver.score,
      sourcePolicyEvidence: [
        ...bridge.assessment.sourcePolicyEvidence,
        ...sanction.assessment.sourcePolicyEvidence
      ],
      contractSuspicionEvidence: [contract],
      riskLayers: [driver],
      dominantRiskLayer: driver
    })
  });
}

describe("buildWherePreliminaryNarrative", () => {
  it("binds 78 to the dominant 83% bridge fact", () => {
    const result = buildWherePreliminaryNarrative(
      bridgeWhereReportFixture({ score: 78, share: 0.83, transferCount: 10 }),
      { locale: "ru" }
    );
    expect(result.score).toBe(78);
    expect(result.sections.findings[0]).toMatch(/83%.*UsdtOFT.*10 перевод/i);
    expect(result.sections.conclusion).toMatch(/скрывает.*источник|затруднить.*происхожд/i);
    expect(result.preferredFactId).toBeTruthy();
    expect(result.diagnosticCode).toBeNull();
  });

  it.each([false, undefined])("hides score for scoreValid=%s", (validity) => {
    const report = bridgeWhereReportFixture({ score: 78, scoreValid: false });
    if (validity === undefined) {
      delete report.scoreValid;
      delete report.assessment.scoreValid;
    }
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.score).toBeNull();
    expect(result.sections.findings).toEqual([]);
    expect(result.sections.conclusion).toBeNull();
    expect(result.sections.coverage).toBeTruthy();
  });

  it.each(
    ([true, false, undefined] as const).flatMap((top) =>
      ([true, false, undefined] as const).map((assessment) => ({
        top,
        assessment,
        expected: top !== false && assessment !== false && (top === true || assessment === true)
      }))
    )
  )("applies strict validity mirrors top=$top assessment=$assessment", ({ top, assessment, expected }) => {
    const report = bridgeWhereReportFixture();
    if (top === undefined) delete report.scoreValid;
    else report.scoreValid = top;
    if (assessment === undefined) delete report.assessment.scoreValid;
    else report.assessment.scoreValid = assessment;
    const result = buildWherePreliminaryNarrative(report, { locale: "en" });
    expect(result.score).toBe(expected ? 78 : null);
    expect(result.diagnosticCode).toBeNull();
  });

  it("fails closed when no typed fact explains a valid score", () => {
    const report = bridgeWhereReportFixture({ score: 78 });
    report.originPaths = [];
    report.assessment.sourcePolicyEvidence = [];
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.score).toBeNull();
    expect(result.sections.findings).toEqual([]);
    expect(result.diagnosticCode).toBe("where_preliminary_score_without_structured_fact");
  });

  it.each([
    ["victim", /жертва/i, /дрейнер-контракт/i],
    ["first_receiver", /перв(ым|ый) получ/i, /жертва/i],
    ["route_linked", /дальше.*маршрут|следующее звено/i, /жертва/i]
  ] as const)("uses exact approval role %s", (role, expected, forbidden) => {
    const result = buildWherePreliminaryNarrative(approvalWhereReportFixture(role), { locale: "ru" });
    expect(result.score).toBe(95);
    expect(result.sections.findings[0]).toMatch(expected);
    expect(text(result)).not.toMatch(forbidden);
  });

  it.each([
    ["mixer", 88, "Mixer X", /Mixer X/i, /нельзя надёжно проследить/i],
    ["sanctioned_service", 90, "Sanctioned X", /санкцион/i, /санкционн.*источник/i],
    ["allowlisted_cex", 18, "Binance", /Binance/i, /общ.*ликвидност|сервис/i]
  ] as const)("renders typed source %s", (kind, score, label, finding, conclusion) => {
    const result = buildWherePreliminaryNarrative(
      sourceWhereReportFixture({ kind, score, share: 0.61, label }),
      { locale: "ru" }
    );
    expect(result.score).toBe(score);
    expect(result.sections.findings[0]).toMatch(finding);
    expect(result.sections.conclusion).toMatch(conclusion);
    expect(result.diagnosticCode).toBeNull();
  });

  it("describes historical HTX without calling it a sanctioned transfer", () => {
    const result = buildWherePreliminaryNarrative(htxWhereReportFixture("historical"), { locale: "ru" });
    expect(result.score).toBe(55);
    expect(text(result)).toMatch(/до.*санкцион/i);
    expect(result.sections.conclusion).toMatch(/compliance|провер.*происхожд/i);
  });

  it("uses an exact subject-bound Fast blacklist reason", () => {
    const report = whereReportFixture({
      riskScore: 95,
      fastWalletRisk: {
        subjectAddress: WHERE_SUBJECT,
        level: "CRITICAL",
        score: 95,
        reasons: [{ code: "stablecoin_usdt_blacklisted", message: POISON_RAW_REASON, scoreImpact: 95, evidenceRef: "fast-blacklist" }]
      },
      assessment: whereAssessmentFixture({
        riskScore: 95,
        hardBadEvidence: [{ kind: "fast_critical", score: 95, message: POISON_RAW_REASON, evidenceIds: ["fast-blacklist"] }],
        dominantRiskLayer: whereRiskLayerFixture("stablecoin_usdt_blacklisted", 95, "hard_proof", ["fast-blacklist"])
      })
    });
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.score).toBe(95);
    expect(result.sections.findings[0]).toMatch(/чёрн.*списк.*USDT|USDT.*чёрн.*списк/i);
    expect(text(result)).toMatch(/заморож/i);
  });

  it.each(["ru", "en"] as const)("keeps preliminary Fast behavior copy action-free in %s", (locale) => {
    const driver = whereRiskLayerFixture(
      "address_behavior_drain_to_service_infrastructure",
      45,
      "behavior_context",
      ["fast-behavior"]
    );
    const report = whereReportFixture({
      riskScore: 45,
      fastWalletRisk: {
        subjectAddress: WHERE_SUBJECT,
        level: "MEDIUM",
        score: 45,
        reasons: [{
          code: "address_behavior_drain_to_service_infrastructure",
          message: POISON_RAW_REASON,
          scoreImpact: 45,
          evidenceRef: "fast-behavior"
        }]
      },
      assessment: whereAssessmentFixture({ riskScore: 45, riskLayers: [driver], dominantRiskLayer: driver })
    });
    const result = buildWherePreliminaryNarrative(report, { locale });
    expect(result.score).toBe(45);
    expect(text(result)).not.toMatch(forbiddenPreliminaryActions[locale]);
  });

  it("requires a full, trusted-service-free, subject-bound Verify20 fingerprint", () => {
    const fingerprint = detectVerify20Fingerprint({
      methodMap: {
        "5082dd12": "Verify20(address,address,address,uint256)",
        fc61dd23: "Verify10(address,uint256)",
        ea4418d9: "withdrawAllTrxTo(address)",
        f2fde38b: "transferOwnership(address)"
      },
      topMethods: []
    });
    const driver = whereRiskLayerFixture("verify20_template", 85, "contract_suspicion", ["verify20:5082dd12"]);
    const report = whereReportFixture({
      riskScore: 85,
      assessment: whereAssessmentFixture({ riskScore: 85, contractSuspicionEvidence: [driver], dominantRiskLayer: driver })
    });
    const result = buildWherePreliminaryNarrative(report, {
      locale: "ru",
      verify20: { subjectAddress: WHERE_SUBJECT, role: "verify20_contract", fingerprint, debitObserved: false }
    });
    expect(result.score).toBe(85);
    expect(text(result)).toMatch(/полный шаблон Verify20/i);
    expect(text(result)).toMatch(/не доказывает конкретное списание/i);
  });

  it.each([
    {
      name: "one selector",
      methodMap: { "5082dd12": "Verify20(address,address,address,uint256)" },
      serviceLabel: null
    },
    {
      name: "ordinary transferFrom",
      methodMap: { "23b872dd": "transferFrom(address,address,uint256)" },
      serviceLabel: null
    },
    {
      name: "trusted service guard",
      methodMap: {
        "5082dd12": "Verify20(address,address,address,uint256)",
        fc61dd23: "Verify10(address,uint256)",
        ea4418d9: "withdrawAllTrxTo(address)",
        f2fde38b: "transferOwnership(address)"
      },
      serviceLabel: "Trusted Service"
    }
  ])("does not publish Verify20 from $name", ({ methodMap, serviceLabel }) => {
    const report = whereReportFixture({ riskScore: 85 });
    const fingerprint = detectVerify20Fingerprint({
      methodMap: methodMap as unknown as Record<string, string>,
      topMethods: [],
      serviceLabel
    });
    const result = buildWherePreliminaryNarrative(report, {
      locale: "en",
      verify20: { subjectAddress: WHERE_SUBJECT, role: "verify20_contract", fingerprint, debitObserved: false }
    });
    expect(result.score).toBeNull();
    expect(text(result)).not.toMatch(/Verify20|specific debit/i);
  });

  it.each(["approval_only", "interaction_only"] as const)("does not publish action-bearing Verify20 role %s", (role) => {
    const fingerprint = detectVerify20Fingerprint({
      methodMap: {
        "5082dd12": "Verify20(address,address,address,uint256)",
        fc61dd23: "Verify10(address,uint256)",
        ea4418d9: "withdrawAllTrxTo(address)",
        f2fde38b: "transferOwnership(address)"
      },
      topMethods: []
    });
    const driver = whereRiskLayerFixture("verify20_template", 85, "contract_suspicion", ["verify20:5082dd12"]);
    const report = whereReportFixture({
      riskScore: 85,
      assessment: whereAssessmentFixture({ riskScore: 85, contractSuspicionEvidence: [driver], dominantRiskLayer: driver })
    });
    const result = buildWherePreliminaryNarrative(report, {
      locale: "ru",
      verify20: { subjectAddress: WHERE_SUBJECT, role, fingerprint, debitObserved: false }
    });
    expect(result.score).toBeNull();
    expect(text(result)).not.toMatch(forbiddenPreliminaryActions.ru);
  });

  it.each(["victim", "first_receiver"] as const)("ignores subject-mismatched approval profile for %s", (role) => {
    const report = approvalWhereReportFixture(role);
    report.approvalDrainProvenanceProfiles[0]!.subjectAddress = WHERE_SOURCE;
    const result = buildWherePreliminaryNarrative(report, { locale: "en" });
    expect(result.score).toBeNull();
    expect(result.diagnosticCode).toBe("where_preliminary_score_without_structured_fact");
    expect(result.sections.findings).toEqual([]);
  });

  it.each([
    ["drainer_like", /похож.*списан/i],
    ["unknown_suspicious", /подозрительн.*неизвест/i]
  ] as const)("renders typed contract suspicion %s", (kind, expected) => {
    const driver = whereRiskLayerFixture(kind, 72, "contract_suspicion", [`contract:${kind}`]);
    const report = whereReportFixture({
      riskScore: 72,
      assessment: whereAssessmentFixture({ riskScore: 72, contractSuspicionEvidence: [driver], dominantRiskLayer: driver })
    });
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.score).toBe(72);
    expect(result.sections.findings[0]).toMatch(expected);
    expect(text(result)).toMatch(/точн.*списан.*не подтвержден/i);
  });

  it("renders a typed unresolved origin without a clean or crime claim", () => {
    const driver = whereRiskLayerFixture("unresolved_origin", 45, "unknown_origin", ["unknown-1"]);
    const report = whereReportFixture({
      riskScore: 45,
      assessment: whereAssessmentFixture({ riskScore: 45, unknownOriginEvidence: [driver], dominantRiskLayer: driver })
    });
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.score).toBe(45);
    expect(text(result)).toMatch(/происхожд.*не установ/i);
    expect(text(result)).not.toMatch(/чист|преступ/i);
  });

  it.each([
    ["subject_new_large_wallet", /нов.*кошел.*крупн/i],
    ["relationship_new", /основн.*отправител.*нов/i],
    ["dormancy_gap", /долг.*неактив/i],
    ["relationship_repeated", /повторн|устоявш/i]
  ] as const)("renders typed age signal %s", (code, expected) => {
    const signal: WhereIsMoneyAgeSignal = {
      code,
      scoreImpact: code === "relationship_repeated" ? -5 : 12,
      message: POISON_RAW_REASON,
      value: 30,
      evidenceIds: [`age:${code}`]
    };
    const driver = whereRiskLayerFixture(code, 35, "behavior_context", signal.evidenceIds);
    const report = whereReportFixture({
      riskScore: 35,
      assessment: whereAssessmentFixture({
        riskScore: 35,
        ageSignals: {
          subjectFirstSeenAt: null,
          subjectAgeDays: null,
          subjectActiveDays: 1,
          directSenderMedianAgeDays: null,
          oldestDirectSenderAgeDays: null,
          repeatedRelationshipCount: 2,
          longestRelationshipAgeDays: 30,
          maxDormancyGapDays: 90,
          signals: [signal]
        },
        riskLayers: [driver],
        dominantRiskLayer: driver
      })
    });
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.score).toBe(35);
    expect(result.sections.findings[0]).toMatch(expected);
  });

  it.each(["ru", "en"] as const)("keeps preliminary age meaning action-free in %s", (locale) => {
    const signal: WhereIsMoneyAgeSignal = {
      code: "dormancy_gap",
      scoreImpact: 12,
      message: POISON_RAW_REASON,
      value: 90,
      evidenceIds: ["age:dormancy_gap"]
    };
    const driver = whereRiskLayerFixture("dormancy_gap", 35, "behavior_context", signal.evidenceIds);
    const report = whereReportFixture({
      riskScore: 35,
      assessment: whereAssessmentFixture({
        riskScore: 35,
        ageSignals: {
          subjectFirstSeenAt: null, subjectAgeDays: null, subjectActiveDays: 1,
          directSenderMedianAgeDays: null, oldestDirectSenderAgeDays: null,
          repeatedRelationshipCount: 0, longestRelationshipAgeDays: null, maxDormancyGapDays: 90,
          signals: [signal]
        },
        riskLayers: [driver],
        dominantRiskLayer: driver
      })
    });
    const result = buildWherePreliminaryNarrative(report, { locale });
    expect(result.score).toBe(35);
    expect(text(result)).not.toMatch(forbiddenPreliminaryActions[locale]);
  });

  it("adds an exact GasFree fee only as non-driving technical detail", () => {
    const report = bridgeWhereReportFixture({ transferCount: 1 });
    const fee: BalanceFormingTransfer = {
      txHash: "fee-tx",
      fromAddress: WHERE_SOURCE,
      toAddress: WHERE_SUBJECT,
      amountRaw: "3000000",
      timestamp: "2026-06-01T00:00:00.000Z",
      coverageShare: 0.03,
      selectedReason: "covers_current_balance",
      economicRole: "service_fee",
      economicProtocol: "tron_gasfree"
    };
    report.balanceFormingTransfers = [fee];
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.score).toBe(78);
    expect(result.preferredFactId).toMatch(/cross-chain/);
    expect(text(result)).toMatch(/GasFree.*3 USDT/i);
  });

  it("does not infer a GasFree fee from TLnt, amount, and time", () => {
    const report = bridgeWhereReportFixture({ transferCount: 1 });
    report.balanceFormingTransfers = [{
      txHash: "heuristic-only",
      fromAddress: WHERE_SOURCE,
      toAddress: "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird",
      amountRaw: "3000000",
      timestamp: "2026-06-01T00:00:00.000Z",
      coverageShare: 0.03,
      selectedReason: "covers_current_balance"
    }];
    expect(text(buildWherePreliminaryNarrative(report, { locale: "ru" }))).not.toMatch(/комис|GasFree/i);
  });

  it.each(["fast", "verify20"] as const)("ignores mismatched %s subjects and fails closed", (kind) => {
    const report = whereReportFixture({ riskScore: 95 });
    if (kind === "fast") {
      report.fastWalletRisk = {
        subjectAddress: WHERE_SOURCE,
        level: "CRITICAL",
        score: 95,
        reasons: [{ code: "stablecoin_usdt_blacklisted", message: POISON_RAW_REASON, scoreImpact: 95 }]
      };
      const driver = whereRiskLayerFixture("stablecoin_usdt_blacklisted", 95, "hard_proof", []);
      report.assessment = whereAssessmentFixture({ riskScore: 95, dominantRiskLayer: driver, hardBadEvidence: [] });
    }
    const fingerprint = detectVerify20Fingerprint({
      methodMap: {
        "5082dd12": "Verify20(address,address,address,uint256)", fc61dd23: "Verify10(address,uint256)",
        ea4418d9: "withdrawAllTrxTo(address)", f2fde38b: "transferOwnership(address)"
      }, topMethods: []
    });
    const result = buildWherePreliminaryNarrative(report, {
      locale: "ru",
      verify20: kind === "verify20"
        ? { subjectAddress: WHERE_SOURCE, role: "verify20_contract", fingerprint, debitObserved: false }
        : null
    });
    expect(result.score).toBeNull();
    expect(text(result)).not.toMatch(/Verify20|чёрн.*списк/i);
  });

  it("never publishes poison raw strings", () => {
    const result = buildWherePreliminaryNarrative(bridgeWhereReportFixture(), { locale: "en" });
    expect(text(result)).not.toContain(POISON_RAW_REASON);
    expect(result.sections.findings[0]).toMatch(/83%.*UsdtOFT.*10 transfers/i);
  });

  it("keeps the matching driver ahead of an unrelated higher-ranked fact", () => {
    const report = bridgeWhereReportFixture({ score: 78, transferCount: 2 });
    report.fastWalletRisk = {
      subjectAddress: WHERE_SUBJECT,
      level: "CRITICAL",
      score: 95,
      reasons: [{ code: "stablecoin_usdt_blacklisted", message: POISON_RAW_REASON, scoreImpact: 95, evidenceRef: "unrelated-fast" }]
    };
    const result = buildWherePreliminaryNarrative(report, { locale: "en" });
    expect(result.score).toBe(78);
    expect(result.sections.findings[0]).toMatch(/UsdtOFT/);
    expect(result.preferredFactId).toMatch(/cross-chain/);
  });

  it.each([
    ["approval", /^approval-drain:/],
    ["bridge", /^cross-chain:/],
    ["sanction", /^sanctioned-source:/],
    ["contract", /^where-contract:/]
  ] as const)("uses semantic compatibility for colliding %s evidence", (target, expectedId) => {
    const result = buildWherePreliminaryNarrative(collidingFactReport(target), { locale: "en" });
    expect(result.score).not.toBeNull();
    expect(result.preferredFactId).toMatch(expectedId);
  });

  it("fails closed instead of using an unrelated exact Fast fallback", () => {
    const report = bridgeWhereReportFixture({ score: 78 });
    report.originPaths = [];
    report.assessment.sourcePolicyEvidence = [];
    report.fastWalletRisk = {
      subjectAddress: WHERE_SUBJECT,
      level: "CRITICAL",
      score: 95,
      reasons: [{
        code: "stablecoin_usdt_blacklisted",
        message: POISON_RAW_REASON,
        scoreImpact: 95,
        evidenceRef: "unrelated-fast-blacklist"
      }]
    };
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.score).toBeNull();
    expect(result.diagnosticCode).toBe("where_preliminary_score_without_structured_fact");
    expect(result.sections.findings).toEqual([]);
    expect(text(result)).not.toMatch(/чёрн.*списк|заморож/i);
  });

  it.each(["ru", "en"] as const)("fails closed for unnamed allowlisted CEX in %s", (locale) => {
    const report = sourceWhereReportFixture({ kind: "allowlisted_cex", score: 18, share: 0.61 });
    const result = buildWherePreliminaryNarrative(report, { locale });
    expect(result.score).toBeNull();
    expect(result.diagnosticCode).toBe("where_preliminary_score_without_structured_fact");
    expect(result.sections.findings).toEqual([]);
  });

  it.each(["ru", "en"] as const)("publishes named allowlisted CEX from structured identity in %s", (locale) => {
    const report = sourceWhereReportFixture({ kind: "allowlisted_cex", score: 18, share: 0.61, label: "Binance" });
    const result = buildWherePreliminaryNarrative(report, { locale });
    expect(result.score).toBe(18);
    expect(result.sections.findings[0]).toContain("Binance");
    expect(result.preferredFactId).toMatch(/^cex:/);
  });

  it("uses a report-score-matched fallback instead of a higher mismatched candidate", () => {
    const bridge = sourceWhereReportFixture({ kind: "cross_chain_boundary", score: 68, label: "Bridge A" });
    const contract = whereRiskLayerFixture("unknown_suspicious", 72, "contract_suspicion", ["contract-high"]);
    bridge.assessment.dominantRiskLayer = null;
    bridge.assessment.contractSuspicionEvidence = [contract];
    const result = buildWherePreliminaryNarrative(bridge, { locale: "en" });
    expect(result.score).toBe(68);
    expect(result.sections.findings[0]).toMatch(/Bridge A/i);
    expect(result.preferredFactId).toMatch(/cross-chain/);
  });

  it("fails closed when no typed driver matches the published score", () => {
    const report = sourceWhereReportFixture({ kind: "cross_chain_boundary", score: 68, label: "Bridge A" });
    const contract = whereRiskLayerFixture("unknown_suspicious", 72, "contract_suspicion", ["contract-high"]);
    report.assessment.sourcePolicyEvidence = [];
    report.assessment.dominantRiskLayer = contract;
    report.assessment.contractSuspicionEvidence = [contract];
    const result = buildWherePreliminaryNarrative(report, { locale: "en" });
    expect(result.score).toBeNull();
    expect(result.diagnosticCode).toBe("where_preliminary_score_without_structured_fact");
  });

  it.each([
    ["ru", 1, "Проверен 1 входящий перевод"],
    ["ru", 2, "Проверены 2 входящих перевода"],
    ["en", 1, "Checked 1 inbound transfer"],
    ["en", 2, "Checked 2 inbound transfers"]
  ] as const)("uses correct %s coverage grammar for %s", (locale, count, expected) => {
    const report = sourceWhereReportFixture({ kind: "allowlisted_cex", score: 18, label: "Binance" });
    report.coverage.selectedInboundTxCount = count;
    const result = buildWherePreliminaryNarrative(report, { locale });
    expect(result.sections.coverage).toContain(expected);
    if (locale === "en" && count === 1) {
      expect(result.sections.coverage).not.toContain("Checked 1 inbound transfers");
    }
  });

  it("keeps repeated bridge fixture shares, amounts, and coverage aligned", () => {
    const report = bridgeWhereReportFixture({ share: 0.83, transferCount: 3 });
    expect(report.originPaths.reduce((sum, path) => sum + (path.balanceShare ?? 0), 0)).toBeCloseTo(0.83);
    expect(report.originPaths.reduce((sum, path) => sum + (path.effectiveExposureShare ?? 0), 0)).toBeCloseTo(0.83);
    expect(report.originPaths.reduce(
      (sum, path) => sum + BigInt(path.steps[0]!.amountRaw), 0n
    )).toBe(83_000_000_000n);
    expect(report.assessment.sourcePolicyEvidence[0]!.pathCount).toBe(3);
    expect(report.coverage.selectedInboundTxCount).toBe(3);
  });

  it.each([
    ["provider_cap_unresolved", /provider/i],
    ["insufficient_coverage", /not enough data|недостаточно данных/i],
    ["local_budget_limited", /local.*limit|локальн/i],
    ["local_index_read_failed", /local.*index|локальн.*индекс/i]
  ] as const)("translates no-score coverage %s", (code, expected) => {
    const report = whereReportFixture({ scoreValid: false });
    report.assessment.scoreValid = false;
    report.scoreBlockedReason = code;
    const result = buildWherePreliminaryNarrative(report, { locale: "en" });
    expect(result.sections.coverage).toMatch(expected);
    expect(result.sections.coverage).not.toContain(code);
  });

  it("keeps no more than two nonduplicate facts and fits the selector budget", () => {
    const report = bridgeWhereReportFixture();
    report.assessment.ageSignals = {
      subjectFirstSeenAt: null, subjectAgeDays: null, subjectActiveDays: 1,
      directSenderMedianAgeDays: null, oldestDirectSenderAgeDays: null,
      repeatedRelationshipCount: 0, longestRelationshipAgeDays: null, maxDormancyGapDays: null,
      signals: [{ code: "subject_new_large_wallet", scoreImpact: 5, message: POISON_RAW_REASON, value: 1, evidenceIds: ["age-1"] }]
    };
    const result = buildWherePreliminaryNarrative(report, { locale: "ru" });
    expect(result.sections.findings.length).toBeLessThanOrEqual(2);
    expect([result.sections.findings.join(" "), result.sections.conclusion, result.sections.coverage].filter(Boolean).join(" ").length).toBeLessThanOrEqual(500);
  });
});
