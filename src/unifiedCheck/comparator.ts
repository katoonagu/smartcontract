import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { buildScoreAnchorV3 } from "../risk/scoreAnchorV3";
import {
  GOLDEN_CASE_EXPECTATIONS_V4,
  LOCKED_GOLDEN_MANIFEST_SHA256
} from "../risk/scoringPolicyV4.generated";
import {
  scoreSignalMatrixV4,
  type NeutralCandidateCode
} from "../risk/scoringSignalMatrixV4";
import type { WalletMetrics } from "../wallet/metrics";
import {
  canonicalizeAdjudicatedFactsV4,
  canonicalizeEvidenceFacts,
  type CanonicalFactInput,
  type CanonicalFactV1
} from "./canonicalFacts";
import type {
  AnalysisManifestV1,
  EvidenceBundleV1,
  ScoringBundleV1,
  TraversalClosureCertificateV1
} from "./contracts";
import {
  buildPresentationManifest,
  renderUnifiedWalletPresentation
} from "./presentation";
import { buildUnifiedWalletReport } from "./report";
import type { FinalAdjudicationV2 } from "../../tools/golden-pilot-v2/adjudication";
import {
  canonicalJson,
  canonicalSha256
} from "../../tools/golden-pilot-v2/canonicalJson";
import {
  parseComparatorInputV1,
  presentationExpectation,
  verifyLockedGoldenRoot,
  type ComparatorInputV1,
  type ComparatorOutputV1
} from "../../tools/golden-pilot-v2/lockedManifest";
import {
  buildNeutralExport,
  type NeutralEvidenceBundleV2
} from "../../tools/golden-pilot-v2/neutralExport";
import { GOLDEN_COMPARATOR_V1_LOCK } from "./goldenComparatorV1.generated";
import { compareAttributionPolicies } from "../../tools/golden-pilot-v2/attribution";
import { canonicalEventFactId } from "../../tools/golden-pilot-v2/reviewWorkspace";

export type GoldenComparatorViolation = {
  readonly property:
    | "score"
    | "decision"
    | "anchor"
    | "aggregate"
    | "presentation"
    | "hash"
    | "relation";
  readonly expected: unknown;
  readonly actual: unknown;
};

type ScoringExpectation =
  typeof GOLDEN_CASE_EXPECTATIONS_V4[number];

export type UnifiedWalletGoldenCase = {
  readonly caseId: string;
  readonly neutralBundle: NeutralEvidenceBundleV2;
  readonly adjudication: FinalAdjudicationV2;
  readonly scoringExpectation: ScoringExpectation;
  readonly expected: ComparatorInputV1;
};

export type UnifiedWalletComparatorRunV1 = {
  readonly version: "unified-wallet-comparator-run-v1";
  readonly passed: boolean;
  readonly caseCount: number;
  readonly lockedGoldenManifestSha256: string;
  readonly results: readonly ComparatorOutputV1[];
};

const HASH_PATTERN = /^[0-9a-f]{64}$/u;

function fail(code: string): never {
  throw new Error(code);
}

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(code);
  }
  return value as Record<string, unknown>;
}

function adjudication(
  value: unknown,
  caseId: string
): FinalAdjudicationV2 {
  const source = asRecord(value, "unified_golden_adjudication_invalid");
  if (
    source.version !== "golden-adjudication-v2" ||
    source.caseId !== caseId ||
    source.selectedAttributionPolicy !== "proportional" ||
    !Number.isSafeInteger(source.exactScore) ||
    (source.exactScore as number) < 0 ||
    (source.exactScore as number) > 100 ||
    !["ACCEPTABLE", "REVIEW", "DECLINE"].includes(
      String(source.expectedDecision)
    ) ||
    !Array.isArray(source.resolvedFacts) ||
    !Array.isArray(source.scoreProperties) ||
    !Array.isArray(source.telegramExpectation)
  ) {
    fail("unified_golden_adjudication_invalid");
  }
  const aggregates = asRecord(
    source.dossierAggregates,
    "unified_golden_aggregates_invalid"
  );
  if (
    Object.values(aggregates).some((item) =>
      typeof item !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(item)
    ) ||
    source.telegramExpectation.length !== 2 ||
    new Set(source.telegramExpectation.map((item) =>
      asRecord(item, "unified_golden_telegram_invalid").locale
    )).size !== 2
  ) {
    fail("unified_golden_adjudication_invalid");
  }
  return value as FinalAdjudicationV2;
}

function semanticDriver(
  facts: readonly FinalAdjudicationV2["resolvedFacts"][number][]
): string {
  const roles = new Set(facts.map((fact) => fact.role));
  const ids = facts.map((fact) => fact.canonicalFactId).join("\n");
  const has = (role: string): boolean => roles.has(role);
  if (has("victim")) return "victim_confirmed_debit";
  if (has("approval_owner")) return "dangerous_approval_no_debit";
  if (has("recipient") && facts.some((fact) => fact.lane === "hard")) {
    return has("cex_subject")
      ? "direct_blacklist_with_safe_volume"
      : "direct_blacklist_at_event";
  }
  if (has("fan_in_fan_out_subject")) return "correlated_dense_transit";
  if (has("collector_sender")) return "collector_transit";
  if (has("high_volume_transit_wallet")) return "high_volume_transit";
  if (has("high_volume_sender")) {
    return facts.some((fact) => fact.timing === "later")
      ? "high_volume_transit_later_labels"
      : "high_volume_transit";
  }
  if (has("route_sender")) return "route_transit";
  if (has("selected_amount_sender")) return "selected_amount_transit";
  if (has("fan_out_sender")) return "fan_out";
  if (has("transit_sender")) return "rapid_forwarding";
  if (has("operational_wallet")) return "operational_wallet";
  if (has("history_subject")) return "history_depth_neutral";
  if (has("delivery_subject")) return "delivery_ambiguity_technical";
  if (has("branch_subject")) return "duplicate_evidence_neutral";
  if (has("dust_recipient")) return "dust_spam_neutral";
  if (has("coverage_subject")) return "provider_key_exhaustion";
  if (has("new_wallet_subject")) return "no_usdt_activity";
  if (has("cex_subject") || ids.includes(":Bybit:")) {
    return "clean_confirmed_context";
  }
  if (has("self_sender_recipient")) return "reorder_invariant";
  if (has("attempt_subject")) return "restart_invariant";
  if (ids.length === 0) return "empty_wallet";
  return "unknown_without_risk_pattern";
}

function neutralCandidate(
  driverCode: string
): NeutralCandidateCode | undefined {
  if (driverCode === "unknown_without_risk_pattern") {
    return "unknown_without_risk_pattern";
  }
  if (driverCode === "no_usdt_activity") return "no_usdt_activity";
  if (driverCode === "clean_confirmed_context") {
    return "clean_confirmed_context";
  }
  return undefined;
}

function sumRaw(values: readonly string[]): string {
  return values
    .reduce((sum, value) => sum + BigInt(value), 0n)
    .toString();
}

function activeBlacklistAddresses(
  bundle: NeutralEvidenceBundleV2,
  timestamp: string
): Set<string> {
  const at = Date.parse(timestamp);
  return new Set(bundle.labels
    .filter((label) =>
      label.category === "blacklist" &&
      (label.validFrom === null || Date.parse(label.validFrom) <= at) &&
      (label.validTo === null || Date.parse(label.validTo) >= at)
    )
    .map((label) => label.address));
}

function aggregateValue(
  bundle: NeutralEvidenceBundleV2,
  key: string
): string {
  const subject = bundle.subjectAddress;
  const selected = bundle.events.filter((event) => event.to === subject);
  const inbound = selected.filter((event) => event.from !== subject);
  const outbound = bundle.events.filter((event) =>
    event.from === subject && event.to !== subject
  );
  const selfTransfers = selected.filter((event) => event.from === subject);
  const selectedAmountRaw = sumRaw(selected.map((event) => event.amountRaw));
  const stateCount = (factType: string): number =>
    bundle.stateFacts.filter((fact) => fact.factType === factType).length;
  const uniqueStateCount = (factType: string): number =>
    new Set(bundle.stateFacts
      .filter((fact) => fact.factType === factType)
      .map((fact) => canonicalJson(fact))).size;
  const values: Record<string, () => string> = {
    selectedAmountRaw: () => selectedAmountRaw,
    selected_amount_raw: () => selectedAmountRaw,
    allocatedAmountRaw: () => selectedAmountRaw,
    attributed_amount_raw: () => selectedAmountRaw,
    residualAmountRaw: () => "0",
    residual_amount_raw: () => "0",
    eventCount: () => String(bundle.events.length),
    event_count: () => String(bundle.events.length),
    logicalTransferCount: () =>
      String(new Set(bundle.events.map((event) => event.txHash)).size),
    uniqueTxCount: () =>
      String(new Set(bundle.events.map((event) => event.txHash)).size),
    inbound_amount_raw: () =>
      sumRaw(inbound.map((event) => event.amountRaw)),
    outbound_amount_raw: () =>
      sumRaw(outbound.map((event) => event.amountRaw)),
    self_transfer_amount_raw: () =>
      sumRaw(selfTransfers.map((event) => event.amountRaw)),
    inbound_counterparty_count: () =>
      String(new Set(inbound.map((event) => event.from)).size),
    outbound_counterparty_count: () =>
      String(new Set(outbound.map((event) => event.to)).size),
    labelCount: () => String(bundle.labels.length),
    label_count: () => String(bundle.labels.length),
    approvalCount: () => String(bundle.approvals.length),
    approval_count: () => String(bundle.approvals.length),
    approval_amount_raw: () =>
      sumRaw(bundle.approvals.map((approval) => approval.amountRaw)),
    stateFactCount: () => String(bundle.stateFacts.length),
    state_fact_count: () => String(bundle.stateFacts.length),
    direct_history_page_count: () => String(stateCount("direct_history_page")),
    exhausted_provider_key_count: () =>
      String(stateCount("provider_key_exhausted")),
    duplicate_state_fact_count: () =>
      String(stateCount("duplicate_evidence")),
    unique_duplicate_fact_count: () =>
      String(uniqueStateCount("duplicate_evidence")),
    replay_state_fact_count: () =>
      String(stateCount("immutable_attempt_replay")),
    unique_replay_fact_count: () =>
      String(uniqueStateCount("immutable_attempt_replay")),
    confirmed_debit_count: () =>
      String(stateCount("confirmed_victim_debit")),
    blacklisted_inbound_amount_raw: () =>
      sumRaw(inbound
        .filter((event) =>
          activeBlacklistAddresses(bundle, event.timestamp).has(event.from)
        )
        .map((event) => event.amountRaw))
  };
  return values[key]?.() ??
    fail(`unified_golden_aggregate_key_unsupported:${key}`);
}

function dossierAggregates(
  bundle: NeutralEvidenceBundleV2,
  lockedKeys: readonly string[]
): Record<string, string> {
  return Object.fromEntries(
    [...lockedKeys].sort(lexical).map((key) => [
      key,
      aggregateValue(bundle, key)
    ])
  );
}

function artifactHash(value: unknown): string {
  const result = fingerprintCanonicalArtifact(value);
  if (!HASH_PATTERN.test(result)) fail("unified_golden_hash_invalid");
  return result;
}

function replayCandidate(
  goldenCase: Omit<UnifiedWalletGoldenCase, "expected">
): ComparatorInputV1 {
  const { adjudication: locked, neutralBundle: neutral } = goldenCase;
  const { driverCode, matrix } = replayScoring(goldenCase);
  const anchor = buildScoreAnchorV3({
    subjectAddress: neutral.subjectAddress,
    matrix
  });
  const manifest: AnalysisManifestV1 = {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId: `golden-replay-${goldenCase.caseId}`,
    requestHash: artifactHash({
      version: "golden-replay-request-v1",
      caseId: goldenCase.caseId,
      subjectAddress: neutral.subjectAddress
    }),
    snapshotHash: artifactHash(neutral.snapshot),
    chain: "tron",
    subjectAddress: neutral.subjectAddress,
    confirmedBlockNumber: neutral.snapshot.confirmedBlockNumber,
    confirmedBlockHash: neutral.snapshot.confirmedBlockHash,
    confirmedBlockTimestamp: neutral.snapshot.timestamp,
    labelDatasetSha256: neutral.snapshot.labelDatasetSha256,
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    traversalPolicyVersion: "snapshot-closure-v1",
    runtimeCommit: "golden-v2-locked-replay",
    databaseSchemaVersion: 33,
    paginationCutoffBlockNumber: neutral.snapshot.confirmedBlockNumber,
    paginationCutoffBlockHash: neutral.snapshot.confirmedBlockHash,
    branchArtifactHashes: {
      fast: artifactHash([goldenCase.caseId, "fast"]),
      deep: artifactHash([goldenCase.caseId, "deep"]),
      where: artifactHash([goldenCase.caseId, "where"])
    }
  };
  const analysisManifestSha256 = artifactHash(manifest);
  const evidence: EvidenceBundleV1 = {
    version: "evidence-bundle-v1",
    schemaVersion: 1,
    analysisManifestHash: analysisManifestSha256,
    canonicalFactsHash: artifactHash(matrix.facts),
    canonicalFactIds: [...matrix.canonicalFactIds],
    acceptedChildAttemptHashes: {
      fast: artifactHash([goldenCase.caseId, "fast", "accepted"]),
      deep: artifactHash([goldenCase.caseId, "deep", "accepted"]),
      where: artifactHash([goldenCase.caseId, "where", "accepted"])
    },
    branchOutputHashes: {
      fast: null,
      deep: null,
      where: null
    }
  };
  const evidenceBundleSha256 = artifactHash(evidence);
  const closure: TraversalClosureCertificateV1 = {
    version: "traversal-closure-certificate-v1",
    schemaVersion: 1,
    analysisManifestHash: analysisManifestSha256,
    snapshotHash: manifest.snapshotHash,
    visitedStateHash: artifactHash([
      goldenCase.caseId,
      "visited",
      neutral.events,
      neutral.stateFacts
    ]),
    frontierHash: artifactHash([goldenCase.caseId, "frontier", []]),
    closed: true
  };
  const scoring: ScoringBundleV1 = {
    version: "scoring-bundle-v1",
    schemaVersion: 1,
    evidenceBundleHash: evidenceBundleSha256,
    traversalClosureHash: artifactHash(closure),
    policyVersion: "scoring-signal-matrix-v4",
    scoreAnchorHash: artifactHash(anchor),
    score: matrix.score,
    decision: matrix.decision
  };
  const walletMetrics: WalletMetrics = {
    version: "unified-wallet-metrics-v1",
    asOfBlock: neutral.snapshot.confirmedBlockNumber,
    observedAt: neutral.snapshot.timestamp,
    consistency: "snapshot_exact",
    profile: {
      createdAt: null,
      firstUsdtActivityAt: null,
      lastUsdtActivityAt: null,
      incomingUsdtTransferCount: 0,
      outgoingUsdtTransferCount: 0,
      snapshotUsdtBalanceRaw: "0",
      snapshotTrxBalanceSun: "0",
      liveBalanceObservation: null
    },
    scoreDrivers: [{
      code: driverCode,
      factIds: [...matrix.canonicalFactIds],
      collapsedFactCount: matrix.canonicalFactIds.length
    }],
    currentBalanceAttribution: {
      scope: "current_balance_attribution",
      denominatorRaw: "0",
      rows: []
    },
    outgoingMovement: {
      scope: "all_direct_outgoing_to_snapshot",
      denominatorRaw: "0",
      rows: []
    },
    serviceLinks: [],
    contractsAndApprovals: [],
    behaviorAndConnections: [],
    coverage: [],
    principalInboundEvents: [],
    negativeFacts: []
  };
  const report = buildUnifiedWalletReport({
    manifest,
    evidence,
    closure,
    scoring,
    walletMetrics,
    selectedAttributionPolicy: "proportional"
  });
  const reportSha256 = artifactHash(report);
  const presentations = (["ru", "en"] as const)
    .map((locale) => {
      const rendered = renderUnifiedWalletPresentation({
        report,
        manifest: buildPresentationManifest(report, locale)
      });
      const expectation = presentationExpectation(
        reportSha256,
        locale,
        rendered.artifact.html
      );
      return {
        locale,
        html: rendered.artifact.html,
        presentationSha256: expectation.presentationSha256
      };
    })
    .sort((left, right) => lexical(left.locale, right.locale));
  return parseComparatorInputV1({
    version: "unified-wallet-comparator-input-v1",
    caseId: goldenCase.caseId,
    analysisManifestSha256,
    evidenceBundleSha256,
    reportSha256,
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    score: matrix.score,
    decision: matrix.decision,
    anchor: {
      ...anchor,
      canonicalFactIds: [...anchor.canonicalFactIds],
      primaryFactIds: [...anchor.primaryFactIds]
    },
    dossierAggregates: dossierAggregates(
      neutral,
      Object.keys(locked.dossierAggregates)
    ),
    presentations
  });
}

function replayScoring(
  goldenCase: Pick<
    UnifiedWalletGoldenCase,
    "adjudication" | "neutralBundle" | "scoringExpectation"
  >,
  extraFacts: readonly CanonicalFactV1[] = [],
  coverage?: unknown
) {
  const driverCode = semanticDriver(goldenCase.adjudication.resolvedFacts);
  const facts = canonicalizeAdjudicatedFactsV4({
    subjectAddress: goldenCase.neutralBundle.subjectAddress,
    facts: goldenCase.scoringExpectation.facts
  });
  const matrix = scoreSignalMatrixV4({
    subjectAddress: goldenCase.neutralBundle.subjectAddress,
    facts: [...facts, ...extraFacts],
    neutralCandidate: neutralCandidate(driverCode),
    coverage
  } as Parameters<typeof scoreSignalMatrixV4>[0] & { coverage?: unknown });
  return { driverCode, facts, matrix };
}

function lockedExpectation(
  goldenCase: Omit<UnifiedWalletGoldenCase, "expected">,
  production: ComparatorInputV1
): ComparatorInputV1 {
  const locked = goldenCase.adjudication;
  const presentations = [...locked.telegramExpectation]
    .sort((left, right) => lexical(left.locale, right.locale))
    .map((item) => ({
      locale: item.locale,
      html: item.exactHtml,
      presentationSha256: presentationExpectation(
        production.reportSha256,
        item.locale,
        item.exactHtml
      ).presentationSha256
    }));
  return parseComparatorInputV1({
    ...production,
    score: locked.exactScore,
    decision: locked.expectedDecision,
    anchor: {
      ...production.anchor,
      score: locked.exactScore,
      decision: locked.expectedDecision
    },
    dossierAggregates: locked.dossierAggregates,
    presentations
  });
}

export async function loadUnifiedWalletGoldenCases(
  goldenRoot: string
): Promise<UnifiedWalletGoldenCase[]> {
  const verified = await verifyLockedGoldenRoot(
    goldenRoot,
    LOCKED_GOLDEN_MANIFEST_SHA256
  );
  const bindings = new Map<string, ScoringExpectation>(
    GOLDEN_CASE_EXPECTATIONS_V4.map((item) => [item.rowId, item])
  );
  const result: UnifiedWalletGoldenCase[] = [];
  for (const manifestCase of [...verified.manifest.cases]
    .sort((left, right) => lexical(left.caseId, right.caseId))) {
    const caseRoot = join(goldenRoot, "cases", manifestCase.caseId);
    const rawNeutral = JSON.parse(
      await readFile(join(caseRoot, "neutral-bundle.json"), "utf8")
    ) as unknown;
    const rawAdjudication = JSON.parse(
      await readFile(join(caseRoot, "adjudication.json"), "utf8")
    ) as unknown;
    const neutral = buildNeutralExport({
      ...asRecord(rawNeutral, "unified_golden_neutral_bundle_invalid"),
      version: "frozen-evidence-source-v2"
    }).bundle;
    const locked = adjudication(rawAdjudication, manifestCase.caseId);
    const binding = bindings.get(manifestCase.caseId) ??
      fail(`unified_golden_scoring_binding_missing:${manifestCase.caseId}`);
    if (
      neutral.caseId !== manifestCase.caseId ||
      canonicalSha256(neutral) !== manifestCase.neutralBundleSha256 ||
      canonicalSha256(rawAdjudication) !== manifestCase.adjudicationSha256 ||
      binding.exactScore !== locked.exactScore ||
      binding.expectedDecision !== locked.expectedDecision ||
      !equal(binding.facts, locked.resolvedFacts) ||
      !equal(binding.scoreProperties, locked.scoreProperties)
    ) {
      fail(`unified_golden_case_binding_mismatch:${manifestCase.caseId}`);
    }
    const base = {
      caseId: manifestCase.caseId,
      neutralBundle: neutral,
      adjudication: locked,
      scoringExpectation: binding
    };
    const production = replayCandidate(base);
    result.push({
      ...base,
      expected: lockedExpectation(base, production)
    });
  }
  if (result.length !== bindings.size) {
    fail("unified_golden_case_set_mismatch");
  }
  return result;
}

export function buildUnifiedWalletGoldenReplayCandidate(
  goldenCase: UnifiedWalletGoldenCase
): ComparatorInputV1 {
  return replayCandidate(goldenCase);
}

function pushViolation(
  violations: GoldenComparatorViolation[],
  property: GoldenComparatorViolation["property"],
  expected: unknown,
  actual: unknown
): void {
  if (!equal(expected, actual)) {
    violations.push({ property, expected, actual });
  }
}

function stableViolations(
  violations: readonly GoldenComparatorViolation[]
): GoldenComparatorViolation[] {
  return [...violations].sort((left, right) =>
    lexical(left.property, right.property) ||
    lexical(canonicalJson(left.expected), canonicalJson(right.expected)) ||
    lexical(canonicalJson(left.actual), canonicalJson(right.actual))
  );
}

export function compareUnifiedWalletGolden(
  expectedValue: ComparatorInputV1,
  candidateValue: unknown
): ComparatorOutputV1 {
  const expected = parseComparatorInputV1(expectedValue);
  const violations: GoldenComparatorViolation[] = [];
  let candidate: ComparatorInputV1;
  try {
    candidate = parseComparatorInputV1(candidateValue);
  } catch (error) {
    return {
      version: "unified-wallet-comparator-output-v1",
      caseId: expected.caseId,
      passed: false,
      violations: [{
        property: "hash",
        expected: "valid unified-wallet-comparator-input-v1",
        actual: error instanceof Error ? error.message : String(error)
      }]
    };
  }
  const lockedInputSha256 =
    GOLDEN_COMPARATOR_V1_LOCK.inputSha256ByCase[
      expected.caseId as keyof
        typeof GOLDEN_COMPARATOR_V1_LOCK.inputSha256ByCase
    ];
  if (
    GOLDEN_COMPARATOR_V1_LOCK.lockedGoldenManifestSha256 !==
      LOCKED_GOLDEN_MANIFEST_SHA256 ||
    lockedInputSha256 === undefined
  ) {
    fail("unified_golden_comparator_lock_missing");
  }
  pushViolation(
    violations,
    "hash",
    { name: "lockedComparatorInputSha256", value: lockedInputSha256 },
    {
      name: "lockedComparatorInputSha256",
      value: canonicalSha256(candidate)
    }
  );
  pushViolation(violations, "relation", expected.caseId, candidate.caseId);
  pushViolation(violations, "score", expected.score, candidate.score);
  pushViolation(
    violations,
    "decision",
    expected.decision,
    candidate.decision
  );
  pushViolation(violations, "anchor", expected.anchor, candidate.anchor);
  for (const name of [
    "analysisManifestSha256",
    "evidenceBundleSha256",
    "reportSha256"
  ] as const) {
    pushViolation(
      violations,
      "hash",
      { name, value: expected[name] },
      { name, value: candidate[name] }
    );
  }
  const aggregateKeys = new Set([
    ...Object.keys(expected.dossierAggregates),
    ...Object.keys(candidate.dossierAggregates)
  ]);
  for (const key of [...aggregateKeys].sort(lexical)) {
    pushViolation(
      violations,
      "aggregate",
      { key, value: expected.dossierAggregates[key] ?? null },
      { key, value: candidate.dossierAggregates[key] ?? null }
    );
  }
  const presentations = new Map(
    candidate.presentations.map((item) => [item.locale, item])
  );
  for (const item of expected.presentations) {
    const actual = presentations.get(item.locale) ?? null;
    pushViolation(
      violations,
      "presentation",
      { locale: item.locale, html: item.html },
      { locale: item.locale, html: actual?.html ?? null }
    );
    pushViolation(
      violations,
      "hash",
      {
        name: `presentation:${item.locale}`,
        value: item.presentationSha256
      },
      {
        name: `presentation:${item.locale}`,
        value: actual?.presentationSha256 ?? null
      }
    );
  }
  const stable = stableViolations(violations);
  return {
    version: "unified-wallet-comparator-output-v1",
    caseId: expected.caseId,
    passed: stable.length === 0,
    violations: stable
  };
}

function propertyFact(
  sequence: number,
  overrides: Partial<CanonicalFactInput> = {}
): CanonicalFactV1 {
  const input: CanonicalFactInput = {
    profile: "state",
    chain: "tron",
    factType: `ordinary_transfer_${sequence}`,
    subject: "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
    counterpartyOrObject: null,
    subjectRole: "subject",
    effectiveAt: null,
    snapshotBlock: "84713573",
    lane: "neutral",
    strength: "exact",
    sourceBranch: "fast",
    directness: "direct",
    timing: "current",
    payload: null,
    ...overrides
  } as CanonicalFactInput;
  return canonicalizeEvidenceFacts({ facts: [input] }).inventory.facts[0]!;
}

export function compareUnifiedWalletGoldenPropertyReplay():
GoldenComparatorViolation[] {
  const subjectAddress = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
  const violations: GoldenComparatorViolation[] = [];
  const dense = propertyFact(1, {
    factType: "dense_fan_in_fan_out",
    lane: "pattern",
    strength: "corroborated"
  });
  const ordinary = propertyFact(2);
  const baseline = scoreSignalMatrixV4({
    subjectAddress,
    facts: [dense, ordinary],
    coverage: { observed: 1 }
  } as Parameters<typeof scoreSignalMatrixV4>[0] & { coverage: unknown });
  const reordered = scoreSignalMatrixV4({
    subjectAddress,
    facts: [ordinary, dense, dense],
    coverage: { observed: 999 }
  } as Parameters<typeof scoreSignalMatrixV4>[0] & { coverage: unknown });
  pushViolation(
    violations,
    "relation",
    { property: "coverage_duplicate_reorder_invariant", result: baseline },
    { property: "coverage_duplicate_reorder_invariant", result: reordered }
  );

  const hardInput: CanonicalFactInput = {
    profile: "event",
    chain: "tron",
    tokenContract: "USDT",
    txHash: "f".repeat(64),
    eventIndex: 1,
    factType: "blacklisted_at_transfer",
    subject: subjectAddress,
    counterparty: "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9",
    subjectRole: "receiver",
    lane: "hard",
    strength: "exact",
    sourceBranch: "deep",
    directness: "direct",
    timing: "at_event",
    payload: null
  };
  const direct = scoreSignalMatrixV4({
    subjectAddress,
    facts: [canonicalizeEvidenceFacts({
      facts: [hardInput]
    }).inventory.facts[0]!]
  });
  const indirect = scoreSignalMatrixV4({
    subjectAddress,
    facts: [canonicalizeEvidenceFacts({
      facts: [{
        ...hardInput,
        profile: "path",
        orderedEventFactIds: ["event-a"],
        lane: "context",
        strength: "corroborated",
        directness: "indirect"
      }]
    }).inventory.facts[0]!]
  });
  const later = scoreSignalMatrixV4({
    subjectAddress,
    facts: [propertyFact(3, {
      factType: "counterparty_later_frozen",
      lane: "context",
      strength: "contextual",
      subjectRole: "receiver",
      timing: "later"
    })]
  });
  const victim = scoreSignalMatrixV4({
    subjectAddress,
    facts: [propertyFact(4, {
      factType: "confirmed_victim_debit",
      lane: "hard",
      subjectRole: "victim",
      timing: "at_event"
    })]
  });
  const diluted = scoreSignalMatrixV4({
    subjectAddress,
    facts: [
      canonicalizeEvidenceFacts({
        facts: [hardInput]
      }).inventory.facts[0]!,
      ...Array.from({ length: 99 }, (_, index) =>
        propertyFact(index + 10))
    ]
  });
  const semanticActual = {
    direct: direct.score,
    indirect: indirect.score,
    later: later.score,
    victim: victim.score,
    hardWithSafeVolume: diluted.score
  };
  pushViolation(
    violations,
    "relation",
    {
      direct: 90,
      indirect: 0,
      later: 0,
      victim: 50,
      hardWithSafeVolume: 90
    },
    semanticActual
  );
  const retry = scoreSignalMatrixV4({
    subjectAddress,
    facts: [ordinary, dense]
  });
  pushViolation(
    violations,
    "relation",
    {
      property: "retry_restart_byte_identity",
      sha256: artifactHash(baseline)
    },
    {
      property: "retry_restart_byte_identity",
      sha256: artifactHash(retry)
    }
  );
  return stableViolations(violations);
}

function caseFact(
  goldenCase: UnifiedWalletGoldenCase,
  sequence: string,
  overrides: Partial<CanonicalFactInput> = {}
): CanonicalFactV1 {
  const input: CanonicalFactInput = {
    profile: "state",
    chain: "tron",
    factType: `score_property_context_${sequence}`,
    subject: goldenCase.neutralBundle.subjectAddress,
    counterpartyOrObject: null,
    subjectRole: "subject",
    effectiveAt: null,
    snapshotBlock: goldenCase.neutralBundle.snapshot.confirmedBlockNumber,
    lane: "neutral",
    strength: "exact",
    sourceBranch: "fast",
    directness: "direct",
    timing: "current",
    payload: null,
    ...overrides
  } as CanonicalFactInput;
  return canonicalizeEvidenceFacts({ facts: [input] }).inventory.facts[0]!;
}

function sameScoreRelation(
  left: ReturnType<typeof replayScoring>["matrix"],
  right: ReturnType<typeof replayScoring>["matrix"]
): boolean {
  return equal(
    {
      score: left.score,
      decision: left.decision,
      matrixRow: left.matrixRow
    },
    {
      score: right.score,
      decision: right.decision,
      matrixRow: right.matrixRow
    }
  );
}

function mutationInvariant(
  goldenCase: UnifiedWalletGoldenCase,
  property: string
): boolean {
  const baseline = replayScoring(goldenCase);
  if (property.includes("coverage")) {
    return sameScoreRelation(
      baseline.matrix,
      replayScoring(goldenCase, [], {
        depth: 500,
        coveredPpm: 1
      }).matrix
    );
  }
  if (
    /duplicate|replay|retry|reordering|event_order|self_transfer_order|same_input/u
      .test(property)
  ) {
    const reordered = scoreSignalMatrixV4({
      subjectAddress: goldenCase.neutralBundle.subjectAddress,
      facts: [
        ...[...baseline.facts].reverse(),
        ...(baseline.facts[0] ? [baseline.facts[0]] : [])
      ],
      neutralCandidate: neutralCandidate(baseline.driverCode)
    });
    return sameScoreRelation(baseline.matrix, reordered);
  }
  const factType = /unknown|unlabeled/u.test(property)
    ? "unknown_source"
    : /metadata|service|created_by_contract/u.test(property)
      ? "created_by_contract_metadata"
      : "safe_context_transfer";
  const context = caseFact(goldenCase, property, {
    factType,
    lane: factType === "created_by_contract_metadata"
      ? "context"
      : "neutral",
    strength: factType === "created_by_contract_metadata"
      ? "contextual"
      : "exact"
  });
  return sameScoreRelation(
    baseline.matrix,
    replayScoring(goldenCase, [context]).matrix
  );
}

function attributionInvariant(goldenCase: UnifiedWalletGoldenCase): boolean {
  const inbound = goldenCase.neutralBundle.events
    .filter((event) => event.to === goldenCase.neutralBundle.subjectAddress)
    .map((event) => ({
      eventId: canonicalEventFactId(event),
      amountRaw: event.amountRaw,
      timestamp: event.timestamp
    }));
  const comparison = compareAttributionPolicies({
    selectedAmountRaw: sumRaw(inbound.map((event) => event.amountRaw)),
    inbound
  });
  const allocations = (value: typeof comparison.fifo) =>
    [...value.allocations].sort((left, right) =>
      lexical(left.eventId, right.eventId)
    );
  return equal(allocations(comparison.fifo), allocations(comparison.lifo)) &&
    equal(
      allocations(comparison.fifo),
      allocations(comparison.proportional)
    ) &&
    comparison.fifo.allocatedAmountRaw ===
      comparison.proportional.allocatedAmountRaw &&
    comparison.fifo.residualAmountRaw ===
      comparison.proportional.residualAmountRaw;
}

function propertySatisfied(
  goldenCase: UnifiedWalletGoldenCase,
  candidate: ComparatorInputV1,
  property: string
): boolean | "unsupported_locked_score_property" {
  if (!(goldenCase.scoringExpectation.scoreProperties as readonly string[])
    .includes(property)) {
    return "unsupported_locked_score_property";
  }
  if (
    candidate.score !== goldenCase.adjudication.exactScore ||
    candidate.decision !== goldenCase.adjudication.expectedDecision
  ) {
    return false;
  }
  if (
    property === "attribution_policies_preserve_the_same_event_allocations" ||
    property === "empty_attribution_is_policy_invariant"
  ) {
    return attributionInvariant(goldenCase);
  }
  if (property.startsWith("relation:")) {
    const expected = property.endsWith("=>decline")
      ? "DECLINE"
      : property.endsWith("=>review") ||
          property.endsWith("=>pattern_review") ||
          property.endsWith("=>compliance_review")
        ? "REVIEW"
        : property.endsWith("=>neutral_context")
          ? "ACCEPTABLE"
          : null;
    return expected === null
      ? "unsupported_locked_score_property"
      : candidate.decision === expected;
  }
  if (
    /coverage|duplicate|replay|retry|reordering|event_order|self_transfer_order|same_input|unknown_counterparty|metadata|service_metadata|neutral_service|unlabeled|safe_context|created_by_contract/u
      .test(property)
  ) {
    return mutationInvariant(goldenCase, property);
  }
  if (
    /direct_at_event_hard_evidence|subject_role_and_event_timing/u
      .test(property)
  ) {
    return candidate.score >= 90 &&
      candidate.decision === "DECLINE" &&
      goldenCase.adjudication.resolvedFacts.some((fact) =>
        fact.lane === "hard" &&
        fact.directness === "direct" &&
        fact.timing === "at_event"
      ) &&
      compareUnifiedWalletGoldenPropertyReplay().length === 0;
  }
  if (
    /victim|outbound_debit/u.test(property)
  ) {
    const victimRole = goldenCase.adjudication.resolvedFacts.some((fact) =>
      fact.role === "victim"
    );
    if (property.includes("outbound_debit")) {
      return victimRole &&
        candidate.dossierAggregates.selected_amount_raw === "0" &&
        candidate.dossierAggregates.inbound_amount_raw === "0";
    }
    return victimRole &&
      candidate.score === 50 &&
      candidate.decision === "REVIEW";
  }
  if (/approval/u.test(property)) {
    return candidate.dossierAggregates.confirmed_debit_count === "0" &&
      candidate.decision === "REVIEW";
  }
  if (
    /requires_review|bounded_review_context|high_throughput_hub_activity/u
      .test(property)
  ) {
    return candidate.decision === "REVIEW" &&
      candidate.score > 5 &&
      candidate.score < 90;
  }
  if (
    /not_hard_proof|no_decline|without_hard_authority|without_sanctions_evidence/u
      .test(property)
  ) {
    return candidate.decision !== "DECLINE";
  }
  if (
    /empty_evidence_set|no_adverse_evidence|delivery_uncertainty|provider_key_exhaustion|provider_failure|wallet_newness|operational_age|operational_wallet_status|unsolicited_dust|direct_legitimate_cex|known_cex_source/u
      .test(property)
  ) {
    return candidate.decision === "ACCEPTABLE" && candidate.score <= 5;
  }
  if (
    /does_not_create_positive_risk|does_not_raise_risk|does_not_raise_subject_risk|does_not_imply_subject_risk|without_a_pattern_does_not_create_risk/u
      .test(property)
  ) {
    return candidate.decision === "ACCEPTABLE" && candidate.score <= 5;
  }
  return "unsupported_locked_score_property";
}

export function compareUnifiedWalletGoldenScoreProperties(
  goldenCase: UnifiedWalletGoldenCase,
  candidateValue: unknown
): {
  readonly evaluatedProperties: readonly string[];
  readonly violations: readonly GoldenComparatorViolation[];
} {
  let candidate: ComparatorInputV1;
  try {
    candidate = parseComparatorInputV1(candidateValue);
  } catch (error) {
    return {
      evaluatedProperties: [],
      violations: [{
        property: "relation",
        expected: "valid unified-wallet-comparator-input-v1",
        actual: error instanceof Error ? error.message : String(error)
      }]
    };
  }
  const evaluatedProperties: string[] = [];
  const violations: GoldenComparatorViolation[] = [];
  for (const property of [...goldenCase.adjudication.scoreProperties]
    .sort(lexical)) {
    const actual = propertySatisfied(goldenCase, candidate, property);
    if (actual === "unsupported_locked_score_property") {
      violations.push({
        property: "relation",
        expected: { property, satisfied: true },
        actual: { property, error: actual }
      });
      continue;
    }
    evaluatedProperties.push(property);
    if (!actual) {
      violations.push({
        property: "relation",
        expected: { property, satisfied: true },
        actual: { property, satisfied: false }
      });
    }
  }
  return {
    evaluatedProperties,
    violations: stableViolations(violations)
  };
}

function withViolations(
  output: ComparatorOutputV1,
  extra: readonly GoldenComparatorViolation[]
): ComparatorOutputV1 {
  const violations = stableViolations([
    ...output.violations.map((item) => ({
      ...item,
      property: item.property as GoldenComparatorViolation["property"]
    })),
    ...extra
  ]);
  return {
    ...output,
    passed: violations.length === 0,
    violations
  };
}

export async function compareUnifiedWalletGoldenRoot(input: {
  readonly goldenRoot: string;
  readonly candidateRoot: string;
}): Promise<UnifiedWalletComparatorRunV1> {
  const cases = await loadUnifiedWalletGoldenCases(input.goldenRoot);
  const results: ComparatorOutputV1[] = [];
  for (const goldenCase of cases) {
    try {
      const value = JSON.parse(
        await readFile(
          join(input.candidateRoot, `${goldenCase.caseId}.json`),
          "utf8"
        )
      ) as unknown;
      const compared = compareUnifiedWalletGolden(
        goldenCase.expected,
        value
      );
      const properties = compareUnifiedWalletGoldenScoreProperties(
        goldenCase,
        value
      );
      results.push(withViolations(compared, properties.violations));
    } catch (error) {
      results.push({
        version: "unified-wallet-comparator-output-v1",
        caseId: goldenCase.caseId,
        passed: false,
        violations: [{
          property: "hash",
          expected: `${goldenCase.caseId}.json`,
          actual: error instanceof Error ? error.message : String(error)
        }]
      });
    }
  }
  const expectedFiles = cases.map((item) => `${item.caseId}.json`).sort();
  const actualFiles = (await readdir(input.candidateRoot, {
    withFileTypes: true
  }))
    .filter((item) => item.isFile() && item.name.endsWith(".json"))
    .map((item) => item.name)
    .sort();
  const globalViolations = compareUnifiedWalletGoldenPropertyReplay();
  if (!equal(expectedFiles, actualFiles)) {
    globalViolations.push({
      property: "hash",
      expected: { candidateFiles: expectedFiles },
      actual: { candidateFiles: actualFiles }
    });
  }
  if (globalViolations.length > 0 && results.length > 0) {
    results[0] = withViolations(results[0]!, globalViolations);
  }
  return {
    version: "unified-wallet-comparator-run-v1",
    passed: results.every((item) => item.passed),
    caseCount: results.length,
    lockedGoldenManifestSha256: LOCKED_GOLDEN_MANIFEST_SHA256,
    results
  };
}
