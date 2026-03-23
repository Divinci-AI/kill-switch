import { describe, it, expect, vi, beforeEach } from "vitest";
import { cloudflareProvider } from "../../src/providers/cloudflare/checker.js";
import type { DecryptedCredential, ThresholdConfig } from "../../src/providers/types.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const credential: DecryptedCredential = {
  provider: "cloudflare",
  apiToken: "test-token-abc123",
  accountId: "test-account-id",
};

const defaultThresholds: ThresholdConfig = {
  doRequestsPerDay: 1_000_000,
  doWalltimeHoursPerDay: 100,
  workerRequestsPerDay: 10_000_000,
};

function mockGraphQLResponse(doGroups: any[], workerGroups: any[] = []) {
  let callCount = 0;
  mockFetch.mockImplementation(async (url: string, options: any) => {
    const body = JSON.parse(options?.body || "{}");
    const query = body.query || "";

    if (query.includes("durableObjects")) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: {
            viewer: {
              accounts: [{
                durableObjectsInvocationsAdaptiveGroups: doGroups,
              }],
            },
          },
        }),
      };
    }

    if (query.includes("workersInvocations")) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: {
            viewer: {
              accounts: [{
                workersInvocationsAdaptive: workerGroups,
              }],
            },
          },
        }),
      };
    }

    return { ok: true, text: async () => "{}" };
  });
}

describe("Cloudflare Provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkUsage", () => {
    it("returns empty results when no services have usage", async () => {
      mockGraphQLResponse([], []);
      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      expect(result.provider).toBe("cloudflare");
      expect(result.accountId).toBe("test-account-id");
      expect(result.services).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
      expect(result.totalEstimatedDailyCostUSD).toBe(0);
    });

    it("detects DO request threshold violations", async () => {
      mockGraphQLResponse([
        {
          dimensions: { scriptName: "runaway-worker" },
          sum: { requests: 5_000_000, wallTime: 100_000_000 }, // 5M requests, 100s walltime
        },
      ]);

      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].serviceName).toBe("runaway-worker");
      expect(result.violations[0].metricName).toBe("DO Requests");
      expect(result.violations[0].currentValue).toBe(5_000_000);
      expect(result.violations[0].threshold).toBe(1_000_000);
    });

    it("detects DO wall-time threshold violations", async () => {
      mockGraphQLResponse([
        {
          dimensions: { scriptName: "long-running-do" },
          sum: {
            requests: 500,
            wallTime: 500 * 3600 * 1_000_000, // 500 hours in microseconds
          },
        },
      ]);

      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].metricName).toBe("DO Wall Time");
      expect(result.violations[0].currentValue).toBe(500);
      expect(result.violations[0].severity).toBe("critical"); // 500 > 100*2
    });

    it("marks severity as warning when under 2x threshold", async () => {
      mockGraphQLResponse([
        {
          dimensions: { scriptName: "slightly-over" },
          sum: { requests: 1_500_000, wallTime: 0 },
        },
      ]);

      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      expect(result.violations[0].severity).toBe("warning"); // 1.5M < 2M (2x threshold)
    });

    it("marks severity as critical when over 2x threshold", async () => {
      mockGraphQLResponse([
        {
          dimensions: { scriptName: "way-over" },
          sum: { requests: 3_000_000, wallTime: 0 },
        },
      ]);

      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      expect(result.violations[0].severity).toBe("critical"); // 3M > 2M (2x threshold)
    });

    it("does not flag services under threshold", async () => {
      mockGraphQLResponse([
        {
          dimensions: { scriptName: "healthy-worker" },
          sum: { requests: 500_000, wallTime: 10_000_000 },
        },
      ]);

      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      expect(result.violations).toHaveLength(0);
      expect(result.services).toHaveLength(1);
      expect(result.services[0].serviceName).toBe("healthy-worker");
    });

    it("merges DO and Worker metrics for same service", async () => {
      mockGraphQLResponse(
        [{ dimensions: { scriptName: "my-worker" }, sum: { requests: 100, wallTime: 1000 } }],
        [{ dimensions: { scriptName: "my-worker" }, sum: { requests: 5000, errors: 10, wallTime: 50000 } }],
      );

      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      expect(result.services).toHaveLength(1);
      expect(result.services[0].serviceName).toBe("my-worker");
      expect(result.services[0].metrics).toHaveLength(3); // DO Requests + DO Wall Time + Worker Requests
    });

    it("detects worker request spike", async () => {
      mockGraphQLResponse(
        [],
        [{ dimensions: { scriptName: "feedback-loop" }, sum: { requests: 50_000_000, errors: 0, wallTime: 100000 } }],
      );

      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].metricName).toBe("Worker Requests");
      expect(result.violations[0].currentValue).toBe(50_000_000);
    });

    it("estimates daily cost correctly", async () => {
      mockGraphQLResponse([
        {
          dimensions: { scriptName: "costly-do" },
          sum: { requests: 10_000_000, wallTime: 0 }, // 10M requests
        },
      ]);

      const result = await cloudflareProvider.checkUsage(credential, defaultThresholds);

      // Cost: (10M - 1M free) * $0.15/M = $1.35
      expect(result.services[0].estimatedDailyCostUSD).toBeCloseTo(1.35, 1);
    });

    it("throws on missing credentials", async () => {
      await expect(
        cloudflareProvider.checkUsage({ provider: "cloudflare" }, defaultThresholds)
      ).rejects.toThrow("Missing Cloudflare API token or account ID");
    });
  });

  describe("validateCredential", () => {
    it("returns valid for successful API response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          result: { id: "abc123", name: "My Account" },
        }),
      });

      const result = await cloudflareProvider.validateCredential(credential);

      expect(result.valid).toBe(true);
      expect(result.accountId).toBe("abc123");
      expect(result.accountName).toBe("My Account");
    });

    it("returns invalid for API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const result = await cloudflareProvider.validateCredential(credential);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("401");
    });

    it("returns invalid for missing credentials", async () => {
      const result = await cloudflareProvider.validateCredential({ provider: "cloudflare" });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing");
    });
  });

  describe("getDefaultThresholds", () => {
    it("returns sensible defaults", () => {
      const thresholds = cloudflareProvider.getDefaultThresholds();

      expect(thresholds.doRequestsPerDay).toBe(1_000_000);
      expect(thresholds.doWalltimeHoursPerDay).toBe(100);
      expect(thresholds.workerRequestsPerDay).toBe(10_000_000);
    });
  });

  describe("executeKillSwitch", () => {
    it("disconnects worker by disabling subdomain and removing domains", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => "{}" }) // disable subdomain
        .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ result: [{ id: "d1", hostname: "my.app" }] }) }) // list domains
        .mockResolvedValueOnce({ ok: true }); // delete domain

      const result = await cloudflareProvider.executeKillSwitch(credential, "my-worker", "disconnect");

      expect(result.success).toBe(true);
      expect(result.action).toBe("disconnect");
      expect(result.details).toContain("Disabled workers.dev");
      expect(result.details).toContain("Removed domain my.app");
    });

    it("deletes worker with force flag", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "{}" });

      const result = await cloudflareProvider.executeKillSwitch(credential, "my-worker", "delete");

      expect(result.success).toBe(true);
      expect(result.action).toBe("delete");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("?force=true"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});
