import { db } from "@/lib/server";
import { listLookups } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Single-lookup history, newest first (?page=0&size=50). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const size = Math.min(200, Math.max(1, Number(url.searchParams.get("size")) || 50));
  const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
  return Response.json(await listLookups(await db(), size, page * size));
}
