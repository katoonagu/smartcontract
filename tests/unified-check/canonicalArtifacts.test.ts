import { describe, expect, it } from "vitest";
import {
  fingerprintCanonicalArtifact,
  fingerprintCanonicalJson
} from "../../src/forensics/canonicalJson";

describe("Unified artifact canonical hashing", () => {
  it("keeps Telegram limits separate from dense forensic artifacts", () => {
    const dense = {
      facts: Array.from({ length: 20_000 }, (_, index) => ({
        id: index,
        value: `fact-${index}`
      }))
    };
    expect(() => fingerprintCanonicalJson(dense)).toThrow(
      "Canonical JSON exceeds node limit"
    );
    expect(fingerprintCanonicalArtifact(dense)).toMatch(/^[0-9a-f]{64}$/u);
  });
});
