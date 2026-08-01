import { readFile } from "node:fs/promises";

import { canonicalizeArtifactJson } from "../src/forensics/canonicalJson";
import { replayServiceRoleShadowGateV1 } from "../src/forensics/serviceRoleShadowGate";

const root = new URL("../", import.meta.url);
const corpus = JSON.parse(await readFile(new URL("../tests/fixtures/forensics/forensic-model-offline-corpus-v1.json", import.meta.url), "utf8"));
const reconstructedFixture = JSON.parse(await readFile(new URL("../tests/fixtures/forensics/service-role-shadow-reconstruction-v1.json", import.meta.url), "utf8"));
const receipt = replayServiceRoleShadowGateV1({ corpus, reconstructedFixture });
process.stdout.write(`${canonicalizeArtifactJson(receipt)}\n`);
if (receipt.service.numerator !== 24 || receipt.adverse.numerator !== 6 ||
  receipt.cases.length !== 30 || receipt.reconstructedAcceptedHistories < 1 ||
  receipt.mismatches.length > 0) process.exitCode = 1;
