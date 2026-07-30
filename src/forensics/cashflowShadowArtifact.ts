import { fingerprintCanonicalArtifact } from "./canonicalJson.js";
import {
  cashflowPublicReasonV1,
  materializeCashflowCanonicalTapeV1,
  publicReason,
  type CashflowAuthorityEnvelopeV1,
  type CashflowPublicUnresolvedReasonV1
} from "./cashflowCanonicalTape.js";
import { selectLedgerProvenanceV1, type LedgerQueryV1 } from "./chronologicalProportionalLedger.js";

export type CashflowShadowArtifactV1 = {
  readonly schemaVersion: "cashflow-shadow-artifact-v1";
  readonly artifactSha256: string;
  readonly body: {
    readonly state: "complete" | "unresolved" | "not_applicable";
    readonly reason: CashflowPublicUnresolvedReasonV1 | null;
    readonly subjectAddress: string | null;
    readonly purpose: LedgerQueryV1["purpose"] | null;
    readonly targetRaw: string | null;
    readonly coveredRaw: string | null;
    readonly allocations: readonly {
      readonly lotId: string;
      readonly sourceEventId: string;
      readonly sourceAddress: string;
      readonly usedAmountRaw: string;
      readonly sourceOriginalRaw: string;
    }[];
    readonly evidenceRefs: readonly string[];
    readonly authorityArtifactSha256: string | null;
  };
};

const RAW_AMOUNT = /^(0|[1-9][0-9]*)$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finishShadow(
  body: CashflowShadowArtifactV1["body"]
): CashflowShadowArtifactV1 {
  const canonical = {
    ...body,
    evidenceRefs: [...new Set(body.evidenceRefs)].sort(compareId),
    allocations: [...body.allocations].sort((left, right) =>
      compareId(left.lotId, right.lotId) || compareId(left.sourceEventId, right.sourceEventId)
    )
  };
  return {
    schemaVersion: "cashflow-shadow-artifact-v1",
    artifactSha256: fingerprintCanonicalArtifact(canonical),
    body: canonical
  };
}

export function buildCashflowShadowArtifactV1(
  authority: CashflowAuthorityEnvelopeV1
): CashflowShadowArtifactV1 {
  if (authority.kind === "unavailable") {
    return finishShadow({
      state: "unresolved",
      reason: authority.typedReason,
      subjectAddress: null,
      purpose: null,
      targetRaw: null,
      coveredRaw: null,
      allocations: [],
      evidenceRefs: authority.evidenceRefs,
      authorityArtifactSha256: null
    });
  }

  const { tape } = authority;
  const { query } = materializeCashflowCanonicalTapeV1(tape);
  const selected = selectLedgerProvenanceV1(query);
  if (selected.state === "unresolved") {
    return finishShadow({
      state: "unresolved",
      reason: cashflowPublicReasonV1(selected.reason!),
      subjectAddress: tape.body.subjectAddress,
      purpose: tape.body.query.purpose,
      targetRaw: null,
      coveredRaw: null,
      allocations: [],
      evidenceRefs: tape.body.evidenceRefs,
      authorityArtifactSha256: tape.artifactSha256
    });
  }
  if (tape.body.economicRoleCoverage === "incomplete") {
    return finishShadow({
      state: "unresolved",
      reason: "economic_role_unresolved",
      subjectAddress: tape.body.subjectAddress,
      purpose: tape.body.query.purpose,
      targetRaw: null,
      coveredRaw: null,
      allocations: [],
      evidenceRefs: tape.body.evidenceRefs,
      authorityArtifactSha256: tape.artifactSha256
    });
  }
  return finishShadow({
    state: selected.state,
    reason: selected.reason === null ? null : cashflowPublicReasonV1(selected.reason),
    subjectAddress: tape.body.subjectAddress,
    purpose: tape.body.query.purpose,
    targetRaw: selected.targetRaw.toString(),
    coveredRaw: selected.coveredRaw.toString(),
    allocations: selected.allocations.map((allocation) => ({
      lotId: allocation.lotId,
      sourceEventId: allocation.sourceEventId,
      sourceAddress: allocation.sourceAddress,
      usedAmountRaw: allocation.amountRaw.toString(),
      sourceOriginalRaw: allocation.sourceOriginalRaw.toString()
    })),
    evidenceRefs: tape.body.evidenceRefs,
    authorityArtifactSha256: tape.artifactSha256
  });
}

function fail(): never {
  throw new TypeError("cashflow_shadow_artifact_invalid");
}

function record(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => {
    const descriptor = descriptors[key as string];
    return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
  })) return fail();
  return value as Record<string, unknown>;
}

function string(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    return fail();
  }
  return value;
}

function nullableString(value: unknown, pattern?: RegExp): string | null {
  return value === null ? null : string(value, pattern);
}

function rawAmount(value: unknown): string {
  return string(value, RAW_AMOUNT);
}

function sortedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return fail();
  const values = value.map((item) => string(item));
  if (
    new Set(values).size !== values.length
    || values.some((item, index) => index > 0 && values[index - 1]! >= item)
  ) return fail();
  return values;
}

export function parseCashflowShadowArtifactV1(value: unknown): CashflowShadowArtifactV1 {
  try {
    const source = record(value, ["schemaVersion", "artifactSha256", "body"]);
    if (source.schemaVersion !== "cashflow-shadow-artifact-v1") return fail();
    const bodySource = record(source.body, [
      "state",
      "reason",
      "subjectAddress",
      "purpose",
      "targetRaw",
      "coveredRaw",
      "allocations",
      "evidenceRefs",
      "authorityArtifactSha256"
    ]);
    if (
      bodySource.state !== "complete"
      && bodySource.state !== "unresolved"
      && bodySource.state !== "not_applicable"
    ) return fail();
    if (bodySource.reason !== null && !publicReason(bodySource.reason)) return fail();
    if (
      bodySource.purpose !== null
      && bodySource.purpose !== "current_balance"
      && bodySource.purpose !== "amount_only"
      && bodySource.purpose !== "exact_episode"
    ) return fail();
    if (!Array.isArray(bodySource.allocations)) return fail();
    const allocations = bodySource.allocations.map((value) => {
      const allocation = record(value, [
        "lotId",
        "sourceEventId",
        "sourceAddress",
        "usedAmountRaw",
        "sourceOriginalRaw"
      ]);
      return {
        lotId: string(allocation.lotId),
        sourceEventId: string(allocation.sourceEventId),
        sourceAddress: string(allocation.sourceAddress, TRON_ADDRESS),
        usedAmountRaw: rawAmount(allocation.usedAmountRaw),
        sourceOriginalRaw: rawAmount(allocation.sourceOriginalRaw)
      };
    });
    if (allocations.some((allocation, index) => {
      if (index === 0) return false;
      const previous = allocations[index - 1]!;
      const lotOrder = compareId(previous.lotId, allocation.lotId);
      return lotOrder > 0
        || (lotOrder === 0 && compareId(previous.sourceEventId, allocation.sourceEventId) >= 0);
    })) return fail();

    const body: CashflowShadowArtifactV1["body"] = {
      state: bodySource.state,
      reason: bodySource.reason as CashflowPublicUnresolvedReasonV1 | null,
      subjectAddress: nullableString(bodySource.subjectAddress, TRON_ADDRESS),
      purpose: bodySource.purpose,
      targetRaw: bodySource.targetRaw === null ? null : rawAmount(bodySource.targetRaw),
      coveredRaw: bodySource.coveredRaw === null ? null : rawAmount(bodySource.coveredRaw),
      allocations,
      evidenceRefs: sortedStrings(bodySource.evidenceRefs),
      authorityArtifactSha256: nullableString(bodySource.authorityArtifactSha256, SHA256)
    };
    const unavailable = body.subjectAddress === null
      && body.purpose === null
      && body.authorityArtifactSha256 === null;
    const authoritative = body.subjectAddress !== null
      && body.purpose !== null
      && body.authorityArtifactSha256 !== null;
    if (!unavailable && !authoritative) return fail();

    const allocationSum = allocations.reduce(
      (sum, allocation) => sum + BigInt(allocation.usedAmountRaw),
      0n
    );
    if (allocations.some((allocation) =>
      BigInt(allocation.usedAmountRaw) <= 0n
      || BigInt(allocation.sourceOriginalRaw) < BigInt(allocation.usedAmountRaw)
    )) return fail();

    if (body.state === "complete") {
      if (
        !authoritative
        || body.reason !== null
        || body.targetRaw === null
        || body.coveredRaw === null
        || BigInt(body.targetRaw) <= 0n
        || BigInt(body.targetRaw) !== BigInt(body.coveredRaw)
        || BigInt(body.coveredRaw) !== allocationSum
      ) return fail();
    } else if (body.state === "unresolved") {
      if (
        !publicReason(body.reason)
        || body.targetRaw !== null
        || body.coveredRaw !== null
        || allocations.length !== 0
      ) return fail();
    } else if (
      !authoritative
      || body.purpose !== "current_balance"
      || body.reason !== null
      || body.targetRaw !== "0"
      || body.coveredRaw !== "0"
      || allocations.length !== 0
    ) return fail();

    const artifactSha256 = string(source.artifactSha256, SHA256);
    if (fingerprintCanonicalArtifact(body) !== artifactSha256) return fail();
    return { schemaVersion: "cashflow-shadow-artifact-v1", artifactSha256, body };
  } catch {
    return fail();
  }
}
