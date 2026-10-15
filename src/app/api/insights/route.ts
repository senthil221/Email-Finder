import { db } from "@/lib/server";
import { insights, RANGES, type Range } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Pattern performance and outcome analytics (?range=24h|7d|30d|all). */
export async function GET(req: Request) {
  const r = new URL(req.url).searchParams.get("range") ?? "7d";
  const range = (r in RANGES ? r : "7d") as Range;
  return Response.json(await insights(await db(), range));
}
