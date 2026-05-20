import pg from "pg";

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl });
}

export async function closeDb(db: Db): Promise<void> {
  await db.end();
}
