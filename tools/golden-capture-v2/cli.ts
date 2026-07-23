import { canonicalSha256 } from "../golden-pilot-v2/canonicalJson";
import {
  captureGoldenPilotV2,
  publishGoldenCaptureV2,
  type GoldenCaptureDatabase
} from "./coordinator";
import type { GoldenCaptureInput } from "./capture";

export function parseGoldenCaptureArgs(args: string[]) {
  if (!Array.isArray(args)) {
    throw new TypeError("golden_capture_invalid_arguments");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !["--output", "--cutoff"].includes(flag ?? "") ||
      value === undefined ||
      values.has(flag)
    ) {
      throw new TypeError("golden_capture_invalid_arguments");
    }
    values.set(flag, value);
  }
  const output = values.get("--output");
  const cutoff = values.get("--cutoff");
  if (
    output === undefined ||
    output.length === 0 ||
    (cutoff !== undefined &&
      (Number.isNaN(Date.parse(cutoff)) ||
        new Date(Date.parse(cutoff)).toISOString() !== cutoff))
  ) {
    throw new TypeError("golden_capture_invalid_arguments");
  }
  return { output, cutoff };
}

export async function runGoldenCaptureCli(
  args: string[],
  deps: {
    db: GoldenCaptureDatabase;
    getConfirmedSnapshot(): Promise<{
      snapshot: GoldenCaptureInput["snapshot"];
      rawResponse: unknown;
    }>;
    catalog: GoldenCaptureInput["catalog"];
    syntheticCases: GoldenCaptureInput["syntheticCases"];
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
  }
): Promise<number> {
  try {
    const parsed = parseGoldenCaptureArgs(args);
    const confirmed = await deps.getConfirmedSnapshot();
    const result = await captureGoldenPilotV2({
      db: deps.db,
      getConfirmedSnapshot: async () => confirmed,
      catalog: deps.catalog,
      syntheticCases: deps.syntheticCases,
      selectionCutoff: parsed.cutoff ?? confirmed.snapshot.timestamp
    });
    const artifacts = await publishGoldenCaptureV2(parsed.output, result);
    deps.stdout.write(
      `${JSON.stringify({
        version: "golden-capture-cli-result-v2",
        captureManifestSha256: canonicalSha256(
          result.capture.captureManifest
        ),
        provenanceManifestSha256: canonicalSha256(
          result.provenanceManifest
        ),
        caseCount: result.capture.sources.length,
        artifactCount: artifacts.length
      })}\n`
    );
    return 0;
  } catch (error) {
    const message =
      error instanceof Error && /^[-:a-zA-Z0-9_]+$/u.test(error.message)
        ? error.message
        : "FAILED_TECHNICAL:golden_capture_failed";
    deps.stderr.write(`${message}\n`);
    return 1;
  }
}
