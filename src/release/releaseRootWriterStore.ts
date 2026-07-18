import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { canonicalReleaseJsonV2, releaseSha256V2 } from "./remediationReleaseManifestV2";

export const ROOT_WRITER_LEASE_FILE = "manifest-transition-root.lease.json";

export function canonicalBytesV2(value: unknown): Buffer {
  return Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8");
}

export function assertSafeArtifactRootPath(root: string): string {
  if (!isAbsolute(root)) throw new Error("artifact_root_must_be_absolute");
  const canonical = realpathSync(resolve(root));
  const stat = lstatSync(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("artifact_root_untrusted");
  return canonical;
}

export function safeArtifactPath(root: string, filename: string): string {
  if (!filename || filename.includes("\0") || filename.includes("/") || filename.includes("\\") || filename === "." || filename === "..") {
    throw new Error("artifact_path_invalid");
  }
  const canonicalRoot = assertSafeArtifactRootPath(root);
  const path = resolve(join(canonicalRoot, filename));
  if (relative(canonicalRoot, path).startsWith("..")) throw new Error("artifact_path_escape");
  return path;
}

export function writeExclusiveDurable(path: string, bytes: Buffer): void {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function replaceDurable(path: string, bytes: Buffer): void {
  const temporary = `${path}.replace-${process.pid}-${releaseSha256V2(bytes).slice(0, 12)}`;
  writeExclusiveDurable(temporary, bytes);
  renameSync(temporary, path);
  const directory = openSync(dirname(path), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export type RootWriterLeaseHandleV2 = {
  path: string;
  bytes: Buffer;
  sha256: string;
  payload: Record<string, unknown>;
  release(): void;
  assertOwned(): void;
};

export function acquireRootWriterLeaseV2(root: string, payload: Record<string, unknown>): RootWriterLeaseHandleV2 {
  const path = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  const bytes = canonicalBytesV2(payload);
  writeExclusiveDurable(path, bytes);
  const sha256 = releaseSha256V2(bytes);
  let released = false;
  return {
    path, bytes, sha256, payload,
    assertOwned() {
      if (released || releaseSha256V2(readFileSync(path)) !== sha256) throw new Error("root_writer_lease_fenced");
    },
    release() {
      if (released) return;
      if (releaseSha256V2(readFileSync(path)) !== sha256) throw new Error("root_writer_lease_fenced");
      unlinkSync(path);
      released = true;
    }
  };
}
