export type OpenAiCompatibleJsonClientOptions = {
  apiKey: string;
  baseUrl: URL;
  model: string;
  providerLabel: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type CompleteJsonInput = {
  systemPrompt: string;
  userPrompt: string;
};

export type CompleteJsonSuccess = {
  ok: true;
  providerLabel: string;
  model: string;
  json: Record<string, unknown>;
  rawText: string;
  latencyMs: number;
};

export type CompleteJsonFailure = {
  ok: false;
  providerLabel: string;
  model: string;
  errorCode: "http_error" | "network_error" | "invalid_json" | "empty_response";
  error: string;
  status?: number;
  latencyMs: number;
};

export type CompleteJsonResult = CompleteJsonSuccess | CompleteJsonFailure;

export type OpenAiCompatibleJsonClient = {
  completeJson(input: CompleteJsonInput): Promise<CompleteJsonResult>;
};

function completionUrl(baseUrl: URL): URL {
  const base = baseUrl.href.endsWith("/") ? baseUrl : new URL(`${baseUrl.href}/`);
  return new URL("chat/completions", base);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function parseJsonContent(value: unknown): { json: Record<string, unknown>; rawText: string } | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { json: parsed as Record<string, unknown>, rawText: value };
    }
  } catch {
    return null;
  }
  return null;
}

function contentFromCompletion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function failure(input: {
  options: OpenAiCompatibleJsonClientOptions;
  startedAt: number;
  errorCode: CompleteJsonFailure["errorCode"];
  error: string;
  status?: number;
}): CompleteJsonFailure {
  const now = input.options.now ?? Date.now;
  return {
    ok: false,
    providerLabel: input.options.providerLabel,
    model: input.options.model,
    errorCode: input.errorCode,
    error: input.error,
    status: input.status,
    latencyMs: Math.max(0, now() - input.startedAt)
  };
}

export function createOpenAiCompatibleJsonClient(options: OpenAiCompatibleJsonClientOptions): OpenAiCompatibleJsonClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const url = completionUrl(options.baseUrl);

  return {
    async completeJson(input): Promise<CompleteJsonResult> {
      const startedAt = now();
      let lastFailure: CompleteJsonFailure | null = null;
      for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
        try {
          const response = await fetchImpl(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: options.model,
              stream: false,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: input.systemPrompt },
                { role: "user", content: input.userPrompt }
              ]
            }),
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (!response.ok) {
            lastFailure = failure({
              options,
              startedAt,
              errorCode: "http_error",
              error: await response.text().catch(() => response.statusText),
              status: response.status
            });
            if (attempt < options.maxRetries && retryableStatus(response.status)) {
              await sleep(options.retryDelayMs ?? 250);
              continue;
            }
            return lastFailure;
          }

          const payload = await response.json().catch(() => null);
          const content = contentFromCompletion(payload);
          if (!content) {
            return failure({
              options,
              startedAt,
              errorCode: "empty_response",
              error: "LLM response did not contain message.content"
            });
          }
          const parsed = parseJsonContent(content);
          if (!parsed) {
            return failure({
              options,
              startedAt,
              errorCode: "invalid_json",
              error: "LLM message.content was not a JSON object"
            });
          }

          return {
            ok: true,
            providerLabel: options.providerLabel,
            model: options.model,
            json: parsed.json,
            rawText: parsed.rawText,
            latencyMs: Math.max(0, now() - startedAt)
          };
        } catch (error) {
          clearTimeout(timeout);
          lastFailure = failure({
            options,
            startedAt,
            errorCode: "network_error",
            error: error instanceof Error ? error.message : String(error)
          });
          if (attempt < options.maxRetries) {
            await sleep(options.retryDelayMs ?? 250);
            continue;
          }
          return lastFailure;
        }
      }
      return lastFailure ?? failure({
        options,
        startedAt,
        errorCode: "network_error",
        error: "LLM request failed before it was sent"
      });
    }
  };
}
