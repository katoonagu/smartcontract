import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  SCHEMA_032_CHECKSUM,
  buildRuntimeVersion,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type RuntimeApi = { validateRuntimeVersion(value: unknown, candidateSha: string): unknown };

it("[REQ-38][RELEASE-VERSION] requires exact candidate policy result narrative and verified schema identity", async () => {
  const modulePath: string = "../../src/runtime/runtimeVersion";
  let api: RuntimeApi;
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<RuntimeApi>;
    if (typeof loaded.validateRuntimeVersion !== "function") throw new Error("validator export missing");
    api = loaded as RuntimeApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: verified runtime version", { cause: error });
  }
  const valid = buildRuntimeVersion();
  expect(() => api.validateRuntimeVersion(valid, CANDIDATE_SHA)).not.toThrow();
  const invalid = [
    (value: any) => { value.gitCommitSha = "f".repeat(40); },
    (value: any) => { value.runtimeInstanceLabel = "candidate"; },
    (value: any) => { value.scoringPolicyVersion = "scoring-signal-matrix-v2"; },
    (value: any) => { value.resultSchemaVersion = "score-anchor-v2"; },
    (value: any) => { value.narrativeVersion = "legacy-narrative"; },
    (value: any) => { value.migration.verified = false; },
    (value: any) => { value.migration.version = 31; },
    (value: any) => { value.migration.filename = "031_address_poisoning_monitor.sql"; },
    (value: any) => { value.migration.checksumSha256 = "f".repeat(64); },
    (value: any) => { value.migration.shortChecksum = SCHEMA_032_CHECKSUM.slice(0, 11); }
  ];
  for (const mutate of invalid) {
    const value: any = cloneFixture(valid);
    mutate(value);
    expect(() => api.validateRuntimeVersion(value, CANDIDATE_SHA)).toThrow();
  }
});
