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
type ExpectedProperty = { readonly path: string; readonly value: unknown };

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

function expectedProperties(value: unknown, path = ""): readonly ExpectedProperty[] {
  if (Array.isArray(value)) {
    const itemPath = `${path}[]`;
    return value.flatMap((item) => expectedProperties(item, itemPath));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.keys(value).sort().flatMap((key) => {
    const child = (value as Record<string, unknown>)[key];
    const childPath = path === "" ? key : `${path}.${key}`;
    return [
      ...(key.startsWith("expected") ? [{ path: childPath, value: child }] : []),
      ...expectedProperties(child, childPath)
    ];
  });
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
  const properties = expectedProperties(source);
  if (properties.length === 0) return "missing";
  let matched = true;
  let replayed = true;
  for (const property of properties) {
    const value = property.value;
    switch (property.path) {
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
      case "currentBalanceObservation.expectedState":
        if (value !== "unresolved") return "unsupported";
        replayed = false;
        break;
      default:
        return "unsupported";
    }
  }
  if (result.state === "expectation_level") return "not_replayed";
  if (!matched) return "mismatch";
  if (!replayed) return "not_replayed";
  return "matched";
}

function compareServiceExpectations(
  source: Record<string, unknown>,
  result: Record<string, unknown>
): ExpectationStatus {
  if (expectedProperties(source).length > 0) return "unsupported";
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
  const properties = expectedProperties(source);
  if (properties.length === 0) return "missing";
  let matched = true;
  let replayed = true;
  for (const property of properties) {
    const value = property.value;
    switch (property.path) {
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
      case "principalTransfers[].expectedTemporalClass":
        if (value !== "before_activation" && value !== "active_at_event" &&
          value !== "unknown_time") return "unsupported";
        replayed = false;
        break;
      default:
        return "unsupported";
    }
  }
  if (!replayed || result.state === "expectation_level") return "not_replayed";
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
  return expectedProperties(expected).length === 0 ? "missing" : "unsupported";
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

const SEMANTIC_ID_KEYS = [
  "id",
  "caseId",
  "branchId",
  "continuationId",
  "lotId",
  "allocationId",
  "consumptionId",
  "providerAliasId",
  "providerEventId",
  "eventId",
  "transferId"
] as const;

function sortSemanticArrays(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => sortSemanticArrays(item));
    if (/Ids$/u.test(parentKey) && items.every((item) => typeof item === "string")) {
      return [...items].sort();
    }
    const records = items.map(record);
    const idKey = SEMANTIC_ID_KEYS.find((key) =>
      records.length > 0 && records.every((item) =>
        typeof item[key] === "string" || typeof item[key] === "number"
      )
    );
    if (idKey === undefined) return items;
    return [...items].sort((left, right) => {
      const leftRecord = record(left);
      const rightRecord = record(right);
      const leftId = String(leftRecord[idKey]);
      const rightId = String(rightRecord[idKey]);
      if (leftId !== rightId) return leftId < rightId ? -1 : 1;
      const leftJson = canonicalizeArtifactJson(left);
      const rightJson = canonicalizeArtifactJson(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    });
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, sortSemanticArrays(child, key)]
  ));
}

function sortResult(result: OfflineReplayResultV1): OfflineReplayResultV1 {
  return sortSemanticArrays(result) as OfflineReplayResultV1;
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
