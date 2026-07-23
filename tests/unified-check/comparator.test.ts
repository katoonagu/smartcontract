import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../../tools/golden-pilot-v2/canonicalJson";
import type { ComparatorInputV1 } from "../../tools/golden-pilot-v2/lockedManifest";
import {
  buildUnifiedWalletGoldenReplayCandidate,
  compareUnifiedWalletGolden,
  compareUnifiedWalletGoldenPropertyReplay,
  compareUnifiedWalletGoldenScoreProperties,
  loadUnifiedWalletGoldenCases
} from "../../src/unifiedCheck/comparator";
import { GOLDEN_COMPARATOR_V1_LOCK } from "../../src/unifiedCheck/goldenComparatorV1.generated";
import { runUnifiedWalletGoldenComparatorCli } from "../../scripts/compareUnifiedWalletGolden";

const goldenRoot = join(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "audit",
  "2026-07-system-audit",
  "golden-v2",
  "locked"
);

describe("Unified wallet Golden comparator", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) =>
        rm(root, { force: true, recursive: true })
      )
    );
  });

  async function candidateDirectory(): Promise<{
    root: string;
    cases: Awaited<ReturnType<typeof loadUnifiedWalletGoldenCases>>;
  }> {
    const root = await mkdtemp(join(tmpdir(), "unified-golden-compare-"));
    temporaryRoots.push(root);
    const cases = await loadUnifiedWalletGoldenCases(goldenRoot);
    for (const goldenCase of cases) {
      const candidate = buildUnifiedWalletGoldenReplayCandidate(goldenCase);
      await writeFile(
        join(root, `${goldenCase.caseId}.json`),
        `${canonicalJson(candidate)}\n`,
        "utf8"
      );
    }
    return { root, cases };
  }

  it("replays every adjudicated case through production and matches locked outputs exactly", async () => {
    const cases = await loadUnifiedWalletGoldenCases(goldenRoot);
    expect(cases).toHaveLength(24);
    expect(Object.keys(GOLDEN_COMPARATOR_V1_LOCK.inputSha256ByCase))
      .toHaveLength(24);
    for (const goldenCase of cases) {
      const candidate = buildUnifiedWalletGoldenReplayCandidate(goldenCase);
      const result = compareUnifiedWalletGolden(
        goldenCase.expected,
        candidate
      );
      expect(result, goldenCase.caseId).toEqual({
        version: "unified-wallet-comparator-output-v1",
        caseId: goldenCase.caseId,
        passed: true,
        violations: []
      });
      expect(candidate.score, goldenCase.caseId)
        .toBe(goldenCase.adjudication.exactScore);
      expect(candidate.decision, goldenCase.caseId)
        .toBe(goldenCase.adjudication.expectedDecision);
      expect(candidate.dossierAggregates, goldenCase.caseId)
        .toEqual(goldenCase.adjudication.dossierAggregates);
      expect(candidate.presentations.map((item) => ({
        locale: item.locale,
        html: item.html
      })), goldenCase.caseId).toEqual(
        [...goldenCase.adjudication.telegramExpectation]
          .sort((left, right) => left.locale.localeCompare(right.locale))
          .map((item) => ({
            locale: item.locale,
            html: item.exactHtml
          }))
      );
      const properties = compareUnifiedWalletGoldenScoreProperties(
        goldenCase,
        candidate
      );
      expect(properties.violations, goldenCase.caseId).toEqual([]);
      expect(properties.evaluatedProperties, goldenCase.caseId).toEqual(
        [...goldenCase.adjudication.scoreProperties].sort()
      );
    }
  });

  it("reports stable score, anchor, aggregate, presentation and hash violations", async () => {
    const [goldenCase] = await loadUnifiedWalletGoldenCases(goldenRoot);
    const candidate = buildUnifiedWalletGoldenReplayCandidate(goldenCase!);
    const changed = structuredClone(candidate) as ComparatorInputV1;
    changed.score = candidate.score === 100 ? 99 : candidate.score + 1;
    changed.anchor.score = changed.score;
    changed.dossierAggregates.event_count = "999";
    changed.presentations[0]!.html += "\nchanged";
    changed.reportSha256 = "0".repeat(64);

    const first = compareUnifiedWalletGolden(goldenCase!.expected, changed);
    const second = compareUnifiedWalletGolden(goldenCase!.expected, changed);
    expect(first).toEqual(second);
    expect(first.passed).toBe(false);
    expect(new Set(first.violations.map((item) => item.property))).toEqual(
      new Set(["score", "anchor", "aggregate", "presentation", "hash"])
    );
  });

  it("uses an immutable production-side input lock instead of self-comparing two replays", async () => {
    const cases = await loadUnifiedWalletGoldenCases(goldenRoot);
    const goldenCase = cases.find((item) =>
      item.caseId === "synthetic-empty-wallet"
    )!;
    const candidate = buildUnifiedWalletGoldenReplayCandidate(goldenCase);
    const selfConsistentButUnlocked = structuredClone(candidate);
    selfConsistentButUnlocked.analysisManifestSha256 = "f".repeat(64);
    const dynamicExpected = structuredClone(goldenCase.expected);
    dynamicExpected.analysisManifestSha256 =
      selfConsistentButUnlocked.analysisManifestSha256;

    const result = compareUnifiedWalletGolden(
      dynamicExpected,
      selfConsistentButUnlocked
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual({
      property: "hash",
      expected: {
        name: "lockedComparatorInputSha256",
        value: GOLDEN_COMPARATOR_V1_LOCK.inputSha256ByCase[
          "synthetic-empty-wallet"
        ]
      },
      actual: {
        name: "lockedComparatorInputSha256",
        value: expect.stringMatching(/^[0-9a-f]{64}$/)
      }
    });
  });

  it("keeps coverage, duplicate, reorder and retry replay invariant while preserving semantic distinctions", () => {
    expect(compareUnifiedWalletGoldenPropertyReplay()).toEqual([]);
  });

  it("fails closed when a locked score property has no evaluator", async () => {
    const [first] = await loadUnifiedWalletGoldenCases(goldenRoot);
    const goldenCase = structuredClone(first!);
    goldenCase.adjudication.scoreProperties.push(
      "new_unreviewed_property"
    );
    const result = compareUnifiedWalletGoldenScoreProperties(
      goldenCase,
      buildUnifiedWalletGoldenReplayCandidate(first!)
    );
    expect(result.evaluatedProperties).not.toContain(
      "new_unreviewed_property"
    );
    expect(result.violations).toContainEqual({
      property: "relation",
      expected: {
        property: "new_unreviewed_property",
        satisfied: true
      },
      actual: {
        property: "new_unreviewed_property",
        error: "unsupported_locked_score_property"
      }
    });
  });

  it("replays the same snapshot byte-for-byte across retry and restart", async () => {
    const cases = await loadUnifiedWalletGoldenCases(goldenRoot);
    for (const goldenCase of cases) {
      const first = buildUnifiedWalletGoldenReplayCandidate(goldenCase);
      const retry = buildUnifiedWalletGoldenReplayCandidate(goldenCase);
      expect(canonicalJson(retry), goldenCase.caseId)
        .toBe(canonicalJson(first));
    }
  });

  it("returns zero for accepted CLI candidates and non-zero with structured JSON for a mismatch", async () => {
    const fixture = await candidateDirectory();
    const accepted: string[] = [];
    expect(await runUnifiedWalletGoldenComparatorCli(
      ["--golden", goldenRoot, "--candidate", fixture.root],
      (line) => accepted.push(line)
    )).toBe(0);
    expect(JSON.parse(accepted.join(""))).toMatchObject({
      version: "unified-wallet-comparator-run-v1",
      passed: true,
      caseCount: 24
    });

    const changedPath = join(fixture.root, `${fixture.cases[0]!.caseId}.json`);
    const changed = JSON.parse(await readFile(changedPath, "utf8")) as
      ComparatorInputV1;
    changed.dossierAggregates.event_count = "999";
    await writeFile(changedPath, `${canonicalJson(changed)}\n`, "utf8");

    const rejected: string[] = [];
    expect(await runUnifiedWalletGoldenComparatorCli(
      ["--golden", goldenRoot, "--candidate", fixture.root],
      (line) => rejected.push(line)
    )).toBe(1);
    const result = JSON.parse(rejected.join("")) as {
      passed: boolean;
      results: Array<{ violations: Array<{ property: string }> }>;
    };
    expect(result.passed).toBe(false);
    expect(result.results.flatMap((item) => item.violations)).toContainEqual(
      expect.objectContaining({ property: "aggregate" })
    );
  });

  it("accepts the exact one-delimiter npm command documented by the plan", async () => {
    const fixture = await candidateDirectory();
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execute = promisify(execFile);
    const npmCli = process.env.npm_execpath;
    expect(npmCli).toBeTruthy();
    const result = await execute(process.execPath, [
      npmCli!,
      "run",
      "unified:golden:compare",
      "--",
      "--golden",
      goldenRoot,
      "--candidate",
      fixture.root
    ], {
      cwd: join(import.meta.dirname, "..", ".."),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    expect(result.stdout).toContain(
      '"version":"unified-wallet-comparator-run-v1"'
    );
    expect(result.stdout).toContain('"passed":true');
  });
});
