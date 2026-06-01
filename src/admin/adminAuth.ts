export type AdminAuthResult =
  | { ok: true }
  | { ok: false; statusCode: 401 | 503; message: string };

export function authorizeAdminRequest(
  authorizationHeader: string | string[] | undefined,
  expectedToken: string | null
): AdminAuthResult {
  if (!expectedToken) {
    return { ok: false, statusCode: 503, message: "Admin dashboard token is not configured." };
  }

  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) {
    return { ok: false, statusCode: 401, message: "Admin authorization required." };
  }

  const token = header.slice(prefix.length);
  if (token !== expectedToken) {
    return { ok: false, statusCode: 401, message: "Admin authorization required." };
  }

  return { ok: true };
}
