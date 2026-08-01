import pg from "pg";

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl });
}

export function createServiceRoleShadowRecoveryDb(databaseUrl: string): Db {
  // ponytail: startup recovery is one bounded sweep; use one isolated client
  // until measured recovery work demonstrates a need for concurrency.
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 400
  });
}

export async function closeDb(db: Db): Promise<void> {
  await db.end();
}
