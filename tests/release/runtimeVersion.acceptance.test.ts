import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  RUNTIME_LABEL,
  SCHEMA_032_CHECKSUM,
  buildRuntimeVersion,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type RuntimeVersion = ReturnType<typeof buildRuntimeVersion>;
type RuntimeApi = {
  buildRuntimeVersion(input: {
    gitCommitSha: string | undefined;
    runtimeInstanceLabel: string | undefined;
    migration: RuntimeVersion["migration"];
  }): RuntimeVersion;
  formatRuntimeVersion(value: RuntimeVersion, locale: "ru" | "en"): string;
  validateRuntimeVersion(value: unknown, candidateSha: string): RuntimeVersion;
};

async function loadRuntimeApi(): Promise<RuntimeApi> {
  const modulePath: string = "../../src/runtime/runtimeVersion";
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<RuntimeApi>;
    if (
      typeof loaded.buildRuntimeVersion !== "function" ||
      typeof loaded.formatRuntimeVersion !== "function" ||
      typeof loaded.validateRuntimeVersion !== "function"
    ) {
      throw new Error("runtime version exports missing");
    }
    return loaded as RuntimeApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: verified runtime version", { cause: error });
  }
}

it("[REQ-38][RELEASE-VERSION] requires exact candidate policy result narrative and verified schema identity", async () => {
  const api = await loadRuntimeApi();
  const valid = buildRuntimeVersion();
  expect(() => api.validateRuntimeVersion(valid, CANDIDATE_SHA)).not.toThrow();
  const invalid = [
    (value: any) => { value.extra = true; },
    (value: any) => { value.version = "runtime-version-v0"; },
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

it("[REQ-38][RUNTIME-BUILD] builds only the exact immutable contract from verified schema output", async () => {
  const api = await loadRuntimeApi();
  const migration = buildRuntimeVersion().migration;

  const runtimeVersion = api.buildRuntimeVersion({
    gitCommitSha: CANDIDATE_SHA,
    runtimeInstanceLabel: RUNTIME_LABEL,
    migration
  });

  expect(runtimeVersion).toEqual(buildRuntimeVersion());
  expect(runtimeVersion.migration).toEqual(migration);
  expect(Object.isFrozen(runtimeVersion)).toBe(true);
  expect(Object.isFrozen(runtimeVersion.migration)).toBe(true);
  expect(api.validateRuntimeVersion(runtimeVersion, CANDIDATE_SHA)).toBe(runtimeVersion);
  expect(() => { (runtimeVersion as any).gitCommitSha = "f".repeat(40); }).toThrow();
  expect(() => { (runtimeVersion.migration as any).verified = false; }).toThrow();
});

it("[REQ-38][RUNTIME-IDENTITY] rejects missing malformed mismatched control-bearing or secret-bearing identity", async () => {
  const api = await loadRuntimeApi();
  const migration = buildRuntimeVersion().migration;
  const invalidIdentity = [
    { gitCommitSha: undefined, runtimeInstanceLabel: RUNTIME_LABEL },
    { gitCommitSha: CANDIDATE_SHA.toUpperCase(), runtimeInstanceLabel: RUNTIME_LABEL },
    { gitCommitSha: CANDIDATE_SHA.slice(0, 39), runtimeInstanceLabel: RUNTIME_LABEL },
    { gitCommitSha: CANDIDATE_SHA, runtimeInstanceLabel: undefined },
    { gitCommitSha: CANDIDATE_SHA, runtimeInstanceLabel: "candidate" },
    { gitCommitSha: CANDIDATE_SHA, runtimeInstanceLabel: `candidate-x${CANDIDATE_SHA.slice(0, 8)}y` },
    { gitCommitSha: CANDIDATE_SHA, runtimeInstanceLabel: `candidate-${CANDIDATE_SHA.slice(0, 8)}\nworker` },
    { gitCommitSha: CANDIDATE_SHA, runtimeInstanceLabel: `candidate-${CANDIDATE_SHA.slice(0, 8)}-password-secret` }
  ];

  for (const identity of invalidIdentity) {
    expect(() => api.buildRuntimeVersion({ ...identity, migration })).toThrow();
  }
});

it("[REQ-32][RUNTIME-VERSION] renders exact pure RU and EN version output", async () => {
  const api = await loadRuntimeApi();
  const runtimeVersion = api.buildRuntimeVersion({
    gitCommitSha: CANDIDATE_SHA,
    runtimeInstanceLabel: RUNTIME_LABEL,
    migration: buildRuntimeVersion().migration
  });

  expect(api.formatRuntimeVersion(runtimeVersion, "en")).toBe([
    "Runtime version",
    `Git SHA: ${CANDIDATE_SHA}`,
    `Instance: ${RUNTIME_LABEL}`,
    "Scoring policy: scoring-signal-matrix-v3",
    "Result schema: score-anchor-v2+forensic-coverage-v2",
    "Narrative: telegram-forensic-result-v1",
    `Database schema: schema 032 verified · ${SCHEMA_032_CHECKSUM.slice(0, 12)}`
  ].join("\n"));
  expect(api.formatRuntimeVersion(runtimeVersion, "ru")).toBe([
    "Версия runtime",
    `Git SHA: ${CANDIDATE_SHA}`,
    `Инстанс: ${RUNTIME_LABEL}`,
    "Политика скоринга: scoring-signal-matrix-v3",
    "Схема результата: score-anchor-v2+forensic-coverage-v2",
    "Версия объяснения: telegram-forensic-result-v1",
    `Схема БД: schema 032 verified · ${SCHEMA_032_CHECKSUM.slice(0, 12)}`
  ].join("\n"));
  expect(api.formatRuntimeVersion(runtimeVersion, "en")).toBe(api.formatRuntimeVersion(runtimeVersion, "en"));
});
