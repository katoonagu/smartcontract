import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  GATE_COMMAND_IDS,
  PRE_RELEASE_GATE_IDS,
  REQUIRED_SUITE_GROUPS,
  buildReleaseManifest,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type ManifestApi = {
  REMEDIATION_REQUIRED_SUITE_GROUPS: unknown;
  validateRemediationReleaseManifest(value: unknown): unknown;
};

async function loadManifestApi(): Promise<ManifestApi> {
  const modulePath: string = "../../src/release/remediationReleaseManifest";
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<ManifestApi>;
    if (typeof loaded.validateRemediationReleaseManifest !== "function") throw new Error("validator export missing");
    return loaded as ManifestApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: remediation release manifest validator", { cause: error });
  }
}

it("[AC-41] validates the release regression manifest and required suite set", async () => {
  const api = await loadManifestApi();
  expect(api.REMEDIATION_REQUIRED_SUITE_GROUPS).toEqual(REQUIRED_SUITE_GROUPS);
  expect(() => api.validateRemediationReleaseManifest(buildReleaseManifest())).not.toThrow();
});

it("[REQ-38][RELEASE-MANIFEST] rejects missing pending failed foreign-SHA or unhashed gate artifacts", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  const invalid = [
    (manifest: any) => { manifest.gates.splice(7, 1); },
    (manifest: any) => { manifest.gates[7].state = "pending"; },
    (manifest: any) => { manifest.gates[7].state = "failed"; manifest.gates[7].exitCode = 1; },
    (manifest: any) => { manifest.gates[7].candidateSha = "f".repeat(40); },
    (manifest: any) => { manifest.gates[7].outputSha256 = "unhashed"; },
    (manifest: any) => { manifest.gates[7].redactedTemplateSha256 = "unhashed"; }
  ];
  for (const mutate of invalid) {
    const manifest: any = cloneFixture(buildReleaseManifest());
    mutate(manifest);
    expect(() => validate(manifest)).toThrow();
  }
});

it("[REQ-38][RELEASE-PHASES] derives ready only from G00-G11 and released only from G00-G15", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  expect(() => validate(buildReleaseManifest("ready_for_release"))).not.toThrow();
  expect(() => validate(buildReleaseManifest("released"))).not.toThrow();

  const prematureReady: any = cloneFixture(buildReleaseManifest("ready_for_release"));
  prematureReady.gates[11].state = "pending";
  expect(() => validate(prematureReady)).toThrow();

  const prematureRelease: any = cloneFixture(buildReleaseManifest("released"));
  prematureRelease.gates[15].state = "pending";
  expect(() => validate(prematureRelease)).toThrow();

  const notReady: any = cloneFixture(prematureReady);
  notReady.overall = "not_ready";
  expect(() => validate(notReady)).not.toThrow();
});

it("[REQ-38][RELEASE-SECRETS] rejects secret-like values in every artifact field", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  const probes: Array<[string, string]> = [
    ["id", "BOT_TOKEN=123456789:AAExampleTokenValue"],
    ["candidateSha", "TRONSCAN_API_KEY=example-secret-value"],
    ["commandId", "chat_id=123456789"],
    ["redactedTemplateSha256", "postgresql://release:secret@127.0.0.1/db"],
    ["startedAt", "DATABASE_URL=postgresql://user:secret@host/db"],
    ["finishedAt", "API_TOKEN=example-secret-value"],
    ["outputSha256", "TELEGRAM_BOT_TOKEN=123456789:AAExampleTokenValue"],
    ["state", "user_id=987654321"]
  ];
  for (const [field, secret] of probes) {
    const manifest: any = cloneFixture(buildReleaseManifest());
    manifest.gates[0][field] = secret;
    expect(() => validate(manifest), field).toThrow(/secret/i);
  }
  const nested: any = cloneFixture(buildReleaseManifest());
  nested.gates[0].diagnostic = { nested: { botToken: "123456789:AAExampleTokenValue" } };
  expect(() => validate(nested)).toThrow(/secret/i);
});

it("[REQ-35][REQ-36][PLAN5-RUNTIME] requires startup delivery and worker gates before ready_for_release", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  for (const gateId of ["G04_RUNTIME", "G08_VERSION_SANITIZED", "G10_ROLLBACK_REHEARSAL"]) {
    const manifest: any = cloneFixture(buildReleaseManifest());
    const gate = manifest.gates.find((item: any) => item.id === gateId);
    gate.state = "pending";
    expect(() => validate(manifest), gateId).toThrow();
  }
});

it("[G11][ADDRESS-POISONING] requires unchanged regression and excludes closeout from release readiness", async () => {
  const { validateRemediationReleaseManifest: validate } = await loadManifestApi();
  const missingRegression: any = cloneFixture(buildReleaseManifest());
  const gate = missingRegression.gates.find((item: any) => item.id === PRE_RELEASE_GATE_IDS[11]);
  gate.commandId = GATE_COMMAND_IDS.G10_ROLLBACK_REHEARSAL;
  expect(() => validate(missingRegression)).toThrow();

  const closeoutSubstitution: any = cloneFixture(buildReleaseManifest());
  closeoutSubstitution.gates = closeoutSubstitution.gates.filter((item: any) => item.id !== "G11_POISONING_REGRESSION");
  closeoutSubstitution.gates.push({ ...closeoutSubstitution.gates[0], id: "APC-01", candidateSha: CANDIDATE_SHA });
  expect(() => validate(closeoutSubstitution)).toThrow();
});
