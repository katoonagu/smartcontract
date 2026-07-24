import type { FrozenLabelRecordV1 } from "./frozenLabels";
import {
  SUPPORTED_LABEL_CATALOG_V1,
  type SupportedLabelCatalogEntryV1
} from "./labelCatalog";
import {
  traversalStateId,
  type TraversalStateV1,
  type TraversalTerminalReason
} from "./traversal";

const HASH = /^[0-9a-f]{64}$/u;

export type BoundaryRouteEvidenceV1 = {
  readonly continuationProven: boolean;
  readonly pooledEndpointProven: boolean;
  readonly evidenceSha256: string | null;
};

export type BoundaryEconomicRoleEvidenceV1 = {
  readonly proven: boolean;
  readonly role: string;
  readonly evidenceSha256: string;
};

export type BoundaryRestrictionEvidenceV1 = {
  readonly validAtEvent: boolean;
  readonly evidenceSha256: string;
};

export type BoundaryStructuralProofV1 = {
  readonly kind: "shared_ownership_or_mixing";
  readonly evidenceSha256: string;
  readonly adjudicationSha256: string | null;
};

export type BoundaryPredicateInputV1 = {
  readonly state: TraversalStateV1;
  readonly labels: readonly FrozenLabelRecordV1[];
  readonly route: BoundaryRouteEvidenceV1;
  readonly economicRole: BoundaryEconomicRoleEvidenceV1 | null;
  readonly restriction: BoundaryRestrictionEvidenceV1 | null;
  readonly structuralProof: BoundaryStructuralProofV1 | null;
  readonly eventTimestamp: string;
};

export type BoundaryEvidenceV1 = {
  readonly version: "unified-boundary-evidence-v1";
  readonly predicateVersion: "unified-boundary-predicates-v1";
  readonly stateId: string;
  readonly eventTimestamp: string;
  readonly labelCatalogEntryId: string | null;
  readonly labelSourcePayloadSha256: string | null;
  readonly supportingEvidenceSha256: string;
};

export type BoundaryContextEvidenceV1 = {
  readonly kind:
    | "label_not_valid_at_event"
    | "hint_not_terminal"
    | "route_continuation_proven"
    | "economic_role_missing"
    | "structural_proof_pending_adjudication";
  readonly catalogEntryId: string | null;
  readonly evidenceSha256: string | null;
};

export type BoundaryDecisionV1 =
  | {
      readonly terminal: true;
      readonly reason: TraversalTerminalReason;
      readonly predicateVersion: "unified-boundary-predicates-v1";
      readonly evidence: BoundaryEvidenceV1;
    }
  | {
      readonly terminal: false;
      readonly contextEvidence: readonly BoundaryContextEvidenceV1[];
    };

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("unified_boundary_timestamp_invalid");
  }
  return parsed;
}

function labelValidAt(label: FrozenLabelRecordV1, eventAt: number): boolean {
  return (
    (label.validFrom === null || timestamp(label.validFrom) <= eventAt) &&
    (label.validTo === null || eventAt <= timestamp(label.validTo))
  );
}

function catalogEntry(label: FrozenLabelRecordV1):
  SupportedLabelCatalogEntryV1 | null {
  return SUPPORTED_LABEL_CATALOG_V1.entries.find(
    (entry) => entry.id === label.catalogEntryId
  ) ?? null;
}

function terminalEvidence(input: {
  state: TraversalStateV1;
  eventTimestamp: string;
  label: FrozenLabelRecordV1 | null;
  supportingEvidenceSha256: string;
}): BoundaryEvidenceV1 {
  if (!HASH.test(input.supportingEvidenceSha256)) {
    throw new TypeError("unified_boundary_evidence_hash_invalid");
  }
  return {
    version: "unified-boundary-evidence-v1",
    predicateVersion: "unified-boundary-predicates-v1",
    stateId: traversalStateId(input.state),
    eventTimestamp: input.eventTimestamp,
    labelCatalogEntryId: input.label?.catalogEntryId ?? null,
    labelSourcePayloadSha256: input.label?.sourcePayloadSha256 ?? null,
    supportingEvidenceSha256: input.supportingEvidenceSha256
  };
}

function terminal(
  input: BoundaryPredicateInputV1,
  reason: TraversalTerminalReason,
  label: FrozenLabelRecordV1 | null,
  supportingEvidenceSha256: string
): BoundaryDecisionV1 {
  return {
    terminal: true,
    reason,
    predicateVersion: "unified-boundary-predicates-v1",
    evidence: terminalEvidence({
      state: input.state,
      eventTimestamp: input.eventTimestamp,
      label,
      supportingEvidenceSha256
    })
  };
}

export function evaluateBoundaryV1(
  input: BoundaryPredicateInputV1
): BoundaryDecisionV1 {
  const eventAt = timestamp(input.eventTimestamp);
  if (input.state.address.length === 0) {
    throw new TypeError("unified_boundary_state_invalid");
  }
  const context: BoundaryContextEvidenceV1[] = [];

  if (input.restriction?.validAtEvent === true) {
    return terminal(
      input,
      "policy_or_restriction_boundary",
      null,
      input.restriction.evidenceSha256
    );
  }

  const eligible: Array<{
    label: FrozenLabelRecordV1;
    entry: SupportedLabelCatalogEntryV1;
  }> = [];
  for (const label of input.labels) {
    if (label.address !== input.state.address) continue;
    if (!labelValidAt(label, eventAt)) {
      context.push({
        kind: "label_not_valid_at_event",
        catalogEntryId: label.catalogEntryId,
        evidenceSha256: label.sourcePayloadSha256
      });
      continue;
    }
    const entry = catalogEntry(label);
    if (
      entry === null ||
      !label.terminalEligible ||
      label.strength === "hint"
    ) {
      context.push({
        kind: "hint_not_terminal",
        catalogEntryId: label.catalogEntryId,
        evidenceSha256: label.sourcePayloadSha256
      });
      continue;
    }
    eligible.push({ label, entry });
  }

  const custodial = eligible.find(
    ({ entry }) => entry.terminalPolicy === "custodial_boundary"
  );
  if (custodial) {
    return terminal(
      input,
      "identified_service_boundary",
      custodial.label,
      custodial.label.sourcePayloadSha256
    );
  }

  const routeDependent = eligible.find(
    ({ entry }) => entry.terminalPolicy === "route_dependent"
  );
  if (routeDependent) {
    if (input.route.continuationProven) {
      context.push({
        kind: "route_continuation_proven",
        catalogEntryId: routeDependent.entry.id,
        evidenceSha256: input.route.evidenceSha256
      });
    } else if (
      input.route.pooledEndpointProven &&
      input.route.evidenceSha256 !== null
    ) {
      return terminal(
        input,
        "shared_liquidity_boundary",
        routeDependent.label,
        input.route.evidenceSha256
      );
    }
  }

  const economic = eligible.find(
    ({ entry }) => entry.terminalPolicy === "economic_role_required"
  );
  if (economic) {
    if (
      input.economicRole?.proven === true &&
      input.economicRole.role.trim().length > 0
    ) {
      return terminal(
        input,
        "contract_economic_boundary",
        economic.label,
        input.economicRole.evidenceSha256
      );
    }
    context.push({
      kind: "economic_role_missing",
      catalogEntryId: economic.entry.id,
      evidenceSha256: economic.label.sourcePayloadSha256
    });
  }

  if (input.structuralProof !== null) {
    // P1 V1 deliberately keeps this non-terminal until a locked adjudication
    // authorizes a specific structural-proof contract.
    context.push({
      kind: "structural_proof_pending_adjudication",
      catalogEntryId: null,
      evidenceSha256: input.structuralProof.evidenceSha256
    });
  }

  return { terminal: false, contextEvidence: context };
}
