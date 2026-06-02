import { describe, expect, it, vi } from "vitest";
import { maybeStartAdminDashboard } from "../../src/admin/adminRuntime";

describe("maybeStartAdminDashboard", () => {
  it("does not start when disabled", async () => {
    const start = vi.fn();
    const server = await maybeStartAdminDashboard({
      config: {
        adminDashboardEnabled: false,
        adminDashboardHost: "127.0.0.1",
        adminDashboardPort: 8787,
        adminDashboardToken: null
      },
      startAdminServer: start,
      listJobs: async () => [],
      getJob: async () => null
    });

    expect(server).toBe(null);
    expect(start).not.toHaveBeenCalled();
  });

  it("throws when enabled without a token", async () => {
    await expect(maybeStartAdminDashboard({
      config: {
        adminDashboardEnabled: true,
        adminDashboardHost: "127.0.0.1",
        adminDashboardPort: 8787,
        adminDashboardToken: null
      },
      startAdminServer: vi.fn(),
      listJobs: async () => [],
      getJob: async () => null
    })).rejects.toThrow("ADMIN_DASHBOARD_TOKEN");
  });
});
