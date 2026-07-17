import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  PREVIOUS_RUNTIME_SHA,
  SANITIZED_DATABASE_FINGERPRINT,
  buildRollbackRehearsalEvidence,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type RollbackApi = {
  validateRollbackRehearsalEvidence(value: unknown, expected: {
    candidateSha: string;
    previousRuntimeSha: string;
    sanitizedDatabaseFingerprintSha256: string;
  }): unknown;
};

it("[REQ-35][REQ-38][ROLLBACK-REHEARSAL] requires the exact previous SHA to run safely on migrated sanitized schema 032", async () => {
  const modulePath: string = "../../scripts/rehearseRemediationRuntime";
  let api: RollbackApi;
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<RollbackApi>;
    if (typeof loaded.validateRollbackRehearsalEvidence !== "function") throw new Error("validator export missing");
    api = loaded as RollbackApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: rollback rehearsal validator", { cause: error });
  }
  const expected = {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    sanitizedDatabaseFingerprintSha256: SANITIZED_DATABASE_FINGERPRINT
  };
  const valid = buildRollbackRehearsalEvidence();
  expect(() => api.validateRollbackRehearsalEvidence(valid, expected)).not.toThrow();
  const invalid = [
    (value: any) => { value.previousRuntimeSha = "f".repeat(40); },
    (value: any) => { value.migratedSanitizedDatabaseFingerprintSha256 = "f".repeat(64); },
    (value: any) => { value.schemaVerification.verified = false; },
    (value: any) => { value.schemaVerification.version = 31; },
    (value: any) => { value.telegramTransport = "live"; },
    (value: any) => { value.outboundSendCount = 1; },
    (value: any) => { value.previousRuntimeStarted = false; },
    (value: any) => { value.adminHealthStatus = 503; },
    (value: any) => { value.runtimeInstanceCount = 2; },
    (value: any) => { value.workerScheduleCount = 2; },
    (value: any) => { value.observedPreviousVersionSha = "f".repeat(40); },
    (value: any) => { value.conservativeAllowanceMirrorsVerified = false; },
    (value: any) => { value.terminalLegacyPopulationAfter.populationCount += 1; },
    (value: any) => { value.completedResultsSha256After = "f".repeat(64); },
    (value: any) => { value.sentFingerprintSetSha256After = "f".repeat(64); },
    (value: any) => { value.remainingProcessCount = 1; },
    (value: any) => { value.remainingAdvisoryLockCount = 1; }
  ];
  for (const mutate of invalid) {
    const value: any = cloneFixture(valid);
    mutate(value);
    expect(() => api.validateRollbackRehearsalEvidence(value, expected)).toThrow();
  }
});
