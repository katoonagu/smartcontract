import type { HistoricalTransitBreakdown } from "../types";

const TRON_USDT_DECIMALS = 1_000_000n;

export type HistoricalTransitInput = {
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  inflowToOutflowRatio: number | null;
  bridgeDexRouterOutgoingRatio: number;
  unknownContractOutgoingRatio: number;
};

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rawUsdtAmount(raw: string): number {
  if (!/^\d+$/.test(raw)) return 0;
  const whole = BigInt(raw) / TRON_USDT_DECIMALS;
  const capped = whole > 10_000_000_000n ? 10_000_000_000n : whole;
  return Number(capped);
}

export function calculateHistoricalTransitBreakdown(input: HistoricalTransitInput): HistoricalTransitBreakdown {
  const incomingUsdt = rawUsdtAmount(input.incomingVolumeRaw);
  const outgoingUsdt = rawUsdtAmount(input.outgoingVolumeRaw);
  const flowUsdt = Math.max(incomingUsdt, outgoingUsdt);
  const passThrough = clampRatio(input.inflowToOutflowRatio ?? (incomingUsdt > 0 ? outgoingUsdt / incomingUsdt : 0));
  const serviceShare = clampRatio(Math.max(input.bridgeDexRouterOutgoingRatio, input.unknownContractOutgoingRatio));

  if (flowUsdt <= 0 || outgoingUsdt <= 0 || serviceShare < 0.2) {
    return {
      eligible: false,
      flowUsdt,
      volumeScore: 0,
      passThrough,
      passThroughScore: 0,
      serviceShare,
      serviceShareScore: 0,
      score: 0
    };
  }

  const volumeContribution = Math.min(20, (Math.log10(flowUsdt + 1) / 6) * 20);
  const passThroughContribution = passThrough * 20;
  const serviceShareContribution = serviceShare * 25;
  const volumeScore = clampScore(volumeContribution);
  const passThroughScore = clampScore(passThroughContribution);
  const serviceShareScore = clampScore(serviceShareContribution);
  const score = clampScore(35 + volumeContribution + passThroughContribution + serviceShareContribution);

  return {
    eligible: score >= 60,
    flowUsdt,
    volumeScore,
    passThrough,
    passThroughScore,
    serviceShare,
    serviceShareScore,
    score: score >= 60 ? Math.min(84, score) : 0
  };
}
