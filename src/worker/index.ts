// Entry point: `npm run worker`. Reads settings from environment variables.
import { pgDb } from "@/lib/db";
import { realDns } from "@/lib/dns";
import { scrapeSite } from "@/lib/scrape";
import { createMtnClient } from "@/lib/mailtester";
import { migrate, setWorkerStatus } from "@/lib/repo";
import { startWorker } from "./run";

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main() {
  const url = process.env.DATABASE_URL;
  const key = process.env.MTN_API_KEY;
  if (!url) throw new Error("DATABASE_URL is not set");

  const concurrency = num("WORKER_CONCURRENCY", 12);
  const db = pgDb(url, concurrency + 4);
  await migrate(db);

  if (!key) {
    // Show the problem in the app instead of crash-looping.
    console.error("[worker] MTN_API_KEY is not set; waiting.");
    for (;;) {
      await setWorkerStatus(db, "error", "MTN_API_KEY is not set on the server").catch(() => {});
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  const worker = startWorker({
    db,
    mtn: createMtnClient({
      apiKey: key,
      baseUrl: process.env.MTN_BASE_URL || undefined,
      timeoutMs: num("MTN_TIMEOUT_MS", 45_000),
    }),
    dns: realDns,
    smartLadder: true,
    mxPass: true,
    scrape: process.env.WEBSITE_PASS === "off" ? undefined : (d: string) => scrapeSite(d),
    concurrency,
    rateMax: num("MTN_RATE_MAX", 22),
    rateWindowMs: num("MTN_RATE_WINDOW_MS", 10_000),
    minSpacingMs: num("MTN_MIN_SPACING_MS", 450),
    dailyLimit: num("MTN_DAILY_LIMIT", 190_000),
    retryDelayMs: num("RETRY_DELAY_MS", 20_000),
  });
  console.log(`[worker] started with ${concurrency} parallel companies`);

  const shutdown = async () => {
    console.log("[worker] shutting down...");
    await worker.stop();
    await db.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await worker.done;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
