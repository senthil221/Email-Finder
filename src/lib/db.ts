// Tiny database interface so the same queries run on real Postgres (pg)
// and on PGlite in tests.
import { Pool } from "pg";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export function pgDb(connectionString: string, max = 10): Db & { end: () => Promise<void> } {
  const pool = new Pool({ connectionString, max });
  return {
    async query<T>(text: string, params?: unknown[]) {
      const res = await pool.query(text, params as unknown[]);
      return res.rows as T[];
    },
    end: () => pool.end(),
  };
}

const g = globalThis as unknown as { __efDb?: Db };

/** Shared pool for the web app (survives hot reloads in dev). */
export function getDb(): Db {
  if (!g.__efDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__efDb = pgDb(url);
  }
  return g.__efDb;
}
