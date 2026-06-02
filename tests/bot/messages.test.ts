import { describe, expect, it } from "vitest";
import {
  addWalletPrompt,
  analyticsMessage,
  checkAddressPrompt,
  checkTxPrompt,
  dashboardMessage,
  helpMessage,
  homeMessage,
  riskIntelOverviewMessage,
  safetyMessage,
  securityMessage,
  settingsMessage,
  walletAlertModeMessage
} from "../../src/bot/messages";
import type { WalletDashboard } from "../../src/wallet/dashboard";

const now = new Date("2026-05-23T00:00:00.000Z");

function dashboard(): WalletDashboard {
  return {
    wallet: {
      id: "wallet-1",
      telegramUserId: "42",
      telegramUsername: "tester",
      address: "TWallet111111111111111111111111111111",
      createdAt: now,
      alertMode: "realtime",
      digestIntervalMinutes: 10
    },
    snapshot: {
      watchedWalletId: "wallet-1",
      trxBalanceSun: "0",
      usdtBalanceMicro: "0",
      walletCreatedAt: now,
      totalTxCount: null,
      incomingTxCount: null,
      outgoingTxCount: null,
      thirtyDayInUsdt: "0",
      thirtyDayOutUsdt: "0",
      thirtyDayTransferCount: 0,
      thirtyDayFeeSun: "0",
      trxUsdPrice: null,
      analyticsPartial: false,
      refreshedAt: now,
      lastError: null
    },
    safety: {
      subjectAddress: "TWallet111111111111111111111111111111",
      level: "LOW",
      score: 0,
      reasons: [],
      confidence: { level: "limited", checked: [], notConnected: [] },
      modules: []
    },
    approvalSummary: {
      usdtApprovalCount: 1,
      unlimitedApprovalCount: 0,
      highRiskApprovalCount: 1,
      drainObservationCount: 1,
      highRiskDrainObservationCount: 1,
      topRiskyApprovals: [
        {
          watchedWalletId: "wallet-1",
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          spenderAddress: "TSpender11111111111111111111111111111",
          amountRaw: "111111000000",
          isUnlimited: false,
          currentAllowanceRaw: "111111000000",
          spenderType: "eoa",
          status: "active",
          lastApprovalTxHash: "approval-tx",
          lastApprovalAt: new Date("2026-05-22T00:00:00.000Z"),
          riskLevel: "HIGH",
          riskScore: 80,
          riskReasons: [{ code: "approval_very_large_finite_usdt", message: "Very large finite approval", scoreImpact: 70 }],
          lastAlertedTxHash: "approval-tx",
          metadataName: "Bridgers",
          metadataTag: null,
          metadataSource: "tronscan",
          metadataIsContract: true,
          contractServiceTag: null,
          contractVerified: false,
          contractActivityLevel: "low",
          contractTopMethods: [{ methodId: "23b872dd", signature: "transferFrom(address,address,uint256)", count: 3, ratio: 1, method: "transferFrom(address,address,uint256)", calls: 3, percentage: 1 }],
          contractHasTransferFromSelector: true,
          contractHasOwnerOnlyPattern: true,
          approvalContextStatus: "resolved",
          approvalContextResult: "linked_swap_route",
          approvalContextDeadlineAt: new Date("2026-05-22T00:10:00.000Z"),
          approvalFinalContextAlertSentAt: new Date("2026-05-22T00:11:00.000Z"),
          updatedAt: now
        }
      ],
      topDrainObservations: [
        {
          id: "drain-1",
          watchedWalletId: "wallet-1",
          approvalTxHash: "approval-tx",
          transferTxHash: "transfer-tx",
          ownerAddress: "TWallet111111111111111111111111111111",
          spenderAddress: "TSpender11111111111111111111111111111",
          receiverAddress: "TReceiver1111111111111111111111111111",
          tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          amountRaw: "320652450320",
          callerAddress: "TSpender11111111111111111111111111111",
          method: "transferFrom",
          approvalAt: new Date("2026-05-20T00:00:00.000Z"),
          transferAt: new Date("2026-05-22T00:00:00.000Z"),
          timeToTransferMs: "172800000",
          spenderType: "eoa",
          receiverType: "eoa",
          observedMode: "shadow",
          riskLevel: "CRITICAL",
          riskScore: 95,
          riskReasons: [{ code: "approval_drain_unknown_eoa_spender", message: "EOA spender", scoreImpact: 60 }],
          rawEvidenceId: "evidence-1",
          createdAt: now,
          updatedAt: now
        }
      ]
    },
    pollState: null,
    source: "cache",
    cacheAgeMs: 0,
    lastError: null
  };
}

function plainTelegramText(message: { text: string } | string): string {
  const text = typeof message === "string" ? message : message.text;
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

describe("bot messages", () => {
  it("uses trust-building copy in home, help, and settings messages", () => {
    const home = plainTelegramText(homeMessage(2, "ru"));
    expect(home).toContain("Следит за входящими USDT");
    expect(home).toContain("Проверяет адреса и транзакции");
    expect(home).toContain("Бот только читает блокчейн");
    expect(home).not.toContain("risk score");
    expect(home).not.toContain("seed/private key");

    const help = plainTelegramText(helpMessage("ru"));
    expect(help).toContain("Что умеет бот");
    expect(help).toContain("Проверка происхождения денег");
    expect(help).toContain("Бот не хранит ключи и не подписывает транзакции");
    expect(help).toContain("риск по правилам сервиса не всегда означает мошенничество");
    expect(help).toContain("точное списание показываем только когда видно, кто получил разрешение и кто списал USDT");
    expect(help).not.toContain("Limited beta");

    const settings = plainTelegramText(settingsMessage([], "ru"));
    expect(settings).toContain("Настройки");
    expect(settings).toContain("Язык");
    expect(settings).toContain("Админы алертов");
    expect(settings).not.toContain("safety events");

    const enHome = plainTelegramText(homeMessage(1, "en"));
    expect(enHome).toContain("Monitors incoming USDT");
    expect(enHome).toContain("Checks addresses and transactions");
    expect(enHome).toContain("The bot is read-only");

    const enHelp = plainTelegramText(helpMessage("en"));
    expect(enHelp).toContain("What the bot does");
    expect(enHelp).toContain("traces the origin of funds");
    expect(enHelp).toContain("The bot does not store keys or sign transactions");

    const enSettings = plainTelegramText(settingsMessage([], "en"));
    expect(enSettings).toContain("Settings");
    expect(enSettings).toContain("Language");
    expect(enSettings).toContain("Alert admins");
    expect(enSettings).toContain("The bot is read-only");
  });

  it("uses clear Russian prompts and wallet alert mode explanations", () => {
    const wallet = dashboard().wallet;

    expect(plainTelegramText(addWalletPrompt("ru"))).toContain("Отправьте TRON-адрес кошелька");
    expect(plainTelegramText(checkAddressPrompt("ru"))).toContain("Отправьте TRON-адрес");
    expect(plainTelegramText(checkAddressPrompt("ru"))).toContain("Адрес не будет добавлен в мониторинг");
    expect(plainTelegramText(checkTxPrompt("ru"))).toContain("Отправьте hash транзакции TRON");
    expect(plainTelegramText(walletAlertModeMessage(wallet, "ru"))).toContain("Сразу: каждое входящее поступление");
    expect(plainTelegramText(walletAlertModeMessage(wallet, "ru"))).not.toContain("LOW tx пачкой");
  });

  it("uses aligned Russian copy in dashboard and analytics report screens", () => {
    const data = dashboard();
    data.snapshot.analyticsPartial = true;
    data.snapshot.thirtyDayFeeSun = "50000000";

    const dashboardText = plainTelegramText(dashboardMessage(data, new Date("2026-05-31T12:00:00Z"), "ru"));
    expect(dashboardText).toContain("Кошелёк");
    expect(dashboardText).toContain("Поток за 30 дней");
    expect(dashboardText).toContain("Безопасность");
    expect(dashboardText).toContain("Данные обновлены частично");
    expect(dashboardText).not.toContain("Data quality");
    expect(dashboardText).not.toContain("Analytics: partial");
    expect(dashboardText).not.toContain("Аналитика: частичная");
    expect(plainTelegramText(dashboardMessage(data, new Date("2026-05-31T12:00:00Z"), "en"))).not.toContain("Data quality");

    const staleData = dashboard();
    staleData.source = "stale";
    const staleDashboardText = plainTelegramText(dashboardMessage(staleData, new Date("2026-05-31T12:00:00Z"), "ru"));
    expect(staleDashboardText).toContain("Данные дашборда: устарели");
    expect(staleDashboardText).not.toContain("Dashboard data: stale");

    const errorData = dashboard();
    errorData.source = "error";
    const errorDashboardText = plainTelegramText(dashboardMessage(errorData, new Date("2026-05-31T12:00:00Z"), "ru"));
    expect(errorDashboardText).toContain("Данные дашборда: недоступны");
    expect(errorDashboardText).not.toContain("Dashboard data: unavailable");

    const analyticsText = plainTelegramText(analyticsMessage(data, new Date("2026-05-31T12:00:00Z"), "ru"));
    expect(analyticsText).toContain("Данные");
    expect(analyticsText).toContain("Транзакции");
    expect(analyticsText).toContain("За 30 дней комиссии высокие. Проверьте, можно ли снизить расходы через TRON Energy/Bandwidth.");
    expect(analyticsText).not.toContain("Качество данных");
    expect(analyticsText).not.toContain("Gas/fees");
  });

  it("uses aligned Russian copy in safety and risk intelligence report screens", () => {
    const data = dashboard();

    const safetyText = plainTelegramText(safetyMessage(data, "ru"));
    expect(safetyText).toContain("Рисковые approvals");
    expect(safetyText).toContain("Как отменить approval");
    expect(safetyText).toContain("Бот только читает данные");
    expect(safetyText).toContain("Нажмите кнопку «Открыть approvals» под сообщением.");
    expect(safetyText).toContain("Найдите USDT и spender из блока «Главные approvals».");
    expect(safetyText).not.toContain("указанного контракта");
    expect(safetyText).not.toContain("Review/revoke");
    expect(safetyText).not.toContain("seed/private key");

    const securityText = plainTelegramText(securityMessage(data, "ru"));
    expect(securityText).toContain("Текущий риск");
    expect(securityText).toContain("Покрытие: ограниченное");
    expect(securityText).not.toContain("Текущий score");
    expect(securityText).not.toContain("Уверенность: limited beta");

    const riskIntelText = plainTelegramText(riskIntelOverviewMessage("ru"));
    expect(riskIntelText).toContain("Что проверяет бот");
    expect(riskIntelText).toContain("Что пока ограничено");
    expect(riskIntelText).toContain("часть проверок остаётся beta");
    expect(riskIntelText).toContain("внешние AML-провайдеры не подключены");
    expect(riskIntelText).not.toContain("Limited beta");

    expect(plainTelegramText(safetyMessage(data, "en"))).toContain("Risky approvals");
    expect(plainTelegramText(safetyMessage(data, "en"))).toContain("Revoke guide");
  });

  it("shows decoded finite approval allowance in the Safety screen", () => {
    const message = safetyMessage(dashboard(), "en");
    const text = message.text;

    expect(message.parseMode).toBe("HTML");
    expect(text).toContain("<b>Risky approvals</b>: <code>1</code>");
    expect(text).toContain("<b>Post-approval outflows</b>: <code>1</code>");
    expect(text).toContain("Bridgers");
    expect(text).toContain("finite 111,111 USDT");
    expect(text).toContain("HIGH 80/100");
    expect(text).toContain("<b>Context</b>: ✅ resolved / linked swap route");
    expect(text).toContain("<b>Contract intelligence</b>");
    expect(text).toContain("no service tag, not verified, low");
    expect(text).toContain("transferFrom(address,address,uint256)");
    expect(text).toContain("<b>Shadow observations</b>");
    expect(text).toContain("320,652.45032 USDT");
    expect(text).toContain("CRITICAL 95/100");
    expect(text).toContain("<b>Revoke guide</b>");
    expect(text).toContain("Tap “Open approvals” under this message.");
    expect(text).toContain("Connect TronLink with the watched wallet.");
    expect(text).toContain("Find USDT and the spender from “Top approvals”.");
    expect(text).toContain("Revoke approval if it is unexpected or no longer needed.");
    expect(text).toContain("Bot is read-only. It never signs transactions and never asks for seed/private key.");
  });

  it("shows route-linked approval session context in the Safety screen", () => {
    const data = dashboard();
    data.approvalSummary.topRiskyApprovals[0].riskLevel = "MEDIUM";
    data.approvalSummary.topRiskyApprovals[0].riskScore = 35;
    data.approvalSummary.topRiskyApprovals[0].riskReasons = [
      {
        code: "approval_temporally_linked_to_known_swap",
        message: "Approval appears linked to a nearby swap/bridge route through service or adapter infrastructure",
        scoreImpact: -35
      }
    ];

    const text = safetyMessage(data, "en").text;

    expect(text).toContain("<b>Session</b>: linked to swap/bridge route");
    expect(text).toContain("<b>Context</b>: ✅ resolved / linked swap route");
  });
});
