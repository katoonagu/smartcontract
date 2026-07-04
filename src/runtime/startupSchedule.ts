export type StartupWorkLabel = "poll" | "where_forensic" | "incoming_deposit" | "deep_forensic" | "address_index";

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
    { label: "address_index", delayMs: config.addressIndexStartDelayMs ?? config.forensicDeepStartDelayMs }
  ];
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
