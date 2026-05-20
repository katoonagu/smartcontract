import { formatAdminSuspiciousAlert, formatUserIncomingAlert } from "../alerts/formatters";
import { parseTrc20IncomingTransfer } from "../parser/transactionParser";
import { calculateRisk, type RiskSignal } from "../risk/riskEngine";
import type { AddressLabel, TronTransferEvent, WatchedWallet } from "../types";
import type { TronClient } from "../tron/tronClient";

export type MonitorRiskSignals = {
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
};

export type PollingCycleDeps = {
  wallets: WatchedWallet[];
  tronClient: TronClient;
  hasObservedTransaction(txHash: string, watchedWalletId: string): Promise<boolean>;
  saveObservedTransaction(input: { watchedWalletId: string; event: TronTransferEvent }): Promise<void>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getRiskSignalsForAddress?(address: string, event: TronTransferEvent, wallet: WatchedWallet): Promise<MonitorRiskSignals>;
  sendUserAlert(telegramUserId: string, message: string): Promise<void>;
  sendAdminAlert(message: string): Promise<void>;
};

function shouldNotifyAdmins(level: string): boolean {
  return level === "HIGH" || level === "CRITICAL";
}

async function getSignals(
  address: string,
  event: TronTransferEvent,
  wallet: WatchedWallet,
  deps: PollingCycleDeps
): Promise<MonitorRiskSignals> {
  return (
    (await deps.getRiskSignalsForAddress?.(address, event, wallet)) ?? {
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    }
  );
}

export async function runSinglePollingCycle(deps: PollingCycleDeps): Promise<void> {
  for (const wallet of deps.wallets) {
    const rawTransfers = await deps.tronClient.listIncomingTrc20Transfers(wallet.address);

    for (const rawTransfer of rawTransfers) {
      const event = parseTrc20IncomingTransfer(rawTransfer, wallet.address);
      if (!event) continue;
      if (await deps.hasObservedTransaction(event.txHash, wallet.id)) continue;

      const [labels, signals] = await Promise.all([
        deps.getLabelsForAddress(event.sender),
        getSignals(event.sender, event, wallet, deps)
      ]);
      const report = calculateRisk({
        subjectAddress: event.sender,
        labels,
        graphSignals: signals.graphSignals,
        behaviorSignals: signals.behaviorSignals,
        amlSignals: signals.amlSignals
      });

      await deps.sendUserAlert(
        wallet.telegramUserId,
        formatUserIncomingAlert({
          amount: event.amount,
          sender: event.sender,
          txHash: event.txHash,
          report
        })
      );

      if (shouldNotifyAdmins(report.level)) {
        await deps.sendAdminAlert(
          formatAdminSuspiciousAlert({
            telegramUserId: wallet.telegramUserId,
            telegramUsername: wallet.telegramUsername,
            watchedWallet: wallet.address,
            amount: event.amount,
            sender: event.sender,
            txHash: event.txHash,
            report
          })
        );
      }

      await deps.saveObservedTransaction({ watchedWalletId: wallet.id, event });
    }
  }
}
