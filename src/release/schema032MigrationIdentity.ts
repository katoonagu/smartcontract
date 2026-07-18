import { createHash } from "node:crypto";

const SYSTEM_IDENTIFIER = /^[0-9]{10,30}$/u;
const DECIMAL = /^\d+$/u;
const SERVER_VERSION = /^\d{5,6}$/u;
const ENDPOINT = /^(?:127\.0\.0\.1|localhost|\[::1\]):(?:[1-9]\d{0,4})$/u;

export type Schema032MigrationSessionIdentity = {
  databaseEndpoint: string;
  databaseName: string;
  databaseOid: string;
  serverVersion: string;
  systemIdentifier: string;
  currentUser: string;
  sessionUser: string;
  currentRole: string;
  databaseOwner: string;
};

type QueryClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

function fail(code: string): never {
  throw new Error(code);
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 63 && !/[\0-\x1f\x7f]/u.test(value);
}

function endpointPort(endpoint: string): number {
  if (!ENDPOINT.test(endpoint)) fail("schema_032_sequence_database_identity_invalid");
  const value = Number(endpoint.slice(endpoint.lastIndexOf(":") + 1));
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    fail("schema_032_sequence_database_identity_invalid");
  }
  return value;
}

export function buildSchema032MigrationSessionIdentitySha256(
  identity: Schema032MigrationSessionIdentity
): string {
  if (!ENDPOINT.test(identity.databaseEndpoint)
      || !safeIdentifier(identity.databaseName)
      || !DECIMAL.test(identity.databaseOid)
      || !SERVER_VERSION.test(identity.serverVersion)
      || !SYSTEM_IDENTIFIER.test(identity.systemIdentifier)
      || !safeIdentifier(identity.currentUser)
      || !safeIdentifier(identity.sessionUser)
      || !safeIdentifier(identity.currentRole)
      || !safeIdentifier(identity.databaseOwner)) {
    fail("schema_032_sequence_database_identity_invalid");
  }
  if (identity.currentUser !== identity.sessionUser
      || identity.currentUser !== identity.currentRole
      || identity.currentUser !== identity.databaseOwner) {
    fail("schema_032_sequence_database_role_unverified");
  }
  return createHash("sha256").update(JSON.stringify({
    databaseEndpoint: identity.databaseEndpoint,
    databaseName: identity.databaseName,
    databaseOid: identity.databaseOid,
    serverVersion: identity.serverVersion,
    systemIdentifier: identity.systemIdentifier,
    currentUser: identity.currentUser,
    sessionUser: identity.sessionUser,
    currentRole: identity.currentRole,
    databaseOwner: identity.databaseOwner
  }), "utf8").digest("hex");
}

export async function observeSchema032MigrationSessionIdentity(
  client: QueryClient,
  databaseEndpoint: string
): Promise<{ identity: Schema032MigrationSessionIdentity; connectedServerPort: number }> {
  endpointPort(databaseEndpoint);
  const result = await client.query(`select current_database() as database_name,
    current_setting('server_version_num') as server_version_num,
    (select oid::text from pg_database where datname = current_database()) as database_oid,
    (select pg_get_userbyid(datdba) from pg_database where datname = current_database()) as database_owner,
    (pg_control_system()).system_identifier::text as system_identifier,
    current_user::text as current_user_name,
    session_user::text as session_user_name,
    current_role::text as current_role_name,
    inet_server_port() as server_port`);
  if (result.rows.length !== 1) fail("schema_032_sequence_database_identity_invalid");
  const row = result.rows[0];
  const connectedServerPort = Number(row.server_port);
  if (!Number.isSafeInteger(connectedServerPort) || connectedServerPort < 1 || connectedServerPort > 65_535) {
    fail("schema_032_sequence_database_identity_invalid");
  }
  const identity: Schema032MigrationSessionIdentity = {
    databaseEndpoint,
    databaseName: String(row.database_name ?? ""),
    databaseOid: String(row.database_oid ?? ""),
    serverVersion: String(row.server_version_num ?? ""),
    systemIdentifier: String(row.system_identifier ?? ""),
    currentUser: String(row.current_user_name ?? ""),
    sessionUser: String(row.session_user_name ?? ""),
    currentRole: String(row.current_role_name ?? ""),
    databaseOwner: String(row.database_owner ?? "")
  };
  buildSchema032MigrationSessionIdentitySha256(identity);
  return { identity, connectedServerPort };
}
