import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";

export type CanonicalFactLane = "hard" | "pattern" | "context" | "neutral";
export type CanonicalFactRole =
  | "subject"
  | "victim"
  | "drainer"
  | "spender"
  | "receiver"
  | "sender";

type CommonFactInput = {
  readonly factType: string;
  readonly subject: string;
  readonly subjectRole: CanonicalFactRole;
  readonly lane: CanonicalFactLane;
  readonly strength: "exact" | "corroborated" | "contextual";
  readonly sourceBranch: "fast" | "where" | "deep";
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
  readonly payload: unknown;
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
    fact.sourceBranch.trim().length === 0 ||
    (fact.negative === true && fact.scopeStatus !== "COMPLETED")
  ) {
    throw new TypeError("unified_canonical_fact_invalid");
  }
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
      fact.subjectRole
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
      fact.snapshotBlock
    ]);
  }
  return fingerprintCanonicalArtifact([
    "canonical-fact-key-v1",
    "path",
    fact.chain,
    fingerprintCanonicalArtifact(fact.orderedEventFactIds),
    fact.factType,
    fact.subject,
    fact.subjectRole
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
