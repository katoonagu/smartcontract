import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { canonicalReleaseJsonV2, releaseSha256V2 } from "./remediationReleaseManifestV2";

export const ROOT_WRITER_LEASE_FILE = "manifest-transition-root.lease.json";

export function canonicalBytesV2(value: unknown): Buffer {
  return Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8");
}

type FileIdentityV2 = { dev: number | bigint; ino: number | bigint };

export type WindowsAclEntryV2 = {
  principal: string;
  access: "allow" | "deny";
  rights: string;
};

export type WindowsAclInspectorV2 = (canonicalRoot: string) => readonly WindowsAclEntryV2[];

export type ArtifactRootSafetyOptionsV2 = {
  windowsAcl?: {
    allowlistedPrincipals: readonly string[];
    inspector?: WindowsAclInspectorV2;
  };
};

function sameIdentity(left: FileIdentityV2, right: FileIdentityV2): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function identityOf(stat: FileIdentityV2): FileIdentityV2 {
  return { dev: stat.dev, ino: stat.ino };
}

function pathEquals(left: string, right: string): boolean {
  return process.platform === "win32"
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function isContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function assertExistingPathComponentsNotReparse(path: string): void {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean)) {
    current = join(current, segment);
    if (!existsNoThrow(current)) return;
    if (lstatSync(current).isSymbolicLink()) throw new Error("artifact_path_reparse_component");
  }
}

function assertStableDirectory(path: string, containmentRoot?: string): FileIdentityV2 {
  const before = lstatSync(path);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("artifact_directory_untrusted");
  if (process.platform !== "win32") {
    if ((before.mode & 0o077) !== 0) throw new Error("artifact_directory_untrusted_mode");
    if (typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("artifact_directory_untrusted_owner");
  }
  const canonical = realpathSync(path);
  if (containmentRoot && !isContained(containmentRoot, canonical)) throw new Error("artifact_path_escape");
  const after = lstatSync(path);
  if (!after.isDirectory() || after.isSymbolicLink() || !sameIdentity(identityOf(before), identityOf(after))) {
    throw new Error("artifact_directory_identity_changed");
  }
  return identityOf(after);
}

function assertStableRegularFile(path: string, containmentRoot?: string): FileIdentityV2 {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("artifact_path_not_regular");
  const canonical = realpathSync(path);
  if (containmentRoot && !isContained(containmentRoot, canonical)) throw new Error("artifact_path_escape");
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    const after = lstatSync(path);
    if (!opened.isFile() || !after.isFile() || after.isSymbolicLink()
        || !sameIdentity(identityOf(before), identityOf(opened))
        || !sameIdentity(identityOf(opened), identityOf(after))) {
      throw new Error("artifact_path_identity_changed");
    }
  } finally {
    closeSync(descriptor);
  }
  return identityOf(before);
}

function readStableRegularFile(path: string, containmentRoot?: string): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("artifact_path_not_regular");
  const canonical = realpathSync(path);
  if (containmentRoot && !isContained(containmentRoot, canonical)) throw new Error("artifact_path_escape");
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameIdentity(identityOf(before), identityOf(opened))) {
      throw new Error("artifact_path_identity_changed");
    }
    const bytes = readFileSync(descriptor);
    const after = lstatSync(path);
    if (!after.isFile() || after.isSymbolicLink() || !sameIdentity(identityOf(opened), identityOf(after))) {
      throw new Error("artifact_path_identity_changed");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function assertSafeArtifactRootPathWithoutAcl(root: string): string {
  if (!isAbsolute(root)) throw new Error("artifact_root_must_be_absolute");
  const supplied = resolve(root);
  assertExistingPathComponentsNotReparse(supplied);
  const before = lstatSync(supplied);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("artifact_root_untrusted");
  const canonical = realpathSync(supplied);
  const stat = lstatSync(supplied);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("artifact_root_untrusted");
  if (!sameIdentity(identityOf(before), identityOf(stat)) || !pathEquals(supplied, canonical)) {
    throw new Error("artifact_root_identity_changed");
  }
  if (process.platform !== "win32") {
    if ((stat.mode & 0o077) !== 0) throw new Error("artifact_root_untrusted_mode");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("artifact_root_untrusted_owner");
  }
  return canonical;
}

export function assertSafeArtifactRootPath(root: string, options: ArtifactRootSafetyOptionsV2 = {}): string {
  const canonical = assertSafeArtifactRootPathWithoutAcl(root);
  if (process.platform === "win32" && options.windowsAcl) {
    assertWindowsArtifactRootAclV2(
      canonical,
      options.windowsAcl.allowlistedPrincipals,
      options.windowsAcl.inspector ?? inspectWindowsArtifactRootAclV2
    );
  }
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
  return safeArtifactRelativePath(root, filename);
}

export type SafeArtifactRelativePathOptionsV2 = {
  createParents?: boolean;
  allowedDirectories?: readonly string[];
};

function relativeSegments(path: string): string[] {
  if (!path || path.includes("\0") || isAbsolute(path) || path.includes("\\")) throw new Error("artifact_relative_path_invalid");
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".."
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment))) {
    throw new Error("artifact_relative_path_invalid");
  }
  return segments;
}

export function safeArtifactRelativePath(
  root: string,
  relativePath: string,
  options: SafeArtifactRelativePathOptionsV2 = {}
): string {
  const canonicalRoot = assertSafeArtifactRootPath(root);
  const rootIdentity = assertStableDirectory(canonicalRoot);
  const segments = relativeSegments(relativePath);
  const allowedDirectories = new Set((options.allowedDirectories ?? []).map((value) => relativeSegments(value).join("/")));
  let current = canonicalRoot;
  const traversed: string[] = [];

  for (const segment of segments.slice(0, -1)) {
    traversed.push(segment);
    const relativeDirectory = traversed.join("/");
    const next = join(current, segment);
    if (!isContained(canonicalRoot, resolve(next))) throw new Error("artifact_path_escape");
    if (!existsNoThrow(next)) {
      if (!options.createParents) throw new Error("artifact_parent_missing");
      if (!allowedDirectories.has(relativeDirectory)) throw new Error("artifact_directory_not_allowlisted");
      const parentIdentity = assertStableDirectory(current, canonicalRoot);
      mkdirSync(next, { mode: 0o700 });
      syncParentDirectory(next);
      if (!sameIdentity(parentIdentity, assertStableDirectory(current, canonicalRoot))) {
        throw new Error("artifact_parent_identity_changed");
      }
    }
    assertExistingPathComponentsNotReparse(next);
    assertStableDirectory(next, canonicalRoot);
    current = next;
  }

  const target = join(current, segments.at(-1)!);
  if (!isContained(canonicalRoot, resolve(target))) throw new Error("artifact_path_escape");
  if (existsNoThrow(target)) assertStableRegularFile(target, canonicalRoot);
  if (!sameIdentity(rootIdentity, assertStableDirectory(canonicalRoot))) throw new Error("artifact_root_identity_changed");
  return target;
}

function existsNoThrow(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function normalizePrincipal(principal: string): string {
  return principal.trim().replace(/^\*/u, "").toUpperCase();
}

function parseWindowsAclDescriptorV2(raw: string): WindowsAclEntryV2[] {
  const descriptor = raw.split(/\r?\n/u).find((line) => line.includes("("));
  if (!descriptor) throw new Error("artifact_root_acl_unverifiable");
  const entries: WindowsAclEntryV2[] = [];
  for (const match of descriptor.matchAll(/\(([^()]*)\)/gu)) {
    const fields = match[1]!.split(";");
    if (fields.length !== 6) throw new Error("artifact_root_acl_unverifiable");
    const [kind, , rights, , , principal] = fields;
    if (kind !== "A" && kind !== "D") throw new Error("artifact_root_acl_unverifiable");
    if (!rights || !principal) throw new Error("artifact_root_acl_unverifiable");
    entries.push({ principal, access: kind === "A" ? "allow" : "deny", rights });
  }
  if (entries.length === 0) throw new Error("artifact_root_acl_unverifiable");
  return entries;
}

export function inspectWindowsArtifactRootAclV2(canonicalRoot: string): readonly WindowsAclEntryV2[] {
  const scratch = mkdtempSync(join(tmpdir(), "release-root-acl-"));
  const output = join(scratch, "acl.txt");
  try {
    const result = spawnSync("icacls.exe", [canonicalRoot, "/save", output, "/c", "/q"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true
    });
    if (result.error || result.status !== 0 || !existsNoThrow(output)) throw new Error("artifact_root_acl_unverifiable");
    return parseWindowsAclDescriptorV2(readFileSync(output).toString("utf16le").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error("artifact_root_acl_unverifiable", { cause: error });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function grantsWrite(rights: string): boolean {
  if (/^0x[0-9a-f]+$/iu.test(rights)) {
    const mask = BigInt(rights);
    const writeMask = 0x10000000n | 0x40000000n | 0x00010000n | 0x00040000n | 0x00080000n
      | 0x00000002n | 0x00000004n | 0x00000010n | 0x00000040n | 0x00000100n;
    return (mask & writeMask) !== 0n;
  }
  const tokens = rights.match(/[A-Z]{2}/gu);
  if (!tokens || tokens.join("") !== rights.toUpperCase()) throw new Error("artifact_root_acl_unverifiable");
  return tokens.some((token) => new Set(["FA", "FW", "GA", "GW", "SD", "WD", "WO", "DC"]).has(token));
}

export function assertWindowsArtifactRootAclV2(
  root: string,
  allowlistedPrincipals: readonly string[],
  inspector: WindowsAclInspectorV2 = inspectWindowsArtifactRootAclV2
): void {
  const canonical = assertSafeArtifactRootPathWithoutAcl(root);
  const allowlist = new Set(allowlistedPrincipals.map(normalizePrincipal).filter(Boolean));
  if (allowlist.size === 0) throw new Error("artifact_root_acl_allowlist_empty");
  let entries: readonly WindowsAclEntryV2[];
  try {
    entries = inspector(canonical);
  } catch (error) {
    throw new Error("artifact_root_acl_unverifiable", { cause: error });
  }
  if (entries.length === 0) throw new Error("artifact_root_acl_unverifiable");
  let trustedWriterFound = false;
  for (const entry of entries) {
    if (entry.access !== "allow" && entry.access !== "deny") throw new Error("artifact_root_acl_unverifiable");
    if (entry.access === "deny" || !grantsWrite(entry.rights)) continue;
    if (!allowlist.has(normalizePrincipal(entry.principal))) throw new Error("artifact_root_acl_untrusted_write_principal");
    trustedWriterFound = true;
  }
  if (!trustedWriterFound) throw new Error("artifact_root_acl_no_trusted_writer");
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
  assertExistingPathComponentsNotReparse(dirname(path));
  assertStableDirectory(dirname(path));
  if (existsNoThrow(path)) assertStableRegularFile(path);
  try {
    writeExclusiveDurable(temporary, bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    assertStableRegularFile(temporary, dirname(path));
    if (!readStableRegularFile(temporary, dirname(path)).equals(bytes)) throw new Error("durable_replace_stale_temp_conflict");
    const descriptor = openSync(temporary, "r+");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
  if (existsNoThrow(path) && readStableRegularFile(path, dirname(path)).equals(bytes)) {
    unlinkSync(temporary);
    syncParentDirectory(temporary);
    return;
  }
  renameSync(temporary, path);
  syncParentDirectory(path);
  assertStableRegularFile(path, dirname(path));
  if (!readStableRegularFile(path, dirname(path)).equals(bytes)) throw new Error("durable_replace_verification_failed");
}

export type MoveNoOverwriteDurableOpsV2 = {
  destinationExists(path: string): boolean;
  assertStableRegularFile(path: string): FileIdentityV2;
  link(source: string, destination: string): void;
  statIdentity(path: string): FileIdentityV2;
  syncParentDirectory(path: string): void;
  unlink(path: string): void;
};

const DEFAULT_MOVE_OPS: MoveNoOverwriteDurableOpsV2 = {
  destinationExists: existsNoThrow,
  assertStableRegularFile,
  link: linkSync,
  statIdentity(path) { return identityOf(statSync(path)); },
  syncParentDirectory,
  unlink: unlinkSync
};

export function moveNoOverwriteDurableWithOpsV2(
  source: string,
  destination: string,
  operations: MoveNoOverwriteDurableOpsV2
): void {
  if (operations.destinationExists(destination)) throw new Error("durable_move_destination_exists");
  const original = operations.assertStableRegularFile(source);
  operations.link(source, destination);
  const linked = operations.statIdentity(destination);
  const sourceAfterLink = operations.statIdentity(source);
  if (!sameIdentity(linked, original) || !sameIdentity(sourceAfterLink, original)) {
    throw new Error("durable_move_identity_mismatch");
  }
  operations.syncParentDirectory(destination);
  const linkedAfterSync = operations.statIdentity(destination);
  const sourceBeforeUnlink = operations.statIdentity(source);
  if (!sameIdentity(linkedAfterSync, original) || !sameIdentity(sourceBeforeUnlink, original)) {
    throw new Error("durable_move_identity_changed");
  }
  operations.unlink(source);
  operations.syncParentDirectory(source);
}

export function moveNoOverwriteDurable(source: string, destination: string): void {
  moveNoOverwriteDurableWithOpsV2(source, destination, DEFAULT_MOVE_OPS);
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
