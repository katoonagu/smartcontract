import type { ForensicCheckJob, ForensicCheckJobKind } from "../storage/repositories";
import type { IncomingDepositRiskReport, RiskLevel, RiskReport, WalletAlertMode } from "../types";

type CompleteJobInput = {
  id: string;
  status: "completed" | "partial" | "failed";
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
};

export type RunSingleIncomingDepositJobCycleDeps = {
  claimNextForensicCheckJob(): Promise<ForensicCheckJob | null>;
  completeForensicCheckJob(input: CompleteJobInput): Promise<boolean>;
  markUserAlertSent(input: { txHash: string; watchedWalletId: string }): Promise<boolean>;
  markUserAlertFailed(input: { txHash: string; watchedWalletId: string; error: string }): Promise<boolean>;
  recordObservedTransactionRisk(input: { txHash: string; watchedWalletId: string; report: RiskReport }): Promise<boolean>;
  sendUserAlert(
    telegramUserId: string,
    message: string,
    options?: { parse_mode?: "HTML"; reply_markup?: unknown }
  ): Promise<void>;
  formatIncomingDepositRiskAlert(input: {
    jobId: string;
    amount: string;
    watchedWallet: string;
    sender: string;
    txHash: string;
    report: IncomingDepositRiskReport;
  }): { text: string; parseMode: "HTML"; replyMarkup?: unknown };
  buildReport(input: {
    job: ForensicCheckJob;
    depositTxHash: string;
    watchedWallet: string;
    sender: string;
    amountRaw: string;
    timestamp: Date;
  }): Promise<IncomingDepositRiskReport>;
};

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function riskLevelFromIncoming(report: IncomingDepositRiskReport): RiskLevel {
  if (report.riskBand === "CRITICAL") return "CRITICAL";
  if (report.riskBand === "HIGH") return "HIGH";
  if (report.riskBand === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function riskReportFromIncoming(subjectAddress: string, report: IncomingDepositRiskReport): RiskReport {
  return {
    subjectAddress,
    score: report.depositRiskScore,
    level: riskLevelFromIncoming(report),
    reasons: report.reasons.map((reason, index) => ({
      code: `incoming_deposit_reason_${index + 1}`,
      message: reason,
      scoreImpact: 0,
      source: "incoming_deposit",
      confidence: "medium",
      severity: report.decision === "DECLINE" ? "high" : "low"
    }))
  };
}

function shouldSend(alertMode: WalletAlertMode, report: IncomingDepositRiskReport): boolean {
  if (alertMode === "paused") return false;
  if (alertMode === "realtime") return true;
  if (alertMode === "risk_only") return report.decision === "DECLINE";
  if (alertMode === "digest") return false;
  return true;
}

export async function runSingleIncomingDepositJobCycle(
  deps: RunSingleIncomingDepositJobCycleDeps
): Promise<boolean> {
  const job = await deps.claimNextForensicCheckJob();
  if (!job) return false;

  const depositTxHash = stringField(job.progressJson.depositTxHash);
  const watchedWallet = stringField(job.progressJson.watchedWallet);
  const watchedWalletId = stringField(job.progressJson.watchedWalletId);
  const sender = stringField(job.progressJson.sender);
  const amountRaw = stringField(job.progressJson.amountRaw);
  const timestampText = stringField(job.progressJson.timestamp);
  const telegramUserId = stringField(job.progressJson.telegramUserId);
  const alertMode = (stringField(job.progressJson.alertMode) ?? "realtime") as WalletAlertMode;

  if (!depositTxHash || !watchedWallet || !watchedWalletId || !sender || !amountRaw || !timestampText || !telegramUserId) {
    const error = "incoming_deposit_check job is missing required progress_json fields";
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: job.progressJson,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: error
    });
    return true;
  }

  try {
    const report = await deps.buildReport({
      job,
      depositTxHash,
      watchedWallet,
      sender,
      amountRaw,
      timestamp: new Date(timestampText)
    });
    const riskReport = riskReportFromIncoming(sender, report);
    await deps.recordObservedTransactionRisk({ txHash: depositTxHash, watchedWalletId, report: riskReport });

    if (shouldSend(alertMode, report)) {
      const message = deps.formatIncomingDepositRiskAlert({
        jobId: job.id,
        amount: stringField(job.progressJson.amount) ?? amountRaw,
        watchedWallet,
        sender,
        txHash: depositTxHash,
        report
      });
      await deps.sendUserAlert(telegramUserId, message.text, {
        parse_mode: message.parseMode,
        reply_markup: message.replyMarkup
      });
    }
    await deps.markUserAlertSent({ txHash: depositTxHash, watchedWalletId });
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "completed",
      progressJson: job.progressJson,
      resultJson: report as unknown as Record<string, unknown>,
      rawEvidenceIds: [],
      observationIds: [],
      lastError: null
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.markUserAlertFailed({ txHash: depositTxHash, watchedWalletId, error: message });
    await deps.completeForensicCheckJob({
      id: job.id,
      status: "failed",
      progressJson: job.progressJson,
      resultJson: {},
      rawEvidenceIds: [],
      observationIds: [],
      lastError: message
    });
    return true;
  }
}

export const INCOMING_DEPOSIT_JOB_KIND: ForensicCheckJobKind = "incoming_deposit_check";
