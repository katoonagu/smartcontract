import type { Logger } from "../logging/logger";
import type { AddressMetadata } from "../storage/repositories";
import type { TronscanAddressMetadata } from "../tron/tronClient";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AddressMetadataCacheDeps = {
  getFresh(address: string, now: Date): Promise<AddressMetadata | null>;
  getStale(address: string): Promise<AddressMetadata | null>;
  fetchLive(address: string): Promise<TronscanAddressMetadata | null>;
  upsert(metadata: AddressMetadata): Promise<void>;
  logger?: Pick<Logger, "warn">;
};

export function addressMetadataTtlMs(metadata: TronscanAddressMetadata): number {
  if (metadata.tag || metadata.name) return 30 * DAY_MS;
  if (metadata.isContract === true) return 7 * DAY_MS;
  return 3 * DAY_MS;
}

export function metadataToAddressMetadata(metadata: TronscanAddressMetadata, now: Date): AddressMetadata {
  return {
    address: metadata.address,
    source: metadata.source,
    name: metadata.name,
    tag: metadata.tag,
    isContract: metadata.isContract,
    verified: metadata.verified,
    accountType: metadata.accountType,
    rawJson: metadata.rawJson,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + addressMetadataTtlMs(metadata))
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCachedAddressMetadataResolver(deps: AddressMetadataCacheDeps) {
  const refreshes = new Map<string, Promise<void>>();

  async function fetchAndStore(address: string, now = new Date()): Promise<AddressMetadata | null> {
    const providerMetadata = await deps.fetchLive(address).catch((error) => {
      deps.logger?.warn("address_metadata_live_fetch_failed", {
        address,
        error: errorMessage(error)
      });
      return null;
    });
    if (!providerMetadata) return null;
    const metadata = metadataToAddressMetadata(providerMetadata, now);
    await deps.upsert(metadata).catch((error) => {
      deps.logger?.warn("address_metadata_cache_write_failed", {
        address,
        error: errorMessage(error)
      });
    });
    return metadata;
  }

  function refreshStaleBestEffort(address: string): void {
    if (refreshes.has(address)) return;
    const refresh = fetchAndStore(address)
      .then(() => undefined)
      .finally(() => {
        refreshes.delete(address);
      });
    refreshes.set(address, refresh);
  }

  return async function getCachedOrLiveAddressMetadata(address: string, now = new Date()): Promise<AddressMetadata | null> {
    const fresh = await deps.getFresh(address, now);
    if (fresh) return fresh;

    const stale = await deps.getStale(address).catch((error) => {
      deps.logger?.warn("address_metadata_stale_cache_read_failed", {
        address,
        error: errorMessage(error)
      });
      return null;
    });
    if (stale) {
      refreshStaleBestEffort(address);
      return stale;
    }

    return fetchAndStore(address, now);
  };
}
