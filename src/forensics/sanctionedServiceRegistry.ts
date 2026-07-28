import type { ServiceCategory } from "../types";

export type SanctionedCryptoService = {
  key: string;
  displayName: string;
  aliases: readonly string[];
  authority: "UK" | "OFAC";
  designatedAt: string;
  category: ServiceCategory;
  sourceUrl: string;
};

export type SanctionedServiceTemporalState = "active" | "inactive" | "unknown";

// Official designation dates are date-only in the cited notices; store them as
// UTC day starts so historical transfers before the designation stay contextual.
export const SANCTIONED_CRYPTO_SERVICES: readonly SanctionedCryptoService[] = [
  {
    key: "htx_huobi",
    displayName: "HTX/Huobi Global",
    aliases: ["htx", "huobi", "huobi global", "huobi global s a", "huobi global sa"],
    authority: "UK",
    designatedAt: "2026-05-26T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://assets.publishing.service.gov.uk/media/6a2a9de71f6fa5c3377e5da7/Sanctions_Notice_Russia_26_May_2026.pdf"
  },
  {
    key: "exmo",
    displayName: "EXMO",
    aliases: ["exmo", "exmo exchange", "exmo exchange limited", "exmo com", "exmo me"],
    authority: "UK",
    designatedAt: "2026-05-26T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://assets.publishing.service.gov.uk/media/6a2a9de71f6fa5c3377e5da7/Sanctions_Notice_Russia_26_May_2026.pdf"
  },
  {
    key: "abcex",
    displayName: "ABCEX/Nueva Cryptologia",
    aliases: ["abcex", "abcex exchange", "abcex io", "nueva cryptologia"],
    authority: "UK",
    designatedAt: "2026-05-26T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://assets.publishing.service.gov.uk/media/6a2a9de71f6fa5c3377e5da7/Sanctions_Notice_Russia_26_May_2026.pdf"
  },
  {
    key: "arvix_exnode",
    displayName: "Arvix/Exnode",
    aliases: ["arvix", "arvix pro", "exnode", "exnode pay", "exnode ru"],
    authority: "UK",
    designatedAt: "2026-05-26T00:00:00.000Z",
    category: "service",
    sourceUrl: "https://assets.publishing.service.gov.uk/media/6a2a9de71f6fa5c3377e5da7/Sanctions_Notice_Russia_26_May_2026.pdf"
  },
  {
    key: "rapira",
    displayName: "Rapira",
    aliases: ["rapira", "rapira group", "rapira group llc", "rapira io", "rapira org", "rapira24"],
    authority: "UK",
    designatedAt: "2026-05-26T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://assets.publishing.service.gov.uk/media/6a2a9de71f6fa5c3377e5da7/Sanctions_Notice_Russia_26_May_2026.pdf"
  },
  {
    key: "bitpapa",
    displayName: "Bitpapa",
    aliases: ["bitpapa", "bitpapa pay"],
    authority: "UK",
    designatedAt: "2026-05-26T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://assets.publishing.service.gov.uk/media/6a2a9de71f6fa5c3377e5da7/Sanctions_Notice_Russia_26_May_2026.pdf"
  },
  {
    key: "garantex",
    displayName: "Garantex",
    aliases: ["garantex", "garantex europe"],
    authority: "OFAC",
    designatedAt: "2022-04-05T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://ofac.treasury.gov/recent-actions/20220405"
  },
  {
    key: "grinex",
    displayName: "Grinex",
    aliases: ["grinex"],
    authority: "OFAC",
    designatedAt: "2025-08-14T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://home.treasury.gov/news/press-releases/sb0225"
  },
  {
    key: "cryptex",
    displayName: "Cryptex",
    aliases: ["cryptex"],
    authority: "OFAC",
    designatedAt: "2024-09-26T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://home.treasury.gov/news/press-releases/jy2616"
  },
  {
    key: "suex",
    displayName: "SUEX",
    aliases: ["suex", "suex otc"],
    authority: "OFAC",
    designatedAt: "2021-09-21T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://ofac.treasury.gov/recent-actions/20210921"
  },
  {
    key: "chatex",
    displayName: "Chatex",
    aliases: ["chatex", "chatextech"],
    authority: "OFAC",
    designatedAt: "2021-11-08T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://ofac.treasury.gov/recent-actions/20211108"
  },
  {
    key: "netex24",
    displayName: "NetEx24",
    aliases: ["netex24", "net exchange", "netexchange"],
    authority: "OFAC",
    designatedAt: "2024-03-25T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://ofac.treasury.gov/recent-actions/20240325"
  },
  {
    key: "awex",
    displayName: "AWEX",
    aliases: ["awex"],
    authority: "OFAC",
    designatedAt: "2024-03-25T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://ofac.treasury.gov/recent-actions/20240325"
  },
  {
    key: "nobitex",
    displayName: "Nobitex",
    aliases: ["nobitex"],
    authority: "OFAC",
    designatedAt: "2026-06-02T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://home.treasury.gov/news/press-releases/sb0519"
  },
  {
    key: "wallex",
    displayName: "Wallex",
    aliases: ["wallex"],
    authority: "OFAC",
    designatedAt: "2026-06-02T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://home.treasury.gov/news/press-releases/sb0519"
  },
  {
    key: "bitpin",
    displayName: "Bitpin",
    aliases: ["bitpin"],
    authority: "OFAC",
    designatedAt: "2026-06-02T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://home.treasury.gov/news/press-releases/sb0519"
  },
  {
    key: "ramzinex",
    displayName: "Ramzinex",
    aliases: ["ramzinex"],
    authority: "OFAC",
    designatedAt: "2026-06-02T00:00:00.000Z",
    category: "cex",
    sourceUrl: "https://home.treasury.gov/news/press-releases/sb0519"
  }
];

function normalizeServiceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAlias(normalizedText: string, alias: string): boolean {
  const normalizedAlias = normalizeServiceText(alias);
  if (!normalizedAlias) return false;
  return (` ${normalizedText} `).includes(` ${normalizedAlias} `);
}

function matchingSanctionedCryptoServices(
  text: string | null | undefined,
  services: readonly SanctionedCryptoService[]
): SanctionedCryptoService[] {
  const normalized = normalizeServiceText(text ?? "");
  if (!normalized) return [];
  return services.filter((service) =>
    normalizeServiceText(service.key) === normalized ||
    service.aliases.some((alias) => containsAlias(normalized, alias))
  );
}

export function resolveSanctionedCryptoService(
  authorityFields: readonly (string | null | undefined)[],
  services: readonly SanctionedCryptoService[] = SANCTIONED_CRYPTO_SERVICES
): SanctionedCryptoService | null {
  const keys = new Set(authorityFields.flatMap((field) =>
    matchingSanctionedCryptoServices(field, services).map((service) => service.key)
  ));
  if (keys.size !== 1) return null;
  const [key] = keys;
  return services.find((service) => service.key === key) ?? null;
}

export function matchSanctionedCryptoService(text: string | null | undefined): SanctionedCryptoService | null {
  return resolveSanctionedCryptoService([text]);
}

export function sanctionedCryptoServiceStateAt(
  service: SanctionedCryptoService,
  eventTimestamp: Date | string | null | undefined
): SanctionedServiceTemporalState {
  if (eventTimestamp === null || eventTimestamp === undefined) return "unknown";
  const eventTime = typeof eventTimestamp === "string"
    ? Date.parse(eventTimestamp)
    : eventTimestamp.getTime();
  const designatedTime = Date.parse(service.designatedAt);
  if (!Number.isFinite(eventTime) || !Number.isFinite(designatedTime)) return "unknown";
  return eventTime >= designatedTime ? "active" : "inactive";
}

export function sanctionsDate(service: SanctionedCryptoService): string {
  return service.designatedAt.slice(0, 10);
}
