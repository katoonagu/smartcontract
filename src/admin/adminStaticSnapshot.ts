export type AdminStaticSnapshotResponse = {
  status: number;
  body: unknown;
};

export type AdminStaticSnapshotPayload = {
  generatedAt: string;
  api: Record<string, AdminStaticSnapshotResponse>;
  assets: Record<string, string>;
};

const injectionMarker = '    localStorage.removeItem("adminForensicsLayout");';
const walletWorkspaceMarker = '      return window.location.pathname === "/admin/wallet-intelligence";';
const staticWalletWorkspaceCheck = '      return window.__ADMIN_STATIC_WORKSPACE__ === "wallet-intelligence" || window.location.pathname === "/admin/wallet-intelligence";';

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function installScript(payload: AdminStaticSnapshotPayload): string {
  return `    window.__ADMIN_STATIC_SNAPSHOT__ = ${scriptJson(payload)};
    (function installAdminStaticSnapshot() {
      const snapshot = window.__ADMIN_STATIC_SNAPSHOT__ || { api: {}, assets: {}, generatedAt: "" };
      const originalFetch = window.fetch.bind(window);
      const api = new Map(Object.entries(snapshot.api || {}));
      const capturedJobs = new Map();
      const capturedWalletAddresses = new Map();
      const capturedWalletDetails = new Map();
      for (const entry of api.values()) {
        const jobs = Array.isArray(entry?.body?.jobs) ? entry.body.jobs : [];
        for (const job of jobs) if (job?.id) capturedJobs.set(job.id, job);
      }
      for (const [key, entry] of api.entries()) {
        const addresses = Array.isArray(entry?.body?.addresses) ? entry.body.addresses : [];
        for (const item of addresses) if (item?.address) capturedWalletAddresses.set(item.address, item);
        const detail = entry?.body?.detail;
        if (detail?.summary?.address) {
          capturedWalletDetails.set(detail.summary.address, detail);
          capturedWalletAddresses.set(detail.summary.address, detail.summary);
        }
      }
      window.__ADMIN_STATIC_WORKSPACE__ = window.__ADMIN_STATIC_WORKSPACE__ || "forensics";
      function snapshotKey(input) {
        const raw = typeof input === "string" ? input : input?.url || String(input || "");
        const url = new URL(raw, window.location.href);
        let path = url.pathname;
        const adminApiIndex = path.indexOf("/admin/api/");
        if (adminApiIndex > 0) path = path.slice(adminApiIndex);
        return path + url.search;
      }
      function response(status, body) {
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
        });
      }
      function filteredJobs(key) {
        if (!key.startsWith("/admin/api/forensic-jobs?")) return null;
        const url = new URL(key, window.location.href);
        const status = url.searchParams.get("status") || "";
        const kind = url.searchParams.get("kind") || "";
        const query = (url.searchParams.get("query") || url.searchParams.get("q") || "").toLowerCase();
        const subjectAddress = (url.searchParams.get("subjectAddress") || "").toLowerCase();
        const limit = Math.max(Number(url.searchParams.get("limit") || "50") || 50, 0);
        const offset = Math.max(Number(url.searchParams.get("offset") || "0") || 0, 0);
        const jobs = Array.from(capturedJobs.values()).filter((job) => {
          if (status && job.status !== status) return false;
          if (kind && job.kind !== kind) return false;
          if (subjectAddress && String(job.subjectAddress || "").toLowerCase() !== subjectAddress) return false;
          if (!query) return true;
          return [job.id, job.subjectAddress, job.sender, job.watchedWallet, job.depositTxHash]
            .some((value) => String(value || "").toLowerCase().includes(query));
        });
        return { status: 200, body: { jobs: jobs.slice(offset, offset + limit) } };
      }
      function numberParam(url, key) {
        const raw = url.searchParams.get(key);
        if (!raw) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
      }
      function rawAmountMatches(value, minRaw, maxRaw) {
        try {
          const amount = BigInt(String(value || "0"));
          if (minRaw && amount < BigInt(minRaw)) return false;
          if (maxRaw && amount > BigInt(maxRaw)) return false;
          return true;
        } catch {
          return false;
        }
      }
      function textMatch(value, query) {
        return String(value || "").toLowerCase().includes(query);
      }
      function detailForWalletAddress(address) {
        return capturedWalletDetails.get(address) || null;
      }
      function walletDetailResponse(key) {
        const match = /^\\/admin\\/api\\/wallet-intelligence\\/addresses\\/([^?]+)$/.exec(key);
        if (!match) return null;
        let address = "";
        try {
          address = decodeURIComponent(match[1]);
        } catch {
          return { status: 400, body: { error: "Invalid wallet intelligence address." } };
        }
        const detail = detailForWalletAddress(address);
        return detail
          ? { status: 200, body: { detail } }
          : { status: 404, body: { error: "This wallet intelligence address was not captured in the static snapshot." } };
      }
      function filteredWalletAddresses(key) {
        if (!key.startsWith("/admin/api/wallet-intelligence/addresses?")) return null;
        const url = new URL(key, window.location.href);
        const addressQuery = (url.searchParams.get("address") || url.searchParams.get("q") || "").toLowerCase();
        const mode = url.searchParams.get("mode") || "";
        const tag = url.searchParams.get("tag") || "";
        const requester = (url.searchParams.get("requester") || "").toLowerCase();
        const subjectAddress = (url.searchParams.get("subjectAddress") || "").toLowerCase();
        const serviceCategory = (url.searchParams.get("serviceCategory") || "").toLowerCase();
        const jobStatus = url.searchParams.get("jobStatus") || "";
        const minUniqueSubjects = numberParam(url, "minUniqueSubjects");
        const minUniqueRequesters = numberParam(url, "minUniqueRequesters");
        const minDepth = numberParam(url, "minDepth");
        const maxDepth = numberParam(url, "maxDepth");
        const minDistinctAmountRaw = url.searchParams.get("minDistinctAmountRaw") || "";
        const maxDistinctAmountRaw = url.searchParams.get("maxDistinctAmountRaw") || "";
        const limit = Math.max(Number(url.searchParams.get("limit") || "50") || 50, 0);
        const offset = Math.max(Number(url.searchParams.get("offset") || "0") || 0, 0);
        const addresses = Array.from(capturedWalletAddresses.values()).filter((item) => {
          const detail = detailForWalletAddress(item.address);
          if (addressQuery && !textMatch(item.address, addressQuery)) return false;
          if (mode && (!Array.isArray(item.modes) || !item.modes.includes(mode))) return false;
          if (tag && (!Array.isArray(item.tags) || !item.tags.includes(tag))) return false;
          if (serviceCategory && (!Array.isArray(item.serviceCategories) || !item.serviceCategories.some((value) => textMatch(value, serviceCategory)))) return false;
          if (minUniqueSubjects !== null && Number(item.uniqueSubjectCount || 0) < minUniqueSubjects) return false;
          if (minUniqueRequesters !== null && Number(item.uniqueRequesterCount || 0) < minUniqueRequesters) return false;
          if (minDepth !== null && Number(item.minDepth || 0) < minDepth) return false;
          if (maxDepth !== null && Number(item.maxDepth || 0) > maxDepth) return false;
          if ((minDistinctAmountRaw || maxDistinctAmountRaw) && !rawAmountMatches(item.distinctAmountRaw, minDistinctAmountRaw, maxDistinctAmountRaw)) return false;
          if (subjectAddress) {
            const inJobs = Array.isArray(detail?.jobs) && detail.jobs.some((job) => textMatch(job?.subjectAddress, subjectAddress));
            const inSightings = Array.isArray(detail?.sightings) && detail.sightings.some((sighting) => textMatch(sighting?.subjectAddress, subjectAddress));
            if (!inJobs && !inSightings) return false;
          }
          if (requester) {
            const inRequesters = Array.isArray(detail?.requesters) && detail.requesters.some((entry) =>
              [entry?.requestedBy, entry?.telegramUserId, entry?.username, entry?.chatId].some((value) => textMatch(value, requester))
            );
            if (!inRequesters) return false;
          }
          if (jobStatus) {
            const hasStatus = Array.isArray(detail?.jobs) && detail.jobs.some((job) => job?.jobStatus === jobStatus);
            if (!hasStatus) return false;
          }
          return true;
        });
        return { status: 200, body: { addresses: addresses.slice(offset, offset + limit) } };
      }
      document.addEventListener("click", (event) => {
        const link = event.target instanceof Element ? event.target.closest("[data-workspace-link]") : null;
        if (!link || window.location.protocol !== "file:") return;
        event.preventDefault();
        const href = link.getAttribute("href") || "";
        window.__ADMIN_STATIC_WORKSPACE__ = href.includes("wallet-intelligence") ? "wallet-intelligence" : "forensics";
        const minSubjects = document.getElementById("walletIntelMinSubjects");
        if (window.__ADMIN_STATIC_WORKSPACE__ === "wallet-intelligence" && minSubjects && !minSubjects.value) minSubjects.value = "2";
        document.getElementById("load")?.click();
      }, true);
      window.fetch = async (input, init = {}) => {
        const method = String(init?.method || input?.method || "GET").toUpperCase();
        if (method !== "GET") return response(405, { error: "Static snapshot is read-only." });
        const key = snapshotKey(input);
        const hit = api.get(key) || filteredJobs(key) || walletDetailResponse(key) || filteredWalletAddresses(key);
        if (hit) return response(hit.status, hit.body);
        if (key.startsWith("/admin/api/")) {
          return response(404, { error: "This endpoint was not captured in the static snapshot." });
        }
        return originalFetch(input, init);
      };
      document.addEventListener("DOMContentLoaded", () => {
        const session = document.getElementById("sessionState");
        if (session) session.textContent = "static snapshot";
        const brand = document.querySelector(".brand");
        if (brand && snapshot.generatedAt) {
          const pill = document.createElement("span");
          pill.className = "session-pill";
          pill.textContent = "Static snapshot " + new Date(snapshot.generatedAt).toLocaleString();
          brand.appendChild(pill);
        }
      });
    })();`;
}

export function adminStaticSnapshotHtml(html: string, payload: AdminStaticSnapshotPayload): string {
  if (!html.includes(injectionMarker)) {
    throw new Error("Admin console snapshot injection marker not found.");
  }
  if (!html.includes(walletWorkspaceMarker)) {
    throw new Error("Admin console wallet workspace marker not found.");
  }

  let output = html.replace(walletWorkspaceMarker, staticWalletWorkspaceCheck);
  for (const [path, dataUri] of Object.entries(payload.assets)) {
    output = output.split(`"${path}"`).join(`"${dataUri}"`);
  }

  return output.replace(injectionMarker, `${installScript(payload)}\n${injectionMarker}`);
}
