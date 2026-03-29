import { describe, it, expect, vi, beforeEach } from "vitest";
import { runpodProvider } from "../../src/providers/runpod/checker.js";
import type { DecryptedCredential, ThresholdConfig } from "../../src/providers/types.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const credential: DecryptedCredential = {
  provider: "runpod",
  runpodApiKey: "rp_test_key_abc123",
};

const defaultThresholds: ThresholdConfig = runpodProvider.getDefaultThresholds();

// ─── Mock Data ─────────────────────────────────────────────────────────────

const mockPods = [
  {
    id: "pod-abc123",
    name: "ml-training",
    desiredStatus: "RUNNING",
    runtime: { uptimeInSeconds: 3600, gpus: [{ id: "gpu-0", gpuUtilPercent: 85, memoryUtilPercent: 70 }] },
    machine: { gpuDisplayName: "NVIDIA A100 80GB" },
    gpuCount: 1,
    costPerHr: 1.64,
    podType: "ON_DEMAND",
  },
  {
    id: "pod-def456",
    name: "inference-spot",
    desiredStatus: "RUNNING",
    runtime: { uptimeInSeconds: 7200, gpus: [{ id: "gpu-0", gpuUtilPercent: 50, memoryUtilPercent: 40 }] },
    machine: { gpuDisplayName: "NVIDIA RTX 4090" },
    gpuCount: 1,
    costPerHr: 0.21,
    podType: "INTERRUPTABLE",
  },
  {
    id: "pod-stopped",
    name: "stopped-pod",
    desiredStatus: "STOPPED",
    runtime: null,
    machine: { gpuDisplayName: "NVIDIA RTX 3090" },
    gpuCount: 1,
    costPerHr: 0.44,
    podType: "ON_DEMAND",
  },
];

const mockEndpoints = [
  {
    id: "ep-abc123",
    name: "whisper-api",
    workersMin: 1,
    workersMax: 5,
    workersStandby: 2,
    gpuIds: ["NVIDIA_A100_80GB"],
    idleTimeout: 5,
  },
  {
    id: "ep-def456",
    name: "llama-inference",
    workersMin: 0,
    workersMax: 10,
    workersStandby: 0,
    gpuIds: ["NVIDIA_RTX_4090"],
    idleTimeout: 10,
  },
];

const mockVolumes = [
  { id: "vol-abc123", name: "training-data", size: 100, dataCenterId: "US-TX-3" },
  { id: "vol-def456", name: "model-weights", size: 250, dataCenterId: "EU-RO-1" },
];

// ─── Mock Helpers ──────────────────────────────────────────────────────────

function mockGraphQLResponse(overrides: {
  pods?: any[];
  endpoints?: any[];
  volumes?: any[];
  email?: string;
  id?: string;
  currentCharges?: number;
  serverlessDiscount?: number;
} = {}) {
  mockFetch.mockImplementation(async (_url: string, options: any) => {
    const body = JSON.parse(options?.body || "{}");
    const query = body.query || "";

    // validateCredential query
    if (query.includes("currentSpend")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            myself: {
              id: overrides.id ?? "user-12345",
              email: overrides.email ?? "test@example.com",
              currentSpend: { currentCharges: overrides.currentCharges ?? 42.50 },
            },
          },
        }),
      };
    }

    // listGPUPods query
    if (query.includes("pods")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            myself: {
              pods: overrides.pods ?? mockPods,
            },
          },
        }),
      };
    }

    // listServerlessEndpoints query
    if (query.includes("endpoints")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            myself: {
              serverlessDiscount: overrides.serverlessDiscount ?? 0,
              endpoints: overrides.endpoints ?? mockEndpoints,
            },
          },
        }),
      };
    }

    // listNetworkVolumes query
    if (query.includes("networkVolumes")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            myself: {
              networkVolumes: overrides.volumes ?? mockVolumes,
            },
          },
        }),
      };
    }

    // Mutations (podStop, podTerminate, updateEndpoint)
    if (query.includes("podStop")) {
      return {
        ok: true,
        json: async () => ({
          data: { podStop: { id: body.variables?.input?.podId, desiredStatus: "EXITED" } },
        }),
      };
    }

    if (query.includes("podTerminate")) {
      return {
        ok: true,
        json: async () => ({
          data: { podTerminate: { id: body.variables?.input?.podId } },
        }),
      };
    }

    if (query.includes("updateEndpoint")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            updateEndpoint: {
              id: body.variables?.input?.endpointId,
              workersMin: 0,
              workersMax: 0,
            },
          },
        }),
      };
    }

    return { ok: true, json: async () => ({ data: {} }) };
  });
}

function mockGraphQLError(message: string) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ errors: [{ message }] }),
  });
}

function mockHTTPError(status: number, statusText: string) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    statusText,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("RunPod Provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateCredential", () => {
    it("returns valid for correct API key", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.validateCredential(credential);

      expect(result.valid).toBe(true);
      expect(result.accountId).toBe("user-12345");
      expect(result.accountName).toBe("test@example.com");
    });

    it("returns invalid for missing API key", async () => {
      const result = await runpodProvider.validateCredential({ provider: "runpod" });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing RunPod API key");
    });

    it("returns invalid when API returns GraphQL error", async () => {
      mockGraphQLError("Invalid API key");

      const result = await runpodProvider.validateCredential(credential);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });

    it("returns invalid when API returns HTTP error", async () => {
      mockHTTPError(401, "Unauthorized");

      const result = await runpodProvider.validateCredential(credential);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("401");
    });

    it("returns invalid when account has no ID", async () => {
      mockGraphQLResponse({ id: undefined as any });
      // Override to return no id
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { myself: { id: null, email: null } } }),
      });

      const result = await runpodProvider.validateCredential(credential);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Could not retrieve");
    });
  });

  describe("getDefaultThresholds", () => {
    it("returns sensible defaults for all RunPod resources", () => {
      const thresholds = runpodProvider.getDefaultThresholds();

      expect(thresholds.runpodGPUPodCount).toBe(4);
      expect(thresholds.runpodSpotPodCount).toBe(8);
      expect(thresholds.runpodServerlessWorkers).toBe(10);
      expect(thresholds.runpodNetworkVolumeGB).toBe(500);
      expect(thresholds.runpodDailyCostUSD).toBe(50);
      expect(thresholds.monthlySpendLimitUSD).toBe(1500);
    });
  });

  describe("checkUsage", () => {
    it("returns usage data from all RunPod services", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      expect(result.provider).toBe("runpod");
      expect(result.services.length).toBeGreaterThan(0);
      expect(result.checkedAt).toBeGreaterThan(0);
    });

    it("detects running GPU pods (on-demand and spot)", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      // Should have aggregate + 2 running pods (stopped pod excluded)
      const podServices = result.services.filter(s => s.serviceName.startsWith("pod:"));
      expect(podServices.length).toBe(3); // all-pods + pod-abc123 + pod-def456

      const allPods = podServices.find(s => s.serviceName === "pod:all-pods");
      expect(allPods).toBeDefined();
      expect(allPods!.metrics[0].value).toBe(2); // 2 running
      expect(allPods!.metrics[1].value).toBe(1); // 1 spot
    });

    it("detects serverless endpoints with active workers", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const serverlessServices = result.services.filter(s => s.serviceName.startsWith("serverless:"));
      expect(serverlessServices.length).toBe(3); // all-endpoints + ep-abc123 + ep-def456

      const allEndpoints = serverlessServices.find(s => s.serviceName === "serverless:all-endpoints");
      expect(allEndpoints).toBeDefined();
      expect(allEndpoints!.metrics[0].value).toBe(2); // 2 standby workers from whisper-api
    });

    it("detects network volumes and total storage", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const volumeServices = result.services.filter(s => s.serviceName.startsWith("volume:"));
      expect(volumeServices.length).toBe(3); // all-volumes + vol-abc123 + vol-def456

      const allVolumes = volumeServices.find(s => s.serviceName === "volume:all-volumes");
      expect(allVolumes).toBeDefined();
      expect(allVolumes!.metrics[0].value).toBe(350); // 100 + 250 GB
    });

    it("detects GPU pod count threshold violation", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, {
        ...defaultThresholds,
        runpodGPUPodCount: 1, // 2 running pods exceeds this
      });

      const podViolation = result.violations.find(v => v.metricName === "Total Running GPU Pods");
      expect(podViolation).toBeDefined();
      expect(podViolation!.currentValue).toBe(2);
      expect(podViolation!.threshold).toBe(1);
      expect(podViolation!.severity).toBe("warning");
    });

    it("detects critical violation when value exceeds 2x threshold", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, {
        ...defaultThresholds,
        runpodNetworkVolumeGB: 100, // 350 GB is > 2x threshold
      });

      const volumeViolation = result.violations.find(v => v.metricName === "Total Network Volume Storage");
      expect(volumeViolation).toBeDefined();
      expect(volumeViolation!.severity).toBe("critical");
    });

    it("detects daily cost threshold violation", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, {
        ...defaultThresholds,
        runpodDailyCostUSD: 1, // Very low threshold, should trigger
      });

      const costViolation = result.violations.find(v => v.metricName === "Estimated Daily Cost");
      expect(costViolation).toBeDefined();
      expect(costViolation!.currentValue).toBeGreaterThan(1);
      expect(costViolation!.unit).toBe("USD");
    });

    it("calculates estimated daily cost from pod costPerHr", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      // pod-abc123: $1.64/hr * 24 = $39.36
      const a100Pod = result.services.find(s => s.serviceName === "pod:pod-abc123");
      expect(a100Pod).toBeDefined();
      expect(a100Pod!.estimatedDailyCostUSD).toBeCloseTo(1.64 * 24, 1);
    });

    it("handles pods API error gracefully", async () => {
      // Pods fail, but endpoints and volumes succeed
      let callCount = 0;
      mockFetch.mockImplementation(async (_url: string, options: any) => {
        const body = JSON.parse(options?.body || "{}");
        const query = body.query || "";
        callCount++;

        if (query.includes("pods")) {
          throw new Error("Network timeout");
        }
        if (query.includes("endpoints")) {
          return {
            ok: true,
            json: async () => ({ data: { myself: { serverlessDiscount: 0, endpoints: mockEndpoints } } }),
          };
        }
        if (query.includes("networkVolumes")) {
          return {
            ok: true,
            json: async () => ({ data: { myself: { networkVolumes: mockVolumes } } }),
          };
        }
        return { ok: true, json: async () => ({ data: {} }) };
      });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      // Should still return results from endpoints and volumes
      expect(result.provider).toBe("runpod");
      const serverlessServices = result.services.filter(s => s.serviceName.startsWith("serverless:"));
      expect(serverlessServices.length).toBeGreaterThan(0);
      const podServices = result.services.filter(s => s.serviceName.startsWith("pod:"));
      expect(podServices.length).toBe(0); // Pods failed
    });

    it("handles endpoints API error gracefully", async () => {
      mockFetch.mockImplementation(async (_url: string, options: any) => {
        const body = JSON.parse(options?.body || "{}");
        const query = body.query || "";

        if (query.includes("pods")) {
          return { ok: true, json: async () => ({ data: { myself: { pods: mockPods } } }) };
        }
        if (query.includes("endpoints")) {
          throw new Error("Server error");
        }
        if (query.includes("networkVolumes")) {
          return { ok: true, json: async () => ({ data: { myself: { networkVolumes: mockVolumes } } }) };
        }
        return { ok: true, json: async () => ({ data: {} }) };
      });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      expect(result.provider).toBe("runpod");
      const podServices = result.services.filter(s => s.serviceName.startsWith("pod:"));
      expect(podServices.length).toBeGreaterThan(0);
      const serverlessServices = result.services.filter(s => s.serviceName.startsWith("serverless:"));
      expect(serverlessServices.length).toBe(0);
    });

    it("throws on missing credentials", async () => {
      await expect(
        runpodProvider.checkUsage({ provider: "runpod" }, defaultThresholds)
      ).rejects.toThrow("Missing RunPod API key");
    });

    it("returns empty services when no resources exist", async () => {
      mockGraphQLResponse({ pods: [], endpoints: [], volumes: [] });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      expect(result.services).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
      expect(result.totalEstimatedDailyCostUSD).toBe(0);
    });

    it("excludes stopped pods from usage", async () => {
      mockGraphQLResponse({
        pods: [mockPods[2]], // Only the stopped pod
      });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const podServices = result.services.filter(s => s.serviceName.startsWith("pod:"));
      expect(podServices).toHaveLength(0);
    });

    it("identifies spot pods correctly", async () => {
      mockGraphQLResponse();

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const spotPod = result.services.find(s => s.serviceName === "pod:pod-def456");
      expect(spotPod).toBeDefined();
      const spotMetric = spotPod!.metrics.find(m => m.name === "Spot Pod");
      expect(spotMetric).toBeDefined();
      expect(spotMetric!.thresholdKey).toBe("runpodSpotPodCount");
    });
  });

  describe("executeKillSwitch", () => {
    beforeEach(() => {
      mockGraphQLResponse();
    });

    it("routes stop-pod action for GPU pods", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "stop-pod"
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("stop-pod");
      expect(result.serviceName).toBe("pod:pod-abc123");
      expect(result.details).toContain("Stopped GPU pod");
      expect(result.details).toContain("volume data preserved");
    });

    it("routes terminate-pod action for GPU pods", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "terminate-pod"
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("terminate-pod");
      expect(result.serviceName).toBe("pod:pod-abc123");
      expect(result.details).toContain("TERMINATED");
      expect(result.details).toContain("container disk destroyed");
    });

    it("routes delete action to terminate for pods", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "delete"
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("terminate-pod");
    });

    it("returns failure for delete on non-pod service", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "serverless:ep-abc123", "delete"
      );

      expect(result.success).toBe(false);
      expect(result.details).toContain("Delete not supported");
    });

    it("routes scale-down for serverless endpoints", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "serverless:ep-abc123", "scale-down"
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("scale-down");
      expect(result.serviceName).toBe("serverless:ep-abc123");
      expect(result.details).toContain("Scaled serverless endpoint");
      expect(result.details).toContain("0 workers");
    });

    it("routes scale-down to stop for pods", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "scale-down"
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("stop-pod");
    });

    it("returns failure for scale-down on unsupported type", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "volume:vol-abc123", "scale-down"
      );

      expect(result.success).toBe(false);
      expect(result.details).toContain("Scale-down not supported");
    });

    it("routes stop-instances to stop-pod for pods", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "stop-instances"
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("stop-pod");
    });

    it("returns failure for stop-instances on non-pod type", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "serverless:ep-abc123", "stop-instances"
      );

      expect(result.success).toBe(false);
      expect(result.details).toContain("Stop not supported");
    });

    it("defaults disconnect to stop-pod for pods", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "disconnect"
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("stop-pod");
    });

    it("defaults disconnect to scale-down for serverless", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "serverless:ep-abc123", "disconnect"
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe("scale-down");
    });

    it("returns failure for disconnect on unknown service type", async () => {
      const result = await runpodProvider.executeKillSwitch(
        credential, "unknown:something", "disconnect"
      );

      expect(result.success).toBe(false);
      expect(result.details).toContain("Unknown service type");
    });
  });

  describe("kill action error handling", () => {
    it("returns failure when stopPod API throws", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "stop-pod"
      );

      expect(result.success).toBe(false);
      expect(result.details).toContain("Failed");
      expect(result.details).toContain("Connection refused");
    });

    it("returns failure when terminatePod API throws", async () => {
      mockFetch.mockRejectedValue(new Error("Pod not found"));

      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "terminate-pod"
      );

      expect(result.success).toBe(false);
      expect(result.details).toContain("Failed");
      expect(result.details).toContain("Pod not found");
    });

    it("returns failure when scaleDownEndpoint API throws", async () => {
      mockFetch.mockRejectedValue(new Error("Endpoint not found"));

      const result = await runpodProvider.executeKillSwitch(
        credential, "serverless:ep-abc123", "scale-down"
      );

      expect(result.success).toBe(false);
      expect(result.details).toContain("Failed");
      expect(result.details).toContain("Endpoint not found");
    });

    it("returns failure when API returns GraphQL error on mutation", async () => {
      mockGraphQLError("Insufficient permissions");

      const result = await runpodProvider.executeKillSwitch(
        credential, "pod:pod-abc123", "stop-pod"
      );

      expect(result.success).toBe(false);
      expect(result.details).toContain("Insufficient permissions");
    });
  });

  describe("GPU cost estimation", () => {
    it("uses costPerHr from API when available", async () => {
      mockGraphQLResponse({
        pods: [{
          ...mockPods[0],
          costPerHr: 2.50,
        }],
      });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const pod = result.services.find(s => s.serviceName === "pod:pod-abc123");
      expect(pod!.estimatedDailyCostUSD).toBeCloseTo(2.50 * 24, 1);
    });

    it("falls back to estimated rate for unknown GPU when costPerHr is 0", async () => {
      mockGraphQLResponse({
        pods: [{
          ...mockPods[0],
          costPerHr: 0,
          machine: { gpuDisplayName: "NVIDIA Unknown GPU" },
          gpuCount: 2,
        }],
      });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const pod = result.services.find(s => s.serviceName === "pod:pod-abc123");
      // Unknown GPU: $1.00/hr fallback * 2 GPUs * 24hrs = $48
      expect(pod!.estimatedDailyCostUSD).toBeCloseTo(1.00 * 2 * 24, 1);
    });

    it("applies spot discount in cost estimation fallback", async () => {
      mockGraphQLResponse({
        pods: [{
          ...mockPods[0],
          costPerHr: 0,
          machine: { gpuDisplayName: "NVIDIA A100 80GB" },
          gpuCount: 1,
          podType: "INTERRUPTABLE",
        }],
      });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const pod = result.services.find(s => s.serviceName === "pod:pod-abc123");
      // A100: $1.64/hr * 0.3 spot discount * 24hrs = $11.81
      expect(pod!.estimatedDailyCostUSD).toBeCloseTo(1.64 * 0.3 * 24, 1);
    });

    it("scales cost by GPU count", async () => {
      mockGraphQLResponse({
        pods: [{
          ...mockPods[0],
          costPerHr: 0,
          machine: { gpuDisplayName: "NVIDIA RTX 4090" },
          gpuCount: 4,
          podType: "ON_DEMAND",
        }],
      });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const pod = result.services.find(s => s.serviceName === "pod:pod-abc123");
      // RTX 4090: $0.69/hr * 4 GPUs * 24hrs = $66.24
      expect(pod!.estimatedDailyCostUSD).toBeCloseTo(0.69 * 4 * 24, 1);
    });
  });

  describe("network volume cost estimation", () => {
    it("estimates storage cost at $0.07/GB/month", async () => {
      mockGraphQLResponse({
        pods: [],
        endpoints: [],
        volumes: [{ id: "vol-test", name: "test", size: 300, dataCenterId: "US-TX-3" }],
      });

      const result = await runpodProvider.checkUsage(credential, defaultThresholds);

      const vol = result.services.find(s => s.serviceName === "volume:vol-test");
      expect(vol!.estimatedDailyCostUSD).toBeCloseTo(300 * 0.07 / 30, 2);
    });
  });
});
