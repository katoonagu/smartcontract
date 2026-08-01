export type ForensicSlotPump = {
  poll(): Promise<void>;
  diagnostics(): {
    activeSlots: number;
    configuredSlots: number;
    occupiedSlotsAtPoll: number;
    stopping: boolean;
  };
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
  let timerPollRequested = false;
  let stopping = false;
  let occupiedSlotsAtPoll = 0;

  const reportError = (error: unknown): void => {
    try {
      input.onHandlerError(error);
    } catch {
      // ponytail: diagnostics must not strand a capacity slot.
    }
  };

  const requestPump = (): Promise<void> => {
    if (stopping) return activePumpPoll ?? Promise.resolve();
    if (activePumpPoll) return activePumpPoll;

    activePumpPoll = (async () => {
      while ((timerPollRequested || refillRequested) && !stopping) {
        if (timerPollRequested) {
          timerPollRequested = false;
          occupiedSlotsAtPoll = activeHandlers.size;
          await input.beforePoll();
          refillRequested = true;
        }
        if (!refillRequested) continue;

        refillRequested = false;
        while (activeHandlers.size < input.concurrency && !stopping) {
          const job = await input.claimOne();
          if (job === null) break;

          let handler!: Promise<void>;
          handler = Promise.resolve()
            .then(() => input.runClaimed(job))
            .catch(reportError)
            .finally(() => {
              activeHandlers.delete(handler);
              if (stopping) return;
              refillRequested = true;
              void requestPump().catch(reportError);
            });
          activeHandlers.add(handler);
        }
      }
    })().finally(() => {
      activePumpPoll = null;
      if ((timerPollRequested || refillRequested) && !stopping) {
        void requestPump().catch(reportError);
      }
    });
    return activePumpPoll;
  };

  return {
    poll(): Promise<void> {
      if (stopping) return Promise.resolve();
      if (activeTimerPoll) return activeTimerPoll;
      timerPollRequested = true;
      activeTimerPoll = requestPump().finally(() => {
        activeTimerPoll = null;
      });
      return activeTimerPoll;
    },
    diagnostics: () => ({
      activeSlots: activeHandlers.size,
      configuredSlots: input.concurrency,
      occupiedSlotsAtPoll,
      stopping
    }),
    async stopAndDrain(): Promise<void> {
      stopping = true;
      refillRequested = false;
      timerPollRequested = false;
      await activeTimerPoll;
      await activePumpPoll;
      await Promise.all([...activeHandlers]);
    }
  };
}
