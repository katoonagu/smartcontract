import { describe, expect, it, vi } from "vitest";
import {
  adminStaticSnapshotHtml,
  type AdminStaticSnapshotPayload
} from "../../src/admin/adminStaticSnapshot";

function snapshotShell(): string {
  return [
    "<!doctype html>",
    "<html>",
    "<body>",
    "<script>",
    '    localStorage.removeItem("adminForensicsLayout");',
    "    function walletIntelligenceActive() {",
    '      return window.location.pathname === "/admin/wallet-intelligence";',
    "    }",
    "</script>",
    "</body>",
    "</html>"
  ].join("\n");
}

describe("adminStaticSnapshotHtml", () => {
  it("injects cached admin API data before the console script runs", () => {
    const payload: AdminStaticSnapshotPayload = {
      generatedAt: "2026-07-08T00:00:00.000Z",
      api: {
        "/admin/api/forensic-jobs?limit=50": {
          status: 200,
          body: { jobs: [{ id: "job-1", subjectAddress: "TSubject" }] }
        },
        "/admin/api/forensic-jobs/job-1/graph": {
          status: 200,
          body: { graph: { job: { id: "job-1" } } }
        }
      },
      assets: {
        "/admin/assets/node-role/drainer.png": "data:image/png;base64,AA=="
      }
    };
    const html = snapshotShell();

    const snapshotHtml = adminStaticSnapshotHtml(html, payload);
    const injectionIndex = snapshotHtml.indexOf("window.__ADMIN_STATIC_SNAPSHOT__");
    const appIndex = snapshotHtml.indexOf('localStorage.removeItem("adminForensicsLayout")');

    expect(injectionIndex).toBeGreaterThan(-1);
    expect(injectionIndex).toBeLessThan(appIndex);
    expect(snapshotHtml).toContain("/admin/api/forensic-jobs?limit=50");
    expect(snapshotHtml).toContain("Static snapshot");
    expect(snapshotHtml).toContain("window.fetch = async (input, init = {}) =>");
    expect(snapshotHtml).toContain('window.__ADMIN_STATIC_WORKSPACE__ === "wallet-intelligence"');
  });

  it("fails loudly if the admin console script marker changes", () => {
    expect(() => adminStaticSnapshotHtml("<html></html>", {
      generatedAt: "2026-07-08T00:00:00.000Z",
      api: {},
      assets: {}
    })).toThrow("Admin console snapshot injection marker not found.");
  });

  it("serves cached API responses when opened from a file URL", async () => {
    const payload: AdminStaticSnapshotPayload = {
      generatedAt: "2026-07-08T00:00:00.000Z",
      api: {
        "/admin/api/forensic-jobs?limit=50": {
          status: 200,
          body: { jobs: [{ id: "job-1" }] }
        }
      },
      assets: {}
    };
    const html = adminStaticSnapshotHtml(snapshotShell(), payload);
    const installBlock = html.match(/window\.__ADMIN_STATIC_SNAPSHOT__ = [\s\S]*?\n    \}\)\(\);/)?.[0] || "";
    const nativeFetch = vi.fn(async () => {
      throw new Error("native fetch should not be called");
    });
    const windowMock = {
      fetch: nativeFetch,
      location: {
        href: "file:///C:/Users/User/OneDrive/Desktop/smartcontract/artifacts/admin-snapshots/snapshot.html"
      }
    };
    const documentMock = {
      addEventListener: vi.fn(),
      getElementById: vi.fn(),
      querySelector: vi.fn()
    };

    const response = await new Function(
      "window",
      "document",
      "Response",
      "URL",
      installBlock + '\nreturn window.fetch("/admin/api/forensic-jobs?limit=50", { headers: {} });'
    )(windowMock, documentMock, Response, URL);

    expect(nativeFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobs: [{ id: "job-1" }] });
  });

  it("serves captured Wallet Intelligence list and detail responses offline", async () => {
    const payload: AdminStaticSnapshotPayload = {
      generatedAt: "2026-07-08T00:00:00.000Z",
      api: {
        "/admin/api/wallet-intelligence/addresses?limit=50&minUniqueSubjects=2": {
          status: 200,
          body: {
            addresses: [
              {
                address: "TWallet111111111111111111111111111111",
                uniqueSubjectCount: 3,
                uniqueRequesterCount: 2,
                minDepth: 1,
                maxDepth: 2,
                distinctAmountRaw: "3000000",
                modes: ["address_deep_check"],
                tags: ["repeated_cross_run_address"],
                serviceCategories: ["cex"]
              },
              {
                address: "TWallet222222222222222222222222222222",
                uniqueSubjectCount: 1,
                uniqueRequesterCount: 1,
                minDepth: 3,
                maxDepth: 4,
                distinctAmountRaw: "1000000",
                modes: ["where_is_money_check"],
                tags: [],
                serviceCategories: []
              }
            ]
          }
        },
        "/admin/api/wallet-intelligence/addresses/TWallet111111111111111111111111111111": {
          status: 200,
          body: {
            detail: {
              summary: {
                address: "TWallet111111111111111111111111111111",
                uniqueSubjectCount: 3,
                uniqueRequesterCount: 2,
                minDepth: 1,
                maxDepth: 2,
                distinctAmountRaw: "3000000",
                modes: ["address_deep_check"],
                tags: ["repeated_cross_run_address"],
                serviceCategories: ["cex"]
              },
              requesters: [{ requestedBy: "client_user", telegramUserId: "42", username: "alice", chatId: "chat-1" }],
              jobs: [{ jobId: "job-1", jobKind: "address_deep_check", jobStatus: "completed", subjectAddress: "TSubject111" }],
              sightings: [],
              edges: []
            }
          }
        }
      },
      assets: {}
    };
    const html = adminStaticSnapshotHtml(snapshotShell(), payload);
    const installBlock = html.match(/window\.__ADMIN_STATIC_SNAPSHOT__ = [\s\S]*?\n    \}\)\(\);/)?.[0] || "";
    const nativeFetch = vi.fn(async () => {
      throw new Error("native fetch should not be called");
    });
    const windowMock = {
      fetch: nativeFetch,
      location: {
        href: "file:///C:/Users/User/OneDrive/Desktop/smartcontract/artifacts/admin-snapshots/snapshot.html",
        protocol: "file:"
      }
    };
    const documentMock = {
      addEventListener: vi.fn(),
      getElementById: vi.fn(),
      querySelector: vi.fn()
    };

    const [listResponse, detailResponse] = await new Function(
      "window",
      "document",
      "Response",
      "URL",
      "Element",
      installBlock + `
return Promise.all([
  window.fetch("/admin/api/wallet-intelligence/addresses?limit=50&minUniqueSubjects=2&serviceCategory=cex"),
  window.fetch("/admin/api/wallet-intelligence/addresses/TWallet111111111111111111111111111111")
]);`
    )(windowMock, documentMock, Response, URL, class Element {});

    expect(nativeFetch).not.toHaveBeenCalled();
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      addresses: [
        expect.objectContaining({
          address: "TWallet111111111111111111111111111111",
          serviceCategories: ["cex"]
        })
      ]
    });
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toEqual({
      detail: expect.objectContaining({
        summary: expect.objectContaining({ address: "TWallet111111111111111111111111111111" })
      })
    });
  });
});
