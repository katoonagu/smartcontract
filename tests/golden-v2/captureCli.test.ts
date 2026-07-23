import { describe, expect, test } from "vitest";
import { parseGoldenCaptureArgs } from "../../tools/golden-capture-v2/cli";

describe("golden capture CLI", () => {
  test("requires one output and accepts an explicit UTC cutoff", () => {
    expect(
      parseGoldenCaptureArgs([
        "--output",
        "artifacts/golden-v2-2026-07",
        "--cutoff",
        "2026-07-23T12:00:00.000Z"
      ])
    ).toEqual({
      output: "artifacts/golden-v2-2026-07",
      cutoff: "2026-07-23T12:00:00.000Z"
    });
  });

  test.each([
    { args: [] },
    { args: ["--output", "a", "--output", "b"] },
    { args: ["--unknown", "a"] },
    { args: ["--output", "a", "--cutoff", "not-a-date"] },
    { args: ["--output"] }
  ])("rejects invalid arguments without including values: $args", ({ args }) => {
    expect(() => parseGoldenCaptureArgs(args)).toThrow(
      "golden_capture_invalid_arguments"
    );
  });
});
