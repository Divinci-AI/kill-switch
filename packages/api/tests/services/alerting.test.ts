import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendAlerts } from "../../src/services/alerting.js";
import type { AlertChannel } from "../../src/models/guardian-account/schema.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Alerting Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, text: async () => "{}" });
  });

  it("sends to PagerDuty with correct payload format", async () => {
    const channels: AlertChannel[] = [{
      type: "pagerduty",
      name: "On-Call",
      config: { routingKey: "test-routing-key" },
      enabled: true,
    }];

    await sendAlerts(channels, "Test alert", "critical", { cost: 91000 });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://events.pagerduty.com/v2/enqueue",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("test-routing-key"),
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.routing_key).toBe("test-routing-key");
    expect(body.event_action).toBe("trigger");
    expect(body.payload.summary).toBe("Test alert");
    expect(body.payload.severity).toBe("critical");
    expect(body.payload.custom_details.cost).toBe(91000);
  });

  it("sends to Discord with embed format", async () => {
    const channels: AlertChannel[] = [{
      type: "discord",
      name: "Alerts",
      config: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      enabled: true,
    }];

    await sendAlerts(channels, "Cost spike detected", "warning", { service: "my-worker" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/abc",
      expect.objectContaining({ method: "POST" })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toContain("WARNING");
    expect(body.embeds[0].description).toBe("Cost spike detected");
    expect(body.embeds[0].color).toBe(0xFFCC00); // warning = yellow
  });

  it("sends to Slack with block format", async () => {
    const channels: AlertChannel[] = [{
      type: "slack",
      name: "Ops",
      config: { webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx" },
      enabled: true,
    }];

    await sendAlerts(channels, "Server overloaded", "error", {});

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("ERROR");
    expect(body.text).toContain("Server overloaded");
  });

  it("sends to custom webhook with standard payload", async () => {
    const channels: AlertChannel[] = [{
      type: "webhook",
      name: "Custom",
      config: { webhookUrl: "https://my-api.com/alerts" },
      enabled: true,
    }];

    await sendAlerts(channels, "Alert!", "info", { foo: "bar" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-api.com/alerts",
      expect.objectContaining({ method: "POST" })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.summary).toBe("Alert!");
    expect(body.severity).toBe("info");
    expect(body.source).toBe("kill-switch");
    expect(body.details.foo).toBe("bar");
  });

  it("sends to multiple channels in parallel", async () => {
    const channels: AlertChannel[] = [
      { type: "pagerduty", name: "PD", config: { routingKey: "key1" }, enabled: true },
      { type: "discord", name: "Discord", config: { webhookUrl: "https://discord.com/wh" }, enabled: true },
      { type: "slack", name: "Slack", config: { webhookUrl: "https://hooks.slack.com/x" }, enabled: true },
    ];

    await sendAlerts(channels, "Multi-channel test", "critical", {});

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("skips disabled channels", async () => {
    const channels: AlertChannel[] = [
      { type: "pagerduty", name: "PD", config: { routingKey: "key1" }, enabled: false },
      { type: "discord", name: "Discord", config: { webhookUrl: "https://discord.com/wh" }, enabled: true },
    ];

    await sendAlerts(channels, "Test", "info", {});

    expect(mockFetch).toHaveBeenCalledTimes(1); // Only Discord
    expect(mockFetch.mock.calls[0][0]).toContain("discord.com");
  });

  it("handles fetch failure gracefully (does not throw)", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const channels: AlertChannel[] = [{
      type: "pagerduty",
      name: "PD",
      config: { routingKey: "key1" },
      enabled: true,
    }];

    // Should not throw
    await expect(sendAlerts(channels, "Test", "critical", {})).resolves.not.toThrow();
  });

  it("skips channels without required config", async () => {
    const channels: AlertChannel[] = [
      { type: "pagerduty", name: "PD", config: {}, enabled: true }, // No routingKey
      { type: "discord", name: "Discord", config: {}, enabled: true }, // No webhookUrl
    ];

    await sendAlerts(channels, "Test", "info", {});

    // Both should be called but return early internally
    // (the functions check for config before sending)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses correct color codes for Discord severity", async () => {
    const makeChannel = (): AlertChannel[] => [{
      type: "discord",
      name: "Test",
      config: { webhookUrl: "https://discord.com/wh" },
      enabled: true,
    }];

    await sendAlerts(makeChannel(), "Critical", "critical", {});
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).embeds[0].color).toBe(0xFF0000);

    mockFetch.mockClear();
    await sendAlerts(makeChannel(), "Error", "error", {});
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).embeds[0].color).toBe(0xFF6600);

    mockFetch.mockClear();
    await sendAlerts(makeChannel(), "Warning", "warning", {});
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).embeds[0].color).toBe(0xFFCC00);

    mockFetch.mockClear();
    await sendAlerts(makeChannel(), "Info", "info", {});
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).embeds[0].color).toBe(0x0099FF);
  });
});
