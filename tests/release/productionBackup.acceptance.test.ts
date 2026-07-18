import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  COMMAND_TEMPLATE_SHA256,
  TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
  buildReleaseManifest,
  buildTask0BReleaseFreezeEvidence,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const evaluatedAt = "2026-07-18T09:05:00.000Z";
const execFileAsync = promisify(execFile);
const postgresIt = process.env.REQUIRE_PLAN5_POSTGRES === "1" ? it : it.skip;

async function makeProtectedTempDir(prefix: string): Promise<string> {
  const path = mkdtempSync(join(homedir(), prefix));
  if (process.platform === "win32") {
    const sid = (await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"])).stdout.trim();
    await execFileAsync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  } else chmodSync(path, 0o700);
  return path;
}

async function loadProducer(): Promise<any> {
  const modulePath: string = "../../scripts/createProductionBackupEvidence";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch (error) {
    throw new Error("Plan 5 feature missing: controlled G12 production backup producer", { cause: error });
  }
}

function fixture(root: string) {
  const task0b = buildTask0BReleaseFreezeEvidence({ candidateSha: CANDIDATE_SHA });
  const manifest = buildReleaseManifest("ready_for_release");
  const task0bBytes = Buffer.from(`${JSON.stringify(task0b)}\n`, "utf8");
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  const authority = {
    version: "production-backup-authority-v1",
    scope: "production_backup",
    source: "operator_protected_one_shot_production_go",
    generationId: "production-backup-generation-0001",
    commandId: "production_backup",
    commandTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup,
    issuedAt: "2026-07-18T09:04:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z",
    candidateSha: CANDIDATE_SHA,
    databaseRole: "production",
    databaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
    task0bEvidencePath: "task0b-release-freeze.json",
    task0bEvidenceSha256: sha256(task0bBytes),
    releaseManifestPath: "release-manifest.json",
    releaseManifestSha256: sha256(manifestBytes),
    releaseManifestOverall: "ready_for_release",
    artifactRootFingerprintSha256: task0b.artifactRoot.rootFingerprintSha256,
    explicitGo: true
  };
  return { root, task0b, manifest, task0bBytes, manifestBytes, authority };
}

describe("[REQ-38][G12-PRODUCTION-BACKUP]", () => {
  it("requires a fresh exact one-shot GO bound to Task0B ready manifest database and protected root", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-authority-"));
    try {
      const valid = fixture(root);
      expect(() => api.validateProductionBackupAuthorization({
        ...valid,
        candidateSha: CANDIDATE_SHA,
        observedDatabaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
        observedArtifactRootFingerprintSha256: valid.task0b.artifactRoot.rootFingerprintSha256,
        evaluatedAt
      })).not.toThrow();

      const invalid: Array<(value: ReturnType<typeof fixture>) => void> = [
        (value) => { value.authority.explicitGo = false as true; },
        (value) => { value.authority.scope = "production_migration"; },
        (value) => { value.authority.source = "operator_guess"; },
        (value) => { value.authority.commandId = "production_migration"; },
        (value) => { value.authority.commandTemplateSha256 = "f".repeat(64); },
        (value) => { value.authority.databaseRole = "staging"; },
        (value) => { value.authority.issuedAt = "2026-07-18T09:06:00.000Z"; },
        (value) => { value.authority.expiresAt = "2026-07-18T09:15:00.001Z"; },
        (value) => { value.authority.expiresAt = "2026-07-18T09:04:59.000Z"; },
        (value) => { value.authority.candidateSha = "f".repeat(40); },
        (value) => { value.authority.task0bEvidenceSha256 = "f".repeat(64); },
        (value) => { value.authority.releaseManifestSha256 = "f".repeat(64); },
        (value) => { value.authority.databaseIdentityFingerprintSha256 = "f".repeat(64); },
        (value) => { value.authority.artifactRootFingerprintSha256 = "f".repeat(64); },
        (value) => { value.manifest.gates.find((gate) => gate.id === "G12_PRODUCTION_BACKUP")!.state = "passed"; value.manifest.overall = "not_ready"; value.manifestBytes = Buffer.from(`${JSON.stringify(value.manifest)}\n`); value.authority.releaseManifestSha256 = sha256(value.manifestBytes); },
        (value) => { value.manifest.gates.find((gate) => gate.id === "G00_BASE")!.state = "failed"; value.manifest.gates.find((gate) => gate.id === "G00_BASE")!.exitCode = 1; value.manifest.overall = "not_ready"; value.manifestBytes = Buffer.from(`${JSON.stringify(value.manifest)}\n`); value.authority.releaseManifestSha256 = sha256(value.manifestBytes); }
      ];
      for (const mutate of invalid) {
        const value = fixture(root);
        mutate(value);
        expect(() => api.validateProductionBackupAuthorization({
          ...value,
          candidateSha: CANDIDATE_SHA,
          observedDatabaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
          observedArtifactRootFingerprintSha256: value.task0b.artifactRoot.rootFingerprintSha256,
          evaluatedAt
        })).toThrow(/backup|authority|binding|release|Task0B/i);
      }
      const secretAuthority = fixture(root).authority as any;
      secretAuthority.operator = { DATABASE_URL: "postgresql://release:secret@127.0.0.1/tron_watch" };
      expect(() => api.validateProductionBackupAuthority(secretAuthority, evaluatedAt)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("builds only the pinned Docker Desktop pg_dump invocation and keeps the password and URL off argv and env", async () => {
    const api = await loadProducer();
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts["release:production:backup"])
      .toBe("node --import tsx scripts/createProductionBackupEvidence.ts");
    const secret = "not-for-argv-$()-'-%";
    const url = `postgresql://release:${encodeURIComponent(secret)}@127.0.0.1:55998/tron_watch`;
    const invocation = api.buildProductionPgDumpInvocation({
      imageId: `sha256:${"9".repeat(64)}`,
      containerName: "plan5-g12-production-backup-generation-0001",
      databaseUrl: url,
      snapshotId: "00000003-0000001B-1"
    }, { PATH: "safe", BOT_TOKEN: "must-be-stripped", DATABASE_URL: url });
    const serialized = JSON.stringify({ executable: invocation.executable, args: invocation.args, env: invocation.env });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(url);
    expect(invocation.executable.replace(/\\/g, "/")).toMatch(/Docker\/resources\/bin\/docker\.exe$|\/docker$/);
    expect(invocation.args).toContain("host.docker.internal:host-gateway");
    expect(invocation.args).toContain("--interactive");
    expect(invocation.args).toContain("host.docker.internal");
    expect(invocation.args).toContain("--pull");
    expect(invocation.args).toContain("never");
    expect(invocation.args).not.toContain("host");
    expect(invocation.args).not.toContain("pg_dump");
    expect(invocation.args).toContain("/usr/local/bin/pg_dump");
    expect(invocation.env.BOT_TOKEN).toBeUndefined();
    expect(invocation.env.DATABASE_URL).toBeUndefined();
    expect(invocation.stdin).toEqual(Buffer.from(`${secret}\n`, "utf8"));
    expect(() => api.buildProductionPgDumpInvocation({
      imageId: `sha256:${"9".repeat(64)}`,
      containerName: "plan5-g12-production-backup-generation-0001",
      databaseUrl: "postgresql://release:bad%0Avalue@127.0.0.1:55998/tron_watch",
      snapshotId: "00000003-0000001B-1"
    })).toThrow(/database_url_invalid/);

    const restore = api.buildProductionPgRestoreListInvocation("C:/protected/artifacts", {
      provider: { immutableImageId: `sha256:${"9".repeat(64)}` }
    });
    expect(restore.args).toEqual(expect.arrayContaining(["--network", "none", "--pull", "never"]));
    expect(restore.args.join(" ")).toContain("type=bind,source=C:/protected/artifacts,target=/artifacts,readonly");
    expect(restore.args).not.toContain("bridge");
  });

  it("claims with an exact authority binding, rejects replay/tamper/symlinks, and serializes concurrent claimers", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-claim-");
    const authority = fixture(root).authority;
    const authorityBytes = Buffer.from(`${JSON.stringify(authority)}\n`);
    const expected = {
      generationId: authority.generationId,
      authoritySha256: sha256(authorityBytes),
      candidateSha: authority.candidateSha,
      databaseIdentityFingerprintSha256: authority.databaseIdentityFingerprintSha256,
      artifactRootFingerprintSha256: authority.artifactRootFingerprintSha256,
      expiresAt: authority.expiresAt
    };
    try {
      const results = await Promise.allSettled([
        api.claimProductionBackupAuthority(root, expected, authority.issuedAt),
        api.claimProductionBackupAuthority(root, expected, authority.issuedAt)
      ]);
      expect(results.filter((result: PromiseSettledResult<string>) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result: PromiseSettledResult<string>) => result.status === "rejected")).toHaveLength(1);
      await expect(api.claimProductionBackupAuthority(root, expected, evaluatedAt)).resolves.toBe("resumed");
      const claimName = `production-backup-authority-consumed-${authority.generationId}.json`;
      const claim = JSON.parse(readFileSync(join(root, claimName), "utf8"));
      expect(() => api.validateProductionBackupConsumptionState(claim, expected, evaluatedAt)).not.toThrow();
      expect(() => api.validateProductionBackupConsumptionState(
        claim, { ...expected, authoritySha256: "f".repeat(64) }, evaluatedAt
      )).toThrow(/mismatch/);
      expect(() => api.validateProductionBackupConsumptionState(claim, expected, "2026-07-18T09:10:00.001Z"))
        .toThrow(/expired/);
      expect(() => api.validateProductionBackupConsumptionState(claim, expected, "2026-07-18T09:10:00.001Z", false))
        .not.toThrow();
      const partialDump = Buffer.from("PGDMP-owned-partial");
      const sideEffects: string[] = [];
      await expect(api.executeProductionBackupStateMachine(authority, {
        now: () => "2026-07-18T09:10:00.001Z",
        readCompletedEvidence: async () => null,
        hasClaim: async () => {
          api.validateProductionBackupConsumptionState(claim, expected, "2026-07-18T09:10:00.001Z");
          return true;
        },
        claim: async () => { sideEffects.push("claim"); },
        inspectPartial: async () => ({ dump: true, list: false }),
        dump: async () => { sideEffects.push("dump"); },
        list: async () => { sideEffects.push("list"); },
        attest: async () => { sideEffects.push("attest"); },
        buildEvidence: async () => Buffer.from("evidence"),
        writeEvidence: async () => { sideEffects.push("evidence"); }
      })).rejects.toThrow(/expired/);
      expect(sideEffects).toEqual([]);
      expect(partialDump).toEqual(Buffer.from("PGDMP-owned-partial"));

      rmSync(join(root, claimName));
      const outside = join(tmpdir(), `plan5-g12-claim-outside-${Date.now()}.json`);
      writeFileSync(outside, "{}\n", { flag: "wx" });
      try {
        symlinkSync(outside, join(root, claimName), "file");
        await expect(api.claimProductionBackupAuthority(root, expected, authority.issuedAt)).rejects.toThrow();
      } finally { rmSync(outside, { force: true }); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("claims before dumping resumes owned partial state and never performs a second dump after valid completion", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-state-"));
    const value = fixture(root);
    const calls: string[] = [];
    const files = new Map<string, Buffer>();
    let now = evaluatedAt;
    const dependencies = {
      now: () => now,
      readCompletedEvidence: async () => files.get("production-backup-evidence.json") ?? null,
      claim: async () => { calls.push("claim"); files.set("claim", Buffer.from("claimed")); },
      hasClaim: async () => files.has("claim"),
      inspectPartial: async () => ({ dump: files.has("production-backup.dump"), list: files.has("production-backup-restore-list.txt") }),
      dump: async () => { calls.push("dump"); files.set("production-backup.dump", Buffer.from("PGDMP fixture")); },
      list: async () => { calls.push("list"); files.set("production-backup-restore-list.txt", Buffer.from("; archive\n1; TABLE public x\n")); },
      attest: async () => { calls.push("attest"); },
      buildEvidence: async () => Buffer.from(`${JSON.stringify({ version: "production-backup-evidence-v1", state: "passed" })}\n`),
      writeEvidence: async (bytes: Buffer) => { calls.push("evidence"); files.set("production-backup-evidence.json", bytes); }
    };
    try {
      const first = await api.executeProductionBackupStateMachine(value.authority, dependencies);
      now = "2026-07-18T09:10:00.001Z";
      const second = await api.executeProductionBackupStateMachine(value.authority, dependencies);
      expect(first).toEqual(second);
      expect(calls).toEqual(["claim", "dump", "list", "attest", "evidence", "attest"]);
      expect(calls.filter((call) => call === "dump")).toHaveLength(1);

      files.delete("production-backup-evidence.json");
      files.delete("production-backup-restore-list.txt");
      now = evaluatedAt;
      calls.length = 0;
      await api.executeProductionBackupStateMachine(value.authority, dependencies);
      expect(calls).toEqual(["list", "attest", "evidence"]);

      files.clear();
      files.set("production-backup.dump", Buffer.from("foreign"));
      calls.length = 0;
      await expect(api.executeProductionBackupStateMachine(value.authority, dependencies)).rejects.toThrow(/unconsumed/);
      expect(calls).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("validates exact evidence bytes and rejects restore-list encoding, size, and artifact tamper", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-evidence-"));
    const value = fixture(root);
    const evidence = {
      version: "production-backup-evidence-v1",
      candidateSha: value.authority.candidateSha,
      gateId: "G12_PRODUCTION_BACKUP",
      commandId: "production_backup",
      redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup,
      databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
      backupFilename: "production-backup.dump",
      backupBytes: 7,
      backupSha256: sha256("PGDMPxx"),
      backupPathFingerprintSha256: "d".repeat(64),
      restoreListFilename: "production-backup-restore-list.txt",
      restoreListBytes: 27,
      restoreListSha256: "e".repeat(64),
      restoreListEntryCount: 1,
      state: "passed"
    };
    try {
      expect(api.validateProductionBackupEvidence(evidence, value.authority)).toEqual(evidence);
      for (const mutation of [
        { backupBytes: 0 }, { backupSha256: "not-a-sha" }, { backupPathFingerprintSha256: "not-a-sha" },
        { restoreListBytes: 0 }, { restoreListSha256: "not-a-sha" }, { restoreListEntryCount: 0 },
        { databaseIdentityFingerprintSha256: "f".repeat(64) }
      ]) expect(() => api.validateProductionBackupEvidence({ ...evidence, ...mutation }, value.authority)).toThrow();
      expect(() => api.normalizeProductionRestoreList(Buffer.from([0xff, 0xfe]))).toThrow(/restore_list_invalid/);
      expect(() => api.normalizeProductionRestoreList(Buffer.alloc(100 * 1024 * 1024 + 1, 0x61))).toThrow(/restore_list_invalid/);
      expect(() => api.validateProductionBackupEvidence({ ...evidence, DATABASE_URL: "secret" }, value.authority)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("cleans an exclusive temporary dump after timeout and never publishes a partial archive", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-timeout-"));
    try {
      await expect(api.writeProductionDump(root, {
        executable: process.execPath,
        args: ["-e", "process.stdout.write('PGDMP');setInterval(()=>{},1000)"],
        env: { ...process.env },
        stdin: Buffer.alloc(0)
      }, "plan5-g12-production-backup-timeout", 250)).rejects.toThrow(/pg_dump_failed/);
      expect(readdirSync(root)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 20_000);

  postgresIt("creates a real custom-format backup and pinned pg_restore list from disposable tron_watch", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-real-"));
    const suffix = `${process.pid}-${Date.now()}`;
    const serverName = `plan5-g12-source-${suffix}`;
    const dumpName = `plan5-g12-production-backup-real-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
    const password = "plan5-test-$()-'%";
    let client: Client | undefined;
    let snapshot: any;
    try {
      await execFileAsync("docker", ["run", "--detach", "--rm", "--name", serverName,
        "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=tron_watch",
        "-p", "127.0.0.1::5432", "postgres:16-alpine"]);
      const portOutput = await execFileAsync("docker", ["port", serverName, "5432/tcp"]);
      const port = Number(portOutput.stdout.trim().split(":").at(-1));
      expect(port).not.toBe(55999);
      const url = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/tron_watch`;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        client = new Client({ connectionString: url, connectionTimeoutMillis: 500 });
        try { await client.connect(); break; } catch { await client.end().catch(() => undefined); client = undefined; await new Promise((resolve) => setTimeout(resolve, 250)); }
      }
      if (!client) throw new Error("disposable postgres did not start");
      await client.query("create table plan5_backup_probe(id integer primary key, value text not null)");
      await client.query("insert into plan5_backup_probe values (1, 'restorable')");
      await client.end(); client = undefined;

      const image = (await execFileAsync("docker", ["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"])).stdout.trim();
      const tool = async (name: "pg_dump" | "pg_restore") => ({
        executableIdentitySha256: (await execFileAsync("docker", ["run", "--rm", "--network", "none", "--pull", "never",
          "--entrypoint", "/usr/bin/sha256sum", image, `/usr/local/bin/${name}`])).stdout.trim().split(/\s+/)[0],
        version: (await execFileAsync("docker", ["run", "--rm", "--network", "none", "--pull", "never",
          "--entrypoint", `/usr/local/bin/${name}`, image, "--version"])).stdout.trim()
      });
      const task0b = fixture(root).task0b;
      const tools = cloneFixture(task0b.postgresTools) as any;
      tools.provider.immutableImageId = image;
      tools.provider.immutableImageIdSha256 = sha256(image);
      Object.assign(tools.pgDump, await tool("pg_dump"));
      Object.assign(tools.pgRestore, await tool("pg_restore"));
      await api.attestProductionPostgresTools(tools);
      await expect(api.attestProductionPostgresTools({
        ...tools, pgRestore: { ...tools.pgRestore, version: `${tools.pgRestore.version}-tampered` }
      })).rejects.toThrow(/tool_changed/);

      snapshot = await api.observeProductionDatabase(url, true);
      const identityFingerprintSha256 = snapshot.identityFingerprintSha256;
      await api.writeProductionDump(root, api.buildProductionPgDumpInvocation({
        imageId: image, containerName: dumpName, databaseUrl: url, snapshotId: snapshot.snapshotId
      }), dumpName, 60_000);
      await snapshot.client.query("rollback"); await snapshot.client.end(); snapshot = undefined;
      await api.writeProductionRestoreList(root, tools);
      const after = await api.observeProductionDatabase(url);
      expect(after.identityFingerprintSha256).toBeTruthy();
      await after.client.query("rollback"); await after.client.end();
      expect(readFileSync(join(root, "production-backup.dump")).subarray(0, 5).toString("ascii")).toBe("PGDMP");
      expect(readFileSync(join(root, "production-backup-restore-list.txt"), "utf8")).toContain("plan5_backup_probe");
      const authority = { ...fixture(root).authority, databaseIdentityFingerprintSha256: identityFingerprintSha256 };
      const evidence = await api.buildProductionBackupEvidence(root, authority);
      expect(evidence.backupBytes).toBe(readFileSync(join(root, "production-backup.dump")).length);
      expect(evidence.restoreListBytes).toBe(readFileSync(join(root, "production-backup-restore-list.txt")).length);
      await api.attestProductionBackupFiles(root, evidence, tools);
      const listBytes = readFileSync(join(root, "production-backup-restore-list.txt"));
      writeFileSync(join(root, "production-backup-restore-list.txt"), Buffer.concat([listBytes, Buffer.from("; tampered\n")]));
      await expect(api.attestProductionBackupFiles(root, evidence, tools)).rejects.toThrow(/backup_file_unverified/);
      writeFileSync(join(root, "production-backup-restore-list.txt"), listBytes);
      const dumpBytes = readFileSync(join(root, "production-backup.dump"));
      const tamperedDump = Buffer.from(dumpBytes); tamperedDump[tamperedDump.length - 1] ^= 0xff;
      writeFileSync(join(root, "production-backup.dump"), tamperedDump);
      await expect(api.attestProductionBackupFiles(root, evidence, tools)).rejects.toThrow(/backup_file_unverified/);
      writeFileSync(join(root, "production-backup.dump"), dumpBytes);
      expect(readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false);
    } finally {
      if (snapshot) { await snapshot.client.query("rollback").catch(() => undefined); await snapshot.client.end().catch(() => undefined); }
      if (client) await client.end().catch(() => undefined);
      await execFileAsync("docker", ["rm", "--force", dumpName]).catch(() => undefined);
      await execFileAsync("docker", ["rm", "--force", serverName]).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
