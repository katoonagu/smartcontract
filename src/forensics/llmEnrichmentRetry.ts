import type { Logger } from "../logging/logger";

export type LlmEnrichmentRetryOptions = {
  label: string;
  address: string;
  maxAttempts: number;
  retryDelayMs: number;
  wait?: (ms: number) => Promise<void>;
  logger?: Pick<Logger, "warn">;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRetryableLlmEnrichmentError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (status === 408 || status === 429) return true;
    if (typeof status === "number" && status >= 500 && status <= 599) return true;
  }
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message = errorMessage(error).toLowerCase();
  return /\b(408|429|5\d\d)\b/.test(message) ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("aborted");
}

export async function withLlmEnrichmentRetry<T>(
  options: LlmEnrichmentRetryOptions,
  task: () => Promise<T>
): Promise<T> {
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = Math.max(1, options.maxAttempts);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      const retryable = isRetryableLlmEnrichmentError(error);
      if (!retryable || attempt >= maxAttempts) throw error;
      const delayMs = options.retryDelayMs * attempt;
      options.logger?.warn("llm_enrichment_retry_wait", {
        label: options.label,
        address: options.address,
        attempt,
        next_attempt: attempt + 1,
        delay_ms: delayMs,
        error: errorMessage(error)
      });
      if (delayMs > 0) await wait(delayMs);
    }
  }
  throw new Error("LLM enrichment retry loop exhausted");
}
