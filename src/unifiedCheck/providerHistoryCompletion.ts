import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type { DirectHistoryPage } from "./directHistory";

type CachedPinnedPageProjection = {
  readonly cursor: string | null;
  readonly provider: unknown;
  readonly transfers: unknown;
  readonly nextOffset: unknown;
  readonly completionReason?: unknown;
  readonly metadataConsistent: unknown;
};

export function providerHistoryPage(
  input: CachedPinnedPageProjection
): DirectHistoryPage {
  if (
    input.provider !== "tronscan" &&
    input.provider !== "trongrid_fallback"
  ) {
    throw new Error("unified_direct_history_cached_page_invalid");
  }
  if (
    !Array.isArray(input.transfers) ||
    typeof input.nextOffset !== "number" ||
    !Number.isSafeInteger(input.nextOffset) ||
    input.nextOffset < 0 ||
    (
      input.completionReason !== "more" &&
      input.completionReason !== "range_exhausted" &&
      input.completionReason !== "provider_range_capped"
    ) ||
    input.metadataConsistent !== true
  ) {
    throw new Error("unified_direct_history_cached_page_invalid");
  }
  if (input.completionReason === "provider_range_capped") {
    throw new Error("unified_direct_history_provider_range_capped");
  }

  const reachedAccountCreation = input.completionReason === "range_exhausted";
  const content: Omit<DirectHistoryPage, "pageHash"> = {
    kind: "page" as const,
    cursor: input.cursor,
    nextCursor: reachedAccountCreation ? null : String(input.nextOffset),
    transfers: input.transfers,
    reachedAccountCreation,
    provider: input.provider
  };
  return {
    ...content,
    pageHash: fingerprintCanonicalArtifact(content)
  };
}
