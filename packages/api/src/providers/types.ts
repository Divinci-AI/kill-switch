/**
 * Cloud Provider Interface & Security Types
 *
 * Abstracts the differences between Cloudflare, GCP, and future providers
 * behind a common interface. Supports both cost and security kill switches.
 */

export type ProviderId = "cloudflare" | "gcp" | "aws";

// ─── Usage & Cost Monitoring ────────────────────────────────────────────────

export interface UsageMetric {
  name: string;
  value: number;
  unit: string;
  thresholdKey: string;
}

export interface ServiceUsage {
  serviceName: string;
  metrics: UsageMetric[];
  estimatedDailyCostUSD: number;
}

export interface UsageResult {
  provider: ProviderId;
  accountId: string;
  checkedAt: number;
  services: ServiceUsage[];
  totalEstimatedDailyCostUSD: number;
  violations: Violation[];
  securityEvents: SecurityEvent[];
}

export interface Violation {
  serviceName: string;
  metricName: string;
  currentValue: number;
  threshold: number;
  unit: string;
  severity: "warning" | "critical";
}

// ─── Security Monitoring ────────────────────────────────────────────────────

export type SecurityEventType =
  | "request_spike"       // Sudden traffic surge (potential DDoS)
  | "error_spike"         // Burst of 4xx/5xx errors (brute force or attack)
  | "egress_anomaly"      // Unusual outbound data volume (data exfiltration)
  | "auth_failure_spike"  // Mass auth failures (credential stuffing)
  | "new_outbound_domain" // Worker contacting unknown domain (compromise)
  | "cpu_anomaly"         // Sustained high CPU (crypto mining)
  | "latency_spike"       // Response time degradation (overload)
  | "config_drift"        // Service config changed outside IaC
  | "credential_exposure" // Token used from unexpected IP/region
  | "rate_limit_breach";  // Rate limiter overwhelmed

export interface SecurityEvent {
  type: SecurityEventType;
  severity: "info" | "warning" | "critical";
  serviceName: string;
  description: string;
  metrics: Record<string, number>;
  detectedAt: number;
}

export type KillAction =
  | "disconnect"    // Remove routes (reversible, CF)
  | "delete"        // Delete worker (nuclear, CF)
  | "scale-down"    // Set max instances to 0 (reversible, GCP)
  | "block-traffic" // Enable WAF block rule
  | "rotate-creds"  // Rotate API keys/tokens
  | "snapshot"       // Capture forensic snapshot only (no kill)
  | "isolate";       // Network-level isolation

export interface ActionResult {
  success: boolean;
  action: KillAction;
  serviceName: string;
  details: string;
  forensicSnapshotId?: string;
}

export interface ValidationResult {
  valid: boolean;
  accountId?: string;
  accountName?: string;
  error?: string;
  permissions?: string[];
}

export interface ThresholdConfig {
  // Cost thresholds
  doRequestsPerDay?: number;
  doWalltimeHoursPerDay?: number;
  workerRequestsPerDay?: number;
  gcpBudgetPercent?: number;
  monthlySpendLimitUSD?: number;
  // Security thresholds
  requestsPerMinute?: number;       // DDoS detection
  errorRatePercent?: number;        // Error spike detection (% of total)
  authFailuresPerMinute?: number;   // Brute force detection
  latencyP99Ms?: number;            // Overload detection
  egressGBPerHour?: number;         // Exfiltration detection
  [key: string]: number | undefined;
}

export interface DecryptedCredential {
  provider: ProviderId;
  apiToken?: string;
  accountId?: string;
  serviceAccountJson?: string;
  projectId?: string;
  region?: string;
}

// ─── Forensic Snapshot ──────────────────────────────────────────────────────

export interface ForensicSnapshot {
  id: string;
  incidentId: string;
  capturedAt: number;
  provider: ProviderId;
  serviceName: string;
  trigger: string;
  data: {
    serviceConfig?: Record<string, unknown>;
    recentLogs?: string[];
    recentMetrics?: Record<string, number[]>;
    activeConnections?: number;
    environmentVariables?: string[];  // Names only, not values
    networkRules?: Record<string, unknown>;
    databaseSnapshot?: { snapshotId: string; status: string };
  };
  integrityHash: string;
}

// ─── Kill Switch Rule Engine ────────────────────────────────────────────────

export type RuleTrigger = "cost" | "security" | "custom" | "api" | "agent";

export interface KillSwitchRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  conditionLogic: "all" | "any";  // AND or OR
  actions: RuleAction[];
  cooldownMinutes: number;        // Don't re-fire within this window
  lastFiredAt?: number;
  forensicsEnabled: boolean;      // Capture snapshot when rule fires
}

export interface RuleCondition {
  metric: string;           // e.g., "doRequestsPerDay", "errorRatePercent", "requestsPerMinute"
  operator: "gt" | "lt" | "gte" | "lte" | "eq";
  value: number;
  windowMinutes?: number;   // Evaluation window (e.g., last 5 minutes)
}

export interface RuleAction {
  type: KillAction;
  target?: string;          // Specific service, or "*" for all non-protected
  delay?: number;           // Seconds to wait before executing (grace period)
  requireApproval?: boolean; // Pause and wait for human approval
}

// ─── Provider Interface ─────────────────────────────────────────────────────

export interface CloudProvider {
  id: ProviderId;
  name: string;

  /** Check current usage and security metrics against thresholds */
  checkUsage(
    credential: DecryptedCredential,
    thresholds: ThresholdConfig
  ): Promise<UsageResult>;

  /** Execute kill switch action on a specific service */
  executeKillSwitch(
    credential: DecryptedCredential,
    serviceName: string,
    action: KillAction
  ): Promise<ActionResult>;

  /** Validate that credentials work and have required permissions */
  validateCredential(
    credential: DecryptedCredential
  ): Promise<ValidationResult>;

  /** Capture a forensic snapshot of a service's current state */
  captureForensicSnapshot?(
    credential: DecryptedCredential,
    serviceName: string,
    trigger: string
  ): Promise<ForensicSnapshot>;

  /** Return sensible default thresholds for new accounts */
  getDefaultThresholds(): ThresholdConfig;
}
