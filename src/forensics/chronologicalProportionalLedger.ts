export type LedgerEventV1 = {
  canonicalEventId: string | null;
  providerEventIds: readonly string[];
  txHash: string;
  blockNumber: number;
  transactionIndex: number | null;
  eventIndex: number | null;
  eventIndexAuthority: "receipt_log_index" | "provider_synthetic";
  occurredAtMs: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
};

export type CanonicalizationReasonV1 =
  | "identity_collision"
  | "identity_unresolved"
  | "order_unresolved";

export type CanonicalizationResultV1 = {
  readonly state: "complete" | "unresolved";
  readonly reason: CanonicalizationReasonV1 | null;
  readonly events: readonly LedgerEventV1[];
  readonly canonicalEventId?: string;
  readonly blockNumber?: number;
};

export type LedgerLotV1 = {
  readonly lotId: string;
  readonly sourceEventId: string;
  readonly sourceAddress: string;
  readonly originalRaw: bigint;
  readonly remainingRaw: bigint;
};

export type AllocationV1 = {
  readonly lotId: string;
  readonly amountRaw: bigint;
};

export type LedgerConsumptionVectorV1 = {
  readonly eventId: string;
  readonly amountRaw: bigint;
  readonly allocations: readonly AllocationV1[];
};

export type LedgerInputV1 = {
  readonly subjectAddress: string;
  readonly historyCompleteness: "genesis_complete" | "partial";
  readonly openingBalanceRaw: bigint;
  readonly events: readonly LedgerEventV1[];
};

export type LedgerFailureReasonV1 =
  | CanonicalizationReasonV1
  | "history_incomplete"
  | "debit_exceeds_inventory";

export type LedgerResultV1 = {
  readonly state: "complete" | "unresolved";
  readonly reason: LedgerFailureReasonV1 | null;
  readonly authoritative: boolean;
  readonly subjectAddress: string;
  readonly events: readonly LedgerEventV1[];
  readonly lots: readonly LedgerLotV1[];
  readonly consumptionVectors: readonly LedgerConsumptionVectorV1[];
  readonly totalIncomingRaw: bigint;
  readonly totalOutgoingRaw: bigint;
  readonly remainingRaw: bigint;
  readonly unresolvedRaw: bigint;
};

export type SnapshotBalanceWitnessV1 = {
  readonly amountRaw: bigint;
  readonly pinned: boolean;
  readonly independent: boolean;
};

export type LedgerQueryV1 = {
  readonly ledger: LedgerResultV1;
  readonly purpose: "current_balance" | "amount_only" | "exact_episode";
  readonly requestedAmountRaw?: bigint;
  readonly exactEventId?: string;
  readonly snapshotBalanceWitness?: SnapshotBalanceWitnessV1;
  readonly exactRedContributorLotIds?: readonly string[];
};

export type LedgerSelectionReasonV1 =
  | LedgerFailureReasonV1
  | "balance_witness_missing"
  | "snapshot_balance_mismatch"
  | "requested_amount_missing"
  | "requested_amount_exceeds_balance"
  | "exact_event_missing"
  | "requested_amount_exceeds_episode";

export type LedgerSelectionAllocationV1 = AllocationV1 & {
  readonly sourceEventId: string;
  readonly sourceAddress: string;
  readonly sourceOriginalRaw: bigint;
  readonly sourceUtilizedRaw: bigint;
};

export type LedgerSelectionV1 = {
  readonly state: "complete" | "unresolved" | "not_applicable";
  readonly reason: LedgerSelectionReasonV1 | null;
  readonly targetRaw: bigint;
  readonly coveredRaw: bigint;
  readonly allocations: readonly LedgerSelectionAllocationV1[];
  readonly deepSelectedLotIds: readonly string[];
};

function sameEventPayload(left: LedgerEventV1, right: LedgerEventV1): boolean {
  return left.txHash === right.txHash &&
    left.blockNumber === right.blockNumber &&
    left.transactionIndex === right.transactionIndex &&
    left.eventIndex === right.eventIndex &&
    left.eventIndexAuthority === right.eventIndexAuthority &&
    left.occurredAtMs === right.occurredAtMs &&
    left.fromAddress === right.fromAddress &&
    left.toAddress === right.toAddress &&
    left.amountRaw === right.amountRaw;
}

function compareCanonicalOrder(left: LedgerEventV1, right: LedgerEventV1): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber - right.blockNumber;
  if (left.txHash === right.txHash) return (left.eventIndex ?? 0) - (right.eventIndex ?? 0);
  return (left.transactionIndex ?? 0) - (right.transactionIndex ?? 0);
}

function hasUnresolvedBlockOrder(events: readonly LedgerEventV1[]): number | null {
  for (let index = 0; index < events.length; index += 1) {
    const left = events[index];
    if (!left) continue;
    for (let otherIndex = index + 1; otherIndex < events.length; otherIndex += 1) {
      const right = events[otherIndex];
      if (!right || left.blockNumber !== right.blockNumber) continue;
      if (left.txHash === right.txHash) {
        if (left.eventIndex === right.eventIndex) return left.blockNumber;
        continue;
      }
      if (
        left.transactionIndex === null ||
        right.transactionIndex === null ||
        left.transactionIndex === right.transactionIndex
      ) return left.blockNumber;
    }
  }
  return null;
}

export function canonicalizeChronologicalLedgerEventsV1(
  events: readonly LedgerEventV1[]
): CanonicalizationResultV1 {
  const byIdentity = new Map<string, LedgerEventV1>();

  for (const event of events) {
    if (
      event.canonicalEventId === null ||
      event.eventIndex === null ||
      event.eventIndexAuthority !== "receipt_log_index"
    ) {
      return { state: "unresolved", reason: "identity_unresolved", events: [] };
    }
    const existing = byIdentity.get(event.canonicalEventId);
    if (existing && !sameEventPayload(existing, event)) {
      return {
        state: "unresolved",
        reason: "identity_collision",
        events: [],
        canonicalEventId: event.canonicalEventId
      };
    }
    const providerEventIds = [...new Set([
      ...(existing?.providerEventIds ?? []),
      ...event.providerEventIds
    ])].sort();
    byIdentity.set(event.canonicalEventId, { ...(existing ?? event), providerEventIds });
  }

  const deduped = [...byIdentity.values()];
  const unresolvedBlock = hasUnresolvedBlockOrder(deduped);
  if (unresolvedBlock !== null) {
    return {
      state: "unresolved",
      reason: "order_unresolved",
      events: [],
      blockNumber: unresolvedBlock
    };
  }
  return {
    state: "complete",
    reason: null,
    events: deduped.sort(compareCanonicalOrder)
  };
}

export function apportionRawLargestRemainderV1(
  targetRaw: bigint,
  capacities: readonly LedgerLotV1[]
): AllocationV1[] {
  if (targetRaw < 0n || capacities.some(({ remainingRaw }) => remainingRaw < 0n)) {
    throw new RangeError("raw amounts must be non-negative");
  }
  if (new Set(capacities.map(({ lotId }) => lotId)).size !== capacities.length) {
    throw new RangeError("lot IDs must be unique");
  }
  const totalRaw = capacities.reduce((sum, { remainingRaw }) => sum + remainingRaw, 0n);
  if (targetRaw > totalRaw) throw new RangeError("target exceeds capacity");
  if (totalRaw === 0n) {
    return capacities
      .map(({ lotId }) => ({ lotId, amountRaw: 0n }))
      .sort((left, right) => left.lotId.localeCompare(right.lotId));
  }

  const shares = capacities.map(({ lotId, remainingRaw }) => {
    const numerator = targetRaw * remainingRaw;
    return {
      lotId,
      amountRaw: numerator / totalRaw,
      remainder: numerator % totalRaw
    };
  });
  let undistributedRaw = targetRaw - shares.reduce((sum, share) => sum + share.amountRaw, 0n);
  const ranked = [...shares].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return left.lotId.localeCompare(right.lotId);
  });
  for (const share of ranked) {
    if (undistributedRaw === 0n) break;
    share.amountRaw += 1n;
    undistributedRaw -= 1n;
  }
  return shares
    .map(({ lotId, amountRaw }) => ({ lotId, amountRaw }))
    .sort((left, right) => left.lotId.localeCompare(right.lotId));
}

function ledgerResult(
  input: LedgerInputV1,
  fields: Partial<LedgerResultV1>
): LedgerResultV1 {
  return {
    state: "complete",
    reason: null,
    authoritative: true,
    subjectAddress: input.subjectAddress,
    events: [],
    lots: [],
    consumptionVectors: [],
    totalIncomingRaw: 0n,
    totalOutgoingRaw: 0n,
    remainingRaw: 0n,
    unresolvedRaw: 0n,
    ...fields
  };
}

export function runChronologicalProportionalLedgerV1(input: LedgerInputV1): LedgerResultV1 {
  if (input.historyCompleteness !== "genesis_complete" || input.openingBalanceRaw !== 0n) {
    return ledgerResult(input, {
      state: "unresolved",
      reason: "history_incomplete",
      authoritative: false
    });
  }

  const canonical = canonicalizeChronologicalLedgerEventsV1(input.events);
  if (canonical.state === "unresolved") {
    return ledgerResult(input, {
      state: "unresolved",
      reason: canonical.reason,
      authoritative: false
    });
  }

  let totalIncomingRaw = 0n;
  let totalOutgoingRaw = 0n;
  const lots: LedgerLotV1[] = [];
  const consumptionVectors: LedgerConsumptionVectorV1[] = [];

  for (const event of canonical.events) {
    if (event.amountRaw < 0n) throw new RangeError("raw amounts must be non-negative");
    if (event.fromAddress === event.toAddress || event.amountRaw === 0n) continue;
    if (event.toAddress === input.subjectAddress && event.fromAddress !== input.subjectAddress) {
      lots.push({
        lotId: event.canonicalEventId as string,
        sourceEventId: event.canonicalEventId as string,
        sourceAddress: event.fromAddress,
        originalRaw: event.amountRaw,
        remainingRaw: event.amountRaw
      });
      totalIncomingRaw += event.amountRaw;
      continue;
    }
    if (event.fromAddress !== input.subjectAddress || event.toAddress === input.subjectAddress) continue;

    const inventoryRaw = lots.reduce((sum, { remainingRaw }) => sum + remainingRaw, 0n);
    if (event.amountRaw > inventoryRaw) {
      return ledgerResult(input, {
        state: "unresolved",
        reason: "debit_exceeds_inventory",
        authoritative: false,
        events: canonical.events,
        lots,
        consumptionVectors,
        totalIncomingRaw,
        totalOutgoingRaw,
        remainingRaw: inventoryRaw,
        unresolvedRaw: event.amountRaw - inventoryRaw
      });
    }

    const allocations = apportionRawLargestRemainderV1(event.amountRaw, lots);
    const consumedByLot = new Map(allocations.map((allocation) => [allocation.lotId, allocation.amountRaw]));
    for (let index = 0; index < lots.length; index += 1) {
      const current = lots[index];
      if (!current) continue;
      lots[index] = {
        ...current,
        remainingRaw: current.remainingRaw - (consumedByLot.get(current.lotId) ?? 0n)
      };
    }
    consumptionVectors.push({
      eventId: event.canonicalEventId as string,
      amountRaw: event.amountRaw,
      allocations: allocations.filter(({ amountRaw }) => amountRaw > 0n)
    });
    totalOutgoingRaw += event.amountRaw;
  }

  return ledgerResult(input, {
    events: canonical.events,
    lots,
    consumptionVectors,
    totalIncomingRaw,
    totalOutgoingRaw,
    remainingRaw: lots.reduce((sum, { remainingRaw }) => sum + remainingRaw, 0n)
  });
}

function unresolvedSelection(reason: LedgerSelectionReasonV1): LedgerSelectionV1 {
  return {
    state: "unresolved",
    reason,
    targetRaw: 0n,
    coveredRaw: 0n,
    allocations: [],
    deepSelectedLotIds: []
  };
}

function selectDeepContributorIds(
  allocations: readonly AllocationV1[],
  targetRaw: bigint,
  redLotIds: readonly string[]
): string[] {
  const ranked = allocations
    .filter(({ amountRaw }) => amountRaw > 0n)
    .sort((left, right) => {
      if (left.amountRaw !== right.amountRaw) return left.amountRaw > right.amountRaw ? -1 : 1;
      return left.lotId.localeCompare(right.lotId);
    });
  const selected: string[] = [];
  let selectedRaw = 0n;
  for (const allocation of ranked) {
    if (selectedRaw * 100n >= targetRaw * 95n) break;
    selected.push(allocation.lotId);
    selectedRaw += allocation.amountRaw;
  }
  for (const lotId of [...new Set(redLotIds)].sort()) {
    if (ranked.some((allocation) => allocation.lotId === lotId) && !selected.includes(lotId)) {
      selected.push(lotId);
    }
  }
  return selected;
}

export function selectLedgerProvenanceV1(input: LedgerQueryV1): LedgerSelectionV1 {
  if (input.ledger.state === "unresolved") {
    return unresolvedSelection(input.ledger.reason as LedgerFailureReasonV1);
  }

  let targetRaw: bigint;
  let allocations: AllocationV1[];
  if (input.purpose === "exact_episode") {
    const vector = input.ledger.consumptionVectors.find(({ eventId }) => eventId === input.exactEventId);
    if (!vector) return unresolvedSelection("exact_event_missing");
    targetRaw = input.requestedAmountRaw ?? vector.amountRaw;
    if (targetRaw > vector.amountRaw) return unresolvedSelection("requested_amount_exceeds_episode");
    const vectorLots = vector.allocations.map(({ lotId, amountRaw }) => {
      const source = input.ledger.lots.find((item) => item.lotId === lotId) as LedgerLotV1;
      return { ...source, remainingRaw: amountRaw };
    });
    allocations = apportionRawLargestRemainderV1(targetRaw, vectorLots);
  } else {
    const witness = input.snapshotBalanceWitness;
    if (!witness?.pinned || !witness.independent) {
      return unresolvedSelection("balance_witness_missing");
    }
    if (witness.amountRaw !== input.ledger.remainingRaw) {
      return unresolvedSelection("snapshot_balance_mismatch");
    }
    if (input.purpose === "current_balance" && input.ledger.remainingRaw === 0n) {
      return {
        state: "not_applicable",
        reason: null,
        targetRaw: 0n,
        coveredRaw: 0n,
        allocations: [],
        deepSelectedLotIds: []
      };
    }
    if (input.purpose === "amount_only" && input.requestedAmountRaw === undefined) {
      return unresolvedSelection("requested_amount_missing");
    }
    targetRaw = input.purpose === "current_balance"
      ? input.ledger.remainingRaw
      : input.requestedAmountRaw as bigint;
    if (targetRaw > input.ledger.remainingRaw) {
      return unresolvedSelection("requested_amount_exceeds_balance");
    }
    allocations = apportionRawLargestRemainderV1(targetRaw, input.ledger.lots);
  }

  const lotsById = new Map(input.ledger.lots.map((item) => [item.lotId, item]));
  const selectedAllocations = allocations
    .filter(({ amountRaw }) => amountRaw > 0n)
    .map(({ lotId, amountRaw }): LedgerSelectionAllocationV1 => {
      const source = lotsById.get(lotId) as LedgerLotV1;
      return {
        lotId,
        amountRaw,
        sourceEventId: source.sourceEventId,
        sourceAddress: source.sourceAddress,
        sourceOriginalRaw: source.originalRaw,
        sourceUtilizedRaw: amountRaw
      };
    });
  return {
    state: "complete",
    reason: null,
    targetRaw,
    coveredRaw: selectedAllocations.reduce((sum, { amountRaw }) => sum + amountRaw, 0n),
    allocations: selectedAllocations,
    deepSelectedLotIds: selectDeepContributorIds(
      selectedAllocations,
      targetRaw,
      input.exactRedContributorLotIds ?? []
    )
  };
}
