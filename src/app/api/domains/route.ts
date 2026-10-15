import { db } from "@/lib/server";
import { listDomains } from "@/lib/views";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["unknown", "valid", "catch_all", "not_found", "no_mx"]);

/** Company domains the finder knows about (?status=valid&q=acme&page=0). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
  return Response.json(
    await listDomains(await db(), {
      status: status && STATUSES.has(status) ? status : undefined,
      q: url.searchParams.get("q")?.trim().slice(0, 100) || undefined,
      limit: 50,
      offset: page * 50,
    }),
  );
}
