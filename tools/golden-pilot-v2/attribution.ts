export type AttributionInput = {
  selectedAmountRaw: string;
  inbound: Array<{
    eventId: string;
    amountRaw: string;
    timestamp: string;
  }>;
};

export type AttributionResult = {
  policy: "fifo" | "lifo" | "proportional";
  selectedAmountRaw: string;
  allocatedAmountRaw: string;
  residualAmountRaw: string;
  allocations: Array<{ eventId: string; allocatedRaw: string }>;
};

type NormalizedInbound = {
  eventId: string;
  amountRaw: bigint;
  timestampMs: number;
};

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decimal(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("golden_invalid_decimal_string");
  }
  return BigInt(value);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  const normalizedInput =
    value.endsWith("Z") && !value.includes(".")
      ? value.replace(/Z$/u, ".000Z")
      : value;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== normalizedInput
  ) {
    throw new TypeError("golden_invalid_iso_utc_timestamp");
  }
  return parsed;
}

function normalize(input: AttributionInput): {
  selectedAmountRaw: bigint;
  inbound: NormalizedInbound[];
} {
  const seen = new Set<string>();
  const inbound = input.inbound.map((event) => {
    if (typeof event.eventId !== "string" || event.eventId.length === 0) {
      throw new TypeError("golden_invalid_attribution_event_id");
    }
    if (seen.has(event.eventId)) {
      throw new TypeError(
        `golden_duplicate_attribution_event_id:${event.eventId}`
      );
    }
    seen.add(event.eventId);
    return {
      eventId: event.eventId,
      amountRaw: decimal(event.amountRaw),
      timestampMs: timestamp(event.timestamp)
    };
  });
  return {
    selectedAmountRaw: decimal(input.selectedAmountRaw),
    inbound
  };
}

function sequential(
  policy: "fifo" | "lifo",
  selectedAmountRaw: bigint,
  inbound: NormalizedInbound[]
): AttributionResult {
  const ordered = [...inbound].sort((left, right) => {
    const time =
      policy === "fifo"
        ? left.timestampMs - right.timestampMs
        : right.timestampMs - left.timestampMs;
    return time || lexical(left.eventId, right.eventId);
  });
  let residual = selectedAmountRaw;
  const allocations: AttributionResult["allocations"] = [];
  for (const event of ordered) {
    if (residual === 0n) {
      break;
    }
    const allocated = event.amountRaw < residual ? event.amountRaw : residual;
    if (allocated > 0n) {
      allocations.push({
        eventId: event.eventId,
        allocatedRaw: allocated.toString()
      });
      residual -= allocated;
    }
  }
  return {
    policy,
    selectedAmountRaw: selectedAmountRaw.toString(),
    allocatedAmountRaw: (selectedAmountRaw - residual).toString(),
    residualAmountRaw: residual.toString(),
    allocations
  };
}

function proportional(
  selectedAmountRaw: bigint,
  inbound: NormalizedInbound[]
): AttributionResult {
  const total = inbound.reduce((sum, event) => sum + event.amountRaw, 0n);
  const target = selectedAmountRaw < total ? selectedAmountRaw : total;
  if (target === 0n || total === 0n) {
    return {
      policy: "proportional",
      selectedAmountRaw: selectedAmountRaw.toString(),
      allocatedAmountRaw: "0",
      residualAmountRaw: selectedAmountRaw.toString(),
      allocations: []
    };
  }

  const shares = inbound.map((event) => {
    const numerator = target * event.amountRaw;
    return {
      eventId: event.eventId,
      sourceAmountRaw: event.amountRaw,
      allocatedRaw: numerator / total,
      remainder: numerator % total
    };
  });
  let undistributed =
    target - shares.reduce((sum, share) => sum + share.allocatedRaw, 0n);
  const byRemainder = [...shares].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    return lexical(left.eventId, right.eventId);
  });
  for (const share of byRemainder) {
    if (undistributed === 0n) {
      break;
    }
    if (share.allocatedRaw < share.sourceAmountRaw) {
      share.allocatedRaw += 1n;
      undistributed -= 1n;
    }
  }
  if (undistributed !== 0n) {
    throw new Error("golden_proportional_conservation_failed");
  }

  const allocations = shares
    .filter((share) => share.allocatedRaw > 0n)
    .sort((left, right) => lexical(left.eventId, right.eventId))
    .map((share) => ({
      eventId: share.eventId,
      allocatedRaw: share.allocatedRaw.toString()
    }));
  return {
    policy: "proportional",
    selectedAmountRaw: selectedAmountRaw.toString(),
    allocatedAmountRaw: target.toString(),
    residualAmountRaw: (selectedAmountRaw - target).toString(),
    allocations
  };
}

export function compareAttributionPolicies(input: AttributionInput): {
  fifo: AttributionResult;
  lifo: AttributionResult;
  proportional: AttributionResult;
} {
  const normalized = normalize(input);
  return {
    fifo: sequential(
      "fifo",
      normalized.selectedAmountRaw,
      normalized.inbound
    ),
    lifo: sequential(
      "lifo",
      normalized.selectedAmountRaw,
      normalized.inbound
    ),
    proportional: proportional(
      normalized.selectedAmountRaw,
      normalized.inbound
    )
  };
}
