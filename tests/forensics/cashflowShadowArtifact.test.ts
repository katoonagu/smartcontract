import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import {
  parseCashflowCanonicalTapeArtifactV1,
  type CashflowAuthorityEnvelopeV1,
  type CashflowCanonicalTapeArtifactV1
} from "../../src/forensics/cashflowCanonicalTape.js";
import {
  buildCashflowShadowArtifactV1,
  parseCashflowShadowArtifactV1
} from "../../src/forensics/cashflowShadowArtifact.js";

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

type MutableTape = {
  schemaVersion: "cashflow-canonical-tape-v1";
  artifactSha256: string;
  body: Record<string, unknown> & {
    subjectAddress: string;
    snapshot: Record<string, unknown> & {
      blockNumber: number;
      blockHash: string;
      balance: Record<string, unknown>;
    };
    history: Record<string, unknown>;
    movements: Array<Record<string, unknown>>;
    query: Record<string, unknown>;
    evidenceRefs: string[];
    economicRoleCoverage: string;
  };
};

const acceptancePath = new URL(
  "../../docs/superpowers/verification/2026-07-30-pacgy-canonical-tape-acceptance.json",
  import.meta.url
);
const acceptance = JSON.parse(readFileSync(acceptancePath, "utf8")) as {
  readonly tapeArtifactPath: string;
  readonly tapeArtifactSha256: string;
};
const rawTape = JSON.parse(readFileSync(acceptance.tapeArtifactPath, "utf8")) as MutableTape;

function completeTape(): CashflowCanonicalTapeArtifactV1 {
  const copy = structuredClone(rawTape);
  const txHash = "0".repeat(64);
  const subjectAddress = copy.body.subjectAddress;
  copy.body.history = {
    completeness: "genesis_complete",
    openingBalanceRaw: "0",
    evidenceRef: "synthetic:genesis"
  };
  copy.body.snapshot.balance = {
    amountRaw: "10",
    pinned: true,
    independent: true,
    evidenceRef: "synthetic:balance"
  };
  copy.body.movements = [{
    canonicalEventId: `receipt:${txHash}:0`,
    providerEventIds: ["synthetic:receipt:0"],
    txHash,
    blockNumber: copy.body.snapshot.blockNumber - 1,
    transactionIndex: 0,
    eventIndex: 0,
    eventIndexAuthority: "receipt_log_index",
    occurredAtMs: 1_000,
    fromAddress: "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC",
    toAddress: subjectAddress,
    amountRaw: "10",
    finality: "confirmed_success",
    identityEvidenceRef: "synthetic:identity",
    finalityEvidenceRef: "synthetic:finality",
    orderEvidenceRef: "synthetic:order"
  }];
  copy.body.query = { purpose: "current_balance", exactRedContributorLotIds: [] };
  copy.body.economicRoleCoverage = "complete";
  copy.body.evidenceRefs = ["synthetic:balance", "synthetic:genesis", "synthetic:movement"];
  copy.artifactSha256 = fingerprintCanonicalArtifact(copy.body);
  return parseCashflowCanonicalTapeArtifactV1(copy);
}

describe("cashflow shadow artifact v1", () => {
  it("consumes the accepted real tape without upgrading incomplete history", () => {
    const tape = parseCashflowCanonicalTapeArtifactV1(rawTape);
    const artifact = buildCashflowShadowArtifactV1({ kind: "canonical_tape", tape });

    expect(tape.artifactSha256).toBe(acceptance.tapeArtifactSha256);
    expect(artifact.body).toMatchObject({
      state: "unresolved",
      reason: "history_incomplete_before_anchor",
      subjectAddress: tape.body.subjectAddress,
      purpose: "exact_episode",
      targetRaw: null,
      coveredRaw: null,
      allocations: [],
      authorityArtifactSha256: tape.artifactSha256
    });
    expect(parseCashflowShadowArtifactV1(artifact)).toEqual(artifact);
    expect(JSON.stringify(artifact)).not.toMatch(/\d+n\b/u);
  });

  it("builds a deterministic complete content-addressed artifact", () => {
    const tape = completeTape();
    const authority = { kind: "canonical_tape", tape } as const;
    const first = buildCashflowShadowArtifactV1(authority);
    const second = buildCashflowShadowArtifactV1(authority);

    expect(second).toEqual(first);
    expect(first.body).toMatchObject({
      state: "complete",
      reason: null,
      subjectAddress: tape.body.subjectAddress,
      purpose: "current_balance",
      targetRaw: "10",
      coveredRaw: "10",
      authorityArtifactSha256: tape.artifactSha256
    });
    expect(first.body.allocations).toHaveLength(1);
    expect(first.body.allocations[0]).toMatchObject({
      sourceAddress: "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC",
      usedAmountRaw: "10",
      sourceOriginalRaw: "10"
    });
    expect(first.artifactSha256).toBe(fingerprintCanonicalArtifact(first.body));
    expect(parseCashflowShadowArtifactV1(first)).toEqual(first);
  });

  it("preserves the zero current-balance case as not applicable", () => {
    const tape = completeTape();
    const body = {
      ...tape.body,
      snapshot: {
        ...tape.body.snapshot,
        balance: {
          amountRaw: "0",
          pinned: true,
          independent: true,
          evidenceRef: "synthetic:balance"
        }
      },
      movements: []
    };
    const zeroTape = parseCashflowCanonicalTapeArtifactV1({
      ...tape,
      artifactSha256: fingerprintCanonicalArtifact(body),
      body
    });
    const artifact = buildCashflowShadowArtifactV1({ kind: "canonical_tape", tape: zeroTape });

    expect(artifact.body).toMatchObject({
      state: "not_applicable",
      reason: null,
      purpose: "current_balance",
      targetRaw: "0",
      coveredRaw: "0",
      allocations: []
    });
    expect(parseCashflowShadowArtifactV1(artifact)).toEqual(artifact);
  });

  it("keeps unavailable authority sparse, sorted, deterministic, and JSON-safe", () => {
    const authority: CashflowAuthorityEnvelopeV1 = {
      kind: "unavailable",
      typedReason: "history_incomplete_before_anchor",
      evidenceRefs: ["z:last", "a:first", "z:last"]
    };
    const first = buildCashflowShadowArtifactV1(authority);
    const second = buildCashflowShadowArtifactV1(authority);

    expect(second).toEqual(first);
    expect(first.body).toEqual({
      state: "unresolved",
      reason: "history_incomplete_before_anchor",
      subjectAddress: null,
      purpose: null,
      targetRaw: null,
      coveredRaw: null,
      allocations: [],
      evidenceRefs: ["a:first", "z:last"],
      authorityArtifactSha256: null
    });
    expect(first.artifactSha256).toBe(fingerprintCanonicalArtifact(first.body));
    expect(parseCashflowShadowArtifactV1(first)).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/\d+n\b/u);
  });

  it("reports incomplete economic-role coverage after authoritative ledger replay", () => {
    const tape = completeTape();
    const body = { ...tape.body, economicRoleCoverage: "incomplete" as const };
    const incomplete: CashflowCanonicalTapeArtifactV1 = {
      ...tape,
      artifactSha256: fingerprintCanonicalArtifact(body),
      body
    };

    expect(buildCashflowShadowArtifactV1({ kind: "canonical_tape", tape: incomplete }).body)
      .toMatchObject({
        state: "unresolved",
        reason: "economic_role_unresolved",
        targetRaw: null,
        coveredRaw: null,
        allocations: []
      });
  });

  it("rejects hash tampering and contradictory shadow states", () => {
    const unavailable = buildCashflowShadowArtifactV1({
      kind: "unavailable",
      typedReason: "history_incomplete_before_anchor",
      evidenceRefs: ["accepted:gap:history"]
    });
    const tampered = structuredClone(unavailable) as Mutable<typeof unavailable>;
    tampered.body.reason = "temporal_order_unresolved";
    expect(() => parseCashflowShadowArtifactV1(tampered))
      .toThrow("cashflow_shadow_artifact_invalid");

    const tape = completeTape();
    const complete = buildCashflowShadowArtifactV1({ kind: "canonical_tape", tape });
    const contradictoryComplete = structuredClone(complete) as Mutable<typeof complete>;
    contradictoryComplete.body.reason = "temporal_order_unresolved";
    contradictoryComplete.artifactSha256 = fingerprintCanonicalArtifact(contradictoryComplete.body);
    expect(() => parseCashflowShadowArtifactV1(contradictoryComplete))
      .toThrow("cashflow_shadow_artifact_invalid");

    const contradictoryUnresolved = structuredClone(unavailable) as Mutable<typeof unavailable>;
    contradictoryUnresolved.body.targetRaw = "0";
    contradictoryUnresolved.body.coveredRaw = "0";
    contradictoryUnresolved.body.allocations = structuredClone(
      complete.body.allocations
    ) as Mutable<typeof complete.body.allocations>;
    contradictoryUnresolved.artifactSha256 = fingerprintCanonicalArtifact(contradictoryUnresolved.body);
    expect(() => parseCashflowShadowArtifactV1(contradictoryUnresolved))
      .toThrow("cashflow_shadow_artifact_invalid");

    const badNotApplicable = structuredClone(complete) as Mutable<typeof complete>;
    badNotApplicable.body.state = "not_applicable";
    badNotApplicable.body.purpose = "amount_only";
    badNotApplicable.body.targetRaw = "0";
    badNotApplicable.body.coveredRaw = "0";
    badNotApplicable.body.allocations = [];
    badNotApplicable.artifactSha256 = fingerprintCanonicalArtifact(badNotApplicable.body);
    expect(() => parseCashflowShadowArtifactV1(badNotApplicable))
      .toThrow("cashflow_shadow_artifact_invalid");
  });
});
