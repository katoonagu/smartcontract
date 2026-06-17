import type {
  BalanceFormingTransfer,
  ForensicRouteEdge,
  WhereIsMoneyAgeSignal,
  WhereIsMoneyAgeSignals
} from "../types";

export type BuildMoneyOriginAgeSignalsInput = {
  subjectAddress: string;
  balanceFormingTransfers: BalanceFormingTransfer[];
  edgesByAddress: Map<string, ForensicRouteEdge[]>;
  now: Date;
  largeBalanceRaw: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_LIVED_DAYS = 180;
const NEW_WALLET_DAYS = 7;
const LARGE_BALANCE_RAW = 50_000n * 1_000_000n;
const DORMANCY_GAP_DAYS = 90;

function parseAmount(value: string | null | undefined): bigint {
  return value && /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function edgeKey(edge: ForensicRouteEdge): string {
  return `${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}:${edge.timestamp.toISOString()}`;
}

function uniqueEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(edge.id || edgeKey(edge), edge);
  }
  return [...byKey.values()];
}

function observedEdges(input: BuildMoneyOriginAgeSignalsInput): ForensicRouteEdge[] {
  return uniqueEdges([...input.edgesByAddress.values()].flat());
}

function addressEdges(edges: ForensicRouteEdge[], address: string): ForensicRouteEdge[] {
  return edges.filter((edge) => edge.fromAddress === address || edge.toAddress === address);
}

function ageDays(firstSeenAt: Date | null, now: Date): number | null {
  if (!firstSeenAt) return null;
  return Math.max(0, Math.floor((now.getTime() - firstSeenAt.getTime()) / DAY_MS));
}

function firstSeen(edges: ForensicRouteEdge[]): Date | null {
  if (edges.length === 0) return null;
  return edges.reduce((min, edge) => edge.timestamp < min ? edge.timestamp : min, edges[0].timestamp);
}

function activeDays(edges: ForensicRouteEdge[]): number {
  return new Set(edges.map((edge) => dayKey(edge.timestamp))).size;
}

function maxDormancyGapDays(edges: ForensicRouteEdge[]): number | null {
  const sorted = [...edges].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  if (sorted.length < 2) return null;

  let maxGap = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = Math.floor((sorted[index].timestamp.getTime() - sorted[index - 1].timestamp.getTime()) / DAY_MS);
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function relationshipEdges(edges: ForensicRouteEdge[], sender: string, subjectAddress: string): ForensicRouteEdge[] {
  return edges.filter((edge) => edge.fromAddress === sender && edge.toAddress === subjectAddress);
}

function signalEvidenceIds(edges: ForensicRouteEdge[]): string[] {
  return edges.slice(0, 5).map((edge) => edge.txHash);
}

export function buildMoneyOriginAgeSignals(input: BuildMoneyOriginAgeSignalsInput): WhereIsMoneyAgeSignals {
  const edges = observedEdges(input);
  const subjectEdges = addressEdges(edges, input.subjectAddress);
  const subjectFirstSeen = firstSeen(subjectEdges);
  const subjectAgeDays = ageDays(subjectFirstSeen, input.now);
  const subjectActiveDays = activeDays(subjectEdges);
  const directSenders = [...new Set(input.balanceFormingTransfers.map((transfer) => transfer.fromAddress))];
  const senderAges = directSenders
    .map((sender) => ageDays(firstSeen(addressEdges(edges, sender)), input.now))
    .filter((value): value is number => value !== null);
  const relationshipAges: number[] = [];
  let repeatedRelationshipCount = 0;
  const signals: WhereIsMoneyAgeSignal[] = [];

  if (subjectAgeDays !== null && subjectAgeDays >= LONG_LIVED_DAYS && subjectActiveDays >= 3) {
    signals.push({
      code: "subject_long_lived",
      scoreImpact: -6,
      message: `Subject wallet has ${subjectAgeDays} days of observed USDT history across ${subjectActiveDays} active day(s).`,
      value: subjectAgeDays,
      evidenceIds: signalEvidenceIds(subjectEdges)
    });
  }

  if (
    subjectAgeDays !== null &&
    subjectAgeDays <= NEW_WALLET_DAYS &&
    parseAmount(input.largeBalanceRaw) >= LARGE_BALANCE_RAW
  ) {
    signals.push({
      code: "subject_new_large_wallet",
      scoreImpact: 12,
      message: "Subject wallet is new in observed USDT history and already holds a large balance.",
      value: subjectAgeDays,
      evidenceIds: signalEvidenceIds(subjectEdges)
    });
  }

  for (const sender of directSenders) {
    const senderEdges = addressEdges(edges, sender);
    const senderAge = ageDays(firstSeen(senderEdges), input.now);
    if (senderAge !== null && senderAge >= LONG_LIVED_DAYS) {
      signals.push({
        code: "sender_long_lived",
        scoreImpact: -4,
        message: `Direct sender ${sender} has ${senderAge} days of observed USDT history.`,
        value: senderAge,
        evidenceIds: signalEvidenceIds(senderEdges)
      });
    }

    const relations = relationshipEdges(edges, sender, input.subjectAddress);
    const relationFirstSeen = firstSeen(relations);
    const relationAge = ageDays(relationFirstSeen, input.now);
    if (relationAge !== null) relationshipAges.push(relationAge);

    if (relations.length >= 2 && relationAge !== null && relationAge >= 2) {
      repeatedRelationshipCount += 1;
      signals.push({
        code: "relationship_repeated",
        scoreImpact: -5,
        message: `Direct sender ${sender} has repeated observed transfers to the checked wallet.`,
        value: relationAge,
        evidenceIds: signalEvidenceIds(relations)
      });
      continue;
    }

    const largeBalanceFormingTransfer = input.balanceFormingTransfers.find(
      (transfer) =>
        transfer.fromAddress === sender &&
        parseAmount(transfer.amountRaw) >= LARGE_BALANCE_RAW &&
        relations.some((relation) => relation.txHash === transfer.txHash && relation.amountRaw === transfer.amountRaw)
    );
    if (relations.length === 1 && largeBalanceFormingTransfer) {
      signals.push({
        code: "relationship_new",
        scoreImpact: 6,
        message: "Large balance-forming transfer comes from a sender with only one observed relationship edge.",
        value: relations[0].amountRaw,
        evidenceIds: [relations[0].txHash]
      });
    }
  }

  const dormancy = maxDormancyGapDays(subjectEdges);
  if (dormancy !== null && dormancy >= DORMANCY_GAP_DAYS) {
    signals.push({
      code: "dormancy_gap",
      scoreImpact: 8,
      message: `Subject wallet has a ${dormancy}-day observed USDT dormancy gap before later activity.`,
      value: dormancy,
      evidenceIds: signalEvidenceIds(subjectEdges)
    });
  }

  return {
    subjectFirstSeenAt: subjectFirstSeen?.toISOString() ?? null,
    subjectAgeDays,
    subjectActiveDays,
    directSenderMedianAgeDays: median(senderAges),
    oldestDirectSenderAgeDays: senderAges.length > 0 ? Math.max(...senderAges) : null,
    repeatedRelationshipCount,
    longestRelationshipAgeDays: relationshipAges.length > 0 ? Math.max(...relationshipAges) : null,
    maxDormancyGapDays: dormancy,
    signals
  };
}
