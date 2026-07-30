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
type CaseKind = "ledger" | "service" | "adverse" | "broad_scope";
type ExpectationStatus =
  | "matched"
  | "mismatch"
  | "missing"
  | "not_replayed"
  | "unsupported";

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

function expectedFieldNames(source: Record<string, unknown>): readonly string[] {
  return Object.keys(source).filter((key) => key.startsWith("expected")).sort();
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function canonicalAmount(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value);
}

function compareLedgerExpectations(
  source: Record<string, unknown>,
  result: Record<string, unknown>
): ExpectationStatus {
  const fields = expectedFieldNames(source);
  if (fields.length === 0) return "missing";
  let matched = true;
  let replayed = true;
  for (const field of fields) {
    const value = source[field];
    switch (field) {
      case "expectedAuthoritativeState":
        if (value !== "history_incomplete" && value !== "complete") return "unsupported";
        matched &&= value === result.state || value === result.reason;
        break;
      case "expected": { // ponytail: v1 exposes no result fields for this legacy control shape.
        const expectation = record(value);
        const keys = [
          "currentBalanceAmountRaw",
          "currentSource",
          "episodeCoveredAmountRaw",
          "oldLotRemainingAmountRaw",
          "state"
        ];
        if (!hasExactKeys(expectation, keys) || expectation.state !== "complete" ||
          !canonicalAmount(expectation.episodeCoveredAmountRaw) ||
          !canonicalAmount(expectation.oldLotRemainingAmountRaw) ||
          !canonicalAmount(expectation.currentBalanceAmountRaw) ||
          typeof expectation.currentSource !== "string" || expectation.currentSource === "") {
          return "unsupported";
        }
        replayed = false;
        break;
      }
      case "expectedAllocations":
        if (!Array.isArray(value) || value.some((item) => {
          const allocation = record(item);
          return !hasExactKeys(allocation, ["amountRaw", "source"]) ||
            typeof allocation.source !== "string" || allocation.source === "" ||
            !canonicalAmount(allocation.amountRaw);
        })) return "unsupported";
        replayed = false;
        break;
      case "expectedBalanceAmountRaw":
        if (!canonicalAmount(value)) return "unsupported";
        replayed = false;
        break;
      case "expectedEffect":
        if (value !== "cashflow_no_op") return "unsupported";
        replayed = false;
        break;
      case "expectedState":
        if (!["complete", "history_incomplete", "identity_collision", "temporal_order_unresolved"]
          .includes(value as string)) return "unsupported";
        matched &&= value === result.state || value === result.reason;
        break;
      case "expectedReason":
        if (value !== "debit_over_inventory") return "unsupported";
        matched &&= value === result.reason;
        break;
      default:
        return "unsupported";
    }
  }
  if (!replayed || result.state === "expectation_level") return "not_replayed";
  return matched ? "matched" : "mismatch";
}

function compareServiceExpectations(
  source: Record<string, unknown>,
  result: Record<string, unknown>
): ExpectationStatus {
  if (expectedFieldNames(source).length > 0) return "unsupported";
  const observed = record(source.observedVector);
  const hasRecordedPredicate = observed.recordedPredicate !== undefined ||
    (Array.isArray(source.windows) && source.windows.some((window) =>
      record(window).recordedPredicate !== undefined
    ));
  const classification = source.behaviorClassification;
  if (classification === undefined && !hasRecordedPredicate) return "missing";
  if (classification !== undefined &&
    classification !== "high_service_behavior" &&
    classification !== "non_service_profile" &&
    classification !== "insufficient_data") return "unsupported";
  if (result.state === "expectation_level") return "not_replayed";
  if (classification === undefined) return "matched";
  const expectedState = {
    high_service_behavior: "high_inferred_service",
    non_service_profile: "non_service_profile",
    insufficient_data: "insufficient_data"
  }[classification];
  return expectedState === result.state ? "matched" : "mismatch";
}

function compareAdverseExpectations(
  source: Record<string, unknown>,
  result: Record<string, unknown>
): ExpectationStatus {
  const fields = expectedFieldNames(source);
  if (fields.length === 0) return "missing";
  let matched = true;
  for (const field of fields) {
    const value = source[field];
    switch (field) {
      case "expectedClassification":
        if (value !== "exact_service_label" && value !== "exact_service_label_not_backdated") {
          return "unsupported";
        }
        matched &&= result.kind === "service_label" && result.authoritative === true &&
          result.atValidityStart === "eligible" && (
            value === "exact_service_label"
              ? result.serviceRole === "cex:binance" && result.adverse === false
              : result.serviceRole === "cex:htx-huobi" && result.adverse === true &&
                result.beforeValidityStart === "label_not_valid_at_event"
          );
        break;
      case "expectedHardEvidenceAmountRaw":
        if (!canonicalAmount(value)) return "unsupported";
        matched &&= value === result.hardEvidenceAmountRaw;
        break;
      case "expectedRule":
        if (value !== "only_active_at_event_partition_is_authoritative") return "unsupported";
        matched &&= record(result.partitions).active_at_event === result.hardEvidenceAmountRaw;
        break;
      case "expectedRoles": { // ponytail: v1 has exactly the principal/fee role pair.
        const roles = record(value);
        if (!hasExactKeys(roles, ["fee", "principal"]) ||
          roles.principal !== "aml_money_path" ||
          roles.fee !== "accounting_only_consumption") return "unsupported";
        matched &&= roles.principal === result.principalRole && roles.fee === result.serviceFeeRole;
        break;
      }
      case "expectedCurrentProvenanceState":
        if (value !== "unresolved") return "unsupported";
        matched &&= result.ledgerExecuted === false;
        break;
      case "expectedEvidenceLevel":
        if (value !== "context_only" && value !== "exact_approval_drain") return "unsupported";
        matched &&= value === "context_only"
          ? result.classification === "context_only" && result.red === false
          : result.classification === "exact_drainer_red" && result.red === true;
        break;
      case "expectedExactDrainerAuthority":
        if (typeof value !== "boolean") return "unsupported";
        matched &&= value === result.red;
        break;
      default:
        return "unsupported";
    }
  }
  if (result.state === "expectation_level") return "not_replayed";
  return matched ? "matched" : "mismatch";
}

function compareCaseExpectation(
  kind: CaseKind,
  source: Case,
  actual: CaseResult
): ExpectationStatus {
  const expected = source as Record<string, unknown>;
  const result = actual as Record<string, unknown>;
  if (kind === "ledger") return compareLedgerExpectations(expected, result);
  if (kind === "service") return compareServiceExpectations(expected, result);
  if (kind === "adverse") return compareAdverseExpectations(expected, result);
  return expectedFieldNames(expected).length === 0 ? "missing" : "unsupported";
}

function compareExpectations(
  corpus: OfflineCorpusV1,
  result: OfflineReplayResultV1
): readonly Mismatch[] {
  const sources = new Map([
    ...corpus.ledgerCases.map((source) => ({ kind: "ledger" as const, source })),
    ...corpus.serviceCases.map((source) => ({ kind: "service" as const, source })),
    ...corpus.adverseCases.map((source) => ({ kind: "adverse" as const, source })),
    ...(corpus.broadScopeCases ?? []).map((source) => ({ kind: "broad_scope" as const, source }))
  ].map((item) => [item.source.id, item] as const));
  return [
    ...result.ledgerCases,
    ...result.serviceCases,
    ...result.adverseCases,
    ...result.broadScopeCases
  ].flatMap((actual): Mismatch[] => {
    const item = sources.get(actual.id);
    if (item === undefined) return [{ caseId: actual.id, code: "frozen_expectation_missing" }];
    const comparison = compareCaseExpectation(item.kind, item.source, actual);
    if (comparison === "matched") return [];
    return [{
      caseId: actual.id,
      code: comparison === "missing" ? "frozen_expectation_missing"
        : comparison === "unsupported" ? "unsupported_frozen_expectation"
          : comparison === "not_replayed" ? "frozen_expectation_not_replayed"
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
