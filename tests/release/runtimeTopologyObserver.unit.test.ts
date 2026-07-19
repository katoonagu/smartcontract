import { describe, expect, it } from "vitest";
import {
  TASK0B_RUNTIME_ENTRYPOINT_PROCESS_PATTERN_V2,
  parseTask0BManagedRuntimeCommand
} from "../../scripts/captureTask0BPreflight";

const SHA = "a".repeat(40);

describe("runtime topology process selection", () => {
  it.each([
    String.raw`node "C:\release\src\index.ts" --task0b-runtime-sha=${SHA} --task0b-runtime-label=master-${SHA.slice(0, 8)} --task0b-manager-producer=task0b_repo_runtime_manager_v1`,
    `node "/release/src/index.ts" --task0b-runtime-sha=${SHA} --task0b-runtime-label=master-${SHA.slice(0, 8)} --task0b-manager-producer=task0b_repo_runtime_manager_v1`
  ])("selects and parses Windows and forward-slash managed entrypoints", (commandLine) => {
    expect(new RegExp(TASK0B_RUNTIME_ENTRYPOINT_PROCESS_PATTERN_V2, "iu").test(commandLine)).toBe(true);
    expect(parseTask0BManagedRuntimeCommand(commandLine)).toMatchObject({
      runtimeSha: SHA,
      runtimeLabel: `master-${SHA.slice(0, 8)}`
    });
  });

  it("does not treat an unrelated node process as an empty managed topology", () => {
    const unrelated = "node C:\\service\\worker.js";
    expect(new RegExp(TASK0B_RUNTIME_ENTRYPOINT_PROCESS_PATTERN_V2, "iu").test(unrelated)).toBe(false);
  });
});
