import { assertTrustedArtifactRootPathV2 } from "../src/release/releaseRootWriterStore";
import { createProtectedProductionOperationAdaptersV2 } from "../src/release/productionOperationAdaptersV2";
import { executeProtectedProductionOperationV2 } from "../src/release/productionReleaseOrchestratorV2";
import type { ProductionOperationKindV2 } from "../src/release/remediationReleaseManifestV2";

export type ProductionCliDependenciesV2 = Readonly<{
  executeProtected?(input: { artifactRoot: string; operationKind: ProductionOperationKindV2 }):
    ReturnType<typeof executeProtectedProductionOperationV2>;
}>;

export async function runProductionOperationCliV2(
  args: string[],
  expectedKind: ProductionOperationKindV2,
  dependencies: ProductionCliDependenciesV2 = {}
) {
  if (args.length !== 1) throw new Error(`usage: release:production:${expectedKind}:execute <protected-artifact-root>`);
  if (dependencies.executeProtected) {
    return dependencies.executeProtected({ artifactRoot: args[0]!, operationKind: expectedKind });
  }
  const artifactRoot = assertTrustedArtifactRootPathV2(args[0]!);
  return executeProtectedProductionOperationV2({ artifactRoot, operationKind: expectedKind }, {
    adapters: createProtectedProductionOperationAdaptersV2(artifactRoot)
  });
}
