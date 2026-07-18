import { resolve } from "node:path"; import { pathToFileURL } from "node:url";
import { runProductionOperationCliV2, type ProductionCliDependenciesV2 } from "./productionOperationCliV2";
export const runExecuteProductionRollout = (args: string[], deps?: ProductionCliDependenciesV2) => runProductionOperationCliV2(args, "rollout", deps);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runExecuteProductionRollout(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
