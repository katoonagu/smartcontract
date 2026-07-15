import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

const PLAN3_DATABASE_URL = "postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3";
const required = process.env.REQUIRE_PLAN3_POSTGRES === "1";
const connectionString = process.env.TEST_DATABASE_URL;
if (required && connectionString !== PLAN3_DATABASE_URL) {
  throw new Error(`Plan 3 PostgreSQL acceptance requires TEST_DATABASE_URL=${PLAN3_DATABASE_URL}`);
}
const postgresIt = required ? it : it.skip;
const databaseUrl = connectionString ?? PLAN3_DATABASE_URL;
const NOW = new Date("2026-07-15T12:00:00.000Z");
const OFFICIAL_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const OWNER = `T${"1".repeat(33)}`;
const filePrefix = `plan3_allowance_${process.pid}_`;

type AllowanceTarget = {
  watchedWalletId: string;
  ownerAddress: string;
  tokenContract: string;
  spenderAddress: string;
};

type AllowanceState = {
  ownerAddress: string;
  spenderAddress: string;
  tokenContract: string;
  confirmedAllowanceRaw: string | null;
  isUnlimited: boolean | null;
  state: "confirmed_active" | "confirmed_zero" | "failed" | "stale";
  freshUntil: string | null;
  lastAttemptAt: string | null;
  failureCode: string | null;
};

type WorkerRepository = {
  listDueApprovalAllowanceRefreshTargets(
    db: unknown,
    input: { now: Date; limit: number }
  ): Promise<AllowanceTarget[]>;
  tryAcquireApprovalAllowanceRefreshLock(
    db: unknown,
    input: AllowanceTarget & { now: Date }
  ): Promise<null | { release(): Promise<void> }>;
};

type RunSingleApprovalAllowanceRefreshCycle = (deps: {
  db: unknown;
  now(): Date;
  getUsdtAllowance(input: {
    ownerAddress: string;
    spenderAddress: string;
    signal: AbortSignal;
  }): Promise<string>;
  saveWalletApprovalAllowanceStateV2(input: {
    watchedWalletId: string;
    allowance: AllowanceState;
  }): Promise<void>;
  repository: WorkerRepository;
}) => Promise<unknown>;

type Plan3AllowanceRepository = {
  tryAcquireApprovalAllowanceRefreshLock(
    db: pg.Pool,
    input: {
      watchedWalletId: string;
      tokenContract: string;
      spenderAddress: string;
      now: Date;
    }
  ): Promise<null | { release(): Promise<void> }>;
};

function target(index: number): AllowanceTarget {
  return {
    watchedWalletId: `allowance-target-${index}`,
    ownerAddress: OWNER,
    tokenContract: OFFICIAL_USDT,
    spenderAddress: `T${String(index + 1).repeat(33)}`
  };
}

async function loadAllowanceWorker(): Promise<RunSingleApprovalAllowanceRefreshCycle> {
  const modulePath: string = "../../src/approvals/allowanceRefreshWorker";
  let module: Record<string, unknown>;
  try {
    module = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  } catch (error) {
    throw new Error("Plan 3 feature missing: runSingleApprovalAllowanceRefreshCycle", { cause: error });
  }
  if (typeof module.runSingleApprovalAllowanceRefreshCycle !== "function") {
    throw new Error("Plan 3 feature missing: runSingleApprovalAllowanceRefreshCycle");
  }
  return module.runSingleApprovalAllowanceRefreshCycle as RunSingleApprovalAllowanceRefreshCycle;
}

async function loadAllowanceRepository(): Promise<Plan3AllowanceRepository> {
  const modulePath: string = "../../src/storage/repositories";
  const module = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  if (typeof module.tryAcquireApprovalAllowanceRefreshLock !== "function") {
    throw new Error("Plan 3 feature missing: tryAcquireApprovalAllowanceRefreshLock");
  }
  return module as unknown as Plan3AllowanceRepository;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushTurns(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function safeIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  return `"${value}"`;
}

async function withAllowanceSchema(run: (db: pg.Pool, applicationName: string) => Promise<void>): Promise<void> {
  const schema = `${filePrefix}${randomUUID().replaceAll("-", "").slice(0, 16)}`.slice(0, 63);
  const applicationName = `${schema}_client`.slice(0, 63);
  const admin = new pg.Pool({ connectionString: databaseUrl, application_name: `${schema}_admin`.slice(0, 63) });
  let db: pg.Pool | null = null;
  let primaryFailed = false;
  let primaryError: unknown;
  try {
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan3") {
      throw new Error(`Refusing Plan 3 acceptance database ${String(database.rows[0]?.name)}`);
    }
    await admin.query(`create schema ${safeIdentifier(schema)}`);
    db = new pg.Pool({
      connectionString: databaseUrl,
      application_name: applicationName,
      options: `-c search_path=${schema},pg_catalog`
    });
    const location = await db.query("select current_schema() as name, current_database() as database");
    expect(location.rows[0]).toEqual({ name: schema, database: "tron_watch_plan3" });
    await db.query(`
      create table telegram_users (
        telegram_user_id text primary key,
        username text,
        locale text not null default 'ru',
        created_at timestamptz not null default now()
      );
      create table watched_wallets (
        id text primary key,
        telegram_user_id text not null references telegram_users(telegram_user_id) on delete cascade,
        address text not null,
        alert_mode text not null default 'realtime'
          check (alert_mode in ('realtime', 'risk_only', 'digest', 'paused')),
        digest_interval_minutes integer not null default 10,
        created_at timestamptz not null default now(),
        unique (telegram_user_id, address)
      );
      create table wallet_approvals (
        watched_wallet_id text not null references watched_wallets(id) on delete cascade,
        token_contract text not null,
        spender_address text not null,
        amount_raw text not null default '0',
        is_unlimited boolean not null default false,
        current_allowance_raw text not null default '0',
        spender_type text not null default 'unknown',
        status text not null default 'unknown',
        last_approval_tx_hash text,
        last_approval_at timestamptz,
        risk_level text not null default 'LOW',
        risk_score integer not null default 0,
        risk_reasons jsonb not null default '[]'::jsonb,
        last_alerted_tx_hash text,
        allowance_confirmed_raw text,
        allowance_check_status text not null default 'stale'
          check (allowance_check_status in ('confirmed_active', 'confirmed_zero', 'failed', 'stale')),
        allowance_checked_at timestamptz,
        allowance_fresh_until timestamptz,
        allowance_last_attempt_at timestamptz,
        allowance_failure_code text,
        updated_at timestamptz not null default now(),
        primary key (watched_wallet_id, token_contract, spender_address)
      );
      create index idx_wallet_approvals_allowance_refresh
        on wallet_approvals(allowance_check_status, allowance_fresh_until);
    `);
    await run(db, applicationName);
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  }

  const cleanupErrors: unknown[] = [];
  if (db) {
    try {
      await db.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await admin.query(`drop schema if exists ${safeIdentifier(schema)} cascade`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
      const namespace = await admin.query("select to_regnamespace($1) as name", [schema]);
      if (namespace.rows[0]?.name !== null) throw new Error(`Plan 3 schema cleanup failed: ${schema}`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    const triggers = await admin.query(
      `select count(*)::integer as count
       from pg_trigger trigger_row
       join pg_class relation on relation.oid = trigger_row.tgrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where not trigger_row.tgisinternal and namespace.nspname = $1`,
      [schema]
    );
    if (triggers.rows[0]?.count !== 0) throw new Error(`Plan 3 trigger cleanup failed: ${schema}`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
      const locks = await admin.query(
        `select count(*)::integer as count
         from pg_locks locks
         join pg_stat_activity activity on activity.pid = locks.pid
         where locks.locktype = 'advisory' and activity.application_name = $1`,
        [applicationName]
      );
      if (locks.rows[0]?.count !== 0) throw new Error(`Plan 3 advisory-lock cleanup failed: ${schema}`);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryFailed && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], `Plan 3 allowance scenario and cleanup failed: ${schema}`);
  }
  if (primaryFailed) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Plan 3 allowance cleanup failed: ${schema}`);
  }
}

describe("Plan 3 allowance refresh acceptance", () => {
  it("[REQ-19][RUNTIME-REFRESH] refreshes only bounded due stale allowance rows", async () => {
    const runCycle = await loadAllowanceWorker();
    const due = Array.from({ length: 6 }, (_, index) => target(index));
    const refreshed: string[] = [];
    const releases: string[] = [];
    let requestedLimit: number | null = null;

    await runCycle({
      db: {},
      now: () => NOW,
      getUsdtAllowance: async () => "1000000",
      saveWalletApprovalAllowanceStateV2: async ({ watchedWalletId, allowance }) => {
        refreshed.push(watchedWalletId);
        expect(allowance).toMatchObject({
          state: "confirmed_active",
          confirmedAllowanceRaw: "1000000",
          tokenContract: OFFICIAL_USDT
        });
      },
      repository: {
        listDueApprovalAllowanceRefreshTargets: async (_db, input) => {
          expect(input.now).toEqual(NOW);
          requestedLimit = input.limit;
          return due;
        },
        tryAcquireApprovalAllowanceRefreshLock: async (_db, row) => ({
          release: async () => { releases.push(row.watchedWalletId); }
        })
      }
    });

    expect(requestedLimit).toBe(5);
    expect(refreshed).toEqual(due.slice(0, 5).map((row) => row.watchedWalletId));
    expect(releases).toEqual(refreshed);
  });

  it("[REQ-19][RUNTIME-REFRESH] skips fresh and recently attempted rows without a full-node call", async () => {
    const runCycle = await loadAllowanceWorker();
    let fullNodeCalls = 0;
    let lockCalls = 0;

    await runCycle({
      db: {},
      now: () => NOW,
      getUsdtAllowance: async () => {
        fullNodeCalls += 1;
        return "0";
      },
      saveWalletApprovalAllowanceStateV2: async () => {
        throw new Error("fresh or recently attempted rows must not be saved");
      },
      repository: {
        listDueApprovalAllowanceRefreshTargets: async (_db, input) => {
          expect(input).toEqual({ now: NOW, limit: 5 });
          return [];
        },
        tryAcquireApprovalAllowanceRefreshLock: async () => {
          lockCalls += 1;
          return null;
        }
      }
    });

    expect(fullNodeCalls).toBe(0);
    expect(lockCalls).toBe(0);
  });

  it("[REQ-19][RUNTIME-REFRESH] isolates provider failure as UNKNOWN null and continues the batch", async () => {
    const runCycle = await loadAllowanceWorker();
    const rows = Array.from({ length: 5 }, (_, index) => target(index));
    const saved = new Map<string, AllowanceState>();
    const providerOutcomes: Array<() => Promise<string>> = [
      async () => { throw new Error("full-node timeout"); },
      async () => "0xmalformed",
      async () => { throw new Error("contract reverted"); },
      async () => { throw new Error("provider disconnected"); },
      async () => "2500000"
    ];
    let providerIndex = 0;

    await runCycle({
      db: {},
      now: () => NOW,
      getUsdtAllowance: async () => providerOutcomes[providerIndex++]!(),
      saveWalletApprovalAllowanceStateV2: async ({ watchedWalletId, allowance }) => {
        saved.set(watchedWalletId, allowance);
      },
      repository: {
        listDueApprovalAllowanceRefreshTargets: async () => rows,
        tryAcquireApprovalAllowanceRefreshLock: async () => ({ release: async () => undefined })
      }
    });

    expect([...saved.keys()]).toEqual(rows.map((row) => row.watchedWalletId));
    expect(rows.slice(0, 4).map((row) => saved.get(row.watchedWalletId))).toEqual([
      expect.objectContaining({ state: "failed", confirmedAllowanceRaw: null, isUnlimited: null, failureCode: "provider_timeout" }),
      expect.objectContaining({ state: "failed", confirmedAllowanceRaw: null, isUnlimited: null, failureCode: "malformed_response" }),
      expect.objectContaining({ state: "failed", confirmedAllowanceRaw: null, isUnlimited: null, failureCode: "contract_call_reverted" }),
      expect.objectContaining({ state: "failed", confirmedAllowanceRaw: null, isUnlimited: null, failureCode: "provider_unavailable" })
    ]);
    expect(saved.get(rows[4]!.watchedWalletId)).toMatchObject({
      state: "confirmed_active",
      confirmedAllowanceRaw: "2500000",
      failureCode: null
    });
  });

  it("[REQ-19][RUNTIME-REFRESH] processes due targets sequentially with concurrency one", async () => {
    const runCycle = await loadAllowanceWorker();
    const rows = [target(0), target(1), target(2)];
    const providerResults = rows.map(() => createDeferred<string>());
    const events: string[] = [];
    let active = 0;
    let maximumActive = 0;
    let providerIndex = 0;

    let cycle: Promise<unknown> | undefined;
    try {
      cycle = runCycle({
        db: {},
        now: () => NOW,
        getUsdtAllowance: async () => {
          const index = providerIndex++;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          events.push(`provider:${rows[index]!.watchedWalletId}`);
          try {
            return await providerResults[index]!.promise;
          } finally {
            active -= 1;
          }
        },
        saveWalletApprovalAllowanceStateV2: async ({ watchedWalletId }) => {
          events.push(`save:${watchedWalletId}`);
        },
        repository: {
          listDueApprovalAllowanceRefreshTargets: async () => rows,
          tryAcquireApprovalAllowanceRefreshLock: async (_db, row) => ({
            release: async () => { events.push(`unlock:${row.watchedWalletId}`); }
          })
        }
      });

      await flushTurns();
      expect(events).toEqual([`provider:${rows[0]!.watchedWalletId}`]);
      providerResults[0]!.resolve("1");
      await flushTurns();
      expect(events.slice(0, 4)).toEqual([
        `provider:${rows[0]!.watchedWalletId}`,
        `save:${rows[0]!.watchedWalletId}`,
        `unlock:${rows[0]!.watchedWalletId}`,
        `provider:${rows[1]!.watchedWalletId}`
      ]);
      providerResults[1]!.resolve("2");
      await flushTurns();
      providerResults[2]!.resolve("3");
      await cycle;

      expect(maximumActive).toBe(1);
      expect(events).toEqual(rows.flatMap((row) => [
        `provider:${row.watchedWalletId}`,
        `save:${row.watchedWalletId}`,
        `unlock:${row.watchedWalletId}`
      ]));
    } finally {
      for (const pending of providerResults) pending.resolve("0");
      if (cycle) await Promise.allSettled([cycle]);
    }
  });

  it("[REQ-19][RUNTIME-REFRESH][TIMEOUT] aborts one provider target at 15 seconds and continues sequentially", async () => {
    const runCycle = await loadAllowanceWorker();
    vi.useFakeTimers();
    const rows = [target(10), target(11)];
    const firstProvider = createDeferred<string>();
    const saved = new Map<string, AllowanceState>();
    const events: string[] = [];
    let providerIndex = 0;
    let firstSignal: AbortSignal | undefined;
    let cycle: Promise<unknown> | undefined;
    try {
      cycle = runCycle({
        db: {},
        now: () => NOW,
        getUsdtAllowance: async ({ signal }) => {
          const row = rows[providerIndex++]!;
          events.push(`provider:${row.watchedWalletId}`);
          if (providerIndex === 1) firstSignal = signal;
          return providerIndex === 1 ? firstProvider.promise : "2000000";
        },
        saveWalletApprovalAllowanceStateV2: async ({ watchedWalletId, allowance }) => {
          saved.set(watchedWalletId, allowance);
          events.push(`save:${watchedWalletId}`);
        },
        repository: {
          listDueApprovalAllowanceRefreshTargets: async () => rows,
          tryAcquireApprovalAllowanceRefreshLock: async (_db, row) => ({
            release: async () => { events.push(`unlock:${row.watchedWalletId}`); }
          })
        }
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(events).toEqual([`provider:${rows[0]!.watchedWalletId}`]);
      expect(firstSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(14_999);
      expect(firstSignal?.aborted).toBe(false);
      expect(saved.has(rows[0]!.watchedWalletId)).toBe(false);
      expect(events).toEqual([`provider:${rows[0]!.watchedWalletId}`]);

      await vi.advanceTimersByTimeAsync(1);
      expect(firstSignal?.aborted).toBe(true);
      expect(saved.get(rows[0]!.watchedWalletId)).toMatchObject({
        state: "failed",
        confirmedAllowanceRaw: null,
        isUnlimited: null,
        failureCode: "provider_timeout"
      });
      expect(events.slice(0, 4)).toEqual([
        `provider:${rows[0]!.watchedWalletId}`,
        `save:${rows[0]!.watchedWalletId}`,
        `unlock:${rows[0]!.watchedWalletId}`,
        `provider:${rows[1]!.watchedWalletId}`
      ]);
      await cycle;
      expect(saved.get(rows[1]!.watchedWalletId)).toMatchObject({
        state: "confirmed_active",
        confirmedAllowanceRaw: "2000000",
        failureCode: null
      });
    } finally {
      firstProvider.resolve("0");
      if (cycle) await Promise.allSettled([cycle]);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  postgresIt("[REQ-19][RUNTIME-REFRESH][POSTGRES] serializes the same owner spender with an advisory lock", async () => {
    await withAllowanceSchema(async (db, applicationName) => {
      const walletId = "allowance-lock-wallet";
      const spenderAddress = `T${"9".repeat(33)}`;
      await db.query("insert into telegram_users (telegram_user_id, username) values ('allowance-owner', 'runtime')");
      await db.query(
        `insert into watched_wallets (id, telegram_user_id, address, alert_mode)
         values ($1, 'allowance-owner', $2, 'realtime')`,
        [walletId, OWNER]
      );
      await db.query(
        `insert into wallet_approvals (
           watched_wallet_id, token_contract, spender_address, allowance_check_status,
           allowance_last_attempt_at, allowance_fresh_until
         ) values ($1, $2, $3, 'stale', $4, $5)`,
        [
          walletId,
          OFFICIAL_USDT,
          spenderAddress,
          new Date(NOW.getTime() - 16 * 60_000),
          new Date(NOW.getTime() - 60_000)
        ]
      );
      const repository = await loadAllowanceRepository();
      const input = { watchedWalletId: walletId, tokenContract: OFFICIAL_USDT, spenderAddress, now: NOW };
      let first: Awaited<ReturnType<Plan3AllowanceRepository["tryAcquireApprovalAllowanceRefreshLock"]>> = null;
      let third: Awaited<ReturnType<Plan3AllowanceRepository["tryAcquireApprovalAllowanceRefreshLock"]>> = null;
      try {
        first = await repository.tryAcquireApprovalAllowanceRefreshLock(db, input);
        expect(first).not.toBeNull();
        await expect(repository.tryAcquireApprovalAllowanceRefreshLock(db, input)).resolves.toBeNull();
        await first!.release();
        first = null;
        third = await repository.tryAcquireApprovalAllowanceRefreshLock(db, input);
        expect(third).not.toBeNull();
      } finally {
        const releases = [first, third]
          .filter((lock): lock is NonNullable<typeof lock> => lock !== null)
          .map((lock) => Promise.resolve().then(() => lock.release()));
        const settled = await Promise.allSettled(releases);
        const releaseErrors = settled
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason);
        if (releaseErrors.length > 0) {
          throw new AggregateError(releaseErrors, "Plan 3 allowance advisory-lock release failed");
        }
      }
      const locks = await db.query(
        `select count(*)::integer as count
         from pg_locks locks
         join pg_stat_activity activity on activity.pid = locks.pid
         where locks.locktype = 'advisory' and activity.application_name = $1`,
        [applicationName]
      );
      expect(locks.rows[0]?.count).toBe(0);
    });
  });
});

afterAll(async () => {
  if (!required) return;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  const errors: unknown[] = [];
  try {
    const database = await admin.query("select current_database() as name");
    if (database.rows[0]?.name !== "tron_watch_plan3") {
      throw new Error(`Refusing Plan 3 allowance cleanup audit database ${String(database.rows[0]?.name)}`);
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    const schemas = await admin.query(
      "select schema_name from information_schema.schemata where schema_name like $1",
      [`${filePrefix}%`]
    );
    if (schemas.rows.length > 0) throw new Error(`Plan 3 allowance schema audit failed: ${schemas.rows.length}`);
  } catch (error) {
    errors.push(error);
  }
  try {
    const triggers = await admin.query(
      `select count(*)::integer as count
       from pg_trigger trigger_row
       join pg_class relation on relation.oid = trigger_row.tgrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where not trigger_row.tgisinternal and namespace.nspname like $1`,
      [`${filePrefix}%`]
    );
    if (triggers.rows[0]?.count !== 0) throw new Error(`Plan 3 allowance trigger audit failed: ${triggers.rows[0]?.count}`);
  } catch (error) {
    errors.push(error);
  }
  try {
    const locks = await admin.query(
      `select count(*)::integer as count
       from pg_locks lock_row
       join pg_stat_activity activity on activity.pid = lock_row.pid
       where lock_row.locktype = 'advisory' and activity.application_name like $1`,
      [`${filePrefix}%`]
    );
    if (locks.rows[0]?.count !== 0) throw new Error(`Plan 3 allowance advisory-lock audit failed: ${locks.rows[0]?.count}`);
  } catch (error) {
    errors.push(error);
  }
  try {
    await admin.end();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) throw new AggregateError(errors, "Plan 3 allowance cleanup audit failed");
});
