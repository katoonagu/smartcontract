import { describe, expect, it, vi } from "vitest";
import { isRetryableLlmEnrichmentError, withLlmEnrichmentRetry } from "../../src/forensics/llmEnrichmentRetry";

describe("LLM enrichment retry gate", () => {
  it("retries rate-limit errors before giving up on contract enrichment", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const result = await withLlmEnrichmentRetry({
      label: "contract_profile",
      address: "TContract",
      maxAttempts: 3,
      retryDelayMs: 100,
      wait: async (ms) => {
        waits.push(ms);
      }
    }, async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("Tronscan contract_top_call request failed: 429");
      return "profile";
    });

    expect(result).toBe("profile");
    expect(attempts).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it("does not retry permanent provider errors", async () => {
    const task = vi.fn(async () => {
      throw new Error("Tronscan contract_top_call request failed: 400");
    });

    await expect(withLlmEnrichmentRetry({
      label: "contract_profile",
      address: "TContract",
      maxAttempts: 3,
      retryDelayMs: 100,
      wait: async () => undefined
    }, task)).rejects.toThrow("400");

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("classifies common transient enrichment failures as retryable", () => {
    expect(isRetryableLlmEnrichmentError(new Error("Tronscan account request failed: 429"))).toBe(true);
    expect(isRetryableLlmEnrichmentError(new Error("request timed out"))).toBe(true);
    expect(isRetryableLlmEnrichmentError(new Error("Tronscan contract request failed: 500"))).toBe(true);
    expect(isRetryableLlmEnrichmentError(new Error("Tronscan contract request failed: 400"))).toBe(false);
  });
});
