/**
 * Alerting Service
 *
 * Sends alerts to configured channels (PagerDuty, Discord, Slack, email, webhook).
 * Reuses the same alerting logic from the open-source kill switch.
 */

import type { AlertChannel } from "../models/guardian-account/schema.js";

type Severity = "critical" | "error" | "warning" | "info";

export async function sendAlerts(
  channels: AlertChannel[],
  summary: string,
  severity: Severity,
  details: Record<string, unknown>
): Promise<void> {
  const enabledChannels = channels.filter(c => c.enabled);

  if (enabledChannels.length === 0) {
    console.warn("[guardian] No enabled alert channels configured");
    return;
  }

  const promises = enabledChannels.map(channel => {
    switch (channel.type) {
      case "pagerduty":
        return alertPagerDuty(channel, summary, severity, details);
      case "discord":
        return alertDiscord(channel, summary, severity, details);
      case "slack":
        return alertSlack(channel, summary, severity, details);
      case "webhook":
        return alertWebhook(channel, summary, severity, details);
      case "email":
        // TODO: implement email alerting (SendGrid/Resend)
        console.warn("[guardian] Email alerting not yet implemented");
        return Promise.resolve();
    }
  });

  await Promise.allSettled(promises);
}

async function alertPagerDuty(channel: AlertChannel, summary: string, severity: Severity, details: Record<string, unknown>): Promise<void> {
  const routingKey = channel.config.routingKey;
  if (!routingKey) return;

  const dedup = `guardian-${new Date().toISOString().split("T")[0]}`;
  const res = await fetch("https://events.pagerduty.com/v2/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      routing_key: routingKey,
      event_action: "trigger",
      dedup_key: dedup,
      payload: {
        summary,
        source: "cloud-cost-guardian",
        severity,
        component: "cloud-monitoring",
        class: "billing",
        custom_details: details,
      },
      client: "Cloud Cost Guardian",
    }),
  });

  if (!res.ok) {
    console.error(`[guardian] PagerDuty error: ${res.status}`);
  }
}

async function alertDiscord(channel: AlertChannel, summary: string, severity: Severity, details: Record<string, unknown>): Promise<void> {
  const webhookUrl = channel.config.webhookUrl;
  if (!webhookUrl) return;

  const colorMap = { critical: 0xFF0000, error: 0xFF6600, warning: 0xFFCC00, info: 0x0099FF };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `Cloud Cost Alert [${severity.toUpperCase()}]`,
        description: summary,
        color: colorMap[severity],
        fields: Object.entries(details).slice(0, 8).map(([key, value]) => ({
          name: key,
          value: typeof value === "string" ? value : JSON.stringify(value).substring(0, 200),
          inline: false,
        })),
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

async function alertSlack(channel: AlertChannel, summary: string, severity: Severity, details: Record<string, unknown>): Promise<void> {
  const webhookUrl = channel.config.webhookUrl;
  if (!webhookUrl) return;

  const emojiMap = { critical: ":rotating_light:", error: ":warning:", warning: ":large_yellow_circle:", info: ":information_source:" };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${emojiMap[severity]} *Cloud Cost Alert [${severity.toUpperCase()}]*\n${summary}`,
    }),
  });
}

async function alertWebhook(channel: AlertChannel, summary: string, severity: Severity, details: Record<string, unknown>): Promise<void> {
  const webhookUrl = channel.config.webhookUrl;
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary, severity, details, timestamp: new Date().toISOString(), source: "cloud-cost-guardian" }),
  });
}
