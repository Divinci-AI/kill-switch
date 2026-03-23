/**
 * Cloud Cost Guardian API
 *
 * Express server that monitors cloud spending and auto-kills runaway services.
 * Born from a $91K Cloudflare Durable Objects bill.
 */

import express from "express";
import cors from "cors";
import morgan from "morgan";
import cron from "node-cron";
import { runCheckCycle } from "./services/monitoring-engine.js";
import { getAllProviders, getProvider } from "./providers/index.js";
import { cloudAccountRouter } from "./routes/cloud-accounts/index.js";
import { alertRouter } from "./routes/alerts/index.js";
import { rulesRouter } from "./routes/rules/index.js";
import { databaseRouter } from "./routes/database/index.js";
import { billingRouter, enforceTierLimits } from "./routes/billing/index.js";
import { openApiSpec } from "./routes/docs/openapi.js";
import { GuardianAccountModel } from "./models/guardian-account/schema.js";
import { connectMongoDB, initPostgresTables, getUsageHistory, getAlertHistory } from "./globals/index.js";
import { requireAuth, resolveGuardianAccount } from "./middleware/auth.js";

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(":method :url :status :response-time ms"));

// ─── Auth Middleware ─────────────────────────────────────────────────────────
// All /cloud-accounts and /alerts routes require authentication.
// In dev mode, use X-Guardian-Account-Id header to bypass.
// In production, Auth0 JWT is verified and account auto-provisioned.

app.use("/cloud-accounts", requireAuth, resolveGuardianAccount);
app.use("/alerts", requireAuth, resolveGuardianAccount);

// ─── Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get("/", (_req, res) => {
  res.json({
    service: "cloud-cost-guardian",
    status: "healthy",
    version: "0.1.0",
    providers: getAllProviders().map(p => ({ id: p.id, name: p.name })),
    endpoints: {
      "/": "Health check",
      "/providers": "List supported providers",
      "/providers/:id/validate": "Validate cloud credentials",
      "/cloud-accounts": "Manage connected cloud accounts",
      "/alerts/channels": "Configure alert channels",
      "/alerts/test": "Test alert delivery",
      "/check": "Run manual monitoring check",
      "/accounts": "Manage Guardian account",
    },
    timestamp: Date.now(),
  });
});

// Provider info
app.get("/providers", (_req, res) => {
  res.json({
    providers: getAllProviders().map(p => ({
      id: p.id,
      name: p.name,
      defaultThresholds: p.getDefaultThresholds(),
    })),
  });
});

app.post("/providers/:providerId/validate", async (req, res, next) => {
  try {
    const provider = getProvider(req.params.providerId as any);
    if (!provider) {
      return res.status(404).json({ error: `Unknown provider: ${req.params.providerId}` });
    }
    const result = await provider.validateCredential(req.body);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// Cloud account management
app.use("/cloud-accounts", cloudAccountRouter);

// Alert management
app.use("/alerts", alertRouter);

// Rules — public endpoints
app.get("/rules/presets", rulesRouter);
// Rules — authenticated endpoints
app.use("/rules", requireAuth, resolveGuardianAccount, rulesRouter);

// Database kill switch (snapshot → verify → isolate → nuke)
app.use("/database", requireAuth, resolveGuardianAccount, databaseRouter);

// Billing — public endpoints
app.get("/billing/plans", billingRouter);
// Billing — authenticated endpoints
app.use("/billing", requireAuth, resolveGuardianAccount, billingRouter);

// Agent report endpoint (receives metrics from edge-deployed guardian-agent workers)
app.post("/agent/report", async (req, res, next) => {
  try {
    const apiKey = req.headers.authorization?.replace("Bearer ", "");
    const agentType = req.headers["x-guardian-agent"];

    if (!apiKey) {
      return res.status(401).json({ error: "Missing API key" });
    }

    // TODO: Validate API key against Guardian account
    // For MVP, accept any report and store it
    const report = req.body;

    console.error(`[guardian] Agent report from ${report.accountId}: ${report.services?.length || 0} services, ${report.violations?.length || 0} violations`);

    // Store in PostgreSQL if available
    try {
      const { recordUsageSnapshot } = await import("./globals/index.js");
      await recordUsageSnapshot(
        report.accountId,
        "agent-report",
        "cloudflare",
        { services: report.services, totalCost: report.totalEstimatedDailyCostUSD },
        report.violations || [],
        report.actionsTaken || [],
        report.totalEstimatedDailyCostUSD || 0,
        report.services?.length || 0
      );
    } catch {
      // Postgres may not be connected
    }

    res.json({ received: true, timestamp: Date.now() });
  } catch (e) {
    next(e);
  }
});

// API Documentation (Scalar UI — zero dependencies, CDN-hosted)
app.get("/docs/openapi.json", (_req, res) => res.json(openApiSpec));
app.get("/docs", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><title>Cloud Cost Guardian API Docs</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
</head><body>
<script id="api-reference" data-url="/docs/openapi.json" data-configuration='${JSON.stringify({
  theme: "kepler",
  layout: "modern",
  darkMode: true,
  hiddenClients: ["node"],
  metaData: { title: "Cloud Cost Guardian API" },
})}'></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`);
});

// Manual check trigger
app.post("/check", async (_req, res, next) => {
  try {
    const results = await runCheckCycle();
    res.json({
      status: "checked",
      accountsChecked: results.length,
      violations: results.filter(r => r.status === "violation").length,
      errors: results.filter(r => r.status === "error").length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

// ─── Account Management (simplified for MVP) ───────────────────────────────

app.post("/accounts", async (req, res, next) => {
  try {
    const { name, ownerUserId } = req.body;
    if (!name || !ownerUserId) {
      return res.status(400).json({ error: "Missing name or ownerUserId" });
    }

    const existing = await GuardianAccountModel.findOne({ ownerUserId });
    if (existing) {
      return res.json({ id: existing._id, name: existing.name, tier: existing.tier, existing: true });
    }

    const account = await GuardianAccountModel.create({
      ownerUserId,
      name,
      tier: "free",
      alertChannels: [],
      settings: { checkIntervalMinutes: 360, dailyReportEnabled: false },
    });

    res.status(201).json({ id: account._id, name: account.name, tier: account.tier });
  } catch (e) {
    next(e);
  }
});

app.get("/accounts/:id", async (req, res, next) => {
  try {
    const account = await GuardianAccountModel.findById(req.params.id).lean();
    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }
    res.json(account);
  } catch (e) {
    next(e);
  }
});

// ─── Usage History (from PostgreSQL) ────────────────────────────────────────

app.get("/cloud-accounts/:id/usage", async (req, res, next) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const history = await getUsageHistory(req.params.id, days);
    res.json({ usage: history, days });
  } catch (e) {
    next(e);
  }
});

app.get("/alerts/history", async (req, res, next) => {
  try {
    const guardianAccountId = (req as any).guardianAccountId || req.query.accountId;
    if (!guardianAccountId) {
      return res.status(400).json({ error: "Missing account ID" });
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const history = await getAlertHistory(guardianAccountId, limit);
    res.json({ alerts: history });
  } catch (e) {
    next(e);
  }
});

// ─── Error Handler ──────────────────────────────────────────────────────────

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[guardian] Error:", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

// ─── Cron Scheduler ─────────────────────────────────────────────────────────

const CHECK_CRON = process.env.CHECK_CRON || "*/5 * * * *";

cron.schedule(CHECK_CRON, async () => {
  console.error(`[guardian] Cron check at ${new Date().toISOString()}`);
  try {
    await runCheckCycle();
  } catch (error) {
    console.error("[guardian] Cron check failed:", error);
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8090");

// Initialize databases, then start server
(async () => {
  try {
    await connectMongoDB();
  } catch (e: any) {
    console.warn("[guardian] MongoDB not available:", e.message);
  }

  try {
    await initPostgresTables();
  } catch (e: any) {
    console.warn("[guardian] PostgreSQL not available:", e.message);
  }

  app.listen(PORT, () => {
    console.error(`[guardian] Cloud Cost Guardian API listening on port ${PORT}`);
    console.error(`[guardian] Check schedule: ${CHECK_CRON}`);
    console.error(`[guardian] Providers: ${getAllProviders().map(p => p.name).join(", ")}`);
  });
})();
