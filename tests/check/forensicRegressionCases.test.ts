import { describe, expect, it } from "vitest";
import { regressionCases } from "../fixtures/forensics/regressionCases";

describe("forensic regression corpus", () => {
  it("contains the minimum architecture regression cases", () => {
    expect(regressionCases.map((item) => item.name)).toEqual([
      "Binance through clean EOA is acceptable",
      "HTX through clean EOA is high policy decline",
      "WhiteBIT small share is medium policy decline",
      "Unknown contract boundary is policy decline not scam proof",
      "Known DEX router approval with output is guarded, not drainer proof",
      "Wrapper transferFrom path to checked wallet is exact approval-drain decline",
      "LLM timeout on uncertain contract is user decline with no cache",
      "Fingerprint clone with different flow does not reuse drainer verdict"
    ]);
  });
});
