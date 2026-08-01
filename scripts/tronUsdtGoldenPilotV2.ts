import { runGoldenPilotCli } from "../tools/golden-pilot-v2/cli";

const exitCode = await runGoldenPilotCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr
});
process.exitCode = exitCode;
