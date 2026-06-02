import { startAdminServer, type RunningAdminServer } from "./adminServer";
import type { AppConfig } from "../config";
import type { ForensicCheckJob, ForensicCheckJobKind, ForensicCheckJobStatus } from "../storage/repositories";

export type AdminRuntimeDeps = {
  config: Pick<AppConfig, "adminDashboardEnabled" | "adminDashboardHost" | "adminDashboardPort" | "adminDashboardToken">;
  startAdminServer?: typeof startAdminServer;
  listJobs(input: {
    limit?: number;
    offset?: number;
    status?: ForensicCheckJobStatus;
    kind?: ForensicCheckJobKind;
    subjectAddress?: string;
  }): Promise<ForensicCheckJob[]>;
  getJob(id: string): Promise<ForensicCheckJob | null>;
};

export async function maybeStartAdminDashboard(deps: AdminRuntimeDeps): Promise<RunningAdminServer | null> {
  if (!deps.config.adminDashboardEnabled) return null;
  if (!deps.config.adminDashboardToken) {
    throw new Error("ADMIN_DASHBOARD_TOKEN is required when ADMIN_DASHBOARD_ENABLED=true");
  }
  return (deps.startAdminServer ?? startAdminServer)({
    config: {
      host: deps.config.adminDashboardHost,
      port: deps.config.adminDashboardPort,
      token: deps.config.adminDashboardToken
    },
    listJobs: deps.listJobs,
    getJob: deps.getJob
  });
}
