import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("forensic wallet calibration rerun", () => {
  it("uses the shared selective resolver contract and no checker-local transaction delay", () => {
    const source = readFileSync("scripts/forensicWalletCalibrationRerun.ts", "utf8");
    expect(source).toContain("createSelectiveTransactionEnricher");
    expect(source).toContain("...calibrationWhereRuntime");
    expect(source).toContain("...calibrationWhereRunOptions(signal)");
    expect(source).not.toMatch(/contractTransactionInfoMinIntervalMs:\s*2_000/);
  });
});
