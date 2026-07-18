import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "release-root-writer-unit-"));
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [value, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  }
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

  it.runIf(process.platform === "win32")(
    "rejects a foreign writer on an existing protected subtree or target file",
    async () => {
      const api = await loadApi();
      const artifactRoot = root();
      const protectedDirectory = join(artifactRoot, "operational-attestations");
      const target = join(protectedDirectory, "evidence.json");
      mkdirSync(protectedDirectory);
      writeFileSync(target, "{}\n", "utf8");

      execFileSync("icacls.exe", [protectedDirectory, "/grant", "*S-1-1-0:(M)"]);
      expect(() => api.safeArtifactRelativePath(artifactRoot, "operational-attestations/new.json"))
        .toThrow(/acl|principal|write/i);

      execFileSync("icacls.exe", [protectedDirectory, "/remove", "*S-1-1-0"]);
      execFileSync("icacls.exe", [target, "/grant", "*S-1-1-0:(M)"]);
      expect(() => api.safeArtifactRelativePath(artifactRoot, "operational-attestations/evidence.json"))
        .toThrow(/acl|principal|write/i);
    }
  );
});

describe("release root writer lease resume", () => {
  const frozenLease = () => ({
    version: "frozen-root-writer-lease-v2" as const,
    scope: "artifact_root" as const,
    relativePath: "manifest-transition-root.lease.json" as const,
    writerOperationKind: "manifest_transition" as const,
    writerOperationKeySha256: "1".repeat(64),
    transitionKeySha256: "2".repeat(64),
    protectedRootFingerprintSha256: "3".repeat(64),
    candidateSha: "4".repeat(40),
    releaseGenerationId: "generation-1",
    releaseFreezeIdentitySha256: "5".repeat(64),
    leaseEpoch: 1,
    ownerPid: 1234,
    ownerProcessStartFingerprintSha256: "6".repeat(64),
    acquiredAt: "2026-07-18T10:00:00.000Z",
    heartbeatAt: "2026-07-18T10:00:00.000Z",
    expiresAt: "2026-07-18T10:01:00.000Z"
  });

  const bootstrapLease = () => ({
    version: "bootstrap-root-writer-lease-v2" as const,
    scope: "artifact_root" as const,
    relativePath: "manifest-transition-root.lease.json" as const,
    writerOperationKind: "release_freeze_materialization" as const,
    writerOperationKeySha256: "1".repeat(64),
    protectedRootFingerprintSha256: "3".repeat(64),
    task0BPreflightEvidenceSha256: "7".repeat(64),
    candidateSha: "4".repeat(40),
    runtimeIdentitySha256: "8".repeat(64),
    releaseGenerationId: null,
    releaseFreezeIdentitySha256: null,
    leaseEpoch: 1,
    ownerPid: 1234,
    ownerProcessStartFingerprintSha256: "6".repeat(64),
    acquiredAt: "2026-07-18T10:00:00.000Z",
    heartbeatAt: "2026-07-18T10:00:00.000Z",
    expiresAt: "2026-07-18T10:01:00.000Z"
  });

  it("rejects non-canonical or non-exact bootstrap and frozen lease bytes", async () => {
    const api = await loadApi();
    for (const lease of [bootstrapLease(), frozenLease()]) {
      const artifactRoot = root();
      writeFileSync(join(artifactRoot, api.ROOT_WRITER_LEASE_FILE), JSON.stringify(lease, null, 2), "utf8");
      expect(() => api.resumeRootWriterLeaseV2(artifactRoot, lease))
        .toThrow(/canonical|schema|lease/i);
    }

    const artifactRoot = root();
    const lease = { ...frozenLease(), unexpected: true };
    writeFileSync(join(artifactRoot, api.ROOT_WRITER_LEASE_FILE), api.canonicalBytesV2(lease));
    expect(() => api.resumeRootWriterLeaseV2(artifactRoot, lease))
      .toThrow(/schema|key|lease/i);
  });

  it("binds resume to the full operation root freeze generation epoch deadline and transition", async () => {
    const api = await loadApi();
    const changes = [
      { writerOperationKeySha256: "9".repeat(64) },
      { protectedRootFingerprintSha256: "a".repeat(64) },
      { candidateSha: "b".repeat(40) },
      { releaseGenerationId: "generation-2" },
      { releaseFreezeIdentitySha256: "c".repeat(64) },
      { leaseEpoch: 2 },
      { acquiredAt: "2026-07-18T09:59:00.000Z" },
      { heartbeatAt: "2026-07-18T10:00:30.000Z" },
      { expiresAt: "2026-07-18T10:02:00.000Z" },
      { transitionKeySha256: "d".repeat(64) }
    ];
    for (const change of changes) {
      const artifactRoot = root();
      const lease = frozenLease();
      writeFileSync(join(artifactRoot, api.ROOT_WRITER_LEASE_FILE), api.canonicalBytesV2(lease));
      expect(() => api.resumeRootWriterLeaseV2(artifactRoot, { ...lease, ...change }))
        .toThrow(/not_owned|binding|lease/i);
    }

    for (const change of [
      { task0BPreflightEvidenceSha256: "a".repeat(64) },
      { runtimeIdentitySha256: "b".repeat(64) },
      { protectedRootFingerprintSha256: "c".repeat(64) },
      { candidateSha: "d".repeat(40) },
      { leaseEpoch: 2 },
      { expiresAt: "2026-07-18T10:02:00.000Z" }
    ]) {
      const artifactRoot = root();
      const lease = bootstrapLease();
      writeFileSync(join(artifactRoot, api.ROOT_WRITER_LEASE_FILE), api.canonicalBytesV2(lease));
      expect(() => api.resumeRootWriterLeaseV2(artifactRoot, { ...lease, ...change }))
        .toThrow(/not_owned|binding|lease/i);
    }
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
      assertTrustedPublishedFile: (path: string) => { events.push(`trust:${path}`); },
      unlink: (path: string) => { events.push(`unlink:${path}`); }
    });

    expect(events).toEqual([
      "link",
      "sync:destination",
      "trust:destination",
      "unlink:source",
      "sync:source"
    ]);
  });

  it("keeps the source and removes only the exact linked destination when final trust validation fails", async () => {
    const api = await loadApi();
    const identity = { dev: 1, ino: 2 };
    let sourcePresent = true;
    let destinationPresent = false;

    expect(() => api.moveNoOverwriteDurableWithOpsV2("source", "destination", {
      destinationExists: () => destinationPresent,
      assertStableRegularFile: () => identity,
      link: () => { destinationPresent = true; },
      statIdentity: () => identity,
      syncParentDirectory: () => undefined,
      assertTrustedPublishedFile: () => { throw new Error("artifact_root_acl_untrusted_write_principal"); },
      unlink: (path: string) => {
        if (path === "source") sourcePresent = false;
        if (path === "destination") destinationPresent = false;
      }
    })).toThrow(/acl|principal|write/i);
    expect(sourcePresent).toBe(true);
    expect(destinationPresent).toBe(false);
  });

  it("removes root-level and nested exclusive targets when their post-create DACL check fails", async () => {
    const api = await loadApi();
    for (const nested of [false, true]) {
      const artifactRoot = root();
      const parent = nested ? join(artifactRoot, "protected") : artifactRoot;
      if (nested) mkdirSync(parent);
      const target = join(parent, "new-evidence.json");

      expect(() => api.writeExclusiveDurableWithOpsV2(target, Buffer.from("{}\n", "utf8"), {
        assertTrustedPublishedFile: () => {
          throw new Error("artifact_root_acl_untrusted_write_principal");
        }
      })).toThrow(/acl|principal|writer|trust/i);
      expect(existsSync(target)).toBe(false);
    }
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
