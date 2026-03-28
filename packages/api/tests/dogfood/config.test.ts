/**
 * Dogfood Configuration Unit Tests
 *
 * Validates the self-monitoring configuration:
 * - Thresholds are sensible for a low-traffic product site
 * - Protected workers list is correct and complete
 * - Rules are well-formed and cover key scenarios
 * - Payload builders produce valid API payloads
 */

import { describe, it, expect } from "vitest";
import {
  DOGFOOD_ACCOUNT_ID,
  DOGFOOD_ACCOUNT_NAME,
  DOGFOOD_PROVIDER,
  PROTECTED_WORKERS,
  KNOWN_WORKERS,
  DOGFOOD_THRESHOLDS,
  getDogfoodRules,
  buildDogfoodAccountPayload,
  buildDogfoodUpdatePayload,
  validateProtectedWorkers,
  isKnownWorker,
} from "../../src/dogfood/config.js";

describe("Dogfood: Constants", () => {
  it("uses the correct Cloudflare account ID", () => {
    expect(DOGFOOD_ACCOUNT_ID).toBe("14a6fa23390363382f378b5bd4a0f849");
  });

  it("uses cloudflare as the provider", () => {
    expect(DOGFOOD_PROVIDER).toBe("cloudflare");
  });

  it("has a descriptive account name", () => {
    expect(DOGFOOD_ACCOUNT_NAME).toBeTruthy();
    expect(typeof DOGFOOD_ACCOUNT_NAME).toBe("string");
  });
});

describe("Dogfood: Protected Workers", () => {
  it("protects kill-switch-cf (the kill switch itself)", () => {
    expect(PROTECTED_WORKERS).toContain("kill-switch-cf");
  });

  it("protects api-proxy (needed for API access)", () => {
    expect(PROTECTED_WORKERS).toContain("api-proxy");
  });

  it("does NOT protect the marketing site (it's expendable)", () => {
    expect(PROTECTED_WORKERS).not.toContain("cloud-switch-site");
  });

  it("does NOT protect the dashboard (it's expendable)", () => {
    expect(PROTECTED_WORKERS).not.toContain("kill-switch-app");
  });

  it("all protected workers are in the known workers list", () => {
    for (const worker of PROTECTED_WORKERS) {
      expect(KNOWN_WORKERS).toContain(worker);
    }
  });
});

describe("Dogfood: Known Workers", () => {
  it("includes all expected workers", () => {
    expect(KNOWN_WORKERS).toContain("cloud-switch-site");
    expect(KNOWN_WORKERS).toContain("kill-switch-app");
    expect(KNOWN_WORKERS).toContain("kill-switch-cf");
    expect(KNOWN_WORKERS).toContain("edge-agent");
    expect(KNOWN_WORKERS).toContain("api-proxy");
  });

  it("isKnownWorker returns true for known workers", () => {
    expect(isKnownWorker("cloud-switch-site")).toBe(true);
    expect(isKnownWorker("kill-switch-cf")).toBe(true);
  });

  it("isKnownWorker returns false for unknown workers", () => {
    expect(isKnownWorker("rogue-crypto-miner")).toBe(false);
    expect(isKnownWorker("")).toBe(false);
  });
});

describe("Dogfood: Thresholds", () => {
  it("sets worker request threshold", () => {
    expect(DOGFOOD_THRESHOLDS.workerRequestsPerDay).toBeDefined();
    expect(DOGFOOD_THRESHOLDS.workerRequestsPerDay).toBeGreaterThan(0);
  });

  it("sets DO thresholds", () => {
    expect(DOGFOOD_THRESHOLDS.doRequestsPerDay).toBeDefined();
    expect(DOGFOOD_THRESHOLDS.doWalltimeHoursPerDay).toBeDefined();
  });

  it("sets a monthly spend limit", () => {
    expect(DOGFOOD_THRESHOLDS.monthlySpendLimitUSD).toBeDefined();
    expect(DOGFOOD_THRESHOLDS.monthlySpendLimitUSD).toBeGreaterThan(0);
    // Should be conservative — this is a low-traffic product site
    expect(DOGFOOD_THRESHOLDS.monthlySpendLimitUSD).toBeLessThanOrEqual(100);
  });

  it("sets DDoS detection threshold", () => {
    expect(DOGFOOD_THRESHOLDS.requestsPerMinute).toBeDefined();
    expect(DOGFOOD_THRESHOLDS.requestsPerMinute).toBeGreaterThan(0);
  });

  it("sets error rate threshold", () => {
    expect(DOGFOOD_THRESHOLDS.errorRatePercent).toBeDefined();
    expect(DOGFOOD_THRESHOLDS.errorRatePercent).toBeGreaterThan(0);
    expect(DOGFOOD_THRESHOLDS.errorRatePercent).toBeLessThanOrEqual(100);
  });

  it("sets egress threshold for exfiltration detection", () => {
    expect(DOGFOOD_THRESHOLDS.egressGBPerHour).toBeDefined();
    expect(DOGFOOD_THRESHOLDS.egressGBPerHour).toBeGreaterThan(0);
  });

  it("has no GCP or AWS thresholds (Cloudflare only)", () => {
    expect(DOGFOOD_THRESHOLDS.gcpBudgetPercent).toBeUndefined();
    expect(DOGFOOD_THRESHOLDS.ec2InstanceCount).toBeUndefined();
    expect(DOGFOOD_THRESHOLDS.awsDailyCostUSD).toBeUndefined();
  });
});

describe("Dogfood: Rules", () => {
  const rules = getDogfoodRules();

  it("returns at least 3 rules", () => {
    expect(rules.length).toBeGreaterThanOrEqual(3);
  });

  it("all rules have required fields", () => {
    for (const rule of rules) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(typeof rule.enabled).toBe("boolean");
      expect(rule.trigger).toBeTruthy();
      expect(rule.conditions.length).toBeGreaterThan(0);
      expect(rule.actions.length).toBeGreaterThan(0);
      expect(rule.cooldownMinutes).toBeGreaterThan(0);
    }
  });

  it("all rules are enabled by default", () => {
    for (const rule of rules) {
      expect(rule.enabled).toBe(true);
    }
  });

  it("all rules have forensics enabled", () => {
    for (const rule of rules) {
      expect(rule.forensicsEnabled).toBe(true);
    }
  });

  it("all rule IDs start with 'dogfood-'", () => {
    for (const rule of rules) {
      expect(rule.id).toMatch(/^dogfood-/);
    }
  });

  it("has a cost guard rule", () => {
    const costRule = rules.find(r => r.id === "dogfood-cost-guard");
    expect(costRule).toBeDefined();
    expect(costRule!.trigger).toBe("cost");
    expect(costRule!.actions.some(a => a.type === "disconnect")).toBe(true);
  });

  it("has a request spike (DDoS) rule", () => {
    const ddosRule = rules.find(r => r.id === "dogfood-request-spike");
    expect(ddosRule).toBeDefined();
    expect(ddosRule!.trigger).toBe("security");
    expect(ddosRule!.conditions[0].metric).toBe("requestsPerMinute");
  });

  it("DDoS rule has a delay before disconnect (grace period)", () => {
    const ddosRule = rules.find(r => r.id === "dogfood-request-spike")!;
    const disconnectAction = ddosRule.actions.find(a => a.type === "disconnect");
    expect(disconnectAction?.delay).toBeGreaterThan(0);
  });

  it("has an unknown worker detection rule", () => {
    const unknownRule = rules.find(r => r.id === "dogfood-unknown-worker");
    expect(unknownRule).toBeDefined();
    // Unknown worker disconnect should require human approval
    const disconnectAction = unknownRule!.actions.find(a => a.type === "disconnect");
    expect(disconnectAction?.requireApproval).toBe(true);
  });

  it("no rule targets protected workers directly", () => {
    for (const rule of rules) {
      for (const action of rule.actions) {
        if (action.target && action.target !== "*") {
          expect(PROTECTED_WORKERS).not.toContain(action.target);
        }
      }
    }
  });
});

describe("Dogfood: Payload Builders", () => {
  it("buildDogfoodAccountPayload includes provider and credentials", () => {
    const payload = buildDogfoodAccountPayload({ apiToken: "test-token" });
    expect(payload.provider).toBe("cloudflare");
    expect(payload.name).toBe(DOGFOOD_ACCOUNT_NAME);
    expect(payload.credential.apiToken).toBe("test-token");
    expect(payload.credential.accountId).toBe(DOGFOOD_ACCOUNT_ID);
    expect(payload.credential.provider).toBe("cloudflare");
  });

  it("buildDogfoodUpdatePayload includes thresholds and protection", () => {
    const payload = buildDogfoodUpdatePayload();
    expect(payload.thresholds).toEqual(DOGFOOD_THRESHOLDS);
    expect(payload.protectedServices).toEqual(PROTECTED_WORKERS);
    expect(payload.autoDisconnect).toBe(true);
    expect(payload.autoDelete).toBe(false); // Never auto-delete our own infra
  });

  it("autoDelete is always false for self-monitoring", () => {
    const payload = buildDogfoodUpdatePayload();
    expect(payload.autoDelete).toBe(false);
  });
});

describe("Dogfood: Protected Worker Validation", () => {
  it("returns empty array when no protected workers are acted upon", () => {
    const actions = [
      "Disconnected cloud-switch-site",
      "PROTECTED: kill-switch-cf",
    ];
    const violations = validateProtectedWorkers(actions);
    expect(violations).toHaveLength(0);
  });

  it("detects when a protected worker is incorrectly acted upon", () => {
    const actions = [
      "Disconnected kill-switch-cf",
      "Disconnected cloud-switch-site",
    ];
    const violations = validateProtectedWorkers(actions);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("kill-switch-cf");
  });

  it("detects multiple protected worker violations", () => {
    const actions = [
      "Disconnected kill-switch-cf",
      "Deleted api-proxy",
    ];
    const violations = validateProtectedWorkers(actions);
    expect(violations).toHaveLength(2);
  });

  it("ignores PROTECTED: prefix (legitimate skip)", () => {
    const actions = [
      "PROTECTED: kill-switch-cf",
      "PROTECTED: api-proxy",
    ];
    const violations = validateProtectedWorkers(actions);
    expect(violations).toHaveLength(0);
  });

  it("works with custom protected workers list", () => {
    const actions = ["Disconnected my-worker"];
    const violations = validateProtectedWorkers(actions, ["my-worker"]);
    expect(violations).toHaveLength(1);
  });

  it("is case-insensitive for worker names", () => {
    const actions = ["Disconnected KILL-SWITCH-CF"];
    const violations = validateProtectedWorkers(actions);
    expect(violations).toHaveLength(1);
  });
});
