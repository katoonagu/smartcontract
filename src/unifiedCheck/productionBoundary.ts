import { evaluateBoundaryV1 } from "./boundaryPredicates";
import type { FrozenLabelRecordV1 } from "./frozenLabels";
import { SUPPORTED_LABEL_CATALOG_V1 } from "./labelCatalog";
import {
  traversalStateId,
  type TraversalStateV1
} from "./traversal";

const HASH = /^[0-9a-f]{64}$/u;

export type ProductionBoundaryEvidenceV2 = {
  readonly version: "unified-traversal-boundary-evidence-v2";
  readonly schemaVersion: 2;
  readonly traversalPolicyVersion: "snapshot-closure-v2";
  readonly predicateVersion: "unified-boundary-predicates-v1";
  readonly state: {
    readonly stateId: string;
    readonly address: string;
    readonly direction: "backward" | "forward";
    readonly fundingEpisodeId: string;
    readonly anchorTimestamp: string;
    readonly allocatedAmountRaw: string;
    readonly sourceEventIds: readonly string[];
  };
  readonly eventTimestamp: string;
  readonly reason: "identified_service_boundary";
  readonly snapshotHash: string;
  readonly labelDatasetSha256: string;
  readonly labelCatalogEntryId: string;
  readonly labelTerminalPolicy: "custodial_boundary";
  readonly labelAuthority: string;
  readonly labelSourcePayloadSha256: string;
};

export type ProductionBoundaryDecisionV2 =
  | {
      readonly terminal: true;
      readonly reason: "identified_service_boundary";
      readonly evidence: ProductionBoundaryEvidenceV2;
    }
  | {
      readonly terminal: false;
    };

export function evaluateProductionBoundaryV2(input: {
  readonly state: TraversalStateV1;
  readonly eventTimestamp: string;
  readonly labels: readonly FrozenLabelRecordV1[];
  readonly snapshotHash: string;
  readonly labelDatasetSha256: string;
}): ProductionBoundaryDecisionV2 {
  if (!HASH.test(input.snapshotHash) || !HASH.test(input.labelDatasetSha256)) {
    throw new TypeError("unified_v2_boundary_binding_invalid");
  }
  const decision = evaluateBoundaryV1({
    state: input.state,
    labels: input.labels,
    route: {
      continuationProven: false,
      pooledEndpointProven: false,
      evidenceSha256: null
    },
    economicRole: null,
    restriction: null,
    structuralProof: null,
    eventTimestamp: input.eventTimestamp
  });
  if (
    !decision.terminal ||
    decision.reason !== "identified_service_boundary" ||
    decision.evidence.labelCatalogEntryId === null
  ) return { terminal: false };

  const label = input.labels.find((candidate) =>
    candidate.address === input.state.address &&
    candidate.catalogEntryId === decision.evidence.labelCatalogEntryId &&
    candidate.sourcePayloadSha256 ===
      decision.evidence.labelSourcePayloadSha256
  );
  const catalog = SUPPORTED_LABEL_CATALOG_V1.entries.find((entry) =>
    entry.id === decision.evidence.labelCatalogEntryId
  );
  if (
    label === undefined ||
    catalog?.terminalPolicy !== "custodial_boundary"
  ) return { terminal: false };

  return {
    terminal: true,
    reason: "identified_service_boundary",
    evidence: {
      version: "unified-traversal-boundary-evidence-v2",
      schemaVersion: 2,
      traversalPolicyVersion: "snapshot-closure-v2",
      predicateVersion: "unified-boundary-predicates-v1",
      state: {
        stateId: traversalStateId(input.state),
        address: input.state.address,
        direction: input.state.direction,
        fundingEpisodeId: input.state.fundingEpisodeId,
        anchorTimestamp: input.state.anchorTimestamp,
        allocatedAmountRaw: input.state.allocatedAmountRaw,
        sourceEventIds: [...new Set(input.state.sourceEventIds)].sort()
      },
      eventTimestamp: input.eventTimestamp,
      reason: "identified_service_boundary",
      snapshotHash: input.snapshotHash,
      labelDatasetSha256: input.labelDatasetSha256,
      labelCatalogEntryId: catalog.id,
      labelTerminalPolicy: "custodial_boundary",
      labelAuthority: label.authority,
      labelSourcePayloadSha256: label.sourcePayloadSha256
    }
  };
}
