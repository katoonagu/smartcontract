export type ForensicSlotPump = {
  poll(): Promise<void>;
  diagnostics(): { activeSlots: number; configuredSlots: number; stopping: boolean };
  stopAndDrain(): Promise<void>;
};

export function createForensicSlotPump<Job>(input: {
  concurrency: number;
  beforePoll(): Promise<void>;
  claimOne(): Promise<Job | null>;
  runClaimed(job: Job): Promise<void>;
  onHandlerError(error: unknown): void;
}): ForensicSlotPump {
  if (!Number.isSafeInteger(input.concurrency) || input.concurrency < 1) {
    throw new Error("forensic_slot_pump_concurrency_must_be_positive_integer");
  }

  const activeHandlers = new Set<Promise<void>>();
  let activePumpPoll: Promise<void> | null = null;
  let activeTimerPoll: Promise<void> | null = null;
  let refillRequested = false;
  let stopping = false;

  const requestRefill = (): Promise<void> => {
    if (stopping) return activePumpPoll ?? Promise.resolve();
    refillRequested = true;
    if (activePumpPoll) return activePumpPoll;

    activePumpPoll = (async () => {
      while (refillRequested && !stopping) {
        refillRequested = false;
        while (activeHandlers.size < input.concurrency && !stopping) {
          const job = await input.claimOne();
          if (job === null) break;

          let handler!: Promise<void>;
          handler = Promise.resolve()
            .then(() => input.runClaimed(job))
            .catch((error) => {
              try {
                input.onHandlerError(error);
              } catch {
                // ponytail: diagnostics must not strand a capacity slot.
              }
            })
            .finally(() => {
              activeHandlers.delete(handler);
              void requestRefill();
            });
          activeHandlers.add(handler);
        }
      }
    })().finally(() => {
      activePumpPoll = null;
      if (refillRequested && !stopping) void requestRefill();
    });
    return activePumpPoll;
  };

  return {
    poll(): Promise<void> {
      if (stopping) return Promise.resolve();
      if (activeTimerPoll) return activeTimerPoll;
      activeTimerPoll = (async () => {
        await input.beforePoll();
        if (stopping) return;
        await requestRefill();
      })().finally(() => {
        activeTimerPoll = null;
      });
      return activeTimerPoll;
    },
    diagnostics: () => ({
      activeSlots: activeHandlers.size,
      configuredSlots: input.concurrency,
      stopping
    }),
    async stopAndDrain(): Promise<void> {
      stopping = true;
      refillRequested = false;
      await activeTimerPoll;
      await activePumpPoll;
      await Promise.all([...activeHandlers]);
    }
  };
}
