import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("isolated Unified worker mode", () => {
  it("processes only canaries without legacy schedules, bot polling, or delivery", () => {
    const source = readFileSync("src/index.ts", "utf8");

    expect(source).toContain(
      'runPurpose: config.unifiedIsolatedWorkerOnly ? "release_canary" : undefined'
    );
    expect(source).toContain(
      "startBackgroundWorkSchedule({ unifiedOnly: true })"
    );
    expect(source).toContain("if (config.unifiedIsolatedWorkerOnly)");
    expect(source).toContain("!config.unifiedIsolatedWorkerOnly &&");
  });
});
