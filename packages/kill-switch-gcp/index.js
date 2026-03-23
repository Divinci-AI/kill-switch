/**
 * GCP Billing Kill Switch
 *
 * Cloud Function triggered by budget alerts via Pub/Sub.
 * Selectively disables Cloud Run services when spending exceeds thresholds,
 * and pages PagerDuty for immediate human response.
 *
 * Unlike nuclear "disable billing" approaches, this:
 * - Selectively scales down Cloud Run services to 0 instances
 * - Preserves critical services (protected list)
 * - Pages on-call via PagerDuty until acknowledged
 * - Logs all actions for audit trail
 *
 * @see https://github.com/Divinci-AI/gcp-billing-kill-switch
 * @license MIT
 */

const { CloudBillingClient } = require("@google-cloud/billing");
const { v2: { ServicesClient } } = require("@google-cloud/run");
const billing = new CloudBillingClient();
const runClient = new ServicesClient();

// ── Configuration ───────────────────────────────────────────────────────────

const PROJECT_ID = process.env.GCP_PROJECT_ID || "openai-api-4375643";
const PROJECT_NAME = `projects/${PROJECT_ID}`;
const REGION = process.env.GCP_REGION || "us-central1";
const PAGERDUTY_ROUTING_KEY = process.env.PAGERDUTY_ROUTING_KEY || "";

// Threshold (0-1) at which to take action. Budget alerts fire at configured
// percentages. We act when cost ratio exceeds this value.
const KILL_THRESHOLD = parseFloat(process.env.KILL_THRESHOLD || "0.8");

// Services to NEVER disable, even when budget is exceeded
// Supports both comma and semicolon separators (semicolon needed for gcloud --set-env-vars)
const PROTECTED_SERVICES = (process.env.PROTECTED_SERVICES || "").split(/[,;]/).map(s => s.trim()).filter(Boolean);

// If true, disable billing entirely (nuclear). If false, only scale down Cloud Run.
const NUCLEAR_MODE = process.env.NUCLEAR_MODE === "true";

// ── Main Handler ────────────────────────────────────────────────────────────

/**
 * Cloud Function entry point. Triggered by Pub/Sub message from billing budget.
 */
exports.killSwitch = async (pubsubMessage, context) => {
  let budgetAlert;
  try {
    const data = Buffer.from(pubsubMessage.data, "base64").toString();
    budgetAlert = JSON.parse(data);
  } catch (err) {
    console.error("Failed to parse budget alert:", err);
    return;
  }

  console.log("Budget alert received:", JSON.stringify(budgetAlert, null, 2));

  const costAmount = budgetAlert.costAmount || 0;
  const budgetAmount = budgetAlert.budgetAmount || 1;
  const costRatio = costAmount / budgetAmount;
  const currencyCode = budgetAlert.currencyCode || "USD";

  console.log(`Cost: ${costAmount} ${currencyCode} / Budget: ${budgetAmount} ${currencyCode} (${(costRatio * 100).toFixed(1)}%)`);

  // Only take action if cost exceeds threshold
  if (costRatio < KILL_THRESHOLD) {
    console.log(`Cost ratio ${(costRatio * 100).toFixed(1)}% is below kill threshold ${(KILL_THRESHOLD * 100).toFixed(1)}%. No action taken.`);

    // Still page at warning level for awareness
    if (costRatio >= 0.5 && PAGERDUTY_ROUTING_KEY) {
      await alertPagerDuty(
        `GCP spending at ${(costRatio * 100).toFixed(0)}% of budget ($${costAmount.toFixed(2)}/$${budgetAmount})`,
        "warning",
        { costAmount, budgetAmount, costRatio, action: "monitoring" }
      );
    }
    return;
  }

  console.log(`KILL THRESHOLD EXCEEDED: ${(costRatio * 100).toFixed(1)}% >= ${(KILL_THRESHOLD * 100).toFixed(1)}%`);

  const actions = [];

  if (NUCLEAR_MODE) {
    // Nuclear: disable billing entirely
    const result = await disableBilling(PROJECT_NAME);
    actions.push(result);
  } else {
    // Selective: scale down Cloud Run services
    const results = await scaleDownCloudRunServices();
    actions.push(...results);
  }

  // Page PagerDuty
  if (PAGERDUTY_ROUTING_KEY) {
    await alertPagerDuty(
      `GCP BILLING KILL SWITCH ACTIVATED: $${costAmount.toFixed(2)}/$${budgetAmount} (${(costRatio * 100).toFixed(0)}%)`,
      "critical",
      {
        costAmount,
        budgetAmount,
        costRatio: (costRatio * 100).toFixed(1) + "%",
        threshold: (KILL_THRESHOLD * 100).toFixed(1) + "%",
        mode: NUCLEAR_MODE ? "NUCLEAR (billing disabled)" : "SELECTIVE (Cloud Run scaled down)",
        actionsTaken: actions,
      }
    );
  }

  console.log("Kill switch actions completed:", actions);
};

// ── Cloud Run Service Management ────────────────────────────────────────────

async function scaleDownCloudRunServices() {
  const actions = [];

  try {
    const [services] = await runClient.listServices({
      parent: `projects/${PROJECT_ID}/locations/${REGION}`,
    });

    for (const service of services) {
      const serviceName = service.name.split("/").pop();

      if (PROTECTED_SERVICES.includes(serviceName)) {
        actions.push(`PROTECTED: ${serviceName} (skipped)`);
        console.log(`Skipping protected service: ${serviceName}`);
        continue;
      }

      try {
        // Scale to 0 by setting max instances to 0
        // This stops the service from serving traffic but preserves the deployment
        const [operation] = await runClient.updateService({
          service: {
            name: service.name,
            template: {
              ...service.template,
              scaling: {
                ...service.template?.scaling,
                maxInstanceCount: 0,
              },
            },
          },
          updateMask: { paths: ["template.scaling.max_instance_count"] },
        });

        actions.push(`SCALED DOWN: ${serviceName} (max instances → 0)`);
        console.log(`Scaled down service: ${serviceName}`);
      } catch (err) {
        actions.push(`FAILED to scale down ${serviceName}: ${err.message}`);
        console.error(`Error scaling down ${serviceName}:`, err);
      }
    }
  } catch (err) {
    actions.push(`FAILED to list services: ${err.message}`);
    console.error("Error listing Cloud Run services:", err);
  }

  return actions;
}

// ── Nuclear: Disable Billing ────────────────────────────────────────────────

async function disableBilling(projectName) {
  try {
    const [info] = await billing.getProjectBillingInfo({ name: projectName });

    if (info.billingEnabled) {
      await billing.updateProjectBillingInfo({
        name: projectName,
        projectBillingInfo: { billingAccountName: "" },
      });
      return `BILLING DISABLED for ${projectName}`;
    }

    return `Billing already disabled for ${projectName}`;
  } catch (err) {
    return `FAILED to disable billing: ${err.message}`;
  }
}

// ── PagerDuty ───────────────────────────────────────────────────────────────

async function alertPagerDuty(summary, severity, details) {
  const dedup = `gcp-billing-${new Date().toISOString().split("T")[0]}`;

  try {
    const res = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: PAGERDUTY_ROUTING_KEY,
        event_action: "trigger",
        dedup_key: dedup,
        payload: {
          summary,
          source: "gcp-billing-kill-switch",
          severity,
          component: "gcp-cloud-run",
          group: PROJECT_ID,
          class: "billing",
          custom_details: details,
        },
        client: "GCP Billing Kill Switch",
        client_url: `https://console.cloud.google.com/billing?project=${PROJECT_ID}`,
      }),
    });

    if (!res.ok) {
      console.error(`PagerDuty error: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("PagerDuty alert failed:", err);
  }
}
