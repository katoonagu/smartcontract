export const ADDRESS_POISONING_INTERVAL_MS = 30_000;

export type StartupWorkLabel =
  | "poll"
  | "where_forensic"
  | "incoming_deposit"
  | "deep_forensic"
  | "address_index"
  | "address_poisoning";

export type StartupDelayConfig = {
  pollStartDelayMs: number;
  forensicWhereStartDelayMs: number;
  forensicIncomingStartDelayMs: number;
  forensicDeepStartDelayMs: number;
  addressIndexStartDelayMs?: number;
};

export type StartupWorkScheduleItem = {
  label: StartupWorkLabel;
  delayMs: number;
};

type StartupTimer = ReturnType<typeof setTimeout>;
type StartupInterval = ReturnType<typeof setInterval>;

export type StartupWorkMap = Record<StartupWorkLabel, () => Promise<void>>;

export type StartupWorkErrorHandler = (eventName: string, error: unknown, label: StartupWorkLabel) => void;

export type StartupWorkScheduleController = {
  startupTimers: StartupTimer[];
  startupIntervals: StartupInterval[];
  stop(): void;
};

export type StartStartupWorkScheduleOptions = {
  schedule: StartupWorkScheduleItem[];
  startupWork: StartupWorkMap;
  intervalByLabel: Record<StartupWorkLabel, number>;
  onError: StartupWorkErrorHandler;
  initialErrorEventByLabel?: Partial<Record<StartupWorkLabel, string>>;
  intervalErrorEventByLabel?: Partial<Record<StartupWorkLabel, string>>;
  setTimeoutFn?: typeof setTimeout;
  setIntervalFn?: typeof setInterval;
  clearTimeoutFn?: typeof clearTimeout;
  clearIntervalFn?: typeof clearInterval;
};

export function buildStartupWorkSchedule(config: StartupDelayConfig): StartupWorkScheduleItem[] {
  return [
    { label: "poll", delayMs: config.pollStartDelayMs },
    { label: "where_forensic", delayMs: config.forensicWhereStartDelayMs },
    { label: "incoming_deposit", delayMs: config.forensicIncomingStartDelayMs },
    { label: "deep_forensic", delayMs: config.forensicDeepStartDelayMs },
    { label: "address_index", delayMs: config.addressIndexStartDelayMs ?? config.forensicDeepStartDelayMs },
    { label: "address_poisoning", delayMs: config.pollStartDelayMs }
  ];
}

export function createNonOverlappingStartupWork(
  work: () => Promise<void>,
  isStopped: () => boolean = () => false
): { run(): Promise<void>; active(): Promise<void> | null } {
  let active: Promise<void> | null = null;
  return {
    run() {
      if (active) return active;
      if (isStopped()) return Promise.resolve();
      let cycle: Promise<void>;
      try {
        cycle = work();
      } catch (error) {
        cycle = Promise.reject(error);
      }
      let cycleWithCleanup: Promise<void>;
      cycleWithCleanup = cycle.finally(() => {
        if (active === cycleWithCleanup) active = null;
      });
      active = cycleWithCleanup;
      return cycleWithCleanup;
    },
    active: () => active
  };
}

export function startStartupWorkSchedule(options: StartStartupWorkScheduleOptions): StartupWorkScheduleController {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const startupTimers: StartupTimer[] = [];
  const startupIntervals: StartupInterval[] = [];

  for (const item of options.schedule) {
    const startupTimer = setTimeoutFn(() => {
      let isInitialRun = true;
      const run = () => {
        const eventName = isInitialRun
          ? options.initialErrorEventByLabel?.[item.label] ?? `${item.label}_cycle_failed`
          : options.intervalErrorEventByLabel?.[item.label] ?? `${item.label}_cycle_failed`;
        isInitialRun = false;
        options.startupWork[item.label]().catch((error) => {
          options.onError(eventName, error, item.label);
        });
      };

      run();
      startupIntervals.push(setIntervalFn(run, options.intervalByLabel[item.label]));
    }, item.delayMs);
    startupTimers.push(startupTimer);
  }

  return {
    startupTimers,
    startupIntervals,
    stop() {
      for (const startupTimer of startupTimers) {
        clearTimeoutFn(startupTimer);
      }
      for (const startupInterval of startupIntervals) {
        clearIntervalFn(startupInterval);
      }
    }
  };
}
