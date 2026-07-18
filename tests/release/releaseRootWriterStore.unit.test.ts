import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "release-root-writer-unit-"));
  roots.push(value);
  return value;
}

async function loadApi(): Promise<any> {
  return import("../../src/release/releaseRootWriterStore");
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("release root trust boundary", () => {
  it("rejects a root supplied through a symlink or junction before canonicalization", async () => {
    const api = await loadApi();
    const parent = root();
    const target = join(parent, "target");
    const alias = join(parent, "alias");
    mkdirSync(target);
    symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");

    expect(() => api.assertSafeArtifactRootPath(alias)).toThrow(/reparse|symlink|untrusted/i);
  });

  it("rejects an existing reparse component below the supplied root", async () => {
    const api = await loadApi();
    const parent = root();
    const outside = root();
    const alias = join(parent, "component");
    symlinkSync(outside, alias, process.platform === "win32" ? "junction" : "dir");

    expect(() => api.safeArtifactRelativePath(parent, "component/evidence.json"))
      .toThrow(/reparse|symlink|untrusted/i);
  });

  it("creates only explicitly allowlisted nested directories and keeps the file contained", async () => {
    const api = await loadApi();
    const artifactRoot = root();
    const relativePath = "operational-attestations/readiness/generation-1/evidence.json";
    const allowedDirectories = [
      "operational-attestations",
      "operational-attestations/readiness",
      "operational-attestations/readiness/generation-1"
    ];

    const path = api.safeArtifactRelativePath(artifactRoot, relativePath, {
      createParents: true,
      allowedDirectories
    });

    expect(path).toBe(join(artifactRoot, ...relativePath.split("/")));
    expect(() => api.safeArtifactRelativePath(artifactRoot, "foreign/evidence.json", {
      createParents: true,
      allowedDirectories
    })).toThrow(/allowlist|directory/i);
    expect(() => api.safeArtifactRelativePath(artifactRoot, "../escape.json", {
      createParents: true,
      allowedDirectories
    })).toThrow(/invalid|escape/i);
  });

  it("fails closed when a strict Windows ACL inspection is unavailable or grants foreign write access", async () => {
    const api = await loadApi();
    const artifactRoot = root();
    const unavailable = () => { throw new Error("inspection unavailable"); };
    const foreignWriter = () => [{ principal: "S-1-1-0", access: "allow", rights: "FW" }];
    const trustedWriters = () => [
      { principal: "SY", access: "allow", rights: "FA" },
      { principal: "BA", access: "allow", rights: "FA" },
      { principal: "S-1-5-80-123", access: "allow", rights: "0x1201bf" }
    ];

    expect(() => api.assertWindowsArtifactRootAclV2(artifactRoot, ["SY", "BA", "S-1-5-80-123"], unavailable))
      .toThrow(/acl|unverifiable|inspection/i);
    expect(() => api.assertWindowsArtifactRootAclV2(artifactRoot, ["SY", "BA", "S-1-5-80-123"], foreignWriter))
      .toThrow(/acl|principal|write/i);
    expect(() => api.assertWindowsArtifactRootAclV2(artifactRoot, ["SY", "BA", "S-1-5-80-123"], trustedWriters))
      .not.toThrow();
  });
});

describe("release root durable file operations", () => {
  it("fsyncs the destination directory before unlinking the no-overwrite source", async () => {
    const api = await loadApi();
    const events: string[] = [];
    const identity = { dev: 1, ino: 2 };

    api.moveNoOverwriteDurableWithOpsV2("source", "destination", {
      destinationExists: () => false,
      assertStableRegularFile: () => identity,
      link: () => { events.push("link"); },
      statIdentity: () => identity,
      syncParentDirectory: (path: string) => { events.push(`sync:${path}`); },
      unlink: (path: string) => { events.push(`unlink:${path}`); }
    });

    expect(events).toEqual([
      "link",
      "sync:destination",
      "unlink:source",
      "sync:source"
    ]);
  });

  it("reuses an identical deterministic stale replace temp but rejects conflicting bytes", async () => {
    const api = await loadApi();
    const artifactRoot = root();
    const target = join(artifactRoot, "release-manifest.json");
    const first = Buffer.from("first\n", "utf8");
    const replacement = Buffer.from("replacement\n", "utf8");
    const replacementHash = createHash("sha256").update(replacement).digest("hex");
    const identicalTemp = `${target}.replace-${process.pid}-${replacementHash.slice(0, 12)}`;
    writeFileSync(target, first);
    writeFileSync(identicalTemp, replacement);

    api.replaceDurable(target, replacement);
    expect(readFileSync(target)).toEqual(replacement);

    const conflict = Buffer.from("other\n", "utf8");
    const conflictHash = createHash("sha256").update(conflict).digest("hex");
    const conflictingTemp = `${target}.replace-${process.pid}-${conflictHash.slice(0, 12)}`;
    writeFileSync(conflictingTemp, Buffer.from("tampered\n", "utf8"));
    expect(() => api.replaceDurable(target, conflict)).toThrow(/stale|conflict|temp/i);
    expect(readFileSync(target)).toEqual(replacement);
  });
});
