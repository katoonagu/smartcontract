import { closeSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
  if (process.platform !== "win32" && (stat.mode & 0o022) !== 0) throw new Error("artifact_root_untrusted_write_mode");
  return canonical;
}

export function assertArtifactRootOutsideRepository(root: string, repositoryRoot: string): void {
  const canonicalRoot = assertSafeArtifactRootPath(root);
  const canonicalRepository = realpathSync(resolve(repositoryRoot));
  const relation = relative(canonicalRepository, canonicalRoot);
  if (relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) {
    throw new Error("artifact_root_inside_repository");
  }
}

export function safeArtifactPath(root: string, filename: string): string {
  if (!filename || filename.includes("\0") || filename.includes("/") || filename.includes("\\") || filename === "." || filename === "..") {
    throw new Error("artifact_path_invalid");
  }
  const canonicalRoot = assertSafeArtifactRootPath(root);
  const path = resolve(join(canonicalRoot, filename));
  if (relative(canonicalRoot, path).startsWith("..")) throw new Error("artifact_path_escape");
  if (existsNoThrow(path)) {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("artifact_path_not_regular");
    const after = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error("artifact_path_identity_changed");
  }
  return path;
}

function existsNoThrow(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function syncParentDirectory(path: string): void {
  const directory = openSync(dirname(path), "r");
  try {
    try { fsyncSync(directory); }
    catch (error) {
      // ponytail: Node cannot FlushFileBuffers on an NTFS directory handle.
      // File handles are still flushed; replace this with a native directory
      // flush helper if Node exposes one.
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally { closeSync(directory); }
}

export function writeExclusiveDurable(path: string, bytes: Buffer): void {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  syncParentDirectory(path);
}

export function replaceDurable(path: string, bytes: Buffer): void {
  const temporary = `${path}.replace-${process.pid}-${releaseSha256V2(bytes).slice(0, 12)}`;
  writeExclusiveDurable(temporary, bytes);
  renameSync(temporary, path);
  syncParentDirectory(path);
}

export function moveNoOverwriteDurable(source: string, destination: string): void {
  if (existsNoThrow(destination)) throw new Error("durable_move_destination_exists");
  linkSync(source, destination);
  const linked = statSync(destination);
  const original = statSync(source);
  if (linked.dev !== original.dev || linked.ino !== original.ino) throw new Error("durable_move_identity_mismatch");
  unlinkSync(source);
  syncParentDirectory(source);
}

export function unlinkDurable(path: string): void {
  unlinkSync(path);
  syncParentDirectory(path);
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
      unlinkDurable(path);
      released = true;
    }
  };
}

export function resumeRootWriterLeaseV2(
  root: string,
  expected: {
    writerOperationKind: string;
    writerOperationKeySha256: string;
    ownerPid: number;
    ownerProcessStartFingerprintSha256: string;
  }
): RootWriterLeaseHandleV2 {
  const path = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  const bytes = readFileSync(path);
  const payload = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (payload.writerOperationKind !== expected.writerOperationKind
      || payload.writerOperationKeySha256 !== expected.writerOperationKeySha256
      || payload.ownerPid !== expected.ownerPid
      || payload.ownerProcessStartFingerprintSha256 !== expected.ownerProcessStartFingerprintSha256) {
    throw new Error("root_writer_lease_not_owned");
  }
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
      unlinkDurable(path);
      released = true;
    }
  };
}
