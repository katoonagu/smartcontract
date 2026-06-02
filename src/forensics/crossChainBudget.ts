export type CrossChainProviderName = "range" | "etherscan" | "alchemy" | "layerzero" | "local";

export type CrossChainProviderBudget = {
  run<T>(provider: CrossChainProviderName, key: string, fn: () => Promise<T>): Promise<T>;
  addCoverageNote(note: string): void;
  providerCalls(): number;
  coverageNotes(): string[];
};

const BUDGET_EXHAUSTED_MESSAGE = "Cross-chain provider budget exhausted";

function normalizeMaxProviderCalls(maxProviderCalls: number): number {
  if (!Number.isFinite(maxProviderCalls)) return 0;
  return Math.max(0, Math.floor(maxProviderCalls));
}

export function createCrossChainProviderBudget(input: {
  maxProviderCalls: number;
}): CrossChainProviderBudget {
  const maxProviderCalls = normalizeMaxProviderCalls(input.maxProviderCalls);
  const callsByProvider = new Map<CrossChainProviderName, Map<string, Promise<unknown>>>();
  const notes: string[] = [];
  let providerCallCount = 0;
  let exhaustionNoteAdded = false;

  function addNote(note: string): void {
    const normalized = note.trim();
    if (!normalized || notes.includes(normalized)) return;
    notes.push(normalized);
  }

  function addExhaustionNote(): void {
    if (exhaustionNoteAdded) return;
    addNote(`Cross-chain provider budget exhausted after ${providerCallCount} calls.`);
    exhaustionNoteAdded = true;
  }

  return {
    run<T>(provider: CrossChainProviderName, key: string, fn: () => Promise<T>): Promise<T> {
      const providerCalls = callsByProvider.get(provider);
      const cached = providerCalls?.get(key);
      if (cached) return cached as Promise<T>;

      if (providerCallCount >= maxProviderCalls) {
        addExhaustionNote();
        return Promise.reject(new Error(BUDGET_EXHAUSTED_MESSAGE));
      }

      providerCallCount += 1;
      const calls = providerCalls ?? new Map<string, Promise<unknown>>();
      const promise = Promise.resolve()
        .then(fn)
        .catch((error: unknown) => {
          calls.delete(key);
          throw error;
        });
      calls.set(key, promise);
      callsByProvider.set(provider, calls);
      return promise;
    },

    addCoverageNote(note: string): void {
      addNote(note);
    },

    providerCalls(): number {
      return providerCallCount;
    },

    coverageNotes(): string[] {
      return [...notes];
    }
  };
}
