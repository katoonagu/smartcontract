import { readFileSync } from "node:fs";
import type { ForensicModelOfflineCorpusV1 } from "../../../src/forensics/chronologicalLedgerCorpusReplay.js";

const FIXTURE = new URL("./forensic-model-offline-corpus-v1.json", import.meta.url);

export function loadForensicModelOfflineCorpusV1(): ForensicModelOfflineCorpusV1 {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== "forensic-model-offline-corpus-v1" ||
    !Array.isArray((parsed as Record<string, unknown>).ledgerCases) ||
    !Array.isArray((parsed as Record<string, unknown>).serviceCases) ||
    !Array.isArray((parsed as Record<string, unknown>).adverseCases)
  ) throw new TypeError("offline_corpus_schema_invalid");
  return parsed as ForensicModelOfflineCorpusV1;
}

export type { ForensicModelOfflineCorpusV1 };
