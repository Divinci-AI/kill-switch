/**
 * Dogfooding Configuration
 *
 * Defines the Kill Switch self-monitoring setup — the kill switch
 * monitors its own Cloudflare infrastructure to eat our own dog food.
 *
 * Workers monitored:
 *   - cloud-switch-site (marketing site)
 *   - kill-switch-app (dashboard SPA, Pages)
 *   - kill-switch-cf (Cloudflare kill-switch cron worker)
 *   - edge-agent (customer agent worker)
 *   - api-proxy (CF→Cloud Run proxy)
 *
 * Protected (never killed):
 *   - kill-switch-cf (the kill switch itself!)
 *   - api-proxy (needed for API access)
 */

import type { ThresholdConfig, KillSwitchRule } from "../providers/types.js";

export const DOGFOOD_ACCOUNT_ID = "14a6fa23390363382f378b5bd4a0f849";

export const DOGFOOD_ACCOUNT_NAME = "Kill Switch Self-Monitor";

export const DOGFOOD_PROVIDER = "cloudflare" as const;

/**
 * Workers that must never be killed — they are the kill switch infrastructure itself.
 */
export const PROTECTED_WORKERS = [
  "kill-switch-cf",  // The kill switch worker — killing this would disable monitoring
  "api-proxy",       // CF→Cloud Run proxy — needed for API access
];

/**
 * All known workers in the kill-switch.net Cloudflare account.
 */
export const KNOWN_WORKERS = [
  "cloud-switch-site",  // Marketing site (kill-switch.net)
  "kill-switch-app",    // Dashboard SPA (app.kill-switch.net)
  "kill-switch-cf",     // Kill-switch cron worker
  "edge-agent",         // Edge agent worker
  "api-proxy",          // API proxy worker
];

/**
 * Conservative thresholds for self-monitoring.
 * These are tuned for a low-traffic product site, not a high-volume app.
 */
export const DOGFOOD_THRESHOLDS: ThresholdConfig = {
  // Worker requests — site + dashboard should be well under 1M/day
  workerRequestsPerDay: 500_000,

  // Durable Objects — not heavily used yet
  doRequestsPerDay: 100_000,
  doWalltimeHoursPerDay: 10,

  // R2 — no buckets expected yet, flag any usage
  r2OpsPerDay: 50_000,
  r2StorageGB: 5,

  // D1 — not used
  d1RowsReadPerDay: 100_000,
  d1RowsWrittenPerDay: 10_000,

  // Queues — not used
  queueOpsPerDay: 10_000,

  // Shared security thresholds
  monthlySpendLimitUSD: 50,
  requestsPerMinute: 10_000,      // DDoS detection
  errorRatePercent: 25,            // Error spike
  authFailuresPerMinute: 50,       // Brute force
  egressGBPerHour: 5,              // Exfiltration
};

/**
 * Custom dogfooding rules beyond the preset templates.
 */
export function getDogfoodRules(): KillSwitchRule[] {
  return [
    {
      id: "dogfood-cost-guard",
      name: "Dogfood: Daily Cost Guard",
      enabled: true,
      trigger: "cost",
      conditions: [
        { metric: "monthlySpendLimitUSD", operator: "gt", value: 50 },
      ],
      conditionLogic: "any",
      actions: [
        { type: "disconnect", target: "cloud-switch-site", requireApproval: false },
        { type: "disconnect", target: "kill-switch-app", requireApproval: false },
        { type: "snapshot", target: "*", requireApproval: false },
      ],
      cooldownMinutes: 60,
      forensicsEnabled: true,
    },
    {
      id: "dogfood-request-spike",
      name: "Dogfood: Request Spike (DDoS)",
      enabled: true,
      trigger: "security",
      conditions: [
        { metric: "requestsPerMinute", operator: "gt", value: 10_000, windowMinutes: 5 },
      ],
      conditionLogic: "any",
      actions: [
        { type: "disconnect", target: "cloud-switch-site", delay: 30, requireApproval: false },
        { type: "snapshot", target: "*", requireApproval: false },
      ],
      cooldownMinutes: 30,
      forensicsEnabled: true,
    },
    {
      id: "dogfood-unknown-worker",
      name: "Dogfood: Unknown Worker Detection",
      enabled: true,
      trigger: "security",
      conditions: [
        { metric: "workerRequestsPerDay", operator: "gt", value: 0 },
      ],
      conditionLogic: "any",
      actions: [
        { type: "disconnect", requireApproval: true },
        { type: "snapshot", target: "*", requireApproval: false },
      ],
      cooldownMinutes: 120,
      forensicsEnabled: true,
    },
  ];
}

/**
 * Build the full dogfooding cloud account configuration payload
 * for POST /cloud-accounts.
 */
export function buildDogfoodAccountPayload(credential: { apiToken: string }) {
  return {
    provider: DOGFOOD_PROVIDER,
    name: DOGFOOD_ACCOUNT_NAME,
    credential: {
      provider: DOGFOOD_PROVIDER,
      apiToken: credential.apiToken,
      accountId: DOGFOOD_ACCOUNT_ID,
    },
  };
}

/**
 * Build the threshold + protection update payload
 * for PUT /cloud-accounts/:id.
 */
export function buildDogfoodUpdatePayload() {
  return {
    thresholds: DOGFOOD_THRESHOLDS,
    protectedServices: PROTECTED_WORKERS,
    autoDisconnect: true,
    autoDelete: false, // Never auto-delete our own infra
  };
}

/**
 * Validate that a check result respects protected workers.
 * Returns violations that were incorrectly acted upon.
 */
export function validateProtectedWorkers(
  actionsTaken: string[],
  protectedWorkers: string[] = PROTECTED_WORKERS
): string[] {
  return actionsTaken.filter(action => {
    const lowerAction = action.toLowerCase();
    return protectedWorkers.some(
      worker => lowerAction.includes(worker.toLowerCase()) && !lowerAction.startsWith("protected:")
    );
  });
}

/**
 * Check if a worker is in the known workers list.
 */
export function isKnownWorker(workerName: string): boolean {
  return KNOWN_WORKERS.includes(workerName);
}
