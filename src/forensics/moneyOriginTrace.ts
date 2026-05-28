import type {
  AddressLabel,
  BalanceFormingTransfer,
  ForensicRouteEdge,
  MoneyOriginPath,
  MoneyOriginPathStep,
  ServiceClassification
} from "../types";
import { classifyMoneyOriginStop } from "./moneyOriginPolicy";

export type TraceMoneyOriginPathInput = {
  subjectAddress: string;
  balanceTransfer: BalanceFormingTransfer;
  maxDepth: number;
  beamWidth: number;
  maxAddressFetches: number;
  maxEdgesPerAddress: number;
  minAmountPreservationRatio?: number;
  maxTimeDeltaMs?: number;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
};

type TraceState = {
  currentAddress: string;
  expectedAmountRaw: bigint;
  latestTimestamp: Date;
  addressesFromSubject: string[];
  txHashesFromSubject: string[];
  stepsFromSubject: MoneyOriginPathStep[];
  timestampsFromSubject: Date[];
  minPreservation: number;
  depth: number;
  score: number;
};

const DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO = 0.7;
const DEFAULT_MAX_TIME_DELTA_MS = 365 * 24 * 60 * 60 * 1000;

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

function timeDeltaMs(previous: Date, next: Date): number {
  return next.getTime() - previous.getTime();
}

function compareCandidateEdges(input: {
  expectedAmountRaw: bigint;
  latestTimestamp: Date;
  left: ForensicRouteEdge;
  right: ForensicRouteEdge;
}): number {
  const leftPreservation = preservationRatio(parseAmount(input.left.amountRaw), input.expectedAmountRaw);
  const rightPreservation = preservationRatio(parseAmount(input.right.amountRaw), input.expectedAmountRaw);
  if (leftPreservation !== rightPreservation) return rightPreservation - leftPreservation;
  const leftDelta = timeDeltaMs(input.left.timestamp, input.latestTimestamp);
  const rightDelta = timeDeltaMs(input.right.timestamp, input.latestTimestamp);
  if (leftDelta !== rightDelta) return leftDelta - rightDelta;
  return input.left.txHash.localeCompare(input.right.txHash);
}

function candidateIncomingEdges(input: {
  currentAddress: string;
  expectedAmountRaw: bigint;
  latestTimestamp: Date;
  edges: ForensicRouteEdge[];
  minPreservation: number;
  maxTimeDeltaMs: number;
  maxEdges: number;
}): ForensicRouteEdge[] {
  return input.edges
    .filter((edge) => edge.toAddress === input.currentAddress)
    .filter((edge) => edge.timestamp <= input.latestTimestamp)
    .filter((edge) => parseAmount(edge.amountRaw) > 0n)
    .filter((edge) => preservationRatio(parseAmount(edge.amountRaw), input.expectedAmountRaw) >= input.minPreservation)
    .filter((edge) => timeDeltaMs(edge.timestamp, input.latestTimestamp) <= input.maxTimeDeltaMs)
    .sort((left, right) => compareCandidateEdges({
      expectedAmountRaw: input.expectedAmountRaw,
      latestTimestamp: input.latestTimestamp,
      left,
      right
    }))
    .slice(0, input.maxEdges);
}

function timeSpanMs(state: TraceState): number {
  const timestamps = state.timestampsFromSubject.map((timestamp) => timestamp.getTime());
  return timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
}

function pathFromState(input: {
  state: TraceState;
  balanceTransferTxHash: string;
  balanceShare: number;
  rootSourceType: MoneyOriginPath["rootSourceType"];
  stoppedReason: MoneyOriginPath["stoppedReason"];
  verdict: MoneyOriginPath["verdict"];
  riskScoreContribution: number;
  exposureSourceKey?: string;
  exposureSourceLabel?: string;
  reasons: string[];
}): MoneyOriginPath {
  return {
    balanceTransferTxHash: input.balanceTransferTxHash,
    rootSourceAddress: input.state.currentAddress,
    rootSourceType: input.rootSourceType,
    balanceShare: input.balanceShare,
    exposureSourceKey: input.exposureSourceKey ?? null,
    exposureSourceLabel: input.exposureSourceLabel ?? null,
    pathAddresses: [...input.state.addressesFromSubject].reverse(),
    txHashes: [...input.state.txHashesFromSubject].reverse(),
    steps: [...input.state.stepsFromSubject].reverse(),
    amountPreservationRatio: input.state.minPreservation,
    timeSpanMs: timeSpanMs(input.state),
    stoppedReason: input.stoppedReason,
    verdict: input.verdict,
    riskScoreContribution: input.riskScoreContribution,
    reasons: input.reasons
  };
}

function incompletePath(input: {
  state: TraceState;
  balanceTransferTxHash: string;
  balanceShare: number;
  stoppedReason: MoneyOriginPath["stoppedReason"];
  message: string;
}): MoneyOriginPath {
  return pathFromState({
    state: input.state,
    balanceTransferTxHash: input.balanceTransferTxHash,
    balanceShare: input.balanceShare,
    rootSourceType: "incomplete",
    stoppedReason: input.stoppedReason,
    verdict: "REVIEW",
    riskScoreContribution: input.stoppedReason === "weak_amount_or_time_continuity" ? 50 : 45,
    reasons: [input.message]
  });
}

function terminalRank(path: MoneyOriginPath): number {
  if (path.verdict === "DECLINE") return 3_000 + path.riskScoreContribution;
  if (path.verdict === "ACCEPTABLE") return 2_000 - path.txHashes.length;
  return 1_000 + path.riskScoreContribution;
}

export async function traceMoneyOriginPath(input: TraceMoneyOriginPathInput): Promise<MoneyOriginPath> {
  const minPreservation = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const maxTimeDeltaMs = input.maxTimeDeltaMs ?? DEFAULT_MAX_TIME_DELTA_MS;
  const initialTimestamp = new Date(input.balanceTransfer.timestamp);
  const initialState: TraceState = {
    currentAddress: input.balanceTransfer.fromAddress,
    expectedAmountRaw: parseAmount(input.balanceTransfer.amountRaw),
    latestTimestamp: initialTimestamp,
    addressesFromSubject: [input.subjectAddress, input.balanceTransfer.fromAddress],
    txHashesFromSubject: [input.balanceTransfer.txHash],
    stepsFromSubject: [{
      txHash: input.balanceTransfer.txHash,
      fromAddress: input.balanceTransfer.fromAddress,
      toAddress: input.subjectAddress,
      amountRaw: input.balanceTransfer.amountRaw,
      timestamp: input.balanceTransfer.timestamp
    }],
    timestampsFromSubject: [initialTimestamp],
    minPreservation: 1,
    depth: 0,
    score: 0
  };

  const fetchedAddresses = new Set<string>();
  const terminals: MoneyOriginPath[] = [];
  let frontier: TraceState[] = [initialState];

  while (frontier.length > 0) {
    const nextFrontier: TraceState[] = [];
    for (const state of frontier) {
      const labels = await input.getLabelsForAddress(state.currentAddress);
      const classification = await input.getClassificationForAddress(state.currentAddress);
      const stop = classifyMoneyOriginStop({
        address: state.currentAddress,
        labels,
        classification,
        balanceShare: input.balanceTransfer.coverageShare
      });
      if (stop) {
        terminals.push(pathFromState({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          balanceShare: input.balanceTransfer.coverageShare,
          rootSourceType: stop.rootSourceType,
          stoppedReason: stop.stoppedReason,
          verdict: stop.verdict,
          riskScoreContribution: stop.riskScoreContribution,
          exposureSourceKey: stop.exposureSourceKey,
          exposureSourceLabel: stop.exposureSourceLabel,
          reasons: stop.reasons
        }));
        continue;
      }

      if (state.depth >= input.maxDepth) {
        terminals.push(incompletePath({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          balanceShare: input.balanceTransfer.coverageShare,
          stoppedReason: "data_budget_exhausted",
          message: `Clean EOA chain reached maxDepth=${input.maxDepth} before a known good or decline source was found; manual review required.`
        }));
        continue;
      }

      if (!fetchedAddresses.has(state.currentAddress) && fetchedAddresses.size >= input.maxAddressFetches) {
        terminals.push(incompletePath({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          balanceShare: input.balanceTransfer.coverageShare,
          stoppedReason: "data_budget_exhausted",
          message: `Trace reached maxAddressFetches=${input.maxAddressFetches} before a known good or decline source was found; manual review required.`
        }));
        continue;
      }

      fetchedAddresses.add(state.currentAddress);
      const edges = await input.fetchEdgesForAddress(state.currentAddress);
      const candidates = candidateIncomingEdges({
        currentAddress: state.currentAddress,
        expectedAmountRaw: state.expectedAmountRaw,
        latestTimestamp: state.latestTimestamp,
        edges,
        minPreservation,
        maxTimeDeltaMs,
        maxEdges: input.maxEdgesPerAddress
      });

      if (candidates.length === 0) {
        const hasAnyPreviousIncoming = edges.some((edge) =>
          edge.toAddress === state.currentAddress &&
          edge.timestamp <= state.latestTimestamp &&
          parseAmount(edge.amountRaw) > 0n
        );
        terminals.push(incompletePath({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          balanceShare: input.balanceTransfer.coverageShare,
          stoppedReason: hasAnyPreviousIncoming ? "weak_amount_or_time_continuity" : "no_previous_transfer",
          message: hasAnyPreviousIncoming
            ? "Previous incoming transfers exist, but amount/time continuity is too weak for acceptable balance-origin proof; manual review required."
            : "No previous inbound USDT transfer found before this clean EOA hop; manual review required."
        }));
        continue;
      }

      for (const edge of candidates) {
        const preservation = preservationRatio(parseAmount(edge.amountRaw), state.expectedAmountRaw);
        nextFrontier.push({
          currentAddress: edge.fromAddress,
          expectedAmountRaw: parseAmount(edge.amountRaw),
          latestTimestamp: edge.timestamp,
          addressesFromSubject: [...state.addressesFromSubject, edge.fromAddress],
          txHashesFromSubject: [...state.txHashesFromSubject, edge.txHash],
          stepsFromSubject: [
            ...state.stepsFromSubject,
            {
              txHash: edge.txHash,
              fromAddress: edge.fromAddress,
              toAddress: edge.toAddress,
              amountRaw: edge.amountRaw,
              timestamp: edge.timestamp.toISOString()
            }
          ],
          timestampsFromSubject: [...state.timestampsFromSubject, edge.timestamp],
          minPreservation: Math.min(state.minPreservation, preservation),
          depth: state.depth + 1,
          score: state.score + preservation * 100
        });
      }
    }

    if (terminals.some((path) => path.verdict === "DECLINE")) break;
    frontier = nextFrontier
      .sort((left, right) => right.score - left.score || left.currentAddress.localeCompare(right.currentAddress))
      .slice(0, input.beamWidth);
  }

  if (terminals.length === 0) {
    return incompletePath({
      state: initialState,
      balanceTransferTxHash: input.balanceTransfer.txHash,
      balanceShare: input.balanceTransfer.coverageShare,
      stoppedReason: "data_budget_exhausted",
      message: "Trace ended without terminal candidates; manual review required."
    });
  }

  return terminals.sort((left, right) => terminalRank(right) - terminalRank(left))[0];
}
