import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import {
  canonicalTronUsdtEventKey
} from "../forensics/tronAddressAllTimeIndex";
import type {
  IndexedTronUsdtTransfer,
  UsdtBlacklistTimeline,
  UsdtBlacklistTimelineEvent
} from "../types";
import type { CanonicalFactInput } from "./canonicalFacts";
import type {
  UnifiedTraversalArtifactV1
} from "./productionTraversal";

const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const HIGH_VOLUME_RAW = 100_000n * 1_000_000n;

type BranchEvidence = {
  readonly evidence: readonly unknown[];
  readonly facts: readonly CanonicalFactInput[];
  readonly patterns: readonly unknown[];
  readonly boundaries: readonly unknown[];
  readonly roles: readonly unknown[];
  readonly candidates: readonly unknown[];
};

export type UnifiedProductionEvidence = {
  readonly fast: BranchEvidence;
  readonly where: BranchEvidence;
  readonly deep: BranchEvidence;
};

export type UnifiedProductionHardEvidence = {
  readonly blacklistedAtEventKeys?: ReadonlySet<string>;
  readonly confirmedVictimDebitEventKeys?: ReadonlySet<string>;
  readonly dangerousApprovalIds?: ReadonlySet<string>;
};

export function evidenceDateWithinSnapshot(
  occurredAt: Date | null,
  snapshotTimestamp: string
): boolean {
  const snapshotMs = Date.parse(snapshotTimestamp);
  return occurredAt !== null &&
    Number.isFinite(snapshotMs) &&
    !Number.isNaN(occurredAt.getTime()) &&
    occurredAt.getTime() <= snapshotMs;
}

export function requireCompleteUnifiedBlacklistTimeline(
  timeline: UsdtBlacklistTimeline
): readonly UsdtBlacklistTimelineEvent[] {
  const unverified = timeline.events.some((event) =>
    event.verification !== "verified_contract_log"
  );
  if (
    timeline.pagination !== "complete" ||
    timeline.failureReason !== null ||
    unverified
  ) {
    throw new Error(
      `unified_blacklist_timeline_incomplete:${
        timeline.failureReason ??
        (unverified ? "event_log_unverified" : "provider_failed")
      }`
    );
  }
  return timeline.events;
}

function empty(): BranchEvidence {
  return {
    evidence: [],
    facts: [],
    patterns: [],
    boundaries: [],
    roles: [],
    candidates: []
  };
}

function isSubject(address: string, subject: string): boolean {
  return address.toLowerCase() === subject.toLowerCase();
}

function eventKey(event: IndexedTronUsdtTransfer): string {
  return `${event.txHash}:${event.eventIndex}`;
}

function eventFact(
  event: IndexedTronUsdtTransfer,
  subjectAddress: string,
  factType: string,
  lane: CanonicalFactInput["lane"],
  strength: CanonicalFactInput["strength"],
  sourceBranch: "fast" | "where" | "deep",
  role: CanonicalFactInput["subjectRole"]
): CanonicalFactInput {
  const incoming = isSubject(event.toAddress, subjectAddress);
  return {
    profile: "event",
    chain: "tron",
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    txHash: event.txHash,
    eventIndex: event.eventIndex,
    factType,
    subject: subjectAddress,
    counterparty: incoming ? event.fromAddress : event.toAddress,
    subjectRole: role,
    lane,
    strength,
    sourceBranch,
    directness: "direct",
    timing: "at_event",
    payload: {
      amountRaw: event.amountRaw,
      direction: incoming ? "incoming" : "outgoing",
      timestamp: event.blockTimestamp.toISOString()
    }
  };
}

function stateFact(input: {
  subjectAddress: string;
  snapshotBlock: string;
  factType: string;
  counterparty?: string | null;
  role: CanonicalFactInput["subjectRole"];
  lane: CanonicalFactInput["lane"];
  strength: CanonicalFactInput["strength"];
  sourceBranch: "fast" | "where" | "deep";
  directness?: "direct" | "indirect";
  timing?: "at_event" | "later" | "current" | "unknown";
  effectiveAt?: string | null;
  payload?: unknown;
}): CanonicalFactInput {
  return {
    profile: "state",
    chain: "tron",
    factType: input.factType,
    subject: input.subjectAddress,
    counterpartyOrObject: input.counterparty ?? null,
    subjectRole: input.role,
    effectiveAt: input.effectiveAt ?? null,
    snapshotBlock: input.snapshotBlock,
    lane: input.lane,
    strength: input.strength,
    sourceBranch: input.sourceBranch,
    directness: input.directness ?? "direct",
    timing: input.timing ?? "current",
    payload: input.payload ?? null
  };
}

function sum(events: readonly IndexedTronUsdtTransfer[]): bigint {
  return events.reduce((total, event) => total + BigInt(event.amountRaw), 0n);
}

function concentratedRapidForwarding(input: {
  incoming: readonly IndexedTronUsdtTransfer[];
  outgoing: readonly IndexedTronUsdtTransfer[];
}): {
  correlated: boolean;
  rapid: boolean;
  topRecipientSharePpm: number;
} {
  if (input.incoming.length === 0 || input.outgoing.length === 0) {
    return { correlated: false, rapid: false, topRecipientSharePpm: 0 };
  }
  const firstInbound = Math.min(
    ...input.incoming.map((event) => event.blockTimestamp.getTime())
  );
  const lastInbound = Math.max(
    ...input.incoming.map((event) => event.blockTimestamp.getTime())
  );
  const rapidOutgoing = input.outgoing.filter((event) => {
    const timestamp = event.blockTimestamp.getTime();
    return timestamp >= firstInbound && timestamp <= lastInbound + ONE_DAY_MS;
  });
  const incomingRaw = sum(input.incoming);
  const rapidRaw = sum(rapidOutgoing);
  const outgoingByRecipient = new Map<string, bigint>();
  for (const event of rapidOutgoing) {
    outgoingByRecipient.set(
      event.toAddress,
      (outgoingByRecipient.get(event.toAddress) ?? 0n) + BigInt(event.amountRaw)
    );
  }
  const top = [...outgoingByRecipient.values()].reduce(
    (maximum, value) => value > maximum ? value : maximum,
    0n
  );
  const topRecipientSharePpm = rapidRaw === 0n
    ? 0
    : Number(top * 1_000_000n / rapidRaw);
  const rapid = incomingRaw > 0n && rapidRaw * 2n >= incomingRaw;
  return {
    rapid,
    correlated: rapid && topRecipientSharePpm >= 700_000,
    topRecipientSharePpm
  };
}

export function buildUnifiedProductionEvidence(input: {
  readonly subjectAddress: string;
  readonly snapshotBlock: string;
  readonly events: readonly IndexedTronUsdtTransfer[];
  readonly knownCounterparties: ReadonlyMap<string, readonly string[]>;
  readonly hardEvidence?: UnifiedProductionHardEvidence;
  readonly traversal?: UnifiedTraversalArtifactV1;
}): UnifiedProductionEvidence {
  const fastFacts: CanonicalFactInput[] = [stateFact({
    subjectAddress: input.subjectAddress,
    snapshotBlock: input.snapshotBlock,
    factType: input.events.length === 0
      ? "no_usdt_activity"
      : "direct_activity_observed",
    role: "subject",
    lane: "neutral",
    strength: "exact",
    sourceBranch: "fast",
    payload: { directTransferCount: input.events.length }
  })];
  const whereFacts: CanonicalFactInput[] = [];
  const deepFacts: CanonicalFactInput[] = [];
  const incoming = input.events.filter((event) =>
    isSubject(event.toAddress, input.subjectAddress)
  );
  const outgoing = input.events.filter((event) =>
    isSubject(event.fromAddress, input.subjectAddress)
  );
  const directEventIds = new Set(
    input.events.map((event) => canonicalTronUsdtEventKey(event))
  );
  for (const event of input.events) {
    const incomingToSubject = isSubject(event.toAddress, input.subjectAddress);
    const counterparty = incomingToSubject
      ? event.fromAddress
      : event.toAddress;
    whereFacts.push(eventFact(
      event,
      input.subjectAddress,
      "direct_usdt_transfer",
      "neutral",
      "exact",
      "where",
      incomingToSubject ? "recipient" : "sender"
    ));
    if (
      incomingToSubject &&
      !input.knownCounterparties.has(counterparty)
    ) {
      whereFacts.push(stateFact({
        subjectAddress: input.subjectAddress,
        snapshotBlock: input.snapshotBlock,
        factType: "unknown_source",
        counterparty,
        role: "recipient",
        lane: "context",
        strength: "contextual",
        sourceBranch: "where"
      }));
    }
    const labels = input.knownCounterparties.get(counterparty);
    if (labels && labels.length > 0) {
      whereFacts.push(stateFact({
        subjectAddress: input.subjectAddress,
        snapshotBlock: input.snapshotBlock,
        factType: "service_link",
        counterparty,
        role: incomingToSubject ? "recipient" : "sender",
        lane: "context",
        strength: "exact",
        sourceBranch: "where",
        payload: {
          labels: [...labels].sort(),
          direction: incomingToSubject ? "incoming" : "outgoing"
        }
      }));
    }
    if (input.hardEvidence?.blacklistedAtEventKeys?.has(eventKey(event))) {
      deepFacts.push(eventFact(
        event,
        input.subjectAddress,
        "blacklisted_at_transfer",
        "hard",
        "exact",
        "deep",
        incomingToSubject ? "receiver" : "recipient"
      ));
    }
    if (
      input.hardEvidence?.confirmedVictimDebitEventKeys?.has(eventKey(event))
    ) {
      deepFacts.push(eventFact(
        event,
        input.subjectAddress,
        "confirmed_victim_debit",
        "hard",
        "exact",
        "deep",
        "victim"
      ));
    }
  }

  for (const approvalId of input.hardEvidence?.dangerousApprovalIds ?? []) {
    deepFacts.push(stateFact({
      subjectAddress: input.subjectAddress,
      snapshotBlock: input.snapshotBlock,
      factType: "dangerous_unlimited_approval",
      counterparty: approvalId,
      role: "approval_owner",
      lane: "pattern",
      strength: "exact",
      sourceBranch: "deep",
      payload: { approvalId }
    }));
  }

  const unknownIncoming = incoming.filter((event) =>
    !input.knownCounterparties.has(event.fromAddress)
  );
  const unknownSenders = new Set(
    unknownIncoming.map((event) => event.fromAddress)
  );
  const forwarding = concentratedRapidForwarding({ incoming, outgoing });
  if (unknownSenders.size >= 10 && forwarding.correlated) {
    deepFacts.push(stateFact({
      subjectAddress: input.subjectAddress,
      snapshotBlock: input.snapshotBlock,
      factType: "dense_fan_in_fan_out",
      role: "fan_in_fan_out_subject",
      lane: "pattern",
      strength: "corroborated",
      sourceBranch: "deep",
      payload: {
        unknownSenderCount: unknownSenders.size,
        topRecipientSharePpm: forwarding.topRecipientSharePpm
      }
    }));
  }
  const incomingRaw = sum(incoming);
  const outgoingRaw = sum(outgoing);
  if (
    incomingRaw >= HIGH_VOLUME_RAW &&
    outgoingRaw >= HIGH_VOLUME_RAW &&
    outgoingRaw * 2n >= incomingRaw &&
    incomingRaw * 2n >= outgoingRaw
  ) {
    deepFacts.push(stateFact({
      subjectAddress: input.subjectAddress,
      snapshotBlock: input.snapshotBlock,
      factType: "high_volume_inbound_outbound",
      role: "high_volume_transit_wallet",
      lane: "pattern",
      strength: "corroborated",
      sourceBranch: "deep",
      payload: {
        incomingRaw: incomingRaw.toString(),
        outgoingRaw: outgoingRaw.toString()
      }
    }));
  }
  if (
    incoming.length > 0 &&
    outgoing.some((outbound) =>
      incoming.some((inbound) => {
        const delay = outbound.blockTimestamp.getTime() -
          inbound.blockTimestamp.getTime();
        return delay >= 0 && delay <= ONE_HOUR_MS;
      })
    ) &&
    outgoingRaw * 5n >= incomingRaw * 4n
  ) {
    deepFacts.push(stateFact({
      subjectAddress: input.subjectAddress,
      snapshotBlock: input.snapshotBlock,
      factType: "rapid_forwarding",
      role: "transit_sender",
      lane: "pattern",
      strength: "corroborated",
      sourceBranch: "deep"
    }));
  }
  for (const terminal of input.traversal?.terminalStates ?? []) {
    const directness = terminal.sourceEventIds.length > 0 &&
      terminal.sourceEventIds.every((id) => directEventIds.has(id))
      ? "direct"
      : "indirect";
    whereFacts.push(stateFact({
      subjectAddress: input.subjectAddress,
      snapshotBlock: input.snapshotBlock,
      factType: terminal.reason,
      counterparty: terminal.address,
      role: terminal.direction === "backward" ? "recipient" : "sender",
      lane: "context",
      strength: terminal.labels.length > 0 ? "exact" : "contextual",
      sourceBranch: "where",
      directness,
      timing: "at_event",
      effectiveAt: terminal.anchorTimestamp,
      payload: {
        amountRaw: terminal.amountRaw,
        evidenceHash: terminal.evidenceHash,
        labels: terminal.labels,
        direction: terminal.direction
      }
    }));
    if (terminal.reason === "policy_or_restriction_boundary") {
      deepFacts.push(stateFact({
        subjectAddress: input.subjectAddress,
        snapshotBlock: input.snapshotBlock,
        factType: "indirect_restriction_boundary",
        counterparty: terminal.address,
        role: terminal.direction === "backward" ? "receiver" : "recipient",
        lane: "context",
        strength: "exact",
        sourceBranch: "deep",
        directness,
        timing: "at_event",
        effectiveAt: terminal.anchorTimestamp,
        payload: {
          evidenceHash: terminal.evidenceHash,
          labels: terminal.labels
        }
      }));
    }
  }

  return {
    fast: { ...empty(), facts: fastFacts },
    where: { ...empty(), facts: whereFacts },
    deep: { ...empty(), facts: deepFacts }
  };
}
