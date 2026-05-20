import { describe, expect, it } from "vitest";
import { classifyInput, isLikelyTronAddress, isLikelyTronTxHash } from "../../src/tron/address";

describe("tron input helpers", () => {
  it("accepts base58 TRON addresses that start with T", () => {
    expect(isLikelyTronAddress("TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d")).toBe(true);
  });

  it("rejects short or malformed addresses", () => {
    expect(isLikelyTronAddress("TDwx")).toBe(false);
    expect(isLikelyTronAddress("0x3c38a410a09539b9bdeea3e5723dbf68c2d282da")).toBe(false);
  });

  it("accepts 64 character transaction hashes", () => {
    expect(isLikelyTronTxHash("aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2")).toBe(true);
  });

  it("classifies address, transaction hash, and unknown input", () => {
    expect(classifyInput("TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d")).toEqual({
      kind: "tron_address",
      value: "TDwxGzHZh8fFTDiRAeu89UvtanhpA94s8d"
    });
    expect(classifyInput("aa4558ce94071f3e0e8d219034b652de005208b38132e54ff4143e555107b3d2").kind).toBe("tron_tx");
    expect(classifyInput("hello").kind).toBe("unknown");
  });
});
