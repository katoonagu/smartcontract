import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { replayServiceRoleShadowGateV1 } from "../../src/forensics/serviceRoleShadowGate.js";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";

const corpus = JSON.parse(readFileSync(
  new URL("../fixtures/forensics/forensic-model-offline-corpus-v1.json", import.meta.url), "utf8"
));
const reconstructionFixture = JSON.parse(readFileSync(
  new URL("../fixtures/forensics/service-role-shadow-reconstruction-v1.json", import.meta.url), "utf8"
));

function collectIdentityStrings(value: unknown, key = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectIdentityStrings(item, key));
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && /(address|id)$/iu.test(key) ? [value] : [];
  }
  return Object.entries(value).flatMap(([childKey, child]) =>
    collectIdentityStrings(child, childKey)
  );
}

describe("Stage C service-role shadow admission gate", () => {
  it("freezes accepted manifest/page bytes and authoritative role entries", () => {
    const pages = reconstructionFixture.acceptedHistory.pages;
    const events = pages.flatMap(({ artifact }: { artifact: { events: unknown[] } }) => artifact.events);

    expect(pages).toHaveLength(2);
    expect(events).toHaveLength(200);
    expect(pages.map(({ artifact }: { artifact: { events: unknown[] } }) => artifact.events.length))
      .toEqual([100, 100]);
    expect(reconstructionFixture.acceptedHistory.manifest.sha256).toBe(
      fingerprintCanonicalArtifact(reconstructionFixture.acceptedHistory.manifest.artifact)
    );
    expect(pages.map(({ sha256 }: { sha256: string }) => sha256)).toEqual(
      reconstructionFixture.acceptedHistory.manifest.artifact.pageArtifactHashes
    );
    for (const page of pages) expect(page.sha256).toBe(fingerprintCanonicalArtifact(page.artifact));
    expect(reconstructionFixture.eventRoleMap.artifact.entries).toHaveLength(200);
    expect(reconstructionFixture.eventRoleMap.sha256).toBe(
      fingerprintCanonicalArtifact(reconstructionFixture.eventRoleMap.artifact)
    );
    expect(reconstructionFixture.eventRoleMap.artifact.entries.map(
      ({ canonicalEventId }: { canonicalEventId: string }) => canonicalEventId
    )).toEqual(events.map((event: { txHash: string; eventIndex: number }) =>
      canonicalTronUsdtEventKey(event)
    ));
  });

  it("keeps the synthetic reconstruction identity outside calibration and blind cases", () => {
    const protectedIdentities = new Set(collectIdentityStrings({
      serviceCases: corpus.serviceCases,
      adverseCases: corpus.adverseCases,
      blindCases: corpus.blindCases ?? []
    }));

    expect(reconstructionFixture).toMatchObject({
      evidenceClass: "synthetic_edge_case",
      fixtureIdentity: "synthetic-offline-accepted-history-control-v1",
      evidenceLimitations: expect.arrayContaining([
        "synthetic_offline_fixture_not_real_db_history",
        "synthetic_addresses_not_calibration_or_blind"
      ])
    });
    for (const identity of [
      reconstructionFixture.caseId,
      reconstructionFixture.subjectAddress,
      reconstructionFixture.state.address
    ]) expect(protectedIdentities).not.toContain(identity);
  });

  it("emits the exact typed receipt with honest evidence limitations", () => {
    const receipt = replayServiceRoleShadowGateV1({ corpus, reconstructedFixture: reconstructionFixture });

    expect(receipt).toMatchObject({
      schemaVersion: "service-role-shadow-gate-v1",
      service: { numerator: 24, denominator: 24 },
      adverse: { numerator: 6, denominator: 6 },
      reconstructedAcceptedHistories: 1,
      reconstructionEvidenceLimitations: [
        "synthetic_addresses_not_calibration_or_blind",
        "synthetic_offline_fixture_not_real_db_history"
      ],
      mismatches: []
    });
    expect(receipt.cases).toHaveLength(30);
    expect(new Set(receipt.cases.map(({ id }) => id)).size).toBe(30);
    expect(receipt.cases.find(({ id }) => id === "w8srl-two-window-calibration")).toMatchObject({
      evaluation: "recorded_vector_replay",
      evidenceLimitations: expect.arrayContaining(["recorded_calibration_vector_not_raw_pages"])
    });
    expect(receipt.cases.find(({ id }) => id === "tqr-d7nzp-recorded-control")).toMatchObject({
      evaluation: "sparse_guard_replay",
      evidenceLimitations: expect.arrayContaining(["checked_subject_guard_only"])
    });
    expect(receipt.cases.find(({ id }) => id === "txc-vusxvhd-recorded-control")).toMatchObject({
      evaluation: "partial_observation_replay",
      evidenceLimitations: expect.arrayContaining(["partial_73_rows_not_two_windows"])
    });
    for (const id of ["csv-q98cdn", "csv-aEGqTr", "csv-H14eaf"]) {
      expect(receipt.cases.find((item) => item.id === id)).toMatchObject({
        evaluation: "expectation_integrity_only",
        evidenceLimitations: expect.arrayContaining(["whole_export_not_real_100_plus_100_windows"])
      });
    }
    expect(receipt.cases.filter(({ evaluation }) => evaluation === "expectation_integrity_only")).toHaveLength(20);
    for (const id of ["exact-binance-label", "exact-htx-label"]) {
      expect(receipt.cases.find((item) => item.id === id)).toMatchObject({
        evaluation: "exact_assertion_replay",
        evidenceLimitations: expect.arrayContaining(["offline_only_no_runtime_eligibility"])
      });
    }
    expect(receipt.cases.filter(({ suite }) => suite === "adverse")).toHaveLength(6);
    expect(receipt.cases.every(({ evidenceLimitations }) => evidenceLimitations.length > 0)).toBe(true);
  });

  it("turns red when accepted reconstruction bindings or case identity are tampered", () => {
    const wrongRoleBinding = {
      ...reconstructionFixture.eventRoleMap.artifact,
      runId: "other-run"
    };
    const variants = [
      { ...reconstructionFixture, acceptedHistory: { ...reconstructionFixture.acceptedHistory, manifest: { ...reconstructionFixture.acceptedHistory.manifest, sha256: "0".repeat(64) } } },
      { ...reconstructionFixture, state: { ...reconstructionFixture.state, anchorTimestamp: "2020-01-01T00:00:00.000Z" } },
      { ...reconstructionFixture, eventRoleMap: { sha256: fingerprintCanonicalArtifact(wrongRoleBinding), artifact: wrongRoleBinding } },
      { ...reconstructionFixture, caseId: "duplicate-case" }
    ];

    for (const fixture of variants) {
      const receipt = replayServiceRoleShadowGateV1({ corpus, reconstructedFixture: fixture });
      expect(receipt.mismatches.length).toBeGreaterThan(0);
    }
  });

  it("uses the pure reconstruction adapter rather than duplicating its classifier", () => {
    const source = readFileSync(new URL("../../src/forensics/serviceRoleShadowGate.ts", import.meta.url), "utf8");
    expect(source).toContain('from "../unifiedCheck/serviceRoleShadow"');
    expect(source).not.toContain('from "./serviceBehaviorResearch"');
  });
});
