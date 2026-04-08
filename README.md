# SaaS CRO Audit (Vercel-ready)

Single-URL PLG-focused CRO audit tool:
- Scrapes a SaaS landing page
- Captures desktop + mobile full-page screenshots
- Extracts DOM evidence + pricing signals
- Generates CRO recommendations (heuristics + optional Claude vision)

## Local setup

1) Install dependencies

```bash
npm install
```

2) Create `.env.local`

Use the provided `.env.local` placeholders and fill in:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `FIRECRAWL_API_KEY`
- `ANTHROPIC_API_KEY` (optional; enables Claude vision)
- `WORKER_TOKEN` (required for worker endpoint)

3) Supabase database + storage

In Supabase SQL editor, run:
- `supabase/migrations/0001_init.sql`
- `supabase/migrations/0002_jobs_and_pricing.sql`

In Supabase Storage:
- create a private bucket named `audit-artifacts`

4) Run dev server

```bash
npm run dev
```

Then open:
- `/audits/new` to create an audit
- `/audits/[id]` to view progress/results

## Vercel deployment

### Environment variables (Vercel)
Add these in **Vercel → Project Settings → Environment Variables**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUDIT_ARTIFACTS_BUCKET` (default `audit-artifacts`)
- `FIRECRAWL_API_KEY`
- `ANTHROPIC_API_KEY` (optional)
- `ANTHROPIC_MODEL` (optional, default `claude-3-5-sonnet-latest`)
- `WORKER_TOKEN`

### Cron worker (Vercel Cron)
Cron is defined via `vercel.json` in this repo and will be created on production deploy.

Add a secret in Vercel:
- `CRON_SECRET` (random long secret)

Vercel will call the worker endpoint on the schedule and include:
- `Authorization: Bearer $CRON_SECRET`

For manual debugging, you can also call it yourself using `x-worker-token` if `WORKER_TOKEN` is set.

The worker endpoint is:
- **Method**: `POST`
- **Path**: `/api/worker/run`

This design avoids running long jobs inside `POST /api/audits`, which is not reliable on serverless.\n+
## Notes
- The app currently uses Supabase **service role** key for simplicity (single-tenant MVP). Before making it multi-user, add auth + RLS and move to least-privilege patterns.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
