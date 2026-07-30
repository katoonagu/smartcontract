export type ServiceBehaviorRowV2 = {
  readonly canonicalEventId: string | null;
  readonly blockNumber: number;
  readonly transactionIndex: number | null;
  readonly eventIndex: number | null;
  readonly occurredAtSeconds: number;
  readonly direction: "incoming" | "outgoing";
  readonly counterpartyAddress: string;
  readonly amountRaw: bigint;
  readonly valid: boolean;
  readonly featureRole:
    | "ordinary"
    | "poisoning_only"
    | "gasfree_fee"
    | "gasfree_principal";
};

export type MedianGapV2 = {
  readonly numerator: number;
  readonly denominator: 1 | 2;
};

export type CompleteServiceWindowVectorV2 = {
  readonly kind: "complete";
  readonly physicalRowCount: number;
  readonly canonicalEventCount: number;
  readonly featureEligibleEventCount: number;
  readonly invalidPhysicalRowCount: number;
  readonly collisionPhysicalRowCount: number;
  readonly duplicatePhysicalRowCount: number;
  readonly poisoningOnlyEventCount: number;
  readonly gasFreeFeeEventCount: number;
  readonly gasFreePrincipalEventCount: number;
  readonly incomingCount: number;
  readonly outgoingCount: number;
  readonly uniqueSenders: number;
  readonly uniqueRecipients: number;
  readonly uniqueCounterparties: number;
  readonly largestCounterpartyCount: number;
  readonly largestCounterpartyShareDenominator: number;
  readonly dominantDirection: "incoming" | "outgoing" | null;
  readonly dominantDirectionCount: number;
  readonly uniqueDominantCounterparties: number;
  readonly dominantShareDenominator: number;
  readonly medianDominantDirectionGapSeconds: MedianGapV2 | null;
  readonly maxDominantDirectionEventsPerHour: number;
  readonly activeUtcHourOfDayCount: number;
  readonly dominantExactAmountRaw: bigint | null;
  readonly dominantExactAmountCount: number;
  readonly dominantExactAmountShareDenominator: number;
  readonly observedStartSeconds: number | null;
  readonly observedEndSeconds: number | null;
  readonly observedWindowDurationSeconds: number;
  readonly orderAuthoritative: boolean;
};

export type IncompleteServiceWindowVectorV2 = {
  readonly kind: "incomplete";
  readonly physicalRowCount: number;
  readonly canonicalEventCount: number;
  readonly orderAuthoritative: boolean;
  readonly observedStartSeconds: number | null;
  readonly observedEndSeconds: number | null;
};

export type ServiceWindowVectorV2 =
  | CompleteServiceWindowVectorV2
  | IncompleteServiceWindowVectorV2;

export type ServiceWindowPredicatesV2 = {
  readonly C: boolean;
  readonly B: boolean;
  readonly G: boolean;
  readonly H: boolean;
  readonly R: boolean;
  readonly X: boolean;
};

export type ServiceBehaviorResultV2 = {
  readonly status:
    | "high_inferred_service"
    | "non_service_profile"
    | "insufficient_data"
    | "role_conflict";
  readonly recentVector: ServiceWindowVectorV2;
  readonly historicalVector: ServiceWindowVectorV2;
  readonly recentPredicates: ServiceWindowPredicatesV2;
  readonly historicalPredicates: ServiceWindowPredicatesV2;
};

const FALSE_PREDICATES: ServiceWindowPredicatesV2 = {
  C: false,
  B: false,
  G: false,
  H: false,
  R: false,
  X: false
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRows(left: ServiceBehaviorRowV2, right: ServiceBehaviorRowV2): number {
  return left.blockNumber - right.blockNumber ||
    (left.transactionIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.transactionIndex ?? Number.MAX_SAFE_INTEGER) ||
    (left.eventIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.eventIndex ?? Number.MAX_SAFE_INTEGER) ||
    compareText(left.canonicalEventId ?? "", right.canonicalEventId ?? "");
}

function hasAuthoritativeOrder(row: ServiceBehaviorRowV2): boolean {
  return Number.isSafeInteger(row.blockNumber) && row.blockNumber >= 0 &&
    Number.isSafeInteger(row.transactionIndex) && (row.transactionIndex ?? -1) >= 0 &&
    Number.isSafeInteger(row.eventIndex) && (row.eventIndex ?? -1) >= 0 &&
    Number.isSafeInteger(row.occurredAtSeconds);
}

function samePayload(left: ServiceBehaviorRowV2, right: ServiceBehaviorRowV2): boolean {
  return left.blockNumber === right.blockNumber &&
    left.transactionIndex === right.transactionIndex &&
    left.eventIndex === right.eventIndex &&
    left.occurredAtSeconds === right.occurredAtSeconds &&
    left.direction === right.direction &&
    left.counterpartyAddress === right.counterpartyAddress &&
    left.amountRaw === right.amountRaw &&
    left.valid === right.valid &&
    left.featureRole === right.featureRole;
}

function medianGap(rows: readonly ServiceBehaviorRowV2[]): MedianGapV2 | null {
  if (rows.length < 2) return null;
  const timestamps = rows.map(({ occurredAtSeconds }) => occurredAtSeconds)
    .sort((left, right) => left - right);
  const gaps = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]!);
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1
    ? { numerator: gaps[middle]!, denominator: 1 }
    : { numerator: gaps[middle - 1]! + gaps[middle]!, denominator: 2 };
}

function maximumBucketCount(rows: readonly ServiceBehaviorRowV2[]): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const bucket = Math.floor(row.occurredAtSeconds / 3_600);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

function mostRepeatedAmount(rows: readonly ServiceBehaviorRowV2[]): {
  amountRaw: bigint | null;
  count: number;
} {
  const counts = new Map<bigint, number>();
  for (const row of rows) counts.set(row.amountRaw, (counts.get(row.amountRaw) ?? 0) + 1);
  let amountRaw: bigint | null = null;
  let count = 0;
  for (const [amount, occurrences] of counts) {
    if (occurrences > count || (occurrences === count && (amountRaw === null || amount < amountRaw))) {
      amountRaw = amount;
      count = occurrences;
    }
  }
  return { amountRaw, count };
}

export function computeServiceWindowVectorV2(
  rows: readonly ServiceBehaviorRowV2[]
): CompleteServiceWindowVectorV2 {
  let orderAuthoritative = rows.every(hasAuthoritativeOrder);
  const physicalRows = [...rows].sort(compareRows).slice(0, 100);
  const invalidPhysicalRowCount = physicalRows.filter((row) =>
    !row.valid || row.canonicalEventId === null
  ).length;
  const validGroups = new Map<string, ServiceBehaviorRowV2[]>();
  for (const row of physicalRows) {
    if (!row.valid || row.canonicalEventId === null) continue;
    const group = validGroups.get(row.canonicalEventId) ?? [];
    group.push(row);
    validGroups.set(row.canonicalEventId, group);
  }

  const canonicalRows: ServiceBehaviorRowV2[] = [];
  let collisionPhysicalRowCount = 0;
  let duplicatePhysicalRowCount = 0;
  for (const group of validGroups.values()) {
    const first = group[0]!;
    if (group.some((row) => !samePayload(first, row))) {
      collisionPhysicalRowCount += group.length;
      continue;
    }
    duplicatePhysicalRowCount += group.length - 1;
    canonicalRows.push(first);
  }
  canonicalRows.sort(compareRows);
  const orderSlots = new Set<string>();
  for (const row of canonicalRows) {
    const slot = `${row.blockNumber}:${row.transactionIndex}:${row.eventIndex}`;
    if (orderSlots.has(slot)) orderAuthoritative = false;
    orderSlots.add(slot);
  }

  const poisoningOnlyEventCount = canonicalRows.filter(({ featureRole }) =>
    featureRole === "poisoning_only"
  ).length;
  const gasFreeFeeEventCount = canonicalRows.filter(({ featureRole }) =>
    featureRole === "gasfree_fee"
  ).length;
  const gasFreePrincipalEventCount = canonicalRows.filter(({ featureRole }) =>
    featureRole === "gasfree_principal"
  ).length;
  const eligible = canonicalRows.filter(({ featureRole }) =>
    featureRole === "ordinary" || featureRole === "gasfree_principal"
  );
  const incoming = eligible.filter(({ direction }) => direction === "incoming");
  const outgoing = eligible.filter(({ direction }) => direction === "outgoing");
  const uniqueSenders = new Set(incoming.map(({ counterpartyAddress }) => counterpartyAddress));
  const uniqueRecipients = new Set(outgoing.map(({ counterpartyAddress }) => counterpartyAddress));
  const uniqueCounterparties = new Set(eligible.map(({ counterpartyAddress }) => counterpartyAddress));
  const counterpartyCounts = new Map<string, number>();
  for (const row of eligible) {
    counterpartyCounts.set(
      row.counterpartyAddress,
      (counterpartyCounts.get(row.counterpartyAddress) ?? 0) + 1
    );
  }
  const dominantDirection = incoming.length === outgoing.length
    ? null
    : incoming.length > outgoing.length ? "incoming" : "outgoing";
  const dominantRows = dominantDirection === "incoming"
    ? incoming
    : dominantDirection === "outgoing" ? outgoing : [];
  const repeated = mostRepeatedAmount(dominantRows);
  const observedSeconds = canonicalRows.map(({ occurredAtSeconds }) => occurredAtSeconds);
  const observedStartSeconds = observedSeconds.length === 0 ? null : Math.min(...observedSeconds);
  const observedEndSeconds = observedSeconds.length === 0 ? null : Math.max(...observedSeconds);
  const hourValues = new Set(eligible.map(({ occurredAtSeconds }) =>
    ((Math.floor(occurredAtSeconds / 3_600) % 24) + 24) % 24
  ));

  return {
    kind: "complete",
    physicalRowCount: physicalRows.length,
    canonicalEventCount: canonicalRows.length,
    featureEligibleEventCount: eligible.length,
    invalidPhysicalRowCount,
    collisionPhysicalRowCount,
    duplicatePhysicalRowCount,
    poisoningOnlyEventCount,
    gasFreeFeeEventCount,
    gasFreePrincipalEventCount,
    incomingCount: incoming.length,
    outgoingCount: outgoing.length,
    uniqueSenders: uniqueSenders.size,
    uniqueRecipients: uniqueRecipients.size,
    uniqueCounterparties: uniqueCounterparties.size,
    largestCounterpartyCount: Math.max(0, ...counterpartyCounts.values()),
    largestCounterpartyShareDenominator: eligible.length,
    dominantDirection,
    dominantDirectionCount: dominantRows.length,
    uniqueDominantCounterparties: new Set(
      dominantRows.map(({ counterpartyAddress }) => counterpartyAddress)
    ).size,
    dominantShareDenominator: eligible.length,
    medianDominantDirectionGapSeconds: medianGap(dominantRows),
    maxDominantDirectionEventsPerHour: maximumBucketCount(dominantRows),
    activeUtcHourOfDayCount: hourValues.size,
    dominantExactAmountRaw: repeated.amountRaw,
    dominantExactAmountCount: repeated.count,
    dominantExactAmountShareDenominator: dominantRows.length,
    observedStartSeconds,
    observedEndSeconds,
    observedWindowDurationSeconds: observedStartSeconds === null || observedEndSeconds === null
      ? 0
      : observedEndSeconds - observedStartSeconds,
    orderAuthoritative
  };
}

function medianAtMost(gap: MedianGapV2 | null, thresholdSeconds: number): boolean {
  return gap !== null && gap.numerator <= thresholdSeconds * gap.denominator;
}

export function evaluateServiceWindowPredicateV2(
  vector: ServiceWindowVectorV2
): ServiceWindowPredicatesV2 {
  if (vector.kind === "incomplete") return { ...FALSE_PREDICATES };
  const C = vector.dominantDirection !== null && vector.dominantDirectionCount >= 20 && (
    medianAtMost(vector.medianDominantDirectionGapSeconds, 120) ||
    vector.maxDominantDirectionEventsPerHour >= 15
  );
  const B = vector.uniqueCounterparties >= 25 &&
    vector.uniqueCounterparties * 5 >= vector.featureEligibleEventCount &&
    vector.largestCounterpartyCount * 2 <= vector.featureEligibleEventCount;
  const G = (
    vector.dominantDirectionCount * 10 >= vector.featureEligibleEventCount * 7 &&
    vector.uniqueDominantCounterparties >= 20
  ) || (vector.uniqueSenders >= 10 && vector.uniqueRecipients >= 10);
  const H = vector.activeUtcHourOfDayCount >= 12;
  const R = vector.dominantDirection !== null && vector.dominantExactAmountCount >= 10 &&
    vector.dominantExactAmountCount * 10 >= vector.dominantDirectionCount;
  const X = vector.dominantDirection !== null && vector.dominantDirectionCount >= 80 &&
    vector.dominantDirectionCount * 10 >= vector.featureEligibleEventCount * 8 &&
    vector.uniqueDominantCounterparties >= 80 && (
      medianAtMost(vector.medianDominantDirectionGapSeconds, 15) ||
      vector.maxDominantDirectionEventsPerHour >= 80
    );
  return { C, B, G, H, R, X };
}

function passesPredicate(predicate: ServiceWindowPredicatesV2): boolean {
  return predicate.C && predicate.B && predicate.G &&
    (predicate.H || predicate.R || predicate.X);
}

function hasWindowQuality(vector: ServiceWindowVectorV2): boolean {
  return vector.kind === "complete" &&
    vector.physicalRowCount === 100 &&
    vector.canonicalEventCount === 100 &&
    vector.orderAuthoritative &&
    vector.observedStartSeconds !== null &&
    vector.observedEndSeconds !== null &&
    vector.observedStartSeconds <= vector.observedEndSeconds;
}

export function classifyServiceBehavior100Plus100V2(input: {
  recent: ServiceWindowVectorV2;
  historical: ServiceWindowVectorV2;
  exactRoleConflict: boolean;
}): ServiceBehaviorResultV2 {
  const recentPredicates = evaluateServiceWindowPredicateV2(input.recent);
  const historicalPredicates = evaluateServiceWindowPredicateV2(input.historical);
  const result = (status: ServiceBehaviorResultV2["status"]): ServiceBehaviorResultV2 => ({
    status,
    recentVector: input.recent,
    historicalVector: input.historical,
    recentPredicates,
    historicalPredicates
  });
  if (!hasWindowQuality(input.recent) || !hasWindowQuality(input.historical)) {
    return result("insufficient_data");
  }
  if (
    input.recent.observedStartSeconds! - input.historical.observedEndSeconds! <
      7 * 24 * 60 * 60
  ) {
    return result("insufficient_data");
  }
  if (input.exactRoleConflict) return result("role_conflict");
  return result(
    passesPredicate(recentPredicates) && passesPredicate(historicalPredicates)
      ? "high_inferred_service"
      : "non_service_profile"
  );
}
