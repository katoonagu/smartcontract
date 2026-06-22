import { describe, expect, it } from "vitest";
import {
  TELEGRAM_MESSAGE_LIMIT,
  formatAdminApprovalAlert,
  formatAdminSuspiciousAlert,
  formatDigestAlert,
  formatIncomingDepositRiskAlert,
  formatUserApprovalAlert,
  formatUserApprovalContextResultAlert,
  formatUserApprovalPendingAlert,
  formatUserIncomingAlert
} from "../../src/alerts/formatters";
import { escapeHtml, formatRiskLine } from "../../src/alerts/telegramHtml";

const report = {
  subjectAddress: "TSender111111111111111111111111111111",
  level: "HIGH" as const,
  score: 82,
  reasons: [
    { code: "split_pattern", message: "Repeated split transfers detected", scoreImpact: 30 },
    { code: "risky_1_hop", message: "1-hop connection to risky address", scoreImpact: 35 }
  ]
};

const incomingDepositBaseInput = {
  jobId: "job-123",
  amount: "384064.001319",
  watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
  sender: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
  txHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
  timestamp: new Date("2026-05-31T11:02:00.000Z"),
  report: {
    decision: "DECLINE" as const,
    depositRiskScore: 68,
    riskBand: "HIGH" as const,
    fastSenderRisk: {
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      score: 0,
      level: "LOW" as const,
      reasons: []
    },
    originPaths: [],
    originCoverage: 0.76,
    fundingCoverage: {
      depositFundingCoverageRatio: 0.76,
      cleanSourceCoverageRatio: 0,
      exactContinuityCoverageRatio: 0.76
    },
    corridorSummary: null,
    provenanceConfidence: 62,
    dataQuality: "medium" as const,
    senderRole: "fresh_one_shot_wallet",
    hardBadEvidence: [],
    contractVerdicts: [
      {
        source: "llm" as const,
        cacheMatch: null,
        reusedFromContractAddress: null,
        providerLabel: "deepseek",
        model: "deepseek-v4-pro",
        contractAddress: "TFcRNwncqXxa8ReHxmPh4jo6yFdFLR5hvh",
        caseFileHash: "case-hash",
        cacheId: null,
        verdict: "unknown_suspicious" as const,
        confidence: 0.78,
        contractRiskScore: 68,
        decisionRecommendation: "DECLINE" as const,
        reasons: ["Unknown contract funded sender shortly before deposit."],
        citedEvidenceIds: ["48d33"],
        falsePositiveNotes: []
      }
    ],
    reasons: ["Sender was funded shortly before this deposit by unknown smart contract."],
    warnings: []
  }
};

describe("alert formatters", () => {
  it("formats user incoming alert with score, HTML parse mode, and reasons", () => {
    const message = formatUserIncomingAlert({
      amount: "12450",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("<b>Incoming USDT</b>");
    expect(message.text).toContain("<b>Watched wallet</b>: <code>TWallet111111111111111111111111111111</code>");
    expect(message.text).toContain("<b>High risk</b>");
    expect(message.text).toContain("<code>82/100</code>");
    expect(message.text).toContain("Repeated split transfers detected");
  });

  it("formats final incoming deposit risk in Russian by default with sender risk separated", () => {
    const message = formatIncomingDepositRiskAlert(incomingDepositBaseInput);

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("<b>Входящий USDT");
    expect(message.text).toContain("31.05.2026 14:02 MSK");
    expect(message.text).toContain("<b>Решение</b>: <code>DECLINE</code>");
    expect(message.text).toContain("<b>Риск депозита</b>: 🟠 <code>68/100</code> (<code>HIGH</code>)");
    expect(message.text).toContain("<b>Быстрая проверка отправителя</b>: <code>0/100</code> (<code>LOW</code>)");
    expect(message.text).toContain("<b>Покрытие депозита</b>: <code>76%</code>");
    expect(message.text).toContain("<b>Чистый источник</b>: <code>0%</code>");
    expect(message.text).toContain("<b>уверенность</b>: <code>средняя</code>");
    expect(message.text).toContain("<b>Роль отправителя</b>");
    expect(message.text).not.toContain("Data quality");
    expect(message.text).toContain("<b>AI-оценка контракта</b>");
    expect(message.text).toContain("unknown_suspicious 68/100 для");
    expect(message.text).not.toContain("<b>AI contract verdict</b>");
    expect(message.text).not.toContain("<b>Fast sender check</b>");
    expect(message.text).not.toContain("68/100 for");
    expect(message.text).toContain("Unknown contract funded sender shortly before deposit.");
    expect(message.text).toContain("Sender was funded shortly before this deposit by unknown smart contract.");
    expect(message.text).not.toContain("Low risk: <code>0/100</code>");
    expect(JSON.stringify(message.replyMarkup?.inline_keyboard)).toContain("check:deposit:job-123");
  });

  it("formats final incoming deposit risk in English when requested", () => {
    const message = formatIncomingDepositRiskAlert({ ...incomingDepositBaseInput, locale: "en" });

    expect(message.text).toContain("<b>Incoming USDT");
    expect(message.text).toContain("May 31, 2026 14:02 MSK");
    expect(message.text).toContain("<b>Decision</b>: <code>DECLINE</code>");
    expect(message.text).toContain("<b>Deposit risk</b>: 🟠 <code>68/100</code> (<code>HIGH</code>)");
    expect(message.text).toContain("<b>Fast sender check</b>: <code>0/100</code> (<code>LOW</code>)");
    expect(message.text).toContain("<b>AI contract verdict</b>");
    expect(message.text).toContain("unknown_suspicious 68/100 for");
    expect(message.text).toContain("<b>Deposit funding coverage</b>: <code>76%</code>");
    expect(message.text).toContain("<b>clean-source proof</b>: <code>0%</code>");
    expect(message.text).toContain("<b>origin confidence</b>: <code>medium</code>");
    expect(message.text).not.toContain("Data quality");
  });

  it("shows historical HTX/Huobi context without source-proof wording in incoming deposit alerts", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        reasons: [
          "Historical HTX/Huobi sender inflow is 51% of incoming wallet volume; background context only, not fresh deposit proof."
        ]
      }
    });

    expect(message.text).toContain("Historical HTX/Huobi sender inflow");
    expect(message.text).toContain("background context only, not fresh deposit proof");
    expect(message.text).not.toContain("100% of selected provenance target");
  });

  it("adds shared incoming exposure context without mixing source proof and history", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        sourceBundleExposure: {
          scope: "incoming_deposit",
          targetAmountRaw: "1000000000",
          coveredAmountRaw: "700000000",
          coverageRatio: 0.7,
          htxHuobiShare: 0.7,
          cleanCexShare: 0,
          bridgeRouterDexShare: 0,
          unknownContractShare: 0,
          riskyLabelShare: 0,
          unknownShare: 0.3,
          dominantSource: "htx_huobi",
          evidenceTxHashes: ["fresh-source-proof-tx"],
          reasons: [],
          warnings: [],
          budget: {
            maxDepth: 7,
            fetchedAddressCount: 12,
            maxAddressFetches: 12,
            liveTransferReadCount: 20,
            skippedAddressCount: 1,
            exhausted: true,
            exhaustedPhase: "trace"
          },
          unresolvedBoundary: {
            kind: "bridge_router_dex",
            affectedShare: 0.3,
            scoreFloor: 55,
            reason: "Source bundle coverage-limited: unresolved bridge/router/DEX boundary remains after the graph budget stopped.",
            evidenceTxHashes: ["boundary-proof-tx"]
          }
        },
        subjectExposureProfile: {
          subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
          windowStart: "2026-06-01T00:00:00.000Z",
          windowEnd: "2026-06-04T00:00:00.000Z",
          transferEventsScanned: 40,
          incomingVolumeRaw: "2000000000",
          outgoingVolumeRaw: "1800000000",
          htxHuobiIncomingShare: 0.4,
          cleanCexIncomingShare: 0,
          bridgeRouterDexVolumeShare: 0.2,
          unknownContractVolumeShare: 0,
          unknownSourceShare: 0.4,
          inOutVelocityScore: 5,
          scoreContribution: 12,
          reasons: [],
          warnings: []
        }
      }
    });

    expect(message.text).toContain("HTX/Huobi funds 70% of the selected amount.");
    expect(message.text).toContain("Historical HTX/Huobi exposure is context, not selected-amount source proof.");
    expect(message.text).toContain("The graph stopped before resolving a material bridge/router/DEX boundary.");
    expect(message.text).not.toContain("fresh-source-proof-tx");
    expect(message.text).not.toContain("boundary-proof-tx");
    expect(message.text).not.toContain("Historical HTX/Huobi funds 70% of the selected amount");
  });

  it("labels non-bridge unresolved source boundaries in incoming deposit alerts", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        sourceBundleExposure: {
          scope: "incoming_deposit",
          targetAmountRaw: "1000000000",
          coveredAmountRaw: "300000000",
          coverageRatio: 0.3,
          htxHuobiShare: 0,
          cleanCexShare: 0,
          bridgeRouterDexShare: 0,
          unknownContractShare: 0,
          riskyLabelShare: 0,
          unknownShare: 0.7,
          dominantSource: null,
          evidenceTxHashes: [],
          reasons: [],
          warnings: [],
          budget: {
            maxDepth: 7,
            fetchedAddressCount: 12,
            maxAddressFetches: 12,
            liveTransferReadCount: 20,
            skippedAddressCount: 1,
            exhausted: true,
            exhaustedPhase: "trace"
          },
          unresolvedBoundary: {
            kind: "unknown_contract",
            affectedShare: 0.7,
            scoreFloor: 45,
            reason: "Source bundle coverage-limited: unresolved unknown-contract boundary remains after the graph budget stopped.",
            evidenceTxHashes: ["unknown-contract-boundary-tx"]
          }
        }
      }
    });

    expect(message.text).toContain("The graph stopped before resolving a material unknown-contract source boundary.");
    expect(message.text).not.toContain("bridge/router/DEX boundary");
  });

  it("formats incoming deposit LOW-MEDIUM risk with a yellow icon", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      report: {
        ...incomingDepositBaseInput.report,
        decision: "ACCEPTABLE",
        depositRiskScore: 40,
        riskBand: "LOW-MEDIUM"
      }
    });

    expect(message.text).toContain("<b>Риск депозита</b>: 🟡 <code>40/100</code> (<code>LOW-MEDIUM</code>)");
  });

  it("shows funding coverage instead of checked-origin amount for low-confidence incoming deposits", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      amount: "300000",
      report: {
        ...incomingDepositBaseInput.report,
        originCoverage: 0.15249102,
        fundingCoverage: {
          depositFundingCoverageRatio: 1,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.15249102
        },
        provenanceConfidence: 31
      }
    });

    expect(message.text).not.toContain("Checked origin");
    expect(message.text).not.toContain("15% of amount");
    expect(message.text).toContain("<b>Deposit funding coverage</b>: <code>100%</code>");
    expect(message.text).toContain("<b>clean-source proof</b>: <code>0%</code>");
    expect(message.text).toContain("<b>origin confidence</b>: <code>low</code>");
  });

  it("shows localized funding coverage instead of checked-origin amount for low-confidence incoming deposits", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      amount: "300000",
      report: {
        ...incomingDepositBaseInput.report,
        originCoverage: 0.15249102,
        fundingCoverage: {
          depositFundingCoverageRatio: 1,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.15249102
        },
        provenanceConfidence: 31
      }
    });

    expect(message.text).not.toContain("Проверено происхождение");
    expect(message.text).not.toContain("15% суммы");
    expect(message.text).toContain("<b>Покрытие депозита</b>: <code>100%</code>");
    expect(message.text).toContain("<b>Чистый источник</b>: <code>0%</code>");
    expect(message.text).toContain("<b>уверенность</b>: <code>низкая</code>");
  });

  it("shows large-transfer funding bundle context without dumping paths or claiming clean origin", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        decision: "ACCEPTABLE",
        depositRiskScore: 40,
        riskBand: "LOW-MEDIUM",
        fundingCoverage: {
          depositFundingCoverageRatio: 1,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.15
        },
        originPaths: [{
          verdict: "ACCEPTABLE" as const,
          score: 30,
          sourcePolicy: "unknown" as const,
          stoppedReason: "weak_cashflow_continuity" as const,
          pathAddresses: ["TLargeLiquidityHub111111111111111111", "TCorridorLiquidity111111111111111111"],
          txHashes: ["large-corridor-transfer"],
          steps: [{
            txHash: "large-corridor-transfer",
            fromAddress: "TLargeLiquidityHub111111111111111111",
            toAddress: "TCorridorLiquidity111111111111111111",
            amountRaw: "1960000000000",
            timestamp: "2026-06-01T10:00:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer" as const
          }],
          amountCoverageRatio: 0.15,
          amountContinuity: "weak" as const,
          proximityHops: 1,
          reasons: ["Clean CEX origin is not fully proven for the deposit amount."],
          fundingBundles: [{
            targetTxHash: "large-corridor-transfer",
            targetFromAddress: "TLargeLiquidityHub111111111111111111",
            targetToAddress: "TCorridorLiquidity111111111111111111",
            targetAmountRaw: "1960000000000",
            bundleAmountRaw: "1958999000000",
            bundleCoverageRatio: 0.9994,
            windowStart: "2026-06-01T04:00:00.000Z",
            windowEnd: "2026-06-01T10:00:00.000Z",
            fundingTxHashes: ["bundle-funding-1", "bundle-funding-2", "bundle-funding-3"],
            fundingAddresses: ["TFunderA11111111111111111111111111111", "TFunderB11111111111111111111111111111"],
            fundingFunders: [
              { address: "TFunderA11111111111111111111111111111", amountRaw: "1058999000000", txHashes: ["bundle-funding-1", "bundle-funding-3"] },
              { address: "TFunderB11111111111111111111111111111", amountRaw: "900000000000", txHashes: ["bundle-funding-2"] }
            ]
          }]
        }],
        reasons: ["Clean CEX origin is not fully proven for the deposit amount."]
      }
    });

    expect(message.text).toContain("A large intermediate transfer is covered by inbound liquidity, but the clean source further upstream is not proven.");
    expect(message.text).not.toContain("TLargeLiquidityHub111111111111111111 -&gt; TCorridorLiquidity111111111111111111");
    expect(message.text).not.toContain("bundle-funding-1");
    expect(message.text).not.toContain("<b>clean-source proof</b>: <code>100%</code>");
    expect(message.text).not.toContain("Balance-forming paths reach allowlisted CEX sources through clean on-chain hops.");
  });

  it("shows compressed liquidity corridor context without dumping paths or tx hashes", () => {
    const corridorSteps = Array.from({ length: 8 }, (_, index) => ({
      txHash: `corridor-hop-tx-${index + 1}`,
      fromAddress: `TLongCorridorFrom${index + 1}111111111111`,
      toAddress: `TLongCorridorTo${index + 1}11111111111111`,
      amountRaw: index === 3 ? "900000000000" : "300000000000",
      timestamp: `2026-06-01T10:0${index}:00.000Z`,
      method: "transfer",
      edgeType: "normal_transfer" as const
    }));
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        decision: "ACCEPTABLE",
        depositRiskScore: 40,
        riskBand: "LOW-MEDIUM",
        originPaths: [{
          verdict: "ACCEPTABLE" as const,
          score: 30,
          sourcePolicy: "unknown" as const,
          stoppedReason: "no_previous_transfer" as const,
          pathAddresses: [
            "TLongCorridorFrom111111111111111111",
            "TLongCorridorMiddle111111111111111",
            "TLongCorridorTo11111111111111111111"
          ],
          txHashes: corridorSteps.map((step) => step.txHash),
          steps: corridorSteps,
          amountCoverageRatio: 0.82,
          amountContinuity: "medium" as const,
          proximityHops: 8,
          reasons: ["Large operational liquidity corridor; clean CEX was not reached."]
        }],
        corridorSummary: {
          kind: "large_liquidity_corridor",
          pathLength: 8,
          largestTransferRaw: "900000000000",
          cleanSourceReached: false,
          hardRiskReached: false,
          reason: "Large operational liquidity corridor; clean CEX was not reached."
        },
        reasons: ["Clean CEX origin is not fully proven for the deposit amount."]
      }
    });

    expect(message.text).toContain("Large liquidity corridor: the money flow is explained, but clean CEX was not reached further upstream.");
    expect(message.text).not.toContain("-&gt;");
    expect(message.text).not.toContain("corridor-hop-tx-1");
    expect(message.text).not.toContain("TLongCorridorMiddle111111111111111");
  });

  it("uses neutral missing-reason copy for high-risk incoming deposits", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      report: {
        ...incomingDepositBaseInput.report,
        reasons: []
      }
    });

    expect(message.text).toContain("Детальные причины не переданы.");
    expect(message.text).not.toContain("Критичных риск-сигналов по депозиту не найдено.");
  });

  it("uses positive missing-reason copy only for acceptable low incoming deposits", () => {
    const message = formatIncomingDepositRiskAlert({
      ...incomingDepositBaseInput,
      locale: "en",
      report: {
        ...incomingDepositBaseInput.report,
        decision: "ACCEPTABLE",
        depositRiskScore: 8,
        riskBand: "LOW",
        reasons: []
      }
    });

    expect(message.text).toContain("No critical deposit-risk signals were found.");
    expect(message.text).not.toContain("No detailed reasons were provided.");
  });

  it("omits incoming deposit AI contract verdict section when there are no verdicts", () => {
    const message = formatIncomingDepositRiskAlert({
      jobId: "job-no-ai",
      amount: "120",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "deposit-tx",
      report: {
        decision: "ACCEPTABLE",
        depositRiskScore: 8,
        riskBand: "LOW",
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
        senderRole: "known_service",
        hardBadEvidence: [],
        contractVerdicts: [],
        reasons: ["Sender matches a known service route."],
        warnings: []
      }
    });

    expect(message.text).not.toContain("AI contract verdict");
    expect(message.text).not.toContain("Data quality");
    expect(JSON.stringify(message.replyMarkup?.inline_keyboard)).toContain("check:deposit:job-no-ai");
  });

  it("shows legitimate service incoming deposit contract verdicts with reasons", () => {
    const message = formatIncomingDepositRiskAlert({
      jobId: "job-service",
      amount: "250",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "service-deposit-tx",
      report: {
        decision: "ACCEPTABLE",
        depositRiskScore: 12,
        riskBand: "LOW",
        fastSenderRisk: null,
        originPaths: [],
        originCoverage: 0.98,
        fundingCoverage: {
          depositFundingCoverageRatio: 0.98,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.98
        },
        corridorSummary: null,
        provenanceConfidence: 94,
        dataQuality: "high",
        senderRole: "service_hot_wallet",
        hardBadEvidence: [],
        contractVerdicts: [
          {
            source: "deterministic",
            cacheMatch: null,
            reusedFromContractAddress: null,
            providerLabel: "local",
            model: "rule",
            contractAddress: "TGasFree1111111111111111111111111111",
            caseFileHash: "case-hash",
            cacheId: null,
            verdict: "legitimate_service",
            confidence: 1,
            contractRiskScore: 0,
            decisionRecommendation: "ACCEPTABLE",
            reasons: ["GasFree service contract matched deterministic allowlist."],
            citedEvidenceIds: ["gasfree"],
            falsePositiveNotes: []
          }
        ],
        reasons: ["Sender was funded by known service infrastructure."],
        warnings: []
      }
    });

    expect(message.text).toContain("<b>AI-оценка контракта</b>");
    expect(message.text).toContain("legitimate_service 0/100");
    expect(message.text).toContain("GasFree service contract matched deterministic allowlist.");
  });

  it("formats admin alert with Telegram owner identity", () => {
    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    }).text;

    expect(text).toContain("<b>User</b>: @client_user - tg_id: <code>123456789</code>");
    expect(text).toContain("<b>Watched wallet</b>: <code>TWallet111111111111111111111111111111</code>");
  });

  it("formats admin alert without username", () => {
    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: null,
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report
    }).text;

    expect(text).toContain("<b>User</b>: tg_id: <code>123456789</code>");
  });

  it("formats read-only approval guard alerts in Russian by default", () => {
    const message = formatUserApprovalAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "unknown",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-06T19:06:15.000Z"),
      signedAt: new Date("2026-05-04T15:06:28.559Z"),
      expirationAt: new Date("2026-05-06T21:07:27.000Z"),
      approvalTxHash: "approval-tx",
      report
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("USDT approval");
    expect(message.text).toContain("<b>Решение</b>");
    expect(message.text).toContain("<b>Риск approval</b>");
    expect(message.text).toContain("Кому разрешено списание");
    expect(message.text).toContain("Это не доказанная кража");
    expect(message.text).toContain("не просит сид-фразу или приватный ключ");
    expect(message.text).not.toContain("Review/revoke");
    expect(message.text).not.toContain("seed/private key");
    expect(message.text).toContain("<code>82/100</code>");
  });

  it("formats service-linked approval guard alerts with route context", () => {
    const text = formatUserApprovalAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalTxHash: "approval-tx",
      report: {
        ...report,
        level: "MEDIUM",
        score: 35,
        reasons: [
          {
            code: "approval_temporally_linked_to_known_swap",
            message: "Approval appears linked to a nearby swap/bridge route through service or adapter infrastructure",
            scoreImpact: -35
          }
        ]
      }
    }).text;

    expect(text).toContain("Это не доказанная кража");
    expect(text).not.toContain("Review/revoke");
  });

  it("formats pending approval context alerts", () => {
    const message = formatUserApprovalPendingAlert({
      watchedWallet: "TWallet<owner>",
      token: "USDT",
      spender: "TSpender&helper",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      contextDeadlineAt: new Date("2026-05-05T13:52:21.000Z"),
      approvalTxHash: "approval-tx",
      report: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Waiting for route context <pending>", scoreImpact: 10 }]
      }
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("Подписан smart contract");
    expect(message.text).toContain("Статус");
    expect(message.text).toContain("ждём контекст операции");
    expect(message.text).toContain("Финальный результат придёт отдельным сообщением");
    expect(message.text).toContain("<code>TWallet&lt;owner&gt;</code>");
    expect(message.text).toContain("<code>TSpender&amp;helper</code>");
    expect(message.text).toContain("Waiting for route context &lt;pending&gt;");
  });

  it("formats linked approval context result follow-up alerts", () => {
    const message = formatUserApprovalContextResultAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      contextDeadlineAt: new Date("2026-05-05T13:52:21.000Z"),
      approvalTxHash: "approval-tx",
      initialReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Pending route context", scoreImpact: 10 }]
      },
      finalReport: {
        ...report,
        level: "MEDIUM",
        score: 35,
        reasons: [
          {
            code: "approval_temporally_linked_to_known_swap",
            message: "Linked to nearby Bridgers/SunSwap route",
            scoreImpact: -35
          }
        ]
      },
      result: "linked_swap_route",
      linkedRouteTxHash: "route-tx",
      routeServiceTags: ["Bridgers", "SunSwap"]
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("Контекст approval найден");
    expect(message.text).toContain("<b>Решение</b>: <code>ACCEPTABLE</code>");
    expect(message.text).toContain("Approval связан с bridge/swap-операцией");
    expect(message.text).toContain("Списания USDT как drain не доказаны");
    expect(message.text).toContain("<code>35/100</code>");
    expect(message.text).toContain("<b>Дедлайн контекста</b>: <code>05.05.2026 16:52 MSK</code>");
    expect(message.text).toContain("<b>Связанная tx</b>: <code>route-tx</code>");
    expect(message.text).not.toContain("Review/revoke");
  });

  it("formats missing approval context result follow-up alerts", () => {
    const message = formatUserApprovalContextResultAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      contextDeadlineAt: new Date("2026-05-05T13:52:21.000Z"),
      approvalTxHash: "approval-tx",
      initialReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Pending route context", scoreImpact: 10 }]
      },
      finalReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [
          {
            code: "approval_no_route_found",
            message: "No related swap/bridge route found",
            scoreImpact: 0
          }
        ]
      },
      result: "no_route_found"
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("Контекст approval не найден");
    expect(message.text).toContain("<b>Решение</b>: <code>DECLINE</code>");
    expect(message.text).toContain("кошелёк небезопасен для работы");
    expect(message.text).not.toContain("Review/revoke");
  });

  it("formats collector-drain approval context result with distinct outflow title", () => {
    const message = formatUserApprovalContextResultAlert({
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "contract",
      spenderIdentity: "tokenApprove",
      allowanceType: "unlimited",
      allowanceAmount: "unlimited",
      approvalAt: new Date("2026-05-05T13:42:21.000Z"),
      approvalTxHash: "approval-tx",
      initialReport: {
        ...report,
        level: "HIGH",
        score: 70,
        reasons: [{ code: "approval_context_pending", message: "Pending route context", scoreImpact: 10 }]
      },
      finalReport: {
        ...report,
        level: "CRITICAL",
        score: 95,
        reasons: [
          {
            code: "approval_collector_drain",
            message: "approval monitoring state: transfer_from_observed",
            scoreImpact: 25
          }
        ]
      },
      result: "collector_drain",
      linkedRouteTxHash: "collector-tx"
    });

    expect(message.text).toContain("Найден вывод USDT после approval");
    expect(message.text).toContain("<b>Решение</b>: <code>DECLINE</code>");
    expect(message.text).toContain("После approval найден вывод USDT. Точный drain доказывается только при совпадении spender и transferFrom.");
    expect(message.text).toContain("<b>Tx вывода USDT</b>: <code>collector-tx</code>");
    expect(message.text).not.toContain("<b>Связанная tx</b>");
    expect(message.text).not.toContain("Linked route tx");
    expect(message.text).not.toContain("Контекст approval не найден");
  });

  it("formats finite approval allowance as decoded USDT", () => {
    const text = formatUserApprovalAlert({
      locale: "en",
      watchedWallet: "TWallet111111111111111111111111111111",
      token: "USDT",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "Bridgers",
      allowanceType: "finite",
      allowanceAmount: "111,111 USDT",
      approvalTxHash: "approval-tx",
      report
    }).text;

    expect(text).toContain("<b>Allowance</b>: <code>finite 111,111 USDT</code>");
    expect(text).toContain("<b>Identity</b>: <code>Bridgers</code>");
  });

  it("formats service-admin approval alerts", () => {
    const text = formatAdminApprovalAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      spender: "TSpender11111111111111111111111111111",
      spenderType: "eoa",
      spenderIdentity: "unknown",
      approvalTxHash: "approval-tx",
      report
    }).text;

    expect(text).toContain("HIGH approval event");
    expect(text).toContain("<b>User</b>: @client_user - tg_id: <code>123456789</code>");
    expect(text).toContain("Spender type");
    expect(text).toContain("<b>Approval tx</b>: <code>approval-tx</code>");
  });

  it("formats empty reasons with a safe fallback", () => {
    const text = formatUserIncomingAlert({
      amount: "12450",
      watchedWallet: "TWallet111111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report: { ...report, reasons: [] }
    }).text;

    expect(text).toContain("• no obvious risk signals found");
  });

  it("normalizes newlines and control characters in user-controlled fields", () => {
    const text = formatUserIncomingAlert({
      amount: "12450\nRisk: LOW",
      watchedWallet: "TWallet\nInjected: no",
      sender: "TSender\nTx: fake",
      txHash: "abc123\r\nInjected: yes",
      report: {
        ...report,
        reasons: [{ code: "provider", message: "Line one\nRisk: LOW\t\u0000", scoreImpact: 10 }]
      }
    }).text;

    expect(text).toContain("<b>Amount</b>: <code>12450 Risk: LOW USDT</code>");
    expect(text).toContain("<b>Watched wallet</b>: <code>TWallet Injected: no</code>");
    expect(text).toContain("<b>From</b>: <code>TSender Tx: fake</code>");
    expect(text).toContain("• Line one Risk: LOW");
    expect(text).not.toContain("\r");
    expect(text).not.toContain("\u0000");
  });

  it("escapes HTML in dynamic fields", () => {
    const text = formatUserIncomingAlert({
      amount: "1 < 2 & ok",
      watchedWallet: "TWallet<bad>",
      sender: "TSender&bad",
      txHash: "tx\"quote'",
      report: {
        ...report,
        reasons: [{ code: "html", message: "Reason <script> & \"quote\"", scoreImpact: 1 }]
      }
    }).text;

    expect(text).toContain("1 &lt; 2 &amp; ok USDT");
    expect(text).toContain("TWallet&lt;bad&gt;");
    expect(text).toContain("TSender&amp;bad");
    expect(text).toContain("tx&quot;quote&#39;");
    expect(text).toContain("Reason &lt;script&gt; &amp; &quot;quote&quot;");
    expect(text).not.toContain("<script>");
  });

  it("formats risk lines by level", () => {
    expect(formatRiskLine({ ...report, level: "LOW", score: 0 })).toContain("🟢 <b>Low risk</b>");
    expect(formatRiskLine({ ...report, level: "MEDIUM", score: 35 })).toContain("🟡 <b>Medium risk</b>");
    expect(formatRiskLine({ ...report, level: "HIGH", score: 80 })).toContain("🟠 <b>High risk</b>");
    expect(formatRiskLine({ ...report, level: "CRITICAL", score: 95 })).toContain("🔴 <b>Critical risk</b>");
  });

  it("exports a reusable HTML escaper", () => {
    expect(escapeHtml("<>&\"'")).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("formats digest alerts with risky summary", () => {
    const message = formatDigestAlert({
      walletAddress: "TWallet111111111111111111111111111111",
      intervalMinutes: 10,
      transactionCount: 23,
      totalUsdt: "81 240",
      uniqueSenderCount: 19,
      riskyTransactionCount: 1,
      riskySenderCount: 1,
      topRisky: { level: "HIGH", score: 80, sender: "TRisky111111111111111111111111111111" }
    });

    expect(message.parseMode).toBe("HTML");
    expect(message.text).toContain("<b>USDT digest</b>");
    expect(message.text).toContain("<b>Incoming</b>: <code>23 tx</code>");
    expect(message.text).toContain("<b>Total</b>: <code>81 240 USDT</code>");
    expect(message.text).toContain("<b>Risky</b>: <code>1 tx / 1 sender</code>");
    expect(message.text).toContain("High-risk tx were alerted immediately");
  });

  it("limits visible reasons and keeps messages below Telegram hard limit", () => {
    const manyReasons = Array.from({ length: 40 }, (_, index) => ({
      code: `reason_${index}`,
      message: `Very long provider reason ${index} ${"x".repeat(500)}`,
      scoreImpact: 1
    }));

    const text = formatAdminSuspiciousAlert({
      telegramUserId: "123456789",
      telegramUsername: "client_user",
      watchedWallet: "TWallet111111111111111111111111111111",
      amount: "12450",
      sender: "TSender111111111111111111111111111111",
      txHash: "abc123",
      report: { ...report, reasons: manyReasons }
    }).text;

    expect(text).toContain("...and 32 more");
    expect(text.length).toBeLessThan(TELEGRAM_MESSAGE_LIMIT);
    expect(text).not.toContain("<code>Very long");
  });
});
