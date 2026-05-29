import type { ForensicCheckJob, ForensicCheckJobKind } from "../storage/repositories";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import type { RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { evaluateAddressRisk } from "../risk/evaluation";
import type {
  AddressLabel,
  ContractAnalysisCaseFile,
  ContractLlmVerdictSummary,
  ForensicRouteEdge,
  IncomingDepositOriginPath,
  IncomingDepositRiskReport,
  IndexedTronUsdtTransfer,
  RiskLevel,
  RiskReport,
  ServiceClassification,
  StablecoinRestrictionProfile,
  WalletAlertMode,
  WalletRole
} from "../types";
import { buildAddressBehaviorProfile } from "./addressBehavior";
import { buildBoundaryExposureProfile } from "./boundaryExposure";
import { analyzeIncomingDepositContracts } from "./incomingDepositContractContext";
import { traceIncomingDepositProvenance } from "./incomingDepositProvenance";
import { buildIncomingDepositRiskReport } from "./incomingDepositRisk";
import { indexedTransferToRouteEdge } from "./localTronUsdtIndex";
import { normalizeTransfer } from "./routeSearch";
import { buildServiceExposureProfile } from "./serviceExposure";
import { buildWalletRoleProfile } from "./walletRoleClassifier";

type CompleteJobInput = {
  id: string;
  status: "completed" | "partial" | "failed";
  progressJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  rawEvidenceIds: string[];
  observationIds: string[];
  lastError: string | null;
};

export type IncomingDepositRuntimeDeps = {
  listIndexedUsdtTransfersForAddress(
    address: string,
    options: {
      minTimestamp?: Date;
      maxTimestamp?: Date;
      limit: number;
      orderBy: "newest";
      direction: "both";
    }
  ): Promise<unknown[]>;
  listRelatedTrc20Transfers(
    address: string,
    options: { start: number; limit: number; minTimestamp?: number; endTimestamp?: number }
  ): Promise<unknown[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getContractIntelligenceProfile(address: string): Promise<ContractRiskContext | null>;
  getTransaction(txHash: string): Promise<unknown>;
  getUsdtRestrictionStatus(address: string): Promise<StablecoinRestrictionProfile | null>;
  analyzeContractLlmCaseFiles?: (caseFiles: ContractAnalysisCaseFile[]) => Promise<ContractLlmVerdictSummary[]>;
};

export type BuildIncomingDepositReportInput = {
  deps: IncomingDepositRuntimeDeps;
  job: ForensicCheckJob;
  depositTxHash: string;
  watchedWallet: string;
  sender: string;
  amountRaw: string;
  timestamp: Date;
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

const RUNTIME_TRANSFER_LIMIT = 200;
const RUNTIME_PROVENANCE_MAX_DEPTH = 4;

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function depositEdge(input: Pick<BuildIncomingDepositReportInput, "depositTxHash" | "sender" | "watchedWallet" | "amountRaw" | "timestamp">): ForensicRouteEdge {
  return {
    id: `incoming_deposit:${input.depositTxHash}`,
    fromAddress: input.sender,
    toAddress: input.watchedWallet,
    txHash: input.depositTxHash,
    amountRaw: input.amountRaw,
    timestamp: input.timestamp,
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function mergeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
}

function asIndexedTransfers(transfers: unknown[]): IndexedTronUsdtTransfer[] {
  return transfers as IndexedTronUsdtTransfer[];
}

function asRawTransfers(transfers: unknown[]): RawTronscanTrc20Transfer[] {
  return transfers as RawTronscanTrc20Transfer[];
}

function hasCleanCexPath(paths: IncomingDepositOriginPath[]): boolean {
  return paths.some((path) => path.stoppedReason === "clean_cex_reached");
}

function countTransfers(edges: ForensicRouteEdge[], address: string): { incoming: number; outgoing: number } {
  return edges.reduce(
    (counts, edge) => ({
      incoming: counts.incoming + (edge.toAddress === address ? 1 : 0),
      outgoing: counts.outgoing + (edge.fromAddress === address ? 1 : 0)
    }),
    { incoming: 0, outgoing: 0 }
  );
}

function mapWalletRole(role: WalletRole): string | null {
  if (role === "treasury_like" || role === "cashout_service") return "operational_liquidity_wallet";
  if (role === "unknown") return "unknown_wallet";
  return role;
}

async function inferIncomingDepositSenderRole(input: {
  sender: string;
  senderEdges: ForensicRouteEdge[];
  originPaths: IncomingDepositOriginPath[];
  stablecoinState: StablecoinRestrictionProfile | null;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
}): Promise<string | null> {
  if (hasCleanCexPath(input.originPaths)) return "clean_cex_funded_wallet";

  const addresses = new Set<string>([input.sender]);
  for (const edge of input.senderEdges) {
    addresses.add(edge.fromAddress);
    addresses.add(edge.toAddress);
  }

  const classifications = new Map<string, ServiceClassification | null>();
  for (const address of addresses) {
    classifications.set(address, await input.getClassificationForAddress(address));
  }

  const subjectClassification = classifications.get(input.sender) ?? null;
  const serviceExposureProfile = buildServiceExposureProfile({
    subjectAddress: input.sender,
    edges: input.senderEdges,
    classifications
  });
  const addressBehaviorProfile = buildAddressBehaviorProfile({
    subjectAddress: input.sender,
    edges: input.senderEdges,
    serviceExposureProfile,
    subjectClassification
  });
  const boundaryExposureProfile = buildBoundaryExposureProfile({
    subjectAddress: input.sender,
    edges: input.senderEdges,
    classifications
  });
  const walletRoleProfile = buildWalletRoleProfile({
    subjectAddress: input.sender,
    approvalDrainProfiles: [],
    addressBehaviorProfile,
    serviceExposureProfile,
    boundaryExposureProfile,
    subjectClassification
  });

  const role = mapWalletRole(walletRoleProfile.primaryRole);
  if (role && role !== "unknown_wallet") return role;

  const counts = countTransfers(input.senderEdges, input.sender);
  if (counts.incoming <= 1 && counts.outgoing <= 1 && input.stablecoinState?.balanceRaw === "0") {
    return "fresh_one_shot_wallet";
  }
  return role;
}

export async function buildIncomingDepositReport(
  input: BuildIncomingDepositReportInput
): Promise<IncomingDepositRiskReport> {
  const labels = await input.deps.getLabelsForAddress(input.sender);
  const stablecoinState = await input.deps.getUsdtRestrictionStatus(input.sender);
  const fastSenderRisk = evaluateAddressRisk({
    context: {
      subjectAddress: input.sender,
      observedTransactionHash: input.depositTxHash
    },
    labels
  }).report;

  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const seedDeposit = depositEdge(input);
  const minTimestamp = input.job.windowStart;
  const maxTimestamp = input.timestamp;
  const fetchEdgesForAddress = async (address: string): Promise<ForensicRouteEdge[]> => {
    const cached = edgeCache.get(address);
    if (cached) return cached;

    const indexedTransfers = await input.deps.listIndexedUsdtTransfersForAddress(address, {
      minTimestamp,
      maxTimestamp,
      limit: RUNTIME_TRANSFER_LIMIT,
      orderBy: "newest",
      direction: "both"
    });
    const liveTransfers = await input.deps.listRelatedTrc20Transfers(address, {
      start: 0,
      limit: RUNTIME_TRANSFER_LIMIT,
      minTimestamp: minTimestamp.getTime(),
      endTimestamp: maxTimestamp.getTime()
    });
    const edges = mergeEdges([
      ...asIndexedTransfers(indexedTransfers).map(indexedTransferToRouteEdge),
      ...asRawTransfers(liveTransfers).map((transfer) => normalizeTransfer(transfer)).filter((edge): edge is ForensicRouteEdge => edge !== null),
      ...(address === input.sender ? [seedDeposit] : [])
    ]);
    edgeCache.set(address, edges);
    return edges;
  };

  const provenance = await traceIncomingDepositProvenance({
    deposit: seedDeposit,
    maxDepth: RUNTIME_PROVENANCE_MAX_DEPTH,
    fetchEdgesForAddress,
    getClassificationForAddress: input.deps.getClassificationForAddress
  });
  const contracts = await analyzeIncomingDepositContracts({
    subjectAddress: input.sender,
    watchedWallet: input.watchedWallet,
    depositTxHash: input.depositTxHash,
    originPaths: provenance.paths,
    getContractIntelligenceProfile: input.deps.getContractIntelligenceProfile,
    getTransaction: input.deps.getTransaction,
    analyzeContractLlmCaseFiles: input.deps.analyzeContractLlmCaseFiles
  });
  const senderEdges = await fetchEdgesForAddress(input.sender);
  const senderRole = await inferIncomingDepositSenderRole({
    sender: input.sender,
    senderEdges,
    originPaths: provenance.paths,
    stablecoinState,
    getClassificationForAddress: input.deps.getClassificationForAddress
  });
  const zeroBalanceWarning = stablecoinState?.balanceRaw === "0"
    ? "Sender current balance is zero after outgoing deposit; balance-origin mode is not applicable."
    : null;

  return buildIncomingDepositRiskReport({
    depositTxHash: input.depositTxHash,
    watchedWallet: input.watchedWallet,
    sender: input.sender,
    amountRaw: input.amountRaw,
    fastSenderRisk,
    originPaths: provenance.paths,
    originCoverage: provenance.originCoverage,
    senderRole,
    senderCurrentBalanceRaw: stablecoinState?.balanceRaw ?? null,
    contractVerdicts: contracts.verdicts,
    warnings: [
      ...provenance.notes,
      ...(zeroBalanceWarning ? [zeroBalanceWarning] : [])
    ]
  });
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
