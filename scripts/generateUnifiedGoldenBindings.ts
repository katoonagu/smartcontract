import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintCanonicalArtifact } from "../src/forensics/canonicalJson";

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
    left.canonicalFactId.localeCompare(right.canonicalFactId) ||
    left.lane.localeCompare(right.lane) ||
    left.role.localeCompare(right.role) ||
    left.directness.localeCompare(right.directness) ||
    left.timing.localeCompare(right.timing)
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
  const serializedRows = JSON.stringify(rows, null, 2)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return [
    "// Generated by scripts/generateUnifiedGoldenBindings.ts. Do not edit.",
    `export const LOCKED_GOLDEN_MANIFEST_SHA256 = ${JSON.stringify(lockedGoldenManifestSha256)};`,
    "",
    "export const SCORING_POLICY_V4 = {",
    '  version: "scoring-signal-matrix-v4",',
    "  lockedGoldenManifestSha256: LOCKED_GOLDEN_MANIFEST_SHA256,",
    `  rows: ${serializedRows.trimStart()}`,
    "} as const;",
    ""
  ].join("\n");
}

async function writeGenerated(
  path: string,
  source: string,
  expectedSourceHash: string,
  replace: boolean
): Promise<void> {
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
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, "utf8");
}

export async function generateUnifiedGoldenBindings(
  input: GenerateUnifiedGoldenBindingsInput
): Promise<GenerateUnifiedGoldenBindingsResult> {
  const manifestValue = JSON.parse(
    await readFile(join(input.goldenRoot, "locked-manifest.json"), "utf8")
  ) as unknown;
  const manifest = parseManifest(manifestValue);
  const lockedGoldenManifestSha256 =
    fingerprintCanonicalArtifact(manifestValue);
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
  rows.sort((left, right) => left.rowId.localeCompare(right.rowId));

  await writeGenerated(
    input.attributionOutput,
    renderAttributionBinding(
      manifest.selectedAttributionPolicy,
      lockedGoldenManifestSha256
    ),
    lockedGoldenManifestSha256,
    input.replace === true
  );
  await writeGenerated(
    input.scoringOutput,
    renderScoringBinding(rows, lockedGoldenManifestSha256),
    lockedGoldenManifestSha256,
    input.replace === true
  );
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
