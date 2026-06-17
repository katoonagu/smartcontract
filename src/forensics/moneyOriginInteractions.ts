import type {
  BalanceFormingTransfer,
  ForensicRouteEdge,
  MoneyOriginCounterpartySummary,
  MoneyOriginFundingCandidate,
  MoneyOriginSenderInteractionProfile
} from "../types";

export type BuildMoneyOriginSenderInteractionProfileInput = {
  subjectAddress: string;
  balanceTransfer: BalanceFormingTransfer;
  edges: ForensicRouteEdge[];
  counterpartyLimit?: number;
  fundingCandidateLimit?: number;
  minFundingCandidatePreservationRatio?: number;
};

const DEFAULT_COUNTERPARTY_LIMIT = 8;
const DEFAULT_FUNDING_CANDIDATE_LIMIT = 6;
const DEFAULT_MIN_FUNDING_CANDIDATE_PRESERVATION_RATIO = 0.4;

function parseAmount(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function preservationRatio(left: bigint, right: bigint): number {
  if (left <= 0n || right <= 0n) return 0;
  const min = left < right ? left : right;
  const max = left > right ? left : right;
  return ratio(min, max);
}

function sumAmounts(edges: ForensicRouteEdge[]): string {
  return edges.reduce((total, edge) => total + parseAmount(edge.amountRaw), 0n).toString();
}

function compareAmountDesc(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function buildCounterparties(input: {
  senderAddress: string;
  edges: ForensicRouteEdge[];
  direction: "incoming" | "outgoing";
  limit: number;
}): MoneyOriginCounterpartySummary[] {
  const byAddress = new Map<string, {
    address: string;
    volumeRaw: bigint;
    txCount: number;
    firstSeen: Date;
    lastSeen: Date;
    txHashes: string[];
  }>();

  for (const edge of input.edges) {
    const matchesDirection = input.direction === "incoming"
      ? edge.toAddress === input.senderAddress
      : edge.fromAddress === input.senderAddress;
    if (!matchesDirection) continue;

    const counterparty = input.direction === "incoming" ? edge.fromAddress : edge.toAddress;
    const current = byAddress.get(counterparty);
    if (!current) {
      byAddress.set(counterparty, {
        address: counterparty,
        volumeRaw: parseAmount(edge.amountRaw),
        txCount: 1,
        firstSeen: edge.timestamp,
        lastSeen: edge.timestamp,
        txHashes: [edge.txHash]
      });
      continue;
    }

    current.volumeRaw += parseAmount(edge.amountRaw);
    current.txCount += 1;
    if (edge.timestamp < current.firstSeen) current.firstSeen = edge.timestamp;
    if (edge.timestamp > current.lastSeen) current.lastSeen = edge.timestamp;
    if (!current.txHashes.includes(edge.txHash) && current.txHashes.length < 5) {
      current.txHashes.push(edge.txHash);
    }
  }

  return [...byAddress.values()]
    .sort((left, right) =>
      compareAmountDesc(left.volumeRaw, right.volumeRaw) ||
      right.lastSeen.getTime() - left.lastSeen.getTime() ||
      left.address.localeCompare(right.address)
    )
    .slice(0, input.limit)
    .map((counterparty) => ({
      address: counterparty.address,
      direction: input.direction,
      volumeRaw: counterparty.volumeRaw.toString(),
      txCount: counterparty.txCount,
      firstSeen: counterparty.firstSeen.toISOString(),
      lastSeen: counterparty.lastSeen.toISOString(),
      txHashes: counterparty.txHashes
    }));
}

function buildFundingCandidates(input: {
  senderAddress: string;
  balanceTransfer: BalanceFormingTransfer;
  edges: ForensicRouteEdge[];
  limit: number;
  minPreservationRatio: number;
}): MoneyOriginFundingCandidate[] {
  const expectedAmountRaw = parseAmount(input.balanceTransfer.amountRaw);
  const balanceTransferAt = new Date(input.balanceTransfer.timestamp);

  return input.edges
    .filter((edge) => edge.toAddress === input.senderAddress)
    .filter((edge) => edge.timestamp <= balanceTransferAt)
    .map((edge) => ({
      edge,
      amountPreservationRatio: preservationRatio(parseAmount(edge.amountRaw), expectedAmountRaw),
      timeDeltaMs: balanceTransferAt.getTime() - edge.timestamp.getTime()
    }))
    .filter((candidate) => candidate.amountPreservationRatio >= input.minPreservationRatio)
    .sort((left, right) =>
      right.amountPreservationRatio - left.amountPreservationRatio ||
      left.timeDeltaMs - right.timeDeltaMs ||
      right.edge.timestamp.getTime() - left.edge.timestamp.getTime()
    )
    .slice(0, input.limit)
    .map((candidate) => ({
      txHash: candidate.edge.txHash,
      fromAddress: candidate.edge.fromAddress,
      toAddress: candidate.edge.toAddress,
      amountRaw: candidate.edge.amountRaw,
      timestamp: candidate.edge.timestamp.toISOString(),
      amountPreservationRatio: candidate.amountPreservationRatio,
      timeDeltaMs: candidate.timeDeltaMs
    }));
}

export function buildMoneyOriginSenderInteractionProfile(
  input: BuildMoneyOriginSenderInteractionProfileInput
): MoneyOriginSenderInteractionProfile {
  const counterpartyLimit = input.counterpartyLimit ?? DEFAULT_COUNTERPARTY_LIMIT;
  const fundingCandidateLimit = input.fundingCandidateLimit ?? DEFAULT_FUNDING_CANDIDATE_LIMIT;
  const minPreservationRatio = input.minFundingCandidatePreservationRatio ?? DEFAULT_MIN_FUNDING_CANDIDATE_PRESERVATION_RATIO;
  const senderAddress = input.balanceTransfer.fromAddress;
  const incomingEdges = input.edges.filter((edge) => edge.toAddress === senderAddress);
  const outgoingEdges = input.edges.filter((edge) => edge.fromAddress === senderAddress);

  return {
    balanceTransferTxHash: input.balanceTransfer.txHash,
    senderAddress,
    incomingVolumeRaw: sumAmounts(incomingEdges),
    outgoingVolumeRaw: sumAmounts(outgoingEdges),
    incomingTxCount: incomingEdges.length,
    outgoingTxCount: outgoingEdges.length,
    topIncomingCounterparties: buildCounterparties({
      senderAddress,
      edges: input.edges,
      direction: "incoming",
      limit: counterpartyLimit
    }),
    topOutgoingCounterparties: buildCounterparties({
      senderAddress,
      edges: input.edges,
      direction: "outgoing",
      limit: counterpartyLimit
    }),
    fundingCandidates: buildFundingCandidates({
      senderAddress,
      balanceTransfer: input.balanceTransfer,
      edges: input.edges,
      limit: fundingCandidateLimit,
      minPreservationRatio
    })
  };
}
