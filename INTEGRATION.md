# Kill Switch Integration Guide

Step-by-step guide for Claude Code to set up Kill Switch financial protection on a Cloudflare Workers project.

## Prerequisites

- Cloudflare account with Workers enabled
- `wrangler` CLI authenticated (`wrangler login`)
- Kill Switch API running at `https://api.kill-switch.net`
- Cloudflare Secrets Store: `0b7ac993cf26413ea6e2f1b5ede20b25`

## Architecture

```
Your App (CF Worker)
  |
  +-- Spend Guard (D1 table: spend_log)
  |     Tracks per-job costs, enforces daily budgets
  |     Fires PagerDuty/Discord/Slack alerts at 80%/95%
  |
  +-- Kill Switch Edge Agent (CF Worker, cron: */5 min)
  |     Monitors CF resource usage (Workers, D1, R2, Queues)
  |     Auto-disconnects runaway services
  |     Reports metrics to Kill Switch API
  |
  +-- Kill Switch API (api.kill-switch.net)
        Dashboard, rules engine, multi-provider monitoring
```

## Step 1: Deploy the Edge Agent

The edge agent monitors your Cloudflare resources and can auto-kill runaway workers.

### 1a. Create a CF API token

In the Cloudflare dashboard, create an API token with:
- Account Analytics: Read
- Account Workers Scripts: Edit
- Account Workers Routes: Edit

### 1b. Deploy the agent

```bash
cd /Users/mikeumus/Documents/cloud-kill-switch/packages/agent
wrangler deploy
```

### 1c. Set secrets

```bash
# Your CF API token (stays local, never sent to Kill Switch API)
wrangler secret put CLOUDFLARE_API_TOKEN
# Your CF account ID
wrangler secret put CLOUDFLARE_ACCOUNT_ID
```

The `GUARDIAN_API_KEY` is already bound via Secrets Store.

### 1d. Configure thresholds

Edit `wrangler.toml` vars to match your usage patterns:

```toml
[vars]
GUARDIAN_API_URL = "https://api.kill-switch.net"
DO_REQUEST_THRESHOLD = "1000000"      # Durable Object requests/day
DO_WALLTIME_HOURS_THRESHOLD = "100"   # DO wall-time hours/day
WORKER_REQUEST_THRESHOLD = "10000000" # Worker requests/day
```

## Step 2: Add Spend Guard to Your App

The Spend Guard is an in-app layer that tracks costs for external services (RunPod, Google AI, etc.) that the edge agent can't see.

### 2a. Copy the spend-guard service

Copy `zombay/web/src/services/spend-guard.ts` into your project's services directory. Adjust:

- `SPEND_LIMITS` — set budgets appropriate for your project
- `COST_ESTIMATES` — set estimated per-operation costs for your providers
- `RUNPOD_COST_PER_SEC` — adjust if using different GPU tiers

### 2b. Wire into your generation/job submission endpoint

```typescript
import { checkSpendBudget, recordSpend } from "../services/spend-guard";

// Before processing:
const budget = await checkSpendBudget("runpod", userId);
if (!budget.allowed) {
  return new Response(JSON.stringify({ error: budget.reason }), { status: 429 });
}

// After creating the job:
await recordSpend("runpod", userId, jobId);
```

### 2c. Track actual costs in webhooks

```typescript
import { updateActualCost, RUNPOD_COST_PER_SEC } from "../services/spend-guard";

// When RunPod/provider reports completion with executionTime:
if (executionTime) {
  const actualUsd = (executionTime / 1000) * RUNPOD_COST_PER_SEC;
  await updateActualCost(jobId, actualUsd);
}
```

### 2d. Add the spend dashboard endpoint

Create `app/api/v1/spend/route.ts`:

```typescript
import { getDailySpendSummary, SPEND_LIMITS } from "../services/spend-guard";

export async function GET(request: Request) {
  // Add auth check here
  const summary = await getDailySpendSummary();
  return Response.json({
    date: new Date().toISOString().split("T")[0],
    total_usd: summary.totalUsd,
    budget_limit_usd: SPEND_LIMITS.DAILY_GLOBAL_USD,
    paused: summary.totalUsd >= SPEND_LIMITS.DAILY_GLOBAL_USD,
    by_provider: summary.byProvider,
  });
}
```

## Step 3: Set Up Alerting

### 3a. Store PagerDuty routing key

The key is already in the shared Secrets Store:

```toml
# In your wrangler.toml / wrangler.jsonc:
[[secrets_store_secrets]]
binding = "PAGERDUTY_ROUTING_KEY"
store_id = "0b7ac993cf26413ea6e2f1b5ede20b25"
secret_name = "PAGERDUTY_ROUTING_KEY"
```

### 3b. (Optional) Add Discord webhook

```bash
# Create the secret
wrangler secrets-store secret create 0b7ac993cf26413ea6e2f1b5ede20b25 \
  --name YOUR_PROJECT_DISCORD_WEBHOOK --scopes workers --remote
```

Then bind it:
```toml
[[secrets_store_secrets]]
binding = "DISCORD_WEBHOOK_URL"
store_id = "0b7ac993cf26413ea6e2f1b5ede20b25"
secret_name = "YOUR_PROJECT_DISCORD_WEBHOOK"
```

### 3c. Alert thresholds

Alerts fire automatically from the Spend Guard:
- **80% of daily budget** → PagerDuty warning + Discord/Slack
- **95% of daily budget** → PagerDuty critical (pages on-call)
- **100%** → All generation blocked with 429 response

## Step 4: Protect External Service Integrations

### RunPod GPU

```typescript
// In your RunPod client, add execution timeout:
{
  input: { /* your workflow */ },
  webhook: `https://yourapp.com/api/webhooks/runpod?secret=${webhookSecret}`,
  policy: {
    executionTimeout: 600, // 10 min max (seconds, not ms!)
  }
}
```

Webhook authentication:
```typescript
// Require RUNPOD_WEBHOOK_SECRET on all webhook requests
const secret = await getEnv("RUNPOD_WEBHOOK_SECRET");
if (!secret) return new Response("Not configured", { status: 503 });
const provided = new URL(request.url).searchParams.get("secret");
if (provided !== secret) return new Response("Unauthorized", { status: 401 });
```

### Google Gemini / VEO

Add a circuit breaker to polling loops:
```typescript
const maxPolls = Math.ceil(maxWaitMs / pollIntervalMs);
let polls = 0;
while (Date.now() - start < maxWaitMs) {
  polls++;
  if (polls > maxPolls) throw new Error("Circuit breaker: max polls exceeded");
  // ... poll logic
}
```

### Credit Refunds on Async Failure

When a provider webhook reports failure, refund the user:
```typescript
if (status === "FAILED" && job.creditsCharged > 0) {
  await refundCredits(db, job.userId, job.creditsCharged);
}
```

## Step 5: D1 Table Auto-Init

The `spend_log` table auto-creates on first use. No manual migration needed. Schema:

```sql
CREATE TABLE spend_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  provider TEXT NOT NULL,
  user_id TEXT NOT NULL,
  job_id TEXT,
  estimated_usd REAL NOT NULL DEFAULT 0,
  actual_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_spend_log_date_provider ON spend_log(date, provider);
CREATE INDEX idx_spend_log_date_user ON spend_log(date, user_id);
```

## Step 6: Verify

```bash
# Check edge agent is running
curl https://guardian-agent.your-workers.dev/

# Check spend dashboard
curl -H "Authorization: Bearer YOUR_TOKEN" https://yourapp.com/api/v1/spend

# Test PagerDuty integration
curl -X POST https://events.pagerduty.com/v2/enqueue \
  -H "Content-Type: application/json" \
  -d '{"routing_key":"YOUR_KEY","event_action":"trigger","payload":{"summary":"Test alert","source":"kill-switch-setup","severity":"info"}}'
```

## Reference: Secrets Store

All secrets are centralized in Cloudflare Secrets Store `0b7ac993cf26413ea6e2f1b5ede20b25`.

| Secret Name | Purpose | Used By |
|-------------|---------|---------|
| PAGERDUTY_ROUTING_KEY | PagerDuty Events v2 | All projects |
| GUARDIAN_AGENT_API_KEY | Agent → API auth | Edge agent |
| CF_ORIGIN_SECRET | Origin verification | API proxy → Cloud Run |
| RUNPOD_WEBHOOK_SECRET | Webhook auth | Zombay |

## Reference: Budget Limits (Zombay defaults)

| Limit | Default | What It Protects |
|-------|---------|-----------------|
| DAILY_GLOBAL_USD | $50 | Total platform runaway |
| DAILY_PER_USER_JOBS | 100 | Single-account abuse |
| RUNPOD_DAILY_USD | $25 | GPU cost explosion |
| RUNPOD_JOB_TIMEOUT_SEC | 600 | Stuck/infinite GPU jobs |
| RUNPOD_MAX_CONCURRENT | 10 | Parallel job flood |
| VEO_DAILY_REQUESTS | 200 | API quota burn |
| TTS_DAILY_REQUESTS | 500 | TTS abuse |

Adjust these per project. A project with heavier GPU usage (like Divinci.ai) may need higher RunPod limits.
