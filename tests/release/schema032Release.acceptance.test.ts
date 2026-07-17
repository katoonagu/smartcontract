import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  POSTCONDITIONS_SHA256,
  buildSchema032ReleaseEvidence,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type SchemaApi = {
  validateSchema032ReleaseEvidence(value: unknown, expected: { candidateSha: string; postconditionsSha256: string }): unknown;
};

it("[REQ-38][SCHEMA-032-RELEASE] rejects filename full candidate checksum receipt checksum or postcondition mismatch", async () => {
  const modulePath: string = "../../scripts/verifySchema032";
  let api: SchemaApi;
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<SchemaApi>;
    if (typeof loaded.validateSchema032ReleaseEvidence !== "function") throw new Error("validator export missing");
    api = loaded as SchemaApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: schema 032 release verifier", { cause: error });
  }
  const expected = { candidateSha: CANDIDATE_SHA, postconditionsSha256: POSTCONDITIONS_SHA256 };
  expect(() => api.validateSchema032ReleaseEvidence(buildSchema032ReleaseEvidence(), expected)).not.toThrow();
  const invalid = [
    (value: any) => { value.migrationFilename = "032_wrong.sql"; },
    (value: any) => { value.candidateBytesChecksumSha256 = "f".repeat(64); },
    (value: any) => { value.receiptChecksumSha256 = "f".repeat(64); },
    (value: any) => { value.shortChecksum = "f".repeat(12); },
    (value: any) => { value.postconditionsSha256 = "f".repeat(64); },
    (value: any) => { value.secondApply = "applied"; }
  ];
  for (const mutate of invalid) {
    const value: any = cloneFixture(buildSchema032ReleaseEvidence());
    mutate(value);
    expect(() => api.validateSchema032ReleaseEvidence(value, expected)).toThrow();
  }
});
