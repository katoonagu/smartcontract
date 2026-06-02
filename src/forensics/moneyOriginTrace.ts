import type {
  AddressLabel,
  BalanceFormingTransfer,
  ForensicRouteEdge,
  MoneyOriginFundingBundle,
  MoneyOriginPath,
  MoneyOriginPathStep,
  MoneyOriginTraceHistoryCoverage,
  ServiceClassification
} from "../types";
import { buildFundingBundleForTraceHop } from "./incomingDepositCashflow";
import { classifyMoneyOriginStop } from "./moneyOriginPolicy";
import {
  DEFAULT_BUNDLE_COVERAGE_THRESHOLD,
  DEFAULT_MAX_BUNDLE_FUNDERS
} from "./provenanceTracingConfig";

export type TraceMoneyOriginPathInput = {
  subjectAddress: string;
  balanceTransfer: BalanceFormingTransfer;
  maxDepth: number;
  beamWidth: number;
  maxAddressFetches: number;
  maxEdgesPerAddress: number;
  minAmountPreservationRatio?: number;
  maxTimeDeltaMs?: number;
  bundleCoverageThreshold?: number;
  maxBundleFunders?: number;
  fetchEdgesForAddress(address: string, options?: { latestTimestamp?: Date }): Promise<ForensicRouteEdge[]>;
  getHistoryCoverageForAddress?(
    address: string,
    options: { latestTimestamp?: Date }
  ): Promise<MoneyOriginTraceHistoryCoverage>;
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
  fundingBundles: MoneyOriginFundingBundle[];
  historyCoverage: MoneyOriginTraceHistoryCoverage[];
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

function fundingCoverageRatio(incomingAmount: bigint, expectedAmount: bigint): number {
  if (incomingAmount <= 0n || expectedAmount <= 0n) return 0;
  if (incomingAmount >= expectedAmount) return 1;
  return ratio(incomingAmount, expectedAmount);
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
  const leftPreservation = fundingCoverageRatio(parseAmount(input.left.amountRaw), input.expectedAmountRaw);
  const rightPreservation = fundingCoverageRatio(parseAmount(input.right.amountRaw), input.expectedAmountRaw);
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
    .filter((edge) => fundingCoverageRatio(parseAmount(edge.amountRaw), input.expectedAmountRaw) >= input.minPreservation)
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

function oldestFetchedTransferAt(edges: ForensicRouteEdge[]): string | null {
  const timestamps = edges
    .map((edge) => edge.timestamp.getTime())
    .filter((timestamp) => Number.isFinite(timestamp));
  if (timestamps.length === 0) return null;
  return new Date(Math.min(...timestamps)).toISOString();
}

function fallbackHistoryCoverage(input: {
  address: string;
  latestTimestamp: Date;
  edges: ForensicRouteEdge[];
}): MoneyOriginTraceHistoryCoverage {
  return {
    address: input.address,
    targetTimestamp: input.latestTimestamp.toISOString(),
    fetchedTransferCount: input.edges.length,
    oldestFetchedTransferAt: oldestFetchedTransferAt(input.edges),
    reachedTargetHop: true,
    source: "unknown"
  };
}

function targetEdgeFromState(state: TraceState): ForensicRouteEdge | null {
  const lastStep = state.stepsFromSubject[state.stepsFromSubject.length - 1];
  if (!lastStep) return null;
  return {
    id: lastStep.txHash,
    txHash: lastStep.txHash,
    fromAddress: state.currentAddress,
    toAddress: lastStep.toAddress,
    amountRaw: state.expectedAmountRaw.toString(),
    timestamp: state.latestTimestamp,
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

function toMoneyOriginFundingBundle(input: ReturnType<typeof buildFundingBundleForTraceHop>): MoneyOriginFundingBundle | null {
  if (!input) return null;
  return {
    hopTxHash: input.targetTxHash,
    hopAddress: input.targetAddress,
    expectedAmountRaw: input.expectedAmountRaw,
    coveredAmountRaw: input.coveredAmountRaw,
    coverageRatio: input.coverageRatio,
    members: input.members.map((member) => ({
      txHash: member.edge.txHash,
      fromAddress: member.edge.fromAddress,
      toAddress: member.edge.toAddress,
      originalAmountRaw: member.edge.amountRaw,
      usedAmountRaw: member.usedAmountRaw,
      spentBeforeHopRaw: member.spentBeforeHopRaw,
      timestamp: member.edge.timestamp.toISOString(),
      coverageShare: member.coverageRatio
    }))
  };
}

function pathFromState(input: {
  state: TraceState;
  balanceTransferTxHash: string;
  balanceShare: number;
  amountUsage?: MoneyOriginPath["amountUsage"];
  rootSourceType: MoneyOriginPath["rootSourceType"];
  stoppedReason: MoneyOriginPath["stoppedReason"];
  verdict: MoneyOriginPath["verdict"];
  riskScoreContribution: number;
  exposureSourceKey?: string;
  exposureSourceLabel?: string;
  sourceExposureKind?: MoneyOriginPath["sourceExposureKind"];
  reasons: string[];
}): MoneyOriginPath {
  return {
    balanceTransferTxHash: input.balanceTransferTxHash,
    rootSourceAddress: input.state.currentAddress,
    rootSourceType: input.rootSourceType,
    balanceShare: input.balanceShare,
    amountUsage: input.amountUsage ?? null,
    exposureSourceKey: input.exposureSourceKey ?? null,
    exposureSourceLabel: input.exposureSourceLabel ?? null,
    sourceExposureKind: input.sourceExposureKind ?? null,
    pathAddresses: [...input.state.addressesFromSubject].reverse(),
    txHashes: [...input.state.txHashesFromSubject].reverse(),
    steps: [...input.state.stepsFromSubject].reverse(),
    fundingBundles: input.state.fundingBundles,
    historyCoverage: input.state.historyCoverage,
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
  amountUsage?: MoneyOriginPath["amountUsage"];
  stoppedReason: MoneyOriginPath["stoppedReason"];
  message: string;
}): MoneyOriginPath {
  return pathFromState({
    state: input.state,
    balanceTransferTxHash: input.balanceTransferTxHash,
    balanceShare: input.balanceShare,
    amountUsage: input.amountUsage,
    rootSourceType: "incomplete",
    stoppedReason: input.stoppedReason,
    verdict: "REVIEW",
    riskScoreContribution: input.stoppedReason === "data_budget_exhausted" ||
      input.stoppedReason === "incoming_history_not_fetched"
      ? 45
      : input.stoppedReason === "no_incoming_transfers_seen" ||
        input.stoppedReason === "no_previous_transfer"
        ? 35
        : input.stoppedReason === "incoming_seen_but_below_continuity"
          ? 30
        : 30,
    reasons: [input.message]
  });
}

function terminalRank(path: MoneyOriginPath): number {
  if (path.rootSourceType === "risky_label") return 5_000 + path.riskScoreContribution;

  if (path.rootSourceType === "decline_boundary") {
    const isContextualSourcePolicy = path.sourceExposureKind === "htx_huobi" || path.sourceExposureKind === "whitebit";
    const balanceShare = path.balanceShare ?? 0;
    if (!isContextualSourcePolicy && balanceShare >= 0.5) return 4_000 + path.riskScoreContribution;
    return 2_000 + path.riskScoreContribution;
  }

  if (path.rootSourceType === "allowlist_cex") return 3_000 - path.txHashes.length;
  return 1_000 + path.riskScoreContribution;
}

export async function traceMoneyOriginPath(input: TraceMoneyOriginPathInput): Promise<MoneyOriginPath> {
  const minPreservation = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const maxTimeDeltaMs = input.maxTimeDeltaMs ?? DEFAULT_MAX_TIME_DELTA_MS;
  const bundleCoverageThreshold = input.bundleCoverageThreshold ?? DEFAULT_BUNDLE_COVERAGE_THRESHOLD;
  const maxBundleFunders = input.maxBundleFunders ?? DEFAULT_MAX_BUNDLE_FUNDERS;
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
    fundingBundles: [],
    historyCoverage: [],
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
          amountUsage: input.balanceTransfer.amountUsage ?? null,
          rootSourceType: stop.rootSourceType,
          stoppedReason: stop.stoppedReason,
          verdict: stop.verdict,
          riskScoreContribution: stop.riskScoreContribution,
          exposureSourceKey: stop.exposureSourceKey,
          exposureSourceLabel: stop.exposureSourceLabel,
          sourceExposureKind: stop.sourceExposureKind,
          reasons: stop.reasons
        }));
        continue;
      }

      if (state.depth >= input.maxDepth) {
        terminals.push(incompletePath({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          balanceShare: input.balanceTransfer.coverageShare,
          amountUsage: input.balanceTransfer.amountUsage ?? null,
          stoppedReason: "data_budget_exhausted",
          message: `Clean EOA chain reached maxDepth=${input.maxDepth} before a known good or decline source was found; source remains unproven.`
        }));
        continue;
      }

      if (!fetchedAddresses.has(state.currentAddress) && fetchedAddresses.size >= input.maxAddressFetches) {
        terminals.push(incompletePath({
          state,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          balanceShare: input.balanceTransfer.coverageShare,
          amountUsage: input.balanceTransfer.amountUsage ?? null,
          stoppedReason: "data_budget_exhausted",
          message: `Trace reached maxAddressFetches=${input.maxAddressFetches} before a known good or decline source was found; source remains unproven.`
        }));
        continue;
      }

      fetchedAddresses.add(state.currentAddress);
      const edges = await input.fetchEdgesForAddress(state.currentAddress, { latestTimestamp: state.latestTimestamp });
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
        const historyCoverage = input.getHistoryCoverageForAddress
          ? await input.getHistoryCoverageForAddress(state.currentAddress, { latestTimestamp: state.latestTimestamp })
          : fallbackHistoryCoverage({
            address: state.currentAddress,
            latestTimestamp: state.latestTimestamp,
            edges
          });
        const stateWithHistory: TraceState = {
          ...state,
          historyCoverage: [...state.historyCoverage, historyCoverage]
        };

        if (!historyCoverage.reachedTargetHop) {
          terminals.push(incompletePath({
            state: stateWithHistory,
            balanceTransferTxHash: input.balanceTransfer.txHash,
            balanceShare: input.balanceTransfer.coverageShare,
            amountUsage: input.balanceTransfer.amountUsage ?? null,
            stoppedReason: "incoming_history_not_fetched",
            message: "Fetched incoming transfer history did not reach the current hop timestamp; source remains unproven."
          }));
          continue;
        }

        const targetEdge = targetEdgeFromState(state);
        const bundle = targetEdge
          ? buildFundingBundleForTraceHop({
            target: targetEdge,
            edges,
            minCoverageRatio: bundleCoverageThreshold,
            maxFunders: maxBundleFunders
          })
          : null;
        const moneyOriginBundle = bundle?.meetsThreshold ? toMoneyOriginFundingBundle(bundle) : null;
        if (bundle?.meetsThreshold && moneyOriginBundle && bundle.funders.length > 0) {
          const stateWithBundle: TraceState = {
            ...stateWithHistory,
            fundingBundles: [...stateWithHistory.fundingBundles, moneyOriginBundle]
          };
          for (const funder of bundle.funders) {
            const funderMembers = bundle.members.filter((member) => member.edge.fromAddress === funder.address);
            if (funderMembers.length === 0) continue;
            const oldestTimestamp = new Date(Math.min(...funderMembers.map((member) => member.edge.timestamp.getTime())));
            nextFrontier.push({
              currentAddress: funder.address,
              expectedAmountRaw: parseAmount(funder.amountRaw),
              latestTimestamp: oldestTimestamp,
              addressesFromSubject: [...stateWithBundle.addressesFromSubject, funder.address],
              txHashesFromSubject: [
                ...stateWithBundle.txHashesFromSubject,
                ...funderMembers.map((member) => member.edge.txHash)
              ],
              stepsFromSubject: [
                ...stateWithBundle.stepsFromSubject,
                ...funderMembers.map((member) => ({
                  txHash: member.edge.txHash,
                  fromAddress: member.edge.fromAddress,
                  toAddress: member.edge.toAddress,
                  amountRaw: member.usedAmountRaw,
                  timestamp: member.edge.timestamp.toISOString()
                }))
              ],
              timestampsFromSubject: [
                ...stateWithBundle.timestampsFromSubject,
                ...funderMembers.map((member) => member.edge.timestamp)
              ],
              fundingBundles: stateWithBundle.fundingBundles,
              historyCoverage: stateWithBundle.historyCoverage,
              minPreservation: Math.min(stateWithBundle.minPreservation, bundle.coverageRatio),
              depth: stateWithBundle.depth + 1,
              score: stateWithBundle.score + bundle.coverageRatio * 100
            });
          }
          continue;
        }

        const hasAnyPreviousIncoming = edges.some((edge) =>
          edge.toAddress === state.currentAddress &&
          edge.timestamp <= state.latestTimestamp &&
          parseAmount(edge.amountRaw) > 0n
        );
        const stoppedReason = input.getHistoryCoverageForAddress
          ? hasAnyPreviousIncoming
            ? "incoming_seen_but_below_continuity"
            : "no_incoming_transfers_seen"
          : hasAnyPreviousIncoming
            ? "weak_amount_or_time_continuity"
            : "no_previous_transfer";
        terminals.push(incompletePath({
          state: stateWithHistory,
          balanceTransferTxHash: input.balanceTransfer.txHash,
          balanceShare: input.balanceTransfer.coverageShare,
          amountUsage: input.balanceTransfer.amountUsage ?? null,
          stoppedReason,
          message: hasAnyPreviousIncoming
            ? "Previous incoming transfers exist, but clean CEX origin is not fully proven; this lowers provenance confidence and is not direct high-risk evidence."
            : "No previous inbound USDT transfer found before this clean EOA hop; source remains unproven."
        }));
        continue;
      }

      for (const edge of candidates) {
        const preservation = fundingCoverageRatio(parseAmount(edge.amountRaw), state.expectedAmountRaw);
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
          fundingBundles: state.fundingBundles,
          historyCoverage: state.historyCoverage,
          minPreservation: Math.min(state.minPreservation, preservation),
          depth: state.depth + 1,
          score: state.score + preservation * 100
        });
      }
    }

    frontier = nextFrontier
      .sort((left, right) => right.score - left.score || left.currentAddress.localeCompare(right.currentAddress))
      .slice(0, input.beamWidth);
  }

  if (terminals.length === 0) {
    return incompletePath({
      state: initialState,
      balanceTransferTxHash: input.balanceTransfer.txHash,
      balanceShare: input.balanceTransfer.coverageShare,
      amountUsage: input.balanceTransfer.amountUsage ?? null,
      stoppedReason: "data_budget_exhausted",
      message: "Trace ended without terminal candidates; source remains unproven."
    });
  }

  return terminals.sort((left, right) => terminalRank(right) - terminalRank(left))[0];
}
