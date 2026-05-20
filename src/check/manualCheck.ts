import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { calculateRisk, type RiskSignal } from "../risk/riskEngine";
import type { AddressLabel, RiskReport } from "../types";
import type { TronClient } from "../tron/tronClient";

export type ManualRiskSignals = {
  graphSignals: RiskSignal[];
  behaviorSignals: RiskSignal[];
  amlSignals: RiskSignal[];
};

export type ManualAddressCheckDeps = {
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getRiskSignalsForAddress?(address: string): Promise<ManualRiskSignals>;
};

export type ManualTransactionCheckDeps = ManualAddressCheckDeps & {
  tronClient: TronClient;
};

export type ManualCheckResult = {
  subjectAddress: string;
  report: RiskReport;
};

type TransactionInfoTransfer = {
  from_address?: unknown;
  contract_address?: unknown;
  contractAddress?: unknown;
  tokenInfo?: {
    tokenId?: unknown;
    tokenAbbr?: unknown;
  };
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOfficialUsdtTransfer(transfer: TransactionInfoTransfer): boolean {
  return (
    transfer.contract_address === TRON_USDT_CONTRACT_ADDRESS ||
    transfer.contractAddress === TRON_USDT_CONTRACT_ADDRESS ||
    transfer.tokenInfo?.tokenId === TRON_USDT_CONTRACT_ADDRESS
  );
}

function extractSenderFromTransactionInfo(raw: unknown): string | null {
  const record = raw as {
    trc20TransferInfo?: unknown;
  };

  if (Array.isArray(record.trc20TransferInfo)) {
    const transfers = record.trc20TransferInfo as TransactionInfoTransfer[];
    const preferredTransfer = transfers.find((transfer) => isOfficialUsdtTransfer(transfer));
    if (isNonEmptyString(preferredTransfer?.from_address)) return preferredTransfer.from_address;
  }

  return null;
}

async function getSignals(address: string, deps: ManualAddressCheckDeps): Promise<ManualRiskSignals> {
  return (
    (await deps.getRiskSignalsForAddress?.(address)) ?? {
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    }
  );
}

export async function checkAddress(address: string, deps: ManualAddressCheckDeps): Promise<ManualCheckResult> {
  const [labels, signals] = await Promise.all([deps.getLabelsForAddress(address), getSignals(address, deps)]);
  const report = calculateRisk({
    subjectAddress: address,
    labels,
    graphSignals: signals.graphSignals,
    behaviorSignals: signals.behaviorSignals,
    amlSignals: signals.amlSignals
  });

  return { subjectAddress: address, report };
}

export async function checkTransactionHash(txHash: string, deps: ManualTransactionCheckDeps): Promise<ManualCheckResult> {
  const raw = await deps.tronClient.getTransaction(txHash);
  const sender = extractSenderFromTransactionInfo(raw);
  if (!sender) {
    throw new Error(`Could not extract sender from transaction: ${txHash}`);
  }

  return checkAddress(sender, deps);
}
