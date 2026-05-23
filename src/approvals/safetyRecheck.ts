import { logger as defaultLogger, type Logger } from "../logging/logger";
import type { Db } from "../storage/db";
import {
  claimObservedApprovalDrainEvent,
  claimObservedApprovalEvent,
  getAddressMetadata,
  getContractIntelligenceProfile,
  getWatchedWalletByAddress,
  listAddressLabels,
  markApprovalOwnerAlertFailed,
  markApprovalOwnerAlertSkipped,
  recordApprovalRisk,
  saveRiskEvaluationEvidence,
  upsertAddressMetadata,
  upsertContractIntelligenceProfile,
  upsertWalletApproval
} from "../storage/repositories";
import type { TronApprovalClient } from "../tron/tronClient";
import type { ApprovalGuardEvent } from "./approvalRisk";
import { runSingleApprovalPollingCycle } from "./approvalWorker";

export type SafetyRecheckTarget =
  | { kind: "wallet" }
  | { kind: "spender"; address: string }
  | { kind: "approval_tx"; txHash: string };

export type SafetyRecheckSummary = {
  walletAddress: string;
  walletFound: boolean;
  target: SafetyRecheckTarget;
  approvalsProcessed: number;
  approvalEventsClaimed: number;
  riskRowsUpdated: number;
  drainObservationsClaimed: number;
};

const txHashPattern = /^[0-9a-fA-F]{64}$/;

export function parseSafetyRecheckTarget(value?: string): SafetyRecheckTarget {
  const normalized = value?.trim();
  if (!normalized) return { kind: "wallet" };
  if (txHashPattern.test(normalized)) return { kind: "approval_tx", txHash: normalized };
  return { kind: "spender", address: normalized };
}

export async function runSafetyRecheck(input: {
  db: Db;
  tronClient: TronApprovalClient;
  walletAddress: string;
  target?: SafetyRecheckTarget;
  pageLimit: number;
  maxPagesPerWallet: number;
  logger?: Logger;
  now?: () => Date;
}): Promise<SafetyRecheckSummary> {
  const target = input.target ?? { kind: "wallet" };
  const wallet = await getWatchedWalletByAddress(input.db, input.walletAddress);
  const summary: SafetyRecheckSummary = {
    walletAddress: input.walletAddress,
    walletFound: wallet !== null,
    target,
    approvalsProcessed: 0,
    approvalEventsClaimed: 0,
    riskRowsUpdated: 0,
    drainObservationsClaimed: 0
  };
  if (!wallet) return summary;

  await runSingleApprovalPollingCycle({
    wallets: [wallet],
    tronClient: input.tronClient,
    pageLimit: input.pageLimit,
    maxPagesPerWallet: input.maxPagesPerWallet,
    now: input.now,
    getApprovalPollState: async () => null,
    recordApprovalPollSuccess: async () => undefined,
    recordApprovalPollFailure: async (failure) => {
      (input.logger ?? defaultLogger).error("safety_recheck_approval_poll_failed", {
        watched_wallet_id: failure.watchedWalletId,
        error: failure.error
      });
    },
    upsertWalletApproval: async (approval) => {
      summary.approvalsProcessed += 1;
      await upsertWalletApproval(input.db, approval);
    },
    claimObservedApprovalEvent: async (approval) => {
      const claimed = await claimObservedApprovalEvent(input.db, approval);
      if (claimed) summary.approvalEventsClaimed += 1;
      return claimed;
    },
    claimObservedApprovalDrainEvent: async (observation) => {
      const claimed = await claimObservedApprovalDrainEvent(input.db, observation);
      if (claimed) summary.drainObservationsClaimed += 1;
      return claimed;
    },
    recordApprovalRisk: async (risk) => {
      const updated = await recordApprovalRisk(input.db, risk);
      if (updated) summary.riskRowsUpdated += 1;
      return updated;
    },
    markApprovalOwnerAlertSent: async () => false,
    markApprovalOwnerAlertSkipped: async (alert) => markApprovalOwnerAlertSkipped(input.db, alert),
    markApprovalOwnerAlertFailed: async (alert) => markApprovalOwnerAlertFailed(input.db, alert),
    getLabelsForAddress: (address) => listAddressLabels(input.db, address),
    getAddressMetadata: (address, now) => getAddressMetadata(input.db, address, now),
    upsertAddressMetadata: (metadata) => upsertAddressMetadata(input.db, metadata),
    getContractIntelligenceProfile: (address, now) => getContractIntelligenceProfile(input.db, address, now),
    upsertContractIntelligenceProfile: (profile) => upsertContractIntelligenceProfile(input.db, profile),
    recordRiskEvaluation: (evaluation) => saveRiskEvaluationEvidence(input.db, evaluation),
    sendUserAlert: async () => undefined,
    sendAdminAlert: async () => undefined,
    recheckExistingApprovals: true,
    suppressApprovalAlerts: true,
    approvalChangeLookupLimit: target.kind === "approval_tx" ? 50 : 1,
    targetApprovalTxHash: target.kind === "approval_tx" ? target.txHash : undefined,
    approvalFilter: (approval) => target.kind !== "spender" || approval.spenderAddress === target.address,
    approvalEventFilter: (event: ApprovalGuardEvent) => target.kind !== "approval_tx" || event.txHash === target.txHash,
    logger: input.logger ?? defaultLogger
  });

  return summary;
}

export function formatSafetyRecheckSummary(summary: SafetyRecheckSummary): string {
  if (!summary.walletFound) return `Wallet not found: ${summary.walletAddress}`;
  const target = summary.target.kind === "wallet"
    ? "wallet"
    : summary.target.kind === "spender"
      ? `spender ${summary.target.address}`
      : `approval tx ${summary.target.txHash}`;
  return [
    "Safety recheck complete.",
    `Wallet: ${summary.walletAddress}`,
    `Target: ${target}`,
    `Approvals processed: ${summary.approvalsProcessed}`,
    `Approval events claimed: ${summary.approvalEventsClaimed}`,
    `Risk rows updated: ${summary.riskRowsUpdated}`,
    `New shadow observations: ${summary.drainObservationsClaimed}`,
    "",
    "Owner/customer alerts were not sent."
  ].join("\n");
}
