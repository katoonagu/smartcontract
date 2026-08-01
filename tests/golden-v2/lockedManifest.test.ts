import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishArtifactOnce,
  type PublishedArtifact
} from "../../tools/golden-pilot-v2/artifactStore";
import { canonicalSha256 } from "../../tools/golden-pilot-v2/canonicalJson";
import { buildNeutralExport } from "../../tools/golden-pilot-v2/neutralExport";
import {
  buildLockedGoldenManifest,
  canonicalAdjudicatedFactInventory,
  lockGoldenManifest,
  parseComparatorContractV1,
  parseComparatorInputV1,
  parseComparatorOutputV1,
  presentationExpectation,
  scoreExpectation,
  type LockGoldenManifestInput
} from "../../tools/golden-pilot-v2/lockedManifest";
import { validFrozenSource } from "../fixtures/golden-v2/builders";

type PublishedCase = LockGoldenManifestInput["cases"][number];

async function publishedCase(
  root: string,
  caseId: string,
  policy: "fifo" | "lifo" | "proportional" = "fifo"
): Promise<PublishedCase> {
  const neutral = buildNeutralExport(validFrozenSource({ caseId }));
  const prefix = `cases/${caseId}`;
  const neutralBundle = await publishArtifactOnce(
    root,
    `${prefix}/neutral-bundle.json`,
    neutral.bundle
  );
  const provenanceManifest = await publishArtifactOnce(
    root,
    `${prefix}/provenance-manifest.json`,
    neutral.manifest
  );
  const validatorReceipt = await publishArtifactOnce(
    root,
    `${prefix}/validator-receipt.json`,
    neutral.receipt
  );
  const reviewBase = {
    version: "golden-review-v2",
    status: "submitted",
    caseId,
    neutralBundleSha256: neutralBundle.sha256,
    provenanceManifestSha256: provenanceManifest.sha256,
    validatorReceiptSha256: validatorReceipt.sha256
  };
  const reviewerA = await publishArtifactOnce(
    root,
    `${prefix}/reviewer-a.json`,
    { ...reviewBase, reviewerId: "reviewer-a" }
  );
  const reviewerB = await publishArtifactOnce(
    root,
    `${prefix}/reviewer-b.json`,
    { ...reviewBase, reviewerId: "reviewer-b" }
  );
  const adjudication = await publishArtifactOnce(
    root,
    `${prefix}/adjudication.json`,
    {
      version: "golden-adjudication-v2",
      caseId,
      neutralBundleSha256: neutralBundle.sha256,
      reviewerHashes: [reviewerA.sha256, reviewerB.sha256],
      resolvedFacts: [
        {
          canonicalFactId: `fact:${caseId}`,
          lane: "neutral",
          role: "subject",
          directness: "direct",
          timing: "at_event"
        }
      ],
      selectedAttributionPolicy: policy,
      expectedDecision: "ACCEPTABLE",
      exactScore: 12,
      scoreProperties: ["coverage_does_not_change_score"],
      dossierAggregates: { incoming_amount_raw: "2000000" },
      telegramExpectation: [
        { locale: "ru", exactHtml: "<b>12/100</b>" }
      ],
      adjudicatorId: "adjudicator-1",
      adjudicatedAt: "2026-07-23T02:00:00.000Z"
    }
  );
  return {
    caseId,
    neutralBundle,
    provenanceManifest,
    validatorReceipt,
    reviewerArtifacts: [reviewerA, reviewerB],
    adjudication
  };
}

async function controlArtifact(
  root: string,
  relativePath: string,
  value: unknown
): Promise<PublishedArtifact> {
  return publishArtifactOnce(root, relativePath, value);
}

describe("Golden V2 locked manifest and comparator contract", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true })
      )
    );
  });

  async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "golden-lock-"));
    roots.push(root);
    return root;
  }

  async function lockInput(
    root: string,
    cases: PublishedCase[]
  ): Promise<LockGoldenManifestInput> {
    const contract = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          "..",
          "..",
          "docs",
          "audit",
          "2026-07-system-audit",
          "golden-v2",
          "comparator-contract.json"
        ),
        "utf8"
      )
    ) as unknown;
    return {
      root,
      outputRelativePath: "locked/manifest.json",
      protocol: await controlArtifact(root, "control/protocol.json", {
        version: "golden-pilot-protocol-v2"
      }),
      caseCatalog: await controlArtifact(root, "control/catalog.json", {
        version: "golden-case-catalog-v2"
      }),
      comparatorContract: await controlArtifact(
        root,
        "control/comparator-contract.json",
        contract
      ),
      cases,
      lockedAt: "2026-07-23T03:00:00.000Z",
      lockedBy: "golden-coordinator"
    };
  }

  it("validates the data-only comparator input and output formats", async () => {
    const contract = parseComparatorContractV1(
      JSON.parse(
        await readFile(
          join(
            import.meta.dirname,
            "..",
            "..",
            "docs",
            "audit",
            "2026-07-system-audit",
            "golden-v2",
            "comparator-contract.json"
          ),
          "utf8"
        )
      )
    );
    expect(contract.anchorVersion).toBe("score-anchor-v3");
    expect(contract.schemaAudit.scoreAnchorV2Compatible).toBe(false);

    const comparatorInput = parseComparatorInputV1({
      version: "unified-wallet-comparator-input-v1",
      caseId: "case-one",
      analysisManifestSha256: "1".repeat(64),
      evidenceBundleSha256: "2".repeat(64),
      reportSha256: "3".repeat(64),
      scoringPolicyVersion: "scoring-signal-matrix-v4",
      score: 12,
      decision: "ACCEPTABLE",
      anchor: {
        version: "score-anchor-v3",
        policyVersion: "scoring-signal-matrix-v4",
        subjectAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKLxmGkn",
        mode: "unified",
        score: 12,
        decision: "ACCEPTABLE",
        matrixRow: "clean_or_operational",
        evidenceClass: "neutral",
        proofLevel: "exact",
        authority: "on_chain",
        canonicalFactIds: ["fact:one"],
        primaryFactIds: ["fact:one"],
        preferredFactId: "fact:one",
        lockedGoldenManifestSha256: "4".repeat(64)
      },
      dossierAggregates: { incoming_amount_raw: "2000000" },
      presentations: [
        {
          locale: "ru",
          html: "<b>12/100</b>",
          presentationSha256: "5".repeat(64)
        }
      ]
    });
    expect(comparatorInput.anchor.score).toBe(comparatorInput.score);
    expect(
      parseComparatorOutputV1({
        version: "unified-wallet-comparator-output-v1",
        caseId: "case-one",
        passed: true,
        violations: []
      }).passed
    ).toBe(true);
  });

  it("locks a deterministic, write-once hash graph", async () => {
    const root = await fixtureRoot();
    const caseOne = await publishedCase(root, "case-one");
    const caseTwo = await publishedCase(root, "case-two");
    const input = await lockInput(root, [caseTwo, caseOne]);

    const forward = await buildLockedGoldenManifest(input);
    const reverse = await buildLockedGoldenManifest({
      ...input,
      cases: [...input.cases].reverse()
    });
    expect(canonicalSha256(reverse)).toBe(canonicalSha256(forward));
    const locked = await lockGoldenManifest(input);
    expect(locked.manifest.cases.map((item) => item.caseId)).toEqual([
      "case-one",
      "case-two"
    ]);
    expect(locked.artifact.sha256).toBe(canonicalSha256(locked.manifest));
    await expect(lockGoldenManifest(input)).rejects.toThrow(
      "golden_artifact_already_exists"
    );
  });

  it("fails closed for duplicates, mixed policies and changed artifacts", async () => {
    const root = await fixtureRoot();
    const caseOne = await publishedCase(root, "case-one");
    const caseTwo = await publishedCase(root, "case-two", "lifo");
    const duplicateInput = await lockInput(root, [caseOne, caseOne]);
    await expect(buildLockedGoldenManifest(duplicateInput)).rejects.toThrow(
      "golden_duplicate_case_id:case-one"
    );
    await expect(
      buildLockedGoldenManifest({
        ...duplicateInput,
        cases: [caseOne, caseTwo]
      })
    ).rejects.toThrow("golden_inconsistent_selected_attribution_policy");

    await writeFile(
      join(root, ...caseOne.neutralBundle.relativePath.split("/")),
      "{}",
      "utf8"
    );
    await expect(
      buildLockedGoldenManifest({
        ...duplicateInput,
        cases: [caseOne]
      })
    ).rejects.toThrow("golden_referenced_artifact_invalid");
  });

  it("keeps score independent from coverage and presentation from locale", () => {
    const adjudication = {
      exactScore: 12,
      expectedDecision: "ACCEPTABLE" as const
    };
    expect(scoreExpectation(adjudication, { coverage: "complete" })).toEqual(
      scoreExpectation(adjudication, { coverage: "partial" })
    );
    const ru = presentationExpectation(
      "1".repeat(64),
      "ru",
      "<b>12/100</b>"
    );
    const en = presentationExpectation(
      "1".repeat(64),
      "en",
      "<b>12/100</b>"
    );
    expect(ru.reportSha256).toBe(en.reportSha256);
    expect(ru.presentationSha256).not.toBe(en.presentationSha256);

    const facts = [
      {
        canonicalFactId: "fact:one",
        lane: "neutral" as const,
        role: "subject",
        directness: "direct" as const,
        timing: "at_event" as const
      }
    ];
    expect(
      canonicalAdjudicatedFactInventory([...facts, ...facts])
    ).toEqual(canonicalAdjudicatedFactInventory(facts));
  });
});
