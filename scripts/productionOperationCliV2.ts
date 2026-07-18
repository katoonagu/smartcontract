import { readFileSync } from "node:fs";
import { safeArtifactPath } from "../src/release/releaseRootWriterStore";
import { executeProductionOperationV2 } from "../src/release/productionReleaseOrchestratorV2";

export type ProductionCliDependenciesV2 = Parameters<typeof executeProductionOperationV2>[1];

export async function runProductionOperationCliV2(
  args: string[],
  expectedKind: "rollout" | "canary" | "rollback" | "recovery",
  dependencies?: ProductionCliDependenciesV2
) {
  if (args.length !== 1) throw new Error(`usage: release:production:${expectedKind}:execute <protected-artifact-root>`);
  if (dependencies === undefined) throw new Error("production_operation_adapters_unconfigured");
  const bytes = readFileSync(safeArtifactPath(args[0], `production-${expectedKind}-input-v2.json`));
  const input = JSON.parse(bytes.toString("utf8"));
  if (input.operation?.kind !== expectedKind) throw new Error("production_operation_kind_mismatch");
  return executeProductionOperationV2(input, dependencies);
}
