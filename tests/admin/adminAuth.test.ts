import { describe, expect, it } from "vitest";
import { authorizeAdminRequest } from "../../src/admin/adminAuth";

describe("authorizeAdminRequest", () => {
  it("rejects requests when dashboard token is not configured", () => {
    expect(authorizeAdminRequest(undefined, null)).toEqual({
      ok: false,
      statusCode: 503,
      message: "Admin dashboard token is not configured."
    });
  });

  it("accepts a matching bearer token", () => {
    expect(authorizeAdminRequest("Bearer secret-token", "secret-token")).toEqual({ ok: true });
  });

  it("rejects missing or wrong bearer tokens", () => {
    expect(authorizeAdminRequest(undefined, "secret-token")).toMatchObject({ ok: false, statusCode: 401 });
    expect(authorizeAdminRequest("Bearer wrong", "secret-token")).toMatchObject({ ok: false, statusCode: 401 });
    expect(authorizeAdminRequest("Basic secret-token", "secret-token")).toMatchObject({ ok: false, statusCode: 401 });
  });
});
