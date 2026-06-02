import type {
  CrossChainAddress,
  CrossChainEvidenceRef,
  ProviderPayloadRef
} from "../types";

export type TimeWindow = {
  start: string;
  end: string;
};

export type CrossChainTransfer = {
  id: string;
  protocol: string;
  source: CrossChainAddress;
  destination: CrossChainAddress;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  assetSymbol: string;
  amountRaw: string;
  decimals: number;
  timestamp: string | null;
  evidenceRefs: readonly CrossChainEvidenceRef[];
  payloadRef: ProviderPayloadRef | null;
  labels: readonly string[];
};

export type ProviderRiskSnapshot = {
  address: CrossChainAddress;
  provider: ProviderPayloadRef["provider"];
  riskScore: number;
  labels: readonly string[];
  evidenceRefs: readonly CrossChainEvidenceRef[];
  payloadRef: ProviderPayloadRef | null;
};

export type CrossChainTxQuery = {
  chain?: string;
  txHash: string;
  address?: string;
  timeWindow?: TimeWindow;
};

export type CrossChainAddressQuery = {
  chain?: string;
  address: string;
  timeWindow?: TimeWindow;
  assetSymbol?: string;
  minAmountRaw?: string;
};

export interface CrossChainDiscoveryProvider {
  findTransfersByTx(query: CrossChainTxQuery): Promise<CrossChainTransfer[]>;
  findTransfersByAddress(query: CrossChainAddressQuery): Promise<CrossChainTransfer[]>;
  getAddressRisk(query: CrossChainAddressQuery): Promise<ProviderRiskSnapshot | null>;
}

export type FixtureCrossChainDiscoveryData = {
  transfers: readonly CrossChainTransfer[];
  riskSnapshots: readonly ProviderRiskSnapshot[];
};

export function createFixtureCrossChainDiscoveryProvider(
  data: FixtureCrossChainDiscoveryData
): CrossChainDiscoveryProvider {
  return {
    async findTransfersByTx(query) {
      return data.transfers.filter((transfer) => {
        if (!isUnsignedIntegerString(transfer.amountRaw)) {
          return false;
        }

        const sourceTxMatches = equalsIgnoreCase(transfer.sourceTxHash, query.txHash);
        const destinationTxMatches = equalsIgnoreCase(transfer.destinationTxHash, query.txHash);

        if (!sourceTxMatches && !destinationTxMatches) {
          return false;
        }

        if (query.chain && !txChainMatches(transfer, query.chain, { sourceTxMatches, destinationTxMatches })) {
          return false;
        }

        if (query.address && !transferAddressMatches(transfer, query.address)) {
          return false;
        }

        return timestampInWindow(transfer.timestamp, query.timeWindow);
      }).map(cloneTransfer);
    },

    async findTransfersByAddress(query) {
      return data.transfers.filter((transfer) => {
        if (!isUnsignedIntegerString(transfer.amountRaw)) {
          return false;
        }

        if (!transferAddressMatches(transfer, query.address)) {
          return false;
        }

        if (query.chain && !transferAddressChainMatches(transfer, query.address, query.chain)) {
          return false;
        }

        if (!timestampInWindow(transfer.timestamp, query.timeWindow)) {
          return false;
        }

        if (query.assetSymbol && !equalsIgnoreCase(transfer.assetSymbol, query.assetSymbol)) {
          return false;
        }

        return amountMeetsMinimum(transfer.amountRaw, query.minAmountRaw);
      }).map(cloneTransfer);
    },

    async getAddressRisk(query) {
      const snapshot = data.riskSnapshots.find((candidate) => {
        if (!equalsIgnoreCase(candidate.address.address, query.address)) {
          return false;
        }

        return !query.chain || equalsIgnoreCase(candidate.address.chain, query.chain);
      });

      return snapshot ? cloneRiskSnapshot(snapshot) : null;
    }
  };
}

function cloneTransfer(transfer: CrossChainTransfer): CrossChainTransfer {
  return {
    ...transfer,
    source: { ...transfer.source },
    destination: { ...transfer.destination },
    evidenceRefs: transfer.evidenceRefs.map((evidenceRef) => ({ ...evidenceRef })),
    payloadRef: transfer.payloadRef ? { ...transfer.payloadRef } : null,
    labels: [...transfer.labels]
  };
}

function cloneRiskSnapshot(snapshot: ProviderRiskSnapshot): ProviderRiskSnapshot {
  return {
    ...snapshot,
    address: { ...snapshot.address },
    labels: [...snapshot.labels],
    evidenceRefs: snapshot.evidenceRefs.map((evidenceRef) => ({ ...evidenceRef })),
    payloadRef: snapshot.payloadRef ? { ...snapshot.payloadRef } : null
  };
}

function normalize(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value).toLowerCase();
}

function equalsIgnoreCase(left: string | number | null | undefined, right: string | number | null | undefined): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}

function transferAddressMatches(transfer: CrossChainTransfer, address: string): boolean {
  return equalsIgnoreCase(transfer.source.address, address) ||
    equalsIgnoreCase(transfer.destination.address, address);
}

function transferAddressChainMatches(transfer: CrossChainTransfer, address: string, chain: string): boolean {
  return (equalsIgnoreCase(transfer.source.address, address) && equalsIgnoreCase(transfer.source.chain, chain)) ||
    (equalsIgnoreCase(transfer.destination.address, address) && equalsIgnoreCase(transfer.destination.chain, chain));
}

function txChainMatches(
  transfer: CrossChainTransfer,
  chain: string,
  matches: { sourceTxMatches: boolean; destinationTxMatches: boolean }
): boolean {
  if (matches.sourceTxMatches && equalsIgnoreCase(transfer.source.chain, chain)) {
    return true;
  }

  if (matches.destinationTxMatches && equalsIgnoreCase(transfer.destination.chain, chain)) {
    return true;
  }

  return false;
}

function timestampInWindow(timestamp: string | null, timeWindow: TimeWindow | undefined): boolean {
  if (!timeWindow) {
    return true;
  }

  if (!timestamp) {
    return false;
  }

  const timestampMs = Date.parse(timestamp);
  const startMs = Date.parse(timeWindow.start);
  const endMs = Date.parse(timeWindow.end);

  if (!Number.isFinite(timestampMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return false;
  }

  return timestampMs >= startMs && timestampMs <= endMs;
}

function isUnsignedIntegerString(value: string): boolean {
  return /^\d+$/.test(value);
}

function amountMeetsMinimum(amountRaw: string, minAmountRaw: string | undefined): boolean {
  if (minAmountRaw === undefined) {
    return true;
  }

  if (!isUnsignedIntegerString(amountRaw) || !isUnsignedIntegerString(minAmountRaw)) {
    return false;
  }

  return BigInt(amountRaw) >= BigInt(minAmountRaw);
}
