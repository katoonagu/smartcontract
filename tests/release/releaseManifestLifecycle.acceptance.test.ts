import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { operationalAttestationTemplateSha256V2 } from "../../src/release/remediationReleaseManifestV2";
import {
  CANDIDATE_SHA,
  RELEASE_V2_FREEZE_IDENTITY,
  buildExecutedReleaseGateV2Fixture,
  buildOperationalAttestationV2Fixture,
  buildReleaseManifestV2Fixture,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function manifestSha(value: unknown): string {
  return createHash("sha256").update(`${canonical(value)}\n`, "utf8").digest("hex");
}

async function loadLifecycleApi(): Promise<any> {
  const modulePath: string = "../../src/release/remediationReleaseManifestV2";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch (error) {
    throw new Error("Plan 5 feature missing: manifest v2 lifecycle", { cause: error });
  }
}

it("[REQ-38][MANIFEST-V2-INIT] creates pre-manual revision one only from absent with G00-G04 and G06-G11 passed G05 manual pending and G12-G15 pending", async () => {
  const api = await loadLifecycleApi();
  const manifest = api.createInitialRemediationReleaseManifestV2({
    freezeIdentity: RELEASE_V2_FREEZE_IDENTITY,
    evaluatedAt: "2026-07-18T10:00:00.000Z",
    latestCommittedReceiptSha256: buildReleaseManifestV2Fixture().latestCommittedReceiptSha256,
    verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate: any) => gate.state === "passed")
  });
  expect(manifest).toMatchObject({ version: "remediation-release-manifest-v2", revision: 1, transitionId: "pre_manual" });
  expect(manifest.gates.filter((gate: any) => gate.state === "pending").map((gate: any) => gate.id)).toEqual([
    "G05_TELEGRAM", "G12_PRODUCTION_BACKUP", "G13_PRODUCTION_MIGRATION", "G14_PRODUCTION_ROLLOUT", "G15_PRODUCTION_CANARY"
  ]);
  expect(() => api.createInitialRemediationReleaseManifestV2({
    freezeIdentity: RELEASE_V2_FREEZE_IDENTITY,
    sourceManifest: buildReleaseManifestV2Fixture(),
    evaluatedAt: "2026-07-18T10:00:00.000Z",
    latestCommittedReceiptSha256: buildReleaseManifestV2Fixture().latestCommittedReceiptSha256
  })).toThrow();
});

it("[REQ-38][MANIFEST-V2-TRANSITIONS] accepts only absent to pre-manual to readiness to G12 to G13 to G14 to G15", async () => {
  const api = await loadLifecycleApi();
  const ordered = ["readiness", "g12_backup_passed", "g13_migration_passed", "g14_rollout_passed", "g15_canary_released"];
  const transitionGate: Record<string, string> = { readiness: "G05_TELEGRAM", g12_backup_passed: "G12_PRODUCTION_BACKUP", g13_migration_passed: "G13_PRODUCTION_MIGRATION", g14_rollout_passed: "G14_PRODUCTION_ROLLOUT", g15_canary_released: "G15_PRODUCTION_CANARY" };
  const transitionCommand: Record<string, string> = { g12_backup_passed: "production_backup", g13_migration_passed: "production_migration", g14_rollout_passed: "production_rollout", g15_canary_released: "production_canary" };
  let manifest = buildReleaseManifestV2Fixture();
  for (const transitionId of ordered) {
    manifest = api.reduceRemediationReleaseManifestV2(manifest, {
      transitionId, evaluatedAt: "2026-07-18T10:01:00.000Z",
      latestCommittedReceiptSha256: createHash("sha256").update(`receipt:${transitionId}`).digest("hex"),
      operationalAttestation: transitionId === "readiness" ? null : buildOperationalAttestationV2Fixture({
        action: transitionId,
        commandId: transitionCommand[transitionId],
        redactedTemplateSha256: operationalAttestationTemplateSha256V2(
          transitionId as Parameters<typeof operationalAttestationTemplateSha256V2>[0]
        ),
        sourceManifestSha256: manifestSha(manifest),
        issuedAt: "2026-07-18T10:00:30.000Z",
        expiresAt: "2026-07-18T10:15:00.000Z"
      })
    }, [buildExecutedReleaseGateV2Fixture(transitionGate[transitionId] as any)], {
      refs: [], actualRollbackOutcome: null
    });
  }
  expect(manifest.transitionId).toBe("g15_canary_released");
  expect(() => api.reduceRemediationReleaseManifestV2(buildReleaseManifestV2Fixture(), {
    transitionId: "g13_migration_passed", evaluatedAt: "2026-07-18T10:01:00.000Z",
    latestCommittedReceiptSha256: "d".repeat(64), operationalAttestation: null
  }, [buildExecutedReleaseGateV2Fixture("G13_PRODUCTION_MIGRATION")], {
    refs: [], actualRollbackOutcome: null
  })).toThrow();
});

it("[REQ-38][MANIFEST-V2-PENDING] pending gates contain no invented execution fields", async () => {
  const api = await loadLifecycleApi();
  const valid = buildReleaseManifestV2Fixture();
  expect(() => api.validateRemediationReleaseManifestV2(valid)).not.toThrow();
  const invalid: any = cloneFixture(valid);
  Object.assign(invalid.gates.find((gate: any) => gate.state === "pending"), { exitCode: 0, outputSha256: "a".repeat(64) });
  expect(() => api.validateRemediationReleaseManifestV2(invalid)).toThrow();
});

it("[REQ-38][MANIFEST-V2-BLOCKED] blocked gates contain only blocker and exact failure evidence without execution fields", async () => {
  const api = await loadLifecycleApi();
  const blocked = {
    id: "G14_PRODUCTION_ROLLOUT", candidateSha: CANDIDATE_SHA, state: "blocked",
    blockedByGateId: "G13_PRODUCTION_MIGRATION",
    productionFailureEvidence: {
      kind: "production_failure_evidence", relativePath: "production-failure-evidence-v2.json",
      sha256: "b".repeat(64), schemaVersion: "production-failure-evidence-v2",
      candidateSha: CANDIDATE_SHA, sourceManifestSha256: "c".repeat(64)
    }
  };
  expect(() => api.validateReleaseGateV2(blocked)).not.toThrow();
  expect(() => api.validateReleaseGateV2({ ...blocked, startedAt: "2026-07-18T10:00:00.000Z" })).toThrow();
});

it("[REQ-38][MANIFEST-V2-FREEZE] separates chain-stable freeze identity from fresh action attestations", async () => {
  const api = await loadLifecycleApi();
  const first = buildOperationalAttestationV2Fixture();
  const second = buildOperationalAttestationV2Fixture({
    action: "readiness", sourceManifestSha256: "d".repeat(64), previousAttestationSha256: "e".repeat(64),
    issuedAt: "2026-07-18T10:05:00.000Z", expiresAt: "2026-07-18T10:20:00.000Z"
  });
  expect(() => api.validateReleaseFreezeIdentityV2(RELEASE_V2_FREEZE_IDENTITY)).not.toThrow();
  expect(() => api.validateOperationalAttestationV2(first, RELEASE_V2_FREEZE_IDENTITY)).not.toThrow();
  expect(() => api.validateOperationalAttestationV2(second, RELEASE_V2_FREEZE_IDENTITY)).not.toThrow();
  expect(first.releaseFreezeIdentitySha256).toBe(second.releaseFreezeIdentitySha256);
  expect(first.sourceManifestSha256).not.toBe(second.sourceManifestSha256);
});

it("[REQ-38][MANIFEST-V2-EVIDENCE] semantically binds every G00-G15 policy to actual bytes", async () => {
  const api = await loadLifecycleApi();
  const manifest = buildReleaseManifestV2Fixture();
  const bytes = new Map<string, Buffer>();
  for (const gate of manifest.gates) for (const ref of gate.evidence ?? []) bytes.set(ref.relativePath, Buffer.from("bound"));
  expect(() => api.validateManifestGateEvidenceV2(manifest, bytes)).toThrow();
});

it("[REQ-38][MANIFEST-V2-FORGED] rejects a structurally valid hand-written manifest and gate output", async () => {
  const api = await loadLifecycleApi();
  const forged: any = cloneFixture(buildReleaseManifestV2Fixture());
  forged.gates[0].outputSha256 = "f".repeat(64);
  expect(() => api.validateManifestGateEvidenceV2(forged, new Map())).toThrow();
});

it("[REQ-38][MANIFEST-V2-VERIFY-READONLY] verifier leaves every artifact byte-identical", async () => {
  const api = await loadLifecycleApi();
  const artifacts = new Map([["release-manifest-v2.json", Buffer.from(JSON.stringify(buildReleaseManifestV2Fixture()))]]);
  const before = Buffer.from(artifacts.get("release-manifest-v2.json")!);
  await expect(api.verifyRemediationReleaseArtifactsV2(artifacts)).rejects.toThrow();
  expect(artifacts.get("release-manifest-v2.json")).toEqual(before);
});

it("[REQ-38][PRODUCTION-MUTATOR-V2] rejects V1 structural or V2 manifest without current transition receipt and root binding", async () => {
  const api = await loadLifecycleApi();
  expect(() => api.assertProductionMutatorAuthorityV2({ version: "remediation-release-manifest-v1" })).toThrow();
  expect(() => api.assertProductionMutatorAuthorityV2(buildReleaseManifestV2Fixture())).toThrow();
});
