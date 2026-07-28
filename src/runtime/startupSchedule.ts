export const ADDRESS_POISONING_INTERVAL_MS = 30_000;

export type StartupWorkLabel =
  | "poll"
  | "where_forensic"
  | "incoming_deposit"
  | "deep_forensic"
  | "address_index"
  | "address_poisoning";

export const UNIFIED_RESOURCE_WORK_LABELS = [
  "unified_provider_io",
  "unified_indexing",
  "unified_cpu_aggregation",
  "unified_scoring_rendering",
  "unified_delivery",
  "unified_watchdog",
  "unified_lifecycle"
] as const;

export type UnifiedResourceWorkLabel =
  typeof UNIFIED_RESOURCE_WORK_LABELS[number];

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

export type StartUnifiedResourceWorkScheduleOptions = {
  schedule: Array<{ label: UnifiedResourceWorkLabel; delayMs: number }>;
  startupWork: Record<UnifiedResourceWorkLabel, () => Promise<void>>;
  intervalByLabel: Record<UnifiedResourceWorkLabel, number>;
  onError: (eventName: string, error: unknown, label: UnifiedResourceWorkLabel) => void;
  setTimeoutFn?: typeof setTimeout;
  setIntervalFn?: typeof setInterval;
  clearTimeoutFn?: typeof clearTimeout;
  clearIntervalFn?: typeof clearInterval;
};

export function buildUnifiedResourceWorkSchedule(
  startDelayMs: Partial<Record<UnifiedResourceWorkLabel, number>> = {}
): Array<{ label: UnifiedResourceWorkLabel; delayMs: number }> {
  return UNIFIED_RESOURCE_WORK_LABELS.map((label) => ({
    label,
    delayMs: startDelayMs[label] ?? 0
  }));
}

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
      if (active) return Promise.resolve();
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

function startWorkSchedule<Label extends string>(options: {
  schedule: Array<{ label: Label; delayMs: number }>;
  startupWork: Record<Label, () => Promise<void>>;
  intervalByLabel: Record<Label, number>;
  onError: (eventName: string, error: unknown, label: Label) => void;
  initialErrorEventByLabel?: Partial<Record<Label, string>>;
  intervalErrorEventByLabel?: Partial<Record<Label, string>>;
  setTimeoutFn?: typeof setTimeout;
  setIntervalFn?: typeof setInterval;
  clearTimeoutFn?: typeof clearTimeout;
  clearIntervalFn?: typeof clearInterval;
}): StartupWorkScheduleController {
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

export function startStartupWorkSchedule(
  options: StartStartupWorkScheduleOptions
): StartupWorkScheduleController {
  return startWorkSchedule(options);
}

export function startUnifiedResourceWorkSchedule(
  options: StartUnifiedResourceWorkScheduleOptions
): StartupWorkScheduleController {
  const stopped = { value: false };
  const guarded = Object.fromEntries(
    UNIFIED_RESOURCE_WORK_LABELS.map((label) => [
      label,
      createNonOverlappingStartupWork(
        options.startupWork[label],
        () => stopped.value
      ).run
    ])
  ) as Record<UnifiedResourceWorkLabel, () => Promise<void>>;
  const controller = startWorkSchedule({
    ...options,
    startupWork: guarded
  });
  return {
    ...controller,
    stop() {
      stopped.value = true;
      controller.stop();
    }
  };
}
