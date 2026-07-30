import { readFile } from "node:fs/promises";
import { canonicalizeArtifactJson } from "../src/forensics/canonicalJson.js";
import {
  replayOfflineForensicModelCorpusV1,
  type OfflineCorpusV1,
  type OfflineReplayResultV1
} from "../src/forensics/offlineForensicModelReplay.js";

type Case = OfflineCorpusV1["ledgerCases"][number];
type CaseResult = OfflineReplayResultV1["ledgerCases"][number];
type Mismatch = { readonly caseId: string; readonly code: string };

const DEFAULT_FIXTURE = new URL(
  "../tests/fixtures/forensics/forensic-model-offline-corpus-v1.json",
  import.meta.url
);

function fixtureArgument(args: readonly string[]): string | URL {
  if (args.length === 0) return DEFAULT_FIXTURE;
  if (args.length !== 2 || args[0] !== "--fixture" || args[1] === "") {
    throw new TypeError("usage: replayForensicModelCorpus [--fixture <path>]");
  }
  return args[1]!;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasFrozenExpectation(source: Case): boolean {
  const item = source as Record<string, unknown>;
  if (Object.keys(item).some((key) => key === "expected" || key.startsWith("expected")) ||
    typeof item.behaviorClassification === "string") return true;
  const observed = record(item.observedVector);
  if (observed.recordedPredicate !== undefined) return true;
  return Array.isArray(item.windows) && item.windows.some((window) =>
    record(window).recordedPredicate !== undefined
  );
}

function matchesDeclaredExpectation(source: Case, actual: CaseResult): boolean {
  const expected = source as Record<string, unknown>;
  const result = actual as Record<string, unknown>;
  if (result.state === "expectation_level") return false;

  if (typeof expected.expectedAuthoritativeState === "string" &&
    expected.expectedAuthoritativeState !== result.state &&
    expected.expectedAuthoritativeState !== result.reason) return false;
  if (typeof expected.expectedState === "string" &&
    expected.expectedState !== result.state &&
    expected.expectedState !== result.reason) return false;
  if (typeof expected.expectedReason === "string" && expected.expectedReason !== result.reason) {
    return false;
  }

  if (typeof expected.behaviorClassification === "string") {
    const expectedState = {
      high_service_behavior: "high_inferred_service",
      non_service_profile: "non_service_profile",
      insufficient_data: "insufficient_data"
    }[expected.behaviorClassification];
    if (expectedState !== undefined && expectedState !== result.state) return false;
  }

  if (expected.expectedClassification === "exact_service_label" &&
    (result.kind !== "service_label" || result.authoritative !== true ||
      result.atValidityStart !== "eligible")) return false;
  if (expected.expectedClassification === "exact_service_label_not_backdated" &&
    (result.kind !== "service_label" || result.authoritative !== true ||
      result.atValidityStart !== "eligible" ||
      result.beforeValidityStart !== "label_not_valid_at_event")) return false;

  if (typeof expected.expectedHardEvidenceAmountRaw === "string" &&
    expected.expectedHardEvidenceAmountRaw !== result.hardEvidenceAmountRaw) return false;
  if (expected.expectedRule === "only_active_at_event_partition_is_authoritative") {
    const partitions = record(result.partitions);
    if (partitions.active_at_event !== result.hardEvidenceAmountRaw) return false;
  }

  const roles = record(expected.expectedRoles);
  if (typeof roles.principal === "string" && roles.principal !== result.principalRole) return false;
  if (typeof roles.fee === "string" && roles.fee !== result.serviceFeeRole) return false;
  if (expected.expectedCurrentProvenanceState === "unresolved" && result.ledgerExecuted !== false) {
    return false;
  }

  if (typeof expected.expectedExactDrainerAuthority === "boolean" &&
    expected.expectedExactDrainerAuthority !== result.red) return false;
  if (expected.expectedEvidenceLevel === "context_only" && result.classification !== "context_only") {
    return false;
  }
  if (expected.expectedEvidenceLevel === "exact_approval_drain" && result.red !== true) return false;
  return true;
}

function compareExpectations(
  corpus: OfflineCorpusV1,
  result: OfflineReplayResultV1
): readonly Mismatch[] {
  const sources = new Map([
    ...corpus.ledgerCases,
    ...corpus.serviceCases,
    ...corpus.adverseCases,
    ...(corpus.broadScopeCases ?? [])
  ].map((item) => [item.id, item] as const));
  return [
    ...result.ledgerCases,
    ...result.serviceCases,
    ...result.adverseCases,
    ...result.broadScopeCases
  ].flatMap((actual): Mismatch[] => {
    const source = sources.get(actual.id);
    if (source === undefined) return [{ caseId: actual.id, code: "frozen_expectation_missing" }];
    if (!hasFrozenExpectation(source)) {
      return [{ caseId: actual.id, code: "frozen_expectation_missing" }];
    }
    if (matchesDeclaredExpectation(source, actual)) return [];
    return [{
      caseId: actual.id,
      code: actual.state === "expectation_level"
        ? "frozen_expectation_not_replayed"
        : "frozen_expectation_mismatch"
    }];
  }).sort((left, right) =>
    left.caseId < right.caseId ? -1
      : left.caseId > right.caseId ? 1
        : left.code < right.code ? -1 : left.code > right.code ? 1 : 0
  );
}

function sortResult(result: OfflineReplayResultV1): OfflineReplayResultV1 {
  const byId = <T extends { readonly id: string }>(items: readonly T[]) =>
    [...items].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return {
    ...result,
    ledgerCases: byId(result.ledgerCases),
    serviceCases: byId(result.serviceCases),
    adverseCases: byId(result.adverseCases),
    broadScopeCases: byId(result.broadScopeCases),
    dataGaps: [...result.dataGaps].sort((left, right) =>
      left.caseId < right.caseId ? -1
        : left.caseId > right.caseId ? 1
          : left.code < right.code ? -1 : left.code > right.code ? 1 : 0
    )
  };
}

async function main(): Promise<void> {
  const fixture = fixtureArgument(process.argv.slice(2));
  const corpus = JSON.parse(await readFile(fixture, "utf8")) as OfflineCorpusV1;
  const result = sortResult(replayOfflineForensicModelCorpusV1(corpus));
  const expectationMismatches = compareExpectations(corpus, result);
  const limitations = [
    ...new Set(result.adverseCases.flatMap((item) =>
      item.providerAssertionReplay === "raw_provider_assertion_not_replayed"
        ? ["raw_provider_assertion_not_replayed"]
        : []
    ))
  ].sort();
  const matched = expectationMismatches.length === 0;
  process.stdout.write(`${canonicalizeArtifactJson({
    schemaVersion: "offline-forensic-model-corpus-run-v1",
    matched,
    expectationMismatches,
    limitations,
    result
  })}\n`);
  if (!matched) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 2;
});
