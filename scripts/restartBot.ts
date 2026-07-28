import "dotenv/config";
import { execFile, spawn, type SpawnOptions } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import { createUnifiedPoolTransactionHost } from "../src/unifiedCheck/repository";
import {
  loadActiveRuntimeOwner,
  loadRuntimeInstance,
  requestRuntimeDrain,
  type UnifiedRuntimeInstanceV1
} from "../src/unifiedCheck/runtimeHandoffRepository";
import { RUNTIME_HANDOFF_DRAIN_MS } from "../src/unifiedCheck/runtimeHandoffPolicy";

const SHA = /^[0-9a-f]{40}$/u;

type LogHandle = Readonly<{
  fd: number;
  close(): Promise<void>;
}>;

type ChildHandle = Readonly<{ unref(): void }>;

export type RestartBotDependencies = Readonly<{
  repositoryRoot: string;
  execPath: string;
  env: NodeJS.ProcessEnv;
  now(): Date;
  getGitSha(): Promise<string>;
  loadActiveRuntime(): Promise<UnifiedRuntimeInstanceV1 | null>;
  loadRuntimeInstance(instanceId: string): Promise<UnifiedRuntimeInstanceV1 | null>;
  requestDrain(
    instanceId: string,
    now: Date,
    drainMs: number
  ): Promise<UnifiedRuntimeInstanceV1>;
  ensureDirectory(path: string): Promise<void>;
  openLog(path: string): Promise<LogHandle>;
  spawnProcess(
    executable: string,
    args: readonly string[],
    options: SpawnOptions
  ): ChildHandle;
  readLog(path: string): Promise<string>;
  delay(ms: number): Promise<void>;
  writeLine(line: string): void;
  pollIntervalMs: number;
  releaseTimeoutMs: number;
  startupTimeoutMs: number;
}>;

export type RestartBotResult = Readonly<{
  oldInstanceId: string;
  newInstanceId: string;
  runtimeCommit: string;
  drainDeadlineAt: string;
  stdoutPath: string;
  stderrPath: string;
}>;

function validClock(now: Date): void {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("restart_bot_clock_invalid");
  }
}

function validWaits(deps: RestartBotDependencies): void {
  for (const value of [
    deps.pollIntervalMs,
    deps.releaseTimeoutMs,
    deps.startupTimeoutMs
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError("restart_bot_wait_invalid");
    }
  }
}

async function waitForPollingRelease(
  deps: RestartBotDependencies,
  instanceId: string
): Promise<void> {
  for (
    let elapsed = 0;
    elapsed <= deps.releaseTimeoutMs;
    elapsed += deps.pollIntervalMs
  ) {
    const runtime = await deps.loadRuntimeInstance(instanceId);
    if (
      runtime?.state === "DRAINING" &&
      runtime.telegramPollingReleasedAt !== null
    ) return;
    if (elapsed < deps.releaseTimeoutMs) {
      await deps.delay(deps.pollIntervalMs);
    }
  }
  throw new Error("runtime_polling_release_timeout");
}

async function waitForReplacement(
  deps: RestartBotDependencies,
  input: {
    oldInstanceId: string;
    runtimeCommit: string;
    stdoutPath: string;
    stderrPath: string;
  }
): Promise<UnifiedRuntimeInstanceV1> {
  let active: UnifiedRuntimeInstanceV1 | null = null;
  let botStarted = false;
  for (
    let elapsed = 0;
    elapsed <= deps.startupTimeoutMs;
    elapsed += deps.pollIntervalMs
  ) {
    const candidate = await deps.loadActiveRuntime();
    if (
      candidate !== null &&
      candidate.instanceId !== input.oldInstanceId &&
      candidate.runtimeCommit === input.runtimeCommit
    ) active = candidate;
    const logs = await Promise.all([
      deps.readLog(input.stdoutPath),
      deps.readLog(input.stderrPath)
    ]);
    botStarted ||= logs.some((log) => log.includes("bot_started"));
    if (active !== null && botStarted) return active;
    if (elapsed < deps.startupTimeoutMs) {
      await deps.delay(deps.pollIntervalMs);
    }
  }
  throw new Error("replacement_runtime_start_timeout");
}

export async function restartBot(
  deps: RestartBotDependencies
): Promise<RestartBotResult> {
  validWaits(deps);
  const now = deps.now();
  validClock(now);
  const runtimeCommit = (await deps.getGitSha()).trim().toLowerCase();
  if (!SHA.test(runtimeCommit)) throw new Error("restart_bot_git_sha_invalid");

  const oldRuntime = await deps.loadActiveRuntime();
  if (oldRuntime === null) {
    throw new Error("legacy_runtime_requires_verified_manual_stop");
  }
  const draining = await deps.requestDrain(
    oldRuntime.instanceId,
    now,
    RUNTIME_HANDOFF_DRAIN_MS
  );
  if (draining.drainDeadlineAt === null) {
    throw new Error("runtime_drain_deadline_missing");
  }
  await waitForPollingRelease(deps, oldRuntime.instanceId);

  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const logDirectory = join(deps.repositoryRoot, "logs");
  const prefix = `bot-${stamp}-${runtimeCommit.slice(0, 8)}`;
  const stdoutPath = join(logDirectory, `${prefix}.out.log`);
  const stderrPath = join(logDirectory, `${prefix}.err.log`);
  await deps.ensureDirectory(logDirectory);
  const stdout = await deps.openLog(stdoutPath);
  let stderr: LogHandle | null = null;
  try {
    stderr = await deps.openLog(stderrPath);
    const runtimeInstanceLabel = `bot-${runtimeCommit.slice(0, 8)}-${stamp}`;
    const child = deps.spawnProcess(
      deps.execPath,
      ["--import", "tsx", "src/index.ts"],
      {
        cwd: deps.repositoryRoot,
        detached: true,
        windowsHide: true,
        shell: false,
        env: {
          ...deps.env,
          RUNTIME_GIT_SHA: runtimeCommit,
          RUNTIME_INSTANCE_LABEL: runtimeInstanceLabel
        },
        stdio: ["ignore", stdout.fd, stderr.fd]
      }
    );
    child.unref();
  } finally {
    await Promise.all([
      stdout.close(),
      ...(stderr === null ? [] : [stderr.close()])
    ]);
  }

  const replacement = await waitForReplacement(deps, {
    oldInstanceId: oldRuntime.instanceId,
    runtimeCommit,
    stdoutPath,
    stderrPath
  });
  const result = {
    oldInstanceId: oldRuntime.instanceId,
    newInstanceId: replacement.instanceId,
    runtimeCommit,
    drainDeadlineAt: draining.drainDeadlineAt,
    stdoutPath,
    stderrPath
  } satisfies RestartBotResult;
  deps.writeLine(`Old runtime: ${result.oldInstanceId}`);
  deps.writeLine(`Drain deadline: ${result.drainDeadlineAt}`);
  deps.writeLine(`New runtime: ${result.newInstanceId} (${runtimeCommit})`);
  deps.writeLine(`Logs: ${stdoutPath} | ${stderrPath}`);
  return result;
}

async function runFromCommandLine(): Promise<void> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const transactionHost = createUnifiedPoolTransactionHost(db);
  const execFileAsync = promisify(execFile);
  try {
    await restartBot({
      repositoryRoot,
      execPath: process.execPath,
      env: process.env,
      now: () => new Date(),
      getGitSha: async () => {
        const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
          cwd: repositoryRoot,
          windowsHide: true
        });
        return result.stdout;
      },
      loadActiveRuntime: () => loadActiveRuntimeOwner(db),
      loadRuntimeInstance: (instanceId) => loadRuntimeInstance(db, instanceId),
      requestDrain: (instanceId, at, drainMs) => requestRuntimeDrain(
        transactionHost,
        { instanceId, now: at, drainMs }
      ),
      ensureDirectory: (path) => mkdir(path, { recursive: true }).then(() => undefined),
      openLog: (path) => open(path, "a"),
      spawnProcess: (executable, args, options) => spawn(
        executable,
        [...args],
        options
      ),
      readLog: async (path) => readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      }),
      delay: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
      writeLine: (line) => process.stdout.write(`${line}\n`),
      pollIntervalMs: 500,
      releaseTimeoutMs: 60_000,
      startupTimeoutMs: 60_000
    });
  } finally {
    await closeDb(db);
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runFromCommandLine().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
