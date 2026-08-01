import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rmdir,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, TextDecoder } from "node:util";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import pg from "pg";

import {
  deriveServiceRoleShadowRuntimeReplaySourceV1,
  parseServiceRoleShadowC1AcceptanceV1,
  parseServiceRoleShadowRuntimeReplayIdentityV1,
  parseServiceRoleShadowRuntimeReplayInputV1,
  serializeServiceRoleShadowC1AcceptanceV1,
  serializeServiceRoleShadowRuntimeReplayIdentityV1,
  serializeServiceRoleShadowRuntimeReplayInputV1,
  validateServiceRoleShadowRuntimeReplayPairV1,
  type ServiceRoleShadowC1AcceptanceV1,
  type ServiceRoleShadowRuntimeReplayIdentityV1,
  type ServiceRoleShadowRuntimeReplayInputV1
} from "../src/unifiedCheck/serviceRoleShadowRuntime.js";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../src/forensics/canonicalJson.js";
import { deriveServiceRoleShadowAcceptedHistoryBindingV1 } from
  "../src/unifiedCheck/serviceRoleShadow.js";
import { traversalStateId, type TraversalStateV1 } from
  "../src/unifiedCheck/traversal.js";
import { canonicalTronUsdtEventKey } from
  "../src/forensics/tronAddressAllTimeIndex.js";
import type { IndexedTronUsdtTransfer } from "../src/types.js";
import { createUnifiedPoolTransactionHost } from
  "../src/unifiedCheck/repository.js";
import { createUnifiedProductionRuntime } from
  "../src/unifiedCheck/productionRuntime.js";
import type { FrozenLabelDatasetV1 } from
  "../src/unifiedCheck/frozenLabels.js";

export const SERVICE_ROLE_SHADOW_RUNTIME_ACCEPTANCE_MAX_FILE_BYTES =
  512 * 1024 * 1024;

export type ServiceRoleShadowRuntimeAcceptanceCommand =
  | {
      readonly kind: "prepare";
      readonly runId: string;
      readonly manifestSha256: string;
      readonly anchor: string;
      readonly testedSourceCommit: string;
      readonly outputRoot: string;
      readonly confirm: true;
    }
  | {
      readonly kind: "verify-input";
      readonly inputPath: string;
      readonly identityPath: string;
    }
  | {
      readonly kind: "replay";
      readonly inputPath: string;
      readonly identityPath: string;
      readonly outputPath: string;
      readonly confirm: true;
    }
  | { readonly kind: "verify-acceptance"; readonly acceptancePath: string };

export type ServiceRoleShadowRuntimeGitCommandRunner = (
  args: readonly string[],
  cwd: string
) => Promise<{ readonly stdout: string }>;

export interface ServiceRoleShadowOutputRootReservationV1 {
  publish(input: {
    readonly replayInputBytes: string;
    readonly replayIdentityBytes: string;
  }): Promise<void>;
  abort(): Promise<void>;
}

export interface ServiceRoleShadowOutputFileReservationV1 {
  publish(bytes: string): Promise<void>;
  abort(): Promise<void>;
}

export interface ServiceRoleShadowRuntimeAcceptanceCliDependencies {
  readonly repoRoot: string;
  readonly scriptPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readArtifactFile: (path: string) => Promise<string>;
  readonly verifyGitState: typeof verifyServiceRoleShadowRuntimeGitStateV1;
  readonly reserveOutputRoot: (
    path: string
  ) => Promise<ServiceRoleShadowOutputRootReservationV1>;
  readonly reserveOutputFile: (
    path: string
  ) => Promise<ServiceRoleShadowOutputFileReservationV1>;
  readonly prepareFromDatabase: (input: {
    readonly databaseUrl: string;
    readonly command: Extract<ServiceRoleShadowRuntimeAcceptanceCommand, { kind: "prepare" }>;
  }) => Promise<{
    readonly replayInput: ServiceRoleShadowRuntimeReplayInputV1;
    readonly replayIdentity: ServiceRoleShadowRuntimeReplayIdentityV1;
  }>;
  readonly replayFromDatabase: (input: {
    readonly databaseUrl: string;
    readonly replayInput: ServiceRoleShadowRuntimeReplayInputV1;
    readonly replayIdentity: ServiceRoleShadowRuntimeReplayIdentityV1;
  }) => Promise<ServiceRoleShadowC1AcceptanceV1>;
  readonly writeStdout: (bytes: string) => void;
}

export function parseServiceRoleShadowRuntimeAcceptanceCommand(
  argv: readonly string[]
): ServiceRoleShadowRuntimeAcceptanceCommand {
  try {
    const [command, ...tokens] = argv;
    if (![
      "prepare",
      "verify-input",
      "replay",
      "verify-acceptance"
    ].includes(command ?? "")) throw new TypeError("invalid_command");
    const values = new Map<string, string | true>();
    for (let index = 0; index < tokens.length; index += 1) {
      const flag = tokens[index]!;
      if (!flag.startsWith("--") || values.has(flag)) {
        throw new TypeError("invalid_flag");
      }
      if (flag === "--confirm") {
        values.set(flag, true);
        continue;
      }
      const value = tokens[++index];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        throw new TypeError("invalid_value");
      }
      values.set(flag, value);
    }
    const exact = (expected: readonly string[]): void => {
      if (
        values.size !== expected.length ||
        [...values.keys()].some((flag) => !expected.includes(flag))
      ) throw new TypeError("invalid_flags");
    };
    const text = (flag: string): string => {
      const value = values.get(flag);
      if (typeof value !== "string") throw new TypeError("invalid_value");
      return value;
    };
    const uuid = (value: string): string => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
        throw new TypeError("invalid_uuid");
      }
      return value;
    };
    const hash = (value: string): string => {
      if (!/^[0-9a-f]{64}$/u.test(value)) throw new TypeError("invalid_hash");
      return value;
    };
    const commit = (value: string): string => {
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)) {
        throw new TypeError("invalid_commit");
      }
      return value;
    };
    const timestamp = (value: string): string => {
      const milliseconds = Date.parse(value);
      if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value ||
        milliseconds % 1_000 !== 0) throw new TypeError("invalid_timestamp");
      return value;
    };
    if (command === "prepare") {
      exact([
        "--run",
        "--manifest",
        "--anchor",
        "--tested-source-commit",
        "--output-root",
        "--confirm"
      ]);
      if (values.get("--confirm") !== true) throw new TypeError("invalid_confirm");
      return {
        kind: "prepare",
        runId: uuid(text("--run")),
        manifestSha256: hash(text("--manifest")),
        anchor: timestamp(text("--anchor")),
        testedSourceCommit: commit(text("--tested-source-commit")),
        outputRoot: text("--output-root"),
        confirm: true
      };
    }
    if (command === "verify-input") {
      exact(["--input", "--identity"]);
      const inputPath = text("--input");
      const identityPath = text("--identity");
      if (resolve(inputPath) === resolve(identityPath)) throw new TypeError("path_collision");
      return { kind: "verify-input", inputPath, identityPath };
    }
    if (command === "replay") {
      exact(["--input", "--identity", "--output", "--confirm"]);
      if (values.get("--confirm") !== true) throw new TypeError("invalid_confirm");
      const inputPath = text("--input");
      const identityPath = text("--identity");
      const outputPath = text("--output");
      const paths = [inputPath, identityPath, outputPath].map((value) => resolve(value));
      if (new Set(paths).size !== paths.length) throw new TypeError("path_collision");
      return { kind: "replay", inputPath, identityPath, outputPath, confirm: true };
    }
    exact(["--acceptance"]);
    return { kind: "verify-acceptance", acceptancePath: text("--acceptance") };
  } catch {
    throw new Error("service_role_shadow_runtime_acceptance_command_invalid");
  }
}

export async function verifyServiceRoleShadowRuntimeGitStateV1(_input: {
  readonly mode: "prepare" | "verify-input" | "replay";
  readonly repoRoot: string;
  readonly scriptPath: string;
  readonly testedSourceCommit: string;
  readonly allowedUntrackedFiles: readonly {
    readonly path: string;
    readonly expectedBytes: string | Uint8Array;
  }[];
  readonly runGit: ServiceRoleShadowRuntimeGitCommandRunner;
  readonly readFile: (path: string) => Promise<string | Uint8Array>;
}): Promise<void> {
  try {
    const input = _input;
    const normalizedRoot = resolve(input.repoRoot);
    const withinRoot = (path: string): string => {
      const absolute = resolve(path);
      const child = relative(normalizedRoot, absolute);
      if (child === "" || child === ".." || child.startsWith(`..${sep}`) ||
        isAbsolute(child)) throw new TypeError("path_outside_root");
      return child.replaceAll("\\", "/");
    };
    const scriptRelative = withinRoot(input.scriptPath);
    if (scriptRelative !== "scripts/replayServiceRoleShadowRuntimeAcceptance.ts") {
      throw new TypeError("script_path_invalid");
    }
    const showTop = (await input.runGit(
      ["rev-parse", "--show-toplevel"],
      normalizedRoot
    )).stdout.trim();
    if (resolve(showTop) !== normalizedRoot) throw new TypeError("repo_root_invalid");
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.testedSourceCommit)) {
      throw new TypeError("tested_commit_invalid");
    }
    const head = (await input.runGit(["rev-parse", "HEAD"], normalizedRoot))
      .stdout.trim();
    if (head !== input.testedSourceCommit) throw new TypeError("head_mismatch");
    const required = [
      "scripts/replayServiceRoleShadowRuntimeAcceptance.ts",
      "src/unifiedCheck/serviceRoleShadowRuntime.ts",
      "src/unifiedCheck/productionTraversalCoordinator.ts",
      "src/unifiedCheck/productionRuntime.ts",
      "tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts",
      "tests/unified-check/serviceRoleShadowRuntime.test.ts",
      "tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts"
    ] as const;
    const tree = (await input.runGit([
      "ls-tree",
      "-rz",
      "--full-tree",
      input.testedSourceCommit,
      "--",
      ...required
    ], normalizedRoot)).stdout;
    const observed = new Map<string, { mode: string; type: string }>();
    for (const item of tree.split("\0")) {
      if (item === "") continue;
      const match = /^(\d{6}) ([^ ]+) [0-9a-f]{40,64}\t(.+)$/u.exec(item);
      if (!match || observed.has(match[3]!)) throw new TypeError("git_tree_invalid");
      observed.set(match[3]!, { mode: match[1]!, type: match[2]! });
    }
    if (
      observed.size !== required.length ||
      required.some((path) => {
        const item = observed.get(path);
        return !item || item.type !== "blob" ||
          (item.mode !== "100644" && item.mode !== "100755");
      })
    ) throw new TypeError("git_tree_invalid");

    const allowed = new Map<string, string | Uint8Array>();
    for (const file of input.allowedUntrackedFiles) {
      const relativePath = withinRoot(resolve(normalizedRoot, file.path));
      if (allowed.has(relativePath)) throw new TypeError("allowlist_duplicate");
      allowed.set(relativePath, file.expectedBytes);
    }
    if (input.mode === "prepare" && allowed.size !== 0) {
      throw new TypeError("prepare_allowlist_invalid");
    }
    if (input.mode !== "prepare" && allowed.size !== 2) {
      throw new TypeError("input_allowlist_invalid");
    }
    const status = (await input.runGit(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      normalizedRoot
    )).stdout;
    const untracked: string[] = [];
    for (const item of status.split("\0")) {
      if (item === "") continue;
      if (!item.startsWith("?? ")) throw new TypeError("tracked_change");
      untracked.push(item.slice(3).replaceAll("\\", "/"));
    }
    untracked.sort();
    const expectedPaths = [...allowed.keys()].sort();
    if (JSON.stringify(untracked) !== JSON.stringify(expectedPaths)) {
      throw new TypeError("untracked_mismatch");
    }
    const sameBytes = (left: string | Uint8Array, right: string | Uint8Array): boolean => {
      const normalize = (value: string | Uint8Array) => typeof value === "string"
        ? new TextEncoder().encode(value)
        : value;
      const leftBytes = normalize(left);
      const rightBytes = normalize(right);
      return leftBytes.length === rightBytes.length &&
        leftBytes.every((value, index) => value === rightBytes[index]);
    };
    for (const [relativePath, expectedBytes] of allowed) {
      const actual = await input.readFile(resolve(normalizedRoot, relativePath));
      if (!sameBytes(actual, expectedBytes)) throw new TypeError("untracked_bytes_mismatch");
    }
  } catch {
    throw new Error("service_role_shadow_runtime_git_state_invalid");
  }
}

function parseCanonicalJsonFile<T>(input: {
  readonly bytes: string;
  readonly parse: (value: unknown) => T;
  readonly serialize: (value: T) => string;
}): T {
  const value = input.parse(JSON.parse(input.bytes));
  if (input.serialize(value) !== input.bytes) {
    throw new Error("service_role_shadow_runtime_acceptance_file_noncanonical");
  }
  return value;
}

function databaseUrlFrom(
  env: Readonly<Record<string, string | undefined>>
): string {
  const value = env.DATABASE_URL;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("service_role_shadow_runtime_acceptance_database_url_required");
  }
  return value;
}

export async function runServiceRoleShadowRuntimeAcceptanceCli(
  argv: readonly string[],
  dependencies?: ServiceRoleShadowRuntimeAcceptanceCliDependencies
): Promise<void> {
  const command = parseServiceRoleShadowRuntimeAcceptanceCommand(argv);
  const deps = dependencies ?? defaultServiceRoleShadowRuntimeAcceptanceCliDependencies();
  if (command.kind === "verify-acceptance") {
    const bytes = await deps.readArtifactFile(command.acceptancePath);
    const acceptance = parseCanonicalJsonFile({
      bytes,
      parse: parseServiceRoleShadowC1AcceptanceV1,
      serialize: serializeServiceRoleShadowC1AcceptanceV1
    });
    deps.writeStdout(`${canonicalizeArtifactJson({
      schemaVersion: "service-role-shadow-c1-acceptance-proof-v1",
      testedSourceCommit: acceptance.testedSourceCommit,
      replayInputSha256: acceptance.replayInputSha256,
      replayIdentitySha256: acceptance.replayIdentitySha256,
      acceptanceSha256: fingerprintCanonicalArtifact(acceptance)
    })}\n`);
    return;
  }
  if (command.kind === "prepare") {
    await deps.verifyGitState({
      mode: "prepare",
      repoRoot: deps.repoRoot,
      scriptPath: deps.scriptPath,
      testedSourceCommit: command.testedSourceCommit,
      allowedUntrackedFiles: [],
      runGit: defaultGitCommandRunner,
      readFile: async (path) => deps.readArtifactFile(path)
    });
    const reservation = await deps.reserveOutputRoot(command.outputRoot);
    try {
      const produced = await deps.prepareFromDatabase({
        databaseUrl: databaseUrlFrom(deps.env),
        command
      });
      const pair = validateServiceRoleShadowRuntimeReplayPairV1(produced);
      if (
        pair.replayInput.sourceRunId !== command.runId ||
        pair.replayInput.sourceAddressHistoryManifestSha256 !== command.manifestSha256 ||
        pair.replayInput.sourceAnchor !== command.anchor ||
        pair.replayInput.testedSourceCommit !== command.testedSourceCommit
      ) throw new Error("service_role_shadow_runtime_prepare_result_mismatch");
      await reservation.publish({
        replayInputBytes: serializeServiceRoleShadowRuntimeReplayInputV1(pair.replayInput),
        replayIdentityBytes: serializeServiceRoleShadowRuntimeReplayIdentityV1(pair.replayIdentity)
      });
    } catch (error) {
      await reservation.abort();
      throw error;
    }
    return;
  }

  const inputBytes = await deps.readArtifactFile(command.inputPath);
  const identityBytes = await deps.readArtifactFile(command.identityPath);
  const replayInput = parseCanonicalJsonFile({
    bytes: inputBytes,
    parse: parseServiceRoleShadowRuntimeReplayInputV1,
    serialize: serializeServiceRoleShadowRuntimeReplayInputV1
  });
  const replayIdentity = parseCanonicalJsonFile({
    bytes: identityBytes,
    parse: parseServiceRoleShadowRuntimeReplayIdentityV1,
    serialize: serializeServiceRoleShadowRuntimeReplayIdentityV1
  });
  validateServiceRoleShadowRuntimeReplayPairV1({ replayInput, replayIdentity });
  await deps.verifyGitState({
    mode: command.kind,
    repoRoot: deps.repoRoot,
    scriptPath: deps.scriptPath,
    testedSourceCommit: replayInput.testedSourceCommit,
    allowedUntrackedFiles: [
      { path: command.inputPath, expectedBytes: inputBytes },
      { path: command.identityPath, expectedBytes: identityBytes }
    ],
    runGit: defaultGitCommandRunner,
    readFile: async (path) => deps.readArtifactFile(path)
  });
  if (command.kind === "verify-input") {
    deps.writeStdout(`${canonicalizeArtifactJson({
      schemaVersion: "service-role-shadow-runtime-replay-input-proof-v1",
      testedSourceCommit: replayInput.testedSourceCommit,
      replayInputSha256: fingerprintCanonicalArtifact(replayInput),
      replayIdentitySha256: fingerprintCanonicalArtifact(replayIdentity)
    })}\n`);
    return;
  }

  const reservation = await deps.reserveOutputFile(command.outputPath);
  try {
    const acceptance = parseServiceRoleShadowC1AcceptanceV1(
      await deps.replayFromDatabase({
        databaseUrl: databaseUrlFrom(deps.env),
        replayInput,
        replayIdentity
      })
    );
    if (
      serializeServiceRoleShadowRuntimeReplayInputV1(acceptance.replayInput) !== inputBytes ||
      serializeServiceRoleShadowRuntimeReplayIdentityV1(acceptance.replayIdentity) !== identityBytes
    ) throw new Error("service_role_shadow_runtime_replay_result_mismatch");
    await reservation.publish(serializeServiceRoleShadowC1AcceptanceV1(acceptance));
  } catch (error) {
    await reservation.abort();
    throw error;
  }
}

const execFileAsync = promisify(execFile);
const defaultGitCommandRunner: ServiceRoleShadowRuntimeGitCommandRunner = async (
  args,
  cwd
) => {
  const result = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  return { stdout: result.stdout };
};

function withinRoot(root: string, path: string): string {
  const normalizedRoot = resolve(root);
  const absolute = resolve(path);
  const child = relative(normalizedRoot, absolute);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error("service_role_shadow_runtime_acceptance_path_outside_root");
  }
  return absolute;
}

async function assertNoSymlinkPath(root: string, path: string): Promise<string> {
  const normalizedRoot = resolve(root);
  const absolute = withinRoot(normalizedRoot, path);
  const rootReal = await realpath(normalizedRoot);
  const child = relative(normalizedRoot, absolute);
  let cursor = normalizedRoot;
  for (const segment of child.split(/[\\/]/u)) {
    cursor = resolve(cursor, segment);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error("service_role_shadow_runtime_acceptance_symlink_rejected");
    }
  }
  const parentReal = await realpath(dirname(absolute));
  const parentChild = relative(rootReal, parentReal);
  if (parentChild === ".." || parentChild.startsWith(`..${sep}`) || isAbsolute(parentChild)) {
    throw new Error("service_role_shadow_runtime_acceptance_path_outside_root");
  }
  return absolute;
}

async function secureReadArtifactFile(root: string, path: string): Promise<string> {
  const absolute = await assertNoSymlinkPath(root, path);
  const handle = await open(
    absolute,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() ||
      before.size > SERVICE_ROLE_SHADOW_RUNTIME_ACCEPTANCE_MAX_FILE_BYTES) {
      throw new Error("service_role_shadow_runtime_acceptance_file_invalid");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      bytes.byteLength !== before.size
    ) throw new Error("service_role_shadow_runtime_acceptance_file_changed");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}

async function validateNewOutputParent(root: string, path: string): Promise<string> {
  const absolute = withinRoot(root, path);
  const parent = dirname(absolute);
  await assertNoSymlinkPath(root, parent);
  try {
    await lstat(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return absolute;
    throw error;
  }
  throw new Error("service_role_shadow_runtime_acceptance_output_exists");
}

async function reserveOutputRoot(
  root: string,
  path: string
): Promise<ServiceRoleShadowOutputRootReservationV1> {
  const absolute = await validateNewOutputParent(root, path);
  await mkdir(absolute);
  let published = false;
  const files = [
    resolve(absolute, "runtime-shadow-replay-input-v1.json"),
    resolve(absolute, "runtime-shadow-replay-identity-v1.json")
  ] as const;
  return {
    publish: async ({ replayInputBytes, replayIdentityBytes }) => {
      if (published) throw new Error("service_role_shadow_runtime_acceptance_output_published");
      for (const [index, bytes] of [replayInputBytes, replayIdentityBytes].entries()) {
        const handle = await open(
          files[index]!,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
            (fsConstants.O_NOFOLLOW ?? 0),
          0o600
        );
        try {
          await handle.writeFile(bytes, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      published = true;
    },
    abort: async () => {
      if (published) return;
      for (const file of files) {
        try { await unlink(file); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      try { await rmdir(absolute); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  };
}

async function reserveOutputFile(
  root: string,
  path: string
): Promise<ServiceRoleShadowOutputFileReservationV1> {
  const absolute = await validateNewOutputParent(root, path);
  let handle: FileHandle | null = await open(
    absolute,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
      (fsConstants.O_NOFOLLOW ?? 0),
    0o600
  );
  let published = false;
  return {
    publish: async (bytes) => {
      if (!handle || published) {
        throw new Error("service_role_shadow_runtime_acceptance_output_published");
      }
      await handle.writeFile(bytes, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      published = true;
    },
    abort: async () => {
      if (published) return;
      if (handle) {
        await handle.close();
        handle = null;
      }
      try { await unlink(absolute); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  };
}

type ServiceRoleShadowPrepareRow = Readonly<Record<string, unknown>>;

export interface ServiceRoleShadowPrepareQueryableV1 {
  query(
    sql: string,
    values: readonly unknown[]
  ): Promise<{ readonly rows: readonly ServiceRoleShadowPrepareRow[] }>;
}

function deterministicReplayUuid(seed: string, label: string): string {
  const bytes = createHash("sha256").update(`${seed}\0${label}`, "utf8").digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)}-${hex.slice(20)}`;
}

function prepareArtifact(row: ServiceRoleShadowPrepareRow): {
  readonly kind: string;
  readonly schemaVersion: string;
  readonly sha256: string;
  readonly artifactJson: unknown;
} {
  const artifact = {
    kind: String(row.kind),
    schemaVersion: String(row.schema_version),
    sha256: String(row.sha256),
    artifactJson: row.artifact_json
  };
  if (fingerprintCanonicalArtifact(artifact.artifactJson) !== artifact.sha256) {
    throw new Error("service_role_shadow_runtime_prepare_artifact_hash_invalid");
  }
  return artifact;
}

function recordValue(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildServiceRoleShadowRuntimeAcceptancePrepareContractsV1(input: {
  readonly command: Extract<ServiceRoleShadowRuntimeAcceptanceCommand, { kind: "prepare" }>;
  readonly authorityRows: readonly ServiceRoleShadowPrepareRow[];
  readonly artifactRows: readonly ServiceRoleShadowPrepareRow[];
}): {
  readonly replayInput: ServiceRoleShadowRuntimeReplayInputV1;
  readonly replayIdentity: ServiceRoleShadowRuntimeReplayIdentityV1;
} {
  if (input.authorityRows.length !== 1) {
    throw new Error("service_role_shadow_runtime_prepare_source_absent");
  }
  const authority = input.authorityRows[0]!;
  const analysis = recordValue(
    authority.analysis_json,
    "service_role_shadow_runtime_prepare_analysis_invalid"
  );
  if (
    authority.run_status !== "FAILED_TECHNICAL" ||
    authority.traversal_task_status !== "CANCELLED" ||
    authority.history_task_status !== "COMPLETED" ||
    authority.planner_state !== "committed" ||
    authority.history_artifact_sha256 !== input.command.manifestSha256 ||
    analysis.runId !== input.command.runId ||
    typeof analysis.runtimeCommit !== "string" ||
    analysis.runtimeCommit.length === 0
  ) throw new Error("service_role_shadow_runtime_prepare_source_authority_invalid");
  const checkpointJson = recordValue(
    authority.checkpoint_json,
    "service_role_shadow_runtime_prepare_checkpoint_invalid"
  );
  const checkpointHead = checkpointJson.deltaHeadSha256;
  const sourceCompactionSha256 = checkpointJson.compactionSha256;
  if (
    typeof checkpointHead !== "string" || !/^[0-9a-f]{64}$/u.test(checkpointHead) ||
    typeof sourceCompactionSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(sourceCompactionSha256)
  ) {
    throw new Error("service_role_shadow_runtime_prepare_checkpoint_invalid");
  }

  const candidates = input.artifactRows.map(prepareArtifact);
  const sourceAnalysisSha256 = fingerprintCanonicalArtifact(analysis);
  const sourceAnalysisRows = candidates.filter((row) =>
    row.sha256 === sourceAnalysisSha256 && row.kind === "analysis_manifest" &&
    row.schemaVersion === "1"
  );
  if (sourceAnalysisRows.length !== 1) {
    throw new Error("service_role_shadow_runtime_prepare_analysis_invalid");
  }
  const sourceAnalysisRow = sourceAnalysisRows[0]!;
  const sourceCompactionRows = candidates.filter((row) =>
    row.sha256 === sourceCompactionSha256 &&
    row.kind === "traversal_compaction_v2" && row.schemaVersion === "1"
  );
  if (sourceCompactionRows.length !== 1) {
    throw new Error("service_role_shadow_runtime_prepare_compaction_invalid");
  }
  const sourceCompactionRow = sourceCompactionRows[0]!;
  const manifestRows = candidates.filter((row) =>
    row.sha256 === input.command.manifestSha256 &&
    row.kind === "address_history_manifest" && row.schemaVersion === "1"
  );
  if (manifestRows.length !== 1) {
    throw new Error("service_role_shadow_runtime_prepare_manifest_invalid");
  }
  const manifestRow = manifestRows[0]!;
  const manifest = recordValue(
    manifestRow.artifactJson,
    "service_role_shadow_runtime_prepare_manifest_invalid"
  );
  if (
    typeof manifest.snapshotHash !== "string" ||
    manifest.snapshotHash !== analysis.snapshotHash ||
    manifest.key !== authority.logical_key ||
    !Array.isArray(manifest.pageArtifactHashes) ||
    manifest.pageArtifactHashes.length === 0
  ) throw new Error("service_role_shadow_runtime_prepare_manifest_invalid");
  const sourcePageHashes = manifest.pageArtifactHashes.map(String);
  const pageByHash = new Map(candidates.filter((row) =>
    row.kind === "address_history_page" && row.schemaVersion === "1"
  ).map((row) => [row.sha256, row]));
  const pages = sourcePageHashes.map((sha256) => {
    const row = pageByHash.get(sha256);
    if (!row) throw new Error("service_role_shadow_runtime_prepare_page_invalid");
    return row;
  });

  const wrapperRows = candidates.filter((row) => {
    if (row.kind !== "service_role_event_role_map" || row.schemaVersion !== "2") {
      return false;
    }
    const body = recordValue(row.artifactJson, "service_role_shadow_runtime_prepare_role_invalid");
    const binding = recordValue(body.binding, "service_role_shadow_runtime_prepare_role_invalid");
    const anchor = recordValue(
      binding.anchorBinding,
      "service_role_shadow_runtime_prepare_role_invalid"
    );
    return body.runId === input.command.runId &&
      body.snapshotHash === manifest.snapshotHash &&
      body.addressHistoryManifestSha256 === input.command.manifestSha256 &&
      anchor.timestamp === input.command.anchor;
  });
  if (wrapperRows.length !== 1) {
    throw new Error("service_role_shadow_runtime_prepare_role_invalid");
  }
  const wrapperRow = wrapperRows[0]!;
  const wrapper = recordValue(
    wrapperRow.artifactJson,
    "service_role_shadow_runtime_prepare_role_invalid"
  );
  const mapV1Rows = candidates.filter((row) =>
    row.kind === "service_role_event_role_map" && row.schemaVersion === "1" &&
    row.sha256 === wrapper.sourceEventRoleMapV1Sha256
  );
  const bundleRows = candidates.filter((row) =>
    row.kind === "service_role_event_evidence_bundle" && row.schemaVersion === "1" &&
    row.sha256 === wrapper.evidenceBundleSha256
  );
  if (mapV1Rows.length !== 1 || bundleRows.length !== 1) {
    throw new Error("service_role_shadow_runtime_prepare_role_invalid");
  }
  const mapV1Row = mapV1Rows[0]!;
  const bundleRow = bundleRows[0]!;

  const allDeltas = new Map(candidates.filter((row) =>
    row.kind === "traversal_delta" && row.schemaVersion === "1"
  ).map((row) => [row.sha256, row]));
  const deltas: typeof candidates = [];
  const states = new Map<string, TraversalStateV1>();
  const seen = new Set<string>();
  let cursor: string | null = checkpointHead;
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw new Error("service_role_shadow_runtime_prepare_delta_invalid");
    }
    seen.add(cursor);
    const row = allDeltas.get(cursor);
    if (!row) throw new Error("service_role_shadow_runtime_prepare_delta_invalid");
    deltas.push(row);
    const delta = recordValue(
      row.artifactJson,
      "service_role_shadow_runtime_prepare_delta_invalid"
    );
    for (const state of [
      ...(Array.isArray(delta.addedFrontier) ? delta.addedFrontier : []),
      ...(Array.isArray(delta.addedVisited) ? delta.addedVisited : [])
    ]) {
      const typed = state as TraversalStateV1;
      states.set(traversalStateId(typed), typed);
    }
    const previous = delta.previousDeltaHash;
    if (!(previous === null ||
      (typeof previous === "string" && /^[0-9a-f]{64}$/u.test(previous)))) {
      throw new Error("service_role_shadow_runtime_prepare_delta_invalid");
    }
    cursor = previous;
  }

  const events = new Map<string, IndexedTronUsdtTransfer>();
  for (const pageRow of pages) {
    const page = recordValue(
      pageRow.artifactJson,
      "service_role_shadow_runtime_prepare_page_invalid"
    );
    if (!Array.isArray(page.events)) {
      throw new Error("service_role_shadow_runtime_prepare_page_invalid");
    }
    for (const serialized of page.events) {
      const eventRow = recordValue(
        serialized,
        "service_role_shadow_runtime_prepare_page_invalid"
      );
      if (typeof eventRow.blockTimestamp !== "string") {
        throw new Error("service_role_shadow_runtime_prepare_page_invalid");
      }
      const event = {
        ...eventRow,
        blockTimestamp: new Date(eventRow.blockTimestamp)
      } as IndexedTronUsdtTransfer;
      events.set(canonicalTronUsdtEventKey(event), event);
    }
  }
  const wrapperBinding = recordValue(
    wrapper.binding,
    "service_role_shadow_runtime_prepare_role_invalid"
  );
  const qualifyingTraversalStateIds = [...states.entries()].filter(([, state]) => {
    if (state.address !== manifest.address || state.anchorTimestamp !== input.command.anchor) {
      return false;
    }
    try {
      return canonicalizeArtifactJson(deriveServiceRoleShadowAcceptedHistoryBindingV1({
        state,
        acceptedHistoryEvents: [...events.values()]
      })) === canonicalizeArtifactJson(wrapperBinding);
    } catch {
      return false;
    }
  }).map(([stateId]) => stateId).sort(compareText);
  if (qualifyingTraversalStateIds.length !== 7) {
    throw new Error("service_role_shadow_runtime_prepare_state_cardinality_invalid");
  }
  const qualifyingJson = canonicalizeArtifactJson(qualifyingTraversalStateIds);
  const targetRows = deltas.filter((row) => {
    const delta = recordValue(
      row.artifactJson,
      "service_role_shadow_runtime_prepare_delta_invalid"
    );
    if (!Array.isArray(delta.addedVisited) ||
      !Array.isArray(delta.removedFrontierStateIds)) return false;
    const added = delta.addedVisited.map((state) =>
      traversalStateId(state as TraversalStateV1)
    ).sort(compareText);
    const removed = delta.removedFrontierStateIds.map(String).sort(compareText);
    return canonicalizeArtifactJson(added) === qualifyingJson &&
      canonicalizeArtifactJson(removed) === qualifyingJson;
  });
  if (targetRows.length !== 1) {
    throw new Error("service_role_shadow_runtime_prepare_target_delta_invalid");
  }
  const replayDeltaRows: typeof deltas = [];
  let replayCursor: string | null = targetRows[0]!.sha256;
  while (replayCursor !== null) {
    const row = allDeltas.get(replayCursor);
    if (!row) throw new Error("service_role_shadow_runtime_prepare_delta_invalid");
    replayDeltaRows.push(row);
    const previous = recordValue(
      row.artifactJson,
      "service_role_shadow_runtime_prepare_delta_invalid"
    ).previousDeltaHash;
    replayCursor = previous === null ? null : String(previous);
  }

  const acceptedPlannerEntry = {
    canonicalSequence: Number(authority.canonical_sequence),
    taskId: String(authority.history_task_id),
    acceptedAttemptId: String(authority.accepted_attempt_id),
    manifestKey: String(authority.logical_key),
    artifactSha256: input.command.manifestSha256
  };
  const sourceArtifacts = [
    sourceAnalysisRow,
    sourceCompactionRow,
    manifestRow,
    ...pages,
    bundleRow,
    mapV1Row,
    wrapperRow,
    ...replayDeltaRows
  ].sort((left, right) => compareText(
    `${left.kind}\0${left.schemaVersion}\0${left.sha256}`,
    `${right.kind}\0${right.schemaVersion}\0${right.sha256}`
  ));
  const replayInput = parseServiceRoleShadowRuntimeReplayInputV1({
    schemaVersion: "service-role-shadow-runtime-replay-input-v1",
    testedSourceCommit: input.command.testedSourceCommit,
    sourceRunId: input.command.runId,
    sourceAnalysisManifestSha256: sourceAnalysisSha256,
    sourceAddressHistoryManifestSha256: input.command.manifestSha256,
    sourceSnapshotHash: manifest.snapshotHash,
    sourceAnchor: input.command.anchor,
    sourceRunStatus: "FAILED_TECHNICAL",
    sourceTraversalTaskStatus: "CANCELLED",
    sourceRuntimeCommit: analysis.runtimeCommit,
    acceptedPlannerEntry,
    qualifyingTraversalStateIds,
    sourceArtifacts,
    observedTraversalCheckpoint: {
      sha256: fingerprintCanonicalArtifact(checkpointJson),
      checkpointJson
    },
    sourceFrozenLabelDataset: {
      sha256: String(analysis.labelDatasetSha256),
      datasetJson: authority.label_dataset_json
    },
    productionEffect: false
  });

  const seed = fingerprintCanonicalArtifact(replayInput);
  const replayRunId = deterministicReplayUuid(seed, "run");
  const replayAnalysis = {
    ...analysis,
    runId: replayRunId,
    runtimeCommit: input.command.testedSourceCommit,
    databaseSchemaVersion: 37
  };
  const replayAnalysisSha256 = fingerprintCanonicalArtifact(replayAnalysis);
  const replayAnalysisArtifact = {
    kind: "analysis_manifest",
    schemaVersion: "1",
    sha256: replayAnalysisSha256,
    artifactJson: replayAnalysis
  };
  const sourceDerivation = deriveServiceRoleShadowRuntimeReplaySourceV1(replayInput);
  const replayCompactionJson = {
    ...recordValue(sourceDerivation.sourceCompaction.artifactJson, "invalid_compaction"),
    analysisManifestHash: replayAnalysisSha256
  };
  const replayCompaction = {
    kind: "traversal_compaction_v2",
    schemaVersion: "1",
    sha256: fingerprintCanonicalArtifact(replayCompactionJson),
    artifactJson: replayCompactionJson
  };
  const replayPredecessorJson = {
    ...recordValue(
      sourceDerivation.derivedSourcePredecessorCheckpoint.checkpointJson,
      "invalid_derived_predecessor"
    ),
    analysisManifestHash: replayAnalysisSha256,
    compactionSha256: replayCompaction.sha256
  };
  const replayPages = pages.map((row) => {
    const artifactJson = { ...recordValue(row.artifactJson, "invalid_page"), runId: replayRunId };
    return {
      kind: row.kind,
      schemaVersion: row.schemaVersion,
      sha256: fingerprintCanonicalArtifact(artifactJson),
      artifactJson
    };
  });
  const replayManifestJson = {
    ...manifest,
    pageArtifactHashes: replayPages.map((row) => row.sha256)
  };
  const replayManifest = {
    kind: manifestRow.kind,
    schemaVersion: manifestRow.schemaVersion,
    sha256: fingerprintCanonicalArtifact(replayManifestJson),
    artifactJson: replayManifestJson
  };
  const replayBundleJson = {
    ...recordValue(bundleRow.artifactJson, "invalid_bundle"),
    runId: replayRunId,
    addressHistoryManifestSha256: replayManifest.sha256
  };
  const replayBundle = {
    kind: bundleRow.kind,
    schemaVersion: bundleRow.schemaVersion,
    sha256: fingerprintCanonicalArtifact(replayBundleJson),
    artifactJson: replayBundleJson
  };
  const sourceMap = recordValue(mapV1Row.artifactJson, "invalid_map");
  const replayMapJson = {
    ...sourceMap,
    runId: replayRunId,
    addressHistoryManifestSha256: replayManifest.sha256,
    entries: (sourceMap.entries as readonly Record<string, unknown>[]).map((entry) => ({
      ...entry,
      evidenceSha256: replayBundle.sha256
    }))
  };
  const replayMap = {
    kind: mapV1Row.kind,
    schemaVersion: mapV1Row.schemaVersion,
    sha256: fingerprintCanonicalArtifact(replayMapJson),
    artifactJson: replayMapJson
  };
  const replayWrapperJson = {
    ...wrapper,
    runId: replayRunId,
    addressHistoryManifestSha256: replayManifest.sha256,
    sourceEventRoleMapV1Sha256: replayMap.sha256,
    evidenceBundleSha256: replayBundle.sha256
  };
  const replayWrapper = {
    kind: wrapperRow.kind,
    schemaVersion: wrapperRow.schemaVersion,
    sha256: fingerprintCanonicalArtifact(replayWrapperJson),
    artifactJson: replayWrapperJson
  };
  const replayIdentity = parseServiceRoleShadowRuntimeReplayIdentityV1({
    schemaVersion: "service-role-shadow-runtime-replay-identity-v1",
    testedSourceCommit: input.command.testedSourceCommit,
    replayInputSha256: seed,
    replay: {
      runId: replayRunId,
      requestId: deterministicReplayUuid(seed, "request"),
      analysisManifestSha256: replayAnalysisSha256,
      directHistoryTaskId: deterministicReplayUuid(seed, "direct-history-task"),
      directHistoryAttemptId: deterministicReplayUuid(seed, "direct-history-attempt"),
      traversalTaskId: deterministicReplayUuid(seed, "traversal-task"),
      acceptedAttemptId: deterministicReplayUuid(seed, "history-attempt"),
      runtimeCommit: input.command.testedSourceCommit
    },
    plannerEntryMapping: {
      source: acceptedPlannerEntry,
      replay: {
        ...acceptedPlannerEntry,
        taskId: deterministicReplayUuid(seed, "history-task"),
        acceptedAttemptId: deterministicReplayUuid(seed, "history-attempt"),
        artifactSha256: replayManifest.sha256
      }
    },
    sourceTargetDeltaSha256: sourceDerivation.sourceTargetDelta.sha256,
    derivedSourcePredecessorCheckpoint:
      sourceDerivation.derivedSourcePredecessorCheckpoint,
    translatedTraversalAuthority: {
      analysisManifest: replayAnalysisArtifact,
      compaction: replayCompaction,
      predecessorCheckpoint: {
        sha256: fingerprintCanonicalArtifact(replayPredecessorJson),
        checkpointJson: replayPredecessorJson
      }
    },
    translatedAcceptedHistory: { pages: replayPages, manifest: replayManifest },
    translatedShadowInputs: {
      evidenceBundle: replayBundle,
      eventRoleMapV1: replayMap,
      eventRoleMapV2: replayWrapper
    },
    productionEffect: false
  });
  return validateServiceRoleShadowRuntimeReplayPairV1({ replayInput, replayIdentity });
}

export async function extractServiceRoleShadowRuntimeAcceptancePrepareV1(input: {
  readonly db: ServiceRoleShadowPrepareQueryableV1;
  readonly command: Extract<ServiceRoleShadowRuntimeAcceptanceCommand, { kind: "prepare" }>;
}): Promise<{
  readonly replayInput: ServiceRoleShadowRuntimeReplayInputV1;
  readonly replayIdentity: ServiceRoleShadowRuntimeReplayIdentityV1;
}> {
  const authority = await input.db.query(
    `select run.status as run_status,
            analysis.artifact_json as analysis_json,
            labels.dataset_json as label_dataset_json,
            traversal.status as traversal_task_status,
            traversal.checkpoint_json,
            history.id as history_task_id,
            history.status as history_task_status,
            history.logical_key,
            history.accepted_attempt_id,
            attempt.artifact_sha256 as history_artifact_sha256,
            planner.canonical_sequence,
            planner.planner_state
       from unified_check_runs run
       join unified_check_artifacts analysis
         on analysis.sha256=run.analysis_manifest_sha256
        and analysis.created_by_run_id=run.id
        and analysis.kind='analysis_manifest'
        and analysis.schema_version='1'
       join unified_label_datasets labels
         on labels.sha256=analysis.artifact_json->>'labelDatasetSha256'
       join unified_check_tasks traversal
         on traversal.run_id=run.id and traversal.kind='traversal'
       join unified_check_tasks history
         on history.run_id=run.id and history.kind='address_history'
       join unified_check_attempts attempt
         on attempt.id=history.accepted_attempt_id
        and attempt.task_id=history.id
       join unified_check_planner_entries planner
         on planner.run_id=run.id and planner.task_id=history.id
      where run.id=$1 and attempt.artifact_sha256=$2`,
    [input.command.runId, input.command.manifestSha256]
  );
  const artifacts = await input.db.query(
    `select artifact.sha256,artifact.kind,artifact.schema_version,
            artifact.artifact_json
       from unified_check_artifacts artifact
      where artifact.created_by_run_id=$1
        and (
          artifact.sha256=$2
          or artifact.sha256=(
            select source_run.analysis_manifest_sha256
              from unified_check_runs source_run where source_run.id=$1
          )
          or artifact.sha256 in (
            select jsonb_array_elements_text(manifest.artifact_json->'pageArtifactHashes')
              from unified_check_artifacts manifest
             where manifest.sha256=$2
               and manifest.created_by_run_id=$1
          )
          or artifact.kind in (
            'service_role_event_evidence_bundle',
            'service_role_event_role_map',
            'traversal_delta',
            'traversal_compaction_v2'
          )
        )
      order by artifact.kind,artifact.schema_version,artifact.sha256`,
    [input.command.runId, input.command.manifestSha256]
  );
  return buildServiceRoleShadowRuntimeAcceptancePrepareContractsV1({
    command: input.command,
    authorityRows: authority.rows,
    artifactRows: artifacts.rows
  });
}

async function prepareServiceRoleShadowRuntimeAcceptanceFromDatabase(
  input: Parameters<ServiceRoleShadowRuntimeAcceptanceCliDependencies["prepareFromDatabase"]>[0]
): ReturnType<ServiceRoleShadowRuntimeAcceptanceCliDependencies["prepareFromDatabase"]> {
  const pool = new pg.Pool({ connectionString: input.databaseUrl, max: 1 });
  try {
    return await extractServiceRoleShadowRuntimeAcceptancePrepareV1({
      db: pool,
      command: input.command
    });
  } finally {
    await pool.end();
  }
}

export type ServiceRoleShadowReplayVariantV1 = "disabled" | "enabled";

export type ServiceRoleShadowReplayVariantResultV1 = {
  readonly authoritativeProjection: unknown;
  readonly runtimeArtifacts: readonly {
    readonly kind: string;
    readonly schemaVersion: string;
    readonly sha256: string;
    readonly artifactJson: unknown;
  }[];
  readonly providerCalls: number;
  readonly shadowReferences: number;
};

export interface ServiceRoleShadowReplayDatabaseV1 {
  schemaExists(input: {
    readonly databaseUrl: string;
    readonly schema: string;
  }): Promise<boolean>;
  createSchema(input: {
    readonly databaseUrl: string;
    readonly schema: string;
    readonly frozenAt: string;
  }): Promise<void>;
  runVariant(input: {
    readonly databaseUrl: string;
    readonly schema: string;
    readonly variant: ServiceRoleShadowReplayVariantV1;
    readonly replayInput: ServiceRoleShadowRuntimeReplayInputV1;
    readonly replayIdentity: ServiceRoleShadowRuntimeReplayIdentityV1;
  }): Promise<ServiceRoleShadowReplayVariantResultV1>;
  dropSchema(input: {
    readonly databaseUrl: string;
    readonly schema: string;
  }): Promise<void>;
}

function validatedReplaySchemaName(value: string): string {
  if (!/^stage_c1_runtime_[0-9a-f]{32}$/u.test(value)) {
    throw new Error("service_role_shadow_runtime_acceptance_schema_invalid");
  }
  return value;
}

export async function runServiceRoleShadowRuntimeAcceptanceReplayV1(input: {
  readonly databaseUrl: string;
  readonly replayInput: unknown;
  readonly replayIdentity: unknown;
  readonly database: ServiceRoleShadowReplayDatabaseV1;
  readonly createSchemaName?: () => string;
}): Promise<ServiceRoleShadowC1AcceptanceV1> {
  const pair = validateServiceRoleShadowRuntimeReplayPairV1({
    replayInput: input.replayInput,
    replayIdentity: input.replayIdentity
  });
  const createSchemaName = input.createSchemaName ?? (() =>
    `stage_c1_runtime_${randomUUID().replaceAll("-", "")}`);
  const schemas = [
    validatedReplaySchemaName(createSchemaName()),
    validatedReplaySchemaName(createSchemaName())
  ] as const;
  if (schemas[0] === schemas[1]) {
    throw new Error("service_role_shadow_runtime_acceptance_schema_collision");
  }
  for (const schema of schemas) {
    if (await input.database.schemaExists({ databaseUrl: input.databaseUrl, schema })) {
      throw new Error("service_role_shadow_runtime_acceptance_schema_exists");
    }
  }
  const created: string[] = [];
  try {
    const results: ServiceRoleShadowReplayVariantResultV1[] = [];
    for (const [index, variant] of (["disabled", "enabled"] as const).entries()) {
      const schema = schemas[index]!;
      await input.database.createSchema({
        databaseUrl: input.databaseUrl,
        schema,
        frozenAt: pair.replayInput.sourceAnchor
      });
      created.push(schema);
      results.push(await input.database.runVariant({
        databaseUrl: input.databaseUrl,
        schema,
        variant,
        replayInput: pair.replayInput,
        replayIdentity: pair.replayIdentity
      }));
    }
    const [disabled, enabled] = results as [
      ServiceRoleShadowReplayVariantResultV1,
      ServiceRoleShadowReplayVariantResultV1
    ];
    if (
      disabled.providerCalls !== 0 || enabled.providerCalls !== 0 ||
      disabled.shadowReferences !== 0 || enabled.shadowReferences !== 0 ||
      disabled.runtimeArtifacts.length !== 0
    ) throw new Error("service_role_shadow_runtime_acceptance_variant_invalid");
    const acceptance = {
      schemaVersion: "service-role-shadow-c1-acceptance-v1" as const,
      testedSourceCommit: pair.replayInput.testedSourceCommit,
      replayInput: pair.replayInput,
      replayInputSha256: fingerprintCanonicalArtifact(pair.replayInput),
      replayIdentity: pair.replayIdentity,
      replayIdentitySha256: fingerprintCanonicalArtifact(pair.replayIdentity),
      disabledAuthoritativeProjection: disabled.authoritativeProjection,
      disabledAuthoritativeProjectionSha256:
        fingerprintCanonicalArtifact(disabled.authoritativeProjection),
      enabledAuthoritativeProjection: enabled.authoritativeProjection,
      enabledAuthoritativeProjectionSha256:
        fingerprintCanonicalArtifact(enabled.authoritativeProjection),
      runtimeArtifacts: [...enabled.runtimeArtifacts].sort((left, right) =>
        compareText(
          `${left.kind}\0${left.schemaVersion}\0${left.sha256}`,
          `${right.kind}\0${right.schemaVersion}\0${right.sha256}`
        )),
      counters: {
        disabledProviderCalls: 0 as const,
        enabledProviderCalls: 0 as const,
        disabledShadowReferences: 0 as const,
        enabledShadowReferences: 0 as const
      },
      cardinalities: {
        inputSet: 1 as const,
        inputFence: 1 as const,
        profile: 7 as const,
        precommit: 1 as const,
        runtimeReceipt: 1 as const,
        runSummary: 0 as const
      },
      productionEffect: false as const
    };
    return parseServiceRoleShadowC1AcceptanceV1(acceptance);
  } finally {
    const errors: unknown[] = [];
    for (const schema of created.reverse()) {
      try {
        await input.database.dropSchema({ databaseUrl: input.databaseUrl, schema });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "service_role_shadow_runtime_acceptance_schema_cleanup_failed"
      );
    }
  }
}

const SCHEMA_037_MIGRATIONS = [
  "003_risk_observation_foundation.sql",
  "033_unified_wallet_check.sql",
  "034_unified_check_adaptive_planner.sql",
  "035_unified_check_run_rollout_policy.sql",
  "036_remove_rollout_authority.sql",
  "037_unified_runtime_handoff.sql"
] as const;

async function withReplayAdminClient<T>(
  databaseUrl: string,
  work: (client: pg.Client) => Promise<T>
): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const RUNTIME_SHADOW_KINDS = [
  "service_role_shadow_input_set",
  "service_role_shadow_input_fence",
  "service_role_shadow_profile",
  "service_role_shadow_precommit_receipt",
  "service_role_shadow_runtime_receipt",
  "service_role_shadow_run_summary"
] as const;

async function insertReplayArtifact(input: {
  readonly pool: pg.Pool;
  readonly runId: string;
  readonly createdAt: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly sha256: string;
  readonly artifactJson: unknown;
}): Promise<void> {
  if (fingerprintCanonicalArtifact(input.artifactJson) !== input.sha256) {
    throw new Error("service_role_shadow_runtime_acceptance_import_hash_invalid");
  }
  await input.pool.query(
    `insert into unified_check_artifacts
       (sha256,created_by_run_id,kind,schema_version,artifact_json,created_at)
     values ($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
    [
      input.sha256,
      input.runId,
      input.kind,
      input.schemaVersion,
      JSON.stringify(input.artifactJson),
      input.createdAt
    ]
  );
}

async function projectionValues(
  pool: pg.Pool,
  sql: string,
  values: readonly unknown[] = []
): Promise<readonly unknown[]> {
  return (await pool.query(sql, values as unknown[])).rows.map((row) => row.value);
}

async function replayAuthoritativeProjection(input: {
  readonly pool: pg.Pool;
  readonly runId: string;
  readonly traversalTaskId: string;
  readonly historicalAttempt: number;
  readonly historicalCheckpoint: unknown;
  readonly historicalTaskRow: unknown;
}): Promise<unknown> {
  const runId = input.runId;
  return JSON.parse(canonicalizeArtifactJson({
    provider: { callCount: 0, calls: [], cacheDecisions: [] },
    requests: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_check_requests value where run_id=$1 order by id",
      [runId]),
    runs: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_check_runs value where id=$1 order by id",
      [runId]),
    tasks: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_check_tasks value where run_id=$1 order by kind,logical_key,id",
      [runId]),
    checkpoints: [{
      taskId: input.traversalTaskId,
      traversalAttempt: input.historicalAttempt,
      checkpointJson: input.historicalCheckpoint,
      taskRow: input.historicalTaskRow
    }],
    planner: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_check_planner_entries value where run_id=$1 order by canonical_sequence",
      [runId]),
    attempts: await projectionValues(input.pool,
      `select to_jsonb(attempt_row) value
         from unified_check_attempts attempt_row
         join unified_check_tasks task on task.id=attempt_row.task_id
        where task.run_id=$1
        order by attempt_row.task_id,attempt_row.attempt,attempt_row.id`,
      [runId]),
    artifacts: await projectionValues(input.pool,
      `select to_jsonb(artifact) value
         from unified_check_artifacts artifact
        where artifact.created_by_run_id=$1
          and artifact.kind <> all($2::text[])
        order by artifact.kind,artifact.schema_version,artifact.sha256`,
      [runId, RUNTIME_SHADOW_KINDS]),
    reports: await projectionValues(input.pool,
      `select to_jsonb(artifact) value
         from unified_check_artifacts artifact
        where artifact.created_by_run_id=$1 and artifact.kind='unified_wallet_report'
        order by artifact.sha256`,
      [runId]),
    presentations: await projectionValues(input.pool,
      `select to_jsonb(artifact) value
         from unified_check_artifacts artifact
        where artifact.created_by_run_id=$1
          and artifact.kind=any($2::text[])
        order by artifact.kind,artifact.schema_version,artifact.sha256`,
      [runId, [
        "presentation_manifest",
        "presentation_artifact",
        "presentation_completeness_receipt",
        "presentation_envelope",
        "delivery_intent"
      ]]),
    deliveries: await projectionValues(input.pool,
      `select to_jsonb(delivery) value
         from unified_check_deliveries delivery
         join unified_check_requests request on request.id=delivery.request_id
        where request.run_id=$1 order by delivery.id`,
      [runId]),
    providerPages: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_provider_pages value order by request_identity_sha256"),
    labelDatasets: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_label_datasets value order by sha256"),
    generationFence: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_check_generation_fence value order by generation_id"),
    deliveryOwnership: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_wallet_delivery_ownership value order by subject_address,chat_id"),
    runtimeInstances: await projectionValues(input.pool,
      "select to_jsonb(value) value from unified_runtime_instances value order by instance_id"),
    notifications: await projectionValues(input.pool,
      `select to_jsonb(notification) value
         from unified_check_notifications notification
         join unified_check_requests request on request.id=notification.request_id
        where request.run_id=$1 order by notification.id`,
      [runId])
  }));
}

async function runPostgresServiceRoleShadowReplayVariant(input: {
  readonly databaseUrl: string;
  readonly schema: string;
  readonly variant: ServiceRoleShadowReplayVariantV1;
  readonly replayInput: ServiceRoleShadowRuntimeReplayInputV1;
  readonly replayIdentity: ServiceRoleShadowRuntimeReplayIdentityV1;
}): Promise<ServiceRoleShadowReplayVariantResultV1> {
  const schema = validatedReplaySchemaName(input.schema);
  validateServiceRoleShadowRuntimeReplayPairV1(input);
  const poolConfig = {
    connectionString: input.databaseUrl,
    max: 1,
    options: `-c search_path=${schema},pg_catalog`
  };
  const pool = new pg.Pool(poolConfig);
  const recoveryPool = new pg.Pool(poolConfig);
  const runId = input.replayIdentity.replay.runId;
  const createdAt = input.replayInput.sourceAnchor;
  let providerCalls = 0;
  try {
    const frozenLabels = {
      sha256: input.replayInput.sourceFrozenLabelDataset.sha256,
      dataset: input.replayInput.sourceFrozenLabelDataset.datasetJson as
        FrozenLabelDatasetV1
    };
    const analysis = input.replayIdentity.translatedTraversalAuthority
      .analysisManifest.artifactJson as Record<string, unknown>;
    const analysisSha256 = fingerprintCanonicalArtifact(analysis);
    const subjectAddress = String(analysis.subjectAddress);
    if (
      analysisSha256 !== input.replayIdentity.translatedTraversalAuthority
        .analysisManifest.sha256 ||
      analysis.labelDatasetSha256 !== frozenLabels.sha256 ||
      subjectAddress.length === 0
    ) throw new Error("service_role_shadow_runtime_acceptance_analysis_translation_mismatch");
    const translatedTraversal = input.replayIdentity.translatedTraversalAuthority;
    const translatedPredecessor = translatedTraversal.predecessorCheckpoint
      .checkpointJson as Record<string, unknown>;
    if (translatedPredecessor.analysisManifestHash !== analysisSha256) {
      throw new Error("service_role_shadow_runtime_acceptance_analysis_translation_mismatch");
    }
    await pool.query(
      `insert into unified_label_datasets (sha256,dataset_json,created_at)
       values ($1,$2::jsonb,$3::timestamptz)`,
      [frozenLabels.sha256, JSON.stringify(frozenLabels.dataset), createdAt]
    );
    await pool.query(
      `insert into unified_check_runs
         (id,analysis_key_sha256,subject_address,status,run_purpose,
          side_effect_policy,analysis_manifest_sha256,fairness_owner_id,
          created_at,updated_at)
       values ($1,$2,$3,'RUNNING','synthetic_test','isolated',$4,$1,$5,$5)`,
      [
        runId,
        fingerprintCanonicalArtifact(["stage-c1-replay", runId]),
        subjectAddress,
        analysisSha256,
        createdAt
      ]
    );
    await insertReplayArtifact({
      pool,
      runId,
      createdAt,
      kind: "analysis_manifest",
      schemaVersion: "1",
      sha256: analysisSha256,
      artifactJson: analysis
    });
    await insertReplayArtifact({
      pool,
      runId,
      createdAt,
      ...translatedTraversal.compaction
    });
    await pool.query(
      `insert into unified_check_requests
         (id,request_correlation_id,run_id,subject_address,chat_id,
          message_thread_id,locale,run_purpose,side_effect_policy,status,
          ready_at,accepted_at,created_at)
       values ($1,$1,$2,$3,'stage-c1','stage-c1','en','synthetic_test',
               'isolated','ATTACHED',$4,$4,$4)`,
      [input.replayIdentity.replay.requestId, runId, subjectAddress, createdAt]
    );

    const directHistory = {
      version: "unified-direct-history-v1" as const,
      schemaVersion: 1 as const,
      runId,
      analysisManifestHash: analysisSha256,
      snapshotHash: input.replayInput.sourceSnapshotHash,
      pageArtifactHashes: [],
      eventIndexHash: fingerprintCanonicalArtifact([]),
      eventCount: 0,
      reachedAccountCreation: true as const
    };
    const directHistorySha256 = fingerprintCanonicalArtifact(directHistory);
    await insertReplayArtifact({
      pool,
      runId,
      createdAt,
      kind: "direct_history",
      schemaVersion: "1",
      sha256: directHistorySha256,
      artifactJson: directHistory
    });

    for (const artifact of [
      ...input.replayIdentity.translatedAcceptedHistory.pages,
      input.replayIdentity.translatedAcceptedHistory.manifest,
      input.replayIdentity.translatedShadowInputs.evidenceBundle,
      input.replayIdentity.translatedShadowInputs.eventRoleMapV1,
      input.replayIdentity.translatedShadowInputs.eventRoleMapV2,
      ...deriveServiceRoleShadowRuntimeReplaySourceV1(input.replayInput).prefixDeltas
    ]) {
      await insertReplayArtifact({ pool, runId, createdAt, ...artifact });
    }

    const predecessor: Record<string, unknown> = {
      ...translatedPredecessor
    };
    const predecessorHead = predecessor.deltaHeadSha256;
    if (!(predecessorHead === null ||
      (typeof predecessorHead === "string" && /^[0-9a-f]{64}$/u.test(predecessorHead)))) {
      throw new Error("service_role_shadow_runtime_acceptance_predecessor_invalid");
    }
    const historyTaskId = input.replayIdentity.plannerEntryMapping.replay.taskId;
    const historyAttemptId = input.replayIdentity.replay.acceptedAttemptId;
    await pool.query(
      `insert into unified_check_tasks
         (id,run_id,kind,status,priority_lane,ready_at,attempt,
          accepted_attempt_id,logical_key,checkpoint_json,created_at,updated_at)
       values
         ($1,$3,'direct_history','COMPLETED','interactive',$6,1,null,'main','{}',$6,$6),
         ($2,$3,'traversal','QUEUED','interactive',$6,0,null,'main',$7::jsonb,$6,$6),
         ($4,$3,'address_history','COMPLETED','interactive',$6,1,null,$5,'{}',$6,$6)`,
      [
        input.replayIdentity.replay.directHistoryTaskId,
        input.replayIdentity.replay.traversalTaskId,
        runId,
        historyTaskId,
        input.replayIdentity.plannerEntryMapping.replay.manifestKey,
        createdAt,
        JSON.stringify(predecessor)
      ]
    );
    await pool.query(
      `insert into unified_check_attempts
         (id,task_id,attempt,artifact_sha256,completed_at)
       values ($1,$2,1,$3,$7),($4,$5,1,$6,$7)`,
      [
        input.replayIdentity.replay.directHistoryAttemptId,
        input.replayIdentity.replay.directHistoryTaskId,
        directHistorySha256,
        historyAttemptId,
        historyTaskId,
        input.replayIdentity.plannerEntryMapping.replay.artifactSha256,
        createdAt
      ]
    );
    await pool.query(
      `update unified_check_tasks
          set accepted_attempt_id=case id when $1 then $2 when $3 then $4 end
        where id=any($5::text[])`,
      [
        input.replayIdentity.replay.directHistoryTaskId,
        input.replayIdentity.replay.directHistoryAttemptId,
        historyTaskId,
        historyAttemptId,
        [input.replayIdentity.replay.directHistoryTaskId, historyTaskId]
      ]
    );
    const mapped = input.replayIdentity.plannerEntryMapping.replay;
    await pool.query(
      `insert into unified_check_planner_entries
         (run_id,canonical_sequence,task_id,planner_state,result_bytes,
          admitted_at,reserved_bytes,planned_at,ready_at,committed_at)
       values ($1,$2,$3,'ready',$5,$4,null,$4,$4,null)`,
      [
        runId,
        mapped.canonicalSequence,
        mapped.taskId,
        createdAt,
        Buffer.byteLength(
          canonicalizeArtifactJson(
            input.replayIdentity.translatedAcceptedHistory.manifest.artifactJson
          ),
          "utf8"
        )
      ]
    );

    let createdId = 0;
    const productionRuntime = createUnifiedProductionRuntime({
      db: createUnifiedPoolTransactionHost(pool),
      ...(input.variant === "enabled" ? {
        serviceRoleShadowRecoveryDb: createUnifiedPoolTransactionHost(recoveryPool)
      } : {}),
      runtimeCommit: input.replayInput.testedSourceCommit,
      providerConfigurationSha256: "e".repeat(64),
      runPurpose: "synthetic_test",
      serviceRoleShadowPolicy: input.variant === "enabled"
        ? "service-role-shadow-100-plus-100-v1"
        : "disabled",
      now: () => new Date(createdAt),
      createId: () => `stage-c1-runtime-${String(++createdId).padStart(4, "0")}`,
      loadProviderPage: async () => {
        providerCalls += 1;
        throw new Error("service_role_shadow_runtime_acceptance_provider_forbidden");
      },
      loadCounterpartyLabels: async () => new Map(),
      loadFrozenLabelDataset: async () => frozenLabels.dataset,
      loadHardEvidence: async () => ({})
    });
    const lifecycles = [];
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const lifecycle = await productionRuntime.runAnalysisCycle();
      lifecycles.push(lifecycle);
      const state = (await pool.query(
        `select task.checkpoint_json->>'deltaHeadSha256' delta_head_sha256,
                planner.planner_state
           from unified_check_tasks task
           join unified_check_planner_entries planner
             on planner.run_id=task.run_id and planner.task_id=$2
          where task.id=$1`,
        [input.replayIdentity.replay.traversalTaskId, mapped.taskId]
      )).rows[0];
      if (state?.delta_head_sha256 === input.replayIdentity.sourceTargetDeltaSha256 &&
        state?.planner_state === "committed") break;
    }
    const lifecycle = lifecycles.at(-1)!;
    const taskRow = (await pool.query(
      `select attempt,status,accepted_attempt_id,checkpoint_json,to_jsonb(task) task_json
         from unified_check_tasks task where id=$1`,
      [input.replayIdentity.replay.traversalTaskId]
    )).rows[0];
    const plannerState = String((await pool.query(
      `select planner_state from unified_check_planner_entries
        where run_id=$1 and task_id=$2`,
      [runId, mapped.taskId]
    )).rows[0]?.planner_state ?? "");
    const continuation = (await pool.query(
      `select task.status,task.accepted_attempt_id,task.logical_key,
              planner.planner_state
         from unified_check_tasks task
         join unified_check_planner_entries planner
           on planner.run_id=task.run_id and planner.task_id=task.id
        where task.run_id=$1 and task.kind='address_history' and task.id<>$2`,
      [runId, mapped.taskId]
    )).rows;
    const summaries = Number((await pool.query(
      `select count(*)::int count from unified_check_artifacts
        where created_by_run_id=$1 and kind='service_role_shadow_run_summary'`,
      [runId]
    )).rows[0]?.count ?? -1);
    if (
      lifecycles.length === 0 || lifecycles.length > 2 ||
      lifecycles.some((item) =>
        item.claimed !== true || item.outcome !== "checkpointed") ||
      plannerState !== "committed" || taskRow?.status !== "QUEUED" ||
      taskRow?.accepted_attempt_id !== null ||
      taskRow?.checkpoint_json?.deltaHeadSha256 !==
        input.replayIdentity.sourceTargetDeltaSha256 ||
      continuation.length === 0 || continuation.some((row) =>
        row.status !== "QUEUED" || row.accepted_attempt_id !== null ||
        row.planner_state !== "planned") ||
      providerCalls !== 0 || summaries !== 0
    ) throw new Error(`service_role_shadow_runtime_acceptance_lifecycle_incomplete:${
      canonicalizeArtifactJson({
        lifecycles,
        plannerState,
        task: taskRow === undefined ? null : {
          attempt: taskRow.attempt,
          status: taskRow.status,
          acceptedAttemptId: taskRow.accepted_attempt_id,
          deltaHeadSha256: taskRow.checkpoint_json?.deltaHeadSha256
        },
        sourceTargetDeltaSha256: input.replayIdentity.sourceTargetDeltaSha256,
        continuation: continuation.map((row) => ({
          status: row.status,
          acceptedAttemptId: row.accepted_attempt_id,
          plannerState: row.planner_state,
          logicalKey: row.logical_key
        })),
        mappedLogicalKey: mapped.manifestKey,
        providerCalls,
        summaries
      })
    }`);

    const runtimeRows = (await pool.query(
      `select kind,schema_version,sha256,artifact_json
         from unified_check_artifacts
        where created_by_run_id=$1 and kind=any($2::text[])
        order by kind,schema_version,sha256`,
      [runId, RUNTIME_SHADOW_KINDS]
    )).rows;
    const shadowReferences = Number((await pool.query(
      `select count(*)::int count
         from unified_check_attempts attempt
         join unified_check_tasks task on task.id=attempt.task_id
         join unified_check_artifacts artifact on artifact.sha256=attempt.artifact_sha256
        where task.run_id=$1 and artifact.kind=any($2::text[])`,
      [runId, RUNTIME_SHADOW_KINDS]
    )).rows[0]!.count);
    const authoritativeProjection = await replayAuthoritativeProjection({
      pool,
      runId,
      traversalTaskId: input.replayIdentity.replay.traversalTaskId,
      historicalAttempt: Number(taskRow.attempt),
      historicalCheckpoint: taskRow.checkpoint_json,
      historicalTaskRow: taskRow.task_json
    }) as Record<string, unknown>;
    return {
      authoritativeProjection,
      runtimeArtifacts: runtimeRows.map((row) => ({
        kind: String(row.kind),
        schemaVersion: String(row.schema_version),
        sha256: String(row.sha256),
        artifactJson: row.artifact_json
      })),
      providerCalls,
      shadowReferences
    };
  } finally {
    await Promise.all([pool.end(), recoveryPool.end()]);
  }
}

const postgresServiceRoleShadowReplayDatabaseV1: ServiceRoleShadowReplayDatabaseV1 = {
  schemaExists({ databaseUrl, schema }) {
    const exactSchema = validatedReplaySchemaName(schema);
    return withReplayAdminClient(databaseUrl, async (client) =>
      Boolean((await client.query(
        "select exists(select 1 from pg_namespace where nspname=$1) as present",
        [exactSchema]
      )).rows[0]?.present)
    );
  },
  async createSchema({ databaseUrl, schema, frozenAt }) {
    const exactSchema = validatedReplaySchemaName(schema);
    const frozenMilliseconds = Date.parse(frozenAt);
    if (!Number.isFinite(frozenMilliseconds) ||
      new Date(frozenMilliseconds).toISOString() !== frozenAt ||
      frozenMilliseconds % 1_000 !== 0) {
      throw new Error("service_role_shadow_runtime_acceptance_frozen_clock_invalid");
    }
    await withReplayAdminClient(databaseUrl, async (client) => {
      let created = false;
      try {
        await client.query(`create schema "${exactSchema}"`);
        created = true;
        await client.query(`set search_path to "${exactSchema}", pg_catalog`);
        for (const functionName of [
          "now",
          "statement_timestamp",
          "transaction_timestamp",
          "clock_timestamp"
        ]) {
          await client.query(
            `create function "${exactSchema}".${functionName}()
             returns timestamptz language sql immutable
             as 'select timestamptz ''${frozenAt}'''`
          );
        }
        const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
        for (const migration of SCHEMA_037_MIGRATIONS) {
          await client.query(await readFile(resolve(migrationRoot, migration), "utf8"));
        }
      } catch (error) {
        if (created) {
          await client.query("reset search_path").catch(() => undefined);
          await client.query(`drop schema "${exactSchema}" cascade`).catch(() => undefined);
        }
        throw error;
      }
    });
  },
  runVariant: runPostgresServiceRoleShadowReplayVariant,
  dropSchema({ databaseUrl, schema }) {
    const exactSchema = validatedReplaySchemaName(schema);
    return withReplayAdminClient(databaseUrl, async (client) => {
      const result = await client.query(
        "select exists(select 1 from pg_namespace where nspname=$1) as present",
        [exactSchema]
      );
      if (result.rows[0]?.present !== true) {
        throw new Error("service_role_shadow_runtime_acceptance_schema_missing");
      }
      await client.query(`drop schema "${exactSchema}" cascade`);
    });
  }
};

export async function replayServiceRoleShadowRuntimeAcceptanceFromDatabase(
  input: Parameters<ServiceRoleShadowRuntimeAcceptanceCliDependencies["replayFromDatabase"]>[0]
): ReturnType<ServiceRoleShadowRuntimeAcceptanceCliDependencies["replayFromDatabase"]> {
  return runServiceRoleShadowRuntimeAcceptanceReplayV1({
    ...input,
    database: postgresServiceRoleShadowReplayDatabaseV1
  });
}

function defaultServiceRoleShadowRuntimeAcceptanceCliDependencies():
ServiceRoleShadowRuntimeAcceptanceCliDependencies {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(scriptPath), "..");
  return {
    repoRoot,
    scriptPath,
    env: process.env,
    readArtifactFile: (path) => secureReadArtifactFile(repoRoot, path),
    verifyGitState: verifyServiceRoleShadowRuntimeGitStateV1,
    reserveOutputRoot: (path) => reserveOutputRoot(repoRoot, path),
    reserveOutputFile: (path) => reserveOutputFile(repoRoot, path),
    prepareFromDatabase: prepareServiceRoleShadowRuntimeAcceptanceFromDatabase,
    replayFromDatabase: replayServiceRoleShadowRuntimeAcceptanceFromDatabase,
    writeStdout: (bytes) => process.stdout.write(bytes)
  };
}

const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  await runServiceRoleShadowRuntimeAcceptanceCli(process.argv.slice(2));
}
