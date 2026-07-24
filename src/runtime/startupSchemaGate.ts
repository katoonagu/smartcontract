import type { Schema034Verification } from "../storage/schemaMigrations";

export async function runStartupSchemaGate(input: {
  verify: () => Promise<Schema034Verification>;
  onVerified: (verification: Schema034Verification) => void;
}): Promise<Schema034Verification> {
  const verification = await input.verify();
  input.onVerified(verification);
  return verification;
}
