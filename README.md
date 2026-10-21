# Email Finder

Internal tool that finds work emails from **first name + last name + company domain**.

1. It generates 9 name combinations.
2. It verifies them one at a time with [MailTester Ninja](https://mailtester.ninja) and stops at the first valid one.
3. One person per company goes first (the "scout"):
   - If the scout is found, everyone else at that company starts on the proven pattern, usually 1 check each.
   - Catch-all companies cost 1 check and are set aside.
   - Dead domains (no mail server) cost 0 checks.
   - Everyone at a live company gets every combination: a miss for one person never skips the others.

Combinations, in try order (`src/lib/patterns.ts`):
`first@`, `first.last@`, `firstlast@`, `flast@`, `firstl@`, `first.l@`, `first_last@`, `fl@`, `f.last@`

## Pieces

| Path | What |
|---|---|
| `src/lib/patterns.ts` | Name/domain cleaning and the 9 combinations |
| `src/lib/mailtester.ts` | MailTester client; maps each answer (by its message) to an action |
| `src/lib/checker.ts` | Cache, speed limit, daily budget and retries around one check |
| `src/lib/engine.ts` | Per-company logic: scout, reuse pattern, park catch-alls |
| `src/lib/repo.ts` | All SQL (Postgres) |
| `src/worker/` | Background worker: claims companies from the queue and runs the engine |
| `src/lib/views.ts` | Read-only queries for the live screens (dashboard, feeds, lookup ladder, domains) |
| `src/app/` | Next.js web app: dashboard, live finder (Ctrl K), bulk upload, history, job detail, domains |
| `src/components/` | Shell, charts, live feed, combination ladder, UI kit (`globals.css` + `theme.css` = the design system) |

## Run locally (no real MailTester credits spent)

```bash
npm install
npm run dev:db      # in-process Postgres on :5433 (PGlite)
npm run dev:mtn     # fake MailTester on :4010
npm run worker:dev  # uses .env.local
npm run dev         # http://localhost:3000
```

`.env.local` for local dev:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable
MTN_API_KEY=local-test-key
MTN_BASE_URL=http://127.0.0.1:4010/ninja
RETRY_DELAY_MS=1000
```

Tests: `npm test`. Typecheck: `npm run typecheck`.

## Deploy (Docker Compose)

On the server, put the code in a folder and create `.env` from `.env.example`. Then run:

```bash
docker compose up -d --build
```

This starts Postgres, the web app (behind the existing Traefik, with HTTPS) and the worker. The web app is protected with HTTP Basic auth (`APP_USER` / `APP_PASSWORD`).
