import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(
  import.meta.dirname,
  "..",
  "..",
  "tools",
  "golden-pilot-v2"
);

const forbidden = [
  /(^|\/)src\//u,
  /\bpg\b/u,
  /dotenv/u,
  /tronClient/u,
  /repositories/u,
  /scoringSignalMatrix/u,
  /forensicResultRenderer/u
];
const forbiddenNetworkImports = new Set([
  "node:http",
  "node:https",
  "node:net"
]);

async function typescriptFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await typescriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      result.push(path);
    }
  }
  return result;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticImport =
    /(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gu;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const expression of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(expression)) {
      specifiers.push(match[1]!);
    }
  }
  return specifiers;
}

describe("Golden V2 package isolation", () => {
  it("has no production, database or network dependency path", async () => {
    const violations: string[] = [];
    for (const file of await typescriptFiles(packageRoot)) {
      const source = await readFile(file, "utf8");
      const displayPath = relative(packageRoot, file).replaceAll("\\", "/");
      for (const specifier of importSpecifiers(source)) {
        if (
          forbidden.some((pattern) => pattern.test(specifier)) ||
          forbiddenNetworkImports.has(specifier)
        ) {
          violations.push(`${displayPath}:import:${specifier}`);
        }
      }
      if (/\bfetch\s*\(/u.test(source)) {
        violations.push(`${displayPath}:runtime:fetch`);
      }
      if (/\bDATABASE_URL\b/u.test(source)) {
        violations.push(`${displayPath}:runtime:DATABASE_URL`);
      }
    }
    expect(violations).toEqual([]);
  });
});
