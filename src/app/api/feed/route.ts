import { db } from "@/lib/server";
import { recentVerifications } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Latest MailTester checks, newest first (?limit=30). */
export async function GET(req: Request) {
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 30));
  return Response.json({ items: await recentVerifications(await db(), limit) });
}
