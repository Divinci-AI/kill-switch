# GCP Billing Cloud Switch

**Selectively disable GCP Cloud Run services when spending exceeds budget thresholds.**

A Cloud Function triggered by GCP Budget Alerts via Pub/Sub. When your monthly spend exceeds the configured threshold, it scales down non-protected Cloud Run services and pages PagerDuty.

Unlike "nuclear" approaches that disable all billing (killing everything including free-tier services), this selectively targets Cloud Run while preserving your infrastructure.

## How It Works

```
GCP Budget ($500/mo) → 50%/80%/100% alerts
    ↓
Pub/Sub topic: billing-alerts
    ↓
Cloud Function: gcp-billing-kill-switch
    ↓ (when cost > 80% of budget)
    ├── Scale down non-protected Cloud Run services (max instances → 0)
    ├── Page PagerDuty (critical — calls until acknowledged)
    └── At 50%: Warning alert only (no action)
```

## Quick Start

### 1. Enable required APIs

```bash
gcloud services enable \
  billingbudgets.googleapis.com \
  cloudfunctions.googleapis.com \
  pubsub.googleapis.com \
  eventarc.googleapis.com \
  run.googleapis.com \
  --project=YOUR_PROJECT_ID
```

### 2. Create Pub/Sub topic

```bash
gcloud pubsub topics create billing-alerts --project=YOUR_PROJECT_ID
```

### 3. Create budget with alerts

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="GCP Cloud Switch Budget" \
  --budget-amount=500 \
  --threshold-rule=percent=0.5,basis=current-spend \
  --threshold-rule=percent=0.8,basis=current-spend \
  --threshold-rule=percent=1.0,basis=current-spend \
  --notifications-rule-pubsub-topic=projects/YOUR_PROJECT_ID/topics/billing-alerts \
  --filter-projects="projects/YOUR_PROJECT_ID"
```

### 4. Deploy the Cloud Function

```bash
gcloud functions deploy gcp-billing-kill-switch \
  --gen2 \
  --runtime=nodejs22 \
  --region=us-central1 \
  --source=. \
  --entry-point=killSwitch \
  --trigger-topic=billing-alerts \
  --set-env-vars="GCP_PROJECT_ID=YOUR_PROJECT_ID,GCP_REGION=us-central1,KILL_THRESHOLD=0.8,NUCLEAR_MODE=false,PAGERDUTY_ROUTING_KEY=YOUR_PD_KEY,PROTECTED_SERVICES=my-critical-api" \
  --memory=256MB \
  --timeout=120s \
  --project=YOUR_PROJECT_ID
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GCP_PROJECT_ID` | Required | Your GCP project ID |
| `GCP_REGION` | `us-central1` | Cloud Run region to monitor |
| `KILL_THRESHOLD` | `0.8` | Cost ratio (0-1) at which to take action |
| `NUCLEAR_MODE` | `false` | If `true`, disables all billing (kills everything). If `false`, selectively scales down Cloud Run. |
| `PROTECTED_SERVICES` | (empty) | Semicolon-separated Cloud Run services to never scale down |
| `PAGERDUTY_ROUTING_KEY` | (empty) | PagerDuty Events API v2 integration key for phone alerts |

## What It Does at Each Threshold

| Budget % | Action |
|----------|--------|
| 50% | PagerDuty warning alert (no action) |
| 80%+ | Scale down non-protected Cloud Run services + PagerDuty critical alert |
| Nuclear mode | Disable billing entirely (not recommended) |

## Protected Services

Services listed in `PROTECTED_SERVICES` will never be scaled down, even when the budget is exceeded. Use semicolons as separators:

```bash
PROTECTED_SERVICES=my-api;my-webhook-handler
```

## Part of Cloud Switch

This is the GCP component of the [Cloud Switch](https://github.com/Divinci-AI/cloudflare-billing-kill-switch) project. See also:

- [Cloudflare Billing Cloud Switch](https://github.com/Divinci-AI/cloudflare-billing-kill-switch) — auto-disconnect runaway Cloudflare Workers

## License

MIT
