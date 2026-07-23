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
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import { generateUnifiedGoldenBindings } from "../../scripts/generateUnifiedGoldenBindings";

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
    const manifest = JSON.parse(
      await readFile(join(paths.goldenRoot, "locked-manifest.json"), "utf8")
    ) as Record<string, unknown>;

    expect(generated.lockedGoldenManifestSha256).toBe(
      fingerprintCanonicalArtifact(manifest)
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

  it("is deterministic when the manifest case input order changes", async () => {
    const paths = await fixture();
    await generateUnifiedGoldenBindings(paths);
    const expectedAttribution = await readFile(paths.attributionOutput, "utf8");
    const expectedScoring = await readFile(paths.scoringOutput, "utf8");
    const manifestPath = join(paths.goldenRoot, "locked-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      cases: unknown[];
    };
    manifest.cases.reverse();
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    await generateUnifiedGoldenBindings({ ...paths, replace: true });
    const changedHash = fingerprintCanonicalArtifact(manifest);

    expect(
      (await readFile(paths.attributionOutput, "utf8"))
        .replace(changedHash, "<manifest>")
    ).toBe(expectedAttribution.replace(generatedHash(expectedAttribution), "<manifest>"));
    expect(
      (await readFile(paths.scoringOutput, "utf8"))
        .replaceAll(changedHash, "<manifest>")
    ).toBe(expectedScoring.replaceAll(generatedHash(expectedScoring), "<manifest>"));
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
    await expect(generateUnifiedGoldenBindings(paths)).rejects.toThrow(
      "unified_golden_manifest_not_locked"
    );

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
    ).rejects.toThrow("unified_golden_adjudication_hash_mismatch");
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
});

function generatedHash(source: string): string {
  const match = source.match(
    /LOCKED_GOLDEN_MANIFEST_SHA256 = "([a-f0-9]{64})"/
  );
  if (!match) throw new Error("test_generated_hash_missing");
  return match[1]!;
}
