import "dotenv/config";

export type AppConfig = {
  botToken: string;
  databaseUrl: string;
  tronscanBaseUrl: string;
  pollIntervalMs: number;
  serviceAdminTelegramIds: Set<string>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const rawAdminIds = process.env.SERVICE_ADMIN_TG_IDS ?? "";
  const adminIds = rawAdminIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return {
    botToken: requireEnv("BOT_TOKEN"),
    databaseUrl: requireEnv("DATABASE_URL"),
    tronscanBaseUrl: process.env.TRONSCAN_BASE_URL ?? "https://apilist.tronscanapi.com",
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "60000"),
    serviceAdminTelegramIds: new Set(adminIds)
  };
}
