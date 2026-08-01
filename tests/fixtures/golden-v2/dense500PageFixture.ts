import type { AttributionInput } from "../../../tools/golden-pilot-v2/attribution";

const PAGE_COUNT = 500;
const EVENTS_PER_PAGE = 200;
const EVENT_AMOUNT_RAW = 1_000_000n;

export function dense500PageAttributionInput(): AttributionInput {
  const eventCount = PAGE_COUNT * EVENTS_PER_PAGE;
  const startedAt = Date.parse("2026-01-01T00:00:00.000Z");
  return {
    selectedAmountRaw: (
      (BigInt(eventCount) * EVENT_AMOUNT_RAW) /
      2n
    ).toString(),
    inbound: Array.from({ length: eventCount }, (_, index) => {
      const page = Math.floor(index / EVENTS_PER_PAGE);
      const event = index % EVENTS_PER_PAGE;
      return {
        eventId: `page-${page.toString().padStart(3, "0")}-event-${event
          .toString()
          .padStart(3, "0")}`,
        amountRaw: EVENT_AMOUNT_RAW.toString(),
        timestamp: new Date(startedAt + index * 1_000).toISOString()
      };
    })
  };
}
