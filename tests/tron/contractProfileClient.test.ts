import { describe, expect, it, vi } from "vitest";
import { TronscanClient } from "../../src/tron/tronClient";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function statusResponse(status: number): Response {
  return new Response(JSON.stringify({ error: String(status) }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("TronscanClient contract intelligence profile", () => {
  it("fetches contract search, detail, and top_call into one normalized profile", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === "/api/contracts") {
        return jsonResponse({
          data: [
            {
              address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
              name: "Bridgers",
              tag1: "Bridgers:Cross-chain Bridge",
              publicTag: "Bridgers:Cross-chain Bridge",
              verify_status: 2,
              date_created: 1721486160000,
              trxCount: 4380107,
              risk: false
            }
          ]
        });
      }
      if (url.pathname === "/api/contract") {
        return jsonResponse({
          data: [
            {
              address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
              name: "Bridgers",
              tag1: "Bridgers:Cross-chain Bridge",
              publicTag: "Bridgers:Cross-chain Bridge",
              verify_status: 2,
              feedbackRisk: false,
              methodMap: {
                d9caed12: "withdraw(address,address,uint256)",
                "9ddf93bb": "swap(address,string,string,uint256,uint256)"
              },
              trxCount: 4380107,
              date_created: 1721486160000
            }
          ]
        });
      }
      return jsonResponse({
        totalAddress: 45552,
        totalCallTimes: 224309,
        topMethods: [
          { methodId: "d9caed12", times: 85070, ratio: 0.3793 },
          { methodId: "9ddf93bb", times: 61958, ratio: 0.2762 }
        ],
        topAddress: [{ address: "TCaller11111111111111111111111111111", count: 136656, ratio: 0.6092 }]
      });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const profile = await client.getContractIntelligenceProfile("TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s", {
      now: new Date("2026-05-23T00:00:00.000Z")
    });

    expect(fetchFn.mock.calls.map(([url]) => (url as URL).pathname)).toEqual([
      "/api/contracts",
      "/api/contract",
      "/api/contracts/top_call"
    ]);
    expect(profile).toMatchObject({
      name: "Bridgers",
      serviceTag: "Bridgers:Cross-chain Bridge",
      publicTag: "Bridgers:Cross-chain Bridge",
      verified: true,
      providerRisk: false,
      trxCount: "4380107",
      totalCallCount: "224309",
      uniqueCallerCount: "45552",
      activityLevel: "high"
    });
    expect(profile.topMethods[0]).toMatchObject({
      method: "withdraw(address,address,uint256)",
      calls: 85070,
      percentage: 0.3793
    });
  });

  it("keeps tokenApprove-like low metadata visible as transferFrom capable", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === "/api/contracts") {
        return jsonResponse({
          data: [
            {
              address: "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5",
              name: "tokenApprove",
              tag1: "",
              verify_status: 0,
              trxCount: 2,
              risk: false
            }
          ]
        });
      }
      if (url.pathname === "/api/contract") {
        return jsonResponse({
          data: [
            {
              address: "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5",
              name: "tokenApprove",
              verify_status: 0,
              methodMap: {},
              bytecode: "23b872dd TokenApprove: No Access"
            }
          ]
        });
      }
      return jsonResponse({ topMethods: [], topAddress: [] });
    });
    const client = new TronscanClient({ baseUrl: "https://apilist.tronscanapi.com", fetchFn });

    const profile = await client.getContractIntelligenceProfile("TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5");

    expect(profile).toMatchObject({
      name: "tokenApprove",
      serviceTag: null,
      verified: false,
      hasTransferFromSelector: true,
      hasOwnerOnlyPattern: true,
      lowMetadata: true
    });
  });

  it("throws transient profile failures in requireComplete mode instead of returning partial data", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === "/api/contracts") {
        return jsonResponse({
          data: [{ address: "TContract", name: "GasFree Account", tag1: "GasFree Account" }]
        });
      }
      if (url.pathname === "/api/contract") {
        return jsonResponse({ data: [{ address: "TContract", methodMap: {} }] });
      }
      return statusResponse(429);
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 1,
      retryBaseDelayMs: 1,
      rateLimitCooldownMs: 1
    });

    await expect(client.getContractIntelligenceProfile("TContract", { requireComplete: true }))
      .rejects.toThrow("429");
  });

  it("keeps best-effort partial profile behavior by default for transient top_call failures", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === "/api/contracts") {
        return jsonResponse({
          data: [{ address: "TContract", name: "GasFree Account", tag1: "GasFree Account" }]
        });
      }
      if (url.pathname === "/api/contract") {
        return jsonResponse({ data: [{ address: "TContract", methodMap: {} }] });
      }
      return statusResponse(429);
    });
    const client = new TronscanClient({
      baseUrl: "https://apilist.tronscanapi.com",
      fetchFn,
      retryAttempts: 1,
      retryBaseDelayMs: 1,
      rateLimitCooldownMs: 1
    });

    const profile = await client.getContractIntelligenceProfile("TContract");

    expect(profile).toMatchObject({
      name: "GasFree Account",
      serviceTag: "GasFree Account"
    });
  });
});
