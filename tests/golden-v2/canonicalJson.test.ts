import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalSha256
} from "../../tools/golden-pilot-v2/canonicalJson";
import {
  publishArtifactOnce,
  verifyPublishedArtifact
} from "../../tools/golden-pilot-v2/artifactStore";

describe("Golden V2 canonical artifacts", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true })
      )
    );
  });

  async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "golden-v2-"));
    temporaryRoots.push(root);
    return root;
  }

  it("sorts objects, preserves ordered arrays and hashes decimal strings", () => {
    const left = { z: ["b", "a"], a: { raw: "1000000", value: 1 } };
    const right = { a: { value: 1, raw: "1000000" }, z: ["b", "a"] };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalSha256(left)).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => canonicalJson({ value: undefined })).toThrow(
      "golden_undefined_value"
    );
    expect(() => canonicalJson([undefined])).toThrow("golden_undefined_value");
  });

  it("publishes once and detects later byte changes", async () => {
    const root = await temporaryRoot();
    const first = await publishArtifactOnce(root, "case/a.json", {
      version: "v1",
      n: 1
    });
    await expect(
      publishArtifactOnce(root, "case/a.json", { version: "v1", n: 2 })
    ).rejects.toThrow("golden_artifact_already_exists");
    expect(await verifyPublishedArtifact(root, first)).toEqual(first);
    expect(JSON.parse(await readFile(join(root, "case/a.json"), "utf8"))).toEqual({
      n: 1,
      version: "v1"
    });

    await writeFile(join(root, "case/a.json"), '{"n":2,"version":"v1"}', "utf8");
    await expect(verifyPublishedArtifact(root, first)).rejects.toThrow(
      "golden_artifact_verification_failed"
    );
  });

  it("rejects paths outside the explicit artifact root", async () => {
    const root = await temporaryRoot();
    await expect(
      publishArtifactOnce(root, "../escape.json", {})
    ).rejects.toThrow("golden_artifact_path_invalid");
    await expect(
      publishArtifactOnce(root, join(root, "absolute.json"), {})
    ).rejects.toThrow("golden_artifact_path_invalid");
    await expect(
      publishArtifactOnce(root, "nested\\windows.json", {})
    ).rejects.toThrow("golden_artifact_path_invalid");
  });

  it("refuses to publish through a symlinked parent", async () => {
    const root = await temporaryRoot();
    const target = join(root, "target");
    await mkdir(target);
    await symlink(target, join(root, "linked"), "junction");

    await expect(
      publishArtifactOnce(root, "linked/a.json", {})
    ).rejects.toThrow("golden_artifact_symlink_forbidden");
  });
});
