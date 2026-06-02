import type { ForensicRouteEdge, MoneyOriginDrainEpisode } from "../types";
import { DEFAULT_DRAIN_EPISODE_WINDOW_MS } from "./provenanceTracingConfig";

export type DetectDrainEpisodeInput = {
  subjectAddress: string;
  anchorTxHash: string;
  edges: ForensicRouteEdge[];
  serviceAddresses: Set<string>;
};

function positiveRawAmount(amountRaw: string): bigint | null {
  if (!/^\d+$/.test(amountRaw)) return null;
  const amount = BigInt(amountRaw);
  return amount > 0n ? amount : null;
}

function rawRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 1_000_000n / denominator) / 1_000_000;
}

export function detectDrainEpisode(input: DetectDrainEpisodeInput): MoneyOriginDrainEpisode | null {
  const subjectAddress = input.subjectAddress.toLowerCase();
  const anchor = input.edges.find((edge) =>
    edge.txHash === input.anchorTxHash &&
    edge.fromAddress.toLowerCase() === subjectAddress &&
    positiveRawAmount(edge.amountRaw) !== null
  );
  if (!anchor) return null;

  const windowStartMs = anchor.timestamp.getTime() - DEFAULT_DRAIN_EPISODE_WINDOW_MS;
  const anchorTimestampMs = anchor.timestamp.getTime();
  const funding = input.edges
    .filter((edge) => {
      if (edge.toAddress.toLowerCase() !== subjectAddress) return false;
      if (positiveRawAmount(edge.amountRaw) === null) return false;
      const timestampMs = edge.timestamp.getTime();
      return timestampMs >= windowStartMs && timestampMs <= anchorTimestampMs;
    })
    .sort((left, right) => {
      const timestampDelta = right.timestamp.getTime() - left.timestamp.getTime();
      if (timestampDelta !== 0) return timestampDelta;
      return left.txHash.localeCompare(right.txHash);
    })[0] ?? null;
  if (!funding) return null;

  const fundingTimestampMs = funding.timestamp.getTime();
  const relevantOutgoing = input.edges
    .filter((edge) => {
      if (edge.fromAddress.toLowerCase() !== subjectAddress) return false;
      if (positiveRawAmount(edge.amountRaw) === null) return false;
      const timestampMs = edge.timestamp.getTime();
      return timestampMs >= fundingTimestampMs && timestampMs <= anchorTimestampMs;
    })
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  if (relevantOutgoing.length <= 1) return null;

  const episodeOutgoingRaw = relevantOutgoing.reduce((sum, edge) => sum + BigInt(edge.amountRaw), 0n);
  const bridgeOutgoingRaw = relevantOutgoing.reduce((sum, edge) => {
    return input.serviceAddresses.has(edge.toAddress.toLowerCase()) ? sum + BigInt(edge.amountRaw) : sum;
  }, 0n);
  const episodeSelectedRaw = BigInt(anchor.amountRaw);

  return {
    anchorTxHash: anchor.txHash,
    fundingTxHash: funding.txHash,
    fundingAmountRaw: funding.amountRaw,
    fundingTimestamp: funding.timestamp.toISOString(),
    startTimestamp: relevantOutgoing[0].timestamp.toISOString(),
    endTimestamp: relevantOutgoing[relevantOutgoing.length - 1].timestamp.toISOString(),
    episodeOutgoingRaw: episodeOutgoingRaw.toString(),
    episodeSelectedRaw: episodeSelectedRaw.toString(),
    episodeCoverageRatio: rawRatio(episodeSelectedRaw, episodeOutgoingRaw),
    outgoingTxHashes: relevantOutgoing.map((edge) => edge.txHash),
    bridgeOutgoingRaw: bridgeOutgoingRaw.toString(),
    bridgeOutgoingShare: rawRatio(bridgeOutgoingRaw, episodeOutgoingRaw)
  };
}
