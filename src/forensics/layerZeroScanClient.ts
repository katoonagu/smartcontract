export type LayerZeroScanTx = {
  txHash: string;
  blockTimestamp?: number;
  from?: string;
};

export type LayerZeroScanMessage = {
  guid: string;
  source: {
    chain: string | null;
    address: string | null;
    tx: LayerZeroScanTx | null;
  };
  destination: {
    chain: string | null;
    address: string | null;
    tx: LayerZeroScanTx | null;
  };
  protocol: string | null;
};

export type LayerZeroScanClient = {
  getMessageByGuid(guid: string): Promise<LayerZeroScanMessage | null>;
};

type CreateLayerZeroScanClientInput = {
  baseUrl?: URL;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = new URL("https://scan.layerzero-api.com");
const DEFAULT_TIMEOUT_MS = 20_000;

export class LayerZeroScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayerZeroScanError";
  }
}

export function createLayerZeroScanClient(input: CreateLayerZeroScanClientInput = {}): LayerZeroScanClient {
  const baseUrl = input.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = positiveIntegerOrDefault(input.timeoutMs, DEFAULT_TIMEOUT_MS);
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async getMessageByGuid(guid: string): Promise<LayerZeroScanMessage | null> {
      const normalizedGuid = normalizeGuid(guid);
      if (!normalizedGuid) return null;

      const url = new URL(`/v1/messages/guid/${normalizedGuid}`, baseUrl);
      const controller = new AbortController();
      const timeout = timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;

      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });

        if (response.status === 404) return null;
        if (!response.ok) {
          throw new LayerZeroScanError(`LayerZero Scan ${response.status} error for message guid`);
        }

        const body = await response.json().catch(() => {
          throw new LayerZeroScanError("LayerZero Scan malformed response for message guid");
        });
        return normalizeMessage(body, normalizedGuid);
      } catch (error) {
        if (error instanceof LayerZeroScanError) throw error;
        if (controller.signal.aborted) {
          throw new LayerZeroScanError("LayerZero Scan request timed out for message guid");
        }
        throw new LayerZeroScanError("LayerZero Scan request failed for message guid");
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }
  };
}

function normalizeMessage(body: unknown, guid: string): LayerZeroScanMessage | null {
  const response = asRecord(body);
  if (!response) return null;
  const items = Array.isArray(response.data) ? response.data : [];
  const row = asRecord(items[0]);
  if (!row) return null;

  const pathway = asRecord(row.pathway);
  const sourcePathway = asRecord(pathway?.sender);
  const destinationPathway = asRecord(pathway?.receiver);
  const source = asRecord(row.source);
  const destination = asRecord(row.destination);
  const sourceTx = normalizeTx(asRecord(source?.tx));
  const destinationTx = normalizeTx(asRecord(destination?.tx));
  const protocol = optionalString(sourcePathway?.name) ?? optionalString(destinationPathway?.name);

  return {
    guid,
    source: {
      chain: normalizeChain(optionalString(sourcePathway?.chain)),
      address: optionalString(sourcePathway?.address) ?? null,
      tx: sourceTx
    },
    destination: {
      chain: normalizeChain(optionalString(destinationPathway?.chain)),
      address: optionalString(destinationPathway?.address) ?? null,
      tx: destinationTx
    },
    protocol: protocol ?? null
  };
}

function normalizeTx(row: Record<string, unknown> | null): LayerZeroScanTx | null {
  if (!row) return null;
  const txHash = optionalString(row.txHash);
  if (!txHash) return null;
  const blockTimestamp = typeof row.blockTimestamp === "number" && Number.isFinite(row.blockTimestamp)
    ? row.blockTimestamp
    : undefined;
  return {
    txHash,
    blockTimestamp,
    from: optionalString(row.from)
  };
}

function normalizeGuid(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function normalizeChain(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "eth") return "ethereum";
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function positiveIntegerOrDefault(value: number | undefined, defaultValue: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return defaultValue;
  }
  return value;
}
