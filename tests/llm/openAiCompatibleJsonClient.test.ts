import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleJsonClient } from "../../src/llm/openAiCompatibleJsonClient";

describe("createOpenAiCompatibleJsonClient", () => {
  it("sends one bearer key to an OpenAI-compatible chat completion endpoint and parses JSON", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ verdict: "drainer_like", confidence: 0.91 })
            }
          }
        ]
      }), { status: 200 })
    );
    const client = createOpenAiCompatibleJsonClient({
      apiKey: "deepseek-key",
      baseUrl: new URL("https://api.deepseek.com"),
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      providerLabel: "deepseek",
      timeoutMs: 5000,
      maxRetries: 0,
      fetchImpl
    });

    const result = await client.completeJson({
      systemPrompt: "Return JSON.",
      userPrompt: "{\"case\":\"x\"}"
    });

    expect(result).toMatchObject({
      ok: true,
      json: { verdict: "drainer_like", confidence: 0.91 },
      providerLabel: "deepseek",
      model: "deepseek-v4-pro"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer deepseek-key",
      "Content-Type": "application/json"
    });
    expect(init?.headers).not.toMatchObject({ Authorization: "Bearer key1,key2" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-pro",
      stream: false,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "max"
    });
  });

  it("omits reasoning effort when thinking is disabled", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({
        choices: [{ message: { content: "{\"verdict\":\"legitimate_service\"}" } }]
      }), { status: 200 })
    );
    const client = createOpenAiCompatibleJsonClient({
      apiKey: "key",
      baseUrl: new URL("https://api.deepseek.com"),
      model: "deepseek-v4-pro",
      thinkingEnabled: false,
      reasoningEffort: "max",
      providerLabel: "deepseek",
      timeoutMs: 5000,
      maxRetries: 0,
      fetchImpl
    });

    await client.completeJson({ systemPrompt: "Return JSON.", userPrompt: "{}" });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ thinking: { type: "disabled" } });
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("returns unavailable for invalid JSON content", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 })
    );
    const client = createOpenAiCompatibleJsonClient({
      apiKey: "key",
      baseUrl: new URL("https://api.deepseek.com"),
      model: "deepseek-v4-flash",
      providerLabel: "deepseek",
      timeoutMs: 5000,
      maxRetries: 0,
      fetchImpl
    });

    const result = await client.completeJson({ systemPrompt: "Return JSON.", userPrompt: "{}" });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "invalid_json"
    });
  });

  it("retries retryable HTTP failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "{\"verdict\":\"legitimate_service\"}" } }]
      }), { status: 200 }));
    const client = createOpenAiCompatibleJsonClient({
      apiKey: "key",
      baseUrl: new URL("https://api.deepseek.com/v1"),
      model: "deepseek-v4-flash",
      providerLabel: "deepseek",
      timeoutMs: 5000,
      maxRetries: 1,
      fetchImpl,
      retryDelayMs: 0
    });

    const result = await client.completeJson({ systemPrompt: "Return JSON.", userPrompt: "{}" });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
