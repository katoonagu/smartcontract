import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalEventFactId } from "../../tools/golden-pilot-v2/reviewWorkspace";
import { runGoldenPilotCli } from "../../tools/golden-pilot-v2/cli";
import { validFrozenSource } from "../fixtures/golden-v2/builders";

const CASE_ID = "synthetic-one-legitimate-transfer";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), "utf8");
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function capture() {
  let value = "";
  return {
    stream: {
      write(chunk: string | Uint8Array): boolean {
        value += chunk.toString();
        return true;
      }
    },
    value: () => value
  };
}

async function run(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const stdout = capture();
  const stderr = capture();
  const exitCode = await runGoldenPilotCli(args, {
    stdout: stdout.stream,
    stderr: stderr.stream
  });
  return {
    exitCode,
    stdout: stdout.value(),
    stderr: stderr.value()
  };
}

async function completeReview(
  reviewerRoot: string,
  neutralRoot: string,
  reviewedAt: string
): Promise<void> {
  const reviewPath = join(reviewerRoot, CASE_ID, "review.json");
  const review = await readJson(reviewPath);
  const neutralExport = await readJson(
    join(neutralRoot, CASE_ID, "neutral-export.json")
  );
  const bundle = neutralExport.bundle as {
    events: Array<Parameters<typeof canonicalEventFactId>[0]>;
  };
  const factId = canonicalEventFactId(bundle.events[0]!);
  Object.assign(review, {
    decision: "ACCEPTABLE",
    reason: "No hard evidence in the frozen bundle.",
    findings: [
      {
        canonicalFactId: factId,
        evidenceRefs: [factId],
        subjectRole: "recipient",
        counterpartyRole: "sender",
        directness: "direct",
        timing: "at_event",
        lane: "neutral"
      }
    ],
    terminalBoundaries: ["known_exchange"],
    preferredAttributionPolicy: "fifo",
    dossierAggregates: { incoming_amount_raw: "2000000" },
    scoreProperties: ["coverage_does_not_change_score"],
    reviewedAt
  });
  await writeJson(reviewPath, review);
}

describe("Golden V2 strict offline CLI", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true })
      )
    );
  });

  async function root(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "golden-cli-"));
    roots.push(path);
    return path;
  }

  it("runs the complete synthetic workflow without production configuration", async () => {
    const workspace = await root();
    const goldenRoot = join(workspace, "golden");
    const sourceRoot = join(goldenRoot, "source");
    const neutralRoot = join(goldenRoot, "neutral");
    const attributionRoot = join(goldenRoot, "attribution");
    const reviewerARoot = join(goldenRoot, "reviewer-a");
    const reviewerBRoot = join(goldenRoot, "reviewer-b");
    const lockedARoot = join(goldenRoot, "locked-reviewer-a");
    const lockedBRoot = join(goldenRoot, "locked-reviewer-b");
    const draftRoot = join(goldenRoot, "adjudication-draft");
    const adjudicatedRoot = join(goldenRoot, "adjudicated");
    const lockedRoot = join(workspace, "locked");
    await mkdir(sourceRoot, { recursive: true });
    await writeJson(join(sourceRoot, "case-catalog.json"), {
      version: "golden-case-catalog-v2",
      groups: [
        { kind: "blind_review", caseIds: [] },
        { kind: "regression", caseIds: [] },
        {
          kind: "synthetic_property_performance",
          caseIds: [CASE_ID]
        }
      ],
      cases: [
        {
          caseId: CASE_ID,
          group: "synthetic_property_performance",
          subjectAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKLxmGkn",
          sourceArtifact: `${CASE_ID}.json`,
          requiredProperties: ["one_legitimate_transfer"]
        }
      ]
    });
    await writeJson(
      join(sourceRoot, `${CASE_ID}.json`),
      validFrozenSource()
    );

    expect(
      (
        await run([
          "neutralize",
          "--input",
          sourceRoot,
          "--output",
          neutralRoot
        ])
      ).exitCode
    ).toBe(0);
    expect(
      (
        await run([
          "compare-attribution",
          "--input",
          neutralRoot,
          "--output",
          attributionRoot
        ])
      ).exitCode
    ).toBe(0);
    for (const [reviewer, output] of [
      ["reviewer-a", reviewerARoot],
      ["reviewer-b", reviewerBRoot]
    ] as const) {
      expect(
        (
          await run([
            "prepare-review",
            "--input",
            neutralRoot,
            "--output",
            output,
            "--reviewer",
            reviewer
          ])
        ).exitCode
      ).toBe(0);
    }
    await completeReview(
      reviewerARoot,
      neutralRoot,
      "2026-07-23T01:00:00.000Z"
    );
    await completeReview(
      reviewerBRoot,
      neutralRoot,
      "2026-07-23T01:05:00.000Z"
    );
    for (const [input, output] of [
      [reviewerARoot, lockedARoot],
      [reviewerBRoot, lockedBRoot]
    ] as const) {
      expect(
        (
          await run([
            "lock-review",
            "--input",
            input,
            "--output",
            output
          ])
        ).exitCode
      ).toBe(0);
    }
    expect(
      (
        await run([
          "open-adjudication",
          "--input",
          goldenRoot,
          "--output",
          draftRoot
        ])
      ).exitCode
    ).toBe(0);

    const draftPath = join(draftRoot, `${CASE_ID}.json`);
    const draft = await readJson(draftPath);
    const neutralExport = await readJson(
      join(neutralRoot, CASE_ID, "neutral-export.json")
    );
    const bundle = neutralExport.bundle as {
      events: Array<Parameters<typeof canonicalEventFactId>[0]>;
    };
    const factId = canonicalEventFactId(bundle.events[0]!);
    draft.resolution = {
      resolvedFacts: [
        {
          canonicalFactId: factId,
          lane: "neutral",
          role: "recipient",
          directness: "direct",
          timing: "at_event"
        }
      ],
      selectedAttributionPolicy: "fifo",
      expectedDecision: "ACCEPTABLE",
      exactScore: 12,
      scoreProperties: ["coverage_does_not_change_score"],
      dossierAggregates: { incoming_amount_raw: "2000000" },
      telegramExpectation: [
        { locale: "ru", exactHtml: "<b>12/100</b>" }
      ],
      adjudicatorId: "adjudicator-1",
      adjudicatedAt: "2026-07-23T02:00:00.000Z"
    };
    await writeJson(draftPath, draft);
    expect(
      (
        await run([
          "finalize-adjudication",
          "--input",
          draftRoot,
          "--output",
          adjudicatedRoot
        ])
      ).exitCode
    ).toBe(0);

    const controlRoot = join(goldenRoot, "control");
    await mkdir(controlRoot);
    const trackedControlRoot = join(
      import.meta.dirname,
      "..",
      "..",
      "docs",
      "audit",
      "2026-07-system-audit",
      "golden-v2"
    );
    for (const name of [
      "protocol.json",
      "case-catalog.json",
      "comparator-contract.json"
    ]) {
      const source =
        name === "case-catalog.json"
          ? join(sourceRoot, name)
          : join(trackedControlRoot, name);
      await writeFile(
        join(controlRoot, name),
        await readFile(source, "utf8"),
        "utf8"
      );
    }
    await writeJson(join(goldenRoot, "lock-request.json"), {
      lockedAt: "2026-07-23T03:00:00.000Z",
      lockedBy: "golden-coordinator"
    });

    expect(
      (
        await run([
          "lock-golden",
          "--input",
          goldenRoot,
          "--output",
          lockedRoot
        ])
      ).exitCode
    ).toBe(0);
    const verified = await run(["verify", "--input", lockedRoot]);
    expect(verified.exitCode).toBe(0);
    expect(verified.stdout).toContain("golden-v2 verified");
    expect(verified.stdout).toContain("cases: 1");
    expect(verified.stdout).not.toContain("score: 12");
  });

  it("rejects ambiguous flags and unsafe destinations", async () => {
    const workspace = await root();
    const source = join(workspace, "source");
    const existing = join(workspace, "existing");
    await mkdir(source);
    await mkdir(existing);

    expect(
      (
        await run([
          "neutralize",
          "--input",
          source,
          "--output",
          join(workspace, "out"),
          "--unknown",
          "x"
        ])
      ).stderr
    ).toContain("golden_unknown_flag:--unknown");
    expect(
      (
        await run([
          "neutralize",
          "--input",
          source,
          "--input",
          source,
          "--output",
          join(workspace, "out")
        ])
      ).stderr
    ).toContain("golden_repeated_flag:--input");
    expect(
      (
        await run([
          "neutralize",
          "--input",
          source,
          "--output",
          join(source, "nested")
        ])
      ).stderr
    ).toContain("golden_output_below_input");
    expect(
      (
        await run([
          "neutralize",
          "--input",
          source,
          "--output",
          existing
        ])
      ).stderr
    ).toContain("golden_output_already_exists");
    expect(
      (
        await run([
          "neutralize",
          "--input",
          "..",
          "--output",
          join(workspace, "escape")
        ])
      ).stderr
    ).toContain("golden_path_escape");
  });
});
