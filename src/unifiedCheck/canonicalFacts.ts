import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";

export type CanonicalFactLane = "hard" | "pattern" | "context" | "neutral";
export type CanonicalFactRole =
  | "subject"
  | "victim"
  | "drainer"
  | "spender"
  | "receiver"
  | "sender"
  | "approval_owner"
  | "operational_wallet"
  | "recipient"
  | "transit_sender"
  | "high_volume_transit_wallet"
  | "high_volume_recipient"
  | "high_volume_sender"
  | "route_sender"
  | "route_recipient"
  | "selected_amount_sender"
  | "selected_amount_recipient"
  | "fan_out_funder_recipient"
  | "fan_out_sender"
  | "collector_sender"
  | "collector_recipient"
  | "fan_in_fan_out_subject"
  | "history_subject"
  | "delivery_subject"
  | "attempt_subject"
  | "branch_subject"
  | "coverage_subject"
  | "dust_recipient"
  | "new_wallet_subject"
  | "cex_subject"
  | "cex_self_transfer"
  | "self_sender_recipient";

type CommonFactInput = {
  readonly factType: string;
  readonly subject: string;
  readonly subjectRole: CanonicalFactRole;
  readonly lane: CanonicalFactLane;
  readonly strength: "exact" | "corroborated" | "contextual";
  readonly sourceBranch: "fast" | "where" | "deep";
  readonly directness: "direct" | "indirect";
  readonly timing: "at_event" | "later" | "current" | "unknown";
  readonly negative?: boolean;
  readonly scopeStatus?: "COMPLETED" | "NOT_APPLICABLE" | "INCOMPLETE";
  readonly payload?: unknown;
};

export type CanonicalEventFactInput = CommonFactInput & {
  readonly profile: "event";
  readonly chain: string;
  readonly tokenContract: string | null;
  readonly txHash: string;
  readonly eventIndex: number;
  readonly counterparty: string | null;
};

export type CanonicalStateFactInput = CommonFactInput & {
  readonly profile: "state";
  readonly chain: string;
  readonly counterpartyOrObject: string | null;
  readonly effectiveAt: string | null;
  readonly snapshotBlock: string;
};

export type CanonicalPathFactInput = CommonFactInput & {
  readonly profile: "path";
  readonly chain: string;
  readonly orderedEventFactIds: readonly string[];
};

export type CanonicalFactInput =
  | CanonicalEventFactInput
  | CanonicalStateFactInput
  | CanonicalPathFactInput;

export type CanonicalFactV1 = {
  readonly version: "canonical-fact-v1";
  readonly id: string;
  readonly profile: "event" | "state" | "path";
  readonly factType: string;
  readonly subject: string;
  readonly subjectRole: CanonicalFactRole;
  readonly lane: CanonicalFactLane;
  readonly strength: "exact" | "corroborated" | "contextual";
  readonly sourceBranches: readonly ("fast" | "where" | "deep")[];
  readonly directness: "direct" | "indirect";
  readonly timing: "at_event" | "later" | "current" | "unknown";
  readonly payload: unknown;
};

export type AdjudicatedFactV4 = {
  readonly canonicalFactId: string;
  readonly lane: CanonicalFactLane;
  readonly role: CanonicalFactRole;
  readonly directness: CanonicalFactV1["directness"];
  readonly timing: CanonicalFactV1["timing"];
};

type TypedAbsent = {
  readonly kind: "absent";
  readonly valueType: "tron_address" | "token_contract" | "timestamp";
};

function optional(
  value: string | null,
  valueType: TypedAbsent["valueType"]
): string | TypedAbsent {
  return value ?? { kind: "absent", valueType };
}

function validateCommon(fact: CanonicalFactInput): void {
  if (
    fact.factType.trim().length === 0 ||
    fact.subject.trim().length === 0 ||
    !["hard", "pattern", "context", "neutral"].includes(fact.lane) ||
    !["exact", "corroborated", "contextual"].includes(fact.strength) ||
    !["fast", "where", "deep"].includes(fact.sourceBranch) ||
    !["direct", "indirect"].includes(fact.directness) ||
    !["at_event", "later", "current", "unknown"].includes(fact.timing) ||
    (fact.negative === true && fact.scopeStatus !== "COMPLETED")
  ) {
    throw new TypeError("unified_canonical_fact_invalid");
  }
}

function adjudicatedFactType(fact: AdjudicatedFactV4): string {
  if (fact.lane === "hard" && fact.role === "victim") {
    return "confirmed_victim_debit";
  }
  if (fact.lane === "hard" && fact.role === "recipient") {
    return "blacklisted_at_transfer";
  }
  if (fact.lane === "pattern") {
    if (fact.role === "approval_owner") return "dangerous_unlimited_approval";
    if (fact.role === "fan_in_fan_out_subject") return "dense_fan_in_fan_out";
    if (fact.role.startsWith("high_volume_")) return "high_volume_transit";
    if (fact.role.startsWith("collector_")) return "collector_transit_pattern";
    if (fact.role.startsWith("route_")) return "route_transit_pattern";
    if (fact.role.startsWith("selected_amount_")) return "selected_amount_forwarded";
    if (fact.role.startsWith("fan_out_")) return "fan_out_pattern";
    if (fact.role === "transit_sender") return "rapid_forwarding";
  }
  if (fact.lane === "neutral" && fact.role === "operational_wallet") {
    return "old_active_operational_wallet";
  }
  if (fact.lane === "neutral" && fact.role === "new_wallet_subject") {
    return "no_usdt_activity";
  }
  if (fact.lane === "neutral" && fact.role === "cex_subject") {
    return "clean_confirmed_context";
  }
  if (
    fact.lane === "context" &&
    fact.role === "recipient" &&
    fact.timing === "later"
  ) {
    return "counterparty_later_frozen";
  }
  return `adjudicated_${fact.lane}_${fact.role}`;
}

export function canonicalizeAdjudicatedFactsV4(input: {
  readonly subjectAddress: string;
  readonly facts: readonly AdjudicatedFactV4[];
}): CanonicalFactV1[] {
  if (input.subjectAddress.trim().length === 0) {
    throw new TypeError("unified_adjudicated_subject_missing");
  }
  const facts: CanonicalStateFactInput[] = input.facts.map((fact) => {
    if (fact.canonicalFactId.trim().length === 0) {
      throw new TypeError("unified_adjudicated_fact_id_missing");
    }
    return {
      profile: "state",
      chain: "tron",
      factType: adjudicatedFactType(fact),
      subject: input.subjectAddress,
      counterpartyOrObject: null,
      subjectRole: fact.role,
      effectiveAt: null,
      snapshotBlock: fact.canonicalFactId,
      lane: fact.lane,
      strength: fact.lane === "hard"
        ? "exact"
        : fact.lane === "pattern"
          ? "corroborated"
          : fact.lane === "context"
            ? "contextual"
            : "exact",
      sourceBranch: "deep",
      directness: fact.directness,
      timing: fact.timing,
      payload: { adjudicatedFactId: fact.canonicalFactId }
    };
  });
  return [...canonicalizeEvidenceFacts({ facts }).inventory.facts];
}

export function canonicalFactId(fact: CanonicalFactInput): string {
  validateCommon(fact);
  if (fact.profile === "event") {
    if (!Number.isSafeInteger(fact.eventIndex) || fact.eventIndex < 0) {
      throw new TypeError("unified_canonical_event_index_invalid");
    }
    return fingerprintCanonicalArtifact([
      "canonical-fact-key-v1",
      "event",
      fact.chain,
      optional(fact.tokenContract, "token_contract"),
      fact.txHash,
      fact.eventIndex,
      fact.factType,
      fact.subject,
      optional(fact.counterparty, "tron_address"),
      fact.subjectRole,
      fact.directness,
      fact.timing
    ]);
  }
  if (fact.profile === "state") {
    return fingerprintCanonicalArtifact([
      "canonical-fact-key-v1",
      "state",
      fact.chain,
      fact.factType,
      fact.subject,
      optional(fact.counterpartyOrObject, "tron_address"),
      fact.subjectRole,
      optional(fact.effectiveAt, "timestamp"),
      fact.snapshotBlock,
      fact.directness,
      fact.timing
    ]);
  }
  return fingerprintCanonicalArtifact([
    "canonical-fact-key-v1",
    "path",
    fact.chain,
    fingerprintCanonicalArtifact(fact.orderedEventFactIds),
    fact.factType,
    fact.subject,
    fact.subjectRole,
    fact.directness,
    fact.timing
  ]);
}

const STRENGTH = { exact: 3, corroborated: 2, contextual: 1 } as const;
const LANE = { hard: 4, pattern: 3, context: 2, neutral: 1 } as const;

function priority(fact: CanonicalFactInput): number {
  return STRENGTH[fact.strength] * 10 + LANE[fact.lane];
}

function toCanonical(
  id: string,
  fact: CanonicalFactInput,
  sourceBranches: readonly ("fast" | "where" | "deep")[]
): CanonicalFactV1 {
  return {
    version: "canonical-fact-v1",
    id,
    profile: fact.profile,
    factType: fact.factType,
    subject: fact.subject,
    subjectRole: fact.subjectRole,
    lane: fact.lane,
    strength: fact.strength,
    sourceBranches,
    directness: fact.directness,
    timing: fact.timing,
    payload: fact.payload ?? null
  };
}

export function canonicalizeEvidenceFacts(input: {
  facts: readonly CanonicalFactInput[];
  correlatedUnknownPatternThreshold?: number;
}): {
  inventory: {
    readonly version: "canonical-fact-inventory-v1";
    readonly facts: readonly CanonicalFactV1[];
  };
  conflictReceipt: {
    readonly version: "canonical-fact-conflict-receipt-v1";
    readonly retained: readonly string[];
    readonly superseded: ReadonlyArray<{
      readonly id: string;
      readonly sourceBranch: string;
      readonly reason: string;
    }>;
  };
  inventoryHash: string;
  conflictReceiptHash: string;
} {
  const groups = new Map<string, CanonicalFactInput[]>();
  const superseded: Array<{
    id: string;
    sourceBranch: string;
    reason: string;
  }> = [];
  for (const fact of input.facts) {
    if (fact.negative === true && fact.scopeStatus !== "COMPLETED") {
      superseded.push({
        id: fingerprintCanonicalArtifact(fact),
        sourceBranch: fact.sourceBranch,
        reason: "negative_scope_incomplete"
      });
      continue;
    }
    const id = canonicalFactId(fact);
    const group = groups.get(id) ?? [];
    group.push(fact);
    groups.set(id, group);
  }
  const retained: CanonicalFactV1[] = [];
  for (const [id, group] of groups) {
    const ordered = [...group].sort((left, right) =>
      priority(right) - priority(left) ||
      left.sourceBranch.localeCompare(right.sourceBranch)
    );
    const winner = ordered[0]!;
    const branches = [...new Set(group.map((fact) => fact.sourceBranch))].sort();
    retained.push(toCanonical(id, winner, branches));
    for (const loser of ordered.slice(1)) {
      superseded.push({
        id,
        sourceBranch: loser.sourceBranch,
        reason: priority(winner) > priority(loser)
          ? "stronger_projection_retained"
          : "duplicate_projection_merged"
      });
    }
  }

  const factTypes = new Set(retained.map((fact) => fact.factType));
  const weakPatternTypes = [
    "mass_fan_in",
    "rapid_forwarding",
    "high_concentration",
    "repeated_behavior"
  ];
  const threshold = input.correlatedUnknownPatternThreshold ?? 3;
  const matchedWeakPatterns = weakPatternTypes.filter((type) => factTypes.has(type));
  if (
    factTypes.has("unknown_source") &&
    matchedWeakPatterns.length >= threshold
  ) {
    const unknown = retained.find((fact) => fact.factType === "unknown_source")!;
    const compositeInput: CanonicalStateFactInput = {
      profile: "state",
      chain: "tron",
      factType: "unknown_with_correlated_pattern",
      subject: unknown.subject,
      counterpartyOrObject: null,
      subjectRole: unknown.subjectRole,
      effectiveAt: null,
      snapshotBlock: "composite",
      lane: "pattern",
      strength: "corroborated",
      sourceBranch: "deep",
      directness: "direct",
      timing: "current",
      payload: { matchedWeakPatterns: matchedWeakPatterns.sort() }
    };
    const id = canonicalFactId(compositeInput);
    retained.push(toCanonical(id, compositeInput, ["deep"]));
  }
  retained.sort((left, right) => left.id.localeCompare(right.id));
  superseded.sort((left, right) =>
    left.id.localeCompare(right.id) ||
    left.sourceBranch.localeCompare(right.sourceBranch) ||
    left.reason.localeCompare(right.reason)
  );
  const inventory = {
    version: "canonical-fact-inventory-v1" as const,
    facts: retained
  };
  const conflictReceipt = {
    version: "canonical-fact-conflict-receipt-v1" as const,
    retained: retained.map((fact) => fact.id),
    superseded
  };
  return {
    inventory,
    conflictReceipt,
    inventoryHash: fingerprintCanonicalArtifact(inventory),
    conflictReceiptHash: fingerprintCanonicalArtifact(conflictReceipt)
  };
}
