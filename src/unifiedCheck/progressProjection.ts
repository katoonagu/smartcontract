export type UnifiedProgressLifecycleV1 =
  | "RUNNING"
  | "WAITING_FOR_PROVIDER"
  | "BLOCKED_ADMIN"
  | "COMPLETED"
  | "FAILED_TECHNICAL";

export type UnifiedProgressPhaseV1 =
  | "direct_history"
  | "traversal_fetch"
  | "traversal_attribution"
  | "provider_wait"
  | "branch_analysis"
  | "finalization"
  | "completed"
  | "failed_technical";

export type UnifiedProgressInputV1 = {
  readonly lifecycle: UnifiedProgressLifecycleV1;
  readonly phase: UnifiedProgressPhaseV1;
  readonly provider: {
    readonly configuredSlots: number;
    readonly activeSlots: number;
    readonly coolingDownSlots: number;
    readonly requests: number;
    readonly measurementWindowMs: number;
    readonly keyGroups: readonly {
      readonly id: string;
      readonly requests: number;
      readonly inFlight: number;
      readonly status: "active" | "idle" | "cooldown";
    }[];
  };
  readonly traversal: {
    readonly discoveredOutstanding: number;
    readonly frontierExpanding: boolean;
    readonly frontierCount: number;
    readonly frontierPeak: number;
    readonly uniqueAddresses: number;
    readonly fundingEpisodes: number;
  };
  readonly storage: {
    readonly checkpointBytes: number;
    readonly deltaArtifactBytes: number;
  };
  readonly reuse: {
    readonly networkFetches: number;
    readonly providerCacheHits: number;
    readonly manifestReuses: number;
    readonly replayAvoided: number;
  };
};

export type UnifiedProgressProjectionV1 = {
  readonly version: "unified-progress-projection-v1";
  readonly lifecycle: UnifiedProgressLifecycleV1;
  readonly phase: UnifiedProgressPhaseV1;
  readonly noScoreReason: string | null;
  readonly provider: {
    readonly configuredSlots: number;
    readonly activeSlots: number;
    readonly idleSlots: number;
    readonly coolingDownSlots: number;
    readonly requestsPerSecond: number;
    readonly keyGroups: readonly {
      readonly id: string;
      readonly requests: number;
      readonly inFlight: number;
      readonly status: "active" | "idle" | "cooldown";
    }[];
  };
  readonly remaining: {
    readonly discoveredExact: number;
    readonly totalKnown: boolean;
    readonly undiscoveredLowerBound: 0;
  };
  readonly reuse: UnifiedProgressInputV1["reuse"];
  readonly traversal: {
    readonly frontier: number;
    readonly frontierPeak: number;
    readonly uniqueAddresses: number;
    readonly fundingEpisodes: number;
  };
  readonly storage: UnifiedProgressInputV1["storage"];
};

function count(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(code);
  return value;
}

function noScoreReason(
  lifecycle: UnifiedProgressLifecycleV1,
  phase: UnifiedProgressPhaseV1
): string | null {
  if (lifecycle === "COMPLETED") return null;
  if (lifecycle === "FAILED_TECHNICAL") {
    return "Analysis ended with a technical failure; no risk score was created.";
  }
  if (lifecycle === "WAITING_FOR_PROVIDER") {
    return "Analysis is waiting for provider recovery; no risk score exists yet.";
  }
  if (lifecycle === "BLOCKED_ADMIN") {
    return "Analysis requires an Admin decision; no risk score exists yet.";
  }
  return `Analysis is still in ${phase}; final score is created only after all required evidence children complete.`;
}

export function projectUnifiedProgress(
  input: UnifiedProgressInputV1
): UnifiedProgressProjectionV1 {
  const configuredSlots = count(
    input.provider.configuredSlots,
    "unified_progress_slots_invalid"
  );
  if (configuredSlots < 1) {
    throw new TypeError("unified_progress_slots_invalid");
  }
  const activeSlots = count(
    input.provider.activeSlots,
    "unified_progress_active_slots_invalid"
  );
  const coolingDownSlots = count(
    input.provider.coolingDownSlots,
    "unified_progress_cooldown_slots_invalid"
  );
  if (activeSlots + coolingDownSlots > configuredSlots) {
    throw new TypeError("unified_progress_slot_totals_invalid");
  }
  const requests = count(
    input.provider.requests,
    "unified_progress_requests_invalid"
  );
  const windowMs = count(
    input.provider.measurementWindowMs,
    "unified_progress_window_invalid"
  );
  if (windowMs < 1) throw new TypeError("unified_progress_window_invalid");

  const keyGroups = [...input.provider.keyGroups]
    .map((group) => ({
      id: group.id,
      requests: count(
        group.requests,
        "unified_progress_group_requests_invalid"
      ),
      inFlight: count(
        group.inFlight,
        "unified_progress_group_inflight_invalid"
      ),
      status: group.status
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (keyGroups.some((group) => group.id.trim().length === 0)) {
    throw new TypeError("unified_progress_group_id_invalid");
  }

  const discoveredExact = count(
    input.traversal.discoveredOutstanding,
    "unified_progress_outstanding_invalid"
  );
  const frontier = count(
    input.traversal.frontierCount,
    "unified_progress_frontier_invalid"
  );
  const frontierPeak = count(
    input.traversal.frontierPeak,
    "unified_progress_frontier_peak_invalid"
  );
  if (frontier > frontierPeak) {
    throw new TypeError("unified_progress_frontier_peak_invalid");
  }

  return {
    version: "unified-progress-projection-v1",
    lifecycle: input.lifecycle,
    phase: input.phase,
    noScoreReason: noScoreReason(input.lifecycle, input.phase),
    provider: {
      configuredSlots,
      activeSlots,
      idleSlots: configuredSlots - activeSlots - coolingDownSlots,
      coolingDownSlots,
      requestsPerSecond: requests / (windowMs / 1_000),
      keyGroups
    },
    remaining: {
      discoveredExact,
      totalKnown: !input.traversal.frontierExpanding,
      undiscoveredLowerBound: 0
    },
    reuse: {
      networkFetches: count(
        input.reuse.networkFetches,
        "unified_progress_network_fetches_invalid"
      ),
      providerCacheHits: count(
        input.reuse.providerCacheHits,
        "unified_progress_cache_hits_invalid"
      ),
      manifestReuses: count(
        input.reuse.manifestReuses,
        "unified_progress_manifest_reuses_invalid"
      ),
      replayAvoided: count(
        input.reuse.replayAvoided,
        "unified_progress_replay_avoided_invalid"
      )
    },
    traversal: {
      frontier,
      frontierPeak,
      uniqueAddresses: count(
        input.traversal.uniqueAddresses,
        "unified_progress_addresses_invalid"
      ),
      fundingEpisodes: count(
        input.traversal.fundingEpisodes,
        "unified_progress_episodes_invalid"
      )
    },
    storage: {
      checkpointBytes: count(
        input.storage.checkpointBytes,
        "unified_progress_checkpoint_bytes_invalid"
      ),
      deltaArtifactBytes: count(
        input.storage.deltaArtifactBytes,
        "unified_progress_delta_bytes_invalid"
      )
    }
  };
}
