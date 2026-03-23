# Cloud Switch

**Monitor cloud spending, auto-kill runaway services, protect your infrastructure.**

Born from a **$91,316 Cloudflare Durable Objects bill**. Cloudflare has no spending cap. Neither does GCP. This is your safety net.

## Packages

| Package | Description | Deployment |
|---------|-------------|------------|
| [`packages/api`](packages/api) | Guardian API — Express server with monitoring engine, rule engine, billing | GCP Cloud Run |
| [`packages/web`](packages/web) | Dashboard — React SPA with Auth0 | Cloudflare Pages |
| [`packages/cloud-switch-cf`](packages/cloud-switch-cf) | Cloudflare Cloud Switch — self-hosted cron Worker | Cloudflare Workers |
| [`packages/cloud-switch-gcp`](packages/cloud-switch-gcp) | GCP Cloud Switch — Cloud Function triggered by budget alerts | GCP Cloud Functions |
| [`packages/agent`](packages/agent) | Edge Agent — deploys to customer's CF account, reports to Guardian API | Customer's Cloudflare |
| [`site`](site) | Landing page with VEO3 videos | Static / CF Pages |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cloud Switch                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Dashboard (React)  ──→  Guardian API (Cloud Run)               │
│                          ├── Monitoring Engine (5-min cron)      │
│                          ├── Rule Engine (programmable)          │
│                          ├── Alerting (PD/Discord/Slack)         │
│                          ├── Database Cloud Switch                │
│                          ├── Forensic Snapshots                  │
│                          └── Stripe Billing                      │
│                                                                  │
│  Model A: Managed        Model B: Edge Agent                    │
│  (we hold credentials)   (customer holds credentials)           │
│  API ──→ CF/GCP APIs     Agent ──→ CF/GCP APIs locally         │
│                           Agent ──→ Reports to API              │
│                                                                  │
│  Cloud Switches (self-hosted, open source)                       │
│  ├── CF Worker (cron, GraphQL, auto-disconnect)                 │
│  └── GCP Cloud Function (budget alerts, Cloud Run scale-down)   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone
git clone https://github.com/AiExpanse/cloud-switch.git
cd cloud-switch

# Run the API locally
cd packages/api
npm install
npm run dev

# Run the dashboard locally
cd packages/web
npm install
npm run dev

# Deploy the self-hosted kill switch
cd packages/cloud-switch-cf
npm install
npx wrangler deploy
```

## Tests

```bash
cd packages/api
npm test
# 118 tests across 8 files
```

## License

MIT — Use it, fork it, protect your wallet.
