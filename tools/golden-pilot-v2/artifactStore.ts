import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  unlink
} from "node:fs/promises";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { canonicalJson } from "./canonicalJson";

export interface PublishedArtifact {
  relativePath: string;
  sha256: string;
  byteLength: number;
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function validateRelativePath(relativePath: string): string[] {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    posix.isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    posix.normalize(relativePath) !== relativePath
  ) {
    throw new TypeError("golden_artifact_path_invalid");
  }
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError("golden_artifact_path_invalid");
  }
  return segments;
}

async function statIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (errno(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function prepareArtifactPath(
  root: string,
  relativePath: string,
  createParents: boolean
): Promise<string> {
  const segments = validateRelativePath(relativePath);
  const absoluteRoot = resolve(root);
  if (createParents) {
    await mkdir(absoluteRoot, { recursive: true });
  }
  const rootStat = await statIfPresent(absoluteRoot);
  if (!rootStat?.isDirectory()) {
    throw new TypeError("golden_artifact_root_invalid");
  }
  if (rootStat.isSymbolicLink()) {
    throw new TypeError("golden_artifact_symlink_forbidden");
  }

  let current = absoluteRoot;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const currentStat = await statIfPresent(current);
    if (currentStat?.isSymbolicLink()) {
      throw new TypeError("golden_artifact_symlink_forbidden");
    }
    if (currentStat && !currentStat.isDirectory()) {
      throw new TypeError("golden_artifact_parent_invalid");
    }
  }

  const destination = join(absoluteRoot, ...segments);
  if (!createParents) {
    return destination;
  }

  await mkdir(dirname(destination), { recursive: true });
  current = absoluteRoot;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const currentStat = await lstat(current);
    if (currentStat.isSymbolicLink()) {
      throw new TypeError("golden_artifact_symlink_forbidden");
    }
    if (!currentStat.isDirectory()) {
      throw new TypeError("golden_artifact_parent_invalid");
    }
  }
  return destination;
}

async function fsyncDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch (error) {
    if (!["EISDIR", "EINVAL", "ENOTSUP", "EPERM"].includes(errno(error) ?? "")) {
      throw error;
    }
  } finally {
    await directory?.close();
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function publishArtifactOnce(
  root: string,
  relativePath: string,
  value: unknown
): Promise<PublishedArtifact> {
  const destination = await prepareArtifactPath(root, relativePath, true);
  const existing = await statIfPresent(destination);
  if (existing?.isSymbolicLink()) {
    throw new TypeError("golden_artifact_symlink_forbidden");
  }
  if (existing) {
    throw new Error("golden_artifact_already_exists");
  }

  const bytes = Buffer.from(canonicalJson(value), "utf8");
  const temporaryPath = join(
    dirname(destination),
    `.${relativePath.split("/").at(-1)}.${randomUUID()}.tmp`
  );
  let temporaryExists = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, destination);
    } catch (error) {
      if (errno(error) === "EEXIST") {
        throw new Error("golden_artifact_already_exists");
      }
      throw error;
    }
    await unlink(temporaryPath);
    temporaryExists = false;
    await fsyncDirectory(dirname(destination));
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  return {
    relativePath,
    sha256: hashBytes(bytes),
    byteLength: bytes.byteLength
  };
}

export async function verifyPublishedArtifact(
  root: string,
  artifact: PublishedArtifact
): Promise<PublishedArtifact> {
  const destination = await prepareArtifactPath(
    root,
    artifact.relativePath,
    false
  );
  const destinationStat = await lstat(destination);
  if (destinationStat.isSymbolicLink()) {
    throw new TypeError("golden_artifact_symlink_forbidden");
  }
  if (!destinationStat.isFile()) {
    throw new TypeError("golden_artifact_not_file");
  }
  const bytes = await readFile(destination);
  if (
    bytes.byteLength !== artifact.byteLength ||
    hashBytes(bytes) !== artifact.sha256
  ) {
    throw new Error("golden_artifact_verification_failed");
  }
  return artifact;
}
