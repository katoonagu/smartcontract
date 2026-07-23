import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateUnifiedGoldenBindings,
  renderScoringBinding
} from "../../scripts/generateUnifiedGoldenBindings";

const lockedGoldenRoot = join(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "audit",
  "2026-07-system-audit",
  "golden-v2",
  "locked"
);

describe("Unified locked Golden bindings", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) =>
        rm(root, { force: true, recursive: true })
      )
    );
  });

  async function fixture(): Promise<{
    root: string;
    goldenRoot: string;
    attributionOutput: string;
    scoringOutput: string;
  }> {
    const root = await mkdtemp(join(tmpdir(), "unified-golden-bindings-"));
    temporaryRoots.push(root);
    const goldenRoot = join(root, "locked");
    await cp(lockedGoldenRoot, goldenRoot, { recursive: true });
    return {
      root,
      goldenRoot,
      attributionOutput: join(root, "selectedAttributionPolicy.generated.ts"),
      scoringOutput: join(root, "scoringPolicyV4.generated.ts")
    };
  }

  it("emits one adjudicated policy and exact sorted score rows bound to the locked hash", async () => {
    const paths = await fixture();
    const generated = await generateUnifiedGoldenBindings(paths);
    expect(generated.lockedGoldenManifestSha256).toBe(
      "4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407"
    );
    expect(generated.selectedAttributionPolicy).toBe("proportional");
    expect(generated.rows).toHaveLength(24);
    expect(generated.rows.map((row) => row.rowId)).toEqual(
      [...generated.rows.map((row) => row.rowId)].sort()
    );
    expect(generated.rows.find((row) =>
      row.rowId === "synthetic-direct-blacklist-1pct"
    )).toMatchObject({
      exactScore: 90,
      expectedDecision: "DECLINE"
    });

    const attributionSource = await readFile(paths.attributionOutput, "utf8");
    const scoringSource = await readFile(paths.scoringOutput, "utf8");
    expect(attributionSource).toContain('policy: "proportional"');
    expect(attributionSource).toContain(generated.lockedGoldenManifestSha256);
    expect(scoringSource).toContain(generated.lockedGoldenManifestSha256);
    expect(scoringSource).not.toContain("limited_coverage_floor");
  });

  it("renders policy bindings deterministically when case input order changes", async () => {
    const paths = await fixture();
    const generated = await generateUnifiedGoldenBindings(paths);
    expect(renderScoringBinding(
      [...generated.rows].reverse(),
      generated.lockedGoldenManifestSha256
    )).toBe(renderScoringBinding(
      generated.rows,
      generated.lockedGoldenManifestSha256
    ));
  });

  it("refuses pre-adjudication input and a mixed selected policy", async () => {
    const paths = await fixture();
    const manifestPath = join(paths.goldenRoot, "locked-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      version: string;
      cases: Array<{ caseId: string }>;
    };
    manifest.version = "golden-capture-manifest-v2";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await expect(generateUnifiedGoldenBindings(paths)).rejects.toThrow();

    manifest.version = "locked-golden-manifest-v2";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const adjudicationPath = join(
      paths.goldenRoot,
      "cases",
      manifest.cases[0]!.caseId,
      "adjudication.json"
    );
    const adjudication = JSON.parse(
      await readFile(adjudicationPath, "utf8")
    ) as { selectedAttributionPolicy: string };
    adjudication.selectedAttributionPolicy = "fifo";
    await writeFile(adjudicationPath, JSON.stringify(adjudication), "utf8");
    await expect(
      generateUnifiedGoldenBindings({ ...paths, replace: true })
    ).rejects.toThrow();
  });

  it("does not overwrite a binding from another source without --replace", async () => {
    const paths = await fixture();
    await writeFile(
      paths.attributionOutput,
      'export const LOCKED_GOLDEN_MANIFEST_SHA256 = "' + "0".repeat(64) + '";\n',
      "utf8"
    );
    await expect(generateUnifiedGoldenBindings(paths)).rejects.toThrow(
      "unified_golden_generated_source_mismatch"
    );
    await expect(
      generateUnifiedGoldenBindings({ ...paths, replace: true })
    ).resolves.toMatchObject({ selectedAttributionPolicy: "proportional" });
  });

  it("verifies the pinned manifest identity and every referenced artifact", async () => {
    const paths = await fixture();
    const descriptorPath = join(
      paths.goldenRoot,
      "locked-manifest-descriptor.json"
    );
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as {
      sha256: string;
    };
    descriptor.sha256 = "0".repeat(64);
    await writeFile(descriptorPath, JSON.stringify(descriptor), "utf8");
    await expect(generateUnifiedGoldenBindings(paths)).rejects.toThrow(
      "golden_locked_manifest_identity_mismatch"
    );

    const fresh = await fixture();
    await writeFile(
      join(
        fresh.goldenRoot,
        "cases",
        "synthetic-empty-wallet",
        "neutral-bundle.json"
      ),
      "{}",
      "utf8"
    );
    await expect(generateUnifiedGoldenBindings(fresh)).rejects.toThrow(
      "golden_artifact_verification_failed"
    );
  });

  it("preflights both destinations before changing either one", async () => {
    const paths = await fixture();
    await generateUnifiedGoldenBindings(paths);
    const attribution = await readFile(paths.attributionOutput, "utf8");
    const sentinel = `${attribution}// sentinel\n`;
    await writeFile(paths.attributionOutput, sentinel, "utf8");
    await writeFile(
      paths.scoringOutput,
      'export const LOCKED_GOLDEN_MANIFEST_SHA256 = "' +
        "0".repeat(64) +
        '";\n',
      "utf8"
    );
    await expect(generateUnifiedGoldenBindings(paths)).rejects.toThrow(
      "unified_golden_generated_source_mismatch"
    );
    expect(await readFile(paths.attributionOutput, "utf8")).toBe(sentinel);
  });
});
