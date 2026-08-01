import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareAttributionPolicies } from "../../tools/golden-pilot-v2/attribution";
import { buildNeutralExport } from "../../tools/golden-pilot-v2/neutralExport";
import {
  assertReviewsReadyForUnblind,
  canonicalEventFactId,
  lockReview,
  prepareReviewWorkspace
} from "../../tools/golden-pilot-v2/reviewWorkspace";
import { validFrozenSource } from "../fixtures/golden-v2/builders";

const attribution = compareAttributionPolicies({
  selectedAmountRaw: "1000000",
  inbound: [
    {
      eventId: "source-event",
      amountRaw: "2000000",
      timestamp: "2026-07-22T23:59:58.000Z"
    }
  ]
});

async function completeReview(
  workspacePath: string,
  mutate: (review: Record<string, unknown>) => void = () => undefined
): Promise<void> {
  const reviewPath = join(workspacePath, "review.json");
  const review = JSON.parse(
    await readFile(reviewPath, "utf8")
  ) as Record<string, unknown>;
  const bundle = JSON.parse(
    await readFile(join(workspacePath, "neutral-bundle.json"), "utf8")
  ) as {
    events: Array<Parameters<typeof canonicalEventFactId>[0]>;
  };
  Object.assign(review, {
    decision: "ACCEPTABLE",
    reason: "The frozen evidence contains no hard risk signal.",
    findings: [
      {
        canonicalFactId: canonicalEventFactId(bundle.events[0]!),
        evidenceRefs: [canonicalEventFactId(bundle.events[0]!)],
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
    reviewedAt: "2026-07-23T01:00:00.000Z"
  });
  mutate(review);
  await writeFile(reviewPath, JSON.stringify(review), "utf8");
}

describe("Golden V2 blind review workspaces", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true })
      )
    );
  });

  async function root(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "golden-review-"));
    temporaryRoots.push(path);
    return path;
  }

  it("prepares identical blind evidence and locks each review once", async () => {
    const parent = await root();
    const neutral = buildNeutralExport(validFrozenSource());
    const workspaceAPath = join(parent, "reviewer-a");
    const workspaceBPath = join(parent, "reviewer-b");
    const workspaceA = await prepareReviewWorkspace(
      workspaceAPath,
      "reviewer-a",
      neutral,
      attribution
    );
    const workspaceB = await prepareReviewWorkspace(
      workspaceBPath,
      "reviewer-b",
      neutral,
      attribution
    );

    expect(workspaceA.neutralBundleSha256).toBe(
      workspaceB.neutralBundleSha256
    );
    expect(workspaceA).not.toHaveProperty("systemScore");
    expect(workspaceA).not.toHaveProperty("expectedDecision");
    expect((await readdir(workspaceAPath)).sort()).toEqual([
      "instructions.md",
      "neutral-bundle.json",
      "provenance-manifest.json",
      "review.json",
      "validator-receipt.json"
    ]);

    await completeReview(workspaceAPath);
    await completeReview(workspaceBPath);
    const lockA = await lockReview(workspaceAPath);
    const lockB = await lockReview(workspaceBPath);
    expect(lockA.reviewerId).toBe("reviewer-a");
    expect(assertReviewsReadyForUnblind([lockA, lockB])).toEqual([
      lockA,
      lockB
    ]);
    await expect(lockReview(workspaceAPath)).rejects.toThrow(
      "golden_review_already_locked"
    );
  });

  it("rejects a changed neutral bundle and a missing evidence reference", async () => {
    const parent = await root();
    const neutral = buildNeutralExport(validFrozenSource());
    const tamperedPath = join(parent, "tampered");
    await prepareReviewWorkspace(
      tamperedPath,
      "reviewer-a",
      neutral,
      attribution
    );
    await completeReview(tamperedPath);
    const bundlePath = join(tamperedPath, "neutral-bundle.json");
    const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as Record<
      string,
      unknown
    >;
    bundle.caseId = "tampered-case";
    await writeFile(bundlePath, JSON.stringify(bundle), "utf8");
    await expect(lockReview(tamperedPath)).rejects.toThrow(
      "golden_workspace_tampered"
    );

    const missingPath = join(parent, "missing-reference");
    await prepareReviewWorkspace(
      missingPath,
      "reviewer-b",
      neutral,
      attribution
    );
    await completeReview(missingPath, (review) => {
      const findings = review.findings as Array<Record<string, unknown>>;
      findings[0]!.evidenceRefs = ["missing:evidence"];
    });
    await expect(lockReview(missingPath)).rejects.toThrow(
      "golden_review_evidence_reference_missing:missing:evidence"
    );
  });

  it("blocks exact scores, mismatched evidence and premature unblinding", async () => {
    const parent = await root();
    const neutralA = buildNeutralExport(validFrozenSource());
    const neutralB = buildNeutralExport(
      validFrozenSource({
        snapshot: {
          ...validFrozenSource().snapshot,
          labelDatasetSha256: "d".repeat(64)
        }
      })
    );
    const pathA = join(parent, "a");
    const pathB = join(parent, "b");
    const exactScorePath = join(parent, "exact-score");
    await prepareReviewWorkspace(pathA, "reviewer-a", neutralA, attribution);
    await prepareReviewWorkspace(pathB, "reviewer-b", neutralB, attribution);
    await prepareReviewWorkspace(
      exactScorePath,
      "reviewer-c",
      neutralA,
      attribution
    );
    await completeReview(pathA);
    await completeReview(pathB);
    await completeReview(exactScorePath, (review) => {
      review.exactScore = 12;
    });

    const lockA = await lockReview(pathA);
    const lockB = await lockReview(pathB);
    await expect(lockReview(exactScorePath)).rejects.toThrow(
      "golden_exact_score_forbidden_before_adjudication"
    );
    expect(() => assertReviewsReadyForUnblind([lockA])).toThrow(
      "golden_two_reviews_required"
    );
    expect(() => assertReviewsReadyForUnblind([lockA, lockA])).toThrow(
      "golden_distinct_reviews_required"
    );
    expect(() => assertReviewsReadyForUnblind([lockA, lockB])).toThrow(
      "golden_review_neutral_hash_mismatch"
    );
  });
});
