import type {
  ForensicRouteEdge,
  IncomingDepositOriginPath,
  IncomingDepositOriginStep,
  ServiceClassification
} from "../types";
import { selectIncomingDepositFundingCandidates } from "./incomingDepositCashflow";

export type IncomingDepositProvenanceResult = {
  paths: IncomingDepositOriginPath[];
  originCoverage: number;
  fetchedAddressCount: number;
  notes: string[];
};

export type TraceIncomingDepositProvenanceInput = {
  deposit: ForensicRouteEdge;
  maxDepth: number;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
};

type QueueItem = {
  address: string;
  depth: number;
  steps: IncomingDepositOriginStep[];
  pathAddresses: string[];
  amountRaw: string;
  timestamp: Date;
  txHash: string;
};

function step(edge: ForensicRouteEdge): IncomingDepositOriginStep {
  return {
    txHash: edge.txHash,
    fromAddress: edge.fromAddress,
    toAddress: edge.toAddress,
    amountRaw: edge.amountRaw,
    timestamp: edge.timestamp.toISOString(),
    method: edge.method,
    edgeType: edge.edgeType
  };
}

function serviceCategory(classification: ServiceClassification | null): string | null {
  return classification?.category ?? null;
}

function isHardServiceBoundary(classification: ServiceClassification | null): boolean {
  const category = serviceCategory(classification);
  return category === "bridge" ||
    category === "bridge_pool" ||
    category === "router" ||
    category === "dex" ||
    category === "pool";
}

function isKnownCleanCex(classification: ServiceClassification | null): boolean {
  if (!classification) return false;
  const identity = (classification.identity ?? "").toLowerCase();
  return classification.category === "cex" &&
    (identity.includes("binance") || identity.includes("bybit") || identity.includes("okx"));
}

function isHtxHuobiCex(classification: ServiceClassification | null): boolean {
  if (!classification || classification.category !== "cex") return false;
  const identity = (classification.identity ?? "").toLowerCase();
  return identity.includes("htx") || identity.includes("huobi");
}

function isWhitebitCex(classification: ServiceClassification | null): boolean {
  if (!classification || classification.category !== "cex") return false;
  return (classification.identity ?? "").toLowerCase().includes("whitebit");
}

function isUnknownContractBoundary(classification: ServiceClassification | null): boolean {
  const category = serviceCategory(classification);
  return Boolean(classification?.isBoundary && (category === "unknown_contract" || category === "unknown"));
}

export async function traceIncomingDepositProvenance(
  input: TraceIncomingDepositProvenanceInput
): Promise<IncomingDepositProvenanceResult> {
  const fetched = new Set<string>();
  const paths: IncomingDepositOriginPath[] = [];
  const queue: QueueItem[] = [{
    address: input.deposit.fromAddress,
    depth: 0,
    steps: [step(input.deposit)],
    pathAddresses: [input.deposit.toAddress, input.deposit.fromAddress],
    amountRaw: input.deposit.amountRaw,
    timestamp: input.deposit.timestamp,
    txHash: input.deposit.txHash
  }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= input.maxDepth) {
      paths.push({
        verdict: "ACCEPTABLE",
        score: 35,
        sourcePolicy: "unknown",
        stoppedReason: "data_budget_exhausted",
        pathAddresses: [...current.pathAddresses].reverse(),
        txHashes: current.steps.map((item) => item.txHash),
        steps: current.steps,
        amountCoverageRatio: 0,
        amountContinuity: "weak",
        proximityHops: current.depth,
        reasons: [`Clean source was not proven within maxDepth=${input.maxDepth}.`]
      });
      continue;
    }

    fetched.add(current.address);
    const edges = await input.fetchEdgesForAddress(current.address);
    const selection = selectIncomingDepositFundingCandidates({
      sender: current.address,
      watchedWallet: current.pathAddresses[current.pathAddresses.length - 2] ?? input.deposit.toAddress,
      depositTxHash: current.txHash,
      depositAmountRaw: current.amountRaw,
      depositTimestamp: current.timestamp,
      edges
    });

    if (selection.candidates.length === 0) {
      paths.push({
        verdict: "ACCEPTABLE",
        score: 35,
        sourcePolicy: "unknown",
        stoppedReason: "no_previous_transfer",
        pathAddresses: [...current.pathAddresses].reverse(),
        txHashes: current.steps.map((item) => item.txHash),
        steps: current.steps,
        amountCoverageRatio: selection.coverageRatio,
        amountContinuity: selection.amountContinuity,
        proximityHops: current.depth,
        reasons: ["No previous inbound USDT transfer found before this deposit context."]
      });
      continue;
    }

    for (const candidate of selection.candidates.slice(0, 6)) {
      const sourceAddress = candidate.edge.fromAddress;
      const classification = await input.getClassificationForAddress(sourceAddress);
      const nextSteps = [step(candidate.edge), ...current.steps];
      const nextAddresses = [...current.pathAddresses, sourceAddress];

      if (isHtxHuobiCex(classification)) {
        paths.push({
          verdict: "DECLINE",
          score: 78,
          sourcePolicy: "hard_decline",
          stoppedReason: "htx_huobi_reached",
          pathAddresses: [...nextAddresses].reverse(),
          txHashes: nextSteps.map((item) => item.txHash),
          steps: nextSteps,
          amountCoverageRatio: selection.coverageRatio,
          amountContinuity: selection.amountContinuity,
          proximityHops: current.depth + 1,
          reasons: [`Deposit funding reaches close ${classification?.identity ?? "HTX/Huobi"} CEX provenance.`]
        });
        continue;
      }

      if (isWhitebitCex(classification)) {
        paths.push({
          verdict: "DECLINE",
          score: 52,
          sourcePolicy: "medium_policy",
          stoppedReason: "whitebit_reached",
          pathAddresses: [...nextAddresses].reverse(),
          txHashes: nextSteps.map((item) => item.txHash),
          steps: nextSteps,
          amountCoverageRatio: selection.coverageRatio,
          amountContinuity: selection.amountContinuity,
          proximityHops: current.depth + 1,
          reasons: [`Deposit funding reaches close WhiteBIT provenance ${classification?.identity ?? sourceAddress}.`]
        });
        continue;
      }

      if (isKnownCleanCex(classification)) {
        paths.push({
          verdict: "ACCEPTABLE",
          score: 5,
          sourcePolicy: "clean",
          stoppedReason: "clean_cex_reached",
          pathAddresses: [...nextAddresses].reverse(),
          txHashes: nextSteps.map((item) => item.txHash),
          steps: nextSteps,
          amountCoverageRatio: selection.coverageRatio,
          amountContinuity: selection.amountContinuity,
          proximityHops: current.depth + 1,
          reasons: [`Deposit funding reaches clean CEX ${classification?.identity ?? sourceAddress}.`]
        });
        continue;
      }

      if (isHardServiceBoundary(classification)) {
        paths.push({
          verdict: "DECLINE",
          score: 70,
          sourcePolicy: "hard_decline",
          stoppedReason: "bridge_router_dex_reached",
          pathAddresses: [...nextAddresses].reverse(),
          txHashes: nextSteps.map((item) => item.txHash),
          steps: nextSteps,
          amountCoverageRatio: selection.coverageRatio,
          amountContinuity: selection.amountContinuity,
          proximityHops: current.depth + 1,
          reasons: [`Deposit funding reaches ${classification?.category ?? "service"} boundary ${classification?.identity ?? sourceAddress}.`]
        });
        continue;
      }

      if (isUnknownContractBoundary(classification)) {
        paths.push({
          verdict: "DECLINE",
          score: 58,
          sourcePolicy: "medium_policy",
          stoppedReason: "unknown_contract_reached",
          pathAddresses: [...nextAddresses].reverse(),
          txHashes: nextSteps.map((item) => item.txHash),
          steps: nextSteps,
          amountCoverageRatio: selection.coverageRatio,
          amountContinuity: selection.amountContinuity,
          proximityHops: current.depth + 1,
          reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
        });
        continue;
      }

      queue.push({
        address: sourceAddress,
        depth: current.depth + 1,
        steps: nextSteps,
        pathAddresses: nextAddresses,
        amountRaw: candidate.usableAmountRaw,
        timestamp: candidate.edge.timestamp,
        txHash: candidate.edge.txHash
      });
    }
  }

  const originCoverage = Math.max(0, ...paths.map((path) => path.amountCoverageRatio));
  return {
    paths,
    originCoverage,
    fetchedAddressCount: fetched.size,
    notes: paths.length === 0 ? ["No origin path found from transaction seed."] : []
  };
}
