import { expect, it } from "vitest";
import { buildTerminalLegacyPopulation, cloneFixture } from "../fixtures/release/remediationReleaseFixtures";

type LegacyApi = { assertTerminalLegacyPopulationUnchanged(before: unknown, after: unknown): void };

it("[REQ-03][REQ-04][PLAN5-LEGACY] rejects changed count ID set result aggregate or sent fingerprints for the terminal legacy cutoff population", async () => {
  const modulePath: string = "../../src/release/terminalLegacyPopulation";
  let api: LegacyApi;
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<LegacyApi>;
    if (typeof loaded.assertTerminalLegacyPopulationUnchanged !== "function") throw new Error("validator export missing");
    api = loaded as LegacyApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: terminal legacy population guard", { cause: error });
  }
  const before = buildTerminalLegacyPopulation();
  expect(() => api.assertTerminalLegacyPopulationUnchanged(before, cloneFixture(before))).not.toThrow();
  for (const field of [
    "populationCount",
    "sortedJobIdSetSha256",
    "aggregateImmutableResultSha256",
    "sentFingerprintSetSha256"
  ]) {
    const after: any = cloneFixture(before);
    after[field] = field === "populationCount" ? after[field] + 1 : "f".repeat(64);
    expect(() => api.assertTerminalLegacyPopulationUnchanged(before, after), field).toThrow();
  }
});
