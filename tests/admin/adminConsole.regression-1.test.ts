import { describe, expect, it } from "vitest";
import { adminConsoleHtml } from "../../src/admin/adminConsole";

describe("adminConsoleHtml explorer link regression", () => {
  it("keeps external explorer links from replacing the admin console tab", () => {
    // Regression: ISSUE-001 - transfer table Tronscan links navigated the admin tab.
    // Found by /qa on 2026-06-22.
    // Report: .gstack/qa-reports/qa-report-admin-forensics-2026-06-22.md
    const html = adminConsoleHtml();

    expect(html).toContain('data-explorer-link="true"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('event.target instanceof Element ? event.target.closest("[data-explorer-link]") : null');
    expect(html).toContain('event.preventDefault();');
    expect(html).toContain('window.open(anchor.href, "_blank", "noopener,noreferrer");');
  });
});
