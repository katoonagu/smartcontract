import type { DeepSecondLayerRelationshipProfile } from "../../../src/types";

export type RuntimeWaitStatus = "waiting" | "ready" | "terminal" | "cancelled";

export type RemediationRuntimeWaitRow = {
  id: string;
  jobId: string;
  address: string;
  targetTimestamp: Date;
  windowStartTimestamp: Date;
  requiredFor: "where_hop" | "incoming_hop";
  status: RuntimeWaitStatus;
  statusReason: string;
  relatedHopTxHash: string;
  candidateTxHash: string;
};

export type RemediationRuntimeParent = {
  id: string;
  kind: "where_is_money_check" | "incoming_deposit_check";
  subjectAddress: string;
  chatId: string;
  progressJson: Record<string, unknown>;
};

export type StrandedParentRuntimeCase = {
  id: "tdea-163" | "tdea-repeat-104" | "tyd-216";
  label: "TDEA 163/163" | "TDEA repeat 104/104" | "TYD 216/216";
  parent: RemediationRuntimeParent;
  waits: RemediationRuntimeWaitRow[];
};

const BASE_TIMESTAMP = Date.parse("2026-07-15T09:00:00.000Z");

export const CANONICAL_DEEP_SECOND_LAYER_PROFILE: DeepSecondLayerRelationshipProfile = {
  version: 1,
  source: "deepcheck_relationship_expansion_v1",
  subjectAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  generatedAt: "2026-07-15T12:05:00.000Z",
  limits: {
    maxDirectWalletsConsidered: 10,
    maxExpandedDirectWallets: 5,
    maxSecondHopNeighborsPerDirectWallet: 6,
    maxTotalSecondHopEdges: 30,
    highDegreeSuppressionThreshold: 250
  },
  directWalletStatuses: [],
  paths: [],
  groups: [],
  queueRequests: [],
  counters: {
    directWalletsConsidered: 0,
    expanded: 0,
    grouped: 0,
    stopped: 0,
    notIndexed: 0,
    queued: 0,
    complete: 0,
    paths: 0,
    groups: 0,
    maxSavedDepth: 0
  }
};

export const CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE: DeepSecondLayerRelationshipProfile = {
  ...CANONICAL_DEEP_SECOND_LAYER_PROFILE,
  directWalletStatuses: [{
    address: "TWYSVbUy6eTu6ZrFWRUimgDy9SinkggVKL",
    status: "queued",
    stopReason: "queued_for_indexing",
    limitationCode: "deep_second_layer_queued",
    queued: true,
    serviceCategory: null,
    identity: null,
    index: null,
    savedPathCount: 0,
    groupedNeighborCount: 0
  }],
  counters: {
    ...CANONICAL_DEEP_SECOND_LAYER_PROFILE.counters,
    directWalletsConsidered: 1,
    queued: 1
  }
};

export function remediationParent(
  id: string,
  kind: RemediationRuntimeParent["kind"] = "where_is_money_check"
): RemediationRuntimeParent {
  return {
    id: `synthetic-parent-${id}`,
    kind,
    subjectAddress: `synthetic-subject-${id}`,
    chatId: `synthetic-chat-${id}`,
    progressJson: {
      fixtureId: id,
      jobPhase: "waiting_for_targeted_index",
      targetedIndex: {
        phase: "waiting_for_targeted_index",
        waitingFor: { fixtureId: id }
      }
    }
  };
}

export function remediationWaits(
  parent: RemediationRuntimeParent,
  statuses: RuntimeWaitStatus[]
): RemediationRuntimeWaitRow[] {
  return statuses.map((status, index) => {
    const targetTimestamp = new Date(BASE_TIMESTAMP + index * 1_000);
    return {
      id: `synthetic-wait-${parent.id}-${index}`,
      jobId: parent.id,
      address: `synthetic-hop-${parent.id}-${index}`,
      targetTimestamp,
      windowStartTimestamp: new Date(targetTimestamp.getTime() - 60_000),
      requiredFor: parent.kind === "incoming_deposit_check" ? "incoming_hop" : "where_hop",
      status,
      statusReason: status === "terminal" ? "partial_provider_cap" : `synthetic-${status}`,
      relatedHopTxHash: `synthetic-hop-tx-${parent.id}-${index}`,
      candidateTxHash: `synthetic-candidate-tx-${parent.id}-${index}`
    };
  });
}

function strandedCase(
  id: StrandedParentRuntimeCase["id"],
  label: StrandedParentRuntimeCase["label"],
  waitCount: number
): StrandedParentRuntimeCase {
  const parent = remediationParent(id);
  return {
    id,
    label,
    parent,
    waits: remediationWaits(parent, Array.from({ length: waitCount }, () => "ready"))
  };
}

export const STRANDED_PARENT_RUNTIME_CASES: StrandedParentRuntimeCase[] = [
  strandedCase("tdea-163", "TDEA 163/163", 163),
  strandedCase("tdea-repeat-104", "TDEA repeat 104/104", 104),
  strandedCase("tyd-216", "TYD 216/216", 216)
];
