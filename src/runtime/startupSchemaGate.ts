import type { Schema032Verification } from "../storage/schemaMigrations";

export async function runStartupSchemaGate(input: {
  verify: () => Promise<Schema032Verification>;
  onVerified: (verification: Schema032Verification) => void;
}): Promise<Schema032Verification> {
  const verification = await input.verify();
  input.onVerified(verification);
  return verification;
}
