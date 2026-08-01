import type { UnifiedTraversalPolicyVersion } from "./contracts";
import {
  buildProductionFrozenLabelDataset,
  type FrozenLabelDatasetV1,
  type LegacyFrozenLabelRowV1
} from "./frozenLabels";
import {
  TRONSCAN_CEX_TAG_MATCHER_VERSION,
  decideTronScanProviderServiceAssertion,
  type AcceptedProviderServiceAssertionV1,
  type ProviderServiceAssertionRejectionV1,
  type ProviderServiceMetadataV1
} from "./providerServiceBindings";

export type ProviderServiceFreezeDiagnosticV1 = {
  readonly version: "unified-provider-service-freeze-diagnostic-v1";
  readonly traversalPolicyVersion: UnifiedTraversalPolicyVersion;
  readonly matcherVersion: typeof TRONSCAN_CEX_TAG_MATCHER_VERSION;
  readonly candidates: number;
  readonly accepted: number;
  readonly rejectedByReason: Readonly<Partial<Record<
    ProviderServiceAssertionRejectionV1,
    number
  >>>;
};

export function createProductionLabelDatasetFreezer(input: {
  readonly traversalPolicyVersion: UnifiedTraversalPolicyVersion;
  readonly legacyRows: readonly LegacyFrozenLabelRowV1[];
  readonly loadFreshProviderMetadata: (
    frozenAt: Date
  ) => Promise<readonly ProviderServiceMetadataV1[]>;
  readonly observe?: (diagnostic: ProviderServiceFreezeDiagnosticV1) => void;
}): (freeze: {
  readonly snapshotHash: string;
  readonly frozenAt: string;
}) => Promise<{
  readonly dataset: FrozenLabelDatasetV1;
  readonly sha256: string;
}> {
  return async (freeze) => {
    if (input.traversalPolicyVersion === "snapshot-closure-v1") {
      return buildProductionFrozenLabelDataset({
        ...freeze,
        legacyRows: input.legacyRows
      });
    }

    const frozenAt = new Date(freeze.frozenAt);
    if (
      !Number.isFinite(frozenAt.getTime()) ||
      frozenAt.toISOString() !== freeze.frozenAt
    ) {
      throw new TypeError("unified_provider_service_freeze_time_invalid");
    }

    const metadata = await input.loadFreshProviderMetadata(frozenAt);
    const providerAssertions: AcceptedProviderServiceAssertionV1[] = [];
    const rejectedByReason: Partial<Record<
      ProviderServiceAssertionRejectionV1,
      number
    >> = {};
    for (const candidate of metadata) {
      const decision = decideTronScanProviderServiceAssertion({
        metadata: candidate,
        frozenAt: freeze.frozenAt
      });
      if (decision.accepted) {
        providerAssertions.push(decision);
      } else {
        rejectedByReason[decision.reason] =
          (rejectedByReason[decision.reason] ?? 0) + 1;
      }
    }

    const diagnostic: ProviderServiceFreezeDiagnosticV1 = Object.freeze({
      version: "unified-provider-service-freeze-diagnostic-v1",
      traversalPolicyVersion: input.traversalPolicyVersion,
      matcherVersion: TRONSCAN_CEX_TAG_MATCHER_VERSION,
      candidates: metadata.length,
      accepted: providerAssertions.length,
      rejectedByReason: Object.freeze(rejectedByReason)
    });
    input.observe?.(diagnostic);

    return buildProductionFrozenLabelDataset({
      ...freeze,
      legacyRows: input.legacyRows,
      providerAssertions
    });
  };
}
