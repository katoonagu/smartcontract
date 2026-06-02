import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUNDLE_COVERAGE_THRESHOLD,
  DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW,
  DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD,
  DEFAULT_DRAIN_EPISODE_WINDOW_MS,
  DEFAULT_MAX_BUNDLE_FUNDERS
} from "../../src/forensics/provenanceTracingConfig";

describe("provenance tracing config", () => {
  it("keeps approved configurable defaults in one place", () => {
    expect(DEFAULT_BUNDLE_COVERAGE_THRESHOLD).toBe(0.8);
    expect(DEFAULT_MAX_BUNDLE_FUNDERS).toBe(3);
    expect(DEFAULT_CROSS_CHAIN_BRIDGE_AMOUNT_THRESHOLD_RAW).toBe("100000000000");
    expect(DEFAULT_CROSS_CHAIN_BRIDGE_EPISODE_SHARE_THRESHOLD).toBe(0.25);
    expect(DEFAULT_DRAIN_EPISODE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
