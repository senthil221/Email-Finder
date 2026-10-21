import { db } from "@/lib/server";
import { insights, RANGES, type Range } from "@/lib/views";
import { loadLadder } from "@/lib/ladder";

export const dynamic = "force-dynamic";

/** Pattern performance and outcome analytics (?range=24h|7d|30d|all). */
export async function GET(req: Request) {
  const r = new URL(req.url).searchParams.get("range") ?? "7d";
  const range = (r in RANGES ? r : "7d") as Range;
  const d = await db();
  const [data, ladder] = await Promise.all([insights(d, range), loadLadder(d)]);
  return Response.json({ ...data, ladder });
}
