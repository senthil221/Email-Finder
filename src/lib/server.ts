// Helpers for route handlers.
import { getDb, type Db } from "./db";
import { migrate } from "./repo";

const g = globalThis as unknown as { __efSchema?: Promise<void> };

/** The shared DB, with the schema created on first use. */
export async function db(): Promise<Db> {
  const d = getDb();
  if (!g.__efSchema) {
    g.__efSchema = migrate(d)
      // The worker may be creating the same tables at the same moment; try once more.
      .catch(() => new Promise((r) => setTimeout(r, 500)).then(() => migrate(d)))
      .catch((e) => {
        g.__efSchema = undefined;
        throw e;
      });
  }
  await g.__efSchema;
  return d;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function dailyLimit(): number {
  const v = Number(process.env.MTN_DAILY_LIMIT);
  return Number.isFinite(v) && v > 0 ? v : 200_000;
}
