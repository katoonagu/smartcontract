import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintCanonicalArtifact } from "../src/forensics/canonicalJson";
import { verifyLockedGoldenRoot } from "../tools/golden-pilot-v2/lockedManifest";

type AttributionPolicy = "fifo" | "lifo" | "proportional";
type GoldenDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";
type GoldenLane = "hard" | "pattern" | "context" | "neutral";
type GoldenDirectness = "direct" | "indirect";
type GoldenTiming = "at_event" | "later" | "current" | "unknown";

type LockedManifestCase = {
  caseId: string;
  adjudicationSha256: string;
};

type LockedGoldenManifestV2 = {
  version: "locked-golden-manifest-v2";
  scoringPolicyVersion: "scoring-signal-matrix-v4";
  selectedAttributionPolicy: AttributionPolicy;
  cases: LockedManifestCase[];
};

type AdjudicatedFact = {
  canonicalFactId: string;
  lane: GoldenLane;
  role: string;
  directness: GoldenDirectness;
  timing: GoldenTiming;
};

type GoldenAdjudicationV2 = {
  version: "golden-adjudication-v2";
  caseId: string;
  selectedAttributionPolicy: AttributionPolicy;
  expectedDecision: GoldenDecision;
  exactScore: number;
  resolvedFacts: AdjudicatedFact[];
  scoreProperties: string[];
};

export type GeneratedScoringPolicyV4Row = {
  rowId: string;
  exactScore: number;
  expectedDecision: GoldenDecision;
  facts: AdjudicatedFact[];
  scoreProperties: string[];
};

type GeneratedSemanticScoringRuleV4 = {
  ruleId: string;
  adjudicatedSourceCaseId: string;
  exactScore: number;
  expectedDecision: GoldenDecision;
};

export type GenerateUnifiedGoldenBindingsInput = {
  goldenRoot: string;
  attributionOutput: string;
  scoringOutput: string;
  replace?: boolean;
};

export type GenerateUnifiedGoldenBindingsResult = {
  lockedGoldenManifestSha256: string;
  selectedAttributionPolicy: AttributionPolicy;
  rows: GeneratedScoringPolicyV4Row[];
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_HASH_PATTERN =
  /LOCKED_GOLDEN_MANIFEST_SHA256 = "([a-f0-9]{64})"/;
export const APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256 =
  "4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407";

const SEMANTIC_RULE_SOURCES = [
  ["direct_blacklist_at_event", "synthetic-direct-blacklist-1pct"],
  ["victim_confirmed_debit", "synthetic-victim-debit"],
  ["dangerous_approval_no_debit", "synthetic-dangerous-approval-no-debit"],
  ["correlated_dense_transit", "synthetic-dense-wallet"],
  ["high_volume_transit", "blind-incoming-deposit-scope"],
  ["collector_transit", "regression-tbl7"],
  ["route_transit", "blind-route-scope"],
  ["selected_amount_transit", "blind-selected-amount-scope"],
  ["fan_out", "blind-wallet-scope"],
  ["rapid_forwarding", "blind-history-scope"],
  ["operational_wallet", "synthetic-operational-wallet"],
  ["clean_confirmed_context", "synthetic-one-legitimate-transfer"],
  ["neutral_no_observed_risk", "synthetic-empty-wallet"],
  ["unknown_without_risk_pattern", "synthetic-unknown-no-pattern"],
  ["no_usdt_activity", "synthetic-new-no-usdt"]
] as const;

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string): never {
  throw new Error(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parsePolicy(value: unknown): AttributionPolicy {
  if (value !== "fifo" && value !== "lifo" && value !== "proportional") {
    fail("unified_golden_invalid_attribution_policy");
  }
  return value;
}

function parseDecision(value: unknown): GoldenDecision {
  if (value !== "ACCEPTABLE" && value !== "REVIEW" && value !== "DECLINE") {
    fail("unified_golden_invalid_decision");
  }
  return value;
}

function parseManifest(value: unknown): LockedGoldenManifestV2 {
  if (!isRecord(value) || value.version !== "locked-golden-manifest-v2") {
    fail("unified_golden_manifest_not_locked");
  }
  if (value.scoringPolicyVersion !== "scoring-signal-matrix-v4") {
    fail("unified_golden_wrong_scoring_policy_version");
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0) {
    fail("unified_golden_cases_missing");
  }
  const cases = value.cases.map((candidate): LockedManifestCase => {
    if (!isRecord(candidate) || !nonEmptyString(candidate.caseId) ||
      typeof candidate.adjudicationSha256 !== "string" ||
      !SHA256_PATTERN.test(candidate.adjudicationSha256)) {
      fail("unified_golden_invalid_manifest_case");
    }
    return {
      caseId: candidate.caseId,
      adjudicationSha256: candidate.adjudicationSha256
    };
  });
  if (new Set(cases.map((candidate) => candidate.caseId)).size !== cases.length) {
    fail("unified_golden_duplicate_case_id");
  }
  return {
    version: value.version,
    scoringPolicyVersion: value.scoringPolicyVersion,
    selectedAttributionPolicy: parsePolicy(value.selectedAttributionPolicy),
    cases
  };
}

function parseAdjudicatedFact(value: unknown): AdjudicatedFact {
  if (!isRecord(value) || !nonEmptyString(value.canonicalFactId) ||
    !nonEmptyString(value.role)) {
    fail("unified_golden_invalid_adjudicated_fact");
  }
  if (!["hard", "pattern", "context", "neutral"].includes(String(value.lane)) ||
    !["direct", "indirect"].includes(String(value.directness)) ||
    !["at_event", "later", "current", "unknown"].includes(String(value.timing))) {
    fail("unified_golden_invalid_adjudicated_fact");
  }
  return {
    canonicalFactId: value.canonicalFactId,
    lane: value.lane as GoldenLane,
    role: value.role,
    directness: value.directness as GoldenDirectness,
    timing: value.timing as GoldenTiming
  };
}

function parseAdjudication(value: unknown): GoldenAdjudicationV2 {
  if (!isRecord(value) || value.version !== "golden-adjudication-v2") {
    fail("unified_golden_case_not_adjudicated");
  }
  if (!nonEmptyString(value.caseId) || !Array.isArray(value.resolvedFacts) ||
    !Array.isArray(value.scoreProperties) ||
    !value.scoreProperties.every(nonEmptyString) ||
    !Number.isSafeInteger(value.exactScore) ||
    (value.exactScore as number) < 0 ||
    (value.exactScore as number) > 100) {
    fail("unified_golden_invalid_adjudication");
  }
  if (value.scoreProperties.includes("limited_coverage_floor")) {
    fail("unified_golden_coverage_floor_forbidden");
  }
  return {
    version: value.version,
    caseId: value.caseId,
    selectedAttributionPolicy: parsePolicy(value.selectedAttributionPolicy),
    expectedDecision: parseDecision(value.expectedDecision),
    exactScore: value.exactScore as number,
    resolvedFacts: value.resolvedFacts.map(parseAdjudicatedFact),
    scoreProperties: [...new Set(value.scoreProperties)].sort()
  };
}

function canonicalFacts(facts: readonly AdjudicatedFact[]): AdjudicatedFact[] {
  const unique = new Map<string, AdjudicatedFact>();
  for (const fact of facts) {
    const key = [
      fact.canonicalFactId,
      fact.lane,
      fact.role,
      fact.directness,
      fact.timing
    ].join("\u0000");
    unique.set(key, fact);
  }
  return [...unique.values()].sort((left, right) =>
    lexical(left.canonicalFactId, right.canonicalFactId) ||
    lexical(left.lane, right.lane) ||
    lexical(left.role, right.role) ||
    lexical(left.directness, right.directness) ||
    lexical(left.timing, right.timing)
  );
}

export function renderAttributionBinding(
  policy: AttributionPolicy,
  lockedGoldenManifestSha256: string
): string {
  return [
    "// Generated by scripts/generateUnifiedGoldenBindings.ts. Do not edit.",
    `export const LOCKED_GOLDEN_MANIFEST_SHA256 = ${JSON.stringify(lockedGoldenManifestSha256)};`,
    "",
    "export const SELECTED_ATTRIBUTION_POLICY = {",
    '  version: "selected-attribution-policy-v1",',
    `  policy: ${JSON.stringify(policy)},`,
    "  lockedGoldenManifestSha256: LOCKED_GOLDEN_MANIFEST_SHA256",
    "} as const;",
    ""
  ].join("\n");
}

export function renderScoringBinding(
  rows: readonly GeneratedScoringPolicyV4Row[],
  lockedGoldenManifestSha256: string
): string {
  const orderedRows = [...rows].sort((left, right) =>
    lexical(left.rowId, right.rowId)
  );
  const byCaseId = new Map(orderedRows.map((row) => [row.rowId, row]));
  const rules: GeneratedSemanticScoringRuleV4[] =
    SEMANTIC_RULE_SOURCES.map(([ruleId, caseId]) => {
      const source = byCaseId.get(caseId) ??
        fail(`unified_golden_semantic_source_missing:${caseId}`);
      return {
        ruleId,
        adjudicatedSourceCaseId: caseId,
        exactScore: source.exactScore,
        expectedDecision: source.expectedDecision
      };
    }).sort((left, right) => lexical(left.ruleId, right.ruleId));
  const serializedRules = JSON.stringify(rules, null, 2)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const serializedExpectations = JSON.stringify(orderedRows, null, 2)
    .split("\n")
    .map((line) => `${line}`)
    .join("\n");
  return [
    "// Generated by scripts/generateUnifiedGoldenBindings.ts. Do not edit.",
    `export const LOCKED_GOLDEN_MANIFEST_SHA256 = ${JSON.stringify(lockedGoldenManifestSha256)};`,
    "",
    "export const SCORING_POLICY_V4 = {",
    '  version: "scoring-signal-matrix-v4",',
    "  lockedGoldenManifestSha256: LOCKED_GOLDEN_MANIFEST_SHA256,",
    `  rules: ${serializedRules.trimStart()}`,
    "} as const;",
    "",
    `export const GOLDEN_CASE_EXPECTATIONS_V4 = ${serializedExpectations} as const;`,
    ""
  ].join("\n");
}

async function existingGenerated(
  path: string,
  expectedSourceHash: string,
  replace: boolean
): Promise<string | null> {
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!isRecord(error) || error.code !== "ENOENT") throw error;
  }
  if (existing !== null) {
    const existingHash = existing.match(SOURCE_HASH_PATTERN)?.[1];
    if (existingHash !== expectedSourceHash && !replace) {
      fail("unified_golden_generated_source_mismatch");
    }
  }
  return existing;
}

async function writeGeneratedPair(input: {
  first: { path: string; source: string; existing: string | null };
  second: { path: string; source: string; existing: string | null };
}): Promise<void> {
  if (resolve(input.first.path) === resolve(input.second.path)) {
    fail("unified_golden_generated_output_collision");
  }
  const items = [input.first, input.second].map((item) => ({
    ...item,
    temporaryPath: join(
      dirname(item.path),
      `.${item.path.split(/[\\/]/u).at(-1)}.${randomUUID()}.tmp`
    ),
    backupPath: item.existing === null
      ? null
      : join(
          dirname(item.path),
          `.${item.path.split(/[\\/]/u).at(-1)}.${randomUUID()}.bak`
        ),
    installed: false,
    backedUp: false
  }));
  try {
    for (const item of items) {
      await mkdir(dirname(item.path), { recursive: true });
      await writeFile(item.temporaryPath, item.source, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    for (const item of items) {
      if (item.backupPath !== null) {
        await rename(item.path, item.backupPath);
        item.backedUp = true;
      }
      await rename(item.temporaryPath, item.path);
      item.installed = true;
    }
    await Promise.all(items.map((item) =>
      item.backupPath === null
        ? Promise.resolve()
        : unlink(item.backupPath).catch(() => undefined)
    ));
  } catch (error) {
    for (const item of [...items].reverse()) {
      if (item.installed) await unlink(item.path).catch(() => undefined);
      if (item.backedUp && item.backupPath !== null) {
        await rename(item.backupPath, item.path).catch(() => undefined);
      }
      await unlink(item.temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

export async function generateUnifiedGoldenBindings(
  input: GenerateUnifiedGoldenBindingsInput
): Promise<GenerateUnifiedGoldenBindingsResult> {
  const verified = await verifyLockedGoldenRoot(
    input.goldenRoot,
    APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256
  );
  const manifest = parseManifest(verified.manifest);
  const lockedGoldenManifestSha256 = verified.manifestSha256;
  const rows: GeneratedScoringPolicyV4Row[] = [];

  for (const manifestCase of manifest.cases) {
    const adjudicationValue = JSON.parse(
      await readFile(
        join(
          input.goldenRoot,
          "cases",
          manifestCase.caseId,
          "adjudication.json"
        ),
        "utf8"
      )
    ) as unknown;
    if (fingerprintCanonicalArtifact(adjudicationValue) !==
      manifestCase.adjudicationSha256) {
      fail("unified_golden_adjudication_hash_mismatch");
    }
    const adjudication = parseAdjudication(adjudicationValue);
    if (adjudication.caseId !== manifestCase.caseId) {
      fail("unified_golden_adjudication_case_mismatch");
    }
    if (adjudication.selectedAttributionPolicy !==
      manifest.selectedAttributionPolicy) {
      fail("unified_golden_inconsistent_selected_attribution_policy");
    }
    rows.push({
      rowId: adjudication.caseId,
      exactScore: adjudication.exactScore,
      expectedDecision: adjudication.expectedDecision,
      facts: canonicalFacts(adjudication.resolvedFacts),
      scoreProperties: adjudication.scoreProperties
    });
  }
  rows.sort((left, right) => lexical(left.rowId, right.rowId));
  const attributionSource = renderAttributionBinding(
    manifest.selectedAttributionPolicy,
    lockedGoldenManifestSha256
  );
  const scoringSource = renderScoringBinding(
    rows,
    lockedGoldenManifestSha256
  );
  const replace = input.replace === true;
  const attributionExisting = await existingGenerated(
    input.attributionOutput,
    lockedGoldenManifestSha256,
    replace
  );
  const scoringExisting = await existingGenerated(
    input.scoringOutput,
    lockedGoldenManifestSha256,
    replace
  );
  await writeGeneratedPair({
    first: {
      path: input.attributionOutput,
      source: attributionSource,
      existing: attributionExisting
    },
    second: {
      path: input.scoringOutput,
      source: scoringSource,
      existing: scoringExisting
    }
  });
  return {
    lockedGoldenManifestSha256,
    selectedAttributionPolicy: manifest.selectedAttributionPolicy,
    rows
  };
}

function cliArguments(argv: readonly string[]): GenerateUnifiedGoldenBindingsInput {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    goldenRoot: resolve(value("--golden") ??
      "docs/audit/2026-07-system-audit/golden-v2/locked"),
    attributionOutput: resolve(value("--attribution-output") ??
      "src/unifiedCheck/selectedAttributionPolicy.generated.ts"),
    scoringOutput: resolve(value("--scoring-output") ??
      "src/risk/scoringPolicyV4.generated.ts"),
    replace: argv.includes("--replace")
  };
}

const isMain = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  generateUnifiedGoldenBindings(cliArguments(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(
        `unified Golden bindings generated: ${result.lockedGoldenManifestSha256}\n`
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
