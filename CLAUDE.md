# Cloud Kill Switch

## Tools & CLI
- Use `wrangler` directly (globally installed), NOT `npx wrangler`
- Cloudflare account ID: 14a6fa23390363382f378b5bd4a0f849

## Project Structure
- `site/` — Marketing landing page (CF Pages: `cloud-switch-site`)
- `packages/web` — React SPA dashboard (CF Pages: `kill-switch-app`)
- `packages/api` — Express.js API (GCP Cloud Run)
- `packages/kill-switch-cf` — Cloudflare kill-switch worker (cron)
- `packages/kill-switch-gcp` — GCP kill-switch
- `packages/kill-switch-aws` — AWS kill-switch
- `packages/agent` — Edge agent worker (cron)

## Domains (kill-switch.net)
- `kill-switch.net` / `www.kill-switch.net` → cloud-switch-site (CF Pages)
- `app.kill-switch.net` → kill-switch-app (CF Pages)
- `api.kill-switch.net` → CNAME to guardian-api GCP Cloud Run (needs DNS record)

## Deploy
- `npm run deploy:site` — deploy marketing site
- `npm run deploy:web` — build + deploy web app (sets VITE_API_URL)
- `npm run deploy:api` — deploy API to GCP Cloud Run
- `npm run deploy:kill-switch` — deploy CF kill-switch worker
- `npm run deploy:agent` — deploy edge agent worker
